import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {assertSupplierExperienceFinanceEvidence} from '../qa-acceptance.js';

const source=readFileSync(new URL('../qa-acceptance.js',import.meta.url),'utf8');

test('Supplier experience wave is registered on the isolated QA runner',()=>{
  assert.match(source,/SUPPLIER_ALIAS='dropi\.deliveries\+testsupplier@gmail\.com'/);
  assert.match(source,/SUPPLIER_EXPERIENCE_WAVE='supplier_experience_v1'/);
  assert.match(source,/runSupplierExperienceAcceptance/);
  assert.match(source,/config\.wave===SUPPLIER_EXPERIENCE_WAVE/);
});

test('Supplier acceptance uses invite-first governed onboarding',()=>{
  assert.match(source,/\/api\/governance\/admin\/invitations/);
  assert.match(source,/role:'supplier'/);
  assert.match(source,/\/api\/governance\/invitations\/\$\{invitationId\}\/accept/);
  assert.match(source,/Supplier application is not backed by an invitation/);
  assert.match(source,/\/api\/governance\/admin\/applications\/\$\{Number\(application\.id\)\}\/review/);
});

test('Supplier acceptance covers procurement, finance, notifications, Support and session recovery',()=>{
  for(const marker of [
    '/api/supplier/catalog',
    '/api/procurement/relationships/invite',
    '/api/supplier/relationships/',
    '/api/procurement/orders',
    '/api/supplier/orders/',
    '/api/accounting/finance-overview',
    '/api/settings/finance',
    'procurement.po_created',
    'procurement.po_updated',
    'procurement.payment_received',
    'supplier.relationship_invited',
    '/api/support/tickets',
    '/api/auth/logout'
  ]) assert.ok(source.includes(marker),'missing Supplier acceptance marker: '+marker);
  assert.match(source,/business_ledger_recorded_receipts/);
  assert.match(source,/business_scoped_po_paid_amount/);
  assert.match(source,/merchant_reconciliation:true/);
  assert.match(source,/live_online_payment:'HOLD_FOR_PAYMONGO_LIVE_GATE'/);
});

test('Supplier Experience uses a commit-scoped purchase-order fixture so notification lifecycle is current',()=>{
  assert.match(source,/const QA_REVISION=clean\(process\.env\.RAILWAY_GIT_COMMIT_SHA\|\|process\.env\.GITHUB_SHA/);
  assert.match(source,/SUPPLIER_QA_PO_NOTE='Controlled QA Supplier Experience PO v1 '\+QA_REVISION/);
});

const expectedFinance={supplierBusinessId:41,expectedTotal:60};
const financeFixture=()=>({
  role:'supplier',business:{id:41},
  commercial:{received_po_count:1,attribution_status:'SUPPLIER_BUSINESS_ATTRIBUTED'},
  cash_evidence:{
    business_scoped_po_paid_amount:60,business_ledger_recorded_receipts:60,
    account_level_po_paid_amount:null,attribution_status:'SUPPLIER_BUSINESS_ATTRIBUTED'
  }
});

test('Supplier Experience finance accepts canonical multi-business evidence with a null account alias',()=>{
  const overview=financeFixture(),before=structuredClone(overview);
  assert.doesNotThrow(()=>assertSupplierExperienceFinanceEvidence(overview,expectedFinance));
  assert.deepEqual(overview,before,'the assertion must not modify financial evidence');
});

test('Supplier Experience finance preserves the canonical single-business legacy alias contract',()=>{
  const overview=financeFixture();overview.cash_evidence.account_level_po_paid_amount=60;
  assert.doesNotThrow(()=>assertSupplierExperienceFinanceEvidence(overview,expectedFinance));
  overview.business.id='41';overview.commercial.received_po_count='1';
  overview.cash_evidence.business_scoped_po_paid_amount='60.00';overview.cash_evidence.business_ledger_recorded_receipts='60.00';
  assert.doesNotThrow(()=>assertSupplierExperienceFinanceEvidence(overview,expectedFinance));
});

test('Supplier Experience requests the tested PO seller business and validates that exact workspace',()=>{
  const start=source.indexOf('async function runSupplierExperienceAcceptance(');
  const end=source.indexOf('async function runSupplierDomainV2Acceptance(',start);
  const wave=source.slice(start,end);
  assert.match(wave,/const supplierBusinessId=Number\(po\.supplier_business_id\)/);
  assert.match(wave,/Number\.isSafeInteger\(supplierBusinessId\)/);
  assert.match(wave,/supplierBusinessId<=0/);
  assert.match(wave,/\/api\/accounting\/finance-overview\?business_id=\$\{supplierBusinessId\}/);
  assert.match(wave,/assertSupplierExperienceFinanceEvidence\(supplierFinance\.json,\{supplierBusinessId,expectedTotal\}\)/);
  assert.doesNotMatch(wave,/account_level_po_paid_amount/);
  assert.ok(wave.indexOf('PO seller business attribution is missing or invalid')<wave.indexOf('Supplier Finance overview'));
});

test('Supplier Experience rejects another business even when its money and fulfilled totals are large',()=>{
  const overview=financeFixture();overview.business.id=42;
  overview.commercial.received_po_count=100;
  overview.cash_evidence.business_scoped_po_paid_amount=10000;overview.cash_evidence.business_ledger_recorded_receipts=10000;
  assert.throws(()=>assertSupplierExperienceFinanceEvidence(overview,expectedFinance),/business\.id/);
});

test('Supplier Experience rejects missing or invalid expected seller business attribution',()=>{
  for(const supplierBusinessId of [undefined,null,0,-1,1.5,'unknown',Infinity,true]){
    assert.throws(()=>assertSupplierExperienceFinanceEvidence(financeFixture(),{...expectedFinance,supplierBusinessId}),/expected_supplier_business_id/);
  }
  const overview=financeFixture();delete overview.business;
  assert.throws(()=>assertSupplierExperienceFinanceEvidence(overview,expectedFinance),/business\.id/);
  overview.business={id:true};
  assert.throws(()=>assertSupplierExperienceFinanceEvidence(overview,{...expectedFinance,supplierBusinessId:1}),/business\.id/);
});

test('Supplier Experience requires the Supplier role and exact business attribution for commercial and cash evidence',()=>{
  const wrongRole=financeFixture();wrongRole.role='merchant';
  assert.throws(()=>assertSupplierExperienceFinanceEvidence(wrongRole,expectedFinance),/role/);
  for(const section of ['commercial','cash_evidence']){
    const overview=financeFixture();overview[section].attribution_status='ACCOUNT_LEVEL_UNATTRIBUTED';
    assert.throws(()=>assertSupplierExperienceFinanceEvidence(overview,expectedFinance),new RegExp(section+'\\.attribution_status'));
    delete overview[section].attribution_status;
    assert.throws(()=>assertSupplierExperienceFinanceEvidence(overview,expectedFinance),new RegExp(section+'\\.attribution_status'));
  }
});

test('missing or insufficient scoped PO payments fail despite a large account-wide total',()=>{
  for(const value of [undefined,null,0,59.99,NaN,Infinity,'invalid','',true]){
    const overview=financeFixture();overview.cash_evidence.business_scoped_po_paid_amount=value;
    overview.cash_evidence.account_level_po_paid_amount=10000;
    assert.throws(()=>assertSupplierExperienceFinanceEvidence(overview,expectedFinance),/cash_evidence\.business_scoped_po_paid_amount/);
  }
});

test('missing or insufficient business-ledger receipts cannot be replaced by PO paid totals',()=>{
  for(const value of [undefined,null,0,59.99,NaN,Infinity,'invalid','',true]){
    const overview=financeFixture();overview.cash_evidence.business_ledger_recorded_receipts=value;
    overview.cash_evidence.business_scoped_po_paid_amount=10000;overview.cash_evidence.account_level_po_paid_amount=10000;
    assert.throws(()=>assertSupplierExperienceFinanceEvidence(overview,expectedFinance),/cash_evidence\.business_ledger_recorded_receipts/);
  }
});

test('Supplier Finance money alone cannot satisfy the required received-order evidence',()=>{
  for(const count of [undefined,null,0,-1,0.5,'invalid',Infinity,true]){
    const overview=financeFixture();overview.commercial.received_po_count=count;
    assert.throws(()=>assertSupplierExperienceFinanceEvidence(overview,expectedFinance),/commercial\.received_po_count/);
  }
});

test('Supplier Finance validates a positive minimum fixture amount instead of accepting absent expectations',()=>{
  for(const expectedTotal of [undefined,null,0,-1,NaN,Infinity,'invalid','']){
    assert.throws(()=>assertSupplierExperienceFinanceEvidence(financeFixture(),{...expectedFinance,expectedTotal}),/expected_fixture_total/);
  }
});

test('Supplier Finance assertion never reads the obsolete account-wide payment alias',()=>{
  const overview=financeFixture();
  Object.defineProperty(overview.cash_evidence,'account_level_po_paid_amount',{get(){throw new Error('Account totals must not be consulted')}});
  assert.doesNotThrow(()=>assertSupplierExperienceFinanceEvidence(overview,expectedFinance));
});

test('Supplier Finance failure diagnostics contain field categories without private payload values',()=>{
  const overview=financeFixture();overview.role='PRIVATE-ROLE';overview.business={id:42,name:'PRIVATE-NAME'};
  overview.cash_evidence.attribution_status='PRIVATE-ATTRIBUTION';overview.cash_evidence.business_ledger_recorded_receipts='PRIVATE-RECEIPT';
  assert.throws(()=>assertSupplierExperienceFinanceEvidence(overview,expectedFinance),error=>{
    assert.match(error.message,/role/);assert.match(error.message,/business\.id/);
    assert.match(error.message,/cash_evidence\.attribution_status/);assert.match(error.message,/cash_evidence\.business_ledger_recorded_receipts/);
    assert.doesNotMatch(error.message,/PRIVATE-/);return true;
  });
});
