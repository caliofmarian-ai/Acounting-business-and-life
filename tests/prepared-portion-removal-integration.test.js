import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const backend=readFileSync(new URL('../server-business-accounting.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/v03.js',import.meta.url),'utf8');

test('prepared product removal is business-scoped, atomic, idempotent, and noncash',()=>{
  const route=backend.slice(backend.indexOf("app.post('/api/prepared-product-removals'"),backend.indexOf("app.post('/api/product-sales'"));
  assert.ok(route.startsWith("app.post('/api/prepared-product-removals'"));
  for(const marker of ['parsePreparedRemoval(req.body,ctx.business.id)',"await client.query('BEGIN')",
    'ON CONFLICT (business_id,idempotency_key) DO NOTHING','FOR UPDATE OF i',
    'planInventoryFefo(client','applyLotAllocations(client','prepared_product_removal_ingredients',
    'prepared_product_removal_lots',"await client.query('COMMIT')","await client.query('ROLLBACK')"]){
    assert.ok(route.includes(marker),'Missing write safety: '+marker);
  }
  assert.doesNotMatch(route,/INSERT INTO transactions|INSERT INTO product_sales|INSERT INTO inventory_adjustments|INSERT INTO orders/);
});
test('prepared removals get a separate immutable reason/cost/actor history, without claiming finished stock',()=>{
  for(const marker of ['CREATE TABLE IF NOT EXISTS prepared_product_removals','estimated_cost NUMERIC(14,2)',
    'actor_account_id BIGINT','recipe_batch_snapshot JSONB','UNIQUE(business_id,idempotency_key)',
    "app.get('/api/prepared-product-removals'"]){
    assert.ok(backend.includes(marker),'Missing persistence: '+marker);
  }
  assert.match(html,/id="preparedRemovalForm"/);
  assert.match(html,/value="owner_consumption"/);
  assert.match(html,/value="damaged"/);
  assert.match(html,/value="spoilage"/);
  assert.match(html,/value="quality_rejected"/);
  assert.match(html,/id="preparedRemovalPreview"/);
  assert.match(html,/id="preparedRemovalList"/);
  assert.match(ui,/loadPreparedRemovals\(\)/);
  assert.match(ui,/crypto\.randomUUID\(\)/);
  assert.match(ui,/Remove .*prepared portion/);
});
