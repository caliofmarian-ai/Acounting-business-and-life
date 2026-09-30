import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MICROBUSINESS_READINESS_POLICY_VERSION,
  microbusinessReadinessReviewRequirements,
  validateMicrobusinessEligibilityEvidence,
  microbusinessReadinessEnforcementMode,
  microbusinessReadinessEnforcementEnabled
} from '../microbusiness-readiness-core.js';

const verifiedChecklist=state=>microbusinessReadinessReviewRequirements(state).map(item=>({
  code:item.code,
  outcome:'verified',
  reference:'fixture:'+item.code,
  source_authority:item.code.includes('activity_')||item.code.includes('operating_')
    ?'Business & Life canonical profile/location record'
    :'Official/current authority or governed platform evidence',
  note:'Deterministic policy fixture'
}));

test('V2 policy exposes explicit review criteria by activity track',()=>{
  assert.equal(MICROBUSINESS_READINESS_POLICY_VERSION,'ph-microbusiness-readiness-v2');
  const food=microbusinessReadinessReviewRequirements({
    profile_role:'merchant',activity_track:'food',operating_context:'home_based'
  }).map(x=>x.code);
  assert.deepEqual(food,[
    'activity_scope_confirmed','operating_context_confirmed',
    'business_registration_requirements','tax_record_requirements',
    'location_permission_requirements','food_safety_requirements'
  ]);

  const nonFood=microbusinessReadinessReviewRequirements({
    profile_role:'merchant',activity_track:'non_food',operating_context:'commercial_space'
  }).map(x=>x.code);
  assert.ok(nonFood.includes('regulated_goods_requirements'));
  assert.ok(!nonFood.includes('food_safety_requirements'));

  const services=microbusinessReadinessReviewRequirements({
    profile_role:'service_provider',activity_track:'local_services',operating_context:'customer_locations'
  }).map(x=>x.code);
  assert.ok(services.includes('service_category_requirements'));
  assert.ok(services.includes('professional_licence_requirements'));
});

test('policy refuses eligibility when track or operating context is incomplete',()=>{
  assert.deepEqual(microbusinessReadinessReviewRequirements({
    profile_role:'merchant',activity_track:'food',operating_context:''
  }),[]);
  assert.throws(
    ()=>validateMicrobusinessEligibilityEvidence({
      profile_role:'merchant',activity_track:'food',operating_context:''
    },[]),
    error=>error.code==='READINESS_CONTEXT_REQUIRED'
  );
});

test('every required review item must be resolved',()=>{
  const state={profile_role:'merchant',activity_track:'food',operating_context:'home_based'};
  const all=verifiedChecklist(state);
  assert.equal(validateMicrobusinessEligibilityEvidence(state,all).length,6);
  assert.throws(
    ()=>validateMicrobusinessEligibilityEvidence(state,all.slice(0,-1)),
    error=>error.code==='READINESS_EVIDENCE_INCOMPLETE'&&error.missing.includes('food_safety_requirements')
  );
});

test('verified decisions require both evidence reference and source authority',()=>{
  const state={profile_role:'merchant',activity_track:'non_food',operating_context:'commercial_space'};
  const list=verifiedChecklist(state);
  const noRef=list.map(x=>x.code==='regulated_goods_requirements'?{...x,reference:''}:x);
  assert.throws(
    ()=>validateMicrobusinessEligibilityEvidence(state,noRef),
    error=>error.code==='READINESS_EVIDENCE_REFERENCE_REQUIRED'
  );
  const noSource=list.map(x=>x.code==='regulated_goods_requirements'?{...x,source_authority:''}:x);
  assert.throws(
    ()=>validateMicrobusinessEligibilityEvidence(state,noSource),
    error=>error.code==='READINESS_EVIDENCE_SOURCE_REQUIRED'
  );
});

test('not-applicable is allowed only for policy-resolvable legal requirements and needs source plus reason',()=>{
  const state={profile_role:'service_provider',activity_track:'local_services',operating_context:'customer_locations'};
  const list=verifiedChecklist(state);
  const licenceIndex=list.findIndex(x=>x.code==='professional_licence_requirements');
  list[licenceIndex]={
    code:'professional_licence_requirements',
    outcome:'not_applicable',
    reference:'',
    source_authority:'Current task-specific official source review',
    note:'The exact approved service task is not regulated under the reviewed source.'
  };
  assert.doesNotThrow(()=>validateMicrobusinessEligibilityEvidence(state,list));

  const categoryIndex=list.findIndex(x=>x.code==='service_category_requirements');
  list[categoryIndex]={
    code:'service_category_requirements',
    outcome:'not_applicable',
    reference:'',
    source_authority:'Business & Life category governance',
    note:'Attempted bypass'
  };
  assert.throws(
    ()=>validateMicrobusinessEligibilityEvidence(state,list),
    error=>error.code==='READINESS_EVIDENCE_NOT_APPLICABLE_DENIED'
  );
});

test('transition is an enforcement mode, not an off state',()=>{
  assert.equal(microbusinessReadinessEnforcementMode({MICROBUSINESS_READINESS_ENFORCEMENT:'transition'}),'transition');
  assert.equal(microbusinessReadinessEnforcementEnabled({MICROBUSINESS_READINESS_ENFORCEMENT:'transition'}),true);
  assert.equal(microbusinessReadinessEnforcementMode({MICROBUSINESS_READINESS_ENFORCEMENT:'full'}),'full');
  assert.equal(microbusinessReadinessEnforcementMode({MICROBUSINESS_READINESS_ENFORCEMENT:'off'}),'off');
});
