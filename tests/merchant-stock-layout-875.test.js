// #875 — Merchant Stock button grid, on-demand tools, and identical receipt actions.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=read('public/index.html');
const css=read('public/v03.css');
const inventory=read('public/v03.js');
const vault=read('public/purchase-documents-ui.js');
const assistant=read('public/receipt-intelligence-ui.js');

const toolKeys=['inventory','purchase','unavailable','scanner','restockSettings','storage',
  'locations','lots','allergens','count','adjustments','wasteAnalytics','restock','consumables'];

test('Stock is a menu of 14 collapsed, independently expandable tools',()=>{
  const start=html.indexOf('<section id="viewStock"');
  const end=html.indexOf('<section id=',start+1);
  const stock=html.slice(start,end);
  assert.ok(start>0&&end>start);
  assert.match(stock,/id="stockToolDeck" class="stockToolDeck"/);
  assert.equal((stock.match(/<details id="stockTool-/g)||[]).length,toolKeys.length);
  for(const key of toolKeys){
    const tag='<details id="stockTool-'+key+'" class="stockTool" data-stock-tool="'+key+'">';
    assert.ok(stock.includes(tag),'missing collapsed button for '+key);
    assert.ok(stock.includes('aria-controls="stockPanel-'+key+'"'),'missing accessible panel '+key);
  }
  assert.ok(!/<details[^>]*class="stockTool"[^>]*\bopen(?:=|\s|>)/.test(stock),'all tools start closed');
  assert.equal((stock.match(/id="stockList"/g)||[]).length,1);
  assert.equal((stock.match(/id="stockForm"/g)||[]).length,1);
  assert.match(stock,/Choose a tool. It loads only when you open it/);
});

test('Figma-aligned Stock tool buttons fit mobile and show one expanded panel',()=>{
  assert.match(css,/#viewStock \.stockToolDeck\{[\s\S]*?grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/#viewStock \.stockTool\[open\]\{grid-column:1\/-1/);
  assert.match(css,/#viewStock \.stockTool > summary\{[\s\S]*?min-height:52px/);
  assert.match(css,/#viewStock \.stockTool > summary:focus-visible/);
  assert.match(css,/@media\(max-width:700px\)\{[\s\S]*?stockToolDeck\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(inventory,/function initStockTools\(\)/);
  assert.match(inventory,/detail\.querySelector\('summary'\)\?\.addEventListener\('click'/);
});

test('Stock tab has no automatic Inventory or Storage data request',()=>{
  const start=inventory.indexOf('async function loadMerchantView(name)');
  const end=inventory.indexOf('async function loadSummary()',start);
  const block=inventory.slice(start,end);
  assert.match(block,/if\(name==='Stock'\)return;/);
  assert.doesNotMatch(block,/if\(name==='Stock'\)return loadStock\(\)/);
  assert.match(inventory,/async function loadStock\(\{tool=null\}=\{\}\)/);
  assert.match(inventory,/const usesLocations=!tool\|\|tool==='locations'/);
  assert.match(inventory,/if\(!tool\|\|tool==='lots'\)jobs\.push\(loadInventoryLots/);
  assert.match(inventory,/if\(!tool\|\|tool==='restock'\)jobs\.push\(loadRestockSuggestions/);
});

test('Both receipt entry buttons have the same green Figma style and 48px hit targets',()=>{
  const styles=css.match(/#viewStock > \.sectionHead #receiptIntelligenceButton,\s*#viewStock > \.sectionHead #merchantPurchaseDocumentsButton\s*\{([^}]+)\}/);
  assert.ok(styles,'same CSS declaration must own both entry buttons');
  assert.match(styles[1],/min-height:48px/);
  assert.match(styles[1],/background:#056b5e/);
  assert.match(styles[1],/color:#fff/);
  assert.match(styles[1],/white-space:normal/);
  assert.match(styles[1],/overflow-wrap:anywhere/);
  assert.match(css,/#viewStock > \.sectionHead #receiptIntelligenceButton:focus-visible,/);
  assert.match(css,/#viewStock > \.sectionHead #merchantPurchaseDocumentsButton:focus-visible/);
});

test('Merchant receipt controls and stock write authorizations remain intact',()=>{
  assert.match(vault,/btn\.id='merchantPurchaseDocumentsButton'/);
  assert.match(assistant,/button\.id='receiptIntelligenceButton'/);
  assert.match(vault,/btn\.addEventListener\('click',open\)/);
  assert.match(assistant,/button\.onclick=\(\)=>open\(\)/);
  assert.match(inventory,/content\.disabled=!ready/);
  assert.match(inventory,/inventoryReadState\('partial'\)/);
  assert.match(inventory,/if\(isCurrent\(\)\)\{\s*inventoryReadState\('ready'\)/);
  assert.match(inventory,/if\(toolMenu\)view\.dataset\.inventoryReadState=state/);
  assert.match(css,/#viewStock\[data-inventory-read-state="error"\] \.stockToolPanel/);
});

// Regression: a successful write from one Stock disclosure must not reload all
// other tools. This invokes the real helper, not a duplicate implementation.
test('Stock post-write refresh is scoped to the currently open instrument',async()=>{
  const start=inventory.indexOf('function refreshStockTool(tool){');
  const end=inventory.indexOf('\n// One expanded instrument at a time.',start);
  assert.ok(start>0&&end>start,'the scoped refresh implementation exists');
  const code=inventory.slice(start,end);
  const calls=[];
  let visible=true;
  const panels=new Map([['purchase',{open:true}],['locations',{open:true}]]);
  const view={classList:{contains:name=>name==='hidden'&&!visible}};
  const runtime={stockToolActive:'purchase',Promise,
    $:key=>key==='viewStock'?view:key==='stockToolDeck'?{}:panels.get(key.slice('stockTool-'.length)),
    loadStock:opts=>{calls.push(opts||'full');return Promise.resolve()}};
  vm.createContext(runtime);
  vm.runInContext(code,runtime);
  await runtime.refreshStockTool('purchase');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{tool:'purchase'}]);
  await runtime.refreshStockTool('locations');
  assert.equal(calls.length,1,'a closed/unselected Stock tool must not refresh');
  panels.get('purchase').open=false;
  await runtime.refreshStockTool('purchase');
  assert.equal(calls.length,1,'no refreshing after tool closes');
  visible=false;
  await runtime.refreshStockTool('purchase');
  assert.equal(calls[1],'full','Sell/Menu outside Stock retain their full Inventory refresh');
});

test('Stock write/refresh callbacks never invoke bare all-tool loadStock',()=>{
  for(const tool of ['locations','count','scanner']){
    assert.ok(inventory.includes("refreshInventory:()=>refreshStockTool('"+tool+"')"),'missing scoped '+tool+' callback');
  }
  for(const tool of ['unavailable','adjustments','storage','restockSettings','purchase','restock']){
    assert.ok(inventory.includes("refreshStockTool('"+tool+"')"),'missing scoped '+tool+' refresh');
  }
  assert.ok(inventory.includes("if(name==='Stock'){\n      if(stockToolActive)await refreshStockTool(stockToolActive);"));
  assert.ok(!inventory.includes("if($('restockRefresh'))$('restockRefresh').onclick=()=>loadStock()"));
});
