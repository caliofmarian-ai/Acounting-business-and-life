import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server-admin-operations.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../public/admin-operations-ui.js', import.meta.url), 'utf8');
const adminConsole = readFileSync(new URL('../public/admin-console.js', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../docs/privacy/PRIVACY_RIGHTS_REQUEST_WORKFLOW.md', import.meta.url), 'utf8');

const categories = [
  'privacy_objection',
  'privacy_access',
  'privacy_correction',
  'privacy_erasure_blocking',
  'privacy_other_request'
];

test('privacy request types are first-class Support categories in server and UI', () => {
  for (const category of categories) {
    assert.match(server, new RegExp(category));
    assert.match(ui, new RegExp(category));
  }
  assert.match(server, /PRIVACY_SUPPORT_CATEGORIES/);
  assert.match(ui, /PRIVACY_SUPPORT_CATEGORIES/);
});

test('privacy requests are forced out of Territory Admin routing server-side', () => {
  assert.match(server, /const isPrivacyRequest=PRIVACY_SUPPORT_CATEGORIES\.has\(category\)/);
  assert.match(server, /destination=isPrivacyRequest\?'country_admin':requestedDestination/);
  assert.match(server, /relatedType=isPrivacyRequest\?'privacy_rights':requestedRelatedType/);
  assert.match(server, /relatedId=isPrivacyRequest\?null:requestedRelatedId/);
  assert.match(server, /territoryId=isPrivacyRequest\?null:/);
  assert.match(server, /'privacy_rights'/);
  assert.match(server, /ON CONFLICT DO NOTHING/);
});

test('privacy UI explains routing, verification minimization and non-automatic outcomes', () => {
  assert.match(ui, /Privacy & data rights/);
  assert.match(ui, /country-level privacy review/);
  assert.match(ui, /not a local Territory Admin/);
  assert.match(ui, /do not upload identity documents unless/i);
  assert.match(ui, /does not automatically guarantee deletion/i);
  assert.match(ui, /destination\.value='country_admin'/);
  assert.match(ui, /destination\.disabled=true/);
});

test('requester access stays account-bound and internal notes stay hidden from requester', () => {
  assert.match(server, /WHERE requester_account_id=\$1 ORDER BY updated_at DESC/);
  assert.match(server, /Number\(t\.requester_account_id\)!==Number\(me\.account\.id\)/);
  assert.match(server, /m\.visibility='user' OR \$2::boolean/);
  assert.match(server, /requireAdminPermission\(pool,me\.account\.id,'support\.manage',t\.territory_id\)/);
});

test('country-wide Admin queue can see NULL-territory privacy cases while territory queue remains scoped', () => {
  assert.match(server, /countryWide\?"t\.country_code='PH'":`t\.territory_id=ANY\(\$1::bigint\[\]\)`/);
  assert.match(server, /isCountryWide\(me\.account\.id,'support\.manage'\)/);
  assert.match(adminConsole, /x\.category/);
  assert.match(ui, /\$\{esc\(t\.category\)\}/);
});

test('workflow does not invent controller DPO identity or guarantee legal outcome', () => {
  assert.match(workflow, /does not state that a Country Admin is automatically the Philippine PIC, DPO/i);
  assert.match(workflow, /does not automatically mean:/);
  assert.match(workflow, /does not yet automate deletion or suppression/i);
  assert.match(workflow, /must not publish an invented DPO\/controller name/i);
});
