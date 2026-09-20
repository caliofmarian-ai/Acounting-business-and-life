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
const COURIER_EXPERIENCE_WAVE='courier_experience_v1';
const CUSTOMER_MARKETPLACE_WAVE='customer_marketplace_e2e_v1';
const CUSTOMER_EXPERIENCE_WAVE='customer_experience_v1';
const ACCEPTANCE_WAVES=new Set([CUSTOMER_WAVE,MERCHANT_CATALOG_WAVE,MERCHANT_EXPERIENCE_WAVE,SUPPLIER_EXPERIENCE_WAVE,COURIER_EXPERIENCE_WAVE,CUSTOMER_MARKETPLACE_WAVE,CUSTOMER_EXPERIENCE_WAVE]);

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
  CUSTOMER_WAVE,MERCHANT_CATALOG_WAVE,MERCHANT_EXPERIENCE_WAVE,SUPPLIER_EXPERIENCE_WAVE,COURIER_EXPERIENCE_WAVE,CUSTOMER_MARKETPLACE_WAVE,CUSTOMER_EXPERIENCE_WAVE
};
