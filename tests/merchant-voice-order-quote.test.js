import test from 'node:test';
import assert from 'node:assert/strict';
import {authoritativeVoiceOrderQuote} from '../merchant-voice-order-quote.js';
const secret=Buffer.from('0123456789abcdef0123456789abcdef');
const context={accountId:44,businessId:7,sessionId:'test-session',secret,now:new Date('2026-10-30T23:00:00Z')};
const draft={status:'unposted_draft',business_id:7,session_id:'test-session',customer_name:'Ana',lines:[{source_kind:'marketplace_product',product_id:11,quantity:2,variant_id:null,modifier_option_ids:[]}]};
const row={source_kind:'marketplace_product',source_id:11,name_snapshot:'Rice',quantity:2,catalog_variant_id:null,modifier_snapshot_json:{groups:[]},unit_price_snapshot:'35.00',line_total:'70.00'};
const quote=(overrides={})=>authoritativeVoiceOrderQuote({...context,draft,snapshots:[row],...overrides});
test('canonical snapshot, not AI draft price, sets signed PHP totals',()=>{
  const x=quote();assert.equal(x.status,'quote_only');assert.equal(x.creates_orders,false);assert.equal(x.stock_reserved,false);
  assert.equal(x.quote.total_centavos,7000);assert.equal(x.quote.payment_status,'unpaid');
  assert.equal(x.quote.fulfilment_method,'pickup');assert.equal(x.quote.delivery_fee_centavos,0);
  assert.equal(x.quote.expires_at,'2026-10-30T23:02:00.000Z');assert.match(x.signature,/^[A-Za-z0-9_-]{43}$/);
});
test('quote signature includes account, session, business and canonical amount',()=>{
  const original=quote().signature;
  assert.notEqual(quote({accountId:45}).signature,original);
  assert.notEqual(quote({snapshots:[{...row,unit_price_snapshot:'40.00',line_total:'80.00'}]}).signature,original);
  assert.notEqual(quote({now:new Date('2026-10-30T23:01:00Z')}).signature,original);
});
test('reject wrong business, session or missing lines',()=>{
  assert.throws(()=>quote({businessId:8}),{code:'VOICE_CONTEXT_STALE'});
  assert.throws(()=>quote({sessionId:'another-session'}),{code:'VOICE_CONTEXT_STALE'});
  assert.throws(()=>quote({snapshots:[]}),{code:'VOICE_QUOTE_STALE'});
});
test('reject product ID, variant ID and modifier difference',()=>{
  assert.throws(()=>quote({snapshots:[{...row,source_id:12}]}),{code:'VOICE_QUOTE_STALE'});
  assert.throws(()=>quote({snapshots:[{...row,catalog_variant_id:80}]}),{code:'VOICE_QUOTE_STALE'});
  assert.throws(()=>quote({snapshots:[{...row,modifier_snapshot_json:{groups:[{options:[{option_id:3}]}]}}]}),{code:'VOICE_QUOTE_STALE'});
});
test('reject altered or inconsistent canonical total',()=>{
  assert.throws(()=>quote({snapshots:[{...row,line_total:'700.00'}]}),{code:'VOICE_QUOTE_STALE'});
  assert.throws(()=>quote({snapshots:[{...row,unit_price_snapshot:-1}]}),{code:'VOICE_QUOTE_STALE'});
});