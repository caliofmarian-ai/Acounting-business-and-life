import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {payMongoCheckoutPolicy,payMongoPilotReadiness} from '../pilot-payment-readiness.js';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const server=read('server-paymongo.js');
const adapter=read('paymongo-adapter.js');
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
const liveEvidence={
  live_payment_confirmed:true,
  live_reconciliation_matched:true,
  latest_live_intent_public_id:'pi_live_proof',
  latest_live_provider_payment_id:'pay_live_proof',
  reconciliation_run_public_id:'rec_live_proof'
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

test('live configuration permits Admin validation before external-customer release',()=>{
  const r=payMongoPilotReadiness(liveConfig,{ready:true},'live_validation',{});
  assert.equal(r.state,'READY');
  assert.deepEqual(r.blockers,[]);
});

test('live config alone does not release external customers without payment and reconciliation evidence',()=>{
  const p=payMongoCheckoutPolicy(liveConfig,{ready:true},{productionSurface:true,evidence:{}});
  assert.equal(p.checkout_enabled,false);
  assert.equal(p.state,'HOLD');
  assert.ok(p.blockers.includes('PAYMONGO_LIVE_PAYMENT_EVIDENCE_MISSING'));
  assert.ok(p.blockers.includes('PAYMONGO_LIVE_RECONCILIATION_EVIDENCE_MISSING'));
});

test('external-customer PayMongo checkout becomes READY after matched LIVE evidence',()=>{
  const p=payMongoCheckoutPolicy(liveConfig,{ready:true},{productionSurface:true,evidence:liveEvidence});
  assert.equal(p.checkout_enabled,true);
  assert.equal(p.state,'READY');
  assert.deepEqual(p.blockers,[]);
  assert.deepEqual(p.enabled_methods,['gcash','paymaya','qrph','card']);
  assert.equal(p.evidence.live_payment_confirmed,true);
  assert.equal(p.evidence.live_reconciliation_matched,true);
});

test('controlled pilot readiness remains fail-closed when webhook is unavailable',()=>{
  const r=payMongoPilotReadiness({...liveConfig,webhookReady:false},{ready:false},'controlled_pilot',liveEvidence);
  assert.equal(r.state,'HOLD');
  assert.ok(r.blockers.includes('PAYMONGO_WEBHOOK_NOT_READY'));
});

test('production PayMongo route enforces checkout policy and allows only scoped Admin live validation override',()=>{
  assert.match(server,/payMongoCheckoutPolicy/);
  assert.match(server,/productionSurface=railwayServiceName==='accounting-business-life'/);
  assert.match(server,/payMongoPilotReadiness\(cfg,bootstrap,'live_validation',evidence\)/);
  assert.match(server,/requireAdminPermission\(pool,me\.account\.id,'payment\.manage'\)/);
  assert.match(server,/PAYMONGO_CHECKOUT_NOT_READY/);
  assert.match(server,/paymongo_live_validation_checkout_opened/);
  assert.match(server,/blockers:Array\.isArray\(err\.blockers\)/);
});

test('provider-backed reconciliation verifies LIVE payment evidence instead of trusting local state alone',()=>{
  assert.match(adapter,/payMongoLivePilotEvidence/);
  assert.match(adapter,/metadata_json->>'mode',''\)='live'/);
  assert.match(adapter,/findPayMongoPaymentById/);
  assert.match(adapter,/\/v1\/payments\?/);
  assert.match(adapter,/provider_payment_not_live/);
  assert.match(adapter,/processor_fee_mismatch/);
  assert.match(adapter,/paymongo_live_reconciliation_matched/);
  assert.match(server,/\/api\/payments\/admin\/paymongo\/reconcile-live\/:intent/);
});

test('payment UI distinguishes QA, Admin LIVE validation and first real-customer pilot',()=>{
  assert.match(ui,/Internal QA/);
  assert.match(ui,/Admin LIVE validation/);
  assert.match(ui,/First real-customer pilot/);
  assert.match(ui,/PayMongo LIVE ready for first pilot/);
  assert.match(ui,/sandbox ready for internal QA/i);
  assert.match(ui,/Online checkout is HOLD on this environment/);
  assert.match(ui,/Run LIVE validation/);
  assert.match(ui,/Reconcile LIVE validation payment/);
  assert.match(ui,/LIVE payment proof/);
  assert.match(ui,/Provider reconciliation/);
});
