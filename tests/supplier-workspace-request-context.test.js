import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/suppliers-ui.js',import.meta.url),'utf8');

// Execute the complete browser source with deferred fetch and canonical lifecycle events.
function supplierHarness(){
  const nodes=new Map(),listeners=new Map(),events=[],requests=[];
  let authenticated=true,csrf='test-session-one';
  class Node{
    constructor(id,className=''){
      this.id=id;this.classes=new Set(className.split(/\s+/).filter(Boolean));this.html='';this.controls=[];this.writes=0;this.style={};this.handlers=new Map();
      this.classList={
        contains:name=>this.classes.has(name),
        add:name=>this.changeClass(()=>this.classes.add(name)),
        remove:name=>this.changeClass(()=>this.classes.delete(name)),
        toggle:(name,force)=>this.changeClass(()=>{const add=force===undefined?!this.classes.has(name):force;add?this.classes.add(name):this.classes.delete(name)})
      };
    }
    get className(){return [...this.classes].join(' ')}
    changeClass(change){change()}
    set innerHTML(html){
      this.html=html;this.writes+=1;
      for(const id of this.controls)nodes.delete(id);
      this.controls=[];
      for(const match of html.matchAll(/\bid="([^"]+)"/g)){nodes.set(match[1],new Node(match[1]));this.controls.push(match[1])}
      this.back=new Node('back');
    }
    get innerHTML(){return this.html}
    querySelector(selector){return selector==='.supBack'?this.back||new Node('back'):null}
    querySelectorAll(){return []}
    addEventListener(type,handler){this.handlers.set(type,handler)}
    click(){return this.handlers.get('click')?.({currentTarget:this})||this.onclick?.({currentTarget:this})}
  }
  for(const [id,classes] of [['shell',''],['supWorkspace','supWorkspace hidden'],['supModalBg','supModalBg hidden'],['supModal',''],['roleHub',''],['bottomNav','']])nodes.set(id,new Node(id,classes));
  const document={
    readyState:'loading',body:new Node('body'),
    getElementById:id=>nodes.get(id)||null,
    querySelector:selector=>selector==='.bottomNav'?nodes.get('bottomNav'):null,
    querySelectorAll:()=>[],
    addEventListener(type,handler){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(handler)},
    dispatchEvent(event){events.push(event);for(const handler of listeners.get(event.type)||[])handler(event)}
  };
  const accounting={role:'supplier',activeBusinessId:11};
  const window={
    ABLSession:{authenticated:()=>authenticated,csrfToken:()=>csrf},
    BusinessLifeProfileState:{surface:'profile',activeRole:'supplier',navigationEpoch:1,accountId:1,snapshot:{account:{id:1,active_role:'supplier'},profiles:[{role:'supplier',enabled:true}]}},
    BusinessLifeAccounting:{getState:()=>accounting},BusinessLifeShell:{showActiveWorkspace(){}}
  };
  const context={window,document,CustomEvent:class{constructor(type,{detail}={}){this.type=type;this.detail=detail}},
    Intl,Date,console,setTimeout,clearTimeout,fetch:path=>new Promise((resolve,reject)=>requests.push({path,resolve:data=>resolve({ok:true,json:async()=>data}),reject}))};
  vm.createContext(context);vm.runInContext(source,context);vm.runInContext('boot()',context);
  const dispatch=(type,detail)=>document.dispatchEvent({type,detail});
  return {
    window,accounting,events,requests,workspace:nodes.get('supWorkspace'),node:id=>nodes.get(id),
    open:section=>window.BusinessLifeSuppliers.openSupplierWorkspace(section),
    load:section=>vm.runInContext(`renderSupplierWorkspace(${JSON.stringify(section)})`,context),
    close:()=>vm.runInContext('closeSupWorkspace()',context),
    selected:()=>vm.runInContext('supSupplierSection',context),
    profile(detail){window.BusinessLifeProfileState={...window.BusinessLifeProfileState,...detail};dispatch('abl:profile-state',window.BusinessLifeProfileState)},
    business(id,event={role:'supplier',activeBusinessId:id}){accounting.activeBusinessId=id;dispatch('abl:business-workspace-changed',event)},
    dispatch,auth:value=>{authenticated=value},session:value=>{csrf=value}
  };
}

const order=(name,status='accepted')=>({id:1,po_number:name,business_name:'Controlled Merchant',expected_total:10,status,fulfilment_mode:'pickup'});
const clearEvents=h=>h.events.filter(event=>event.type==='abl:clear-context-help').length;

test('Supplier ETA survives an older Orders success without stale bindings or Help effects',async()=>{
  const h=supplierHarness(),older=h.open('Orders'),current=h.open('ETA');
  h.requests[1].resolve([order('CURRENT-ETA')]);await current;
  const html=h.workspace.innerHTML,writes=h.workspace.writes,help=clearEvents(h);
  h.requests[0].resolve([order('OLD-ORDERS')]);await older;
  assert.equal(h.workspace.innerHTML,html);assert.equal(h.workspace.writes,writes);assert.equal(clearEvents(h),help);
  assert.match(html,/CURRENT-ETA/);assert.equal(h.selected(),'ETA');
});

test('older Supplier success cannot replace the newest section Loading state',async()=>{
  const h=supplierHarness(),older=h.open('Orders'),current=h.open('ETA');
  const loading=h.workspace.innerHTML;
  h.requests[0].resolve([order('OLD')]);await older;
  assert.equal(h.workspace.innerHTML,loading);assert.match(loading,/Loading ETA/);assert.equal(clearEvents(h),0);
  h.requests[1].resolve([]);await current;assert.match(h.workspace.innerHTML,/No accepted orders/);
});

test('late Supplier failure cannot replace a newer successful section',async()=>{
  const h=supplierHarness(),older=h.open('Orders'),current=h.open('ETA');
  h.requests[1].resolve([order('CURRENT')]);await current;const html=h.workspace.innerHTML;
  h.requests[0].reject(new Error('Previous screen unavailable'));await older;
  assert.equal(h.workspace.innerHTML,html);assert.doesNotMatch(html,/Previous screen unavailable/);
});

test('the existing Today fallback error cannot overwrite newer Money evidence',async()=>{
  const h=supplierHarness(),older=h.open('Today'),current=h.open('Money');
  h.requests[1].resolve({money:{receivable_total:123},money_orders:[]});await current;const html=h.workspace.innerHTML;
  h.requests[0].reject(new Error('Old Today connection failed'));await older;
  assert.equal(h.workspace.innerHTML,html);assert.match(html,/123/);assert.match(html,/Total receivable/);
});

test('same-section Supplier reload is also latest-request-wins',async()=>{
  const h=supplierHarness(),older=h.open('Orders'),current=h.load('Orders');
  h.requests[1].resolve([order('NEWEST')]);await current;
  h.requests[0].resolve([order('OLDER')]);await older;
  assert.match(h.workspace.innerHTML,/NEWEST/);assert.doesNotMatch(h.workspace.innerHTML,/OLDER/);
});

test('closing Supplier invalidates pending success and reopening accepts only the new request',async()=>{
  const h=supplierHarness(),older=h.open('Orders');h.close();
  const closed=h.workspace.innerHTML,writes=h.workspace.writes;
  h.requests[0].resolve([order('CLOSED')]);await older;
  assert.equal(h.workspace.innerHTML,closed);assert.equal(h.workspace.writes,writes);assert.equal(clearEvents(h),0);assert.equal(h.workspace.classList.contains('hidden'),true);
  const current=h.open('Orders');h.requests[1].resolve([order('REOPENED')]);await current;
  assert.match(h.workspace.innerHTML,/REOPENED/);
});

test('Supplier close and immediate reopen keep only the newly opened load current',async()=>{
  const h=supplierHarness(),older=h.open('Orders');h.close();const current=h.open('ETA');
  h.requests[1].resolve([order('REOPENED')]);await current;
  h.requests[0].resolve([order('CLOSED')]);await older;
  assert.match(h.workspace.innerHTML,/REOPENED/);assert.doesNotMatch(h.workspace.innerHTML,/CLOSED/);
});

test('profile leave and return cannot restore an old Supplier request',async()=>{
  const h=supplierHarness(),older=h.open('Orders');
  h.profile({surface:'account',activeRole:null,navigationEpoch:2});
  h.profile({surface:'profile',activeRole:'supplier',navigationEpoch:3});
  const current=h.open('ETA');h.requests[1].resolve([order('RETURNED')]);await current;
  h.requests[0].resolve([order('OLD-PROFILE')]);await older;
  assert.match(h.workspace.innerHTML,/RETURNED/);assert.doesNotMatch(h.workspace.innerHTML,/OLD-PROFILE/);
});

test('changing account invalidates Supplier even with the same business and navigation number',async()=>{
  const h=supplierHarness(),older=h.open('Orders');h.profile({accountId:2});
  const current=h.open('ETA');h.requests[1].resolve([order('ACCOUNT-TWO')]);await current;
  h.requests[0].reject(new Error('Old account error'));await older;
  assert.match(h.workspace.innerHTML,/ACCOUNT-TWO/);assert.doesNotMatch(h.workspace.innerHTML,/Old account error/);
});

test('user business change replaces Loading with explicit Retry and rejects old business data',async()=>{
  const h=supplierHarness(),older=h.open('Orders');h.business(22);
  assert.match(h.workspace.innerHTML,/selected Supplier business changed/);assert.equal(h.requests.length,1);
  const retry=h.node('supWorkspaceRetry').click();assert.equal(h.requests.length,2);
  h.requests[1].resolve([order('BUSINESS-TWO')]);await retry;
  h.requests[0].resolve([order('BUSINESS-ONE')]);await older;
  assert.match(h.workspace.innerHTML,/BUSINESS-TWO/);assert.doesNotMatch(h.workspace.innerHTML,/BUSINESS-ONE/);
});

test('switching Supplier business away and back invalidates an earlier matching business request',async()=>{
  const h=supplierHarness(),older=h.open('Orders');h.business(22);h.business(11);
  const html=h.workspace.innerHTML;h.requests[0].resolve([order('BEFORE-SWITCH')]);await older;
  assert.equal(h.workspace.innerHTML,html);assert.doesNotMatch(html,/BEFORE-SWITCH/);
});

test('unrelated role or foreign-business events do not invalidate current Supplier work',async()=>{
  const h=supplierHarness(),current=h.open('Orders');
  h.dispatch('abl:business-workspace-changed',{role:'merchant',activeBusinessId:99});
  h.dispatch('abl:business-workspace-changed',{role:'supplier',activeBusinessId:99});
  h.requests[0].resolve([order('CURRENT-BUSINESS')]);await current;
  assert.match(h.workspace.innerHTML,/CURRENT-BUSINESS/);assert.equal(h.requests.length,1);
});

test('duplicate same-business notification preserves an in-flight Supplier view',async()=>{
  const h=supplierHarness(),current=h.open('Orders');h.business(11);
  assert.match(h.workspace.innerHTML,/Loading Orders/);assert.doesNotMatch(h.workspace.innerHTML,/business changed/);
  h.requests[0].resolve([order('SAME-BUSINESS')]);await current;
  assert.match(h.workspace.innerHTML,/SAME-BUSINESS/);assert.equal(h.requests.length,1);
});

test('normal Supplier failure keeps Error and working Retry on the same section',async()=>{
  const h=supplierHarness(),first=h.open('ETA');h.requests[0].reject(new Error('Current connection failed'));await first;
  assert.match(h.workspace.innerHTML,/Current connection failed/);assert.match(h.workspace.innerHTML,/role="alert"/);
  const retry=h.node('supWorkspaceRetry').click();h.requests[1].resolve([]);await retry;
  assert.match(h.workspace.innerHTML,/No accepted orders/);assert.doesNotMatch(h.workspace.innerHTML,/role="alert"/);assert.equal(h.selected(),'ETA');
});

test('detached older Retry controls cannot move a newer Supplier section',async()=>{
  const h=supplierHarness(),first=h.open('Orders');h.requests[0].reject(new Error('Retry me'));await first;
  const detached=h.node('supWorkspaceRetry'),current=h.open('ETA');
  const ignored=detached.click();assert.equal(h.requests.length,2);assert.equal(h.selected(),'ETA');await ignored;
  h.requests[1].resolve([]);await current;
});

test('initial accounting hydration and same-context profile decoration preserve Supplier success',async()=>{
  const h=supplierHarness();h.accounting.activeBusinessId=null;const current=h.open('Orders');
  h.profile({snapshot:{...h.window.BusinessLifeProfileState.snapshot}});h.accounting.activeBusinessId=11;
  h.requests[0].resolve([order('INITIAL-HYDRATION')]);await current;
  assert.match(h.workspace.innerHTML,/INITIAL-HYDRATION/);assert.equal(h.requests.length,1);
  const html=h.workspace.innerHTML;h.business(11);
  assert.equal(h.workspace.innerHTML,html);assert.equal(h.requests.length,1);
});

test('same-account session initialization and token rotation do not strand Supplier Loading',async()=>{
  const h=supplierHarness();h.session('');const current=h.open('Orders');
  h.session('hydrated-session');h.profile({snapshot:{...h.window.BusinessLifeProfileState.snapshot}});
  h.requests[0].resolve([order('INITIALIZED-SESSION')]);await current;
  assert.match(h.workspace.innerHTML,/INITIALIZED-SESSION/);assert.equal(h.requests.length,1);
  const rotated=h.load('ETA');h.session('rotated-session');h.requests[1].resolve([]);await rotated;
  assert.match(h.workspace.innerHTML,/No accepted orders/);
});

test('authentication expiry and a new session cannot revive an old Supplier response',async()=>{
  const h=supplierHarness(),older=h.open('Orders');h.dispatch('abl:auth-expired');h.session('test-session-two');
  const current=h.open('ETA');h.requests[1].resolve([order('NEW-SESSION')]);await current;
  h.requests[0].resolve([order('OLD-SESSION')]);await older;
  assert.match(h.workspace.innerHTML,/NEW-SESSION/);assert.doesNotMatch(h.workspace.innerHTML,/OLD-SESSION/);
});

test('logout without a profile event prevents Supplier success and new reads',async()=>{
  const h=supplierHarness(),older=h.open('Orders');h.auth(false);const html=h.workspace.innerHTML;
  h.requests[0].resolve([order('LOGGED-OUT')]);await older;await h.load('ETA');await h.open('ETA');
  assert.equal(h.workspace.innerHTML,html);assert.equal(h.requests.length,1);assert.equal(clearEvents(h),0);
});

test('logged-out and other-profile Supplier opens cannot expose retained markup or change the current surface',async()=>{
  const h=supplierHarness();h.workspace.innerHTML='Retained private Supplier markup';
  h.auth(false);await h.open('ETA');
  assert.equal(h.workspace.classList.contains('hidden'),true);assert.equal(h.selected(),'Today');assert.equal(h.requests.length,0);
  h.auth(true);h.profile({activeRole:'merchant',navigationEpoch:2});await h.open('Orders');
  assert.equal(h.workspace.classList.contains('hidden'),true);assert.equal(h.workspace.innerHTML,'Retained private Supplier markup');
  assert.equal(h.selected(),'Today');assert.equal(h.requests.length,0);assert.equal(h.node('roleHub').classList.contains('hidden'),false);
});

test('another feature using the shared workspace cannot receive stale Supplier success or error',async()=>{
  for(const failure of [false,true]){
    const h=supplierHarness(),older=h.open('Orders');
    h.dispatch('abl:feature-workspace',{workspaceId:'supWorkspace',activeRole:'merchant'});h.workspace.innerHTML='Merchant procurement';
    if(failure)h.requests[0].reject(new Error('Old Supplier error'));else h.requests[0].resolve([order('OLD-SUPPLIER')]);
    await older;assert.equal(h.workspace.innerHTML,'Merchant procurement');assert.equal(clearEvents(h),0);
  }
});

test('Supplier response while hidden cannot alter retained markup or Help state',async()=>{
  const h=supplierHarness(),older=h.open('Orders');
  h.workspace.classList.add('hidden');h.workspace.innerHTML='Hidden retained surface';
  h.requests[0].resolve([order('BEFORE-HIDE')]);await older;
  assert.equal(h.workspace.innerHTML,'Hidden retained surface');assert.equal(clearEvents(h),0);
});

test('canonical feature leave and return cannot restore a pre-navigation Supplier response',async()=>{
  const h=supplierHarness(),older=h.open('Orders');
  h.workspace.classList.add('hidden');h.dispatch('abl:feature-workspace',{workspaceId:'deliveryWorkspace',activeRole:'supplier'});
  h.workspace.classList.remove('hidden');h.dispatch('abl:feature-workspace',{workspaceId:'supWorkspace',activeRole:'supplier'});h.workspace.innerHTML='Returned surface';
  h.requests[0].resolve([order('BEFORE-LEAVE')]);await older;
  assert.equal(h.workspace.innerHTML,'Returned surface');assert.equal(clearEvents(h),0);
});

test('Supplier Catalog still starts independent reads together and renders their combined result',async()=>{
  const h=supplierHarness(),current=h.open('Catalog');
  assert.deepEqual(h.requests.map(request=>request.path),['/api/supplier/me','/api/supplier/v2/activities']);
  h.requests[0].resolve({supplier:{supplier_name:'Controlled Supplier'},catalog:[]});h.requests[1].resolve({activities:[]});await current;
  assert.match(h.workspace.innerHTML,/My Catalog/);assert.doesNotMatch(h.workspace.innerHTML,/Loading My Catalog/);assert.equal(clearEvents(h),1);
});
