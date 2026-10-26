import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(process.env.ABL_SETTINGS_SOURCE||new URL('../public/profile-settings-ui.js',import.meta.url),'utf8');
const roles=['customer','merchant','supplier','courier','service_provider'];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const snapshot=(label='Current bank',accountId=1)=>({
  account:{id:accountId,display_name:'Synthetic account'},active_role:'merchant',
  profiles:roles.map(role=>({role,profile_id:'TEST-'+role,enabled:true,status:'active'})),
  businesses:[{id:1,name:'Business one'},{id:2,name:'Business two'}],financial_accounts:[],preferences:[],budgets:[],profile_fund_scopes:[],
  catalog:{},provider:{},account_money:{identity:{legal_name:label},destinations:[{id:1,display_name:label,destination_kind:'bank',status:'active',can_payout:true,is_default_payout:true,verification_status:'verified'}]}
});

// A deliberately small DOM with replaceable real control instances. The entire
// production source runs unchanged; tests inspect markup, requests and controls.
function harness({role='merchant',surface='profile',businessId=1}={}){
  const nodes=new Map(),listeners=new Map(),requests=[],toasts=[],navigation=[];
  let authenticated=true;
  const accounting={role,activeBusinessId:businessId};
  const camel=value=>value.replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());
  class Element {
    constructor(id='',tag='div',parent=null){
      this.id=id;this.tag=tag;this.parent=parent;this.children=[];this.dataset={};this.handlers=new Map();this.value='';this.checked=false;this.options=[];this._html='';this._text='';this.classes=new Set();
      this.classList={add:name=>this.classes.add(name),remove:name=>this.classes.delete(name),contains:name=>this.classes.has(name),toggle:(name,force)=>{const add=force??!this.classes.has(name);add?this.classes.add(name):this.classes.delete(name)}};
      if(id)nodes.set(id,this);
    }
    set textContent(value){this._text=value;if(this.id==='roleToast')toasts.push(value)}
    get textContent(){return this._text}
    removeChildren(){for(const child of this.children){child.removeChildren();if(child.id&&nodes.get(child.id)===child)nodes.delete(child.id)}this.children=[]}
    set innerHTML(value){this.removeChildren();this._html=String(value);this.parse(value)}
    get innerHTML(){return this._html}
    parse(html){
      for(const match of String(html).matchAll(/<([a-z][\w-]*)(\s[^<>]*?)?>/gi)){
        const attrs=match[2]||'',id=attrs.match(/\bid="([^"]*)"/)?.[1]||'';
        const child=new Element(id,match[1],this);this.children.push(child);
        for(const item of attrs.matchAll(/\bdata-([\w-]+)="([^"]*)"/g))child.dataset[camel(item[1])]=item[2];
        child.value=attrs.match(/\bvalue="([^"]*)"/)?.[1]||'';
        child.checked=/\bchecked\b/.test(attrs);
      }
    }
    querySelectorAll(selector){
      const descendants=this.children.flatMap(child=>[child,...child.querySelectorAll('*')]);
      if(selector==='*')return descendants;
      const attr=selector.match(/^\[data-([\w-]+)(?:="([^"]*)")?\](:checked)?$/);
      if(attr)return descendants.filter(child=>Object.hasOwn(child.dataset,camel(attr[1]))&&(attr[2]===undefined||child.dataset[camel(attr[1])]===attr[2])&&(!attr[3]||child.checked));
      if(selector.startsWith('#'))return descendants.filter(child=>child.id===selector.slice(1));
      return [];
    }
    querySelector(selector){return this.querySelectorAll(selector)[0]||null}
    insertAdjacentHTML(position,html){const owner=this.parent||this;owner._html+=html;owner.parse(html)}
    addEventListener(event,handler){if(!this.handlers.has(event))this.handlers.set(event,[]);this.handlers.get(event).push(handler)}
    async fire(type){const event={type,target:this,preventDefault(){}};const callbacks=[this['on'+type],...(this.handlers.get(type)||[])].filter(Boolean);for(const callback of callbacks)await callback.call(this,event)}
    click(){return this.fire('click')}
    scrollIntoView(){}
  }
  new Element('shell');const workspace=new Element('profileSettingsWorkspace');workspace.classList.add('hidden');new Element('roleToast');
  const document={readyState:'complete',cookie:'__Host-abl_csrf=synthetic-session-one',getElementById:id=>nodes.get(id)||null,
    querySelectorAll:()=>[],querySelector:()=>null,createElement:tag=>new Element('',tag),
    addEventListener(type,callback){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(callback)},
    dispatchEvent(event){for(const callback of listeners.get(event.type)||[])callback(event)}
  };
  const dispatch=(type,detail)=>document.dispatchEvent({type,detail});
  const window={BusinessLifeProfileState:{surface,activeRole:surface==='profile'?role:null,accountId:1,navigationEpoch:1,snapshot:snapshot()},
    ABLSession:{authenticated:()=>authenticated},BusinessLifeAccounting:{getState:()=>accounting},scrollTo(){},
    BusinessLifeShell:{getProfileState:()=>window.BusinessLifeProfileState,
      openFeatureWorkspace(id){workspace.classList.remove('hidden');dispatch('abl:feature-workspace',{workspaceId:id});return true},
      showActiveWorkspace(){navigation.push('profile')},openAccountSettings(view){navigation.push(view||'account')}
    }
  };
  const context=vm.createContext({window,document,Intl,console,location:{href:'/'},CustomEvent:class{constructor(type,{detail}={}){this.type=type;this.detail=detail}},setTimeout:()=>1,clearTimeout(){},
    fetch:(path,options={})=>new Promise((resolve,reject)=>requests.push({path,options,resolve(data,status=200){resolve({ok:status>=200&&status<300,status,json:async()=>data})},reject}))
  });
  vm.runInContext(source,context,{filename:'public/profile-settings-ui.js'});
  return {workspace,requests,toasts,navigation,accounting,document,window,dispatch,node:id=>nodes.get(id),
    run:code=>vm.runInContext(code,context),open:role=>window.BusinessLifeProfileSettings.open(role),bank:returnTo=>window.BusinessLifeProfileSettings.openAccountMoney(returnTo),
    profile(detail,notify=true){window.BusinessLifeProfileState={...window.BusinessLifeProfileState,...detail};if(notify)dispatch('abl:profile-state',window.BusinessLifeProfileState)},
    business(id,eventRole=accounting.role){accounting.activeBusinessId=id;dispatch('abl:business-workspace-changed',{role:eventRole,activeBusinessId:id})},
    expire(){authenticated=false;document.cookie='';dispatch('abl:auth-expired')},
    view(name){return workspace.querySelector('[data-profile-settings-view="'+name+'"]').click()}
  };
}
async function loaded(h,kind='bank',data=snapshot()){
  const start=h.requests.length,pending=kind==='bank'?h.bank():h.open(kind);
  h.requests[start].resolve(data);
  if(kind==='courier'){await tick();h.requests[start+1].resolve({profile:{operating_area_name:'Current area'}})}
  await pending;
}

test('an older banking response cannot replace the latest default payout',async()=>{
  const h=harness(),old=h.bank(),current=h.bank();
  h.requests[1].resolve(snapshot('Latest bank'));await current;
  h.requests[0].resolve(snapshot('Older bank'));await old;
  assert.match(h.workspace.innerHTML,/Latest bank/);assert.doesNotMatch(h.workspace.innerHTML,/Older bank/);
});
test('an older banking error cannot replace a newer successful screen',async()=>{
  const h=harness(),old=h.bank(),current=h.bank();
  h.requests[1].resolve(snapshot('Latest bank'));await current;
  h.requests[0].reject(new Error('Old transport failure'));await old;
  assert.match(h.workspace.innerHTML,/Latest bank/);assert.doesNotMatch(h.workspace.innerHTML,/Old transport failure/);
});
test('overlapping refreshes within one open banking view commit only the latest read',async()=>{
  const h=harness();await loaded(h);
  const old=h.run('refreshSettings()'),current=h.run('refreshSettings()');
  h.requests[2].resolve(snapshot('New refresh'));await current;
  h.requests[1].resolve(snapshot('Old refresh'));await old;
  assert.match(h.workspace.innerHTML,/New refresh/);assert.doesNotMatch(h.workspace.innerHTML,/Old refresh/);
});
test('a finance read started before a save cannot overwrite the view while that save is pending',async()=>{
  const h=harness();await loaded(h);const oldRead=h.run('refreshSettings()');
  const save=h.node('accountMoneyIdentityForm').fire('submit');h.requests[1].resolve(snapshot('Pre-save read'));await oldRead;
  assert.doesNotMatch(h.workspace.innerHTML,/Pre-save read/);
  h.requests[2].resolve({saved:true});await tick();h.requests[3].resolve(snapshot('Post-save read'));await save;
  assert.match(h.workspace.innerHTML,/Post-save read/);assert.equal(h.requests.length,4);
});
test('current errors escape markup and offer a working explicit Retry',async()=>{
  const h=harness(),opening=h.bank();h.requests[0].resolve({error:'<img src=x onerror=alert(1)>'},503);await opening;
  assert.match(h.workspace.innerHTML,/&lt;img/);assert.doesNotMatch(h.workspace.innerHTML,/<img src=x/);
  const retry=h.node('settingsRetry').click();assert.equal(h.requests.length,2);
  h.requests[1].resolve(snapshot('Retry bank'));await retry;assert.match(h.workspace.innerHTML,/Retry bank/);
});
test('a detached old Retry does not issue requests after a newer screen opens',async()=>{
  const h=harness(),opening=h.bank();h.requests[0].reject(new Error('Temporary failure'));await opening;
  const retry=h.node('settingsRetry');h.profile({activeRole:'customer',navigationEpoch:2});await loaded(h,'customer');await retry.click();
  assert.equal(h.requests.length,2);assert.match(h.workspace.innerHTML,/Customer settings/);
});
test('Back remains available during loading and retires the pending response',async()=>{
  const h=harness(),opening=h.bank();await h.node('settingsBack').click();
  h.requests[0].resolve(snapshot('Closed bank'));await opening;
  assert.equal(h.workspace.classList.contains('hidden'),true);assert.equal(h.workspace.innerHTML,'');assert.deepEqual(h.navigation,['account']);
});
for(const outcome of ['success','failure'])test('closing Profile Settings ignores late '+outcome,async()=>{
  const h=harness(),opening=h.open('merchant');h.run('closeProfileSettings()');
  outcome==='success'?h.requests[0].resolve(snapshot('Closed profile')):h.requests[0].reject(new Error('Closed failure'));
  await opening;assert.equal(h.workspace.innerHTML,'');assert.equal(h.workspace.classList.contains('hidden'),true);
});
test('leaving for a different feature never rewrites that feature or hidden settings',async()=>{
  const h=harness(),opening=h.open('merchant');h.dispatch('abl:feature-workspace',{workspaceId:'ordersWorkspace'});
  h.requests[0].resolve(snapshot());await opening;assert.equal(h.workspace.innerHTML,'');assert.equal(h.workspace.classList.contains('hidden'),true);
});
test('profile transitions discard loaded banking data and reject pending responses',async()=>{
  const h=harness();await loaded(h);const pending=h.run('refreshSettings()');
  h.profile({activeRole:'customer',navigationEpoch:2});h.requests[1].resolve(snapshot('Previous profile bank'));await pending;
  assert.equal(h.workspace.innerHTML,'');assert.equal(h.workspace.classList.contains('hidden'),true);
});
test('account changes discard loaded financial details immediately',async()=>{
  const h=harness();await loaded(h);h.profile({accountId:2,snapshot:snapshot('Other account',2)});
  assert.equal(h.workspace.innerHTML,'');assert.equal(h.workspace.classList.contains('hidden'),true);
});
test('canonical profile revocation clears an already rendered view without waiting for another read',async()=>{
  const h=harness();await loaded(h,'merchant');const revoked=snapshot();revoked.profiles.find(profile=>profile.role==='merchant').enabled=false;
  h.profile({snapshot:revoked});assert.equal(h.workspace.innerHTML,'');assert.equal(h.workspace.classList.contains('hidden'),true);
});
test('authentication expiry clears private DOM and ignores the old network failure',async()=>{
  const h=harness();await loaded(h);const pending=h.run('refreshSettings()');h.expire();
  h.requests[1].reject(new Error('Expired private response'));await pending;
  assert.equal(h.workspace.innerHTML,'');assert.equal(h.workspace.classList.contains('hidden'),true);assert.equal(h.toasts.length,0);
});
test('a replaced session cookie invalidates an old response even for the same account',async()=>{
  const h=harness(),old=h.bank();h.document.cookie='__Host-abl_csrf=synthetic-session-two';
  const current=h.bank();h.requests[1].resolve(snapshot('New session bank'));await current;
  h.requests[0].resolve(snapshot('Old session bank'));await old;
  assert.match(h.workspace.innerHTML,/New session bank/);assert.doesNotMatch(h.workspace.innerHTML,/Old session bank/);
});
test('a new navigation epoch rejects an old read even when the same profile remains selected',async()=>{
  const h=harness(),old=h.open('merchant');h.profile({navigationEpoch:2});
  const current=h.open('merchant');h.requests[1].resolve(snapshot('New navigation'));await current;
  h.requests[0].reject(new Error('Old navigation error'));await old;
  assert.match(h.workspace.innerHTML,/Merchant settings/);assert.doesNotMatch(h.workspace.innerHTML,/Old navigation error/);
});
test('business switches invalidate the old read without automatic requests and offer explicit Retry',async()=>{
  const h=harness(),old=h.open('merchant');h.business(2);
  assert.equal(h.requests.length,1);assert.match(h.workspace.innerHTML,/Business workspace changed/);
  h.requests[0].reject(new Error('Old business failed'));await old;
  const retry=h.node('settingsRetry').click();h.requests[1].resolve(snapshot());await retry;
  assert.match(h.workspace.innerHTML,/Business two/);assert.doesNotMatch(h.workspace.innerHTML,/Old business failed/);
});
test('initial accounting hydration adopts the canonical business without invalidating valid data',async()=>{
  const h=harness({businessId:null}),opening=h.open('merchant');h.business(2);h.requests[0].resolve(snapshot());await opening;
  assert.match(h.workspace.innerHTML,/Business two/);assert.equal(h.requests.length,1);
});
test('same-business and unrelated-role events preserve the current read',async()=>{
  const h=harness(),opening=h.open('merchant');h.business(1);h.dispatch('abl:business-workspace-changed',{role:'supplier',activeBusinessId:2});
  h.profile({...h.window.BusinessLifeProfileState});h.requests[0].resolve(snapshot());await opening;
  assert.match(h.workspace.innerHTML,/Business one/);assert.equal(h.requests.length,1);
});
test('Courier supplemental data cannot overwrite a newer account banking view',async()=>{
  const h=harness({role:'courier'}),courier=h.open('courier');h.requests[0].resolve(snapshot('Old courier snapshot'));await tick();
  assert.equal(h.requests[1].path,'/api/courier/delivery-profile');
  const bank=h.bank();h.requests[2].resolve(snapshot('Current banking snapshot'));await bank;
  h.requests[1].resolve({profile:{operating_area_name:'Old private area'}});await courier;
  assert.match(h.workspace.innerHTML,/Current banking snapshot/);assert.doesNotMatch(h.workspace.innerHTML,/Old courier snapshot|Old private area/);
});
test('Courier supplemental reads stay paired with their own finance snapshot',async()=>{
  const h=harness({role:'courier'}),old=h.open('courier');h.requests[0].resolve(snapshot('Old snapshot'));await tick();
  const current=h.open('courier');h.requests[2].resolve(snapshot('New snapshot'));await tick();
  h.requests[3].resolve({profile:{operating_area_name:'New area'}});await current;await h.view('operatingArea');h.node('courierOperatingAreaSearch').value='Keep my current input';
  h.requests[1].resolve({profile:{operating_area_name:'Old area'}});await old;
  assert.match(h.workspace.innerHTML,/New area/);assert.doesNotMatch(h.workspace.innerHTML,/Old area/);
  assert.equal(h.node('courierOperatingAreaSearch').value,'Keep my current input');
});
test('an old Courier supplemental failure cannot replace current banking or its form inputs',async()=>{
  const h=harness({role:'courier'}),old=h.open('courier');h.requests[0].resolve(snapshot());await tick();
  await loaded(h);h.node('accountLegalName').value='Current unsaved owner';h.requests[1].reject(new Error('Old courier failed'));await old;
  assert.match(h.workspace.innerHTML,/Money &amp; Banking/);assert.doesNotMatch(h.workspace.innerHTML,/Old courier failed/);assert.equal(h.node('accountLegalName').value,'Current unsaved owner');
});
test('a current Courier supplemental failure shows Retry without committing partial data',async()=>{
  const h=harness({role:'courier'}),opening=h.open('courier');h.requests[0].resolve(snapshot('Uncommitted bank'));await tick();
  h.requests[1].reject(new Error('Delivery profile unavailable'));await opening;
  assert.match(h.workspace.innerHTML,/Delivery profile unavailable/);assert.ok(h.node('settingsRetry'));assert.doesNotMatch(h.workspace.innerHTML,/Uncommitted bank/);
});
test('reordered Courier area searches show only the latest results',async()=>{
  const h=harness({role:'courier'});await loaded(h,'courier');await h.view('operatingArea');
  h.node('courierOperatingAreaSearch').value='First';const first=h.node('courierOperatingAreaSearchButton').click();
  h.node('courierOperatingAreaSearch').value='Second';const second=h.node('courierOperatingAreaSearchButton').click();
  h.requests[3].resolve({items:[{psgc_code:'2',name:'Second area'}]});await second;
  h.requests[2].resolve({items:[{psgc_code:'1',name:'First area'}]});await first;
  assert.match(h.node('courierOperatingAreaResults').innerHTML,/Second area/);assert.doesNotMatch(h.node('courierOperatingAreaResults').innerHTML,/First area/);
});
test('shortened Courier search clears its results and invalidates the pending longer query',async()=>{
  const h=harness({role:'courier'});await loaded(h,'courier');await h.view('operatingArea');
  h.node('courierOperatingAreaSearch').value='Area';const old=h.node('courierOperatingAreaSearchButton').click();
  h.node('courierOperatingAreaSearch').value='';await h.node('courierOperatingAreaSearchButton').click();
  h.requests[2].resolve({items:[{psgc_code:'old',name:'Old area'}]});await old;
  assert.equal(h.node('courierOperatingAreaResults').innerHTML,'');assert.match(h.node('courierOperatingAreaStatus').textContent,/at least 2/);
});
test('an older successful Courier search cannot erase the current search error',async()=>{
  const h=harness({role:'courier'});await loaded(h,'courier');await h.view('operatingArea');
  h.node('courierOperatingAreaSearch').value='First';const first=h.node('courierOperatingAreaSearchButton').click();
  h.node('courierOperatingAreaSearch').value='Second';const second=h.node('courierOperatingAreaSearchButton').click();
  h.requests[3].reject(new Error('Current geography failure'));await second;
  h.requests[2].resolve({items:[{psgc_code:'old',name:'Old area'}]});await first;
  assert.match(h.node('courierOperatingAreaResults').innerHTML,/Current geography failure/);assert.doesNotMatch(h.node('courierOperatingAreaResults').innerHTML,/Old area/);
});
test('an old Courier result button cannot change a replacement operating-area form',async()=>{
  const h=harness({role:'courier'});await loaded(h,'courier');await h.view('operatingArea');
  h.node('courierOperatingAreaSearch').value='Area';const search=h.node('courierOperatingAreaSearchButton').click();h.requests[2].resolve({items:[{psgc_code:'old',name:'Old area'}]});await search;
  const old=h.workspace.querySelector('[data-courier-operating-area]');await h.node('settingsBack').click();await h.view('operatingArea');await old.click();
  assert.equal(h.node('courierOperatingPsgcCode').value,'');
});
test('late saving success after a new view does not toast or reload that view',async()=>{
  const h=harness();await loaded(h);h.node('accountIdentityKind').value='individual';h.node('accountLegalName').value='Confirmed synthetic owner';
  const save=h.node('accountMoneyIdentityForm').fire('submit');assert.equal(h.requests[1].options.method,'PUT');
  assert.equal(JSON.parse(h.requests[1].options.body).legal_name,'Confirmed synthetic owner');
  await loaded(h,'merchant');const html=h.workspace.innerHTML;
  h.requests[1].resolve({saved:true});await save;
  assert.equal(h.workspace.innerHTML,html);assert.equal(h.requests.length,3);assert.equal(h.toasts.length,0);
});
test('late saving failure after navigation cannot write into the new screen',async()=>{
  const h=harness();await loaded(h);const save=h.node('accountMoneyIdentityForm').fire('submit');
  h.profile({activeRole:'customer',navigationEpoch:2});await loaded(h,'customer');const html=h.workspace.innerHTML;h.requests[1].reject(new Error('Private old failure'));await save;
  assert.equal(h.workspace.innerHTML,html);assert.equal(h.requests.length,3);assert.equal(h.toasts.length,0);
});
test('a current explicit save keeps its payload and performs one fresh read',async()=>{
  const h=harness();await loaded(h);h.node('accountIdentityKind').value='individual';h.node('accountLegalName').value='Saved owner';
  const save=h.node('accountMoneyIdentityForm').fire('submit');h.requests[1].resolve({saved:true});await tick();
  assert.deepEqual(JSON.parse(h.requests[1].options.body),{identity_kind:'individual',legal_name:'Saved owner'});
  assert.equal(h.requests[2].path,'/api/settings/finance');assert.equal(h.requests.length,3);
  h.requests[2].resolve(snapshot('Saved banking state'));await save;
  assert.match(h.workspace.innerHTML,/Saved banking state/);assert.deepEqual(h.toasts,['Financial identity saved.']);
});
test('a current rejected save reports the error and does not trigger a reload',async()=>{
  const h=harness();await loaded(h);const save=h.node('accountMoneyIdentityForm').fire('submit');
  h.requests[1].resolve({error:'Identity confirmation required'},403);await save;
  assert.equal(h.node('accountMoneyIdentityStatus').textContent,'Identity confirmation required');assert.equal(h.requests.length,2);assert.equal(h.toasts.length,0);
});
test('detached old financial forms cannot submit using the replacement account fields',async()=>{
  const h=harness();await loaded(h);const oldForm=h.node('accountMoneyIdentityForm');await loaded(h,'bank',snapshot('Replacement bank'));
  await oldForm.fire('submit');assert.equal(h.requests.length,2);assert.match(h.workspace.innerHTML,/Replacement bank/);
});
test('session replacement suppresses old save completion without cancelling the submitted request',async()=>{
  const h=harness();await loaded(h);const save=h.node('accountMoneyIdentityForm').fire('submit');h.document.cookie='__Host-abl_csrf=replacement-session';
  h.requests[1].resolve({saved:true});await save;
  assert.equal(h.requests.length,2);assert.equal(h.toasts.length,0);
});
test('a stale financial form cannot submit after a canonical business switch',async()=>{
  const h=harness();await loaded(h);const old=h.node('accountMoneyIdentityForm');h.business(2);await old.fire('submit');
  assert.equal(h.requests.length,1);assert.match(h.workspace.innerHTML,/Business workspace changed/);
});
test('unverified response account data is never rendered',async()=>{
  const h=harness(),opening=h.bank();h.requests[0].resolve(snapshot('Other account secret',2));await opening;
  assert.doesNotMatch(h.workspace.innerHTML,/Other account secret/);assert.match(h.workspace.innerHTML,/could not be verified/);assert.ok(h.node('settingsRetry'));
});
test('a disabled selected profile does not silently fall back to another profile',async()=>{
  const h=harness(),data=snapshot();data.profiles.find(profile=>profile.role==='merchant').enabled=false;
  const opening=h.open('merchant');h.requests[0].resolve(data);await opening;
  assert.match(h.workspace.innerHTML,/no longer available/);assert.doesNotMatch(h.workspace.innerHTML,/Customer profile/);
});
test('opening another profile Settings does not change the operational profile or fetch',async()=>{
  const h=harness();await h.open('customer');assert.equal(h.requests.length,0);assert.equal(h.window.BusinessLifeProfileState.activeRole,'merchant');
  assert.match(h.toasts[0],/Open the profile first/);
});
test('account bootstrap still loading produces feedback instead of a stuck Settings screen',async()=>{
  const h=harness();h.profile({accountId:null,snapshot:null});await h.bank();await h.open('merchant');
  assert.equal(h.requests.length,0);assert.equal(h.workspace.classList.contains('hidden'),true);assert.ok(h.toasts.every(text=>/still loading/.test(text)));
});
for(const role of roles)test(role+' Settings retains a usable Home, Identity and Back path',async()=>{
  const h=harness({role});await loaded(h,role);assert.match(h.workspace.innerHTML,/Profile ID:/);
  await h.view('identity');assert.match(h.workspace.innerHTML,/Profile type/);await h.node('settingsBack').click();assert.match(h.workspace.innerHTML,/Profile ID:/);
  await h.node('settingsBack').click();assert.equal(h.workspace.classList.contains('hidden'),true);assert.deepEqual(h.navigation,['profile']);
  assert.equal(h.requests.length,role==='courier'?2:1);
});
test('Profile Settings to shared Banking and Back preserves the selected operational profile',async()=>{
  const h=harness({role:'customer'});await loaded(h,'customer');
  const bank=h.node('openAccountMoneyFromProfile').click();h.requests[1].resolve(snapshot());await bank;
  const back=h.node('settingsBack').click();h.requests[2].resolve(snapshot());await back;
  assert.equal(h.window.BusinessLifeProfileState.activeRole,'customer');assert.match(h.workspace.innerHTML,/Customer settings/);assert.equal(h.requests.length,3);
});
