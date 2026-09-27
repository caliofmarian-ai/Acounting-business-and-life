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

  await request('/api/admin/members/1/status',{
    token:ownerToken,method:'PATCH',expected:409,
    body:{status:'suspended',reason:'CI current Admin account must remain protected',confirm:true}
  });

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
  const profileSpecialist=await createAccount('profile-specialist-'+suffix);
  const memberSupportSpecialist=await createAccount('member-support-specialist-'+suffix);
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
  await pool.query(
    `INSERT INTO profiles(account_id,role,enabled,visibility,status)
     VALUES($1,'customer',TRUE,'private','active')
     ON CONFLICT(account_id,role) DO UPDATE SET enabled=TRUE,status='active',updated_at=NOW()`,
    [Number(memberA.id)]
  );
  await pool.query(
    `INSERT INTO profiles(account_id,role,enabled,visibility,status)
     VALUES($1,'supplier',TRUE,'private','active')
     ON CONFLICT(account_id,role) DO UPDATE SET enabled=TRUE,status='active',updated_at=NOW()`,
    [Number(memberB.id)]
  );
  const memberBusiness=await pool.query(
    `INSERT INTO businesses(name,country_code,currency_code,territory_id)
     VALUES($1,'PH','PHP',$2) RETURNING id,name`,
    ['CI Member Business '+suffix,Number(t1.id)]
  );
  await pool.query(
    `INSERT INTO business_memberships(business_id,account_id,membership_role,active)
     VALUES($1,$2,'owner',TRUE)`,
    [Number(memberBusiness.rows[0].id),Number(memberA.id)]
  );

  const supportA=await pool.query(
    `INSERT INTO support_tickets(requester_account_id,country_code,territory_id,category,subject,description,priority,status)
     VALUES($1,'PH',$2,'account','CI Member Support A','Private support body must stay in Support','high','triaged') RETURNING id`,
    [Number(memberA.id),Number(t1.id)]
  );
  await pool.query(
    `INSERT INTO support_tickets(requester_account_id,country_code,territory_id,category,subject,description,priority,status)
     VALUES($1,'PH',$2,'account','CI Member Support B','Sibling private support body','normal','new')`,
    [Number(memberB.id),Number(t2.id)]
  );
  const trustA=await pool.query(
    `INSERT INTO trust_cases(public_id,case_type,title,status,severity,country_code,territory_id,created_by_account_id)
     VALUES($1,'fraud_or_identity','CI Member Safety A','investigating','high','PH',$2,1) RETURNING id`,
    ['CI-TSC-A-'+suffix,Number(t1.id)]
  );
  await pool.query(
    `INSERT INTO trust_case_entities(case_id,entity_type,entity_id,relation_type,added_by_account_id)
     VALUES($1,'account',$2,'reported_subject',1)`,
    [Number(trustA.rows[0].id),String(memberA.id)]
  );
  const privacyDoc=await pool.query("SELECT id FROM legal_documents WHERE code='privacy_notice' LIMIT 1");
  assert(privacyDoc.rowCount===1,'Privacy notice legal document fixture missing');
  const legalHash=('a'+suffix.replace(/[^a-z0-9]/gi,'')).padEnd(64,'0').slice(0,64);
  const legalVersion=await pool.query(
    `INSERT INTO legal_document_versions(
       document_id,version_label,locale,content_markdown,content_sha256,status,authoritative,
       translation_review_status,legal_review_status,effective_at,published_at,source_ref,created_by_account_id
     ) VALUES($1,$2,'en-PH',$3,$4,'active',TRUE,'not_applicable','reviewed',NOW(),NOW(),'ci-members-v3',1)
     RETURNING id,content_sha256`,
    [Number(privacyDoc.rows[0].id),'ci-members-v3-'+suffix,'CI Members V3 privacy acceptance fixture content for runtime scope verification.',legalHash]
  );
  await pool.query(
    `INSERT INTO legal_acceptances(
       account_id,document_version_id,state,role_context,territory_id,action_code,purpose,content_sha256,accepted_at
     ) VALUES($1,$2,'accepted','service_provider',$3,'profile.submit','CI Members V3 sanitized legal history',$4,NOW())`,
    [Number(memberA.id),Number(legalVersion.rows[0].id),Number(t1.id),legalVersion.rows[0].content_sha256]
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
      function_codes:['profile_onboarding','support_operations','delivery_operations','member_account_controls','member_context_notes','trust_safety'],
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

  await request('/api/admin/assignments',{
    token:ownerToken,method:'POST',expected:201,
    body:{
      target_email:profileSpecialist.email,admin_role:'specialist',territory_id:Number(t1.id),
      function_codes:['profile_onboarding'],
      reason:'CI Members Hub profile-governance-only specialist acceptance'
    }
  });

  await request('/api/admin/assignments',{
    token:ownerToken,method:'POST',expected:201,
    body:{
      target_email:memberSupportSpecialist.email,admin_role:'specialist',territory_id:Number(t1.id),
      function_codes:['support_operations','member_directory'],
      reason:'CI Members V3 Support + Member Directory acceptance'
    }
  });

  const countryToken=await sessionFor(country.id,'country');
  const territoryToken=await sessionFor(territory.id,'territory');
  const specialistToken=await sessionFor(specialist.id,'specialist');
  const profileSpecialistToken=await sessionFor(profileSpecialist.id,'profile-specialist');
  const memberSupportSpecialistToken=await sessionFor(memberSupportSpecialist.id,'member-support-specialist');

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
  const countryMemberSummary=await request('/api/admin/members/summary',{token:countryToken});
  assert(countryMemberSummary.scope?.country_wide===true&&countryMemberSummary.scope?.platform_wide===false,'Country Admin Members summary scope must remain PH country-wide');
  assert(Number(countryMemberSummary.total||0)>=2,'Country Admin Members summary omitted fixture accounts');
  assert(Number(countryMemberSummary.active_profiles?.customer||0)>=1,'Country Admin Members summary missing Customer profile');
  assert(Number(countryMemberSummary.active_profiles?.supplier||0)>=1,'Country Admin Members summary missing sibling-territory Supplier profile from country scope');
  assert((countryMembers.items||[]).some(x=>Number(x.account_id)===Number(memberA.id)),'Country Admin cannot see member in territory A');
  assert((countryMembers.items||[]).some(x=>Number(x.account_id)===Number(memberB.id)),'Country Admin cannot see member in territory B');
  const countryMemberDetail=await request('/api/admin/members/'+Number(memberA.id),{token:countryToken});
  assert(Number(countryMemberDetail.member?.account_id)===Number(memberA.id),'Country Admin cannot open member detail');
  assert(countryMemberDetail.controls?.manage_status===false&&countryMemberDetail.controls?.revoke_sessions===false,'Read-only Country Admin unexpectedly received member controls');
  assert(countryMemberDetail.context?.support?.available===true,'Country Admin Support context not available');
  assert((countryMemberDetail.context?.support?.items||[]).some(x=>Number(x.id)===Number(supportA.rows[0].id)),'Country Admin Support context missing member ticket');
  assert(countryMemberDetail.context?.safety?.available===false,'Country Admin without incident.triage received Trust & Safety context');
  assert(countryMemberDetail.context?.legal?.available===false,'Country Admin without legal.view received Legal context');
  assert(countryMemberDetail.context?.internal?.available===false&&countryMemberDetail.controls?.manage_notes===false,'Country Admin received undelegated internal notes');
  await request('/api/admin/members/'+Number(memberA.id)+'/status',{
    token:countryToken,method:'PATCH',expected:403,
    body:{status:'suspended',reason:'Country Admin fixture is read-only',confirm:true}
  });
  const ownerMemberSummary=await request('/api/admin/members/summary',{token:ownerToken});
  assert(ownerMemberSummary.scope?.platform_wide===true,'Super Admin Members summary must remain platform-wide');
  assert(Number(ownerMemberSummary.total||0)>=Number(countryMemberSummary.total||0),'Super Admin Members summary cannot be smaller than country scope');
  const ownerMemberDetail=await request('/api/admin/members/'+Number(memberA.id),{token:ownerToken});
  assert(ownerMemberDetail.context?.legal?.available===true,'Super Admin legal context missing');
  const legalItem=(ownerMemberDetail.context?.legal?.items||[]).find(x=>x.purpose==='CI Members V3 sanitized legal history');
  assert(Boolean(legalItem),'Sanitized legal acceptance history missing');
  assert(!Object.prototype.hasOwnProperty.call(legalItem,'ip_hash')&&!Object.prototype.hasOwnProperty.call(legalItem,'device_hash')&&!Object.prototype.hasOwnProperty.call(legalItem,'correlation_id')&&!Object.prototype.hasOwnProperty.call(legalItem,'content_sha256'),'Legal context leaked metadata hashes or evidence fields');
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
  assert(hasPermission(territoryBoot,'members.notes.manage'),'Territory Admin explicit member notes authority missing');
  assert(hasPermission(territoryBoot,'incident.triage'),'Territory Admin Trust & Safety function missing');
  assert(!hasPermission(territoryBoot,'delivery.pricing.manage'),'Territory Admin received country Delivery pricing');
  assert(!hasPermission(territoryBoot,'admin.delegate'),'Territory Admin received undelegated Admin delegation');
  await request('/api/admin/support',{token:territoryToken});
  await request('/api/admin/couriers',{token:territoryToken});
  const territoryMembers=await request('/api/admin/members?limit=100',{token:territoryToken});
  assert(territoryMembers.scope?.country_wide===false,'Territory Admin Members escaped into country scope');
  const territoryMemberSummary=await request('/api/admin/members/summary',{token:territoryToken});
  assert(territoryMemberSummary.scope?.country_wide===false&&territoryMemberSummary.scope?.platform_wide===false,'Territory Admin Members summary escaped delegated scope');
  assert(Number(territoryMemberSummary.active_profiles?.customer||0)>=1,'Territory Admin Members summary missing in-scope Customer profile');
  assert(Number(territoryMemberSummary.active_profiles?.supplier||0)===0,'Territory Admin Members summary leaked sibling-territory Supplier profile');
  assert((territoryMembers.items||[]).some(x=>Number(x.account_id)===Number(memberA.id)),'Territory Admin cannot see in-scope member');
  assert(!(territoryMembers.items||[]).some(x=>Number(x.account_id)===Number(memberB.id)),'Territory Admin leaked sibling-territory member');
  await sessionFor(memberA.id,'member-a-target');
  const territoryMemberDetail=await request('/api/admin/members/'+Number(memberA.id),{token:territoryToken});
  assert(territoryMemberDetail.controls?.manage_status===true&&territoryMemberDetail.controls?.revoke_sessions===true,'Territory Admin member controls not exposed for in-scope member');
  assert(territoryMemberDetail.controls?.manage_notes===true&&territoryMemberDetail.context?.internal?.available===true,'Territory Admin member notes control missing');
  assert(territoryMemberDetail.context?.support?.available===true,'Territory Admin Support context missing');
  assert(territoryMemberDetail.context?.safety?.available===true,'Territory Admin Trust & Safety context missing');
  assert((territoryMemberDetail.context?.safety?.items||[]).some(x=>Number(x.id)===Number(trustA.rows[0].id)),'Territory Admin safety context missing in-scope case');
  assert(territoryMemberDetail.context?.legal?.available===false,'Territory Admin without legal.view received legal context');
  await request('/api/admin/members/'+Number(memberA.id)+'/notes',{
    token:territoryToken,method:'POST',expected:201,
    body:{note:'CI Members V3 append-only coordination note'}
  });
  const addedTag=await request('/api/admin/members/'+Number(memberA.id)+'/tags',{
    token:territoryToken,method:'POST',
    body:{tag:'Pilot User'}
  });
  assert(addedTag.created===true&&addedTag.tag==='pilot user','Member tag was not normalized and created');
  const contextAfterNote=await request('/api/admin/members/'+Number(memberA.id),{token:territoryToken});
  assert((contextAfterNote.context?.internal?.notes||[]).some(x=>x.note_text==='CI Members V3 append-only coordination note'),'Internal member note missing after append');
  assert((contextAfterNote.context?.internal?.tags||[]).some(x=>x.tag==='pilot user'),'Internal member tag missing after add');
  const removedTag=await request('/api/admin/members/'+Number(memberA.id)+'/tags/'+encodeURIComponent('pilot user'),{token:territoryToken,method:'DELETE'});
  assert(removedTag.removed===true,'Internal member tag was not removed');
  assert((territoryMemberDetail.businesses||[]).some(x=>Number(x.business_id)===Number(memberBusiness.rows[0].id)&&x.membership_role==='owner'),'Member detail did not expose scoped business membership');
  assert(!(territoryMemberDetail.businesses||[]).some(x=>Object.prototype.hasOwnProperty.call(x,'balance')||Object.prototype.hasOwnProperty.call(x,'payment_credentials')),'Member detail leaked financial or payment data');
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
  assert(memberAuditCodes.has('member_internal_note_added')&&memberAuditCodes.has('member_tag_added')&&memberAuditCodes.has('member_tag_removed'),'Member notes/tags audit events missing');
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

  // Members V3 specialist: Member Directory + Support only. No Trust, Legal or internal notes.
  const memberSupportBoot=await request('/api/admin/bootstrap',{token:memberSupportSpecialistToken});
  assert(hasPermission(memberSupportBoot,'members.view')&&hasPermission(memberSupportBoot,'support.manage'),'Members V3 Support specialist permissions missing');
  assert(!hasPermission(memberSupportBoot,'incident.triage')&&!hasPermission(memberSupportBoot,'legal.view')&&!hasPermission(memberSupportBoot,'members.notes.manage'),'Members V3 Support specialist received sensitive extra authority');
  const memberSupportSummary=await request('/api/admin/members/summary',{token:memberSupportSpecialistToken});
  assert(memberSupportSummary.scope?.country_wide===false,'Member Directory Specialist summary escaped delegated territory');
  const memberSupportDetail=await request('/api/admin/members/'+Number(memberA.id),{token:memberSupportSpecialistToken});
  assert(memberSupportDetail.context?.support?.available===true,'Members V3 Support specialist cannot see allowed Support context');
  assert(memberSupportDetail.context?.safety?.available===false&&memberSupportDetail.context?.legal?.available===false&&memberSupportDetail.context?.internal?.available===false,'Members V3 Support specialist context isolation failed');
  await request('/api/admin/members/'+Number(memberA.id)+'/notes',{
    token:memberSupportSpecialistToken,method:'POST',expected:403,
    body:{note:'Must be denied'}
  });
  await request('/api/admin/members/'+Number(memberB.id),{token:memberSupportSpecialistToken,expected:404});

  // Members Hub V5: Profile Governance-only Specialist must not gain Member Directory access.
  const profileSpecialistBoot=await request('/api/admin/bootstrap',{token:profileSpecialistToken});
  assert(hasPermission(profileSpecialistBoot,'profiles.invite_merchant'),'Profile Governance Specialist invitation permission missing');
  assert(hasPermission(profileSpecialistBoot,'merchant.approve'),'Profile Governance Specialist review permission missing');
  assert(hasPermission(profileSpecialistBoot,'profile.suspend'),'Profile Governance Specialist authorization permission missing');
  assert(!hasPermission(profileSpecialistBoot,'members.view'),'Profile Governance Specialist gained Member Directory access through UI fusion');
  await request('/api/admin/overview',{token:profileSpecialistToken});
  await request('/api/governance/admin/invitations',{
    token:profileSpecialistToken,method:'POST',expected:201,
    body:{target_email:'ci-profile-hub-'+suffix+'@example.test',role:'merchant',territory_id:Number(t1.id),expires_days:2,note:'Members Hub governance-only acceptance'}
  });
  await request('/api/admin/members',{token:profileSpecialistToken,expected:403});
  await request('/api/admin/members/summary',{token:profileSpecialistToken,expected:403});
  await request('/api/admin/members/'+Number(memberA.id),{token:profileSpecialistToken,expected:403});

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
    members_business_membership:'PASS',
    members_controls_explicit_permission:'PASS',
    members_controls_audit:'PASS',
    members_self_protection:'PASS',
    members_support_context_gate:'PASS',
    members_safety_context_gate:'PASS',
    members_legal_context_sanitized:'PASS',
    members_internal_notes_tags:'PASS',
    members_notes_tags_audit:'PASS',
    members_support_specialist_isolation:'PASS',
    members_hub_governance_without_directory:'PASS',
    members_insights_platform_scope:'PASS',
    members_insights_country_scope:'PASS',
    members_insights_territory_isolation:'PASS',
    members_insights_governance_deny:'PASS',
    members_specialist_deny:'PASS'
  }));
}

main().catch(error=>{
  console.error(error.stack||error.message);
  process.exitCode=1;
}).finally(async()=>{await pool.end().catch(()=>{})});
