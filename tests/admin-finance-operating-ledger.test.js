import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ADMIN_PERMISSIONS} from '../admin-authorization.js';
import {ADMIN_FUNCTION_BUNDLES} from '../admin-functions.js';
import {ADMIN_FINANCE_ENTRY_TYPES,ADMIN_FINANCE_CATEGORIES,ADMIN_BUDGET_CATEGORIES} from '../admin-finance-core.js';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const core=read('admin-finance-core.js');
const server=read('server-admin-operations.js');
const ui=read('public/admin-console.js');
const css=read('public/admin-console.css');
const pkg=read('package.json');

test('Admin Finance has a dedicated company ledger instead of reusing Customer or Merchant accounting',()=>{
  assert.match(core,/CREATE TABLE IF NOT EXISTS admin_finance_entries/);
  assert.match(core,/CREATE TABLE IF NOT EXISTS admin_finance_budgets/);
  assert.doesNotMatch(core,/INSERT INTO transactions/);
  assert.doesNotMatch(core,/profile_money_entries/);
  assert.match(ui,/Company money/);
  assert.match(ui,/Recorded company balance/);
});

test('owner distribution is separate from operating expense and payroll',()=>{
  assert.ok(ADMIN_FINANCE_ENTRY_TYPES.includes('owner_distribution'));
  assert.match(core,/owner_distribution_rule:'Owner distribution is separate from operating expense and payroll\.'/);
  assert.match(core,/entry_type='owner_distribution'/);
  assert.match(ui,/Owner withdrawal \/ distribution/);
  assert.match(ui,/not a business expense and not payroll/i);
});

test('owner distribution authority is protected for Super Admin',()=>{
  assert.ok(ADMIN_PERMISSIONS.includes('finance.owner_distribution.manage'));
  assert.match(server,/Owner distribution authority is reserved for Super Admin/);
  assert.match(server,/entryType==='owner_distribution'\?'finance\.owner_distribution\.manage':'finance\.ledger\.manage'/);
  assert.match(server,/entryType==='owner_distribution'&&rank!=='super_admin'/);
  assert.doesNotMatch(ADMIN_FUNCTION_BUNDLES.finance_accounting.permissions.join(','),/owner_distribution/);
});

test('every Admin can see a scoped Finance module while writes remain separately delegated',()=>{
  assert.match(ui,/{id:'finance',label:'Finance',any:\['admin\.console'\]}/);
  assert.match(server,/app\.get\('\/api\/admin\/finance\/operating'/);
  assert.match(server,/requirePermissionFromContext\(ctx,'admin\.console'\)/);
  assert.match(server,/finance\.ledger\.manage/);
  assert.match(server,/finance\.budget\.manage/);
});

test('Country Territory and Specialist finance are scope-limited',()=>{
  assert.match(server,/function adminFinanceScope/);
  assert.match(server,/rank==='specialist'/);
  assert.match(server,/Specialist budget requires its delegated function/);
  assert.match(server,/Specialist cannot manage another function budget/);
  assert.match(server,/Specialist finance entry requires its delegated function/);
  assert.match(core,/function_code=ANY/);
  assert.doesNotMatch(core,/function_code='' OR .*function_code=ANY/);
});

test('Admin operating budgets cover real platform activities requested by Owner',()=>{
  for(const category of ['infrastructure','apis_ai','payroll_contractors','marketing_growth','support_operations','legal_compliance','accounting_tax'])assert.ok(ADMIN_BUDGET_CATEGORIES.includes(category));
  for(const category of ['infrastructure','database','storage','monitoring_security','ai_api','maps_api','notification','payroll_contractor','legal_compliance','accounting','tax'])assert.ok(ADMIN_FINANCE_CATEGORIES.includes(category));
  assert.match(ui,/Infrastructure/);
  assert.match(ui,/API & AI/);
  assert.match(ui,/Payroll \/ contractors/);
});

test('recorded company balance never pretends to be provider or bank cash',()=>{
  assert.match(core,/recorded_company_balance/);
  assert.match(core,/provider_balance:null/);
  assert.match(core,/NOT_AVAILABLE_WITHOUT_PROVIDER_EVIDENCE/);
  assert.match(ui,/Provider\/bank balance/);
});

test('Admin finance writes are idempotent and audited',()=>{
  assert.match(core,/entry_key TEXT NOT NULL UNIQUE/);
  assert.match(server,/idempotency-key/i);
  assert.match(server,/admin_finance_entry_created/);
  assert.match(server,/admin_finance_budget_created/);
  assert.match(server,/appendAdminAudit/);
});

test('Admin Finance UI progressively discloses advanced unit economics',()=>{
  assert.match(ui,/Advanced unit economics & monetization/);
  assert.match(ui,/adminFinanceAdvanced/);
  assert.match(css,/\.adminFinanceAdvanced/);
  assert.match(ui,/Operating budgets/);
  assert.match(ui,/Recent company money/);
});

test('Finance core is syntax checked by project contract',()=>{
  assert.match(pkg,/node --check admin-finance-core\.js/);
});
