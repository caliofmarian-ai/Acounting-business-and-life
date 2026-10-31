import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {authoritativeVoiceOrderQuote,verifyVoiceOrderSignedQuote,assertVoiceQuoteMatchesSnapshots} from '../merchant-voice-order-quote.js';
const secret=Buffer.from('0123456789abcdef0123456789abcdef');
const clock=new Date('2026-10-30T23:00:30Z');
const context={accountId:44,businessId:7,sessionId:'session-a',secret};
const draft={status:'unposted_draft',business_id:7,session_id:'session-a',customer_name:'Ana',lines:[{source_kind:'marketplace_product',product_id:11,quantity:2,variant_id:null,modifier_option_ids:[]}]};
const row={source_kind:'marketplace_product',source_id:11,name_snapshot:'Rice',quantity:2,catalog_variant_id:null,modifier_snapshot_json:{groups:[]},unit_price_snapshot:'35.00',line_total:'70.00'};
const signed=()=>authoritativeVoiceOrderQuote({...context,draft,snapshots:[row],now:new Date('2026-10-30T23:00:00Z')});
const verified=(s=signed(),extra={})=>verifyVoiceOrderSignedQuote({signedQuote:s,...context,now:clock,...extra});
test('approved signed quote has fixed source/variant IDs and hash',()=>{
  const x=verified();assert.equal(x.quote.total_centavos,7000);assert.match(x.quoteHash,/^[a-f0-9]{64}$/);
  assert.deepEqual(x.orderItems,[{product_id:11,source_kind:'marketplace_product',quantity:2,variant_id:null,modifier_option_ids:[]}]);
  assert.equal(assertVoiceQuoteMatchesSnapshots(x.quote,[row]),true);
});
test('HMAC rejects changed totals, product ID, customer and payment without any order write',()=>{
  for(const patched of [
    {total_centavos:8000},{line_items:[{...signed().quote.line_items[0],product_id:99}]},
    {customer_name:'Mallory'},{payment_status:'paid'}]){
    const s=signed();s.quote={...s.quote,...patched};assert.throws(()=>verified(s),{code:'VOICE_CONFIRM_QUOTE_INVALID'});
  }
});
test('quote is bound to business, account and signed-in session',()=>{
  assert.throws(()=>verified(signed(),{accountId:45}),{code:'VOICE_CONTEXT_STALE'});
  assert.throws(()=>verified(signed(),{businessId:8}),{code:'VOICE_CONTEXT_STALE'});
  assert.throws(()=>verified(signed(),{sessionId:'session-b'}),{code:'VOICE_CONTEXT_STALE'});
});
test('expired quote is rejected for new create, but permits authenticated replay lookup',()=>{
  assert.throws(()=>verified(signed(),{now:new Date('2026-10-30T23:03:00Z')}),{code:'VOICE_QUOTE_STALE'});
  assert.equal(verified(signed(),{now:new Date('2026-10-30T23:03:00Z'),allowExpired:true}).quote.total_centavos,7000);
});
test('live canonical price, product, options and name must match signed quote',()=>{
  const q=verified().quote;
  for(const replacement of [{...row,unit_price_snapshot:'36.00',line_total:'72.00'},{...row,source_id:12},
    {...row,name_snapshot:'Different Rice'},{...row,modifier_snapshot_json:{groups:[{options:[{option_id:2}]}]}}])
    assert.throws(()=>assertVoiceQuoteMatchesSnapshots(q,[replacement]),{code:'VOICE_QUOTE_STALE'});
});
test('duplicated or internally inconsistent signed quote rejected even when correctly re-signed',()=>{
  const base=signed().quote;
  for(const changed of [{line_items:[base.line_items[0],base.line_items[0]]},
    {line_items:[{...base.line_items[0],quantity:3}]},
    {fulfilment_method:'delivery'}, {payment_method:'online'}, {currency_code:'EUR'}]){
    const q={...base,...changed};
    const signature=crypto.createHmac('sha256',secret).update(JSON.stringify(q)).digest('base64url');
    assert.throws(()=>verified({quote:q,signature}),{code:'VOICE_CONFIRM_QUOTE_INVALID'});
  }
});