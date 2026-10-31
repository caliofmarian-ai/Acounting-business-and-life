import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const server=readFileSync(new URL('../server-orders.js',import.meta.url),'utf8');
const voice=readFileSync(new URL('../merchant-voice-order-routes.js',import.meta.url),'utf8');
const confirm=readFileSync(new URL('../merchant-voice-order-confirm.js',import.meta.url),'utf8');
const teamUi=readFileSync(new URL('../public/merchant-team-ui.js',import.meta.url),'utf8');
const voiceUi=readFileSync(new URL('../public/merchant-voice-order-ui.js',import.meta.url),'utf8');
const core=readFileSync(new URL('../merchant-team-operators.js',import.meta.url),'utf8');

test('one existing Merchant account holds the Team; no second account, profile or business engine',()=>{
 assert.match(server,/installMerchantTeamRoutes\(app,/);
 assert.match(server,/db:pool,requireMerchant,bodyMiddleware:body/);
 assert.match(server,/if\(process\.env\.MERCHANT_TEAM_ENABLED==='1'\)await ensureMerchantTeamSchema\(pool\)/);
 assert.doesNotMatch(core,/INSERT INTO\s+(accounts|businesses|profiles|profile_business_bindings)/i);
 assert.match(core,/merchant_team_operators/);
 assert.match(core,/owner_account_id/);
});
test('every voice turn and quote rebinds to operator shift and rejects stale draft after handoff',()=>{
 assert.match(server,/teamEnabled:merchantTeam\.enabled,operatorResolver:merchantTeam\.resolveForVoice/);
 assert.match(voice,/operator=await operatorResolver\(req/);
 assert.match(voice,/operator\.operator_id/);
 assert.match(voice,/operator\.shift_id/);
 assert.match(voice,/team_enabled:teamEnabled\(\)/);
 assert.match(voiceUi,/abl:merchant-team-operator-changed/);
 assert.match(voiceUi,/BusinessLifeMerchantTeam\?\.headers/);
});
test('account-level passkey cannot create on behalf of an employee while new team gate is enabled',()=>{
 assert.match(server,/teamEnabled:merchantTeam\.enabled/);
 assert.match(confirm,/!teamEnabled\(\)/);
 assert.match(voice,/can_confirm_order:!teamEnabled\(\)/);
 assert.match(core,/orders.voice_draft/);
 assert.doesNotMatch(core,/payments\.write/);
});
test('Android Team companion has separate operator PIN, owner-only management and no saved credentials',()=>{
 assert.match(server,/merchant-team-ui\.js/);
 assert.match(server,/merchant-team\.css/);
 assert.match(teamUi,/merchantTeamStart/);
 assert.match(teamUi,/merchantTeamAdd/);
 assert.match(teamUi,/merchantTeamVerify/);
 assert.match(teamUi,/abl:merchant-team-operator-changed/);
 assert.doesNotMatch(teamUi,/localStorage|sessionStorage|indexedDB/i);
 assert.match(core,/scrypt/);
 assert.match(core,/timingSafeEqual/);
 assert.match(core,/attempt_count/);
});
