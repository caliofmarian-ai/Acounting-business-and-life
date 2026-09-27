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

  const planned=await request('/api/governance/admin/territories/'+Number(t1.id)+'/status',{
    token:ownerToken,method:'PATCH',
    body:{status:'planned',reason:'CI verify territory lifecycle control'}
  });
  assert(planned.status==='planned','Owner could not move territory to planned');
  const onboardingAfterPlanned=await request('/api/governance/territories',{token:ownerToken});
  assert(!onboardingAfterPlanned.some(x=>Number(x.id)===Number(t1.id)),'Planned territory leaked into onboarding territory list');
  const reopened=await request('/api/governance/admin/territories/'+Number(t1.id)+'/status',{
    token:ownerToken,method:'PATCH',
    body:{status:'onboarding',reason:'CI restore delegated Admin fixture'}
  });
  assert(reopened.status==='onboarding','Owner could not restore territory onboarding status');
  const lifecycleAudit=await pool.query(
    "SELECT detail_json FROM profile_governance_events WHERE territory_id=$1 AND event_code='territory_status_changed' ORDER BY id DESC LIMIT 1",
    [Number(t1.id)]
  );
  assert(lifecycleAudit.rowCount===1,'Territory lifecycle audit event missing');
  assert(lifecycleAudit.rows[0].detail_json?.before_status==='planned'&&lifecycleAudit.rows[0].detail_json?.after_status==='onboarding','Territory lifecycle audit before/after evidence incorrect');

  const country=await createAccount('country-'+suffix);
  const territory=await createAccount('territory-'+suffix);
  const specialist=await createAccount('specialist-'+suffix);
  const memberA=await createAccount('member-a-'+suffix);
  const memberB=await createAccount('member-b-'+suffix);
  await pool.query(
    `INSERT INTO profile_authorizations(account_id,role,territory_id,status,approved_by_account_id,approved_at,reason)
     VALUES($1,'service_provider',$2,'active',1,NOW(),'CI Members scope fixture')`,
    [Number(memberA.id),Number(t1.id)]
  );
  await pool.query(
    `INSERT INTO profile_authorizations(account_id,role,territory_id,status,approved_by_account_id,approved_at,reason)
     VALUES($1,'service_provider',$2,'active',1,NOW(),'CI Members sibling scope fixture')`,
    [Number(memberB.id),Number(t2.id)]
  );

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
      function_codes:['profile_onboarding','support_operations','delivery_operations','member_account_controls'],
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
  assert(hasPermission(countryBoot,'members.view'),'Country Admin baseline Members permission missing');
  assert(!hasPermission(countryBoot,'courier.verify'),'Country Admin received undelegated Courier verification');
  assert(territoryIds(countryBoot).has(Number(t1.id))&&territoryIds(countryBoot).has(Number(t2.id)),'Country Admin did not receive country-wide territory visibility');
  await request('/api/admin/support',{token:countryToken});
  await request('/api/admin/assignments',{token:countryToken});
  await request('/api/admin/audit',{token:countryToken});
  const countryMembers=await request('/api/admin/members?limit=100',{token:countryToken});
  assert(countryMembers.scope?.country_wide===true&&countryMembers.scope?.platform_wide===false,'Country Admin Members scope must remain country-wide, not platform-wide');
  assert((countryMembers.items||[]).some(x=>Number(x.account_id)===Number(memberA.id)),'Country Admin cannot see member in territory A');
  assert((countryMembers.items||[]).some(x=>Number(x.account_id)===Number(memberB.id)),'Country Admin cannot see member in territory B');
  const countryMemberDetail=await request('/api/admin/members/'+Number(memberA.id),{token:countryToken});
  assert(Number(countryMemberDetail.member?.account_id)===Number(memberA.id),'Country Admin cannot open member detail');
  assert(countryMemberDetail.controls?.manage_status===false&&countryMemberDetail.controls?.revoke_sessions===false,'Read-only Country Admin unexpectedly received member controls');
  await request('/api/admin/members/'+Number(memberA.id)+'/status',{
    token:countryToken,method:'PATCH',expected:403,
    body:{status:'suspended',reason:'Country Admin fixture is read-only',confirm:true}
  });
  await request('/api/admin/finance/operating',{token:countryToken});
  await request('/api/admin/couriers',{token:countryToken,expected:403});
  await request('/api/governance/admin/territories',{
    token:countryToken,method:'POST',expected:403,
    body:{territory_type:'city',name:'Forbidden Country Admin Territory',status:'planned'}
  });
  await request('/api/governance/admin/territories/'+Number(t2.id)+'/status',{
    token:countryToken,method:'PATCH',expected:403,
    body:{status:'planned',reason:'Country Admin must not receive territory.manage implicitly'}
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
  assert(hasPermission(territoryBoot,'members.view'),'Territory Admin baseline Members permission missing');
  assert(hasPermission(territoryBoot,'members.manage_status'),'Territory Admin explicit member status control missing');
  assert(hasPermission(territoryBoot,'members.sessions.revoke'),'Territory Admin explicit member session control missing');
  assert(!hasPermission(territoryBoot,'delivery.pricing.manage'),'Territory Admin received country Delivery pricing');
  assert(!hasPermission(territoryBoot,'admin.delegate'),'Territory Admin received undelegated Admin delegation');
  await request('/api/admin/support',{token:territoryToken});
  await request('/api/admin/couriers',{token:territoryToken});
  const territoryMembers=await request('/api/admin/members?limit=100',{token:territoryToken});
  assert(territoryMembers.scope?.country_wide===false,'Territory Admin Members escaped into country scope');
  assert((territoryMembers.items||[]).some(x=>Number(x.account_id)===Number(memberA.id)),'Territory Admin cannot see in-scope member');
  assert(!(territoryMembers.items||[]).some(x=>Number(x.account_id)===Number(memberB.id)),'Territory Admin leaked sibling-territory member');
  await sessionFor(memberA.id,'member-a-target');
  const territoryMemberDetail=await request('/api/admin/members/'+Number(memberA.id),{token:territoryToken});
  assert(territoryMemberDetail.controls?.manage_status===true&&territoryMemberDetail.controls?.revoke_sessions===true,'Territory Admin member controls not exposed for in-scope member');
  assert(Number(territoryMemberDetail.security?.active_session_count||0)>=1,'Member security summary did not count active session');
  await request('/api/admin/members/'+Number(memberB.id),{token:territoryToken,expected:404});
  await request('/api/admin/members/'+Number(memberB.id)+'/status',{
    token:territoryToken,method:'PATCH',expected:404,
    body:{status:'suspended',reason:'Sibling territory must remain inaccessible',confirm:true}
  });
  const revokedSessions=await request('/api/admin/members/'+Number(memberA.id)+'/sessions/revoke',{
    token:territoryToken,method:'POST',
    body:{reason:'CI account takeover response check',confirm:true}
  });
  assert(Number(revokedSessions.sessions_revoked||0)>=1,'Territory Admin did not revoke active member session');
  const afterSessionRevoke=await request('/api/admin/members/'+Number(memberA.id),{token:territoryToken});
  assert(Number(afterSessionRevoke.security?.active_session_count||0)===0,'Revoked member session still counted active');
  const suspendedMember=await request('/api/admin/members/'+Number(memberA.id)+'/status',{
    token:territoryToken,method:'PATCH',
    body:{status:'suspended',reason:'CI scoped member suspension acceptance',confirm:true}
  });
  assert(suspendedMember.auth_status==='suspended','Territory Admin could not suspend in-scope member');
  const suspendedDetail=await request('/api/admin/members/'+Number(memberA.id),{token:territoryToken});
  assert(suspendedDetail.member?.auth_status==='suspended','Suspended member detail did not refresh status');
  const reactivatedMember=await request('/api/admin/members/'+Number(memberA.id)+'/status',{
    token:territoryToken,method:'PATCH',
    body:{status:'active',reason:'CI restore member after suspension acceptance',confirm:true}
  });
  assert(reactivatedMember.auth_status==='active','Territory Admin could not reactivate in-scope member');
  const memberAudit=await pool.query(
    "SELECT event_code,reason FROM admin_audit_events WHERE target_type='member_account' AND target_id=$1 ORDER BY id",
    [String(memberA.id)]
  );
  const memberAuditCodes=new Set(memberAudit.rows.map(x=>x.event_code));
  assert(memberAuditCodes.has('member_sessions_revoked')&&memberAuditCodes.has('member_account_suspended')&&memberAuditCodes.has('member_account_reactivated'),'Member control audit events missing');
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
  assert(!hasPermission(specialistBoot,'members.view'),'Support-only Specialist received undelegated Members access');
  assert(!hasPermission(specialistBoot,'profiles.invite_merchant'),'Specialist received undelegated profile onboarding');
  assert(!hasPermission(specialistBoot,'courier.verify'),'Specialist received undelegated Courier verification');
  assert(!hasPermission(specialistBoot,'audit.view'),'Specialist received undelegated audit access');
  await request('/api/admin/support',{token:specialistToken});
  const specialistFinance=await request('/api/admin/finance/operating',{token:specialistToken});
  assert(Array.isArray(specialistFinance?.scope?.function_codes),'Specialist finance function scope missing');
  assert(specialistFinance.scope.function_codes.length===1&&specialistFinance.scope.function_codes[0]==='support_operations','Specialist finance escaped support function scope');
  await request('/api/admin/assignments',{token:specialistToken,expected:403});
  await request('/api/admin/members',{token:specialistToken,expected:403});
  await request('/api/admin/members/'+Number(memberA.id),{token:specialistToken,expected:403});
  await request('/api/admin/members/'+Number(memberA.id)+'/sessions/revoke',{
    token:specialistToken,method:'POST',expected:403,
    body:{reason:'Specialist must not revoke sessions',confirm:true}
  });
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
    territory_status_lifecycle:'PASS',
    territory_status_audit:'PASS',
    specialist_finance_function_scope:'PASS',
    members_country_scope:'PASS',
    members_territory_isolation:'PASS',
    members_detail_scope:'PASS',
    members_controls_explicit_permission:'PASS',
    members_controls_audit:'PASS',
    members_specialist_deny:'PASS'
  }));
}

main().catch(error=>{
  console.error(error.stack||error.message);
  process.exitCode=1;
}).finally(async()=>{await pool.end().catch(()=>{})});
