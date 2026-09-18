import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PRICING_SCENARIO_SERVICES} from '../finance-core.js';

const core=readFileSync(new URL('../finance-core.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../server-payments.js',import.meta.url),'utf8');

test('Pricing Lab is explicitly simulation-only and cannot activate live fees',()=>{
  assert.match(core,/simulation_only:true/);
  assert.match(core,/applies_live_fees:false/);
  assert.match(core,/fee_activation:'NOT_PERFORMED'/);
  assert.match(core,/promotional_charge:'ZERO_IN_LIVE_POLICY_UNTIL_FUTURE_EXPLICIT_FEE_RESOLUTION'/);
});

test('Pricing Lab models only the four monetizable service scopes',()=>{
  assert.deepEqual(PRICING_SCENARIO_SERVICES,['marketplace','delivery','supplier','local_services']);
  for(const scope of PRICING_SCENARIO_SERVICES)assert.match(core,new RegExp(scope));
});

test('Pricing Lab separates post-promo actual basis from mature-volume planning basis',()=>{
  assert.match(core,/post_promo_actual:'Only completed gross service value already outside the 90-day promotional window\.'/);
  assert.match(core,/all_activity_mature_simulation:'All completed service value in the period treated hypothetically as mature\/post-promo volume/);
  assert.match(core,/projected_revenue_post_promo_actual/);
  assert.match(core,/projected_revenue_mature_volume/);
});

test('Pricing Lab compares modeled revenue against canonical recorded costs',()=>{
  assert.match(core,/totalRecordedCosts=money\(Number\(finance\.variable_costs\|\|0\)\+Number\(finance\.allocated_fixed_cost\|\|0\)\)/);
  assert.match(core,/projected_operating_pl_post_promo_actual/);
  assert.match(core,/projected_operating_pl_mature_volume/);
  assert.match(core,/break_even_rate_total_volume_pct/);
  assert.match(core,/break_even_rate_post_promo_volume_pct/);
  assert.match(core,/Missing invoices or unrecorded overhead are not invented/);
});

test('unallocated shared cost is not silently pushed into arbitrary service margins',()=>{
  assert.match(core,/unallocated_shared_cost/);
  assert.match(core,/shared\/unallocated/);
  assert.match(core,/included only in portfolio P\/L, not service-specific P\/L/);
});

test('scenario rates are bounded but no rate is treated as approved',()=>{
  assert.match(core,/Scenario rate must be between 0 and 100 percent/);
  assert.match(core,/const rates=\{\}/);
  assert.match(core,/input\.rates\?\.\[scope\]/);
  assert.doesNotMatch(core,/marketplace:\s*2(?:\.0+)?[,}]/);
  assert.doesNotMatch(core,/delivery:\s*3(?:\.0+)?[,}]/);
});

test('Pricing Lab endpoint is Finance-read scoped and has no fee-policy mutation',()=>{
  assert.match(server,/app\.post\('\/api\/payments\/admin\/pricing-scenario'/);
  assert.match(server,/requireAdminPermission\(pool,me\.account\.id,'finance\.summary\.view'/);
  assert.match(server,/pricingScenario\(pool,/);
  const start=server.indexOf("app.post('/api/payments/admin/pricing-scenario'");
  const end=server.indexOf("app.get('/api/payments/admin/costs'",start);
  const block=server.slice(start,end);
  assert.doesNotMatch(block,/INSERT INTO fee_policy_versions/);
  assert.doesNotMatch(block,/UPDATE fee_policy_versions/);
  assert.doesNotMatch(block,/payment_allocations/);
});
