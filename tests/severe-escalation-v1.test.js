import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  acknowledgeSevereEscalation,
  assertSevereCaseTransitionAllowed,
  createIncidentSevereEscalation,
  incidentUrgencyIndicator,
  incidentUrgencyIndicators,
  resolveSevereEscalation,
  severeIncidentEscalationPolicy
} from '../trust-safety-escalation-core.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const core=read('trust-safety-escalation-core.js');
const cases=read('trust-safety-case-core.js');
const incidents=read('server-incidents.js');
const admin=read('server-admin-operations.js');
const userUi=read('public/incidents-ui.js');
const adminUi=read('public/admin-console.js');
const runtime=read('.github/workflows/admin-runtime.yml');

test('severe routing accepts only the closed structured signal registry',()=>{
  assert.deepEqual(incidentUrgencyIndicators(),[
    'none','immediate_danger','child_or_vulnerable_person','credible_threat_stalking_or_doxxing',
    'account_takeover_or_identity_theft','payment_fraud_or_money_mule','severe_illegal_or_exploitative_content'
  ]);
  assert.equal(incidentUrgencyIndicator('Immediate Danger'),'immediate_danger');
  assert.throws(()=>incidentUrgencyIndicator('custom accusation'),/Unknown incident urgency indicator/);

  const immediate=severeIncidentEscalationPolicy({category:'Other operational issue',urgencyIndicator:'immediate_danger'});
  assert.equal(immediate.severity,'critical');
  assert.equal(immediate.route_code,'immediate_personal_safety');
  assert.equal(immediate.response_minutes,15);
  assert.equal(immediate.country_scoped,true);

  const fraud=severeIncidentEscalationPolicy({urgencyIndicator:'payment_fraud_or_money_mule'});
  assert.equal(fraud.severity,'high');
  assert.equal(fraud.legal_review_required,true);
  assert.equal(fraud.route_code,'payments_fraud');

  const conflicting=severeIncidentEscalationPolicy({category:'Exploitation concern',urgencyIndicator:'payment_fraud_or_money_mule'});
  assert.equal(conflicting.severity,'critical');
  assert.equal(conflicting.route_code,'child_vulnerable_safety');
  const fastestCritical=severeIncidentEscalationPolicy({category:'Exploitation concern',urgencyIndicator:'immediate_danger'});
  assert.equal(fastestCritical.route_code,'immediate_personal_safety');
  assert.equal(fastestCritical.response_minutes,15);
});

test('free-text descriptions never classify or escalate a report',()=>{
  const ordinary=severeIncidentEscalationPolicy({
    category:'Other operational issue',urgencyIndicator:'none',
    description:'immediate danger child threat money mule account takeover'
  });
  assert.equal(ordinary,null);
  const policyFunction=core.slice(core.indexOf('export function severeIncidentEscalationPolicy'),core.indexOf('export async function ensureSevereEscalationSchema'));
  assert.doesNotMatch(policyFunction,/description|attachment/i);
  assert.match(core,/Report descriptions and attachments are intentionally absent/);
});

test('high-risk report categories have deterministic allegation routing',()=>{
  const exploitation=severeIncidentEscalationPolicy({category:'Exploitation concern',urgencyIndicator:'none'});
  assert.equal(exploitation.severity,'critical');
  assert.equal(exploitation.route_code,'child_vulnerable_safety');
  assert.equal(exploitation.evidence_preservation_required,true);
  const threat=severeIncidentEscalationPolicy({category:'Harassment / threat'});
  assert.equal(threat.severity,'high');
  assert.equal(threat.route_code,'personal_safety');
});

test('escalation schema is auditable, restrictive and cannot claim external reporting',()=>{
  assert.match(core,/ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS urgency_indicator/);
  assert.match(core,/incident_reports_urgency_indicator_check/);
  assert.match(core,/CREATE TABLE IF NOT EXISTS trust_case_escalations/);
  assert.match(core,/case_id BIGINT NOT NULL REFERENCES trust_cases\(id\) ON DELETE RESTRICT/);
  assert.match(core,/source_incident_id BIGINT NOT NULL UNIQUE REFERENCES incident_reports\(id\) ON DELETE RESTRICT/);
  assert.match(core,/state IN \('pending_acknowledgement','acknowledged','resolved'\)/);
  assert.match(core,/CHECK\(external_reporting_state='not_determined'\)/);
  assert.match(core,/trust_case_escalations_active_idx/);
  assert.doesNotMatch(core,/DELETE FROM trust_case_escalations/);
});

test('creating a severe escalation raises the case without an adverse action',async()=>{
  const calls=[];
  const db={async query(sql,args=[]){
    calls.push({sql,args});
    if(sql.includes('INSERT INTO trust_case_escalations'))return{rowCount:1,rows:[{id:17,state:'pending_acknowledgement',external_reporting_state:'not_determined'}]};
    return{rowCount:1,rows:[]};
  }};
  const result=await createIncidentSevereEscalation(db,{
    caseId:31,incidentId:71,category:'Other operational issue',urgencyIndicator:'immediate_danger',actorAccountId:12
  });
  assert.equal(result.record.id,17);
  assert.equal(result.policy.severity,'critical');
  const insert=calls.find(x=>x.sql.includes('INSERT INTO trust_case_escalations'));
  assert.equal(insert.args[2],'incident:71:severe-escalation');
  assert.equal(insert.args[7],'critical');
  assert.equal(insert.args[9],true);
  assert.ok(calls.some(x=>x.sql.includes('UPDATE trust_cases SET')));
  assert.doesNotMatch(JSON.stringify(calls),/description|criminal|guilty|suspend|ban/i);
});

test('report, case and severe route are committed as one transaction',()=>{
  const route=incidents.slice(incidents.indexOf("app.post('/api/incidents'"),incidents.indexOf("app.get('/api/incidents/mine'"));
  assert.ok(route.indexOf("client.query('BEGIN')")<route.indexOf('INSERT INTO incident_reports'));
  assert.ok(route.indexOf('ensureIncidentTrustCase')<route.indexOf('createIncidentSevereEscalation'));
  assert.ok(route.indexOf('createIncidentSevereEscalation')<route.indexOf("client.query('COMMIT')"));
  assert.match(route,/confidenceClass:'allegation'/);
  assert.match(route,/automated:true/);
  assert.match(route,/external_reporting_state:'not_determined'/);
  assert.match(route,/humanReviewed:false/);
});

test('active escalation blocks premature case closure and severity downgrade',async()=>{
  const db={async query(){return{rowCount:1,rows:[{severity:'critical',state:'pending_acknowledgement'}]}}};
  await assert.rejects(()=>assertSevereCaseTransitionAllowed(db,{caseId:4,status:'resolved',severity:'critical'}),/Resolve every active severe escalation/);
  await assert.rejects(()=>assertSevereCaseTransitionAllowed(db,{caseId:4,status:'investigating',severity:'high'}),/cannot be lower/);
  await assert.doesNotReject(()=>assertSevereCaseTransitionAllowed(db,{caseId:4,status:'investigating',severity:'critical'}));
  assert.match(admin,/assertSevereCaseTransitionAllowed\(client,\{caseId:id,status,severity\}\)/);
  assert.match(admin,/assertSevereIncidentCanClose\(client,id\)/);
});

test('acknowledgement and resolution require ordered human-reviewed transitions',async()=>{
  const ackCalls=[];
  const ackDb={async query(sql,args=[]){
    ackCalls.push({sql,args});
    if(sql.includes('FROM trust_case_escalations e JOIN trust_cases'))return{rowCount:1,rows:[{id:9,state:'pending_acknowledgement',case_status:'open',case_severity:'critical'}]};
    if(sql.includes("SET state='acknowledged'"))return{rowCount:1,rows:[{id:9,state:'acknowledged',external_reporting_state:'not_determined'}]};
    if(sql.includes('UPDATE trust_cases SET status='))return{rowCount:1,rows:[{id:5,status:'investigating',severity:'critical'}]};
    return{rowCount:1,rows:[]};
  }};
  const acknowledged=await acknowledgeSevereEscalation(ackDb,{caseId:5,escalationId:9,actorAccountId:2,rationale:'Reviewed immediate safety context'});
  assert.equal(acknowledged.escalation.state,'acknowledged');
  assert.equal(acknowledged.case.status,'investigating');

  const resolveDb={async query(sql){
    if(sql.includes('FROM trust_case_escalations e JOIN trust_cases'))return{rowCount:1,rows:[{id:9,state:'acknowledged',case_status:'investigating',case_severity:'critical'}]};
    if(sql.includes("SET state='resolved'"))return{rowCount:1,rows:[{id:9,state:'resolved',external_reporting_state:'not_determined'}]};
    return{rowCount:1,rows:[]};
  }};
  const resolved=await resolveSevereEscalation(resolveDb,{caseId:5,escalationId:9,actorAccountId:2,rationale:'Immediate risk reviewed and safety handoff documented'});
  assert.equal(resolved.escalation.state,'resolved');
  for(const path of ['acknowledge','resolve']){
    const block=admin.slice(admin.indexOf(`/escalations/:escalationId/${path}'`),admin.indexOf(`/escalations/:escalationId/${path}'`)+4200);
    assert.match(block,/human_reviewed!==true/);
    assert.ok(block.indexOf('FOR UPDATE')<block.indexOf(path==='acknowledge'?'acknowledgeSevereEscalation':'resolveSevereEscalation'));
    assert.match(block,/recordTrustAction\(client/);
    assert.match(block,/appendAdminAudit\(pool/);
  }
});

test('critical scope survives territory inference and follows Incident links',()=>{
  assert.match(cases,/e\.country_scoped=TRUE AND e\.state<>'resolved'/);
  assert.match(cases,/UPDATE trust_case_escalations SET case_id=\$1/);
  assert.match(cases,/EXISTS\(SELECT 1 FROM trust_case_escalations e WHERE e\.case_id=c\.id AND e\.state<>'resolved' AND e\.severity='critical'\)/);
  assert.match(admin,/async function effectiveIncidentTriageTerritory/);
  assert.match(admin,/WHERE e\.source_incident_id=\$1 AND e\.country_scoped=TRUE AND e\.state<>'resolved'/);
  assert.match(admin,/NOT EXISTS\(\s*SELECT 1 FROM trust_case_escalations se\s*WHERE se\.source_incident_id=i\.id AND se\.country_scoped=TRUE AND se\.state<>'resolved'/s);
  assert.match(admin,/triageTerritory=await effectiveIncidentTriageTerritory/);
  assert.match(admin,/FOR SHARE OF c/);
  assert.match(admin,/Country-level Trust & Safety authority is required for an unscoped case/);
  const caseDetail=admin.slice(admin.indexOf("app.get('/api/admin/trust-cases/:id'"),admin.indexOf("app.patch('/api/admin/trust-cases/:id'"));
  assert.doesNotMatch(caseDetail,/Promise\.all/);
  assert.match(caseDetail,/A pg Client permits one in-flight query/);
  assert.match(incidents,/if\(status>=500\)console\.error\(err\)/);
});

test('user and Admin UI state the emergency and external-reporting boundaries',()=>{
  assert.match(userUi,/Business & Life is not an emergency service/);
  assert.match(userUi,/contact the appropriate local emergency service first/i);
  assert.match(userUi,/urgency_indicator:urgencyIndicator/);
  assert.match(userUi,/does not mean an authority was contacted/);
  assert.match(adminUi,/Internal escalation only/);
  assert.match(adminUi,/does not mean an authority or emergency service was contacted/);
  assert.match(adminUi,/data-trust-escalation-action/);
  assert.match(adminUi,/\/escalations\/'\+escalationId\+'\/'\+action/);
});

test('isolated PostgreSQL runtime verifies the escalation boundary',()=>{
  assert.match(runtime,/- 'trust-safety-escalation-core\.js'/);
  assert.match(runtime,/- 'tests\/severe-escalation-v1\.test\.js'/);
  assert.match(runtime,/FROM trust_case_escalations LIMIT 0/);
  assert.match(runtime,/SELECT urgency_indicator FROM incident_reports LIMIT 0/);
  assert.match(runtime,/incident_reports_urgency_indicator_check/);
});
