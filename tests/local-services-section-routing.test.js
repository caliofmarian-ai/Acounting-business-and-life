import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const shell=read('public/shell.js');
const ui=read('public/services-ui.js');
const server=read('server-services.js');

test('Local Services shell declares six distinct provider destinations',()=>{
  for(const feature of ['Profile','Services','Qualifications','Quotes','Jobs','Reviews']){
    assert.match(shell,new RegExp("['\"]"+feature+"['\"]"));
    assert.match(ui,new RegExp(feature));
  }
  assert.match(ui,/openProviderWorkspace\(b\.dataset\.hubFeature\)/);
});

test('provider workspace uses the selected section instead of rendering one combined page',()=>{
  assert.match(ui,/PROVIDER_SECTION_META/);
  assert.match(ui,/svcProviderSection=normalized/);
  assert.match(ui,/normalized==='Profile'/);
  assert.match(ui,/normalized==='Services'/);
  assert.match(ui,/normalized==='Qualifications'/);
  assert.match(ui,/normalized==='Reviews'/);
  assert.match(ui,/providerJobsPanel\(mine,normalized\)/);
  assert.doesNotMatch(ui,/profileEditor\(data\)\+servicesEditor\(data\)\+credentialsEditor\(data\)/);
});

test('quotes and jobs are separated by real service-job lifecycle states',()=>{
  assert.match(ui,/quoteStates=new Set\(\['requested','provider_reviewing','quoted'\]\)/);
  assert.match(ui,/jobStates=new Set\(\['accepted','scheduled','in_progress','completed','cancelled','disputed'\]\)/);
  assert.match(ui,/\['accepted','scheduled'\]\.includes\(j\.status\)/);
  assert.match(ui,/openProviderWorkspace\(svcProviderSection\)/);
});

test('Reviews section is backed by published verified job reviews',()=>{
  assert.match(server,/FROM service_reviews r/);
  assert.match(server,/r\.moderation_status='published'/);
  assert.match(server,/reviewer_name/);
  assert.match(server,/reviews:reviews\.rows/);
  assert.match(ui,/providerReviewsPanel/);
  assert.match(ui,/No published verified reviews yet/);
  assert.match(ui,/customer-confirmed completed service job/);
});
