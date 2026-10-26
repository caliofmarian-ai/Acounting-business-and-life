import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAdminAssignments } from './admin-authorization.js';
import { resolveV2SessionMfa } from './auth-session-core.js';
import { sessionCredentialFromHeaders } from './session-cookie-core.js';
import { documentationAccessContext, canAccessControlledDocument, documentationAccessSummary } from './documentation-access.js';
import { DOCUMENT_ID, loadControlledDocuments, documentMetadata, authorizedDocumentLinks } from './documentation-catalog.js';

const ROOT = dirname(fileURLToPath(import.meta.url));

export async function knowledgeRequestContext({ pool, identity, req, tokenSecret, mfaKeyReady }) {
  const me = await identity(req); // Canonical session, account-state and verification policy.
  if (!me?.account?.id) throw Object.assign(new Error('Sign in to open Knowledge'), { status: 401 });
  const assignments = await getAdminAssignments(pool, Number(me.account.id));
  let context = documentationAccessContext(me, assignments);
  if (!context.authenticated) throw Object.assign(new Error('Account unavailable'), { status: 403 });
  if (context.adminLocked && mfaKeyReady) {
    const raw = req.ablSessionToken || sessionCredentialFromHeaders(req.headers || {}).token;
    const [session, factor] = await Promise.all([
      resolveV2SessionMfa(pool, tokenSecret, raw),
      pool.query("SELECT 1 FROM super_admin_mfa_factors WHERE account_id=$1 AND status='active'", [context.accountId])
    ]);
    context = documentationAccessContext(me, assignments, {
      privilegedVerified: Boolean(session?.mfaValid && Number(session.accountId) === context.accountId && factor.rowCount)
    });
  }
  return context;
}

export function registerKnowledgeRoutes(app, { pool, identity,
  tokenSecret = process.env.TOKEN_SECRET || '',
  mfaKeyReady = String(process.env.SUPER_ADMIN_MFA_ENCRYPTION_KEY || process.env.TOKEN_SECRET || '').length >= 16,
  loadDocuments = loadControlledDocuments } = {}) {
  let documents;
  const catalog = () => documents || (documents = loadDocuments());
  const privateHeaders = res => res.set({ 'Cache-Control': 'private, no-store',
    'Vary': 'Cookie, Authorization', 'X-Content-Type-Options': 'nosniff' });
  const page = (_req, res) => {
    privateHeaders(res).type('html').send(readFileSync(join(ROOT, 'public', 'knowledge', 'index.html'), 'utf8'));
  };
  app.get('/knowledge', page);
  app.get('/knowledge/', page);
  for (const [path, type] of [['knowledge.css', 'text/css'], ['knowledge.js', 'application/javascript'], ['markdown.js', 'application/javascript']]) {
    app.get('/knowledge/' + path, (_req, res) => res.type(type).send(readFileSync(join(ROOT, 'public', 'knowledge', path), 'utf8')));
  }
  app.use('/api/knowledge', async (req, res, next) => {
    privateHeaders(res);
    try {
      req.knowledgeContext = await knowledgeRequestContext({ pool, identity, req, tokenSecret, mfaKeyReady });
      next();
    } catch (error) {
      res.status(error.status || 503).json({ error: error.status ? error.message : 'Knowledge is temporarily unavailable. Try again.' });
    }
  });
  app.get('/api/knowledge/catalog', (req, res) => {
    try {
      const allowed = catalog().filter(d => canAccessControlledDocument(d, req.knowledgeContext));
      res.json({ access: documentationAccessSummary(req.knowledgeContext, allowed), documents: allowed.map(documentMetadata) });
    } catch { res.status(503).json({ error: 'Knowledge is temporarily unavailable. Try again.' }); }
  });
  app.get('/api/knowledge/documents/:id', async (req, res) => {
    try {
      const id = req.params.id;
      const doc = DOCUMENT_ID.test(id) ? catalog().find(d => d.id === id) : null;
      if (!doc || !canAccessControlledDocument(doc, req.knowledgeContext)) return res.status(404).json({ error: 'Document unavailable for this account.' });
      // Audit before releasing private content; do not swallow audit failures.
      await pool.query(`INSERT INTO admin_audit_events(actor_account_id,country_code,target_type,target_id,event_code,after_json)
        VALUES($1,'PH','controlled_document',$2,'knowledge_document_read',$3::jsonb)`,
      [req.knowledgeContext.accountId, doc.id, JSON.stringify({ version: doc.version, access_class: doc.access_class })]);
      const allowed = catalog().filter(d => canAccessControlledDocument(d, req.knowledgeContext));
      res.json({ ...documentMetadata(doc), markdown: doc.markdown, links: authorizedDocumentLinks(doc, allowed) });
    } catch { res.status(503).json({ error: 'Document could not be opened. Try again.' }); }
  });
  app.use('/api/knowledge', (_req, res) => res.status(404).json({ error: 'Knowledge endpoint unavailable.' }));
}
