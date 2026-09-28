import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const shell=read('public/shell.js');
const support=read('public/admin-operations-ui.js');
const css=read('public/admin-operations.css');

test('Account Settings exposes one root help destination instead of duplicate Help rows',()=>{
  const start=shell.indexOf('<section class="accountSettingsCard accountSharedUtilities">');
  const end=shell.indexOf('<div class="accountSettingsBoundary">',start);
  assert.ok(start>=0&&end>start);
  const block=shell.slice(start,end);
  assert.equal((block.match(/<strong>Help & Support<\/strong>/g)||[]).length,1);
  assert.equal((block.match(/<strong>Help Center<\/strong>/g)||[]).length,0);
  assert.doesNotMatch(block,/<a href="\/help"/);
  assert.match(block,/Guides, contact Support, tickets and privacy-rights requests/);
});

test('Help & Support retains public guides inside the canonical Support workspace',()=>{
  const start=support.indexOf('function supportFormHtml()');
  const end=support.indexOf('async function openSupport()',start);
  const block=support.slice(start,end);
  assert.match(block,/class="supportHelpCenterLink" href="\/help"/);
  assert.match(block,/<strong>Help Center<\/strong>/);
  assert.match(block,/data-tab="new"/);
  assert.match(block,/data-tab="mine"/);
  assert.match(css,/\.supportHelpCenterLink\{[^}]*min-height:62px/);
});
