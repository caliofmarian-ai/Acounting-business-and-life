import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const scanner=readFileSync(new URL('../inventory-notification-scanner.js',import.meta.url),'utf8');
const core=readFileSync(new URL('../notification-core.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../server-notifications.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/notifications-ui.js',import.meta.url),'utf8');
const merchant=readFileSync(new URL('../public/v03.js',import.meta.url),'utf8');
const attention=readFileSync(new URL('../notification-attention-policy.js',import.meta.url),'utf8');

test('Inventory notification templates exist in English and Filipino',()=>{
  for(const code of ['inventory.low_stock','inventory.out_of_stock','inventory.expiring_soon','inventory.expired','inventory.held']){
    assert.match(core,new RegExp(code.replace('.','\\.')));
  }
  assert.match(core,/Low stock: \{\{item\}\}/);
  assert.match(core,/Mababa ang stock: \{\{item\}\}/);
});

test('scanner stores transition state and episode-based dedupe',()=>{
  assert.match(scanner,/CREATE TABLE IF NOT EXISTS inventory_notification_states/);
  assert.match(scanner,/active BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(scanner,/episode INTEGER NOT NULL DEFAULT 0/);
  assert.match(scanner,/AND active=FALSE/);
  assert.match(scanner,/episode=episode\+1/);
  assert.match(scanner,/eventKey:.*inventory:/s);
  assert.match(scanner,/clearInactiveSignals/);
});

test('notification worker scans Inventory without adding another polling timer',()=>{
  assert.match(server,/INVENTORY_SCAN_INTERVAL_MS=60\*1000/);
  assert.match(server,/scanInventoryNotifications\(pool,\{now\}\)/);
  assert.match(server,/workerTimer=setInterval\(runWorker,8000\)/);
  assert.doesNotMatch(server,/setInterval\(scanInventoryNotifications/);
});

test('Inventory notifications use operational preferences and existing push delivery',()=>{
  assert.match(scanner,/category:'operational'/);
  assert.match(scanner,/pushDefault:true/);
  assert.match(scanner,/emailDefault:false/);
  assert.match(scanner,/businessNotificationRecipients\(pool,businessId,'merchant'\)/);
  assert.match(attention,/inventory\.out_of_stock/);
  assert.match(attention,/inventory\.expired/);
});

test('notification cards and push links open exact Inventory item or lot context',()=>{
  assert.match(core,/inventory_item/);
  assert.match(core,/inventory_lot/);
  assert.match(ui,/action==='open_inventory'/);
  assert.match(ui,/BusinessLifeInventory\?\.openNotificationContext/);
  assert.match(merchant,/openNotificationContext:openInventoryNotificationContext/);
  assert.match(merchant,/dataset\.inventoryId/);
  assert.match(merchant,/dataset\.lotId/);
  assert.match(merchant,/inventoryNotificationTarget/);
});

test('Inventory notification entities are threaded to consolidate repeated episodes',()=>{
  assert.match(server,/inventory_item','inventory_lot/);
});
