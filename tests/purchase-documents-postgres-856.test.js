// #856: disposable PostgreSQL 16 only; no real account, provider, receipt or deployment access.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { normalizeMerchantPurchaseDocument } from '../merchant-purchase-documents.js';

if (process.env.NODE_ENV !== 'test' || process.env.RECEIPTS_856_ISOLATED !== '1' ||
    process.env.PGHOST !== '127.0.0.1' || process.env.PGDATABASE !== 'abl_receipts_856_ci' ||
    process.env.DATABASE_URL || process.env.PAYMONGO_LIVE_ENABLED !== 'false') {
  throw new Error('Purchase document PostgreSQL regression requires the dedicated disposable CI database.');
}

const base = gross_amount => ({
  business_id: 14, client_request_key: 'receipt-856-ci-20261104', document_kind: 'purchase_receipt',
  issue_date: '2026-11-04', currency_code: 'PHP', gross_amount, links: []
});

test('literal purchase document normalization preserves NUMERIC(14,2) values in real PostgreSQL', async () => {
  const pool = new pg.Pool();
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    assert.equal(client.connection.stream.remoteAddress, '127.0.0.1');
    const db = await client.query('SELECT current_database() AS name');
    assert.equal(db.rows[0].name, 'abl_receipts_856_ci');
    await client.query('BEGIN'); transactionStarted = true;
    await client.query('CREATE TEMP TABLE receipt_856 (amount NUMERIC(14,2), issue_date DATE) ON COMMIT DROP');
    let checks = 0;
    for (const [input, expected] of [
      ['0.01', '0.01'], ['145.25', '145.25'], ['999999999999.99', '999999999999.99']
    ]) {
      const normalized = normalizeMerchantPurchaseDocument(base(input));
      const stored = await client.query(
        'INSERT INTO receipt_856(amount,issue_date) VALUES ($1,$2) RETURNING amount::text,issue_date::text',
        [normalized.amount, normalized.issueDate]
      );
      assert.equal(stored.rows[0].amount, expected);
      assert.equal(stored.rows[0].issue_date, '2026-11-04');
      checks += 2;
    }
    for (const invalid of ['100.005','0.001','1e3','1000000000000','999999999999.999']) {
      assert.throws(() => normalizeMerchantPurchaseDocument(base(invalid)), /Invalid document amount/);
      checks++;
    }
    for (const invalid of ['2026-11-04junk','2026-11-04T00:00:00Z','2026-02-29']) {
      assert.throws(() => normalizeMerchantPurchaseDocument({...base('15.20'),issue_date:invalid}), /Invalid issue date/);
      checks++;
    }
    const n = await client.query('SELECT COUNT(*)::int AS count FROM receipt_856');
    assert.equal(n.rows[0].count, 3); checks++;
    // PostgreSQL by itself rounds: this is precisely why the API rejects such evidence.
    const rounded = await client.query('SELECT ($1::numeric(14,2))::text AS value', ['100.005']);
    assert.notEqual(rounded.rows[0].value, '100.005'); checks++;
    await client.query('ROLLBACK'); transactionStarted = false;
    console.log(JSON.stringify({status:'PASS',checks,db:'isolated PostgreSQL 16',source:'actual normalizer',persisted:false}));
  } finally {
    if(transactionStarted) await client.query('ROLLBACK').catch(()=>{});
    client.release(); await pool.end();
  }
});
