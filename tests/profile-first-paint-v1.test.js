import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const shell=read('public/shell.js');
const shellCss=read('public/shell.css');
const accounting=read('public/business-accounting-ui.js');
const supplier=read('public/suppliers-ui.js');
const merchant=read('public/v03.js');

function between(source,startNeedle,endNeedle){
  const start=source.indexOf(startNeedle);
  const end=source.indexOf(endNeedle,start+1);
  return start<0?'':source.slice(start,end>start?end:undefined);
}

test('Supplier Finance & Accounting is part of first-paint shell composition',()=>{
  const hubs=between(shell,'const HUBS = {','const CUSTOMER_HOME_CACHE_MS');
  assert.match(hubs,/supplier:\s*\[[\s\S]*Finance & Accounting/);
  assert.match(hubs,/PO income, actual receipts, receivables, costs, budgets and payout status/);
  const roleHub=between(shell,'function renderRoleHub','function renderAccountHome');
  assert.match(roleHub,/data-business-accounting-tile="true"/);
  assert.match(roleHub,/businessAccountingTile/);
  assert.match(roleHub,/BusinessLifeAccounting\?\.openSupplierAccounting/);
});

test('Accounting module hydrates the Supplier Finance card and never creates or prepends it',()=>{
  const wire=between(accounting,'function wireSupplierAccountingTile','async function openSupplierAccounting');
  assert.match(wire,/querySelector\('#roleHub \[data-business-accounting-tile\]'\)/);
  assert.match(wire,/tile\.onclick=openSupplierAccounting/);
  assert.doesNotMatch(wire,/createElement|prepend|appendChild|insertAdjacent/);
  assert.doesNotMatch(accounting,/function mountSupplierAccountingTile/);
  assert.doesNotMatch(accounting,/grid\.prepend\(tile\)/);
});

test('Merchant and Supplier reserve business context geometry before async workspace hydration',()=>{
  assert.match(shell,/function syncBusinessWorkspacePlaceholder\(\)/);
  assert.match(shell,/businessWorkspaceBarPending/);
  assert.match(shell,/Preparing workspace…/);
  assert.match(shell,/\['merchant','supplier'\]\.includes\(role\)/);
  assert.match(shell,/syncBusinessWorkspacePlaceholder\(\)/);
  assert.match(accounting,/bar\.className='businessWorkspaceBar'/);
  assert.match(accounting,/bar\.removeAttribute\('aria-busy'\)/);
  assert.match(shellCss,/\.businessWorkspaceBar\{/);
  assert.match(shellCss,/min-height:58px/);
  assert.match(shellCss,/\.businessAccountingTile\{/);
});

test('Customer Courier and Local Services reserve structure and hydrate parallel data, not late primary cards',()=>{
  const customer=between(shell,'async function loadCustomerHomeData','function customerHomeActivities');
  assert.match(customer,/Promise\.allSettled\(\[/);
  for(const path of ['/api/orders/mine?view=home','/api/delivery/mine?view=home','/api/services/jobs/mine?view=home','/api/profile-money/customer?view=home']){
    assert.ok(customer.includes(path),path+' must remain parallel');
  }

  const courier=between(shell,'async function loadCourierHomeData','function courierHomeCurrentWork');
  assert.match(courier,/Promise\.allSettled\(\[/);
  assert.match(courier,/\/api\/courier\/home/);
  assert.match(courier,/\/api\/profile-money\/courier\?view=home/);

  const services=between(shell,'async function loadServiceProviderHomeData','function serviceProviderHomeReadiness');
  assert.match(services,/Promise\.allSettled\(\[/);
  assert.match(services,/\/api\/service-provider\/me/);
  assert.match(services,/\/api\/services\/jobs\/mine/);
  assert.match(services,/\/api\/profile-money\/service_provider/);
});

test('Merchant Today keeps one atomic critical response and reveals its card set together',()=>{
  const block=between(merchant,'function renderMerchantToday','window.BusinessLifeMerchantToday');
  assert.match(block,/todayContent'\)\.classList\.remove\('hidden'\)/);
  assert.match(block,/todayLoading'\)\.classList\.add\('hidden'\)/);
  const load=between(merchant,'async function loadMerchantToday','window.BusinessLifeMerchantToday');
  assert.match(load,/api\('\/api\/merchant\/today'\)/);
  assert.doesNotMatch(load,/Promise\.all/);
});

test('Supplier Today still uses one critical endpoint and replaces the workspace in one DOM commit',()=>{
  const block=between(supplier,'async function renderSupplierWorkspace','function poCardSupplier');
  assert.match(block,/todayState=await papi\('\/api\/supplier\/v5\/today'\)/);
  assert.match(block,/supWorkspace\.innerHTML=/);
  assert.equal((block.match(/supWorkspace\.innerHTML=/g)||[]).length,1);
});
