import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const inventoryUi=read('public/v03.js');
const marketUi=read('public/marketplace-ui.js');
const marketServer=read('server-marketplace.js');

test('empty unavailable-stock selection can never become Inventory ID 0',()=>{
  assert.match(inventoryUi,/function selectedPositiveInventoryId\(select\)/);
  assert.match(inventoryUi,/if\(!raw\)return null/);
  assert.match(inventoryUi,/Number\.isInteger\(id\)&&id>0\?id:null/);
  const loader=inventoryUi.slice(
    inventoryUi.indexOf('async function loadInventoryUnavailableAllocations'),
    inventoryUi.indexOf('function wireInventoryUnavailableUi')
  );
  assert.match(loader,/const inventoryId=selectedPositiveInventoryId\(select\)/);
  assert.match(loader,/if\(inventoryId==null\)/);
  assert.doesNotMatch(loader,/Number\(\$\('inventoryUnavailableItem'\)\?\.value\)/);
  const stockLoader=inventoryUi.slice(
    inventoryUi.indexOf('async function loadStock'),
    inventoryUi.indexOf('function lotExpiryCopy')
  );
  assert.match(stockLoader,/selectedPositiveInventoryId\(\$\('inventoryUnavailableItem'\)\)!=null/);
  assert.doesNotMatch(stockLoader,/Number\.isInteger\(Number\(\$\('inventoryUnavailableItem'/);
});

test('unavailable-stock contextual errors are cleared after selector recovery or successful load',()=>{
  const loader=inventoryUi.slice(
    inventoryUi.indexOf('async function loadInventoryUnavailableAllocations'),
    inventoryUi.indexOf('function wireInventoryUnavailableUi')
  );
  assert.match(loader,/invalid inventory item\|could not be loaded/i);
  assert.match(loader,/message\.textContent=''/);
});

test('Merchant Catalog has one canonical summary and labels Food and Retail projections separately',()=>{
  assert.match(marketServer,/app\.get\('\/api\/merchant\/catalog-v3\/summary'/);
  for(const marker of [
    'all_products','food_products','retail_products','published_products',
    'private_products','archived_products','food_private','retail_private'
  ])assert.ok(marketServer.includes(marker),'missing Catalog summary marker: '+marker);
  assert.match(marketUi,/Catalog summary/);
  assert.match(marketUi,/total Merchant products/);
  assert.match(marketUi,/Retail products & collections/);
  assert.match(marketUi,/Retail product.*in this view/s);
  assert.match(marketUi,/Food \/ prepared products/);
  assert.match(marketUi,/private Merchant Catalog/);
});

test('private Merchant products remain outside public discovery',()=>{
  const privateProducts=marketServer.slice(
    marketServer.indexOf('async function products('),
    marketServer.indexOf('// Guest/public read-only boundary')
  );
  assert.match(privateProducts,/p\.published=TRUE AND p\.active=TRUE/);
  const guest=marketServer.slice(
    marketServer.indexOf('async function guestPublicProducts'),
    marketServer.indexOf('async function importLegacyProducts')
  );
  assert.match(guest,/published=TRUE AND active=TRUE/);
  assert.match(marketServer,/public_discovery_rule:'Only active \+ published products/);
});
