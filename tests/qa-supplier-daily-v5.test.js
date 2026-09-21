import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../qa-acceptance.js',import.meta.url),'utf8');

test('Supplier Daily V5 acceptance wave is registered after V4',()=>{
  assert.match(source,/SUPPLIER_DAILY_V5_WAVE='supplier_daily_v5'/);
  assert.match(source,/runSupplierDailyV5Acceptance/);
  assert.match(source,/runSupplierSourcingV4Acceptance\(\{pool,base,secret\}\)/);
  assert.match(source,/config\.wave===SUPPLIER_DAILY_V5_WAVE/);
});

test('Supplier Daily V5 acceptance protects operational Money semantics',()=>{
  assert.match(source,/treated an unreceived uninvoiced PO commitment as Money due/);
  assert.match(source,/invoice evidence did not become an operational receivable/);
  assert.match(source,/future-due invoice overdue/);
  assert.match(source,/uninvoiced_unreceived_po_money_due_zero:true/);
  assert.match(source,/invoice_becomes_receivable:true/);
});

test('Supplier Daily V5 acceptance validates availability evidence without fake exact stock',()=>{
  assert.match(source,/AVAILABILITY_EVIDENCE_ONLY/);
  assert.match(source,/exact_on_hand_quantity!==null/);
  assert.match(source,/limited_availability_attention:true/);
  assert.match(source,/availability_evidence_only:true/);
});

test('Supplier Daily V5 acceptance preserves V1 through V4 baseline and no opaque priority score',()=>{
  assert.match(source,/supplier_v1_v2_v3_v4_baseline:true/);
  assert.match(source,/priority_score:false/);
});
