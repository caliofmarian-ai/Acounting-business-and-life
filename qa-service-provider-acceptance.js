const SERVICE_JOB_DESCRIPTION='Controlled QA Local Services handyman job v1';
const SERVICE_SUPPORT_PREFIX='Controlled QA Service Provider support job ';
const SERVICE_QUOTE_AMOUNT=350;
const SERVICE_FINAL_PRICE=375;
const QA_EVIDENCE_IMAGE='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlWhVQAAAAASUVORK5CYII=';
const SECONDARY_TERRITORY_CODE='QA-SERVICE-OTHER';

const clean=(value,max=300)=>String(value??'').trim().slice(0,max);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function latestServiceApplication(pool,accountId){
  const q=await pool.query(
    "SELECT * FROM profile_applications WHERE account_id=$1 AND role='service_provider' ORDER BY id DESC LIMIT 1",
    [Number(accountId)]
  );
  return q.rows[0]||null;
}

async function ensureServiceProviderApproved({
  pool,base,provider,adminToken,territoryId,categoryId,
  requestJson,expectStatus,ensureActiveRole
}){
  let application=await latestServiceApplication(pool,provider.accountId);

  if(!application){
    const started=await requestJson(base,'/api/governance/service-provider/start',{
      method:'POST',token:provider.token,body:{territory_id:territoryId}
    });
    expectStatus(started,201,'Local Services self-application start');
    application=started.json;
  }

  if(Number(application.territory_id)!==Number(territoryId)){
    throw new Error('Local Services application resolved the wrong QA territory.');
  }
  if(application.invitation_id){
    throw new Error('Local Services self-application unexpectedly requires an invitation.');
  }

  if(['application_started','requirements_pending','rejected'].includes(application.status)){
    const edited=await requestJson(base,'/api/governance/applications/'+Number(application.id),{
      method:'PUT',
      token:provider.token,
      body:{
        proposed_business_name:'Business & Life QA Handyman',
        applicant_note:'Controlled internal QA Local Services profile. Not a real provider.',
        responsibility_acknowledged:true,
        application_data:{
          test_fixture:true,
          professional_headline:'QA General Handyman',
          about:'Controlled QA profile used only for Local Services acceptance.',
          service_area:'QA Pilot City, Philippines',
          years_experience:3,
          requested_category_ids:[Number(categoryId)],
          onboarding_version:'service-provider-experience-v1'
        }
      }
    });
    expectStatus(edited,200,'Local Services application edit');

    const submitted=await requestJson(base,'/api/governance/applications/'+Number(application.id)+'/submit',{
      method:'POST',token:provider.token,body:{}
    });
    expectStatus(submitted,200,'Local Services application submit');
  }

  application=await latestServiceApplication(pool,provider.accountId);
  if(['submitted','under_review'].includes(application?.status)){
    const reviewed=await requestJson(base,'/api/governance/admin/applications/'+Number(application.id)+'/review',{
      method:'POST',
      token:adminToken,
      body:{
        decision:'approve',
        reason:'Controlled internal QA Local Services acceptance fixture',
        approved_category_ids:[Number(categoryId)]
      }
    });
    expectStatus(reviewed,200,'Local Services Admin approval');
  }

  application=await latestServiceApplication(pool,provider.accountId);
  if(application?.status!=='approved')throw new Error('Local Services application did not become approved.');

  const [profile,authorization,categoryAuthorization]=await Promise.all([
    pool.query("SELECT enabled,status,visibility FROM profiles WHERE account_id=$1 AND role='service_provider'",[provider.accountId]),
    pool.query("SELECT id,status FROM profile_authorizations WHERE account_id=$1 AND role='service_provider' AND territory_id=$2 ORDER BY id DESC LIMIT 1",[provider.accountId,territoryId]),
    pool.query("SELECT status FROM service_category_authorizations WHERE account_id=$1 AND category_id=$2 AND territory_id=$3",[provider.accountId,categoryId,territoryId])
  ]);
  if(!profile.rows[0]?.enabled||profile.rows[0]?.status!=='active')throw new Error('Service Provider profile did not become active.');
  if(authorization.rows[0]?.status!=='active')throw new Error('Service Provider authorization did not become active.');
  if(categoryAuthorization.rows[0]?.status!=='active')throw new Error('Handyman category authorization did not become active.');

  await ensureActiveRole({base,token:provider.token,role:'service_provider',label:'Service Provider Experience QA'});
  return{
    applicationId:Number(application.id),
    authorizationId:Number(authorization.rows[0]?.id||0),
    invitationRequired:false
  };
}

async function publishQaServiceProvider({
  base,providerToken,categoryId,requestJson,expectStatus
}){
  const saved=await requestJson(base,'/api/service-provider/me',{
    method:'PUT',
    token:providerToken,
    body:{
      display_name:'Business & Life QA Handyman',
      professional_headline:'General handyman — controlled QA',
      about:'Internal QA Local Services profile. Not a real public provider.',
      service_area:'QA Pilot City, Philippines',
      years_experience:3,
      languages:'English, Filipino',
      availability_text:'Controlled QA availability only',
      pricing_model:'quotation',
      price_from:300,
      price_to:500,
      same_day_available:false,
      public_reputation_enabled:true,
      cv_public_summary:'Controlled QA profile; no licence or credential claim.',
      visibility:'public'
    }
  });
  expectStatus(saved,200,'Service Provider profile publish');

  const services=await requestJson(base,'/api/service-provider/services',{
    method:'PUT',
    token:providerToken,
    body:{services:[{category_id:Number(categoryId),service_label:'General handyman'}]}
  });
  expectStatus(services,200,'Service Provider approved service selection');
  if(!(services.json?.services||[]).some(x=>Number(x.category_id)===Number(categoryId)&&x.active===true)){
    throw new Error('Approved handyman service did not persist.');
  }
}


async function ensureSecondaryServiceTerritory({pool,base,adminToken,requestJson,expectStatus}){
  const existing=await pool.query(
    "SELECT id,status FROM territories WHERE country_code='PH' AND code=$1 LIMIT 1",
    [SECONDARY_TERRITORY_CODE]
  );
  if(existing.rowCount){
    if(!['onboarding','active'].includes(existing.rows[0].status)){
      await pool.query("UPDATE territories SET status='active',updated_at=NOW() WHERE id=$1",[existing.rows[0].id]);
    }
    return Number(existing.rows[0].id);
  }
  const created=await requestJson(base,'/api/governance/admin/territories',{
    method:'POST',
    token:adminToken,
    body:{
      country_code:'PH',
      territory_type:'city',
      name:'QA Service Other City',
      code:SECONDARY_TERRITORY_CODE,
      status:'active'
    }
  });
  expectStatus(created,201,'Secondary QA territory creation');
  return Number(created.json?.id);
}

async function verifyCredentialAdminScope({
  pool,base,provider,customer,admin,territoryAdmin,territoryId,jobId,
  requestJson,expectStatus
}){
  const created=await requestJson(base,'/api/service-provider/credentials',{
    method:'POST',
    token:provider.token,
    body:{
      credential_type:'other',
      title:'Controlled QA evidence record',
      issuing_body:'Business & Life QA',
      reference_number:'QA-SERVICE-'+Number(jobId),
      evidence_data_url:QA_EVIDENCE_IMAGE
    }
  });
  expectStatus(created,201,'Service Provider controlled credential evidence');
  const credentialId=Number(created.json?.id);
  if(!credentialId)throw new Error('Controlled Service Provider credential was not created.');

  const ordinaryDenied=await requestJson(base,'/api/admin/service-credentials/'+credentialId,{
    method:'PATCH',
    token:customer.token,
    body:{verification_status:'verified'}
  });
  expectStatus(ordinaryDenied,403,'Ordinary Customer credential-review denial');

  const otherTerritoryId=await ensureSecondaryServiceTerritory({
    pool,base,adminToken:admin.token,requestJson,expectStatus
  });
  if(otherTerritoryId===Number(territoryId)){
    throw new Error('Credential scope test requires two distinct QA territories.');
  }

  await pool.query(
    "UPDATE platform_admin_assignments SET status='revoked',updated_at=NOW() WHERE account_id=$1 AND COALESCE(NULLIF(authority_rank,''),admin_role)='territory_admin'",
    [territoryAdmin.accountId]
  );

  const outside=await requestJson(base,'/api/admin/assignments',{
    method:'POST',
    token:admin.token,
    body:{
      target_email:territoryAdmin.email,
      admin_role:'territory_admin',
      territory_id:otherTerritoryId,
      permissions:['credential.verify'],
      reason:'Controlled QA out-of-scope credential authority'
    }
  });
  expectStatus(outside,201,'Out-of-scope Territory Admin assignment');

  const scopedDenied=await requestJson(base,'/api/admin/service-credentials/'+credentialId,{
    method:'PATCH',
    token:territoryAdmin.token,
    body:{verification_status:'verified'}
  });
  expectStatus(scopedDenied,403,'Out-of-scope credential-review denial');

  const inside=await requestJson(base,'/api/admin/assignments',{
    method:'POST',
    token:admin.token,
    body:{
      target_email:territoryAdmin.email,
      admin_role:'territory_admin',
      territory_id:Number(territoryId),
      permissions:['credential.verify'],
      reason:'Controlled QA in-scope credential authority'
    }
  });
  expectStatus(inside,201,'In-scope Territory Admin assignment');

  const verified=await requestJson(base,'/api/admin/service-credentials/'+credentialId,{
    method:'PATCH',
    token:territoryAdmin.token,
    body:{verification_status:'verified'}
  });
  expectStatus(verified,200,'In-scope credential verification');

  const evidence=await pool.query(
    "SELECT verification_status,verified_by_account_id,verified_at FROM profile_credentials WHERE id=$1",
    [credentialId]
  );
  if(evidence.rows[0]?.verification_status!=='verified'
    ||Number(evidence.rows[0]?.verified_by_account_id)!==Number(territoryAdmin.accountId)
    ||!evidence.rows[0]?.verified_at){
    throw new Error('Credential verifier/timestamp evidence did not persist.');
  }

  const audit=await pool.query(
    "SELECT id,assignment_id,permission_code,territory_id,actor_account_id FROM admin_audit_events WHERE event_code='service_credential.reviewed' AND target_type='profile_credential' AND target_id=$1 AND actor_account_id=$2 ORDER BY id DESC LIMIT 1",
    [String(credentialId),territoryAdmin.accountId]
  );
  if(!audit.rowCount||audit.rows[0].permission_code!=='credential.verify'
    ||Number(audit.rows[0].territory_id)!==Number(territoryId)
    ||!audit.rows[0].assignment_id){
    throw new Error('Credential verification audit evidence is incomplete.');
  }

  const cleanup=await requestJson(base,'/api/admin/service-credentials/'+credentialId,{
    method:'PATCH',
    token:territoryAdmin.token,
    body:{
      verification_status:'rejected',
      rejection_reason:'Controlled QA evidence cleanup; not a real professional credential.'
    }
  });
  expectStatus(cleanup,200,'Controlled credential cleanup');
  return{
    credentialId,
    auditId:Number(audit.rows[0].id),
    ordinaryDenied:true,
    outOfScopeDenied:true,
    inScopeAllowed:true
  };
}

async function serviceNotifications({
  base,customerToken,providerToken,jobId,requestJson,expectStatus
}){
  const providerRequired=['service.request_created','service.quote_accepted','service.status_changed'];
  const customerRequired=['service.quote_created','service.status_changed'];
  let providerRows=[],customerRows=[];
  for(let attempt=0;attempt<25;attempt++){
    const [provider,customer]=await Promise.all([
      requestJson(base,'/api/notifications?limit=150',{token:providerToken}),
      requestJson(base,'/api/notifications?limit=150',{token:customerToken})
    ]);
    expectStatus(provider,200,'Service Provider notification inbox');
    expectStatus(customer,200,'Local Services Customer notification inbox');
    providerRows=(Array.isArray(provider.json)?provider.json:[]).filter(
      x=>x.entity_type==='service_job'&&Number(x.entity_id)===Number(jobId)
    );
    customerRows=(Array.isArray(customer.json)?customer.json:[]).filter(
      x=>x.entity_type==='service_job'&&Number(x.entity_id)===Number(jobId)
    );
    const has=(rows,codes)=>codes.every(code=>rows.some(x=>x.event_code===code));
    if(has(providerRows,providerRequired)&&has(customerRows,customerRequired)){
      return{provider:providerRows.length,customer:customerRows.length};
    }
    await sleep(100);
  }
  for(const code of providerRequired){
    if(!providerRows.some(x=>x.event_code===code))throw new Error('Service Provider notification lifecycle is missing '+code+'.');
  }
  for(const code of customerRequired){
    if(!customerRows.some(x=>x.event_code===code))throw new Error('Local Services Customer notification lifecycle is missing '+code+'.');
  }
  return{provider:providerRows.length,customer:customerRows.length};
}

async function ensureServiceSupportTicket({
  pool,base,provider,jobId,requestJson,expectStatus
}){
  const subject=SERVICE_SUPPORT_PREFIX+Number(jobId);
  const existing=await pool.query(
    "SELECT id FROM support_tickets WHERE requester_account_id=$1 AND subject=$2 ORDER BY id DESC LIMIT 1",
    [provider.accountId,subject]
  );
  let ticketId=Number(existing.rows[0]?.id||0);
  if(!ticketId){
    const created=await requestJson(base,'/api/support/tickets',{
      method:'POST',
      token:provider.token,
      body:{
        category:'other',
        subject,
        description:'Controlled internal QA Local Services support request linked to a service job. No real issue.',
        requested_destination:'support',
        related_type:'service_job',
        related_id:Number(jobId),
        source_language:'en-PH'
      }
    });
    expectStatus(created,201,'Service Provider Support ticket create');
    ticketId=Number(created.json?.id);
  }
  if(!ticketId)throw new Error('Service Provider Support ticket was not created.');

  const detail=await requestJson(base,'/api/support/tickets/'+ticketId,{token:provider.token});
  expectStatus(detail,200,'Service Provider Support ticket detail');
  if(detail.json?.related_type!=='service_job'||Number(detail.json?.related_id)!==Number(jobId)){
    throw new Error('Service Provider Support ticket lost its service-job context.');
  }

  const mine=await requestJson(base,'/api/support/tickets/mine',{token:provider.token});
  expectStatus(mine,200,'Service Provider My Support');
  if(!(Array.isArray(mine.json)?mine.json:[]).some(x=>Number(x.id)===ticketId)){
    throw new Error('Service Provider Support ticket is missing from My Support.');
  }
  return ticketId;
}

async function ensureServiceReview({
  pool,base,customerToken,jobId,requestJson,expectStatus
}){
  const prior=await pool.query("SELECT id FROM service_reviews WHERE job_id=$1",[jobId]);
  if(prior.rowCount)return Number(prior.rows[0].id);
  const review=await requestJson(base,'/api/services/jobs/'+jobId+'/review',{
    method:'POST',
    token:customerToken,
    body:{
      workmanship:5,
      reliability:5,
      communication:5,
      professionalism:5,
      property_care:5,
      price_transparency:5,
      overall:5,
      review_text:'Controlled QA review for a completed Local Services job.'
    }
  });
  expectStatus(review,201,'Local Services verified review');
  return Number(review.json?.id||0);
}

export async function runServiceProviderExperienceAcceptance({
  pool,base,secret,aliases,helpers
}){
  const {
    requestJson,expectStatus,qaAccountSession,runCustomerOnboarding,
    ensureQaTerritory,ensureActiveRole,loginWithCredential
  }=helpers;

  const customerPrerequisite=await runCustomerOnboarding({pool,base,secret});
  if(customerPrerequisite.status!=='PASS')throw new Error('Customer prerequisite did not pass.');

  const [admin,provider,customer,territoryAdmin]=await Promise.all([
    qaAccountSession({pool,base,secret,email:aliases.superAdmin,role:'super_admin',label:'Service Provider Super Admin QA'}),
    qaAccountSession({pool,base,secret,email:aliases.serviceProvider,role:'service_provider',label:'Service Provider Experience QA'}),
    qaAccountSession({pool,base,secret,email:aliases.customer,role:'customer',label:'Local Services Customer QA'}),
    qaAccountSession({pool,base,secret,email:aliases.territoryAdmin,role:'territory_admin',label:'Service Provider Territory Admin QA'})
  ]);

  const territoryId=await ensureQaTerritory({pool,base,adminToken:admin.token});
  const category=await pool.query(
    "SELECT id,code,name,credential_gate FROM service_categories WHERE code='handyman' AND active=TRUE LIMIT 1"
  );
  if(!category.rowCount||category.rows[0].credential_gate===true){
    throw new Error('Non-credential-gated handyman category is unavailable.');
  }
  const categoryId=Number(category.rows[0].id);

  const governance=await ensureServiceProviderApproved({
    pool,base,provider,adminToken:admin.token,territoryId,categoryId,
    requestJson,expectStatus,ensureActiveRole
  });
  await ensureActiveRole({base,token:customer.token,role:'customer',label:'Local Services Customer QA'});

  await publishQaServiceProvider({
    base,providerToken:provider.token,categoryId,requestJson,expectStatus
  });

  const providers=await requestJson(base,'/api/services/providers?category=handyman',{token:customer.token});
  expectStatus(providers,200,'Customer Local Services discovery');
  if(!(Array.isArray(providers.json)?providers.json:[]).some(x=>Number(x.account_id)===provider.accountId)){
    throw new Error('Published QA Service Provider is missing from Customer discovery.');
  }

  const publicProfile=await requestJson(base,'/api/services/providers/'+provider.accountId,{token:customer.token});
  expectStatus(publicProfile,200,'Customer Service Provider public profile');
  if(!(publicProfile.json?.services||[]).some(x=>x.code==='handyman')){
    throw new Error('Public Service Provider profile is missing approved handyman service.');
  }
  if((publicProfile.json?.credentials||[]).some(x=>x.verification_status==='verified')){
    throw new Error('QA Service Provider unexpectedly exposes a verified credential.');
  }

  const created=await requestJson(base,'/api/services/jobs',{
    method:'POST',
    token:customer.token,
    body:{
      provider_account_id:provider.accountId,
      category_id:categoryId,
      service_label:'General handyman',
      description:SERVICE_JOB_DESCRIPTION,
      service_location:'Internal QA service location — Philippines',
      requested_window:'Controlled QA window'
    }
  });
  expectStatus(created,201,'Local Services Customer request');
  let job=created.json;
  const jobId=Number(job?.id);
  if(!jobId)throw new Error('Local Services QA job is missing.');

  if(['requested','provider_reviewing','quoted'].includes(job.status)&&job.status!=='quoted'){
    const quoted=await requestJson(base,'/api/service-provider/jobs/'+jobId+'/quote',{
      method:'POST',
      token:provider.token,
      body:{quote_amount:SERVICE_QUOTE_AMOUNT,quote_note:'Controlled QA quotation.'}
    });
    expectStatus(quoted,200,'Service Provider quote');
    job=quoted.json;
  }

  if(job.status==='quoted'){
    const accepted=await requestJson(base,'/api/services/jobs/'+jobId+'/accept-quote',{
      method:'POST',token:customer.token,body:{}
    });
    expectStatus(accepted,200,'Customer quote acceptance');
    job=accepted.json;
  }

  if(job.status==='accepted'){
    const scheduled=await requestJson(base,'/api/service-provider/jobs/'+jobId+'/status',{
      method:'POST',
      token:provider.token,
      body:{status:'scheduled',scheduled_at:new Date(Date.now()+60_000).toISOString()}
    });
    expectStatus(scheduled,200,'Service Provider schedule job');
    job=scheduled.json;
  }

  if(job.status==='scheduled'){
    const started=await requestJson(base,'/api/service-provider/jobs/'+jobId+'/status',{
      method:'POST',token:provider.token,body:{status:'in_progress'}
    });
    expectStatus(started,200,'Service Provider start job');
    job=started.json;
  }

  if(job.status==='in_progress'){
    const completed=await requestJson(base,'/api/service-provider/jobs/'+jobId+'/status',{
      method:'POST',
      token:provider.token,
      body:{status:'completed',final_price:SERVICE_FINAL_PRICE}
    });
    expectStatus(completed,200,'Service Provider complete job');
    job=completed.json;
  }

  if(job.status!=='completed')throw new Error('Local Services job did not reach completed state.');

  if(job.customer_confirmed_at){
    throw new Error('Fresh Local Services QA job was unexpectedly customer-confirmed before the Customer action.');
  }
  const prematureReview=await requestJson(base,'/api/services/jobs/'+jobId+'/review',{
    method:'POST',
    token:customer.token,
    body:{
      workmanship:5,reliability:5,communication:5,professionalism:5,
      property_care:5,price_transparency:5,overall:5,
      review_text:'This controlled QA review must be rejected before Customer confirmation.'
    }
  });
  expectStatus(prematureReview,409,'Premature Local Services review denial');

  if(!job.customer_confirmed_at){
    const confirmed=await requestJson(base,'/api/services/jobs/'+jobId+'/confirm-completion',{
      method:'POST',token:customer.token,body:{}
    });
    expectStatus(confirmed,200,'Customer Local Services completion confirmation');
    job=confirmed.json;
  }
  if(!job.customer_confirmed_at)throw new Error('Customer did not confirm Local Services completion.');

  const reviewId=await ensureServiceReview({
    pool,base,customerToken:customer.token,jobId,requestJson,expectStatus
  });
  if(!reviewId)throw new Error('Verified Local Services review was not created.');

  const credentialScope=await verifyCredentialAdminScope({
    pool,base,provider,customer,admin,territoryAdmin,territoryId,jobId,
    requestJson,expectStatus
  });

  const [customerJobs,providerJobs]=await Promise.all([
    requestJson(base,'/api/services/jobs/mine',{token:customer.token}),
    requestJson(base,'/api/services/jobs/mine',{token:provider.token})
  ]);
  expectStatus(customerJobs,200,'Customer Local Services history');
  expectStatus(providerJobs,200,'Service Provider job history');
  for(const result of [customerJobs,providerJobs]){
    const row=(Array.isArray(result.json)?result.json:[]).find(x=>Number(x.id)===jobId);
    if(row?.status!=='completed'||!row.customer_confirmed_at){
      throw new Error('Local Services completed job is missing from one participant history.');
    }
  }

  const finance=await requestJson(base,'/api/profile-money/service_provider',{token:provider.token});
  expectStatus(finance,200,'Service Provider Money');
  if(finance.json?.role!=='service_provider'
    ||Number(finance.json?.summary?.confirmed_completed_count||0)<1
    ||Number(finance.json?.summary?.confirmed_job_value||0)<SERVICE_FINAL_PRICE){
    throw new Error('Service Provider Money is missing confirmed commercial job value.');
  }

  const providerNet=await pool.query(
    "SELECT COUNT(*)::int n,COALESCE(SUM(amount) FILTER(WHERE settlement_status<>'reversed'),0) amount FROM payment_allocations WHERE component_code='service_provider_net' AND economic_party_id=$1",
    [String(provider.accountId)]
  );
  const providerNetCount=Number(providerNet.rows[0]?.n||0);
  if(Boolean(finance.json?.summary?.income?.tracked)!==(providerNetCount>0)){
    throw new Error('Service Provider Money income tracking does not match service_provider_net evidence.');
  }

  const settings=await requestJson(base,'/api/settings/finance',{token:provider.token});
  expectStatus(settings,200,'Service Provider Settings finance state');
  const settingsProfile=(settings.json?.profiles||[]).find(x=>x.role==='service_provider');
  if(settings.json?.active_role!=='service_provider'||!settingsProfile?.enabled||!settings.json?.account_money){
    throw new Error('Service Provider Settings lost profile or shared Money & Banking context.');
  }

  const entitlement=await pool.query(
    "SELECT * FROM service_monetization_entitlements WHERE country_code='PH' AND service_scope='local_services' AND subject_type='account' AND subject_id=$1",
    [provider.accountId]
  );
  if(Number(entitlement.rows[0]?.promo_duration_days)!==90){
    throw new Error('Local Services promotional entitlement is not 90 days.');
  }
  if(String(entitlement.rows[0]?.first_event_type)!=='service_job'){
    throw new Error('Local Services promotional entitlement did not start from the confirmed service job.');
  }

  const notificationEvidence=await serviceNotifications({
    base,
    customerToken:customer.token,
    providerToken:provider.token,
    jobId,
    requestJson,
    expectStatus
  });

  const supportTicketId=await ensureServiceSupportTicket({
    pool,base,provider,jobId,requestJson,expectStatus
  });

  const finalPublic=await requestJson(base,'/api/services/providers/'+provider.accountId,{token:customer.token});
  expectStatus(finalPublic,200,'Customer final Service Provider profile');
  if(Number(finalPublic.json?.review_count||0)<1||Number(finalPublic.json?.rating||0)!==5){
    throw new Error('Verified Local Services review did not appear in public reputation.');
  }

  const providerLogout=await requestJson(base,'/api/auth/logout',{method:'POST',token:provider.token,body:{}});
  expectStatus(providerLogout,200,'Service Provider Experience logout');
  const relogin=await loginWithCredential({
    base,email:aliases.serviceProvider,password:provider.password,label:'Service Provider Experience final re-login'
  });
  const finalLogout=await requestJson(base,'/api/auth/logout',{method:'POST',token:relogin,body:{}});
  expectStatus(finalLogout,200,'Service Provider Experience final logout');
  for(const [label,session] of [['Customer',customer],['Admin',admin],['Territory Admin',territoryAdmin]]){
    const logout=await requestJson(base,'/api/auth/logout',{method:'POST',token:session.token,body:{}});
    expectStatus(logout,200,'Service Provider Experience '+label+' logout');
  }

  return{
    status:'PASS',
    wave:'service_provider_experience_v1',
    account_role:'service_provider',
    application_id:governance.applicationId,
    authorization_id:governance.authorizationId,
    invitation_required:false,
    category:'handyman',
    credential_gate:false,
    public_profile:true,
    job_id:jobId,
    quote_amount:SERVICE_QUOTE_AMOUNT,
    final_price:SERVICE_FINAL_PRICE,
    customer_confirmed_completion:true,
    verified_review_id:reviewId,
    review_blocked_before_customer_confirmation:true,
    credential_scope_authority:true,
    credential_id:credentialScope.credentialId,
    credential_audit_id:credentialScope.auditId,
    credential_ordinary_user_denied:credentialScope.ordinaryDenied,
    credential_out_of_scope_denied:credentialScope.outOfScopeDenied,
    credential_in_scope_allowed:credentialScope.inScopeAllowed,
    finance_commercial_value:true,
    service_provider_net_allocations:providerNetCount,
    provider_income_settlement:providerNetCount>0?'TRACKED':'HOLD_NO_SERVICE_PROVIDER_NET',
    promotional_days:90,
    notification_lifecycle:true,
    notification_events:notificationEvidence,
    settings_context:true,
    support_ticket_id:supportTicketId,
    support:true,
    logout_relogin:true,
    online_service_payment:'HOLD_UNSUPPORTED_RUNTIME_FLOW',
    provider_payout_settlement:'HOLD_FOR_PROVIDER_EVIDENCE'
  };
}
