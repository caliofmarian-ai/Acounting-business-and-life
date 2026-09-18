import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {payMongoCheckoutPolicy,payMongoPilotReadiness} from '../pilot-payment-readiness.js';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const server=read('server-paymongo.js');
const ui=read('public/payments-ui.js');

const testConfig={
  secretReady:true,
  webhookReady:true,
  keyMode:'test',
  mode:'test',
  liveAllowed:false,
  methods:['gcash','paymaya','qrph','card']
};
const liveConfig={
  secretReady:true,
  webhookReady:true,
  keyMode:'live',
  mode:'live',
  liveAllowed:true,
  methods:['gcash','paymaya','qrph','card']
};

test('sandbox checkout is allowed on QA/preview surfaces when webhook is ready',()=>{
  const p=payMongoCheckoutPolicy(testConfig,{ready:true},{productionSurface:false});
  assert.equal(p.required_stage,'internal');
  assert.equal(p.checkout_enabled,true);
  assert.equal(p.state,'READY');
});

test('sandbox checkout is blocked on the public production surface',()=>{
  const p=payMongoCheckoutPolicy(testConfig,{ready:true},{productionSurface:true});
  assert.equal(p.required_stage,'controlled_pilot');
  assert.equal(p.checkout_enabled,false);
  assert.equal(p.state,'HOLD');
  assert.ok(p.blockers.includes('PAYMONGO_LIVE_MODE_REQUIRED_FOR_REAL_CUSTOMER_PILOT'));
  assert.ok(p.blockers.includes('PAYMONGO_LIVE_SECRET_KEY_REQUIRED'));
});

test('live PayMongo checkout becomes READY only with live key, explicit live enablement and webhook',()=>{
  const p=payMongoCheckoutPolicy(liveConfig,{ready:true},{productionSurface:true});
  assert.equal(p.checkout_enabled,true);
  assert.equal(p.state,'READY');
  assert.deepEqual(p.blockers,[]);
  assert.deepEqual(p.enabled_methods,['gcash','paymaya','qrph','card']);
});

test('controlled pilot readiness remains fail-closed when webhook is unavailable',()=>{
  const r=payMongoPilotReadiness({...liveConfig,webhookReady:false},{ready:false},'controlled_pilot');
  assert.equal(r.state,'HOLD');
  assert.ok(r.blockers.includes('PAYMONGO_WEBHOOK_NOT_READY'));
});

test('production PayMongo route enforces checkout policy server-side',()=>{
  assert.match(server,/payMongoCheckoutPolicy/);
  assert.match(server,/productionSurface:railwayServiceName==='accounting-business-life'/);
  assert.match(server,/PAYMONGO_CHECKOUT_NOT_READY/);
  assert.match(server,/blockers:Array\.isArray\(err\.blockers\)/);
});

test('payment UI distinguishes internal QA from first real-customer pilot',()=>{
  assert.match(ui,/Internal QA/);
  assert.match(ui,/First real-customer pilot/);
  assert.match(ui,/PayMongo LIVE ready for first pilot/);
  assert.match(ui,/sandbox ready for internal QA/i);
  assert.match(ui,/Online checkout is HOLD on this environment/);
  assert.match(ui,/data-pay-order=.*disabled/);
});
