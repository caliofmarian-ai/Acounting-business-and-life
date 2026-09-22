import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const qa=readFileSync(new URL('../qa-acceptance.js',import.meta.url),'utf8');
const courier=readFileSync(new URL('../qa-courier-acceptance.js',import.meta.url),'utf8');

test('Delivery Finance Runtime V8 has a fresh-order focused acceptance wave',()=>{
  assert.match(qa,/const DELIVERY_FINANCE_RUNTIME_V8_WAVE='delivery_finance_runtime_v8'/);
  assert.match(qa,/runDeliveryFinanceRuntimeV8Acceptance/);
  assert.match(qa,/config\.wave===DELIVERY_FINANCE_RUNTIME_V8_WAVE/);
  assert.match(qa,/wave:DELIVERY_FINANCE_RUNTIME_V8_WAVE/);
  assert.match(courier,/orderNote=COURIER_QA_ORDER_NOTE/);
  assert.match(courier,/paymentMode='paymongo'/);
  assert.match(courier,/paymentMode==='merchant_confirmation'/);
});

test('Delivery Finance Runtime V8 verifies canonical financial side effects exactly once',()=>{
  assert.ok(courier.includes("provider_code:'qa_manual_delivery_finance_v8'"),'missing controlled V8 Merchant payment provider marker');
  for(const marker of [
    "FROM order_payments p",
    "source='order_payment'",
    "delivery_fee_received",
    "legacy-order-payment:",
    "payment_allocations",
    "order.payment_confirmed",
    "'/api/courier/delivery-profile'",
    "duplicate payment denial"
  ])assert.ok(qa.includes(marker),`missing Delivery Finance V8 acceptance marker: ${marker}`);
  assert.match(qa,/one_confirmed_payment:true/);
  assert.match(qa,/one_business_ledger_record:true/);
  assert.match(qa,/one_delivery_financial_event:true/);
  assert.match(qa,/payment_core_mirror:true/);
  assert.match(qa,/one_payment_notification:true/);
  assert.match(qa,/duplicate_payment_denied:true/);
  assert.match(qa,/QA credential restore failed/);
});
