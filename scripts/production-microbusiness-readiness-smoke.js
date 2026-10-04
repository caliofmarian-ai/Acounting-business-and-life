import pg from 'pg';
import {
  ensureMicrobusinessReadinessSchema,
  microbusinessReadinessEnforcementMode,
  microbusinessReadinessReviewRequirements,
  updateMicrobusinessReadiness,
  setMicrobusinessCommerceState,
  filterCommerceEligibleBusinessIds,
  filterCommerceEligibleServiceProviderIds,
  requireMicrobusinessCommerceEligibility
} from '../microbusiness-readiness-core.js';

const {Pool}=pg;
const fail=message=>{throw new Error(message)};
function evidenceFor(state){
  return microbusinessReadinessReviewRequirements(state).map(item=>({
    code:item.code,
    outcome:'verified',
    reference:'production-smoke:'+item.code,
    source_authority:'Business & Life production smoke fixture — transaction rolled back',
    note:'Temporary company_test verification inside rollback-only Production smoke.'
  }));
}


async function createTemporaryCompanyTestFixture(client){
  const suffix=String(Date.now())+'-'+String(process.pid);
  const createAccount=async(role,label)=>{
    const q=await client.query(
      `INSERT INTO accounts(
         display_name,email,account_mode,test_role,email_verified_at,auth_status
       ) VALUES($1,$2,'company_test',$3,NOW(),'active')
       RETURNING id`,
      [label,`production-smoke-${role}-${suffix}@business-life.invalid`,role]
    );
    const accountId=Number(q.rows[0]?.id);
    if(!Number.isInteger(accountId)||accountId<1)fail('Could not create temporary '+role+' company_test account.');
    await client.query(
      `INSERT INTO profiles(account_id,role,enabled,visibility,status)
       VALUES($1,$2,TRUE,'private','active')`,
      [accountId,role]
    );
    return accountId;
  };

  const merchantAccountId=await createAccount('merchant','Production Smoke Merchant');
  const businessQ=await client.query(
    `INSERT INTO businesses(name,country_code,currency_code)
     VALUES('Production Smoke Merchant','PH','PHP')
     RETURNING id`
  );
  const businessId=Number(businessQ.rows[0]?.id);
  if(!Number.isInteger(businessId)||businessId<1)fail('Could not create temporary Merchant business.');
  await client.query(
    `INSERT INTO business_memberships(business_id,account_id,membership_role,active)
     VALUES($1,$2,'owner',TRUE)`,
    [businessId,merchantAccountId]
  );
  await client.query(
    `INSERT INTO merchant_storefronts(
       business_id,store_name,merchant_domain,publication_status,presence_type,
       public_location_enabled,opening_status,pickup_enabled,delivery_enabled,
       cash_enabled,online_enabled,public_reputation_enabled,price_comparison_enabled
     ) VALUES($1,'Production Smoke Store','non_food','published','online',
       FALSE,'open',TRUE,FALSE,TRUE,FALSE,FALSE,FALSE)`,
    [businessId]
  );

  const providerAccountId=await createAccount('service_provider','Production Smoke Local Services');
  await client.query(
    `INSERT INTO service_provider_profiles(account_id,display_name)
     VALUES($1,'Production Smoke Local Services')`,
    [providerAccountId]
  );
  await client.query(
    `UPDATE profiles SET visibility='public',updated_at=NOW()
      WHERE account_id=$1 AND role='service_provider'`,
    [providerAccountId]
  );

  return{
    merchant:{accountId:merchantAccountId,businessId},
    provider:{accountId:providerAccountId}
  };
}

async function ensureTestAuthorization(client,{accountId,role}){
  await client.query(
    `INSERT INTO profile_authorizations(
       account_id,role,territory_id,application_id,status,
       approved_by_account_id,approved_at,expires_at,reason
     ) VALUES($1,$2,NULL,NULL,'active',$1,NOW(),NULL,'Rollback-only Production readiness smoke')
     ON CONFLICT(account_id,role,COALESCE(territory_id,0))
     DO UPDATE SET status='active',approved_by_account_id=EXCLUDED.approved_by_account_id,
       approved_at=NOW(),expires_at=NULL,reason=EXCLUDED.reason,updated_at=NOW()`,
    [accountId,role]
  );
}

async function expectBlocked(promise,label){
  try{
    await promise;
  }catch(error){
    if(error?.code==='MICROBUSINESS_READINESS_REQUIRED')return true;
    throw new Error(label+' failed with unexpected error: '+String(error?.message||error));
  }
  throw new Error(label+' unexpectedly allowed readiness-only commerce');
}

async function expectIncompleteEligibility(promise,label){
  try{
    await promise;
  }catch(error){
    if(
      error?.code==='READINESS_EVIDENCE_INCOMPLETE'
      &&Number(error?.review_status?.total)===6
      &&Number(error?.review_status?.resolved)===0
    )return true;
    throw new Error(label+' failed with unexpected error: '+String(error?.message||error));
  }
  throw new Error(label+' unexpectedly granted commerce with 0/6 evidence.');
}

async function run(){
  if(process.env.RAILWAY_ENVIRONMENT_NAME!=='production')fail('Production readiness smoke requires Railway production environment.');
  if(process.env.NODE_ENV!=='production')fail('Production readiness smoke requires NODE_ENV=production.');
  if(microbusinessReadinessEnforcementMode(process.env)!=='transition')fail('Production readiness smoke requires transition enforcement mode.');
  const cutoff=String(process.env.MICROBUSINESS_READINESS_TRANSITION_CUTOFF||'').trim();
  if(!cutoff||!Number.isFinite(new Date(cutoff).getTime()))fail('Production readiness smoke requires a valid transition cutoff.');
  if(!process.env.DATABASE_URL)fail('DATABASE_URL is required.');

  const pool=new Pool({
    connectionString:process.env.DATABASE_URL,
    ssl:process.env.DATABASE_URL?{rejectUnauthorized:false}:undefined
  });
  const client=await pool.connect();
  let began=false;
  try{
    await client.query('BEGIN');
    began=true;
    await ensureMicrobusinessReadinessSchema(client);

    const fixture=await createTemporaryCompanyTestFixture(client);
    const merchant=fixture.merchant;
    await ensureTestAuthorization(client,{accountId:merchant.accountId,role:'merchant'});
    await client.query(
      "UPDATE merchant_storefronts SET publication_status='published',updated_at=NOW() WHERE business_id=$1",
      [merchant.businessId]
    );
    const merchantState=await updateMicrobusinessReadiness(client,merchant.accountId,{
      profile_role:'merchant',
      business_id:merchant.businessId,
      activity_track:'non_food',
      operating_context:'commercial_space',
      readiness_stage:'applying',
      source:'production_smoke_rollback'
    });
    await setMicrobusinessCommerceState(client,{
      accountId:merchant.accountId,
      profileRole:'merchant',
      businessId:merchant.businessId,
      actorAccountId:merchant.accountId,
      commerceState:'readiness_only',
      reason:'Rollback-only Production smoke reset'
    });

    const merchantBlockedSet=await filterCommerceEligibleBusinessIds(client,[merchant.businessId],{env:process.env});
    if(merchantBlockedSet.has(merchant.businessId))fail('Merchant readiness-only subject was not blocked in transition mode.');
    await expectBlocked(
      requireMicrobusinessCommerceEligibility(client,{
        accountId:merchant.accountId,
        profileRole:'merchant',
        businessId:merchant.businessId,
        action:'production smoke Merchant public commerce',
        env:process.env
      }),
      'Merchant readiness gate'
    );
    await expectIncompleteEligibility(
      setMicrobusinessCommerceState(client,{
        accountId:merchant.accountId,
        profileRole:'merchant',
        businessId:merchant.businessId,
        actorAccountId:merchant.accountId,
        commerceState:'eligible_full',
        reason:'Rollback-only Production smoke incomplete evidence denial',
        evidenceChecklist:[]
      }),
      'Merchant 0/6 evidence gate'
    );

    await setMicrobusinessCommerceState(client,{
      accountId:merchant.accountId,
      profileRole:'merchant',
      businessId:merchant.businessId,
      actorAccountId:merchant.accountId,
      commerceState:'eligible_full',
      reason:'Rollback-only Production smoke governed evidence grant',
      evidenceChecklist:evidenceFor(merchantState)
    });
    const merchantAllowedSet=await filterCommerceEligibleBusinessIds(client,[merchant.businessId],{env:process.env});
    if(!merchantAllowedSet.has(merchant.businessId))fail('Merchant eligible_full subject was not allowed.');
    const merchantAllowed=await requireMicrobusinessCommerceEligibility(client,{
      accountId:merchant.accountId,
      profileRole:'merchant',
      businessId:merchant.businessId,
      action:'production smoke Merchant public commerce',
      env:process.env
    });
    if(!merchantAllowed.allowed)fail('Merchant eligible_full requirement did not allow commerce.');

    const provider=fixture.provider;
    await ensureTestAuthorization(client,{accountId:provider.accountId,role:'service_provider'});
    await client.query(
      "UPDATE profiles SET enabled=TRUE,status='active',visibility='public',updated_at=NOW() WHERE account_id=$1 AND role='service_provider'",
      [provider.accountId]
    );
    const providerState=await updateMicrobusinessReadiness(client,provider.accountId,{
      profile_role:'service_provider',
      activity_track:'local_services',
      operating_context:'customer_locations',
      readiness_stage:'applying',
      source:'production_smoke_rollback'
    });
    await setMicrobusinessCommerceState(client,{
      accountId:provider.accountId,
      profileRole:'service_provider',
      actorAccountId:provider.accountId,
      commerceState:'readiness_only',
      reason:'Rollback-only Production smoke reset'
    });

    const providerBlockedSet=await filterCommerceEligibleServiceProviderIds(client,[provider.accountId],{env:process.env});
    if(providerBlockedSet.has(provider.accountId))fail('Local Services readiness-only subject was not blocked in transition mode.');
    await expectBlocked(
      requireMicrobusinessCommerceEligibility(client,{
        accountId:provider.accountId,
        profileRole:'service_provider',
        action:'production smoke Local Services public commerce',
        env:process.env
      }),
      'Local Services readiness gate'
    );

    await setMicrobusinessCommerceState(client,{
      accountId:provider.accountId,
      profileRole:'service_provider',
      actorAccountId:provider.accountId,
      commerceState:'eligible_full',
      reason:'Rollback-only Production smoke governed evidence grant',
      evidenceChecklist:evidenceFor(providerState)
    });
    const providerAllowedSet=await filterCommerceEligibleServiceProviderIds(client,[provider.accountId],{env:process.env});
    if(!providerAllowedSet.has(provider.accountId))fail('Local Services eligible_full subject was not allowed.');
    const providerAllowed=await requireMicrobusinessCommerceEligibility(client,{
      accountId:provider.accountId,
      profileRole:'service_provider',
      action:'production smoke Local Services public commerce',
      env:process.env
    });
    if(!providerAllowed.allowed)fail('Local Services eligible_full requirement did not allow commerce.');

    await client.query('ROLLBACK');
    began=false;
    console.log('PRODUCTION_READINESS_SMOKE_RESULT '+JSON.stringify({
      status:'PASS',
      environment:'production',
      enforcement_mode:'transition',
      rollback:true,
      merchant_readiness_only_blocked:true,
      merchant_zero_of_six_grant_blocked:true,
      merchant_evidence_review_unlock:true,
      local_services_readiness_only_blocked:true,
      local_services_evidence_review_unlock:true,
      real_money:false
    }));
  }catch(error){
    if(began)await client.query('ROLLBACK').catch(()=>{});
    console.error('PRODUCTION_READINESS_SMOKE_RESULT '+JSON.stringify({
      status:'FAIL',
      rollback:true,
      error:String(error?.message||error).slice(0,500)
    }));
    process.exitCode=1;
  }finally{
    client.release();
    await pool.end();
  }
}

await run();
