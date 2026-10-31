import test from 'node:test';
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
 assert.match(nav,/id="merchantRecipesNav"[^>]*class="roleFinanceHidden"[^>]*data-view="Menu"[^>]*aria-controls="viewMenu"[^>]*>[\s\S]*?<span class="merchantNavLabel">Products &amp; recipes<\/span><\/button><button data-view="Stock">/);
 assert.equal((html.match(/data-today-action="recipes"/g)||[]).length,0);
 assert.match(html,/data-today-action="quick-sale">Quick Sale/);
 for(const label of ['Today','Orders','Catalog','Stock','Money'])assert.ok(nav.includes('>'+label+'<'));
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
 const context=vm.createContext({$:id=>views[id],document:{querySelectorAll:s=>s==='.view'?Object.values(views):buttons},window:{scrollTo(){}},loadMerchantView:async name=>loads.push(name),resetStockTools(){},updateSellPreview(){},console});
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
 assert.match(css,/min-height:56px;font-size:\.73rem/);assert.match(css,/padding-bottom:calc\(158px \+ env\(safe-area-inset-bottom,0px\)\)/);
});

test('Figma V2 makes each destination a visible icon button and current page identifiable',()=>{
 assert.equal((nav.match(/<svg class="merchantNavIcon"/g)||[]).length,6);
 assert.equal((nav.match(/<span class="merchantNavLabel">/g)||[]).length,6);
 assert.match(nav,/data-view="Dashboard" class="active" aria-current="page"/);
 assert.match(css,/\.merchantPrimaryNav button\.active\{background:#056b5e;border-color:#056b5e;color:#fff/);
 assert.match(css,/\.merchantPrimaryNav button:focus-visible\{outline:3px solid #1d4ed8/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});
test('Finance hydration changes only labels, never replaces native nav icons',()=>{
 const presentationSource=block(finance,'function applyFinancePresentation(','\nconst BUSINESS_FINANCE_COMPATIBILITY_COPY');
 assert.match(presentationSource,/btn\.querySelector\?\.\('\.merchantNavLabel'\)/);
 assert.match(presentationSource,/stockBtn\.querySelector\?\.\('\.merchantNavLabel'\)/);
});
test('canonical view and Orders or Catalog destination keep one accessible current-page marker',()=>{
 const viewSource=block(ui,'function setView(name){','\nasync function openInventoryNotificationContext');
 const actionSource=block(ui,'async function openMerchantAction(action){','\nasync function loadMerchantView');
 for(const src of [viewSource,actionSource]){
  assert.match(src,/setAttribute\?\.\('aria-current','page'\)/);
  assert.match(src,/removeAttribute\?\.\('aria-current'\)/);
 }
});
