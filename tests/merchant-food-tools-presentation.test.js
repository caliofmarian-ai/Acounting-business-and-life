import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {merchantTodayViewModel} from '../merchant-today-core.js';

const accountingSource=readFileSync(new URL('../public/business-accounting-ui.js',import.meta.url),'utf8');

// Execute the complete existing consumer, including its real Today event listener.
// No Finance request should be necessary to make the Food tools destinations visible.
function presentationHarness(role='merchant'){
  const listeners=new Map(),requests=[];
  const node=()=>{
    const classes=new Set(['hidden','roleFinanceHidden']);
    return {classList:{
      add:name=>classes.add(name),
      contains:name=>classes.has(name),
      toggle(name,force){force?classes.add(name):classes.delete(name)}
    }};
  };
  const views=new Map([['viewMenu',node()],['viewSell',node()]]);
  const saleLink=node();
  const document={
    readyState:'complete',body:{dataset:{}},
    getElementById:id=>views.get(id)||null,
    querySelector:()=>null,
    querySelectorAll:selector=>selector==='[data-view-link="Sell"]'?[saleLink]:[],
    addEventListener(name,listener){
      if(!listeners.has(name))listeners.set(name,[]);
      listeners.get(name).push(listener);
    }
  };
  const window={fetch:async(...args)=>{requests.push(args);throw new Error('Unexpected Finance request')}};
  const context=vm.createContext({window,document,console,Intl,setTimeout:()=>{}});
  vm.runInContext(accountingSource,context);
  vm.runInContext(`accountingState.role=${JSON.stringify(role)}`,context);
  return {
    views,saleLink,requests,
    today(presentation){
      const detail=merchantTodayViewModel({business:{id:1,name:'Test'},presentation});
      for(const listener of listeners.get('abl:merchant-today-data')||[])listener({detail});
      return detail;
    }
  };
}

for(const domain of ['food','mixed']){
  test(`${domain} Today makes Products & recipes and Quick Sale visible before opening Money`,()=>{
    const h=presentationHarness();
    const today=h.today({merchant_domain:domain,food_modules_enabled:true,legacy_recipe_ui_allowed:true});
    assert.equal(today.presentation.legacy_recipe_ui_allowed,true);
    for(const id of ['viewMenu','viewSell']){
      assert.equal(h.views.get(id).classList.contains('roleFinanceHidden'),false,id+' must not stay display:none');
      assert.equal(h.views.get(id).classList.contains('hidden'),true,'presentation must not navigate automatically');
    }
    assert.equal(h.saleLink.classList.contains('roleFinanceHidden'),false);
    assert.equal(h.requests.length,0);
  });
}

for(const domain of ['non_food','unknown',undefined]){
  test(`${domain||'unconfigured'} Today keeps recipe and Quick Sale destinations excluded`,()=>{
    const h=presentationHarness(),today=h.today({merchant_domain:domain});
    assert.equal(today.presentation.legacy_recipe_ui_allowed,false);
    assert.equal(today.presentation.food_modules_enabled,false);
    for(const view of h.views.values())assert.equal(view.classList.contains('roleFinanceHidden'),true);
    assert.equal(h.saleLink.classList.contains('roleFinanceHidden'),true);
  });
}

test('returning through Today restores Food tools after switching from Non-food to Food',()=>{
  const h=presentationHarness();
  for(const domain of ['food','non_food','mixed','unknown','food']){
    h.today({merchant_domain:domain,legacy_recipe_ui_allowed:['food','mixed'].includes(domain)});
    for(const view of h.views.values())assert.equal(view.classList.contains('roleFinanceHidden'),!['food','mixed'].includes(domain));
  }
});

test('Today preserves an explicit recipe exclusion even when other Food modules are enabled',()=>{
  const h=presentationHarness();
  for(const allowed of [false,undefined]){
    const today=h.today({merchant_domain:'food',food_modules_enabled:true,legacy_recipe_ui_allowed:allowed});
    assert.equal(today.presentation.food_modules_enabled,true);
    assert.equal(today.presentation.legacy_recipe_ui_allowed,false);
    for(const view of h.views.values())assert.equal(view.classList.contains('roleFinanceHidden'),true);
  }
});

test('Supplier never enables Merchant Food tools from a Today event',()=>{
  const h=presentationHarness('supplier');
  h.today({merchant_domain:'food',food_modules_enabled:true,legacy_recipe_ui_allowed:true});
  for(const view of h.views.values())assert.equal(view.classList.contains('roleFinanceHidden'),true);
  assert.equal(h.requests.length,0);
});
