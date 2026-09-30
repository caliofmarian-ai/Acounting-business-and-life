import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  GUIDED_ONBOARDING_CUSTOMER_STEPS,
  GUIDED_ONBOARDING_PROFILE_DEFINITIONS
} from '../guided-onboarding-core.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const core=read('guided-onboarding-core.js');
const ui=read('public/guided-onboarding.js');
const shell=read('public/shell.js');
const market=read('public/marketplace-ui.js');
const orders=read('public/orders-ui.js');
const money=read('public/profile-money-ui.js');
const services=read('public/services-ui.js');
const en=JSON.parse(read('public/locales/guided-onboarding.en-PH.json'));
const fil=JSON.parse(read('public/locales/guided-onboarding.fil-PH.json'));

test('Customer keeps its own versioned complete journey while unfinished profiles stay on V2B foundation',()=>{
  assert.equal(GUIDED_ONBOARDING_PROFILE_DEFINITIONS.customer.version,2);
  assert.equal(GUIDED_ONBOARDING_PROFILE_DEFINITIONS.merchant.version,2);
  assert.equal(GUIDED_ONBOARDING_PROFILE_DEFINITIONS.supplier.version,2);
  assert.equal(GUIDED_ONBOARDING_PROFILE_DEFINITIONS.courier.version,2);
  assert.equal(GUIDED_ONBOARDING_PROFILE_DEFINITIONS.service_provider.version,2);
  assert.deepEqual(GUIDED_ONBOARDING_PROFILE_DEFINITIONS.customer.steps,GUIDED_ONBOARDING_CUSTOMER_STEPS);
  assert.match(core,/profileDefinition\(role\)/);
  assert.match(core,/journey_version DESC LIMIT 1/);
  assert.match(core,/normalizeProfileCompleted\(previousRow\.completed_steps,role\)/);
});

test('Customer important-risk steps come before optional discovery polish',()=>{
  const important=[
    'customer_address_privacy',
    'customer_price_payment',
    'customer_order_commitment',
    'customer_tracking',
    'customer_support_safety'
  ];
  for(let i=1;i<important.length;i++){
    assert.ok(GUIDED_ONBOARDING_CUSTOMER_STEPS.indexOf(important[i-1])<GUIDED_ONBOARDING_CUSTOMER_STEPS.indexOf(important[i]));
  }
  const discovery=GUIDED_ONBOARDING_CUSTOMER_STEPS.indexOf('customer_discovery');
  const servicesStep=GUIDED_ONBOARDING_CUSTOMER_STEPS.indexOf('customer_services');
  for(const step of important)assert.ok(GUIDED_ONBOARDING_CUSTOMER_STEPS.indexOf(step)<discovery);
  assert.ok(discovery<servicesStep);
});

test('Customer tour covers privacy price payment commitment tracking safety money discovery services and settings',()=>{
  for(const step of [
    'customer_address_privacy','customer_price_payment','customer_order_commitment','customer_tracking',
    'customer_support_safety','customer_money','customer_discovery','customer_services','profile_settings'
  ])assert.ok(GUIDED_ONBOARDING_CUSTOMER_STEPS.includes(step),step);
  assert.match(ui,/function customerProfileJourneyDefinition/);
  assert.match(ui,/customer_tour\.address_body/);
  assert.match(ui,/customer_tour\.price_body/);
  assert.match(ui,/customer_tour\.commit_body/);
  assert.match(ui,/customer_tour\.tracking_body/);
  assert.match(ui,/customer_tour\.support_body/);
  assert.match(ui,/customer_tour\.money_body/);
  assert.match(ui,/customer_tour\.discovery_body/);
  assert.match(ui,/customer_tour\.services_body/);
});

test('Customer tour points at real product controls instead of mock tutorial UI',()=>{
  assert.match(shell,/data-customer-nav-target="shop"/);
  assert.match(shell,/data-hub-feature="Orders"/);
  assert.match(shell,/data-hub-feature="Money"/);
  assert.match(shell,/data-hub-feature="Local Services"/);
  assert.match(shell,/customerSettingsLink/);
  assert.match(market,/id="checkoutAddress"/);
  assert.match(market,/data-bl-pricing="customer_checkout"/);
  assert.match(market,/id="checkoutPayment"/);
  assert.match(market,/class="placeOrder"/);
  assert.match(orders,/data-track=/);
  assert.match(money,/moneyHeroCustomer/);
  assert.match(services,/id="requestService"/);
  assert.match(ui,/customerJourneyTarget\('#checkoutAddressLabel','#checkoutAddress'/);
  assert.match(ui,/customerJourneyTarget\('\[data-bl-pricing="customer_checkout"\]'/);
  assert.match(ui,/customerJourneyTarget\('\[data-track\]'/);
  assert.match(ui,/customerJourneyTarget\('#lazySupportBtn'/);
});

test('Customer journey never auto-places orders, pays, switches profiles or grants permissions',()=>{
  const start=ui.indexOf('function customerProfileJourneyDefinition');
  const end=ui.indexOf('function profileJourneyDefinition',start);
  const block=ui.slice(start,end);
  assert.doesNotMatch(block,/submitCheckout|placeOrder\.click|paymentPay\.click|active-role|applyActiveRole|toggleProfile|geolocation\.getCurrentPosition/);
  assert.doesNotMatch(core,/UPDATE profiles SET enabled=TRUE|profile_authorizations|admin_assignments/);
});

test('Customer copy explains key financial and privacy boundaries without exposing internal territory mechanics',()=>{
  assert.match(en['customer_tour.address_body'],/home address stays private/i);
  assert.match(en['customer_tour.price_body'],/delivery charge/i);
  assert.match(en['customer_tour.commit_body'],/Place order is the commitment point/i);
  assert.match(en['customer_tour.money_body'],/not business accounting or a bank\/provider balance/i);
  assert.match(en['customer_tour.support_body'],/Do not post private addresses/i);
  for(const key of Object.keys(en).filter(k=>k.startsWith('customer_tour.'))){
    assert.ok(fil[key],`missing Filipino key ${key}`);
    assert.doesNotMatch(en[key],/PSGC|territory demand|expansion signal/i);
    assert.doesNotMatch(fil[key],/PSGC|territory demand|expansion signal/i);
  }
});

test('Customer journey listens for the real checkout render so coachmarks can follow visible checkout controls',()=>{
  assert.match(market,/abl:marketplace-checkout-rendered/);
  assert.match(ui,/addEventListener\('abl:marketplace-checkout-rendered'/);
});
