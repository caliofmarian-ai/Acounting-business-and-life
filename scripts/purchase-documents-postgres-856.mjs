// #856: disposable PostgreSQL 16 only; no real account, provider, receipt or deployment access.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { normalizeMerchantPurchaseDocument, merchantPurchaseDocumentInternals } from '../merchant-purchase-documents.js';

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


// Genuine PostgreSQL row-lock ordering. Only disposable CI tables and synthetic grants.
test('revoked Merchant binding or membership cannot pass the post-upload receipt write lock', async () => {
  const pool = new pg.Pool({max:3});
  const writer=await pool.connect(),revoker=await pool.connect(),observer=await pool.connect();
  const {lockMerchantDocumentWriteAuthority:lockGrant}=merchantPurchaseDocumentInternals;
  let pending=null;
  try {
    assert.equal((await observer.query('SELECT current_database() AS db')).rows[0].db,'abl_receipts_856_ci');
    await observer.query('CREATE TABLE profile_business_bindings(account_id BIGINT,role TEXT,business_id BIGINT,status TEXT)');
    await observer.query('CREATE TABLE business_memberships(account_id BIGINT,business_id BIGINT,active BOOLEAN)');
    await observer.query("INSERT INTO profile_business_bindings VALUES(9101,'merchant',201,'active')");
    await observer.query('INSERT INTO business_memberships VALUES(9101,201,TRUE)');
    const writerPid=(await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const revokerPid=(await revoker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const blocking=async(target,blocker)=>{
      for(let i=0;i<35;i++){
        const pids=(await observer.query('SELECT pg_blocking_pids($1::int) AS pids',[target])).rows[0].pids;
        if(pids.includes(blocker))return true;
        await new Promise(resolve=>setTimeout(resolve,25));
      }
      return false;
    };
    await writer.query('BEGIN');
    await lockGrant(writer,9101,201);
    pending=revoker.query("UPDATE profile_business_bindings SET status='revoked' WHERE account_id=9101 AND business_id=201");
    assert.equal(await blocking(revokerPid,writerPid),true,'binding revocation must wait for receipt transaction');
    await writer.query('COMMIT');
    await pending;pending=null;
    await assert.rejects(()=>lockGrant(writer,9101,201),e=>e.status===403);
    await writer.query("UPDATE profile_business_bindings SET status='active' WHERE account_id=9101 AND business_id=201");
    await revoker.query('BEGIN');
    await revoker.query('UPDATE business_memberships SET active=FALSE WHERE account_id=9101 AND business_id=201');
    pending=lockGrant(writer,9101,201);
    assert.equal(await blocking(writerPid,revokerPid),true,'post-upload check must wait for membership revocation');
    await revoker.query('COMMIT');
    await assert.rejects(pending,e=>e.status===403);pending=null;
    await assert.rejects(()=>lockGrant(writer,9101,202),e=>e.status===403);
    console.log(JSON.stringify({status:'PASS',db:'isolated PostgreSQL 16',postUploadGrantLock:true,realBlockingObserved:true,revokeBeforeLockDenied:true,persistedReceipt:false}));
  } finally {
    await writer.query('ROLLBACK').catch(()=>{});
    await revoker.query('ROLLBACK').catch(()=>{});
    if(pending)await pending.catch(()=>{});
    await observer.query('DROP TABLE IF EXISTS business_memberships').catch(()=>{});
    await observer.query('DROP TABLE IF EXISTS profile_business_bindings').catch(()=>{});
    writer.release();revoker.release();observer.release();await pool.end();
  }
});
