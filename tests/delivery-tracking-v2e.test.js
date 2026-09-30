import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const server=read('server-delivery.js');
const ui=read('public/delivery-ui.js');
const core=read('delivery-tracking-v2e-core.js');

test('Delivery V2E schema stores ordered route history and opaque private proof references',()=>{
  assert.match(server,/CREATE TABLE IF NOT EXISTS delivery_location_points/);
  assert.match(server,/sequence_no INTEGER NOT NULL/);
  assert.match(server,/UNIQUE\(delivery_id,sequence_no\)/);
  assert.match(server,/accuracy_m NUMERIC/);
  assert.match(server,/heading_deg NUMERIC/);
  assert.match(server,/speed_mps NUMERIC/);
  assert.match(server,/CREATE TABLE IF NOT EXISTS delivery_proof_media/);
  assert.match(server,/private_evidence_object_id BIGINT NOT NULL REFERENCES private_evidence_objects\(id\)/);
  const schemaStart=server.indexOf('CREATE TABLE IF NOT EXISTS delivery_proof_media');
  const schemaEnd=server.indexOf(');',schemaStart);
  assert.doesNotMatch(server.slice(schemaStart,schemaEnd),/data_url|base64/i);
});

test('route writes are assigned-Courier only, lifecycle-scoped, row-locked and bounded',()=>{
  const start=server.indexOf("app.post('/api/courier/deliveries/:id/location'");
  const end=server.indexOf("app.post('/api/courier/deliveries/:id/proof'",start);
  const block=server.slice(start,end);
  assert.match(block,/FOR UPDATE/);
  assert.match(block,/courier_account_id/);
  assert.match(block,/deliveryRouteTrackingActive\(d\.status\)/);
  assert.match(block,/deliveryRoutePointDecision/);
  assert.match(block,/INSERT INTO delivery_location_points/);
  assert.match(block,/UPDATE deliveries[\s\S]*last_lat=\$1,last_lng=\$2,last_location_at=NOW/);
  assert.match(core,/DELIVERY_ROUTE_POINT_LIMIT=1000/);
  assert.match(core,/DELIVERY_ROUTE_DEDUP_SECONDS=12/);
  assert.match(core,/DELIVERY_ROUTE_DEDUP_METERS=8/);
  assert.doesNotMatch(core,/courier_assigned'.*DELIVERY_ROUTE_TRACKING_STATES/s);
});

test('normal route visibility is participant-scoped and closes at terminal state',()=>{
  const start=server.indexOf("app.get('/api/delivery/:id/route'");
  const end=server.indexOf("app.get('/api/delivery/:id/proofs'",start);
  const block=server.slice(start,end);
  assert.match(block,/allowedDelivery\(req,d\)/);
  assert.match(block,/deliveryRouteTrackingActive\(d\.status\)/);
  assert.match(block,/points:\[\]/);
  assert.match(server,/app\.get\('\/api\/admin\/deliveries\/:id\/route-evidence'/);
  assert.match(server,/admin_route_evidence_viewed/);
  assert.match(server,/scopedAdminDelivery/);
});

test('pickup and delivery proof photos use private evidence storage and lifecycle rules',()=>{
  const start=server.indexOf("app.post('/api/courier/deliveries/:id/proof'");
  const end=server.indexOf("app.post('/api/courier/deliveries/:id/complete'",start);
  const block=server.slice(start,end);
  assert.match(block,/deliveryProofAllowed\(proofType,d\.status\)/);
  assert.match(block,/storePrivateEvidence\(pool/);
  assert.match(block,/classification:'delivery_proof'/);
  assert.match(block,/sourceType:'delivery_proof'/);
  assert.match(block,/bindPrivateEvidenceSource/);
  assert.match(block,/deletePrivateEvidence/);
  assert.match(block,/MAX_DELIVERY_PROOFS_PER_TYPE/);
  assert.doesNotMatch(block,/INSERT INTO delivery_proof_media[\s\S]*evidence_data_url/);
});

test('proof reads are proxied privately and Admin evidence access is audited',()=>{
  assert.match(server,/app\.get\('\/api\/delivery\/:id\/proofs\/:proofId\/file'/);
  assert.match(server,/readPrivateEvidence\(pool/);
  assert.match(server,/sendPrivateEvidence\(res,evidence\)/);
  assert.match(server,/app\.get\('\/api\/admin\/deliveries\/:id\/proofs\/:proofId\/file'/);
  assert.match(server,/admin_delivery_proof_viewed/);
});

test('completion code remains authoritative and terminal completion clears live location',()=>{
  const start=server.indexOf("app.post('/api/courier/deliveries/:id/complete'");
  const end=server.indexOf("app.get('/api/delivery/mine'",start);
  const block=server.slice(start,end);
  assert.match(block,/completion_code/);
  assert.match(block,/Customer delivery code is incorrect/);
  assert.match(block,/status='delivered'/);
  assert.match(block,/last_lat=NULL,last_lng=NULL,last_location_at=NULL/);
  assert.doesNotMatch(block,/proof.*required/i);
});

test('Android-first Delivery UI renders route polyline and camera proof capture',()=>{
  assert.match(ui,/L\.polyline\(route\)/);
  assert.match(ui,/\/api\/delivery\/\$\{key\}\/route\?after_sequence=/);
  assert.match(ui,/route_points:safeRoute/);
  assert.match(ui,/data-upload-proof/);
  assert.match(ui,/capture="environment"/);
  assert.match(ui,/accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(ui,/Private operational evidence only/);
  assert.match(ui,/Customer handoff code is still required/);
});

test('Courier cannot share route before Start route and device telemetry remains job scoped',()=>{
  const actionStart=ui.indexOf('function courierActionButtons');
  const actionEnd=ui.indexOf('async function openCustomerDelivery',actionStart);
  const actions=ui.slice(actionStart,actionEnd);
  assert.doesNotMatch(actions,/\['courier_assigned'.*data-share-location/s);
  assert.match(actions,/courier_en_route_to_merchant/);
  assert.match(ui,/delWatchDeliveryId/);
  assert.match(ui,/stopLocationWatch/);
  assert.match(ui,/accuracy_m:p\.accuracy/);
  assert.match(ui,/heading_deg:p\.heading/);
  assert.match(ui,/speed_mps:p\.speed/);
});
