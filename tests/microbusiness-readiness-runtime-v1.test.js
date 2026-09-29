import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  MICROBUSINESS_READINESS_POLICY_VERSION,
  microbusinessReadinessEnforcementEnabled,
  microbusinessReadinessState,
  microbusinessCommerceDecision,
  nextMicrobusinessReadinessAction,
  updateMicrobusinessReadiness,
  setMicrobusinessCommerceState,
  requireMicrobusinessCommerceEligibility,
  filterCommerceEligibleServiceProviderIds
} from '../microbusiness-readiness-core.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

class ReadinessDb{
  constructor(){
    this.rows=[];
    this.events=[];
    this.nextId=1;
    this.startedProfiles=new Set(['1:merchant','1:service_provider']);
    this.memberships=new Set(['1:10']);
  }
  async query(sql,args=[]){
    const q=String(sql).replace(/\s+/g,' ').trim();
    if(q.startsWith('CREATE TABLE IF NOT EXISTS microbusiness_readiness'))return{rows:[],rowCount:0};
    if(q.startsWith('SELECT 1 FROM business_memberships')){
      const key=String(args[0])+':'+String(args[1]);
      return{rows:this.memberships.has(key)?[{ '?column?':1 }]:[],rowCount:this.memberships.has(key)?1:0};
    }
    if(q.startsWith('SELECT 1 FROM profiles p')){
      const key=String(args[0])+':'+String(args[1]);
      return{rows:this.startedProfiles.has(key)?[{ '?column?':1 }]:[],rowCount:this.startedProfiles.has(key)?1:0};
    }
    if(q.startsWith('SELECT * FROM microbusiness_readiness WHERE profile_role=$1 AND business_id=$2')){
      const row=this.rows.find(r=>r.profile_role===args[0]&&Number(r.business_id)===Number(args[1]));
      return{rows:row?[{...row}]:[],rowCount:row?1:0};
    }
    if(q.startsWith('SELECT * FROM microbusiness_readiness WHERE account_id=$1 AND profile_role=$2 AND business_id IS NULL')){
      const row=this.rows.find(r=>Number(r.account_id)===Number(args[0])&&r.profile_role===args[1]&&r.business_id==null);
      return{rows:row?[{...row}]:[],rowCount:row?1:0};
    }
    if(q.startsWith('INSERT INTO microbusiness_readiness(')){
      const [accountId,profileRole,businessId,activityTrack,operatingContext,readinessStage,source,policyVersion]=args;
      const duplicate=this.rows.find(r=>(
        businessId!=null
          ?r.profile_role===profileRole&&Number(r.business_id)===Number(businessId)
          :r.profile_role===profileRole&&Number(r.account_id)===Number(accountId)&&r.business_id==null
      ));
      if(duplicate)return{rows:[],rowCount:0};
      const row={
        id:this.nextId++,
        account_id:Number(accountId),
        profile_role:profileRole,
        business_id:businessId==null?null:Number(businessId),
        activity_track:activityTrack,
        operating_context:operatingContext,
        readiness_stage:readinessStage,
        commerce_state:'readiness_only',
        commerce_scope_json:{},
        eligibility_reviewed_at:null,
        eligibility_reviewed_by_account_id:null,
        eligibility_reason:'',
        source,
        policy_version:policyVersion,
        created_at:'2026-09-29T00:00:00.000Z',
        updated_at:'2026-09-29T00:00:00.000Z'
      };
      this.rows.push(row);
      return{rows:[{...row}],rowCount:1};
    }
    if(q.startsWith('UPDATE microbusiness_readiness SET activity_track=$1')){
      const row=this.rows.find(r=>Number(r.id)===Number(args[5]));
      Object.assign(row,{
        activity_track:args[0],
        operating_context:args[1],
        readiness_stage:args[2],
        source:args[3],
        policy_version:args[4],
        updated_at:'2026-09-29T00:01:00.000Z'
      });
      return{rows:[{...row}],rowCount:1};
    }
    if(q.startsWith('UPDATE microbusiness_readiness SET commerce_state=$1')){
      const row=this.rows.find(r=>Number(r.id)===Number(args[6]));
      Object.assign(row,{
        commerce_state:args[0],
        commerce_scope_json:JSON.parse(args[1]),
        eligibility_reviewed_at:'2026-09-29T00:02:00.000Z',
        eligibility_reviewed_by_account_id:Number(args[2]),
        eligibility_reason:args[3],
        readiness_stage:args[4],
        source:'governed_review',
        policy_version:args[5],
        updated_at:'2026-09-29T00:02:00.000Z'
      });
      return{rows:[{...row}],rowCount:1};
    }
    if(q.startsWith('INSERT INTO microbusiness_readiness_events')){
      this.events.push(args);
      return{rows:[{id:this.events.length}],rowCount:1};
    }
    if(q.startsWith('SELECT DISTINCT business_id FROM microbusiness_readiness')){
      const ids=new Set((args[0]||[]).map(Number));
      const rows=this.rows.filter(r=>ids.has(Number(r.business_id))&&r.profile_role==='merchant'&&['eligible_limited','eligible_full'].includes(r.commerce_state))
        .map(r=>({business_id:r.business_id}));
      return{rows,rowCount:rows.length};
    }
    if(q.startsWith('SELECT DISTINCT account_id FROM microbusiness_readiness')){
      const ids=new Set((args[0]||[]).map(Number));
      const rows=this.rows.filter(r=>ids.has(Number(r.account_id))&&r.profile_role==='service_provider'&&r.business_id==null&&['eligible_limited','eligible_full'].includes(r.commerce_state))
        .map(r=>({account_id:r.account_id}));
      return{rows,rowCount:rows.length};
    }
    throw new Error('Unexpected readiness test query: '+q);
  }
}

test('enforcement is opt-in and tolerant only while explicitly disabled',()=>{
  assert.equal(microbusinessReadinessEnforcementEnabled({}),false);
  assert.equal(microbusinessReadinessEnforcementEnabled({MICROBUSINESS_READINESS_ENFORCEMENT:'true'}),true);
  assert.equal(microbusinessReadinessEnforcementEnabled({MICROBUSINESS_READINESS_ENFORCEMENT:'1'}),true);
  assert.equal(microbusinessReadinessEnforcementEnabled({MICROBUSINESS_READINESS_ENFORCEMENT:'off'}),false);

  const missing=microbusinessReadinessState({profile_role:'merchant'});
  assert.equal(microbusinessCommerceDecision(missing,{enforcementEnabled:false}).allowed,true);
  assert.equal(microbusinessCommerceDecision(missing,{enforcementEnabled:true}).allowed,false);
  assert.equal(microbusinessCommerceDecision(missing,{enforcementEnabled:true}).reason,'readiness_state_missing');
});

test('readiness-only cannot transact when enforcement is on but governed eligibility can',()=>{
  const readiness=microbusinessReadinessState({
    id:1,account_id:1,profile_role:'merchant',business_id:10,
    activity_track:'food',operating_context:'private_property',
    readiness_stage:'getting_ready',commerce_state:'readiness_only',
    policy_version:MICROBUSINESS_READINESS_POLICY_VERSION
  });
  assert.equal(microbusinessCommerceDecision(readiness,{enforcementEnabled:true}).allowed,false);
  assert.equal(microbusinessCommerceDecision({...readiness,commerce_state:'eligible_limited'},{enforcementEnabled:true}).allowed,true);
  assert.equal(microbusinessCommerceDecision({...readiness,commerce_state:'eligible_full'},{enforcementEnabled:true}).allowed,true);
});

test('next action stays small and progressive',()=>{
  assert.equal(nextMicrobusinessReadinessAction({profile_role:'merchant'}),'choose_activity_track');
  assert.equal(nextMicrobusinessReadinessAction({profile_role:'merchant',activity_track:'food'}),'add_operating_context');
  assert.equal(nextMicrobusinessReadinessAction({profile_role:'merchant',activity_track:'food',operating_context:'home_based',readiness_stage:'building_records'}),'review_readiness_steps');
  assert.equal(nextMicrobusinessReadinessAction({profile_role:'merchant',activity_track:'food',operating_context:'home_based',readiness_stage:'applying'}),'track_application_progress');
});

test('normal user can save track/context/progress but cannot self-authorize commerce or verified stage',async()=>{
  const db=new ReadinessDb();
  const saved=await updateMicrobusinessReadiness(db,1,{
    profile_role:'merchant',
    business_id:10,
    activity_track:'food',
    operating_context:'home_based',
    readiness_stage:'getting_ready'
  });
  assert.equal(saved.activity_track,'food');
  assert.equal(saved.operating_context,'home_based');
  assert.equal(saved.commerce_state,'readiness_only');
  assert.equal(db.events.at(-1)[3],'readiness_self_service_updated');

  await assert.rejects(
    updateMicrobusinessReadiness(db,1,{profile_role:'merchant',business_id:10,commerce_state:'eligible_full'}),
    error=>error.status===403&&error.code==='COMMERCE_ELIGIBILITY_GOVERNED'
  );
  await assert.rejects(
    updateMicrobusinessReadiness(db,1,{profile_role:'merchant',business_id:10,readiness_stage:'verified'}),
    error=>error.status===403&&error.code==='READINESS_STAGE_GOVERNED'
  );
});

test('track ownership is role-specific and operating-context claims never grant eligibility',async()=>{
  const db=new ReadinessDb();
  await assert.rejects(
    updateMicrobusinessReadiness(db,1,{profile_role:'merchant',business_id:10,activity_track:'local_services'}),
    /Merchant readiness track must be Food or Non-food/
  );
  const svc=await updateMicrobusinessReadiness(db,1,{
    profile_role:'service_provider',
    activity_track:'local_services',
    operating_context:'customer_locations',
    readiness_stage:'building_records'
  });
  assert.equal(svc.commerce_state,'readiness_only');
  assert.equal(svc.profile_role,'service_provider');
  assert.equal(svc.business_id,null);
});

test('governed review is the only core path that grants commerce eligibility',async()=>{
  const db=new ReadinessDb();
  await updateMicrobusinessReadiness(db,1,{
    profile_role:'merchant',business_id:10,activity_track:'non_food',
    operating_context:'commercial_space',readiness_stage:'applying'
  });
  const reviewed=await setMicrobusinessCommerceState(db,{
    accountId:1,profileRole:'merchant',businessId:10,actorAccountId:99,
    commerceState:'eligible_limited',reason:'Evidence reviewed for limited pilot scope',
    commerceScope:{territory:'queens-row-west',mode:'pilot'}
  });
  assert.equal(reviewed.commerce_state,'eligible_limited');
  assert.equal(reviewed.readiness_stage,'verified');
  assert.equal(reviewed.eligibility_reviewed_by_account_id,99);
  assert.equal(db.events.at(-1)[3],'commerce_eligibility_reviewed');

  const decision=await requireMicrobusinessCommerceEligibility(db,{
    profileRole:'merchant',businessId:10,enforcementEnabled:true
  });
  assert.equal(decision.allowed,true);
});

test('commerce requirement fails closed when enforcement is on and state is missing',async()=>{
  const db=new ReadinessDb();
  await assert.rejects(
    requireMicrobusinessCommerceEligibility(db,{profileRole:'merchant',businessId:10,enforcementEnabled:true}),
    error=>error.status===409&&error.code==='MICROBUSINESS_READINESS_REQUIRED'&&error.decision.reason==='readiness_state_missing'
  );
});

test('schema and integration contract preserve separate authorization and no tax-collector claims',()=>{
  const core=read('microbusiness-readiness-core.js');
  assert.match(core,/CREATE TABLE IF NOT EXISTS microbusiness_readiness/);
  assert.match(core,/CREATE TABLE IF NOT EXISTS microbusiness_readiness_events/);
  assert.match(core,/commerce_state TEXT NOT NULL DEFAULT 'readiness_only'/);
  assert.match(core,/Commerce eligibility can only be changed through a governed review/);
  assert.match(core,/Verified and Growing stages require governed evidence/);
  assert.doesNotMatch(core,/collect(?:s|ing)? government (?:tax|fee)/i);
});


test('Auth API exposes private readiness state without creating a second onboarding engine',()=>{
  const auth=read('server-auth.js');
  assert.match(auth,/ensureMicrobusinessReadinessSchema\(pool\)/);
  assert.match(auth,/app\.get\('\/api\/onboarding\/readiness'/);
  assert.match(auth,/app\.put\('\/api\/onboarding\/readiness'/);
  assert.match(auth,/verifyOwnership:true/);
  assert.match(auth,/source:'user_readiness_api'/);
  assert.doesNotMatch(auth,/UPDATE profiles SET enabled=TRUE[^\n]*readiness/i);
});

test('Merchant public discovery publication and checkout consume readiness capability while private tools remain available',()=>{
  const market=read('server-marketplace.js');
  assert.match(market,/filterCommerceEligibleBusinessIds\(pool,rows\.map\(row=>row\.business_id\)\)/);
  assert.match(market,/action:'publish the Merchant storefront'/);
  assert.match(market,/action:'accept a public marketplace order'/);
  assert.match(market,/microbusinessReadinessSnapshot\(pool,\{accountId:me\.account\.id,profileRole:'merchant',businessId:business\.id\}\)/);
  assert.match(market,/products:await products\(business\.id,true\)/);
  assert.match(market,/if\(!includePrivate\)\{/);
});


test('Merchant readiness UI is profile-local and does not claim government authorization',()=>{
  const ui=read('public/marketplace-ui.js');
  assert.match(ui,/function merchantReadinessForm\(s\)/);
  assert.match(ui,/BUSINESS READINESS/);
  assert.match(ui,/Business & Life platform eligibility is not a government permit, tax registration or professional licence/);
  assert.match(ui,/\/api\/onboarding\/readiness/);
  assert.match(ui,/Verified and Growing are governed stages and cannot be self-declared/);
  assert.match(ui,/authorized_sidewalk/);
  assert.match(ui,/Public marketplace publication and new orders stay locked/);
});


test('Local Services discovery filter is permissive only with enforcement off and eligible-only when on',async()=>{
  const db=new ReadinessDb();
  assert.deepEqual([...await filterCommerceEligibleServiceProviderIds(db,[1,2],{enforcementEnabled:false})],[1,2]);
  await updateMicrobusinessReadiness(db,1,{
    profile_role:'service_provider',
    activity_track:'local_services',
    operating_context:'customer_locations',
    readiness_stage:'applying'
  });
  let gated=await filterCommerceEligibleServiceProviderIds(db,[1],{enforcementEnabled:true});
  assert.equal(gated.size,0);
  await setMicrobusinessCommerceState(db,{
    accountId:1,profileRole:'service_provider',actorAccountId:99,
    commerceState:'eligible_full',reason:'Local Services pilot evidence reviewed'
  });
  gated=await filterCommerceEligibleServiceProviderIds(db,[1],{enforcementEnabled:true});
  assert.deepEqual([...gated],[1]);
});

test('Local Services public discovery visibility and new-request flow consume readiness while private workspace remains available',()=>{
  const services=read('server-services.js');
  assert.match(services,/ensureMicrobusinessReadinessSchema\(pool\)/);
  assert.match(services,/filterCommerceEligibleServiceProviderIds\(pool,\[accountId\]\)/);
  assert.match(services,/filterCommerceEligibleServiceProviderIds\(pool,rows\.map\(row=>row\.account_id\)\)/);
  assert.match(services,/action:'make the Local Services profile public'/);
  assert.match(services,/app\.post\('\/api\/services\/jobs'/);
  assert.match(services,/const provider=await publicProvider\(providerId\)/);
  assert.match(services,/microbusinessReadinessSnapshot\(pool,\{accountId,profileRole:'service_provider'\}\)/);
  assert.match(services,/detail_mode:'home'[^\n]*readiness/);
  assert.match(services,/cv_private_evidence_object_id/,'#623 private evidence integration must remain intact');
  assert.match(services,/storePrivateEvidence/,'#623 private evidence storage must remain intact');
});

test('Local Services readiness UI stays non-authoritative and keeps governed stages out of self-service',()=>{
  const ui=read('public/services-ui.js');
  assert.match(ui,/function serviceReadinessPanel\(data\)/);
  assert.match(ui,/BUSINESS READINESS/);
  assert.match(ui,/Business & Life eligibility is not a government or professional licence/);
  assert.match(ui,/profile_role:'service_provider'/);
  assert.match(ui,/activity_track:'local_services'/);
  assert.match(ui,/Verified and Growing require governed evidence and cannot be self-declared/);
  assert.match(ui,/Public visibility and new customer requests stay locked until governed review is complete/);
});


test('governed Admin review endpoint remains separate from profile authorization',()=>{
  const governance=read('server-profile-governance.js');
  assert.match(governance,/app\.post\('\/api\/governance\/admin\/readiness\/:accountId\/:role\/review'/);
  assert.match(governance,/const me=await requireAdmin\(req\)/);
  assert.match(governance,/const authorization=await activeAuthorization\(accountId,role\)/);
  assert.match(governance,/Active platform profile authorization is required before commerce eligibility can be granted/);
  assert.match(governance,/Complete the activity track and operating context before commerce eligibility review/);
  assert.match(governance,/profile_authorization_separate:true/);
  assert.match(governance,/setMicrobusinessCommerceState\(pool/);
  assert.doesNotMatch(governance,/application_approve[^\n]{0,500}setMicrobusinessCommerceState/);
});
