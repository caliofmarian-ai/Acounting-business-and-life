import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  acceptedCompletionPrice,
  moneyCents,
  normalizeServicePriceOffer,
  normalizeServiceQuote,
  quoteIsExpired,
  resolveAcceptedServiceJobPayable,
  SERVICE_PRICING_METHODS,
  serviceJobPayableSnapshot,
  ServicePricingValidationError
} from '../local-services-pricing-core.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Local Services supports market-aligned work pricing methods without inventing a mandatory rate',()=>{
  assert.deepEqual(SERVICE_PRICING_METHODS,[
    'quotation','fixed','hourly','half_day','daily','per_unit','per_sqm','inspection_then_quote'
  ]);
  assert.deepEqual(normalizeServicePriceOffer({
    pricing_method:'per_sqm',rate_unit:'sqm',price_from:'120',price_to:'250',minimum_charge:'650',
    callout_fee:'0',materials_policy:'separate',service_mode:'at_customer',pricing_note:'Labour only; surface preparation is quoted separately.'
  }),{
    pricing_method:'per_sqm',rate_unit:'sqm',price_from:120,price_to:250,minimum_charge:650,
    callout_fee:0,materials_policy:'separate',service_mode:'at_customer',pricing_note:'Labour only; surface preparation is quoted separately.'
  });
  assert.throws(()=>normalizeServicePriceOffer({price_from:500,price_to:100}),/cannot be lower/);
});

test('server calculates centavo-safe item totals and rejects a browser-forged total',()=>{
  const quote=normalizeServiceQuote({
    quote_kind:'fixed_quote',scope_summary:'Install two wall shelves',materials_policy:'customer_supplied',
    valid_until:'2026-10-05T00:00:00.000Z',
    line_items:[
      {item_kind:'labor',description:'Shelf installation',quantity:2,unit_code:'item',unit_price:425.25},
      {item_kind:'callout',description:'Home visit',quantity:1,unit_code:'visit',unit_price:100},
      {item_kind:'materials',description:'Anchors',quantity:4,unit_code:'item',unit_price:12.5}
    ]
  },{now:new Date('2026-09-27T00:00:00.000Z')});
  assert.equal(quote.labor_amount,850.5);
  assert.equal(quote.callout_amount,100);
  assert.equal(quote.materials_amount,50);
  assert.equal(quote.total_amount,1000.5);
  assert.equal(moneyCents(quote.total_amount),100050);
  assert.throws(()=>normalizeServiceQuote({
    total_amount:999,
    line_items:[{item_kind:'labor',description:'Work',quantity:1,unit_code:'job',unit_price:500}]
  }),error=>error instanceof ServicePricingValidationError&&error.code==='SERVICE_QUOTE_TOTAL_MISMATCH');
});

test('legacy scalar quote is normalized to one immutable labor item during migration',()=>{
  const quote=normalizeServiceQuote({quote_amount:'350',quote_note:'Controlled QA quotation.'},{now:new Date('2026-09-27T00:00:00.000Z')});
  assert.equal(quote.quote_kind,'fixed_quote');
  assert.equal(quote.quote_phase,'initial');
  assert.equal(quote.total_amount,350);
  assert.deepEqual(quote.line_items,[{
    item_kind:'labor',description:'Controlled QA quotation.',quantity:1,unit_code:'job',unit_price:350,subtotal:350
  }]);
});

test('invalid money, units, quantities and expired quote validity fail closed',()=>{
  const base={line_items:[{item_kind:'labor',description:'Work',quantity:1,unit_code:'job',unit_price:100}]};
  assert.throws(()=>normalizeServiceQuote({...base,line_items:[{...base.line_items[0],unit_price:-1}]}),/invalid/);
  assert.throws(()=>normalizeServiceQuote({...base,line_items:[{...base.line_items[0],quantity:0}]}),/greater than zero/);
  assert.throws(()=>normalizeServiceQuote({...base,line_items:[{...base.line_items[0],unit_code:'week'}]}),/unsupported unit/);
  assert.throws(()=>normalizeServiceQuote({...base,valid_until:'2026-09-26T23:59:59Z'},{now:new Date('2026-09-27T00:00:00Z')}),/future/);
  assert.equal(quoteIsExpired({valid_until:'2026-09-26T23:59:59Z'},new Date('2026-09-27T00:00:00Z')),true);
});

test('completion is pinned to the latest Customer-accepted total',()=>{
  assert.equal(acceptedCompletionPrice({acceptedTotal:'1275.50'}),1275.5);
  assert.equal(acceptedCompletionPrice({acceptedTotal:1275.5,requestedFinalPrice:'1275.50'}),1275.5);
  assert.throws(
    ()=>acceptedCompletionPrice({acceptedTotal:1275.5,requestedFinalPrice:1400}),
    error=>error instanceof ServicePricingValidationError&&error.code==='SERVICE_CHANGE_ORDER_REQUIRED'
  );
  assert.throws(()=>acceptedCompletionPrice({acceptedTotal:1275.5,requestedFinalPrice:-1}),/invalid/);
});

test('Payment Core resolves a V2 payable value only from the exact accepted quote snapshot',()=>{
  const job={
    id:44,status:'completed',currency_code:'PHP',accepted_quote_id:91,agreed_total:'1275.50',
    final_price:'1275.50',pricing_locked_at:'2026-09-27T10:00:00Z',legacy_final_adjustment:null
  };
  const quote={id:91,job_id:44,status:'accepted',total_amount:'1275.50',currency_code:'PHP',legacy_record:false};
  assert.deepEqual(resolveAcceptedServiceJobPayable(job,quote),{
    payable_value:1275.5,payable_authority:'accepted_quote',accepted_quote_id:91,
    agreed_total:1275.5,legacy_final_adjustment:null
  });
  assert.throws(
    ()=>resolveAcceptedServiceJobPayable({...job,final_price:'1400.00'},quote),
    error=>error.code==='SERVICE_JOB_PRICE_INTEGRITY_MISMATCH'&&error.status===409
  );
  assert.throws(
    ()=>resolveAcceptedServiceJobPayable(job,{...quote,total_amount:'1270.00'}),
    error=>error.code==='SERVICE_JOB_PRICE_INTEGRITY_MISMATCH'&&error.status===409
  );
  assert.throws(
    ()=>resolveAcceptedServiceJobPayable(job,null),
    error=>error.code==='SERVICE_JOB_PRICE_INTEGRITY_MISMATCH'&&error.status===409
  );
});

test('legacy payable value is preserved only through explicit migrated adjustment evidence',()=>{
  const job={
    id:45,status:'completed',currency_code:'PHP',accepted_quote_id:92,agreed_total:'1000.00',
    final_price:'1150.00',pricing_locked_at:'2026-09-20T10:00:00Z',legacy_final_adjustment:'150.00'
  };
  const legacyQuote={id:92,job_id:45,status:'accepted',total_amount:'1000.00',currency_code:'PHP',legacy_record:true};
  const resolved=resolveAcceptedServiceJobPayable(job,legacyQuote);
  assert.equal(resolved.payable_value,1150);
  assert.equal(resolved.payable_authority,'legacy_accepted_quote_plus_adjustment');
  assert.throws(
    ()=>resolveAcceptedServiceJobPayable(job,{...legacyQuote,legacy_record:false}),
    error=>error.code==='SERVICE_JOB_PRICE_INTEGRITY_MISMATCH'
  );
  assert.deepEqual(serviceJobPayableSnapshot({final_price:'875.00',quote_amount:'800.00'}),{
    payable_value:875,payable_authority:'legacy_final_price',accepted_quote_id:null,
    agreed_total:null,legacy_final_adjustment:null
  });
});

test('runtime schema and routes preserve immutable quote versions and exact acceptance',()=>{
  const server=read('server-services.js');
  const core=read('local-services-pricing-core.js');
  const documents=read('financial-document-core.js');
  const monetization=read('monetization-core.js');
  assert.match(server,/CREATE TABLE IF NOT EXISTS service_job_quotes/);
  assert.match(server,/CREATE TABLE IF NOT EXISTS service_job_quote_items/);
  assert.match(server,/accepted_quote_id/);
  assert.match(server,/FOR UPDATE/);
  assert.match(server,/quote_id/);
  assert.match(server,/SERVICE_QUOTE_ID_REQUIRED/);
  assert.match(server,/acceptedCompletionPrice/);
  assert.match(server,/resolveAcceptedServiceJobPayable/);
  assert.match(core,/SERVICE_CHANGE_ORDER_REQUIRED/);
  assert.match(documents,/payable_authority:pricing\.payable_authority/);
  // Historical monetization must consult the accepted quote, never a bare SQL
  // COALESCE that could accept missing/mismatched snapshots as zero.
  assert.match(monetization,/LEFT JOIN service_job_quotes q ON q.id=j.accepted_quote_id/);
  assert.match(monetization,/resolveAcceptedServiceJobPayable\(job,acceptedQuote\)\.payable_value/);
  assert.doesNotMatch(monetization,/j\.agreed_total\+COALESCE\(j\.legacy_final_adjustment,0\)/);
});

test('Provider and Customer UI show itemised pricing and explicit change-order approval',()=>{
  const ui=read('public/services-ui.js');
  assert.match(ui,/Build itemised quote/);
  assert.match(ui,/Labour/);
  assert.match(ui,/Materials/);
  assert.match(ui,/Call-out \/ inspection/);
  assert.match(ui,/Accept change/);
  assert.match(ui,/Decline change/);
  assert.match(ui,/Server-calculated total/);
  assert.doesNotMatch(ui,/final_price:Number\(document/);
});

test('accepted quote requires complete canonical matching currency evidence',()=>{
  const job={
    id:44,status:'completed',currency_code:'PHP',accepted_quote_id:91,
    agreed_total:'150.00',final_price:'150.00',pricing_locked_at:'2026-10-28T01:00:00Z'
  };
  const quote={
    id:91,job_id:44,status:'accepted',total_amount:'150.00',
    currency_code:'PHP',legacy_record:false
  };
  assert.equal(resolveAcceptedServiceJobPayable(job,quote).payable_value,150);
  for(const invalid of [null,undefined,'','PHP ','php','EUR']){
    assert.throws(
      ()=>resolveAcceptedServiceJobPayable(job,{...quote,currency_code:invalid}),
      error=>error.code==='SERVICE_JOB_PRICE_INTEGRITY_MISMATCH'&&error.status===409,
      'invalid accepted quote currency: '+String(invalid)
    );
    assert.throws(
      ()=>resolveAcceptedServiceJobPayable({...job,currency_code:invalid},quote),
      error=>error.code==='SERVICE_JOB_PRICE_INTEGRITY_MISMATCH'&&error.status===409,
      'invalid Service Job currency: '+String(invalid)
    );
  }
});

test('unsafe BIGINT IDs cannot be rounded into a different accepted quote or job',()=>{
  const job={
    id:'9007199254740992',status:'completed',currency_code:'PHP',
    accepted_quote_id:'9007199254740992',agreed_total:'100.00',
    final_price:'100.00',pricing_locked_at:'2026-10-28T00:00:00Z'
  };
  const otherQuote={
    id:'9007199254740993',job_id:'9007199254740993',status:'accepted',
    total_amount:'100.00',currency_code:'PHP',legacy_record:false
  };
  const rejectsIntegrity=error=>
    error.code==='SERVICE_JOB_PRICE_INTEGRITY_MISMATCH'&&error.status===409;
  // These distinct PostgreSQL BIGINT strings previously collapsed into one JS Number.
  assert.throws(()=>resolveAcceptedServiceJobPayable(job,otherQuote),rejectsIntegrity);
  const safeJob={...job,id:44,accepted_quote_id:91};
  assert.throws(
    ()=>resolveAcceptedServiceJobPayable(safeJob,{...otherQuote,id:91}),rejectsIntegrity
  );
  assert.throws(
    ()=>resolveAcceptedServiceJobPayable({...safeJob,accepted_quote_id:'9007199254740993'},
      {...otherQuote,id:'9007199254740992',job_id:44}),rejectsIntegrity
  );
});

test('canonical safe PostgreSQL quote/job IDs work while ambiguous ID encodings fail closed',()=>{
  const job={
    id:'44',status:'completed',currency_code:'PHP',accepted_quote_id:'91',
    agreed_total:'100.00',final_price:'100.00'
  };
  const quote={
    id:'91',job_id:'44',status:'accepted',total_amount:'100.00',
    currency_code:'PHP',legacy_record:false
  };
  assert.equal(resolveAcceptedServiceJobPayable(job,quote).payable_value,100);
  for(const invalid of ['091','91e0','91.0','+91',' 91 ','-91','9007199254740992',0]){
    assert.throws(
      ()=>resolveAcceptedServiceJobPayable({...job,accepted_quote_id:invalid},quote),
      error=>error.code==='SERVICE_JOB_PRICE_INTEGRITY_MISMATCH',
      'accepted quote ID: '+String(invalid)
    );
    assert.throws(
      ()=>resolveAcceptedServiceJobPayable(job,{...quote,id:invalid}),
      error=>error.code==='SERVICE_JOB_PRICE_INTEGRITY_MISMATCH',
      'quote row ID: '+String(invalid)
    );
  }
});
