import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const loader=read('public/mobile-feature-loader.js');
const admin=read('public/admin-operations-ui.js');
const authServer=read('server-auth.js');
const promo=read('public/referral/promotion-center.html');
const help=read('public/help-linking.js');
const helpCss=read('public/help-linking.css');
const payments=read('public/payments-ui.js');

test('lazy Support keeps the Admin module API without injecting duplicate Admin buttons',()=>{
  assert.match(admin,/lazyFeatureMode=Boolean\(window\.__ABL_LAZY_FEATURES__\)/);
  assert.match(admin,/window\.BusinessLifeAdminOps=Object\.freeze\(\{openSupport,openAdmin,closeOps\}\)/);
  assert.match(admin,/if\(lazyFeatureMode\|\|!token\(\)\)return/);
  assert.match(loader,/window\.__ABL_LAZY_FEATURES__=true/);
  assert.match(loader,/window\.BusinessLifeAdminOps/);
  assert.doesNotMatch(loader,/lazyAdminBtn/);
  assert.doesNotMatch(admin,/adminOpsBtn/);
  assert.doesNotMatch(loader,/waitFor\('adminOpsBtn'/);
  assert.doesNotMatch(loader,/document\.getElementById\('adminOpsBtn'\).*click/);
});

test('referral public origin can never silently use localhost upstream host',()=>{
  assert.match(authServer,/REFERRAL_PUBLIC_ORIGIN/);
  assert.match(authServer,/RAILWAY_PUBLIC_DOMAIN/);
  assert.match(authServer,/x-forwarded-host/);
  assert.match(authServer,/Public referral origin is not configured/);
  assert.match(authServer,/127\.0\.0\.1/);
});

test('Promotion Center explains unavailable states instead of generic Unavailable',()=>{
  assert.doesNotMatch(promo,/codeNode\.textContent='Unavailable'/);
  assert.match(promo,/Profile not enabled/);
  assert.match(promo,/Sharing temporarily unavailable/);
  assert.match(promo,/Choose another enabled profile/);
});

test('voice support provides Android overlay fallback guidance',()=>{
  assert.match(admin,/screen-recording\/floating bubbles|screen-recording\/floating/);
  assert.match(admin,/type the message or attach audio/i);
  assert.match(admin,/window\.isSecureContext/);
});

test('Admin delegation does not offer an empty Territory Admin flow',()=>{
  assert.match(admin,/Create a territory first for Territory Admin/);
  assert.match(admin,/No territories created/);
  assert.match(admin,/Create and choose an operating territory before delegating Territory Admin/);
});

test('background payment failures do not leak raw upstream errors into unrelated UI',()=>{
  assert.match(help,/shouldSurface\(path\)/);
  assert.match(help,/path\.startsWith\('\/api\/payments\/'\)/);
  assert.match(help,/This feature is temporarily unavailable/);
  assert.match(helpCss,/@media\(max-width:640px\)\{\.contextHelpGlobal\{display:none\}/);
});

test('Payments loads independent context calls in parallel',()=>{
  assert.match(payments,/Promise\.all\(\[mePromise,adminPromise,configPromise,paymongoPromise\]\)/);
});
