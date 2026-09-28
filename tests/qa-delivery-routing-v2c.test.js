import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const qa=readFileSync(new URL('../qa-acceptance.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../server-delivery.js',import.meta.url),'utf8');
const routing=readFileSync(new URL('../delivery-routing-v2c.js',import.meta.url),'utf8');

test('Delivery Routing V2C runtime wave is registered and proves no-credential fallback',()=>{
  assert.match(qa,/DELIVERY_ROUTING_V2C_RUNTIME_WAVE='delivery_routing_v2c_runtime'/);
  assert.match(qa,/runDeliveryRoutingV2CRuntimeAcceptance/);
  assert.match(qa,/no_credential_external_calls:providerCalls/);
  assert.match(qa,/public_config_credential_free:true/);
  assert.match(qa,/motorcycle_travel_mode:route\.travel_mode/);
});

test('quote path snapshots provider evidence and copies it into Delivery',()=>{
  const start=server.indexOf("app.post('/api/delivery/quote'");
  const end=server.indexOf("app.post('/api/marketplace/checkout'",start);
  const quote=server.slice(start,end);
  assert.match(quote,/resolveDeliveryRoute/);
  assert.match(quote,/routeEvidence/);
  assert.match(quote,/provider_call_count:routeCalls/);
  assert.match(quote,/routeCalls>=2/);
  assert.match(quote,/route_evidence/);
  assert.match(server,/ALTER TABLE delivery_quotes ADD COLUMN IF NOT EXISTS route_evidence JSONB/);
  assert.match(server,/ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS route_evidence JSONB/);
  assert.match(server,/JSON\.stringify\(quote\.route_evidence\|\|\{\}\)/);
  assert.match(server,/\$21,\$22,\$23\) RETURNING id/);
});

test('routing provider remains server-only and production defaults to fallback',()=>{
  assert.match(routing,/DELIVERY_ROUTING_PROVIDER/);
  assert.match(routing,/GOOGLE_ROUTES_API_KEY/);
  assert.match(routing,/provider=configured\?'google_routes':'fallback'/);
  assert.match(routing,/X-Goog-Api-Key/);
  assert.match(routing,/X-Goog-FieldMask/);
  assert.doesNotMatch(server,/GOOGLE_ROUTES_API_KEY/);
});

test('road routing is bounded to at most two provider calls per quote',()=>{
  const start=server.indexOf("app.post('/api/delivery/quote'");
  const end=server.indexOf("app.post('/api/marketplace/checkout'",start);
  const quote=server.slice(start,end);
  const calls=(quote.match(/await resolveDeliveryRoute\(/g)||[]).length;
  assert.equal(calls,2);
  assert.match(quote,/routeEvidence\.provider_attempted/);
  assert.match(quote,/String\(selected\.route_profile\|\|''\)!==String\(routeEvidence\.route_profile\|\|''\)/);
});

test('Google route adapter never requests pricing polyline and rejects partially ignored restrictions',()=>{
  assert.match(routing,/routes\.routeRestrictionsPartiallyIgnored/);
  assert.match(routing,/ROUTE_RESTRICTIONS_PARTIALLY_IGNORED/);
  assert.doesNotMatch(routing,/routes\.polyline/);
  assert.match(routing,/provider_attempted:true/);
  assert.match(routing,/toll_status='unknown'/);
  assert.match(routing,/toll_status='none'/);
  assert.match(routing,/toll_status='estimated'/);
});
