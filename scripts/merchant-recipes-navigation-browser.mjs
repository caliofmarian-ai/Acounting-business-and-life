// Synthetic native layout/navigation checks. No login, database, server API or
// deployed acceptance is claimed. Uses shipped HTML/CSS and actual view/presentation functions.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url))),read=p=>readFileSync(join(root,p),'utf8');
const ui=read('public/v03.js'),finance=read('public/business-accounting-ui.js');
function block(s,a,b){const first=s.indexOf(a),last=s.indexOf(b,first);assert.ok(first>=0&&last>first);return s.slice(first,last)}
const setView=block(ui,'function setView(name){','\nasync function openInventoryNotificationContext');
const presentation=block(finance,'function applyFinancePresentation(','\nconst BUSINESS_FINANCE_COMPATIBILITY_COPY');
const actions=block(ui,'async function openMerchantAction(action){','\nasync function loadMerchantView');
const states=['food','mixed','non_food','unknown','supplier'];
const controls='<aside id="syntheticFixture"><strong>SYNTHETIC UI CHECK — no live account or stock</strong>'+states.map(s=>'<button type="button" data-fixture="'+s+'">Fixture '+s+'</button>').join('')+'</aside>';
const script=["const $=id=>document.getElementById(id);const accountingState={role:'merchant'};async function loadMerchantView(name){document.body.dataset.requestedView=name}function updateSellPreview(){}",setView,presentation,actions,
 "$('login').classList.add('hidden');$('shell').classList.remove('hidden');$('todayContent').classList.remove('hidden');$('todayLoading').classList.add('hidden');",
 "document.querySelectorAll('.bottomNav [data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view));",
 "document.querySelectorAll('[data-today-action]').forEach(b=>b.onclick=()=>openMerchantAction(b.dataset.todayAction));",
 "document.querySelectorAll('[data-fixture]').forEach(b=>b.onclick=()=>{const domain=b.dataset.fixture;applyFinancePresentation({role:domain==='supplier'?'supplier':'merchant',presentation:{merchant_domain:domain,legacy_recipe_ui_allowed:['food','mixed','supplier'].includes(domain)}});$('todayFoodActions').classList.toggle('hidden',!['food','mixed'].includes(domain));setView('Dashboard')});",
 "document.querySelectorAll('form').forEach(form=>form.addEventListener('submit',e=>e.preventDefault()));"
].join('\n');
let html=read('public/index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*rel="(?:manifest|icon)"[^>]*>/gi,'');
html=html.replace('</head>','<link rel="stylesheet" href="/shell.css"><link rel="stylesheet" href="/business-accounting.css"></head>');
html=html.replace('<body>','<body>'+controls).replace('</body>','<script>'+script+'</script></body>');
const errors=[],external=[],checks=[],files=new Set(['/styles.css','/v03.css','/shell.css','/business-accounting.css']);
const server=createServer((req,res)=>{
 if(req.method!=='GET'){external.push(req.method+' '+req.url);res.writeHead(405).end();return}
 if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return}
 if(files.has(req.url)){res.setHeader('Content-Type','text/css');res.end(read('public'+req.url));return}
 res.writeHead(404).end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const evidence=process.env.RECIPE_BROWSER_EVIDENCE;
if(evidence)mkdirSync(evidence,{recursive:true});
const {chromium}=await import(process.env.RECIPE_BROWSER_MODULE||'playwright');
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.RECIPE_BROWSER_CHANNEL?{channel:process.env.RECIPE_BROWSER_CHANNEL}:{})});
 for(const width of [320,390,1348]){
  const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{if(route.request().url().startsWith(origin+'/'))return route.continue();external.push(route.request().url());return route.abort()});
  await page.goto(origin);
  const recipes=page.locator('#merchantRecipesNav'),nav=page.getByRole('navigation',{name:'Merchant primary navigation'});
  assert.equal(await recipes.isVisible(),false,'no capability flash');
  assert.equal(await nav.locator('button .merchantNavIcon').count(),6,'six native outline icons');
  assert.equal(await nav.locator('button .merchantNavLabel').count(),6,'six persistent text labels');
  for(const domain of states){
   await page.getByRole('button',{name:'Fixture '+domain,exact:true}).click();
   const allowed=['food','mixed'].includes(domain);
   assert.equal(await recipes.isVisible(),allowed,domain+' recipe eligibility');
   const visible=await nav.locator('button:visible').allTextContents();
   if(allowed){
    assert.deepEqual(visible,['Today','Orders','Catalog','Products & recipes','Stock','Money']);
    assert.equal(await nav.locator('button .merchantNavIcon').count(),6,'Finance hydration cannot erase icons');
    assert.equal(await nav.locator('button:visible').first().evaluate(b=>getComputedStyle(b).borderTopWidth),'1px','inactive button has outlined border');
    await recipes.press('Enter');
    assert.equal(await page.locator('#viewMenu').isVisible(),true);
    assert.equal(await recipes.getAttribute('class'),'active');
    assert.equal(await recipes.getAttribute('aria-current'),'page');
    assert.equal(await nav.locator('button[aria-current="page"]').count(),1,'only one current destination');
    assert.equal(await page.locator('body').getAttribute('data-requested-view'),'Menu');
    assert.equal(await page.locator('#viewMenu h1').textContent(),'Products & recipes');
    const geometry=await nav.locator('button:visible').evaluateAll(buttons=>buttons.map(b=>{const r=b.getBoundingClientRect();return{height:r.height,left:r.left,right:r.right,top:r.top,bottom:r.bottom,fit:b.scrollWidth<=b.clientWidth}}));
    assert.ok(geometry.every(r=>r.height>=44&&r.left>=0&&r.right<=width&&r.top>=0&&r.bottom<=844&&r.fit),'labels and targets fit viewport '+width);
    if(width<650){assert.equal(geometry[3].top,geometry[4].top);assert.ok(geometry[3].top>geometry[0].top,'three-column two-row mobile nav')}
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no page overflow');
    if(evidence&&domain==='food')await page.screenshot({path:join(evidence,width+'-recipes.png')});
    await nav.getByRole('button',{name:'Stock',exact:true}).click();assert.equal(await page.locator('#viewStock').isVisible(),true);assert.equal(await nav.getByRole('button',{name:'Stock',exact:true}).getAttribute('aria-current'),'page');
    await recipes.click();assert.equal(await page.locator('#viewMenu').isVisible(),true);
    await nav.getByRole('button',{name:'Money',exact:true}).click();assert.equal(await page.locator('#viewMoney').isVisible(),true);
    await nav.getByRole('button',{name:'Today',exact:true}).click();
    await page.getByRole('button',{name:'Quick Sale',exact:true}).click();assert.equal(await page.locator('#viewSell').isVisible(),true);
   }else{
    assert.equal(visible.length,5);assert.equal(await nav.getByRole('button',{name:'Money',exact:true}).isVisible(),true);
   }
   checks.push({width,domain,passed:true});
  }
  assert.equal(await page.locator('[data-today-action="recipes"]').count(),0);
  await context.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 const result={revision:process.env.RECIPE_BROWSER_REVISION||'candidate-working-tree',browser:browser.version(),mode:'synthetic native UI, no authentication or deployed API',checks};
 if(evidence)writeFileSync(join(evidence,'result.json'),JSON.stringify(result,null,2));
 console.log('RECIPE_NAV_BROWSER_PASS '+JSON.stringify(result));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
