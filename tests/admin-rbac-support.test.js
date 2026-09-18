import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { signAdminAssertion, verifyAdminAssertion, ADMIN_PERMISSIONS } from '../admin-authorization.js';

const server=readFileSync(new URL('../server-admin-operations.js',import.meta.url),'utf8');
const governance=readFileSync(new URL('../server-profile-governance.js',import.meta.url),'utf8');
const accounting=readFileSync(new URL('../server-business-accounting.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/admin-operations-ui.js',import.meta.url),'utf8');

test('internal scoped Admin assertions are signed, expiring and tamper-resistant',()=>{
  const secret='test-secret-value';
  const signed=signAdminAssertion(secret,{accountId:42,permission:'support.manage',territoryId:7,assignmentId:9});
  const parsed=verifyAdminAssertion(secret,signed,42);
  assert.equal(parsed.accountId,42);
  assert.equal(parsed.permission,'support.manage');
  assert.equal(parsed.territoryId,7);
  assert.equal(parsed.assignmentId,9);
  assert.equal(verifyAdminAssertion(secret,signed+'x',42),null);
  assert.equal(verifyAdminAssertion(secret,signed,99),null);
});

test('admin authority is modeled separately from public profiles',()=>{
  assert.match(server,/platform_admin_assignments/);
  assert.match(server,/admin_permission_grants/);
  assert.match(server,/super_admin/);
  assert.match(server,/country_admin/);
  assert.match(server,/territory_admin/);
  assert.ok(ADMIN_PERMISSIONS.includes('admin.assign_limited'));
  assert.ok(ADMIN_PERMISSIONS.includes('support.manage'));
  assert.ok(ADMIN_PERMISSIONS.includes('incident.triage'));
});

test('territory scope and delegated permissions gate Admin operations',()=>{
  assert.match(server,/visibleTerritoryIds/);
  assert.match(server,/requireAdminPermission/);
  assert.match(server,/You cannot delegate permission/);
  assert.match(server,/Only Super Admin can appoint a Country Admin/);
  assert.doesNotMatch(server,/if\(Number\(me\.account\.id\)!==1\)/);
});

test('legacy governance accepts only a signed internal assertion for non-owner Admins',()=>{
  assert.match(governance,/verifyAdminAssertion/);
  assert.match(governance,/x-bl-admin-assertion/);
  assert.match(governance,/Scoped Admin assertion required/);
  assert.match(accounting,/x-bl-admin-assertion/);
});

test('support is distinct from incidents and supports rich evidence',()=>{
  assert.match(server,/CREATE TABLE IF NOT EXISTS support_tickets/);
  assert.match(server,/CREATE TABLE IF NOT EXISTS support_messages/);
  assert.match(server,/CREATE TABLE IF NOT EXISTS support_attachments/);
  assert.match(server,/requested_destination/);
  for(const marker of ["'image'","'pdf'","'word'","'markdown'","'audio'"])assert.match(server,new RegExp(marker));
  assert.match(server,/transcript_text/);
  assert.match(server,/english_translation/);
  assert.match(server,/support_escalated_to_incident/);
  assert.match(server,/linked_incident_id/);
});

test('support UI offers voice transcription, English translation and Admin routing',()=>{
  assert.match(ui,/SpeechRecognition/);
  assert.match(ui,/MediaRecorder/);
  assert.match(ui,/Translator/);
  assert.match(ui,/LanguageDetector/);
  assert.match(ui,/Filipino \/ Tagalog/);
  assert.match(ui,/Platform administration/);
  assert.match(ui,/\.docx/);
  assert.match(ui,/\.md/);
});

test('Admin Operations UI contains scoped queues and delegated Admin editor',()=>{
  assert.match(ui,/Admin Operations/);
  assert.match(ui,/Delegate administration/);
  assert.match(ui,/adminTargetRole/);
  assert.match(ui,/Support/);
  assert.match(ui,/Incidents/);
  assert.match(ui,/Audit/);
});
