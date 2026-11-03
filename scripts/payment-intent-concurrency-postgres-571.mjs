import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import {createOrderPaymentIntent,createServiceJobPaymentIntent} from '../payment-core.js';

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
      'CREATE TABLE payment_intents(id bigserial PRIMARY KEY,public_id text UNIQUE NOT NULL,idempotency_key text UNIQUE NOT NULL,source_type text,source_id bigint,payer_account_id bigint,business_id bigint,territory_id bigint,provider_code text,provider_status text,provider_payment_id text,logical_method text,currency_code text,amount numeric(14,2),status text,client_reference text,expires_at timestamptz,created_at timestamptz DEFAULT NOW(),updated_at timestamptz DEFAULT NOW(),succeeded_at timestamptz)',
      'CREATE TABLE order_payments(order_id bigint,merchandise_amount numeric(14,2),delivery_amount numeric(14,2),status text)',
      'CREATE TABLE payment_allocations(payment_intent_id bigint,component_code text,economic_party_type text,economic_party_id text,gross_base numeric(14,2),amount numeric(14,2),currency_code text,settlement_status text,rule_snapshot jsonb)',
      'CREATE TABLE service_jobs(id bigint PRIMARY KEY,customer_account_id bigint,provider_account_id bigint,status text,customer_confirmed_at timestamptz,accepted_quote_id bigint,agreed_total numeric(14,2),final_price numeric(14,2),pricing_locked_at timestamptz,currency_code text,quote_amount numeric(14,2),legacy_final_adjustment numeric(14,2))',
      'CREATE TABLE service_job_quotes(id bigint PRIMARY KEY,job_id bigint,status text,total_amount numeric(14,2),currency_code text,legacy_record boolean)',
      'CREATE TABLE refunds(payment_intent_id bigint,amount numeric(14,2),status text)',
      'CREATE TABLE payment_audit_events(actor_account_id bigint,payment_intent_id bigint,event_code text,provider_code text,after_json jsonb,correlation_id text)'
    ])await pool.query(sql);
    await pool.query('INSERT INTO businesses VALUES(6,2),(7,2)');
    await pool.query("INSERT INTO orders VALUES(31,6,7,'online',200,200,0,'PHP'),(32,7,8,'online',200,200,0,'PHP')");
    // Real completed Pricing V2 service jobs, with distinct accepted-quote
    // snapshots: no real Customer/payment-provider accounts are used.
    await pool.query(`INSERT INTO service_jobs(id,customer_account_id,provider_account_id,status,
      customer_confirmed_at,accepted_quote_id,agreed_total,final_price,pricing_locked_at,
      currency_code,quote_amount) VALUES
      (91,7,17,'completed',NOW(),901,200,200,NOW(),'PHP',200),
      (92,7,17,'completed',NOW(),902,200,200,NOW(),'PHP',200),
      (93,7,17,'completed',NOW(),903,200,200,NOW(),'PHP',200)`);
    await pool.query(`INSERT INTO service_job_quotes(id,job_id,status,total_amount,currency_code,legacy_record)
      VALUES(901,91,'accepted',200,'PHP',FALSE),
            (902,92,'accepted',200,'PHP',FALSE),
            (903,93,'accepted',200,'PHP',FALSE)`);

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
    await t.test('overlength keys reject distinct suffixes rather than collide',async()=>{
      for(const suffix of ['alpha','bravo']){
        await assert.rejects(createOrderPaymentIntent(pool,{...b,idempotencyKey:'x'.repeat(220)+suffix}),
          e=>e?.status===400&&e?.code==='PAYMENT_IDEMPOTENCY_KEY_INVALID');
      }
      assert.equal(await count('payment_intents'),1);
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
      assert.equal(await count('payment_intents'),2);
      assert.equal(await count('payment_allocations'),2);
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
    await t.test('real PostgreSQL audit failure rolls back Service Job key, then same-key retry is safe',async()=>{
      const input={serviceJobId:93,payerAccountId:7,idempotencyKey:'pg-job93-retry-safe',providerCode:'sandbox_a'};
      // A real database trigger raises an error AFTER the payment_intents INSERT
      // and before COMMIT. Both the key and intent must be rolled back.
      await pool.query(`CREATE FUNCTION payment_ci_reject_job93_audit()
        RETURNS trigger LANGUAGE plpgsql AS $
        BEGIN
          IF NEW.event_code='service_job_payment_intent_created'
             AND NEW.after_json->>'service_job_id'='93' THEN
            RAISE EXCEPTION 'isolated audit refusal' USING ERRCODE='P0001';
          END IF;
          RETURN NEW;
        END $`);
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
