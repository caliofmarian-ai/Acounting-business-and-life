from pathlib import Path
import subprocess
expected={'public/index.html':'45ba5ed965fd8bb76d3377c9ba81100060269661','public/business-accounting-ui.js':'5f671da740a5f86884ab839a2159e559ce05a797','public/v03.css':'1d5d49781fb769b22b75e9dcae8e836aaec96e28','public/v03.js':'ede2e5b618f5b347a21827d9e0951539080085f9'}
for p,sha in expected.items():
 actual=subprocess.check_output(['git','hash-object',p],text=True).strip()
 assert actual==sha,(p,actual,sha)
def replace(path,old,new):
 p=Path(path);text=p.read_text()
 assert text.count(old)==1,(path,'replacement must match exactly once',old[:100],text.count(old))
 p.write_text(text.replace(old,new))
replace('public/index.html','<button type="button" class="secondary" data-today-action="recipes">Products & recipes</button>','')
replace('public/index.html','<nav class="bottomNav merchantPrimaryNav">','<nav class="bottomNav merchantPrimaryNav" aria-label="Merchant primary navigation">')
replace('public/index.html','<button data-view="Stock">Inventory</button>','<button id="merchantRecipesNav" type="button" class="roleFinanceHidden" data-view="Menu" aria-controls="viewMenu">Products &amp; recipes</button><button data-view="Stock">Inventory</button>')
replace('public/business-accounting-ui.js',"if(name==='Menu'&&foodAllowed)btn.textContent='Food menu'","if(name==='Menu'&&foodAllowed)btn.textContent='Products & recipes'")
replace('public/v03.js',"  if(merchantTodayProfileKey!==merchantTodayProfileContext())invalidateMerchantToday();\n  if(isMerchantBaseActive())loadMerchantToday().catch(()=>{});","  if(merchantTodayProfileKey!==merchantTodayProfileContext()){\n    $('merchantRecipesNav')?.classList.add('roleFinanceHidden');\n    invalidateMerchantToday();\n  }\n  if(isMerchantBaseActive())loadMerchantToday().catch(()=>{});")
replace('public/v03.js',"document.addEventListener('abl:business-workspace-changed',()=>{\n  invalidateMerchantToday();\n  if(isMerchantBaseActive()&&!$('viewDashboard')?.classList.contains('hidden'))loadMerchantToday({force:true}).catch(()=>{});\n});","document.addEventListener('abl:business-workspace-changed',()=>{\n  $('merchantRecipesNav')?.classList.add('roleFinanceHidden');\n  invalidateMerchantToday();\n  if(isMerchantBaseActive())loadMerchantToday({force:true}).catch(()=>{});\n});")
replace('public/v03.js',"  if(!Number.isInteger(businessId)||businessId<1||businessId!==activeId)return;\n  invalidateMerchantToday();\n  if(!$('viewDashboard')?.classList.contains('hidden'))loadMerchantToday().catch(()=>{});","  if(!Number.isInteger(businessId)||businessId<1||businessId!==activeId)return;\n  $('merchantRecipesNav')?.classList.add('roleFinanceHidden');\n  invalidateMerchantToday();\n  loadMerchantToday().catch(()=>{});")
replace('public/v03.js',"document.addEventListener('abl:auth-expired',()=>invalidateMerchantToday());","document.addEventListener('abl:auth-expired',()=>{\n  $('merchantRecipesNav')?.classList.add('roleFinanceHidden');\n  invalidateMerchantToday();\n});")
with Path('public/v03.css').open('a') as f:
 f.write('''
/* #843: one canonical recipe destination beside Stock, not a Today action.
   Keep all six labels visible instead of shrinking or horizontally hiding them. */
.merchantPrimaryNav [data-view="Menu"].roleFinanceHidden{display:none!important}
.merchantPrimaryNav:has([data-view="Menu"]:not(.roleFinanceHidden)){grid-template-columns:repeat(6,minmax(0,1fr))!important}
.merchantPrimaryNav [data-view="Menu"]{overflow-wrap:anywhere}
@media(max-width:649px){
  .merchantPrimaryNav:has([data-view="Menu"]:not(.roleFinanceHidden)){grid-template-columns:repeat(3,minmax(0,1fr))!important}
  .merchantPrimaryNav:has([data-view="Menu"]:not(.roleFinanceHidden)) button{min-height:48px;font-size:.78rem;padding:6px;line-height:1.25}
  body:has(.merchantPrimaryNav:not(.hidden) [data-view="Menu"]:not(.roleFinanceHidden)) #app{padding-bottom:calc(132px + env(safe-area-inset-bottom,0px))}
}
''')
Path('tests/merchant-recipes-primary-nav-843.test.js').write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=read('public/index.html'),ui=read('public/v03.js'),finance=read('public/business-accounting-ui.js'),css=read('public/v03.css');
function block(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,'exact source boundaries: '+start);return source.slice(a,b)}
function node(classes=[]){const values=new Set(classes);return{dataset:{},textContent:'',classList:{add:x=>values.add(x),remove:x=>values.delete(x),contains:x=>values.has(x),toggle(x,on){on?values.add(x):values.delete(x)}}}}
const nav=html.match(/<nav class="bottomNav merchantPrimaryNav"[\s\S]*?<\/nav>/)?.[0];
test('recipe destination occurs once in primary nav immediately before Stock',()=>{
 assert.ok(nav);assert.equal((nav.match(/data-view="Menu"/g)||[]).length,1);
 assert.match(nav,/aria-label="Merchant primary navigation"/);
 assert.match(nav,/id="merchantRecipesNav"[^>]*class="roleFinanceHidden"[^>]*data-view="Menu"[^>]*aria-controls="viewMenu">Products &amp; recipes<\/button><button data-view="Stock">/);
 assert.equal((html.match(/data-today-action="recipes"/g)||[]).length,0);
 assert.match(html,/data-today-action="quick-sale">Quick Sale/);
 for(const label of ['Today','Orders','Catalog','Inventory','Money'])assert.ok(nav.includes('>'+label+'<'));
});
function presentation(){
 const recipe=node(['roleFinanceHidden']);recipe.textContent='Products & recipes';const stock=node();const views={viewMenu:node(['hidden','roleFinanceHidden']),viewSell:node(['hidden','roleFinanceHidden'])};
 const context=vm.createContext({document:{body:{dataset:{}},getElementById:id=>views[id]||null,querySelector:selector=>selector.includes('[data-view="Menu"]')?recipe:selector.includes('[data-view="Stock"]')?stock:null,querySelectorAll:()=>[]},accountingState:{role:'merchant'}});
 vm.runInContext(block(finance,'function applyFinancePresentation(','\nconst BUSINESS_FINANCE_COMPATIBILITY_COPY'),context);
 return{recipe,views,apply:overview=>context.applyFinancePresentation(overview)};
}
for(const domain of ['food','mixed'])test(domain+' canonical presentation exposes the first-level button without renaming it Food menu',()=>{
 const h=presentation();h.apply({role:'merchant',presentation:{merchant_domain:domain,legacy_recipe_ui_allowed:true}});
 assert.equal(h.recipe.classList.contains('roleFinanceHidden'),false);assert.equal(h.recipe.textContent,'Products & recipes');assert.equal(h.views.viewMenu.classList.contains('hidden'),true,'eligibility does not navigate');
});
for(const [label,overview] of [
 ['non-food',{role:'merchant',presentation:{merchant_domain:'non_food'}}],
 ['unknown',{role:'merchant',presentation:{}}],
 ['explicit exclusion',{role:'merchant',presentation:{merchant_domain:'food',food_modules_enabled:true,legacy_recipe_ui_allowed:false}}],
 ['supplier',{role:'supplier',presentation:{merchant_domain:'food',legacy_recipe_ui_allowed:true}}],
 ['customer',{role:'customer',presentation:{merchant_domain:'food',legacy_recipe_ui_allowed:true}}]
])test(label+' hides recipes even after Food was shown',()=>{
 const h=presentation();h.apply({role:'merchant',presentation:{merchant_domain:'food',legacy_recipe_ui_allowed:true}});h.apply(overview);assert.equal(h.recipe.classList.contains('roleFinanceHidden'),true);assert.equal(h.views.viewMenu.classList.contains('roleFinanceHidden'),true);
});
test('the existing setView opens the canonical editor and selects only its nav button',()=>{
 const views={viewMenu:node(['hidden']),viewStock:node(),viewDashboard:node(['hidden'])},buttons=['Dashboard','Menu','Stock','Money'].map(name=>({...node(name==='Stock'?['active']:[]),dataset:{view:name}}));const loads=[];
 const context=vm.createContext({$:id=>views[id],document:{querySelectorAll:s=>s==='.view'?Object.values(views):buttons},window:{scrollTo(){}},loadMerchantView:async name=>loads.push(name),updateSellPreview(){},console});
 vm.runInContext(block(ui,'function setView(name){','\nasync function openInventoryNotificationContext'),context);
 context.setView('Menu');assert.equal(views.viewMenu.classList.contains('hidden'),false);assert.equal(views.viewStock.classList.contains('hidden'),true);assert.deepEqual(buttons.filter(b=>b.classList.contains('active')).map(b=>b.dataset.view),['Menu']);assert.deepEqual(loads,['Menu']);
 context.setView('Stock');context.setView('Menu');assert.deepEqual(loads,['Menu','Stock','Menu']);
 assert.match(ui,/querySelectorAll\('\.bottomNav \[data-view\]'\)\.forEach\(b=>b\.onclick=\(\)=>setView\(b\.dataset\.view\)\)/);
});
function lifecycle(){
 const listeners=new Map(),recipe=node(),loads=[],state={role:'merchant',key:'1:merchant',id:1,invalidations:0};
 const context=vm.createContext({$:id=>id==='merchantRecipesNav'?recipe:id==='viewDashboard'?node(['hidden']):null,baseActiveRole:'merchant',merchantTodayProfileKey:'1:merchant',merchantTodayBusinessId:1,merchantTodayRequestBusinessId:null,merchantTodayProfileContext:()=>state.key,currentMerchantBusinessId:()=>state.id,isMerchantBaseActive:()=>context.baseActiveRole==='merchant',invalidateMerchantToday:()=>state.invalidations++,loadMerchantToday:async options=>loads.push(options),openPendingInventoryNotification:async()=>false,document:{addEventListener:(name,fn)=>listeners.set(name,fn)}});
 vm.runInContext(block(ui,"document.addEventListener('abl:profile-state',event=>{","window.addEventListener('online'"),context);
 return{state,recipe,loads,context,emit:(name,detail)=>listeners.get(name)({detail})};
}
test('business transition hides old recipe eligibility and rechecks it even away from Today',()=>{
 const h=lifecycle();h.emit('abl:business-workspace-changed');assert.equal(h.recipe.classList.contains('roleFinanceHidden'),true);assert.equal(h.state.invalidations,1);assert.equal(h.loads.length,1);assert.equal(h.loads[0].force,true);
});
test('profile/account change hides recipes before any next load',()=>{
 const h=lifecycle();h.state.key='2:customer';h.emit('abl:profile-state',{activeRole:'customer'});assert.equal(h.recipe.classList.contains('roleFinanceHidden'),true);assert.equal(h.loads.length,0);
});
test('expired authentication revokes the recipe entry immediately',()=>{
 const h=lifecycle();h.emit('abl:auth-expired');assert.equal(h.recipe.classList.contains('roleFinanceHidden'),true);assert.equal(h.loads.length,0);
});
test('current storefront save rechecks domain without requiring a trip through Today',()=>{
 const h=lifecycle();h.emit('abl:merchant-storefront-saved',{businessId:1});assert.equal(h.recipe.classList.contains('roleFinanceHidden'),true);assert.equal(h.loads.length,1);
});
test('unrelated storefront updates do not hide the current recipe entry',()=>{
 const h=lifecycle();h.emit('abl:merchant-storefront-saved',{businessId:2});assert.equal(h.recipe.classList.contains('roleFinanceHidden'),false);assert.equal(h.loads.length,0);
});
test('mobile recipe navigation wraps to three columns with safe bottom clearance',()=>{
 assert.match(css,/merchantPrimaryNav:has\(\[data-view="Menu"\]:not\(\.roleFinanceHidden\)\)\{grid-template-columns:repeat\(6,minmax\(0,1fr\)\)!important\}/);
 assert.match(css,/@media\(max-width:649px\)\{\s*\.merchantPrimaryNav:has\([^\n]+repeat\(3,minmax\(0,1fr\)\)/);
 assert.match(css,/min-height:48px;font-size:\.78rem/);assert.match(css,/padding-bottom:calc\(132px \+ env\(safe-area-inset-bottom,0px\)\)/);
});
''')
print('Applied bounded #843 changes to four source files plus dedicated tests.')
