// #856: disposable PostgreSQL 16 only; no real account, provider, receipt or deployment access.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { normalizeMerchantPurchaseDocument, normalizeMerchantPurchaseDocumentEvidence, merchantPurchaseDocumentInternals } from '../merchant-purchase-documents.js';

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
    // Observe the expected denial from the moment the asynchronous query
    // starts: it may reject in the event-loop turn that releases the lock.
    pending=lockGrant(writer,9101,201).then(
      ()=>({allowed:true}),error=>({allowed:false,error}));
    assert.equal(await blocking(writerPid,revokerPid),true,'post-upload check must wait for membership revocation');
    await revoker.query('COMMIT');
    const deniedGrant=await pending;
    assert.equal(deniedGrant.allowed,false);
    assert.equal(deniedGrant.error.status,403);pending=null;
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


// Synthetic linked purchase rows in disposable CI only. Actual two-connection
// PostgreSQL locks prove reassignments cannot slip past the receipt final check.
test('receipt association recheck holds source business ownership stable until COMMIT',async()=>{
  const pool=new pg.Pool({max:3});
  const writer=await pool.connect(),changer=await pool.connect(),observer=await pool.connect();
  const validate=merchantPurchaseDocumentInternals.validatePurchaseLinks;
  const links=[{kind:'inventory_purchase',id:101}];
  let pending=null;
  try{
    assert.equal((await observer.query('SELECT current_database() AS db')).rows[0].db,'abl_receipts_856_ci');
    await observer.query('CREATE TABLE inventory_purchases(id BIGINT PRIMARY KEY,business_id BIGINT NOT NULL)');
    await observer.query('INSERT INTO inventory_purchases VALUES(101,14)');
    const writerPid=(await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const changerPid=(await changer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const blocked=async(target,blocker)=>{
      for(let n=0;n<50;n++){
        const ids=(await observer.query('SELECT pg_blocking_pids($1::int) AS ids',[target])).rows[0].ids;
        if(ids.includes(blocker))return true;
        await new Promise(done=>setTimeout(done,20));
      }
      return false;
    };
    await writer.query('BEGIN');
    await validate(writer,14,links,{lockRows:true});
    pending=changer.query('UPDATE inventory_purchases SET business_id=15 WHERE id=101');
    assert.equal(await blocked(changerPid,writerPid),true,'business reassignment waits for receipt COMMIT');
    await writer.query('COMMIT');
    await pending;pending=null;
    await assert.rejects(()=>validate(writer,14,links,{lockRows:true}),e=>e.status===404);

    await observer.query('UPDATE inventory_purchases SET business_id=14 WHERE id=101');
    await changer.query('BEGIN');
    await changer.query('UPDATE inventory_purchases SET business_id=15 WHERE id=101');
    pending=validate(writer,14,links,{lockRows:true}).then(
      ()=>({allowed:true}),error=>({allowed:false,error}));
    assert.equal(await blocked(writerPid,changerPid),true,'receipt verification waits for a pending change');
    await changer.query('COMMIT');
    const deniedLink=await pending;
    assert.equal(deniedLink.allowed,false);
    assert.equal(deniedLink.error.status,404);pending=null;
    await observer.query('UPDATE inventory_purchases SET business_id=14 WHERE id=101');
    await writer.query('BEGIN');
    await validate(writer,14,links,{lockRows:true});
    await writer.query('ROLLBACK');
    console.log(JSON.stringify({status:'PASS',db:'isolated PostgreSQL 16',sourceRowShareLock:true,
      businessReassignmentWaited:true,changedOwnershipDenied:true,persistedReceipts:false}));
  }finally{
    await changer.query('ROLLBACK').catch(()=>{});
    await writer.query('ROLLBACK').catch(()=>{});
    if(pending)await pending.catch(()=>{});
    await observer.query('DROP TABLE IF EXISTS inventory_purchases').catch(()=>{});
    writer.release();changer.release();observer.release();await pool.end();
  }
});


// Real PostgreSQL 16 verification for append-only supplementary evidence.
// The one-connection adapter keeps every temporary table confined to this CI session.
test('supplementary evidence is separately persisted, idempotent and business-bound in PostgreSQL 16',async()=>{
  const pool=new pg.Pool({max:1});
  const connection=await pool.connect();
  const db={
    query:(...args)=>connection.query(...args),
    connect:async()=>({query:(...args)=>connection.query(...args),release:()=>{}})
  };
  let uploads=0,bindings=0,deletions=0;
  try{
    assert.equal((await connection.query('SELECT current_database() AS db')).rows[0].db,'abl_receipts_856_ci');
    await connection.query('CREATE TEMP TABLE profile_business_bindings(account_id BIGINT,role TEXT,business_id BIGINT,status TEXT)');
    await connection.query('CREATE TEMP TABLE business_memberships(account_id BIGINT,business_id BIGINT,active BOOLEAN)');
    await connection.query('CREATE TEMP TABLE merchant_purchase_documents(id BIGINT PRIMARY KEY,business_id BIGINT NOT NULL,private_evidence_object_id BIGINT)');
    await connection.query(`CREATE TEMP TABLE private_evidence_objects(
      id BIGSERIAL PRIMARY KEY,owner_account_id BIGINT NOT NULL,source_type TEXT NOT NULL,source_id TEXT NOT NULL,
      original_file_name TEXT NOT NULL,detected_mime TEXT NOT NULL,byte_size BIGINT NOT NULL,
      scan_status TEXT NOT NULL,retention_state TEXT NOT NULL
    )`);
    await connection.query(`CREATE TEMP TABLE merchant_purchase_document_evidence(
      id BIGSERIAL PRIMARY KEY,document_id BIGINT NOT NULL,business_id BIGINT NOT NULL,
      created_by_account_id BIGINT NOT NULL,client_request_key TEXT NOT NULL,request_fingerprint TEXT NOT NULL,
      private_evidence_object_id BIGINT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(document_id,client_request_key)
    )`);
    await connection.query("INSERT INTO profile_business_bindings VALUES(9101,'merchant',201,'active'),(9101,'merchant',202,'active')");
    await connection.query('INSERT INTO business_memberships VALUES(9101,201,TRUE),(9101,202,TRUE)');
    await connection.query("INSERT INTO private_evidence_objects(id,owner_account_id,source_type,source_id,original_file_name,detected_mime,byte_size,scan_status,retention_state) VALUES(700,9101,'merchant_purchase_document','101','original.png','image/png',68,'clean','active')");
    await connection.query('INSERT INTO merchant_purchase_documents(id,business_id,private_evidence_object_id) VALUES(101,201,700)');
    const record=normalizeMerchantPurchaseDocumentEvidence({
      client_request_key:'pg-supplementary-20261113-01',file_name:'delivery-note.png',
      data_url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2s5YAAAAASUVORK5CYII='
    },{businessId:201,documentId:101});
    const storeEvidence=async(poolArg,input)=>{
      uploads++;
      const saved=await poolArg.query(`
        INSERT INTO private_evidence_objects(owner_account_id,source_type,source_id,original_file_name,
          detected_mime,byte_size,scan_status,retention_state)
        VALUES($1,$2,$3,$4,'image/png',68,'clean','active')
        RETURNING id,original_file_name,detected_mime,byte_size
      `,[input.ownerAccountId,input.sourceType,input.sourceId,input.fileName]);
      return saved.rows[0];
    };
    const bindEvidence=async(client,input)=>{
      bindings++;
      const saved=await client.query(`
        UPDATE private_evidence_objects SET source_type=$1,source_id=$2
         WHERE id=$3 AND owner_account_id=$4 AND retention_state='active'
        RETURNING id
      `,[input.sourceType,input.sourceId,input.objectId,input.actorAccountId]);
      assert.equal(saved.rowCount,1);
    };
    const deleteEvidence=async(poolArg,input)=>{
      deletions++;
      await poolArg.query("UPDATE private_evidence_objects SET retention_state='deleted' WHERE id=$1",[input.objectId]);
    };
    const args={actorAccountId:9101,businessId:201,documentId:101,record,storeEvidence,bindEvidence,deleteEvidence};
    const first=await merchantPurchaseDocumentInternals.appendPurchaseDocumentEvidence(db,args);
    assert.equal(first.already_saved,false);
    assert.equal(first.evidence.document_id,101);
    assert.equal(first.evidence.business_id,201);
    assert.equal(first.evidence.file_name,'delivery-note.png');
    const object=(await connection.query('SELECT source_type,source_id,owner_account_id FROM private_evidence_objects WHERE id=(SELECT private_evidence_object_id FROM merchant_purchase_document_evidence WHERE id=$1)',[first.evidence.id])).rows[0];
    assert.deepEqual(object,{source_type:'merchant_purchase_document_attachment',source_id:String(first.evidence.id),owner_account_id:'9101'});
    const original=(await connection.query('SELECT private_evidence_object_id FROM merchant_purchase_documents WHERE id=101')).rows[0];
    assert.equal(Number(original.private_evidence_object_id),700,'original scan object is unchanged');
    const replay=await merchantPurchaseDocumentInternals.appendPurchaseDocumentEvidence(db,args);
    assert.equal(replay.already_saved,true);
    assert.equal(replay.evidence.id,first.evidence.id);
    assert.equal(uploads,1,'idempotent replay does not upload a second object');
    const changed=normalizeMerchantPurchaseDocumentEvidence({
      client_request_key:record.key,file_name:'different.png',data_url:record.dataUrl
    },{businessId:201,documentId:101});
    await assert.rejects(()=>merchantPurchaseDocumentInternals.appendPurchaseDocumentEvidence(db,{...args,record:changed}),
      error=>error.status===409);
    const foreign=normalizeMerchantPurchaseDocumentEvidence({
      client_request_key:'pg-supplementary-20261113-02',file_name:'foreign.png',data_url:record.dataUrl
    },{businessId:202,documentId:101});
    await assert.rejects(()=>merchantPurchaseDocumentInternals.appendPurchaseDocumentEvidence(db,{
      ...args,businessId:202,record:foreign
    }),error=>error.status===404);
    assert.equal(uploads,1,'foreign-business receipt is rejected before private storage is invoked');
    assert.equal(deletions,0,'no private object is created for a missing/foreign receipt');
    const counts=await connection.query(`
      SELECT (SELECT COUNT(*)::int FROM merchant_purchase_document_evidence) AS attachments,
             (SELECT COUNT(*)::int FROM merchant_purchase_documents WHERE private_evidence_object_id=700) AS original_links,
             (SELECT COUNT(*)::int FROM private_evidence_objects WHERE retention_state='deleted') AS deleted_uploads
    `);
    assert.deepEqual(counts.rows[0],{attachments:1,original_links:1,deleted_uploads:0});
    console.log(JSON.stringify({status:'PASS',db:'isolated PostgreSQL 16',append:true,replay:true,
      changedPayloadConflict:true,foreignBusinessDenied:true,originalPreserved:true,uploads,bindings,deletions}));
  }finally{
    connection.release();
    await pool.end();
  }
});
