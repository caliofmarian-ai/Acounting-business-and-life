import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  PAYMONGO_PH_BENCHMARK_AS_OF,PAYMONGO_PH_PAYMENT_BENCHMARKS,
  payMongoRailCost,digitalPaymentIncentiveScenario,compareDigitalPaymentRails
} from '../digital-payment-incentive-core.js';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const server=read('server-payments.js');
const ui=read('public/admin-console.js');
const css=read('public/admin-console.css');
const pkg=read('package.json');

test('dated PayMongo benchmark registry preserves current public rates and VAT boundary',()=>{
  assert.equal(PAYMONGO_PH_BENCHMARK_AS_OF,'2026-09-19');
  assert.equal(PAYMONGO_PH_PAYMENT_BENCHMARKS.qrph.variable_rate_pct,1.34);
  assert.equal(PAYMONGO_PH_PAYMENT_BENCHMARKS.gcash.variable_rate_pct,2.23);
  assert.equal(PAYMONGO_PH_PAYMENT_BENCHMARKS.paymaya.variable_rate_pct,1.79);
  assert.equal(PAYMONGO_PH_PAYMENT_BENCHMARKS.card.variable_rate_pct,3.125);
  assert.equal(PAYMONGO_PH_PAYMENT_BENCHMARKS.card.fixed_fee_php,13.39);
  for(const x of Object.values(PAYMONGO_PH_PAYMENT_BENCHMARKS))assert.equal(x.published_fee_excludes_vat,true);
});

test('rail cost math handles percentage and fixed card fee correctly',()=>{
  assert.equal(payMongoRailCost(1000,'qrph').published_fee_before_tax,13.4);
  assert.equal(payMongoRailCost(1000,'gcash').published_fee_before_tax,22.3);
  assert.equal(payMongoRailCost(1000,'paymaya').published_fee_before_tax,17.9);
  assert.equal(payMongoRailCost(1000,'card').published_fee_before_tax,44.64);
});

test('optional provider fee tax is explicit and never silently assumed',()=>{
  const base=payMongoRailCost(1000,'qrph');
  assert.equal(base.modeled_provider_fee_tax_pct,0);
  assert.equal(base.modeled_total_processor_cost,13.4);
  const taxed=payMongoRailCost(1000,'qrph',{providerFeeTaxPct:12});
  assert.equal(taxed.modeled_provider_fee_tax,1.61);
  assert.equal(taxed.modeled_total_processor_cost,15.01);
});

test('QR Ph can support credit when modeled Cash handling cost is higher',()=>{
  const s=digitalPaymentIncentiveScenario({
    commercialAmount:1000,railCode:'qrph',
    cashHandlingCostPct:3,cashHandlingFixedCost:0,
    providerFeeTaxPct:0,returnSavingsPct:50
  });
  assert.equal(s.cash_cost_model.modeled_cash_total_cost,30);
  assert.equal(s.provider_cost.modeled_total_processor_cost,13.4);
  assert.equal(s.incentive.gross_operational_savings,16.6);
  assert.equal(s.incentive.supported_credit,8.3);
  assert.equal(s.incentive.retained_business_life_savings,8.3);
  assert.equal(s.state,'SUPPORTED');
});

test('credit is zero when digital rail is more expensive than modeled Cash handling',()=>{
  const s=digitalPaymentIncentiveScenario({
    commercialAmount:1000,railCode:'card',
    cashHandlingCostPct:3,cashHandlingFixedCost:0,
    returnSavingsPct:100
  });
  assert.equal(s.provider_cost.modeled_total_processor_cost,44.64);
  assert.equal(s.incentive.gross_operational_savings,-14.64);
  assert.equal(s.incentive.supported_credit,0);
  assert.equal(s.state,'NO_ECONOMIC_SAVINGS');
});

test('credit cap and remaining Growth budget both constrain incentive',()=>{
  const capped=digitalPaymentIncentiveScenario({
    commercialAmount:1000,railCode:'qrph',
    cashHandlingCostPct:5,returnSavingsPct:100,creditCap:10
  });
  assert.equal(capped.incentive.raw_credit,36.6);
  assert.equal(capped.incentive.supported_credit,10);
  const budgeted=digitalPaymentIncentiveScenario({
    commercialAmount:1000,railCode:'qrph',
    cashHandlingCostPct:5,returnSavingsPct:100,creditCap:10,growthBudgetRemaining:4
  });
  assert.equal(budgeted.incentive.supported_credit,4);
  assert.equal(budgeted.incentive.retained_business_life_savings,32.6);
});

test('rail comparison ranks the same ticket by modeled processor cost',()=>{
  const rows=compareDigitalPaymentRails({
    commercialAmount:1000,cashHandlingCostPct:5,returnSavingsPct:50
  });
  assert.deepEqual(rows.map(x=>x.provider_cost.rail_code),['qrph','paymaya','gcash','card']);
  assert.deepEqual(rows.map(x=>x.provider_cost.modeled_total_processor_cost),[13.4,17.9,22.3,44.64]);
});

test('digital incentive guardrails require provider confirmation and prohibit Cash surcharge',()=>{
  const s=digitalPaymentIncentiveScenario({
    commercialAmount:500,railCode:'gcash',cashHandlingCostPct:4,returnSavingsPct:50
  });
  assert.equal(s.guardrails.provider_confirmation_required,true);
  assert.equal(s.guardrails.no_cash_surcharge,true);
  assert.equal(s.guardrails.actual_provider_statement_overrides_benchmark,true);
  assert.equal(s.guardrails.activation,'NOT_PERFORMED');
  assert.deepEqual(s.guardrails.credit_targets,['subscription','future_platform_fee']);
});

test('Admin APIs are Finance-read scoped and scenario cannot mutate live fee or credits',()=>{
  assert.match(server,/\/api\/payments\/admin\/digital-payment-incentive\/benchmarks/);
  assert.match(server,/\/api\/payments\/admin\/digital-payment-incentive\/scenario/);
  assert.match(server,/digitalPaymentIncentiveScenario/);
  assert.match(server,/compareDigitalPaymentRails/);
  assert.match(server,/digital_payment_incentive_scenario_run/);
  const start=server.indexOf("app.post('/api/payments/admin/digital-payment-incentive/scenario'");
  const end=server.indexOf("app.get('/api/payments/admin/monetization-v2/model'",start);
  const block=server.slice(start,end);
  assert.match(block,/finance\.summary\.view/);
  assert.doesNotMatch(block,/createFeePolicy|addFeeRule|UPDATE fee_policy|INSERT INTO fee_policy|credit_balance|apply_credit/i);
});

test('Admin Finance shows benchmark rails and credit-ceiling inputs',()=>{
  assert.match(ui,/DIGITAL PAYMENT INCENTIVE/);
  assert.match(ui,/How much credit can a digital payment safely earn\?/);
  assert.match(ui,/Measured Cash handling cost %/);
  assert.match(ui,/Provider fee VAT\/tax %/);
  assert.match(ui,/Return to profile as credit % of savings/);
  assert.match(ui,/Growth\/Finance budget remaining/);
  assert.match(ui,/No Cash surcharge/);
  assert.match(ui,/\/api\/payments\/admin\/digital-payment-incentive\/scenario/);
  assert.match(css,/\.digitalPaymentIncentiveCard/);
  assert.match(css,/\.paymentRailBenchmarks/);
});

test('project syntax contract checks incentive core and tests',()=>{
  assert.match(pkg,/node --check digital-payment-incentive-core\.js/);
  assert.match(pkg,/node --check tests\/digital-payment-incentive-planner\.test\.js/);
});
