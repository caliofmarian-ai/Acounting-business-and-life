import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveCredentialQaTerritories,captureQaCredentialAdminBaseline,restoreQaCredentialAdminBaseline,buildQaCredentialAdminRecoverySnapshot} from '../qa-service-provider-acceptance.js';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const qa=read('qa-acceptance.js');
const service=read('qa-service-provider-acceptance.js');

test('Service Provider runtime wave is isolated and wired through canonical QA acceptance',()=>{
  assert.match(qa,/runServiceProviderExperienceAcceptance/);
  assert.match(qa,/SERVICE_PROVIDER_EXPERIENCE_WAVE='service_provider_experience_v1'/);
  assert.match(qa,/SERVICE_PROVIDER_ALIAS='dropi\.deliveries\+testservice@gmail\.com'/);
  assert.match(qa,/TERRITORY_ADMIN_ALIAS='dropi\.deliveries\+testterritoryadmin@gmail\.com'/);
  assert.match(qa,/config\.wave===SERVICE_PROVIDER_EXPERIENCE_WAVE/);
  assert.match(qa,/validateRuntimeSafety/);
  assert.match(qa,/isolated accounting-preview QA database/);
});

test('Service Provider QA uses self-application and non-credential-gated handyman category',()=>{
  assert.match(service,/\/api\/governance\/service-provider\/start/);
  assert.match(service,/invitation_id/);
  assert.match(service,/self-application unexpectedly requires an invitation/);
  assert.match(service,/code='handyman'/);
  assert.match(service,/credential_gate===true/);
  assert.match(service,/requested_category_ids:\[Number\(categoryId\)\]/);
  assert.match(service,/role='service_provider' AND territory_id=\$2/);
  assert.match(service,/latestServiceApplication\(pool,provider\.accountId,territoryId\)/);
  assert.doesNotMatch(service,/prc_license|tesda_nc_coc/);
});

test('Local Services runtime proves request through customer-confirmed completion',()=>{
  for(const route of [
    '/api/services/jobs',
    '/api/service-provider/jobs/',
    '/quote',
    '/accept-quote',
    '/status',
    '/confirm-completion'
  ]) assert.match(service,new RegExp(route.replaceAll('/','\\/')));
  assert.match(service,/status:'scheduled'/);
  assert.match(service,/status:'in_progress'/);
  assert.match(service,/status:'completed',final_price:SERVICE_FINAL_PRICE/);
  assert.match(service,/customer_confirmed_at/);
});

test('verified review boundary is denied before Customer confirmation and allowed after',()=>{
  const start=service.indexOf('export async function runServiceProviderExperienceAcceptance');
  assert.ok(start>=0);
  const run=service.slice(start);
  const blocked=run.indexOf("Premature Local Services review denial");
  const confirm=run.indexOf("Customer Local Services completion confirmation");
  const allowed=run.indexOf("const reviewId=await ensureServiceReview");
  assert.ok(blocked>=0&&confirm>blocked&&allowed>confirm);
  assert.match(run,/expectStatus\(prematureReview,409/);
});

test('Service Provider QA preflight only rejects its own stale credential evidence',()=>{
  assert.match(service,/resetStaleQaCredentialEvidence/);
  assert.match(service,/title='Controlled QA evidence record'/);
  assert.match(service,/issuing_body='Business & Life QA'/);
  assert.match(service,/verification_status='verified'/);
  assert.match(service,/non-QA verified credential evidence; refusing automatic cleanup/);
  assert.match(service,/Controlled QA preflight cleanup; not a real professional credential/);
});

test('credential authority proves ordinary denial, territory denial, in-scope allow and audit evidence',()=>{
  assert.match(service,/Ordinary Customer credential-review denial/);
  assert.match(service,/Out-of-scope credential-review denial/);
  assert.match(service,/In-scope credential verification/);
  assert.match(service,/permissions:\['credential\.verify'\]/);
  assert.match(service,/event_code='service_credential\.reviewed'/);
  assert.match(service,/permission_code!=='credential\.verify'/);
  assert.match(service,/territory_id\)!==Number\(reviewTerritoryId\)/);
  assert.match(service,/In-scope credential verification HTTP/);
  assert.match(service,/verified_by_account_id/);
  assert.match(service,/verified_at/);
});

test('Service Provider QA keeps Money commercial truth separate from settlement evidence',()=>{
  assert.match(service,/\/api\/profile-money\/service_provider/);
  assert.match(service,/confirmed_job_value/);
  assert.match(service,/component_code='service_provider_net'/);
  assert.match(service,/HOLD_NO_SERVICE_PROVIDER_NET/);
  assert.match(service,/provider_payout_settlement:'HOLD_FOR_PROVIDER_EVIDENCE'/);
  assert.doesNotMatch(service,/delivery_fee.*service_provider_net/i);
});

test('Local Services 90-day promotion and notifications/support/settings/session are covered',()=>{
  assert.match(service,/service_scope='local_services'/);
  assert.match(service,/promo_duration_days\)!==90/);
  assert.match(service,/service\.request_created/);
  assert.match(service,/service\.quote_created/);
  assert.match(service,/service\.quote_accepted/);
  assert.match(service,/service\.status_changed/);
  assert.match(service,/\/api\/settings\/finance/);
  assert.match(service,/\/api\/support\/tickets/);
  assert.match(service,/Service Provider Experience final re-login/);
});

test('credential QA targets canonical active authorization across historical controlled territories',async()=>{
  const check=async(target,pilot,secondary)=>{
    const pool={async query(sql,params){
      assert.match(sql,/pa\.status='active'/);
      assert.match(sql,/a\.account_mode='company_test'/);
      assert.deepEqual(params,[14,13]);
      return{rowCount:1,rows:[{target_territory_id:target}]};
    }};
    return resolveCredentialQaTerritories({
      pool,providerAccountId:13,credentialId:14,pilotTerritoryId:pilot,secondaryTerritoryId:secondary
    });
  };
  assert.deepEqual(await check(1,1,2),{reviewTerritoryId:1,outsideTerritoryId:2,reviewTargetMatchesPilot:true});
  assert.deepEqual(await check(2,1,2),{reviewTerritoryId:2,outsideTerritoryId:1,reviewTargetMatchesPilot:false});
  assert.deepEqual(await check(3,1,2),{reviewTerritoryId:3,outsideTerritoryId:2,reviewTargetMatchesPilot:false});
  await assert.rejects(check(null,1,2),/no authoritative review territory/);
  await assert.rejects(check(1,1,1),/distinct pilot and secondary/);
  await assert.rejects(resolveCredentialQaTerritories({
    pool:{async query(){return{rowCount:0,rows:[]}}},
    providerAccountId:13,credentialId:14,pilotTerritoryId:1,secondaryTerritoryId:2
  }),/company_test credential missing/);
});

test('Local Services exact-head runtime wave exercises provider-neutral payment intent without settlement',()=>{
  assert.match(service,/verifyUnsettledServiceJobPaymentAuthority/);
  assert.match(service,/paymentIntentQa=await verifyUnsettledServiceJobPaymentAuthority/);
  assert.match(service,/\/api\/payments\/intents\/service-job\//);
  assert.match(service,/\/api\/payments\/service-jobs\//);
  assert.match(service,/qa_unconfigured_571/);
  assert.match(service,/commercial\?\.accepted_quote_id/);
  assert.match(service,/commercial\?\.agreed_total/);
  assert.match(service,/status!=='requires_provider'/);
  assert.match(service,/Service Job payment intent exact replay/);
  assert.match(service,/Service Job same-key method conflict/);
  assert.match(service,/Service Job second pending intent denial/);
  assert.match(service,/Non-payer Service Job payment-intent denial/);
  assert.match(service,/Ordinary Customer admin refund denial/);
  assert.match(service,/payment_audit_events/);
  assert.match(service,/provider_events WHERE payment_intent_id/);
  assert.match(service,/payment_allocations WHERE payment_intent_id/);
  assert.match(service,/UPDATE payment_intents SET status='cancelled'/);
  assert.match(service,/fixture_cancelled:true/);
  assert.match(service,/online_service_payment:'HOLD_UNSUPPORTED_RUNTIME_FLOW'/);
});

function credentialAdminFixture(){
  const calls=[],prior={id:'6',territory_id:'11',status:'active',authority_rank:'territory_admin',assigned_by_account_id:'1',reason:'initial',effective_from:null,effective_until:null};
  let allowed=true,unrelated=false,failRestore=false,unknownPermission=false,unknownFunction=false;
  const client={async query(sql,params=[]){
    calls.push({sql,params});
    if(/^(BEGIN|COMMIT|ROLLBACK)/.test(sql))return{rowCount:0,rows:[]};
    if(sql.startsWith('SELECT id FROM accounts'))return{rowCount:allowed?1:0,rows:allowed?[{id:'21'}]:[]};
    if(sql.startsWith('SELECT id,territory_id,authority_rank'))return{rows:[prior],rowCount:1};
    if(sql.startsWith('SELECT assignment_id,permission_code'))
      return{rows:[{assignment_id:'6',permission_code:'members.view',status:'active',granted_by_account_id:'1',reason:'before',effective_from:null,effective_until:null}]};
    if(sql.startsWith('SELECT assignment_id,function_code'))
      return{rows:[{assignment_id:'6',function_code:'trust_safety',status:'revoked',granted_by_account_id:'1',reason:'before',effective_from:null,effective_until:null}]};
    if(sql.startsWith('SELECT id,territory_id FROM platform_admin_assignments'))
      return{rows:[{id:'6',territory_id:'11'},{id:'7',territory_id:unrelated?'999':'23'}]};
    if(sql.startsWith('SELECT g.assignment_id,g.permission_code'))return{rows:[
      {assignment_id:'6',permission_code:'members.view',reason:'before',territory_id:'11'},
      {assignment_id:'7',permission_code:'credential.verify',reason:'Controlled QA in-scope credential authority',territory_id:'23'},
      {assignment_id:'7',permission_code:'members.view',reason:'Controlled QA in-scope credential authority',territory_id:'23'},
      ...(unknownPermission?[{assignment_id:'6',permission_code:'finance.payout',reason:'Unrelated agent grant',territory_id:'11'}]:[])
    ]};
    if(sql.startsWith('SELECT g.assignment_id,g.function_code'))return{rows:[
      {assignment_id:'6',function_code:'trust_safety',reason:'before',territory_id:'11'},
      ...(unknownFunction?[{assignment_id:'6',function_code:'finance_admin',reason:'Other worker',territory_id:'11'}]:[])
    ]};
    if(sql.startsWith('UPDATE'))return{rowCount:failRestore&&sql.includes('SET status=$3')?0:1};
    throw Error('Unexpected query '+sql);
  },release(){calls.push({sql:'RELEASE'})}};
  return{pool:{connect:async()=>client},calls,allow:x=>allowed=x,unrelated:x=>unrelated=x,fail:x=>failRestore=x,
    unknownPermission:x=>unknownPermission=x,unknownFunction:x=>unknownFunction=x};
}
test('credential review wave restores company_test Admin assignment and grant baseline, revoking new QA grants',async()=>{
  const f=credentialAdminFixture(),b=await captureQaCredentialAdminBaseline(f.pool,21);
  assert.equal(b.assignments.length,1);
  const r=await restoreQaCredentialAdminBaseline(f.pool,21,b,[22,23]);
  assert.deepEqual(r,{restored:true,original_assignments:1,temporary_assignments_revoked:1});
  assert.ok(f.calls.some(q=>q.sql?.startsWith('UPDATE platform_admin_assignments SET authority_rank=')&&q.params[3]==='active'));
  assert.ok(f.calls.some(q=>q.sql?.startsWith("UPDATE platform_admin_assignments SET status='revoked'")&&String(q.params[0])==='7'));
  assert.ok(f.calls.some(q=>q.sql?.startsWith('UPDATE admin_permission_grants SET status=$3')&&q.params[2]==='active'));
  assert.ok(f.calls.some(q=>q.sql?.startsWith('UPDATE admin_function_assignments SET status=$3')&&q.params[2]==='revoked'));
  assert.ok(f.calls.some(q=>q.sql?.startsWith("UPDATE admin_permission_grants SET status='revoked'")&&String(q.params[0])==='7'&&q.params[1]==='credential.verify'));
  assert.ok(f.calls.some(q=>q.sql?.startsWith("UPDATE admin_permission_grants SET status='revoked'")&&String(q.params[0])==='7'&&q.params[1]==='members.view'));
  assert.ok(!f.calls.some(q=>q.sql?.includes('WHERE assignment_id=ANY($1::bigint[])')&&q.sql.startsWith('UPDATE')),'must not bulk-revoke grants');
  const method=service.slice(service.indexOf('async function verifyCredentialAdminScope('),service.indexOf('async function serviceNotifications'));
  assert.match(method,/captureQaCredentialAdminBaseline/);
  assert.match(method,/finally\s*\{\s*await restoreQaCredentialAdminBaseline/);
  assert.match(service,/credential_qa_admin_authorization_restored:/);
  assert.match(service,/recoverStaleQaCredentialAdminBaseline\(/);
  assert.match(service,/credential_qa_admin_preflight_recovery:/);
});

test('Local Services QA recovers only the known stale company_test Territory Admin baseline',()=>{
  const OUTSIDE='Controlled QA out-of-scope credential authority';
  const INSIDE='Controlled QA in-scope credential authority';
  const OWNER='Controlled Owner Control Tower delegated-scope acceptance';
  const assignments=[
    {id:'102',territory_id:'2',authority_rank:'territory_admin',status:'active',assigned_by_account_id:'1',reason:OUTSIDE,effective_from:'2026-09-21T16:04:51.936Z',effective_until:null,created_at:'2026-09-21T16:04:51.936Z'},
    {id:'103',territory_id:'1',authority_rank:'territory_admin',status:'revoked',assigned_by_account_id:'1',reason:INSIDE,effective_from:'2026-09-21T16:04:58.347Z',effective_until:null,created_at:'2026-09-21T16:04:58.347Z'},
    {id:'902',territory_id:'6',authority_rank:'territory_admin',status:'active',assigned_by_account_id:'1',reason:INSIDE,effective_from:'2026-11-13T15:04:21.279Z',effective_until:null,created_at:'2026-11-13T15:04:21.279Z'}
  ];
  const permissions=[
    {assignment_id:'102',permission_code:'members.view',status:'active',reason:OUTSIDE},
    {assignment_id:'102',permission_code:'credential.verify',status:'active',reason:OUTSIDE},
    {assignment_id:'103',permission_code:'members.view',status:'active',reason:INSIDE},
    {assignment_id:'103',permission_code:'credential.verify',status:'active',reason:INSIDE},
    {assignment_id:'103',permission_code:'admin.console',status:'revoked',reason:OWNER},
    {assignment_id:'103',permission_code:'incident.triage',status:'revoked',reason:OWNER},
    {assignment_id:'103',permission_code:'profile.suspend',status:'revoked',reason:OWNER},
    {assignment_id:'902',permission_code:'members.view',status:'active',reason:INSIDE},
    {assignment_id:'902',permission_code:'credential.verify',status:'active',reason:INSIDE}
  ];
  const functions=[{assignment_id:'103',function_code:'trust_safety',status:'revoked',reason:OWNER}];
  const plan=buildQaCredentialAdminRecoverySnapshot({
    accountId:8,pilotTerritoryId:6,assignments,permissions,functions
  });
  assert.equal(plan.needsRestore,true);
  assert.deepEqual(plan.scopeIds,[2,6]);
  assert.equal(plan.temporaryAssignments,1);
  assert.deepEqual(plan.snapshot.assignments.map(row=>[String(row.id),row.status]),[
    ['102','active'],['103','active']
  ]);

  const clean=buildQaCredentialAdminRecoverySnapshot({
    accountId:8,pilotTerritoryId:6,
    assignments:assignments.map(row=>({...row,status:String(row.id)==='103'?'active':'revoked'})),
    permissions:permissions.map(row=>({...row,status:String(row.assignment_id)==='902'?'revoked':row.status})),
    functions
  });
  assert.equal(clean.needsRestore,false);

  assert.throws(()=>buildQaCredentialAdminRecoverySnapshot({
    accountId:8,pilotTerritoryId:6,
    assignments:[...assignments,{...assignments[2],id:'903',reason:'Unrelated executor assignment'}],
    permissions,functions
  }),/Unexpected QA Territory Admin assignment/);
  assert.throws(()=>buildQaCredentialAdminRecoverySnapshot({
    accountId:8,pilotTerritoryId:6,
    assignments,permissions:[...permissions,{assignment_id:'902',permission_code:'finance.payout',status:'active',reason:INSIDE}],functions
  }),/Unexpected temporary QA Territory Admin grant/);
});

test('credential review fixture fails closed on unauthorized account and other agent scope',async()=>{
  const f=credentialAdminFixture();f.allow(false);
  await assert.rejects(captureQaCredentialAdminBaseline(f.pool,21),/not an active company_test/);
  assert.equal(f.calls.filter(x=>x.sql?.startsWith('UPDATE')).length,0);
  f.allow(true);const b=await captureQaCredentialAdminBaseline(f.pool,21);
  f.unrelated(true);
  await assert.rejects(restoreQaCredentialAdminBaseline(f.pool,21,b,[22,23]),/Unrelated concurrent/);
  assert.equal(f.calls.filter(x=>x.sql?.startsWith('UPDATE')).length,0);
  assert.ok(f.calls.some(x=>x.sql==='ROLLBACK'));
});
test('failed credential review fixture restoration ROLLBACKs without claiming PASS',async()=>{
  const f=credentialAdminFixture(),b=await captureQaCredentialAdminBaseline(f.pool,21),offset=f.calls.length;
  f.fail(true);
  await assert.rejects(restoreQaCredentialAdminBaseline(f.pool,21,b,[22,23]),/grant compensation failed/);
  const statements=f.calls.slice(offset).map(x=>x.sql);
  assert.ok(statements.includes('ROLLBACK'));
  assert.ok(!statements.includes('COMMIT'));
  assert.equal(statements.at(-1),'RELEASE');
});


test('credential QA restores no grants if an unrelated executor added a permission or function',async()=>{
  for(const kind of ['unknownPermission','unknownFunction']){
    const f=credentialAdminFixture(),b=await captureQaCredentialAdminBaseline(f.pool,21);
    const start=f.calls.length;f[kind](true);
    await assert.rejects(restoreQaCredentialAdminBaseline(f.pool,21,b,[22,23]),/Unexpected concurrent QA Admin grant/);
    const attempted=f.calls.slice(start).map(x=>x.sql);
    assert.equal(attempted.filter(x=>x.startsWith('UPDATE')).length,0,'unrelated '+kind+' must not be changed');
    assert.ok(attempted.includes('ROLLBACK'));
    assert.ok(!attempted.includes('COMMIT'));
  }
});
