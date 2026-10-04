import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const adminServer=read('server-admin-operations.js');
const adminUi=read('public/admin-console.js');
const deliveryServer=read('server-delivery.js');
const governance=read('server-profile-governance.js');
const towerRuntime=read('owner-control-tower-runtime.js');
const towerUi=read('public/owner-control-tower.js');

test('Owner Control Tower exposes source-linked Production release evidence and explicit unavailable reasons',()=>{
  assert.match(towerRuntime,/currentReleaseEvidence/);
  assert.match(towerRuntime,/release_quality:'available'/);
  assert.match(towerRuntime,/owner_decisions:'available'/);
  assert.match(towerUi,/id="ownerReleaseEvidence"/);
  assert.match(towerUi,/Production regressions/);
  assert.match(towerUi,/unavailable_reasons/);
  assert.match(adminUi,/source==='release_evidence'/);
});

test('active delivery tariff is inspectable without editing the immutable version',()=>{
  assert.match(deliveryServer,/creator\.display_name created_by_name/);
  assert.match(adminUi,/ACTIVE IMMUTABLE TARIFF/);
  for(const marker of [
    'base_fee','per_km','per_kg','per_liter','minimum_fee','maximum_distance_km',
    'max_weight_kg','max_volume_l','included_distance_km','distance_bands',
    'extra_stop_fee','free_wait_minutes','waiting_fee_per_minute',
    'demand_adjustment_cap_pct','route_profile','expressway_eligible',
    'toll_policy','parking_policy','stacking_policy'
  ])assert.ok(adminUi.includes(marker),'missing active tariff field: '+marker);
  assert.match(adminUi,/Save and activate new version/);
});

test('Admin audit returns and renders safe actor, target, territory and request correlation context',()=>{
  const endpoint=adminServer.slice(adminServer.indexOf("app.get('/api/admin/audit'"),adminServer.indexOf("app.get('/api/support/assist/status'"));
  for(const marker of ['actor_account_id','actor_name','target_type','target_id','territory_name','correlation_id'])assert.ok(endpoint.includes(marker),'missing audit field: '+marker);
  assert.doesNotMatch(endpoint,/before_json|after_json/);
  assert.match(adminUi,/Actor /);
  assert.match(adminUi,/Target /);
  assert.match(adminUi,/Request /);
  assert.match(adminUi,/Country scope/);
});

test('application review history reconstructs decision actor, transition, attestation and request correlation',()=>{
  const history=governance.slice(governance.indexOf('async function applicationReviewHistory'),governance.indexOf('async function applicationSnapshot'));
  assert.match(history,/reviewer_account_id/);
  assert.match(history,/reviewer_name/);
  assert.match(history,/reviewer_note/);
  assert.match(history,/evidence_attested/);
  assert.match(history,/adult_eligibility_attested/);
  assert.match(history,/approved_category_ids/);
  assert.match(history,/correlation_id/);
  assert.match(adminUi,/Decision reference/);
  assert.match(adminUi,/State: /);
  assert.match(adminUi,/Review #/);
  assert.match(adminUi,/Request /);
});
