import { fileURLToPath } from 'node:url';
import {
  AccountAccessError, submitAccountAccess, isUnscopedSupportAssignment,
  listAccountAccess, readAccountAccess, triageAccountAccess
} from './account-access-core.js';

const assets = fileURLToPath(new URL('./public/account-access/', import.meta.url));
const publicPath = '/api/public/account-access';
const staffPath = '/api/admin/account-access';

export function accountAccessHeaders(_req, res, next) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  next();
}

export function accountAccessPublicOrigin(req, res, next) {
  const headers = req.headers || {};
  let allowed = headers['x-account-access-request'] === '1';
  const fetchSite = String(headers['sec-fetch-site'] || '');
  if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) allowed = false;
  if (headers.origin) {
    try {
      const origin = new URL(headers.origin);
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
      allowed = allowed && origin.origin === headers.origin && origin.host.toLowerCase() === String(headers.host || '').toLowerCase()
        && (origin.protocol === 'https:' || (local && origin.protocol === 'http:'));
    } catch { allowed = false; }
  }
  if (!allowed) return res.status(403).json({ error: 'Open the account-access form on this site and try again.', code: 'ACCOUNT_ACCESS_ORIGIN' });
  if (!/^application\/json(?:\s*;|$)/iu.test(String(headers['content-type'] || ''))) {
    return res.status(415).json({ error: 'This form accepts JSON text only. Attachments are not accepted.', code: 'ACCOUNT_ACCESS_CONTENT_TYPE' });
  }
  next();
}

export function accountAccessError(error, _req, res, _next) {
  if (res.headersSent) return;
  if (error instanceof AccountAccessError) {
    if (error.status === 429) res.setHeader('Retry-After', String(Math.max(1, Math.min(3600, error.retryAfter || 3600))));
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'The request is too large. Use a message of at most 2,000 characters, without attachments.', code: 'ACCOUNT_ACCESS_TOO_LARGE' });
  if (error?.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request could not be read. Check the form and try again.', code: 'ACCOUNT_ACCESS_INVALID' });
  if (error?.type === 'encoding.unsupported' || error?.type === 'charset.unsupported') return res.status(415).json({ error: 'Use uncompressed UTF-8 JSON text.', code: 'ACCOUNT_ACCESS_CONTENT_TYPE' });
  // Never send SQL errors, private form values, tokens or stack traces to clients/logs.
  return res.status(503).json({ error: 'The request could not be completed. Please try again later.', code: 'ACCOUNT_ACCESS_UNAVAILABLE' });
}

/** Mount BEFORE sessionSecurityMiddleware and any large/global body parser.
 *  This route has no authenticated authority; stale cookies and bearer tokens
 *  are ignored, never used to associate or recover an account. */
export function registerPublicAccountAccessRoutes(app, { pool, json, secret = () => process.env.TOKEN_SECRET || '' }) {
  const parse = json({ limit: '12kb', strict: true, inflate: false, type: 'application/json' });
  app.get('/help/account-access', accountAccessHeaders, (_req, res) => res.sendFile('index.html', { root: assets }));
  for (const name of ['public.js', 'staff.js', 'style.css']) {
    app.get(`/account-access-assets/${name}`, accountAccessHeaders, (_req, res) => res.sendFile(name, { root: assets }));
  }
  app.post(publicPath, accountAccessHeaders, accountAccessPublicOrigin, parse, async (req, res, next) => {
    try {
      // Do not trust visitor-supplied forwarding headers. Without an explicitly
      // verified proxy policy, a shared ingress conservatively shares this bucket.
      const result = await submitAccountAccess(pool, req.body, { secret: secret(), source: req.socket?.remoteAddress || 'unknown' });
      res.status(202).json(result);
    } catch (error) { next(error); }
  }, accountAccessError);
  app.all(publicPath, accountAccessHeaders, (_req, res) => {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Use the account-access form to send a request.', code: 'ACCOUNT_ACCESS_METHOD' });
  });
}

/** Mount AFTER sessionSecurityMiddleware, BEFORE the general body parser. */
export function registerStaffAccountAccessRoutes(app, { pool, json, identity, requireAdminPermission }) {
  const parse = json({ limit: '8kb', strict: true, inflate: false, type: 'application/json' });
  const authorize = async (req, res, next) => {
    try {
      const me = await identity(req);
      if (!me?.account?.id) return res.status(401).json({ error: 'Sign in to an authorized staff account.', code: 'ACCOUNT_ACCESS_AUTH_REQUIRED' });
      const assignment = await requireAdminPermission(pool, me.account.id, 'support.manage');
      if (!isUnscopedSupportAssignment(assignment)) return res.status(403).json({ error: 'Unscoped Philippines or platform support access is required.', code: 'ACCOUNT_ACCESS_FORBIDDEN' });
      req.accountAccessActor = { accountId: me.account.id, assignmentId: assignment.id };
      next();
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) return res.status(error.status).json({ error: 'Sign in with the required staff permission.', code: error.status === 401 ? 'ACCOUNT_ACCESS_AUTH_REQUIRED' : 'ACCOUNT_ACCESS_FORBIDDEN' });
      next(error);
    }
  };
  const run = work => async (req, res, next) => {
    try { res.json(await work(req)); } catch (error) { next(error); }
  };
  app.get('/admin/account-access', accountAccessHeaders, authorize, (_req, res) => res.sendFile('staff.html', { root: assets }), accountAccessError);
  app.get(staffPath, accountAccessHeaders, authorize, run(req => listAccountAccess(pool, req.accountAccessActor, { before: req.query.before, status: req.query.status || 'new' })), accountAccessError);
  app.get(`${staffPath}/:id`, accountAccessHeaders, authorize, run(req => readAccountAccess(pool, req.accountAccessActor, req.params.id)), accountAccessError);
  app.post(`${staffPath}/:id/triage`, accountAccessHeaders, authorize, parse, run(req => triageAccountAccess(pool, req.accountAccessActor, req.params.id, req.body)), accountAccessError);
}
