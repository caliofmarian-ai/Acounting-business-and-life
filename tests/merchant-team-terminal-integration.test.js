import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const get=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');

test('staff portal is mounted behind its own flag in existing Orders service',()=>{
 const orders=get('server-orders.js');
 assert.match(orders,/installMerchantTeamTerminalRoutes\(app,/);
 assert.match(orders,/ensureMerchantTeamTerminalSchema\(pool\)/);
 assert.match(orders,/MERCHANT_TEAM_TERMINAL_ENABLED==='1'/);
 assert.match(orders,/merchantCounterCatalog\(pool,\{businessId/);
 assert.match(orders,/merchantCounterSnapshots\(pool,/);
 assert.match(orders,/\/operator/);
});
test('restricted staff routes contain no financial mutation or account impersonation',()=>{
 const routes=get('merchant-team-terminal-routes.js');
 for(const marker of ["'/api/orders/operator/session'","'/api/orders/operator/catalog'",
   "'/api/orders/operator/voice/turn'","'/api/orders/operator/voice/quote'",
   "'/api/orders/team/terminal/pair'",'forbidOwnerSession','verifyTerminalCsrf'])assert.ok(routes.includes(marker),marker);
 assert.doesNotMatch(routes,/app\.post\('\/api\/orders\/operator\/(?:payment|refund|create|admin)/);
 assert.doesNotMatch(routes,/\.headers\.authorization\s*=|accountAuthFetch\(/);
});
test('main owner Team UI offers pairing rather than shared-session staff unlock',()=>{
 const ui=get('public/merchant-team-ui.js');
 assert.match(ui,/merchantTeamPair/);
 assert.match(ui,/MERCHANT_TEAM_TERMINAL_ENABLED|terminal_enabled/);
 const teamRoutes=get('merchant-team-routes.js');
 assert.match(teamRoutes,/TEAM_OPERATOR_TERMINAL_REQUIRED/);
 assert.match(teamRoutes,/terminal_enabled/);
});
test('staff portal is standalone, no main app or Money/Payments scripts',()=>{
 const html=get('public/merchant-operator.html');
 assert.match(html,/Staff terminal/);
 assert.match(html,/merchant-operator-ui\.js/);
 assert.doesNotMatch(html,/auth-ui\.js|shell\.js|payments-ui\.js|BusinessLifeShell/);
 const js=get('public/merchant-operator-ui.js');
 assert.match(js,/api\/orders\/operator\/pair\/start/);
 assert.match(js,/api\/orders\/operator\/voice\/quote/);
 assert.doesNotMatch(js,/localStorage|sessionStorage|\/api\/accounting\/|\/api\/payments\//);
});