import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { validateRuntimeSafety } from './runtime-safety.js';
import { runCourierExperienceAcceptance } from './qa-courier-acceptance.js';
import { runServiceProviderExperienceAcceptance } from './qa-service-provider-acceptance.js';

const scryptAsync=promisify(crypto.scrypt);
const CUSTOMER_ALIAS='dropi.deliveries+testcustomer@gmail.com';
const MERCHANT_ALIAS='dropi.deliveries+testmerchant@gmail.com';
const SUPPLIER_ALIAS='dropi.deliveries+testsupplier@gmail.com';
const COURIER_ALIAS='dropi.deliveries+testcourier@gmail.com';
const SERVICE_PROVIDER_ALIAS='dropi.deliveries+testservice@gmail.com';
const TERRITORY_ADMIN_ALIAS='dropi.deliveries+testterritoryadmin@gmail.com';
const SUPER_ADMIN_ALIAS='dropi.deliveries+testsuperadmin@gmail.com';
const CUSTOMER_WAVE='customer_onboarding_v1';
const MERCHANT_CATALOG_WAVE='merchant_catalog_seed_v1';
const MERCHANT_EXPERIENCE_WAVE='merchant_experience_v1';
const SUPPLIER_EXPERIENCE_WAVE='supplier_experience_v1';
const SUPPLIER_DOMAIN_V2_WAVE='supplier_domain_v2';
const SUPPLIER_COMMERCIAL_V3_WAVE='supplier_commercial_v3';
const SUPPLIER_SOURCING_V4_WAVE='supplier_sourcing_v4';
const SUPPLIER_DAILY_V5_WAVE='supplier_daily_v5';
const COURIER_EXPERIENCE_WAVE='courier_experience_v1';
const SERVICE_PROVIDER_EXPERIENCE_WAVE='service_provider_experience_v1';
const CUSTOMER_MARKETPLACE_WAVE='customer_marketplace_e2e_v1';
const CUSTOMER_EXPERIENCE_WAVE='customer_experience_v1';
const AUTH_RUNTIME_V6_WAVE='auth_runtime_v6';
const INCIDENT_RUNTIME_V7_WAVE='incident_runtime_v7';
const DELIVERY_FINANCE_RUNTIME_V8_WAVE='delivery_finance_runtime_v8';
const DELIVERY_RUNTIME_V9_WAVE='delivery_runtime_v9';
const SUPPLIER_RUNTIME_V10_WAVE='supplier_runtime_v10';
const LOCAL_SERVICES_RUNTIME_V11_WAVE='local_services_runtime_v11';
const MARKETPLACE_RUNTIME_V12_WAVE='marketplace_runtime_v12';
const ORDERS_RUNTIME_V13_WAVE='orders_runtime_v13';
const ACCEPTANCE_WAVES=new Set([CUSTOMER_WAVE,MERCHANT_CATALOG_WAVE,MERCHANT_EXPERIENCE_WAVE,SUPPLIER_EXPERIENCE_WAVE,SUPPLIER_DOMAIN_V2_WAVE,SUPPLIER_COMMERCIAL_V3_WAVE,SUPPLIER_SOURCING_V4_WAVE,SUPPLIER_DAILY_V5_WAVE,COURIER_EXPERIENCE_WAVE,SERVICE_PROVIDER_EXPERIENCE_WAVE,CUSTOMER_MARKETPLACE_WAVE,CUSTOMER_EXPERIENCE_WAVE,AUTH_RUNTIME_V6_WAVE,INCIDENT_RUNTIME_V7_WAVE,DELIVERY_FINANCE_RUNTIME_V8_WAVE,DELIVERY_RUNTIME_V9_WAVE,SUPPLIER_RUNTIME_V10_WAVE,LOCAL_SERVICES_RUNTIME_V11_WAVE,MARKETPLACE_RUNTIME_V12_WAVE,ORDERS_RUNTIME_V13_WAVE]);

const clean=(value,max=300)=>String(value??'').trim().slice(0,max);
const originalAutomationCredentials=new Map();

export function qaAcceptanceConfig(env=process.env){
  const wave=clean(env.QA_ACCEPTANCE_WAVE,80);
  if(!wave)return{enabled:false,wave:''};

  const runtime=validateRuntimeSafety(env);
  if(!runtime.previewService||runtime.appEnvironment!=='qa'||!/(?:^|_)(?:qa|test)$/.test(runtime.databaseName)){
    throw new Error('QA acceptance may run only on the isolated accounting-preview QA database.');
  }
  const secret=String(env.QA_AUTOMATION_SECRET||'');
  if(secret.length<32)throw new Error('QA acceptance requires a dedicated QA automation secret.');
  if(!ACCEPTANCE_WAVES.has(wave))throw new Error('Unknown QA acceptance wave.');
  return{enabled:true,wave,runtime,secret};
}

function derivePassword(secret,email){
  return crypto.createHmac('sha256',secret).update('business-life-qa-password:'+email).digest('base64url');
}

async function installAutomationCredential(pool,{secret,email,role}){
  const account=await pool.query(
    `SELECT id,account_mode,test_role,email_verified_at,password_salt,password_hash
       FROM accounts
      WHERE LOWER(email)=$1`,
    [email]
  );
  if(account.rowCount!==1)throw new Error('Expected QA test identity was not found.');
  const row=account.rows[0];
  if(row.account_mode!=='company_test'||row.test_role!==role)throw new Error('QA test identity classification is invalid.');

  const accountId=Number(row.id);
  if(!originalAutomationCredentials.has(accountId)){
    originalAutomationCredentials.set(accountId,{
      salt:row.password_salt??null,
      hash:row.password_hash??null
    });
  }

  const password=derivePassword(secret,email);
  const salt=crypto.randomBytes(16).toString('hex');
  const derived=await scryptAsync(password,salt,64);
  await pool.query(
    `UPDATE accounts
        SET password_salt=$1,password_hash=$2,updated_at=NOW()
      WHERE id=$3 AND account_mode='company_test' AND test_role=$4`,
    [salt,Buffer.from(derived).toString('hex'),accountId,role]
  );
  return{accountId,password,alreadyVerified:Boolean(row.email_verified_at)};
}

async function restoreAutomationCredentials(pool){
  const entries=[...originalAutomationCredentials.entries()];
  originalAutomationCredentials.clear();
  for(const [accountId,credential] of entries){
    await pool.query(
      `UPDATE accounts
          SET password_salt=$1,password_hash=$2,updated_at=NOW()
        WHERE id=$3 AND account_mode='company_test'`,
      [credential.salt,credential.hash,accountId]
    );
  }
}

async function verifySupplierDeliveryRootComposition(base,path,label){
  const response=await fetch(base+path,{headers:{Accept:'text/html'}});
  const html=await response.text();
  if(response.status!==200)throw new Error(label+' returned an unexpected status.');
  for(const marker of ['/suppliers.css','/suppliers-ui.js','/delivery.css','/delivery-ui.js']){
    const count=html.split(marker).length-1;
    if(count!==1)throw new Error(label+' expected exactly one '+marker+' composition marker.');
  }
  return true;
}

async function verifyLocalServicesRootComposition(base,path,label){
  const response=await fetch(base+path,{headers:{Accept:'text/html'}});
  const html=await response.text();
  if(response.status!==200)throw new Error(label+' returned an unexpected status.');
  for(const marker of ['/services.css','/services-ui.js','/suppliers.css','/suppliers-ui.js','/delivery.css','/delivery-ui.js']){
    const count=html.split(marker).length-1;
    if(count!==1)throw new Error(label+' expected exactly one '+marker+' composition marker.');
  }
  return true;
}

async function verifyMarketplaceRootComposition(base,path,label){
  const response=await fetch(base+path,{headers:{Accept:'text/html'}});
  const html=await response.text();
  if(response.status!==200)throw new Error(label+' returned an unexpected status.');
  for(const marker of ['/marketplace.css','/marketplace-ui.js','/guest-explore.css','/guest-explore.js','/services.css','/services-ui.js','/suppliers.css','/suppliers-ui.js','/delivery.css','/delivery-ui.js']){
    const count=html.split(marker).length-1;
    if(count!==1)throw new Error(label+' expected exactly one '+marker+' composition marker.');
  }
  return true;
}

async function verifyOrdersRootComposition(base,path,label){
  const response=await fetch(base+path,{headers:{Accept:'text/html'}});
  const html=await response.text();
  if(response.status!==200)throw new Error(label+' returned an unexpected status.');
  for(const marker of ['/orders.css','/orders-ui.js','/marketplace.css','/marketplace-ui.js','/guest-explore.css','/guest-explore.js','/services.css','/services-ui.js','/suppliers.css','/suppliers-ui.js','/delivery.css','/delivery-ui.js']){
    const count=html.split(marker).length-1;
    if(count!==1)throw new Error(label+' expected exactly one '+marker+' composition marker.');
  }
  return true;
}

async function requestJson(base,path,{method='GET',token='',body,headers:extraHeaders={}}={}){
  const headers={Accept:'application/json',...extraHeaders};
  if(token)headers.Authorization='Bearer '+token;
  let payload;
  if(body!==undefined){
    headers['Content-Type']='application/json';
    payload=JSON.stringify(body);
  }
  const response=await fetch(base+path,{method,headers,body:payload});
  const json=await response.json().catch(()=>({}));
  return{status:response.status,ok:response.ok,json};
}

function expectStatus(result,expected,label){
  const accepted=Array.isArray(expected)?expected:[expected];
  if(!accepted.includes(result.status))throw new Error(label+' returned an unexpected status.');
}

async function loginWithCredential({base,email,password,label}){
  const login=await requestJson(base,'/api/auth/login',{
    method:'POST',
    body:{email,password}
  });
  expectStatus(login,200,label+' login');
  const token=clean(login.json?.token,500);
  if(!token)throw new Error(label+' login did not create a session.');
  return token;
}

async function verifyEmailIfNeeded({pool,base,credential,token,label}){
  if(credential.alreadyVerified)return'already_verified';

  const verificationRequest=await requestJson(base,'/api/auth/email-verification/request',{
    method:'POST',token,body:{}
  });
  expectStatus(verificationRequest,200,label+' verification request');
  const deliveryStatus=clean(verificationRequest.json?.delivery_status,40)||'unknown';
  if(deliveryStatus!=='sent')throw new Error(label+' verification email was not delivered by the configured provider.');

  const previewUrl=clean(verificationRequest.json?.preview_verify_url,1200);
  if(!previewUrl)throw new Error(label+' QA verification link was not returned by the isolated preview environment.');
  let verifyToken='';
  try{verifyToken=new URL(previewUrl).searchParams.get('verify_token')||''}catch{}
  if(!verifyToken)throw new Error(label+' QA verification token was not available.');

  const verified=await requestJson(base,'/api/auth/email-verification/verify',{
    method:'POST',token,body:{token:verifyToken}
  });
  expectStatus(verified,200,label+' email verification');

  const state=await pool.query(`SELECT email_verified_at FROM accounts WHERE id=$1`,[credential.accountId]);
  if(!state.rows[0]?.email_verified_at)throw new Error(label+' verification did not persist.');
  return deliveryStatus;
}

async function qaAccountSession({pool,base,secret,email,role,label}){
  const credential=await installAutomationCredential(pool,{secret,email,role});
  const token=await loginWithCredential({base,email,password:credential.password,label});
  const emailDelivery=await verifyEmailIfNeeded({pool,base,credential,token,label});
  return{...credential,token,emailDelivery};
}

async function runCustomerOnboarding({pool,base,secret}){
  const customer=await qaAccountSession({
    pool,base,secret,email:CUSTOMER_ALIAS,role:'customer',label:'Customer QA'
  });
  const token=customer.token;

  const activated=await requestJson(base,'/api/profiles/customer/activate',{
    method:'POST',token,body:{}
  });
  expectStatus(activated,[200,201],'Customer activation');

  const me=await requestJson(base,'/api/me',{token});
  expectStatus(me,200,'Customer account snapshot');
  const customerProfile=(me.json?.profiles||[]).find(profile=>profile.role==='customer');
  if(!customerProfile?.enabled||customerProfile?.status!=='active')throw new Error('Customer profile did not become active.');
  if(me.json?.account?.account_mode!=='company_test'||me.json?.account?.test_role!=='customer')throw new Error('Customer test identity lost its controlled classification.');

  const context=await requestJson(base,'/api/context/customer',{token});
  expectStatus(context,200,'Customer context');

  const deniedMerchant=await requestJson(base,'/api/profiles/merchant',{
    method:'PUT',token,body:{enabled:true,visibility:'private'}
  });
  expectStatus(deniedMerchant,403,'Cross-role Merchant activation denial');

  const logout=await requestJson(base,'/api/auth/logout',{method:'POST',token,body:{}});
  expectStatus(logout,200,'Customer logout');

  const relogin=await loginWithCredential({
    base,email:CUSTOMER_ALIAS,password:customer.password,label:'Customer QA re-login'
  });
  const finalLogout=await requestJson(base,'/api/auth/logout',{method:'POST',token:relogin,body:{}});
  expectStatus(finalLogout,200,'Customer final logout');

  return{
    status:'PASS',
    wave:CUSTOMER_WAVE,
    account_role:'customer',
    email_delivery:customer.emailDelivery,
    verified:true,
    profile_active:true,
    cross_role_denial:true,
    logout_relogin:true
  };
}

async function ensureQaTerritory({pool,base,adminToken}){
  const code='QA-PILOT-CITY';
  const existing=await pool.query(
    `SELECT id,name,code,status FROM territories WHERE country_code='PH' AND code=$1 LIMIT 1`,
    [code]
  );
  if(existing.rowCount){
    if(!['onboarding','active'].includes(existing.rows[0].status)){
      await pool.query(`UPDATE territories SET status='active',updated_at=NOW() WHERE id=$1`,[existing.rows[0].id]);
    }
    return Number(existing.rows[0].id);
  }
  const created=await requestJson(base,'/api/governance/admin/territories',{
    method:'POST',
    token:adminToken,
    body:{
      country_code:'PH',
      territory_type:'city',
      name:'QA Pilot City',
      code,
      status:'active'
    }
  });
  expectStatus(created,201,'QA territory creation');
  return Number(created.json.id);
}

async function latestMerchantApplication(pool,accountId){
  const q=await pool.query(
    `SELECT * FROM profile_applications
      WHERE account_id=$1 AND role='merchant'
      ORDER BY id DESC LIMIT 1`,
    [Number(accountId)]
  );
  return q.rows[0]||null;
}

async function ensureMerchantApproved({pool,base,merchant,adminToken,territoryId}){
  let application=await latestMerchantApplication(pool,merchant.accountId);
  if(!application){
    const started=await requestJson(base,'/api/governance/profiles/merchant/start',{
      method:'POST',token:merchant.token,body:{territory_id:territoryId}
    });
    expectStatus(started,201,'Merchant onboarding start');
    application=started.json;
  }

  if(['application_started','requirements_pending','rejected'].includes(application.status)){
    const edited=await requestJson(base,`/api/governance/applications/${Number(application.id)}`,{
      method:'PUT',
      token:merchant.token,
      body:{
        proposed_business_name:'Business & Life QA Fish Kitchen',
        applicant_note:'Controlled internal QA Merchant fixture. Not a real merchant.',
        responsibility_acknowledged:true,
        application_data:{
          test_fixture:true,
          business_type:'mixed_food_non_food',
          onboarding_version:'merchant-catalog-seed-v1'
        }
      }
    });
    expectStatus(edited,200,'Merchant application edit');

    const submitted=await requestJson(base,`/api/governance/applications/${Number(application.id)}/submit`,{
      method:'POST',token:merchant.token,body:{}
    });
    expectStatus(submitted,200,'Merchant application submit');
    application=submitted.json;
  }

  application=await latestMerchantApplication(pool,merchant.accountId);
  if(['submitted','under_review'].includes(application?.status)){
    const reviewed=await requestJson(base,`/api/governance/admin/applications/${Number(application.id)}/review`,{
      method:'POST',
      token:adminToken,
      body:{
        decision:'approve',
        reason:'Controlled internal QA Merchant acceptance fixture'
      }
    });
    expectStatus(reviewed,200,'Merchant Admin approval');
  }

  const profile=await pool.query(
    `SELECT enabled,status FROM profiles WHERE account_id=$1 AND role='merchant'`,
    [merchant.accountId]
  );
  if(!profile.rows[0]?.enabled||profile.rows[0]?.status!=='active')throw new Error('Merchant profile did not become active.');

  const activeRole=await requestJson(base,'/api/me/active-role',{
    method:'PATCH',token:merchant.token,body:{role:'merchant'}
  });
  expectStatus(activeRole,200,'Merchant role activation');

  const me=await requestJson(base,'/api/me',{token:merchant.token});
  expectStatus(me,200,'Merchant account snapshot');
  if(me.json?.account?.active_role!=='merchant')throw new Error('Merchant profile did not become the active workspace.');
  if(!Array.isArray(me.json?.businesses)||!me.json.businesses.length)throw new Error('Merchant business workspace was not created.');
  return{
    businessId:Number(me.json.businesses[0].id),
    businessName:clean(me.json.businesses[0].name,180)
  };
}

async function ensureInventoryItem({base,token,name,purchaseQuantity,purchaseUnit,totalCost,reorderQuantity,reorderUnit}){
  const inventory=await requestJson(base,'/api/inventory',{token});
  expectStatus(inventory,200,'Merchant inventory read');
  const existing=(Array.isArray(inventory.json)?inventory.json:[]).find(
    item=>String(item.item||'').trim().toLowerCase()===String(name).toLowerCase()
  );
  if(existing)return existing;

  const created=await requestJson(base,'/api/inventory/purchase',{
    method:'POST',
    token,
    body:{
      item:name,
      purchase_quantity:purchaseQuantity,
      purchase_unit:purchaseUnit,
      total_cost:totalCost,
      reorder_quantity:reorderQuantity,
      reorder_unit:reorderUnit,
      account:'cash',
      note:'Controlled QA catalog fixture — no real purchase',
      record_expense:false
    }
  });
  expectStatus(created,201,'Merchant stock purchase '+name);
  return created.json.inventory;
}

async function ensurePreparedFishSoup({base,token,inventoryByName}){
  const products=await requestJson(base,'/api/products',{token});
  expectStatus(products,200,'Prepared product read');
  let product=(Array.isArray(products.json)?products.json:[]).find(p=>p.name==='QA Fish Soup');

  if(!product){
    const created=await requestJson(base,'/api/products',{
      method:'POST',
      token,
      body:{
        name:'QA Fish Soup',
        category:'Soup',
        selling_price:35,
        active:true,
        product_kind:'prepared_recipe'
      }
    });
    expectStatus(created,201,'Prepared product create');
    product=created.json;
  }

  const batch=await requestJson(base,`/api/products/${Number(product.id)}/recipe-batch`,{
    method:'PUT',
    token,
    body:{
      yield_quantity:1,
      yield_unit:'L',
      selling_quantity:250,
      selling_unit:'ml',
      components:[
        {inventory_id:Number(inventoryByName.Water.id),quantity:800,unit:'ml'},
        {inventory_id:Number(inventoryByName.Fish.id),quantity:250,unit:'g'},
        {inventory_id:Number(inventoryByName.Carrot.id),quantity:100,unit:'g'},
        {inventory_id:Number(inventoryByName.Parsley.id),quantity:10,unit:'g'}
      ]
    }
  });
  expectStatus(batch,200,'Fish Soup batch recipe');
  if(Number(batch.json?.recipe_batch?.sale_units_per_batch)!==4)throw new Error('Fish Soup batch did not compile to four 250 ml sale units.');
  return batch.json;
}

async function publishStorefront({base,token,businessId}){
  const saved=await requestJson(base,'/api/merchant/storefront',{
    method:'PUT',
    token,
    body:{
      business_id:businessId,
      store_name:'Business & Life QA Fish Kitchen',
      description:'Internal QA storefront for Business & Life acceptance testing. Not a real merchant.',
      merchant_domain:'mixed',
      publication_status:'published',
      pickup_address:'Internal QA — Philippines',
      opening_status:'open',
      preparation_eta_minutes:15,
      pickup_enabled:true,
      delivery_enabled:false,
      cash_enabled:true,
      online_enabled:false,
      public_reputation_enabled:false,
      price_comparison_enabled:false
    }
  });
  expectStatus(saved,200,'QA Merchant storefront publish');
}

async function ensureDirectStoreProduct({base,token,businessId,store,inventory,name,kind,quantityPerUnit,category,price,description}){
  let product=(store.products||[]).find(p=>p.name===name);
  if(!product){
    const created=await requestJson(base,'/api/merchant/storefront/products',{
      method:'POST',
      token,
      body:{
        business_id:businessId,
        product_kind:kind,
        name,
        inventory_id:Number(inventory.id),
        quantity_per_unit:quantityPerUnit,
        unit_code:`${quantityPerUnit} ${inventory.unit}`,
        category,
        selling_price:price,
        description,
        published:false
      }
    });
    expectStatus(created,201,'Direct product create '+name);
    product=created.json;
  }
  return product;
}

async function publishStoreProduct({base,token,product}){
  if(product.published===true)return product;
  const updated=await requestJson(base,`/api/merchant/storefront/products/${Number(product.id)}`,{
    method:'PATCH',token,body:{published:true}
  });
  expectStatus(updated,200,'Marketplace product publish');
  return updated.json;
}

async function ensureAiFishSoupImage({pool,base,token,marketProduct}){
  let media=await pool.query(
    `SELECT * FROM catalog_product_media
      WHERE entity_type='marketplace_product' AND entity_id=$1
        AND source_type='ai_generated' AND approval_status<>'archived'
      ORDER BY is_primary DESC,id DESC LIMIT 1`,
    [Number(marketProduct.id)]
  );
  let image=media.rows[0]||null;

  if(!image){
    const generated=await requestJson(base,`/api/merchant/storefront/products/${Number(marketProduct.id)}/images/generate`,{
      method:'POST',token,body:{}
    });
    expectStatus(generated,201,'Fish Soup AI image generation');
    image=generated.json.media;
  }

  if(image.approval_status!=='approved'||image.public_visible!==true||image.is_primary!==true){
    const approved=await requestJson(
      base,
      `/api/merchant/storefront/products/${Number(marketProduct.id)}/images/${Number(image.id)}/approve`,
      {method:'POST',token,body:{primary:true}}
    );
    expectStatus(approved,200,'Fish Soup AI image approval');
    image=approved.json.media;
  }
  return image;
}

async function runMerchantCatalogSeed({pool,base,secret}){
  const [admin,merchant]=await Promise.all([
    qaAccountSession({
      pool,base,secret,email:SUPER_ADMIN_ALIAS,role:'super_admin',label:'Super Admin QA'
    }),
    qaAccountSession({
      pool,base,secret,email:MERCHANT_ALIAS,role:'merchant',label:'Merchant QA'
    })
  ]);

  const territoryId=await ensureQaTerritory({pool,base,adminToken:admin.token});
  const workspace=await ensureMerchantApproved({
    pool,base,merchant,adminToken:admin.token,territoryId
  });

  const inventoryByName={};
  for(const spec of [
    ['Water',10,'L',100,2,'L'],
    ['Fish',5,'kg',900,1,'kg'],
    ['Carrot',5,'kg',400,1,'kg'],
    ['Parsley',1,'kg',300,200,'g'],
    ['Bottled Juice',24,'unit',480,6,'unit'],
    ['Dish Soap',12,'unit',600,4,'unit']
  ]){
    const [name,purchaseQuantity,purchaseUnit,totalCost,reorderQuantity,reorderUnit]=spec;
    inventoryByName[name]=await ensureInventoryItem({
      base,token:merchant.token,name,purchaseQuantity,purchaseUnit,totalCost,reorderQuantity,reorderUnit
    });
  }

  const fishSoup=await ensurePreparedFishSoup({
    base,token:merchant.token,inventoryByName
  });

  await publishStorefront({base,token:merchant.token,businessId:workspace.businessId});

  const imported=await requestJson(base,'/api/merchant/storefront/import-legacy',{
    method:'POST',token:merchant.token,body:{business_id:workspace.businessId}
  });
  expectStatus(imported,200,'Prepared product Marketplace import');

  let store=await requestJson(base,`/api/merchant/storefront?business_id=${workspace.businessId}`,{token:merchant.token});
  expectStatus(store,200,'Private Merchant storefront');

  const fresh=await ensureDirectStoreProduct({
    base,token:merchant.token,businessId:workspace.businessId,store:store.json,
    inventory:inventoryByName.Carrot,name:'QA Fresh Carrots',kind:'fresh_direct',
    quantityPerUnit:500,category:'Vegetables',price:50,
    description:'Controlled QA direct-food test product. 500 g from linked Merchant stock.'
  });
  const packaged=await ensureDirectStoreProduct({
    base,token:merchant.token,businessId:workspace.businessId,store:store.json,
    inventory:inventoryByName['Bottled Juice'],name:'QA Bottled Juice',kind:'packaged_resale',
    quantityPerUnit:1,category:'Beverages',price:30,
    description:'Controlled QA packaged-food resale product.'
  });
  const nonFood=await ensureDirectStoreProduct({
    base,token:merchant.token,businessId:workspace.businessId,store:store.json,
    inventory:inventoryByName['Dish Soap'],name:'QA Dish Soap',kind:'non_food_resale',
    quantityPerUnit:1,category:'Household',price:70,
    description:'Controlled QA non-food resale product.'
  });

  store=await requestJson(base,`/api/merchant/storefront?business_id=${workspace.businessId}`,{token:merchant.token});
  expectStatus(store,200,'Merchant storefront product refresh');

  const preparedMarket=(store.json.products||[]).find(p=>Number(p.legacy_product_id)===Number(fishSoup.id));
  if(!preparedMarket)throw new Error('Prepared Fish Soup was not imported into the Marketplace.');

  for(const product of [preparedMarket,fresh,packaged,nonFood]){
    await publishStoreProduct({base,token:merchant.token,product});
  }

  const aiImage=await ensureAiFishSoupImage({
    pool,base,token:merchant.token,marketProduct:preparedMarket
  });

  const publicStore=await requestJson(base,`/api/public/marketplace/storefronts/${workspace.businessId}`);
  expectStatus(publicStore,200,'Public QA storefront');
  const publicProducts=Array.isArray(publicStore.json?.products)?publicStore.json.products:[];
  const expectedNames=['QA Fish Soup','QA Fresh Carrots','QA Bottled Juice','QA Dish Soap'];
  for(const name of expectedNames){
    if(!publicProducts.some(p=>p.name===name))throw new Error('Published QA product missing from storefront: '+name);
  }
  const publicSoup=publicProducts.find(p=>p.name==='QA Fish Soup');
  if(!publicSoup?.image_data_url||publicSoup.image_source_type!=='ai_generated'){
    throw new Error('Fish Soup AI reference image is not visible through the public QA storefront.');
  }

  const merchantLogout=await requestJson(base,'/api/auth/logout',{method:'POST',token:merchant.token,body:{}});
  expectStatus(merchantLogout,200,'Merchant QA logout');
  const adminLogout=await requestJson(base,'/api/auth/logout',{method:'POST',token:admin.token,body:{}});
  expectStatus(adminLogout,200,'Super Admin QA logout');

  return{
    status:'PASS',
    wave:MERCHANT_CATALOG_WAVE,
    account_role:'merchant',
    merchant_email_delivery:merchant.emailDelivery,
    admin_email_delivery:admin.emailDelivery,
    merchant_verified:true,
    merchant_profile_active:true,
    business_id:workspace.businessId,
    storefront_published:true,
    inventory_items:Object.keys(inventoryByName).length,
    prepared_recipe:true,
    direct_food:true,
    packaged_food:true,
    non_food:true,
    published_products:expectedNames.length,
    ai_reference_image:Boolean(aiImage?.id),
    ai_reference_primary:true
  };
}


const CUSTOMER_MARKETPLACE_NOTE='Controlled QA customer marketplace E2E v1';
const MERCHANT_EXPERIENCE_ORDER_NOTE='Controlled QA Merchant Experience Marketplace order';
const CUSTOMER_MARKETPLACE_ITEMS=['QA Fish Soup','QA Fresh Carrots','QA Bottled Juice','QA Dish Soap'];
const CUSTOMER_MARKETPLACE_CONSUMPTION=new Map([
  ['Water',200],
  ['Fish',62.5],
  ['Carrot',525],
  ['Parsley',2.5],
  ['Bottled Juice',1],
  ['Dish Soap',1]
]);

const closeEnough=(actual,expected,epsilon=0.0001)=>Math.abs(Number(actual)-Number(expected))<=epsilon;

async function orderDetailFor({base,token,orderId,label='QA order detail'}){
  const detail=await requestJson(base,`/api/orders/${Number(orderId)}`,{token});
  expectStatus(detail,200,label);
  return detail.json;
}

async function assertCustomerMarketplaceConsumption({pool,orderId}){
  const rows=await pool.query(
    `SELECT i.item,c.quantity_used,c.reversed_at
       FROM order_stock_consumptions c
       JOIN inventory i ON i.id=c.inventory_id
      WHERE c.order_id=$1
      ORDER BY i.item`,
    [Number(orderId)]
  );
  const actual=new Map(rows.rows.map(row=>[row.item,Number(row.quantity_used)]));
  for(const [item,expected] of CUSTOMER_MARKETPLACE_CONSUMPTION){
    if(!actual.has(item)||!closeEnough(actual.get(item),expected)){
      throw new Error(`QA Marketplace stock consumption mismatch for ${item}.`);
    }
  }
  if(rows.rows.some(row=>row.reversed_at))throw new Error('QA Marketplace stock consumption was unexpectedly reversed.');
  return actual;
}

async function inventoryQuantitySnapshot(pool,businessId){
  const rows=await pool.query(
    `SELECT item,quantity FROM inventory
      WHERE business_id=$1
        AND item=ANY($2::text[])`,
    [Number(businessId),[...CUSTOMER_MARKETPLACE_CONSUMPTION.keys()]]
  );
  return new Map(rows.rows.map(row=>[row.item,Number(row.quantity)]));
}

function assertInventoryDelta(before,after){
  for(const [item,expected] of CUSTOMER_MARKETPLACE_CONSUMPTION){
    if(!before.has(item)||!after.has(item))throw new Error(`QA Marketplace inventory item missing for ${item}.`);
    const delta=before.get(item)-after.get(item);
    if(!closeEnough(delta,expected))throw new Error(`QA Marketplace inventory delta mismatch for ${item}.`);
  }
}

async function ensureActiveRole({base,token,role,label}){
  const active=await requestJson(base,'/api/me/active-role',{
    method:'PATCH',token,body:{role}
  });
  expectStatus(active,200,label+' active role');
}

async function runCustomerMarketplaceE2E({pool,base,secret,orderNote=CUSTOMER_MARKETPLACE_NOTE}){
  const customerPrerequisite=await runCustomerOnboarding({pool,base,secret});
  if(customerPrerequisite.status!=='PASS')throw new Error('Customer onboarding prerequisite did not pass.');
  const merchantPrerequisite=await runMerchantCatalogSeed({pool,base,secret});
  if(merchantPrerequisite.status!=='PASS')throw new Error('Merchant catalog prerequisite did not pass.');

  const [customer,merchant]=await Promise.all([
    qaAccountSession({
      pool,base,secret,email:CUSTOMER_ALIAS,role:'customer',label:'Customer Marketplace QA'
    }),
    qaAccountSession({
      pool,base,secret,email:MERCHANT_ALIAS,role:'merchant',label:'Merchant Marketplace QA'
    })
  ]);
  await ensureActiveRole({base,token:customer.token,role:'customer',label:'Customer Marketplace QA'});
  await ensureActiveRole({base,token:merchant.token,role:'merchant',label:'Merchant Marketplace QA'});

  const merchantMe=await requestJson(base,'/api/me',{token:merchant.token});
  expectStatus(merchantMe,200,'Merchant Marketplace account snapshot');
  const business=(merchantMe.json?.businesses||[]).find(x=>x.name==='Business & Life QA Fish Kitchen')
    ||(merchantMe.json?.businesses||[])[0];
  if(!business?.id)throw new Error('QA Merchant business workspace is unavailable.');
  const businessId=Number(business.id);

  const discovered=await requestJson(base,`/api/marketplace/storefronts/${businessId}`,{token:customer.token});
  expectStatus(discovered,200,'Customer Marketplace storefront discovery');
  const publicProducts=Array.isArray(discovered.json?.products)?discovered.json.products:[];
  const basket=[];
  for(const name of CUSTOMER_MARKETPLACE_ITEMS){
    const product=publicProducts.find(x=>x.name===name);
    if(!product?.id)throw new Error('QA Marketplace product missing from Customer discovery: '+name);
    basket.push({product_id:Number(product.id),quantity:1});
  }

  const existing=await pool.query(
    `SELECT id,order_status FROM orders
      WHERE business_id=$1 AND customer_account_id=$2 AND note=$3
      ORDER BY id DESC LIMIT 1`,
    [businessId,customer.accountId,orderNote]
  );
  let order;
  if(existing.rowCount&&existing.rows[0].order_status!=='cancelled'){
    order=await orderDetailFor({
      base,token:customer.token,orderId:existing.rows[0].id,label:'Existing Customer Marketplace QA order'
    });
  }else{
    const checkout=await requestJson(base,'/api/marketplace/checkout',{
      method:'POST',
      token:customer.token,
      body:{
        business_id:businessId,
        items:basket,
        fulfilment_method:'pickup',
        payment_method:'cash',
        note:orderNote
      }
    });
    expectStatus(checkout,201,'Customer Marketplace checkout');
    order=checkout.json;
  }

  const orderId=Number(order?.id);
  if(!orderId)throw new Error('Customer Marketplace checkout did not create a valid order.');
  if(!closeEnough(order.subtotal,185))throw new Error('QA Marketplace order subtotal is not the expected PHP 185.');

  let presenceGate=false;
  let stockDeltaVerified=false;

  if(order.order_status==='awaiting_customer_presence'){
    presenceGate=true;
    const checkIn=await requestJson(base,`/api/orders/${orderId}/check-in`,{
      method:'POST',token:customer.token,body:{}
    });
    expectStatus(checkIn,200,'Customer Marketplace check-in');

    const confirm=await requestJson(base,`/api/orders/merchant/${orderId}/confirm-presence`,{
      method:'POST',token:merchant.token,body:{}
    });
    expectStatus(confirm,200,'Merchant Marketplace presence confirmation');
    order=confirm.json;
  }else if(!['accepted','preparing','ready','completed'].includes(order.order_status)){
    throw new Error('QA Marketplace order entered an unexpected state before preparation.');
  }

  if(order.order_status==='accepted'){
    const before=await inventoryQuantitySnapshot(pool,businessId);
    const start=await requestJson(base,`/api/orders/merchant/${orderId}/start`,{
      method:'POST',token:merchant.token,body:{}
    });
    expectStatus(start,200,'Merchant Marketplace preparation start');
    order=start.json;
    const after=await inventoryQuantitySnapshot(pool,businessId);
    assertInventoryDelta(before,after);
    stockDeltaVerified=true;
  }

  if(['preparing','ready','completed'].includes(order.order_status)){
    await assertCustomerMarketplaceConsumption({pool,orderId});
  }else{
    throw new Error('QA Marketplace order did not reach a stock-consuming state.');
  }

  if(order.order_status==='preparing'){
    const ready=await requestJson(base,`/api/orders/merchant/${orderId}/ready`,{
      method:'POST',token:merchant.token,body:{}
    });
    expectStatus(ready,200,'Merchant Marketplace ready');
    order=ready.json;
  }

  if(order.order_status==='ready'&&order.payment_status!=='paid'){
    const outstanding=Number(order.outstanding_amount);
    if(!(outstanding>0))throw new Error('QA Marketplace ready order has no valid outstanding amount.');
    const paid=await requestJson(base,`/api/orders/merchant/${orderId}/payment`,{
      method:'POST',
      token:merchant.token,
      body:{amount:outstanding,account:'cash',method_code:'cash'}
    });
    expectStatus(paid,200,'Merchant Marketplace cash payment');
    order=paid.json;
  }

  if(order.order_status==='ready'){
    if(order.payment_status!=='paid'||Number(order.outstanding_amount)>0.001){
      throw new Error('QA Marketplace order is not fully paid before completion.');
    }
    const completed=await requestJson(base,`/api/orders/merchant/${orderId}/complete`,{
      method:'POST',token:merchant.token,body:{allow_credit:false}
    });
    expectStatus(completed,200,'Merchant Marketplace completion');
    order=completed.json;
  }

  if(order.order_status!=='completed'||order.payment_status!=='paid'){
    throw new Error('QA Marketplace order did not complete as paid.');
  }

  await assertCustomerMarketplaceConsumption({pool,orderId});
  const payment=await pool.query(
    `SELECT COUNT(*)::int count,COALESCE(SUM(amount),0)::numeric total
       FROM order_payments
      WHERE order_id=$1 AND status='confirmed'`,
    [orderId]
  );
  if(Number(payment.rows[0]?.count||0)<1||!closeEnough(payment.rows[0]?.total,185)){
    throw new Error('QA Marketplace confirmed cash payment evidence is incomplete.');
  }

  const history=await requestJson(base,'/api/orders/mine',{token:customer.token});
  expectStatus(history,200,'Customer Marketplace order history');
  const historyOrder=(Array.isArray(history.json)?history.json:[]).find(x=>Number(x.id)===orderId);
  if(historyOrder?.order_status!=='completed'||historyOrder?.payment_status!=='paid'){
    throw new Error('Completed QA Marketplace order is missing from Customer history.');
  }

  const publicToken=clean(order.public_token,200);
  if(!publicToken)throw new Error('QA Marketplace order is missing its public tracker token.');
  const tracker=await requestJson(base,`/api/orders/track/${publicToken}`);
  expectStatus(tracker,200,'Customer Marketplace public tracker');
  if(Number(tracker.json?.id)!==orderId||tracker.json?.order_status!=='completed'||tracker.json?.payment_status!=='paid'){
    throw new Error('Public tracker does not match the completed QA Marketplace order.');
  }

  const customerLogout=await requestJson(base,'/api/auth/logout',{method:'POST',token:customer.token,body:{}});
  expectStatus(customerLogout,200,'Customer Marketplace QA logout');
  const merchantLogout=await requestJson(base,'/api/auth/logout',{method:'POST',token:merchant.token,body:{}});
  expectStatus(merchantLogout,200,'Merchant Marketplace QA logout');

  return{
    status:'PASS',
    wave:CUSTOMER_MARKETPLACE_WAVE,
    customer_verified:true,
    merchant_verified:true,
    business_id:businessId,
    storefront_discovered:true,
    basket_products:basket.length,
    order_id:orderId,
    cash_pickup:true,
    presence_gate:presenceGate||Boolean(order.presence_confirmed_at),
    stock_consumption_verified:true,
    stock_delta_verified:stockDeltaVerified,
    payment_confirmed:true,
    payment_status:'paid',
    order_completed:true,
    customer_history:true,
    public_tracker:true
  };
}


const CUSTOMER_SUPPORT_SUBJECT='Controlled QA Customer support E2E';
const CUSTOMER_PRIVACY_SUBJECT='Controlled QA privacy rights E2E';
const CUSTOMER_SUPPORT_FOLLOWUP='Controlled QA follow-up confirmed.';

async function ensureCustomerPasswordRecovery({pool,base,secret}){
  const account=await pool.query(
    `SELECT id FROM accounts WHERE LOWER(email)=$1 AND account_mode='company_test' AND test_role='customer'`,
    [CUSTOMER_ALIAS]
  );
  if(account.rowCount!==1)throw new Error('Controlled Customer identity is unavailable for recovery acceptance.');
  const accountId=Number(account.rows[0].id);

  const prior=await pool.query(
    `SELECT id FROM auth_security_events
      WHERE account_id=$1 AND event_code='password_reset_completed'
      ORDER BY id DESC LIMIT 1`,
    [accountId]
  );
  if(prior.rowCount)return{completed:true,emailSentEvidence:true,reusedEvidence:true};

  const forgot=await requestJson(base,'/api/auth/forgot-password',{
    method:'POST',body:{email:CUSTOMER_ALIAS}
  });
  expectStatus(forgot,200,'Customer password recovery request');

  const previewUrl=clean(forgot.json?.preview_reset_url,1200);
  if(!previewUrl)throw new Error('Customer QA recovery did not return the isolated preview reset link.');

  const delivery=await pool.query(
    `SELECT status FROM auth_email_deliveries
      WHERE account_id=$1 AND template_code='password_reset'
      ORDER BY id DESC LIMIT 1`,
    [accountId]
  );
  if(delivery.rows[0]?.status!=='sent')throw new Error('Customer password recovery email was not delivered.');

  let resetToken='';
  try{resetToken=new URL(previewUrl).searchParams.get('reset_token')||''}catch{}
  if(!resetToken)throw new Error('Customer QA recovery token was not available.');

  const recoveryPassword=derivePassword(secret,CUSTOMER_ALIAS)+'-recovery';
  const reset=await requestJson(base,'/api/auth/reset-password',{
    method:'POST',body:{token:resetToken,new_password:recoveryPassword}
  });
  expectStatus(reset,200,'Customer password reset');

  const token=await loginWithCredential({
    base,email:CUSTOMER_ALIAS,password:recoveryPassword,label:'Customer recovery re-login'
  });
  const logout=await requestJson(base,'/api/auth/logout',{method:'POST',token,body:{}});
  expectStatus(logout,200,'Customer recovery logout');

  return{completed:true,emailSentEvidence:true,reusedEvidence:false};
}

async function ensureQaSupportTicket({pool,base,token,accountId,orderId}){
  const existing=await pool.query(
    `SELECT id FROM support_tickets
      WHERE requester_account_id=$1 AND subject=$2
      ORDER BY id DESC LIMIT 1`,
    [Number(accountId),CUSTOMER_SUPPORT_SUBJECT]
  );
  let ticketId=Number(existing.rows[0]?.id||0);
  if(!ticketId){
    const created=await requestJson(base,'/api/support/tickets',{
      method:'POST',token,
      body:{
        category:'marketplace_order',
        subject:CUSTOMER_SUPPORT_SUBJECT,
        description:'Controlled internal QA Support request linked to the completed Marketplace order. No real customer issue.',
        requested_destination:'support',
        related_type:'order',
        related_id:Number(orderId),
        source_language:'en-PH'
      }
    });
    expectStatus(created,201,'Customer Support ticket create');
    ticketId=Number(created.json?.id);
  }
  if(!ticketId)throw new Error('Customer Support ticket was not created.');

  const detail=await requestJson(base,`/api/support/tickets/${ticketId}`,{token});
  expectStatus(detail,200,'Customer Support ticket detail');
  if(detail.json?.category!=='marketplace_order'||Number(detail.json?.related_id)!==Number(orderId)){
    throw new Error('Customer Support ticket lost its Marketplace order context.');
  }

  const followup=await pool.query(
    `SELECT id FROM support_messages WHERE ticket_id=$1 AND message=$2 LIMIT 1`,
    [ticketId,CUSTOMER_SUPPORT_FOLLOWUP]
  );
  if(!followup.rowCount){
    const reply=await requestJson(base,`/api/support/tickets/${ticketId}/reply`,{
      method:'POST',token,body:{message:CUSTOMER_SUPPORT_FOLLOWUP}
    });
    expectStatus(reply,200,'Customer Support follow-up');
  }

  const mine=await requestJson(base,'/api/support/tickets/mine',{token});
  expectStatus(mine,200,'Customer Support My tickets');
  if(!(Array.isArray(mine.json)?mine.json:[]).some(x=>Number(x.id)===ticketId)){
    throw new Error('Customer Support ticket is missing from My Support.');
  }
  return ticketId;
}

async function ensureQaPrivacyRequest({pool,base,customerToken,merchantToken,accountId}){
  const existing=await pool.query(
    `SELECT id FROM support_tickets
      WHERE requester_account_id=$1 AND subject=$2
      ORDER BY id DESC LIMIT 1`,
    [Number(accountId),CUSTOMER_PRIVACY_SUBJECT]
  );
  let ticketId=Number(existing.rows[0]?.id||0);
  if(!ticketId){
    const created=await requestJson(base,'/api/support/tickets',{
      method:'POST',token:customerToken,
      body:{
        category:'privacy_access',
        subject:CUSTOMER_PRIVACY_SUBJECT,
        description:'Controlled internal QA privacy-access request. This is acceptance evidence only and does not request a real legal outcome.',
        requested_destination:'territory_admin',
        related_type:'order',
        related_id:999999,
        source_language:'en-PH'
      }
    });
    expectStatus(created,201,'Customer privacy request create');
    ticketId=Number(created.json?.id);
  }
  if(!ticketId)throw new Error('Customer privacy request was not created.');

  const detail=await requestJson(base,`/api/support/tickets/${ticketId}`,{token:customerToken});
  expectStatus(detail,200,'Customer privacy request detail');
  const tags=Array.isArray(detail.json?.tags)?detail.json.tags:[];
  if(detail.json?.category!=='privacy_access'
    ||detail.json?.requested_destination!=='country_admin'
    ||detail.json?.related_type!=='privacy_rights'
    ||detail.json?.related_id!=null
    ||!tags.includes('privacy_rights')
    ||!tags.includes('privacy_access')){
    throw new Error('Customer privacy request routing or canonical tags are incorrect.');
  }

  const denied=await requestJson(base,`/api/support/tickets/${ticketId}`,{token:merchantToken});
  expectStatus(denied,403,'Cross-account privacy ticket denial');
  return ticketId;
}

async function verifyCustomerNotifications({base,token,orderId}){
  const inbox=await requestJson(base,'/api/notifications?limit=100',{token});
  expectStatus(inbox,200,'Customer notification inbox');
  const rows=(Array.isArray(inbox.json)?inbox.json:[]).filter(
    x=>x.entity_type==='order'&&Number(x.entity_id)===Number(orderId)
  );
  for(const code of ['order.customer_checked_in','order.preparing','order.ready','order.payment_confirmed','order.completed']){
    if(!rows.some(x=>x.event_code===code))throw new Error('Customer notification lifecycle is missing '+code+'.');
  }

  const completed=rows.find(x=>x.event_code==='order.completed');
  if(!completed?.recipient_id)throw new Error('Customer completed-order notification is missing a recipient id.');
  const marked=await requestJson(base,`/api/notifications/${Number(completed.recipient_id)}/read`,{
    method:'PATCH',token,body:{}
  });
  expectStatus(marked,200,'Customer notification mark read');
  if(!marked.json?.read_at)throw new Error('Customer notification read state did not persist.');
  return rows.length;
}

async function runCustomerExperienceAcceptance({pool,base,secret}){
  const marketplace=await runCustomerMarketplaceE2E({pool,base,secret});
  if(marketplace.status!=='PASS')throw new Error('Customer Marketplace prerequisite did not pass.');
  const orderId=Number(marketplace.order_id);
  if(!orderId)throw new Error('Customer Experience acceptance requires a completed QA order.');

  const recovery=await ensureCustomerPasswordRecovery({pool,base,secret});

  const [customer,merchant]=await Promise.all([
    qaAccountSession({
      pool,base,secret,email:CUSTOMER_ALIAS,role:'customer',label:'Customer Experience QA'
    }),
    qaAccountSession({
      pool,base,secret,email:MERCHANT_ALIAS,role:'merchant',label:'Merchant Privacy Isolation QA'
    })
  ]);
  await ensureActiveRole({base,token:customer.token,role:'customer',label:'Customer Experience QA'});
  await ensureActiveRole({base,token:merchant.token,role:'merchant',label:'Merchant Privacy Isolation QA'});

  const me=await requestJson(base,'/api/me',{token:customer.token});
  expectStatus(me,200,'Customer Account Home');
  const customerProfile=(me.json?.profiles||[]).find(x=>x.role==='customer');
  if(me.json?.account?.active_role!=='customer'||!customerProfile?.enabled||customerProfile?.status!=='active'){
    throw new Error('Customer Account Home does not resolve the active Customer profile.');
  }

  const moneyView=await requestJson(base,'/api/profile-money/customer',{token:customer.token});
  expectStatus(moneyView,200,'Customer Money');
  const recentOrder=(moneyView.json?.recent_orders||[]).find(x=>Number(x.id)===orderId);
  const recentPayment=(moneyView.json?.recent_payments||[]).find(
    x=>x.source_type==='order'&&Number(x.source_id)===orderId
  );
  if(!recentOrder||recentOrder.order_status!=='completed'||recentOrder.payment_status!=='paid'
    ||!closeEnough(recentOrder.total,185)||!closeEnough(recentOrder.outstanding_amount,0)){
    throw new Error('Customer Money recent order does not reconcile to the completed QA order.');
  }
  if(!recentPayment||recentPayment.status!=='succeeded'||!closeEnough(recentPayment.amount,185)){
    throw new Error('Customer Money confirmed payment does not reconcile to PHP 185.');
  }
  if(Number(moneyView.json?.summary?.confirmed_payments||0)<185){
    throw new Error('Customer Money confirmed-payments summary does not include the QA payment.');
  }

  const notificationCount=await verifyCustomerNotifications({
    base,token:customer.token,orderId
  });

  const supportTicketId=await ensureQaSupportTicket({
    pool,base,token:customer.token,accountId:customer.accountId,orderId
  });
  const privacyTicketId=await ensureQaPrivacyRequest({
    pool,base,customerToken:customer.token,merchantToken:merchant.token,accountId:customer.accountId
  });

  const merchantMe=await requestJson(base,'/api/me',{token:merchant.token});
  expectStatus(merchantMe,200,'Merchant workspace for delivery boundary');
  const business=(merchantMe.json?.businesses||[]).find(x=>x.name==='Business & Life QA Fish Kitchen')
    ||(merchantMe.json?.businesses||[])[0];
  if(!business?.id)throw new Error('QA Merchant workspace is unavailable for delivery-boundary acceptance.');
  const businessId=Number(business.id);

  const storefront=await requestJson(base,`/api/marketplace/storefronts/${businessId}`,{token:customer.token});
  expectStatus(storefront,200,'Customer delivery-choice discovery');
  if(storefront.json?.delivery_enabled!==false)throw new Error('QA delivery boundary expected delivery to remain disabled.');

  const soup=(storefront.json?.products||[]).find(x=>x.name==='QA Fish Soup');
  if(!soup?.id)throw new Error('QA Fish Soup is unavailable for delivery-boundary validation.');
  const blockedDelivery=await requestJson(base,'/api/marketplace/checkout',{
    method:'POST',
    token:customer.token,
    body:{
      business_id:businessId,
      items:[{product_id:Number(soup.id),quantity:1}],
      fulfilment_method:'delivery',
      payment_method:'cash',
      delivery_address:'Controlled QA delivery address — not a real customer address'
    }
  });
  expectStatus(blockedDelivery,409,'Delivery-disabled checkout guard');

  const logout=await requestJson(base,'/api/auth/logout',{method:'POST',token:customer.token,body:{}});
  expectStatus(logout,200,'Customer Experience logout');
  const relogin=await loginWithCredential({
    base,email:CUSTOMER_ALIAS,password:customer.password,label:'Customer Experience final re-login'
  });
  const finalLogout=await requestJson(base,'/api/auth/logout',{method:'POST',token:relogin,body:{}});
  expectStatus(finalLogout,200,'Customer Experience final logout');
  const merchantLogout=await requestJson(base,'/api/auth/logout',{method:'POST',token:merchant.token,body:{}});
  expectStatus(merchantLogout,200,'Merchant Privacy Isolation logout');

  return{
    status:'PASS',
    wave:CUSTOMER_EXPERIENCE_WAVE,
    order_id:orderId,
    password_recovery:true,
    recovery_email_sent:recovery.emailSentEvidence,
    account_home:true,
    customer_money:true,
    confirmed_payment:185,
    notification_lifecycle:true,
    notification_events:notificationCount,
    support_ticket_id:supportTicketId,
    support:true,
    privacy_ticket_id:privacyTicketId,
    privacy_country_routing:true,
    privacy_cross_account_denial:true,
    delivery_disabled_guard:true,
    full_delivery_e2e:'HOLD_FOR_COURIER_WAVE',
    logout_relogin:true
  };
}

const MERCHANT_SUPPORT_SUBJECT='Controlled QA Merchant support E2E';

async function ensureQaMerchantSupportTicket({pool,base,token,accountId,orderId}){
  const existing=await pool.query(
    `SELECT id FROM support_tickets
      WHERE requester_account_id=$1 AND subject=$2
      ORDER BY id DESC LIMIT 1`,
    [Number(accountId),MERCHANT_SUPPORT_SUBJECT]
  );
  let ticketId=Number(existing.rows[0]?.id||0);
  if(!ticketId){
    const created=await requestJson(base,'/api/support/tickets',{
      method:'POST',token,
      body:{
        category:'marketplace_order',
        subject:MERCHANT_SUPPORT_SUBJECT,
        description:'Controlled internal QA Merchant support request linked to the completed Marketplace order. No real merchant issue.',
        requested_destination:'support',
        related_type:'order',
        related_id:Number(orderId),
        source_language:'en-PH'
      }
    });
    expectStatus(created,201,'Merchant Support ticket create');
    ticketId=Number(created.json?.id);
  }
  if(!ticketId)throw new Error('Merchant Support ticket was not created.');

  const detail=await requestJson(base,`/api/support/tickets/${ticketId}`,{token});
  expectStatus(detail,200,'Merchant Support ticket detail');
  if(detail.json?.category!=='marketplace_order'||Number(detail.json?.related_id)!==Number(orderId)){
    throw new Error('Merchant Support ticket lost its Marketplace order context.');
  }

  const mine=await requestJson(base,'/api/support/tickets/mine',{token});
  expectStatus(mine,200,'Merchant Support My tickets');
  if(!(Array.isArray(mine.json)?mine.json:[]).some(x=>Number(x.id)===ticketId)){
    throw new Error('Merchant Support ticket is missing from My Support.');
  }
  return ticketId;
}

async function verifyMerchantNotifications({base,token,orderId}){
  const inbox=await requestJson(base,'/api/notifications?limit=100',{token});
  expectStatus(inbox,200,'Merchant notification inbox');
  const rows=(Array.isArray(inbox.json)?inbox.json:[]).filter(
    x=>x.entity_type==='order'&&Number(x.entity_id)===Number(orderId)
  );
  for(const code of ['order.created','order.customer_checked_in','order.payment_confirmed']){
    if(!rows.some(x=>x.event_code===code))throw new Error('Merchant notification lifecycle is missing '+code+'.');
  }
  return rows.length;
}

async function runMerchantExperienceAcceptance({pool,base,secret}){
  const marketplace=await runCustomerMarketplaceE2E({pool,base,secret,orderNote:MERCHANT_EXPERIENCE_ORDER_NOTE});
  if(marketplace.status!=='PASS')throw new Error('Customer Marketplace prerequisite did not pass.');
  const orderId=Number(marketplace.order_id);
  if(!orderId)throw new Error('Merchant Experience acceptance requires a completed QA order.');

  const merchant=await qaAccountSession({
    pool,base,secret,email:MERCHANT_ALIAS,role:'merchant',label:'Merchant Experience QA'
  });
  await ensureActiveRole({base,token:merchant.token,role:'merchant',label:'Merchant Experience QA'});

  const me=await requestJson(base,'/api/me',{token:merchant.token});
  expectStatus(me,200,'Merchant Account Home');
  const merchantProfile=(me.json?.profiles||[]).find(x=>x.role==='merchant');
  const business=(me.json?.businesses||[]).find(x=>x.name==='Business & Life QA Fish Kitchen')
    ||(me.json?.businesses||[])[0];
  if(me.json?.account?.active_role!=='merchant'||!merchantProfile?.enabled||merchantProfile?.status!=='active'){
    throw new Error('Merchant Account Home does not resolve the active Merchant profile.');
  }
  if(!business?.id)throw new Error('Merchant Experience business workspace is unavailable.');
  const businessId=Number(business.id);

  const finance=await requestJson(base,'/api/accounting/finance-overview',{token:merchant.token});
  expectStatus(finance,200,'Merchant Finance overview');
  if(finance.json?.role!=='merchant'||Number(finance.json?.business?.id)!==businessId){
    throw new Error('Merchant Finance resolved the wrong economic workspace.');
  }
  if(Number(finance.json?.commercial?.completed_merchandise_value||0)<185
    ||Number(finance.json?.cash_evidence?.confirmed_merchandise_received||0)<185){
    throw new Error('Merchant Finance does not reconcile the controlled completed order and confirmed payment.');
  }
  if(Number(finance.json?.profitability?.completed_order_revenue||0)<185
    ||Number(finance.json?.profitability?.line_count||0)<4){
    throw new Error('Merchant profitability evidence does not include the controlled Marketplace order.');
  }

  const settings=await requestJson(base,'/api/settings/finance',{token:merchant.token});
  expectStatus(settings,200,'Merchant Profile Settings finance state');
  const settingsProfile=(settings.json?.profiles||[]).find(x=>x.role==='merchant');
  if(settings.json?.active_role!=='merchant'||!settingsProfile?.enabled
    ||!(settings.json?.businesses||[]).some(x=>Number(x.id)===businessId)
    ||!settings.json?.account_money){
    throw new Error('Merchant Settings does not preserve profile, business and shared account Money & Banking context.');
  }

  const notificationCount=await verifyMerchantNotifications({
    base,token:merchant.token,orderId
  });
  const supportTicketId=await ensureQaMerchantSupportTicket({
    pool,base,token:merchant.token,accountId:merchant.accountId,orderId
  });

  const storefront=await requestJson(base,`/api/merchant/storefront?business_id=${businessId}`,{token:merchant.token});
  expectStatus(storefront,200,'Merchant private storefront persistence');
  if(!(storefront.json?.products||[]).some(x=>x.name==='QA Fish Soup')){
    throw new Error('Merchant catalog did not persist after the Customer order flow.');
  }

  const logout=await requestJson(base,'/api/auth/logout',{method:'POST',token:merchant.token,body:{}});
  expectStatus(logout,200,'Merchant Experience logout');
  const relogin=await loginWithCredential({
    base,email:MERCHANT_ALIAS,password:merchant.password,label:'Merchant Experience final re-login'
  });
  const finalLogout=await requestJson(base,'/api/auth/logout',{method:'POST',token:relogin,body:{}});
  expectStatus(finalLogout,200,'Merchant Experience final logout');

  return{
    status:'PASS',
    wave:MERCHANT_EXPERIENCE_WAVE,
    account_role:'merchant',
    business_id:businessId,
    order_id:orderId,
    account_home:true,
    catalog_persisted:true,
    finance_reconciled:true,
    confirmed_merchandise_received_minimum:185,
    settings_context:true,
    shared_account_money_context:true,
    notification_lifecycle:true,
    notification_events:notificationCount,
    support_ticket_id:supportTicketId,
    support:true,
    logout_relogin:true,
    supplier_procurement_e2e:'HOLD_FOR_SUPPLIER_WAVE',
    delivery_e2e:'HOLD_FOR_COURIER_WAVE',
    live_online_payment:'HOLD_FOR_PAYMONGO_LIVE_GATE'
  };
}


const SUPPLIER_QA_PRODUCT='QA Supplier Rice Pack';
const SUPPLIER_QA_PO_NOTE='Controlled QA Supplier Experience PO v1';
const SUPPLIER_QA_PRICE=120;
const SUPPLIER_QA_PACKS=2;
const SUPPLIER_V2_EXTERNAL_NAME='QA Public Market Rice Vendor';
const SUPPLIER_V2_SOURCE_ITEM='QA Bulk Rice V2';
const SUPPLIER_V2_OUTPUT_ITEM='QA Rice 1kg Bag V2';
const SUPPLIER_V2_TIER_PRODUCT='QA Bottled Drink Case V2';
const SUPPLIER_V2_TIER_PO_NOTE='Controlled QA Supplier Domain V2 tier PO';

async function latestSupplierApplication(pool,accountId){
  const q=await pool.query(
    `SELECT * FROM profile_applications
      WHERE account_id=$1 AND role='supplier'
      ORDER BY id DESC LIMIT 1`,
    [Number(accountId)]
  );
  return q.rows[0]||null;
}

async function ensureSupplierApproved({pool,base,supplier,adminToken,territoryId}){
  let application=await latestSupplierApplication(pool,supplier.accountId);
  let invitationId=Number(application?.invitation_id||0);

  if(!invitationId){
    if(application?.status==='approved'){
      throw new Error('Supplier approval is missing the required invitation evidence.');
    }
    const invited=await requestJson(base,'/api/governance/admin/invitations',{
      method:'POST',token:adminToken,
      body:{
        role:'supplier',
        target_email:SUPPLIER_ALIAS,
        territory_id:territoryId,
        expires_days:7,
        note:'Controlled internal QA Supplier invitation. Not a real Supplier.'
      }
    });
    expectStatus(invited,201,'Supplier Admin invitation');
    invitationId=Number(invited.json?.id);
    if(!invitationId)throw new Error('Supplier invitation did not return an id.');

    const accepted=await requestJson(base,`/api/governance/invitations/${invitationId}/accept`,{
      method:'POST',token:supplier.token,body:{}
    });
    expectStatus(accepted,200,'Supplier invitation acceptance');
    application=accepted.json;
  }

  application=await latestSupplierApplication(pool,supplier.accountId);
  if(!application?.invitation_id)throw new Error('Supplier application is not backed by an invitation.');

  if(['application_started','requirements_pending','rejected'].includes(application.status)){
    const edited=await requestJson(base,`/api/governance/applications/${Number(application.id)}`,{
      method:'PUT',token:supplier.token,
      body:{
        proposed_business_name:'Business & Life QA Supply',
        applicant_note:'Controlled internal QA Supplier fixture. Not a real Supplier.',
        responsibility_acknowledged:true,
        application_data:{
          test_fixture:true,
          supplier_type:'food_wholesale',
          onboarding_version:'supplier-experience-v1'
        }
      }
    });
    expectStatus(edited,200,'Supplier application edit');

    const submitted=await requestJson(base,`/api/governance/applications/${Number(application.id)}/submit`,{
      method:'POST',token:supplier.token,body:{}
    });
    expectStatus(submitted,200,'Supplier application submit');
    application=submitted.json;
  }

  application=await latestSupplierApplication(pool,supplier.accountId);
  if(['submitted','under_review'].includes(application?.status)){
    const reviewed=await requestJson(base,`/api/governance/admin/applications/${Number(application.id)}/review`,{
      method:'POST',token:adminToken,
      body:{decision:'approve',reason:'Controlled internal QA Supplier acceptance fixture'}
    });
    expectStatus(reviewed,200,'Supplier Admin approval');
  }

  const profile=await pool.query(
    `SELECT enabled,status FROM profiles WHERE account_id=$1 AND role='supplier'`,
    [supplier.accountId]
  );
  if(!profile.rows[0]?.enabled||profile.rows[0]?.status!=='active'){
    throw new Error('Supplier profile did not become active.');
  }

  await ensureActiveRole({base,token:supplier.token,role:'supplier',label:'Supplier Experience QA'});
  return{applicationId:Number(application?.id||0),invitationId};
}

async function ensureQaSupplierCatalogItem({base,token}){
  const profile=await requestJson(base,'/api/supplier/me',{token});
  expectStatus(profile,200,'Supplier private profile');

  const saved=await requestJson(base,'/api/supplier/me',{
    method:'PUT',token,
    body:{
      supplier_name:'Business & Life QA Supply',
      description:'Controlled internal QA Supplier. Not a real supplier.',
      delivery_available:true,
      service_area:'QA Pilot City, Philippines',
      normal_lead_days:1,
      minimum_order_value:0,
      notes:'Internal Supplier E2E fixture only.'
    }
  });
  expectStatus(saved,200,'Supplier profile update');

  let item=(Array.isArray(saved.json?.catalog)?saved.json.catalog:[]).find(
    x=>x.product_name===SUPPLIER_QA_PRODUCT
  );
  if(!item){
    const created=await requestJson(base,'/api/supplier/catalog',{
      method:'POST',token,
      body:{
        product_name:SUPPLIER_QA_PRODUCT,
        sku:'QA-SUP-RICE-001',
        unit_name:'pack',
        base_unit:'unit',
        base_units_per_pack:1,
        price_per_pack:SUPPLIER_QA_PRICE,
        minimum_packs:1,
        availability_status:'available',
        lead_time_days:1
      }
    });
    expectStatus(created,201,'Supplier catalog item create');
    item=created.json;
  }else{
    const patched=await requestJson(base,`/api/supplier/catalog/${Number(item.id)}`,{
      method:'PATCH',token,
      body:{
        product_name:SUPPLIER_QA_PRODUCT,
        sku:'QA-SUP-RICE-001',
        unit_name:'pack',
        base_unit:'unit',
        base_units_per_pack:1,
        price_per_pack:SUPPLIER_QA_PRICE,
        minimum_packs:1,
        availability_status:'available',
        lead_time_days:1,
        active:true
      }
    });
    expectStatus(patched,200,'Supplier catalog item normalize');
    item=patched.json;
  }
  if(!item?.id||Number(item.price_per_pack)!==SUPPLIER_QA_PRICE){
    throw new Error('Supplier catalog fixture is not stable.');
  }
  return item;
}

async function supplierNotificationsForPo({base,token,poId,businessId,supplierAccountId}){
  const requiredPo=new Set(['procurement.po_created','procurement.po_updated','procurement.payment_received']);
  let rows=[];
  for(let attempt=0;attempt<20;attempt++){
    const inbox=await requestJson(base,'/api/notifications?limit=150',{token});
    expectStatus(inbox,200,'Supplier notification inbox');
    const all=Array.isArray(inbox.json)?inbox.json:[];
    rows=all.filter(x=>x.entity_type==='purchase_order'&&Number(x.entity_id)===Number(poId));
    const relationship=all.some(
      x=>x.entity_type==='supplier_relationship'
        &&String(x.entity_id)===String(businessId)+':'+String(supplierAccountId)
        &&x.event_code==='supplier.relationship_invited'
    );
    const poCodes=new Set(rows.map(x=>x.event_code));
    if(relationship&&[...requiredPo].every(code=>poCodes.has(code))){
      return{poEvents:rows.length,relationshipInvite:true};
    }
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  const codes=new Set(rows.map(x=>x.event_code));
  for(const code of requiredPo){
    if(!codes.has(code))throw new Error('Supplier notification lifecycle is missing '+code+'.');
  }
  throw new Error('Supplier relationship invitation notification is missing.');
}

async function ensureQaSupplierSupportTicket({pool,base,token,accountId,poId}){
  const subject='Controlled QA Supplier support E2E PO '+Number(poId);
  const existing=await pool.query(
    `SELECT id FROM support_tickets
      WHERE requester_account_id=$1 AND subject=$2
      ORDER BY id DESC LIMIT 1`,
    [Number(accountId),subject]
  );
  let ticketId=Number(existing.rows[0]?.id||0);
  if(!ticketId){
    const created=await requestJson(base,'/api/support/tickets',{
      method:'POST',token,
      body:{
        category:'other',
        subject,
        description:'Controlled internal QA Supplier support request linked to a purchase order. No real supplier issue.',
        requested_destination:'support',
        related_type:'purchase_order',
        related_id:Number(poId),
        source_language:'en-PH'
      }
    });
    expectStatus(created,201,'Supplier Support ticket create');
    ticketId=Number(created.json?.id);
  }
  if(!ticketId)throw new Error('Supplier Support ticket was not created.');

  const detail=await requestJson(base,`/api/support/tickets/${ticketId}`,{token});
  expectStatus(detail,200,'Supplier Support ticket detail');
  if(Number(detail.json?.related_id)!==Number(poId)||detail.json?.related_type!=='purchase_order'){
    throw new Error('Supplier Support ticket lost its purchase-order context.');
  }
  const mine=await requestJson(base,'/api/support/tickets/mine',{token});
  expectStatus(mine,200,'Supplier Support My tickets');
  if(!(Array.isArray(mine.json)?mine.json:[]).some(x=>Number(x.id)===ticketId)){
    throw new Error('Supplier Support ticket is missing from My Support.');
  }
  return ticketId;
}

async function runSupplierExperienceAcceptance({pool,base,secret}){
  const merchantSeed=await runMerchantCatalogSeed({pool,base,secret});
  if(merchantSeed.status!=='PASS')throw new Error('Merchant catalog prerequisite did not pass.');

  const [admin,supplier,merchant]=await Promise.all([
    qaAccountSession({pool,base,secret,email:SUPER_ADMIN_ALIAS,role:'super_admin',label:'Supplier Experience Super Admin QA'}),
    qaAccountSession({pool,base,secret,email:SUPPLIER_ALIAS,role:'supplier',label:'Supplier Experience QA'}),
    qaAccountSession({pool,base,secret,email:MERCHANT_ALIAS,role:'merchant',label:'Supplier Experience Merchant QA'})
  ]);
  const territoryId=await ensureQaTerritory({pool,base,adminToken:admin.token});
  const onboarding=await ensureSupplierApproved({
    pool,base,supplier,adminToken:admin.token,territoryId
  });
  await ensureActiveRole({base,token:merchant.token,role:'merchant',label:'Supplier Experience Merchant QA'});

  const supplierItem=await ensureQaSupplierCatalogItem({base,token:supplier.token});

  const merchantMe=await requestJson(base,'/api/me',{token:merchant.token});
  expectStatus(merchantMe,200,'Supplier Experience Merchant account snapshot');
  const merchantBusiness=(merchantMe.json?.businesses||[]).find(
    x=>Number(x.id)===Number(merchantSeed.business_id)
  )||(merchantMe.json?.businesses||[])[0];
  if(!merchantBusiness?.id)throw new Error('Supplier Experience Merchant business workspace is unavailable.');
  const merchantBusinessId=Number(merchantBusiness.id);

  const relationshipInvite=await requestJson(base,'/api/procurement/relationships/invite',{
    method:'POST',token:merchant.token,
    body:{
      business_id:merchantBusinessId,
      supplier_email:SUPPLIER_ALIAS,
      note:'Controlled QA Merchant → Supplier relationship'
    }
  });
  expectStatus(relationshipInvite,201,'Merchant Supplier relationship invite');
  if(Number(relationshipInvite.json?.supplier_account_id)!==Number(supplier.accountId)){
    throw new Error('Supplier relationship resolved the wrong account.');
  }

  const relationshipAccept=await requestJson(
    base,`/api/supplier/relationships/${merchantBusinessId}/respond`,
    {method:'POST',token:supplier.token,body:{accept:true}}
  );
  expectStatus(relationshipAccept,200,'Supplier relationship acceptance');
  if(relationshipAccept.json?.state!=='accepted')throw new Error('Supplier relationship did not become accepted.');

  const merchantCatalog=await requestJson(
    base,
    `/api/procurement/suppliers/${supplier.accountId}/catalog?business_id=${merchantBusinessId}`,
    {token:merchant.token}
  );
  expectStatus(merchantCatalog,200,'Merchant Supplier catalog');
  const merchantItem=(merchantCatalog.json?.items||[]).find(x=>Number(x.id)===Number(supplierItem.id));
  if(!merchantItem)throw new Error('Merchant cannot see the accepted Supplier catalog item.');

  const existing=await pool.query(
    `SELECT id FROM purchase_orders
      WHERE business_id=$1 AND supplier_account_id=$2 AND merchant_note=$3
      ORDER BY id DESC LIMIT 1`,
    [merchantBusinessId,supplier.accountId,SUPPLIER_QA_PO_NOTE]
  );
  let po;
  if(existing.rowCount){
    const detail=await requestJson(base,`/api/procurement/orders/${Number(existing.rows[0].id)}`,{token:merchant.token});
    expectStatus(detail,200,'Existing Supplier Experience PO');
    po=detail.json;
  }else{
    const created=await requestJson(base,'/api/procurement/orders',{
      method:'POST',token:merchant.token,
      body:{
        business_id:merchantBusinessId,
        supplier_account_id:supplier.accountId,
        fulfilment_mode:'delivery',
        delivery_fee:0,
        merchant_note:SUPPLIER_QA_PO_NOTE,
        items:[{catalog_item_id:Number(supplierItem.id),packs:SUPPLIER_QA_PACKS}]
      }
    });
    expectStatus(created,201,'Merchant purchase order create');
    po=created.json;
  }

  const poId=Number(po?.id);
  if(!poId)throw new Error('Supplier Experience purchase order is missing.');
  if(!closeEnough(po.expected_total,SUPPLIER_QA_PRICE*SUPPLIER_QA_PACKS)){
    throw new Error('Supplier Experience purchase order total is not deterministic.');
  }

  if(['sent','supplier_received','accepted','partially_accepted'].includes(po.status)){
    const items=(po.items||[]).map(item=>({
      item_id:Number(item.id),
      confirmed_packs:Number(item.ordered_packs),
      confirmed_price_per_pack:Number(item.price_per_pack_snapshot)
    }));
    const responded=await requestJson(base,`/api/supplier/orders/${poId}/respond`,{
      method:'POST',token:supplier.token,
      body:{items,supplier_note:'Controlled QA Supplier accepts the purchase order.'}
    });
    expectStatus(responded,200,'Supplier purchase order acceptance');
    po=responded.json;
  }

  if(!['received','partially_received','cancelled','rejected'].includes(po.status)){
    const preparing=await requestJson(base,`/api/supplier/orders/${poId}/status`,{
      method:'POST',token:supplier.token,
      body:{status:'preparing',supplier_note:'Controlled QA preparation state.'}
    });
    expectStatus(preparing,200,'Supplier PO preparing');
    const delivered=await requestJson(base,`/api/supplier/orders/${poId}/status`,{
      method:'POST',token:supplier.token,
      body:{status:'delivered',supplier_note:'Controlled QA delivery state.'}
    });
    expectStatus(delivered,200,'Supplier PO delivered');
    po=delivered.json;
  }

  if(po.status!=='received'){
    const receiveItems=(po.items||[]).map(item=>({
      item_id:Number(item.id),
      received_packs:Math.max(0,Number(item.confirmed_packs??item.ordered_packs)-Number(item.received_packs||0)),
      actual_price_per_pack:Number(item.confirmed_price_per_pack??item.price_per_pack_snapshot)
    })).filter(item=>item.received_packs>0);
    if(receiveItems.length){
      const received=await requestJson(base,`/api/procurement/orders/${poId}/receive`,{
        method:'POST',token:merchant.token,
        body:{items:receiveItems,note:'Controlled QA Merchant receipt of Supplier PO.'}
      });
      expectStatus(received,200,'Merchant purchase order receipt');
      po=received.json;
    }
  }
  if(po.status!=='received')throw new Error('Supplier Experience purchase order was not fully received.');

  const outstanding=Math.max(0,Number(po.expected_total)-Number(po.paid_amount||0));
  if(outstanding>0.001){
    const paid=await requestJson(base,`/api/procurement/orders/${poId}/payment`,{
      method:'POST',token:merchant.token,
      body:{amount:outstanding,account:'cash'}
    });
    expectStatus(paid,200,'Merchant Supplier payment');
    po=paid.json;
  }
  if(po.payment_status!=='paid'||Number(po.paid_amount)+0.001<Number(po.expected_total)){
    throw new Error('Supplier Experience PO payment did not reconcile.');
  }

  const supplierFinance=await requestJson(base,'/api/accounting/finance-overview',{token:supplier.token});
  expectStatus(supplierFinance,200,'Supplier Finance overview');
  if(supplierFinance.json?.role!=='supplier'||!supplierFinance.json?.business?.id){
    throw new Error('Supplier Finance did not resolve a Supplier business workspace.');
  }
  const supplierBusinessId=Number(supplierFinance.json.business.id);
  const expectedTotal=SUPPLIER_QA_PRICE*SUPPLIER_QA_PACKS;
  if(Number(supplierFinance.json?.commercial?.received_po_count||0)<1
    ||Number(supplierFinance.json?.cash_evidence?.account_level_po_paid_amount||0)<expectedTotal
    ||Number(supplierFinance.json?.cash_evidence?.business_ledger_recorded_receipts||0)<expectedTotal){
    throw new Error('Supplier Finance is missing fulfilled-PO or recorded-payment evidence.');
  }

  const supplierMe=await requestJson(base,'/api/me',{token:supplier.token});
  expectStatus(supplierMe,200,'Supplier Account Home');
  const supplierProfile=(supplierMe.json?.profiles||[]).find(x=>x.role==='supplier');
  if(supplierMe.json?.account?.active_role!=='supplier'||!supplierProfile?.enabled||supplierProfile?.status!=='active'
    ||!(supplierMe.json?.businesses||[]).some(x=>Number(x.id)===supplierBusinessId)){
    throw new Error('Supplier Account Home does not preserve the active Supplier business workspace.');
  }

  const settings=await requestJson(base,'/api/settings/finance',{token:supplier.token});
  expectStatus(settings,200,'Supplier Profile Settings finance state');
  const settingsProfile=(settings.json?.profiles||[]).find(x=>x.role==='supplier');
  if(settings.json?.active_role!=='supplier'||!settingsProfile?.enabled
    ||!(settings.json?.businesses||[]).some(x=>Number(x.id)===supplierBusinessId)
    ||!settings.json?.account_money){
    throw new Error('Supplier Settings does not preserve profile, business and shared Money & Banking context.');
  }

  const notificationEvidence=await supplierNotificationsForPo({
    base,token:supplier.token,poId,businessId:merchantBusinessId,supplierAccountId:supplier.accountId
  });
  const supportTicketId=await ensureQaSupplierSupportTicket({
    pool,base,token:supplier.token,accountId:supplier.accountId,poId
  });

  const merchantFinance=await requestJson(base,'/api/accounting/finance-overview',{token:merchant.token});
  expectStatus(merchantFinance,200,'Merchant Finance after Supplier settlement');
  const finalPo=await requestJson(base,`/api/procurement/orders/${poId}`,{token:merchant.token});
  expectStatus(finalPo,200,'Merchant final Supplier PO detail');
  if(finalPo.json?.status!=='received'||finalPo.json?.payment_status!=='paid'){
    throw new Error('Merchant and Supplier views do not agree on the settled purchase order.');
  }

  const supplierLogout=await requestJson(base,'/api/auth/logout',{method:'POST',token:supplier.token,body:{}});
  expectStatus(supplierLogout,200,'Supplier Experience logout');
  const relogin=await loginWithCredential({
    base,email:SUPPLIER_ALIAS,password:supplier.password,label:'Supplier Experience final re-login'
  });
  const finalLogout=await requestJson(base,'/api/auth/logout',{method:'POST',token:relogin,body:{}});
  expectStatus(finalLogout,200,'Supplier Experience final logout');
  const merchantLogout=await requestJson(base,'/api/auth/logout',{method:'POST',token:merchant.token,body:{}});
  expectStatus(merchantLogout,200,'Supplier Experience Merchant logout');
  const adminLogout=await requestJson(base,'/api/auth/logout',{method:'POST',token:admin.token,body:{}});
  expectStatus(adminLogout,200,'Supplier Experience Admin logout');

  return{
    status:'PASS',
    wave:SUPPLIER_EXPERIENCE_WAVE,
    account_role:'supplier',
    invitation_id:onboarding.invitationId,
    application_id:onboarding.applicationId,
    supplier_business_id:supplierBusinessId,
    merchant_business_id:merchantBusinessId,
    catalog_item_id:Number(supplierItem.id),
    purchase_order_id:poId,
    purchase_order_total:expectedTotal,
    purchase_order_received:true,
    purchase_order_paid:true,
    finance_recorded_payment:true,
    settings_context:true,
    shared_account_money_context:true,
    notification_lifecycle:true,
    notification_events:notificationEvidence.poEvents,
    relationship_invite_notification:notificationEvidence.relationshipInvite,
    support_ticket_id:supportTicketId,
    support:true,
    merchant_reconciliation:true,
    logout_relogin:true,
    provider_payout_settlement:supplierFinance.json?.settlement?.status||'NOT_CONFIGURED',
    live_online_payment:'HOLD_FOR_PAYMONGO_LIVE_GATE'
  };
}


async function runSupplierDomainV2Acceptance({pool,base,secret}){
  const baseline=await runSupplierExperienceAcceptance({pool,base,secret});
  if(baseline.status!=='PASS')throw new Error('Supplier V1 prerequisite did not pass.');

  const [supplier,merchant]=await Promise.all([
    qaAccountSession({pool,base,secret,email:SUPPLIER_ALIAS,role:'supplier',label:'Supplier Domain V2 QA'}),
    qaAccountSession({pool,base,secret,email:MERCHANT_ALIAS,role:'merchant',label:'Supplier Domain V2 Merchant QA'})
  ]);
  await ensureActiveRole({base,token:supplier.token,role:'supplier',label:'Supplier Domain V2 QA'});
  await ensureActiveRole({base,token:merchant.token,role:'merchant',label:'Supplier Domain V2 Merchant QA'});

  const supplierBusinessId=Number(baseline.supplier_business_id);
  const merchantBusinessId=Number(baseline.merchant_business_id);
  if(!supplierBusinessId||!merchantBusinessId)throw new Error('Supplier V2 prerequisite business context is missing.');

  const activities=await requestJson(base,'/api/supplier/v2/activities',{
    method:'PUT',token:supplier.token,
    body:{business_id:supplierBusinessId,activities:['wholesaler','repacker','retailer']}
  });
  expectStatus(activities,200,'Supplier V2 business activities');
  if(!['wholesaler','repacker','retailer'].every(code=>(activities.json?.activities||[]).includes(code))){
    throw new Error('Supplier V2 business activities did not persist.');
  }

  const supplierProfile=await requestJson(base,'/api/supplier/me',{token:supplier.token});
  expectStatus(supplierProfile,200,'Supplier V2 catalog discovery');
  let tierItem=(supplierProfile.json?.catalog||[]).find(x=>x.product_name===SUPPLIER_V2_TIER_PRODUCT);
  if(!tierItem){
    const created=await requestJson(base,'/api/supplier/catalog',{
      method:'POST',token:supplier.token,
      body:{
        product_name:SUPPLIER_V2_TIER_PRODUCT,
        sku:'QA-SUP-V2-CASE-001',
        unit_name:'case',
        base_unit:'bottle',
        base_units_per_pack:24,
        price_per_pack:720,
        minimum_packs:1,
        availability_status:'available',
        lead_time_days:1
      }
    });
    expectStatus(created,201,'Supplier V2 tier catalog create');
    tierItem=created.json;
  }
  if(!tierItem?.id)throw new Error('Supplier V2 tier catalog item is unavailable.');

  const v2catalog=await requestJson(base,`/api/supplier/catalog/${Number(tierItem.id)}/v2`,{
    method:'PUT',token:supplier.token,
    body:{
      handling_mode:'break_pack',
      price_tiers:[{minimum_quantity:2,price_per_pack:680,label:'2+ cases'}],
      package_levels:[{level_name:'case',base_unit:'bottle',base_units_per_level:24,saleable:true,sort_order:0}]
    }
  });
  expectStatus(v2catalog,200,'Supplier V2 catalog packaging');
  if(v2catalog.json?.handling_mode!=='break_pack'
    ||Number(v2catalog.json?.price_tiers?.[0]?.price_per_pack)!==680
    ||Number(v2catalog.json?.package_levels?.[0]?.base_units_per_level)!==24){
    throw new Error('Supplier V2 catalog packaging or tier pricing did not persist.');
  }

  const merchantCatalog=await requestJson(
    base,
    `/api/procurement/suppliers/${supplier.accountId}/catalog?business_id=${merchantBusinessId}`,
    {token:merchant.token}
  );
  expectStatus(merchantCatalog,200,'Merchant Supplier V2 tier catalog');
  const tierVisible=(merchantCatalog.json?.items||[]).find(x=>Number(x.id)===Number(tierItem.id));
  if(!tierVisible||(tierVisible.price_tiers||[]).length!==1){
    throw new Error('Merchant cannot see Supplier V2 volume pricing.');
  }

  const priorTierPo=await pool.query(
    `SELECT id FROM purchase_orders
      WHERE business_id=$1 AND supplier_account_id=$2 AND merchant_note=$3
      ORDER BY id DESC LIMIT 1`,
    [merchantBusinessId,supplier.accountId,SUPPLIER_V2_TIER_PO_NOTE]
  );
  let tierPo;
  if(priorTierPo.rowCount){
    const existing=await requestJson(base,`/api/procurement/orders/${Number(priorTierPo.rows[0].id)}`,{token:merchant.token});
    expectStatus(existing,200,'Existing Supplier V2 tier PO');
    tierPo=existing.json;
  }else{
    const created=await requestJson(base,'/api/procurement/orders',{
      method:'POST',token:merchant.token,
      body:{
        business_id:merchantBusinessId,
        supplier_account_id:supplier.accountId,
        fulfilment_mode:'pickup',
        delivery_fee:0,
        merchant_note:SUPPLIER_V2_TIER_PO_NOTE,
        items:[{catalog_item_id:Number(tierItem.id),packs:2}]
      }
    });
    expectStatus(created,201,'Supplier V2 tier PO create');
    tierPo=created.json;
  }
  if(!closeEnough(tierPo?.expected_total,1360)
    ||!closeEnough(tierPo?.items?.[0]?.price_per_pack_snapshot,680)){
    throw new Error('Supplier V2 qualifying tier was not snapshotted into the purchase order.');
  }

  await pool.query(
    `DELETE FROM supply_repack_operations
      WHERE business_id=$1 AND (
        source_lot_id IN (SELECT id FROM supply_lots WHERE business_id=$1 AND item_name=ANY($2::text[]))
        OR output_lot_id IN (SELECT id FROM supply_lots WHERE business_id=$1 AND item_name=ANY($2::text[]))
      )`,
    [merchantBusinessId,[SUPPLIER_V2_SOURCE_ITEM,SUPPLIER_V2_OUTPUT_ITEM]]
  );
  await pool.query(
    `DELETE FROM supply_lots WHERE business_id=$1 AND item_name=$2`,
    [merchantBusinessId,SUPPLIER_V2_OUTPUT_ITEM]
  );
  await pool.query(
    `DELETE FROM supply_lots WHERE business_id=$1 AND item_name=$2`,
    [merchantBusinessId,SUPPLIER_V2_SOURCE_ITEM]
  );
  await pool.query(
    `DELETE FROM merchant_supply_parties WHERE business_id=$1 AND display_name=$2`,
    [merchantBusinessId,SUPPLIER_V2_EXTERNAL_NAME]
  );

  const sourceInv=await pool.query(
    `INSERT INTO inventory(business_id,item,unit,quantity,reorder_level,unit_cost,measurement_family,base_unit)
     VALUES($1,$2,'g',0,0,0,'mass','g')
     ON CONFLICT(business_id,item) DO UPDATE
       SET unit='g',quantity=0,reorder_level=0,unit_cost=0,measurement_family='mass',base_unit='g',updated_at=NOW()
     RETURNING id`,
    [merchantBusinessId,SUPPLIER_V2_SOURCE_ITEM]
  );
  const outputInv=await pool.query(
    `INSERT INTO inventory(business_id,item,unit,quantity,reorder_level,unit_cost,measurement_family,base_unit)
     VALUES($1,$2,'g',0,0,0,'mass','g')
     ON CONFLICT(business_id,item) DO UPDATE
       SET unit='g',quantity=0,reorder_level=0,unit_cost=0,measurement_family='mass',base_unit='g',updated_at=NOW()
     RETURNING id`,
    [merchantBusinessId,SUPPLIER_V2_OUTPUT_ITEM]
  );

  const party=await requestJson(base,'/api/procurement/supply-parties',{
    method:'POST',token:merchant.token,
    body:{
      business_id:merchantBusinessId,
      display_name:SUPPLIER_V2_EXTERNAL_NAME,
      contact_name:'Controlled QA Vendor',
      phone:'+630000000000',
      location_note:'Controlled QA public market fixture',
      notes:'No real vendor. Supplier Domain V2 acceptance fixture.'
    }
  });
  expectStatus(party,201,'Supplier V2 external party create');
  if(party.json?.source_type!=='external'||party.json?.supplier_account_id!=null){
    throw new Error('Supplier V2 external party was incorrectly treated as a connected account.');
  }

  const sourceLot=await requestJson(base,'/api/procurement/supply-lots',{
    method:'POST',token:merchant.token,
    body:{
      business_id:merchantBusinessId,
      supply_party_id:Number(party.json.id),
      inventory_id:Number(sourceInv.rows[0].id),
      item_name:SUPPLIER_V2_SOURCE_ITEM,
      quantity_base:50000,
      base_unit:'g',
      total_cost:2300,
      handling_mode:'bulk',
      supplier_lot_code:'QA-RICE-BULK-001',
      expires_at:'2027-06-30T23:59:59+08:00',
      note:'Controlled QA Supplier V2 bulk receipt'
    }
  });
  expectStatus(sourceLot,201,'Supplier V2 external lot receive');

  const sourceAfterReceipt=await pool.query(
    `SELECT quantity,unit_cost FROM inventory WHERE id=$1 AND business_id=$2`,
    [sourceInv.rows[0].id,merchantBusinessId]
  );
  if(!closeEnough(sourceAfterReceipt.rows[0]?.quantity,50000)
    ||!closeEnough(sourceAfterReceipt.rows[0]?.unit_cost,0.046,0.000001)){
    throw new Error('Supplier V2 external receipt did not update source Inventory correctly.');
  }

  const repacked=await requestJson(base,`/api/procurement/supply-lots/${Number(sourceLot.json.id)}/repack`,{
    method:'POST',token:merchant.token,
    body:{
      business_id:merchantBusinessId,
      output_item_name:SUPPLIER_V2_OUTPUT_ITEM,
      input_quantity_base:50000,
      waste_quantity_base:1000,
      package_size_base:1000,
      output_packages:49,
      package_unit_name:'bag',
      packaging_cost_per_output:2,
      output_inventory_id:Number(outputInv.rows[0].id),
      note:'Controlled QA Supplier V2 repack'
    }
  });
  expectStatus(repacked,201,'Supplier V2 repack');
  if(!closeEnough(repacked.json?.operation?.packed_quantity,49000)
    ||!closeEnough(repacked.json?.operation?.waste_quantity,1000)
    ||!closeEnough(repacked.json?.operation?.total_output_cost,2398)){
    throw new Error('Supplier V2 repack quantity/cost conservation failed.');
  }

  const inventoryCheck=await pool.query(
    `SELECT item,quantity,unit_cost FROM inventory
      WHERE business_id=$1 AND item=ANY($2::text[])`,
    [merchantBusinessId,[SUPPLIER_V2_SOURCE_ITEM,SUPPLIER_V2_OUTPUT_ITEM]]
  );
  const invByName=new Map(inventoryCheck.rows.map(x=>[x.item,x]));
  if(!closeEnough(invByName.get(SUPPLIER_V2_SOURCE_ITEM)?.quantity,0)
    ||!closeEnough(invByName.get(SUPPLIER_V2_OUTPUT_ITEM)?.quantity,49000)){
    throw new Error('Supplier V2 repack did not conserve Inventory quantities.');
  }

  const lots=await requestJson(base,`/api/procurement/supply-lots?business_id=${merchantBusinessId}`,{token:merchant.token});
  expectStatus(lots,200,'Supplier V2 lot list');
  const source=(lots.json||[]).find(x=>Number(x.id)===Number(sourceLot.json.id));
  const output=(lots.json||[]).find(x=>Number(x.id)===Number(repacked.json?.output_lot?.id));
  if(!source||!output||!closeEnough(source.quantity_remaining_base,0)
    ||!closeEnough(output.quantity_remaining_base,49000)
    ||Number(output.parent_lot_id)!==Number(source.id)
    ||output.handling_mode!=='repacked'){
    throw new Error('Supplier V2 lot lineage is incomplete.');
  }
  if(new Date(output.expires_at).getTime()!==new Date(source.expires_at).getTime()){
    throw new Error('Supplier V2 child lot did not inherit the source expiry.');
  }

  const supplierLogout=await requestJson(base,'/api/auth/logout',{method:'POST',token:supplier.token,body:{}});
  expectStatus(supplierLogout,200,'Supplier V2 logout');
  const merchantLogout=await requestJson(base,'/api/auth/logout',{method:'POST',token:merchant.token,body:{}});
  expectStatus(merchantLogout,200,'Supplier V2 Merchant logout');

  return{
    status:'PASS',
    wave:SUPPLIER_DOMAIN_V2_WAVE,
    supplier_v1_baseline:true,
    supplier_business_id:supplierBusinessId,
    merchant_business_id:merchantBusinessId,
    activities:true,
    external_supplier:true,
    connected_supplier:true,
    break_pack_catalog:true,
    tier_price_snapshot:true,
    tier_purchase_order_id:Number(tierPo.id),
    source_lot_id:Number(source.id),
    output_lot_id:Number(output.id),
    lot_lineage:true,
    expiry_lineage:true,
    quantity_conservation:true,
    source_inventory_remaining:0,
    output_inventory_quantity:49000,
    waste_quantity:1000,
    total_repack_cost:2398
  };
}


async function runSupplierCommercialV3Acceptance({pool,base,secret}){
  const baseline=await runSupplierDomainV2Acceptance({pool,base,secret});
  if(baseline.status!=='PASS')throw new Error('Supplier Domain V2 prerequisite did not pass.');

  const [supplier,merchant]=await Promise.all([
    qaAccountSession({pool,base,secret,email:SUPPLIER_ALIAS,role:'supplier',label:'Supplier Commercial V3 QA'}),
    qaAccountSession({pool,base,secret,email:MERCHANT_ALIAS,role:'merchant',label:'Supplier Commercial V3 Merchant QA'})
  ]);
  await ensureActiveRole({base,token:supplier.token,role:'supplier',label:'Supplier Commercial V3 QA'});
  await ensureActiveRole({base,token:merchant.token,role:'merchant',label:'Supplier Commercial V3 Merchant QA'});

  const merchantBusinessId=Number(baseline.merchant_business_id);
  if(!merchantBusinessId)throw new Error('Supplier Commercial V3 merchant business context is missing.');

  const terms=await requestJson(base,`/api/supplier/relationships/${merchantBusinessId}/terms`,{
    method:'PUT',token:supplier.token,
    body:{paymentTermCode:'net_30',creditLimit:10000,currencyCode:'PHP',note:'Controlled QA Net 30 terms'}
  });
  expectStatus(terms,200,'Supplier Commercial V3 terms');
  if(terms.json?.payment_term_code!=='net_30'||Number(terms.json?.credit_limit)!==10000){
    throw new Error('Supplier Commercial V3 terms did not persist.');
  }

  const supplierProfile=await requestJson(base,'/api/supplier/me',{token:supplier.token});
  expectStatus(supplierProfile,200,'Supplier Commercial V3 catalog discovery');
  const productName='QA Commercial V3 Pack';
  let item=(supplierProfile.json?.catalog||[]).find(x=>x.product_name===productName);
  if(!item){
    const created=await requestJson(base,'/api/supplier/catalog',{
      method:'POST',token:supplier.token,
      body:{
        product_name:productName,sku:'QA-SUP-V3-PACK-001',unit_name:'pack',base_unit:'unit',
        base_units_per_pack:1,price_per_pack:250,minimum_packs:1,availability_status:'available',lead_time_days:1
      }
    });
    expectStatus(created,201,'Supplier Commercial V3 catalog create');
    item=created.json;
  }
  if(!item?.id)throw new Error('Supplier Commercial V3 catalog item is unavailable.');

  const itemV2=await requestJson(base,`/api/supplier/catalog/${Number(item.id)}/v2`,{
    method:'PUT',token:supplier.token,
    body:{handling_mode:'sealed_resale',price_tiers:[],package_levels:[]}
  });
  expectStatus(itemV2,200,'Supplier Commercial V3 handling mode');

  const inventory=await pool.query(
    `INSERT INTO inventory(business_id,item,unit,quantity,reorder_level,unit_cost,measurement_family,base_unit)
     VALUES($1,$2,'unit',0,0,0,'count','unit')
     ON CONFLICT(business_id,item) DO UPDATE
       SET unit='unit',quantity=0,reorder_level=0,unit_cost=0,measurement_family='count',base_unit='unit',updated_at=NOW()
     RETURNING id`,
    [merchantBusinessId,'QA Commercial V3 Inventory']
  );
  const inventoryId=Number(inventory.rows[0].id);

  const linked=await requestJson(base,`/api/procurement/catalog/${Number(item.id)}/link`,{
    method:'PUT',token:merchant.token,
    body:{business_id:merchantBusinessId,legacy_inventory_id:inventoryId,merchant_item_name:'QA Commercial V3 Inventory'}
  });
  expectStatus(linked,200,'Supplier Commercial V3 Inventory link');

  const poCreated=await requestJson(base,'/api/procurement/orders',{
    method:'POST',token:merchant.token,
    body:{
      business_id:merchantBusinessId,
      supplier_account_id:supplier.accountId,
      fulfilment_mode:'delivery',
      delivery_fee:0,
      merchant_note:'Controlled QA Supplier Commercial V3 PO',
      items:[{catalog_item_id:Number(item.id),packs:4}]
    }
  });
  expectStatus(poCreated,201,'Supplier Commercial V3 PO create');
  const poId=Number(poCreated.json?.id);
  const poItem=poCreated.json?.items?.[0];
  if(!poId||!poItem?.id||!closeEnough(poCreated.json?.expected_total,1000)){
    throw new Error('Supplier Commercial V3 PO was not created with expected value.');
  }
  if(poItem.handling_mode_snapshot!=='sealed_resale'){
    throw new Error('Supplier Commercial V3 handling mode was not snapshotted into the PO item.');
  }

  const accepted=await requestJson(base,`/api/supplier/orders/${poId}/respond`,{
    method:'POST',token:supplier.token,
    body:{
      items:[{
        item_id:Number(poItem.id),
        confirmed_packs:4,
        confirmed_price_per_pack:250,
        supplier_note:'Confirmed for V3 QA'
      }],
      supplier_note:'Supplier Commercial V3 accepted'
    }
  });
  expectStatus(accepted,200,'Supplier Commercial V3 PO accept');

  const delivered=await requestJson(base,`/api/supplier/orders/${poId}/status`,{
    method:'POST',token:supplier.token,body:{status:'delivered',supplier_note:'Delivered for V3 QA'}
  });
  expectStatus(delivered,200,'Supplier Commercial V3 PO delivered');

  const supplierLotCode='QA-V3-LOT-'+poId;
  const received=await requestJson(base,`/api/procurement/orders/${poId}/receive`,{
    method:'POST',token:merchant.token,
    body:{
      note:'Controlled QA V3 receipt',
      items:[{
        item_id:Number(poItem.id),
        received_packs:4,
        actual_price_per_pack:250,
        supplier_lot_code:supplierLotCode,
        expires_at:'2027-12-31T23:59:59+08:00'
      }]
    }
  });
  expectStatus(received,200,'Supplier Commercial V3 PO receive');

  const lotQ=await pool.query(
    `SELECT * FROM supply_lots
      WHERE business_id=$1 AND purchase_order_id=$2 AND purchase_order_item_id=$3
      ORDER BY id DESC LIMIT 1`,
    [merchantBusinessId,poId,Number(poItem.id)]
  );
  const lot=lotQ.rows[0];
  if(!lot||lot.supplier_lot_code!==supplierLotCode||!closeEnough(lot.quantity_remaining_base,4)
    ||Number(lot.inventory_id)!==inventoryId||lot.lot_state!=='available'){
    throw new Error('Supplier Commercial V3 PO receiving did not create the expected traceable lot.');
  }
  const invAfterReceive=await pool.query(`SELECT quantity,unit_cost FROM inventory WHERE id=$1 AND business_id=$2`,[inventoryId,merchantBusinessId]);
  if(!closeEnough(invAfterReceive.rows[0]?.quantity,4)||!closeEnough(invAfterReceive.rows[0]?.unit_cost,250)){
    throw new Error('Supplier Commercial V3 Inventory did not update from PO receiving.');
  }

  const issueDate=new Date().toISOString().slice(0,10);
  const invoice=await requestJson(base,`/api/supplier/orders/${poId}/invoices`,{
    method:'POST',token:supplier.token,
    body:{
      document_number:'QA-V3-INV-'+poId,
      document_kind:'charge_invoice',
      issue_date:issueDate,
      gross_amount:1000,
      evidence_reference:'Controlled QA invoice evidence'
    }
  });
  expectStatus(invoice,201,'Supplier Commercial V3 invoice evidence');
  const expectedDue=new Date(issueDate+'T00:00:00Z');
  expectedDue.setUTCDate(expectedDue.getUTCDate()+30);
  if(invoice.json?.fiscal_status!=='internal_evidence'
    ||String(invoice.json?.due_date).slice(0,10)!==expectedDue.toISOString().slice(0,10)){
    throw new Error('Supplier Commercial V3 invoice evidence or Net 30 due date is incorrect.');
  }

  const beforeReturn=await requestJson(base,`/api/procurement/orders/${poId}/commercial`,{token:merchant.token});
  expectStatus(beforeReturn,200,'Supplier Commercial V3 commercial summary before return');
  if(!closeEnough(beforeReturn.json?.summary?.invoice_total,1000)
    ||!closeEnough(beforeReturn.json?.summary?.outstanding,1000)
    ||!closeEnough(beforeReturn.json?.summary?.paid_amount,0)){
    throw new Error('Supplier Commercial V3 invoice/payment separation is incorrect.');
  }

  const ret=await requestJson(base,'/api/procurement/returns',{
    method:'POST',token:merchant.token,
    body:{supply_lot_id:Number(lot.id),quantity_base:1,reason_code:'quality',note:'Controlled QA return'}
  });
  expectStatus(ret,201,'Supplier Commercial V3 return request');
  const returnId=Number(ret.json?.id);
  if(!returnId||ret.json?.status!=='requested'||!closeEnough(ret.json?.expected_credit,250)){
    throw new Error('Supplier Commercial V3 return request is incorrect.');
  }
  const invBeforeDispatch=await pool.query(`SELECT quantity FROM inventory WHERE id=$1 AND business_id=$2`,[inventoryId,merchantBusinessId]);
  if(!closeEnough(invBeforeDispatch.rows[0]?.quantity,4)){
    throw new Error('Supplier Commercial V3 return request changed Inventory before physical return.');
  }

  const authorized=await requestJson(base,`/api/supplier/returns/${returnId}/respond`,{
    method:'POST',token:supplier.token,body:{decision:'authorize',supplier_note:'QA return authorized'}
  });
  expectStatus(authorized,200,'Supplier Commercial V3 return authorize');

  const dispatched=await requestJson(base,`/api/procurement/returns/${returnId}/dispatch`,{
    method:'POST',token:merchant.token,body:{}
  });
  expectStatus(dispatched,200,'Supplier Commercial V3 physical return');
  if(dispatched.json?.status!=='returned')throw new Error('Supplier Commercial V3 return was not marked physically returned.');

  const [invAfterReturn,lotAfterReturn]=await Promise.all([
    pool.query(`SELECT quantity FROM inventory WHERE id=$1 AND business_id=$2`,[inventoryId,merchantBusinessId]),
    pool.query(`SELECT quantity_remaining_base,lot_state FROM supply_lots WHERE id=$1`,[lot.id])
  ]);
  if(!closeEnough(invAfterReturn.rows[0]?.quantity,3)||!closeEnough(lotAfterReturn.rows[0]?.quantity_remaining_base,3)){
    throw new Error('Supplier Commercial V3 physical return did not reduce lot and Inventory exactly once.');
  }

  const resolved=await requestJson(base,`/api/supplier/returns/${returnId}/resolve`,{
    method:'POST',token:supplier.token,
    body:{resolution_type:'credit',confirmed_credit:250,supplier_note:'QA credit confirmed'}
  });
  expectStatus(resolved,200,'Supplier Commercial V3 return credit');
  if(resolved.json?.status!=='resolved'||!closeEnough(resolved.json?.confirmed_credit,250)){
    throw new Error('Supplier Commercial V3 confirmed credit did not persist.');
  }

  const afterCredit=await requestJson(base,`/api/procurement/orders/${poId}/commercial`,{token:merchant.token});
  expectStatus(afterCredit,200,'Supplier Commercial V3 commercial summary after credit');
  if(!closeEnough(afterCredit.json?.summary?.confirmed_credits,250)
    ||!closeEnough(afterCredit.json?.summary?.outstanding,750)
    ||!closeEnough(afterCredit.json?.summary?.paid_amount,0)){
    throw new Error('Supplier Commercial V3 credit did not reduce payable correctly.');
  }

  const excessivePayment=await requestJson(base,`/api/procurement/orders/${poId}/payment`,{
    method:'POST',token:merchant.token,body:{amount:751,account:'cash'}
  });
  expectStatus(excessivePayment,409,'Supplier Commercial V3 excessive payment guard');

  const payment=await requestJson(base,`/api/procurement/orders/${poId}/payment`,{
    method:'POST',token:merchant.token,body:{amount:750,account:'cash'}
  });
  expectStatus(payment,200,'Supplier Commercial V3 payment');

  const afterPayment=await requestJson(base,`/api/procurement/orders/${poId}/commercial`,{token:merchant.token});
  expectStatus(afterPayment,200,'Supplier Commercial V3 final commercial summary');
  if(!closeEnough(afterPayment.json?.summary?.paid_amount,750)
    ||!closeEnough(afterPayment.json?.summary?.outstanding,0)){
    throw new Error('Supplier Commercial V3 final payable was not settled correctly.');
  }

  const recall=await requestJson(base,'/api/supplier/recalls',{
    method:'POST',token:supplier.token,
    body:{
      supplier_lot_code:supplierLotCode,
      product_name:productName,
      notice_level:'recall',
      requested_action:'isolate',
      reason:'Controlled QA exact lot recall',
      source_reference:'QA-V3-RECALL-'+poId
    }
  });
  expectStatus(recall,201,'Supplier Commercial V3 recall');
  if(Number(recall.json?.matched_lots)<1||recall.json?.aggregate_inventory_sale_blocking!==false){
    throw new Error('Supplier Commercial V3 recall did not match the exact lot or overclaimed sale blocking.');
  }
  const recallLot=await pool.query(`SELECT lot_state FROM supply_lots WHERE id=$1`,[lot.id]);
  if(recallLot.rows[0]?.lot_state!=='quarantined'){
    throw new Error('Supplier Commercial V3 recalled lot was not quarantined.');
  }

  const merchantRecalls=await requestJson(base,`/api/procurement/recalls?business_id=${merchantBusinessId}`,{token:merchant.token});
  expectStatus(merchantRecalls,200,'Supplier Commercial V3 Merchant recall visibility');
  if(!(merchantRecalls.json?.matches||[]).some(x=>Number(x.lot_id)===Number(lot.id))){
    throw new Error('Supplier Commercial V3 Merchant cannot see the matched recall lot.');
  }

  await requestJson(base,'/api/auth/logout',{method:'POST',token:supplier.token,body:{}});
  await requestJson(base,'/api/auth/logout',{method:'POST',token:merchant.token,body:{}});

  return{
    status:'PASS',
    wave:SUPPLIER_COMMERCIAL_V3_WAVE,
    supplier_v1_v2_baseline:true,
    merchant_business_id:merchantBusinessId,
    purchase_order_id:poId,
    inventory_id:inventoryId,
    lot_id:Number(lot.id),
    terms_net_30:true,
    po_receipt_lot:true,
    invoice_evidence_separate:true,
    return_request_stock_unchanged:true,
    return_inventory_reduction:true,
    confirmed_credit:true,
    excessive_payment_blocked:true,
    payable_settled:true,
    recall_exact_lot:true,
    recall_quarantine:true,
    aggregate_inventory_sale_blocking:false
  };
}


async function runSupplierSourcingV4Acceptance({pool,base,secret}){
  const baseline=await runSupplierCommercialV3Acceptance({pool,base,secret});
  if(baseline.status!=='PASS')throw new Error('Supplier Commercial V3 prerequisite did not pass.');

  const [supplier,merchant]=await Promise.all([
    qaAccountSession({pool,base,secret,email:SUPPLIER_ALIAS,role:'supplier',label:'Supplier Sourcing V4 QA'}),
    qaAccountSession({pool,base,secret,email:MERCHANT_ALIAS,role:'merchant',label:'Supplier Sourcing V4 Merchant QA'})
  ]);
  await ensureActiveRole({base,token:supplier.token,role:'supplier',label:'Supplier Sourcing V4 QA'});
  await ensureActiveRole({base,token:merchant.token,role:'merchant',label:'Supplier Sourcing V4 Merchant QA'});

  const merchantBusinessId=Number(baseline.merchant_business_id);
  const supplierBinding=await pool.query(
    `SELECT business_id FROM profile_business_bindings
      WHERE account_id=$1 AND role='supplier' AND status='active'
      ORDER BY is_primary DESC,business_id LIMIT 1`,
    [supplier.accountId]
  );
  const supplierBusinessId=Number(supplierBinding.rows[0]?.business_id);
  if(!merchantBusinessId||!supplierBusinessId)throw new Error('Supplier Sourcing V4 business context is missing.');

  const profile=await requestJson(base,'/api/supplier/me',{token:supplier.token});
  expectStatus(profile,200,'Supplier Sourcing V4 catalog discovery');
  const productName='QA Sourcing V4 Rice 10kg';
  let item=(profile.json?.catalog||[]).find(x=>x.product_name===productName);
  if(!item){
    const created=await requestJson(base,'/api/supplier/catalog',{
      method:'POST',token:supplier.token,
      body:{
        product_name:productName,sku:'QA-SUP-V4-RICE-10KG',unit_name:'sack',base_unit:'kg',
        base_units_per_pack:10,price_per_pack:500,minimum_packs:1,availability_status:'available',lead_time_days:2
      }
    });
    expectStatus(created,201,'Supplier Sourcing V4 catalog create');
    item=created.json;
  }
  if(!item?.id)throw new Error('Supplier Sourcing V4 catalog item is unavailable.');

  const handling=await requestJson(base,`/api/supplier/catalog/${Number(item.id)}/v2`,{
    method:'PUT',token:supplier.token,
    body:{handling_mode:'sealed_resale',price_tiers:[],package_levels:[]}
  });
  expectStatus(handling,200,'Supplier Sourcing V4 catalog handling');

  const privateSettings=await requestJson(base,'/api/supplier/v4/sourcing-settings',{
    method:'PUT',token:supplier.token,
    body:{
      business_id:supplierBusinessId,visibility:'private',accepts_rfqs:true,
      categories:['rice_grains'],published_catalog_item_ids:[Number(item.id)]
    }
  });
  expectStatus(privateSettings,200,'Supplier Sourcing V4 private settings');

  const hiddenDirectory=await requestJson(
    base,`/api/procurement/sourcing/directory?business_id=${merchantBusinessId}&category=rice_grains`,
    {token:merchant.token}
  );
  expectStatus(hiddenDirectory,200,'Supplier Sourcing V4 private directory check');
  if((hiddenDirectory.json||[]).some(x=>Number(x.supplier_business_id)===supplierBusinessId)){
    throw new Error('Private Supplier leaked into controlled sourcing directory.');
  }

  const visibleSettings=await requestJson(base,'/api/supplier/v4/sourcing-settings',{
    method:'PUT',token:supplier.token,
    body:{
      business_id:supplierBusinessId,visibility:'directory',accepts_rfqs:true,
      categories:['rice_grains','packaging'],published_catalog_item_ids:[Number(item.id)]
    }
  });
  expectStatus(visibleSettings,200,'Supplier Sourcing V4 directory opt-in');

  const directory=await requestJson(
    base,`/api/procurement/sourcing/directory?business_id=${merchantBusinessId}&category=rice_grains`,
    {token:merchant.token}
  );
  expectStatus(directory,200,'Supplier Sourcing V4 directory');
  const discovered=(directory.json||[]).find(x=>Number(x.supplier_business_id)===supplierBusinessId);
  if(!discovered||!(discovered.published_catalog||[]).some(x=>Number(x.id)===Number(item.id))){
    throw new Error('Opted-in Supplier or published catalog item is missing from directory.');
  }
  for(const forbidden of ['email','phone','notes']){
    if(Object.prototype.hasOwnProperty.call(discovered,forbidden)){
      throw new Error('Supplier directory exposed private contact/internal fields.');
    }
  }

  const inventory=await pool.query(
    `INSERT INTO inventory(business_id,item,unit,quantity,reorder_level,unit_cost,measurement_family,base_unit)
     VALUES($1,$2,'kg',0,20,0,'mass','kg')
     ON CONFLICT(business_id,item) DO UPDATE SET
       unit='kg',quantity=0,reorder_level=20,unit_cost=0,measurement_family='mass',base_unit='kg',updated_at=NOW()
     RETURNING id`,
    [merchantBusinessId,'QA Sourcing V4 Rice Inventory']
  );
  const inventoryId=Number(inventory.rows[0].id);

  const map=await requestJson(base,`/api/procurement/catalog/${Number(item.id)}/link`,{
    method:'PUT',token:merchant.token,
    body:{business_id:merchantBusinessId,legacy_inventory_id:inventoryId,merchant_item_name:'QA Sourcing V4 Rice Inventory'}
  });
  expectStatus(map,200,'Supplier Sourcing V4 Inventory mapping');

  const preference=await requestJson(base,`/api/procurement/inventory/${inventoryId}/supplier-sources`,{
    method:'PUT',token:merchant.token,
    body:{sources:[{catalog_item_id:Number(item.id),preference_rank:1,note:'Controlled QA preferred source'}]}
  });
  expectStatus(preference,200,'Supplier Sourcing V4 preferred source');
  if(Number(preference.json?.[0]?.catalog_item_id)!==Number(item.id)||Number(preference.json?.[0]?.preference_rank)!==1){
    throw new Error('Supplier Sourcing V4 preferred source did not persist.');
  }

  const poCountBefore=await pool.query(`SELECT COUNT(*)::int c FROM purchase_orders WHERE business_id=$1`,[merchantBusinessId]);

  const rfq=await requestJson(base,'/api/procurement/sourcing/rfqs',{
    method:'POST',token:merchant.token,
    body:{
      business_id:merchantBusinessId,supplier_business_ids:[supplierBusinessId],
      item_specification:'QA Sourcing V4 Jasmine rice',requested_quantity:10,requested_unit:'kg',
      fulfilment_mode:'delivery',service_area:'QA Pilot City, Philippines',
      quality_requirements:'Controlled QA food grade',substitution_policy:'approval_required',
      target_budget:600,note:'Controlled QA RFQ'
    }
  });
  expectStatus(rfq,201,'Supplier Sourcing V4 RFQ');
  const rfqId=Number(rfq.json?.id);
  if(!rfqId||Number(rfq.json?.target_count)!==1)throw new Error('Supplier Sourcing V4 RFQ target count is incorrect.');

  const poCountAfterRfq=await pool.query(`SELECT COUNT(*)::int c FROM purchase_orders WHERE business_id=$1`,[merchantBusinessId]);
  if(Number(poCountAfterRfq.rows[0].c)!==Number(poCountBefore.rows[0].c)){
    throw new Error('Supplier Sourcing V4 RFQ created a purchase order automatically.');
  }

  const inbox=await requestJson(base,`/api/supplier/v4/rfqs?business_id=${supplierBusinessId}`,{token:supplier.token});
  expectStatus(inbox,200,'Supplier Sourcing V4 RFQ inbox');
  if(!(inbox.json||[]).some(x=>Number(x.id)===rfqId))throw new Error('Supplier Sourcing V4 RFQ is missing from Supplier inbox.');

  const future=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
  const earliest=new Date(Date.now()+2*86400000).toISOString().slice(0,10);
  const quoted=await requestJson(base,`/api/supplier/v4/rfqs/${rfqId}/quote`,{
    method:'PUT',token:supplier.token,
    body:{
      business_id:supplierBusinessId,catalog_item_id:Number(item.id),
      offered_name:productName,quoted_packs:1,minimum_packs:1,package_unit:'sack',
      base_unit:'kg',base_units_per_pack:10,price_per_pack:500,delivery_fee:20,
      lead_days:2,earliest_fulfilment_date:earliest,valid_until:future,
      availability_status:'available',payment_term_note:'COD or agreed terms',supplier_note:'Controlled QA connected quote'
    }
  });
  expectStatus(quoted,200,'Supplier Sourcing V4 connected quote');
  const connectedQuoteId=Number(quoted.json?.id);
  if(!connectedQuoteId)throw new Error('Supplier Sourcing V4 connected quote id is missing.');

  const party=await pool.query(
    `SELECT id FROM merchant_supply_parties
      WHERE business_id=$1 AND display_name=$2 AND status='active'
      ORDER BY id DESC LIMIT 1`,
    [merchantBusinessId,SUPPLIER_V2_EXTERNAL_NAME]
  );
  if(!party.rowCount)throw new Error('Supplier Sourcing V4 external Supplier fixture is missing.');

  const external=await requestJson(base,`/api/procurement/sourcing/rfqs/${rfqId}/external-quotes`,{
    method:'POST',token:merchant.token,
    body:{
      supply_party_id:Number(party.rows[0].id),offered_name:'QA incompatible pieces',
      quoted_packs:10,minimum_packs:1,package_unit:'piece',base_unit:'piece',base_units_per_pack:1,
      price_per_pack:10,delivery_fee:0,lead_days:1,valid_until:future,availability_status:'available'
    }
  });
  if(![200,201].includes(external.status))throw new Error('Supplier Sourcing V4 external quote failed with status '+external.status);

  const compare=await requestJson(base,`/api/procurement/sourcing/rfqs/${rfqId}`,{token:merchant.token});
  expectStatus(compare,200,'Supplier Sourcing V4 quote comparison');
  const connectedRow=(compare.json?.quotes||[]).find(x=>Number(x.id)===connectedQuoteId);
  const externalRow=(compare.json?.quotes||[]).find(x=>x.source_type==='external');
  if(!connectedRow||!connectedRow.comparable||!closeEnough(connectedRow.landed_total,520)
    ||!closeEnough(connectedRow.normalized_landed_cost,0.052,0.000001)){
    throw new Error('Supplier Sourcing V4 connected quote landed-cost normalization is incorrect.');
  }
  if(!externalRow||externalRow.comparison_status!=='NOT_COMPARABLE'||externalRow.normalized_landed_cost!=null){
    throw new Error('Supplier Sourcing V4 incompatible quote did not fail closed.');
  }
  if(Number(compare.json?.factual_highlights?.lowest_normalized_landed_cost_quote_id)!==connectedQuoteId
    ||compare.json?.auto_selected_quote_id!=null){
    throw new Error('Supplier Sourcing V4 comparison invented or missed a factual highlight.');
  }

  const reorder=await requestJson(
    base,`/api/procurement/reorder-suggestions?business_id=${merchantBusinessId}`,
    {token:merchant.token}
  );
  expectStatus(reorder,200,'Supplier Sourcing V4 reorder suggestions');
  const suggestion=(reorder.json||[]).find(x=>Number(x.inventory_id)===inventoryId);
  if(!suggestion||Number(suggestion.catalog_item_id)!==Number(item.id)
    ||Number(suggestion.preference_rank)!==1||Number(suggestion.suggested_packs)!==2){
    throw new Error('Supplier Sourcing V4 reorder did not use the explicit preferred source.');
  }

  const poCountBeforeExplicit=await pool.query(`SELECT COUNT(*)::int c FROM purchase_orders WHERE business_id=$1`,[merchantBusinessId]);
  if(Number(poCountBeforeExplicit.rows[0].c)!==Number(poCountBefore.rows[0].c)){
    throw new Error('Supplier Sourcing V4 quote/preferences created a purchase order automatically.');
  }

  const po=await requestJson(base,`/api/procurement/sourcing/quotes/${connectedQuoteId}/create-po`,{
    method:'POST',token:merchant.token,body:{order_packs:1,fulfilment_mode:'delivery',merchant_note:'Controlled QA V4 quote-selected PO'}
  });
  expectStatus(po,201,'Supplier Sourcing V4 explicit quote to PO');
  const poId=Number(po.json?.purchase_order_id);
  if(!poId||Number(po.json?.source_quote_id)!==connectedQuoteId||!closeEnough(po.json?.expected_total,520)){
    throw new Error('Supplier Sourcing V4 quote to PO response is incorrect.');
  }

  const detail=await requestJson(base,`/api/procurement/orders/${poId}`,{token:merchant.token});
  expectStatus(detail,200,'Supplier Sourcing V4 PO snapshot');
  if(Number(detail.json?.source_quote_id)!==connectedQuoteId
    ||!closeEnough(detail.json?.items?.[0]?.price_per_pack_snapshot,500)
    ||detail.json?.items?.[0]?.handling_mode_snapshot!=='sealed_resale'){
    throw new Error('Supplier Sourcing V4 PO did not snapshot quote evidence.');
  }

  const poCountAfterExplicit=await pool.query(`SELECT COUNT(*)::int c FROM purchase_orders WHERE business_id=$1`,[merchantBusinessId]);
  if(Number(poCountAfterExplicit.rows[0].c)!==Number(poCountBefore.rows[0].c)+1){
    throw new Error('Supplier Sourcing V4 explicit PO count is incorrect.');
  }

  await requestJson(base,'/api/auth/logout',{method:'POST',token:supplier.token,body:{}});
  await requestJson(base,'/api/auth/logout',{method:'POST',token:merchant.token,body:{}});

  return{
    status:'PASS',
    wave:SUPPLIER_SOURCING_V4_WAVE,
    supplier_v1_v2_v3_baseline:true,
    merchant_business_id:merchantBusinessId,
    supplier_business_id:supplierBusinessId,
    private_supplier_hidden:true,
    controlled_directory:true,
    rfq_id:rfqId,
    connected_quote_id:connectedQuoteId,
    external_quote_not_comparable:true,
    factual_comparison_no_auto_selection:true,
    preferred_source:true,
    reorder_business_id:merchantBusinessId,
    reorder_preferred_source:true,
    no_auto_po:true,
    explicit_quote_to_po:true,
    purchase_order_id:poId,
    source_quote_snapshot:true
  };
}


async function runSupplierDailyV5Acceptance({pool,base,secret}){
  const baseline=await runSupplierSourcingV4Acceptance({pool,base,secret});
  if(baseline.status!=='PASS')throw new Error('Supplier Sourcing V4 prerequisite did not pass.');

  const [supplier,merchant]=await Promise.all([
    qaAccountSession({pool,base,secret,email:SUPPLIER_ALIAS,role:'supplier',label:'Supplier Daily V5 QA'}),
    qaAccountSession({pool,base,secret,email:MERCHANT_ALIAS,role:'merchant',label:'Supplier Daily V5 Merchant QA'})
  ]);
  await ensureActiveRole({base,token:supplier.token,role:'supplier',label:'Supplier Daily V5 QA'});
  await ensureActiveRole({base,token:merchant.token,role:'merchant',label:'Supplier Daily V5 Merchant QA'});

  const supplierBusinessId=Number(baseline.supplier_business_id);
  const merchantBusinessId=Number(baseline.merchant_business_id);
  const sourcePoId=Number(baseline.purchase_order_id);
  if(!supplierBusinessId||!merchantBusinessId||!sourcePoId){
    throw new Error('Supplier Daily V5 prerequisite context is missing.');
  }

  const before=await requestJson(
    base,`/api/supplier/v5/today?business_id=${supplierBusinessId}`,
    {token:supplier.token}
  );
  expectStatus(before,200,'Supplier Daily V5 Today before invoice');
  const beforeOrders=[
    ...(before.json?.sections?.new_orders||[]),
    ...(before.json?.sections?.prepare||[]),
    ...(before.json?.sections?.ready||[]),
    ...(before.json?.sections?.completed||[])
  ];
  const sourceBefore=beforeOrders.find(x=>Number(x.id)===sourcePoId);
  if(!sourceBefore||sourceBefore.status!=='sent'){
    throw new Error('Supplier Daily V5 source PO is not visible as a new Supplier order.');
  }
  if(!closeEnough(sourceBefore.commercial_outstanding,0)){
    throw new Error('Supplier Daily V5 treated an unreceived uninvoiced PO commitment as Money due.');
  }
  if(before.json?.authority?.priority_score!==false){
    throw new Error('Supplier Daily V5 introduced an opaque priority score.');
  }

  const catalog=await pool.query(
    `SELECT id FROM supplier_catalog_items
      WHERE supplier_account_id=$1 AND product_name=$2 AND active=TRUE
      ORDER BY id DESC LIMIT 1`,
    [supplier.accountId,'QA Sourcing V4 Rice 10kg']
  );
  const catalogItemId=Number(catalog.rows[0]?.id);
  if(!catalogItemId)throw new Error('Supplier Daily V5 catalog fixture is missing.');

  const restock=new Date(Date.now()+2*86400000).toISOString().slice(0,10);
  const availability=await requestJson(base,`/api/supplier/v5/catalog/${catalogItemId}/availability`,{
    method:'PATCH',token:supplier.token,
    body:{
      business_id:supplierBusinessId,
      availability_status:'limited',
      lead_time_days:3,
      availability_note:'Controlled QA limited availability',
      expected_restock_date:restock
    }
  });
  expectStatus(availability,200,'Supplier Daily V5 availability update');
  if(availability.json?.stock_claim!=='AVAILABILITY_EVIDENCE_ONLY'
    ||availability.json?.exact_on_hand_quantity!==null
    ||availability.json?.availability_status!=='limited'){
    throw new Error('Supplier Daily V5 availability update overclaimed exact stock or did not persist.');
  }

  const todayLimited=await requestJson(
    base,`/api/supplier/v5/today?business_id=${supplierBusinessId}`,
    {token:supplier.token}
  );
  expectStatus(todayLimited,200,'Supplier Daily V5 Today limited availability');
  const attention=(todayLimited.json?.catalog_attention||[]).find(x=>Number(x.id)===catalogItemId);
  if(!attention||!(attention.attention_signals||[]).includes('LIMITED')){
    throw new Error('Supplier Daily V5 limited catalog item is missing from Today attention.');
  }

  const issueDate=new Date().toISOString().slice(0,10);
  const dueDate=new Date(Date.now()+86400000).toISOString().slice(0,10);
  const invoice=await requestJson(base,`/api/supplier/orders/${sourcePoId}/invoices`,{
    method:'POST',token:supplier.token,
    body:{
      document_number:'QA-V5-INV-'+sourcePoId,
      document_kind:'charge_invoice',
      issue_date:issueDate,
      due_date:dueDate,
      gross_amount:520,
      evidence_reference:'Controlled QA Supplier Daily V5 invoice'
    }
  });
  expectStatus(invoice,201,'Supplier Daily V5 invoice evidence');

  const after=await requestJson(
    base,`/api/supplier/v5/today?business_id=${supplierBusinessId}`,
    {token:supplier.token}
  );
  expectStatus(after,200,'Supplier Daily V5 Today after invoice');
  const afterOrders=[
    ...(after.json?.sections?.new_orders||[]),
    ...(after.json?.sections?.prepare||[]),
    ...(after.json?.sections?.ready||[]),
    ...(after.json?.sections?.completed||[])
  ];
  const sourceAfter=afterOrders.find(x=>Number(x.id)===sourcePoId);
  if(!sourceAfter||!closeEnough(sourceAfter.commercial_outstanding,520)){
    throw new Error('Supplier Daily V5 invoice evidence did not become an operational receivable.');
  }
  if(Number(after.json?.money?.receivable_total)<520-0.001){
    throw new Error('Supplier Daily V5 Money due total omitted the invoiced receivable.');
  }
  if((sourceAfter.attention_signals||[]).includes('RECEIVABLE_OVERDUE')){
    throw new Error('Supplier Daily V5 marked a future-due invoice overdue.');
  }

  const exceptionPo=await requestJson(base,'/api/procurement/orders',{
    method:'POST',token:merchant.token,
    body:{
      business_id:merchantBusinessId,
      supplier_account_id:supplier.accountId,
      fulfilment_mode:'pickup',
      delivery_fee:0,
      merchant_note:'Controlled QA Supplier Daily V5 exception PO',
      items:[{catalog_item_id:catalogItemId,packs:4}]
    }
  });
  expectStatus(exceptionPo,201,'Supplier Daily V5 exception PO create');
  const exceptionPoId=Number(exceptionPo.json?.id);
  const exceptionItem=exceptionPo.json?.items?.[0];
  if(!exceptionPoId||!exceptionItem?.id||Number(exceptionItem.ordered_packs)!==4){
    throw new Error('Supplier Daily V5 exception PO is invalid.');
  }

  const partial=await requestJson(base,`/api/supplier/orders/${exceptionPoId}/respond`,{
    method:'POST',token:supplier.token,
    body:{
      items:[{
        item_id:Number(exceptionItem.id),
        confirmed_packs:2,
        confirmed_price_per_pack:Number(exceptionItem.price_per_pack_snapshot),
        supplier_note:'Controlled QA partial confirmation'
      }],
      supplier_note:'Controlled QA partial acceptance'
    }
  });
  expectStatus(partial,200,'Supplier Daily V5 partial acceptance');
  if(partial.json?.status!=='partially_accepted'){
    throw new Error('Supplier Daily V5 exception PO did not become partially accepted.');
  }

  const inventoryBefore=exceptionItem.legacy_inventory_id
    ?await pool.query(`SELECT quantity FROM inventory WHERE id=$1 AND business_id=$2`,[
      Number(exceptionItem.legacy_inventory_id),merchantBusinessId
    ])
    :{rows:[]};
  const inventoryQuantityBefore=inventoryBefore.rows.length?Number(inventoryBefore.rows[0].quantity):null;

  const tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10);
  const backorder=await requestJson(base,`/api/supplier/orders/${exceptionPoId}/backorders`,{
    method:'POST',token:supplier.token,
    body:{
      supplier_business_id:supplierBusinessId,
      purchase_order_item_id:Number(exceptionItem.id),
      proposed_packs:1,
      expected_available_date:tomorrow,
      supplier_note:'Controlled QA backorder proposal'
    }
  });
  expectStatus(backorder,201,'Supplier Daily V5 backorder proposal');
  const backorderId=Number(backorder.json?.id);
  if(!backorderId||backorder.json?.po_quantities_changed!==false){
    throw new Error('Supplier Daily V5 backorder proposal mutated PO quantities.');
  }

  const backorderAccepted=await requestJson(base,`/api/procurement/backorders/${backorderId}/respond`,{
    method:'POST',token:merchant.token,
    body:{accept:true,merchant_note:'Controlled QA backorder accepted'}
  });
  expectStatus(backorderAccepted,200,'Supplier Daily V5 backorder Merchant acceptance');
  if(backorderAccepted.json?.state!=='merchant_accepted'
    ||backorderAccepted.json?.po_quantities_changed!==false
    ||backorderAccepted.json?.inventory_changed!==false
    ||backorderAccepted.json?.money_changed!==false){
    throw new Error('Supplier Daily V5 backorder Merchant decision crossed mutation boundaries.');
  }

  const afterBackorderAccept=await requestJson(base,`/api/procurement/orders/${exceptionPoId}`,{token:merchant.token});
  expectStatus(afterBackorderAccept,200,'Supplier Daily V5 PO after backorder acceptance');
  const itemAfterBackorderAccept=afterBackorderAccept.json?.items?.find(x=>Number(x.id)===Number(exceptionItem.id));
  if(Number(itemAfterBackorderAccept?.ordered_packs)!==4||Number(itemAfterBackorderAccept?.confirmed_packs)!==2){
    throw new Error('Supplier Daily V5 backorder acceptance changed ordered or confirmed packs.');
  }

  const todayBackorder=await requestJson(
    base,`/api/supplier/v5/today?business_id=${supplierBusinessId}`,
    {token:supplier.token}
  );
  expectStatus(todayBackorder,200,'Supplier Daily V5 Today accepted backorder');
  if(!(todayBackorder.json?.backorders||[]).some(x=>Number(x.id)===backorderId)){
    throw new Error('Supplier Daily V5 accepted backorder is missing from Today.');
  }

  const fulfilledBackorder=await requestJson(base,`/api/supplier/backorders/${backorderId}/fulfil`,{
    method:'POST',token:supplier.token,body:{}
  });
  expectStatus(fulfilledBackorder,200,'Supplier Daily V5 backorder fulfilment');
  if(fulfilledBackorder.json?.state!=='fulfilled'
    ||Number(fulfilledBackorder.json?.added_confirmed_packs)!==1
    ||fulfilledBackorder.json?.ordered_packs_unchanged!==true){
    throw new Error('Supplier Daily V5 backorder fulfilment did not preserve ordered quantity.');
  }

  const afterBackorderFulfil=await requestJson(base,`/api/procurement/orders/${exceptionPoId}`,{token:merchant.token});
  expectStatus(afterBackorderFulfil,200,'Supplier Daily V5 PO after backorder fulfilment');
  const itemAfterFulfil=afterBackorderFulfil.json?.items?.find(x=>Number(x.id)===Number(exceptionItem.id));
  if(Number(itemAfterFulfil?.ordered_packs)!==4||Number(itemAfterFulfil?.confirmed_packs)!==3){
    throw new Error('Supplier Daily V5 backorder fulfilment confirmation delta is incorrect.');
  }

  const supplierProfileAfter=await requestJson(base,'/api/supplier/me',{token:supplier.token});
  expectStatus(supplierProfileAfter,200,'Supplier Daily V5 substitute catalog discovery');
  const substituteName='QA Supplier Daily V5 Substitute Rice';
  let substitute=(supplierProfileAfter.json?.catalog||[]).find(x=>x.product_name===substituteName);
  if(!substitute){
    const created=await requestJson(base,'/api/supplier/catalog',{
      method:'POST',token:supplier.token,
      body:{
        product_name:substituteName,
        sku:'QA-SUP-V5-SUB-RICE',
        unit_name:'sack',
        base_unit:'kg',
        base_units_per_pack:10,
        price_per_pack:525,
        minimum_packs:1,
        availability_status:'available',
        lead_time_days:2
      }
    });
    expectStatus(created,201,'Supplier Daily V5 substitute catalog create');
    substitute=created.json;
  }
  if(!substitute?.id)throw new Error('Supplier Daily V5 substitute catalog item is missing.');

  const substituteHandling=await requestJson(base,`/api/supplier/catalog/${Number(substitute.id)}/v2`,{
    method:'PUT',token:supplier.token,
    body:{handling_mode:'sealed_resale',price_tiers:[],package_levels:[]}
  });
  expectStatus(substituteHandling,200,'Supplier Daily V5 substitute handling');

  const substitution=await requestJson(base,`/api/supplier/orders/${exceptionPoId}/substitutions`,{
    method:'POST',token:supplier.token,
    body:{
      supplier_business_id:supplierBusinessId,
      purchase_order_item_id:Number(exceptionItem.id),
      substitute_catalog_item_id:Number(substitute.id),
      proposed_packs:1,
      price_per_pack:525,
      reason_code:'unavailable',
      expected_available_date:tomorrow,
      supplier_note:'Controlled QA substitution proposal'
    }
  });
  expectStatus(substitution,201,'Supplier Daily V5 substitution proposal');
  const substitutionId=Number(substitution.json?.id);
  if(!substitutionId||substitution.json?.po_mutated!==false
    ||substitution.json?.inventory_changed!==false||substitution.json?.money_changed!==false){
    throw new Error('Supplier Daily V5 substitution proposal crossed mutation boundaries.');
  }

  const substitutionAccepted=await requestJson(base,`/api/procurement/substitutions/${substitutionId}/respond`,{
    method:'POST',token:merchant.token,
    body:{accept:true,merchant_note:'Controlled QA substitution accepted'}
  });
  expectStatus(substitutionAccepted,200,'Supplier Daily V5 substitution Merchant acceptance');
  if(substitutionAccepted.json?.state!=='merchant_accepted'
    ||substitutionAccepted.json?.po_mutated!==false
    ||substitutionAccepted.json?.inventory_changed!==false
    ||substitutionAccepted.json?.money_changed!==false
    ||substitutionAccepted.json?.fulfilment_status!=='MERCHANT_APPROVED_NOT_YET_FULFILLED'){
    throw new Error('Supplier Daily V5 substitution approval did not remain evidence-only.');
  }

  const afterSubstitution=await requestJson(base,`/api/procurement/orders/${exceptionPoId}`,{token:merchant.token});
  expectStatus(afterSubstitution,200,'Supplier Daily V5 PO after substitution acceptance');
  const itemAfterSubstitution=afterSubstitution.json?.items?.find(x=>Number(x.id)===Number(exceptionItem.id));
  if(Number(itemAfterSubstitution?.ordered_packs)!==4||Number(itemAfterSubstitution?.confirmed_packs)!==3
    ||Number(afterSubstitution.json?.paid_amount||0)!==0||Number(afterSubstitution.json?.actual_received_total||0)!==0){
    throw new Error('Supplier Daily V5 substitution acceptance changed PO quantity, money or receiving.');
  }

  if(exceptionItem.legacy_inventory_id){
    const inventoryAfter=await pool.query(
      `SELECT quantity FROM inventory WHERE id=$1 AND business_id=$2`,
      [Number(exceptionItem.legacy_inventory_id),merchantBusinessId]
    );
    if(!closeEnough(inventoryAfter.rows[0]?.quantity,inventoryQuantityBefore)){
      throw new Error('Supplier Daily V5 exception proposals changed Inventory.');
    }
  }

  const todaySubstitution=await requestJson(
    base,`/api/supplier/v5/today?business_id=${supplierBusinessId}`,
    {token:supplier.token}
  );
  expectStatus(todaySubstitution,200,'Supplier Daily V5 Today accepted substitution');
  if(!(todaySubstitution.json?.substitutions||[]).some(x=>Number(x.id)===substitutionId)){
    throw new Error('Supplier Daily V5 accepted substitution is missing from Today.');
  }

  const restore=await requestJson(base,`/api/supplier/v5/catalog/${catalogItemId}/availability`,{
    method:'PATCH',token:supplier.token,
    body:{
      business_id:supplierBusinessId,
      availability_status:'available',
      lead_time_days:2,
      availability_note:'',
      expected_restock_date:null
    }
  });
  expectStatus(restore,200,'Supplier Daily V5 availability restore');

  await requestJson(base,'/api/auth/logout',{method:'POST',token:supplier.token,body:{}});
  await requestJson(base,'/api/auth/logout',{method:'POST',token:merchant.token,body:{}});

  return{
    status:'PASS',
    wave:SUPPLIER_DAILY_V5_WAVE,
    supplier_v1_v2_v3_v4_baseline:true,
    supplier_business_id:supplierBusinessId,
    merchant_business_id:merchantBusinessId,
    source_purchase_order_id:sourcePoId,
    today_new_order_visible:true,
    uninvoiced_unreceived_po_money_due_zero:true,
    availability_evidence_only:true,
    limited_availability_attention:true,
    invoice_becomes_receivable:true,
    future_due_not_overdue:true,
    backorder_proposal_no_po_mutation:true,
    backorder_merchant_acceptance_explicit:true,
    backorder_fulfilment_confirmed_delta:true,
    substitution_proposal_no_mutation:true,
    substitution_merchant_acceptance_explicit:true,
    substitution_not_physically_fulfilled:true,
    priority_score:false
  };
}


async function runAuthRuntimeV6Acceptance({pool,base,secret}){
  const customer=await qaAccountSession({
    pool,base,secret,email:CUSTOMER_ALIAS,role:'customer',label:'Auth V6 Customer QA'
  });

  const firstToken=customer.token;
  const firstMe=await requestJson(base,'/api/me',{token:firstToken});
  expectStatus(firstMe,200,'Auth V6 first /api/me');

  const secondToken=await loginWithCredential({
    base,email:CUSTOMER_ALIAS,password:customer.password,label:'Auth V6 second login'
  });
  const secondMe=await requestJson(base,'/api/me',{token:secondToken});
  expectStatus(secondMe,200,'Auth V6 second /api/me');

  const revokeOthers=await requestJson(base,'/api/auth/sessions/revoke-others',{
    method:'POST',token:secondToken,body:{}
  });
  expectStatus(revokeOthers,200,'Auth V6 revoke other sessions');

  const revokedFirst=await requestJson(base,'/api/me',{token:firstToken});
  expectStatus(revokedFirst,401,'Auth V6 revoked session denial');

  const activeSecond=await requestJson(base,'/api/me',{token:secondToken});
  expectStatus(activeSecond,200,'Auth V6 active session after revoke');

  const retiredPin=await requestJson(base,'/api/login',{
    method:'POST',body:{pin:'qa-retired-pin'}
  });
  expectStatus(retiredPin,410,'Auth V6 retired public PIN');
  if(!/PIN login has been retired/i.test(clean(retiredPin.json?.error,240)))throw new Error('Auth V6 retired PIN response changed.');

  const legacy=await requestJson(base,'/api/me',{token:'legacy.qa.signature'});
  expectStatus(legacy,401,'Auth V6 legacy bearer denial');
  if(!/Legacy PIN session expired/i.test(clean(legacy.json?.error,240)))throw new Error('Auth V6 legacy bearer response changed.');

  const invalidVerification=await requestJson(base,'/api/auth/email-verification/verify',{
    method:'POST',token:secondToken,body:{token:'qa-v6-invalid-verification-token'}
  });
  expectStatus(invalidVerification,400,'Auth V6 email verification invalid-token contract');

  const hardeningStatus=await requestJson(base,'/api/auth/hardening/status');
  expectStatus(hardeningStatus,200,'Auth V6 hardening status');

  const oauthStart=await fetch(base+'/api/auth/google/start',{redirect:'manual'});
  expectStatus({status:oauthStart.status},[302,503],'Auth V6 Google start route');
  const oauthLink=await fetch(base+'/api/auth/google/link/start',{
    headers:{Authorization:'Bearer '+secondToken},redirect:'manual'
  });
  expectStatus({status:oauthLink.status},[302,503],'Auth V6 Google link route');
  const oauthCallback=await fetch(base+'/api/auth/google/callback',{redirect:'manual'});
  expectStatus({status:oauthCallback.status},302,'Auth V6 Google callback route');
  const oauthHandoff=await requestJson(base,'/api/auth/oauth/handoff',{
    method:'POST',body:{code:'qa-v6-invalid-handoff'}
  });
  expectStatus(oauthHandoff,400,'Auth V6 OAuth handoff route');

  const forgot=await requestJson(base,'/api/auth/forgot-password',{
    method:'POST',body:{email:CUSTOMER_ALIAS}
  });
  expectStatus(forgot,200,'Auth V6 forgot password');
  const previewUrl=clean(forgot.json?.preview_reset_url,1200);
  if(!previewUrl)throw new Error('Auth V6 recovery did not return the isolated preview reset link.');

  let resetToken='';
  try{resetToken=new URL(previewUrl).searchParams.get('reset_token')||''}catch{}
  if(!resetToken)throw new Error('Auth V6 recovery token was unavailable.');

  const delivery=await pool.query(
    `SELECT status FROM auth_email_deliveries
      WHERE account_id=$1 AND template_code='password_reset'
      ORDER BY id DESC LIMIT 1`,
    [customer.accountId]
  );
  if(delivery.rows[0]?.status!=='sent')throw new Error('Auth V6 password recovery email was not delivered.');

  const resetPassword=derivePassword(secret,CUSTOMER_ALIAS)+'-auth-v6-reset';
  const reset=await requestJson(base,'/api/auth/reset-password',{
    method:'POST',body:{token:resetToken,new_password:resetPassword}
  });
  expectStatus(reset,200,'Auth V6 reset password');

  const revokedByReset=await requestJson(base,'/api/me',{token:secondToken});
  expectStatus(revokedByReset,401,'Auth V6 reset revokes active session');

  const recoveredToken=await loginWithCredential({
    base,email:CUSTOMER_ALIAS,password:resetPassword,label:'Auth V6 recovery login'
  });
  const recoveredMe=await requestJson(base,'/api/me',{token:recoveredToken});
  expectStatus(recoveredMe,200,'Auth V6 recovery /api/me');

  const logout=await requestJson(base,'/api/auth/logout',{
    method:'POST',token:recoveredToken,body:{}
  });
  expectStatus(logout,200,'Auth V6 logout');

  const loggedOutDenied=await requestJson(base,'/api/me',{token:recoveredToken});
  expectStatus(loggedOutDenied,401,'Auth V6 logged-out session denial');

  const relogin=await loginWithCredential({
    base,email:CUSTOMER_ALIAS,password:resetPassword,label:'Auth V6 re-login'
  });
  const reloginMe=await requestJson(base,'/api/me',{token:relogin});
  expectStatus(reloginMe,200,'Auth V6 re-login /api/me');
  const finalLogout=await requestJson(base,'/api/auth/logout',{method:'POST',token:relogin,body:{}});
  expectStatus(finalLogout,200,'Auth V6 final logout');

  return{
    status:'PASS',
    wave:AUTH_RUNTIME_V6_WAVE,
    login_v2:true,
    account_me:true,
    logout_relogin:true,
    revoked_session:true,
    legacy_bearer_rejection:true,
    retired_pin_410:true,
    email_verification_no_500:true,
    password_recovery:true,
    recovery_email_sent:true,
    oauth_routes_present:true,
    session_revoke_others:true
  };
}


const QA_INCIDENT_EVIDENCE='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlWhVQAAAAASUVORK5CYII=';

async function runIncidentRuntimeV7Acceptance({pool,base,secret}){
  const [customer,merchant,admin,territoryAdmin]=await Promise.all([
    qaAccountSession({pool,base,secret,email:CUSTOMER_ALIAS,role:'customer',label:'Incident V7 Customer QA'}),
    qaAccountSession({pool,base,secret,email:MERCHANT_ALIAS,role:'merchant',label:'Incident V7 Merchant QA'}),
    qaAccountSession({pool,base,secret,email:SUPER_ADMIN_ALIAS,role:'super_admin',label:'Incident V7 Super Admin QA'}),
    qaAccountSession({pool,base,secret,email:TERRITORY_ADMIN_ALIAS,role:'territory_admin',label:'Incident V7 Territory Admin QA'})
  ]);

  const territoryId=await ensureQaTerritory({pool,base,adminToken:admin.token});

  await pool.query(
    "UPDATE platform_admin_assignments SET status='revoked',updated_at=NOW() WHERE account_id=$1 AND COALESCE(NULLIF(authority_rank,''),admin_role)='territory_admin'",
    [territoryAdmin.accountId]
  );

  const assignment=await requestJson(base,'/api/admin/assignments',{
    method:'POST',
    token:admin.token,
    body:{
      target_email:TERRITORY_ADMIN_ALIAS,
      admin_role:'territory_admin',
      territory_id:territoryId,
      function_codes:['trust_safety'],
      reason:'Controlled Incident V7 scoped triage acceptance'
    }
  });
  expectStatus(assignment,201,'Incident V7 Territory Admin assignment');
  if(Number(assignment.json?.territory_id)!==Number(territoryId))throw new Error('Incident V7 Admin assignment resolved the wrong territory.');
  if(!(assignment.json?.permissions||[]).includes('incident.triage'))throw new Error('Incident V7 Admin assignment did not include incident.triage.');

  const created=await requestJson(base,'/api/incidents',{
    method:'POST',
    token:customer.token,
    body:{
      category:'Controlled QA runtime incident',
      description:'Controlled Incident V7 acceptance record used only to verify the embedded Incident boundary.',
      related_type:'other',
      territory_id:territoryId,
      attachments:[{
        file_name:'incident-v7.png',
        data_url:QA_INCIDENT_EVIDENCE
      }]
    }
  });
  expectStatus(created,201,'Incident V7 create');
  const incidentId=Number(created.json?.id);
  if(!incidentId)throw new Error('Incident V7 create returned no incident id.');

  const persisted=await pool.query(
    'SELECT reporter_account_id,territory_id,status FROM incident_reports WHERE id=$1',
    [incidentId]
  );
  if(Number(persisted.rows[0]?.reporter_account_id)!==Number(customer.accountId))throw new Error('Incident V7 reporter ownership did not persist.');
  if(Number(persisted.rows[0]?.territory_id)!==Number(territoryId))throw new Error('Incident V7 territory enrichment did not persist.');
  if(persisted.rows[0]?.status!=='submitted')throw new Error('Incident V7 did not start submitted.');

  const mine=await requestJson(base,'/api/incidents/mine',{token:customer.token});
  expectStatus(mine,200,'Incident V7 mine');
  if(!(Array.isArray(mine.json)&&mine.json.some(x=>Number(x.id)===incidentId)))throw new Error('Incident V7 was missing from Customer incident history.');

  const detail=await requestJson(base,'/api/incidents/'+incidentId,{token:customer.token});
  expectStatus(detail,200,'Incident V7 detail');
  const attachmentId=Number(detail.json?.attachments?.[0]?.id);
  if(!attachmentId)throw new Error('Incident V7 attachment metadata was missing.');

  const attachment=await requestJson(base,'/api/incidents/'+incidentId+'/attachments/'+attachmentId,{token:customer.token});
  expectStatus(attachment,200,'Incident V7 attachment');
  if(!String(attachment.json?.data_url||'').startsWith('data:image/png;base64,'))throw new Error('Incident V7 attachment evidence was not returned to its owner.');

  const note=await requestJson(base,'/api/incidents/'+incidentId+'/note',{
    method:'POST',token:customer.token,body:{note:'Controlled Customer follow-up for Incident V7 acceptance.'}
  });
  expectStatus(note,200,'Incident V7 note');

  const crossAccount=await requestJson(base,'/api/incidents/'+incidentId,{token:merchant.token});
  expectStatus(crossAccount,403,'Incident V7 cross-account denial');

  const scopedRead=await requestJson(base,'/api/admin/incidents/'+incidentId,{token:territoryAdmin.token});
  expectStatus(scopedRead,200,'Incident V7 scoped Admin read');
  if(Number(scopedRead.json?.territory_id)!==Number(territoryId))throw new Error('Incident V7 scoped Admin read crossed territory.');

  const triage=await requestJson(base,'/api/admin/incidents/'+incidentId,{
    method:'PATCH',
    token:territoryAdmin.token,
    body:{
      status:'investigating',
      note:'Controlled scoped triage for Incident V7 acceptance.',
      resolution_summary:''
    }
  });
  expectStatus(triage,200,'Incident V7 scoped Admin triage');

  const after=await requestJson(base,'/api/incidents/'+incidentId,{token:customer.token});
  expectStatus(after,200,'Incident V7 detail after triage');
  if(after.json?.status!=='investigating')throw new Error('Incident V7 scoped triage status did not persist.');
  if(!(after.json?.actions||[]).some(x=>x.action_type==='admin_status'))throw new Error('Incident V7 Admin triage action evidence was missing.');

  for(const [label,token] of [
    ['Customer',customer.token],
    ['Merchant',merchant.token],
    ['Super Admin',admin.token],
    ['Territory Admin',territoryAdmin.token]
  ]){
    const logout=await requestJson(base,'/api/auth/logout',{method:'POST',token,body:{}});
    expectStatus(logout,200,'Incident V7 '+label+' logout');
  }

  return{
    status:'PASS',
    wave:INCIDENT_RUNTIME_V7_WAVE,
    incident_id:incidentId,
    territory_id:territoryId,
    create:true,
    mine_detail:true,
    note:true,
    attachment_authorization:true,
    cross_account_denial:true,
    scoped_admin_triage:true,
    incident_status:'investigating'
  };
}


async function runDeliveryFinanceRuntimeV8Acceptance({pool,base,secret}){
  const orderNote='Controlled QA Delivery Finance V8 '+Date.now();
  const courierResult=await runCourierExperienceAcceptance({
    pool,base,secret,
    aliases:{customer:CUSTOMER_ALIAS,merchant:MERCHANT_ALIAS,courier:COURIER_ALIAS,superAdmin:SUPER_ADMIN_ALIAS},
    helpers:{requestJson,expectStatus,qaAccountSession,runCustomerOnboarding,runMerchantCatalogSeed,ensureQaTerritory,ensureActiveRole,loginWithCredential},
    orderNote,
    paymentMode:'merchant_confirmation'
  });
  if(courierResult.status!=='PASS')throw new Error('Delivery Finance V8 Courier prerequisite did not pass.');

  const orderId=Number(courierResult.order_id),deliveryId=Number(courierResult.delivery_id),businessId=Number(courierResult.business_id);
  if(!orderId||!deliveryId||!businessId)throw new Error('Delivery Finance V8 Courier result is missing canonical ids.');

  const payment=await pool.query(
    `SELECT p.id,p.amount,p.merchandise_amount,p.delivery_amount,p.payment_intent_id,
            p.provider_code,p.provider_reference,o.subtotal,o.delivery_fee,o.total
       FROM order_payments p
       JOIN orders o ON o.id=p.order_id
      WHERE p.order_id=$1 AND p.status='confirmed'
      ORDER BY p.id`,
    [orderId]
  );
  if(payment.rowCount!==1)throw new Error('Delivery Finance V8 expected exactly one confirmed order payment.');
  const p=payment.rows[0];
  const paymentId=Number(p.id),intentId=Number(p.payment_intent_id);
  if(!paymentId||!intentId)throw new Error('Delivery Finance V8 Payment Core mirror was not attached to the confirmed payment.');
  if(!closeEnough(p.amount,p.total))throw new Error('Delivery Finance V8 confirmed payment total does not match the order total.');
  if(!closeEnough(p.merchandise_amount,p.subtotal))throw new Error('Delivery Finance V8 merchandise allocation does not match order subtotal.');
  if(!(Number(p.delivery_fee)>0)||!closeEnough(p.delivery_amount,p.delivery_fee))throw new Error('Delivery Finance V8 delivery allocation does not match the delivery fee.');
  if(p.provider_code!=='qa_manual_delivery_finance_v8')throw new Error('Delivery Finance V8 payment did not use the controlled manual provider marker.');

  const [ledger,deliveryEvent,intent,allocations,notification]=await Promise.all([
    pool.query(
      "SELECT COUNT(*)::int n,COALESCE(SUM(amount),0)::numeric total FROM transactions WHERE business_id=$1 AND source='order_payment' AND source_id=$2",
      [businessId,paymentId]
    ),
    pool.query(
      "SELECT COUNT(*)::int n,COALESCE(SUM(amount),0)::numeric total FROM delivery_financial_events WHERE order_id=$1 AND delivery_id=$2 AND event_type='delivery_fee_received' AND source_payment_id=$3",
      [orderId,deliveryId,paymentId]
    ),
    pool.query(
      "SELECT id,idempotency_key,status,amount FROM payment_intents WHERE id=$1",
      [intentId]
    ),
    pool.query(
      "SELECT component_code,COUNT(*)::int n,COALESCE(SUM(amount),0)::numeric total FROM payment_allocations WHERE payment_intent_id=$1 AND settlement_status<>'reversed' GROUP BY component_code ORDER BY component_code",
      [intentId]
    ),
    pool.query(
      "SELECT COUNT(*)::int n FROM notification_events WHERE event_code='order.payment_confirmed' AND entity_type='order' AND entity_id=$1",
      [String(orderId)]
    )
  ]);
  if(Number(ledger.rows[0]?.n)!==1||!closeEnough(ledger.rows[0]?.total,p.merchandise_amount))throw new Error('Delivery Finance V8 expected exactly one Merchant ledger record.');
  if(Number(deliveryEvent.rows[0]?.n)!==1||!closeEnough(deliveryEvent.rows[0]?.total,p.delivery_amount))throw new Error('Delivery Finance V8 expected exactly one delivery financial event.');
  if(intent.rows[0]?.status!=='succeeded'||intent.rows[0]?.idempotency_key!=='legacy-order-payment:'+paymentId||!closeEnough(intent.rows[0]?.amount,p.amount)){
    throw new Error('Delivery Finance V8 Payment Core mirror evidence is incomplete.');
  }
  const allocationMap=new Map((allocations.rows||[]).map(x=>[x.component_code,x]));
  if(Number(allocationMap.get('merchandise')?.n)!==1||!closeEnough(allocationMap.get('merchandise')?.total,p.merchandise_amount)){
    throw new Error('Delivery Finance V8 Payment Core merchandise allocation is incomplete.');
  }
  if(Number(allocationMap.get('delivery')?.n)!==1||!closeEnough(allocationMap.get('delivery')?.total,p.delivery_amount)){
    throw new Error('Delivery Finance V8 Payment Core delivery allocation is incomplete.');
  }
  if(Number(notification.rows[0]?.n)!==1)throw new Error('Delivery Finance V8 expected exactly one payment-confirmed notification event.');

  const [courier,merchant]=await Promise.all([
    qaAccountSession({pool,base,secret,email:COURIER_ALIAS,role:'courier',label:'Delivery Finance V8 Courier QA'}),
    qaAccountSession({pool,base,secret,email:MERCHANT_ALIAS,role:'merchant',label:'Delivery Finance V8 Merchant QA'})
  ]);
  await ensureActiveRole({base,token:courier.token,role:'courier',label:'Delivery Finance V8 Courier QA'});
  await ensureActiveRole({base,token:merchant.token,role:'merchant',label:'Delivery Finance V8 Merchant QA'});

  const profileBefore=await requestJson(base,'/api/courier/delivery-profile',{token:courier.token});
  expectStatus(profileBefore,200,'Delivery Finance V8 Courier profile read before update');

  const profileUpdate=await requestJson(base,'/api/courier/delivery-profile',{
    method:'PUT',
    token:courier.token,
    body:{vehicle_type:'bicycle',max_weight_kg:21,max_volume_l:81,service_radius_km:26}
  });
  expectStatus(profileUpdate,200,'Delivery Finance V8 Courier profile update');

  const profileAfter=await requestJson(base,'/api/courier/delivery-profile',{token:courier.token});
  expectStatus(profileAfter,200,'Delivery Finance V8 Courier profile read after update');
  const updated=profileAfter.json?.profile;
  if(updated?.vehicle_type!=='bicycle'||Number(updated?.max_weight_kg)!==21||Number(updated?.max_volume_l)!==81||Number(updated?.service_radius_km)!==26){
    throw new Error('Delivery Finance V8 Courier profile update did not persist through the embedded boundary.');
  }

  const profileRestore=await requestJson(base,'/api/courier/delivery-profile',{
    method:'PUT',
    token:courier.token,
    body:{vehicle_type:'bicycle',max_weight_kg:20,max_volume_l:80,service_radius_km:25}
  });
  expectStatus(profileRestore,200,'Delivery Finance V8 Courier profile restore');

  const duplicatePayment=await requestJson(base,'/api/orders/merchant/'+orderId+'/payment',{
    method:'POST',
    token:merchant.token,
    body:{amount:1,account:'cash',method_code:'cash',provider_code:'qa_manual_delivery_finance_v8_repeat'}
  });
  expectStatus(duplicatePayment,409,'Delivery Finance V8 duplicate payment denial');

  const duplicateEvidence=await Promise.all([
    pool.query("SELECT COUNT(*)::int n FROM order_payments WHERE order_id=$1 AND status='confirmed'",[orderId]),
    pool.query("SELECT COUNT(*)::int n FROM transactions WHERE business_id=$1 AND source='order_payment' AND source_id=$2",[businessId,paymentId]),
    pool.query("SELECT COUNT(*)::int n FROM delivery_financial_events WHERE order_id=$1 AND source_payment_id=$2 AND event_type='delivery_fee_received'",[orderId,paymentId]),
    pool.query("SELECT COUNT(*)::int n FROM notification_events WHERE event_code='order.payment_confirmed' AND entity_type='order' AND entity_id=$1",[String(orderId)])
  ]);
  if(duplicateEvidence.some(x=>Number(x.rows[0]?.n)!==1))throw new Error('Delivery Finance V8 duplicate attempt changed canonical evidence counts.');

  for(const [label,token] of [['Courier',courier.token],['Merchant',merchant.token]]){
    const logout=await requestJson(base,'/api/auth/logout',{method:'POST',token,body:{}});
    expectStatus(logout,200,'Delivery Finance V8 '+label+' logout');
  }

  return{
    status:'PASS',
    wave:DELIVERY_FINANCE_RUNTIME_V8_WAVE,
    order_id:orderId,
    delivery_id:deliveryId,
    business_id:businessId,
    payment_id:paymentId,
    payment_intent_id:intentId,
    courier_profile_update:true,
    one_confirmed_payment:true,
    merchandise_allocation:true,
    delivery_allocation:true,
    one_business_ledger_record:true,
    one_delivery_financial_event:true,
    payment_core_mirror:true,
    one_payment_notification:true,
    duplicate_payment_denied:true,
    delivery_fee:Number(p.delivery_fee)
  };
}


async function runDeliveryRuntimeV9Acceptance({pool,base,secret}){
  const orderNote='Controlled QA Delivery Runtime V9 '+Date.now();
  const courierResult=await runCourierExperienceAcceptance({
    pool,base,secret,
    aliases:{customer:CUSTOMER_ALIAS,merchant:MERCHANT_ALIAS,courier:COURIER_ALIAS,superAdmin:SUPER_ADMIN_ALIAS},
    helpers:{requestJson,expectStatus,qaAccountSession,runCustomerOnboarding,runMerchantCatalogSeed,ensureQaTerritory,ensureActiveRole,loginWithCredential},
    orderNote,
    paymentMode:'merchant_confirmation'
  });
  if(courierResult.status!=='PASS')throw new Error('Delivery Runtime V9 Courier flow did not pass.');
  if(courierResult.payment_mode!=='merchant_confirmation')throw new Error('Delivery Runtime V9 did not exercise the controlled Merchant payment path.');
  if(courierResult.delivery_completed!==true||courierResult.order_completed!==true)throw new Error('Delivery Runtime V9 did not complete Delivery and order.');
  if(courierResult.completion_code_required!==true)throw new Error('Delivery Runtime V9 completion-code security was not exercised.');
  if(courierResult.live_tracking_closed_after_completion!==true)throw new Error('Delivery Runtime V9 did not close live tracking after completion.');

  const orderId=Number(courierResult.order_id);
  const deliveryId=Number(courierResult.delivery_id);
  const businessId=Number(courierResult.business_id);
  if(!orderId||!deliveryId||!businessId)throw new Error('Delivery Runtime V9 result is missing canonical ids.');

  const [deliveryState,quoteState,monetization]=await Promise.all([
    pool.query(
      `SELECT d.id,d.order_id,d.quote_id,d.status,d.delivery_fee,d.last_lat,d.last_lng,d.last_location_at,
              d.courier_account_id,o.order_status,o.payment_status,o.business_id,o.subtotal,o.delivery_fee order_delivery_fee
         FROM deliveries d
         JOIN orders o ON o.id=d.order_id
        WHERE d.id=$1 AND d.order_id=$2`,
      [deliveryId,orderId]
    ),
    pool.query(
      `SELECT q.id,q.status,q.fee,q.pricing_rule_version,q.required_vehicle_class,q.formula_type,q.pricing_snapshot
         FROM delivery_quotes q
         JOIN deliveries d ON d.quote_id=q.id
        WHERE d.id=$1`,
      [deliveryId]
    ),
    pool.query(
      `SELECT service_scope,source_type,source_id,COUNT(*)::int n,COALESCE(SUM(gross_value),0)::numeric gross
         FROM service_monetization_events
        WHERE (service_scope='marketplace' AND source_type='order' AND source_id=$1)
           OR (service_scope='delivery' AND source_type='delivery' AND source_id=$2)
        GROUP BY service_scope,source_type,source_id
        ORDER BY service_scope`,
      [orderId,deliveryId]
    )
  ]);

  const d=deliveryState.rows[0],q=quoteState.rows[0];
  if(!d||d.status!=='delivered'||d.order_status!=='completed'||d.payment_status!=='paid'){
    throw new Error('Delivery Runtime V9 canonical Delivery/order state is incomplete.');
  }
  if(Number(d.business_id)!==businessId)throw new Error('Delivery Runtime V9 business binding changed.');
  if(d.last_lat!=null||d.last_lng!=null||d.last_location_at!=null)throw new Error('Delivery Runtime V9 live tracking remained open after completion.');
  if(!(Number(d.delivery_fee)>0)||!closeEnough(d.delivery_fee,d.order_delivery_fee))throw new Error('Delivery Runtime V9 delivery fee evidence is inconsistent.');

  if(!q||q.status!=='used'||!closeEnough(q.fee,d.delivery_fee))throw new Error('Delivery Runtime V9 quote was not consumed exactly into Delivery.');
  if(!(Number(q.pricing_rule_version)>0))throw new Error('Delivery Runtime V9 quote lost pricing version evidence.');
  if(!q.required_vehicle_class)throw new Error('Delivery Runtime V9 quote lost required vehicle class.');
  if(!q.formula_type)throw new Error('Delivery Runtime V9 quote lost pricing formula evidence.');
  if(!q.pricing_snapshot||typeof q.pricing_snapshot!=='object')throw new Error('Delivery Runtime V9 quote lost pricing snapshot evidence.');

  const marketEvent=monetization.rows.find(x=>x.service_scope==='marketplace'&&x.source_type==='order'&&Number(x.source_id)===orderId);
  const deliveryEvent=monetization.rows.find(x=>x.service_scope==='delivery'&&x.source_type==='delivery'&&Number(x.source_id)===deliveryId);
  if(Number(marketEvent?.n)!==1)throw new Error('Delivery Runtime V9 expected one marketplace monetization completion.');
  if(Number(deliveryEvent?.n)!==1)throw new Error('Delivery Runtime V9 expected one delivery monetization completion.');
  if(!closeEnough(marketEvent?.gross,d.subtotal))throw new Error('Delivery Runtime V9 marketplace monetization gross is inconsistent.');
  if(!closeEnough(deliveryEvent?.gross,d.delivery_fee))throw new Error('Delivery Runtime V9 delivery monetization gross is inconsistent.');

  return{
    status:'PASS',
    wave:DELIVERY_RUNTIME_V9_WAVE,
    order_id:orderId,
    delivery_id:deliveryId,
    business_id:businessId,
    delivery_quote_used:true,
    pricing_snapshot_preserved:true,
    courier_eligibility:true,
    admin_dispatch:true,
    live_tracking:true,
    completion_code_security:true,
    delivery_completed:true,
    order_completed:true,
    tracking_closed_after_completion:true,
    marketplace_monetization_event:true,
    delivery_monetization_event:true,
    notification_lifecycle:Boolean(courierResult.notification_lifecycle),
    support:Boolean(courierResult.support),
    logout_relogin:Boolean(courierResult.logout_relogin)
  };
}


async function runSupplierRuntimeV10Acceptance({pool,base,secret}){
  const rootComposition=await verifySupplierDeliveryRootComposition(base,'/','Supplier Runtime V10 root composition');
  const indexComposition=await verifySupplierDeliveryRootComposition(base,'/index.html','Supplier Runtime V10 index composition');

  const baseline=await runSupplierDailyV5Acceptance({pool,base,secret});
  if(baseline.status!=='PASS')throw new Error('Supplier Runtime V10 Supplier V1–V5 baseline did not pass.');

  const [supplier,merchant,customer]=await Promise.all([
    qaAccountSession({pool,base,secret,email:SUPPLIER_ALIAS,role:'supplier',label:'Supplier Runtime V10 Supplier QA'}),
    qaAccountSession({pool,base,secret,email:MERCHANT_ALIAS,role:'merchant',label:'Supplier Runtime V10 Merchant QA'}),
    qaAccountSession({pool,base,secret,email:CUSTOMER_ALIAS,role:'customer',label:'Supplier Runtime V10 Customer QA'})
  ]);
  await ensureActiveRole({base,token:supplier.token,role:'supplier',label:'Supplier Runtime V10 Supplier QA'});
  await ensureActiveRole({base,token:merchant.token,role:'merchant',label:'Supplier Runtime V10 Merchant QA'});
  await ensureActiveRole({base,token:customer.token,role:'customer',label:'Supplier Runtime V10 Customer QA'});

  const supplierProfile=await requestJson(base,'/api/supplier/me',{token:supplier.token});
  expectStatus(supplierProfile,200,'Supplier Runtime V10 Supplier profile');
  if(!Array.isArray(supplierProfile.json?.catalog)||supplierProfile.json.catalog.length<1){
    throw new Error('Supplier Runtime V10 Supplier catalog is unavailable after V1–V5 baseline.');
  }

  const merchantBusinessId=Number(baseline.merchant_business_id);
  if(!merchantBusinessId)throw new Error('Supplier Runtime V10 Merchant business context is missing.');

  const newestPo=await pool.query(
    `SELECT id,public_token,status,payment_status,supplier_ready_at,supplier_delivery_eta
       FROM purchase_orders
      WHERE business_id=$1 AND supplier_account_id=$2
      ORDER BY id DESC LIMIT 1`,
    [merchantBusinessId,supplier.accountId]
  );
  const po=newestPo.rows[0];
  if(!po?.id||!po.public_token)throw new Error('Supplier Runtime V10 fresh procurement evidence is missing.');

  const merchantDetail=await requestJson(base,`/api/procurement/orders/${Number(po.id)}`,{token:merchant.token});
  expectStatus(merchantDetail,200,'Supplier Runtime V10 Merchant PO read');

  const customerDenied=await requestJson(base,`/api/procurement/orders/${Number(po.id)}`,{token:customer.token});
  expectStatus(customerDenied,403,'Supplier Runtime V10 cross-role procurement denial');

  const publicEvidence=await requestJson(base,`/api/procurement/respond/${encodeURIComponent(po.public_token)}`);
  expectStatus(publicEvidence,200,'Supplier Runtime V10 public PO evidence');
  if(Number(publicEvidence.json?.id)!==Number(po.id)){
    throw new Error('Supplier Runtime V10 public PO token resolved a different purchase order.');
  }

  const today=await requestJson(
    base,`/api/supplier/v5/today?business_id=${Number(baseline.supplier_business_id)}`,
    {token:supplier.token}
  );
  expectStatus(today,200,'Supplier Runtime V10 Today');

  const relationshipList=await requestJson(
    base,`/api/procurement/relationships?business_id=${merchantBusinessId}`,
    {token:merchant.token}
  );
  expectStatus(relationshipList,200,'Supplier Runtime V10 relationship list');
  if(!(relationshipList.json||[]).some(x=>Number(x.supplier_account_id)===Number(supplier.accountId)&&x.state==='accepted')){
    throw new Error('Supplier Runtime V10 accepted Merchant–Supplier relationship is missing.');
  }

  for(const [label,token] of [['Supplier',supplier.token],['Merchant',merchant.token],['Customer',customer.token]]){
    const logout=await requestJson(base,'/api/auth/logout',{method:'POST',token,body:{}});
    expectStatus(logout,200,'Supplier Runtime V10 '+label+' logout');
  }

  return{
    status:'PASS',
    wave:SUPPLIER_RUNTIME_V10_WAVE,
    supplier_v1_v2_v3_v4_v5_baseline:true,
    supplier_business_id:Number(baseline.supplier_business_id),
    merchant_business_id:merchantBusinessId,
    purchase_order_id:Number(po.id),
    root_composition:Boolean(rootComposition),
    index_composition:Boolean(indexComposition),
    supplier_profile:true,
    catalog:true,
    relationship:true,
    procurement_read:true,
    public_token_scope:true,
    cross_role_denial:true,
    domain_v2:true,
    commercial_v3:true,
    sourcing_v4:true,
    daily_v5:true,
    backorder_and_substitution:true,
    logout:true
  };
}


async function runOrdersRuntimeV13Acceptance({pool,base,secret}){
  const rootComposition=await verifyOrdersRootComposition(base,'/','Orders Runtime V13 root composition');
  const indexComposition=await verifyOrdersRootComposition(base,'/index.html','Orders Runtime V13 index composition');

  const marketplace=await runCustomerMarketplaceE2E({
    pool,base,secret,orderNote:'Controlled QA Orders Runtime V13 Marketplace baseline'
  });
  if(marketplace.status!=='PASS')throw new Error('Orders Runtime V13 Marketplace baseline did not pass.');

  const [customer,merchant]=await Promise.all([
    qaAccountSession({pool,base,secret,email:CUSTOMER_ALIAS,role:'customer',label:'Orders Runtime V13 Customer QA'}),
    qaAccountSession({pool,base,secret,email:MERCHANT_ALIAS,role:'merchant',label:'Orders Runtime V13 Merchant QA'})
  ]);
  await ensureActiveRole({base,token:customer.token,role:'customer',label:'Orders Runtime V13 Customer QA'});
  await ensureActiveRole({base,token:merchant.token,role:'merchant',label:'Orders Runtime V13 Merchant QA'});

  const businessId=Number(marketplace.business_id);
  if(!businessId)throw new Error('Orders Runtime V13 Marketplace baseline is missing business id.');

  const products=await requestJson(base,`/api/orders/products?business_id=${businessId}`,{token:merchant.token});
  expectStatus(products,200,'Orders Runtime V13 Orders product read');
  const product=(Array.isArray(products.json)?products.json:[]).find(x=>x.name==='QA Fish Soup')||(Array.isArray(products.json)?products.json:[])[0];
  if(!product?.id)throw new Error('Orders Runtime V13 did not find an Orders-owned product fixture.');

  const created=await requestJson(base,'/api/orders',{
    method:'POST',token:customer.token,
    body:{
      business_id:businessId,
      items:[{product_id:Number(product.id),quantity:1}],
      fulfilment_method:'pickup',
      payment_method:'cash',
      note:'Controlled QA Orders Runtime V13 direct order'
    }
  });
  expectStatus(created,201,'Orders Runtime V13 direct Customer order');
  const orderId=Number(created.json?.id);
  const publicToken=clean(created.json?.public_token,200);
  if(!orderId||!publicToken)throw new Error('Orders Runtime V13 direct order is missing canonical identifiers.');

  let order=created.json;
  if(order.order_status==='awaiting_customer_presence'){
    const checkIn=await requestJson(base,`/api/orders/${orderId}/check-in`,{method:'POST',token:customer.token,body:{}});
    expectStatus(checkIn,200,'Orders Runtime V13 Customer check-in');
    const presence=await requestJson(base,`/api/orders/merchant/${orderId}/confirm-presence`,{method:'POST',token:merchant.token,body:{manual_confirmation:false}});
    expectStatus(presence,200,'Orders Runtime V13 Merchant presence confirmation');
    order=presence.json;
  }
  if(order.order_status!=='accepted')throw new Error('Orders Runtime V13 direct order did not reach accepted state.');

  const started=await requestJson(base,`/api/orders/merchant/${orderId}/start`,{method:'POST',token:merchant.token,body:{}});
  expectStatus(started,200,'Orders Runtime V13 Merchant start');
  if(started.json?.order_status!=='preparing')throw new Error('Orders Runtime V13 direct order did not start preparation.');

  const ready=await requestJson(base,`/api/orders/merchant/${orderId}/ready`,{method:'POST',token:merchant.token,body:{}});
  expectStatus(ready,200,'Orders Runtime V13 Merchant ready');
  if(ready.json?.order_status!=='ready')throw new Error('Orders Runtime V13 direct order did not reach ready.');

  const amount=Number(ready.json?.outstanding_amount??ready.json?.total);
  if(!(amount>0))throw new Error('Orders Runtime V13 direct order has no payable balance.');
  const payment=await requestJson(base,`/api/orders/merchant/${orderId}/payment`,{
    method:'POST',token:merchant.token,
    body:{amount,account:'cash',method_code:'cash',provider_code:'qa_orders_runtime_v13'}
  });
  expectStatus(payment,200,'Orders Runtime V13 Merchant payment');
  if(payment.json?.payment_status!=='paid')throw new Error('Orders Runtime V13 direct order payment did not settle.');

  const completed=await requestJson(base,`/api/orders/merchant/${orderId}/complete`,{method:'POST',token:merchant.token,body:{}});
  expectStatus(completed,200,'Orders Runtime V13 Merchant complete');
  if(completed.json?.order_status!=='completed')throw new Error('Orders Runtime V13 direct order did not complete.');

  const customerDetail=await requestJson(base,`/api/orders/${orderId}`,{token:customer.token});
  expectStatus(customerDetail,200,'Orders Runtime V13 Customer order detail');
  if(Number(customerDetail.json?.id)!==orderId||customerDetail.json?.order_status!=='completed')throw new Error('Orders Runtime V13 Customer detail is inconsistent.');

  const history=await requestJson(base,'/api/orders/mine',{token:customer.token});
  expectStatus(history,200,'Orders Runtime V13 Customer history');
  if(!(Array.isArray(history.json)?history.json:[]).some(x=>Number(x.id)===orderId&&x.order_status==='completed')){
    throw new Error('Orders Runtime V13 direct order is missing from Customer history.');
  }

  const tracker=await requestJson(base,`/api/orders/track/${publicToken}`);
  expectStatus(tracker,200,'Orders Runtime V13 public tracker');
  if(Number(tracker.json?.id)!==orderId||tracker.json?.order_status!=='completed')throw new Error('Orders Runtime V13 public tracker is inconsistent.');

  const trust=await requestJson(base,`/api/orders/merchant/customers/${customer.accountId}/trust?business_id=${businessId}`,{token:merchant.token});
  expectStatus(trust,200,'Orders Runtime V13 Merchant trust read');
  if(!Number.isFinite(Number(trust.json?.completed_orders)))throw new Error('Orders Runtime V13 trust evidence is missing.');

  for(const [label,token] of [['Customer',customer.token],['Merchant',merchant.token]]){
    const logout=await requestJson(base,'/api/auth/logout',{method:'POST',token,body:{}});
    expectStatus(logout,200,'Orders Runtime V13 '+label+' logout');
  }

  return{
    status:'PASS',
    wave:ORDERS_RUNTIME_V13_WAVE,
    marketplace_v12_baseline:true,
    root_composition:Boolean(rootComposition),
    index_composition:Boolean(indexComposition),
    direct_order_id:orderId,
    direct_order_creation:true,
    customer_check_in:true,
    merchant_presence:true,
    merchant_start:true,
    merchant_ready:true,
    payment_wrappers:true,
    direct_order_completed:true,
    customer_detail:true,
    customer_history:true,
    public_tracker:true,
    merchant_trust:true,
    logout:true
  };
}


async function runMarketplaceRuntimeV12Acceptance({pool,base,secret}){
  const rootComposition=await verifyMarketplaceRootComposition(base,'/','Marketplace Runtime V12 root composition');
  const indexComposition=await verifyMarketplaceRootComposition(base,'/index.html','Marketplace Runtime V12 index composition');
  const baseline=await runCustomerMarketplaceE2E({
    pool,base,secret,orderNote:'Controlled QA Marketplace Runtime V12'
  });
  if(baseline.status!=='PASS')throw new Error('Marketplace Runtime V12 Customer Marketplace baseline did not pass.');
  return{
    ...baseline,
    status:'PASS',
    wave:MARKETPLACE_RUNTIME_V12_WAVE,
    customer_marketplace_e2e_v1:true,
    root_composition:Boolean(rootComposition),
    index_composition:Boolean(indexComposition),
    marketplace_checkout:true,
    marketplace_stock_consumption:true,
    marketplace_order_override:true,
    logout_relogin:true
  };
}


async function runLocalServicesRuntimeV11Acceptance({pool,base,secret}){
  const rootComposition=await verifyLocalServicesRootComposition(base,'/','Local Services Runtime V11 root composition');
  const indexComposition=await verifyLocalServicesRootComposition(base,'/index.html','Local Services Runtime V11 index composition');

  const baseline=await runServiceProviderExperienceAcceptance({
    pool,base,secret,
    aliases:{
      customer:CUSTOMER_ALIAS,
      serviceProvider:SERVICE_PROVIDER_ALIAS,
      superAdmin:SUPER_ADMIN_ALIAS,
      territoryAdmin:TERRITORY_ADMIN_ALIAS
    },
    helpers:{
      requestJson,expectStatus,qaAccountSession,runCustomerOnboarding,
      ensureQaTerritory,ensureActiveRole,loginWithCredential
    }
  });
  if(baseline.status!=='PASS')throw new Error('Local Services Runtime V11 Service Provider baseline did not pass.');

  return{
    ...baseline,
    status:'PASS',
    wave:LOCAL_SERVICES_RUNTIME_V11_WAVE,
    service_provider_experience_v1:true,
    root_composition:Boolean(rootComposition),
    index_composition:Boolean(indexComposition),
    service_job_lifecycle:true,
    customer_confirmation:true,
    credential_scope:true,
    monetization_evidence:true,
    logout_relogin:true
  };
}


export async function runQaAcceptanceIfRequested({pool,port,env=process.env}){
  const config=qaAcceptanceConfig(env);
  if(!config.enabled)return{status:'SKIPPED',wave:''};

  const base='http://127.0.0.1:'+Number(port);
  let finalResult;
  try{
    const result=config.wave===ORDERS_RUNTIME_V13_WAVE
      ?await runOrdersRuntimeV13Acceptance({pool,base,secret:config.secret})
      :config.wave===MARKETPLACE_RUNTIME_V12_WAVE
      ?await runMarketplaceRuntimeV12Acceptance({pool,base,secret:config.secret})
      :config.wave===LOCAL_SERVICES_RUNTIME_V11_WAVE
      ?await runLocalServicesRuntimeV11Acceptance({pool,base,secret:config.secret})
      :config.wave===SUPPLIER_RUNTIME_V10_WAVE
      ?await runSupplierRuntimeV10Acceptance({pool,base,secret:config.secret})
      :config.wave===DELIVERY_RUNTIME_V9_WAVE
      ?await runDeliveryRuntimeV9Acceptance({pool,base,secret:config.secret})
      :config.wave===DELIVERY_FINANCE_RUNTIME_V8_WAVE
      ?await runDeliveryFinanceRuntimeV8Acceptance({pool,base,secret:config.secret})
      :config.wave===INCIDENT_RUNTIME_V7_WAVE
      ?await runIncidentRuntimeV7Acceptance({pool,base,secret:config.secret})
      :config.wave===AUTH_RUNTIME_V6_WAVE
      ?await runAuthRuntimeV6Acceptance({pool,base,secret:config.secret})
      :config.wave===MERCHANT_CATALOG_WAVE
      ?await runMerchantCatalogSeed({pool,base,secret:config.secret})
      :config.wave===MERCHANT_EXPERIENCE_WAVE
        ?await runMerchantExperienceAcceptance({pool,base,secret:config.secret})
        :config.wave===SUPPLIER_EXPERIENCE_WAVE
          ?await runSupplierExperienceAcceptance({pool,base,secret:config.secret})
        :config.wave===SUPPLIER_DOMAIN_V2_WAVE
          ?await runSupplierDomainV2Acceptance({pool,base,secret:config.secret})
        :config.wave===SUPPLIER_COMMERCIAL_V3_WAVE
          ?await runSupplierCommercialV3Acceptance({pool,base,secret:config.secret})
        :config.wave===SUPPLIER_SOURCING_V4_WAVE
          ?await runSupplierSourcingV4Acceptance({pool,base,secret:config.secret})
        :config.wave===SUPPLIER_DAILY_V5_WAVE
          ?await runSupplierDailyV5Acceptance({pool,base,secret:config.secret})
        :config.wave===COURIER_EXPERIENCE_WAVE
          ?await runCourierExperienceAcceptance({
            pool,base,secret:config.secret,
            aliases:{customer:CUSTOMER_ALIAS,merchant:MERCHANT_ALIAS,courier:COURIER_ALIAS,superAdmin:SUPER_ADMIN_ALIAS},
            helpers:{requestJson,expectStatus,qaAccountSession,runCustomerOnboarding,runMerchantCatalogSeed,ensureQaTerritory,ensureActiveRole,loginWithCredential}
          })
        :config.wave===SERVICE_PROVIDER_EXPERIENCE_WAVE
          ?await runServiceProviderExperienceAcceptance({
            pool,base,secret:config.secret,
            aliases:{
              customer:CUSTOMER_ALIAS,
              serviceProvider:SERVICE_PROVIDER_ALIAS,
              superAdmin:SUPER_ADMIN_ALIAS,
              territoryAdmin:TERRITORY_ADMIN_ALIAS
            },
            helpers:{
              requestJson,expectStatus,qaAccountSession,runCustomerOnboarding,
              ensureQaTerritory,ensureActiveRole,loginWithCredential
            }
          })
        :config.wave===CUSTOMER_MARKETPLACE_WAVE
        ?await runCustomerMarketplaceE2E({pool,base,secret:config.secret})
        :config.wave===CUSTOMER_EXPERIENCE_WAVE
          ?await runCustomerExperienceAcceptance({pool,base,secret:config.secret})
          :await runCustomerOnboarding({pool,base,secret:config.secret});
    finalResult=result;
    console.log('QA_ACCEPTANCE_RESULT '+JSON.stringify(result));
  }catch(error){
    finalResult={status:'FAIL',wave:config.wave,reason:clean(error?.message||'QA acceptance failed.',240)};
    console.error('QA_ACCEPTANCE_RESULT '+JSON.stringify(finalResult));
  }finally{
    await restoreAutomationCredentials(pool).catch(error=>console.error('QA credential restore failed:',clean(error?.message,200)));
  }
  return finalResult;
}

export {
  CUSTOMER_ALIAS,MERCHANT_ALIAS,SUPPLIER_ALIAS,COURIER_ALIAS,SERVICE_PROVIDER_ALIAS,TERRITORY_ADMIN_ALIAS,SUPER_ADMIN_ALIAS,
  CUSTOMER_WAVE,MERCHANT_CATALOG_WAVE,MERCHANT_EXPERIENCE_WAVE,SUPPLIER_EXPERIENCE_WAVE,SUPPLIER_DOMAIN_V2_WAVE,SUPPLIER_COMMERCIAL_V3_WAVE,SUPPLIER_SOURCING_V4_WAVE,SUPPLIER_DAILY_V5_WAVE,COURIER_EXPERIENCE_WAVE,SERVICE_PROVIDER_EXPERIENCE_WAVE,CUSTOMER_MARKETPLACE_WAVE,CUSTOMER_EXPERIENCE_WAVE,AUTH_RUNTIME_V6_WAVE,INCIDENT_RUNTIME_V7_WAVE,DELIVERY_FINANCE_RUNTIME_V8_WAVE,DELIVERY_RUNTIME_V9_WAVE,SUPPLIER_RUNTIME_V10_WAVE,LOCAL_SERVICES_RUNTIME_V11_WAVE,MARKETPLACE_RUNTIME_V12_WAVE,ORDERS_RUNTIME_V13_WAVE
};
