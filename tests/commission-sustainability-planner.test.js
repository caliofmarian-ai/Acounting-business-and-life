import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {commissionSustainabilityScenario} from '../finance-core.js';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const server=read('server-payments.js');
const ui=read('public/admin-console.js');
const css=read('public/admin-console.css');
const pkg=read('package.json');

function base(overrides={}){
  return commissionSustainabilityScenario({
    completedEventsPerMonth:10000,
    averageFeeBaseValue:500,
    feeEligibleSharePct:100,
    onlinePaymentSharePct:50,
    processorRatePct:2,
    processorFixedPerOnlineEvent:0,
    riskAllowancePct:1,
    safetyReservePct:10,
    growthSurplusPct:5,
    staffing:{
      super_admin_remuneration:{count:1,monthly_cost_per_person:50000},
      country_admin:{count:1,monthly_cost_per_person:40000},
      territory_admin:{count:5,monthly_cost_per_person:20000},
      specialist_admin:{count:2,monthly_cost_per_person:25000},
      support_staff:{count:3,monthly_cost_per_person:18000},
      other_employee_contractor:{count:2,monthly_cost_per_person:22000}
    },
    monthlyCosts:{
      infrastructure:80000,
      database_storage_monitoring:30000,
      ai_api_maps_notifications:70000,
      support_operations:30000,
      marketing_growth:60000,
      legal_accounting_compliance:40000,
      insurance_licences:10000,
      other_overhead:20000
    },
    ...overrides
  });
}

test('commission planner calculates break-even from modeled fee base and all operating costs',()=>{
  const s=base();
  assert.equal(s.volume.mature_monthly_fee_base,5000000);
  assert.equal(s.staffing.total_monthly_staffing_cost,338000);
  assert.equal(s.operating_costs.total_monthly_operating_overhead,340000);
  assert.equal(s.cost_model.processor_total_cost,50000);
  assert.equal(s.cost_model.refund_chargeback_bad_debt_allowance,50000);
  assert.equal(s.cost_model.base_operating_cost,778000);
  assert.equal(s.cost_model.safety_reserve_amount,77800);
  assert.equal(s.cost_model.growth_reinvestment_surplus_amount,38900);
  assert.equal(s.rates.mature_100pct_fee_eligible.break_even_pct,15.56);
  assert.equal(s.rates.mature_100pct_fee_eligible.sustainable_pct,17.116);
});

test('current rollout rate uses only post-promo fee-eligible volume',()=>{
  const s=base({feeEligibleSharePct:25});
  assert.equal(s.volume.current_fee_eligible_monthly_base,1250000);
  assert.equal(s.rates.current_rollout.break_even_pct,62.24);
  assert.equal(s.rates.mature_100pct_fee_eligible.break_even_pct,15.56);
});

test('zero fee-eligible volume reports promo funding instead of inventing commission',()=>{
  const s=base({feeEligibleSharePct:0});
  assert.equal(s.rates.current_rollout.status,'PROMOTIONAL_VOLUME_REQUIRES_EXTERNAL_FUNDING');
  assert.equal(s.rates.current_rollout.break_even_pct,null);
  assert.equal(s.rates.current_rollout.sustainable_pct,null);
  assert.match(s.guardrails.promotional_rule,/Owner\/company capital/);
});

test('processor cost respects online share and can be excluded when funded separately',()=>{
  const a=base({onlinePaymentSharePct:20,processorRatePct:2.5,processorFixedPerOnlineEvent:2});
  assert.equal(a.volume.online_events_per_month,2000);
  assert.equal(a.volume.online_fee_base,1000000);
  assert.equal(a.cost_model.processor_variable_cost,25000);
  assert.equal(a.cost_model.processor_fixed_cost,4000);
  const b=base({platformAbsorbsProcessorFees:false});
  assert.equal(b.cost_model.processor_total_cost,0);
});

test('owner distribution is explicitly excluded from commission cost model',()=>{
  const s=base();
  assert.equal(s.guardrails.owner_distribution_in_operating_cost,false);
  assert.match(s.guardrails.owner_distribution_note,/excluded/);
  assert.ok(!Object.keys(s.staffing.by_key).includes('owner_distribution'));
  assert.ok(!Object.keys(s.operating_costs.by_key).includes('owner_distribution'));
});

test('staffing cost is headcount times monthly remuneration with no hardcoded admin commission',()=>{
  const s=base({staffing:{country_admin:{count:2,monthly_cost_per_person:30000}}});
  assert.equal(s.staffing.by_key.country_admin,60000);
  assert.equal(s.staffing.by_key.territory_admin,0);
  assert.doesNotMatch(JSON.stringify(s),/country_operator_fee/);
});

test('Commission Planner endpoint is Finance-read scoped and cannot mutate fee policy',()=>{
  assert.match(server,/app\.post\('\/api\/payments\/admin\/commission-planner'/);
  assert.match(server,/requireAdminPermission\(pool,me\.account\.id,'finance\.summary\.view'/);
  assert.match(server,/commissionSustainabilityScenario\(/);
  const start=server.indexOf("app.post('/api/payments/admin/commission-planner'");
  const end=server.indexOf("app.post('/api/payments/admin/pricing-scenario'",start);
  const block=server.slice(start,end);
  assert.doesNotMatch(block,/createFeePolicy|addFeeRule|fee_policy_versions|UPDATE fee_policy|INSERT INTO fee_policy/i);
  assert.match(block,/commission_sustainability_scenario_run/);
});

test('Admin Finance UI asks for volume staffing overhead and reserve before calculating rate',()=>{
  assert.match(ui,/What is the lowest sustainable platform fee\?/);
  assert.match(ui,/name="completed_events_per_month"/);
  assert.match(ui,/name="average_fee_base_value"/);
  assert.match(ui,/name="fee_eligible_share_pct"/);
  assert.match(ui,/Super Admin remuneration/);
  assert.match(ui,/Country Admins/);
  assert.match(ui,/Territory Admins/);
  assert.match(ui,/AI, APIs, maps & notifications/);
  assert.match(ui,/Safety reserve % of operating cost/);
  assert.match(ui,/Calculate minimum sustainable fee/);
  assert.match(ui,/\/api\/payments\/admin\/commission-planner/);
  assert.match(css,/\.commissionPlannerCard/);
});

test('UI separates mature, rollout, break-even and sustainable rates',()=>{
  assert.match(ui,/Mature break-even/);
  assert.match(ui,/Mature sustainable/);
  assert.match(ui,/Current rollout break-even/);
  assert.match(ui,/Current rollout sustainable/);
  assert.match(ui,/Promo-funded period/);
});

test('project syntax contract includes planner test',()=>{
  assert.match(pkg,/node --check tests\/commission-sustainability-planner\.test\.js/);
});
