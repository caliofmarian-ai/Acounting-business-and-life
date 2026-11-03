import test from 'node:test';
import assert from 'node:assert/strict';
import {createOrderPaymentIntent,paymentRequestIdempotencyKey} from '../payment-core.js';

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
  currency_code:'PHP',amount:'200.00',status:'requires_provider'
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
