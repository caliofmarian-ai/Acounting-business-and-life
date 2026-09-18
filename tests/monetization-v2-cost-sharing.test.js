import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  PROFILE_MONETIZATION_MODEL,DIGITAL_PAYMENT_INCENTIVE_DEFAULT,
  allocateSharedCompanyCost50x50,profileMonetizationModel,monetizationPolicyDraft
} from '../monetization-policy-v2.js';
import {commissionSustainabilityScenario} from '../finance-core.js';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const server=read('server-payments.js');
const ui=read('public/admin-console.js');
const css=read('public/admin-console.css');
const pkg=read('package.json');

test('profile monetization matrix follows Owner model without invented prices',()=>{
  assert.equal(PROFILE_MONETIZATION_MODEL.customer.customer_free,true);
  assert.equal(PROFILE_MONETIZATION_MODEL.customer.monthly_subscription,false);
  assert.equal(PROFILE_MONETIZATION_MODEL.customer.transaction_fee,false);

  for(const role of ['merchant','supplier','local_services']){
    const m=profileMonetizationModel(role);
    assert.equal(m.monthly_subscription,true);
    assert.equal(m.transaction_fee,true);
    assert.equal(m.delivery_production_fee,false);
    assert.equal(m.promotional_entitlement,true);
  }

  const courier=profileMonetizationModel('courier');
  assert.equal(courier.monthly_subscription,false);
  assert.equal(courier.transaction_fee,false);
  assert.equal(courier.delivery_production_fee,true);
  assert.equal(courier.service_scope,'delivery');

  const merchantDraft=monetizationPolicyDraft('merchant');
  assert.equal(merchantDraft.monthly_subscription_amount,null);
  assert.equal(merchantDraft.transaction_rate_pct,null);
  assert.equal(merchantDraft.transaction_fixed_amount,null);
  assert.equal(merchantDraft.promotional_days,90);
});

test('50/50 shared cost allocation gives baseline share to zero-traffic market',()=>{
  const x=allocateSharedCompanyCost50x50(100000,[
    {scope_id:'A',scope_name:'A',driver_value:50},
    {scope_id:'B',scope_name:'B',driver_value:30},
    {scope_id:'C',scope_name:'C',driver_value:20},
    {scope_id:'D',scope_name:'New market',driver_value:0}
  ]);
  assert.equal(x.equal_pool,50000);
  assert.equal(x.activity_pool,50000);
  assert.deepEqual(x.rows.map(r=>r.allocated_amount),[37500,27500,22500,12500]);
  assert.equal(x.rows[3].equal_component,12500);
  assert.equal(x.rows[3].activity_component,0);
  assert.equal(x.allocated_total,100000);
  assert.equal(x.residual,0);
});

test('when every market has zero activity, activity half falls back to equal split',()=>{
  const x=allocateSharedCompanyCost50x50(100000,[
    {scope_id:'A',driver_value:0},
    {scope_id:'B',driver_value:0},
    {scope_id:'C',driver_value:0},
    {scope_id:'D',driver_value:0}
  ]);
  assert.equal(x.zero_activity_fallback,'EQUAL_SPLIT_ACTIVITY_HALF');
  assert.deepEqual(x.rows.map(r=>r.allocated_amount),[25000,25000,25000,25000]);
  assert.equal(x.residual,0);
});

test('shared cost allocation is cent-exact even with uneven weights',()=>{
  const x=allocateSharedCompanyCost50x50(100.01,[
    {scope_id:'A',driver_value:1},
    {scope_id:'B',driver_value:2},
    {scope_id:'C',driver_value:7}
  ]);
  const cents=x.rows.reduce((s,r)=>s+Math.round(r.allocated_amount*100),0);
  assert.equal(cents,10001);
  assert.equal(x.allocated_total,100.01);
  assert.equal(x.residual,0);
});

test('subscription and Delivery revenues reduce transaction-fee revenue requirement',()=>{
  const s=commissionSustainabilityScenario({
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
      infrastructure:80000,database_storage_monitoring:30000,ai_api_maps_notifications:70000,
      support_operations:30000,marketing_growth:60000,legal_accounting_compliance:40000,
      insurance_licences:10000,other_overhead:20000
    },
    paidProfiles:{merchant:100,supplier:20,local_services:30},
    subscriptionAmounts:{merchant:500,supplier:400,local_services:300},
    deliveryEligibleEarnings:1000000,
    deliveryProductionRatePct:5
  });
  assert.equal(s.revenue_mix.subscription_revenue,67000);
  assert.equal(s.revenue_mix.delivery_production_fee_revenue,50000);
  assert.equal(s.revenue_mix.non_transaction_platform_revenue,117000);
  assert.equal(s.revenue_mix.break_even_transaction_revenue_need,661000);
  assert.equal(s.revenue_mix.sustainable_transaction_revenue_need,738800);
  assert.equal(s.rates.mature_100pct_fee_eligible.break_even_pct,13.22);
  assert.equal(s.rates.mature_100pct_fee_eligible.sustainable_pct,14.776);
});

test('digital payment incentive defaults fail closed and require provider confirmation',()=>{
  assert.equal(DIGITAL_PAYMENT_INCENTIVE_DEFAULT.enabled,false);
  assert.equal(DIGITAL_PAYMENT_INCENTIVE_DEFAULT.provider_confirmation_required,true);
  assert.deepEqual(DIGITAL_PAYMENT_INCENTIVE_DEFAULT.eligible_roles,['merchant','supplier','local_services']);
  assert.ok(DIGITAL_PAYMENT_INCENTIVE_DEFAULT.preferred_credit_targets.includes('subscription'));
  assert.ok(DIGITAL_PAYMENT_INCENTIVE_DEFAULT.eligible_payment_methods.includes('gcash'));
  assert.ok(DIGITAL_PAYMENT_INCENTIVE_DEFAULT.eligible_payment_methods.includes('card'));
});

test('read-only Admin endpoints expose policy and 50/50 simulator without live mutation',()=>{
  assert.match(server,/\/api\/payments\/admin\/monetization-v2\/model/);
  assert.match(server,/\/api\/payments\/admin\/shared-cost-allocation-scenario/);
  assert.match(server,/allocateSharedCompanyCost50x50/);
  assert.match(server,/equalWeightPct:50/);
  assert.match(server,/driverWeightPct:50/);
  const start=server.indexOf("app.post('/api/payments/admin/shared-cost-allocation-scenario'");
  const end=server.indexOf("app.post('/api/payments/admin/commission-planner'",start);
  const block=server.slice(start,end);
  assert.doesNotMatch(block,/createFeePolicy|addFeeRule|UPDATE fee_policy|INSERT INTO fee_policy/i);
  assert.match(block,/applies_live_allocation:false/);
});

test('Admin Finance UI presents profile policy and shared cost model clearly',()=>{
  assert.match(ui,/MONETIZATION V2/);
  assert.match(ui,/Customer/);
  assert.match(ui,/Subscription \+ transaction fee/);
  assert.match(ui,/% of delivery production/);
  assert.match(ui,/Shared company cost simulator/);
  assert.match(ui,/50% equal \+ 50% activity/);
  assert.match(ui,/Digital-payment incentive/);
  assert.match(css,/\.monetizationV2Card/);
  assert.match(css,/\.sharedCostScopeRow/);
});

test('Commission Planner collects hybrid revenue assumptions',()=>{
  assert.match(ui,/Paid Merchant profiles/);
  assert.match(ui,/Merchant monthly subscription/);
  assert.match(ui,/Paid Supplier profiles/);
  assert.match(ui,/Paid Artisan \/ Local Services profiles/);
  assert.match(ui,/Monthly eligible Delivery earnings/);
  assert.match(ui,/Delivery production fee %/);
  assert.match(ui,/Subscriptions/);
  assert.match(ui,/Remaining sustainable transaction-fee revenue need/);
});

test('project syntax contract includes Monetization V2 test',()=>{
  assert.match(pkg,/node --check tests\/monetization-v2-cost-sharing\.test\.js/);
});
