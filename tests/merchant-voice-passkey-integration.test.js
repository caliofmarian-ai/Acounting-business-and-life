import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const server=readFileSync(new URL('../server-orders.js',import.meta.url),'utf8');
const routes=readFileSync(new URL('../merchant-voice-passkey-routes.js',import.meta.url),'utf8');
const voiceRoutes=readFileSync(new URL('../merchant-voice-order-routes.js',import.meta.url),'utf8');
const confirm=readFileSync(new URL('../merchant-voice-order-confirm.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/merchant-voice-order-ui.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/merchant-voice-order.css',import.meta.url),'utf8');

test('all passkey endpoints attach to the existing Orders router and exact Merchant context',()=>{
 assert.match(server,/installMerchantVoicePasskeyRoutes\(app,/);
 assert.match(server,/requireMerchant,quoteSecret:merchantVoiceSigningSecret/);
 assert.match(server,/tokenSecret:process\.env\.TOKEN_SECRET/);
 assert.match(server,/verifyDeviceApproval:merchantVoicePasskey\.ready\(\)\?merchantVoicePasskey\.verifyDeviceApproval:null/);
 assert.match(server,/passkeyReady:\(\)=>merchantVoicePasskey\.enrollmentReady\(\)/);
 assert.match(server,/passkeyConfig\(\)\.ready\)await ensureMerchantVoicePasskeySchema\(pool\)/);
 for(const suffix of ['enroll/options','enroll/verify','approval/options'])
   assert.ok(routes.includes("/api/orders/voice/passkey/"+suffix));
 assert.match(routes,/const \{me,business\}=await requireMerchant\(req,bid\)/);
 assert.match(routes,/sessionId:safeSessionId|safeSessionId\(req,aid,bid,quoteSecret\)/);
});

test('password and phone proof must both precede existing canonical order with one transactional request key',()=>{
 const stepUpIndex=confirm.indexOf('await requireVoiceOperatorStepUp(client,');
 const deviceIndex=confirm.indexOf('await verifyDeviceApproval(client,');
 const snapshotIndex=confirm.indexOf('const snapshots=await canonicalSnapshots(client,');
 const createIndex=confirm.indexOf('return createCanonicalOrder({businessId:bid');
 assert.ok(stepUpIndex>0&&deviceIndex>stepUpIndex&&snapshotIndex>deviceIndex&&createIndex>snapshotIndex);
 assert.match(confirm,/return createCanonicalOrder\(\{businessId:bid/);
 assert.match(confirm,/client\}\);/);
 assert.match(confirm,/guard\(db,\{/);
 assert.match(server,/if\(!sharedClient\)await client\.query\('BEGIN'\)/);
 assert.match(server,/if\(!sharedClient\)\{await client\.query\('COMMIT'\)/);
 assert.match(voiceRoutes,/passkey_enrollment_available:ready\(\)&&passkeyReady\(\)/);
});

test('Android UI keeps native device confirmation and human phrase separate from speech recognition',()=>{
 assert.match(ui,/navigator\.credentials\.create/);
 assert.match(ui,/navigator\.credentials\.get/);
 assert.match(ui,/passkey\/enroll\/options/);
 assert.match(ui,/passkey\/enroll\/verify/);
 assert.match(ui,/passkey\/approval\/options/);
 assert.match(ui,/merchantVoicePhraseInput/);
 assert.match(ui,/confirmation_phrase:state\.phraseTyped\.trim\(\)/);
 assert.match(ui,/request_key:state\.confirmationKey/);
 assert.match(ui,/operator_confirmed:true/);
 assert.match(ui,/password.*not sent to AI/);
 assert.doesNotMatch(ui,/localStorage|sessionStorage|MediaRecorder/);
 assert.match(css,/min-height:44px/);
});