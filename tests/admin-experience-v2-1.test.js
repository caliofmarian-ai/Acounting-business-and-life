import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=read('public/admin-console.html');
const admin=read('public/admin-console.js');
const notifications=read('public/notifications-ui.js');
const delivery=read('server-delivery.js');
const gateway=read('server-admin-operations.js');
const deliveryOps=read('tests/admin-delivery-operations.test.js');

for(const path of ['public/admin-console.js','public/notifications-ui.js','server-delivery.js','server-admin-operations.js']){
  test(path+' has valid JavaScript syntax',()=>{
    const result=spawnSync(process.execPath,['--check',fileURLToPath(new URL('../'+path,import.meta.url))],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr||result.stdout);
  });
}

test('Admin topbar reuses the existing notification center without adding a menu module',()=>{
  assert.match(html,/href="\/notifications\.css"/);
  assert.match(html,/class="topActions adminTopActions"/);
  assert.match(html,/src="\/notifications-ui\.js"/);
  assert.match(admin,/BusinessLifeAdminConsole/);
  assert.match(notifications,/BusinessLifeAdminConsole\?\.openSupportTicket/);
});

test('Courier verification uses a guided detail form instead of browser prompt',()=>{
  assert.match(admin,/Review eligibility/);
  assert.match(admin,/id="courierEligibilityForm"/);
  assert.match(admin,/Review every submitted Courier document before approving eligibility/);
  assert.match(admin,/data-courier-decision="review"/);
  assert.doesNotMatch(admin,/prompt\('Approved vehicle class/);
  assert.match(deliveryOps,/data-courier-decision/);
});

test('Courier evidence is fetched only from scoped Admin detail routes',()=>{
  assert.match(delivery,/app\.get\('\/api\/admin\/couriers\/:accountId'/);
  assert.match(delivery,/app\.get\('\/api\/admin\/couriers\/:accountId\/documents\/:documentId'/);
  assert.match(delivery,/Courier is outside your delegated territory/);
  assert.match(delivery,/evidence_data_url FROM courier_documents/);
  assert.match(gateway,/\/api\/admin\/couriers\/:accountId\/documents\/:documentId/);
  assert.match(admin,/data-courier-document-view/);
});

test('Courier approval can update document decisions through the existing audited mutation',()=>{
  assert.match(admin,/document_updates:updates\.filter/);
  assert.match(delivery,/Array\.isArray\(req\.body\?\.document_updates\)/);
  assert.match(delivery,/verification_status=\$1/);
});
