// Native DOM/CSS checks using synthetic data and loopback only.
// Gateway, read-authority and shared Preview journeys remain separate gates.
// Viewport coverage does not claim physical Android hardware acceptance.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const source=readFileSync(join(root,'public/v03.js'),'utf8');
const index=readFileSync(join(root,'public/index.html'),'utf8');
const start=index.indexOf('<section id="viewStock"');
const end=index.indexOf('<section id=',start+1);
assert.ok(start>=0&&end>start,'Actual Inventory markup is required');
const stock=index.slice(start,end).replace('class="view hidden"','class="view"');
const rendererStart=source.indexOf('let inventoryConfirmedContext=null;');
const rendererEnd=source.indexOf('\nfunction inventoryReadApi(',rendererStart);
assert.ok(rendererStart>=0&&rendererEnd>rendererStart,'Actual read-state renderer is required');
const renderer=source.slice(rendererStart,rendererEnd);
const script=[
  "const $=id=>document.getElementById(id);",
  "const merchantReadContext=()=>({accountId:1,businessId:1});",
  "function loadStock(){inventoryReadState('ready')}",
  renderer,
  "document.querySelectorAll('form').forEach(form=>form.addEventListener('submit',event=>event.preventDefault()));",
  "$('stockList').textContent='Example ingredient — last confirmed quantity: 4 kg';",
  "document.querySelectorAll('[data-test-state]').forEach(button=>button.addEventListener('click',()=>inventoryReadState(button.dataset.testState,{savedAt:Date.UTC(2026,9,27,16),error:new Error('Controlled read failure.')})));",
  "inventoryReadState('ready');"
].join('\n');
const controls=['ready','loading','cached','error','idle'].map(state=>
  '<button type="button" data-test-state="'+state+'">Test '+state+'</button>').join('');
const html='<!doctype html><html lang="en"><head><meta charset="utf-8">'+
  '<meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/v03.css">'+
  '<title>Isolated Inventory native checks</title></head><body>'+
  '<nav style="display:flex;flex-wrap:wrap;gap:4px;padding:8px" aria-label="Test states">'+controls+'</nav>'+
  '<main id="app"><section id="shell">'+stock+'</section></main>'+
  '<script>'+script+'</script></body></html>';
const unexpectedRequests=[];
const server=createServer((req,res)=>{
  if(req.method!=='GET'){unexpectedRequests.push(req.method+' '+req.url);res.writeHead(405).end();return}
  if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return}
  if(req.url==='/styles.css'||req.url==='/v03.css'){
    res.setHeader('Content-Type','text/css');
    res.end(readFileSync(join(root,'public',req.url.slice(1))));return;
  }
  res.writeHead(404).end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const evidence=process.env.INVENTORY_BROWSER_EVIDENCE_DIR;
if(evidence)mkdirSync(evidence,{recursive:true});
const {chromium}=await import(process.env.INVENTORY_BROWSER_MODULE||'playwright');
const checks=[],errors=[];
let browser;
try{
  browser=await chromium.launch({headless:true,...(process.env.INVENTORY_BROWSER_CHANNEL?{channel:process.env.INVENTORY_BROWSER_CHANNEL}:{})});
  for(const viewport of [{width:390,height:844},{width:1348,height:936}]){
    const context=await browser.newContext({viewport,deviceScaleFactor:1});
    const page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>{
      if(route.request().url().startsWith(base+'/'))return route.continue();
      unexpectedRequests.push(route.request().url());return route.abort();
    });
    await page.goto(base);
    const fieldset=page.locator('#inventoryReadContent');
    const input=page.locator('#stockPurchaseQty');
    const picker=page.locator('#stockItemPicker');
    const status=page.locator('#inventoryReadStatus');
    const fit=async label=>{
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,label);
      checks.push(viewport.width+'px '+label);
      if(evidence)await page.screenshot({path:join(evidence,viewport.width+'-'+label+'.png')});
    };
    await status.getByText('Inventory confirmed just now.',{exact:true}).waitFor();
    assert.equal(await input.isEnabled(),true);
    assert.equal(await picker.isEnabled(),false,'Capability-disabled picker stays disabled');
    const styles=await fieldset.evaluate(el=>{
      const style=getComputedStyle(el);
      return{border:style.borderTopWidth,padding:style.padding,margin:style.margin,minWidth:style.minWidth};
    });
    assert.deepEqual(styles,{border:'0px',padding:'0px',margin:'0px',minWidth:'0px'});
    await fit('ready');

    await page.getByRole('button',{name:'Test loading',exact:true}).click();
    assert.equal(await input.isEnabled(),false,'Native fieldset disables nested writes during loading');
    assert.equal(await page.locator('#viewStock').getAttribute('aria-busy'),'true');
    assert.equal(await page.locator('#stockForm').isVisible(),false);
    assert.equal(await page.locator('#lowStock').textContent(),'—');
    await fit('loading');

    await page.getByRole('button',{name:'Test cached',exact:true}).click();
    assert.match(await status.textContent(),/Philippine time.*Stock changes are disabled/);
    assert.equal(await input.isEnabled(),false);
    assert.equal(await page.locator('#stockList').isVisible(),true,'Cached Inventory stays readable');
    assert.equal(await page.locator('#stockForm').isVisible(),false);
    await fit('offline');
    await status.getByRole('button',{name:'Retry',exact:true}).click();
    assert.equal(await input.isEnabled(),true);
    assert.equal(await picker.isEnabled(),false,'Retry cannot clear an independent disabled state');
    checks.push(viewport.width+'px retry preserves individual widget restrictions');

    await page.getByRole('button',{name:'Test error',exact:true}).click();
    assert.equal(await status.getAttribute('role'),'alert');
    assert.match(await status.textContent(),/Inventory could not be loaded.*Controlled read failure/);
    assert.equal(await input.isEnabled(),false);
    assert.equal(await page.locator('#stockList').isVisible(),false,'Failed reads expose no retained stock');
    await fit('error');
    await status.getByRole('button',{name:'Retry',exact:true}).click();
    assert.equal(await input.isEnabled(),true);
    assert.equal(await picker.isEnabled(),false);

    await page.getByRole('button',{name:'Test idle',exact:true}).click();
    assert.equal(await input.isEnabled(),false);
    assert.equal(await page.locator('#stockList').isVisible(),false);
    await fit('idle');
    await status.getByRole('button',{name:'Load Inventory',exact:true}).click();
    assert.equal(await input.isEnabled(),true);
    assert.equal(await picker.isEnabled(),false);
    await context.close();
  }
  assert.deepEqual(errors,[],'No fixture script error');
  assert.deepEqual(unexpectedRequests,[],'No external or mutation request');
  const result={revision:process.env.INVENTORY_BROWSER_REVISION||'local',browser:browser.version(),checks};
  if(evidence)writeFileSync(join(evidence,'result.json'),JSON.stringify(result,null,2));
  console.log('INVENTORY_NATIVE_BROWSER_PASS '+JSON.stringify(result));
}finally{
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}
