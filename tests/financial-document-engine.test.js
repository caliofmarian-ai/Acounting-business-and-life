import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  financialPeriodRange,FINANCIAL_DOCUMENT_TYPES,FINANCIAL_IMPACT_CLASSES,
  normalizeFinancialProfileRole
} from '../financial-document-core.js';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const core=read('financial-document-core.js');
const server=read('server-payments.js');
const pkg=read('package.json');

test('period engine returns Manila calendar boundaries for day week month and year',()=>{
  assert.deepEqual(financialPeriodRange('day','2026-09-19'),{
    period:'day',anchor:'2026-09-19',start_date:'2026-09-19',end_date_exclusive:'2026-09-20',timezone:'Asia/Manila'
  });
  assert.deepEqual(financialPeriodRange('week','2026-09-19'),{
    period:'week',anchor:'2026-09-19',start_date:'2026-09-14',end_date_exclusive:'2026-09-21',timezone:'Asia/Manila'
  });
  assert.deepEqual(financialPeriodRange('month','2026-09-19'),{
    period:'month',anchor:'2026-09-19',start_date:'2026-09-01',end_date_exclusive:'2026-10-01',timezone:'Asia/Manila'
  });
  assert.deepEqual(financialPeriodRange('year','2026-09-19'),{
    period:'year',anchor:'2026-09-19',start_date:'2026-01-01',end_date_exclusive:'2027-01-01',timezone:'Asia/Manila'
  });
});

test('Local Services alias resolves to the canonical service_provider profile role',()=>{
  assert.equal(normalizeFinancialProfileRole('local_services'),'service_provider');
  assert.equal(normalizeFinancialProfileRole('service_provider'),'service_provider');
});

test('document taxonomy distinguishes evidence from statutory fiscal validation',()=>{
  assert.ok(FINANCIAL_DOCUMENT_TYPES.includes('sale_invoice_candidate'));
  assert.ok(FINANCIAL_DOCUMENT_TYPES.includes('subscription_invoice'));
  assert.ok(FINANCIAL_DOCUMENT_TYPES.includes('profile_transfer_record'));
  assert.match(core,/fiscal_status TEXT NOT NULL DEFAULT 'internal_evidence'/);
  assert.match(core,/fiscal_candidate/);
  assert.match(core,/Internal service evidence; fiscal invoice status is determined separately/);
});

test('Financial Document Engine is a derived evidence layer and never writes source ledgers',()=>{
  assert.match(core,/CREATE TABLE IF NOT EXISTS financial_documents/);
  assert.match(core,/CREATE TABLE IF NOT EXISTS financial_document_lines/);
  assert.match(core,/CREATE TABLE IF NOT EXISTS financial_document_source_links/);
  assert.doesNotMatch(core,/INSERT INTO transactions/i);
  assert.doesNotMatch(core,/UPDATE transactions/i);
  assert.doesNotMatch(core,/INSERT INTO profile_money_entries/i);
  assert.doesNotMatch(core,/UPDATE profile_money_entries/i);
});

test('source documents are idempotent and deterministic by document_key',()=>{
  assert.match(core,/document_key TEXT NOT NULL UNIQUE/);
  assert.match(core,/createHash\('sha256'\)/);
  assert.match(core,/ON CONFLICT\(document_key\) DO NOTHING/);
  assert.match(core,/UNIQUE\(document_id,line_code\)/);
});

test('business transaction correction preserves original evidence and applies reversal plus replacement',()=>{
  assert.match(core,/original_snapshot/);
  assert.match(core,/reverse_previous/);
  assert.match(core,/apply_replacement/);
  assert.match(core,/sourceRelation:'corrects'/);
});

test('profile Money reversal remains traceable instead of deleting the original document',()=>{
  assert.match(core,/documentStatus:'active'/);
  assert.match(core,/sourceRelation:'reverses'/);
  assert.match(core,/row\.entry_type==='reversal'/);
});

test('PayMongo processor cost is not automatically counted as Merchant or Supplier expense',()=>{
  assert.match(core,/r\.charged_to/);
  assert.match(core,/merchant_deduction/);
  assert.match(core,/supplier_deduction/);
  assert.match(core,/participant_expense:explicitlyCharged/);
  assert.match(core,/Visible as separate fee context; not counted as this profile expense/);
});

test('periodic statement exposes separated financial impact classes',()=>{
  for(const impact of ['revenue','expense','purchase','cash_in','cash_out','refund_in','transfer_in','transfer_out','fee_expense','tax_expense','neutral']){
    assert.ok(FINANCIAL_IMPACT_CLASSES.includes(impact));
  }
  assert.match(core,/operating_result/);
  assert.match(core,/documented_purchases/);
  assert.match(core,/documented_refunds/);
  assert.match(core,/transfers_net/);
  assert.match(core,/source_ledgers_remain_authoritative:true/);
});

test('scoped APIs expose documents profile statements and consolidated own-account view',()=>{
  assert.match(server,/\/api\/financial-documents'/);
  assert.match(server,/\/api\/financial-documents\/:publicId/);
  assert.match(server,/\/api\/financial-statements\/consolidated\/:period/);
  assert.match(server,/\/api\/financial-statements\/:period/);
  assert.match(server,/financialDocumentScope/);
  assert.match(server,/financeScope\(me,role,rawBusinessId\)/);
  assert.match(server,/Shared business workspaces are counted once/);
  assert.match(server,/no_cross_account_or_cross_business_data:true/);
});


test('Merchant and Supplier document reads require an exact active profile-business binding',()=>{
  assert.match(server,/FROM profile_business_bindings pb/);
  assert.match(server,/pb\.account_id=\$1/);
  assert.match(server,/pb\.role=\$2/);
  assert.match(server,/pb\.business_id=\$3/);
  assert.match(server,/pb\.status='active'/);
  assert.match(server,/This business workspace is not bound to the selected financial profile/);
});

test('financial document schema is initialized by Payment Core',()=>{
  assert.match(server,/ensureFinancialDocumentSchema\(pool\)/);
  assert.match(server,/synchronizeFinancialDocumentsForScope/);
});


test('Android Statements & Documents workspace is mounted and period-aware',()=>{
  const ui=read('public/financial-documents-ui.js');
  assert.match(server,/financial-documents\.css/);
  assert.match(server,/financial-documents-ui\.js/);
  assert.match(ui,/Statements & Documents/);
  assert.match(ui,/My consolidated view/);
  for(const period of ['day','week','month','year'])assert.match(ui,new RegExp("'"+period+"'"));
  assert.match(ui,/Internal evidence/);
  assert.match(ui,/Fiscal candidate/);
  assert.match(ui,/Source ledgers remain authoritative/);
  assert.match(pkg,/node --check public\/financial-documents-ui\.js/);
});

test('package syntax contract covers the new financial-document core and tests',()=>{
  assert.match(pkg,/node --check financial-document-core\.js/);
  assert.match(pkg,/node --check tests\/financial-document-engine\.test\.js/);
});
