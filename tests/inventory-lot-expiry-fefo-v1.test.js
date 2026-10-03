import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const accounting=readFileSync(new URL('../server-business-accounting.js',import.meta.url),'utf8');
const orders=readFileSync(new URL('../server-orders.js',import.meta.url),'utf8');
const marketplace=readFileSync(new URL('../server-marketplace.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/v03.js',import.meta.url),'utf8');
const runtime=readFileSync(new URL('../inventory-lot-runtime.js',import.meta.url),'utf8');
const reservation=readFileSync(new URL('../order-stock-reservation.js',import.meta.url),'utf8');

test('Inventory purchase captures lot code and expiry and creates a traceable supply lot',()=>{
  assert.match(html,/id="stockLotCode"/);
  assert.match(html,/id="stockExpiry"/);
  assert.match(accounting,/INSERT INTO supply_lots/);
  assert.match(accounting,/INV-\$\{ctx\.business\.id\}-\$\{purchaseRecord\.rows\[0\]\.id\}/);
  assert.match(accounting,/expiryAt=inventoryExpiryTimestamp/);
  assert.match(ui,/lot_code:\$\('stockLotCode'\)\.value/);
  assert.match(ui,/expires_at:\$\('stockExpiry'\)\.value/);
});

test('Inventory exposes lot expiry status and FEFO usability',()=>{
  assert.match(accounting,/\/api\/inventory\/lots/);
  assert.match(accounting,/inventoryLotExpiryStatus/);
  assert.match(accounting,/usable:state==='available'&&expiry_status!=='expired'/);
  assert.match(html,/Lots & expiry/);
  assert.match(ui,/function loadInventoryLots/);
  assert.match(ui,/expiring soon/i);
});

test('shared FEFO runtime locks and updates canonical supply lots',()=>{
  assert.match(runtime,/FOR UPDATE/);
  assert.match(runtime,/planFefoAllocation/);
  assert.match(runtime,/quantity_remaining_base=GREATEST\(0,quantity_remaining_base-\$1\)/);
  assert.match(runtime,/lot_state=CASE WHEN quantity_remaining_base-\$1<=0\.000000001 THEN 'depleted'/);
});

test('quick sales allocate recipe ingredients from FEFO lots',()=>{
  assert.match(accounting,/CREATE TABLE IF NOT EXISTS product_sale_lot_allocations/);
  assert.match(accounting,/planInventoryFefo\(client/);
  assert.match(accounting,/applyLotAllocations\(client/);
  assert.match(accounting,/expired_or_held_lot_stock/);
});

test('orders reserve both recipes and configured consumables using FEFO and restore consumed lots on cancellation',()=>{
  assert.match(orders,/consumeOrderReservations\(client,order\)/);
  assert.match(reservation,/FROM merchant_order_consumable_rules/);
  assert.match(reservation,/sortFefoLots/);
  assert.match(reservation,/applyLotAllocations\(client,allocations\)/);
  assert.match(orders,/restoreLotAllocation\(client/);
});

test('Marketplace uses the same reservation, FEFO, consumable and cancellation runtime as Orders',()=>{
  assert.match(marketplace,/reserveOrderStock\(client/);
  assert.match(marketplace,/consumeOrderReservations\(client,o\)/);
  assert.match(marketplace,/releaseOrderReservations\(client/);
  assert.match(reservation,/FROM merchant_order_consumable_rules/);
  assert.match(reservation,/order_stock_lot_allocations/);
  assert.match(marketplace,/restoreLotAllocation\(client/);
});
