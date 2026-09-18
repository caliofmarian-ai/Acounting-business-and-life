import test from 'node:test';
import assert from 'node:assert/strict';
import {cryptoProviderContractStatus,normalizeCryptoQuote,cryptoActivationGate,CRYPTO_LOGICAL_METHOD} from '../crypto-payment-contract.js';
import {payMongoPilotReadiness} from '../pilot-payment-readiness.js';

test('crypto adapter contract is provider-neutral and requires every money-safety method',()=>{
  const status=cryptoProviderContractStatus({createQuote(){},createPaymentIntent(){}});
  assert.equal(status.ready,false);
  assert.equal(status.logical_method,CRYPTO_LOGICAL_METHOD);
  assert.ok(status.missing_methods.includes('verifyWebhook'));
  assert.ok(status.missing_methods.includes('reconcilePayment'));
});

test('crypto quote keeps PHP commercial amount and requires an unexpired provider quote',()=>{
  const now=Date.parse('2026-09-18T18:00:00Z');
  const q=normalizeCryptoQuote({
    provider_code:'example_vasp',
    quote_id:'q_1',
    fiat_currency:'PHP',
    fiat_amount:500,
    asset:'STABLE_ASSET',
    network:'provider_network',
    crypto_amount:8.25,
    destination:'provider-generated-destination',
    expires_at:'2026-09-18T18:05:00Z',
    exchange_rate:60.606
  },{expectedPhpAmount:500,now});
  assert.equal(q.fiat_currency,'PHP');
  assert.equal(q.fiat_amount,500);
  assert.equal(q.provider_code,'example_vasp');
});

test('crypto live activation remains HOLD without provider and compliance evidence',()=>{
  const g=cryptoActivationGate({providerConfigured:true});
  assert.equal(g.state,'HOLD');
  assert.ok(g.blockers.includes('VASP_REGULATORY_STATUS_NOT_VERIFIED'));
  assert.ok(g.blockers.includes('LIVE_CRYPTO_MONEY_EVIDENCE_MISSING'));
});

test('PayMongo sandbox can be READY for internal QA but not for real-customer controlled pilot',()=>{
  const cfg={secretReady:true,webhookReady:true,keyMode:'test',mode:'test',liveAllowed:false,methods:['gcash','qrph']};
  assert.equal(payMongoPilotReadiness(cfg,{ready:true},'internal').state,'READY');
  const live=payMongoPilotReadiness(cfg,{ready:true},'controlled_pilot');
  assert.equal(live.state,'HOLD');
  assert.ok(live.blockers.includes('PAYMONGO_LIVE_MODE_REQUIRED_FOR_REAL_CUSTOMER_PILOT'));
});

test('PayMongo real-customer pilot gate is READY only with live key, live enablement and webhook',()=>{
  const cfg={secretReady:true,webhookReady:true,keyMode:'live',mode:'live',liveAllowed:true,methods:['gcash','paymaya','qrph','card']};
  const live=payMongoPilotReadiness(cfg,{ready:true},'controlled_pilot');
  assert.equal(live.state,'READY');
  assert.deepEqual(live.blockers,[]);
  assert.equal(live.online_payment_required,true);
});
