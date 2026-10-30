import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const src=readFileSync(new URL('../public/business-accounting-ui.js',import.meta.url),'utf8');
function actual(start,end){
  const i=src.indexOf(start),j=src.indexOf(end,i+start.length);
  assert.ok(i>=0&&j>i,'Cannot locate source: '+start);
  return src.slice(i,j);
}
function mockNode(){
  const classes=new Set(),attrs=new Map();
  return {
    textContent:'',classList:{
      add:x=>classes.add(x),remove:x=>classes.delete(x),
      contains:x=>classes.has(x),toggle:(x,enable)=>enable?classes.add(x):classes.delete(x)
    },
    getAttribute:x=>attrs.get(x)||null,
    setAttribute:(x,v)=>attrs.set(x,String(v)),
    removeAttribute:x=>attrs.delete(x)
  };
}
test('Supplier finance cannot hydrate an inactive Merchant navigation, and switching back resets stale Food state',()=>{
  const listeners=new Map(),nav=mockNode(),recipe=mockNode(),legacy=mockNode(),stock=mockNode();
  const label={textContent:'Stock'};stock.querySelector=()=>label;
  recipe.classList.add('roleFinanceHidden');
  nav.querySelector=selector=>selector==='#merchantRecipesTopButton'?recipe:
    selector==='#merchantBusinessTools'?mockNode():null;
  nav.setAttribute('aria-busy','true');
  const nodes={
    '.merchantPrimaryNav':legacy,
    '.bottomNav [data-view="Menu"]':recipe,
    '.bottomNav [data-view="Stock"]':stock,
    '#viewStock h1':mockNode(),
    '#viewStock form h2':mockNode()
  };
  const byId={merchantWorkspaceNav:nav,viewSell:mockNode(),viewMenu:mockNode()};
  const ctx=vm.createContext({
    document:{
      body:{dataset:{}},
      querySelector:q=>nodes[q]||null,
      getElementById:id=>byId[id]||null,
      querySelectorAll:()=>[],
      addEventListener:(name,fn)=>listeners.set(name,fn)
    },
    bootAccountingWorkspace:()=>{}
  });
  vm.runInContext("const accountingState={role:'supplier'};\n"+
    actual('function applyFinancePresentation(','\nconst BUSINESS_FINANCE_COMPATIBILITY_COPY')+
    '\n'+actual('function resetMerchantNavPresentation(){',"document.addEventListener('abl:merchant-today-error'"),ctx);
  const emit=(name,detail)=>{const handler=listeners.get(name);assert.equal(typeof handler,'function');handler({detail})};
  const supplier={role:'supplier',presentation:{merchant_domain:'unknown',legacy_recipe_ui_allowed:false}};
  const food={role:'merchant',presentation:{merchant_domain:'food',legacy_recipe_ui_allowed:true}};

  ctx.applyFinancePresentation(supplier);
  assert.equal(nav.getAttribute('data-ready'),null,'Supplier response may never unlock Merchant nav');
  assert.equal(recipe.classList.contains('roleFinanceHidden'),true);

  emit('abl:profile-state',{surface:'profile',activeRole:'supplier',accountId:45});
  emit('abl:profile-state',{surface:'profile',activeRole:'merchant',accountId:45});
  assert.equal(nav.getAttribute('data-ready'),null,'entering Merchant must invalidate the former role');
  ctx.applyFinancePresentation(food);
  assert.equal(nav.getAttribute('data-ready'),'true');
  assert.equal(recipe.classList.contains('roleFinanceHidden'),false);

  emit('abl:profile-state',{surface:'profile',activeRole:'merchant',accountId:45});
  assert.equal(nav.getAttribute('data-ready'),'true','same Merchant profile events must not cause flicker');

  emit('abl:business-workspace-changed',{role:'merchant',activeBusinessId:88});
  assert.equal(nav.getAttribute('data-ready'),null,'business change must reset readiness');
  assert.equal(recipe.classList.contains('roleFinanceHidden'),true,'old business Food capability must not leak');

  emit('abl:profile-state',{surface:'account',activeRole:null,accountId:45});
  ctx.applyFinancePresentation(supplier);
  assert.equal(nav.getAttribute('data-ready'),null,'late Supplier overview must not re-open Merchant nav');

  emit('abl:profile-state',{surface:'profile',activeRole:'merchant',accountId:46});
  assert.equal(nav.getAttribute('data-ready'),null,'another account must not inherit readiness');
});

test('switching profiles clears the stale business attribution before Merchant Today loads',async()=>{
  const bar={
    className:'businessWorkspaceBar',innerHTML:'<strong>Supplier private business</strong>',
    removed:false,setAttribute(name,value){this[name]=String(value)},
    remove(){this.removed=true}
  };
  const supplierWorkspace={classList:{add(){}}};
  const context=vm.createContext({
    accountingState:{role:'supplier',activeBusinessId:77,businesses:[{id:77,name:'Supplier private business'}]},
    ablToken:()=>true,
    document:{
      getElementById:id=>id==='businessWorkspaceBar'?bar:
        id==='supplierAccountingWorkspace'?supplierWorkspace:null,
      body:{classList:{remove(){}}}
    },
    window:{BusinessLifeMerchantToday:{getState:()=>({workspace:null})}},
    applyWorkspaceState:()=>{throw new Error('Unverified Merchant cache must not hydrate')},
    api:async()=>({}),wireSupplierAccountingTile:()=>{},console
  });
  vm.runInContext(actual('async function bootAccountingWorkspace','function resetMerchantNavPresentation'),context);
  await context.bootAccountingWorkspace({
    surface:'profile',activeRole:'merchant',
    snapshot:{profiles:[{role:'merchant',enabled:true}]}
  });
  assert.equal(context.accountingState.role,'merchant');
  assert.equal(context.accountingState.activeBusinessId,null);
  assert.deepEqual(context.accountingState.businesses,[]);
  assert.match(bar.innerHTML,/Preparing workspace/);
  assert.doesNotMatch(bar.innerHTML,/Supplier private business/);
  assert.match(bar.className,/businessWorkspaceBarPending/);

  await context.bootAccountingWorkspace({
    surface:'profile',activeRole:'customer',
    snapshot:{profiles:[{role:'customer',enabled:true}]}
  });
  assert.equal(context.accountingState.role,null);
  assert.equal(context.accountingState.activeBusinessId,null);
  assert.equal(bar.removed,true);
});
