import assert from 'node:assert/strict';
import {once} from 'node:events';
import test from 'node:test';
import {setTimeout as sleep} from 'node:timers/promises';
import express from 'express';
import pg from 'pg';
import {registerReceiptIntelligenceRoutes} from '../receipt-intelligence-routes.js';

const connectionString=process.env.RECEIPT_860_PG_URL;

test('receipt variance evidence serializes with blind-count resume on PostgreSQL',{
  skip:!connectionString,timeout:15000
},async()=>{
  const database=new URL(connectionString);
  assert.equal(database.protocol,'postgresql:');
  assert.equal(database.hostname,'127.0.0.1');
  assert.equal(database.pathname,'/abl_receipt_variance_860_test');
  assert.equal(database.search,'');
  const pool=new pg.Pool({connectionString,max:5,statement_timeout:5000});
  let server,blocker;
  const app=express();
  registerReceiptIntelligenceRoutes({app,pool,body:express.json(),identity:async()=>({
    account:{id:1},profiles:[{role:'merchant',enabled:true}]
  })});
  app.use((error,_req,res,_next)=>res.status(error.status??500).json({error:error.message}));

  const waitForBlockedQuery=async pattern=>{
    for(let attempt=0;attempt<70;attempt++){
      const {rowCount}=await pool.query(`SELECT pid FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1`,[pattern]);
      if(rowCount)return;
      await sleep(25);
    }
    assert.fail('Expected concurrent SQL to wait for a row or relation lock');
  };
  try{
    await pool.query(`
      CREATE TABLE businesses(id BIGINT PRIMARY KEY);
      CREATE TABLE profile_business_bindings(account_id BIGINT,role TEXT,business_id BIGINT,status TEXT,is_primary BOOLEAN);
      CREATE TABLE business_memberships(account_id BIGINT,business_id BIGINT,active BOOLEAN);
      CREATE TABLE inventory_count_sessions(id BIGINT PRIMARY KEY,business_id BIGINT,status TEXT);
      CREATE TABLE inventory_count_session_items(session_id BIGINT,inventory_id BIGINT,expected_quantity NUMERIC,counted_quantity NUMERIC);
      CREATE TABLE inventory(id BIGINT,business_id BIGINT,item TEXT,unit TEXT);
      CREATE TABLE inventory_purchases(id BIGINT,business_id BIGINT,inventory_id BIGINT,total_cost NUMERIC,
        purchase_quantity NUMERIC,purchase_unit TEXT,created_at TIMESTAMPTZ);
      CREATE TABLE merchant_purchase_documents(id BIGINT,business_id BIGINT,issuer_name TEXT,document_number TEXT,issue_date DATE);
      CREATE TABLE merchant_purchase_document_links(document_id BIGINT,link_kind TEXT,linked_id BIGINT);
      INSERT INTO businesses VALUES (10),(20);
      INSERT INTO profile_business_bindings VALUES (1,'merchant',10,'active',TRUE),(1,'merchant',20,'active',FALSE);
      INSERT INTO business_memberships VALUES (1,10,TRUE),(1,20,TRUE);
      INSERT INTO inventory_count_sessions VALUES (123,10,'review'),(456,10,'posted');
      INSERT INTO inventory VALUES (100,10,'Synthetic rice','g');
      INSERT INTO inventory_count_session_items VALUES (123,100,1000,750);
      INSERT INTO inventory_purchases VALUES (101,10,100,50,1,'kg',NOW());
      INSERT INTO merchant_purchase_documents VALUES (102,10,'Synthetic market','QA-860','2026-10-30');
      INSERT INTO merchant_purchase_document_links VALUES (102,'inventory_purchase',101);
    `);
    server=app.listen(0,'127.0.0.1');
    await once(server,'listening');
    const get=(sessionId=123,businessId=10)=>fetch(
      `http://127.0.0.1:${server.address().port}/api/procurement/receipt-intelligence/count-sessions/${sessionId}/variance-evidence?business_id=${businessId}`
    );
    blocker=await pool.connect();

    // Resume wins the row lock before the evidence request reads its grant.
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM inventory_count_sessions WHERE id=123 FOR UPDATE');
    await blocker.query("UPDATE inventory_count_sessions SET status='in_progress' WHERE id=123");
    const afterResume=get();
    await waitForBlockedQuery('SELECT status FROM inventory_count_sessions%FOR SHARE');
    await blocker.query('COMMIT');
    const denied=await afterResume;
    assert.equal(denied.status,409);
    assert.equal(denied.headers.get('cache-control'),'private, no-store, max-age=0');
    assert.deepEqual(await denied.json(),{error:'Finish blind counting before viewing documents'});

    // Evidence wins first. Delay its findings SELECT and prove that resume
    // cannot change the status between authorization and reading quantities.
    await pool.query("UPDATE inventory_count_sessions SET status='review' WHERE id=123");
    await blocker.query('BEGIN');
    await blocker.query('LOCK TABLE inventory_count_session_items IN ACCESS EXCLUSIVE MODE');
    const evidence=get();
    await waitForBlockedQuery('%FROM inventory_count_session_items si%');
    const concurrentResume=pool.query("UPDATE inventory_count_sessions SET status='in_progress' WHERE id=123");
    await waitForBlockedQuery("UPDATE inventory_count_sessions SET status='in_progress' WHERE id=123");
    await blocker.query('COMMIT');
    const visible=await evidence;
    assert.equal(visible.status,200);
    assert.equal(visible.headers.get('cache-control'),'private, no-store, max-age=0');
    const report=await visible.json();
    assert.equal(report.session_status,'review');
    assert.equal(report.stock_posted,false);
    assert.equal(report.findings.length,1);
    assert.equal(report.findings[0].expected,1000);
    assert.equal(report.findings[0].variance,-250);
    assert.equal(report.findings[0].receipt.id,102);
    await concurrentResume;
    assert.equal((await get()).status,409);
    assert.equal((await get(123,20)).status,404);
    const posted=await get(456);
    assert.equal(posted.status,200);
    assert.deepEqual(await posted.json(),{count_session_id:456,session_status:'posted',stock_posted:false,findings:[]});
  }finally{
    if(blocker){
      await blocker.query('ROLLBACK').catch(()=>{});
      blocker.release();
    }
    if(server)await new Promise(resolve=>server.close(resolve));
    await pool.end();
  }
});
