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

test('Merchant Marketplace direct products reserve and consume canonical inventory instead of a duplicate stock counter',()=>{
  const server=read('server-marketplace.js');
  const reservation=read('order-stock-reservation.js');
  assert.match(server,/inventory_id BIGINT REFERENCES inventory/);
  assert.match(server,/fresh_direct/);
  assert.match(server,/packaged_resale/);
  assert.match(server,/non_food_resale/);
  assert.match(server,/row\.inventory_id/);
  assert.match(server,/reserveOrderStock\(client/);
  assert.match(server,/consumeOrderReservations\(client,o\)/);
  assert.match(reservation,/quantity_per_unit/);
  assert.match(reservation,/UPDATE inventory SET quantity=quantity-\$1/);
  assert.match(reservation,/order_stock_consumptions/);
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

test('Merchant Orders owns direct-sale product creation while Storefront only manages publication',()=>{
  const orders=read('public/orders-ui.js');
  const storefront=read('public/marketplace-ui.js');
  assert.match(orders,/Add a direct-sale product/);
  assert.match(orders,/Fresh \/ direct food/);
  assert.match(orders,/Packaged food resale/);
  assert.match(orders,/Non-food resale/);
  assert.match(orders,/inventory_id:inventoryId/);
  assert.match(orders,/Each sale consumes/);
  assert.match(orders,/published:false/);
  assert.match(orders,/Publish it from My Storefront when ready/);
  assert.doesNotMatch(storefront,/Add a direct-sale product/);
  assert.doesNotMatch(storefront,/directProductForm/);
});

test('Supplier pack receiving normalizes into the linked Merchant base unit',()=>{
  const server=read('server-business-accounting.js');
  assert.match(server,/toBaseQuantity\(Number\(x\.base_units_per_pack_snapshot\),x\.base_unit_snapshot\)/);
  assert.match(server,/receivedInventoryUnits/);
  assert.match(server,/Confirm the pack conversion first/);
});
