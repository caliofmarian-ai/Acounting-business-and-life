import assert from 'node:assert/strict';
import { loadControlledDocuments } from './documentation-catalog.js';
import { validateRuntimeSafety } from './runtime-safety.js';

export const KNOWLEDGE_CENTER_WAVE = 'knowledge_center_v1';

// The shared harness installs/restores temporary credentials only for designated
// company-test identities. This wave changes no profile, membership or MFA state.
export async function runKnowledgeCenterAcceptance({ pool, base, secret, aliases, helpers, env = process.env }) {
  const runtime = validateRuntimeSafety(env);
  assert.ok(runtime.previewService && runtime.appEnvironment === 'qa'
    && /(?:^|_)(?:qa|test)$/.test(runtime.databaseName), 'Knowledge acceptance requires isolated Preview QA');
  const target = new URL(base);
  assert.equal(target.protocol, 'http:'); assert.equal(target.hostname, '127.0.0.1');
  const database = await pool.query('SELECT current_database() AS name');
  assert.equal(database.rows[0].name, runtime.databaseName, 'Knowledge acceptance database must match isolated QA');
  const { requestJson, expectStatus, qaAccountSession } = helpers;
  const source = loadControlledDocuments(), sessions = [], profiles = [];
  const executive = source.find(d => d.access_class === 'EXECUTIVE_CONFIDENTIAL');
  const business = source.find(d => d.access_class === 'BUSINESS_PRIVATE' && !d.applicable_profiles.length);
  const territory = source.find(d => d.access_class === 'TERRITORY_ADMIN' && d.document_type === 'job_description');
  const superAdmin = source.find(d => d.access_class === 'SUPER_ADMIN');
  assert.ok(executive && business && territory && superAdmin);
  function privateResponse(response) {
    assert.match(response.headers.get('cache-control') || '', /private.*no-store/);
    assert.match(response.headers.get('vary') || '', /Cookie/);
    assert.match(response.headers.get('vary') || '', /Authorization/);
  }
  async function get(path, token = '', status = 200) {
    const response = await requestJson(base, path, { token });
    expectStatus(response, status, 'Knowledge ' + path.split('?')[0]);
    privateResponse(response); return response.json;
  }
  async function login(role) {
    const fixture = await pool.query('SELECT id,account_mode,test_role,email_verified_at FROM accounts WHERE LOWER(email)=$1', [aliases[role]]);
    assert.equal(fixture.rows.length, 1, 'Knowledge QA requires a designated test identity');
    assert.equal(fixture.rows[0].account_mode, 'company_test');
    assert.equal(fixture.rows[0].test_role, role);
    assert.ok(fixture.rows[0].email_verified_at, 'Knowledge QA requires an already verified test identity');
    const session = await qaAccountSession({ pool, base, secret, email: aliases[role], role, label: 'Knowledge ' + role + ' QA' });
    sessions.push(session);
    // Isolated QA reserves ID 1 for its company-test Customer. Classify the
    // actual identity before installing credentials; numeric IDs are not roles.
    assert.equal(session.accountId, Number(fixture.rows[0].id), 'Knowledge QA session must match the verified test identity');
    const me = await requestJson(base, '/api/me', { token: session.token });
    expectStatus(me, 200, 'Knowledge test account snapshot');
    assert.equal(me.json.account.account_mode, 'company_test');
    assert.equal(me.json.account.test_role, role);
    assert.equal(Number(me.json.account.id), session.accountId);
    return { ...session, me: me.json };
  }
  async function read(session, doc) {
    const count = async () => Number((await pool.query(`SELECT COUNT(*)::int AS count FROM admin_audit_events
      WHERE actor_account_id=$1 AND target_id=$2 AND event_code='knowledge_document_read'
      AND after_json->>'version'=$3 AND after_json->>'access_class'=$4`,
    [session.accountId, doc.id, doc.version, doc.access_class])).rows[0].count);
    const before = await count();
    const result = await get('/api/knowledge/documents/' + doc.id, session.token);
    assert.equal(result.markdown, doc.markdown, 'Deployed document must match canonical controlled source');
    assert.equal(result.relative_path, undefined);
    assert.ok(await count() > before, 'Document read must persist a new sanitized audit event');
  }
  try {
    const anonymous = await get('/api/knowledge/catalog', '', 401);
    assert.equal(anonymous.documents, undefined); assert.equal(anonymous.markdown, undefined);
    await get('/api/knowledge/documents/' + executive.id, '', 401);
    for (const role of ['customer', 'merchant', 'supplier', 'courier', 'service_provider']) {
      const session = await login(role);
      const enabled = session.me.profiles.filter(p => p.enabled === true && p.status === 'active').map(p => p.role);
      assert.ok(enabled.includes(role), 'Knowledge QA needs the existing active ' + role + ' profile');
      const catalog = await get('/api/knowledge/catalog', session.token);
      const own = source.find(d => d.document_type === 'profile_playbook' && d.applicable_profiles.includes(role));
      assert.ok(own && catalog.documents.some(d => d.id === own.id), 'Own enabled profile guide must be listed');
      assert.equal(catalog.documents.some(d => d.access_class === 'EXECUTIVE_CONFIDENTIAL'), false);
      for (const item of catalog.documents) {
        assert.equal(item.markdown, undefined); assert.equal(item.relative_path, undefined);
      }
      await read(session, own);
      const denied = await get('/api/knowledge/documents/' + executive.id, session.token, 404);
      const unknown = await get('/api/knowledge/documents/BL-00-GLB-MISSING-999', session.token, 404);
      assert.deepEqual(denied, unknown, 'Private and unknown document IDs must be indistinguishable');
      await get('/api/knowledge/documents/%2e%2e%2fAGENTS.md', session.token, 404);
      for (const other of source.filter(d => d.document_type === 'profile_playbook'
        && !d.applicable_profiles.some(p => enabled.includes(p)))) {
        await get('/api/knowledge/documents/' + other.id, session.token, 404);
      }
      const businessAccess = enabled.some(p => ['merchant', 'supplier'].includes(p))
        && session.me.businesses.some(b => b.active === true && b.country_code === 'PH');
      assert.equal(catalog.access.business_guidance, businessAccess);
      if (businessAccess) await read(session, business);
      else await get('/api/knowledge/documents/' + business.id, session.token, 404);
      profiles.push(role);
    }
    const delegated = await login('territory_admin');
    await read(delegated, territory);
    await get('/api/knowledge/documents/' + executive.id, delegated.token, 404);
    const privileged = await login('super_admin');
    const locked = await get('/api/knowledge/catalog', privileged.token);
    assert.equal(locked.access.admin_locked, true, 'Password-only Super Admin session must remain locked');
    await get('/api/knowledge/documents/' + superAdmin.id, privileged.token, 404);
    await get('/api/knowledge/documents/' + executive.id, privileged.token, 404);
    return { status: 'PASS', wave: KNOWLEDGE_CENTER_WAVE,
      qa_revision: String(env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 12), profiles,
      anonymous_denied: true, cross_profile_denied: true, direct_id_traversal_denied: true,
      business_membership_enforced: true, canonical_content_and_audit_verified: true,
      delegated_read: true, executive_denied_to_test_sessions: true, super_admin_requires_mfa: true,
      profile_membership_mfa_state_unchanged: true };
  } finally {
    const cleanup = await Promise.allSettled(sessions.map(async session => {
      const logout = await requestJson(base, '/api/auth/logout', { method: 'POST', token: session.token, body: {} });
      expectStatus(logout, 200, 'Knowledge QA session cleanup');
    }));
    assert.ok(cleanup.every(result => result.status === 'fulfilled'), 'Knowledge QA session cleanup failed');
  }
}
