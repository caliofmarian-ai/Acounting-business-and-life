import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  GUIDED_ONBOARDING_MERCHANT_STEPS,
  GUIDED_ONBOARDING_PROFILE_DEFINITIONS
} from '../guided-onboarding-core.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const core=read('guided-onboarding-core.js');
const ui=read('public/guided-onboarding.js');
const shell=read('public/shell.js');
const market=read('public/marketplace-ui.js');
const orders=read('public/orders-ui.js');
const delivery=read('public/delivery-ui.js');
const finance=read('public/business-accounting-ui.js');
const settings=read('public/profile-settings-ui.js');
const pricing=read('public/pricing-transparency.js');
const en=JSON.parse(read('public/locales/guided-onboarding.en-PH.json'));
const fil=JSON.parse(read('public/locales/guided-onboarding.fil-PH.json'));

test('Merchant has its own versioned complete journey while unfinished roles remain on V2B foundation',()=>{
  assert.equal(GUIDED_ONBOARDING_PROFILE_DEFINITIONS.merchant.version,2);
  assert.deepEqual(GUIDED_ONBOARDING_PROFILE_DEFINITIONS.merchant.steps,GUIDED_ONBOARDING_MERCHANT_STEPS);
  assert.equal(GUIDED_ONBOARDING_PROFILE_DEFINITIONS.customer.version,2);
  assert.equal(GUIDED_ONBOARDING_PROFILE_DEFINITIONS.supplier.version,2);
  assert.equal(GUIDED_ONBOARDING_PROFILE_DEFINITIONS.courier.version,2);
  assert.equal(GUIDED_ONBOARDING_PROFILE_DEFINITIONS.service_provider.version,2);
  assert.match(core,/journey_version DESC LIMIT 1/);
  assert.match(core,/normalizeProfileCompleted\(previousRow\.completed_steps,role\)/);
});

test('Merchant important operational steps come before optional promotion',()=>{
  const important=[
    'merchant_storefront_visibility',
    'merchant_catalog_ai',
    'merchant_orders_fulfilment',
    'merchant_delivery_pricing',
    'merchant_refunds',
    'merchant_finance_settlement',
    'merchant_supplier_sourcing',
    'merchant_reputation_safety'
  ];
  const promotion=GUIDED_ONBOARDING_MERCHANT_STEPS.indexOf('merchant_promotion');
  for(const step of important){
    const index=GUIDED_ONBOARDING_MERCHANT_STEPS.indexOf(step);
    assert.ok(index>0,step);
    assert.ok(index<promotion,step+' must precede optional promotion');
  }
  assert.ok(promotion<GUIDED_ONBOARDING_MERCHANT_STEPS.indexOf('profile_settings'));
});

test('Merchant tour covers storefront catalog orders delivery refunds finance suppliers safety promotion and settings',()=>{
  for(const step of [
    'merchant_storefront_visibility','merchant_catalog_ai','merchant_orders_fulfilment',
    'merchant_delivery_pricing','merchant_refunds','merchant_finance_settlement',
    'merchant_supplier_sourcing','merchant_reputation_safety','merchant_promotion','profile_settings'
  ])assert.ok(GUIDED_ONBOARDING_MERCHANT_STEPS.includes(step),step);
  assert.match(ui,/function merchantProfileJourneyDefinition/);
  assert.match(ui,/merchant_tour\.storefront_body/);
  assert.match(ui,/merchant_tour\.catalog_body/);
  assert.match(ui,/merchant_tour\.orders_body/);
  assert.match(ui,/merchant_tour\.delivery_body/);
  assert.match(ui,/merchant_tour\.refunds_body/);
  assert.match(ui,/merchant_tour\.finance_body/);
  assert.match(ui,/merchant_tour\.suppliers_body/);
  assert.match(ui,/merchant_tour\.reputation_body/);
  assert.match(ui,/merchant_tour\.promotion_body/);
});

test('Merchant tour points to real operational controls already present in the product',()=>{
  assert.match(shell,/id="ordersQuickButton"/);
  assert.match(shell,/id="marketQuickButton"/);
  assert.match(shell,/id="supQuickButton"/);
  assert.match(shell,/id="deliveryQuickButton"/);
  assert.match(shell,/data-merchant-mobile-action="profileSettings"/);
  assert.match(market,/storeLocationPanel/);
  assert.match(market,/storePresence/);
  assert.match(market,/storePublicLocation/);
  assert.match(market,/storefrontV2Media/);
  assert.match(market,/directProductForm/);
  assert.match(market,/class="merchantCatalogList"/);
  assert.match(market,/AI image draft · review before use/);
  assert.match(market,/storeReputation/);
  assert.match(market,/storeCompare/);
  assert.match(orders,/class="ordersBoard"/);
  assert.match(orders,/data-action="cancel"/);
  assert.match(delivery,/pickupLocationForm/);
  assert.match(finance,/class="businessFinancePrimary"/);
  assert.match(finance,/class="businessFinanceDetails"/);
  assert.match(pricing,/profiles\?\.merchant/);
  assert.match(pricing,/Merchant-side platform policy/);
  assert.match(settings,/profilePromotionCenter/);
});

test('Merchant tour never publishes, moves money, refunds, changes order state or switches profile automatically',()=>{
  const start=ui.indexOf('function merchantProfileJourneyDefinition');
  const end=ui.indexOf('function profileJourneyDefinition',start);
  const block=ui.slice(start,end);
  assert.doesNotMatch(block,/\.click\(|fetch\(|mapi\(|oapi\(|dapi\(|active-role|applyActiveRole|toggleProfile|publication_status\s*=|data-action=.*cancel/);
  assert.doesNotMatch(block,/payment.*POST|refund.*POST|settlement.*POST|payout.*POST/i);
  assert.doesNotMatch(core,/UPDATE profiles SET enabled=TRUE|profile_authorizations|admin_assignments/);
});

test('Merchant copy explains public visibility AI refund and finance boundaries',()=>{
  assert.match(en['merchant_tour.storefront_body'],/stays private unless you explicitly turn on public location sharing/i);
  assert.match(en['merchant_tour.catalog_body'],/AI-generated media is always a draft/i);
  assert.match(en['merchant_tour.orders_body'],/Record payment only when you actually received it/i);
  assert.match(en['merchant_tour.delivery_body'],/delivery fees are not merchandise revenue/i);
  assert.match(en['merchant_tour.refunds_body'],/refund succeeded until payment\/refund evidence confirms it/i);
  assert.match(en['merchant_tour.finance_body'],/manual records are not bank balance/i);
  assert.match(en['merchant_tour.reputation_body'],/opt-in controls/i);
  for(const key of Object.keys(en).filter(k=>k.startsWith('merchant_tour.'))){
    assert.ok(fil[key],`missing Filipino key ${key}`);
    assert.doesNotMatch(en[key],/PSGC|territory demand|expansion signal/i);
    assert.doesNotMatch(fil[key],/PSGC|territory demand|expansion signal/i);
  }
});

test('Merchant profile dispatcher uses the Merchant journey before generic profile fallback',()=>{
  const start=ui.indexOf('function profileJourneyDefinition');
  const end=ui.indexOf('function renderProfileJourney',start);
  const block=ui.slice(start,end);
  assert.match(block,/if\(role==='merchant'\)/);
  assert.match(block,/merchantProfileJourneyDefinition\(journey,label\)/);
});
