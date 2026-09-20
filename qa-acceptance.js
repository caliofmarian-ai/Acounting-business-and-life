import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { validateRuntimeSafety } from './runtime-safety.js';

const scryptAsync=promisify(crypto.scrypt);
const CUSTOMER_ALIAS='dropi.deliveries+testcustomer@gmail.com';
const MERCHANT_ALIAS='dropi.deliveries+testmerchant@gmail.com';
const SUPER_ADMIN_ALIAS='dropi.deliveries+testsuperadmin@gmail.com';
const CUSTOMER_WAVE='customer_onboarding_v1';
const MERCHANT_CATALOG_WAVE='merchant_catalog_seed_v1';
const CUSTOMER_MARKETPLACE_WAVE='customer_marketplace_e2e_v1';
const CUSTOMER_EXPERIENCE_WAVE='customer_experience_v1';
const ACCEPTANCE_WAVES=new Set([CUSTOMER_WAVE,MERCHANT_CATALOG_WAVE,CUSTOMER_MARKETPLACE_WAVE,CUSTOMER_EXPERIENCE_WAVE]);

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

async function requestJson(base,path,{method='GET',token='',body}={}){
  const headers={Accept:'application/json'};
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

async function runCustomerMarketplaceE2E({pool,base,secret}){
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
    [businessId,customer.accountId,CUSTOMER_MARKETPLACE_NOTE]
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
        note:CUSTOMER_MARKETPLACE_NOTE
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

export async function runQaAcceptanceIfRequested({pool,port,env=process.env}){
  const config=qaAcceptanceConfig(env);
  if(!config.enabled)return{status:'SKIPPED',wave:''};

  const base='http://127.0.0.1:'+Number(port);
  try{
    const result=config.wave===MERCHANT_CATALOG_WAVE
      ?await runMerchantCatalogSeed({pool,base,secret:config.secret})
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
  CUSTOMER_ALIAS,MERCHANT_ALIAS,SUPER_ADMIN_ALIAS,
  CUSTOMER_WAVE,MERCHANT_CATALOG_WAVE,CUSTOMER_MARKETPLACE_WAVE,CUSTOMER_EXPERIENCE_WAVE
};
