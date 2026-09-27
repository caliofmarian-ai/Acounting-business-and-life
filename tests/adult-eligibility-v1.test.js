import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  ADULT_ELIGIBILITY_POLICY_VERSION,
  accountAdultEligibilityState,
  recordAdultEligibilityAttestation,
  recordAdultEligibilityAdminReview,
  recordCompanyTestEligibilityExemption,
  requireAdultEligibility
} from '../account-safety-eligibility-core.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

class EligibilityDb{
  constructor(accountMode='personal'){
    this.connectCalls=0;
    this.row={
      account_mode:accountMode,
      safety_eligibility_status:'pending',
      safety_eligibility_policy_version:'',
      safety_eligibility_attested_at:null,
      safety_eligibility_reviewed_at:null,
      safety_eligibility_source:''
    };
    this.events=[];
  }
  async connect(){this.connectCalls+=1;return this}
  release(){}
  async query(sql,args=[]){
    const normalized=String(sql).replace(/\s+/g,' ').trim();
    if(['BEGIN','COMMIT','ROLLBACK'].includes(normalized))return{rowCount:0,rows:[]};
    if(normalized.startsWith('SELECT account_mode,safety_eligibility_status'))return{rowCount:1,rows:[{...this.row}]};
    if(normalized.includes("SET safety_eligibility_status='adult_self_attested'")){
      if(this.row.account_mode!=='personal')return{rowCount:0,rows:[]};
      Object.assign(this.row,{safety_eligibility_status:'adult_self_attested',safety_eligibility_policy_version:args[0],safety_eligibility_attested_at:'2026-09-27T00:00:00.000Z',safety_eligibility_reviewed_at:null,safety_eligibility_source:args[1]});
      return{rowCount:1,rows:[{id:1}]};
    }
    if(normalized.includes("SET safety_eligibility_status='adult_reviewed'")){
      Object.assign(this.row,{safety_eligibility_status:'adult_reviewed',safety_eligibility_policy_version:args[0],safety_eligibility_reviewed_at:'2026-09-27T00:01:00.000Z',safety_eligibility_source:args[2]});
      return{rowCount:1,rows:[{id:1}]};
    }
    if(normalized.includes("SET safety_eligibility_status='company_test_exempt'")){
      if(this.row.account_mode!=='company_test')return{rowCount:0,rows:[]};
      Object.assign(this.row,{safety_eligibility_status:'company_test_exempt',safety_eligibility_policy_version:args[0],safety_eligibility_attested_at:null,safety_eligibility_reviewed_at:null,safety_eligibility_source:args[1]});
      return{rowCount:1,rows:[{id:1}]};
    }
    if(normalized.startsWith('INSERT INTO account_safety_eligibility_events')){
      this.events.push(args);
      return{rowCount:1,rows:[{id:this.events.length}]};
    }
    throw new Error('Unexpected eligibility test query: '+normalized);
  }
}

test('eligibility state is current-policy scoped and never infers a minor',()=>{
  assert.equal(accountAdultEligibilityState({safety_eligibility_status:'adult_self_attested',safety_eligibility_policy_version:ADULT_ELIGIBILITY_POLICY_VERSION,account_mode:'personal'}).eligible,true);
  assert.equal(accountAdultEligibilityState({safety_eligibility_status:'adult_self_attested',safety_eligibility_policy_version:'old-policy',account_mode:'personal'}).eligible,false);
  assert.equal(accountAdultEligibilityState({safety_eligibility_status:'company_test_exempt',safety_eligibility_policy_version:ADULT_ELIGIBILITY_POLICY_VERSION,account_mode:'personal'}).eligible,false);
  assert.equal(accountAdultEligibilityState({safety_eligibility_status:'adult_self_attested',safety_eligibility_policy_version:ADULT_ELIGIBILITY_POLICY_VERSION,account_mode:'company_test'}).eligible,false);
  assert.equal(accountAdultEligibilityState({safety_eligibility_status:'pending',account_mode:'personal'}).status,'pending');
});

test('personal account must explicitly attest before operational eligibility',async()=>{
  const db=new EligibilityDb('personal');
  await assert.rejects(requireAdultEligibility(db,1),error=>error.code==='ADULT_ELIGIBILITY_REQUIRED'&&error.status===403);
  await assert.rejects(recordAdultEligibilityAttestation(db,{accountId:1,attested:false,policyVersion:ADULT_ELIGIBILITY_POLICY_VERSION}),/Explicit confirmation/);
  await assert.rejects(recordAdultEligibilityAttestation(db,{accountId:1,attested:true,policyVersion:'stale'}),/policy changed/);
  const state=await recordAdultEligibilityAttestation(db,{accountId:1,attested:true,policyVersion:ADULT_ELIGIBILITY_POLICY_VERSION,source:'test'});
  assert.equal(state.eligible,true);
  assert.equal(state.self_attested,true);
  assert.equal(db.events.length,1);
  assert.equal(db.events[0][2],'adult_eligibility_self_attested');
  assert.equal(db.connectCalls,0,'an existing PostgreSQL client must never be connected a second time');
  const repeat=await recordAdultEligibilityAttestation(db,{accountId:1,attested:true,policyVersion:ADULT_ELIGIBILITY_POLICY_VERSION,source:'test'});
  assert.equal(repeat.eligible,true);
  assert.equal(db.events.length,1,'idempotent declaration must not append duplicate evidence');
});

test('governed approval requires an explicit human review after self-attestation',async()=>{
  const db=new EligibilityDb('personal');
  await assert.rejects(recordAdultEligibilityAdminReview(db,{accountId:1,actorAccountId:9,confirmed:true}),/must complete/);
  await recordAdultEligibilityAttestation(db,{accountId:1,attested:true,policyVersion:ADULT_ELIGIBILITY_POLICY_VERSION});
  await assert.rejects(recordAdultEligibilityAdminReview(db,{accountId:1,actorAccountId:9,confirmed:false}),/Explicit Admin confirmation/);
  const reviewed=await recordAdultEligibilityAdminReview(db,{accountId:1,actorAccountId:9,confirmed:true});
  assert.equal(reviewed.admin_reviewed,true);
  assert.equal(db.events.at(-1)[2],'adult_eligibility_admin_reviewed');
});

test('company test exemption is classification-bound and audited',async()=>{
  const qa=new EligibilityDb('company_test');
  const exempt=await recordCompanyTestEligibilityExemption(qa,{accountId:1});
  assert.equal(exempt.company_test_exempt,true);
  assert.equal(qa.events[0][2],'company_test_exempted');
  const personal=new EligibilityDb('personal');
  await assert.rejects(recordCompanyTestEligibilityExemption(personal,{accountId:1}),/Only a classified company test account/);
  const restricted=new EligibilityDb('company_test');
  restricted.row.safety_eligibility_status='restricted';
  await assert.rejects(recordCompanyTestEligibilityExemption(restricted,{accountId:1}),/restricted account cannot receive/);
});

test('schema stores a minimal versioned decision and append-only evidence, not DOB or disability data',()=>{
  const core=read('account-safety-eligibility-core.js');
  assert.match(core,/CREATE TABLE IF NOT EXISTS account_safety_eligibility_events/);
  assert.match(core,/company_test_exempt/);
  assert.match(core,/adult_eligibility_self_attested/);
  assert.match(core,/safety_eligibility_status<>'restricted'/);
  assert.doesNotMatch(core,/ADD COLUMN IF NOT EXISTS [^\n]*(?:birth|birthday|disability|medical)/i);
});

test('registration, profile lifecycle and governed Admin approval fail closed',()=>{
  const auth=read('server-auth.js'),governance=read('server-profile-governance.js'),velocity=read('abuse-velocity-core.js'),qa=read('qa-acceptance.js');
  assert.match(auth,/adult_eligibility_attested!==true/);
  assert.match(auth,/\/api\/me\/adult-eligibility\/attest/);
  assert.match(auth,/requireAdultEligibility\(pool,req\.accountId,\{action:'switch into a profile'/);
  assert.match(auth,/requireAdultEligibility\(pool,req\.accountId,\{action:'activate Customer'/);
  assert.match(governance,/action:'start operational onboarding'/);
  assert.match(governance,/action:'accept an operational invitation'/);
  assert.match(governance,/adult_eligibility_reviewed===true/);
  assert.match(velocity,/adult_eligibility_attestation/);
  assert.match(qa,/ADULT_ELIGIBILITY_RUNTIME_WAVE='adult_eligibility_v1'/);
  assert.match(qa,/pending_profile_activation_denied:true/);
  assert.match(qa,/governed_admin_review_required:true/);
  assert.match(qa,/Adult eligibility QA account cleanup did not remove the temporary account/);
});

test('registration, Account Settings and both Admin surfaces expose explicit controls',()=>{
  const authUi=read('public/auth-ui.js'),hardeningUi=read('public/auth-hardening-ui.js'),shell=read('public/shell.js'),admin=read('public/admin-console.js'),governanceUi=read('public/profile-governance-ui.js');
  for(const source of [authUi,hardeningUi]){
    assert.match(source,/I confirm that I am 18 or older/);
    assert.match(source,/adult_eligibility_policy_version/);
  }
  assert.match(shell,/adultEligibilityForm/);
  assert.match(shell,/Confirm adult eligibility first/);
  assert.match(admin,/adult_eligibility_reviewed/);
  assert.match(governanceUi,/adult_eligibility_reviewed/);
});

test('policy records the legal and privacy boundary with primary PH sources',()=>{
  const policy=read('docs/trust-safety/PH_MINOR_VULNERABLE_PERSON_SAFETY.md');
  assert.match(policy,/adult-only boundary/);
  assert.match(policy,/not a claim that self-declaration proves age/);
  assert.match(policy,/Child Privacy Impact Assessment/);
  assert.match(policy,/privacy\.gov\.ph\/wp-content\/uploads\/2024\/12\/Advisory/);
  assert.match(policy,/does \*\*not\*\* treat “18\+” as a complete vulnerable-person safeguard/);
});
