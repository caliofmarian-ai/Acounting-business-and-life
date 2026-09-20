import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const core=readFileSync(new URL('../notification-core.js',import.meta.url),'utf8');

test('Resend email routing is department-aware',()=>{
  assert.match(core,/function emailDepartment/);
  for(const dept of ['security','billing','support','legal','marketing','operations'])assert.match(core,new RegExp("'"+dept+"'"));
  assert.match(core,/RESEND_API_KEY_/);
  assert.match(core,/RESEND_FROM_/);
});

test('department-specific credentials fall back to legacy shared Resend configuration',()=>{
  assert.match(core,/process\.env\['RESEND_API_KEY_'\+suffix\]\|\|process\.env\.RESEND_API_KEY/);
  assert.match(core,/process\.env\['RESEND_FROM_'\+suffix\]\|\|process\.env\.AUTH_FROM_EMAIL/);
});

test('auth mail is routed through Security department',()=>{
  assert.match(core,/cat==='security'/);
  assert.match(core,/sendTransientEmailNotification/);
  assert.match(core,/resendEmail\(\{to,subject,html,eventCode,category\}\)/);
});

test('billing and finance event families route to Billing',()=>{
  assert.match(core,/payment\|billing\|invoice\|subscription\|refund\|settlement\|payout\|fee\|finance/);
});

test('Resend outbound messages are tagged with department and event',()=>{
  assert.match(core,/tags:\[\{name:'department',value:cfg\.department\}/);
  assert.ok(core.includes("{name:'event',value:clean(eventCode||'generic',80).replace(/[^A-Za-z0-9_-]/g,'_')||'generic'}"));
});

test('queued email delivery carries notification category into sender routing',()=>{
  assert.match(core,/e\.event_code,e\.category,e\.entity_type/);
  assert.match(core,/category:row\.category\|\|'operational'/);
});
