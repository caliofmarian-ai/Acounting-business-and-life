import test from 'node:test';
import assert from 'node:assert/strict';
import {
  supplierTodayBucket,supplierOrderAttention,supplierCatalogAttention,summarizeSupplierToday
} from '../supplier-daily-core.js';

test('Supplier Today reuses existing PO lifecycle states',()=>{
  assert.equal(supplierTodayBucket('sent'),'new_orders');
  assert.equal(supplierTodayBucket('partially_accepted'),'prepare');
  assert.equal(supplierTodayBucket('ready_for_pickup'),'ready');
  assert.equal(supplierTodayBucket('received'),'completed');
  assert.equal(supplierTodayBucket('cancelled'),null);
});

test('Supplier Today derives factual overdue and partial signals',()=>{
  const now=new Date('2026-09-21T12:00:00Z');
  const signals=supplierOrderAttention({
    status:'partially_accepted',
    supplier_ready_at:'2026-09-21T10:00:00Z',
    commercial_outstanding:500,
    earliest_due_date:'2026-09-20'
  },{now});
  assert.deepEqual(signals,[
    'PARTIAL_ACCEPTANCE_FOLLOW_UP','READY_TIME_OVERDUE','RECEIVABLE_OVERDUE'
  ]);
});

test('delivery ETA is overdue only while out for delivery',()=>{
  const now=new Date('2026-09-21T12:00:00Z');
  assert.ok(supplierOrderAttention({
    status:'out_for_delivery',supplier_delivery_eta:'2026-09-21T11:00:00Z'
  },{now}).includes('DELIVERY_ETA_OVERDUE'));
  assert.ok(!supplierOrderAttention({
    status:'delivered',supplier_delivery_eta:'2026-09-21T11:00:00Z'
  },{now}).includes('DELIVERY_ETA_OVERDUE'));
});

test('catalog attention is availability evidence, not invented stock',()=>{
  assert.deepEqual(
    supplierCatalogAttention({
      availability_status:'unavailable',
      expected_restock_date:'2026-09-20'
    },{today:new Date('2026-09-21T12:00:00Z')}),
    ['UNAVAILABLE','RESTOCK_DATE_PASSED']
  );
  assert.deepEqual(supplierCatalogAttention({availability_status:'available'}),[]);
});

test('Today summary groups work and commercial receivables deterministically',()=>{
  const now=new Date('2026-09-21T12:00:00Z');
  const s=summarizeSupplierToday({
    now,
    orders:[
      {id:1,business_id:7,status:'sent',commercial_outstanding:100,earliest_due_date:null},
      {id:2,business_id:7,status:'preparing',supplier_ready_at:'2026-09-21T10:00:00Z',commercial_outstanding:200,earliest_due_date:'2026-09-20'},
      {id:3,business_id:8,status:'received',commercial_outstanding:0}
    ],
    rfqs:[{id:4}],returns:[{id:5}],
    catalog:[{id:6,availability_status:'limited'}]
  });
  assert.equal(s.counts.new_orders,1);
  assert.equal(s.counts.prepare,1);
  assert.equal(s.counts.completed,1);
  assert.equal(s.counts.rfqs,1);
  assert.equal(s.counts.returns,1);
  assert.equal(s.counts.catalog_attention,1);
  assert.equal(s.counts.merchant_balances,1);
  assert.equal(s.counts.overdue_timing,1);
  assert.equal(s.money.receivable_total,300);
  assert.equal(s.money.overdue_receivable_total,200);
});
