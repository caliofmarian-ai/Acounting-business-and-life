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
