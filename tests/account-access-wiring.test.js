import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('canonical gateway mounts only guest intake before session checks and staff afterwards',()=>{
  const source=read('server-paymongo.js');
  const guest=source.indexOf('registerPublicAccountAccessRoutes(app,'),session=source.indexOf('app.use(sessionSecurityMiddleware);'),staff=source.indexOf('registerStaffAccountAccessRoutes(app,'),body=source.indexOf('app.use(body);');
  assert.ok(guest>0&&guest<session&&session<staff&&staff<body);
  assert.match(source,/await ensureAccountAccessSchema\(accountAccessPool\)/u);
  assert.match(source,/const accountAccessPool=new Pool\([^\n]+max:4,connectionTimeoutMillis:5000/u);
});
test('guest form never sends cookies or reads browser session storage',()=>{
  const js=read('public/account-access/public.js');assert.match(js,/credentials:'omit'/u);assert.doesNotMatch(js,/localStorage|sessionStorage|document\.cookie|Authorization/u);
  assert.match(js,/response\.status===202&&payload\?\.ok===true/u);
  assert.doesNotMatch(js,/innerHTML/u);
});
test('private queue preserves CSRF and renders evidence as text, without persistence',()=>{
  const js=read('public/account-access/staff.js');assert.match(js,/'X-CSRF-Token':csrf\(\)/u);assert.match(js,/credentials:'same-origin'/u);
  assert.doesNotMatch(js,/innerHTML|localStorage|sessionStorage/u);assert.match(js,/addEventListener\('pagehide',clearPrivate\)/u);
});
test('public form has explicit limits, labels, disabled no-script submit, English and Filipino',()=>{
  const html=read('public/account-access/index.html'),js=read('public/account-access/public.js');
  assert.match(html,/maxlength="2000"/u);assert.match(html,/maxlength="254"/u);assert.match(html,/type="submit" disabled/u);assert.match(html,/aria-live="polite"/u);assert.match(html,/<noscript>/u);
  assert.match(js,/'fil-PH'/u);assert.match(js,/'en-PH'/u);assert.doesNotMatch(html,/<input[^>]*type="file"/u);
});
