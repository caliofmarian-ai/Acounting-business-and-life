import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=read('public/index.html');
const css=read('public/v03.css');
const finance=read('public/business-accounting-ui.js');
const merchant=read('public/v03.js');
const shell=read('public/shell.js');

function element(classes=[]){
  const names=new Set(classes),attrs=new Map(),label={textContent:''};
  return{
    label,attrs,textContent:'',
    classList:{contains:name=>names.has(name),add:name=>names.add(name),
      remove:name=>names.delete(name),toggle(name,force){force?names.add(name):names.delete(name)}},
    setAttribute:(name,value)=>attrs.set(name,String(value)),
    removeAttribute:name=>attrs.delete(name),
    getAttribute:name=>attrs.get(name)||null,
    querySelector:selector=>selector==='.merchantNavLabel'?label:null
  };
}

test('first-paint Merchant nav reserves a single stable loading state, not provisional Inventory labels',()=>{
  const nav=html.match(/<nav class="bottomNav merchantPrimaryNav"[\s\S]*?<\/nav>/)?.[0];
  assert.ok(nav);
  assert.match(nav,/aria-busy="true"/);
  assert.match(nav,/class="merchantNavLoading" role="status"/);
  assert.match(nav,/id="merchantRecipesNav"[^>]*class="roleFinanceHidden"/);
  assert.match(nav,/data-view="Stock"[\s\S]*?<span class="merchantNavLabel">Stock<\/span>/);
  assert.doesNotMatch(nav,/class="merchantNavLabel">Inventory<\/span>/);
  assert.match(css,/merchantPrimaryNav:not\(\[data-ready="true"\]\) button\{visibility:hidden!important;pointer-events:none\}/);
  assert.match(css,/merchantPrimaryNav:not\(\[data-ready="true"\]\) \.merchantNavLoading/);
});

test('Food, Mixed, Non-food and unknown resolve the entire nav at once with stable Stock text',()=>{
  const nav=element(),recipe=element(['roleFinanceHidden']),stock=element();
  const views={viewMenu:element(['roleFinanceHidden','hidden']),viewSell:element(['roleFinanceHidden','hidden'])};
  const title=element(),formTitle=element();
  const nodes={
    '.bottomNav [data-view="Menu"]':recipe,
    '.bottomNav [data-view="Stock"]':stock,
    '#viewStock h1':title,
    '#viewStock form h2':formTitle,
    '.merchantPrimaryNav':nav
  };
  nav.setAttribute('aria-busy','true');
  const context=vm.createContext({
    document:{
      body:{dataset:{}},
      querySelector:selector=>nodes[selector]||null,
      getElementById:id=>views[id]||null,
      querySelectorAll:()=>[]
    },
    accountingState:{role:'merchant'}
  });
  const start=finance.indexOf('function applyFinancePresentation(');
  const end=finance.indexOf('\nconst BUSINESS_FINANCE_COMPATIBILITY_COPY',start);
  vm.runInContext(finance.slice(start,end),context);
  const resetStart=finance.indexOf('function resetMerchantNavPresentation(){');
  const resetEnd=finance.indexOf("\ndocument.addEventListener('abl:profile-state'",resetStart);
  assert.ok(resetStart>0&&resetEnd>resetStart);
  vm.runInContext(finance.slice(resetStart,resetEnd),context);
  for(const domain of ['food','non_food','mixed','unknown']){
    context.resetMerchantNavPresentation();
    assert.equal(nav.getAttribute('data-ready'),null);
    assert.equal(nav.getAttribute('aria-busy'),'true');
    context.applyFinancePresentation({
      role:'merchant',
      presentation:{merchant_domain:domain,legacy_recipe_ui_allowed:domain==='food'||domain==='mixed'}
    });
    const allowed=domain==='food'||domain==='mixed';
    assert.equal(recipe.classList.contains('roleFinanceHidden'),!allowed);
    assert.equal(views.viewMenu.classList.contains('roleFinanceHidden'),!allowed);
    assert.equal(stock.label.textContent,'Stock');
    assert.equal(title.textContent,'Stock');
    assert.equal(nav.getAttribute('data-ready'),'true');
    assert.equal(nav.getAttribute('aria-busy'),null);
  }
});

test('local Stock or Money routes clear false shell Today state',()=>{
  const start=merchant.indexOf('function setView(name){');
  const end=merchant.indexOf('\nasync function openInventoryNotificationContext',start);
  assert.ok(start>0&&end>start);
  assert.match(merchant.slice(start,end),/CustomEvent\('abl:merchant-local-view',\{detail:\{name\}\}\)/);
  assert.match(shell,/document.addEventListener\('abl:merchant-local-view'/);
  assert.match(shell,/const navTarget=\{Dashboard:'home',Stock:'stock',Money:'money',Menu:'recipes'\}/);
  assert.match(shell,/if\(active\)button.setAttribute\('aria-current','page'\)/);
});
