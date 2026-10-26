import test from 'node:test';
import assert from 'node:assert/strict';
import { loadControlledDocuments, documentMetadata } from '../documentation-catalog.js';
import { qaAcceptanceConfig } from '../qa-acceptance.js';
import { KNOWLEDGE_CENTER_WAVE, runKnowledgeCenterAcceptance } from '../qa-knowledge-acceptance.js';

const safe = { RAILWAY_SERVICE_NAME: 'accounting-preview', APP_ENV: 'qa',
  DATABASE_URL: 'postgresql://test:test@localhost/accounting_qa', TOKEN_SECRET: 'x'.repeat(48),
  QA_AUTOMATION_SECRET: 'q'.repeat(48), PAYMONGO_LIVE_ENABLED: 'false', PAYMONGO_MODE: 'test',
  RAILWAY_GIT_COMMIT_SHA: 'd'.repeat(40) };
const roles = ['customer', 'merchant', 'supplier', 'courier', 'service_provider', 'territory_admin', 'super_admin'];
const source = loadControlledDocuments();

function fixture({ missingAudit = false, crossProfileLeak = false, metadataLeak = false,
  actualDatabase = 'accounting_qa', unverified = false, logoutFailure = false } = {}) {
  const counts = new Map(), loggedIn = [], loggedOut = [];
  const roleId = role => 100 + roles.indexOf(role);
  const businessRole = role => ['merchant', 'supplier'].includes(role);
  const allowed = (doc, role) => doc.access_class === 'MEMBER'
    || (doc.access_class === 'PROFILE_PRIVATE' && (!doc.applicable_profiles.length || doc.applicable_profiles.includes(role)))
    || (doc.access_class === 'BUSINESS_PRIVATE' && businessRole(role)
      && (!doc.applicable_profiles.length || doc.applicable_profiles.includes(role)))
    || (doc.access_class === 'TERRITORY_ADMIN' && role === 'territory_admin');
  const response = (status, json) => ({ status, json, headers: new Headers({
    'cache-control': 'private, no-store', vary: 'Cookie, Authorization' }) });
  const pool = { async query(sql, values) {
    if (sql.startsWith('SELECT current_database()')) return { rows: [{ name: actualDatabase }] };
    if (sql.startsWith('SELECT account_mode')) return { rows: [{ account_mode: 'company_test',
      test_role: values[0].split('@')[0], email_verified_at: unverified ? null : '2026-01-01' }] };
    assert.match(sql, /SELECT COUNT\(\*\).*admin_audit_events/s);
    return { rows: [{ count: counts.get(values[0] + ':' + values[1]) || 0 }] };
  } };
  const helpers = {
    async qaAccountSession({ role }) { loggedIn.push(role); return { accountId: roleId(role), token: 'fixture:' + role }; },
    expectStatus(result, status, label) { assert.equal(result.status, status, label + ' unexpected status'); },
    async requestJson(_base, path, { token = '', method = 'GET' } = {}) {
      const role = token.replace('fixture:', '');
      if (path === '/api/auth/logout') { assert.equal(method, 'POST'); loggedOut.push(role);
        if (logoutFailure && role === 'customer') throw new Error('Controlled logout failure');
        return response(200, {}); }
      if (path === '/api/me') return response(200, {
        account: { id: roleId(role), account_mode: 'company_test', test_role: role },
        profiles: roles.indexOf(role) < 5 ? [{ role, enabled: true, status: 'active' }] : [],
        businesses: businessRole(role) ? [{ active: true, country_code: 'PH' }] : []
      });
      if (!token) return response(401, { error: 'Sign in to open Knowledge' });
      if (path === '/api/knowledge/catalog') {
        const documents = source.filter(d => allowed(d, role)).map(documentMetadata);
        if (metadataLeak) documents[0].markdown = 'Unexpected private catalog body';
        return response(200, { documents, access: { business_guidance: businessRole(role), admin_locked: role === 'super_admin' } });
      }
      const id = decodeURIComponent(path.split('/').at(-1));
      const doc = source.find(d => d.id === id);
      const leaked = crossProfileLeak && doc?.document_type === 'profile_playbook';
      if (!doc || (!allowed(doc, role) && !leaked)) return response(404, { error: 'Document unavailable for this account.' });
      const key = roleId(role) + ':' + id;
      if (!missingAudit) counts.set(key, (counts.get(key) || 0) + 1);
      return response(200, { ...documentMetadata(doc), markdown: doc.markdown });
    }
  };
  return { args: { pool, helpers, base: 'http://127.0.0.1:3000', secret: safe.QA_AUTOMATION_SECRET,
    aliases: Object.fromEntries(roles.map(role => [role, role + '@example.test'])), env: safe }, loggedIn, loggedOut };
}

test('Knowledge Preview wave uses the canonical QA environment gate', () => {
  assert.equal(qaAcceptanceConfig({ ...safe, QA_ACCEPTANCE_WAVE: KNOWLEDGE_CENTER_WAVE }).wave, 'knowledge_center_v1');
  for (const changed of [{ RAILWAY_SERVICE_NAME: 'accounting-business-life', APP_ENV: 'production' },
    { DATABASE_URL: 'postgresql://test:test@localhost/accounting_live' }, { PAYMONGO_LIVE_ENABLED: 'true' }]) {
    assert.throws(() => qaAcceptanceConfig({ ...safe, ...changed, QA_ACCEPTANCE_WAVE: KNOWLEDGE_CENTER_WAVE }));
  }
});

test('Knowledge Preview acceptance reads five profiles and cleans all seven sessions', async () => {
  const f = fixture(), result = await runKnowledgeCenterAcceptance(f.args);
  assert.equal(result.status, 'PASS'); assert.deepEqual(result.profiles, roles.slice(0, 5));
  assert.equal(result.qa_revision, 'd'.repeat(12));
  assert.equal(result.delegated_read, true); assert.equal(result.super_admin_requires_mfa, true);
  assert.deepEqual(f.loggedIn, roles); assert.deepEqual(f.loggedOut, roles);
  assert.doesNotMatch(JSON.stringify(result), /fixture:|@example|password|markdown/);
});

test('Knowledge Preview acceptance rejects a missing fresh audit even if the read succeeds', async () => {
  const f = fixture({ missingAudit: true });
  await assert.rejects(runKnowledgeCenterAcceptance(f.args), /new sanitized audit/);
  assert.deepEqual(f.loggedOut, ['customer']);
});

test('Knowledge Preview acceptance rejects cross-profile and catalog-content leaks', async () => {
  for (const fault of [{ crossProfileLeak: true }, { metadataLeak: true }]) {
    const f = fixture(fault);
    await assert.rejects(runKnowledgeCenterAcceptance(f.args));
    assert.deepEqual(f.loggedOut, ['customer']);
  }
});

test('Knowledge Preview acceptance avoids verification email and attempts all cleanup after one logout fails', async () => {
  const unverified = fixture({ unverified: true });
  await assert.rejects(runKnowledgeCenterAcceptance(unverified.args), /already verified test identity/);
  assert.deepEqual(unverified.loggedIn, []);
  const failedLogout = fixture({ logoutFailure: true });
  await assert.rejects(runKnowledgeCenterAcceptance(failedLogout.args), /session cleanup failed/);
  assert.deepEqual(failedLogout.loggedOut, roles);
});

test('Knowledge Preview acceptance refuses production, foreign targets, wrong databases and Owner fixtures before reading', async () => {
  for (const override of [
    { env: { ...safe, RAILWAY_SERVICE_NAME: 'accounting-business-life', APP_ENV: 'production' } },
    { base: 'https://caliof.com' }, { base: 'http://example.test' }
  ]) {
    const f = fixture(); await assert.rejects(runKnowledgeCenterAcceptance({ ...f.args, ...override }));
    assert.deepEqual(f.loggedIn, []);
  }
  const wrongDatabase = fixture({ actualDatabase: 'accounting_live' });
  await assert.rejects(runKnowledgeCenterAcceptance(wrongDatabase.args), /database must match/);
  assert.deepEqual(wrongDatabase.loggedIn, []);
  const owner = fixture();
  owner.args.helpers.qaAccountSession = async () => ({ accountId: 1, token: 'fixture:customer' });
  await assert.rejects(runKnowledgeCenterAcceptance(owner.args), /never use the Owner/);
  assert.deepEqual(owner.loggedOut, ['customer']);
});
