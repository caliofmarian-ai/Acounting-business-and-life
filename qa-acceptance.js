import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { validateRuntimeSafety } from './runtime-safety.js';

const scryptAsync=promisify(crypto.scrypt);
const CUSTOMER_ALIAS='dropi.deliveries+testcustomer@gmail.com';
const CUSTOMER_WAVE='customer_onboarding_v1';

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
  if(wave!==CUSTOMER_WAVE)throw new Error('Unknown QA acceptance wave.');
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

async function runCustomerOnboarding({pool,base,secret}){
  const credential=await installAutomationCredential(pool,{secret,email:CUSTOMER_ALIAS,role:'customer'});

  const login=await requestJson(base,'/api/auth/login',{
    method:'POST',
    body:{email:CUSTOMER_ALIAS,password:credential.password}
  });
  expectStatus(login,200,'Customer QA login');
  const token=clean(login.json?.token,400);
  if(!token)throw new Error('Customer QA login did not create a session.');

  let emailDelivery='already_verified';
  if(!credential.alreadyVerified){
    const verificationRequest=await requestJson(base,'/api/auth/email-verification/request',{
      method:'POST',token,body:{}
    });
    expectStatus(verificationRequest,200,'Customer verification request');
    emailDelivery=clean(verificationRequest.json?.delivery_status,40)||'unknown';
    if(emailDelivery!=='sent')throw new Error('Customer verification email was not delivered by the configured provider.');

    const previewUrl=clean(verificationRequest.json?.preview_verify_url,1200);
    if(!previewUrl)throw new Error('QA verification link was not returned by the isolated preview environment.');
    let verifyToken='';
    try{verifyToken=new URL(previewUrl).searchParams.get('verify_token')||''}catch{}
    if(!verifyToken)throw new Error('QA verification token was not available.');

    const verified=await requestJson(base,'/api/auth/email-verification/verify',{
      method:'POST',token,body:{token:verifyToken}
    });
    expectStatus(verified,200,'Customer email verification');
  }

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

  const relogin=await requestJson(base,'/api/auth/login',{
    method:'POST',
    body:{email:CUSTOMER_ALIAS,password:credential.password}
  });
  expectStatus(relogin,200,'Customer re-login');
  const secondToken=clean(relogin.json?.token,400);
  if(!secondToken)throw new Error('Customer re-login did not create a session.');

  const finalLogout=await requestJson(base,'/api/auth/logout',{method:'POST',token:secondToken,body:{}});
  expectStatus(finalLogout,200,'Customer final logout');

  return{
    status:'PASS',
    wave:CUSTOMER_WAVE,
    account_role:'customer',
    email_delivery:emailDelivery,
    verified:true,
    profile_active:true,
    cross_role_denial:true,
    logout_relogin:true
  };
}

export async function runQaAcceptanceIfRequested({pool,port,env=process.env}){
  const config=qaAcceptanceConfig(env);
  if(!config.enabled)return{status:'SKIPPED',wave:''};

  const base='http://127.0.0.1:'+Number(port);
  try{
    const result=await runCustomerOnboarding({pool,base,secret:config.secret});
    console.log('QA_ACCEPTANCE_RESULT '+JSON.stringify(result));
    return result;
  }catch(error){
    const result={status:'FAIL',wave:config.wave,reason:clean(error?.message||'QA acceptance failed.',240)};
    console.error('QA_ACCEPTANCE_RESULT '+JSON.stringify(result));
    return result;
  }
}

export { CUSTOMER_ALIAS, CUSTOMER_WAVE };
