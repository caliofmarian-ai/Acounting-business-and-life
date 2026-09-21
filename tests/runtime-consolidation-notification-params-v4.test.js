import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const notifications=read('server-notifications.js');
const services=read('server-services.js');
const admin=read('server-admin-operations.js');

test('post-transaction notification hooks retain route params across embedded Express apps',()=>{
  const snapshot=notifications.indexOf('const notificationParams={...req.params}');
  const dispatch=notifications.indexOf('adminApp.handle(req,res');
  const restore=notifications.indexOf('req.params=notificationParams');
  const hook=notifications.indexOf('after(data)');
  assert.ok(snapshot>=0);
  assert.ok(dispatch>snapshot);
  assert.ok(restore>snapshot);
  assert.ok(hook>restore);
  assert.match(notifications,/const positiveId=v=>/);
  assert.match(notifications,/const key=positiveId\(id\);if\(!key\)return null/);
});

test('Local Services notification lifecycle remains wired after in-process consolidation',()=>{
  assert.match(notifications,/service\.request_created/);
  assert.match(notifications,/service\.quote_created/);
  assert.match(notifications,/service\.quote_accepted/);
  assert.match(notifications,/service\.status_changed/);
  assert.match(notifications,/\/api\/services\/jobs\/:id\/accept-quote/);
});

test('expected access denials remain HTTP 4xx without noisy server-error stack logging',()=>{
  assert.match(services,/if\(status>=500\)console\.error\(err\)/);
  assert.match(admin,/if\(status>=500\)console\.error\(err\)/);
  assert.match(services,/status<500\?err\.message:'Unexpected server error'/);
  assert.match(admin,/status<500\?err\.message:'Unexpected admin operations error'/);
});
