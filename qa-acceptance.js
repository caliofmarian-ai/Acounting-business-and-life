import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { validateRuntimeSafety } from './runtime-safety.js';
import { runCourierExperienceAcceptance } from './qa-courier-acceptance.js';

const scryptAsync=promisify(crypto.scrypt);
const CUSTOMER_ALIAS='dropi.deliveries+testcustomer@gmail.com';
const MERCHANT_ALIAS='dropi.deliveries+testmerchant@gmail.com';
const SUPPLIER_ALIAS='dropi.deliveries+testsupplier@gmail.com';
const COURIER_ALIAS='dropi.deliveries+testcourier@gmail.com';
const SUPER_ADMIN_ALIAS='dropi.deliveries+testsuperadmin@gmail.com';
const CUSTOMER_WAVE='customer_onboarding_v1';
const MERCHANT_CATALOG_WAVE='merchant_catalog_seed_v1';
const MERCHANT_EXPERIENCE_WAVE='merchant_experience_v1';
const SUPPLIER_EXPERIENCE_WAVE='supplier_experience_v1';
const SUPPLIER_DOMAIN_V2_WAVE='supplier_domain_v2';
const SUPPLIER_COMMERCIAL_V3_WAVE='supplier_commercial_v3';
const SUPPLIER_SOURCING_V4_WAVE='supplier_sourcing_v4';
const COURIER_EXPERIENCE_WAVE='courier_experience_v1';
const CUSTOMER_MARKETPLACE_WAVE='customer_marketplace_e2e_v1';
const CUSTOMER_EXPERIENCE_WAVE='customer_experience_v1';
const ACCEPTANCE_WAVES=new Set([CUSTOMER_WAVE,MERCHANT_CATALOG_WAVE,MERCHANT_EXPERIENCE_WAVE,SUPPLIER_EXPERIENCE_WAVE,SUPPLIER_DOMAIN_V2_WAVE,SUPPLIER_COMMERCIAL_V3_WAVE,SUPPLIER_SOURCING_V4_WAVE,COURIER_EXPERIENCE_WAVE,CUSTOMER_MARKETPLACE_WAVE,CUSTOMER_EXPERIENCE_WAVE]);

const clean=(value,max=300)=>String(value??'').trim().slice(0,max);

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
    `SELECT id,account_mode,test_role,email_verified_at
       FROM accounts
      WHERE LOWER(email)=$1`,
    [email]
  );
  if(account.rowCount!==1)throw new Error('Expected QA test identity was not found.');
  const row=account.rows[0];
  if(row.account_mode!=='company_test'||row.test_role!==role)throw new Error('QA test identity classification is invalid.');

  const password=derivePassword(secret,email);
  const salt=crypto.randomBytes(16).toString('hex');
  const derived=await scryptAsync(password,salt,64);
  await pool.query(
    `UPDATE accounts
        SET password_salt=$1,password_hash=$2,updated_at=NOW()
      WHERE id=$3 AND account_mode='company_test' AND test_role=$4`,
    [salt,Buffer.from(derived).toString('hex'),row.id,role]
  );
  return{accountId:Number(row.id),password,alreadyVerified:Boolean(row.email_verified_at)};
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

export async function runQaAcceptanceIfRequested({pool,port,env=process.env}){
  const config=qaAcceptanceConfig(env);
  if(!config.enabled)return{status:'SKIPPED',wave:''};

  const base='http://127.0.0.1:'+Number(port);
  try{
    const result=config.wave===MERCHANT_CATALOG_WAVE
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
        :config.wave===COURIER_EXPERIENCE_WAVE
          ?await runCourierExperienceAcceptance({
            pool,base,secret:config.secret,
            aliases:{customer:CUSTOMER_ALIAS,merchant:MERCHANT_ALIAS,courier:COURIER_ALIAS,superAdmin:SUPER_ADMIN_ALIAS},
            helpers:{requestJson,expectStatus,qaAccountSession,runCustomerOnboarding,runMerchantCatalogSeed,ensureQaTerritory,ensureActiveRole,loginWithCredential}
          })
        :config.wave===CUSTOMER_MARKETPLACE_WAVE
        ?await runCustomerMarketplaceE2E({pool,base,secret:config.secret})
        :config.wave===CUSTOMER_EXPERIENCE_WAVE
          ?await runCustomerExperienceAcceptance({pool,base,secret:config.secret})
          :await runCustomerOnboarding({pool,base,secret:config.secret});
    console.log('QA_ACCEPTANCE_RESULT '+JSON.stringify(result));
    return result;
  }catch(error){
    const result={status:'FAIL',wave:config.wave,reason:clean(error?.message||'QA acceptance failed.',240)};
    console.error('QA_ACCEPTANCE_RESULT '+JSON.stringify(result));
    return result;
  }
}

export {
  CUSTOMER_ALIAS,MERCHANT_ALIAS,SUPPLIER_ALIAS,COURIER_ALIAS,SUPER_ADMIN_ALIAS,
  CUSTOMER_WAVE,MERCHANT_CATALOG_WAVE,MERCHANT_EXPERIENCE_WAVE,SUPPLIER_EXPERIENCE_WAVE,SUPPLIER_DOMAIN_V2_WAVE,SUPPLIER_COMMERCIAL_V3_WAVE,SUPPLIER_SOURCING_V4_WAVE,COURIER_EXPERIENCE_WAVE,CUSTOMER_MARKETPLACE_WAVE,CUSTOMER_EXPERIENCE_WAVE
};
