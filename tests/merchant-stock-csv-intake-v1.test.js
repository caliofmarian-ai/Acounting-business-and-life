import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  parseCsvRecords,parseStockIntakeCsv,validStockIntakeRow,findExistingInventory,
  parsePhpMoney,parseStockQuantity,validPhilippinePurchaseDate
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
  assert.equal(validStockIntakeRow({...row,total:0}),false);
  assert.throws(()=>parseStockIntakeCsv('item,proposed_quantity,proposed_unit\nRice,2,kg'),/Missing required/);
  assert.throws(()=>parseStockIntakeCsv('item,proposed_quantity,proposed_unit,screenshot_line_php\nRice,2,kg,120\nrice,3,kg,90'),/Duplicate product/);
});

test('same-business duplicate names are blocked before purchase',()=>{
  const row=parseStockIntakeCsv(example)[0];
  row.exists=findExistingInventory(row,[{id:75,item:'FISH BALLS',quantity:3000,unit:'g'}]);
  assert.equal(row.exists.id,75);
  assert.equal(validStockIntakeRow(row),false);
});

test('paid stock intake requires one Merchant, and records exactly a linked purchase expense without retry',()=>{
  assert.match(js,/workspace\.businesses\.length!==1/);
  assert.match(js,/business\.country_code/);
  assert.match(js,/sameContext\(next,verify\)/);
  assert.match(js,/sameContext\(after,state\.context\)/);
  assert.match(js,/await assertLiveContext\(\)/);
  assert.match(js,/findExistingInventory\(row,state\.inventory\)/);
  assert.match(js,/record_expense:true/);
  assert.match(js,/account:paidFrom/);
  assert.match(js,/result\?\.transaction\?\.id/);
  assert.match(js,/method:'PATCH'/);
  assert.match(js,/originalDate!==localDatePH\(\)/);
  assert.match(js,/originalDate\+'T12:00:00\+08:00'/);
  assert.match(js,/api\('\/api\/transactions'/);
  assert.match(js,/No automatic retry/);
  assert.match(js,/saved-date-pending/);
  assert.match(js,/totalsMatch/);
  assert.match(js,/selectedPaid/);
  assert.match(js,/actualTotalPaid/);
  assert.doesNotMatch(js,/localStorage|sessionStorage|record_expense:false/);
  assert.match(ui,/session-security\.js/);
  assert.match(ui,/merchant-stock-csv-intake\.js/);
});

test('the self-service tool requires explicit physical count and business confirmation',()=>{
  assert.match(ui,/physicalConfirm/);
  assert.match(ui,/moneyConfirm/);
  assert.match(ui,/businessName/);
  assert.match(ui,/purchaseAccount/);
  assert.match(ui,/purchaseDate/);
  assert.match(ui,/actualTotalPaid/);
  assert.match(ui,/reconciliation/);
  assert.match(ui,/actual payment/);
  assert.match(js,/localDatePH\(\)/);
  assert.match(ui,/type="file"/);
  assert.match(ui,/noindex,nofollow/);
  assert.match(js,/exactlyConfirmedBusiness\(\)/);
});

test('confirmed PHP amounts reject exponent, radix, sub-cent and coercion without rounding',()=>{
  for(const value of ['1e3','0x10','0b10','0.001','1.234','1.005','-2','+2','NaN',
    'Infinity','1,000','₱10','01.20','100000000.01','100000001',''])assert.equal(parsePhpMoney(value),null,String(value));
  assert.equal(parsePhpMoney('0.01'),0.01);
  assert.equal(parsePhpMoney('3772.50'),3772.5);
  assert.equal(parsePhpMoney('100000000.00'),100000000);
  assert.equal(parsePhpMoney(12.5),12.5);
});

test('physical quantity must have at most four fractional digits and a valid decimal form',()=>{
  for(const value of ['1e3','0x10','2.00001','1.0000000000000001','-1','+1','01',
    '1000000.0001','1000001',''])assert.equal(parseStockQuantity(value),null,String(value));
  assert.equal(parseStockQuantity('0.0001'),0.0001);
  assert.equal(parseStockQuantity('1.2500'),1.25);
  assert.equal(parseStockQuantity('1000000'),1000000);
});

test('malformed CSV numbers stay unverified; invalid paid totals and duplicate headers fail closed',()=>{
  const h='item,proposed_quantity,proposed_unit,screenshot_line_php,recomputed_line_php,actual_total_paid_php';
  const row=parseStockIntakeCsv(h+'\nRice,1e3,kg,0x10,15,3772.50')[0];
  assert.equal(row.quantity,null);assert.equal(row.total,null);assert.equal(row.requiresReview,true);
  assert.equal(validStockIntakeRow(row),false);
  const unknown=parseStockIntakeCsv(h+'\nRice,2,kg,100,1.001,3772.50')[0];
  assert.equal(unknown.requiresReview,true);
  for(const paid of ['3772.501','1e3','0x10','NaN','Infinity','100000000.01']){
    assert.throws(()=>parseStockIntakeCsv(h+'\nRice,2,kg,100,100,'+paid),/Invalid confirmed paid total/);
  }
  assert.throws(()=>parseStockIntakeCsv('item,proposed_quantity,proposed_unit,screenshot_line_php,ITEM\nRice,2,kg,100,Beans'),/Duplicate CSV column name/);
});

test('paid date cannot normalize invalid calendar days or future PH dates',()=>{
  assert.equal(validPhilippinePurchaseDate('2026-10-31','2026-10-31'),true);
  assert.equal(validPhilippinePurchaseDate('2024-02-29','2026-10-31'),true);
  for(const date of ['2026-02-29','2026-02-31','2026-04-31','2026-13-01',
    '2026-11-01','2026-1-1','2026-00-01','not-a-date']){
    assert.equal(validPhilippinePurchaseDate(date,'2026-10-31'),false,date);
  }
});

test('posting controls validate raw human-paid amount and date before any mutation',()=>{
  assert.match(js,/const parsedPaid=parsePhpMoney\(paidText\)/);
  assert.match(js,/validPhilippinePurchaseDate\(date,localDatePH\(\)\)/);
  assert.match(js,/row\.total=value===''\?null:parsePhpMoney\(value\)/);
  assert.match(js,/row\.quantity=value===''\?null:parseStockQuantity\(value\)/);
});
