import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const loader=read('public/mobile-feature-loader.js');
const paymentsServer=read('server-payments.js');
const adminServer=read('server-admin-operations.js');
const legalServer=read('server-legal.js');
const incidentServer=read('server-incidents.js');
const governanceServer=read('server-profile-governance.js');
const accountingServer=read('server-business-accounting.js');
const governanceUi=read('public/profile-governance-ui.js');

test('optional feature modules are no longer injected into startup HTML',()=>{
  assert.doesNotMatch(adminServer,/src="\/admin-operations-ui\.js"/);
  assert.doesNotMatch(adminServer,/href="\/admin-operations\.css"/);
  assert.doesNotMatch(legalServer,/src="\/legal-ui\.js"/);
  assert.doesNotMatch(legalServer,/href="\/legal\.css"/);
  assert.doesNotMatch(incidentServer,/src="\/incidents-ui\.js"/);
  assert.doesNotMatch(incidentServer,/href="\/incidents\.css"/);
  assert.doesNotMatch(governanceServer,/src="\/profile-governance-ui\.js"/);
  assert.doesNotMatch(governanceServer,/href="\/profile-governance\.css"/);
  assert.doesNotMatch(accountingServer,/src="\/business-accounting-ui\.js"/);
  assert.doesNotMatch(accountingServer,/href="\/business-accounting\.css"/);
  assert.doesNotMatch(paymentsServer,/src="\/payments-ui\.js"/);
  assert.doesNotMatch(paymentsServer,/href="\/payments\.css"/);
});

test('one lightweight feature launcher is injected at startup',()=>{
  assert.match(paymentsServer,/href="\/mobile-feature-loader\.css"/);
  assert.match(paymentsServer,/src="\/mobile-feature-loader\.js"/);
});

test('feature launcher lazy-loads optional modules and their CSS',()=>{
  for(const js of [
    '/admin-operations-ui.js','/legal-ui.js','/payments-ui.js',
    '/incidents-ui.js','/profile-governance-ui.js','/business-accounting-ui.js'
  ]) assert.ok(loader.includes(js),`missing lazy JS spec ${js}`);
  for(const css of [
    '/admin-operations.css','/legal.css','/payments.css',
    '/incidents.css','/profile-governance.css','/business-accounting.css'
  ]) assert.ok(loader.includes(css),`missing lazy CSS spec ${css}`);
  assert.match(loader,/import\(spec\.js\)/);
  assert.match(loader,/featurePromises\.has\(name\)/);
});

test('mobile launcher preserves Help and More while Admin stays in the profile switcher',()=>{
  assert.match(loader,/lazySupportBtn/);
  assert.doesNotMatch(loader,/lazyAdminBtn/);
  assert.doesNotMatch(loader,/fetchAdminAccess/);
  assert.match(loader,/lazyMoreBtn/);
  assert.match(loader,/BusinessLifeAdminOps/);
  assert.match(loader,/Could not load this feature/);
});

test('governance can decorate a drawer that was already open before lazy import',()=>{
  assert.match(governanceUi,/await refreshGov\(\);decorateDrawer\(\)/);
  assert.match(loader,/abl:drawer-rendered/);
});

test('business accounting is loaded only for relevant active profiles',()=>{
  assert.match(loader,/\['merchant','supplier'\]\.includes/);
  assert.match(loader,/abl:profile-state/);
  assert.match(loader,/loadAccountingForRole/);
});
