import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signV2SessionToken } from '../auth-session-core.js';
import { canAccessControlledDocument, documentationAccessContext } from '../documentation-access.js';
import { loadControlledDocuments, parseControlledMarkdown, documentMetadata, authorizedDocumentLinks } from '../documentation-catalog.js';
import { registerKnowledgeRoutes } from '../server-knowledge.js';
import { safeMarkdownLink } from '../public/knowledge/markdown.js';

const at = Date.now();
const me = (id = 2, roles = ['customer'], businesses = []) => ({ account: { id, auth_status: 'active' },
  profiles: roles.map(role => ({ role, enabled: true, status: 'active' })), businesses });
const assignment = (id, effective_rank, extra = {}) => ({ id: id * 10, account_id: id,
  admin_role: effective_rank === 'specialist' ? 'territory_admin' : effective_rank,
  effective_rank, country_code: 'PH', status: 'active', effective_from: new Date(at - 1000).toISOString(),
  effective_until: null, permissions: [], ...extra });
const doc = (access_class = 'PROFILE_PRIVATE', extra = {}) => ({ id: 'BL-30-PH-PLAY-002', title: 'Merchant guide',
  document_type: 'profile_playbook', access_class, status: 'DRAFT', version: '1.0',
  country_code: 'PH', territory_scope: 'country', applicable_profiles: ['merchant'], applicable_functions: [],
  category: 'My role', markdown: '# Merchant guide\n\nPrivate guidance.', relative_path: 'docs/roles/PLAYBOOK_MERCHANT.md', ...extra });
const context = (account, assignments = [], opts = {}) => documentationAccessContext(account, assignments, { now: at, ...opts });
const frontmatter = (extra = '') => `---\ndocument_id: BL-30-PH-PLAY-002\ntitle: Merchant guide\nversion: 1.0\nstatus: DRAFT\naccess_class: PROFILE_PRIVATE\ncountry_code: PH\nterritory_scope: country\napplicable_profiles: [merchant]\n${extra}---\n\n# Merchant guide\n`;

test('private profile guides require current enabled/active role, generic member guides remain readable', () => {
  assert.equal(canAccessControlledDocument(doc(), context(me())), false);
  assert.equal(canAccessControlledDocument(doc(), context(me(2, ['merchant']))), true);
  const disabled = me(2, ['merchant']); disabled.profiles[0].status = 'suspended';
  assert.equal(canAccessControlledDocument(doc(), context(disabled)), false);
  disabled.profiles[0].status = 'active'; disabled.profiles[0].enabled = false;
  assert.equal(canAccessControlledDocument(doc(), context(disabled)), false);
  assert.equal(canAccessControlledDocument(doc('PROFILE_PRIVATE', { applicable_profiles: [] }), context(me())), true);
  assert.equal(canAccessControlledDocument(doc('MEMBER'), context(me())), true);
  assert.equal(canAccessControlledDocument(doc('PUBLIC'), context(me())), false);
  assert.equal(canAccessControlledDocument(doc(), context(null)), false);
});

test('business guidance requires Merchant/Supplier plus a current PH workspace membership', () => {
  const business = [{ id: 10, active: true, country_code: 'PH' }];
  const d = doc('BUSINESS_PRIVATE', { applicable_profiles: [] });
  assert.equal(canAccessControlledDocument(d, context(me(2, ['merchant'], business))), true);
  assert.equal(canAccessControlledDocument(d, context(me(2, ['supplier'], business))), true);
  for (const account of [me(2, ['merchant']), me(2, ['customer'], business), me(2, ['merchant'], [{ ...business[0], active: false }]), me(2, ['merchant'], [{ ...business[0], country_code: 'IE' }])]) {
    assert.equal(canAccessControlledDocument(d, context(account)), false);
  }
});

test('executive content is Owner-only and requires an active Super Admin assignment and verified MFA', () => {
  const executive = doc('EXECUTIVE_CONFIDENTIAL');
  assert.equal(canAccessControlledDocument(executive, context(me(1), [assignment(1, 'super_admin')], { privilegedVerified: true })), true);
  assert.equal(canAccessControlledDocument(executive, context(me(1), [assignment(1, 'super_admin')])), false);
  assert.equal(canAccessControlledDocument(executive, context(me(1), [], { privilegedVerified: true })), false);
  assert.equal(canAccessControlledDocument(executive, context(me(2), [assignment(2, 'super_admin')], { privilegedVerified: true })), false);
  assert.equal(canAccessControlledDocument(executive, context(me(1), [assignment(1, 'country_admin')], { privilegedVerified: true })), false);
});

test('current effective rank, country, assignment ownership, dates and status constrain Admin guides', () => {
  const d = doc('COUNTRY_ADMIN');
  assert.equal(canAccessControlledDocument(d, context(me(), [assignment(2, 'country_admin')])), true);
  const denied = [assignment(2, 'territory_admin'), assignment(2, 'specialist'), assignment(2, 'country_admin', { status: 'revoked' }),
    assignment(2, 'country_admin', { effective_until: new Date(at - 1).toISOString() }),
    assignment(2, 'country_admin', { effective_from: new Date(at + 1000).toISOString() }),
    assignment(2, 'country_admin', { country_code: 'IE' }), assignment(2, 'country_admin', { country_code: 'GLB' }), assignment(3, 'country_admin')];
  for (const a of denied) assert.equal(canAccessControlledDocument(d, context(me(), [a])), false);
  assert.equal(canAccessControlledDocument(doc('SUPER_ADMIN'), context(me(), [assignment(2, 'specialist', { admin_role: 'super_admin' })])), false);
  assert.equal(canAccessControlledDocument(doc('TERRITORY_ADMIN'), context(me(), [assignment(2, 'specialist')])), false);
});

test('function-specific operating guidance follows exact granted permissions and rejects unknown function labels', () => {
  const d = doc('OPERATIONS_PRIVATE', { applicable_functions: ['Support Agent'] });
  const support = assignment(2, 'specialist', { permissions: ['support.manage'] });
  assert.equal(canAccessControlledDocument(d, context(me(), [support])), true);
  assert.equal(canAccessControlledDocument(d, context(me(), [assignment(2, 'specialist', { permissions: ['members.view'] })])), false);
  assert.equal(canAccessControlledDocument({ ...d, applicable_functions: ['Fake support super power'] }, context(me(), [support])), false);
  assert.equal(canAccessControlledDocument(doc('UNKNOWN'), context(me(1), [assignment(1, 'super_admin')], { privilegedVerified: true })), false);
  for (const extra of [{ country_code: 'IE' }, { territory_id: 7 }, { territory_scope: 'specific' }]) {
    assert.equal(canAccessControlledDocument({ ...d, ...extra }, context(me(), [support])), false);
  }
});

test('metadata parser fails closed on ambiguous, unclassified or missing controls and supports CRLF', () => {
  assert.equal(parseControlledMarkdown(frontmatter()).meta.document_id, 'BL-30-PH-PLAY-002');
  assert.equal(parseControlledMarkdown(frontmatter().replaceAll('\n', '\r\n')).meta.status, 'DRAFT');
  for (const input of ['# public text', frontmatter('access_class: MEMBER\n'), frontmatter().replace('access_class: PROFILE_PRIVATE', 'access_class: INTERNAL'),
    frontmatter().replace('country_code: PH\n', ''), frontmatter().replace('applicable_profiles: [merchant]', 'applicable_profiles:\n  - merchant'), frontmatter('territory_id: 4\n')]) {
    assert.equal(parseControlledMarkdown(input), null);
  }
  const template = parseControlledMarkdown('---\ntemplate_id: BL-120-PH-FORM-004\ntitle: Checklist\nversion: 1.0\nstatus: DRAFT\naccess_class: PROFILE_PRIVATE\n---\n\n# Checklist');
  assert.equal(template.meta.country_code, 'PH'); assert.equal(template.meta.territory_scope, 'country');
});

test('catalog loads canonical docs without leaking paths or content in metadata, and resolves only authorized internal links', () => {
  const docs = loadControlledDocuments();
  for (const category of ['My role', 'SOPs', 'Compliance', 'Forms', 'Training', 'Agreements', 'Management']) assert.ok(docs.some(d => d.category === category));
  const merchant = docs.find(d => d.relative_path === 'docs/roles/PLAYBOOK_MERCHANT.md'); assert.ok(merchant);
  const metadata = documentMetadata(merchant);
  assert.equal(metadata.version, '1.0'); assert.equal(metadata.status, 'DRAFT');
  for (const field of ['markdown', 'relative_path', 'absolutePath']) assert.equal(Object.hasOwn(metadata, field), false);
  const source = { ...merchant, markdown: '[Merchant](PLAYBOOK_MERCHANT.md) [Executive](JD_EXECUTIVE.md) [Secret](../../.env)' };
  const links = authorizedDocumentLinks(source, [merchant]);
  assert.equal(links['PLAYBOOK_MERCHANT.md'], merchant.id);
  assert.equal(Object.hasOwn(links, 'JD_EXECUTIVE.md'), false);
  assert.equal(Object.hasOwn(links, '../../.env'), false);
});

test('catalog skips symlink escapes and rejects duplicate IDs instead of serving an ambiguous document', () => {
  const temp = mkdtempSync(join(tmpdir(), 'knowledge-catalog-'));
  try {
    mkdirSync(join(temp, 'docs/roles'), { recursive: true }); mkdirSync(join(temp, 'outside'));
    writeFileSync(join(temp, 'outside', 'secret.md'), frontmatter());
    symlinkSync(join(temp, 'outside', 'secret.md'), join(temp, 'docs/roles', 'link.md'));
    assert.equal(loadControlledDocuments(temp).length, 0);
    writeFileSync(join(temp, 'docs/roles', 'one.md'), frontmatter());
    writeFileSync(join(temp, 'docs/roles', 'two.md'), frontmatter());
    assert.throws(() => loadControlledDocuments(temp), /Duplicate controlled/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('Markdown link policy denies script/data/file/credential URLs and preserves approved internal IDs', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', '//evil.example/x', 'https://name:pass@example.com', 'https://good.example\nevil', '/api/admin', '../roles/JD_EXECUTIVE.md', 'https:\\evil.example']) assert.equal(safeMarkdownLink(url), null);
  assert.equal(safeMarkdownLink('https://example.com/guide'), 'https://example.com/guide');
  assert.equal(safeMarkdownLink('/help/article/start'), '/help/article/start');
  assert.equal(safeMarkdownLink('guide.md', { 'guide.md': 'BL-30-PH-PLAY-002' }), '/knowledge?document=BL-30-PH-PLAY-002');
});

async function fixture(t, { account = me(2, ['merchant'], [{ id: 10, active: true, country_code: 'PH' }]),
  assignments = [], data = [doc(), doc('EXECUTIVE_CONFIDENTIAL', { id: 'BL-30-GLB-JD-001', title: 'Executive secret' })],
  mfa = false, revoked = false, factor = true, auditFailure = false } = {}) {
  const state = { account, assignments, mfa, revoked, factor, auditFailure, audits: [] };
  const pool = { async query(sql, params) {
    if (sql.includes('FROM platform_admin_assignments a')) return { rows: state.assignments };
    if (sql.includes('SELECT 1 FROM super_admin_mfa_factors')) return { rowCount: state.factor ? 1 : 0, rows: [] };
    if (sql.includes('SELECT account_id FROM account_sessions')) return { rowCount: state.revoked ? 0 : 1, rows: [{ account_id: state.account.account.id }] };
    if (sql.includes('SELECT mfa_verified_at,mfa_method')) return { rowCount: 1, rows: [{ mfa_verified_at: typeof state.mfa === 'string' ? state.mfa : state.mfa ? new Date(at - 1000) : null, mfa_method: 'totp' }] };
    if (sql.includes('INSERT INTO admin_audit_events')) { if (state.auditFailure) throw new Error('private-db-connection'); state.audits.push(params); return { rowCount: 1 }; }
    throw new Error('Unexpected fixture query');
  } };
  const app = express();
  registerKnowledgeRoutes(app, { pool, tokenSecret: 'knowledge-test-secret-material', mfaKeyReady: true,
    identity: async req => { if (!req.headers.authorization) throw Object.assign(new Error('Unauthorized'), { status: 401 }); return state.account; },
    loadDocuments: () => data });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = 'http://127.0.0.1:' + server.address().port;
  const token = signV2SessionToken('knowledge-test-secret-material', account.account.id, 'knowledge-session');
  return { state, async get(path, auth = true) { return fetch(base + path, { headers: auth ? { Authorization: 'Bearer ' + (typeof auth === 'string' ? auth : token) } : {} }); } };
}

test('HTTP anonymous APIs reveal neither private metadata nor documents, generic page contains no private data', async t => {
  const f = await fixture(t);
  for (const path of ['/api/knowledge/catalog', '/api/knowledge/documents/BL-30-PH-PLAY-002']) {
    const r = await f.get(path, false); assert.equal(r.status, 401); assert.match(r.headers.get('cache-control'), /no-store/);
    assert.doesNotMatch(await r.text(), /Merchant guide|Executive secret|Private guidance/);
  }
  const page = await f.get('/knowledge', false); assert.equal(page.status, 200); assert.doesNotMatch(await page.text(), /Executive secret|Private guidance/);
  assert.equal(f.state.audits.length, 0);
});

test('HTTP catalog and direct IDs share authorization; revoking a profile immediately denies the next read', async t => {
  const f = await fixture(t), r = await f.get('/api/knowledge/catalog'), payload = await r.json();
  assert.equal(payload.documents.length, 1); assert.equal(payload.documents[0].id, doc().id);
  assert.equal(Object.hasOwn(payload.documents[0], 'markdown'), false);
  const read = await f.get('/api/knowledge/documents/' + doc().id); assert.equal(read.status, 200);
  assert.match((await read.json()).markdown, /Private guidance/); assert.equal(f.state.audits.length, 1);
  f.state.account.profiles[0].enabled = false;
  assert.equal((await f.get('/api/knowledge/documents/' + doc().id)).status, 404);
  const executive = await f.get('/api/knowledge/documents/BL-30-GLB-JD-001'); assert.equal(executive.status, 404);
  assert.doesNotMatch(await executive.text(), /Executive secret/);
  for (const id of ['..%2F..%2F.env', '%2Fetc%2Fpasswd', 'README.md', 'not-an-id']) assert.equal((await f.get('/api/knowledge/documents/' + id)).status, 404);
});

test('HTTP privileged docs require signed live session MFA and factor; revocation and factor reset cannot expose them', async t => {
  const f = await fixture(t, { account: me(1), assignments: [assignment(1, 'super_admin')], mfa: false });
  let r = await f.get('/api/knowledge/catalog'), payload = await r.json();
  assert.equal(payload.access.admin_locked, true); assert.equal(payload.documents.length, 0);
  assert.equal((await f.get('/api/knowledge/documents/BL-30-GLB-JD-001')).status, 404);
  f.state.mfa = true;
  r = await f.get('/api/knowledge/documents/BL-30-GLB-JD-001'); assert.equal(r.status, 200);
  assert.equal((await f.get('/api/knowledge/documents/BL-30-GLB-JD-001', 'v2.invalid-signature')).status, 404);
  f.state.mfa = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString();
  assert.equal((await f.get('/api/knowledge/documents/BL-30-GLB-JD-001')).status, 404);
  f.state.mfa = true;
  for (const change of ['revoked', 'factor']) {
    f.state.revoked = change === 'revoked'; f.state.factor = change !== 'factor';
    assert.equal((await f.get('/api/knowledge/documents/BL-30-GLB-JD-001')).status, 404);
  }
  f.state.factor = true; f.state.revoked = false; f.state.assignments = [];
  assert.equal((await f.get('/api/knowledge/documents/BL-30-GLB-JD-001')).status, 404);
});

test('HTTP audit failure withholds private content and emits no database detail', async t => {
  const f = await fixture(t, { auditFailure: true });
  const r = await f.get('/api/knowledge/documents/' + doc().id); assert.equal(r.status, 503);
  assert.doesNotMatch(await r.text(), /private-db-connection|Private guidance|Merchant guide/);
  assert.match(r.headers.get('vary'), /Cookie/);
});
