import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import {createOrderPaymentIntent} from '../payment-core.js';

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
      'CREATE TABLE payment_intents(id bigserial PRIMARY KEY,public_id text UNIQUE NOT NULL,idempotency_key text UNIQUE NOT NULL,source_type text,source_id bigint,payer_account_id bigint,business_id bigint,territory_id bigint,provider_code text,logical_method text,currency_code text,amount numeric(14,2),status text,client_reference text,expires_at timestamptz)',
      'CREATE TABLE order_payments(order_id bigint,merchandise_amount numeric(14,2),delivery_amount numeric(14,2),status text)',
      'CREATE TABLE payment_allocations(payment_intent_id bigint,component_code text,economic_party_type text,economic_party_id text,gross_base numeric(14,2),amount numeric(14,2),currency_code text,settlement_status text,rule_snapshot jsonb)'
    ])await pool.query(sql);
    await pool.query('INSERT INTO businesses VALUES(6,2),(7,2)');
    await pool.query("INSERT INTO orders VALUES(31,6,7,'online',200,200,0,'PHP'),(32,7,8,'online',200,200,0,'PHP')");
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
  }finally{
    if(pool)await pool.end().catch(()=>{});
    await admin.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE').catch(()=>{});
    await admin.end();
  }
});
