import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { validateRuntimeSafety } from './runtime-safety.js';

const scryptAsync=promisify(crypto.scrypt);
const CUSTOMER_ALIAS='dropi.deliveries+testcustomer@gmail.com';
const MERCHANT_ALIAS='dropi.deliveries+testmerchant@gmail.com';
const SUPER_ADMIN_ALIAS='dropi.deliveries+testsuperadmin@gmail.com';
const CUSTOMER_WAVE='customer_onboarding_v1';
const MERCHANT_CATALOG_WAVE='merchant_catalog_seed_v1';
const ACCEPTANCE_WAVES=new Set([CUSTOMER_WAVE,MERCHANT_CATALOG_WAVE]);

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

export async function runQaAcceptanceIfRequested({pool,port,env=process.env}){
  const config=qaAcceptanceConfig(env);
  if(!config.enabled)return{status:'SKIPPED',wave:''};

  const base='http://127.0.0.1:'+Number(port);
  try{
    const result=config.wave===MERCHANT_CATALOG_WAVE
      ?await runMerchantCatalogSeed({pool,base,secret:config.secret})
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
  CUSTOMER_WAVE,MERCHANT_CATALOG_WAVE
};
