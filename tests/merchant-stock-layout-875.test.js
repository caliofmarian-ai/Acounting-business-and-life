// #875 — Merchant Production Stock first-paint stability and unified receipt actions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=read('public/index.html');
const css=read('public/v03.css');
const inventory=read('public/v03.js');
const vault=read('public/purchase-documents-ui.js');
const assistant=read('public/receipt-intelligence-ui.js');

test('Stock list stays before purchase form when partial data becomes ready',()=>{
  const start=html.indexOf('<section id="viewStock"');
  const end=html.indexOf('<section id=',start+1);
  const stock=html.slice(start,end);
  assert.ok(start>0&&end>start);
  const list=stock.indexOf('id="stockList"');
  const purchase=stock.indexOf('id="stockForm"');
  assert.ok(list>0&&purchase>list,'fast first list must not move below late purchase form');
  assert.equal(stock.match(/id="stockList"/g)?.length,1);
  assert.equal(stock.match(/id="stockForm"/g)?.length,1);
  assert.match(stock,/id="inventoryUnavailableCard"/);
});

test('Both receipt entry buttons have one shared Merchant style and 48px hit targets',()=>{
  const styles=css.match(/#viewStock > \.sectionHead #receiptIntelligenceButton,\s*#viewStock > \.sectionHead #merchantPurchaseDocumentsButton\s*\{([^}]+)\}/);
  assert.ok(styles,'same CSS declaration must own both entry buttons');
  assert.match(styles[1],/min-height:48px/);
  assert.match(styles[1],/background:#056b5e/);
  assert.match(styles[1],/color:#fff/);
  assert.match(styles[1],/white-space:normal/);
  assert.match(styles[1],/overflow-wrap:anywhere/);
  assert.match(css,/#viewStock > \.sectionHead #receiptIntelligenceButton:focus-visible,/);
  assert.match(css,/#viewStock > \.sectionHead #merchantPurchaseDocumentsButton:focus-visible/);
  assert.match(css,/@media\(max-width:520px\)[\s\S]*#viewStock > \.sectionHead > div:first-child\{grid-template-columns:minmax\(0,1fr\)\}/);
});

test('Existing Merchant receipt actions and write safety remain intact',()=>{
  assert.match(vault,/btn\.id='merchantPurchaseDocumentsButton'/);
  assert.match(assistant,/button\.id='receiptIntelligenceButton'/);
  assert.match(vault,/btn\.addEventListener\('click',open\)/);
  assert.match(assistant,/button\.onclick=\(\)=>open\(\)/);
  assert.match(inventory,/content\.disabled=!ready/);
  assert.match(inventory,/inventoryReadState\('partial'\)/);
  assert.match(inventory,/if\(isCurrent\(\)\)inventoryReadState\('ready'\)/);
});
