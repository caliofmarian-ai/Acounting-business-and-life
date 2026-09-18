import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { verifyPayMongoSignature, payMongoRuntimeConfig } from '../paymongo-adapter.js';

const adapter=readFileSync(new URL('../paymongo-adapter.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../server-paymongo.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/payments-ui.js',import.meta.url),'utf8');

test('PayMongo adapter uses Hosted Checkout v2 and never enables pass-on fees implicitly',()=>{
  assert.match(adapter,/\/v2\/checkout_sessions/);
  assert.match(adapter,/pass_on_fees:false/);
  assert.match(adapter,/send_email_receipt:false/);
  assert.match(adapter,/payment_method_types/);
  assert.match(adapter,/card,gcash,paymaya,qrph/);
});

test('PayMongo secret key remains server-side and Basic auth is constructed only in adapter code',()=>{
  assert.match(adapter,/PAYMONGO_SECRET_KEY/);
  assert.match(adapter,/Buffer\.from\(secretKey\+':'\)/);
  assert.doesNotMatch(ui,/PAYMONGO_SECRET_KEY/);
  assert.doesNotMatch(ui,/sk_test_/);
  assert.doesNotMatch(server,/res\.json\([^)]*secretKey/);
});

test('live key cannot activate accidentally without explicit live enablement',()=>{
  const old={...process.env};
  process.env.PAYMONGO_SECRET_KEY='sk_live_example';
  process.env.PAYMONGO_MODE='live';
  delete process.env.PAYMONGO_LIVE_ENABLED;
  const cfg=payMongoRuntimeConfig();
  assert.equal(cfg.mode,'test');
  assert.equal(cfg.secretReady,false);
  process.env.PAYMONGO_LIVE_ENABLED='true';
  const live=payMongoRuntimeConfig();
  assert.equal(live.mode,'live');
  assert.equal(live.secretReady,true);
  process.env=old;
});

test('webhook signature verification uses raw body, HMAC SHA-256, mode signature and replay tolerance',()=>{
  const old={...process.env};
  process.env.PAYMONGO_WEBHOOK_SECRET='whsec_test';
  process.env.PAYMONGO_MODE='test';
  delete process.env.PAYMONGO_LIVE_ENABLED;
  const raw=Buffer.from('{"data":{"type":"checkout_session.payment.paid"}}');
  const ts=1700000000;
  const sig=crypto.createHmac('sha256','whsec_test').update(String(ts)+'.').update(raw).digest('hex');
  const ok=verifyPayMongoSignature(raw,'t='+ts+',te='+sig+',li=',ts);
  assert.equal(ok.ok,true);
  assert.equal(ok.mode,'test');
  const bad=verifyPayMongoSignature(raw,'t='+ts+',te='+'0'.repeat(64)+',li=',ts);
  assert.equal(bad.ok,false);
  const oldTs=verifyPayMongoSignature(raw,'t='+(ts-1000)+',te='+sig+',li=',ts);
  assert.equal(oldTs.ok,false);
  process.env=old;
});

test('public webhook route consumes raw application/json before parsed JSON body middleware',()=>{
  const hook=server.indexOf("app.post('/api/payments/webhooks/paymongo'");
  const body=server.indexOf('app.use(body)');
  assert.ok(hook>=0&&body>hook);
  assert.match(server,/express\.raw\(\{type:'application\/json'/);
  assert.match(server,/paymongo-signature/);
});

test('checkout return is never payment authority',()=>{
  assert.match(ui,/Waiting for verified webhook confirmation/);
  assert.match(adapter,/checkout_session\.payment\.paid/);
  assert.match(adapter,/amount_or_currency_mismatch/);
  assert.match(adapter,/outstanding_balance_changed/);
  assert.match(adapter,/checkout_session_mismatch/);
});

test('successful verified PayMongo webhook records provider fee and payment evidence separately',()=>{
  assert.match(adapter,/processor_fee/);
  assert.match(adapter,/provider_fee/);
  assert.match(adapter,/provider_net_amount/);
  assert.match(adapter,/provider_payment_id/);
  assert.match(adapter,/settlement_status='eligible'/);
  assert.match(adapter,/PayMongo webhook confirmed payment/);
});

test('PayMongo refunds use provider payment id and official refunds endpoint',()=>{
  assert.match(adapter,/\/v1\/refunds/);
  assert.match(adapter,/payment_id:r\.provider_payment_id/);
  assert.match(adapter,/bl-refund-/);
  assert.match(adapter,/partially_refunded/);
  assert.match(adapter,/refunded/);
});

test('PayMongo provider metadata declares adapter readiness without storing credentials',()=>{
  assert.match(adapter,/v0\.14-hosted-checkout-v2/);
  assert.match(adapter,/secret_ready/);
  assert.match(adapter,/webhook_ready/);
  assert.doesNotMatch(adapter,/config_metadata[^]*secretKey/);
});
