import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const onboarding=read('public/guided-onboarding.js');
const marketplace=read('public/marketplace-ui.js');
const shell=read('public/shell.js');
const merchant=read('public/v03.js');
const server=read('server-marketplace.js');

function between(source,start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a+1);
  return a<0?'':source.slice(a,b>a?b:undefined);
}

test('Getting Started no longer floats over Merchant navigation and remains in Settings',()=>{
  const launcher=between(onboarding,'function syncLauncher','function overlayShell');
  assert.match(launcher,/classList\.add\('hidden'\)/);
  assert.match(launcher,/aria-hidden/);
  assert.match(launcher,/tabIndex=-1/);
  assert.doesNotMatch(launcher,/classList\.remove\('hidden'\)/);
  assert.match(onboarding,/guidedOnboardingSettingsCard/);
  assert.match(onboarding,/Getting started tutorial/);
});

test('Catalog and Storefront are separate Merchant destinations',()=>{
  assert.match(shell,/id="catalogQuickButton"/);
  assert.match(shell,/id="marketQuickButton"/);
  assert.match(shell,/data-merchant-mobile-action="catalogQuickButton"/);
  assert.match(shell,/data-merchant-mobile-action="marketQuickButton"/);
  assert.match(shell,/openMerchantCatalog/);
  assert.match(shell,/openMerchantStore/);
  assert.match(merchant,/BusinessLifeMarketplace\?\.openMerchantCatalog/);
});

test('Storefront render contains store settings but not Catalog creation or import',()=>{
  const block=between(marketplace,'async function renderMerchantStore()','async function renderMerchantCatalog()');
  assert.match(block,/Public shop settings only/);
  assert.match(block,/storeForm\(merchantStore\)/);
  assert.doesNotMatch(block,/catalogCreateSection/);
  assert.doesNotMatch(block,/preparedImportSection/);
  assert.doesNotMatch(block,/catalogSection\(/);
  assert.match(block,/Products are managed in Catalog/);
});

test('Catalog render owns direct product creation prepared imports publication and images',()=>{
  const block=between(marketplace,'async function renderMerchantCatalog()','function readinessLabel');
  assert.match(block,/mapi\('\/api\/inventory'\)/);
  assert.match(block,/catalogCreateSection\(inventory\|\|\[\]\)/);
  assert.match(block,/preparedImportSection\(\)/);
  assert.match(block,/catalogSection\(store\.products\|\|\[\]\)/);
  assert.match(marketplace,/id="merchantCatalogCreateForm"/);
  assert.match(marketplace,/Import prepared products/);
  assert.match(marketplace,/Create private product/);
});

test('Catalog can create direct resale products linked to Inventory without changing stock',()=>{
  const create=between(marketplace,'function bindCatalogCreate','function bindStoreForm');
  assert.match(create,/\/api\/merchant\/storefront\/products/);
  assert.match(create,/inventory_id:inventoryId/);
  assert.match(create,/selling_price:Number/);
  assert.match(create,/quantity_per_unit:Number/);
  assert.match(create,/published:false/);

  const endpoint=between(server,"app.post('/api/merchant/storefront/products'","app.patch('/api/merchant/storefront/products/:id'");
  for(const kind of ['fresh_direct','packaged_resale','non_food_resale'])assert.match(endpoint,new RegExp(kind));
  assert.match(endpoint,/Choose the stock item this product sells from/);
  assert.match(endpoint,/inventory_id,name,description,category/);
  assert.doesNotMatch(endpoint,/UPDATE inventory SET/);
  assert.doesNotMatch(endpoint,/INSERT INTO inventory_purchases/);
});

test('Catalog archive hides accidental products without deleting history',()=>{
  const bind=between(marketplace,'function bindCatalog()','function showPlatformStore');
  assert.match(bind,/data-archive-product/);
  assert.match(bind,/active:false,published:false/);
  assert.match(bind,/data-restore-product/);
  assert.match(bind,/active:true,published:false/);
  assert.match(marketplace,/Archived products/);
});

test('Marketplace global surface exports both Merchant destinations',()=>{
  assert.match(marketplace,/BusinessLifeMarketplace=Object\.freeze\(\{openMerchantStore,openMerchantCatalog/);
  assert.match(marketplace,/abl:marketplace-merchant-surface/);
});
