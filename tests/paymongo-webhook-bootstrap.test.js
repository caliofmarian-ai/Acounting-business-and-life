import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { payMongoWebhookBootstrapStatus, payMongoRuntimeConfig } from '../paymongo-adapter.js';

const adapter=readFileSync(new URL('../paymongo-adapter.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../server-paymongo.js',import.meta.url),'utf8');

test('PayMongo webhook bootstrap discovers by exact URL before creating anything',()=>{
  assert.match(adapter,/\/v1\/webhooks\?limit=100&url=/);
  assert.match(adapter,/events\.includes\('checkout_session\.payment\.paid'\)/);
  assert.match(adapter,/if\(!hook\)/);
  assert.match(adapter,/method:'POST'/);
});

test('webhook bootstrap keeps verification secret out of public status',()=>{
  const old=process.env.PAYMONGO_WEBHOOK_SECRET;
  process.env.PAYMONGO_WEBHOOK_SECRET='whsk_unit_test_secret';
  const state=payMongoWebhookBootstrapStatus();
  assert.equal(state.ready,true);
  assert.equal('secret' in state,false);
  assert.equal(JSON.stringify(state).includes('whsk_unit_test_secret'),false);
  if(old===undefined)delete process.env.PAYMONGO_WEBHOOK_SECRET;else process.env.PAYMONGO_WEBHOOK_SECRET=old;
});

test('provider metadata records webhook identity and source but never secret material',()=>{
  assert.match(adapter,/webhook_id:/);
  assert.match(adapter,/webhook_url:/);
  assert.match(adapter,/webhook_secret_source:/);
  assert.doesNotMatch(adapter,/webhook_secret\s*:/);
  assert.doesNotMatch(adapter,/secret_key\s*:\s*state/);
});

test('environment webhook secret remains an explicit override',()=>{
  const old=process.env.PAYMONGO_WEBHOOK_SECRET;
  process.env.PAYMONGO_WEBHOOK_SECRET='whsk_override';
  const cfg=payMongoRuntimeConfig();
  assert.equal(cfg.webhookReady,true);
  assert.equal(cfg.webhookSource,'environment');
  if(old===undefined)delete process.env.PAYMONGO_WEBHOOK_SECRET;else process.env.PAYMONGO_WEBHOOK_SECRET=old;
});

test('server bootstraps webhook at startup and exposes a scoped Admin retry',()=>{
  assert.match(server,/await ensurePayMongoWebhook\(pool\)/);
  assert.match(server,/\/api\/payments\/admin\/paymongo\/webhook\/bootstrap/);
  assert.match(server,/requireAdminPermission\(pool,me\.account\.id,'payment\.manage'/);
  assert.match(server,/paymongo_webhook_bootstrap/);
});

test('webhook bootstrap failure keeps payment provider unavailable instead of weakening signature checks',()=>{
  assert.match(adapter,/status:'bootstrap_failed'/);
  assert.match(adapter,/webhook_secret_not_configured/);
  assert.match(adapter,/PAYMONGO_WEBHOOK_SIGNATURE_INVALID/);
});
