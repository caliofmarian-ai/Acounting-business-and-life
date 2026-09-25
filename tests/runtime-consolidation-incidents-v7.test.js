import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const incidents=read('server-incidents.js');
const finance=read('server-delivery-finance.js'),delivery=read('server-delivery.js'),suppliers=read('server-suppliers.js'),services=read('server-services.js'),marketplace=read('server-marketplace.js');
const orders=read('server-orders.js');
const auth=read('server-auth.js');
const hardening=read('server-auth-hardening.js');
const admin=read('server-admin-operations.js');
const notifications=read('server-notifications.js');

test('Incidents exposes embedded lifecycle and remains standalone rollback-capable',()=>{
  assert.match(incidents,/export async function startEmbeddedIncidents\(\)/);
  assert.match(incidents,/export async function stopEmbeddedIncidents\(\)/);
  assert.match(incidents,/startEmbeddedDeliveryFinance/);
  assert.match(incidents,/deliveryFinanceApp=await startEmbeddedDeliveryFinance\(\)/);
  assert.doesNotMatch(incidents,/INTERNAL_FINANCE_PORT/);
  assert.doesNotMatch(incidents,/3807/);
  assert.match(incidents,/Business & Life incidents mounted in-process/);
  assert.match(incidents,/directExecution/);
  assert.match(incidents,/Business & Life incident gateway listening on/);
});

test('Auth Hardening embeds Incidents and composed runtime retires localhost 3907',()=>{
  assert.match(hardening,/incidentsFetch,startEmbeddedIncidents,stopEmbeddedIncidents/);
  assert.match(hardening,/incidentsApp=await startEmbeddedIncidents\(\)/);
  assert.match(hardening,/return incidentsApp\(req,res,next\)/);
  assert.doesNotMatch(hardening,/INTERNAL_INCIDENTS_PORT/);
  assert.doesNotMatch(hardening,/\|\|\s*3907/);
  assert.doesNotMatch(hardening,/127\.0\.0\.1:3907/);
  assert.doesNotMatch(hardening,/spawn\(process\.execPath, \['server-incidents\.js'\]/);
  assert.doesNotMatch(hardening,/Incident child failed health check/);
});

test('Incident fetch-like facade refuses to bypass Incident-owned routes',()=>{
  assert.match(incidents,/export function isIncidentOwnedPath/);
  assert.match(incidents,/pathname==='\/api\/incidents'/);
  assert.match(incidents,/pathname\.startsWith\('\/api\/incidents\/'\)/);
  assert.match(incidents,/pathname==='\/api\/admin\/incidents'/);
  assert.match(incidents,/INCIDENT_EMBEDDED_DISPATCH_REQUIRED/);
  assert.match(incidents,/return downstreamFetch\(path,options\)/);
});

test('Incident routes and assets remain owned by server-incidents',()=>{
  for(const marker of [
    "app.post('/api/incidents'",
    "app.get('/api/incidents/mine'",
    "app.get('/api/incidents/:id'",
    "app.get('/api/incidents/:id/attachments/:attachmentId'",
    "app.post('/api/incidents/:id/note'",
    "app.get('/api/admin/incidents'",
    "app.patch('/api/admin/incidents/:id'",
    "app.get('/incidents.css'",
    "app.get('/incidents-ui.js'"
  ])assert.ok(incidents.includes(marker),`missing Incident marker: ${marker}`);
});

test('parsed request bodies stay in-process without a legacy Accounting HTTP boundary',()=>{
  assert.match(incidents,/const body = \(req,res,next\) => req\.body !== undefined \? next\(\) : jsonBody\(req,res,next\)/);
  assert.match(finance,/const body = \(req,res,next\) => req\.body !== undefined \? next\(\) : jsonBody\(req,res,next\)/);
  assert.match(delivery,/const body = \(req,res,next\) => req\.body !== undefined \? next\(\) : jsonBody\(req,res,next\)/);
  assert.match(suppliers,/const body = \(req,res,next\) => req\.body !== undefined \? next\(\) : jsonBody\(req,res,next\)/);
  assert.match(services,/const body = \(req,res,next\) => req\.body !== undefined \? next\(\) : jsonBody\(req,res,next\)/);
  assert.match(marketplace,/const body = \(req,res,next\) => req\.body !== undefined \? next\(\) : jsonBody\(req,res,next\)/);
  assert.match(orders,/const body = \(req,res,next\) => req\.body !== undefined \? next\(\) : jsonBody\(req,res,next\)/);
  assert.doesNotMatch(orders,/const parsedJsonBody=req\.body!==undefined/);
  assert.doesNotMatch(auth,/INTERNAL_ACCOUNTING_PORT/);
  assert.doesNotMatch(auth,/\|\|\s*3107/);
  assert.doesNotMatch(auth,/server-v03\.js/);
  assert.doesNotMatch(auth,/const rawPayload=Buffer\.isBuffer\(req\.rawBody\)/);
  assert.doesNotMatch(auth,/http\.request/);
  assert.match(auth,/No Account\/Auth route owns this request/);
});

test('Admin incident creation traverses the embedded chain instead of fetch-bypassing Incidents',()=>{
  const route=admin.slice(admin.indexOf("app.post('/api/incidents'"),admin.indexOf("app.post('/api/governance/admin/territories'",admin.indexOf("app.post('/api/incidents'")));
  assert.match(route,/dispatchBusinessAccounting\(req,res/);
  assert.match(route,/afterSuccess:async\(_status,data\)/);
  assert.doesNotMatch(route,/upstream\('\/api\/incidents'/);
  assert.match(admin,/afterSuccess\?afterSuccess\(status,responseBody,payload\)/);
});

test('V7 preserves security policy in front and raw-body webhook ownership above',()=>{
  assert.match(hardening,/hardeningPolicyResponse/);
  assert.match(hardening,/PIN login has been retired from the public app/);
  assert.match(hardening,/Legacy PIN session expired/);
  assert.match(notifications,/app\.post\('\/api\/notifications\/webhooks\/resend',express\.raw/);
  assert.match(notifications,/verifyResendWebhook/);
});
