import test from 'node:test';
import assert from 'node:assert/strict';
import {createOrderPaymentIntent} from '../payment-core.js';

// Source-executing synthetic SQL controls. No real account, database or provider.
function paymentReplayFixture(existing){
  const statements=[];
  let releases=0;
  const client={
    async query(sql,params=[]){
      statements.push({sql,params});
      if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return{rowCount:0,rows:[]};
      if(sql.includes('FROM orders o JOIN businesses b')){
        assert.deepEqual(params,[31]);
        return{rowCount:1,rows:[{
          id:31,customer_account_id:7,business_id:6,territory_id:2,
          payment_method:'online',outstanding_amount:'200.00',currency_code:'PHP'
        }]};
      }
      if(sql.includes('FROM payment_intents WHERE idempotency_key')){
        assert.deepEqual(params,['scope-key-31']);
        return{rowCount:1,rows:[existing]};
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
