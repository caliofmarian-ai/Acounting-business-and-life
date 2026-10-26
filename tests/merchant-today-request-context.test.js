import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/v03.js',import.meta.url),'utf8');
const todayStart=source.indexOf('let merchantTodayCache=null;');
const todayEnd=source.indexOf('async function openMerchantAction',todayStart);
const lifecycleStart=source.indexOf("document.addEventListener('abl:profile-state',event=>{");
const lifecycleEnd=source.indexOf("window.addEventListener('online'",lifecycleStart);

function todayHarness(){
  const nodes=new Map(),listeners=new Map(),events=[],requests=[];
  const accounting={role:'merchant',activeBusinessId:1};
  function node(id){
    if(!nodes.has(id)){
      const classes=new Set(id==='todayContent'||id==='todayError'?['hidden']:[]);
      nodes.set(id,{textContent:'',innerHTML:'',classList:{
        add:name=>classes.add(name),remove:name=>classes.delete(name),
        contains:name=>classes.has(name),
        toggle(name,force){const add=force===undefined?!classes.has(name):force;add?classes.add(name):classes.delete(name)}
      }});
    }
    return nodes.get(id);
  }
  const window={
    BusinessLifeProfileState:{surface:'profile',activeRole:'merchant',accountId:1,navigationEpoch:1},
    BusinessLifeAccounting:{getState:()=>accounting}
  };
  const document={
    addEventListener(name,listener){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(listener)},
    dispatchEvent(event){events.push(event);for(const listener of listeners.get(event.type)||[])listener(event)}
  };
  const context={window,document,console,Intl,Date,$:node,esc:String,num:String,money:String,
    CustomEvent:class{constructor(type,{detail}={}){this.type=type;this.detail=detail}},
    api:()=>new Promise((resolve,reject)=>requests.push({resolve,reject})),
    openPendingInventoryNotification:async()=>false
  };
  vm.createContext(context);
  vm.runInContext("let baseActiveRole=window.BusinessLifeProfileState.activeRole;function isMerchantBaseActive(){return baseActiveRole==='merchant'}\n"+source.slice(todayStart,todayEnd)+source.slice(lifecycleStart,lifecycleEnd),context);
  function dispatch(type,detail){document.dispatchEvent({type,detail})}
  return{
    node,events,requests,accounting,
    load:options=>window.BusinessLifeMerchantToday.load(options),
    state:()=>window.BusinessLifeMerchantToday.getState(),
    switchBusiness(id){accounting.activeBusinessId=id;dispatch('abl:business-workspace-changed',{role:'merchant',activeBusinessId:id})},
    profile(detail){window.BusinessLifeProfileState={...window.BusinessLifeProfileState,...detail};dispatch('abl:profile-state',window.BusinessLifeProfileState)},
    expire(){dispatch('abl:auth-expired')}
  };
}

const payload=(id,name='Business '+id)=>({business:{id,name},presentation:{merchant_domain:'non_food'},orders:{},inventory:{},supplier:{},catalog:{},money:{},workspace:{active_business_id:id},generated_at:'2026-10-26T10:00:00Z'});

test('late previous-business success cannot replace current Today or publish stale workspace metadata',async()=>{
  const h=todayHarness(),old=h.load();
  h.switchBusiness(2);
  const current=h.load();
  h.requests[1].resolve(payload(2));await current;
  h.requests[0].resolve(payload(1));await old;
  assert.equal(h.state().businessId,2);
  assert.equal(h.node('todayBusinessName').textContent,'Business 2');
  assert.deepEqual(h.events.filter(e=>e.type==='abl:merchant-today-data').map(e=>e.detail.business.id),[2]);
});

test('late previous-business error cannot hide current successful Today',async()=>{
  const h=todayHarness(),old=h.load();
  h.switchBusiness(2);
  const current=h.load();
  h.requests[1].resolve(payload(2));await current;
  h.requests[0].reject(new Error('Old business failed'));await old.catch(()=>{});
  assert.equal(h.node('todayContent').classList.contains('hidden'),false);
  assert.equal(h.node('todayError').classList.contains('hidden'),true);
  assert.equal(h.state().businessId,2);
});

test('old finalization cannot clear the current in-flight request or cause duplicate loads',async()=>{
  const h=todayHarness(),old=h.load();
  h.switchBusiness(2);
  const current=h.load();
  h.requests[0].resolve(payload(1));await old;
  const repeated=h.load();
  assert.equal(h.requests.length,2);
  h.requests[1].resolve(payload(2));await Promise.all([current,repeated]);
  assert.equal(h.state().businessId,2);
});

test('leaving Merchant clears visible data and rejects a response arriving after the profile change',async()=>{
  const h=todayHarness(),initial=h.load();
  h.requests[0].resolve(payload(1));await initial;
  const old=h.load({force:true});
  h.profile({surface:'profile',activeRole:'customer',navigationEpoch:2});
  assert.equal(h.state().data,null);
  assert.equal(h.node('todayContent').classList.contains('hidden'),true);
  h.requests[1].resolve(payload(1));await old;
  assert.equal(h.state().data,null);
  assert.equal(h.events.filter(e=>e.type==='abl:merchant-today-data').length,1);
});

test('another authenticated identity cannot reuse Today cache even when its business context is unresolved',async()=>{
  const h=todayHarness(),initial=h.load();
  h.requests[0].resolve(payload(1));await initial;
  h.accounting.activeBusinessId=null;
  h.profile({accountId:2,navigationEpoch:2});
  assert.equal(h.state().data,null);
  assert.equal(h.requests.length,2);
  const current=h.load();
  h.requests[1].resolve(payload(2));await current;
  assert.equal(h.node('todayBusinessName').textContent,'Business 2');
});

test('authentication expiry invalidates in-flight Today authority',async()=>{
  const h=todayHarness(),old=h.load();
  h.expire();
  h.requests[0].resolve(payload(1));await old;
  assert.equal(h.state().data,null);
  assert.equal(h.node('todayContent').classList.contains('hidden'),true);
});

test('returning to Today within the same Merchant account and business reuses its cached data',async()=>{
  const h=todayHarness(),initial=h.load();
  h.requests[0].resolve(payload(1));await initial;
  h.profile({navigationEpoch:2});
  await h.load();
  assert.equal(h.requests.length,1);
  assert.equal(h.state().businessId,1);
  assert.equal(h.node('todayContent').classList.contains('hidden'),false);
});

test('current failure has a retry state and same-context concurrent loads share one request',async()=>{
  const h=todayHarness(),first=h.load(),duplicate=h.load();
  assert.equal(h.requests.length,1);
  h.requests[0].reject(new Error('Current connection failed'));
  await Promise.all([assert.rejects(first,/Current connection failed/),assert.rejects(duplicate,/Current connection failed/)]);
  assert.equal(h.node('todayError').classList.contains('hidden'),false);
  assert.equal(h.node('todayErrorMessage').textContent,'Current connection failed');
  const retry=h.load({force:true});
  h.requests[1].resolve(payload(1));await retry;
  assert.equal(h.node('todayError').classList.contains('hidden'),true);
  assert.equal(h.node('todayContent').classList.contains('hidden'),false);
  await h.load();
  assert.equal(h.requests.length,2);
});
