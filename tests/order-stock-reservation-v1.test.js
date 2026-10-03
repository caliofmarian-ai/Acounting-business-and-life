import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planInventoryReservationAllocation,reservationExpiryForOrder} from '../order-stock-reservation.js';

const reservation=readFileSync(new URL('../order-stock-reservation.js',import.meta.url),'utf8');
const orders=readFileSync(new URL('../server-orders.js',import.meta.url),'utf8');
const marketplace=readFileSync(new URL('../server-marketplace.js',import.meta.url),'utf8');
const accounting=readFileSync(new URL('../server-business-accounting.js',import.meta.url),'utf8');
const deliveryFinance=readFileSync(new URL('../server-delivery-finance.js',import.meta.url),'utf8');
const paymongo=readFileSync(new URL('../paymongo-adapter.js',import.meta.url),'utf8');
const inventoryRuntime=readFileSync(new URL('../inventory-lot-runtime.js',import.meta.url),'utf8');
const inventoryUi=readFileSync(new URL('../public/v03.js',import.meta.url),'utf8');

const now=Date.parse('2026-10-03T00:00:00Z');

test('reservation planner subtracts other orders from exact FEFO lots and untracked stock',()=>{
  const plan=planInventoryReservationAllocation({
    quantityNeeded:4,
    physicalQuantity:10,
    now,
    lots:[
      {id:1,quantity_remaining_base:4,lot_state:'available',expires_at:'2026-10-05T00:00:00Z'},
      {id:2,quantity_remaining_base:4,lot_state:'available',expires_at:'2026-10-10T00:00:00Z'}
    ],
    reservedByLot:new Map([[1,3]]),
    untrackedReserved:1
  });
  assert.equal(plan.ok,true);
  assert.equal(plan.available,6);
  assert.deepEqual(plan.allocations.map(x=>[x.lot_id,x.quantity]),[[1,1],[2,3]]);
  assert.equal(plan.untrackedUsed,0);
});

test('second concurrent order fails when active reservations consume the remaining availability',()=>{
  const plan=planInventoryReservationAllocation({
    quantityNeeded:7,
    physicalQuantity:10,
    now,
    lots:[
      {id:1,quantity_remaining_base:4,lot_state:'available',expires_at:'2026-10-05T00:00:00Z'},
      {id:2,quantity_remaining_base:4,lot_state:'available',expires_at:'2026-10-10T00:00:00Z'}
    ],
    reservedByLot:new Map([[1,3]]),
    untrackedReserved:1
  });
  assert.equal(plan.ok,false);
  assert.equal(plan.available,6);
  assert.equal(plan.short,1);
  assert.equal(plan.reason,'reserved_or_unusable_stock');
});

test('expired and held lots are never available for reservation',()=>{
  const plan=planInventoryReservationAllocation({
    quantityNeeded:3,
    physicalQuantity:8,
    now,
    lots:[
      {id:1,quantity_remaining_base:3,lot_state:'available',expires_at:'2026-10-02T00:00:00Z'},
      {id:2,quantity_remaining_base:3,lot_state:'quarantined',expires_at:'2026-10-10T00:00:00Z'},
      {id:3,quantity_remaining_base:2,lot_state:'available',expires_at:'2026-10-08T00:00:00Z'}
    ]
  });
  assert.equal(plan.ok,false);
  assert.equal(plan.available,2);
});

test('accepted orders extend reservation lifetime beyond unpaid checkout hold',()=>{
  const base=new Date('2026-10-03T00:00:00Z');
  const checkout=new Date(reservationExpiryForOrder({order_status:'awaiting_payment'},{now:base}));
  const accepted=new Date(reservationExpiryForOrder({order_status:'accepted'},{now:base}));
  assert.equal((checkout-base)/60000,30);
  assert.equal((accepted-base)/60000,240);
});

test('reservation schema has explicit reserved consumed released states and lot evidence',()=>{
  assert.match(reservation,/CREATE TABLE IF NOT EXISTS order_stock_reservations/);
  assert.match(reservation,/state IN \('reserved','consumed','released'\)/);
  assert.match(reservation,/CREATE TABLE IF NOT EXISTS order_stock_reservation_lots/);
  assert.match(reservation,/UNIQUE\(order_id,stock_kind,stock_ref_id\)/);
  assert.match(reservation,/FOR UPDATE/);
});

test('normal Orders reserve at creation, refresh at acceptance, consume once at preparation and release on cancellation',()=>{
  assert.match(orders,/reserveOrderStock\(client,\{\.\.\.order\.rows\[0\]/);
  assert.match(orders,/toStatus==='accepted'.*reserveOrderStock/s);
  assert.match(orders,/consumeOrderReservations\(client,order\)/);
  assert.match(orders,/releaseOrderReservations\(client,\{orderId:id,reason:'cancelled'\}\)/);
  assert.match(reservation,/if\(order\.stock_consumed_at\)return\{consumed:false,reused:true\}/);
});

test('Marketplace checkout and start use the same canonical reservation lifecycle',()=>{
  assert.match(marketplace,/reserveOrderStock\(client,\{\.\.\.o\.rows\[0\]/);
  assert.match(marketplace,/consumeOrderReservations\(client,o\)/);
  assert.match(marketplace,/releaseOrderReservations\(client,\{orderId:id,reason:'cancelled'\}\)/);
});

test('all payment acceptance paths refresh an expired reservation before accepting the order',()=>{
  assert.match(accounting,/reserveOrderStock\(client,order/);
  assert.match(deliveryFinance,/reserveOrderStock\(client,order/);
  assert.match(paymongo,/reserveOrderStock\(client,o/);
});

test('Inventory exposes reserved and available quantities without changing usable-stock restock authority',()=>{
  assert.match(inventoryRuntime,/reserved_quantity/);
  assert.match(inventoryRuntime,/available_quantity/);
  assert.match(inventoryRuntime,/usable_quantity:usable/);
  assert.match(inventoryUi,/available .*reserved .*usable .*physical/s);
});
