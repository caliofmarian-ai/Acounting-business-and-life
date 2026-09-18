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

test('Finance dashboard does not fabricate promotional subsidy before direct cost attribution exists',()=>{
  assert.match(ui,/Promo cost attribution/);
  assert.match(ui,/No subsidy amount is inferred/);
  assert.doesNotMatch(ui,/Promo subsidy[^\n]{0,80}financeMoney\(0\)/);
});

test('Finance dashboard exposes promotional activity per service and phase',()=>{
  assert.match(ui,/Promotion activity by service/);
  assert.match(ui,/promo\.services\|\|\[\]/);
  assert.match(ui,/x\.phase/);
  assert.match(ui,/x\.gross_value/);
});
