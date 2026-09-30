import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const publicServer=read('server-paymongo.js');
const payments=read('server-payments.js');
const legal=read('server-legal.js');
const notifications=read('server-notifications.js');
const auth=read('server-auth.js');
const notificationUi=read('public/notifications-ui.js');
const qa=read('qa-acceptance.js');
const workflow=read('.github/workflows/admin-runtime.yml');

test('Notifications is embedded beneath Legal and localhost 4407 is retired',()=>{
  assert.match(notifications,/export async function startEmbeddedNotifications\(\)/);
  assert.match(notifications,/export async function stopEmbeddedNotifications\(\)/);
  assert.match(notifications,/Business & Life notification gateway mounted in-process/);
  assert.match(notifications,/directExecution/);
  assert.match(notifications,/Business & Life notification gateway listening on/);
  assert.match(legal,/notificationsApp=await startEmbeddedNotifications\(\)/);
  assert.match(legal,/await stopEmbeddedNotifications\(\)/);
  for(const source of [legal,payments,publicServer]){
    assert.doesNotMatch(source,/INTERNAL_NOTIFICATIONS_PORT/);
    assert.doesNotMatch(source,/\|\|\s*4407/);
    assert.doesNotMatch(source,/127\.0\.0\.1:4407/);
  }
  assert.doesNotMatch(legal,/spawn\(process\.execPath,\['server-notifications\.js'\]/);
});

test('Notifications fetch facade is fail-closed for owned routes and composes the lower runtime',()=>{
  assert.match(notifications,/export function isNotificationsOwnedPath/);
  assert.match(notifications,/pathname==='\/api\/notifications'/);
  assert.match(notifications,/pathname\.startsWith\('\/api\/notifications\/'\)/);
  assert.match(notifications,/NOTIFICATIONS_EMBEDDED_DISPATCH_REQUIRED/);
  assert.match(notifications,/return upstream\(path,options\)/);
  assert.match(notifications,/href="\/notifications\.css"/);
  assert.match(notifications,/src="\/notifications-ui\.js"/);
});

test('Resend signature verification uses byte-exact public rawBody before parsed JSON',()=>{
  assert.match(publicServer,/verify:\(req,_res,buf\)=>\{req\.rawBody=Buffer\.from\(buf\)\}/);
  const rawBodyChoice=notifications.indexOf('Buffer.isBuffer(req.rawBody)&&req.rawBody.length');
  const parsedFallback=notifications.indexOf('Buffer.isBuffer(req.body)?req.body:null');
  const verify=notifications.indexOf('verifyResendWebhook({');
  assert.ok(rawBodyChoice>=0&&parsedFallback>rawBodyChoice&&verify>parsedFallback);
  assert.match(notifications,/verifyResendWebhook\(\{\s*rawBody,/s);
  assert.doesNotMatch(legal,/http\.request/);
  assert.doesNotMatch(legal,/JSON\.stringify\(req\.body\?\?\{\}\).*webhooks\/resend/s);
});

test('Payment Core preserves post-transaction mirror hooks while dispatching Legal in-process',()=>{
  assert.match(payments,/legalApp\.handle\(req,res/);
  assert.match(payments,/const paymentParams=\{\.\.\.req\.params\}/);
  assert.match(payments,/Buffer\.concat\(chunks\)\.toString\('utf8'\)/);
  assert.match(payments,/Payment mirror hook/);
  assert.match(payments,/req\.params=paymentParams/);
  assert.match(payments,/authHardeningFetch/);
  assert.doesNotMatch(payments,/http:\/\/127\.0\.0\.1/);
});

test('PayMongo preserves PWA gating without a localhost asset proxy',()=>{
  assert.match(publicServer,/function allowPwaAsset/);
  assert.match(publicServer,/app\.get\('\/manifest\.webmanifest',allowPwaAsset\)/);
  assert.match(publicServer,/app\.get\('\/sw\.js',allowPwaAsset\)/);
  assert.doesNotMatch(publicServer,/servePwaAsset/);
  assert.doesNotMatch(publicServer,/http:\/\/127\.0\.0\.1/);
});

test('Notifications polling resolves only lightweight authenticated identity',()=>{
  assert.match(auth,/app\.get\('\/api\/auth\/session\/identity', auth/);
  assert.match(auth,/account_id:Number\(req\.accountId\)/);
  assert.match(auth,/authenticatedAccountContext/);
  assert.match(auth,/pathname==='\/api\/auth\/session\/identity'/);
  assert.match(auth,/SELECT auth_status,email_verified_at,account_mode FROM accounts/);
  assert.match(auth,/ACCOUNT_NOT_ACTIVE/);
  assert.match(auth,/EMAIL_VERIFICATION_REQUIRED/);
  assert.match(notifications,/upstream\('\/api\/auth\/session\/identity'/);
  assert.doesNotMatch(notifications,/upstream\('\/api\/me'/);
});

test('Foreground notification refresh performs one unread request per cycle',()=>{
  assert.match(notificationUi,/async function pollForegroundVoice\(\{refreshBadge=true\}=\{\}\)/);
  assert.match(notificationUi,/if\(refreshBadge\)await refreshUnread\(\)/);
  assert.match(notificationUi,/pollForegroundVoice\(\{refreshBadge:false\}\)/);
  assert.doesNotMatch(notificationUi,/Promise\.allSettled\(\[refreshUnread\(\),pollForegroundVoice\(\)\]\)/);
});

test('Notifications Runtime V16 acceptance is wired into canonical QA',()=>{
  assert.match(qa,/NOTIFICATIONS_RUNTIME_V16_WAVE='notifications_runtime_v16'/);
  assert.match(qa,/runNotificationsRuntimeV16Acceptance/);
  assert.match(qa,/config\.wave===NOTIFICATIONS_RUNTIME_V16_WAVE/);
  assert.match(qa,/transaction_notification_hook:true/);
  assert.match(qa,/latency_samples:10/);
  assert.match(qa,/inbox_p50_ms:inboxP50/);
  assert.match(qa,/unread_p50_ms:unreadP50/);
  assert.match(qa,/inbox p50 exceeded 750 ms/);
  assert.match(qa,/unread p50 exceeded 500 ms/);
  assert.match(qa,/resend_invalid_signature_fail_closed:true/);
  assert.match(qa,/legacy_port_4407_retired:true/);
});

test('Admin Runtime Contract watches Notifications and Legal changes on PR and main',()=>{
  assert.equal((workflow.match(/- 'server-notifications\.js'/g)||[]).length,2);
  assert.equal((workflow.match(/- 'server-legal\.js'/g)||[]).length,2);
  assert.equal((workflow.match(/- 'server-payments\.js'/g)||[]).length,2);
  assert.equal((workflow.match(/- 'server-paymongo\.js'/g)||[]).length,2);
});
