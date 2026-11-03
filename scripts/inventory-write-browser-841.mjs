// Native Chrome + shipped callbacks/modules/markup; identities and HTTP are
// synthetic loopback fixtures. Authenticated real PG/Preview QA is separate.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

const read=p=>readFileSync(p,'utf8'),source=read('public/v03.js');
const block=(a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start);assert.ok(start>=0&&end>start);return source.slice(start,end)};
const forms=['stockForm','stockAdjustmentForm','consumableRuleForm','storageForm','restockSettingsForm','ingredientAllergenForm','inventoryUnavailableForm'];
const callbacks=forms.filter(form=>form!=='inventoryUnavailableForm').map(form=>{
  const start=source.indexOf(`$('${form}')${form==='stockForm'?'.':'?.'}addEventListener('submit',async`);
  const end=source.indexOf('\n});',start)+4;assert.ok(start>=0&&end>start);
  return source.slice(start,end);
}).join('\n');
function functionSource(name){
  const match=new RegExp('^(?:async )?function '+name+'\\(','m').exec(source);assert.ok(match);
  const tail=source.slice(match.index),end=tail.slice(1).search(/\n(?:async )?function /);return end<0?tail:tail.slice(0,end+1);
}
const setup=`
import {createInventoryWriteController} from '/inventory-write-context.js';
import {createInventoryCountUi} from '/inventory-count-ui.js';
import {createInventoryLocationUi} from '/inventory-location-ui.js';
import {createInventoryScanUi} from '/inventory-scan-ui.js';
const $=id=>document.getElementById(id);window.__context={accountId:1,businessId:11,session:'synthetic-a',profileEpoch:1};
const merchantReadContext=()=>({...window.__context});
const merchantReadIsCurrent=context=>JSON.stringify(context)===JSON.stringify(window.__context);
const staleMerchantRead=()=>Object.assign(new Error('context changed'),{staleMerchantRead:true});
const inventoryWrites=createInventoryWriteController({captureContext:merchantReadContext,isContextCurrent:merchantReadIsCurrent,byId:$});
const beginInventoryWrite=root=>inventoryWrites.begin(root);
let inventoryConfirmedContext=merchantReadContext();
window.__calls=[];window.__refreshes=0;window.__logouts=0;
function setOnline(){}function logout(){window.__logouts++}
const num=String,money=String,esc=String;function invalidateMerchantToday(){}
const inventoryReadGuard=()=>{const c=merchantReadContext();return()=>merchantReadIsCurrent(c)};
const selectedPositiveInventoryId=select=>Number(select.value)||null;
function updateInventoryUnavailablePreview(){}function fillInventoryUnavailableEditor(){}
const consumableRuleLabel=()=> 'Synthetic consumable';
const emptyRow=text=>{const n=document.createElement('div');n.textContent=text;return n};
async function loadStock(){window.__refreshes++}async function loadProducts(){window.__refreshes++}
async function loadStockAdjustmentLots(){window.__refreshes++}
function updateStockAdjustmentPreview(){}const checkedAllergens=()=>[];
const originalFetch=window.fetch.bind(window);
window.fetch=(path,options={})=>{
  if(!String(path).startsWith('/api/'))return originalFetch(path,options);
  window.__calls.push({path,method:options.method||'GET',headers:options.headers});
  return new Promise(resolve=>{window.__resolve=(status,data)=>resolve(new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}}))});
};
`+block('async function api(', '\nasync function cachedJson(')+'\n'+callbacks+'\n'+functionSource('loadInventoryUnavailableAllocations')+'\n'+functionSource('loadConsumableRules')+'\n'+block('function wireInventoryUnavailableUi(){','\nlet inventoryLoadGeneration=')+`
const options={api,getReadGuard:()=>{const c=merchantReadContext();return()=>merchantReadIsCurrent(c)},beginWrite:beginInventoryWrite,
 getInventory:()=>[{id:10,item:'Synthetic flour',unit:'g'}],getLocations:()=>[],
 refreshInventory:loadStock,escapeHtml:String,formatNumber:String};
const count=createInventoryCountUi(options),locations=createInventoryLocationUi(options),scan=createInventoryScanUi(options);
count.wire();locations.wire();scan.wire();wireInventoryUnavailableUi();
window.__fixture={forms,prepareCount(action){
 count.render({id:8,business_id:11,status:['countSessionPostBtn','countSessionResumeBtn'].includes(action)?'review':'in_progress',
 items:[{inventory_id:10,item:'Synthetic flour',unit:'g',inventory_type:'ingredient',counted_quantity:1,expected_quantity:1,variance_quantity:0}],
 progress:{total:1,counted:1,remaining:0}});
},seedAction(action){
 return action==='restore'?loadInventoryUnavailableAllocations():action==='remove'?loadConsumableRules():locations.load();
},prepare(){
 count.reset();locations.reset();
 inventoryWrites.invalidate();window.__context={accountId:1,businessId:11,session:'synthetic-a',profileEpoch:1};
 inventoryConfirmedContext=merchantReadContext();window.__calls=[];window.__refreshes=0;
 for(const id of ['stockAdjustmentInventory','storageInventoryId','restockSettingsInventory','ingredientAllergenInventory','inventoryIdentifierItem','inventoryUnavailableItem','inventoryTransferItem','inventoryTransferSource','inventoryTransferDestination']){if($(id).tagName==='SELECT'&&![...$(id).options].some(o=>o.value==='10'))$(id).add(new Option('Synthetic flour','10'));$(id).value='10';}
 $('stockAdjustmentQty').value='1';$('inventoryUnavailableQuantity').value='1';
 for(const [id,value] of [['inventoryTransferSource','21'],['inventoryTransferDestination','22']]){$(id).add(new Option(value,value));$(id).value=value}
 $('inventoryTransferQuantity').value='1';
},switch(){window.__context={...window.__context,businessId:22};inventoryWrites.invalidate()},submit(form){$(form).dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))}};
window.__ready=true;
`;
// The factories use the actual index forms and the existing native DOM.
let html=read('public/index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*rel="(?:manifest|icon)"[^>]*>/gi,'');
html=html.replace('</body>','<script type="module" src="/fixture.js"></script></body>');
const files=new Set(['/inventory-write-context.js','/inventory-count-ui.js','/inventory-location-ui.js','/inventory-scan-ui.js','/styles.css','/v03.css']);
const server=createServer((req,res)=>{
  if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return}
  if(req.url==='/fixture.js'){res.setHeader('Content-Type','application/javascript');res.end('const forms='+JSON.stringify(forms)+';\n'+setup);return}
  if(files.has(req.url)){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'application/javascript');res.end(read('public'+req.url));return}
  res.writeHead(404).end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const {chromium}=await import(process.env.INVENTORY_BROWSER_MODULE||'playwright');
const checks=[],errors=[];let browser;
try{
  browser=await chromium.launch({headless:true,channel:process.env.INVENTORY_BROWSER_CHANNEL||'chrome'});
  for(const width of [390,1280]){
    const page=await browser.newPage({viewport:{width,height:844}});
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base);await page.waitForFunction(()=>window.__ready===true);
    for(const form of forms){
      for(const status of [201,500,401]){
        await page.evaluate(form=>{window.__fixture.prepare();window.__fixture.submit(form);window.__fixture.submit(form)},form);
        assert.equal(await page.evaluate(()=>window.__calls.length),1,form+' duplicate submit');
        assert.equal(await page.evaluate(()=>window.__calls[0].headers['x-abl-inventory-origin-business']),'11');
        await page.evaluate(status=>{
          window.__fixture.switch();for(const n of document.querySelectorAll('[id$="Message"]'))n.textContent='B draft';
          document.getElementById('stockItem').value='B flour draft';window.__resolve(status,{error:'A failure',item:'A private item'});
        },status);
        await page.waitForTimeout(15);
        assert.equal(await page.locator('#stockItem').inputValue(),'B flour draft',form+' must not erase B draft');
        assert.equal(await page.evaluate(()=>window.__refreshes),0,form+' must not refresh B');
        assert.equal(await page.evaluate(()=>window.__logouts),0,form+' old 401 cannot log out B');
        const msg={stockForm:'stockMessage',stockAdjustmentForm:'stockAdjustmentMessage',consumableRuleForm:'consumableRuleMessage',storageForm:'storageMessage',restockSettingsForm:'restockSettingsMessage',ingredientAllergenForm:'ingredientAllergenMessage',inventoryUnavailableForm:'inventoryUnavailableMessage'}[form];
        assert.equal(await page.locator('#'+msg).textContent(),'B draft');
        checks.push(width+' '+form+' stale '+status);
      }
    }
    for(const [action,message] of [
      ['countSessionStart','countSessionMessage'],['countSessionSaveItem','countSessionMessage'],
      ['countSessionReviewBtn','countSessionMessage'],['countSessionResumeBtn','countSessionMessage'],
      ['countSessionPostBtn','countSessionMessage'],['inventoryIdentifierSave','inventoryIdentifierMessage'],
      ['inventoryLocationForm','inventoryLocationMessage'],['inventoryTransferForm','inventoryTransferMessage']
    ]){
      for(const status of [200,500]){
        await page.evaluate(action=>{
          window.__fixture.prepare();if(action.startsWith('countSession')&&action!=='countSessionStart')window.__fixture.prepareCount(action);
          const n=document.getElementById(action);if(n.tagName==='FORM'){window.__prevented=[n.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})),n.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))]}else n.click();
        },action);
        assert.equal(await page.evaluate(()=>window.__calls.length),1,action+' dispatch');
        if(action.endsWith('Form'))assert.deepEqual(await page.evaluate(()=>window.__prevented),[false,false],action+' duplicate native submit must prevent navigation');
        await page.evaluate(({message,status})=>{window.__fixture.switch();document.getElementById(message).textContent='B draft';window.__resolve(status,{error:'A failure',id:8,items:[]})},{message,status});
        await page.waitForTimeout(15);
        assert.equal(await page.locator('#'+message).textContent(),'B draft');
        assert.equal(await page.evaluate(()=>window.__refreshes),0);
        checks.push(width+' '+action+' stale '+status);
      }
    }
    for(const [action,selector,rows,message] of [
      ['restore','#inventoryUnavailableList button',[{id:1,state:'active',reason:'other',quantity:1,unit:'g'}],'inventoryUnavailableMessage'],
      ['remove','#consumableRuleList button',[{id:1,item:'Synthetic cup',stock_quantity:5,unit:'unit'}],'consumableRuleMessage'],
      ['reverse','#inventoryTransferList button',{locations:[],balances:[],transfers:[{id:9,item:'Synthetic flour',quantity:1,unit:'g',source_location:'A',destination_location:'B'}]},'inventoryTransferMessage']
    ]){
      for(const status of [200,500]){
        await page.evaluate(({action,rows})=>{window.__fixture.prepare();window.__loaded=window.__fixture.seedAction(action);window.__resolve(200,rows)},{action,rows});
        await page.evaluate(()=>window.__loaded);
        assert.equal(await page.locator(selector).count(),1,action+' actual action button');
        await page.evaluate(selector=>{window.__calls=[];document.querySelector(selector).click()},selector);
        assert.equal(await page.evaluate(()=>window.__calls.length),1,action+' dispatch');
        await page.evaluate(({message,status})=>{window.__fixture.switch();document.getElementById(message).textContent='B draft';window.__resolve(status,{error:'A failure'})},{message,status});
        await page.waitForTimeout(15);
        assert.equal(await page.locator('#'+message).textContent(),'B draft');
        assert.equal(await page.evaluate(()=>window.__refreshes),0);
        assert.equal(await page.evaluate(()=>window.__calls.length),1,'stale action starts no new reads');
        checks.push(width+' '+action+' stale '+status);
      }
    }
    await page.evaluate(()=>{window.__fixture.prepare();window.__fixture.submit('storageForm');window.__resolve(200,{item:'Current flour'})});
    await page.waitForFunction(()=>document.getElementById('storageMessage').textContent==='Storage saved for Current flour.');
    assert.equal(await page.evaluate(()=>window.__refreshes),1,'current save refresh control');
    checks.push(width+' current storage control');
    await page.close();
  }
  assert.deepEqual(errors,[],'no native JavaScript failures');
  const result={checks,synthetic_identity:true,physical_android:false,browser:browser.version()};
  const out=process.env.INVENTORY_BROWSER_EVIDENCE_DIR;if(out){mkdirSync(out,{recursive:true});writeFileSync(join(out,'write-841.json'),JSON.stringify(result,null,2))}
  console.log('INVENTORY_WRITE_NATIVE_841_PASS '+JSON.stringify(result));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
