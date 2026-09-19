import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui=fs.readFileSync(new URL('../public/admin-console.js',import.meta.url),'utf8');

test('admin support queue opens a ticket detail view',()=>{
  assert.match(ui,/data-support-ticket/);
  assert.match(ui,/openAdminSupportTicket/);
  assert.match(ui,/\/api\/support\/tickets\/'\+id/);
  assert.match(ui,/bindSupportQueue/);
});

test('admin can reply and update ticket workflow',()=>{
  assert.match(ui,/adminSupportReply/);
  assert.match(ui,/\/api\/admin\/support\/'\+id\+'\/messages/);
  assert.match(ui,/visibility:form\.internal\.checked\?'internal':'user'/);
  assert.match(ui,/adminSupportUpdate/);
  assert.match(ui,/method:'PATCH'/);
  assert.match(ui,/assign_to_self/);
});
