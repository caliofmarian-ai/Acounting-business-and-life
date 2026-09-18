import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {financeInternals} from '../finance-core.js';

const core=readFileSync(new URL('../finance-core.js',import.meta.url),'utf8');

test('processor fee allocation preserves exact cents across merchandise and delivery',()=>{
  const rows=financeInternals.allocateProcessorCents(1.01,[
    {service_scope:'marketplace',weight:70},
    {service_scope:'delivery',weight:30}
  ]);
  assert.equal(rows[0].amount,0.71);
  assert.equal(rows[1].amount,0.30);
  assert.equal(Number((rows[0].amount+rows[1].amount).toFixed(2)),1.01);

  const second=financeInternals.allocateProcessorCents(3.33,[
    {service_scope:'marketplace',weight:100},
    {service_scope:'delivery',weight:50}
  ]);
  assert.deepEqual(second.map(x=>x.amount),[2.22,1.11]);
});

test('direct promo costs use immutable monetization event phase snapshots',()=>{
  assert.match(core,/service_monetization_events e/);
  assert.match(core,/e\.phase_snapshot/);
  assert.match(core,/phase_snapshot/);
  assert.doesNotMatch(core,/registration.*promotional/i);
});

test('order processor cost is split using canonical merchandise and delivery allocations',()=>{
  assert.match(core,/component_code='processor_fee'/);
  assert.match(core,/component_code='merchandise'/);
  assert.match(core,/component_code='delivery'/);
  assert.match(core,/merchandise_base/);
  assert.match(core,/delivery_base/);
  assert.match(core,/allocateProcessorCents\(x\.fee,x\.rows\)/);
});

test('Finance cost ledger contributes only with explicit payment-intent and service attribution',()=>{
  assert.match(core,/platform_cost_allocations a ON a\.payment_intent_id=m\.payment_intent_id AND a\.service_scope=m\.service_scope/);
  assert.match(core,/platform_cost_entries ce ON ce\.payment_intent_id=m\.payment_intent_id AND ce\.service_scope=m\.service_scope/);
  assert.match(core,/NOT EXISTS\(SELECT 1 FROM platform_cost_allocations a WHERE a\.cost_entry_id=ce\.id\)/);
});

test('direct promotional cost explicitly excludes unallocated shared and fixed overhead',()=>{
  assert.match(core,/coverage_status:'DIRECT_ONLY_EXCLUDES_SHARED_FIXED'/);
  assert.match(core,/terminology:'DIRECT_PROMOTIONAL_SUBSIDY_FLOOR'/);
  assert.match(core,/Shared and fixed overhead is excluded unless explicitly allocated/);
});

test('direct promo KPI reports processor, ledger and total cost per completion and active subject',()=>{
  assert.match(core,/direct_processor_cost/);
  assert.match(core,/direct_ledger_cost/);
  assert.match(core,/total_direct_cost/);
  assert.match(core,/direct_cost_per_completion/);
  assert.match(core,/direct_cost_per_active_subject/);
  assert.match(core,/promotion_economics:\{\.\.\.promotion,direct_cost:promotionDirectCost\}/);
});

test('processor fee remains separate from manual platform cost ledger',()=>{
  assert.doesNotMatch(core,/FINANCE_COST_CATEGORIES[\s\S]{0,1000}'processor_fee'/);
  assert.match(core,/processor fee/i);
});
