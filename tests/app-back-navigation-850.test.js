import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAppBackController} from '../public/app-back-navigation.js';

const tick=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));};
function harness({prior=true,restore,surfaces}={}){
  let states=prior?[{external:true},{other:'preserved'}]:[{other:'preserved'}],at=states.length-1,outside=false;
  const listeners=[],restored=[],exitCalls=[],changes=[];
  const context={authenticated:true,accountId:10,activeRole:'merchant'};
  const history={get state(){return states[at];},get length(){return states.length;},
    replaceState(s){states[at]=structuredClone(s);},
    pushState(s){states=states.slice(0,at+1);states.push(structuredClone(s));at++;},
    go(delta){queueMicrotask(()=>{const next=at+delta;if(next<0||next>=states.length)return;at=next;if(states[at].external){outside=true;return;}for(const fn of listeners)fn({state:structuredClone(states[at])});});},
    back(){this.go(-1);},forward(){this.go(1);}};
  const nav=createAppBackController({history,subscribePop:f=>listeners.push(f),getContext:()=>context,
    restore:async(r,options)=>{restored.push(r);return restore?restore(r,options):true;},
    onExit:a=>exitCalls.push(a),onChange:s=>changes.push(s),surfaces});
  return{nav,context,history,restored,exitCalls,changes,position:()=>at,outside:()=>outside};
}
const home={kind:'account-home'},merchant={kind:'profile-home',role:'merchant'};
const stock={kind:'merchant-view',role:'merchant',view:'Stock'},money={kind:'merchant-view',role:'merchant',view:'Money'};

test('Android Back visits previous screen before exit, and Stay keeps true root',async()=>{
  const h=harness();h.nav.begin(home);h.nav.record(merchant);h.nav.record(stock);
  h.history.back();await tick();assert.deepEqual(h.restored.at(-1),merchant);
  h.history.back();await tick();assert.deepEqual(h.restored.at(-1),home);assert.equal(h.exitCalls.length,0);
  h.history.back();await tick();assert.equal(h.exitCalls.length,1);assert.equal(h.nav.getState().exitPending,true);
  assert.equal(h.exitCalls[0].stay(),true);assert.equal(h.nav.getState().sequence,1);assert.equal(h.changes.at(-1).canGoBack,false);
});
test('Merchant Inventory/Money Back and browser Forward preserve tab sequence',async()=>{
  const h=harness();h.nav.begin(home);h.nav.record(merchant);h.nav.record(stock);h.nav.record(money);
  h.history.back();await tick();assert.deepEqual(h.restored.at(-1),stock);
  h.history.forward();await tick();assert.deepEqual(h.restored.at(-1),money);
  h.history.back();await tick();h.history.back();await tick();assert.deepEqual(h.restored.at(-1),merchant);
});
test('second native Back at exit prompt dismisses it without leaving',async()=>{
  const h=harness();h.nav.begin(home);h.history.back();await tick();
  assert.equal(h.nav.getState().exitPending,true);assert.equal(h.position(),2);
  h.history.back();await tick();assert.equal(h.outside(),false);assert.equal(h.position(),2);
  assert.equal(h.nav.getState().exitPending,false);assert.equal(h.changes.at(-1).atRoot,true);
});
test('fifty root Stay cycles do not add entries or show a false nested Back button',async()=>{
  const h=harness();h.nav.begin(home);const count=h.history.length;
  for(let i=0;i<50;i++){h.history.back();await tick();assert.equal(h.nav.stay(),true);}
  assert.equal(h.history.length,count);assert.equal(h.nav.getState().sequence,1);assert.equal(h.changes.at(-1).canGoBack,false);
});
test('Leave intentionally returns to the real preceding browser page',async()=>{
  const h=harness();h.nav.begin(home);h.history.back();await tick();
  assert.equal(h.exitCalls.at(-1).canLeaveToPage,true);assert.equal(h.nav.leave(),true);await tick();
  assert.equal(h.outside(),true);assert.equal(h.nav.getState().started,false);
});
test('fresh standalone entry releases its guard rather than claiming JavaScript can close a PWA',async()=>{
  const h=harness({prior:false});h.nav.begin(home);h.history.back();await tick();
  assert.equal(h.exitCalls.at(-1).canLeaveToPage,false);h.nav.leave();await tick();
  assert.equal(h.position(),0);assert.equal(h.nav.getState().started,false);
});
test('equivalent render does not add history',()=>{
  const h=harness();h.nav.begin(home);const n=h.history.length;
  assert.equal(h.nav.record(home),false);assert.equal(h.nav.record(home),false);assert.equal(h.history.length,n);
});
test('branching after Back uses physical position, not a high-water sequence',async()=>{
  const h=harness();h.nav.begin(home);h.nav.record(merchant);h.nav.record(stock);h.nav.record(money);
  h.history.back();await tick();h.nav.record({kind:'account-settings',view:'home'});
  assert.equal(h.nav.getState().sequence,4);h.history.back();await tick();assert.deepEqual(h.restored.at(-1),stock);
});
test('profile switch refuses older role history',async()=>{
  const h=harness();h.nav.begin(home);h.nav.record(merchant);h.context.activeRole='supplier';h.nav.syncContext();
  h.nav.record({kind:'feature-workspace',role:'supplier',workspaceId:'supWorkspace'});
  h.history.back();await tick();assert.deepEqual(h.restored.at(-1),home);
  h.history.back();await tick();assert.deepEqual(h.restored.at(-1),home);
});
test('business invalidation refuses the previous business view',async()=>{
  const h=harness();h.nav.begin(home);h.nav.record(stock);h.nav.invalidate();h.nav.record(money);
  h.history.back();await tick();assert.deepEqual(h.restored.at(-1),home);
});
test('sign out prevents protected restoration',async()=>{
  const h=harness();h.nav.begin(home);h.nav.record(merchant);h.context.authenticated=false;h.nav.syncContext();
  h.history.back();await tick();assert.equal(h.restored.length,0);
});
test('late failing restoration cannot fallback into a changed business',async()=>{
  let finish;const h=harness({restore:()=>new Promise(r=>{finish=r;})});
  h.nav.begin(home);h.nav.record(merchant);h.nav.record(stock);h.history.back();await tick();
  h.nav.invalidate();finish(false);await tick();assert.deepEqual(h.restored,[merchant]);
});
test('rejected restoration falls back safely, without an unhandled rejection',async()=>{
  const h=harness({restore:r=>r.kind==='profile-home'?Promise.reject(new Error('gone')):true});
  h.nav.begin(home);h.nav.record(merchant);h.nav.record(stock);h.history.back();await tick();
  assert.deepEqual(h.restored,[merchant,home]);assert.equal(h.nav.getState().restoring,false);
});
test('native Back closes one registered layer and preserves underlying history position',async()=>{
  let open=true;const h=harness({surfaces:{consumeBack:()=>{if(!open)return false;open=false;return true;}}});
  h.nav.begin(home);h.nav.record(stock);const pos=h.position();h.history.back();await tick();
  assert.equal(open,false);assert.equal(h.position(),pos);assert.equal(h.restored.length,0);
  h.history.back();await tick();assert.deepEqual(h.restored.at(-1),home);
});
test('visible Back closes a layer without traversing history',()=>{
  const h=harness({surfaces:{consumeBack:()=>true}});h.nav.begin(home);h.nav.record(stock);const pos=h.position();
  h.nav.back();assert.equal(h.position(),pos);assert.equal(h.restored.length,0);
});
test('unsaved navigation refusal bounces to current view without rendering an earlier page',async()=>{
  const h=harness({surfaces:{allowNavigation:()=>false}});h.nav.begin(home);h.nav.record(stock);const pos=h.position();
  h.history.back();await tick();assert.equal(h.position(),pos);assert.equal(h.restored.length,0);
});
test('history keeps other callers state and contains no account identifiers or form values',()=>{
  const h=harness();h.nav.begin(home);h.nav.record(stock);
  assert.equal(h.history.state.other,'preserved');
  assert.equal(Object.hasOwn(h.history.state.__abl_back_v1,'scope'),false);
  assert.equal(Object.hasOwn(h.history.state.__abl_back_v1,'accountId'),false);
});
test('source hooks remain explicit and the canonical shell is still integrated',()=>{
  const shell=readFileSync(new URL('../public/shell.js',import.meta.url),'utf8');
  assert.match(shell,/createAppBackController/);
  for(const kind of ['account-home','feature-workspace','profile-home','account-settings','merchant-view'])assert.ok(shell.includes("kind:'"+kind+"'"));
  assert.match(shell,/appNavigationBack/);assert.match(shell,/bindMerchantBackNavigation/);
  assert.doesNotMatch(shell,/document\.addEventListener\('click',[^\n]+history\.pushState/);
});

// Feature modal adapters must use existing close controls, never a payment or cancellation submit action.
test('Orders and Catalog Back adapters target canonical close controls',()=>{
  const src=readFileSync(new URL('../public/app-back-surfaces.js',import.meta.url),'utf8');
  for(const [layer,close] of [['orderModalBackdrop','.cancelModal'],['productDetailBackdrop','.productDetailClose'],['checkoutBackdrop','.closeCheckout'],['catalogEditorBackdrop','#catalogEditorClose']]){
    assert.ok(src.includes("['"+layer+"','"+close+"']"),layer+' uses its feature-owned close');
  }
  assert.match(src,/layer\.node\.querySelector\(layer\.closeId\)/);
  assert.doesNotMatch(src,/\.saveModal\.click\(|\.placeOrder\.click\(/);
});

test('Orders and Catalog actual feature source still binds each Back close control to its cleanup handler',()=>{
  const orders=readFileSync(new URL('../public/orders-ui.js',import.meta.url),'utf8');
  const market=readFileSync(new URL('../public/marketplace-ui.js',import.meta.url),'utf8');
  assert.match(orders,/function closeOrderModal\(\)/);
  assert.match(orders,/querySelector\('\.cancelModal'\)\.onclick=closeOrderModal/);
  assert.match(market,/function closeProductDetail\(\)/);
  assert.match(market,/querySelector\('\.productDetailClose'\)\.onclick=closeProductDetail/);
  assert.match(market,/function closeCheckout\(\)/);
  assert.match(market,/querySelector\('\.closeCheckout'\)\.onclick=closeCheckout/);
  assert.match(market,/function closeCatalogEditor\(\)/);
  assert.match(market,/getElementById\('catalogEditorClose'\)\.onclick=closeCatalogEditor/);
  assert.match(orders,/function openPaymentModal\(/);
  assert.match(orders,/function openCancelModal\(/);
});

test('Marketplace stacked overlay order keeps checkout above product details and catalog editor highest',()=>{
  const css=readFileSync(new URL('../public/marketplace.css',import.meta.url),'utf8');
  const layer=name=>Number(css.match(new RegExp('\\.'+name+'\\{[^}]*z-index:(\\d+)'))?.[1]);
  const detail=layer('productDetailBackdrop'),checkout=layer('checkoutBackdrop'),editor=layer('catalogEditorBackdrop');
  assert.ok(detail>0&&checkout>detail&&editor>checkout,{detail,checkout,editor});
});
