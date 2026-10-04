import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  COURIER_ELIGIBILITY_POLICY_VERSION,
  courierEligibilityAssessment,
  courierEligibilityError,
  courierEligibilityProfileView
} from '../courier-eligibility-core.js';

const nowMs=Date.parse('2026-10-04T12:00:00.000Z');
const completeProfile=Object.freeze({
  account_id:9,
  eligibility_status:'approved',
  approved_vehicle_class:'motorbike',
  eligibility_expires_at:'2027-10-04T12:00:00.000Z',
  approval_note:'Vehicle evidence and operating boundary reviewed.',
  eligibility_reviewed_by_account_id:1,
  eligibility_reviewed_at:'2026-10-04T11:30:00.000Z',
  eligibility_policy_version:COURIER_ELIGIBILITY_POLICY_VERSION,
  vehicle_type:'motorcycle',
  max_weight_kg:20,
  max_volume_l:80,
  service_radius_km:12,
  operating_psgc_code:'0402103028',
  operating_area_name:'Queens Row West',
  operating_area_source_version:'2026-Q3',
  available:true
});
const completeDocument=Object.freeze({
  id:17,
  account_id:9,
  document_type:'vehicle_attestation',
  vehicle_class:'motorcycle',
  issue_date:'2026-01-01',
  private_evidence_object_id:22,
  verification_status:'verified',
  verified_by_account_id:1,
  verified_at:'2026-10-04T11:25:00.000Z',
  expiry_date:'2027-10-04'
});
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('complete evidence-backed Courier is eligible and canonicalizes the vehicle',()=>{
  const result=courierEligibilityAssessment(completeProfile,[completeDocument],{nowMs});
  assert.equal(result.prerequisites_met,true);
  assert.equal(result.can_approve,true);
  assert.equal(result.eligible,true);
  assert.equal(result.available,true);
  assert.equal(result.effective_status,'approved');
  assert.equal(result.approved_vehicle_class,'motorcycle');
  assert.deepEqual(result.missing_requirements,[]);
});

test('company-test eligibility stays visibly non-commercial',()=>{
  const result=courierEligibilityAssessment({...completeProfile,account_mode:'company_test'},[completeDocument],{nowMs});
  assert.equal(result.eligible,true);
  assert.equal(result.non_commercial,true);
  assert.equal(result.commercial_use_allowed,false);
});

test('Super Admin self-test marker remains non-commercial outside company-test accounts',()=>{
  const result=courierEligibilityAssessment({
    ...completeProfile,account_mode:'personal',non_commercial_test_only:true
  },[completeDocument],{nowMs});
  assert.equal(result.eligible,true);
  assert.equal(result.non_commercial,true);
  assert.equal(result.commercial_use_allowed,false);
});

test('Approved without vehicle evidence review and operating area fails closed to pending',()=>{
  const result=courierEligibilityAssessment({
    eligibility_status:'approved',available:true,approval_note:'Legacy self-test bypass'
  },[],{nowMs});
  assert.equal(result.eligible,false);
  assert.equal(result.available,false);
  assert.equal(result.effective_status,'pending');
  for(const code of [
    'APPROVED_VEHICLE','VEHICLE_CAPACITY','OPERATING_AREA','SERVICE_RADIUS',
    'ELIGIBILITY_EXPIRY','REVIEW_ATTESTATION','VERIFIED_VEHICLE_EVIDENCE'
  ])assert.ok(result.missing_requirements.includes(code));
});

test('expired profile or matching document makes approval expired and unavailable',()=>{
  const expiredProfile=courierEligibilityAssessment({
    ...completeProfile,eligibility_expires_at:'2026-10-03T23:59:59.000Z'
  },[completeDocument],{nowMs});
  assert.equal(expiredProfile.effective_status,'expired');
  assert.equal(expiredProfile.available,false);

  const expiredDocument=courierEligibilityAssessment(completeProfile,[{
    ...completeDocument,expiry_date:'2026-10-03'
  }],{nowMs});
  assert.equal(expiredDocument.effective_status,'expired');
  assert.equal(expiredDocument.available,false);
  assert.ok(expiredDocument.missing_requirements.includes('VERIFIED_VEHICLE_EVIDENCE'));

  const explicitlyExpired=courierEligibilityAssessment(completeProfile,[{
    ...completeDocument,verification_status:'expired'
  }],{nowMs});
  assert.equal(explicitlyExpired.effective_status,'expired');
});

test('PostgreSQL DATE values remain valid through their recorded expiry day',()=>{
  const localExpiry=new Date(2026,9,4,0,0,0,0);
  const midday=localExpiry.getTime()+12*60*60*1000;
  const result=courierEligibilityAssessment({
    ...completeProfile,eligibility_expires_at:localExpiry
  },[{...completeDocument,expiry_date:localExpiry}],{nowMs:midday});
  assert.equal(result.eligible,true);
  assert.equal(result.effective_status,'approved');
});

test('vehicle evidence must match the approved canonical vehicle class',()=>{
  const result=courierEligibilityAssessment(completeProfile,[{
    ...completeDocument,vehicle_class:'sedan'
  }],{nowMs});
  assert.equal(result.effective_status,'pending');
  assert.equal(result.eligible,false);
  assert.deepEqual(result.missing_requirements,['VERIFIED_VEHICLE_EVIDENCE']);
});

test('generic identity evidence cannot satisfy the vehicle-evidence requirement',()=>{
  const result=courierEligibilityAssessment(completeProfile,[{
    ...completeDocument,document_type:'identity_support'
  }],{nowMs});
  assert.equal(result.eligible,false);
  assert.deepEqual(result.missing_requirements,['VERIFIED_VEHICLE_EVIDENCE']);
});

test('vehicle evidence dates and review ordering must be internally valid',()=>{
  const futureIssue=courierEligibilityAssessment(completeProfile,[{
    ...completeDocument,issue_date:'2027-01-01'
  }],{nowMs});
  assert.ok(futureIssue.missing_requirements.includes('VERIFIED_VEHICLE_EVIDENCE'));

  const staleReview=courierEligibilityAssessment({
    ...completeProfile,eligibility_reviewed_at:'2026-10-04T11:00:00.000Z'
  },[{...completeDocument,verified_at:'2026-10-04T11:25:00.000Z'}],{nowMs});
  assert.ok(staleReview.missing_requirements.includes('REVIEW_ATTESTATION'));
});

test('suspended and revoked decisions remain unavailable even with complete evidence',()=>{
  for(const status of ['suspended','revoked']){
    const result=courierEligibilityAssessment({...completeProfile,eligibility_status:status},[completeDocument],{nowMs});
    assert.equal(result.prerequisites_met,true);
    assert.equal(result.eligible,false);
    assert.equal(result.available,false);
    assert.equal(result.effective_status,status);
  }
});

test('public profile projection cannot expose stale Approved or Available state',()=>{
  const view=courierEligibilityProfileView({
    ...completeProfile,operating_psgc_code:'',operating_area_name:'',available:true
  },[completeDocument],{nowMs});
  assert.equal(view.eligibility_status,'pending');
  assert.equal(view.available,false);
  assert.equal(view.eligibility.eligible,false);
  assert.ok(view.eligibility.missing_requirements.includes('OPERATING_AREA'));
});

test('incomplete approval error exposes stable machine-readable requirements',()=>{
  const assessment=courierEligibilityAssessment({eligibility_status:'approved'},[],{nowMs});
  const error=courierEligibilityError(assessment);
  assert.equal(error.status,409);
  assert.equal(error.code,'COURIER_ELIGIBILITY_INCOMPLETE');
  assert.deepEqual(error.missing_requirements,assessment.missing_requirements);
  assert.match(error.message,/Courier approval is incomplete/);
});

test('runtime routes use the canonical policy for approval availability and dispatch',()=>{
  const server=read('server-delivery.js');
  const finance=read('server-delivery-finance.js');
  const auth=read('server-auth.js');
  const dispatch=read('delivery-dispatch-v2f-core.js');
  const legacy=read('identity-server.js');
  const governance=read('server-profile-governance.js');
  const controlTower=read('owner-control-tower-runtime.js');
  for(const field of [
    'eligibility_reviewed_by_account_id','eligibility_reviewed_at','eligibility_policy_version'
  ])assert.match(server,new RegExp(field));
  assert.match(server,/evidence_review_attested/);
  assert.match(server,/courierEligibilityAssessment/);
  assert.match(server,/reconcileCourierEligibility/);
  assert.doesNotMatch(server,/WITH latest_review/);
  assert.match(server,/COURIER_ELIGIBILITY_INCOMPLETE/);
  assert.match(server,/missing_requirements/);
  assert.match(server,/offer_withdrawn_test_isolation/);
  assert.doesNotMatch(server,/const \[territoryAuthorized,hasActiveDelivery,eligibilityRecord,controlledTestDelivery\]=await Promise\.all/);
  assert.match(finance,/eligibility_status=CASE WHEN \$6 AND eligibility_status='approved' THEN 'pending'/);
  assert.match(auth,/UPDATE delivery_offers SET status='withdrawn'/);
  assert.match(auth,/SELECT id,document_type,vehicle_class,issue_date,expiry_date,private_evidence_object_id,verification_status/);
  assert.match(dispatch,/eligibilityAssessment\.eligible!==true/);
  assert.match(dispatch,/COURIER_NON_COMMERCIAL_TEST_ONLY/);
  assert.match(legacy,/available=FALSE/);
  assert.match(legacy,/UPDATE delivery_offers SET status='withdrawn'/);
  assert.match(legacy,/SELECT document_type,vehicle_class,issue_date,expiry_date,private_evidence_object_id,verification_status/);
  assert.match(governance,/Super Admin self-test only — private, non-commercial/);
  assert.match(governance,/non_commercial_test_only=TRUE/);
  assert.match(governance,/UPDATE delivery_offers SET status='withdrawn'/);
  assert.match(controlTower,/courier_account\.account_mode<>'company_test'/);
});

test('Admin and Courier UI explain missing evidence and block incomplete approval',()=>{
  const admin=read('public/admin-console.js');
  const courier=read('public/delivery-ui.js');
  const shell=read('public/shell.js');
  assert.match(admin,/Approval requirements/);
  assert.match(admin,/Approval blocked/);
  assert.match(admin,/s==='approved'&&!canApprove\?'disabled'/);
  assert.match(admin,/evidence_review_attested:true/);
  assert.match(admin,/eligibility\.non_commercial/);
  assert.match(courier,/eligibility\?\.eligible===true/);
  assert.match(courier,/Still required:/);
  assert.match(courier,/Changing your vehicle, capacity, service radius or operating area/);
  assert.match(courier,/can receive only controlled test deliveries, never real customer work/);
  assert.match(shell,/profile\?\.eligibility/);
  assert.match(shell,/eligibility requirement/);
});
