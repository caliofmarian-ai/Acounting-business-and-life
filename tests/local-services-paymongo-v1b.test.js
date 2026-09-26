import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const adapter=read('paymongo-adapter.js');
const payment=read('payment-core.js');
const server=read('server-payments.js');
const ui=read('public/services-ui.js');

test('Service Job PayMongo checkout is source-aware and keeps Order metadata out of Service Job payload',()=>{
  const start=adapter.indexOf("if(i.source_type==='service_job')");
  const end=adapter.indexOf("throw payMongoSourceNotEnabled",start);
  const block=adapter.slice(start,end);
  assert.match(block,/FROM service_jobs j JOIN accounts p/);
  assert.match(block,/serviceJobPaymentSummary/);
  assert.match(block,/bl_source_type:'service_job'/);
  assert.match(block,/bl_source_id:String\(i\.source_id\)/);
  assert.doesNotMatch(block,/bl_order_id/);
  assert.doesNotMatch(block,/bl_business_id/);
});

test('verified Service Job webhook becomes canonical payment evidence without inventing provider payout',()=>{
  const start=adapter.indexOf('async function confirmServiceJobPayMongoSourcePayment');
  const end=adapter.indexOf('export async function confirmPayMongoSourcePayment',start);
  const block=adapter.slice(start,end);
  assert.match(block,/serviceJobPaymentSummary/);
  assert.match(block,/service_job_not_payable/);
  assert.match(block,/outstanding_balance_changed/);
  assert.match(adapter,/if\(sourceType==='service_job'\)return confirmServiceJobPayMongoSourcePayment/);
  assert.doesNotMatch(block,/service_provider_net/);
  assert.doesNotMatch(block,/settlement_status='paid'/);
});

test('Customer Local Services jobs load canonical payment summaries and expose Pay only for outstanding work',()=>{
  assert.match(ui,/async function enrichJobPayments/);
  assert.match(ui,/api\/payments\/service-jobs\/.*\/summary/);
  assert.match(ui,/Number\(payment\.outstanding\|\|0\)>0/);
  assert.match(ui,/data-job-action="pay"/);
  assert.match(ui,/Payment received/);
  assert.match(ui,/Receipt /);
  assert.match(ui,/Leave review/);
});

test('Customer Pay creates or reuses a Service Job intent then opens the shared guarded PayMongo checkout',()=>{
  const start=ui.indexOf('async function openServiceJobPayMongo');
  const end=ui.indexOf('async function jobAction',start);
  const block=ui.slice(start,end);
  assert.match(block,/pending_amount/);
  assert.match(block,/latest_intent/);
  assert.match(block,/api\/payments\/intents\/service-job\//);
  assert.match(block,/Idempotency-Key/);
  assert.match(block,/provider_code:'paymongo'/);
  assert.match(block,/api\/payments\/paymongo\/checkout\//);
  assert.match(block,/window\.location\.assign\(checkout\.checkout_url\)/);
  assert.doesNotMatch(block,/status\s*[:=]\s*['"]succeeded['"]/);
});

test('Service Provider payment card separates paid, receivable, refund and settlement evidence',()=>{
  const start=ui.indexOf('function jobPaymentEvidence');
  const end=ui.indexOf('function jobCard',start);
  const block=ui.slice(start,end);
  assert.match(block,/effective_paid/);
  assert.match(block,/outstanding/);
  assert.match(block,/refunded/);
  assert.match(block,/settlement\.status/);
  assert.match(block,/Still due/);
});

test('Payment Core remains the authority and checkout capability does not create provider settlement',()=>{
  const start=payment.indexOf('export async function createServiceJobPaymentIntent');
  const end=payment.indexOf('export async function mirrorConfirmedOrderPayment',start);
  const block=payment.slice(start,end);
  assert.match(block,/checkout_supported/);
  assert.doesNotMatch(block,/service_provider_net/);
  assert.match(server,/checkout_supported:true/);
  assert.match(server,/OPEN_PAYMONGO_CHECKOUT/);
});
