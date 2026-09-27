import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const incidentsServer=read('server-incidents.js');
const adminServer=read('server-admin-operations.js');
const incidentsUi=read('public/incidents-ui.js');
const marketplaceUi=read('public/marketplace-ui.js');
const servicesUi=read('public/services-ui.js');
const loader=read('public/mobile-feature-loader.js');
const marketplaceCss=read('public/marketplace.css');
const servicesCss=read('public/services.css');

test('contextual Incident relations are canonical and migrated safely',()=>{
  assert.match(incidentsServer,/RELATED_TYPES[^\n]+marketplace_product/);
  assert.match(incidentsServer,/DROP CONSTRAINT IF EXISTS incident_reports_related_type_check/);
  assert.match(incidentsServer,/ADD CONSTRAINT incident_reports_related_type_check[\s\S]{0,240}marketplace_product/);
});

test('Merchant, product and Service Provider targets are validated before persistence',()=>{
  const validation=incidentsServer.slice(incidentsServer.indexOf('async function validateIncidentRelation'),incidentsServer.indexOf('async function initDb'));
  assert.match(validation,/SELECT 1 FROM businesses WHERE id=\$1/);
  assert.match(validation,/SELECT 1 FROM marketplace_products WHERE id=\$1/);
  assert.match(validation,/SELECT 1 FROM service_provider_profiles WHERE account_id=\$1/);
  assert.match(validation,/status:404/);
  const route=incidentsServer.slice(incidentsServer.indexOf("app.post('/api/incidents'"),incidentsServer.indexOf("app.get('/api/incidents/mine'"));
  assert.ok(route.indexOf('validateIncidentRelation')<route.indexOf('INSERT INTO incident_reports'));
});

test('contextual reports are routed into the delegated territory queue',()=>{
  for(const type of ['merchant','marketplace_product','service_provider']){
    assert.match(adminServer,new RegExp("relatedType==='"+type+"'"));
    assert.match(adminServer,new RegExp("related_type='"+type+"'"));
  }
  assert.match(adminServer,/marketplace_products p JOIN businesses b ON b\.id=p\.business_id/);
  assert.match(adminServer,/profile_authorizations WHERE account_id=\$1 AND role='service_provider'/);
});

test('Incident UI exposes a fixed contextual report API without publishing allegations',()=>{
  assert.match(incidentsUi,/window\.BusinessLifeIncidents=Object\.freeze\(\{openReport,openMyIncidents,openAdminIncidents\}\)/);
  assert.match(incidentsUi,/CONTEXTUAL_REPORT_TYPES[^\n]+merchant[^\n]+marketplace_product[^\n]+service_provider/);
  assert.match(incidentsUi,/The target is fixed for this contextual report/);
  assert.match(incidentsUi,/Submitting a report does not automatically remove content, punish another user or publish an accusation/);
  for(const category of ['Illegal / restricted item or service','Counterfeit / IP concern','Stolen-goods concern','False licence / credential','Harassment / threat','Privacy / data misuse','Exploitation concern'])assert.match(incidentsUi,new RegExp(category.replaceAll('/','\\/')));
  const submit=incidentsUi.slice(incidentsUi.indexOf('function bindIncidentForm'),incidentsUi.indexOf('async function openIncidentDetail'));
  assert.doesNotMatch(submit,/display_label/);
});

test('Marketplace and Local Services load private contextual reporting on demand',()=>{
  assert.match(loader,/async function openSafetyReport\(context\)/);
  assert.match(loader,/await loadFeature\('incidents'\)/);
  assert.match(loader,/api\.openReport\(context\)/);
  assert.match(marketplaceUi,/data-report-product/);
  assert.match(marketplaceUi,/related_type:'merchant'/);
  assert.match(marketplaceUi,/related_type:'marketplace_product'/);
  assert.match(servicesUi,/id="reportProvider"/);
  assert.match(servicesUi,/related_type:'service_provider'/);
  assert.match(marketplaceCss,/\.marketSafetyAction,\.marketProductReport\{min-height:44px/);
  assert.doesNotMatch(marketplaceCss,/\.marketProductReport\{[^}]*min-height:(?:3[0-9]|4[0-3])px/);
  assert.match(servicesCss,/\.serviceSafetyAction[^}]*min-height:44px/);
});
