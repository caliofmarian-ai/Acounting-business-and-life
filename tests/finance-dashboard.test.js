import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const ui=readFileSync(new URL('../public/admin-console.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/admin-console.css',import.meta.url),'utf8');

test('Finance dashboard reads canonical unit economics instead of operational counts only',()=>{
  assert.match(ui,/api\/payments\/admin\/unit-economics/);
  assert.match(ui,/Platform revenue/);
  assert.match(ui,/Variable costs/);
  assert.match(ui,/Contribution/);
  assert.match(ui,/Operating profit \/ loss/);
  assert.match(ui,/Break-even transactions/);
});

test('GMV/payment volume is explicitly not presented as platform revenue',()=>{
  assert.match(ui,/Gross payment volume · context, not revenue/);
  assert.doesNotMatch(ui,/Gross payment volume · revenue/);
});

test('Finance dashboard shows per-service profitability and evidence quality',()=>{
  assert.match(ui,/Profitability by service/);
  assert.match(ui,/Cost evidence quality/);
  assert.match(ui,/Contribution margin/);
  assert.match(ui,/Net margin/);
  assert.match(ui,/evidence_breakdown/);
});

test('cost entry form is permission gated and writes to canonical finance API',()=>{
  assert.match(ui,/hasAny\(\['finance\.cost\.manage'\]\)/);
  assert.match(ui,/id="financeCostForm"/);
  assert.match(ui,/api\('\/api\/payments\/admin\/costs'/);
  assert.match(ui,/Idempotency-Key/);
  assert.match(ui,/evidence_reference/);
});

test('estimated and budget data are visibly separated from actual/accrued operating result',()=>{
  assert.match(ui,/Actual \+ accrued costs drive operating result/);
  assert.match(ui,/estimates and budgets stay visible separately/);
  assert.match(ui,/option value="estimated">Estimated/);
  assert.match(ui,/option value="budget">Budget/);
});

test('Finance dashboard stays mobile-first with dedicated KPI and form layouts',()=>{
  assert.match(css,/\.financeSummary/);
  assert.match(css,/\.financeEvidence/);
  assert.match(css,/\.financeFormGrid/);
  assert.match(css,/@media\(min-width:760px\)[\s\S]*\.financeSummary/);
});


test('Finance dashboard renders real 90-day cohort metrics without inventing paid conversion',()=>{
  assert.match(ui,/90-day promotional cohorts/);
  assert.match(ui,/Active 90-day trials/);
  assert.match(ui,/Trials started this period/);
  assert.match(ui,/Promo completions this period/);
  assert.match(ui,/Post-promo activity conversion/);
  assert.match(ui,/NOT_AVAILABLE_UNTIL_ACTIVE_FEE_POLICY/);
  assert.match(ui,/Activity conversion means an expired trial subject completed at least one later service/);
});

test('Finance dashboard does not overstate the evidenced direct promo cost as full subsidy',()=>{
  assert.match(ui,/DIRECT_PROMOTIONAL_SUBSIDY_FLOOR/);
  assert.match(ui,/minimum evidenced subsidy\/cost floor, not the full economic cost/);
  assert.doesNotMatch(ui,/No subsidy amount is inferred/);
  assert.doesNotMatch(ui,/Promo subsidy[^\n]{0,80}financeMoney\(0\)/);
});

test('Finance dashboard exposes promotional activity per service and phase',()=>{
  assert.match(ui,/Promotion activity by service/);
  assert.match(ui,/promo\.services\|\|\[\]/);
  assert.match(ui,/x\.phase/);
  assert.match(ui,/x\.gross_value/);
});


test('Pricing Lab is visibly simulation-only and exposes no activation control',()=>{
  assert.match(ui,/Pricing Lab — simulation only/);
  assert.match(ui,/No live fee is changed here/);
  assert.match(ui,/Run non-charging simulation/);
  assert.match(ui,/SIMULATION ONLY/);
  assert.doesNotMatch(ui,/Activate fee policy/);
  assert.doesNotMatch(ui,/fee-policies\/[^'"]*activate/);
});

test('Pricing Lab submits explicit hypothetical service rates to read-only scenario API',()=>{
  assert.match(ui,/id="pricingScenarioForm"/);
  assert.match(ui,/name="marketplace"[^>]*required/);
  assert.match(ui,/name="delivery"[^>]*required/);
  assert.match(ui,/name="supplier"[^>]*required/);
  assert.match(ui,/name="local_services"[^>]*required/);
  assert.match(ui,/api\('\/api\/payments\/admin\/pricing-scenario'/);
  assert.match(ui,/marketplace:Number\(fd\.get\('marketplace'\)\)/);
  assert.match(ui,/local_services:Number\(fd\.get\('local_services'\)\)/);
});

test('Pricing Lab has no prefilled commission rate that could be mistaken for an approved price',()=>{
  const start=ui.indexOf('id="pricingScenarioForm"');
  const end=ui.indexOf('id="pricingScenarioResult"',start);
  const form=ui.slice(start,end);
  assert.doesNotMatch(form,/value="(?:1|1\.5|2|3|0\.5|0\.25)"/);
  assert.match(form,/placeholder="Hypothetical %"/);
});

test('Pricing Lab distinguishes actual post-promo economics from mature-volume simulation',()=>{
  assert.match(ui,/Actual post-promo gross value/);
  assert.match(ui,/Projected revenue · post-promo actual/);
  assert.match(ui,/Projected revenue · mature simulation/);
  assert.match(ui,/Projected P\/L · post-promo actual/);
  assert.match(ui,/Projected P\/L · mature simulation/);
  assert.match(ui,/Break-even rate · total volume/);
});

test('Pricing Lab discloses shared cost and missing-cost evidence limitations',()=>{
  assert.match(ui,/Shared \/ unallocated recorded cost/);
  assert.match(ui,/Evidence boundary/);
  assert.match(ui,/missing_cost_warning/);
  assert.match(ui,/shared_cost_warning/);
});


test('Direct promotional cost is shown as an evidence floor, not full subsidy',()=>{
  assert.match(ui,/Direct promotional cost/);
  assert.match(ui,/Direct promo cost/);
  assert.match(ui,/Promo processor cost/);
  assert.match(ui,/Explicit Finance-ledger cost/);
  assert.match(ui,/Direct cost \/ promo completion/);
  assert.match(ui,/Direct cost \/ active promo subject/);
  assert.match(ui,/DIRECT_ONLY_EXCLUDES_SHARED_FIXED/);
  assert.match(ui,/DIRECT_PROMOTIONAL_SUBSIDY_FLOOR/);
  assert.match(ui,/minimum evidenced subsidy\/cost floor, not the full economic cost/);
});

test('Direct promo dashboard exposes service and phase cost attribution',()=>{
  assert.match(ui,/Direct promo cost by service/);
  assert.match(ui,/promo\.direct_cost\|\|\{\}/);
  assert.match(ui,/direct_processor_cost/);
  assert.match(ui,/direct_ledger_cost/);
  assert.match(ui,/total_direct_cost/);
  assert.match(ui,/direct_cost_per_completion/);
  assert.match(ui,/direct_cost_per_active_subject/);
});

test('Old no-attribution placeholder is removed after direct cost runtime exists',()=>{
  assert.doesNotMatch(ui,/exact subsidy per promotional transaction is not shown until/);
  assert.doesNotMatch(ui,/No subsidy amount is inferred/);
});
