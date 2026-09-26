import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const payment=readFileSync(new URL('../payment-core.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../server-payments.js',import.meta.url),'utf8');

test('Service Job payment intent requires completed and Customer-confirmed work',()=>{
  assert.match(payment,/job\.status!=='completed'/);
  assert.match(payment,/Service Job is not completed yet/);
  assert.match(payment,/!job\.customer_confirmed_at/);
  assert.match(payment,/Confirm Service Job completion before payment/);
  assert.match(payment,/job\.final_price\?\?job\.quote_amount\?\?0/);
  assert.match(payment,/Service Job has no payable amount/);
});

test('only the owning Customer can create a Service Job payment intent',()=>{
  assert.match(payment,/Number\(job\.customer_account_id\)!==Number\(payerAccountId\)/);
  assert.match(payment,/This Service Job belongs to another Customer/);
  assert.match(server,/payerAccountId:Number\(me\.account\.id\)/);
});

test('Service Job intent is idempotent within the same payment scope',()=>{
  assert.match(payment,/SELECT \* FROM payment_intents WHERE idempotency_key=\$1/);
  assert.match(payment,/Idempotency key belongs to another payment scope/);
  assert.match(payment,/old\.source_type!=='service_job'/);
  assert.match(payment,/Number\(old\.source_id\)!==id/);
  assert.match(payment,/Number\(old\.payer_account_id\)!==Number\(payerAccountId\)/);
});

test('expired pending Service Job intents are cancelled before a replacement is created',()=>{
  assert.match(payment,/source_type='service_job' AND source_id=\$1/);
  assert.match(payment,/status IN \('requires_provider','requires_action','processing'\)/);
  assert.match(payment,/expires_at IS NOT NULL AND expires_at<=NOW\(\)/);
  assert.match(payment,/status='cancelled',cancelled_at=NOW\(\)/);
});

test('active pending Service Job payment blocks another payment intent',()=>{
  assert.match(payment,/pending_amount/);
  assert.match(payment,/A Service Job payment is already pending/);
  assert.match(payment,/if\(summary\.payment\.pending_amount>0\)/);
});

test('Service Job payment summary separates commercial value, confirmed payment, refunds and receivable',()=>{
  assert.match(payment,/payable_value:payable/);
  assert.match(payment,/gross_confirmed:gross/);
  assert.match(payment,/refunded/);
  assert.match(payment,/effective_paid:effectivePaid/);
  assert.match(payment,/outstanding/);
  assert.match(payment,/effectivePaid=money\(Math\.max\(0,gross-refunded\)\)/);
  assert.match(payment,/outstanding=money\(Math\.max\(0,payable-effectivePaid\)\)/);
  assert.match(payment,/Completed job value is commercial value\. Only provider-backed payment evidence is treated as paid/);
});

test('confirmed Service Job payment evidence comes from canonical payment intents and succeeded refunds',()=>{
  assert.match(payment,/status IN \('succeeded','partially_refunded','refunded'\)/);
  assert.match(payment,/FROM refunds r/);
  assert.match(payment,/r\.status='succeeded'/);
  assert.match(payment,/pi\.source_type='service_job'/);
  assert.match(payment,/authority:'payment_intents \+ succeeded refunds'/);
});

test('Service Provider settlement remains unconfigured without service_provider_net allocations',()=>{
  assert.match(payment,/pa\.component_code='service_provider_net'/);
  assert.match(payment,/status:allocationCount>0\?'TRACKED':'NOT_CONFIGURED'/);
  const createStart=payment.indexOf('export async function createServiceJobPaymentIntent');
  const createEnd=payment.indexOf('export async function mirrorConfirmedOrderPayment',createStart);
  const block=payment.slice(createStart,createEnd);
  assert.doesNotMatch(block,/INSERT INTO payment_allocations/);
  assert.doesNotMatch(block,/service_provider_net/);
});

test('V1 B keeps Payment Core provider-neutral while exposing the PayMongo checkout handoff',()=>{
  const createStart=payment.indexOf('export async function createServiceJobPaymentIntent');
  const createEnd=payment.indexOf('export async function mirrorConfirmedOrderPayment',createStart);
  const block=payment.slice(createStart,createEnd);
  assert.match(block,/'service_job'/);
  assert.match(block,/'requires_provider'/);
  assert.match(block,/'checkout_supported'/);
  assert.doesNotMatch(block,/createPayMongoCheckout/);
  assert.match(server,/checkout_supported:true/);
  assert.match(server,/provider_adapter_ready:intent\.provider_code==='paymongo'/);
  assert.match(server,/OPEN_PAYMONGO_CHECKOUT/);
  assert.doesNotMatch(server,/SERVICE_JOB_CHECKOUT_NOT_ENABLED_YET/);
});

test('Service Job payment summary is readable by Customer, Provider, or scoped payment Admin only',()=>{
  assert.match(server,/summary\.customer_account_id/);
  assert.match(server,/summary\.provider_account_id/);
  assert.match(server,/requireAdminPermission\(pool,accountId,'payment\.view'\)/);
  assert.match(server,/Service Job payment summary is outside your authorized scope/);
});

test('Service Job payment endpoints are distinct from Order payment endpoint',()=>{
  assert.match(server,/api\/payments\/intents\/service-job\/:id/);
  assert.match(server,/api\/payments\/service-jobs\/:id\/summary/);
  assert.match(server,/api\/payments\/intents\/order\/:id/);
  const start=server.indexOf("app.post('/api/payments/intents/service-job/:id'");
  const end=server.indexOf("app.get('/api/payments/intents/:id'",start);
  assert.ok(start>=0&&end>start);
  const block=server.slice(start,end);
  assert.doesNotMatch(block,/mirrorConfirmedOrderPayment/);
  assert.doesNotMatch(block,/order_payments/);
});
