import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Merchant accounting exposes purchase-based stock intake and batch recipes',()=>{
  const server=read('server-business-accounting.js');
  assert.match(server,/\/api\/inventory\/purchase/);
  assert.match(server,/weightedAverageUnitCost/);
  assert.match(server,/'inventory_purchase'/);
  assert.match(server,/\/api\/products\/:id\/recipe-batch/);
  assert.match(server,/product_recipe_batches/);
  assert.match(server,/recipe_batch_components/);
  assert.match(server,/per_sale_quantity/);
});

test('Merchant Marketplace direct products consume canonical inventory instead of a duplicate stock counter',()=>{
  const server=read('server-marketplace.js');
  assert.match(server,/inventory_id BIGINT REFERENCES inventory/);
  assert.match(server,/fresh_direct/);
  assert.match(server,/packaged_resale/);
  assert.match(server,/non_food_resale/);
  assert.match(server,/p\.inventory_id/);
  assert.match(server,/required=Number\(x\.quantity_per_unit\)\*Number\(x\.quantity\)/);
  assert.match(server,/UPDATE inventory SET quantity=quantity-\$1/);
  assert.match(server,/order_stock_consumptions/);
});

test('Merchant mobile UI asks for purchase facts and batch yield rather than manual unit cost',()=>{
  const html=read('public/index.html');
  const ui=read('public/v03.js');
  assert.match(html,/Add stock from a purchase/);
  assert.match(html,/Bought quantity/);
  assert.match(html,/Total purchase cost/);
  assert.match(html,/Finished batch/);
  assert.match(html,/Sell as/);
  assert.match(html,/Save batch recipe/);
  assert.doesNotMatch(html,/id="stockCost"/);
  assert.match(ui,/\/api\/inventory\/purchase/);
  assert.match(ui,/\/recipe-batch/);
  assert.match(ui,/Batch makes/);
});

test('Storefront can create fresh, packaged and non-food resale products from Merchant inventory',()=>{
  const ui=read('public/marketplace-ui.js');
  assert.match(ui,/Add a direct-sale product/);
  assert.match(ui,/Fresh \/ direct food/);
  assert.match(ui,/Packaged food resale/);
  assert.match(ui,/Non-food resale/);
  assert.match(ui,/inventory_id:Number\(inventory\.value\)/);
  assert.match(ui,/Each sale consumes/);
  assert.match(ui,/Create private product/);
});
