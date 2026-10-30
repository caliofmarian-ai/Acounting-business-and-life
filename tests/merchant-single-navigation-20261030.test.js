import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const shell=read('public/shell.js');
const css=read('public/shell.css');
const accounting=read('public/business-accounting-ui.js');
const mobile=read('public/mobile-feature-loader.css');
const oldNav=read('public/index.html');

const navMarkup=shell.split('\n').find(line=>line.includes("nav.innerHTML='<div id=\"merchantWorkspaceActions\""));
const shellSection=(start,end)=>{
  const a=shell.indexOf(start),b=shell.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,'missing shell source boundary '+start);
  return shell.slice(a,b);
};
function button(target){
  const set=new Set(),attrs=new Map();
  return {id:'merchant'+target,dataset:{merchantNav:target},
    classList:{toggle:(name,on)=>on?set.add(name):set.delete(name),contains:name=>set.has(name)},
    setAttribute:(name,value)=>attrs.set(name,String(value)),
    removeAttribute:name=>attrs.delete(name),
    getAttribute:name=>attrs.get(name)||null};
}

test('one shell-owned navigation is the only rendered Merchant menu',()=>{
  assert.ok(navMarkup);
  const primary=['home','orders','catalog','recipes','stock','money'];
  for(const key of primary)
    assert.equal((navMarkup.match(new RegExp('data-merchant-nav="'+key+'"','g'))||[]).length,1,key);
  for(const key of ['storefront','suppliers','delivery','settings'])
    assert.equal((navMarkup.match(new RegExp('data-merchant-nav="'+key+'"','g'))||[]).length,1,key);
  assert.match(navMarkup,/id="merchantBusinessTools"/);
  assert.match(navMarkup,/<summary class="merchantWorkspaceButton">Business tools<\/summary>/);
  assert.match(navMarkup,/id="merchantRecipesTopButton" class="merchantWorkspaceButton roleFinanceHidden"/);
  assert.match(css,/#shell \.merchantPrimaryNav\{display:none!important\}/);
  assert.match(css,/#shell \.merchantMobileTools\{display:none!important\}/);
  assert.match(css,/#shell \.merchantWorkspaceNav:not\(\.hidden\)\{display:block\}/);
  assert.match(css,/#shell \.merchantWorkspaceNav:not\(\[data-ready="true"\]\) \.merchantWorkspaceActions\{visibility:hidden;pointer-events:none\}/);
  assert.match(oldNav,/class="bottomNav merchantPrimaryNav"/,'legacy routes remain wired but not rendered');
});

test('Food/Mixed eligibility is resolved before revealing main shell navigation',()=>{
  const presentation=accounting.slice(accounting.indexOf('function applyFinancePresentation('),accounting.indexOf('\nconst BUSINESS_FINANCE_COMPATIBILITY_COPY'));
  assert.match(presentation,/shellNav\.querySelector\('#merchantRecipesTopButton'\)/);
  assert.match(presentation,/recipes\?\.classList\.toggle\('roleFinanceHidden',!foodAllowed\)/);
  assert.match(presentation,/shellNav\.setAttribute\('data-ready','true'\)/);
  const reset=accounting.slice(accounting.indexOf('function resetMerchantNavPresentation(){'),accounting.indexOf("\ndocument.addEventListener('abl:profile-state'"));
  assert.match(reset,/shellNav\.removeAttribute\('data-ready'\)/);
  assert.match(reset,/shellNav\.querySelector\('#merchantRecipesTopButton'\)\?\.classList\.add\('roleFinanceHidden'\)/);
  assert.match(accounting,/abl:merchant-today-error/);
});

test('Stock, Money and Recipes route to the existing Merchant views without making a new API call',()=>{
  const clicks=[],actions=[];
  const legacyNav={
    classList:{remove:name=>actions.push('nav:'+name)},
    querySelector:selector=>({click:()=>clicks.push(selector)})
  };
  const root={
    classList:{add:name=>actions.push(name)}
  };
  const context=vm.createContext({
    activeSurface:'profile',activeRole:'merchant',
    document:{
      getElementById:id=>id==='merchantRecipesNav'?{classList:{contains:()=>false}}:root,
      querySelector:selector=>selector==='.bottomNav'?legacyNav:null
    },
    closeDrawer:()=>actions.push('close'),
    hideFeatureWorkspaces:()=>actions.push('hide'),
    window:{scrollTo:()=>{}},
    showToast:message=>{throw new Error(message)}
  });
  vm.runInContext(shellSection('function openMerchantLocalDestination(name){','function openMerchantDestination(destination){'),context);
  for(const [name,selector] of [
    ['Stock','[data-view="Stock"]'],['Money','[data-view="Money"]'],['Menu','[data-view="Menu"]']
  ]){
    assert.equal(context.openMerchantLocalDestination(name),true);
    assert.equal(clicks.at(-1),selector);
  }
  assert.equal(clicks.length,3);
  assert.ok(actions.includes('hide'));
});

test('Merchant local view marks the actual page, never falsely highlights Today',()=>{
  const listeners=new Map();
  const buttons=['home','orders','catalog','recipes','stock','money','storefront','suppliers','delivery','settings'].map(button);
  const c=vm.createContext({
    activeSurface:'profile',activeRole:'merchant',
    document:{
      addEventListener:(name,fn)=>listeners.set(name,fn),
      querySelectorAll:()=>buttons
    }
  });
  vm.runInContext(shellSection("document.addEventListener('abl:merchant-local-view'",'\nfunction hideFeatureWorkspaces('),c);
  const emit=name=>listeners.get('abl:merchant-local-view')({detail:{name}});
  for(const [view,want] of [['Stock','stock'],['Money','money'],['Menu','recipes'],['Dashboard','home']]){
    emit(view);
    assert.deepEqual(buttons.filter(b=>b.getAttribute('aria-current')==='page').map(b=>b.dataset.merchantNav),[want],view);
  }
});

test('single Merchant menu is responsive, without legacy fixed-bottom clearance',()=>{
  assert.match(css,/@media\(max-width:649px\)\{[\s\S]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css,/@media\(max-width:370px\)\{/);
  assert.match(css,/min-height:54px/);
  assert.match(css,/min-height:62px/);
  assert.match(css,/body\[data-merchant-nav="unified"\] #app\{padding-bottom:20px!important\}/);
  assert.match(css,/#shell \.merchantBusinessToolsMenu\{/);
  assert.match(css,/outline:3px solid #1d4ed8/);
  assert.match(mobile,/\.merchantMobileTools\{display:none\}/);
});
