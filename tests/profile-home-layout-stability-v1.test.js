import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const shell=read('public/shell.js');
const css=read('public/shell.css');

function between(source,start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a+1);
  assert.ok(a>=0&&b>a,'expected block '+start+' → '+end);
  return source.slice(a,b);
}

test('Customer Courier and Local Services use one shared structural Home skeleton',()=>{
  assert.match(shell,/function profileHomeLoadingMarkup\(id,stateClass,title,detail\)/);
  assert.match(shell,/profileHomeSkeletonCard/);
  assert.match(shell,/profileHomeSkeletonMiniGrid/);
  assert.match(shell,/profileHomeLoadingMarkup\('customerHomeLoading','customerHomeState'/);
  assert.match(shell,/profileHomeLoadingMarkup\('courierHomeLoading','courierHomeState'/);
  assert.match(shell,/profileHomeLoadingMarkup\('serviceProviderHomeLoading','serviceProviderHomeState'/);
});

test('Home loading skeleton contains no invented domain values',()=>{
  const block=between(shell,'function profileHomeLoadingMarkup','function setProfileHomeRefreshBusy');
  assert.doesNotMatch(block,/₱|PHP|ETA|approved|available|jobs?\s*[:=]\s*\d|orders?\s*[:=]\s*\d|%|balance/i);
  assert.match(block,/aria-hidden="true"/);
});

test('manual refresh keeps ready content in place and uses the toolbar button as progress UI',()=>{
  assert.match(shell,/function setProfileHomeRefreshBusy\(hub,id,busy\)/);
  for(const [load,button,dynamic] of [
    ['loadCustomerHome','customerHomeRefresh','customerHomeDynamic'],
    ['loadCourierHome','courierHomeRefresh','courierHomeDynamic'],
    ['loadServiceProviderHome','serviceProviderHomeRefresh','serviceProviderHomeDynamic']
  ]){
    const start=shell.indexOf('async function '+load+'(');
    const end=shell.indexOf('\n}',start)+2;
    const block=shell.slice(start,end);
    assert.match(block,new RegExp("querySelector\\('#"+dynamic+"'\\)"));
    assert.match(block,/if\(force\)\{/);
    assert.match(block,/if\(dynamic\?\.classList\.contains\('hidden'\)\)loading\?\.classList\.remove\('hidden'\)/);
    assert.match(block,new RegExp("setProfileHomeRefreshBusy\\(hub,'"+button+"',true\\)"));
    assert.match(block,new RegExp("setProfileHomeRefreshBusy\\(hub,'"+button+"',false\\)"));
    assert.match(block,/if\(!force\)dynamic\?\.classList\.add\('hidden'\)/);
  }
});

test('parallel Home data loading contracts remain unchanged',()=>{
  const customer=between(shell,'async function loadCustomerHomeData','function customerHomeActivities');
  assert.match(customer,/Promise\.allSettled\(\[/);
  const courier=between(shell,'async function loadCourierHomeData','function courierHomeSettlementStatus');
  assert.match(courier,/Promise\.allSettled\(\[/);
  const services=between(shell,'async function loadServiceProviderHomeData','function serviceProviderHomeReadiness');
  assert.match(services,/Promise\.allSettled\(\[/);
});

test('shared Home skeleton reserves multi-card geometry and respects reduced motion',()=>{
  assert.match(css,/\.profileHomeSkeleton\{display:grid;gap:10px\}/);
  assert.match(css,/\.profileHomeSkeletonCard\{[^}]*min-height:86px/);
  assert.match(css,/\.profileHomeSkeletonCardTall\{min-height:110px\}/);
  assert.match(css,/\.profileHomeSkeletonMiniGrid\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});
