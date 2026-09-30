export async function runServiceProviderBaseLocationV1Acceptance({pool,base,secret,aliases,helpers}){
  const {requestJson,expectStatus,qaAccountSession,ensureActiveRole,runServiceProviderExperienceAcceptance}=helpers;

  const baseline=await runServiceProviderExperienceAcceptance({pool,base,secret,aliases,helpers});
  if(baseline.status!=='PASS')throw new Error('Service Provider base-location prerequisite did not pass.');

  const [provider,customer]=await Promise.all([
    qaAccountSession({pool,base,secret,email:aliases.serviceProvider,role:'service_provider',label:'Service base QA'}),
    qaAccountSession({pool,base,secret,email:aliases.customer,role:'customer',label:'Service base Customer QA'})
  ]);
  await ensureActiveRole({base,token:provider.token,role:'service_provider',label:'Service base QA'});
  await ensureActiveRole({base,token:customer.token,role:'customer',label:'Service base Customer QA'});

  const exact='QA Provider Workshop — Private Base Street';
  const radius=18.5;

  const privateSaved=await requestJson(base,'/api/service-provider/operating-location',{
    method:'PUT',token:provider.token,
    body:{use_override:true,location_label:'QA Workshop',exact_address:exact,visibility:'private',service_radius_km:radius}
  });
  expectStatus(privateSaved,200,'Service base private save');
  if(privateSaved.json?.operating_location?.exact_address!==exact)throw new Error('Provider could not read its own exact service base.');

  const privateMe=await requestJson(base,'/api/service-provider/me',{token:provider.token});
  expectStatus(privateMe,200,'Service base private profile');
  if(privateMe.json?.operating_location?.exact_address!==exact||Number(privateMe.json?.operating_location?.service_radius_km)!==radius){
    throw new Error('Private Provider base/radius did not persist.');
  }

  const customerPrivate=await requestJson(base,'/api/services/providers/'+provider.accountId,{token:customer.token});
  expectStatus(customerPrivate,200,'Service base customer private view');
  if(customerPrivate.json?.service_base_address||customerPrivate.json?.service_base_label){
    throw new Error('Private Provider service base leaked to Customer.');
  }
  if(Number(customerPrivate.json?.service_radius_km)!==radius){
    throw new Error('Public service radius disappeared while exact base remained private.');
  }

  const publicSaved=await requestJson(base,'/api/service-provider/operating-location',{
    method:'PUT',token:provider.token,
    body:{use_override:true,location_label:'QA Workshop',exact_address:exact,visibility:'public',service_radius_km:radius}
  });
  expectStatus(publicSaved,200,'Service base public opt-in save');

  const customerPublic=await requestJson(base,'/api/services/providers/'+provider.accountId,{token:customer.token});
  expectStatus(customerPublic,200,'Service base customer public view');
  if(customerPublic.json?.service_base_address!==exact||customerPublic.json?.service_base_label!=='QA Workshop'){
    throw new Error('Explicit public Provider service base was not visible on the public profile.');
  }

  const providerJobs=await requestJson(base,'/api/services/jobs/mine',{token:provider.token});
  expectStatus(providerJobs,200,'Service base provider jobs');
  const baselineJob=(providerJobs.json||[]).find(x=>Number(x.id)===Number(baseline.job_id));
  if(!baselineJob||baselineJob.service_location!==null||baselineJob.exact_location_available!==false){
    throw new Error('Service-base change weakened completed Customer job-address privacy.');
  }

  const reset=await requestJson(base,'/api/service-provider/operating-location',{
    method:'PUT',token:provider.token,
    body:{use_override:false,location_mode:'personal_default',service_radius_km:radius}
  });
  expectStatus(reset,200,'Service base reset');
  if(reset.json?.operating_location?.exact_address||reset.json?.operating_location?.visibility!=='private'){
    throw new Error('Reset to personal default retained a public exact service base.');
  }
  if(Number(reset.json?.operating_location?.service_radius_km)!==radius){
    throw new Error('Reset to personal default unexpectedly removed service radius.');
  }

  const customerAfterReset=await requestJson(base,'/api/services/providers/'+provider.accountId,{token:customer.token});
  expectStatus(customerAfterReset,200,'Service base customer after reset');
  if(customerAfterReset.json?.service_base_address||customerAfterReset.json?.service_base_label){
    throw new Error('Reset Provider profile still exposed an exact service base.');
  }

  await requestJson(base,'/api/auth/logout',{method:'POST',token:provider.token,body:{}});
  await requestJson(base,'/api/auth/logout',{method:'POST',token:customer.token,body:{}});

  return{
    status:'PASS',
    wave:'service_provider_base_location_v1',
    service_provider_account_id:provider.accountId,
    private_base_protected:true,
    public_opt_in_verified:true,
    public_radius_verified:true,
    customer_job_location_still_scoped:true,
    reset_to_personal_default:true,
    qa_revision:String(process.env.RAILWAY_GIT_COMMIT_SHA||process.env.GITHUB_SHA||'local').slice(0,12)
  };
}
