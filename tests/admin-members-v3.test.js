import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const auth=read('admin-authorization.js');
const functions=read('admin-functions.js');
const server=read('server-admin-operations.js');
const ui=read('public/admin-console.js');
const css=read('public/admin-console.css');

function between(source,start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a);
  assert.ok(a>=0,'Missing start marker: '+start);
  assert.ok(b>a,'Missing end marker: '+end);
  return source.slice(a,b);
}

test('Members V3 keeps internal notes authority separate from directory visibility',()=>{
  assert.match(auth,/'members\.notes\.manage'/);
  assert.match(auth,/CREATE TABLE IF NOT EXISTS admin_member_notes/);
  assert.match(auth,/CREATE TABLE IF NOT EXISTS admin_member_tags/);
  const directory=between(functions,'member_directory:Object.freeze','member_account_controls:Object.freeze');
  assert.doesNotMatch(directory,/members\.notes\.manage/);
  const notes=between(functions,'member_context_notes:Object.freeze','profile_onboarding:Object.freeze');
  assert.match(notes,/permissions:\['admin\.console','members\.view','members\.notes\.manage'\]/);
  assert.match(notes,/assignable_to:\['country_admin','territory_admin','specialist'\]/);
});

test('Support member context requires overlapping Support scope and exposes summaries only',()=>{
  const block=between(server,'async function memberSupportContext','async function memberSafetyContext');
  assert.match(block,/memberPermissionAvailable\(ctx,id,'support\.manage'\)/);
  assert.match(block,/scopeFromContext\(ctx,'support\.manage','territory_id'\)/);
  assert.match(block,/requester_account_id=\$1/);
  assert.match(block,/subject/);
  assert.match(block,/priority/);
  assert.doesNotMatch(block,/description/);
  assert.doesNotMatch(block,/support_messages/);
  assert.doesNotMatch(block,/support_attachments/);
  assert.doesNotMatch(block,/data_url/);
});

test('Trust and Safety member context requires incident authority and never returns evidence details',()=>{
  const block=between(server,'async function memberSafetyContext','async function memberLegalContext');
  assert.match(block,/memberPermissionAvailable\(ctx,id,'incident\.triage'\)/);
  assert.match(block,/scopeFromContext\(ctx,'incident\.triage','territory_id'\)/);
  assert.match(block,/trust_case_entities/);
  assert.match(block,/relation_types/);
  assert.doesNotMatch(block,/signal_details/);
  assert.doesNotMatch(block,/trust_actions/);
  assert.doesNotMatch(block,/before_json/);
  assert.doesNotMatch(block,/after_json/);
});

test('Legal member context is sanitized and separately permission gated',()=>{
  const block=between(server,'async function memberLegalContext','async function memberInternalContext');
  assert.match(block,/memberPermissionAvailable\(ctx,id,'legal\.view'\)/);
  assert.match(block,/legal_acceptances/);
  assert.match(block,/document_code/);
  assert.match(block,/version_label/);
  assert.doesNotMatch(block,/ip_hash/);
  assert.doesNotMatch(block,/device_hash/);
  assert.doesNotMatch(block,/correlation_id/);
  assert.doesNotMatch(block,/content_sha256/);
});

test('Internal notes and tags are scoped, audited and notes remain append-only',()=>{
  const block=between(server,'async function memberInternalContext','async function adminMemberDetails');
  assert.match(block,/memberPermissionAvailable\(ctx,id,'members\.notes\.manage'\)/);
  assert.match(block,/admin_member_notes/);
  assert.match(block,/admin_member_tags/);
  assert.match(block,/memberScopeRecord\(ctx,accountId,'members\.notes\.manage'\)/);
  assert.match(block,/member_internal_note_added/);
  assert.match(block,/member_tag_added/);
  assert.match(block,/member_tag_removed/);
  assert.match(block,/appendAdminAudit/);
  assert.doesNotMatch(server,/delete\('\/api\/admin\/members\/:accountId\/notes/);
  assert.match(server,/app\.post\('\/api\/admin\/members\/:accountId\/notes'/);
  assert.match(server,/app\.post\('\/api\/admin\/members\/:accountId\/tags'/);
  assert.match(server,/app\.delete\('\/api\/admin\/members\/:accountId\/tags\/:tag'/);
});

test('Members V3 UI hides unauthorized contexts and deep-links canonical modules',()=>{
  assert.match(ui,/function memberSupportContextMarkup/);
  assert.match(ui,/function memberSafetyContextMarkup/);
  assert.match(ui,/function memberLegalContextMarkup/);
  assert.match(ui,/function memberInternalContextMarkup/);
  assert.match(ui,/if\(!context\?\.available\)return''/);
  assert.match(ui,/data-member-support-ticket/);
  assert.match(ui,/openSupportTicket/);
  assert.match(ui,/data-member-trust-case/);
  assert.match(ui,/openCase/);
  assert.match(ui,/IP\/device hashes, correlation IDs and document evidence are not exposed here/);
  assert.match(ui,/Do not paste passwords, payment credentials, raw identity documents or private evidence here/);
  assert.match(css,/ADMIN MEMBERS V3/);
  assert.match(css,/@media\(max-width:520px\)/);
});
