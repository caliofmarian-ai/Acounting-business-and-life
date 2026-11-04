import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {monetizationInternals} from '../monetization-core.js';

// This is run ONLY in the existing Admin Runtime CI PostgreSQL service.
// No production/Preview database is a valid target for this test.
test('Local Services historical backfill SELECT uses real isolated PostgreSQL 16', {timeout: 60000}, async t => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.PGDATABASE, 'abl_admin_ci');
  assert.equal(process.env.PGHOST, '127.0.0.1');
  assert.equal(process.env.RAILWAY_SERVICE_NAME, 'accounting-admin-runtime-ci');

  const pool = new pg.Pool({max: 1, connectionTimeoutMillis: 5000});
  const client = await pool.connect();
  try {
    const context = await client.query(
      "SELECT current_database() db, inet_server_addr()::text addr, current_setting('server_version_num')::integer version"
    );
    assert.equal(context.rows[0].db, 'abl_admin_ci');
    // GitHub Actions maps the 127.0.0.1 runner port to the container's RFC1918
    // address (e.g. 172.18.0.2/32); the database connection itself must
    // still originate through the runner's loopback PGHOST above.
    assert.match(context.rows[0].addr, /^(?:127\.0\.0\.1|10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+)(?:\/32)?$/);
    assert.ok(context.rows[0].version >= 160000);

    await client.query('BEGIN');
    // TEMP tables shadow actual application tables on THIS connection only.
    // Rollback removes every fixture; no persistent CI or application row changes.
    for (const sql of [
      'CREATE TEMP TABLE businesses(id bigint, territory_id bigint) ON COMMIT DROP',
      'CREATE TEMP TABLE orders(id bigint, business_id bigint, completed_at timestamptz, subtotal numeric(14,2), currency_code text, order_status text) ON COMMIT DROP',
      'CREATE TEMP TABLE deliveries(id bigint, courier_account_id bigint, business_id bigint, delivered_at timestamptz, delivery_fee numeric(14,2), currency_code text, status text) ON COMMIT DROP',
      'CREATE TEMP TABLE purchase_orders(id bigint, supplier_account_id bigint, business_id bigint, received_at timestamptz, actual_received_total numeric(14,2), status text) ON COMMIT DROP',
      'CREATE TEMP TABLE service_monetization_events(id bigint, event_key text) ON COMMIT DROP',
      'CREATE TEMP TABLE service_jobs(id bigint, provider_account_id bigint, status text, customer_confirmed_at timestamptz, pricing_locked_at timestamptz, accepted_quote_id bigint, agreed_total numeric(14,2), legacy_final_adjustment numeric(14,2), final_price numeric(14,2), quote_amount numeric(14,2), currency_code text) ON COMMIT DROP',
      'CREATE TEMP TABLE service_job_quotes(id bigint, job_id bigint, status text, total_amount numeric(14,2), currency_code text, legacy_record boolean) ON COMMIT DROP'
    ]) await client.query(sql);

    const jobColumns = [
      'id', 'provider_account_id', 'status', 'customer_confirmed_at',
      'pricing_locked_at', 'accepted_quote_id', 'agreed_total',
      'legacy_final_adjustment', 'final_price', 'quote_amount', 'currency_code'
    ];
    const quoteColumns = ['id', 'job_id', 'status', 'total_amount', 'currency_code', 'legacy_record'];
    const baseJob = {
      id: 44, provider_account_id: 7, status: 'completed',
      customer_confirmed_at: '2026-10-27T11:00:00Z',
      pricing_locked_at: '2026-10-27T09:00:00Z', accepted_quote_id: 91,
      agreed_total: '1275.50', legacy_final_adjustment: null,
      final_price: '1275.50', quote_amount: '1000.00', currency_code: 'PHP'
    };
    const baseQuote = {
      id: 91, job_id: 44, status: 'accepted', total_amount: '1275.50',
      currency_code: 'PHP', legacy_record: false
    };
    const insert = (table, columns, row) => client.query(
      `INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map((_, i) => '$' + (i + 1)).join(',')})`,
      columns.map(column => row[column] ?? null)
    );
    const insertJob = row => insert('service_jobs', jobColumns, row);
    const insertQuote = row => insert('service_job_quotes', quoteColumns, row);
    const seed = async (job = baseJob, quote = baseQuote) => {
      await client.query('TRUNCATE service_job_quotes, service_jobs');
      await insertJob(job);
      if (quote) await insertQuote(quote);
    };
    // The same real Postgres SELECTs as production, but no mutation API.
    const readOnly = {query: (sql, params) => {
      assert.match(sql, /^\s*SELECT\b/i, 'historical preflight must be read-only');
      return client.query(sql, params);
    }};
    const history = () => monetizationInternals.historicalRows(readOnly);
    const rejectsIntegrity = error =>
      error?.code === 'SERVICE_JOB_PRICE_INTEGRITY_MISMATCH' && error.status === 409;

    await t.test('valid V2 quote yields exact centavos from the joined row', async () => {
      await seed();
      const rows = await history();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].serviceScope, 'local_services');
      assert.equal(rows[0].gross_value, 1275.5);
      assert.equal(Number(rows[0].accepted_quote_ref_id), 91); // BIGINT is a string in node-postgres
    });

    await t.test('missing, moved, withdrawn, mismatched or wrong-currency quote fails closed', async () => {
      const cases = [
        [baseJob, null],
        [baseJob, {...baseQuote, job_id: 45}],
        [baseJob, {...baseQuote, status: 'withdrawn'}],
        [baseJob, {...baseQuote, total_amount: '1000.00'}],
        [baseJob, {...baseQuote, currency_code: 'EUR'}],
        [baseJob, {...baseQuote, id: 92}]
      ];
      for (const [job, quote] of cases) {
        await seed(job, quote);
        await assert.rejects(history, rejectsIntegrity);
      }
    });

    await t.test('incomplete V2 snapshot and completed-price mismatch fail closed', async () => {
      for (const job of [
        {...baseJob, agreed_total: null},
        {...baseJob, accepted_quote_id: null},
        {...baseJob, accepted_quote_id: null, agreed_total: null},
        {...baseJob, final_price: null},
        {...baseJob, accepted_quote_id: null, agreed_total: null, pricing_locked_at: null,
          legacy_final_adjustment: '25.00', final_price: '300.00'},
        {...baseJob, final_price: '1276.00'},
        {...baseJob, legacy_final_adjustment: '25.00', final_price: '1300.50'}
      ]) {
        await seed(job);
        await assert.rejects(history, rejectsIntegrity);
      }
    });

    await t.test('evidenced migrated adjustment and pre-V2 historical amounts remain valid', async () => {
      await seed(
        {...baseJob, legacy_final_adjustment: '25.00', final_price: '1300.50'},
        {...baseQuote, legacy_record: true}
      );
      assert.equal((await history())[0].gross_value, 1300.5);
      await seed({...baseJob, final_price: null}, {...baseQuote, legacy_record: true});
      assert.equal((await history())[0].gross_value, 1275.5);
      await seed({
        ...baseJob, accepted_quote_id: null, agreed_total: null,
        pricing_locked_at: null, legacy_final_adjustment: null,
        final_price: '350.00', quote_amount: '300.00'
      }, null);
      assert.equal((await history())[0].gross_value, 350);
    });

    await t.test('malformed later row aborts preflight without writing an event', async () => {
      await seed();
      await insertJob({
        ...baseJob, id: 45, accepted_quote_id: 92,
        customer_confirmed_at: '2026-10-27T12:00:00Z', final_price: '9999.00'
      });
      await insertQuote({...baseQuote, id: 92, job_id: 45});
      await assert.rejects(history, rejectsIntegrity);
      const events = await client.query('SELECT COUNT(*)::integer count FROM service_monetization_events');
      assert.equal(events.rows[0].count, 0);
    });
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await pool.end();
  }
});
