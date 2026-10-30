import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  parseCsvRecords,parseStockIntakeCsv,validStockIntakeRow,findExistingInventory
} from '../public/merchant-stock-csv-intake.js';

const ui=readFileSync(new URL('../public/merchant-stock-csv-intake.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../public/merchant-stock-csv-intake.js',import.meta.url),'utf8');
const example=[
  'item,proposed_quantity,proposed_unit,screenshot_line_php,recomputed_line_php,posting_status,review_note',
  'Fish balls,3,kg,345,345,CONFIRM STOCK,Three kilograms',
  'Rice,2,kg,120,124,CHECK PRICE,Arithmetic disagreement',
  'String beans,,kg,50,50,CONFIRM QTY,Weigh before posting',
  '"Quail eggs (box)",2,unit,400,400,VERIFY PACK,"Box count, not egg count"'
].join('\r\n');

test('quoted commas, BOM, and CRLF are correctly parsed',()=>{
  const records=parseCsvRecords('\uFEFFitem,qty\r\n"Fish balls, frozen",3\r\n');
  assert.deepEqual(records,[['item','qty'],['Fish balls, frozen','3']]);
});

test('genuine source-note mismatches and missing physical quantities are held for review',()=>{
  const rows=parseStockIntakeCsv(example);
  assert.equal(rows.length,4);
  assert.equal(rows[0].item,'Fish balls');
  assert.equal(validStockIntakeRow(rows[0]),true);
  assert.equal(rows[1].requiresReview,true);
  assert.equal(validStockIntakeRow(rows[1]),false);
  assert.equal(rows[2].quantity,null);
  assert.equal(validStockIntakeRow(rows[2]),false);
  assert.equal(rows[3].requiresReview,true);
  assert.equal(rows[3].unit,'unit');
});

test('human correction and explicit review permit a valid line',()=>{
  const rows=parseStockIntakeCsv(example);
  rows[1].total=124;
  rows[1].reviewConfirmed=true;
  assert.equal(validStockIntakeRow(rows[1]),true);
  rows[2].quantity=.25;
  rows[2].reviewConfirmed=true;
  assert.equal(validStockIntakeRow(rows[2]),true);
  rows[3].reviewConfirmed=true;
  assert.equal(validStockIntakeRow(rows[3]),true);
});

test('invalid units, precision, duplicates and omitted columns fail closed',()=>{
  const row=parseStockIntakeCsv(example)[0];
  assert.equal(validStockIntakeRow({...row,unit:'tray'}),false);
  assert.equal(validStockIntakeRow({...row,quantity:0}),false);
  assert.equal(validStockIntakeRow({...row,quantity:1.12345}),false);
  assert.equal(validStockIntakeRow({...row,total:-2}),false);
  assert.throws(()=>parseStockIntakeCsv('item,proposed_quantity,proposed_unit\nRice,2,kg'),/Missing required/);
  assert.throws(()=>parseStockIntakeCsv('item,proposed_quantity,proposed_unit,screenshot_line_php\nRice,2,kg,120\nrice,3,kg,90'),/Duplicate product/);
});

test('same-business duplicate names are blocked before purchase',()=>{
  const row=parseStockIntakeCsv(example)[0];
  row.exists=findExistingInventory(row,[{id:75,item:'FISH BALLS',quantity:3000,unit:'g'}]);
  assert.equal(row.exists.id,75);
  assert.equal(validStockIntakeRow(row),false);
});

test('stock intake uses one selected Merchant and never silently writes finance or retries',()=>{
  assert.match(js,/workspace\.businesses\.length!==1/);
  assert.match(js,/business\.country_code/);
  assert.match(js,/sameContext\(next,verify\)/);
  assert.match(js,/sameContext\(after,state\.context\)/);
  assert.match(js,/await assertLiveContext\(\)/);
  assert.match(js,/findExistingInventory\(row,state\.inventory\)/);
  assert.match(js,/record_expense:false/);
  assert.match(js,/No automatic retry/);
  assert.doesNotMatch(js,/localStorage|sessionStorage/);
  assert.doesNotMatch(js,/record_expense:true/);
  assert.match(ui,/session-security\.js/);
  assert.match(ui,/merchant-stock-csv-intake\.js/);
});

test('the self-service tool requires explicit physical count and business confirmation',()=>{
  assert.match(ui,/physicalConfirm/);
  assert.match(ui,/moneyConfirm/);
  assert.match(ui,/businessName/);
  assert.match(ui,/type="file"/);
  assert.match(ui,/noindex,nofollow/);
  assert.match(js,/exactlyConfirmedBusiness\(\)/);
});
