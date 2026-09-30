import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  GUIDED_ONBOARDING_PROFILE_DEFINITIONS,
  GUIDED_ONBOARDING_CUSTOMER_STEPS,
  GUIDED_ONBOARDING_MERCHANT_STEPS,
  GUIDED_ONBOARDING_SUPPLIER_STEPS,
  GUIDED_ONBOARDING_COURIER_STEPS,
  GUIDED_ONBOARDING_SERVICE_PROVIDER_STEPS
} from '../guided-onboarding-core.js';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const guide=read('public/guided-onboarding.js');
const css=read('public/guided-onboarding.css');
const shell=read('public/shell.js');
const market=read('public/marketplace-ui.js');
const orders=read('public/orders-ui.js');
const delivery=read('public/delivery-ui.js');
const services=read('public/services-ui.js');
const suppliers=read('public/suppliers-ui.js');
const accounting=read('public/business-accounting-ui.js');
const profileMoney=read('public/profile-money-ui.js');
const settings=read('public/profile-settings-ui.js');
const core=read('guided-onboarding-core.js');
const en=JSON.parse(read('public/locales/guided-onboarding.en-PH.json'));
const fil=JSON.parse(read('public/locales/guided-onboarding.fil-PH.json'));

const roles={
  customer:GUIDED_ONBOARDING_CUSTOMER_STEPS,
  merchant:GUIDED_ONBOARDING_MERCHANT_STEPS,
  supplier:GUIDED_ONBOARDING_SUPPLIER_STEPS,
  courier:GUIDED_ONBOARDING_COURIER_STEPS,
  service_provider:GUIDED_ONBOARDING_SERVICE_PROVIDER_STEPS
};

test('V2H audit keeps every operational profile on its own versioned V2 journey',()=>{
  for(const [role,steps] of Object.entries(roles)){
    assert.equal(GUIDED_ONBOARDING_PROFILE_DEFINITIONS[role].version,2,role);
    assert.deepEqual(GUIDED_ONBOARDING_PROFILE_DEFINITIONS[role].steps,steps,role);
    assert.equal(steps[0],'profile_welcome',role);
    assert.equal(steps.at(-1),'profile_settings',role);
    assert.ok(steps.length>=10,role+' journey is unexpectedly short');
  }
});

test('V2H important-actions matrix covers money, commitments, privacy/location, safety/recovery and settings before optional polish',()=>{
  const required={
    customer:[
      'customer_address_privacy','customer_price_payment','customer_order_commitment',
      'customer_tracking','customer_support_safety','customer_money','profile_settings'
    ],
    merchant:[
      'merchant_storefront_visibility','merchant_orders_fulfilment','merchant_delivery_pricing',
      'merchant_refunds','merchant_finance_settlement','merchant_supplier_sourcing',
      'merchant_reputation_safety','profile_settings'
    ],
    supplier:[
      'supplier_workspace_identity','supplier_catalog_availability','supplier_relationships_quotes',
      'supplier_orders_eta','supplier_exceptions','supplier_money_receivables',
      'supplier_settlement_payout','supplier_support_safety','profile_settings'
    ],
    courier:[
      'courier_eligibility_vehicle','courier_availability_area','courier_assignments_workflow',
      'courier_customer_privacy','courier_navigation_location','courier_handoff_evidence',
      'courier_money_earnings','courier_settlement_payout','courier_safety_support','profile_settings'
    ],
    service_provider:[
      'service_readiness_credentials','service_visibility_area','service_offers_pricing',
      'service_quotes_changes','service_jobs_privacy','service_work_evidence_consent',
      'service_money_payments','service_safety_compliance','profile_settings'
    ]
  };
  for(const [role,steps] of Object.entries(required)){
    const journey=roles[role];
    for(const step of steps)assert.ok(journey.includes(step),role+' missing '+step);
  }
  assert.ok(
    GUIDED_ONBOARDING_MERCHANT_STEPS.indexOf('merchant_reputation_safety')
      < GUIDED_ONBOARDING_MERCHANT_STEPS.indexOf('merchant_promotion')
  );
  assert.ok(
    GUIDED_ONBOARDING_CUSTOMER_STEPS.indexOf('customer_support_safety')
      < GUIDED_ONBOARDING_CUSTOMER_STEPS.indexOf('customer_discovery')
  );
});

test('V2H destructive and hard-to-reverse boundaries are explicitly taught instead of performed by the tutorial',()=>{
  const boundaries=[
    /Place order is the commitment point/i,
    /refund succeeded until payment\/refund evidence confirms it/i,
    /quote becomes a purchase order only when the Merchant explicitly decides/i,
    /confirmed credit.*not cash refunded/i,
    /do not ask for it early/i,
    /Customer publication consent/i,
    /job completion as media or promotion consent/i
  ];
  const allCopy=Object.values(en).join('\n');
  for(const boundary of boundaries)assert.match(allCopy,boundary);

  const roleFunctions=[
    ['customer','function customerProfileJourneyDefinition','function merchantProfileJourneyDefinition'],
    ['merchant','function merchantProfileJourneyDefinition','function supplierJourneyTarget'],
    ['supplier','function supplierProfileJourneyDefinition','function courierJourneyTarget'],
    ['courier','function courierProfileJourneyDefinition','function serviceProviderJourneyTarget'],
    ['service_provider','function serviceProviderProfileJourneyDefinition','function profileJourneyDefinition']
  ];
  for(const [role,startMarker,endMarker] of roleFunctions){
    const start=guide.indexOf(startMarker),end=guide.indexOf(endMarker,start+1);
    assert.ok(start>=0&&end>start,role+' journey block unavailable');
    const block=guide.slice(start,end);
    assert.doesNotMatch(block,/\.click\(|fetch\(|mapi\(|oapi\(|dapi\(|papi\(|sapi\(|profileApi\(/,role);
    assert.doesNotMatch(block,/active-role|applyActiveRole|toggleProfile|geolocation\.getCurrentPosition/,role);
    assert.doesNotMatch(block,/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i,role);
  }
});

test('V2H audit confirms all role-specific tutorial targets are backed by real production controls',()=>{
  const combined=[shell,market,orders,delivery,services,suppliers,accounting,profileMoney,settings].join('\n');
  const markers=[
    // Customer
    'checkoutAddress','checkoutPayment','placeOrder','data-track','lazySupportBtn','moneyHeroCustomer','requestService',
    // Merchant
    'ordersQuickButton','marketQuickButton','supQuickButton','deliveryQuickButton','storeLocationPanel','storeReputation','profilePromotionCenter',
    // Supplier
    'supplierProfile','supplierOperatingLocationForm','catalogAdd','supplierActivities','supEditSourcing','data-sup-respond','supIssueRecall',
    // Delivery
    'courierHomeStatus','courierHomeWork','courierHomeMoney','data-courier-status','data-share-location','data-complete-delivery',
    // Local Services
    'serviceReadinessForm','providerProfileForm','serviceBaseLocationForm','providerServicesForm','providerJobs','addCredential',
    // Shared settings/finance/recovery
    'profileFinancialDocuments','openAccountMoneyFromProfile','profileGuidedTutorial'
  ];
  for(const marker of markers)assert.ok(combined.includes(marker),'missing real control '+marker);

  for(const fn of [
    'customerJourneyTarget','merchantJourneyTarget','supplierJourneyTarget',
    'courierJourneyTarget','serviceProviderJourneyTarget'
  ])assert.match(guide,new RegExp('function '+fn));
});

test('V2H language audit requires complete English and Filipino copy for every guided role key',()=>{
  const prefixes=['customer_tour.','merchant_tour.','supplier_tour.','courier_tour.','service_tour.','profile_tour.','mission.'];
  const referenced=[...guide.matchAll(/tr\('([^']+)'/g)].map(x=>x[1]).filter(k=>prefixes.some(p=>k.startsWith(p)));
  assert.ok(referenced.length>80,'unexpectedly small guided copy surface');
  for(const key of new Set(referenced)){
    assert.equal(typeof en[key],'string','missing English key '+key);
    assert.ok(en[key].trim(),'empty English key '+key);
    assert.equal(typeof fil[key],'string','missing Filipino key '+key);
    assert.ok(fil[key].trim(),'empty Filipino key '+key);
  }
});

test('V2H mobile/Android layout contract keeps the coachmark inside visual viewport and safe areas',()=>{
  assert.match(guide,/window\.visualViewport/);
  assert.match(guide,/getBoundingClientRect\(\)/);
  assert.match(guide,/COACH_TARGET_GAP=14/);
  assert.match(guide,/COMPACT_BREAKPOINT=420/);
  assert.match(guide,/scrollIntoView\(\{block:'center'/);
  assert.match(css,/safe-area-inset-top/);
  assert.match(css,/safe-area-inset-bottom/);
  assert.match(css,/@media\(max-width:520px\)/);
  assert.match(css,/@media\(max-width:419px\)/);
  assert.match(css,/\.guidedSpotlight[^}]*pointer-events:none/);
  assert.match(css,/\.guidedCoach[^}]*pointer-events:auto/);
  assert.match(css,/prefers-reduced-motion:reduce/);
});

test('V2H pause, resume, restart and reopen remain persisted and role-isolated',()=>{
  for(const action of ['profile_complete_step','profile_pause','profile_resume','profile_reset','profile_complete']){
    assert.match(core,new RegExp(action));
  }
  for(const action of ['pause','resume','reset','complete_step'])assert.match(core,new RegExp("action==='"+action+"'"));
  assert.match(guide,/data-guide-pause/);
  assert.match(guide,/profile_pause/);
  assert.match(guide,/profile_resume/);
  assert.match(guide,/profile_reset/);
  assert.match(settings,/id="profileGuidedTutorial"/);
  assert.match(settings,/Open or restart the guided tutorial for this profile only/);
  assert.match(core,/PRIMARY KEY\(account_id,profile_role,journey_version\)/);
});

test('V2H Settings boundary keeps profile preferences separate from account identity and shared banking',()=>{
  assert.match(en['profile_tour.settings_body'],/Profile-specific preferences stay inside/i);
  assert.match(en['profile_tour.settings_body'],/Account identity and shared banking remain separate/i);
  assert.match(fil['profile_tour.settings_body'],/profile/i);
  assert.match(settings,/data-profile-settings-view="finance"/);
  assert.match(settings,/openAccountMoneyFromProfile/);
  assert.match(settings,/manageProfileLifecycle/);
});

test('V2H audit does not expose internal territory mechanics in user-facing role tutorial copy',()=>{
  for(const pack of [en,fil]){
    for(const [key,value] of Object.entries(pack)){
      if(!/^(customer|merchant|supplier|courier|service)_tour\./.test(key))continue;
      assert.doesNotMatch(value,/territory demand|expansion signal|re-detection/i,key);
    }
  }
});
