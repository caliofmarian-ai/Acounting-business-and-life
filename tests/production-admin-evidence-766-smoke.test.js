import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const script=readFileSync(new URL('../scripts/production-admin-evidence-766-smoke.js',import.meta.url),'utf8');

test('Production Admin Evidence smoke is read-only and Production-gated',()=>{
  assert.match(script,/RAILWAY_ENVIRONMENT_NAME!=='production'/);
  assert.match(script,/NODE_ENV!=='production'/);
  assert.match(script,/read_only:true/);
  assert.match(script,/real_money:false/);
  assert.doesNotMatch(script,/\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bCOMMIT\b|\bROLLBACK\b/i);
});

test('Production Admin Evidence smoke verifies all #766 evidence families without private payloads',()=>{
  for(const marker of [
    'delivery_pricing_rules','delivery_vehicle_pricing_rules','created_by_name',
    'admin_audit_events','actor_account_id','target_type','target_id','correlation_id',
    'profile_applications','profile_application_reviews','application_id=pa.id',
    'evidence_attested','adult_eligibility_attested','approved_category_ids',
    'currentReleaseEvidence','source_issue!==758',
    'PRODUCTION_ADMIN_EVIDENCE_766_SMOKE_RESULT'
  ])assert.ok(script.includes(marker),'missing #766 Production evidence marker: '+marker);
  assert.doesNotMatch(script,/private_evidence_objects|evidence_data_url|original_file_name|detected_mime/);
});
