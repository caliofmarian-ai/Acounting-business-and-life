import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import {createOrderPaymentIntent,createServiceJobPaymentIntent,serviceJobPaymentSummary,createRefundRequest} from '../payment-core.js';

// Real PostgreSQL 16, isolated disposable schema, synthetic financial identities only.
test('payment key atomicity and scoped replay (isolated PostgreSQL)',{timeout:60000},async t=>{
  assert.equal(process.env.NODE_ENV,'test');
  assert.equal(process.env.PGHOST,'127.0.0.1');
  assert.equal(process.env.PGDATABASE,'abl_payment_intent_ci');
  assert.equal(process.env.RAILWAY_SERVICE_NAME,'accounting-payment-concurrency-ci');
  const admin=new pg.Pool({max:1,connectionTimeoutMillis:5000});
  const schema='payment_intent_qa_'+crypto.randomBytes(6).toString('hex');
  let pool;
  try{
    await admin.query('CREATE SCHEMA "'+schema+'"');
    pool=new pg.Pool({max:5,options:'-c search_path='+schema,connectionTimeoutMillis:5000,statement_timeout:12000});
    for(const sql of [
      'CREATE TABLE businesses(id bigint PRIMARY KEY,territory_id bigint)',
      'CREATE TABLE orders(id bigint PRIMARY KEY,business_id bigint,customer_account_id bigint,payment_method text,outstanding_amount numeric(14,2),subtotal numeric(14,2),delivery_fee numeric(14,2),currency_code text)',
      'CREATE TABLE payment_intents(id bigserial PRIMARY KEY,public_id text UNIQUE NOT NULL,idempotency_key text UNIQUE NOT NULL,source_type text,source_id bigint,payer_account_id bigint,business_id bigint,territory_id bigint,provider_code text,provider_status text,provider_payment_id text,logical_method text,currency_code text,amount numeric(14,2),status text,client_reference text,expires_at timestamptz,created_at timestamptz DEFAULT NOW(),updated_at timestamptz DEFAULT NOW(),succeeded_at timestamptz,cancelled_at timestamptz)',
      'CREATE TABLE order_payments(order_id bigint,merchandise_amount numeric(14,2),delivery_amount numeric(14,2),status text)',
      'CREATE TABLE payment_allocations(payment_intent_id bigint,component_code text,economic_party_type text,economic_party_id text,gross_base numeric(14,2),amount numeric(14,2),currency_code text,settlement_status text,rule_snapshot jsonb)',
      'CREATE TABLE service_jobs(id bigint PRIMARY KEY,customer_account_id bigint,provider_account_id bigint,status text,customer_confirmed_at timestamptz,accepted_quote_id bigint,agreed_total numeric(14,2),final_price numeric(14,2),pricing_locked_at timestamptz,currency_code text,quote_amount numeric(14,2),legacy_final_adjustment numeric(14,2))',
      'CREATE TABLE service_job_quotes(id bigint PRIMARY KEY,job_id bigint,status text,total_amount numeric(14,2),currency_code text,legacy_record boolean)',
      'CREATE TABLE refunds(id bigserial PRIMARY KEY,payment_intent_id bigint,public_id text UNIQUE,amount numeric(14,2),currency_code text,reason text,status text,requested_by_account_id bigint,request_key text UNIQUE)',
      'CREATE TABLE payment_audit_events(actor_account_id bigint,payment_intent_id bigint,event_code text,provider_code text,after_json jsonb,correlation_id text)',
      'CREATE TABLE admin_audit_events(actor_account_id bigint,assignment_id bigint,permission_code text,country_code text,target_type text,target_id text,event_code text,after_json jsonb,reason text,correlation_id text)'
    ])await pool.query(sql);
    await pool.query('INSERT INTO businesses VALUES(6,2),(7,2)');
    await pool.query("INSERT INTO orders VALUES(31,6,7,'online',200,200,0,'PHP'),(32,7,8,'online',200,200,0,'PHP'),(33,6,7,'online',200,200,0,'PHP')");
    // Real completed Pricing V2 service jobs, with distinct accepted-quote
    // snapshots: no real Customer/payment-provider accounts are used.
    await pool.query(`INSERT INTO service_jobs(id,customer_account_id,provider_account_id,status,
      customer_confirmed_at,accepted_quote_id,agreed_total,final_price,pricing_locked_at,
      currency_code,quote_amount) VALUES
      (91,7,17,'completed',NOW(),901,200,200,NOW(),'PHP',200),
      (92,7,17,'completed',NOW(),902,200,200,NOW(),'PHP',200),
      (93,7,17,'completed',NOW(),903,200,200,NOW(),'PHP',200),
      (94,7,17,'completed',NOW(),904,200,200,NOW(),'PHP',200)`);
    await pool.query(`INSERT INTO service_job_quotes(id,job_id,status,total_amount,currency_code,legacy_record)
      VALUES(901,91,'accepted',200,'PHP',FALSE),
            (902,92,'accepted',200,'PHP',FALSE),
            (903,93,'accepted',200,'PHP',FALSE),
            (904,94,'accepted',200,'PHP',FALSE)`);

    const count=async table=>Number((await pool.query('SELECT COUNT(*)::int n FROM '+table)).rows[0].n);
    const a={orderId:31,payerAccountId:7,idempotencyKey:'two-orders-one-key'};
    const b={orderId:32,payerAccountId:8,idempotencyKey:'two-orders-one-key'};
    await t.test('two concurrent different Orders with one key: 409, not 23505 or a second intent',async()=>{
      let resolveRead,releaseFirst,resolveSecondLock;
      const firstRead=new Promise(resolve=>{resolveRead=resolve});
      const firstGo=new Promise(resolve=>{releaseFirst=resolve});
      const secondAtLock=new Promise(resolve=>{resolveSecondLock=resolve});
      const bridge=which=>({
        connect:async()=>{
          const db=await pool.connect();
          return{
            async query(sql,params){
              if(which==='B'&&sql.includes('pg_advisory_xact_lock'))resolveSecondLock();
              const response=await db.query(sql,params);
              if(which==='A'&&sql.includes('FROM payment_intents WHERE idempotency_key')&&response.rowCount===0){
                resolveRead();
                await firstGo;
              }
              return response;
            },
            release:()=>db.release()
          };
        }
      });
      let first,second;
      try{
        first=createOrderPaymentIntent(bridge('A'),a);
        await firstRead;
        let secondDone=false;
        second=createOrderPaymentIntent(bridge('B'),b).then(
          value=>{secondDone=true;return {value}},
          error=>{secondDone=true;return {error}}
        );
        await secondAtLock;
        await new Promise(resolve=>setTimeout(resolve,80));
        assert.equal(secondDone,false,'second different-Order caller must wait on same key');
      }finally{
        releaseFirst();
      }
      const original=await first;
      const concurrent=await second;
      assert.equal(concurrent.error?.status,409);
      assert.equal(concurrent.error?.code,'PAYMENT_INTENT_SCOPE_CONFLICT');
      assert.ok(original.id);
      assert.equal(await count('payment_intents'),1);
      assert.equal(await count('payment_allocations'),1);
      const replay=await createOrderPaymentIntent(pool,a);
      assert.equal(String(replay.id),String(original.id));
      assert.equal(await count('payment_intents'),1);
      assert.equal(await count('payment_allocations'),1);
      // Same literal key and Order must not switch the provider or method,
      // nor acknowledge an intent in a changed source currency.
      for(const changed of [{logicalMethod:'card'},{providerCode:'different-provider'}]){
        await assert.rejects(createOrderPaymentIntent(pool,{...a,...changed}),
          e=>e?.status===409&&e?.code==='PAYMENT_INTENT_DETAILS_CONFLICT');
      }
      await pool.query("UPDATE orders SET currency_code='USD' WHERE id=31");
      try{
        await assert.rejects(createOrderPaymentIntent(pool,a),
          e=>e?.status===409&&e?.code==='PAYMENT_INTENT_DETAILS_CONFLICT');
      }finally{
        await pool.query("UPDATE orders SET currency_code='PHP' WHERE id=31");
      }
      assert.equal(await count('payment_intents'),1);
      assert.equal(await count('payment_allocations'),1);
      await pool.query('UPDATE orders SET outstanding_amount=0 WHERE id=31');
      const settledReplay=await createOrderPaymentIntent(pool,a);
      assert.equal(String(settledReplay.id),String(original.id));
      await assert.rejects(createOrderPaymentIntent(pool,{...a,idempotencyKey:'new-key-after-paid'}),
        e=>e?.status===409&&/already paid/.test(e.message));
      assert.equal(await count('payment_intents'),1);
    });
    await t.test('different keys cannot create two live Order payment intents',async()=>{
      const firstArgs={orderId:33,payerAccountId:7,idempotencyKey:'order33-first'};
      const first=await createOrderPaymentIntent(pool,firstArgs);
      const replay=await createOrderPaymentIntent(pool,firstArgs);
      assert.equal(String(replay.id),String(first.id),'same key must replay safely');
      for(const status of ['requires_provider','requires_action','processing']){
        await pool.query('UPDATE payment_intents SET status=$1 WHERE id=$2',[status,first.id]);
        await assert.rejects(
          createOrderPaymentIntent(pool,{...firstArgs,idempotencyKey:'order33-new-'+status}),
          e=>e?.status===409&&e?.code==='ORDER_PAYMENT_ALREADY_PENDING'
        );
      }
      assert.equal((await pool.query("SELECT count(*)::int n FROM payment_intents WHERE source_type='order' AND source_id=33")).rows[0].n,1);
      assert.equal((await pool.query('SELECT count(*)::int n FROM payment_allocations WHERE payment_intent_id=$1',[first.id])).rows[0].n,1);
      // An aged PROCESSING payment could still settle asynchronously; TTL
      // alone must not permit a second key to create another checkout.
      await pool.query("UPDATE payment_intents SET expires_at=NOW()-INTERVAL '1 hour' WHERE id=$1",[first.id]);
      await assert.rejects(
        createOrderPaymentIntent(pool,{...firstArgs,idempotencyKey:'order33-new-expired-processing'}),
        e=>e?.status===409&&e?.code==='ORDER_PAYMENT_ALREADY_PENDING'
      );
      // An unconfigured provider has no provider-backed charge in progress.
      await pool.query("UPDATE payment_intents SET status='requires_provider' WHERE id=$1",[first.id]);
      const replacement=await createOrderPaymentIntent(pool,{
        ...firstArgs,idempotencyKey:'order33-after-unconfigured-expiry'
      });
      assert.notEqual(String(replacement.id),String(first.id));
      assert.equal((await pool.query("SELECT count(*)::int n FROM payment_intents WHERE source_type='order' AND source_id=33")).rows[0].n,2);
    });
    await t.test('overlength keys reject distinct suffixes rather than collide',async()=>{
      const beforeIntents=await count('payment_intents');
      for(const suffix of ['alpha','bravo']){
        await assert.rejects(createOrderPaymentIntent(pool,{...b,idempotencyKey:'x'.repeat(220)+suffix}),
          e=>e?.status===400&&e?.code==='PAYMENT_IDEMPOTENCY_KEY_INVALID');
      }
      assert.equal(await count('payment_intents'),beforeIntents);
    });
    await t.test('padded/control/nonstring keys never alias a committed intent',async()=>{
      const before=await count('payment_intents');
      for(const invalid of [
        'two-orders-one-key ',' two-orders-one-key',
        'two-orders-one-key\n','\ttwo-orders-one-key',12345,false
      ]){
        await assert.rejects(
          createOrderPaymentIntent(pool,{...b,idempotencyKey:invalid}),
          e=>e?.status===400&&e?.code==='PAYMENT_IDEMPOTENCY_KEY_INVALID'
        );
      }
      assert.equal(await count('payment_intents'),before,
        'rejected aliases cannot create or mutate payment intents');
      assert.equal(await count('payment_allocations'),before,
        'rejected aliases cannot create allocations');
    });

    await t.test('invalid provider identities cannot create payment intents or allocations',async()=>{
      const beforeIntents=await count('payment_intents');
      const beforeAllocations=await count('payment_allocations');
      for(const [i,invalid] of [
        ' provider_x','provider_x ','provider_x\n','x'.repeat(81),
        42,false,[],{provider:'provider_x'}
      ].entries()){
        await assert.rejects(
          createOrderPaymentIntent(pool,{...b,idempotencyKey:'bad-provider-'+i,providerCode:invalid}),
          e=>e?.status===400&&e?.code==='PAYMENT_PROVIDER_CODE_INVALID'
        );
      }
      assert.equal(await count('payment_intents'),beforeIntents);
      assert.equal(await count('payment_allocations'),beforeAllocations);
    });
    await t.test('allocation error rolls back key; original attempt may be safely retried',async()=>{
      const priorIntents=await count('payment_intents');
      const priorAllocations=await count('payment_allocations');
      const key='rollback-only-key';
      const injected={connect:async()=>{
        const db=await pool.connect();
        return{
          async query(sql,params){
            if(sql.startsWith('INSERT INTO payment_allocations'))throw Error('synthetic failed allocation');
            return db.query(sql,params);
          },
          release:()=>db.release()
        };
      }};
      await assert.rejects(createOrderPaymentIntent(injected,{...b,idempotencyKey:key}),/synthetic failed allocation/);
      const before=await pool.query('SELECT COUNT(*)::int n FROM payment_intents WHERE idempotency_key=$1',[key]);
      assert.equal(before.rows[0].n,0);
      const accepted=await createOrderPaymentIntent(pool,{...b,idempotencyKey:key});
      assert.ok(accepted.id);
      assert.equal(await count('payment_intents'),priorIntents+1);
      assert.equal(await count('payment_allocations'),priorAllocations+1);
    });
    await t.test('invalid fractional-cent and coerced refunds never write a real PostgreSQL reservation',async()=>{
      const before=await count('refunds');
      for(const amount of [true,[1],'0.015',0.015,'1e2','1.999',' 10.00','01.00','9999999999999.00']){
        await assert.rejects(
          createRefundRequest(pool,{intentId:'pi_qa_missing_refund_preflight',amount,
            idempotencyKey:'pg_refund_invalid_fraction_001'}),
          e=>e?.status===409&&e?.code==='REFUND_AMOUNT_INVALID'
        );
      }
      assert.equal(await count('refunds'),before,
        'no malformed amount can create a real PostgreSQL refund row');
    });
    await t.test('two concurrent full-value refund reservations cannot exceed the succeeded payment',async()=>{
      // Use a synthetic succeeded intent, not a PayMongo provider or real refund.
      const seed=await pool.query(`INSERT INTO payment_intents(
        public_id,idempotency_key,source_type,source_id,payer_account_id,business_id,
        territory_id,provider_code,logical_method,currency_code,amount,status
      ) VALUES('pi_qa_refund_race','qa_refund_race','order',31,7,6,2,'','card','PHP',200,'succeeded')
      RETURNING id`);
      const id=seed.rows[0].id;
      const input={intentId:id,amount:200,reason:'isolated concurrent reservation',requestedBy:7,idempotencyKey:'pg_refund_concurrent_a'};
      let atRead,releaseFirst,atLock;
      const firstRead=new Promise(resolve=>{atRead=resolve});
      const firstGo=new Promise(resolve=>{releaseFirst=resolve});
      const secondAtLock=new Promise(resolve=>{atLock=resolve});
      const wrap=which=>({connect:async()=>{
        const db=await pool.connect();
        return{
          async query(sql,args){
            if(which==='B'&&sql.includes('FROM payment_intents WHERE id::text=$1 OR public_id=$1 FOR UPDATE'))atLock();
            const result=await db.query(sql,args);
            if(which==='A'&&sql.includes('SELECT COALESCE(SUM(amount),0) total FROM refunds')){
              atRead();
              await firstGo;
            }
            return result;
          },
          release:()=>db.release()
        };
      }});
      let first,second;
      try{
        first=createRefundRequest(wrap('A'),input);
        await firstRead;
        let secondDone=false;
        second=createRefundRequest(wrap('B'),{...input,idempotencyKey:'pg_refund_concurrent_b'}).then(
          value=>{secondDone=true;return {value}},
          error=>{secondDone=true;return {error}}
        );
        await secondAtLock;
        // The second connection is blocked on the real payment_intents
        // row lock while the first connection has only READ the old sum.
        await new Promise(resolve=>setTimeout(resolve,80));
        assert.equal(secondDone,false,'competing refund must wait for the intent lock');
        const waiting=await pool.query(`
          SELECT COUNT(*)::int n FROM pg_stat_activity
          WHERE datname=current_database() AND wait_event_type='Lock'
            AND query LIKE 'SELECT id,amount,currency_code,status FROM payment_intents WHERE id::text=%'
        `);
        assert.ok(waiting.rows[0].n>=1,'actual PostgreSQL row lock wait must be observable');
      }finally{
        releaseFirst();
      }
      const winner=await first;
      const loser=await second;
      assert.equal(winner.status,'requested');
      assert.equal(loser.error?.status,409);
      assert.match(loser.error?.message||'',/exceeds refundable balance/);
      const q=await pool.query('SELECT count(*)::int n, COALESCE(SUM(amount),0) total FROM refunds WHERE payment_intent_id=$1',[id]);
      assert.equal(q.rows[0].n,1);
      assert.equal(Number(q.rows[0].total),200);
      const replay=await createRefundRequest(pool,input);
      assert.equal(replay.__idempotent_replay,true,'same-key network retry recovers prior reservation');
      assert.equal(replay.id,winner.id);
      await assert.rejects(createRefundRequest(pool,{...input,amount:199}),
        e=>e?.status===409&&e?.code==='REFUND_REQUEST_KEY_CONFLICT');
      await assert.rejects(createRefundRequest(pool,{...input,idempotencyKey:'pg_refund_concurrent_c'}),
        e=>e?.status===409&&/exceeds refundable balance/.test(e.message));
      assert.equal((await pool.query('SELECT count(*)::int n FROM refunds WHERE payment_intent_id=$1',[id])).rows[0].n,1);
    });
    await t.test('refund insert failure rolls back and permits corrected reservation',async()=>{
      const seed=await pool.query(`INSERT INTO payment_intents(
        public_id,idempotency_key,source_type,source_id,payer_account_id,business_id,
        territory_id,provider_code,logical_method,currency_code,amount,status
      ) VALUES('pi_qa_refund_rollback','qa_refund_rollback','order',31,7,6,2,'','card','PHP',200,'succeeded')
      RETURNING id`);
      const id=seed.rows[0].id;
      // Actual database trigger, not a synthetic query exception. The rollback
      // must release the row lock and preserve the full refundable balance.
      await pool.query(`CREATE FUNCTION payment_ci_reject_refund()
        RETURNS trigger LANGUAGE plpgsql AS $refusal$
        BEGIN
          RAISE EXCEPTION 'isolated refund refusal' USING ERRCODE='P0001';
        END; $refusal$`);
      await pool.query(`CREATE TRIGGER payment_ci_reject_refund
        BEFORE INSERT ON refunds FOR EACH ROW EXECUTE FUNCTION payment_ci_reject_refund()`);
      const input={intentId:id,amount:130,requestedBy:7,idempotencyKey:'pg_refund_rollback_first'};
      try{
        await assert.rejects(createRefundRequest(pool,input),e=>e?.code==='P0001');
        assert.equal((await pool.query('SELECT count(*)::int n FROM refunds WHERE payment_intent_id=$1',[id])).rows[0].n,0);
      }finally{
        await pool.query('DROP TRIGGER IF EXISTS payment_ci_reject_refund ON refunds');
        await pool.query('DROP FUNCTION IF EXISTS payment_ci_reject_refund()');
      }
      const first=await createRefundRequest(pool,input);
      assert.equal(Number(first.amount),130);
      const remainder=await createRefundRequest(pool,{intentId:'pi_qa_refund_rollback',amount:70,requestedBy:7,idempotencyKey:'pg_refund_rollback_second'});
      assert.equal(Number(remainder.amount),70);
      await assert.rejects(createRefundRequest(pool,{intentId:id,amount:1,requestedBy:7,idempotencyKey:'pg_refund_rollback_over'}),
        e=>e?.status===409);
      const sum=await pool.query('SELECT count(*)::int n, COALESCE(SUM(amount),0) total FROM refunds WHERE payment_intent_id=$1',[id]);
      assert.equal(sum.rows[0].n,2);
      assert.equal(Number(sum.rows[0].total),200);
    });

    await t.test('refund admin audit failure rolls back key/amount; retry and replay record exactly one audit',async()=>{
      const seed=await pool.query(`INSERT INTO payment_intents(
        public_id,idempotency_key,source_type,source_id,payer_account_id,business_id,
        territory_id,provider_code,logical_method,currency_code,amount,status
      ) VALUES('pi_qa_refund_audit','qa_refund_audit','order',31,7,6,2,'','card','PHP',200,'succeeded')
      RETURNING id`);
      const intentId=seed.rows[0].id;
      const input={intentId,amount:75,requestedBy:7,reason:'qa audit atomicity',
        idempotencyKey:'pg_refund_audit_atomic_001',
        adminAudit:{assignmentId:501,correlationId:'qa-refund-audit-001'},
        reauthorize:async client=>{
          const check=await client.query('SELECT 1 AS authorized');
          assert.equal(check.rows[0].authorized,1,'same transaction client must be reused');
        }};
      await assert.rejects(createRefundRequest(pool,{
        ...input,reauthorize:async client=>{
          assert.equal((await client.query('SELECT 1 AS authorized')).rows[0].authorized,1);
          throw Object.assign(new Error('isolated revoked operator after lock'),{status:403});
        }
      }),e=>e?.status===403);
      assert.equal((await pool.query('SELECT COUNT(*)::int n FROM refunds WHERE payment_intent_id=$1',[intentId])).rows[0].n,0,
        'revoked operator cannot reserve a refund after the lock');
      await pool.query(`CREATE FUNCTION payment_ci_refuse_refund_audit()
        RETURNS trigger LANGUAGE plpgsql AS $refusal$
        BEGIN
          IF NEW.event_code='refund_requested_provider_action_required' THEN
            RAISE EXCEPTION 'isolated financial audit refusal' USING ERRCODE='P0001';
          END IF;
          RETURN NEW;
        END; $refusal$`);
      await pool.query(`CREATE TRIGGER payment_ci_refuse_refund_audit
        BEFORE INSERT ON admin_audit_events FOR EACH ROW
        EXECUTE FUNCTION payment_ci_refuse_refund_audit()`);
      try{
        await assert.rejects(createRefundRequest(pool,input),e=>e?.code==='P0001');
        assert.equal((await pool.query('SELECT COUNT(*)::int n FROM refunds WHERE payment_intent_id=$1',[intentId])).rows[0].n,0,
          'admin audit failure must not commit an unaudited reservation');
        assert.equal((await pool.query("SELECT COUNT(*)::int n FROM admin_audit_events WHERE event_code='refund_requested_provider_action_required'")).rows[0].n,0);
      }finally{
        await pool.query('DROP TRIGGER IF EXISTS payment_ci_refuse_refund_audit ON admin_audit_events');
        await pool.query('DROP FUNCTION IF EXISTS payment_ci_refuse_refund_audit()');
      }
      const first=await createRefundRequest(pool,input);
      const replay=await createRefundRequest(pool,input);
      assert.equal(replay.__idempotent_replay,true);
      assert.equal(String(first.id),String(replay.id));
      assert.equal((await pool.query('SELECT COUNT(*)::int n FROM refunds WHERE payment_intent_id=$1',[intentId])).rows[0].n,1);
      const audit=await pool.query(
        "SELECT actor_account_id,assignment_id,target_id,after_json FROM admin_audit_events WHERE event_code='refund_requested_provider_action_required'");
      assert.equal(audit.rowCount,1,'replay must not create a second admin audit');
      assert.equal(Number(audit.rows[0].actor_account_id),7);
      assert.equal(Number(audit.rows[0].assignment_id),501);
      assert.equal(String(audit.rows[0].target_id),String(first.id));
      assert.equal(Number(audit.rows[0].after_json.amount),75);
    });
    await t.test('real PostgreSQL V2 Service Job quote authority, private replay and pending fence',async()=>{
      const input={serviceJobId:91,payerAccountId:7,idempotencyKey:'pg-job91-one-intent',logicalMethod:'card',providerCode:'sandbox_a'};
      const first=await createServiceJobPaymentIntent(pool,input);
      assert.equal(first.source_type,'service_job');
      assert.equal(Number(first.amount),200,'amount must come from accepted PHP 200 quote');
      assert.equal(first.status,'requires_provider','no provider charge is attempted');
      const again=await createServiceJobPaymentIntent(pool,input);
      assert.equal(String(again.id),String(first.id));
      assert.equal(Number((await pool.query("SELECT count(*)::int n FROM payment_intents WHERE source_type='service_job' AND source_id=91")).rows[0].n),1);
      assert.equal(Number((await pool.query("SELECT count(*)::int n FROM payment_audit_events WHERE payment_intent_id=$1",[first.id])).rows[0].n),1);
      for(const changed of [{logicalMethod:'ewallet'},{providerCode:'sandbox_b'}]){
        await assert.rejects(createServiceJobPaymentIntent(pool,{...input,...changed}),
          e=>e?.status===409&&e?.code==='PAYMENT_INTENT_DETAILS_CONFLICT');
      }
      await assert.rejects(createServiceJobPaymentIntent(pool,{...input,payerAccountId:8}),
        e=>e?.status===403);
      await assert.rejects(createServiceJobPaymentIntent(pool,{...input,serviceJobId:92}),
        e=>e?.status===409,'global key cannot be reused for another completed job');
      await assert.rejects(createServiceJobPaymentIntent(pool,{...input,idempotencyKey:'job91-new-pending'}),
        e=>e?.status===409&&/already pending/.test(e.message));
      await pool.query('UPDATE service_job_quotes SET total_amount=201 WHERE id=901');
      try{
        await assert.rejects(createServiceJobPaymentIntent(pool,input),
          e=>e?.status===409&&e?.code==='SERVICE_JOB_PRICE_INTEGRITY_MISMATCH');
      }finally{
        await pool.query('UPDATE service_job_quotes SET total_amount=200 WHERE id=901');
      }
      await pool.query("UPDATE service_jobs SET currency_code='USD' WHERE id=91");
      await pool.query("UPDATE service_job_quotes SET currency_code='USD' WHERE id=901");
      try{
        await assert.rejects(createServiceJobPaymentIntent(pool,input),
          e=>e?.status===409&&e?.code==='PAYMENT_INTENT_DETAILS_CONFLICT');
      }finally{
        await pool.query("UPDATE service_jobs SET currency_code='PHP' WHERE id=91");
        await pool.query("UPDATE service_job_quotes SET currency_code='PHP' WHERE id=901");
      }
      assert.equal((await pool.query("SELECT count(*)::int n FROM payment_intents WHERE source_type='service_job'")).rows[0].n,1);
      assert.equal((await pool.query('SELECT count(*)::int n FROM payment_audit_events')).rows[0].n,1);
    });
    await t.test('expired processing Service Job intent remains pending; expired unconfigured attempt may be replaced',async()=>{
      const input={serviceJobId:94,payerAccountId:7,idempotencyKey:'pg-job94-original',providerCode:'sandbox_a'};
      const first=await createServiceJobPaymentIntent(pool,input);
      assert.equal(first.status,'requires_provider');
      await pool.query("UPDATE payment_intents SET status='processing',expires_at=NOW()-INTERVAL '1 hour' WHERE id=$1",[first.id]);
      const pending=await serviceJobPaymentSummary(pool,94);
      assert.equal(pending.payment.pending_count,1,'expired processing must remain pending');
      assert.equal(pending.payment.pending_amount,200);
      await assert.rejects(createServiceJobPaymentIntent(pool,{...input,idempotencyKey:'pg-job94-different'}),
        e=>e?.status===409&&/already pending/.test(e.message));
      const afterReject=await pool.query("SELECT status,cancelled_at FROM payment_intents WHERE id=$1",[first.id]);
      assert.equal(afterReject.rows[0].status,'processing','expired processing must not be cancelled');
      assert.equal(afterReject.rows[0].cancelled_at,null);
      assert.equal((await pool.query("SELECT count(*)::int n FROM payment_intents WHERE source_type='service_job' AND source_id=94")).rows[0].n,1);
      assert.equal((await pool.query("SELECT count(*)::int n FROM payment_audit_events WHERE after_json->>'service_job_id'='94'")).rows[0].n,1);
      await pool.query("UPDATE payment_intents SET status='requires_provider' WHERE id=$1",[first.id]);
      const replacement=await createServiceJobPaymentIntent(pool,{...input,idempotencyKey:'pg-job94-replacement'});
      assert.notEqual(String(replacement.id),String(first.id));
      assert.equal((await pool.query("SELECT status FROM payment_intents WHERE id=$1",[first.id])).rows[0].status,'cancelled');
      assert.equal((await pool.query("SELECT count(*)::int n FROM payment_intents WHERE source_type='service_job' AND source_id=94")).rows[0].n,2);
      assert.equal((await pool.query("SELECT count(*)::int n FROM payment_audit_events WHERE after_json->>'service_job_id'='94'")).rows[0].n,2);
    });
    await t.test('real PostgreSQL audit failure rolls back Service Job key, then same-key retry is safe',async()=>{
      const input={serviceJobId:93,payerAccountId:7,idempotencyKey:'pg-job93-retry-safe',providerCode:'sandbox_a'};
      // A real database trigger raises an error AFTER the payment_intents INSERT
      // and before COMMIT. Both the key and intent must be rolled back.
      await pool.query(`CREATE FUNCTION payment_ci_reject_job93_audit()
        RETURNS trigger LANGUAGE plpgsql AS $payment_ci$
        BEGIN
          IF NEW.event_code='service_job_payment_intent_created'
             AND NEW.after_json->>'service_job_id'='93' THEN
            RAISE EXCEPTION 'isolated audit refusal' USING ERRCODE='P0001';
          END IF;
          RETURN NEW;
        END; $payment_ci$`);
      await pool.query(`CREATE TRIGGER payment_ci_reject_job93
        BEFORE INSERT ON payment_audit_events FOR EACH ROW
        EXECUTE FUNCTION payment_ci_reject_job93_audit()`);
      try{
        await assert.rejects(createServiceJobPaymentIntent(pool,input),e=>e?.code==='P0001');
        assert.equal((await pool.query('SELECT count(*)::int n FROM payment_intents WHERE idempotency_key=$1',[input.idempotencyKey])).rows[0].n,0);
        assert.equal((await pool.query("SELECT count(*)::int n FROM payment_audit_events WHERE after_json->>'service_job_id'='93'")).rows[0].n,0);
      }finally{
        await pool.query('DROP TRIGGER IF EXISTS payment_ci_reject_job93 ON payment_audit_events');
        await pool.query('DROP FUNCTION IF EXISTS payment_ci_reject_job93_audit()');
      }
      const accepted=await createServiceJobPaymentIntent(pool,input);
      const replay=await createServiceJobPaymentIntent(pool,input);
      assert.equal(String(accepted.id),String(replay.id));
      assert.equal((await pool.query('SELECT count(*)::int n FROM payment_intents WHERE idempotency_key=$1',[input.idempotencyKey])).rows[0].n,1);
      assert.equal((await pool.query("SELECT count(*)::int n FROM payment_audit_events WHERE after_json->>'service_job_id'='93'")).rows[0].n,1);
    });
  }finally{
    if(pool)await pool.end().catch(()=>{});
    await admin.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE').catch(()=>{});
    await admin.end();
  }
});
