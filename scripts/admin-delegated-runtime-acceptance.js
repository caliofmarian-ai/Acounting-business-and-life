import crypto from 'node:crypto';
import pg from 'pg';

const {Pool}=pg;
const base='http://127.0.0.1:3000';
const secret=String(process.env.TOKEN_SECRET||'');
const database=String(process.env.PGDATABASE||'');

if(process.env.NODE_ENV!=='test'||database!=='abl_admin_ci'){
  throw new Error('Delegated Admin runtime acceptance may run only in isolated abl_admin_ci test runtime.');
}
if(!secret)throw new Error('TOKEN_SECRET is required for delegated Admin runtime acceptance.');

const pool=new Pool({
  host:process.env.PGHOST||'127.0.0.1',
  port:Number(process.env.PGPORT||5432),
  user:process.env.PGUSER||'postgres',
  password:process.env.PGPASSWORD||'postgres',
  database
});

function signToken(accountId,sessionId){
  const issued=Date.now();
  const payload='v2.'+issued+'.'+Number(accountId)+'.'+sessionId;
  const sig=crypto.createHmac('sha256',secret).update(payload).digest('hex');
  return payload+'.'+sig;
}
async function sessionFor(accountId,label){
  const sessionId='ci-admin-'+label+'-'+crypto.randomBytes(6).toString('hex');
  await pool.query(
    `INSERT INTO account_sessions(session_id,account_id,expires_at,user_agent,ip_hash)
     VALUES($1,$2,NOW()+INTERVAL '2 hours',$3,'ci')
     ON CONFLICT(session_id) DO UPDATE SET expires_at=EXCLUDED.expires_at,revoked_at=NULL`,
    [sessionId,Number(accountId),'delegated-admin-runtime-'+label]
  );
  return signToken(accountId,sessionId);
}
async function request(path,{token,method='GET',body,expected=200}={}){
  const response=await fetch(base+path,{
    method,
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  const text=await response.text();
  let data={};
  try{data=text?JSON.parse(text):{}}catch{data={raw:text}}
  if(response.status!==expected){
    throw new Error(method+' '+path+' expected '+expected+' but received '+response.status+': '+text.slice(0,700));
  }
  return data;
}
async function createAccount(label){
  const email='ci-admin-'+label+'@example.test';
  const q=await pool.query(
    `INSERT INTO accounts(display_name,email,auth_status)
     VALUES($1,$2,'active') RETURNING id,email`,
    ['CI '+label.replaceAll('-',' '),email]
  );
  return q.rows[0];
}
function assert(condition,message){if(!condition)throw new Error(message)}
function hasPermission(bootstrap,permission){return new Set(bootstrap?.me?.permissions||[]).has(permission)}
function territoryIds(bootstrap){return new Set((bootstrap?.overview?.territories||[]).map(x=>Number(x.id)))}

async function main(){
  const ownerToken=await sessionFor(1,'owner');
  const owner=await request('/api/admin/bootstrap',{token:ownerToken});
  assert(owner?.me?.is_admin===true,'Bootstrap owner is not Admin');
  assert((owner.me.assignments||[]).some(a=>(a.effective_rank||a.authority_rank||a.admin_role)==='super_admin'),'Owner Super Admin assignment missing');

  const suffix=Date.now().toString(36);
  const t1=await request('/api/governance/admin/territories',{
    token:ownerToken,method:'POST',expected:201,
    body:{country_code:'PH',territory_type:'city',name:'CI Admin Territory A '+suffix,code:'CI-ADM-A-'+suffix,status:'onboarding'}
  });
  const t2=await request('/api/governance/admin/territories',{
    token:ownerToken,method:'POST',expected:201,
    body:{country_code:'PH',territory_type:'city',name:'CI Admin Territory B '+suffix,code:'CI-ADM-B-'+suffix,status:'onboarding'}
  });

  const country=await createAccount('country-'+suffix);
  const territory=await createAccount('territory-'+suffix);
  const specialist=await createAccount('specialist-'+suffix);

  await request('/api/admin/assignments',{
    token:ownerToken,method:'POST',expected:201,
    body:{
      target_email:country.email,admin_role:'country_admin',
      function_codes:['profile_onboarding','support_operations','admin_delegation','audit_analytics'],
      reason:'CI delegated Country Admin acceptance'
    }
  });
  await request('/api/admin/assignments',{
    token:ownerToken,method:'POST',expected:201,
    body:{
      target_email:territory.email,admin_role:'territory_admin',territory_id:Number(t1.id),
      function_codes:['profile_onboarding','support_operations','delivery_operations'],
      reason:'CI delegated Territory Admin acceptance'
    }
  });
  await request('/api/admin/assignments',{
    token:ownerToken,method:'POST',expected:201,
    body:{
      target_email:specialist.email,admin_role:'specialist',territory_id:Number(t1.id),
      function_codes:['support_operations'],
      reason:'CI delegated Specialist acceptance'
    }
  });

  const countryToken=await sessionFor(country.id,'country');
  const territoryToken=await sessionFor(territory.id,'territory');
  const specialistToken=await sessionFor(specialist.id,'specialist');

  // Country Admin: delegated country-wide onboarding/support/delegation/audit, but no Courier verification or territory management.
  const countryBoot=await request('/api/admin/bootstrap',{token:countryToken});
  assert(hasPermission(countryBoot,'profiles.invite_merchant'),'Country Admin profile onboarding permission missing');
  assert(hasPermission(countryBoot,'support.manage'),'Country Admin support permission missing');
  assert(hasPermission(countryBoot,'admin.delegate'),'Country Admin delegation permission missing');
  assert(hasPermission(countryBoot,'audit.view'),'Country Admin audit permission missing');
  assert(!hasPermission(countryBoot,'courier.verify'),'Country Admin received undelegated Courier verification');
  assert(territoryIds(countryBoot).has(Number(t1.id))&&territoryIds(countryBoot).has(Number(t2.id)),'Country Admin did not receive country-wide territory visibility');
  await request('/api/admin/support',{token:countryToken});
  await request('/api/admin/assignments',{token:countryToken});
  await request('/api/admin/audit',{token:countryToken});
  await request('/api/admin/finance/operating',{token:countryToken});
  await request('/api/admin/couriers',{token:countryToken,expected:403});
  await request('/api/governance/admin/territories',{
    token:countryToken,method:'POST',expected:403,
    body:{territory_type:'city',name:'Forbidden Country Admin Territory',status:'planned'}
  });
  await request('/api/governance/admin/invitations',{
    token:countryToken,method:'POST',expected:201,
    body:{target_email:'ci-country-invite-'+suffix+'@example.test',role:'merchant',territory_id:Number(t2.id),expires_days:2,note:'Country scope acceptance'}
  });

  // Territory Admin: may operate only in assigned territory, including Courier verification, but not pricing, audit or Admin delegation.
  const territoryBoot=await request('/api/admin/bootstrap',{token:territoryToken});
  const territoryScope=territoryIds(territoryBoot);
  assert(territoryScope.has(Number(t1.id)),'Territory Admin cannot see assigned territory');
  assert(!territoryScope.has(Number(t2.id)),'Territory Admin leaked into sibling territory');
  assert(hasPermission(territoryBoot,'courier.verify'),'Territory Admin delegated Courier verification missing');
  assert(!hasPermission(territoryBoot,'delivery.pricing.manage'),'Territory Admin received country Delivery pricing');
  assert(!hasPermission(territoryBoot,'admin.delegate'),'Territory Admin received undelegated Admin delegation');
  await request('/api/admin/support',{token:territoryToken});
  await request('/api/admin/couriers',{token:territoryToken});
  await request('/api/admin/finance/operating',{token:territoryToken});
  await request('/api/admin/assignments',{token:territoryToken,expected:403});
  await request('/api/admin/delivery/pricing',{token:territoryToken,expected:403});
  await request('/api/admin/audit',{token:territoryToken,expected:403});
  await request('/api/governance/admin/invitations',{
    token:territoryToken,method:'POST',expected:201,
    body:{target_email:'ci-territory-ok-'+suffix+'@example.test',role:'supplier',territory_id:Number(t1.id),expires_days:2,note:'Territory scope acceptance'}
  });
  await request('/api/governance/admin/invitations',{
    token:territoryToken,method:'POST',expected:403,
    body:{target_email:'ci-territory-denied-'+suffix+'@example.test',role:'supplier',territory_id:Number(t2.id),expires_days:2,note:'Must remain outside sibling territory'}
  });

  // Specialist: support-only operational authority. Finance remains available but is function-scoped.
  const specialistBoot=await request('/api/admin/bootstrap',{token:specialistToken});
  const specialistScope=territoryIds(specialistBoot);
  assert(specialistScope.has(Number(t1.id))&&!specialistScope.has(Number(t2.id)),'Specialist territory scope is incorrect');
  assert(hasPermission(specialistBoot,'support.manage'),'Specialist support permission missing');
  assert(!hasPermission(specialistBoot,'profiles.invite_merchant'),'Specialist received undelegated profile onboarding');
  assert(!hasPermission(specialistBoot,'courier.verify'),'Specialist received undelegated Courier verification');
  assert(!hasPermission(specialistBoot,'audit.view'),'Specialist received undelegated audit access');
  await request('/api/admin/support',{token:specialistToken});
  const specialistFinance=await request('/api/admin/finance/operating',{token:specialistToken});
  assert(Array.isArray(specialistFinance?.scope?.function_codes),'Specialist finance function scope missing');
  assert(specialistFinance.scope.function_codes.length===1&&specialistFinance.scope.function_codes[0]==='support_operations','Specialist finance escaped support function scope');
  await request('/api/admin/assignments',{token:specialistToken,expected:403});
  await request('/api/admin/couriers',{token:specialistToken,expected:403});
  await request('/api/admin/audit',{token:specialistToken,expected:403});
  await request('/api/admin/incidents',{token:specialistToken,expected:403});
  await request('/api/governance/admin/invitations',{
    token:specialistToken,method:'POST',expected:403,
    body:{target_email:'ci-specialist-denied-'+suffix+'@example.test',role:'merchant',territory_id:Number(t1.id),expires_days:2}
  });

  console.log(JSON.stringify({
    ok:true,
    acceptance:'delegated_admin_allow_deny',
    country_admin:'PASS',
    territory_admin:'PASS',
    specialist:'PASS',
    sibling_territory_denial:'PASS',
    specialist_finance_function_scope:'PASS'
  }));
}

main().catch(error=>{
  console.error(error.stack||error.message);
  process.exitCode=1;
}).finally(async()=>{await pool.end().catch(()=>{})});
