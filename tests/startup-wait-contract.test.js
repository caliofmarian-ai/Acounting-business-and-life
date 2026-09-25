import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {startupWaitAttempts} from '../startup-wait.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('production and default startup budgets remain unchanged',()=>{for(const base of [300,340,380,420]){assert.equal(startupWaitAttempts(base,{}),base);assert.equal(startupWaitAttempts(base,{APP_ENV:'production'}),base)}});
test('isolated QA doubles bounded child-startup attempts',()=>{for(const base of [300,340,380,420]){assert.equal(startupWaitAttempts(base,{APP_ENV:'qa'}),base*2);assert.equal(startupWaitAttempts(base,{APP_ENV:'QA'}),base*2)}});
test('in-process runtime retirement removes the final Notifications child-startup wait',()=>{
  const legal=read('server-legal.js');
  assert.doesNotMatch(legal,/startupWaitAttempts/);
  assert.doesNotMatch(legal,/Notification child failed health check/);
  assert.doesNotMatch(legal,/spawn\(process\.execPath,\['server-notifications\.js'\]/);
  assert.doesNotMatch(read('server-profile-governance.js'),/startupWaitAttempts/);
});
test('startup helper remains finite and sanitizes invalid base attempts',()=>{assert.equal(startupWaitAttempts(0,{APP_ENV:'qa'}),2);assert.equal(startupWaitAttempts('bad',{APP_ENV:'production'}),1);assert.ok(Number.isFinite(startupWaitAttempts(420,{APP_ENV:'qa'})))});
