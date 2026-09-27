import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  acceptedCompletionPrice,
  moneyCents,
  normalizeServicePriceOffer,
  normalizeServiceQuote,
  quoteIsExpired,
  SERVICE_PRICING_METHODS,
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

test('runtime schema and routes preserve immutable quote versions and exact acceptance',()=>{
  const server=read('server-services.js');
  const core=read('local-services-pricing-core.js');
  assert.match(server,/CREATE TABLE IF NOT EXISTS service_job_quotes/);
  assert.match(server,/CREATE TABLE IF NOT EXISTS service_job_quote_items/);
  assert.match(server,/accepted_quote_id/);
  assert.match(server,/FOR UPDATE/);
  assert.match(server,/quote_id/);
  assert.match(server,/SERVICE_QUOTE_ID_REQUIRED/);
  assert.match(server,/acceptedCompletionPrice/);
  assert.match(core,/SERVICE_CHANGE_ORDER_REQUIRED/);
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
