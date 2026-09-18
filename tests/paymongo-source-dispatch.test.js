import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  resolvePayMongoCheckoutDescriptor,
  confirmPayMongoSourcePayment
} from '../paymongo-adapter.js';

const adapter=readFileSync(new URL('../paymongo-adapter.js',import.meta.url),'utf8');

test('Order checkout descriptor keeps Order behavior and adds generic source metadata',async()=>{
  let call=0;
  const pool={query:async(sql,args)=>{
    call++;
    if(call===1)return{rowCount:1,rows:[{
      id:91,public_id:'pi_order_91',source_type:'order',source_id:12,payer_account_id:7,
      currency_code:'PHP',amount:'700.00',status:'requires_provider'
    }]};
    assert.match(sql,/FROM orders o JOIN businesses b/);
    assert.deepEqual(args,[12]);
    return{rowCount:1,rows:[{
      order_number:'BL-12',customer_account_id:7,business_id:3,currency_code:'PHP',
      outstanding_amount:'700.00',business_name:'Merchant'
    }]};
  }};
  const d=await resolvePayMongoCheckoutDescriptor(pool,{intentPublicId:'pi_order_91',accountId:7});
  assert.equal(d.source_type,'order');
  assert.equal(d.source_id,12);
  assert.equal(d.line_item_name,'Order BL-12 balance');
  assert.equal(d.reference_number,'BL-12');
  assert.equal(d.metadata.bl_payment_intent_public_id,'pi_order_91');
  assert.equal(d.metadata.bl_source_type,'order');
  assert.equal(d.metadata.bl_source_id,'12');
  assert.equal(d.metadata.bl_order_id,'12');
  assert.equal(d.metadata.bl_business_id,'3');
});

test('unsupported checkout sources fail closed before source-domain queries',async()=>{
  for(const source_type of ['service_job','purchase_order','external']){
    let calls=0;
    const pool={query:async()=>{
      calls++;
      return{rowCount:1,rows:[{
        id:1,public_id:'pi_'+source_type,source_type,source_id:44,payer_account_id:9,
        currency_code:'PHP',amount:'100.00',status:'requires_provider'
      }]};
    }};
    await assert.rejects(
      resolvePayMongoCheckoutDescriptor(pool,{intentPublicId:'pi_'+source_type,accountId:9}),
      err=>err?.code==='PAYMONGO_SOURCE_NOT_ENABLED'&&err?.source_type===source_type
    );
    assert.equal(calls,1,'unsupported source must not query its domain table');
  }
});

test('confirmation dispatcher holds unsupported sources without touching a domain client',async()=>{
  for(const source_type of ['service_job','purchase_order','external']){
    let queried=false;
    const client={query:async()=>{queried=true;throw new Error('domain query must not run')}};
    const result=await confirmPayMongoSourcePayment(client,{intent:{source_type,source_id:81}});
    assert.equal(queried,false);
    assert.equal(result.hold,true);
    assert.equal(result.manual_review,true);
    assert.equal(result.code,'PAYMONGO_SOURCE_NOT_ENABLED');
    assert.equal(result.reason,'paymongo_source_not_enabled');
    assert.equal(result.source_type,source_type);
  }
});

test('webhook dispatch uses canonical DB payment_intent source, not provider metadata as authority',()=>{
  assert.match(adapter,/const iq=await client\.query\("SELECT \* FROM payment_intents WHERE id=\$1 FOR UPDATE"/);
  assert.match(adapter,/confirmPayMongoSourcePayment\(client,\{intent:i,providerPaymentId,providerMethod\}\)/);
  assert.match(adapter,/source_type:i\.source_type/);
  assert.doesNotMatch(adapter,/confirmPayMongoSourcePayment\([^)]*meta\.bl_source_type/);
});

test('unsupported verified webhook source is manual review and never succeeds',()=>{
  assert.match(adapter,/processing_status='manual_review'/);
  assert.match(adapter,/paymongo_source_not_enabled/);
  assert.match(adapter,/PAYMONGO_SOURCE_NOT_ENABLED/);
  const dispatchStart=adapter.indexOf('export async function confirmPayMongoSourcePayment');
  const webhookStart=adapter.indexOf('export async function processPayMongoWebhook');
  const dispatch=adapter.slice(dispatchStart,webhookStart);
  assert.doesNotMatch(dispatch,/UPDATE service_jobs/);
  assert.doesNotMatch(dispatch,/INSERT INTO order_payments/);
});

test('Order source handler preserves existing financial and order mutations',()=>{
  const start=adapter.indexOf('async function confirmOrderPayMongoSourcePayment');
  const end=adapter.indexOf('export async function confirmPayMongoSourcePayment',start);
  const block=adapter.slice(start,end);
  assert.match(block,/SELECT \* FROM orders WHERE id=\$1 FOR UPDATE/);
  assert.match(block,/INSERT INTO order_payments/);
  assert.match(block,/merchandise_amount/);
  assert.match(block,/delivery_amount/);
  assert.match(block,/INSERT INTO transactions/);
  assert.match(block,/delivery_financial_events/);
  assert.match(block,/PayMongo webhook confirmed payment/);
  assert.match(block,/settlement_status='eligible'/);
  assert.match(block,/outstanding_balance_changed/);
});

test('provider fee and succeeded state remain common after source confirmation',()=>{
  const start=adapter.indexOf('export async function processPayMongoWebhook');
  const end=adapter.indexOf('export async function payMongoLivePilotEvidence',start);
  const block=adapter.slice(start,end);
  const dispatch=block.indexOf('confirmPayMongoSourcePayment');
  const fee=block.indexOf("'processor_fee'");
  const success=block.indexOf("status='succeeded'");
  assert.ok(dispatch>=0&&fee>dispatch&&success>dispatch);
  assert.match(block,/payment_attempts SET status='succeeded'/);
  assert.match(block,/provider_events SET processing_status='processed'/);
  assert.match(block,/paymongo_checkout_paid/);
});

test('checkout payload carries generic source metadata while retaining legacy Order metadata',()=>{
  assert.match(adapter,/bl_payment_intent_public_id/);
  assert.match(adapter,/bl_source_type:'order'/);
  assert.match(adapter,/bl_source_id:String\(i\.source_id\)/);
  assert.match(adapter,/bl_order_id:String\(i\.source_id\)/);
  assert.match(adapter,/bl_business_id:String\(o\.business_id\)/);
});
