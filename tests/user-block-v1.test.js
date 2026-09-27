import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {accountsBlocked,blockAccount,hasActiveBlock} from '../trust-safety-core.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const core=read('trust-safety-core.js');
const services=read('server-services.js');
const incidents=read('server-incidents.js');
const velocity=read('abuse-velocity-core.js');
const ui=read('public/services-ui.js');
const css=read('public/services.css');

test('Local Services blocks have a canonical scoped relation and append-only audit events',()=>{
  assert.match(core,/CREATE TABLE IF NOT EXISTS user_blocks/);
  assert.match(core,/PRIMARY KEY\(blocker_account_id,blocked_account_id,scope\)/);
  assert.match(core,/CHECK\(blocker_account_id<>blocked_account_id\)/);
  assert.match(core,/CHECK\(scope IN \('local_services'\)\)/);
  assert.match(core,/CREATE TABLE IF NOT EXISTS user_block_events/);
  assert.match(core,/event_type IN \('blocked','unblocked','reason_updated'\)/);
  assert.match(core,/created_at=CASE WHEN user_blocks\.removed_at IS NOT NULL THEN NOW\(\)/);
  assert.match(core,/INSERT INTO user_block_events[\s\S]{0,220}'unblocked'/);
});

test('block checks are bilateral but scope-bound',async()=>{
  const calls=[];
  const pool={query:async(sql,args)=>{calls.push({sql,args});return{rowCount:1,rows:[{}]}}};
  assert.equal(await accountsBlocked(pool,12,34,'local_services'),true);
  assert.deepEqual(calls[0].args,[12,34,'local_services']);
  assert.match(calls[0].sql,/scope=\$3/);
  assert.match(calls[0].sql,/blocker_account_id=\$2 AND blocked_account_id=\$1/);
  assert.equal(await hasActiveBlock(pool,{blockerAccountId:12,blockedAccountId:34,blockScope:'local_services'}),true);
  await assert.rejects(()=>accountsBlocked(pool,12,34,'global'),e=>e.status===400);
});

test('self-block and platform safety-function block fail before persistence',async()=>{
  const pool={query:async()=>{throw new Error('database must not be reached')},connect:async()=>{throw new Error('database must not be reached')}};
  await assert.rejects(()=>blockAccount(pool,{blockerAccountId:7,blockedAccountId:7}),e=>e.status===409);
  await assert.rejects(()=>blockAccount(pool,{blockerAccountId:7,blockedAccountId:1}),e=>e.status===403);
});

test('block mutations and Incident submissions have bounded velocity',()=>{
  assert.match(core,/BLOCK_ACTION_HOURLY_LIMIT=20/);
  assert.match(core,/BLOCK_ACTION_DAILY_LIMIT=60/);
  assert.match(core,/user_block_events[\s\S]{0,260}INTERVAL '1 hour'/);
  assert.match(core,/Too many block changes[\s\S]{0,80}status:429/);
  assert.match(velocity,/incident_submit:\[\{windowSeconds:3600,maxAttempts:12\},\{windowSeconds:86400,maxAttempts:40\}\]/);
  const route=incidents.slice(incidents.indexOf("app.post('/api/incidents'"),incidents.indexOf("app.get('/api/incidents/mine'"));
  assert.ok(route.indexOf("actionCode:'incident_submit'")<route.indexOf('INSERT INTO incident_reports'));
});

test('authenticated block API reveals only the callers own block direction',()=>{
  assert.match(services,/pathname==='\/api\/user-blocks'\|\|pathname\.startsWith\('\/api\/user-blocks\/'\)/);
  assert.match(services,/app\.get\('\/api\/user-blocks',async\(req,res,next\)=>\{try\{const me=await identity\(req\)/);
  assert.match(services,/app\.post\('\/api\/user-blocks',body,async\(req,res,next\)=>\{try\{const me=await identity\(req\)/);
  assert.match(services,/app\.delete\('\/api\/user-blocks\/:accountId',async\(req,res,next\)=>\{try\{const me=await identity\(req\)/);
  const statusRoute=services.slice(services.indexOf("app.get('/api/user-blocks/:accountId/status'"),services.indexOf("app.post('/api/user-blocks'"));
  assert.match(statusRoute,/blocked_by_me/);
  assert.doesNotMatch(statusRoute,/reason_category|blocked_me|blocked_by_target/);
});

test('Local Services denies only new interaction and preserves existing obligations and history',()=>{
  const createRoute=services.slice(services.indexOf("app.post('/api/services/jobs'"),services.indexOf("app.get('/api/services/jobs/mine'"));
  assert.match(createRoute,/accountsBlocked\(pool,me\.account\.id,providerId,'local_services'\)/);
  assert.ok(createRoute.indexOf('accountsBlocked')<createRoute.indexOf('INSERT INTO service_jobs'));
  assert.match(createRoute,/Existing jobs and history remain available/);
  const existingRoutes=services.slice(services.indexOf("app.get('/api/services/jobs/mine'"),services.indexOf('async function credentialReviewTarget'));
  assert.doesNotMatch(existingRoutes,/accountsBlocked|user_blocks/);
  for(const retained of ['accept-quote','confirm-completion',"jobs/:id/review","jobs/:id/status"])assert.match(existingRoutes,new RegExp(retained.replace('/','\\/')));
});

test('provider UI separates private block from report and supports audited unblock',()=>{
  assert.match(ui,/Promise\.all\(\[sapi\(`\/api\/services\/providers\/\$\{id\}`\),sapi\(`\/api\/user-blocks\/\$\{id\}\/status`\)\]\)/);
  assert.match(ui,/id="reportProvider"[\s\S]{0,220}id="blockProvider"/);
  assert.match(ui,/The other account is not shown this reason/);
  assert.match(ui,/It does not cancel active jobs, hide transaction history or submit a report/);
  assert.match(ui,/method:'DELETE'/);
  assert.match(ui,/New requests blocked/);
  assert.match(ui,/Existing jobs, payments, reports, reviews and history remain available/);
  assert.match(css,/\.serviceSafetyAction,\.serviceBlockAction\{min-height:44px/);
  assert.match(css,/\.requestServiceBtn:disabled/);
});
