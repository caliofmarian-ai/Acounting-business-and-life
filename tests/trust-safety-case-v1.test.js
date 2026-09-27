import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  ensureIncidentTrustCase,
  incidentCaseType,
  linkIncidentToTrustCase,
  privacySafeRiskDetails,
  trustCaseSeverity,
  trustCaseStatus
} from '../trust-safety-case-core.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const core=read('trust-safety-case-core.js');
const incidents=read('server-incidents.js');
const admin=read('server-admin-operations.js');
const ui=read('public/admin-console.js');
const adminRuntime=read('.github/workflows/admin-runtime.yml');

function fakeCaseDb(){
  const calls=[];
  return{
    calls,
    async query(sql,args=[]){
      calls.push({sql,args});
      if(sql.includes('SELECT * FROM incident_reports'))return{rowCount:1,rows:[{
        id:71,reporter_account_id:12,related_type:'marketplace_product',related_id:88,
        category:'Marketplace scam concern',status:'submitted',territory_id:9
      }]};
      if(sql.includes('INSERT INTO trust_cases'))return{rowCount:1,rows:[{id:31,public_id:'TSC-I71',status:'open',severity:'moderate',territory_id:9}]};
      if(sql.includes('INSERT INTO trust_risk_events'))return{rowCount:1,rows:[{id:41}]};
      return{rowCount:1,rows:[]};
    }
  };
}

test('case schema preserves canonical cases, entities, risk events, actions and source Incidents',()=>{
  for(const table of ['trust_cases','trust_case_entities','trust_risk_events','trust_actions'])assert.match(core,new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(core,/ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS trust_case_id/);
  assert.match(core,/ON CONFLICT\(source_incident_id\) DO NOTHING/);
  assert.match(core,/UPDATE incident_reports i SET trust_case_id=c\.id/);
  assert.match(core,/confidence_class IN \('allegation','system_signal','corroborated','verified'\)/);
  assert.match(core,/case_id BIGINT NOT NULL REFERENCES trust_cases\(id\) ON DELETE RESTRICT/);
  assert.doesNotMatch(core,/criminal_score|risk_score|guilt_score/i);
  assert.doesNotMatch(core,/DELETE FROM (?:incident_reports|trust_cases|trust_risk_events|trust_actions)/);
});

test('new Incident creates one allegation case and privacy-safe event inside the caller transaction',async()=>{
  const db=fakeCaseDb();
  const result=await ensureIncidentTrustCase(db,{incidentId:71,actorAccountId:12,sourceSurface:'incident_report',correlationId:'request-7'});
  assert.equal(result.id,31);
  const caseInsert=db.calls.find(x=>x.sql.includes('INSERT INTO trust_cases'));
  assert.equal(caseInsert.args[0],'TSC-I71');
  assert.equal(caseInsert.args[1],'fraud_or_identity');
  assert.equal(caseInsert.args[2],'Fraud or identity report');
  const entities=db.calls.filter(x=>x.sql.includes('INSERT INTO trust_case_entities'));
  assert.equal(entities.length,3);
  assert.deepEqual(entities.map(x=>x.args.slice(1,4)),[
    ['incident','71','source'],['account','12','reporter'],['marketplace_product','88','reported_subject']
  ]);
  const event=db.calls.find(x=>x.sql.includes('INSERT INTO trust_risk_events'));
  assert.equal(event.args[1],'incident:71:submitted');
  assert.equal(event.args[7],'allegation');
  assert.doesNotMatch(JSON.stringify(event.args),/Marketplace scam concern|@|data:/);
});

test('risk detail boundary rejects direct identifiers and active payloads',()=>{
  assert.deepEqual(privacySafeRiskDetails({report_status:'allegation',attempt_count:2}),{report_status:'allegation',attempt_count:2});
  for(const details of [
    {email:'person@example.com'},
    {network:'203.0.113.9'},
    {contact:'+63 912 345 6789'},
    {payload:'data:image/png;base64,AAAA'},
    {latitude:14.6}
  ])assert.throws(()=>privacySafeRiskDetails(details),/prohibited sensitive/);
  assert.throws(()=>privacySafeRiskDetails({nested:{raw:'value'}}),/scalar values only/);
});

test('case classifications are categorical and status/severity are closed registries',()=>{
  assert.equal(incidentCaseType('Harassment / threat'),'personal_safety');
  assert.equal(incidentCaseType('Refund fraud'),'payment_abuse');
  assert.equal(incidentCaseType('Privacy concern'),'privacy_safety');
  assert.equal(trustCaseStatus('investigating'),'investigating');
  assert.equal(trustCaseSeverity('critical'),'critical');
  assert.throws(()=>trustCaseStatus('convicted'));
  assert.throws(()=>trustCaseSeverity('criminal'));
});

test('Incident and Support creation attach the case before commit',()=>{
  const incidentRoute=incidents.slice(incidents.indexOf("app.post('/api/incidents'"),incidents.indexOf("app.get('/api/incidents/mine'"));
  assert.ok(incidentRoute.indexOf('ensureIncidentTrustCase')>incidentRoute.indexOf('INSERT INTO incident_reports'));
  assert.ok(incidentRoute.indexOf('ensureIncidentTrustCase')<incidentRoute.indexOf("client.query('COMMIT')"));
  const supportRoute=admin.slice(admin.indexOf("app.post('/api/admin/support/:id/escalate'"),admin.indexOf("app.get('/api/admin/trust-cases'"));
  assert.ok(supportRoute.indexOf("client.query('BEGIN')")<supportRoute.indexOf('INSERT INTO incident_reports'));
  assert.ok(supportRoute.indexOf('ensureIncidentTrustCase')<supportRoute.lastIndexOf("client.query('COMMIT')"));
  assert.match(admin,/syncIncidentTrustCaseTerritory/);
});

test('delegated case queue is territory-scoped and prioritizes severity without a score',()=>{
  const queue=admin.slice(admin.indexOf("app.get('/api/admin/trust-cases'"),admin.indexOf("app.get('/api/admin/trust-cases/:id'"));
  assert.match(queue,/visibleTerritoryIds\(pool,me\.account\.id,'incident\.triage'\)/);
  assert.match(queue,/c\.territory_id=ANY\(\$1::bigint\[\]\)/);
  assert.match(queue,/WHEN 'critical' THEN 0 WHEN 'high' THEN 1/);
  assert.doesNotMatch(queue,/score/i);
  assert.match(admin,/Country-level Trust & Safety authority is required for an unscoped case/);
});

test('case review and multi-Incident link require human review and append audit history',()=>{
  const update=admin.slice(admin.indexOf("app.patch('/api/admin/trust-cases/:id'"),admin.indexOf("app.post('/api/admin/trust-cases/:id/incidents'"));
  assert.match(update,/human_reviewed!==true/);
  assert.match(update,/recordTrustAction\(client/);
  assert.match(update,/eventCode:'trust_case_reviewed'/);
  const link=admin.slice(admin.indexOf("app.post('/api/admin/trust-cases/:id/incidents'"),admin.indexOf("app.get('/api/admin/incidents'"));
  assert.match(link,/human_reviewed!==true/);
  assert.match(link,/SELECT \* FROM trust_cases WHERE id=\$1 FOR UPDATE/);
  assert.match(link,/SELECT \* FROM incident_reports WHERE id=\$1 FOR UPDATE/);
  assert.match(link,/linkIncidentToTrustCase\(client/);
  assert.match(link,/Country-level Trust & Safety authority is required to link Incidents across territory scopes/);
  assert.match(core,/status='linked',merged_into_case_id=\$1/);
  assert.match(core,/SELECT COUNT\(\*\)::int n FROM incident_reports WHERE trust_case_id=\$1/);
  assert.match(core,/target\.territory_id==null\|\|incident\.territory_id==null/);
  assert.match(admin,/routeId\(req\.params\.id,'Trust & Safety case'\)/);
});

test('linking an unscoped Incident makes the combined case country-scoped',async()=>{
  const calls=[];
  const db={async query(sql,args=[]){
    calls.push({sql,args});
    if(sql.includes('SELECT * FROM trust_cases WHERE id=$1 FOR UPDATE')){
      const id=Number(args[0]);
      return{rowCount:1,rows:[id===31?{id:31,status:'open',severity:'moderate',territory_id:9}:{id:32,status:'open',severity:'moderate',territory_id:null}]};
    }
    if(sql.includes('SELECT * FROM incident_reports'))return{rowCount:1,rows:[{id:72,reporter_account_id:13,related_type:'other',related_id:null,status:'submitted',territory_id:null,trust_case_id:32}]};
    if(sql.includes('SELECT COUNT(*)::int n'))return{rowCount:1,rows:[{n:0}]};
    if(sql.includes("UPDATE trust_cases SET status='linked'"))return{rowCount:1,rows:[{id:32,status:'linked',severity:'moderate'}]};
    if(sql.includes('INSERT INTO trust_risk_events'))return{rowCount:1,rows:[{id:91}]};
    if(sql.includes('INSERT INTO trust_actions'))return{rowCount:1,rows:[{id:92}]};
    return{rowCount:1,rows:[]};
  }};
  await linkIncidentToTrustCase(db,{caseId:31,incidentId:72,actorAccountId:4,rationale:'Reports share reviewed evidence'});
  assert.ok(calls.some(x=>x.sql.includes('UPDATE trust_cases SET territory_id=NULL')&&Number(x.args[0])===31));
});

test('case and evidence reads create independent sensitive-access audit events',()=>{
  assert.match(admin,/eventCode:'trust_case_viewed'/);
  assert.match(admin,/eventCode:'incident_viewed'/);
  assert.match(admin,/eventCode:'incident_attachment_viewed'/);
});

test('Admin Trust & Safety UI exposes cases, linked reports and explicit review boundaries',()=>{
  assert.match(ui,/\/api\/admin\/trust-cases/);
  assert.match(ui,/data-admin-trust-case/);
  assert.match(ui,/Reports remain allegations until reviewed/);
  assert.match(ui,/No restriction is applied automatically from this case/);
  assert.match(ui,/Link another Incident/);
  assert.match(ui,/human_reviewed/);
  assert.match(ui,/openCase:async caseId/);
});

test('isolated PostgreSQL runtime contract watches and verifies the case schema',()=>{
  assert.match(adminRuntime,/- 'trust-safety-case-core\.js'/);
  assert.match(adminRuntime,/- 'tests\/trust-safety-case-v1\.test\.js'/);
  assert.match(adminRuntime,/Verify Trust and Safety case schema/);
  for(const table of ['trust_cases','trust_case_entities','trust_risk_events','trust_actions']){
    assert.match(adminRuntime,new RegExp(`FROM ${table} LIMIT 0`));
  }
  assert.match(adminRuntime,/SELECT trust_case_id FROM incident_reports LIMIT 0/);
});
