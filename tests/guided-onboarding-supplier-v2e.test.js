import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  GUIDED_ONBOARDING_SUPPLIER_STEPS,
  GUIDED_ONBOARDING_PROFILE_DEFINITIONS
} from '../guided-onboarding-core.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const core=read('guided-onboarding-core.js');
const ui=read('public/guided-onboarding.js');
const suppliers=read('public/suppliers-ui.js');
const shell=read('public/shell.js');
const finance=read('public/business-accounting-ui.js');
const settings=read('public/profile-settings-ui.js');
const en=JSON.parse(read('public/locales/guided-onboarding.en-PH.json'));
const fil=JSON.parse(read('public/locales/guided-onboarding.fil-PH.json'));

test('Supplier has its own versioned complete journey while unfinished roles remain on the V2B foundation',()=>{
  assert.equal(GUIDED_ONBOARDING_PROFILE_DEFINITIONS.customer.version,2);
  assert.equal(GUIDED_ONBOARDING_PROFILE_DEFINITIONS.merchant.version,2);
  assert.equal(GUIDED_ONBOARDING_PROFILE_DEFINITIONS.supplier.version,2);
  assert.equal(GUIDED_ONBOARDING_PROFILE_DEFINITIONS.courier.version,2);
  assert.equal(GUIDED_ONBOARDING_PROFILE_DEFINITIONS.service_provider.version,2);
  assert.deepEqual(GUIDED_ONBOARDING_PROFILE_DEFINITIONS.supplier.steps,GUIDED_ONBOARDING_SUPPLIER_STEPS);
  assert.match(core,/journey_version DESC LIMIT 1/);
  assert.match(core,/normalizeProfileCompleted\(previousRow\.completed_steps,role\)/);
});

test('Supplier important operational and money-risk steps precede Profile Settings',()=>{
  assert.deepEqual(GUIDED_ONBOARDING_SUPPLIER_STEPS,[
    'profile_welcome',
    'supplier_workspace_identity',
    'supplier_catalog_availability',
    'supplier_relationships_quotes',
    'supplier_orders_eta',
    'supplier_exceptions',
    'supplier_money_receivables',
    'supplier_settlement_payout',
    'supplier_support_safety',
    'profile_settings'
  ]);
  const settingsIndex=GUIDED_ONBOARDING_SUPPLIER_STEPS.indexOf('profile_settings');
  for(const step of GUIDED_ONBOARDING_SUPPLIER_STEPS.slice(1,-1)){
    assert.ok(GUIDED_ONBOARDING_SUPPLIER_STEPS.indexOf(step)<settingsIndex,step);
  }
});

test('Supplier tour covers identity catalog relationships quotes orders ETA exceptions finance settlement safety and settings',()=>{
  for(const step of [
    'supplier_workspace_identity','supplier_catalog_availability','supplier_relationships_quotes',
    'supplier_orders_eta','supplier_exceptions','supplier_money_receivables',
    'supplier_settlement_payout','supplier_support_safety','profile_settings'
  ])assert.ok(GUIDED_ONBOARDING_SUPPLIER_STEPS.includes(step),step);
  assert.match(ui,/function supplierProfileJourneyDefinition/);
  for(const key of [
    'supplier_tour.workspace_body','supplier_tour.catalog_body','supplier_tour.relationships_body',
    'supplier_tour.eta_body','supplier_tour.exceptions_body','supplier_tour.money_body',
    'supplier_tour.settlement_body','supplier_tour.support_body'
  ])assert.ok(ui.includes(key),key);
});

test('Supplier coachmarks point at real Supplier, finance and settings controls',()=>{
  for(const marker of [
    'id="supplierProfile"','id="catalogAdd"','id="supplierActivities"','id="supEditSourcing"',
    'data-rfq-quote','id="supplierRfqQuoteForm"','data-sup-respond','id="supReady"',
    'id="supDeliveryEta"','data-sup-status','data-sup-shortage','data-propose-backorder',
    'data-propose-substitution','data-return-resolve','id="supIssueRecall"'
  ])assert.ok(suppliers.includes(marker),marker);
  assert.match(shell,/supplier:\s*\[/);
  for(const feature of ['Finance & Accounting','Today','Catalog','Orders','Money']){
    assert.ok(shell.includes("'"+feature+"'"),feature);
  }
  assert.match(finance,/businessFinancePrimary/);
  assert.match(finance,/businessFinanceDetails/);
  assert.match(finance,/openBusinessFinanceSettings/);
  assert.match(settings,/id="profileFinancialDocuments"/);
  assert.match(settings,/data-profile-settings-view="finance"/);
  assert.match(settings,/id="openAccountMoneyFromProfile"/);
  assert.match(ui,/supplierJourneyTarget\('#supplierProfile','#catalogAdd','#supplierActivities'/);
  assert.match(ui,/supplierJourneyTarget\('\[data-sup-respond\]','#supReady','#supDeliveryEta'/);
  assert.match(ui,/supplierJourneyTarget\('\[data-sup-shortage\]'/);
});

test('Supplier journey is explanatory only and never changes commercial or profile state automatically',()=>{
  const start=ui.indexOf('function supplierProfileJourneyDefinition');
  const end=ui.indexOf('function profileJourneyDefinition',start);
  const block=ui.slice(start,end);
  assert.doesNotMatch(block,/\.click\(|fetch\(|mapi\(|papi\(|active-role|applyActiveRole|toggleProfile/);
  assert.doesNotMatch(block,/payment.*POST|settlement.*POST|payout.*POST|refund.*POST|status.*POST/i);
  assert.doesNotMatch(core,/UPDATE profiles SET enabled=TRUE|SET active_role|profile_authorizations|admin_assignments/);
});

test('Supplier copy preserves the commercial, settlement, visibility and compliance boundaries',()=>{
  assert.match(en['supplier_tour.welcome_body'],/Personal Account stays separate/i);
  assert.match(en['supplier_tour.workspace_body'],/not your Personal Account/i);
  assert.match(en['supplier_tour.catalog_body'],/private by default/i);
  assert.match(en['supplier_tour.catalog_body'],/only items you explicitly publish/i);
  assert.match(en['supplier_tour.relationships_body'],/quote becomes a purchase order only when the Merchant explicitly decides/i);
  assert.match(en['supplier_tour.eta_body'],/not a delivery guarantee/i);
  assert.match(en['supplier_tour.exceptions_body'],/confirmed credit.*not cash refunded/i);
  assert.match(en['supplier_tour.money_body'],/unreceived PO is not money due/i);
  assert.match(en['supplier_tour.money_body'],/platform or processor fees/i);
  assert.match(en['supplier_tour.settlement_body'],/not the same as provider-confirmed settlement/i);
  assert.match(en['supplier_tour.settlement_body'],/provider evidence confirms it/i);
  assert.match(en['supplier_tour.support_body'],/Compliance & Training guidance/i);
});

test('Every Supplier onboarding key is translated to Filipino and neither locale exposes internal territory mechanics',()=>{
  const keys=Object.keys(en).filter(k=>k.startsWith('supplier_tour.'));
  assert.ok(keys.length>=24);
  for(const key of keys){
    assert.ok(fil[key],'missing Filipino key '+key);
    assert.doesNotMatch(en[key],/PSGC|territory demand|expansion signal|re-detection/i);
    assert.doesNotMatch(fil[key],/PSGC|territory demand|expansion signal|re-detection/i);
  }
});

test('Supplier dispatcher uses the Supplier journey before generic profile fallback',()=>{
  const start=ui.indexOf('function profileJourneyDefinition');
  const end=ui.indexOf('function renderProfileJourney',start);
  const block=ui.slice(start,end);
  assert.match(block,/if\(role==='supplier'\)/);
  assert.match(block,/supplierProfileJourneyDefinition\(journey,label\)/);
});
