import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {orderReceivableAmount,ordersReceivableTotal} from '../public/orders-receivable-view.js';

const source=readFileSync(new URL('../public/orders-ui.js',import.meta.url),'utf8').replace(/^import .*\n/,'');
// A small DOM fixture parses the real rendered markup. No Orders rendering,
// binder, request, authority or mutation implementation is replaced in this VM.
class Element{
  constructor(tag='div',attrs={}){this.tag=tag;this.attrs=attrs;this.children=[];this.parent=null;this.listeners={};this.style={};this._text='';this._value=null}
  get id(){return this.attrs.id} set id(value){this.attrs.id=value}
  get className(){return this.attrs.class||''} set className(value){this.attrs.class=value}
  get classList(){return {contains:name=>this.className.split(' ').includes(name),add:name=>{if(!this.classList.contains(name))this.className+=' '+name},remove:name=>{this.className=this.className.split(' ').filter(x=>x!==name).join(' ')}}}
  get dataset(){return Object.fromEntries(Object.entries(this.attrs).filter(([k])=>k.startsWith('data-')).map(([k,v])=>[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),v]))}
  appendChild(child){child.parent=this;this.children.push(child);return child}
  get innerHTML(){return this._html||''}
  set innerHTML(html){this._html=html;this.children=[];this._text='';const stack=[this];
    for(const token of html.match(/<[^>]*>|[^<]+/g)||[]){
      if(token.startsWith('</')){if(stack.length>1)stack.pop();continue}
      if(token.startsWith('<')){const tag=token.match(/^<([\w-]+)/)?.[1];if(!tag)continue;
        const attrs={};for(const match of token.slice(tag.length+1,-1).matchAll(/([\w-]+)(?:="([^"]*)")?/g))attrs[match[1]]=match[2]??'';
        const child=stack.at(-1).appendChild(new Element(tag,attrs));if(!['input','br','img','hr','meta','link'].includes(tag))stack.push(child);
      }else stack.at(-1)._text+=token;
    }
  }
  get textContent(){return this._text+this.children.map(c=>c.textContent).join('')} set textContent(value){this._text=value;this.children=[]}
  get value(){if(this._value!==null)return this._value;if(this.tag==='select')return this.querySelector('option')?.value??'';return this.attrs.value??''} set value(value){this._value=String(value)}
  get selectedOptions(){return this.querySelectorAll('option').filter(x=>x.value===this.value)}
  matches(selector){if(selector.endsWith(':checked'))return this.attrs.checked!==undefined&&this.matches(selector.slice(0,-8));
    if(selector.startsWith('#'))return this.id===selector.slice(1);if(selector.startsWith('.'))return this.classList.contains(selector.slice(1));
    const attr=selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);if(attr)return this.attrs[attr[1]]!==undefined&&(attr[2]===undefined||this.attrs[attr[1]]===attr[2]);return this.tag===selector}
  querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)])}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null}
  closest(selector){return this.matches(selector)?this:this.parent?.closest(selector)||null}
  addEventListener(name,listener){(this.listeners[name]??=[]).push(listener)}
  insertAdjacentElement(_where,element){this.parent?.appendChild(element)}
}
async function flush(){for(let i=0;i<12;i++)await Promise.resolve()}
function browser({business=1,account=6,role='merchant',known=true}={}){
  const events=new Map(),body=new Element('body'),shell=body.appendChild(new Element('main',{id:'shell'}));
  shell.appendChild(new Element('div',{class:'topbar'}));const board=shell.appendChild(new Element('section',{id:'ordersWorkspace',class:'hidden'}));
  const backdrop=body.appendChild(new Element('div',{id:'orderModalBackdrop',class:'hidden'})),modal=backdrop.appendChild(new Element('div',{id:'orderModal'}));
  const toast=body.appendChild(new Element('div',{id:'roleToast'}));
  const document={readyState:'loading',hidden:false,body,createElement:tag=>new Element(tag),
    getElementById:id=>body.querySelector('#'+id),querySelector:s=>body.querySelector(s),querySelectorAll:s=>body.querySelectorAll(s),
    addEventListener(name,callback){if(!events.has(name))events.set(name,[]);events.get(name).push(callback)}};
  const state={account,role,business,session:'in-memory-test-session-A',authenticated:true,known};
  const window={ABLSession:{authenticated:()=>state.authenticated,csrfToken:()=>state.session},
    BusinessLifeAccounting:{getState:()=>({role:state.role,activeBusinessId:state.known?state.business:null,businesses:[{id:1},{id:2}]})},
    BusinessLifeShell:{openFeatureWorkspace(){board.classList.remove('hidden');emit('abl:feature-workspace',{workspaceId:'ordersWorkspace',activeRole:state.role});return true},showActiveWorkspace(){}}};
  function profile(patch={}){window.BusinessLifeProfileState={surface:'profile',activeRole:state.role,accountId:state.account,navigationEpoch:1,snapshot:{account:{id:state.account},businesses:[{id:1},{id:2}]},...patch}}
  function emit(name,detail){for(const callback of events.get(name)||[])callback({detail})}
  profile();const calls=[];
  const context=vm.createContext({window,document,Intl,Date,Number,JSON,orderReceivableAmount,ordersReceivableTotal,confirm:()=>false,
    alert:()=>assert.fail('unexpected alert'),setTimeout:()=>0,fetch:(path,options={})=>new Promise((resolve,reject)=>calls.push({path,options,resolve,reject}))});
  vm.runInContext(source,context);
  const respond=(call,data=[],status=200)=>{assert.ok(call,'expected pending API call');call.resolve({ok:status<400,status,json:async()=>data})};
  const pending=()=>calls.filter(c=>!c.done);
  async function boardResponse(batch,label='CURRENT',opts={}){for(const call of batch){call.done=true;
      if(call.path.includes('/products?'))respond(call,[{id:3,source_kind:'marketplace_product',name:label+' PRODUCT',category:'Food',selling_price:1,published:false,available:true}],opts.productsStatus??200);
      else if(call.path.includes('/inventory?'))respond(call,[{id:8,item:label+' INVENTORY',unit:'unit',quantity:1}],opts.inventoryStatus??200);
      else respond(call,[{id:9,order_number:label,order_status:'accepted',total:1,outstanding_amount:1,payment_status:'unpaid',fulfilment_method:'pickup',created_at:'2026-10-26T00:00:00Z',business_name:label}],opts.status??200);
    }await flush()}
  const globals=()=>vm.runInContext('({productsCache,productsLoadError,directSaleInventory,directSaleInventoryError,merchantBusinessId,ordersMode,pending:Boolean(ordersRequest)})',context);
  async function open(){const task=context.openMerchantOrders();await flush();return {task,batch:pending()}}
  async function switchBusiness(id){state.business=id;state.known=true;emit('abl:business-workspace-changed',{role:'merchant',activeBusinessId:id});await flush()}
  return {context,state,window,document,board,backdrop,modal,toast,calls,pending,profile,emit,respond,boardResponse,globals,open,switchBusiness,boot:()=>context.boot()};
}

for(const staleError of [false,true])test(`late business A ${staleError?'error':'success'} cannot overwrite business B board or either picker`,async()=>{
  const b=browser();await b.boot();const old=await b.open();await b.switchBusiness(2);const current=b.pending().filter(c=>!old.batch.includes(c));
  await b.boardResponse(current,'BUSINESS-B');await b.boardResponse(old.batch,'BUSINESS-A',{status:staleError?403:200,productsStatus:403,inventoryStatus:403});await old.task;
  assert.match(b.board.innerHTML,/BUSINESS-B/);assert.doesNotMatch(b.board.innerHTML,/BUSINESS-A|couldn’t load/);
  const g=b.globals();assert.equal(g.merchantBusinessId,2);assert.equal(g.productsCache[0].name,'BUSINESS-B PRODUCT');assert.equal(g.directSaleInventory[0].item,'BUSINESS-B INVENTORY');assert.equal(g.productsLoadError,'');assert.equal(g.directSaleInventoryError,'');
});

test('independent old picker completions cannot write after newer board has committed',async()=>{
  const b=browser();await b.boot();const old=await b.open();const list=old.batch.find(c=>c.path.includes('/list?'));b.respond(list,[]);await flush();
  assert.equal(b.globals().productsCache.length,0);await b.switchBusiness(2);await b.boardResponse(b.pending().filter(c=>!old.batch.includes(c)),'NEW');
  for(const c of old.batch.filter(c=>c!==list))b.respond(c,[{id:111,name:'OLD CACHE',item:'OLD CACHE'}]);await old.task;
  assert.equal(b.globals().productsCache[0].name,'NEW PRODUCT');assert.equal(b.globals().directSaleInventory[0].item,'NEW INVENTORY');
});

test('late Merchant response cannot replace Customer history or restore Merchant controls',async()=>{
  const b=browser();await b.boot();const old=await b.open();b.state.role='customer';b.profile({navigationEpoch:2});b.emit('abl:profile-state',b.window.BusinessLifeProfileState);
  const customer=b.context.openCustomerOrders();await flush();await b.boardResponse(b.pending().filter(c=>!old.batch.includes(c)),'CUSTOMER');await customer;
  await b.boardResponse(old.batch,'OLD MERCHANT');await old.task;
  assert.match(b.board.innerHTML,/My Orders|CUSTOMER/);assert.doesNotMatch(b.board.innerHTML,/New counter order|OLD MERCHANT/);assert.equal(b.globals().productsCache.length,0);
});

for(const transition of ['account','session','logout','account-home','other-feature','close'])test(`${transition} invalidates pending board and caches, including same-business reopen`,async()=>{
  const b=browser();await b.boot();const old=await b.open();
  if(transition==='account'){b.state.account=7;b.profile();b.emit('abl:profile-state',b.window.BusinessLifeProfileState)}
  if(transition==='session'){b.state.session='in-memory-test-session-B'}
  if(transition==='logout'){b.state.authenticated=false;b.state.session='';b.emit('abl:auth-expired');b.state.authenticated=true;b.state.session='in-memory-test-session-B'}
  if(transition==='account-home'){b.profile({surface:'account',activeRole:null,navigationEpoch:2});b.emit('abl:profile-state',b.window.BusinessLifeProfileState);b.profile({navigationEpoch:3})}
  if(transition==='other-feature')b.emit('abl:feature-workspace',{workspaceId:'catalogWorkspace',activeRole:'merchant'});
  if(transition==='close')b.context.closeOrders();
  const next=await b.open();await b.boardResponse(next.batch.filter(c=>!old.batch.includes(c)),'NEW CONTEXT');await next.task;
  await b.boardResponse(old.batch,'OLD CONTEXT');await old.task;
  assert.match(b.board.innerHTML,/NEW CONTEXT/);assert.doesNotMatch(b.board.innerHTML,/OLD CONTEXT/);assert.equal(b.globals().productsCache[0].name,'NEW CONTEXT PRODUCT');
});

test('same profile/business hydration and own feature events preserve one valid in-flight load',async()=>{
  const b=browser();await b.boot();const {task,batch}=await b.open();
  b.profile();b.emit('abl:profile-state',b.window.BusinessLifeProfileState);await b.switchBusiness(1);
  b.emit('abl:business-workspace-changed',{role:'supplier',activeBusinessId:2});b.emit('abl:feature-workspace',{workspaceId:'ordersWorkspace'});
  const deduplicated=b.context.renderMerchantOrders(false);await flush();assert.equal(b.calls.length,3);
  await b.boardResponse(batch,'HYDRATED');await Promise.all([task,deduplicated]);assert.match(b.board.innerHTML,/HYDRATED/);
});

test('unknown workspace resolves matching initial accounting hydration without another API loop',async()=>{
  const b=browser({known:false});await b.boot();const {task}=await b.open();assert.equal(b.calls.length,1);
  b.state.known=true;b.respond(b.calls[0],{active_business_id:1});await flush();assert.equal(b.calls.length,4);
  await b.boardResponse(b.calls.slice(1),'MATCHED');await task;assert.equal(b.globals().merchantBusinessId,1);assert.equal(b.calls.length,4);
});

for(const event of ['none','profile','business'])test(`unknown A workspace cannot bind later known B (${event} hydration event)`,async()=>{
  const b=browser({known:false});await b.boot();const {task}=await b.open();const workspace=b.calls[0];b.state.known=true;b.state.business=2;
  if(event==='profile'){b.profile();b.emit('abl:profile-state',b.window.BusinessLifeProfileState)}
  if(event==='business')b.emit('abl:business-workspace-changed',{role:'merchant',activeBusinessId:2});
  b.respond(workspace,{active_business_id:1});await flush();
  const reads=b.calls.filter(c=>c!==workspace);assert.equal(reads.length,3);assert.ok(reads.every(c=>c.path.endsWith('business_id=2')));
  await b.boardResponse(reads,'RIGHT BUSINESS');await task;assert.equal(b.globals().merchantBusinessId,2);assert.equal(b.calls.length,4);
});

test('old reload finalization cannot release a newer pending request or create extra requests',async()=>{
  const b=browser();await b.boot();const old=await b.open();const newer=b.context.renderMerchantOrders(true,true);await flush();const batch=b.calls.slice(3);
  await b.boardResponse(old.batch,'OLD');await old.task;assert.equal(b.globals().pending,true);
  const duplicate=b.context.renderMerchantOrders(false);await flush();assert.equal(b.calls.length,6);
  await b.boardResponse(batch,'LATEST');await Promise.all([newer,duplicate]);assert.equal(b.globals().pending,false);assert.match(b.board.innerHTML,/LATEST/);
});

test('current API error remains retryable and picker errors do not masquerade as empty catalog',async()=>{
  const b=browser();await b.boot();const old=await b.open();await b.boardResponse(old.batch,'DENIED',{status:403});await old.task;assert.match(b.board.innerHTML,/Try again/);
  const retry=b.board.querySelector('[data-orders-retry]');retry.listeners.click[0]();await flush();const batch=b.calls.slice(3);await b.boardResponse(batch,'RECOVERED',{productsStatus:403,inventoryStatus:403});
  assert.match(b.board.innerHTML,/Counter catalog could not be loaded/);assert.equal(b.globals().productsCache.length,0);assert.ok(b.globals().productsLoadError);assert.ok(b.globals().directSaleInventoryError);assert.equal(b.state.authenticated,true);
});

test('hidden document response stays inert and visibility resumes one current load',async()=>{
  const b=browser();await b.boot();const old=await b.open();b.document.hidden=true;b.emit('visibilitychange');await b.boardResponse(old.batch,'HIDDEN');await old.task;assert.doesNotMatch(b.board.innerHTML,/HIDDEN/);
  b.document.hidden=false;b.emit('visibilitychange');await flush();assert.equal(b.calls.length,6);await b.boardResponse(b.calls.slice(3),'VISIBLE');assert.match(b.board.innerHTML,/VISIBLE/);
});

async function ready(b){await b.boot();const opened=await b.open();await b.boardResponse(opened.batch,'INITIAL');await opened.task}
const submit={preventDefault(){}};
function fillCounter(b){b.board.querySelector('[data-counter-product]').value='1';b.document.getElementById('counterCustomer').value='Test customer';b.document.getElementById('counterNote').value='Test note';return b.document.getElementById('counterOrderForm')}

test('current counter creation preserves canonical item/business and refreshes past a pre-mutation read',async()=>{
  const b=browser();await ready(b);const form=fillCounter(b);const background=b.context.renderMerchantOrders(false);await flush();const stale=b.calls.slice(3);
  const mutation=form.onsubmit(submit);await flush();const post=b.calls.at(-1),body=JSON.parse(post.options.body);
  assert.equal(post.path,'/api/orders/merchant/create');assert.equal(body.business_id,1);assert.deepEqual(body.items,[{product_id:3,source_kind:'marketplace_product',quantity:1,variant_id:null,modifier_option_ids:[]}]);
  await b.boardResponse(stale,'PRE-MUTATION');await background;assert.doesNotMatch(b.board.innerHTML,/PRE-MUTATION/);
  b.respond(post,{id:10});await flush();const latest=b.calls.slice(7);assert.equal(latest.length,3);await b.boardResponse(latest,'CREATED');await mutation;
  assert.match(b.board.innerHTML,/CREATED/);assert.equal(b.toast.textContent,'Order created.');
});

for(const failure of [false,true])test(`old counter mutation ${failure?'error':'success'} cannot change new-business form, toast or request count`,async()=>{
  const b=browser();await ready(b);const form=fillCounter(b),mutation=form.onsubmit(submit);await flush();const post=b.calls.at(-1);
  await b.switchBusiness(2);await b.boardResponse(b.calls.slice(4),'BUSINESS TWO');const newForm=fillCounter(b),before=b.calls.length;
  b.document.getElementById('counterMessage').textContent='New form retained';b.respond(post,{error:'old mutation failure'},failure?409:200);await mutation;
  assert.equal(b.document.getElementById('counterOrderForm'),newForm);assert.equal(b.document.getElementById('counterMessage').textContent,'New form retained');assert.equal(b.calls.length,before);assert.equal(b.toast.textContent,'');assert.equal(JSON.parse(post.options.body).business_id,1);
});

test('current direct-sale product submit remains private and refreshes the current business',async()=>{
  const b=browser();await ready(b);b.document.getElementById('ordersDirectName').value='Private carrot';b.document.getElementById('ordersDirectPrice').value='3';
  const mutation=b.document.getElementById('ordersDirectProductForm').onsubmit(submit);await flush();const post=b.calls.at(-1),payload=JSON.parse(post.options.body);
  assert.equal(post.path,'/api/merchant/storefront/products');assert.equal(payload.business_id,1);assert.equal(payload.inventory_id,8);assert.equal(payload.published,false);
  b.respond(post,{id:20});await flush();await b.boardResponse(b.calls.slice(4),'PRODUCT ADDED');await mutation;assert.match(b.board.innerHTML,/PRODUCT ADDED/);
});

test('current status and cancel mutations retain API semantics and refresh the board',async()=>{
  const b=browser();await ready(b);let mutation=b.context.merchantAction('start',9,false);await flush();let post=b.calls.at(-1);assert.equal(post.path,'/api/orders/merchant/9/start');b.respond(post,{});await flush();await b.boardResponse(b.calls.slice(4),'PREPARING');await mutation;
  b.context.openCancelModal(9);b.document.getElementById('orderCancelReason').value='controlled test';mutation=b.document.getElementById('orderCancelForm').onsubmit(submit);await flush();post=b.calls.at(-1);
  assert.equal(post.path,'/api/orders/merchant/9/cancel');assert.deepEqual(JSON.parse(post.options.body),{reason:'controlled test'});b.respond(post,{});await flush();await b.boardResponse(b.calls.slice(8),'CANCELLED');await mutation;
  assert.equal(b.backdrop.classList.contains('hidden'),true);assert.match(b.toast.textContent,/cancelled/);assert.match(b.board.innerHTML,/CANCELLED/);
});

test('old status response after Customer switch cannot refresh or toast into Customer context',async()=>{
  const b=browser();await ready(b);const mutation=b.context.merchantAction('start',9,false);await flush();const post=b.calls.at(-1);
  b.state.role='customer';b.profile({navigationEpoch:2});b.emit('abl:profile-state',b.window.BusinessLifeProfileState);const opened=b.context.openCustomerOrders();await flush();await b.boardResponse([b.calls.at(-1)],'CUSTOMER');await opened;
  const before=b.calls.length;b.respond(post,{});await mutation;assert.equal(b.calls.length,before);assert.equal(b.toast.textContent,'');assert.match(b.board.innerHTML,/My Orders/);
});

test('payment detail callbacks target only their own open modal and handle current errors',async()=>{
  const b=browser();await ready(b);b.context.openPaymentModal(9);const old=b.calls.at(-1);b.context.closeOrderModal();b.context.openPaymentModal(10);const current=b.calls.at(-1);
  b.document.getElementById('orderPayAmount').value='42';b.respond(old,{outstanding_amount:99,payment_method:'cash'});await flush();assert.equal(b.document.getElementById('orderPayAmount').value,'42');
  b.respond(current,{error:'Payment details unavailable'},403);await flush();assert.equal(b.document.getElementById('orderModalMessage').textContent,'Payment details unavailable');
});

for(const failure of [false,true])test(`old modal POST ${failure?'error':'success'} cannot close or overwrite replacement modal`,async()=>{
  const b=browser();await ready(b);b.context.openCancelModal(9);b.document.getElementById('orderCancelReason').value='old test';const mutation=b.document.getElementById('orderCancelForm').onsubmit(submit);await flush();const old=b.calls.at(-1);
  b.context.closeOrderModal();b.context.openCancelModal(10);const replacement=b.document.getElementById('orderCancelForm');b.document.getElementById('orderModalMessage').textContent='replacement retained';const before=b.calls.length;
  b.respond(old,{error:'old failure'},failure?409:200);await mutation;
  assert.equal(b.document.getElementById('orderCancelForm'),replacement);assert.equal(b.document.getElementById('orderModalMessage').textContent,'replacement retained');assert.equal(b.backdrop.classList.contains('hidden'),false);assert.equal(b.calls.length,before);assert.equal(b.toast.textContent,'');
});

test('repeated same-context open calls reuse one pending API set',async()=>{
  const b=browser();await b.boot();const first=await b.open(),second=b.context.openMerchantOrders();await flush();assert.equal(b.calls.length,3);
  await b.boardResponse(first.batch,'ONE READ');await Promise.all([first.task,second]);assert.match(b.board.innerHTML,/ONE READ/);
});

test('visible refresh after session replacement clears old board without using prior authority',async()=>{
  const b=browser();await ready(b);b.state.session='in-memory-test-session-B';await b.context.renderMerchantOrders(false);
  assert.equal(b.calls.length,3);assert.equal(b.board.classList.contains('hidden'),true);assert.equal(b.board.innerHTML,'');assert.equal(b.globals().productsCache.length,0);
});

test('Refresh during current counter POST waits for its single fresh read instead of replacing the form',async()=>{
  const b=browser();await ready(b);const form=fillCounter(b),mutation=form.onsubmit(submit);await flush();const post=b.calls.at(-1);
  await b.context.renderMerchantOrders(true,true);assert.equal(b.calls.length,4);assert.equal(b.document.getElementById('counterOrderForm'),form);
  b.respond(post,{id:10});await flush();assert.equal(b.calls.length,7);await b.boardResponse(b.calls.slice(4),'AFTER COMMIT');await mutation;assert.match(b.board.innerHTML,/AFTER COMMIT/);
});

test('inactive Orders visibility/feature/auth cleanup preserves another modal scroll lock',async()=>{
  const b=browser();await b.boot();b.document.body.style.overflow='hidden';b.document.hidden=true;b.emit('visibilitychange');b.emit('abl:feature-workspace',{workspaceId:'catalogWorkspace'});b.emit('abl:auth-expired');
  assert.equal(b.document.body.style.overflow,'hidden');assert.equal(b.calls.length,0);
});

test('Orders modal restores its prior scroll state and leaves a later feature modal lock alone',async()=>{
  const b=browser();await ready(b);b.document.body.style.overflow='clip';b.context.openCancelModal(9);assert.equal(b.document.body.style.overflow,'hidden');b.context.closeOrderModal();assert.equal(b.document.body.style.overflow,'clip');
  b.context.openCancelModal(9);b.backdrop.classList.add('hidden');b.document.body.style.overflow='hidden';b.emit('abl:feature-workspace',{workspaceId:'catalogWorkspace'});assert.equal(b.document.body.style.overflow,'hidden');
});

for(const failure of [false,true])test(`old direct-product POST ${failure?'error':'success'} does not affect a replacement form`,async()=>{
  const b=browser();await ready(b);const old=b.document.getElementById('ordersDirectProductForm');b.document.getElementById('ordersDirectName').value='A product';b.document.getElementById('ordersDirectPrice').value='3';const mutation=old.onsubmit(submit);await flush();const post=b.calls.at(-1);
  await b.switchBusiness(2);await b.boardResponse(b.calls.slice(4),'BUSINESS TWO');const replacement=b.document.getElementById('ordersDirectProductForm');b.document.getElementById('ordersDirectProductMessage').textContent='B form';const count=b.calls.length;
  b.respond(post,{error:'A product failed'},failure?409:200);await mutation;assert.equal(b.document.getElementById('ordersDirectProductForm'),replacement);assert.equal(b.document.getElementById('ordersDirectProductMessage').textContent,'B form');assert.equal(b.toast.textContent,'');assert.equal(b.calls.length,count);
});

test('accounting cache from a different account cannot select a business outside current snapshot',async()=>{
  const b=browser();b.profile({snapshot:{account:{id:6},businesses:[{id:2}]}});await b.boot();const opened=await b.open();assert.equal(b.calls[0].path,'/api/accounting/workspaces');
  b.respond(b.calls[0],{active_business_id:2});await flush();assert.ok(b.calls.slice(1).every(c=>c.path.endsWith('business_id=2')));await b.boardResponse(b.calls.slice(1),'OWN BUSINESS');await opened.task;assert.equal(b.globals().merchantBusinessId,2);
});

test('current failed counter submit shows error and permits an explicit retry without session changes',async()=>{
  const b=browser();await ready(b);const form=fillCounter(b);let mutation=form.onsubmit(submit);await flush();b.respond(b.calls.at(-1),{error:'Not enough stock'},409);await mutation;
  assert.equal(b.document.getElementById('counterMessage').textContent,'Not enough stock');assert.equal(b.state.authenticated,true);mutation=form.onsubmit(submit);await flush();b.respond(b.calls.at(-1),{id:10});await flush();await b.boardResponse(b.calls.slice(5),'RETRIED');await mutation;assert.match(b.board.innerHTML,/RETRIED/);
});

test('duplicate submit and different-form writes cannot release or overtake a pending mutation',async()=>{
  const b=browser();await ready(b);const counter=fillCounter(b),mutation=counter.onsubmit(submit);await flush();const post=b.calls.at(-1);
  await counter.onsubmit(submit);b.document.getElementById('ordersDirectName').value='Private product';b.document.getElementById('ordersDirectPrice').value='2';await b.document.getElementById('ordersDirectProductForm').onsubmit(submit);
  await b.context.renderMerchantOrders(true,true);await b.context.openMerchantOrders();assert.equal(b.calls.length,4);assert.equal(b.document.getElementById('counterOrderForm'),counter);
  b.respond(post,{id:10});await flush();await b.boardResponse(b.calls.slice(4),'AFTER COUNTER');await mutation;assert.equal(b.calls.length,7);assert.match(b.board.innerHTML,/AFTER COUNTER/);
  const productMutation=b.document.getElementById('ordersDirectProductForm').onsubmit(submit);await flush();assert.equal(b.calls.at(-1).path,'/api/merchant/storefront/products');b.respond(b.calls.at(-1),{id:20});await flush();await b.boardResponse(b.calls.slice(8),'AFTER PRODUCT');await productMutation;
});

test('opening a modal during a status POST cannot release its lock or permit a pre-write refresh',async()=>{
  const b=browser();await ready(b);const mutation=b.context.merchantAction('start',9,false);await flush();const post=b.calls.at(-1);
  await b.context.merchantAction('cancel',10,false);await b.context.merchantAction('payment',10,false);await b.context.renderMerchantOrders(true,true);assert.equal(b.calls.length,4);assert.equal(b.backdrop.classList.contains('hidden'),true);
  b.respond(post,{});await flush();await b.boardResponse(b.calls.slice(4),'AFTER START');await mutation;assert.match(b.board.innerHTML,/AFTER START/);
});
