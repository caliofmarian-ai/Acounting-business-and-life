import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const qa=readFileSync(new URL('../qa-acceptance.js',import.meta.url),'utf8');

test('Incident Runtime V7 has a focused acceptance wave',()=>{
  assert.match(qa,/const INCIDENT_RUNTIME_V7_WAVE='incident_runtime_v7'/);
  assert.match(qa,/runIncidentRuntimeV7Acceptance/);
  assert.match(qa,/config\.wave===INCIDENT_RUNTIME_V7_WAVE/);
  assert.match(qa,/wave:INCIDENT_RUNTIME_V7_WAVE/);
});

test('Incident Runtime V7 acceptance covers ownership evidence and scoped triage',()=>{
  for(const marker of [
    "'/api/incidents'",
    "'/api/incidents/mine'",
    "'/api/incidents/'",
    "'/api/admin/assignments'",
    "'trust_safety'",
    "'incident.triage'",
    "'/api/admin/incidents/'",
    "'investigating'",
    "QA_INCIDENT_EVIDENCE"
  ])assert.ok(qa.includes(marker),`missing Incident V7 acceptance marker: ${marker}`);
  assert.match(qa,/expectStatus\(crossAccount,403/);
  assert.match(qa,/attachment_authorization:true/);
  assert.match(qa,/scoped_admin_triage:true/);
  assert.match(qa,/QA credential restore failed/);
});

test('Incident Runtime V7 acceptance proves the severe-escalation Preview gate',()=>{
  for(const marker of [
    "urgency_indicator:'payment_fraud_or_money_mule'",
    "category:'Exploitation concern'",
    "'ph-severe-escalation-v1'",
    "'child_vulnerable_safety'",
    "'/api/admin/trust-cases?severity=critical'",
    "'pending_acknowledgement'",
    "'severe_escalation_acknowledged'",
    "'severe_escalation_resolved'",
    "external_reporting_not_determined:true"
  ])assert.ok(qa.includes(marker),`missing severe Incident V7 acceptance marker: ${marker}`);
  assert.match(qa,/expectStatus\(territorySevereRead,403/);
  assert.match(qa,/expectStatus\(territoryCaseRead,403/);
  assert.match(qa,/expectStatus\(prematureResolution,409/);
  assert.match(qa,/expectStatus\(prematureIncidentClose,409/);
  assert.match(qa,/expectStatus\(prematureCaseDowngrade,409/);
  assert.match(qa,/expectStatus\(unconfirmedAcknowledgement,400/);
  assert.match(qa,/expectStatus\(acknowledged,200/);
  assert.match(qa,/expectStatus\(escalationResolved,200/);
  assert.match(qa,/expectStatus\(restoredTerritoryRead,200/);
  assert.match(qa,/admin_audit_evidence:true/);
});
