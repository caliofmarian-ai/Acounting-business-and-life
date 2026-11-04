import test from 'node:test';
import assert from 'node:assert/strict';
import {createOrderPaymentIntent,createServiceJobPaymentIntent,paymentRequestIdempotencyKey} from '../payment-core.js';

// Source-executing synthetic SQL controls. No real account, database or provider.
function paymentReplayFixture(existing,outstanding='200.00'){
  const statements=[];
  let releases=0;
  const client={
    async query(sql,params=[]){
      statements.push({sql,params});
      if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return{rowCount:0,rows:[]};
      if(sql.includes('pg_advisory_xact_lock')){
        assert.deepEqual(params,['scope-key-31']);
        return{rowCount:1,rows:[{}]};
      }
      if(sql.includes('FROM orders o JOIN businesses b')){
        assert.deepEqual(params,[31]);
        return{rowCount:1,rows:[{
          id:31,customer_account_id:7,business_id:6,territory_id:2,
          payment_method:'online',outstanding_amount:outstanding,currency_code:'PHP'
        }]};
      }
      if(sql.includes('FROM payment_intents WHERE idempotency_key')){
        assert.deepEqual(params,['scope-key-31']);
        return existing?{rowCount:1,rows:[existing]}:{rowCount:0,rows:[]};
      }
      throw new Error('Unexpected payment-side SQL: '+sql);
    },
    release(){releases++}
  };
  return{pool:{connect:async()=>client},statements,releases:()=>releases};
}
const authorizedIntent=Object.freeze({
  id:95,public_id:'pi_fixture_95',idempotency_key:'scope-key-31',
  source_type:'order',source_id:31,payer_account_id:7,business_id:6,
  currency_code:'PHP',amount:'200.00',logical_method:'online_other',provider_code:'',status:'requires_provider'
});
const args={orderId:31,payerAccountId:7,idempotencyKey:'scope-key-31'};

test('Order payment replay returns the original authorized intent without writes',async()=>{
  const f=paymentReplayFixture({...authorizedIntent});
  const result=await createOrderPaymentIntent(f.pool,args);
  assert.equal(result.public_id,authorizedIntent.public_id);
  assert.equal(f.statements.filter(x=>x.sql==='COMMIT').length,1);
  assert.equal(f.statements.filter(x=>x.sql==='ROLLBACK').length,0);
  assert.equal(f.statements.filter(x=>/^\s*(?:INSERT|UPDATE|DELETE)\b/i.test(x.sql)).length,0);
  assert.equal(f.releases(),1);
});

for(const [scenario,changedFields] of [
  ['another payer',{payer_account_id:8}],
  ['another order',{source_id:32}],
  ['another source type',{source_type:'service_job'}],
  ['another Merchant business',{business_id:7}]
]){
  test('Order payment key cannot disclose '+scenario+' intent',async()=>{
    const f=paymentReplayFixture({...authorizedIntent,...changedFields});
    await assert.rejects(createOrderPaymentIntent(f.pool,args),
      e=>e?.status===409&&e?.code==='PAYMENT_INTENT_SCOPE_CONFLICT');
    assert.equal(f.statements.filter(x=>x.sql==='COMMIT').length,0);
    assert.equal(f.statements.filter(x=>x.sql==='ROLLBACK').length,1);
    assert.equal(f.statements.filter(x=>/^\s*(?:INSERT|UPDATE|DELETE)\b/i.test(x.sql)).length,0);
    assert.equal(f.releases(),1);
  });
}

test('Payment intent keys reject padding, controls and nonstring aliases before key lookup',async()=>{
  for(const invalid of [
    ' scope-key-31','scope-key-31 ','\tscope-key-31','scope-key-31\n',
    '\u0000scope-key-31',1234,false,new String('scope-key-31')
  ]){
    const f=paymentReplayFixture({...authorizedIntent});
    await assert.rejects(createOrderPaymentIntent(f.pool,{...args,idempotencyKey:invalid}),
      e=>e?.status===400&&e?.code==='PAYMENT_IDEMPOTENCY_KEY_INVALID');
    assert.equal(f.statements.some(x=>x.sql.includes('pg_advisory_xact_lock')),false);
    assert.equal(f.statements.some(x=>x.sql.includes('FROM payment_intents')),false);
    assert.equal(f.statements.filter(x=>x.sql==='ROLLBACK').length,1);
  }
});

test('An oversized payment key is rejected without truncation or lookup',async()=>{
  const f=paymentReplayFixture({...authorizedIntent});
  await assert.rejects(createOrderPaymentIntent(f.pool,{...args,idempotencyKey:'x'.repeat(221)}),
    e=>e?.status===400&&e?.code==='PAYMENT_IDEMPOTENCY_KEY_INVALID');
  assert.equal(f.statements.filter(x=>x.sql.includes('FROM payment_intents')).length,0);
  assert.equal(f.statements.filter(x=>x.sql.includes('pg_advisory_xact_lock')).length,0);
  assert.equal(f.statements.filter(x=>x.sql==='ROLLBACK').length,1);
});

test('Different Order key cannot bypass existing active payment checkout',async()=>{
  const statements=[];
  const client={
    async query(sql,params=[]){
      statements.push(sql);
      if(['BEGIN','ROLLBACK','COMMIT'].includes(sql))return{rowCount:0,rows:[]};
      if(sql.includes('FROM orders o JOIN businesses b'))return{rowCount:1,rows:[{
        id:31,customer_account_id:7,business_id:6,territory_id:2,
        payment_method:'online',outstanding_amount:'200',currency_code:'PHP'
      }]};
      if(sql.includes('pg_advisory_xact_lock'))return{rowCount:1,rows:[{}]};
      if(sql.includes('FROM payment_intents WHERE idempotency_key'))return{rowCount:0,rows:[]};
      if(sql.includes("source_type='order' AND source_id=$1")&&sql.includes("status='processing'")){
        assert.deepEqual(params,[31]);
        return{rowCount:1,rows:[{id:95}]};
      }
      throw Error('Unexpected payment-side SQL: '+sql);
    },
    release(){}
  };
  await assert.rejects(createOrderPaymentIntent({connect:async()=>client},{
    ...args,idempotencyKey:'another-key-for-order-31'
  }),e=>e?.status===409&&e?.code==='ORDER_PAYMENT_ALREADY_PENDING');
  assert.equal(statements.includes('ROLLBACK'),true);
  assert.equal(statements.includes('COMMIT'),false);
  assert.equal(statements.some(s=>s.trim().startsWith('INSERT ')),false);
});

test('HTTP payment requests reject conflicting header/body idempotency identities without normalization',()=>{
  const key='literal-scope-key-31';
  assert.equal(paymentRequestIdempotencyKey({'idempotency-key':key},{}),key);
  assert.equal(paymentRequestIdempotencyKey({}, {idempotency_key:key}),key);
  assert.equal(paymentRequestIdempotencyKey({'idempotency-key':key},{idempotency_key:key}),key);
  for(const [header,payload] of [
    [key,'different-scope-key-31'],[key,key+'-other'],
    [key,key+' '],[' '+key,key],[key,123]
  ]){
    assert.throws(()=>paymentRequestIdempotencyKey(
      {'idempotency-key':header},{idempotency_key:payload}
    ),e=>e?.status===400&&e?.code==='PAYMENT_IDEMPOTENCY_KEY_CONFLICT');
  }
  for(const [headers,body] of [
    [{'idempotency-key':key+' '},{}],[{},{idempotency_key:' '+key}],
    [{'idempotency-key':[key]},{}],[{},{idempotency_key:123}],[{},{}]
  ]){
    assert.throws(()=>paymentRequestIdempotencyKey(headers,body),
      e=>e?.status===400&&e?.code==='PAYMENT_IDEMPOTENCY_KEY_INVALID');
  }
});


test('Both payment HTTP routes pass raw provider instructions for validated replay',async()=>{
  const {readFileSync}=await import('node:fs');
  const source=readFileSync(new URL('../server-payments.js',import.meta.url),'utf8');
  for(const route of ['/api/payments/intents/order/:id','/api/payments/intents/service-job/:id']){
    const at=source.indexOf("app.post('"+route+"'");
    assert.ok(at>=0);
    const snippet=source.slice(at,at+700);
    assert.match(snippet,/const provider=\(req\.body\?\.provider_code==null/);
    assert.doesNotMatch(snippet,/provider=clean\(/);
  }
});

test('Provider identity rejects silent padding, truncation or nonstring alias before Order lookup',async()=>{
  for(const invalid of [
    ' provider_a','provider_a ','provider_a\n','\tprovider_a',
    'x'.repeat(81),17,false,[],{provider:'provider_a'}
  ]){
    const f=paymentReplayFixture({...authorizedIntent});
    await assert.rejects(createOrderPaymentIntent(f.pool,{...args,providerCode:invalid}),
      e=>e?.status===400&&e?.code==='PAYMENT_PROVIDER_CODE_INVALID');
    assert.equal(f.statements.some(x=>x.sql.includes('FROM payment_intents')),false);
    assert.equal(f.statements.some(x=>x.sql.includes('pg_advisory_xact_lock')),false);
    assert.equal(f.statements.filter(x=>x.sql==='ROLLBACK').length,1);
    assert.equal(f.releases(),1);
  }
  const samePrefix=paymentReplayFixture({...authorizedIntent,provider_code:'p'.repeat(79)+'a'});
  await assert.rejects(createOrderPaymentIntent(samePrefix.pool,{...args,providerCode:'p'.repeat(79)+'b'}),
    e=>e?.status===409&&e?.code==='PAYMENT_INTENT_DETAILS_CONFLICT');
});

test('Service Job rejects malformed provider identity before payment intent query',async()=>{
  const prior={id:199,source_type:'service_job',source_id:91,payer_account_id:7,
    logical_method:'online_other',provider_code:'',currency_code:'PHP'};
  const f=serviceJobReplayFixture(prior);
  await assert.rejects(createServiceJobPaymentIntent(f.pool,{
    serviceJobId:91,payerAccountId:7,idempotencyKey:'service-job-key-91',providerCode:'p'.repeat(81)
  }),e=>e?.status===400&&e?.code==='PAYMENT_PROVIDER_CODE_INVALID');
  assert.equal(f.statements.some(x=>x.includes('FROM payment_intents')),false);
  assert.equal(f.statements.filter(x=>x==='ROLLBACK').length,1);
});

test('Both HTTP entry points preserve the original caller key for Payment Core validation',async()=>{
  const {readFileSync}=await import('node:fs');
  const routeSource=readFileSync(new URL('../server-payments.js',import.meta.url),'utf8');
  for(const route of ['/api/payments/intents/order/:id','/api/payments/intents/service-job/:id']){
    const start=routeSource.indexOf("app.post('"+route+"'");
    assert.ok(start>=0,'missing payment route '+route);
    const snippet=routeSource.slice(start,start+650);
    assert.match(snippet,/const idempotency=paymentRequestIdempotencyKey\(req\.headers,req\.body\);/);
    assert.doesNotMatch(snippet,/idempotency=clean\(/);
  }
});

test('Committed Order payment key still replays after outstanding balance reaches zero',async()=>{
  const same=paymentReplayFixture({...authorizedIntent},'0.00');
  const original=await createOrderPaymentIntent(same.pool,args);
  assert.equal(original.id,authorizedIntent.id);
  assert.equal(same.statements.filter(x=>x.sql==='COMMIT').length,1);
  assert.equal(same.statements.filter(x=>/^\s*(?:INSERT|UPDATE|DELETE)\b/i.test(x.sql)).length,0);
  const fresh=paymentReplayFixture(null,'0.00');
  await assert.rejects(createOrderPaymentIntent(fresh.pool,args),
    e=>e?.status===409&&/already paid/.test(e.message));
  assert.equal(fresh.statements.filter(x=>x.sql==='ROLLBACK').length,1);
});

test('Same Order key cannot silently replay another provider, method or source currency',async()=>{
  for(const [change,original] of [
    [{logicalMethod:'card'},authorizedIntent],
    [{providerCode:'provider_b'},authorizedIntent],
    [{}, {...authorizedIntent,currency_code:'USD'}],
    [{}, {...authorizedIntent,logical_method:'ewallet'}],
    [{}, {...authorizedIntent,provider_code:'provider_a'}]
  ]){
    const f=paymentReplayFixture({...original});
    await assert.rejects(createOrderPaymentIntent(f.pool,{...args,...change}),
      e=>e?.status===409&&e?.code==='PAYMENT_INTENT_DETAILS_CONFLICT');
    assert.equal(f.statements.some(x=>x.sql==='COMMIT'),false);
    assert.equal(f.statements.filter(x=>x.sql==='ROLLBACK').length,1);
    assert.equal(f.statements.some(x=>/^\s*(?:INSERT|UPDATE|DELETE)\b/i.test(x.sql)),false);
    assert.equal(f.releases(),1);
  }
});

// A literal source-executed Service Job fixture: read-only, no provider calls.
function serviceJobReplayFixture(existing){
  const statements=[];let releases=0;
  const job={id:91,customer_account_id:7,provider_account_id:10,
    status:'completed',customer_confirmed_at:'2026-11-03T00:00:00Z',
    accepted_quote_id:19,agreed_total:'200.00',final_price:'200.00',
    pricing_locked_at:'2026-11-02T00:00:00Z',currency_code:'PHP'};
  const quote={id:19,job_id:91,status:'accepted',total_amount:'200.00',
    currency_code:'PHP',legacy_record:false};
  const client={async query(sql,args=[]){
    statements.push(sql);
    if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return{rowCount:0,rows:[]};
    if(sql.includes('FROM service_jobs WHERE id=$1 FOR UPDATE'))return{rowCount:1,rows:[job]};
    if(sql.includes('gross_confirmed'))return{rowCount:1,rows:[{gross_confirmed:'0',pending_amount:'0',confirmed_count:0,pending_count:0}]};
    if(sql.includes('refunded_amount'))return{rowCount:1,rows:[{refunded_amount:'0',refund_count:0}]};
    if(sql.includes('allocation_count'))return{rowCount:1,rows:[{allocation_count:0}]};
    if(sql.includes('ORDER BY created_at DESC,id DESC LIMIT 1'))return{rowCount:0,rows:[]};
    if(sql.includes('FROM service_job_quotes'))return{rowCount:1,rows:[quote]};
    if(sql.includes('pg_advisory_xact_lock'))return{rowCount:1,rows:[]};
    if(sql.includes('FROM payment_intents WHERE idempotency_key'))return{rowCount:1,rows:[existing]};
    throw Error('Unexpected Service Job payment SQL: '+sql);
  },release(){releases++}};
  return{pool:{connect:async()=>client},statements,releases:()=>releases};
}
test('Service Job same-key replay rejects another payment channel/currency without mutation',async()=>{
  const original={id:199,source_type:'service_job',source_id:91,payer_account_id:7,
    logical_method:'online_other',provider_code:'',currency_code:'PHP'};
  const input={serviceJobId:91,payerAccountId:7,idempotencyKey:'service-job-key-91'};
  for(const [override,prior] of [
    [{logicalMethod:'card'},original],
    [{providerCode:'provider_b'},original],
    [{}, {...original,currency_code:'USD'}]
  ]){
    const f=serviceJobReplayFixture(prior);
    await assert.rejects(createServiceJobPaymentIntent(f.pool,{...input,...override}),
      e=>e?.status===409&&e?.code==='PAYMENT_INTENT_DETAILS_CONFLICT');
    assert.equal(f.statements.filter(x=>x==='COMMIT').length,0);
    assert.equal(f.statements.filter(x=>x==='ROLLBACK').length,1);
    assert.equal(f.statements.filter(x=>/^\s*(?:INSERT|UPDATE|DELETE)\b/i.test(x)).length,0);
    assert.equal(f.releases(),1);
  }
  const ok=serviceJobReplayFixture(original);
  assert.equal((await createServiceJobPaymentIntent(ok.pool,input)).id,199);
  assert.equal(ok.statements.filter(x=>x==='COMMIT').length,1);
});
