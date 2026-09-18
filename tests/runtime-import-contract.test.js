import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as paymentCore from '../payment-core.js';
import * as paymongoAdapter from '../paymongo-adapter.js';

const paymentsServer=readFileSync(new URL('../server-payments.js',import.meta.url),'utf8');
const paymongoServer=readFileSync(new URL('../server-paymongo.js',import.meta.url),'utf8');

test('server-payments required payment-core exports exist',()=>{
  const required=[
    'ensurePaymentSchema','backfillLegacyOrderPayments','createOrderPaymentIntent','paymentIntentDetail',
    'createFeePolicy','addFeeRule','feePolicyOverview','createRefundRequest','createReconciliationRun',
    'paymentFinanceOverview','mirrorConfirmedOrderPayment'
  ];
  for(const name of required){
    assert.match(paymentsServer,new RegExp('\\b'+name+'\\b'),'server-payments must reference '+name);
    assert.equal(typeof paymentCore[name],'function','Missing payment-core export: '+name);
  }
});

test('server-paymongo required adapter exports exist',()=>{
  const required=[
    'ensurePayMongoSchema','payMongoRuntimeConfig','createPayMongoCheckout',
    'processPayMongoWebhook','executePayMongoRefund'
  ];
  for(const name of required){
    assert.match(paymongoServer,new RegExp('\\b'+name+'\\b'),'server-paymongo must reference '+name);
    assert.equal(typeof paymongoAdapter[name],'function','Missing PayMongo adapter export: '+name);
  }
});
