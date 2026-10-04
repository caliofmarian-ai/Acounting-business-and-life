import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const script=readFileSync(new URL('../scripts/production-inventory-catalog-769-smoke.js',import.meta.url),'utf8');

test('Production Inventory/Catalog smoke is read-only and production-gated',()=>{
  assert.match(script,/RAILWAY_ENVIRONMENT_NAME!=='production'/);
  assert.match(script,/NODE_ENV!=='production'/);
  assert.match(script,/read_only:true/);
  assert.match(script,/real_money:false/);
  assert.doesNotMatch(script,/\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bCOMMIT\b|\bROLLBACK\b/i);
});

test('Production Inventory/Catalog smoke verifies ID-zero regression, count reconciliation and private exclusion',()=>{
  for(const marker of [
    'selectedPositiveInventoryId',
    'inventoryUnavailableItem',
    'Retail products & collections',
    'Food / prepared products',
    'Catalog summary',
    'merchant/catalog-v3/summary',
    'private_products',
    'published_products',
    'PRODUCTION_INVENTORY_CATALOG_769_SMOKE_RESULT'
  ])assert.ok(script.includes(marker),'missing #769 Production smoke marker: '+marker);
  assert.match(script,/privateCount<1/);
  assert.match(script,/private_public_overlap:0/);
});
