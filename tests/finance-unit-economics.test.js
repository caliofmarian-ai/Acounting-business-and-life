import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  FINANCE_EVIDENCE_CLASSES,FINANCE_COST_NATURES,FINANCE_SERVICE_SCOPES,
  FINANCE_COST_CATEGORIES,FINANCE_ALLOCATION_METHODS,financeInternals
} from '../finance-core.js';

const core=readFileSync(new URL('../finance-core.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../server-payments.js',import.meta.url),'utf8');
const admin=readFileSync(new URL('../admin-authorization.js',import.meta.url),'utf8');
const functions=readFileSync(new URL('../admin-functions.js',import.meta.url),'utf8');

test('finance cost ledger has versioned allocation policy, cost entries and cost allocations',()=>{
  for(const table of ['cost_allocation_policy_versions','platform_cost_entries','platform_cost_allocations']){
    assert.ok(core.includes('CREATE TABLE IF NOT EXISTS '+table),table+' must exist');
  }
  assert.match(core,/source_key TEXT NOT NULL UNIQUE/);
  assert.match(core,/allocation_key TEXT NOT NULL UNIQUE/);
  assert.match(core,/CHECK\(status IN \('active','void'\)\)/);
});

test('cost evidence and cost nature classes are explicit and bounded',()=>{
  assert.deepEqual(FINANCE_EVIDENCE_CLASSES,['actual','accrued','estimated','budget']);
  assert.deepEqual(FINANCE_COST_NATURES,['variable','fixed','semi_fixed']);
  assert.ok(FINANCE_SERVICE_SCOPES.includes('marketplace'));
  assert.ok(FINANCE_SERVICE_SCOPES.includes('delivery'));
  assert.ok(FINANCE_SERVICE_SCOPES.includes('local_services'));
  assert.ok(FINANCE_ALLOCATION_METHODS.includes('measured'));
  assert.ok(FINANCE_COST_CATEGORIES.includes('infrastructure'));
  assert.ok(FINANCE_COST_CATEGORIES.includes('support'));
});

test('processor fees come from canonical payment allocations instead of a duplicated manual processor category',()=>{
  assert.doesNotMatch(core,/FINANCE_COST_CATEGORIES[\s\S]{0,1000}'processor_fee'/);
  assert.match(core,/pa\.component_code='processor_fee'/);
  assert.match(core,/processorCost/);
});

test('unit economics separates platform revenue, variable cost, contribution, fixed cost and operating result',()=>{
  assert.match(core,/platformRevenue-variableCosts/);
  assert.match(core,/contribution-allocatedFixed/);
  assert.match(core,/contribution_margin_pct/);
  assert.match(core,/net_margin_pct/);
  assert.match(core,/NO_BREAK_EVEN_AT_CURRENT_UNIT_ECONOMICS/);
});

test('promotional reporting uses real cohorts while paid conversion remains gated by active fee policy',()=>{
  assert.match(core,/promotionKpi\(pool,\{\.\.\.p,territoryId\}\)/);
  assert.match(core,/promotion_economics:promotion/);
  assert.doesNotMatch(core,/PENDING_PROMO_COHORT_LINKAGE/);
  assert.doesNotMatch(core,/paid_conversion_pct:\s*0/);
});

test('cost allocation cannot exceed the source cost and historical cost is voided rather than deleted',()=>{
  assert.match(core,/Cost allocations cannot exceed the cost entry amount/);
  assert.match(core,/status='void'/);
  assert.doesNotMatch(core,/DELETE FROM platform_cost_entries/);
  assert.doesNotMatch(core,/DELETE FROM platform_cost_allocations/);
});

test('finance API uses scoped read and write permissions with Admin audit events',()=>{
  assert.match(admin,/'finance\.summary\.view'/);
  assert.match(admin,/'finance\.cost\.manage'/);
  assert.match(functions,/finance_accounting[\s\S]{0,800}'finance\.cost\.manage'/);
  assert.match(server,/api\/payments\/admin\/unit-economics/);
  assert.match(server,/api\/payments\/admin\/costs/);
  assert.match(server,/requireAdminPermission\(pool,me\.account\.id,'finance\.summary\.view'/);
  assert.match(server,/requireAdminPermission\(pool,me\.account\.id,'finance\.cost\.manage'/);
  assert.match(server,/platform_cost_recorded/);
  assert.match(server,/platform_cost_allocated/);
  assert.match(server,/platform_cost_voided/);
});

test('service source mapping does not mislabel delivery processor cost as marketplace cost',()=>{
  assert.equal(financeInternals.serviceFromSource('order'),'marketplace');
  assert.equal(financeInternals.serviceFromSource('purchase_order'),'supplier');
  assert.equal(financeInternals.serviceFromSource('service_job'),'local_services');
  assert.match(core,/COALESCE\(fp\.service_scope,'shared'\) service_scope/);
});
