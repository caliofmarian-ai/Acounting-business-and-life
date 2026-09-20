import crypto from 'node:crypto';
import { payMongoRuntimeConfig } from './paymongo-adapter.js';

const COURIER_QA_ORDER_NOTE='Controlled QA Courier Delivery E2E v1';
const COURIER_QA_DOCUMENT_REFERENCE='QA-COURIER-ID-V1';
const COURIER_QA_PRODUCT='QA Bottled Juice';
const QA_PICKUP={lat:14.5995,lng:120.9842};
const QA_DROPOFF={lat:14.6010,lng:120.9860};
const QA_IDENTITY_IMAGE='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlWhVQAAAAASUVORK5CYII=';

const clean=(value,max=300)=>String(value??'').trim().slice(0,max);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function latestCourierApplication(pool,accountId){
  const q=await pool.query(
    "SELECT * FROM profile_applications WHERE account_id=$1 AND role='courier' ORDER BY id DESC LIMIT 1",
    [Number(accountId)]
  );
  return q.rows[0]||null;
}

async function ensureCourierGovernance({pool,base,courier,courierEmail,adminToken,territoryId,requestJson,expectStatus,ensureActiveRole}){
  let application=await latestCourierApplication(pool,courier.accountId);
  let invitationId=Number(application?.invitation_id||0);

  if(!invitationId){
    if(application?.status==='approved')throw new Error('Courier approval is missing required invitation evidence.');
    const invited=await requestJson(base,'/api/governance/admin/invitations',{
      method:'POST',
      token:adminToken,
      body:{
        role:'courier',
        target_email:courierEmail,
        territory_id:territoryId,
        expires_days:7,
        note:'Controlled internal QA Courier invitation. Not a real Courier.'
      }
    });
    expectStatus(invited,201,'Courier Admin invitation');
    invitationId=Number(invited.json?.id);
    if(!invitationId)throw new Error('Courier invitation did not return an id.');

    const accepted=await requestJson(base,'/api/governance/invitations/'+invitationId+'/accept',{
      method:'POST',token:courier.token,body:{}
    });
    expectStatus(accepted,200,'Courier invitation acceptance');
  }

  application=await latestCourierApplication(pool,courier.accountId);
  if(!application?.invitation_id)throw new Error('Courier application is not backed by an invitation.');

  if(['application_started','requirements_pending','rejected'].includes(application.status)){
    const edited=await requestJson(base,'/api/governance/applications/'+Number(application.id),{
      method:'PUT',
      token:courier.token,
      body:{
        proposed_business_name:'Business & Life QA Courier',
        applicant_note:'Controlled internal QA Courier fixture. Not a real delivery provider.',
        responsibility_acknowledged:true,
        application_data:{
          test_fixture:true,
          activity_type:'parcel_delivery',
          vehicle_type:'bicycle',
          passenger_transport_requested:false,
          onboarding_version:'courier-experience-v1'
        }
      }
    });
    expectStatus(edited,200,'Courier application edit');

    const submitted=await requestJson(base,'/api/governance/applications/'+Number(application.id)+'/submit',{
      method:'POST',token:courier.token,body:{}
    });
    expectStatus(submitted,200,'Courier application submit');
  }

  application=await latestCourierApplication(pool,courier.accountId);
  if(['submitted','under_review'].includes(application?.status)){
    const reviewed=await requestJson(base,'/api/governance/admin/applications/'+Number(application.id)+'/review',{
      method:'POST',
      token:adminToken,
      body:{decision:'approve',reason:'Controlled internal QA Courier acceptance fixture'}
    });
    expectStatus(reviewed,200,'Courier Admin profile approval');
  }

  const profile=await pool.query(
    "SELECT enabled,status FROM profiles WHERE account_id=$1 AND role='courier'",
    [courier.accountId]
  );
  if(!profile.rows[0]?.enabled||profile.rows[0]?.status!=='active'){
    throw new Error('Courier profile did not become active.');
  }
  const authorization=await pool.query(
    "SELECT id,status FROM profile_authorizations WHERE account_id=$1 AND role='courier' AND territory_id=$2 ORDER BY id DESC LIMIT 1",
    [courier.accountId,territoryId]
  );
  if(authorization.rows[0]?.status!=='active')throw new Error('Courier authorization did not become active.');

  await ensureActiveRole({base,token:courier.token,role:'courier',label:'Courier Experience QA'});
  return{
    applicationId:Number(application?.id||0),
    invitationId,
    authorizationId:Number(authorization.rows[0]?.id||0)
  };
}

async function configureCourierEligibility({pool,base,courier,adminToken,requestJson,expectStatus}){
  const profileSaved=await requestJson(base,'/api/courier',{
    method:'PATCH',
    token:courier.token,
    body:{
      display_name:'Business & Life QA Courier',
      vehicle_type:'bicycle',
      available:false,
      max_weight_kg:20,
      max_volume_l:80,
      service_radius_km:25
    }
  });
  expectStatus(profileSaved,200,'Courier profile configuration');

  let document=(await pool.query(
    "SELECT id,verification_status FROM courier_documents WHERE account_id=$1 AND reference_number=$2 ORDER BY id DESC LIMIT 1",
    [courier.accountId,COURIER_QA_DOCUMENT_REFERENCE]
  )).rows[0]||null;

  if(!document){
    const uploaded=await requestJson(base,'/api/courier/documents',{
      method:'POST',
      token:courier.token,
      body:{
        document_type:'identity_support',
        vehicle_class:'bicycle',
        reference_number:COURIER_QA_DOCUMENT_REFERENCE,
        evidence_data_url:QA_IDENTITY_IMAGE
      }
    });
    expectStatus(uploaded,201,'Courier QA identity evidence');
    document=uploaded.json;
  }

  const approved=await requestJson(base,'/api/admin/couriers/'+courier.accountId,{
    method:'PATCH',
    token:adminToken,
    body:{
      eligibility_status:'approved',
      approved_vehicle_class:'bicycle',
      eligibility_expires_at:'2030-12-31',
      approval_note:'Controlled internal QA Courier eligibility.',
      document_updates:[{id:Number(document.id),status:'verified',rejection_reason:''}]
    }
  });
  expectStatus(approved,200,'Courier eligibility approval');

  const available=await requestJson(base,'/api/courier/availability',{
    method:'PUT',token:courier.token,body:{available:true}
  });
  expectStatus(available,200,'Courier availability enable');

  const current=await requestJson(base,'/api/courier/delivery-profile',{token:courier.token});
  expectStatus(current,200,'Courier delivery profile');
  const p=current.json?.profile;
  const docs=Array.isArray(current.json?.documents)?current.json.documents:[];
  const qaDoc=docs.find(x=>Number(x.id)===Number(document.id));
  if(!p||p.eligibility_status!=='approved'||p.available!==true||p.approved_vehicle_class!=='bicycle'){
    throw new Error('Courier eligibility/availability state is not operational.');
  }
  if(qaDoc?.verification_status!=='verified')throw new Error('Courier QA identity evidence was not verified.');
  return{documentId:Number(document.id)};
}

async function configureQaDeliveryPricing({base,adminToken,requestJson,expectStatus}){
  const configured=await requestJson(base,'/api/admin/delivery/pricing',{
    method:'PUT',
    token:adminToken,
    body:{
      active:true,
      route_factor:1.15,
      average_speed_bicycle_kmh:15,
      average_speed_motorbike_kmh:30,
      average_speed_car_kmh:25,
      vehicle_rules:[
        {
          vehicle_class:'bicycle',formula_type:'base_plus_km',priority:1,
          base_fee:30,per_km:10,per_kg:0,per_liter:0,minimum_fee:30,
          maximum_distance_km:20,max_weight_kg:5,max_volume_l:20
        },
        {
          vehicle_class:'car',formula_type:'distance_weight_volume',priority:2,
          base_fee:50,per_km:12,per_kg:2,per_liter:0.5,minimum_fee:50,
          maximum_distance_km:50,max_weight_kg:100,max_volume_l:400
        },
        {
          vehicle_class:'van',formula_type:'distance_weight_volume',priority:3,
          base_fee:80,per_km:15,per_kg:1.5,per_liter:0.4,minimum_fee:80,
          maximum_distance_km:100,max_weight_kg:1000,max_volume_l:3000
        }
      ]
    }
  });
  expectStatus(configured,200,'QA Delivery V2 pricing');
  const classes=new Set((configured.json?.vehicle_rules||[]).map(x=>x.vehicle_class));
  for(const cls of ['bicycle','car','van'])if(!classes.has(cls))throw new Error('QA Delivery pricing is missing '+cls+'.');
  return Number(configured.json?.version||0);
}

async function enableQaMerchantDelivery({base,token,businessId,requestJson,expectStatus}){
  const store=await requestJson(base,'/api/merchant/storefront?business_id='+businessId,{token});
  expectStatus(store,200,'Courier QA Merchant storefront');

  const saved=await requestJson(base,'/api/merchant/storefront',{
    method:'PUT',
    token,
    body:{
      business_id:businessId,
      store_name:store.json?.store_name||'Business & Life QA Fish Kitchen',
      description:store.json?.description||'Internal QA storefront for Business & Life acceptance testing. Not a real merchant.',
      merchant_domain:store.json?.merchant_domain||'mixed',
      publication_status:'published',
      pickup_address:'Internal QA — Philippines',
      opening_status:'open',
      preparation_eta_minutes:15,
      pickup_enabled:true,
      delivery_enabled:true,
      cash_enabled:true,
      online_enabled:true,
      public_reputation_enabled:false,
      price_comparison_enabled:false
    }
  });
  expectStatus(saved,200,'Courier QA Merchant delivery enable');

  const location=await requestJson(base,'/api/delivery/store-location',{
    method:'PUT',
    token,
    body:{business_id:businessId,lat:QA_PICKUP.lat,lng:QA_PICKUP.lng}
  });
  expectStatus(location,200,'Courier QA Merchant pickup location');
}

async function publicCourierBasket({base,token,businessId,requestJson,expectStatus}){
  const store=await requestJson(base,'/api/marketplace/storefronts/'+businessId,{token});
  expectStatus(store,200,'Courier QA Customer storefront');
  const products=Array.isArray(store.json?.products)?store.json.products:[];
  const product=products.find(x=>x.name===COURIER_QA_PRODUCT);
  if(!product?.id)throw new Error('Courier QA Marketplace product is unavailable.');
  return[{product_id:Number(product.id),quantity:1}];
}

async function signedQaPayMongoWebhook({base,intent,checkoutSessionId}){
  const cfg=payMongoRuntimeConfig();
  if(cfg.mode!=='test')throw new Error('Courier QA refuses to simulate a PayMongo payment outside test mode.');
  if(!cfg.webhookSecret)throw new Error('Courier QA requires the configured PayMongo test webhook secret.');

  const amountCents=Math.round(Number(intent.amount)*100);
  const providerIntentId='pi_qa_courier_'+Number(intent.id);
  const payload={
    data:{
      id:'evt_qa_courier_'+Number(intent.id),
      type:'checkout_session.payment.paid',
      data:{
        id:checkoutSessionId,
        type:'checkout_session',
        attributes:{
          metadata:{bl_payment_intent_public_id:String(intent.public_id)},
          payments:[{
            id:'pay_qa_courier_'+Number(intent.id),
            type:'payment',
            attributes:{
              status:'paid',
              amount:amountCents,
              currency:'PHP',
              fee:0,
              net_amount:amountCents,
              source:{type:'qrph'},
              payment_intent_id:providerIntentId
            }
          }],
          payment_intent:{id:providerIntentId}
        }
      }
    }
  };
  const raw=JSON.stringify(payload);
  const ts=Math.floor(Date.now()/1000);
  const signature=crypto.createHmac('sha256',cfg.webhookSecret).update(String(ts)+'.').update(raw).digest('hex');
  const response=await fetch(base+'/api/payments/webhooks/paymongo',{
    method:'POST',
    headers:{
      Accept:'application/json',
      'Content-Type':'application/json',
      'paymongo-signature':'t='+ts+',te='+signature
    },
    body:raw
  });
  const json=await response.json().catch(()=>({}));
  if(response.status!==200)throw new Error('Courier QA PayMongo webhook returned an unexpected status.');
  return json;
}

async function ensureQaDigitalPayment({pool,base,customer,orderId,requestJson,expectStatus}){
  let order=await requestJson(base,'/api/orders/'+orderId,{token:customer.token});
  expectStatus(order,200,'Courier QA order before digital payment');
  if(order.json?.payment_status==='paid')return order.json;

  const intentResult=await requestJson(base,'/api/payments/intents/order/'+orderId,{
    method:'POST',
    token:customer.token,
    body:{
      idempotency_key:'qa-courier-order-'+orderId,
      provider_code:'paymongo',
      logical_method:'qrph',
      client_reference:'QA Courier Delivery E2E'
    }
  });
  expectStatus(intentResult,201,'Courier QA payment intent');
  const intent=intentResult.json;
  if(!intent?.public_id||!intent?.id)throw new Error('Courier QA payment intent is invalid.');

  if(intent.status!=='succeeded'){
    const checkout=await requestJson(base,'/api/payments/paymongo/checkout/'+encodeURIComponent(intent.public_id),{
      method:'POST',token:customer.token,body:{}
    });
    expectStatus(checkout,[200,201],'Courier QA PayMongo sandbox checkout');
    const sessionId=clean(checkout.json?.checkout_session_id,220);
    if(!sessionId)throw new Error('Courier QA PayMongo sandbox checkout did not return a session id.');
    await signedQaPayMongoWebhook({base,intent:checkout.json?.intent||intent,checkoutSessionId:sessionId});
  }

  order=await requestJson(base,'/api/orders/'+orderId,{token:customer.token});
  expectStatus(order,200,'Courier QA order after digital payment');
  if(order.json?.payment_status!=='paid'||Number(order.json?.outstanding_amount||0)>0.001){
    throw new Error('Courier QA digital payment did not make the order fully paid.');
  }

  const evidence=await pool.query(
    "SELECT op.id,op.provider_code,op.status,op.delivery_amount,pi.status intent_status FROM order_payments op JOIN payment_intents pi ON pi.id=op.payment_intent_id WHERE op.order_id=$1 AND op.status='confirmed' ORDER BY op.id DESC LIMIT 1",
    [orderId]
  );
  if(evidence.rows[0]?.provider_code!=='paymongo'||evidence.rows[0]?.intent_status!=='succeeded'||Number(evidence.rows[0]?.delivery_amount||0)<=0){
    throw new Error('Courier QA PayMongo payment evidence is incomplete.');
  }
  return order.json;
}

async function deliveryDetail({base,token,deliveryId,requestJson,expectStatus,label}){
  const result=await requestJson(base,'/api/delivery/'+deliveryId+'/live',{token});
  expectStatus(result,200,label);
  return result.json;
}

async function advanceCourierDelivery({base,courierToken,deliveryId,requestJson,expectStatus}){
  let d=await deliveryDetail({
    base,token:courierToken,deliveryId,requestJson,expectStatus,label:'Courier assigned delivery detail'
  });
  const sequence=[
    ['courier_assigned','courier_en_route_to_merchant'],
    ['courier_en_route_to_merchant','courier_arrived_at_merchant'],
    ['courier_arrived_at_merchant','picked_up'],
    ['picked_up','in_transit'],
    ['in_transit','courier_arrived_at_customer']
  ];
  for(const [from,to] of sequence){
    if(d.status===from){
      const moved=await requestJson(base,'/api/courier/deliveries/'+deliveryId+'/status',{
        method:'POST',token:courierToken,body:{status:to}
      });
      expectStatus(moved,200,'Courier delivery status '+to);
      d=moved.json;
    }
  }
  if(d.status!=='courier_arrived_at_customer')throw new Error('Courier delivery did not reach Customer arrival.');
  return d;
}

async function verifyDeliveryNotifications({base,customerToken,merchantToken,courierToken,deliveryId,requestJson,expectStatus}){
  const requiredCustomer=['delivery.assigned','delivery.picked_up','delivery.in_transit','delivery.arrived','delivery.completed'];
  const requiredMerchant=[...requiredCustomer];
  const requiredCourier=['delivery.assigned'];
  let customerRows=[],merchantRows=[],courierRows=[];

  for(let attempt=0;attempt<25;attempt++){
    const [customer,merchant,courier]=await Promise.all([
      requestJson(base,'/api/notifications?limit=150',{token:customerToken}),
      requestJson(base,'/api/notifications?limit=150',{token:merchantToken}),
      requestJson(base,'/api/notifications?limit=150',{token:courierToken})
    ]);
    expectStatus(customer,200,'Customer Delivery notifications');
    expectStatus(merchant,200,'Merchant Delivery notifications');
    expectStatus(courier,200,'Courier Delivery notifications');

    const pick=result=>(Array.isArray(result.json)?result.json:[]).filter(
      x=>x.entity_type==='delivery'&&Number(x.entity_id)===Number(deliveryId)
    );
    customerRows=pick(customer);merchantRows=pick(merchant);courierRows=pick(courier);
    const has=(rows,codes)=>codes.every(code=>rows.some(x=>x.event_code===code));
    if(has(customerRows,requiredCustomer)&&has(merchantRows,requiredMerchant)&&has(courierRows,requiredCourier)){
      return{customer:customerRows.length,merchant:merchantRows.length,courier:courierRows.length};
    }
    await sleep(100);
  }
  for(const code of requiredCustomer)if(!customerRows.some(x=>x.event_code===code))throw new Error('Customer delivery notification lifecycle is missing '+code+'.');
  for(const code of requiredMerchant)if(!merchantRows.some(x=>x.event_code===code))throw new Error('Merchant delivery notification lifecycle is missing '+code+'.');
  for(const code of requiredCourier)if(!courierRows.some(x=>x.event_code===code))throw new Error('Courier delivery notification lifecycle is missing '+code+'.');
  return{customer:customerRows.length,merchant:merchantRows.length,courier:courierRows.length};
}

async function ensureCourierSupportTicket({pool,base,courier,deliveryId,requestJson,expectStatus}){
  const subject='Controlled QA Courier support E2E delivery '+deliveryId;
  const existing=await pool.query(
    "SELECT id FROM support_tickets WHERE requester_account_id=$1 AND subject=$2 ORDER BY id DESC LIMIT 1",
    [courier.accountId,subject]
  );
  let ticketId=Number(existing.rows[0]?.id||0);
  if(!ticketId){
    const created=await requestJson(base,'/api/support/tickets',{
      method:'POST',
      token:courier.token,
      body:{
        category:'other',
        subject,
        description:'Controlled internal QA Courier support request linked to a delivery. No real delivery issue.',
        requested_destination:'support',
        related_type:'delivery',
        related_id:Number(deliveryId),
        source_language:'en-PH'
      }
    });
    expectStatus(created,201,'Courier Support ticket create');
    ticketId=Number(created.json?.id);
  }
  if(!ticketId)throw new Error('Courier Support ticket was not created.');

  const detail=await requestJson(base,'/api/support/tickets/'+ticketId,{token:courier.token});
  expectStatus(detail,200,'Courier Support ticket detail');
  if(detail.json?.related_type!=='delivery'||Number(detail.json?.related_id)!==Number(deliveryId)){
    throw new Error('Courier Support ticket lost its Delivery context.');
  }
  return ticketId;
}

export async function runCourierExperienceAcceptance({
  pool,base,secret,
  aliases,
  helpers
}){
  const {
    requestJson,expectStatus,qaAccountSession,runCustomerOnboarding,runMerchantCatalogSeed,
    ensureQaTerritory,ensureActiveRole,loginWithCredential
  }=helpers;

  const customerPrerequisite=await runCustomerOnboarding({pool,base,secret});
  if(customerPrerequisite.status!=='PASS')throw new Error('Customer prerequisite did not pass.');
  const merchantSeed=await runMerchantCatalogSeed({pool,base,secret});
  if(merchantSeed.status!=='PASS')throw new Error('Merchant catalog prerequisite did not pass.');

  const [admin,courier,merchant,customer]=await Promise.all([
    qaAccountSession({pool,base,secret,email:aliases.superAdmin,role:'super_admin',label:'Courier Experience Super Admin QA'}),
    qaAccountSession({pool,base,secret,email:aliases.courier,role:'courier',label:'Courier Experience QA'}),
    qaAccountSession({pool,base,secret,email:aliases.merchant,role:'merchant',label:'Courier Experience Merchant QA'}),
    qaAccountSession({pool,base,secret,email:aliases.customer,role:'customer',label:'Courier Experience Customer QA'})
  ]);

  const territoryId=await ensureQaTerritory({pool,base,adminToken:admin.token});
  const governance=await ensureCourierGovernance({
    pool,base,courier,courierEmail:aliases.courier,adminToken:admin.token,territoryId,requestJson,expectStatus,ensureActiveRole
  });
  await ensureActiveRole({base,token:merchant.token,role:'merchant',label:'Courier Experience Merchant QA'});
  await ensureActiveRole({base,token:customer.token,role:'customer',label:'Courier Experience Customer QA'});

  const eligibility=await configureCourierEligibility({
    pool,base,courier,adminToken:admin.token,requestJson,expectStatus
  });

  const businessId=Number(merchantSeed.business_id);
  if(!businessId)throw new Error('Courier Experience Merchant business is unavailable.');
  await enableQaMerchantDelivery({base,token:merchant.token,businessId,requestJson,expectStatus});
  const pricingVersion=await configureQaDeliveryPricing({base,adminToken:admin.token,requestJson,expectStatus});
  const basket=await publicCourierBasket({base,token:customer.token,businessId,requestJson,expectStatus});

  const existing=await pool.query(
    "SELECT o.id order_id,o.order_status,o.payment_status,d.id delivery_id,d.status delivery_status FROM orders o LEFT JOIN deliveries d ON d.order_id=o.id WHERE o.business_id=$1 AND o.customer_account_id=$2 AND o.note=$3 AND o.order_status<>'cancelled' ORDER BY o.id DESC LIMIT 1",
    [businessId,customer.accountId,COURIER_QA_ORDER_NOTE]
  );

  let orderId=Number(existing.rows[0]?.order_id||0);
  let deliveryId=Number(existing.rows[0]?.delivery_id||0);
  let quoteFee=0;

  if(!orderId||!deliveryId){
    const quote=await requestJson(base,'/api/delivery/quote',{
      method:'POST',
      token:customer.token,
      body:{
        business_id:businessId,
        dropoff_lat:QA_DROPOFF.lat,
        dropoff_lng:QA_DROPOFF.lng,
        items:basket
      }
    });
    expectStatus(quote,201,'Courier QA delivery quote');
    if(quote.json?.required_vehicle_class!=='bicycle')throw new Error('Courier QA quote did not select bicycle.');
    quoteFee=Number(quote.json?.fee||0);
    if(!(quoteFee>0))throw new Error('Courier QA delivery quote fee is invalid.');

    const checkout=await requestJson(base,'/api/marketplace/checkout',{
      method:'POST',
      token:customer.token,
      body:{
        business_id:businessId,
        items:basket,
        fulfilment_method:'delivery',
        payment_method:'online',
        delivery_quote_id:Number(quote.json.id),
        delivery_address:'Internal QA customer destination — Philippines',
        note:COURIER_QA_ORDER_NOTE
      }
    });
    expectStatus(checkout,201,'Courier QA delivery checkout');
    orderId=Number(checkout.json?.id);
    deliveryId=Number(checkout.json?.delivery_id);
    if(!orderId||!deliveryId)throw new Error('Courier QA delivery checkout did not create order and delivery ids.');
  }

  let order=await ensureQaDigitalPayment({
    pool,base,customer,orderId,requestJson,expectStatus
  });

  if(order.order_status==='accepted'){
    const started=await requestJson(base,'/api/orders/merchant/'+orderId+'/start',{
      method:'POST',token:merchant.token,body:{}
    });
    expectStatus(started,200,'Courier QA Merchant preparation start');
    order=started.json;
  }
  if(order.order_status==='preparing'){
    const ready=await requestJson(base,'/api/orders/merchant/'+orderId+'/ready',{
      method:'POST',token:merchant.token,body:{}
    });
    expectStatus(ready,200,'Courier QA Merchant ready');
    order=ready.json;
  }
  if(!['ready','handoff_to_delivery','completed'].includes(order.order_status)){
    throw new Error('Courier QA order did not reach a dispatchable state.');
  }

  let delivery=await deliveryDetail({
    base,token:merchant.token,deliveryId,requestJson,expectStatus,label:'Courier QA Merchant delivery state'
  });

  if(['quoted','requested'].includes(delivery.status)){
    const requested=await requestJson(base,'/api/delivery/'+deliveryId+'/request-courier',{
      method:'POST',token:merchant.token,body:{}
    });
    expectStatus(requested,200,'Merchant request Courier');
    delivery=requested.json;
  }

  if(delivery.status==='awaiting_courier'){
    const eligible=await requestJson(base,'/api/admin/delivery/eligible-couriers',{token:admin.token});
    expectStatus(eligible,200,'Admin eligible Courier list');
    if(!(Array.isArray(eligible.json)?eligible.json:[]).some(x=>Number(x.account_id)===courier.accountId)){
      throw new Error('Approved QA Courier is missing from eligible dispatch list.');
    }
    const assigned=await requestJson(base,'/api/admin/deliveries/'+deliveryId+'/assign',{
      method:'POST',token:admin.token,body:{courier_account_id:courier.accountId}
    });
    expectStatus(assigned,200,'Admin Courier assignment');
    delivery=assigned.json;
  }
  if(Number(delivery.courier_account_id)!==courier.accountId){
    throw new Error('Courier QA delivery was assigned to the wrong account.');
  }

  if(delivery.status!=='delivered'){
    delivery=await advanceCourierDelivery({
      base,courierToken:courier.token,deliveryId,requestJson,expectStatus
    });

    const located=await requestJson(base,'/api/courier/deliveries/'+deliveryId+'/location',{
      method:'POST',
      token:courier.token,
      body:{lat:QA_DROPOFF.lat-0.0004,lng:QA_DROPOFF.lng-0.0004}
    });
    expectStatus(located,200,'Courier live location');

    const customerLive=await deliveryDetail({
      base,token:customer.token,deliveryId,requestJson,expectStatus,label:'Customer live Delivery'
    });
    if(customerLive.status!=='courier_arrived_at_customer'||!customerLive.last_lat||!customerLive.last_lng){
      throw new Error('Customer live Delivery does not expose active Courier location.');
    }
    const completionCode=clean(customerLive.completion_code,20);
    if(!/^\d{6}$/.test(completionCode))throw new Error('Customer Delivery completion code is unavailable.');

    const wrongCode=completionCode==='000000'?'000001':'000000';
    const denied=await requestJson(base,'/api/courier/deliveries/'+deliveryId+'/complete',{
      method:'POST',token:courier.token,body:{completion_code:wrongCode}
    });
    expectStatus(denied,403,'Courier incorrect completion-code denial');

    const completed=await requestJson(base,'/api/courier/deliveries/'+deliveryId+'/complete',{
      method:'POST',token:courier.token,body:{completion_code:completionCode}
    });
    expectStatus(completed,200,'Courier Delivery completion');
    delivery=completed.json;
  }

  if(delivery.status!=='delivered')throw new Error('Courier QA delivery did not complete.');

  const [customerFinal,merchantDeliveries,courierProfile]=await Promise.all([
    deliveryDetail({base,token:customer.token,deliveryId,requestJson,expectStatus,label:'Customer final Delivery'}),
    requestJson(base,'/api/delivery/merchant?business_id='+businessId,{token:merchant.token}),
    requestJson(base,'/api/courier/delivery-profile',{token:courier.token})
  ]);
  expectStatus(merchantDeliveries,200,'Merchant final Delivery list');
  expectStatus(courierProfile,200,'Courier final Delivery profile');

  if(customerFinal.status!=='delivered'||customerFinal.last_lat!=null||customerFinal.last_lng!=null||customerFinal.completion_code!=null){
    throw new Error('Completed Delivery did not close Customer live tracking safely.');
  }
  if(!(Array.isArray(merchantDeliveries.json)?merchantDeliveries.json:[]).some(x=>Number(x.id)===deliveryId&&x.status==='delivered')){
    throw new Error('Merchant does not see the completed Delivery.');
  }
  if(!(courierProfile.json?.deliveries||[]).some(x=>Number(x.id)===deliveryId&&x.status==='delivered')){
    throw new Error('Courier does not see the completed Delivery.');
  }

  const finalOrder=await requestJson(base,'/api/orders/'+orderId,{token:customer.token});
  expectStatus(finalOrder,200,'Customer completed delivery order');
  if(finalOrder.json?.order_status!=='completed'||finalOrder.json?.payment_status!=='paid'){
    throw new Error('Delivery completion did not complete the linked paid order.');
  }

  const finance=await requestJson(base,'/api/profile-money/courier',{token:courier.token});
  expectStatus(finance,200,'Courier Money');
  if(finance.json?.role!=='courier'||Number(finance.json?.summary?.delivered_count||0)<1){
    throw new Error('Courier Money does not include the completed Delivery.');
  }
  if(Number(finance.json?.summary?.customer_delivery_fees_context||0)<=0){
    throw new Error('Courier Money is missing Delivery fee context.');
  }

  const courierNet=await pool.query(
    "SELECT COUNT(*)::int n,COALESCE(SUM(amount) FILTER(WHERE settlement_status<>'reversed'),0) amount FROM payment_allocations WHERE component_code='courier_net' AND economic_party_id=$1",
    [String(courier.accountId)]
  );
  const courierNetCount=Number(courierNet.rows[0]?.n||0);
  if(Boolean(finance.json?.summary?.earnings?.tracked)!==(courierNetCount>0)){
    throw new Error('Courier Money earnings tracking does not match courier_net allocation evidence.');
  }

  const settings=await requestJson(base,'/api/settings/finance',{token:courier.token});
  expectStatus(settings,200,'Courier Settings finance state');
  const courierSettings=(settings.json?.profiles||[]).find(x=>x.role==='courier');
  if(settings.json?.active_role!=='courier'||!courierSettings?.enabled||!settings.json?.account_money){
    throw new Error('Courier Settings lost profile or shared Money & Banking context.');
  }

  const entitlement=await pool.query(
    "SELECT * FROM service_monetization_entitlements WHERE country_code='PH' AND service_scope='delivery' AND subject_type='account' AND subject_id=$1",
    [courier.accountId]
  );
  if(entitlement.rows[0]?.promo_duration_days!==30){
    throw new Error('Courier Delivery promotional entitlement is not 30 days.');
  }

  const notificationEvidence=await verifyDeliveryNotifications({
    base,
    customerToken:customer.token,
    merchantToken:merchant.token,
    courierToken:courier.token,
    deliveryId,
    requestJson,
    expectStatus
  });

  const supportTicketId=await ensureCourierSupportTicket({
    pool,base,courier,deliveryId,requestJson,expectStatus
  });

  const unavailable=await requestJson(base,'/api/courier/availability',{
    method:'PUT',token:courier.token,body:{available:false}
  });
  expectStatus(unavailable,200,'Courier QA availability cleanup');

  const courierLogout=await requestJson(base,'/api/auth/logout',{method:'POST',token:courier.token,body:{}});
  expectStatus(courierLogout,200,'Courier Experience logout');
  const relogin=await loginWithCredential({
    base,email:aliases.courier,password:courier.password,label:'Courier Experience final re-login'
  });
  const finalLogout=await requestJson(base,'/api/auth/logout',{method:'POST',token:relogin,body:{}});
  expectStatus(finalLogout,200,'Courier Experience final logout');
  for(const [label,session] of [['Customer',customer],['Merchant',merchant],['Admin',admin]]){
    const logout=await requestJson(base,'/api/auth/logout',{method:'POST',token:session.token,body:{}});
    expectStatus(logout,200,'Courier Experience '+label+' logout');
  }

  return{
    status:'PASS',
    wave:'courier_experience_v1',
    account_role:'courier',
    invitation_id:governance.invitationId,
    application_id:governance.applicationId,
    authorization_id:governance.authorizationId,
    identity_document_id:eligibility.documentId,
    territory_id:territoryId,
    business_id:businessId,
    pricing_version:pricingVersion,
    order_id:orderId,
    delivery_id:deliveryId,
    delivery_fee:Number(delivery.delivery_fee||quoteFee||0),
    digital_payment_server_confirmed:true,
    paymongo_mode:'test',
    courier_eligible:true,
    admin_dispatch:true,
    live_tracking_closed_after_completion:true,
    completion_code_required:true,
    delivery_completed:true,
    order_completed:true,
    finance_delivery_context:true,
    courier_net_allocations:courierNetCount,
    courier_compensation_runtime:courierNetCount>0?'TRACKED':'HOLD_NO_COURIER_NET',
    promotional_days:30,
    notification_lifecycle:true,
    notification_events:notificationEvidence,
    support_ticket_id:supportTicketId,
    support:true,
    settings_context:true,
    logout_relogin:true,
    live_external_paymongo:'HOLD_FOR_CONTROLLED_LIVE_PILOT',
    provider_payout_settlement:'HOLD_FOR_PROVIDER_EVIDENCE'
  };
}
