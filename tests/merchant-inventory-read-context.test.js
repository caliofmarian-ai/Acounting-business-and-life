import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Exercise the browser implementation with synthetic identities and controlled I/O.
// An alternate source root permits the same behavior tests against the pre-fix code.
const sourceRoot=process.env.MERCHANT_READ_SOURCE_ROOT;
const readSource=name=>readFileSync(sourceRoot?`${sourceRoot}/public/${name}`:new URL(`../public/${name}`,import.meta.url),'utf8');
const source=readSource('v03.js');
const plain=value=>JSON.parse(JSON.stringify(value));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const expectReject=(promise,expected)=>{const result=assert.rejects(promise,expected);result.catch(()=>{});return result};
const transportError=/Transport disconnected|Connection unavailable/;
const inventoryRows=(businessId,name=`Stock ${businessId}`)=>[{id:businessId*10,business_id:businessId,item:name,quantity:4,reorder_level:1}];

function section(start,end){const from=source.indexOf(start);assert.notEqual(from,-1,`Missing source boundary: ${start}`);const to=source.indexOf(end,from);assert.notEqual(to,-1,`Missing source boundary: ${end}`);return source.slice(from,to)}
function functionSource(name){
  if(name==='refreshCurrentMerchantView')return section('async function refreshCurrentMerchantView(){',"\nif($('refreshBtn'))");
  const match=new RegExp(`^(?:async )?function ${name}\\(`,'m').exec(source);
  assert.ok(match,`Missing actual function ${name}`);
  const rest=source.slice(match.index),end=rest.slice(1).search(/\n(?:async )?function /);
  return end<0?rest:rest.slice(0,end+1);
}

function dom(){
  const nodes=new Map();
  class Element{
    constructor(tag='div',id=''){this.tagName=tag.toUpperCase();this._id='';this.id=id;this.children=[];this.parentElement=null;this.className='';this.textContent='';this.innerHTML='';this.value='';this.disabled=false;this.hidden=false;this.dataset={};this.attributes={};this.listeners=new Map();this.style={};}
    set id(value){this._id=value;if(value)nodes.set(value,this)}get id(){return this._id}
    get classList(){const node=this;return{contains:name=>node.className.split(/\s+/).includes(name),add(name){node.className=[...new Set([...node.className.split(/\s+/).filter(Boolean),name])].join(' ')},remove(name){node.className=node.className.split(/\s+/).filter(x=>x!==name).join(' ')},toggle(name,force){const add=force??!this.contains(name);add?this.add(name):this.remove(name);return add}}}
    setAttribute(name,value){this.attributes[name]=String(value)}
    appendChild(child){if(child.parentElement){const old=child.parentElement.children;old.splice(old.indexOf(child),1)}this.children.push(child);child.parentElement=this;return child}
    append(...children){for(const child of children)this.appendChild(child)}
    replaceChildren(...children){this.children=[];for(const child of children)this.appendChild(child);this.textContent='';this.innerHTML=''}
    contains(child){return child===this||this.children.some(x=>x.contains(child))}
    closest(selector){return selector==='.card'?(this.classList.contains('card')?this:this.parentElement?.closest(selector)):null}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null}
    querySelectorAll(selector){const choices=selector.split(',').map(x=>x.trim());return this.children.flatMap(child=>[...(choices.some(x=>x.startsWith('.')?child.classList.contains(x.slice(1)):child.tagName.toLowerCase()===x)?[child]:[]),...child.querySelectorAll(selector)])}
    insertAdjacentElement(position,child){const parent=this.parentElement;if(!parent)return;const index=parent.children.indexOf(this);parent.children.splice(position==='afterend'?index+1:index,0,child);child.parentElement=parent}
    addEventListener(name,handler){this.listeners.set(name,handler)}
    scrollIntoView(){}focus(){}
  }
  const node=id=>nodes.get(id)||(['inventoryReadStatus','inventoryReadContent'].includes(id)?null:new Element('div',id));
  const view=node('viewStock'),head=new Element();head.className='sectionHead';view.appendChild(head);
  const stock=new Element();stock.className='card';stock.appendChild(node('stockList'));view.appendChild(stock);
  const advanced=new Element();advanced.className='card';view.appendChild(advanced);
  const editable=new Element('input','purchaseInput'),submit=new Element('button','purchaseSubmit'),intentionalDisabled=new Element('button','intentionalDisabled');intentionalDisabled.disabled=true;
  advanced.appendChild(editable);advanced.appendChild(submit);advanced.appendChild(intentionalDisabled);
  return{node,view,stock,advanced,editable,submit,intentionalDisabled,document:{cookie:'__Host-abl_csrf=dummy-session-a',getElementById:node,createElement:tag=>new Element(tag),addEventListener(){},querySelectorAll(){return[]}},Element};
}

function harness({businessId=1,legacy={}}={}){
  const ui=dom(),storage=new Map(Object.entries(legacy)),writes=[],requests=[],renders=[],nested=[],consoleErrors=[];
  const accounting={role:'merchant',activeBusinessId:businessId,businesses:businessId?[{id:businessId}]:[]};
  let authenticated=true,allergenWait=null,locationWait=null,logoutCalls=0;
  const window={scrollTo(){},ABLSession:{authenticated:()=>authenticated,clearReadableSession(){authenticated=false}},BusinessLifeProfileState:{surface:'profile',activeRole:'merchant',accountId:1,navigationEpoch:1},BusinessLifeAccounting:{getState:()=>accounting}};
  const nestedCall=name=>(...args)=>{nested.push({name,args});return Promise.resolve([])};
  const context={window,document:ui.document,console:{...console,error:(...args)=>consoleErrors.push(args)},Date,Intl,Map,WeakMap,JSON,Number,Error,TypeError,Promise,$:ui.node,
    localStorage:{get length(){return storage.size},key:index=>[...storage.keys()][index],getItem:key=>storage.get(key)??null,setItem(key,value){writes.push({key,value});storage.set(key,value)},removeItem:key=>storage.delete(key)},
    fetch:(path,options)=>new Promise((resolve,reject)=>requests.push({path,options,resolve,reject})),
    logout(){logoutCalls+=1;authenticated=false;if(context.readApi?.invalidate)context.readApi.invalidate()},
    renderInventoryList(){renders.push(plain(context.readApi.inventory()))},
    fillIngredientSelect:nestedCall('ingredients'),fillIngredientAllergenEditor:async guard=>{nested.push({name:'allergens',args:[guard]});if(allergenWait)await allergenWait.promise},
    fillConsumableRuleInventory:nestedCall('consumables'),fillStockAdjustmentInventory:nestedCall('adjustments'),fillStorageEditor:nestedCall('storage'),fillRestockSettingsEditor:nestedCall('settings'),fillInventoryUnavailableEditor:nestedCall('unavailable'),
    inventoryScanUi:{syncInventory:nestedCall('scan'),reset:nestedCall('scanReset')},
    inventoryLocationUi:{load:async options=>{nested.push({name:'locations',args:[options]});if(locationWait)await locationWait.promise},reset:nestedCall('locationsReset')},
    inventoryCountUi:{load:nestedCall('count'),syncScopeOptions:nestedCall('countScope'),reset:nestedCall('countReset')},
    loadRestockSuggestions:nestedCall('restock'),loadConsumableRules:nestedCall('rules'),loadStockAdjustments:nestedCall('adjustmentRows'),loadInventoryLots:nestedCall('lots'),loadWasteAnalytics:nestedCall('waste'),loadInventoryUnavailableAllocations:nestedCall('holds'),
    selectedPositiveInventoryId:()=>null,wasteAnalyticsDays:7,emptyRow:text=>{const el=new ui.Element();el.textContent=text;return el},esc:String,num:String,money:String,alert(){},isMerchantBaseActive:()=>true,txRow:row=>{const el=new ui.Element();el.textContent=row.note||'Synthetic ledger row';return el},
    renderRestockList:rows=>{ui.node('restockSummary').textContent=JSON.stringify(rows)},renderWasteAnalytics:report=>{ui.node('wasteAnalyticsSummary').textContent=JSON.stringify(report)},consumableRuleLabel:()=>'',stockAdjustmentKindLabel:()=>'',stockAdjustmentLotCode:lot=>lot.internal_lot_code||`Lot ${lot.id}`,STORAGE_CONDITION_LABELS:{},STORAGE_AREA_LABELS:{},lotExpiryCopy:()=>''
  };
  vm.createContext(context);
  const hasNewHelpers=source.includes('let merchantReadGeneration=');
  const helperSource=hasNewHelpers?section('let merchantReadGeneration=','function setOnline'):section('const cacheKey =','function setOnline');
  const inventorySource=source.includes('let inventoryLoadGeneration=')?section('let inventoryLoadGeneration=','function lotExpiryCopy'):functionSource('loadStock');
  context.Option=class extends ui.Element{constructor(label,value){super('option');this.textContent=label;this.value=value}};
  vm.runInContext('let inventory=[],products=[],transactions=[],restockSuggestions=[],stockAdjustmentLots=[];\n'+helperSource+section('function setOnline','let baseActiveRole=')+inventorySource+`\n globalThis.readApi={read:cachedJson,raw:api,online:setOnline,load:loadStock,inventory:()=>inventory,adjustmentLots:()=>stockAdjustmentLots,setAdjustmentLots:rows=>{stockAdjustmentLots=rows},context:()=>typeof merchantReadContext==='function'?merchantReadContext():null,reconcile:()=>{if(typeof reconcileMerchantReads==='function')reconcileMerchantReads()},invalidate:typeof invalidateMerchantReads==='function'?invalidateMerchantReads:null,state:typeof inventoryReadState==='function'?inventoryReadState:null,guard:()=>typeof inventoryReadGuard==='function'?inventoryReadGuard():()=>true};`,context);
  const defer=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return{promise,resolve}};
  return{...ui,context,window,accounting,storage,writes,requests,renders,nested,consoleErrors,api:context.readApi,
    async respond(index,data,status=200){const r=requests[index];assert.ok(r,`Expected request ${index}`);r.resolve({ok:status>=200&&status<300,status,headers:{get:()=> 'application/json'},json:async()=>data,text:async()=>JSON.stringify(data)});await tick()},
    async reject(index,error=new TypeError('Transport disconnected')){assert.ok(requests[index]);requests[index].reject(error);await tick()},
    switchBusiness(id,{notify=true}={}){accounting.activeBusinessId=id;accounting.businesses=id?[{id}]:[];if(notify)context.readApi.reconcile()},
    profile(detail){Object.assign(window.BusinessLifeProfileState,detail);context.readApi.reconcile()},
    session(marker){ui.document.cookie=marker?`__Host-abl_csrf=${marker}`:'';context.readApi.reconcile()},
    pauseAllergens(){allergenWait=defer();return allergenWait.resolve},pauseLocations(){locationWait=defer();return locationWait.resolve},
    installLoader(name){vm.runInContext(functionSource(name),context);return(...args)=>vm.runInContext(name,context)(...args)},
    installComponent(file,factory){const create=vm.runInContext(`(function(){${readSource(file).replace('export function','function')}\nreturn ${factory};})()`,context);return create({api:context.readApi.raw,getReadGuard:context.readApi.guard,getInventory:context.readApi.inventory,getLocations:()=>[],refreshInventory:async()=>{},escapeHtml:String,formatNumber:String})},
    logoutCalls:()=>logoutCalls,
    mutationsDisabled:()=>ui.node('inventoryReadContent')?.disabled??ui.submit.disabled,
    status(){return ui.node('inventoryReadStatus')?.children.map(x=>x.textContent).join(' ')||''}
  };
}

async function warm(h,{key='inventory',offline=true,data=inventoryRows(1)}={}){const pending=h.api.read(`/api/${key}`,key,{offline});const index=h.requests.length-1;await h.respond(index,data);return pending}

test('startup removes legacy Merchant cache while successful reads never persist business data or session markers',async()=>{
  const h=harness({legacy:{abl_cache_inventory:'old private inventory',abl_cache_summary:'old finances',preference:'keep'}});
  assert.deepEqual([...h.storage.keys()],['preference']);
  await warm(h);assert.deepEqual(h.writes,[]);assert.deepEqual([...h.storage], [['preference','keep']]);
});

test('only explicit same-context transport fallback returns an independent page-local Inventory snapshot',async()=>{
  const h=harness(),original=await warm(h);original[0].item='Mutated caller object';
  const stamps=[],offline=h.api.read('/api/inventory','inventory',{offline:true,onCache:stamp=>stamps.push(stamp)});
  await h.reject(1);const rows=await offline;assert.equal(rows[0].item,'Stock 1');assert.equal(stamps.length,1);assert.equal(typeof stamps[0],'number');
  rows[0].item='Mutated fallback';const again=h.api.read('/api/inventory','inventory',{offline:true});await h.reject(2);assert.equal((await again)[0].item,'Stock 1');assert.equal(h.writes.length,0);
});

test('successful-response parse errors and aborted requests cannot be mistaken for offline transport evidence',async()=>{
  for(const kind of ['body-type-error','body-syntax-error','abort']){
    const h=harness();await warm(h);const pending=h.api.read('/api/inventory','inventory',{offline:true}),rejected=expectReject(pending,error=>kind==='abort'?error.name==='AbortError':error.name=== (kind==='body-type-error'?'TypeError':'SyntaxError'));
    if(kind==='abort'){const abort=Object.assign(new Error('Synthetic abort'),{name:'AbortError'});await h.reject(1,abort)}
    else{h.requests[1].resolve({ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>{throw kind==='body-type-error'?new TypeError('Synthetic body failure'):new SyntaxError('Synthetic invalid JSON')}});await tick()}
    await rejected;
  }
});

test('missing account, authenticated session, readable marker or Merchant surface fails closed before requesting cached reads',async()=>{
  for(const missing of ['account','session','marker','surface']){
    const h=harness();await warm(h);
    if(missing==='account')h.profile({accountId:null});
    if(missing==='session')h.window.ABLSession.authenticated=()=>false;
    if(missing==='marker')h.session('');
    if(missing==='surface')h.profile({surface:'account',activeRole:null});
    await assert.rejects(h.api.read('/api/inventory','inventory',{offline:true}),error=>error.staleMerchantRead===true);assert.equal(h.requests.length,1);
  }
});

test('financial and product reads do not silently fall back to an earlier successful response',async()=>{
  for(const key of ['summary','transactions','remittances','day_status','budget','analysis_7','analysis_30','products','product_sales','profit_7','profit_30']){
    const h=harness();await warm(h,{key,offline:false,data:{private:key}});
    const pending=h.api.read(`/api/${key}`,key),rejected=expectReject(pending,transportError);await h.reject(1);await rejected;assert.equal(h.writes.length,0,key);
  }
});

for(const status of [401,403,404,409,422,500])test(`HTTP ${status} cannot use offline Inventory evidence`,async()=>{
  const h=harness();await warm(h);const pending=h.api.read('/api/inventory','inventory',{offline:true}),rejected=expectReject(pending,error=>error.status===status||error.staleMerchantRead===true);
  await h.respond(1,{error:'Access or server failure'},status);await rejected;
  if(status!==401){const again=h.api.read('/api/inventory','inventory',{offline:true}),rejectedAgain=expectReject(again,transportError);await h.reject(2);await rejectedAgain}
});

for(const change of ['business','account','profile','session'])test(`${change} changes cannot reuse warmed Inventory`,async()=>{
  const h=harness();await warm(h);
  if(change==='business')h.switchBusiness(2);
  if(change==='account')h.profile({accountId:2});
  if(change==='profile'){h.profile({activeRole:'supplier',navigationEpoch:2});h.profile({activeRole:'merchant',navigationEpoch:3})}
  if(change==='session')h.session('dummy-session-b');
  const pending=h.api.read('/api/inventory','inventory',{offline:true}),rejected=expectReject(pending,transportError);await h.reject(1);await rejected;
});

test('unresolved business can receive current network data but creates no offline cache',async()=>{
  const h=harness({businessId:null});assert.deepEqual(plain(await warm(h)),inventoryRows(1));
  const offline=h.api.read('/api/inventory','inventory',{offline:true}),rejected=expectReject(offline,transportError);await h.reject(1);await rejected;
});

test('Supplier accounting state is not authoritative Merchant business context',async()=>{
  const h=harness();h.accounting.role='supplier';assert.equal(h.api.context()?.businessId,null);
  await warm(h);const offline=h.api.read('/api/inventory','inventory',{offline:true}),rejected=expectReject(offline,transportError);await h.reject(1);await rejected;
});

test('same-business workspace notification preserves an in-flight read and its later confirmed offline cache',async()=>{
  const h=harness(),pending=h.api.read('/api/inventory','inventory',{offline:true});h.switchBusiness(1,{notify:true});assert.equal(h.requests.length,1);
  await h.respond(0,inventoryRows(1));assert.deepEqual(plain(await pending),inventoryRows(1));assert.equal(h.requests.length,1);
  const offline=h.api.read('/api/inventory','inventory',{offline:true});await h.reject(1);assert.deepEqual(plain(await offline),inventoryRows(1));assert.equal(h.requests.length,2);
});

test('matching startup response survives a notified unknown-to-known hydration without warming an unknown-context cache',async()=>{
  const h=harness({businessId:null}),pending=h.api.read('/api/inventory','inventory',{offline:true});h.switchBusiness(2,{notify:true});await h.respond(0,inventoryRows(2));
  assert.deepEqual(plain(await pending),inventoryRows(2));assert.equal(h.requests.length,1);
  const offline=h.api.read('/api/inventory','inventory',{offline:true}),rejected=expectReject(offline,transportError);await h.reject(1);await rejected;
});

test('direct context reconciliation clears previously rendered Merchant ledger, product and financial details',()=>{
  const h=harness();h.api.reconcile();
  const lists=['historyList','recentList','productList','productSaleList','remittanceList','profit7List','analysis30'];
  const totals=['availableTotal','todaySales','todayProfit','acctCash','acctBank','openingCashShown','expectedCashShown','profit7Totals','analysis30Totals'];
  const budgets=['budgetPersonalDaily','budgetPersonalWeekly','budgetBusinessDaily','budgetMinimum'];
  for(const id of lists){const privateRow=new h.Element();privateRow.textContent='Synthetic prior business private row';h.node(id).appendChild(privateRow)}
  for(const id of totals)h.node(id).textContent='Synthetic prior business private amount';
  for(const id of budgets)h.node(id).value='1234';
  h.accounting.activeBusinessId=2;h.accounting.businesses=[{id:2}];h.api.reconcile();
  for(const id of lists)assert.equal(h.node(id).children.length,0,id);
  for(const id of totals)assert.equal(h.node(id).textContent,'Not loaded',id);
  for(const id of budgets)assert.equal(h.node(id).value,'',id);
  assert.equal(h.requests.length,0);assert.equal(h.mutationsDisabled(),true);
});

test('Inventory rejects a response belonging to another known business',async()=>{
  const h=harness(),pending=h.api.read('/api/inventory','inventory',{offline:true}),rejected=expectReject(pending,error=>error.status===409);
  await h.respond(0,inventoryRows(2));await rejected;
});

test('late prior-business success cannot replace or warm the current business cache',async()=>{
  const h=harness(),old=h.api.read('/api/inventory','inventory',{offline:true}),oldRejected=expectReject(old,error=>error.staleMerchantRead===true);
  h.switchBusiness(2);const current=h.api.read('/api/inventory','inventory',{offline:true});await h.respond(1,inventoryRows(2));await current;
  await h.respond(0,inventoryRows(1));await oldRejected;
  const offline=h.api.read('/api/inventory','inventory',{offline:true});await h.reject(2);assert.deepEqual(plain(await offline),inventoryRows(2));
});

test('late protected 401 from a prior session cannot log out the new session or alter its Online state',async()=>{
  const h=harness(),old=h.api.read('/api/inventory','inventory',{offline:true}),oldRejected=expectReject(old,error=>error.staleMerchantRead===true);
  h.session('dummy-session-b');h.profile({accountId:2});h.switchBusiness(2);
  const current=h.api.read('/api/inventory','inventory',{offline:true});await h.respond(1,inventoryRows(2));await current;assert.equal(h.node('onlineState').textContent,'Online');
  await h.respond(0,{error:'Expired prior session'},401);await oldRejected;
  assert.equal(h.logoutCalls(),0);assert.equal(h.window.ABLSession.authenticated(),true);assert.equal(h.node('onlineState').textContent,'Online');
});

test('context changes while a response body parses cannot publish old data or change current connectivity',async()=>{
  const h=harness();let releaseBody;const body=new Promise(resolve=>{releaseBody=resolve});
  const old=h.api.read('/api/inventory','inventory',{offline:true}),oldRejected=expectReject(old,error=>error.staleMerchantRead===true);
  h.requests[0].resolve({ok:true,status:200,headers:{get:()=> 'application/json'},json:()=>body});await tick();
  h.switchBusiness(2);const current=h.api.read('/api/inventory','inventory',{offline:true});await h.respond(1,inventoryRows(2));await current;
  releaseBody(inventoryRows(1));await oldRejected;assert.equal(h.node('onlineState').textContent,'Online');
  const offline=h.api.read('/api/inventory','inventory',{offline:true});await h.reject(2);assert.deepEqual(plain(await offline),inventoryRows(2));
});

test('later same-key request supersedes an older response without replacing its confirmed cache',async()=>{
  const h=harness(),old=h.api.read('/api/inventory','inventory',{offline:true}),oldRejected=expectReject(old,error=>error.staleMerchantRead===true);
  const current=h.api.read('/api/inventory','inventory',{offline:true});await h.respond(1,inventoryRows(1,'Newest'));await current;await h.respond(0,inventoryRows(1,'Old'));await oldRejected;
  const offline=h.api.read('/api/inventory','inventory',{offline:true});await h.reject(2);assert.equal((await offline)[0].item,'Newest');
});

test('unknown-to-known hydration accepts only a response that proves the newly active business',async()=>{
  const h=harness({businessId:null});let returned=null;
  const pending=h.api.read('/api/inventory','inventory',{offline:true}).then(rows=>{returned=rows;return rows});
  h.switchBusiness(2,{notify:false});await h.respond(0,inventoryRows(1));assert.equal(h.requests.length,2);assert.equal(returned,null);
  await h.respond(1,inventoryRows(2));assert.deepEqual(plain(await pending),inventoryRows(2));
  const offline=h.api.read('/api/inventory','inventory',{offline:true});await h.reject(2);assert.deepEqual(plain(await offline),inventoryRows(2));
});

test('financial startup response without business identity is retried in the hydrated business context',async()=>{
  const h=harness({businessId:null});let returned=null;
  const pending=h.api.read('/api/day-status','day_status').then(row=>{returned=row;return row});
  h.switchBusiness(2,{notify:false});await h.respond(0,{business_date:'2026-10-25',opening_cash:100});assert.equal(h.requests.length,2);assert.equal(returned,null);
  const current={business_date:'2026-10-26',opening_cash:200};await h.respond(1,current);assert.deepEqual(plain(await pending),current);assert.equal(h.requests.length,2);
});

test('Inventory retries an unproven startup response once after business hydration, then fails closed on a mismatch',async()=>{
  const h=harness({businessId:null}),pending=h.api.load();h.switchBusiness(2,{notify:false});await h.respond(0,inventoryRows(1));assert.equal(h.requests.length,2);
  await h.respond(1,inventoryRows(1));await pending;assert.equal(h.requests.length,2);assert.equal(h.mutationsDisabled(),true);assert.equal(h.renders.length,0);assert.match(h.status(),/does not match/i);
});

test('Inventory can recover from an unproven empty startup response using the hydrated business',async()=>{
  const h=harness({businessId:null}),pending=h.api.load();h.switchBusiness(2,{notify:false});await h.respond(0,[]);assert.equal(h.requests.length,2);
  await h.respond(1,inventoryRows(2));await pending;assert.equal(h.mutationsDisabled(),false);assert.deepEqual(h.renders,[inventoryRows(2)]);
});

test('Inventory loading hides previous details; transport fallback is visibly read-only and online recovery restores control defaults',async()=>{
  const h=harness(),initial=h.api.load();assert.equal(h.mutationsDisabled(),true);assert.equal(h.advanced.hidden,true);assert.equal(h.advanced.classList.contains('hidden'),true);assert.equal(h.stock.classList.contains('hidden'),true);await h.respond(0,inventoryRows(1));await initial;
  assert.match(h.status(),/confirmed/i);assert.equal(h.editable.disabled,false);assert.equal(h.intentionalDisabled.disabled,true);
  assert.equal(h.advanced.classList.contains('hidden'),false);assert.equal(h.stock.classList.contains('hidden'),false);
  h.submit.disabled=true; // A widget can independently disable its own control.
  const offline=h.api.load();await h.reject(1);await offline;assert.match(h.status(),/last confirmed Inventory/i);assert.match(h.status(),/changes are disabled/i);assert.equal(h.stock.hidden,false);assert.equal(h.advanced.hidden,true);assert.equal(h.mutationsDisabled(),true);assert.equal(h.advanced.classList.contains('hidden'),true);assert.equal(h.stock.classList.contains('hidden'),false);
  const retryButton=h.node('inventoryReadStatus').children.find(child=>child.tagName==='BUTTON');assert.ok(retryButton);assert.equal(h.node('inventoryReadContent').contains(retryButton),false);
  const retry=h.api.load();await h.respond(2,inventoryRows(1));await retry;assert.equal(h.advanced.hidden,false);assert.equal(h.advanced.classList.contains('hidden'),false);assert.equal(h.mutationsDisabled(),false);assert.equal(h.intentionalDisabled.disabled,true);assert.equal(h.submit.disabled,true);
});

test('Inventory readiness preserves sections that were already hidden by capability or disclosure state',async()=>{
  const h=harness(),priorHidden=new h.Element();priorHidden.className='card hidden';h.view.appendChild(priorHidden);
  const pending=h.api.load();await h.respond(0,inventoryRows(1));await pending;assert.equal(priorHidden.hidden,true);assert.equal(priorHidden.classList.contains('hidden'),true);
});

test('unresolved business never enables Inventory mutation controls',async()=>{
  const h=harness({businessId:null}),pending=h.api.load();await h.respond(0,inventoryRows(1));await pending;assert.equal(h.mutationsDisabled(),true);assert.equal(h.advanced.hidden,true);assert.doesNotMatch(h.status(),/confirmed just now/);
});

test('programmatic stock changes are blocked before confirmation, after offline fallback and after authority changes',async()=>{
  const h=harness();
  for(const[path,method]of [['/api/inventory/purchase','POST'],['/api/inventory/10/identifiers','PATCH'],['/api/inventory/consumable-rules/1','DELETE'],['/api/product-sales','POST']])await assert.rejects(h.api.raw(path,{method}),/Reload Inventory online/);
  assert.equal(h.requests.length,0);
  const online=h.api.load();await h.respond(0,inventoryRows(1));await online;
  const write=h.api.raw('/api/inventory/purchase',{method:'POST'});await h.respond(1,{id:1});await write;
  const offline=h.api.load();await h.reject(2);await offline;
  await assert.rejects(h.api.raw('/api/inventory/purchase',{method:'POST'}),/Reload Inventory online/);assert.equal(h.requests.length,3);
  h.switchBusiness(2);await assert.rejects(h.api.raw('/api/product-sales',{method:'POST'}),/Reload Inventory online/);assert.equal(h.requests.length,3);
});

test('business change exposes an idle Load Inventory button without fetching until it is clicked',async()=>{
  const h=harness(),first=h.api.load();await h.respond(0,inventoryRows(1));await first;assert.equal(h.requests.length,1);
  h.switchBusiness(2);assert.equal(h.requests.length,1);assert.equal(h.mutationsDisabled(),true);assert.deepEqual(plain(h.api.inventory()),[]);assert.equal(h.stock.classList.contains('hidden'),true);
  const button=h.node('inventoryReadStatus').children.find(child=>child.tagName==='BUTTON');assert.equal(button?.textContent,'Load Inventory');assert.equal(h.node('inventoryReadContent').contains(button),false);
  const current=button.onclick();assert.equal(h.requests.length,2);assert.equal(h.requests[1].path,'/api/inventory');await h.respond(1,inventoryRows(2));await current;
  assert.deepEqual(plain(h.api.inventory()),inventoryRows(2));assert.equal(h.mutationsDisabled(),false);assert.match(h.status(),/confirmed just now/i);assert.equal(h.requests.length,2);
});

for(const cause of ['offline signal','current transport failure'])test(`confirmed Inventory becomes read-only on ${cause} and needs fresh load before stock writes resume`,async()=>{
  const h=harness(),first=h.api.load();await h.respond(0,inventoryRows(1));await first;assert.equal(h.mutationsDisabled(),false);
  if(cause==='offline signal')h.api.online(false);
  else{const index=h.requests.length,pending=h.api.raw('/api/summary'),rejected=expectReject(pending,transportError);await h.reject(index);await rejected}
  assert.equal(h.node('onlineState').textContent,'Offline');assert.equal(h.mutationsDisabled(),true);assert.match(h.status(),/last confirmed Inventory/i);assert.equal(h.stock.classList.contains('hidden'),false);assert.equal(h.advanced.classList.contains('hidden'),true);
  const beforeWrites=h.requests.length;
  for(const path of ['/api/inventory/purchase','/api/product-sales'])await assert.rejects(h.api.raw(path,{method:'POST'}),/Reload Inventory online/);
  assert.equal(h.requests.length,beforeWrites);
  h.api.online(true);assert.equal(h.mutationsDisabled(),true);await assert.rejects(h.api.raw('/api/inventory/purchase',{method:'POST'}),/Reload Inventory online/);assert.equal(h.requests.length,beforeWrites);
  const retry=h.api.load();await h.respond(beforeWrites,inventoryRows(1));await retry;assert.equal(h.mutationsDisabled(),false);assert.match(h.status(),/confirmed just now/i);
  const writeIndex=h.requests.length,write=h.api.raw('/api/inventory/purchase',{method:'POST'});await h.respond(writeIndex,{id:1});await write;
});

for(const caller of ['setView','refreshCurrentMerchantView'])test(`actual ${caller} handles stale financial cancellation without console or unhandled rejection noise`,async()=>{
  const h=harness(),history=h.node('viewHistory');h.view.className='view hidden';history.className=caller==='setView'?'view hidden':'view';
  h.document.querySelectorAll=selector=>selector==='.view'?[h.view,history]:[];
  h.installLoader('loadTransactions');h.installLoader('loadMerchantView');const call=h.installLoader(caller),pending=caller==='setView'?call('History'):call();assert.equal(h.requests.length,1);
  h.switchBusiness(2);await h.respond(0,[{id:1,note:'Synthetic stale ledger row'}]);await pending;await tick();
  assert.deepEqual(h.consoleErrors,[]);assert.equal(h.node('historyList').children.length,0);assert.equal(h.node('recentList').children.length,0);assert.equal(h.logoutCalls(),0);
});

test('late Inventory success and error cannot replace the current successful business view',async()=>{
  for(const failure of [false,true]){
    const h=harness(),old=h.api.load();h.switchBusiness(2);const current=h.api.load();await h.respond(1,inventoryRows(2));await current;
    if(failure)await h.reject(0,new Error('Previous business failed'));else await h.respond(0,inventoryRows(1));await old;
    assert.deepEqual(plain(h.api.inventory()),inventoryRows(2));assert.match(h.status(),/confirmed/i);assert.equal(h.mutationsDisabled(),false);assert.deepEqual(h.renders,[inventoryRows(2)]);
  }
});

test('auxiliary Inventory reads start in parallel while a delayed allergen result loses authority after a context change',async()=>{
  const h=harness(),release=h.pauseAllergens(),old=h.api.load();await h.respond(0,inventoryRows(1));assert.ok(h.nested.some(x=>x.name==='allergens'));
  assert.ok(h.nested.some(x=>x.name==='locations'));assert.ok(h.nested.some(x=>x.name==='restock'));
  const allergenGuard=h.nested.find(x=>x.name==='allergens').args[0];h.switchBusiness(2);assert.equal(allergenGuard(),false);release();await old;assert.equal(h.mutationsDisabled(),true);assert.deepEqual(plain(h.api.inventory()),[]);assert.doesNotMatch(h.status(),/confirmed just now/);
});

test('context change during location loading prevents count and later nested Inventory stages',async()=>{
  const h=harness(),release=h.pauseLocations(),old=h.api.load();await h.respond(0,inventoryRows(1));assert.ok(h.nested.some(x=>x.name==='locations'));
  h.switchBusiness(2);release();await old;assert.equal(h.nested.some(x=>x.name==='count'),false);assert.equal(h.mutationsDisabled(),true);assert.doesNotMatch(h.status(),/confirmed just now/);
});

const nestedLoaders=[
  ['loadRestockSuggestions','restockSummary'],['loadInventoryLots','lotSummary'],['loadStockAdjustments','stockAdjustmentList'],['loadWasteAnalytics','wasteAnalyticsSummary'],['loadConsumableRules','consumableRuleList'],['loadInventoryUnavailableAllocations','inventoryUnavailableList']
];
for(const[name,target]of nestedLoaders)test(`${name} ignores stale success and stale failure`,async()=>{
  for(const fail of [false,true]){
    const h=harness(),load=h.installLoader(name),guard=h.api.guard();h.context.selectedPositiveInventoryId=()=>10;
    const pending=name==='loadWasteAnalytics'?load(7,guard):load(guard);h.switchBusiness(2);h.node(target).textContent='Current business result';
    if(fail)await h.reject(0,new Error('Stale nested failure'));else await h.respond(0,[]);await pending;assert.equal(h.node(target).textContent,'Current business result');
  }
});

for(const change of ['business','selected item','adjustment kind'])test(`lot picker ignores late success and error after ${change} changes`,async()=>{
  for(const fail of [false,true]){
    const h=harness(),load=h.installLoader('loadStockAdjustmentLots');h.node('stockAdjustmentInventory').value='10';h.node('stockAdjustmentKind').value='waste';
    const pending=load();
    if(change==='business')h.switchBusiness(2);
    if(change==='selected item')h.node('stockAdjustmentInventory').value='20';
    if(change==='adjustment kind')h.node('stockAdjustmentKind').value='expired';
    const currentLots=[{id:222,quantity_remaining_base:5,base_unit:'unit'}];h.api.setAdjustmentLots(currentLots);
    const picker=h.node('stockAdjustmentLot');picker.replaceChildren(new h.context.Option('Current confirmed lot','222'));picker.disabled=false;h.node('stockAdjustmentLotHelp').textContent='Current picker help';
    if(fail)await h.reject(0,new Error('Stale lot picker failed'));else await h.respond(0,[{id:111,quantity_remaining_base:8,base_unit:'unit'}]);await pending;
    assert.deepEqual(plain(h.api.adjustmentLots()),currentLots);assert.equal(picker.children.length,1);assert.equal(picker.children[0].value,'222');assert.equal(picker.disabled,false);assert.equal(h.node('stockAdjustmentLotHelp').textContent,'Current picker help');
  }
});

test('lot picker still renders current business lots and enables their selection',async()=>{
  const h=harness(),load=h.installLoader('loadStockAdjustmentLots');h.node('stockAdjustmentInventory').value='10';h.node('stockAdjustmentKind').value='waste';
  const pending=load(),rows=[{id:111,quantity_remaining_base:8,base_unit:'unit',internal_lot_code:'SYNTHETIC-111'}];await h.respond(0,rows);assert.deepEqual(plain(await pending),rows);assert.equal(h.node('stockAdjustmentLot').children[1].value,'111');assert.equal(h.node('stockAdjustmentLot').disabled,false);
});

for(const change of ['business','selected item'])test(`ingredient allergen editor ignores late success and error after ${change} changes`,async()=>{
  for(const fail of [false,true]){
    const h=harness(),load=h.installLoader('loadIngredientAllergens');h.node('ingredientAllergenInventory').value='10';
    h.context.renderAllergenChecks=(host,name,codes)=>{h.node(host).textContent=JSON.stringify(codes)};
    const pending=load().then(value=>({value}),error=>({error}));
    if(change==='business')h.switchBusiness(2);else h.node('ingredientAllergenInventory').value='20';
    h.node('ingredientContainsGrid').textContent='Current contains';h.node('ingredientMayContainGrid').textContent='Current may contain';h.node('ingredientAllergenNote').value='Current note';
    if(fail)await h.reject(0,new Error('Stale ingredient evidence failed'));else await h.respond(0,{contains:['synthetic-old'],may_contain:['synthetic-may'],note:'Old note'});
    const outcome=await pending;assert.equal(h.node('ingredientContainsGrid').textContent,'Current contains');assert.equal(h.node('ingredientMayContainGrid').textContent,'Current may contain');assert.equal(h.node('ingredientAllergenNote').value,'Current note');assert.equal(outcome.error?.staleMerchantRead,true);
  }
});

for(const change of ['business','selected item'])test(`unavailable-stock history ignores late success and error after ${change} changes`,async()=>{
  for(const fail of [false,true]){
    const h=harness(),load=h.installLoader('loadInventoryUnavailableAllocations');h.context.selectedPositiveInventoryId=select=>Number(select.value)||null;h.node('inventoryUnavailableItem').value='10';
    const pending=load();if(change==='business')h.switchBusiness(2);else h.node('inventoryUnavailableItem').value='20';
    h.node('inventoryUnavailableList').textContent='Current unavailable-stock history';h.node('inventoryUnavailableMessage').textContent='Current history message';
    if(fail)await h.reject(0,new Error('Stale history failed'));else await h.respond(0,[{id:111,state:'released',reason:'other',quantity:2,unit:'unit'}]);await pending;
    assert.equal(h.node('inventoryUnavailableList').textContent,'Current unavailable-stock history');assert.equal(h.node('inventoryUnavailableMessage').textContent,'Current history message');
  }
});

for(const component of ['locations','count','scan'])test(`actual ${component} component rejects stale successes/errors and reset invalidates retained state`,async()=>{
  for(const fail of [false,true]){
    const h=harness(),ui=component==='locations'?h.installComponent('inventory-location-ui.js','createInventoryLocationUi'):component==='count'?h.installComponent('inventory-count-ui.js','createInventoryCountUi'):h.installComponent('inventory-scan-ui.js','createInventoryScanUi');
    const old=component==='scan'?ui.lookup({query:'Synthetic item'}):ui.load();
    const target=component==='locations'?'inventoryTransferMessage':component==='count'?'countSessionMessage':'inventoryLookupMessage';
    h.switchBusiness(2);h.node(target).textContent='Current component state';
    if(fail)await h.reject(0,new Error('Previous component failure'));
    else if(component==='locations'){await h.respond(0,{locations:[{id:1,name:'Prior location'}],balances:[],transfers:[]})}
    else await h.respond(0,component==='count'?{id:1,status:'posted'}:[]);
    await old;assert.equal(h.node(target).textContent,'Current component state');
    if(component==='locations')assert.deepEqual(plain(ui.getLocations()),[]);
    if(component==='count')assert.equal(ui.getSession(),null);
    assert.equal(typeof ui.reset,'function');ui.reset();
    if(component==='locations')assert.deepEqual(plain(ui.getBalances()),[]);
    if(component==='count')assert.equal(ui.getSession(),null);
  }
});

test('location and count reset clear confirmed private closure state and invalidate their own pending reads',async()=>{
  for(const component of ['locations','count']){
    const h=harness(),ui=component==='locations'?h.installComponent('inventory-location-ui.js','createInventoryLocationUi'):h.installComponent('inventory-count-ui.js','createInventoryCountUi');
    const initial=ui.load();
    if(component==='locations'){await h.respond(0,{locations:[{id:1,name:'Synthetic confirmed location'}],balances:[],transfers:[]});await initial;assert.equal(ui.getLocations().length,1)}
    else{await h.respond(0,{id:1,status:'posted'});await initial;assert.equal(ui.getSession().id,1)}
    const index=h.requests.length,pending=ui.load();ui.reset();
    if(component==='locations'){await h.respond(index,{locations:[{id:2,name:'Synthetic late location'}],balances:[],transfers:[]})}
    else await h.respond(index,{id:2,status:'posted'});
    await pending;
    if(component==='locations')assert.deepEqual(plain(ui.getLocations()),[]);else assert.equal(ui.getSession(),null);
  }
});

const confirmedCount={id:44,status:'in_progress',items:[{inventory_id:10,item:'Synthetic private count item',unit:'unit',counted_quantity:null}],progress:{total:1,counted:0,remaining:1}};
const confirmedLocations=[{id:11,name:'Synthetic private location'}];
const confirmedBalances=[{inventory_id:10,location_id:11,item:'Synthetic private stock',location_name:'Synthetic private location',quantity:4,unit:'unit'}];
const confirmedTransfers=[{id:12,item:'Synthetic private stock',quantity:1,unit:'unit',source_location:'Synthetic private source',destination_location:'Synthetic private destination'}];
const confirmedStorage={locations:confirmedLocations,balances:confirmedBalances,transfers:confirmedTransfers};

for(const component of ['locations','count'])for(const status of [403,500])test(`actual ${component} HTTP ${status} after success clears retained private state and reports failed read evidence`,async()=>{
  const h=harness(),ui=component==='locations'?h.installComponent('inventory-location-ui.js','createInventoryLocationUi'):h.installComponent('inventory-count-ui.js','createInventoryCountUi');
  const first=ui.load();
  if(component==='locations'){
    await h.respond(0,confirmedStorage);await first;
    assert.equal(ui.getLocations().length,1);assert.equal(ui.getBalances().length,1);assert.equal(h.node('inventoryTransferList').children.length,1);
  }else{await h.respond(0,confirmedCount);await first;assert.equal(ui.getSession().id,44);assert.equal(h.node('countSessionActivePane').classList.contains('hidden'),false)}
  const start=h.requests.length,failed=ui.load();await h.respond(start,{error:'Synthetic current read denied'},status);

  const result=await failed;assert.equal(result?.readError,true);
  if(component==='locations'){
    assert.deepEqual(plain(ui.getLocations()),[]);assert.deepEqual(plain(ui.getBalances()),[]);
    assert.ok(h.node('inventoryLocationBalanceList').children.every(child=>!child.innerHTML.includes('Synthetic private')));
    assert.ok(h.node('inventoryTransferList').children.every(child=>!child.innerHTML.includes('Synthetic private')));
  }else{assert.equal(ui.getSession(),null);assert.equal(h.node('countSessionActivePane').classList.contains('hidden'),true);assert.equal(h.node('countSessionReviewPane').classList.contains('hidden'),true)}
});

async function completeRealInventoryRead(h,{failedComponent=null,status=200}={}){
  const start=h.requests.length,pending=h.api.load();await h.respond(start,inventoryRows(1));
  assert.match(h.requests[start+1]?.path||'',/\/inventory\/location-summary$/);
  await h.respond(start+1,failedComponent==='locations'?{error:'Synthetic current locations denied'}:confirmedStorage,failedComponent==='locations'?status:200);
  if(failedComponent!=='locations'){
    assert.match(h.requests[start+2]?.path||'',/\/count-sessions\/active$/);
    await h.respond(start+2,failedComponent==='count'?{error:'Synthetic current count denied'}:confirmedCount,failedComponent==='count'?status:200);
  }
  await pending;
}

for(const failedComponent of ['locations','count'])for(const status of [403,500])test(`Inventory remains disabled after current ${failedComponent} HTTP ${status} until a complete successful retry`,async()=>{
  const h=harness(),locations=h.installComponent('inventory-location-ui.js','createInventoryLocationUi'),count=h.installComponent('inventory-count-ui.js','createInventoryCountUi');
  h.context.inventoryLocationUi=locations;h.context.inventoryCountUi=count;
  await completeRealInventoryRead(h);assert.equal(h.mutationsDisabled(),false);assert.equal(count.getSession().id,44);assert.equal(locations.getLocations().length,1);
  await completeRealInventoryRead(h,{failedComponent,status});assert.equal(h.mutationsDisabled(),true);assert.equal(h.advanced.hidden,true);assert.equal(h.advanced.classList.contains('hidden'),true);assert.match(h.status(),/could not be loaded/i);assert.doesNotMatch(h.status(),/confirmed just now/i);
  if(failedComponent==='locations')assert.deepEqual(plain(locations.getLocations()),[]);else assert.equal(count.getSession(),null);
  const requestsBeforeWrite=h.requests.length;await assert.rejects(h.api.raw('/api/inventory/purchase',{method:'POST'}),/Reload Inventory online/);assert.equal(h.requests.length,requestsBeforeWrite);
  await completeRealInventoryRead(h);assert.equal(h.mutationsDisabled(),false);assert.equal(h.advanced.hidden,false);assert.match(h.status(),/confirmed just now/i);assert.equal(count.getSession().id,44);assert.equal(locations.getLocations().length,1);
});
