import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {
  parseCsvRecords,parseStockIntakeCsv,validStockIntakeRow,findExistingInventory,
  parsePhpMoney,parseStockQuantity,validPhilippinePurchaseDate,
  reviseStockIntakeRow,guardNewPaidStockIntakeRow,guardNewPaidStockIntakeBatch,csvReadIsCurrent,preserveIntakeReviewForMerchant,
  revokePaidBatchConfirmations,clearPreviousCsvReview,revokeMerchantIntakeSession,intakeOperationIsCurrent,
  STOCK_INTAKE_CLASSIFICATIONS,stockIntakeClassification,decodeReviewedStockCsvBytes,
  canonicalStockIntakeIdentityId,stockIntakeOriginHeaders,stockIntakePurchaseIntentKey,stockIntakeBaseQuantityExact,stockIntakeScopedRows,verifyPaidStockIntakeReceipt,verifyPaidStockIntakeExpenseDatePatch,postWriteMerchantAuthorityIsCurrent
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

test('CSV size cap is enforced in UTF-8 bytes for Philippine Unicode text',()=>{
  const within='ñ'.repeat(125000); // exactly 250,000 UTF-8 bytes
  assert.equal(new TextEncoder().encode(within).byteLength,250000);
  const rows=parseCsvRecords(within);
  assert.equal(rows.length,1);
  assert.equal(rows[0][0].length,125000);
  const over='ñ'.repeat(125001);
  assert.equal(over.length,125001,'UTF-16 code units would incorrectly pass the old limit');
  assert.throws(()=>parseCsvRecords(over),/250 KB review limit/);
  assert.throws(()=>parseCsvRecords('a'.repeat(250001)),/250 KB review limit/);
});

test('actual CSV bytes fail closed for malformed UTF-8 before paid stock review',()=>{
  const good=['item,proposed_quantity,proposed_unit,screenshot_line_php','Kamote ñ,2,kg,120'].join(String.fromCharCode(10));
  const encoded=new TextEncoder().encode(good);
  assert.equal(decodeReviewedStockCsvBytes(encoded),good);
  assert.equal(parseStockIntakeCsv(decodeReviewedStockCsvBytes(encoded))[0].item,'Kamote ñ');
  assert.equal(decodeReviewedStockCsvBytes(encoded.buffer),good);
  const invalid=Uint8Array.of(82,105,99,101,44,0xc3,0x28);
  assert.ok(new TextDecoder().decode(invalid).includes(String.fromCodePoint(0xfffd)),
    'default browser-style decoding silently substitutes a replacement character');
  assert.throws(()=>decodeReviewedStockCsvBytes(invalid),/invalid UTF-8 bytes/);
  assert.throws(()=>decodeReviewedStockCsvBytes(Uint8Array.of(0xed,0xa0,0x80)),/invalid UTF-8 bytes/,
    'malformed surrogate encoding must not become an item name');
  assert.throws(()=>decodeReviewedStockCsvBytes(new Uint8Array(250001)),/250 KB review limit/);
  assert.throws(()=>decodeReviewedStockCsvBytes('not file bytes'),/file bytes are unavailable/);
  assert.ok(js.includes('decodeReviewedStockCsvBytes(await file.arrayBuffer())'));
  assert.ok(!js.includes('await file.text()'));
});

test('genuine source-note mismatches and missing physical quantities are held for review',()=>{
  const rows=parseStockIntakeCsv(example);
  assert.equal(rows.length,4);
  assert.equal(rows[0].item,'Fish balls');
  assert.equal(rows[0].classificationCode,'');
  assert.equal(validStockIntakeRow(rows[0]),false,'unverified category is never implicitly ingredient');
  assert.equal(reviseStockIntakeRow(rows[0],'classificationCode','food_ingredient'),true);
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
  for(const row of rows)reviseStockIntakeRow(row,'classificationCode','food_ingredient');
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

test('Inventory/Money reads must prove original Merchant business before review and preflight',()=>{
  const origin={accountId:11,businessId:123,businessName:'Verified PH Merchant'};
  const verified=[
    {id:1,business_id:123,item:'Rice'},
    {id:2,business_id:'123',item:'Beans'}
  ];
  assert.equal(stockIntakeScopedRows(verified,origin,'Inventory'),verified);
  assert.deepEqual(stockIntakeScopedRows([],origin,'Money'),[]);
  // Regression: Number([123]), Number(' 123 '), Number('1.23e2') and
  // Number({valueOf(){return 123}}) previously forged the same business.
  for(const business_id of [
    [123],{valueOf:()=>123},' 123 ','1.23e2','123.0','00123',
    '+123','0x7b',123.0001,null,undefined,true,false
  ]){
    assert.throws(()=>stockIntakeScopedRows([{id:1,business_id}],origin,'Inventory'),
      /not tied to the verified Merchant business/);
  }
  // Boolean true also matched business 1 under the old coercion.
  assert.throws(()=>stockIntakeScopedRows([{id:1,business_id:true}],
    {accountId:11,businessId:1},'Money'),/not tied to the verified Merchant business/);
  assert.throws(()=>stockIntakeScopedRows([{id:1,business_id:Number.MAX_SAFE_INTEGER+1}],
    origin,'Inventory'),/not tied to the verified Merchant business/);
  for(const records of [
    null,undefined,{},[{id:1,item:'Missing business'}],
    [{id:1,business_id:456,item:'Different business'}],
    [{id:1,business_id:'not-a-business'}], [null]
  ])assert.throws(()=>stockIntakeScopedRows(records,origin,'Money'),
    /not tied to the verified Merchant business/);
  assert.throws(()=>stockIntakeScopedRows([{business_id:123}],{businessId:NaN},'Inventory'),
    /not tied to the verified Merchant business/);
  // Require a pinned read to prevent A→B→A preference swaps from making
  // an empty B Inventory list look like an empty A list.
  assert.match(js,/api\('\/api\/inventory',\{headers:stockIntakeOriginHeaders\(next\)\}\)/);
  assert.match(js,/api\('\/api\/inventory',\{headers:stockIntakeOriginHeaders\(before\)\}\)/);
  assert.match(js,/stockIntakeScopedRows\(inventory,verify,'Inventory'\)/);
  assert.match(js,/stockIntakeScopedRows\(transactions,verify,'Money'\)/);
  assert.match(js,/stockIntakeScopedRows\(inventory,after,'Inventory'\)/);
  assert.equal(stockIntakeOriginHeaders(origin)['x-abl-inventory-origin-business'],'123');
});

test('a saved purchase must prove exact Merchant, stock identity, paid expense and links',()=>{
  const merchant={accountId:11,businessId:123,businessName:'Verified PH Merchant'};
  const row={item:'Fresh rice',quantity:2,unit:'kg',total:120};
  const good={
    inventory:{id:201,business_id:123,item:'Fresh rice'},
    purchase:{id:301,business_id:123,inventory_id:201,purchase_quantity:'2.0000',
      purchase_unit:'kg',base_quantity:'2000.000',base_unit:'g',total_cost:'120.00',account:'cash'},
    transaction:{id:401,business_id:123,source:'inventory_purchase',source_id:301,
      type:'business_expense',amount:'120.00',payment_method:'cash',account:'cash'},
    lot:{id:501,business_id:123,inventory_id:201,base_unit:'g',quantity_received_base:'2000.000'}
  };
  assert.equal(verifyPaidStockIntakeReceipt(good,merchant,row,'cash'),good);
  assert.ok(verifyPaidStockIntakeReceipt({...good,lot:null},merchant,row,'cash'),
    'lot absence is allowed where optional lot tables are not enabled');
  const mutations=[
    x=>{x.inventory.business_id=999},
    x=>{x.purchase.business_id=999},
    x=>{x.transaction.business_id=999},
    x=>{x.lot.business_id=999},
    x=>{delete x.purchase.business_id},
    x=>{x.purchase.inventory_id=202},
    x=>{x.lot.inventory_id=202},
    x=>{x.transaction.source_id=302},
    x=>{x.transaction.source='other'},
    x=>{x.transaction.type='sale'},
    x=>{x.transaction.account='bank'},
    x=>{x.transaction.payment_method='gcash'},
    x=>{x.purchase.account='bank'},
    x=>{x.inventory.item='Other Merchant beans'},
    x=>{x.purchase.purchase_quantity='3.0000'},
    x=>{x.purchase.purchase_unit='g'},
    x=>{x.purchase.base_quantity='1999.999'},
    x=>{x.purchase.base_quantity='2e3'},
    x=>{x.purchase.base_unit='ml'},
    x=>{x.lot.quantity_received_base='1999.999'},
    x=>{x.lot.quantity_received_base='2000.0001'},
    x=>{x.lot.base_unit='unit'},
    x=>{x.purchase.total_cost='119.99'},
    x=>{x.transaction.amount='119.99'},
    x=>{x.transaction.amount='120.001'},
    x=>{x.purchase.id='0'},
    x=>{x.transaction.id='1e2'},
    x=>{x.lot.id=null}
  ];
  for(const mutate of mutations){
    const altered=structuredClone(good);
    mutate(altered);
    assert.throws(()=>verifyPaidStockIntakeReceipt(altered,merchant,row,'cash'),
      /Saved purchase evidence did not match/,String(mutate));
  }
  assert.throws(()=>verifyPaidStockIntakeReceipt(good,{...merchant,businessId:999},row,'cash'),
    /Saved purchase evidence did not match/);
  assert.throws(()=>verifyPaidStockIntakeReceipt(good,merchant,{...row,total:119.99},'cash'),
    /Saved purchase evidence did not match/);
  assert.ok(js.includes('verifyPaidStockIntakeReceipt(result,originalContext,row,paidFrom)'),
    'the actual purchase HTTP completion must validate durable Stock/Money evidence before SAVED');
  const check=js.indexOf('verifyPaidStockIntakeReceipt(result,originalContext,row,paidFrom)');
  const saved=js.indexOf("row.result='saved-date-pending'",check);
  assert.ok(check>0&&saved>check,'never mark a paid batch saved before validating the returned ledger');
});


test('paid Stock receipt proves exactly converted quantity in purchase and lot',()=>{
  const merchant={accountId:11,businessId:123,businessName:'Synthetic PH Merchant'};
  for(const [quantity,unit,base,baseUnit] of [
    ['2','kg','2000.000','g'],['0.0001','kg','0.100000','g'],
    ['1.5','L','1500.000','ml'],['0.001','g','0.001','g'],
    ['2.5','unit','2.500','unit']
  ]){
    const row={item:'Sample',quantity,unit,total:120};
    const good={
      inventory:{id:201,business_id:123,item:'Sample'},
      purchase:{id:301,business_id:123,inventory_id:201,purchase_quantity:quantity,
        purchase_unit:unit,base_quantity:base,base_unit:baseUnit,total_cost:'120.00',account:'cash'},
      transaction:{id:401,business_id:123,source:'inventory_purchase',source_id:301,
        type:'business_expense',amount:'120.00',payment_method:'cash',account:'cash'},
      lot:{id:501,business_id:123,inventory_id:201,base_unit:baseUnit,quantity_received_base:base}
    };
    assert.equal(verifyPaidStockIntakeReceipt(good,merchant,row,'cash'),good);
    for(const mutate of [
      r=>{r.purchase.base_quantity='0.002'},
      r=>{r.lot.quantity_received_base='0.002'},
      r=>{r.purchase.base_unit='wrong'},
      r=>{r.lot.base_unit='wrong'}
    ]){
      const mismatch=structuredClone(good);mutate(mismatch);
      assert.throws(()=>verifyPaidStockIntakeReceipt(mismatch,merchant,row,'cash'),
        /Saved purchase evidence did not match/,quantity+' '+unit);
    }
  }
  assert.match(js,/stockIntakeReceivedBaseMilli\(purchase\.base_quantity\)/);
  assert.match(js,/stockIntakeReceivedBaseMilli\(lot\.quantity_received_base\)/);
});

test('historical paid expense date requires exact PHP-noon TIMESTAMPTZ and unchanged linked money evidence',()=>{
  const context={accountId:11,businessId:123,businessName:'Verified PH Merchant'};
  const original={id:401,business_id:123,source:'inventory_purchase',source_id:301,
    type:'business_expense',account:'cash',payment_method:'cash',amount:'120.00',
    occurred_at:'2026-11-07T01:02:03.000Z'};
  const updated={...original,occurred_at:'2026-11-01T04:00:00.000Z'};
  assert.equal(verifyPaidStockIntakeExpenseDatePatch(updated,original,context,'2026-11-01'),updated);
  assert.equal(verifyPaidStockIntakeExpenseDatePatch(
    {...updated,occurred_at:'2026-11-01T12:00:00+08:00'},original,context,'2026-11-01').id,401);
  const mutations=[
    tx=>{tx.id=402},tx=>{tx.business_id=999},tx=>{tx.source_id=302},
    tx=>{tx.source='manual'},tx=>{tx.type='order_payment'},tx=>{tx.account='bank'},
    tx=>{tx.payment_method='gcash'},tx=>{tx.amount='119.99'},
    tx=>{tx.occurred_at=original.occurred_at},
    tx=>{tx.occurred_at='2026-11-01T04:00:01.000Z'},
    tx=>{tx.occurred_at='2026-11-01T04:00:00'}, // timezone ambiguity
    tx=>{delete tx.occurred_at}
  ];
  for(const mutate of mutations){
    const altered={...updated};mutate(altered);
    assert.throws(()=>verifyPaidStockIntakeExpenseDatePatch(altered,original,context,'2026-11-01'),
      /could not be verified/,String(mutate));
  }
  for(const invalid of [null,{id:401},[],{...updated,amount:'120.001'}]){
    assert.throws(()=>verifyPaidStockIntakeExpenseDatePatch(invalid,original,context,'2026-11-01'),
      /could not be verified/);
  }
  assert.throws(()=>verifyPaidStockIntakeExpenseDatePatch(updated,original,{...context,businessId:999},'2026-11-01'),
    /could not be verified/);
  assert.throws(()=>verifyPaidStockIntakeExpenseDatePatch(updated,original,context,'2026-11-02'),
    /could not be verified/);
  assert.ok(js.includes('verifyPaidStockIntakeExpenseDatePatch(dated,result.transaction,originalContext,originalDate)'),
    'actual PATCH completion must verify original purchase, Merchant, amount and exact PH date');
  const pending=js.indexOf("row.result='saved-date-pending'"),
        checked=js.indexOf('verifyPaidStockIntakeExpenseDatePatch(dated,result.transaction,originalContext,originalDate)'),
        saved=js.indexOf("row.result='saved';",checked);
  assert.ok(pending>0&&checked>pending&&saved>checked,
    'stock is already durably saved before PATCH verification and only marked fully dated afterward');
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
  assert.ok(js.includes('verifyPaidStockIntakeReceipt(result,originalContext,row,paidFrom)'));
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
  assert.match(js,/reviseStockIntakeRow\(row,'total',value\)/);
  assert.match(js,/reviseStockIntakeRow\(row,'quantity',value\)/);
});

test('editing an approved quantity, cost, or unit revokes review and batch selection',()=>{
  const row=parseStockIntakeCsv(example)[0];
  row.reviewConfirmed=true;row.selected=true;
  assert.equal(reviseStockIntakeRow(row,'quantity','4.0000'),true);
  assert.equal(row.quantity,4);
  assert.equal(row.reviewConfirmed,false);
  assert.equal(row.selected,false);
  assert.equal(row.requiresReview,true);
  assert.equal(validStockIntakeRow(row),false);
  row.reviewConfirmed=true;row.selected=true;
  assert.equal(reviseStockIntakeRow(row,'quantity','4'),false);
  assert.equal(row.reviewConfirmed,true,'identical quantity does not revoke a valid approval');
  assert.equal(reviseStockIntakeRow(row,'total','346.00'),true);
  assert.equal(row.reviewConfirmed,false);
  assert.equal(row.selected,false);
  row.reviewConfirmed=true;row.selected=true;
  assert.equal(reviseStockIntakeRow(row,'unit','g'),true);
  assert.equal(row.unit,'g');
  assert.equal(row.reviewConfirmed,false);
  assert.equal(row.selected,false);
  row.reviewConfirmed=true;row.selected=true;
  assert.equal(reviseStockIntakeRow(row,'total','1e3'),true);
  assert.equal(row.total,null);
  assert.equal(validStockIntakeRow(row),false);
  row.result='saved';
  assert.equal(reviseStockIntakeRow(row,'quantity','7'),false,'posted rows cannot be edited');
});

test('a newly discovered duplicate aborts paid intake instead of silently posting other rows',()=>{
  const row=parseStockIntakeCsv(example)[0];
  row.reviewConfirmed=true;row.selected=true;
  assert.equal(guardNewPaidStockIntakeRow(row,[]),true);
  assert.equal(row.selected,true);
  assert.throws(()=>guardNewPaidStockIntakeRow(row,[{id:123,item:' FISH   BALLS ',quantity:5}]),
    error=>error.paidBatchConflict===true&&/reconcile the entire Stock and Money batch/.test(error.message));
  assert.equal(row.exists.id,123);
  assert.equal(row.selected,false);
  assert.equal(validStockIntakeRow(row),false);
  assert.match(js,/guardNewPaidStockIntakeRow\(row,state\.inventory\)/);
  assert.match(js,/error\?\.paidBatchConflict/);
  assert.doesNotMatch(js,/if\(existing\).*continue/);
});

test('malformed quote boundaries cannot silently rewrite paid CSV line amounts',()=>{
  const header='item,proposed_quantity,proposed_unit,screenshot_line_php';
  for(const line of [
    'Rice,2,kg,1"2"0',
    'Rice,2,kg,"120"garbage',
    'Rice,2,kg,"120',
    'Rice,2,kg,120"'
  ])assert.throws(()=>parseStockIntakeCsv(header+'\n'+line),/CSV quote|quoted CSV|Unexpected content/i,line);
  assert.deepEqual(parseCsvRecords('item,note\r\n"Fish, frozen","The receipt says ""paid""\nsecond line"\r\n'),
    [['item','note'],['Fish, frozen','The receipt says "paid"\nsecond line']]);
});

test('stale asynchronous CSV reads cannot replace a posted or newer reviewed batch',()=>{
  assert.equal(csvReadIsCurrent(4,4,false),true);
  assert.equal(csvReadIsCurrent(3,4,false),false,'a newer file selection wins');
  assert.equal(csvReadIsCurrent(4,4,true),false,'a running stock/expense write blocks file replacement');
  assert.equal(csvReadIsCurrent(4,5,false),false,'a past read stays cancelled after posting');
  assert.match(js,/const ticket=\+\+state\.csvReadRevision;/);
  assert.match(js,/const csvText=decodeReviewedStockCsvBytes\(await file\.arrayBuffer\(\)\);\s*if\(!csvReadIsCurrent\(ticket,state\.csvReadRevision,state\.busy\)\)return;/);
  assert.match(js,/state\.csvReadRevision\+\+;\s*state\.busy=true/);
  assert.match(js,/\$\('csv'\)\.disabled=state\.busy/);
  assert.match(js,/\$\('actualTotalPaid'\)\.disabled=state\.busy/);
});

test('re-verified Merchant identity revokes a different account or business CSV approvals and private results',()=>{
  const source={accountId:11,businessId:100,businessName:'Trizian'};
  for(const target of [
    {accountId:12,businessId:100,businessName:'Trizian'},
    {accountId:11,businessId:200,businessName:'Trizian'},
    {accountId:11,businessId:100,businessName:'Trizian New'},null
  ]){
    const row=parseStockIntakeCsv(example)[0];row.selected=true;row.reviewConfirmed=true;
    const session={rows:[row],resultLog:['Old Merchant private expense #123']};
    assert.equal(preserveIntakeReviewForMerchant(session,source,target),false);
    assert.deepEqual(session.rows,[]);
    assert.deepEqual(session.resultLog,[]);
  }
  const same={rows:[{reviewConfirmed:true}],resultLog:['Current Merchant']};
  assert.equal(preserveIntakeReviewForMerchant(same,source,{...source}),true);
  assert.deepEqual(same.rows,[{reviewConfirmed:true}]);
  assert.deepEqual(same.resultLog,['Current Merchant']);
  const invalid={rows:[{selected:true}],resultLog:['private']};
  assert.equal(preserveIntakeReviewForMerchant(invalid,{...source,accountId:NaN},source),false);
  assert.deepEqual(invalid,{rows:[],resultLog:[]});
});

test('older Merchant refresh and pending file reads cannot resurrect prior login evidence',()=>{
  assert.ok(js.includes('const revision=++state.contextReadRevision;'));
  assert.ok(js.includes('++state.csvReadRevision;'));
  assert.ok(js.includes('if(revision!==state.contextReadRevision)return;'));
  assert.ok(js.includes('preserveIntakeReviewForMerchant(state,previous,verify)'));
  assert.ok(js.includes('preserveIntakeReviewForMerchant(state,previous,null)'));
  assert.ok(js.includes('state.context=null;state.inventory=[];state.transactions=[];state.accountId=null;'));
  assert.ok(js.includes("$('rows').replaceChildren();"));
  assert.ok(js.includes("$('businessName').value='';"));
  assert.ok(js.includes("$('moneyConfirm').checked=false;"));
});

test('paid-batch selection and reviewed-row edits revoke BOTH physical and Money approvals even at the same total',()=>{
  const first=parseStockIntakeCsv('item,proposed_quantity,proposed_unit,screenshot_line_php\nRice,2,kg,120')[0];
  const replacement=parseStockIntakeCsv('item,proposed_quantity,proposed_unit,screenshot_line_php\nBeans,2,kg,120')[0];
  first.selected=true;
  const physical={checked:true},money={checked:true};
  assert.equal(first.total,replacement.total,'equal-PHP substitutions could otherwise retain reconciliation');
  first.selected=false;replacement.selected=true;
  revokePaidBatchConfirmations(physical,money);
  assert.equal(physical.checked,false,'new physical counts require new explicit approval');
  assert.equal(money.checked,false,'equal-PHP substitutes require fresh duplicate-expense approval');
  physical.checked=true;money.checked=true;
  reviseStockIntakeRow(replacement,'quantity','3');
  revokePaidBatchConfirmations(physical,money);
  assert.equal(physical.checked,false);
  assert.equal(money.checked,false);
  // Actual page wiring: manual selection, mass-select, clear, review change,
  // material edits and Inventory membership changes must revoke both fields.
  assert.match(js,/row\.selected!==check\.checked\)\{row\.selected=check\.checked;revokeBatchConfirmations\(\)/);
  assert.match(js,/if\(changed\)revokeBatchConfirmations\(\);/);
  assert.match(js,/if\(membershipChanged\)revokeBatchConfirmations\(\);/);
  assert.match(js,/row\.reviewConfirmed=check\.checked;revokeBatchConfirmations\(\)/);
  for(const field of ['quantity','unit','total']){
    assert.ok(js.includes("if(reviseStockIntakeRow(row,'"+field+"',value))revokeBatchConfirmations()"));
  }
});

test('a duplicate in a later selected line stops the entire paid batch before the first POST',()=>{
  const rows=parseStockIntakeCsv([
    'item,proposed_quantity,proposed_unit,screenshot_line_php',
    'Rice,2,kg,120',
    'Fish balls,3,kg,345'
  ].join('\n'));
  rows.forEach(row=>{row.selected=true});
  assert.equal(guardNewPaidStockIntakeBatch(rows,[]),true);
  assert.throws(
    ()=>guardNewPaidStockIntakeBatch(rows,[{id:88,item:' FISH  BALLS ',quantity:1}]),
    error=>error.paidBatchConflict===true&&error.conflictRow===rows[1]
  );
  assert.equal(rows[0].selected,true,'earlier item has not been posted or silently deselected');
  assert.equal(rows[0].result,'pending');
  assert.equal(rows[1].selected,false,'conflicting later item needs fresh review');
  assert.equal(rows[1].exists.id,88);
  assert.ok(js.includes('guardNewPaidStockIntakeBatch(pending,state.inventory)'));
  assert.ok(
    js.indexOf('guardNewPaidStockIntakeBatch(pending,state.inventory)') <
    js.indexOf("const result=await api('/api/inventory/purchase'"),
    'whole-batch preflight precedes any item POST'
  );
  assert.match(js,/if\(!initialBatchChecked\)/);
  assert.match(js,/guardNewPaidStockIntakeRow\(row,state\.inventory\)/,
    'each subsequent item still gets a fresh live duplicate check');
});

test('errors before purchase dispatch are NOT POSTED, while interrupted POST remains uncertain',()=>{
  assert.match(js,/let purchaseDispatched=false;/);
  assert.match(js,/purchaseDispatched=true;\s*\/\/ Canonical atomic purchase/);
  assert.match(js,/else if\(!purchaseDispatched\)\{/);
  assert.match(js,/No purchase request was sent for this item/);
  assert.match(js,/else\{\s*row\.result='uncertain'/);
  assert.match(js,/const conflictRow=error\.conflictRow\|\|row;/);
  assert.match(js,/conflictRow\.result='error';/);
  assert.match(js,/revokeBatchConfirmations\(\);\s*\}else if\(row\.result==='saved-date-pending'\)/);
});

test('expired Merchant auth erases reviewed CSV, financial history and pending request context',()=>{
  const merchant={accountId:11,businessId:100,businessName:'Reviewed Merchant'};
  const row=parseStockIntakeCsv(example)[0];
  const state={context:merchant,accountId:11,rows:[row],resultLog:['old private expense'],
    inventory:[{id:3}],transactions:[{id:4}],contextReadRevision:8,csvReadRevision:10,stop:false};
  assert.equal(intakeOperationIsCurrent(state,8,'csrf-old','csrf-old'),true);
  state.stop=true; // Manual stop still permits recording the in-flight response.
  assert.equal(intakeOperationIsCurrent(state,8,'csrf-old','csrf-old'),true);
  assert.equal(intakeOperationIsCurrent(state,8,'csrf-old','csrf-new'),false);
  revokeMerchantIntakeSession(state);
  assert.equal(state.contextReadRevision,9);
  assert.equal(state.csvReadRevision,11);
  assert.equal(state.stop,true);
  assert.equal(state.context,null);
  assert.equal(state.accountId,null);
  assert.deepEqual(state.rows,[]);
  assert.deepEqual(state.resultLog,[]);
  assert.deepEqual(state.inventory,[]);
  assert.deepEqual(state.transactions,[]);
  assert.equal(intakeOperationIsCurrent(state,8,'csrf-old','csrf-old'),false);
  assert.equal(intakeOperationIsCurrent({...state,context:merchant},9,'',''),false);
});

test('auth-expired and pagehide dispatches block stale POST and date correction results',()=>{
  assert.ok(js.includes("document.addEventListener('abl:auth-expired',invalidatePrivateReview)"));
  assert.ok(js.includes("window.addEventListener('pagehide',invalidatePrivateReview)"));
  assert.ok(js.includes("window.addEventListener('pageshow',event=>"));
  assert.ok(js.includes("const operationRevision=state.contextReadRevision;"));
  assert.ok(js.includes("const csrfAtStart=window.ABLSession?.csrfToken?.()||'';"));
  assert.ok(js.includes('if(!requireCurrent())break;'));
  assert.ok(js.includes("if(!requireCurrent()){state.busy=false;updateControls();return;}"));
  assert.match(js,/await assertLiveContext\(\);\s*if\(!requireCurrent\(\)\|\|state\.stop\)break;/);
  assert.match(js,/await assertMerchantContext\(\);\s*if\(!requireCurrent\(\)\)break;/);
  assert.match(js,/\}catch\(error\)\{\s*if\(!requireCurrent\(\)\)break;/);
  assert.ok(js.includes("        })});\n        if(!requireCurrent())break;\n        if(!await postWriteMerchantAuthorityIsCurrent("));
  assert.match(js,/state\.busy=false;\s*if\(!requireCurrent\(\)\)\{updateControls\(\);return;\}/);
});

test('paid stock CSV needs explicit canonical physical category, never source guesses',()=>{
  const expected={
    food_ingredient:{inventory_domain:'food',stock_role:'ingredient',inventory_type:'ingredient'},
    food_resale:{inventory_domain:'food',stock_role:'direct_resale',inventory_type:'resale_item'},
    non_food_resale:{inventory_domain:'non_food',stock_role:'direct_resale',inventory_type:'resale_item'},
    production_material:{inventory_domain:'non_food',stock_role:'production_material',inventory_type:'production_material'},
    packaging:{inventory_domain:'operations',stock_role:'packaging',inventory_type:'packaging'},
    kitchen_consumable:{inventory_domain:'operations',stock_role:'operational_consumable',inventory_type:'kitchen_consumable'},
    cleaning_sanitation:{inventory_domain:'operations',stock_role:'operational_supply',inventory_type:'cleaning_sanitation'},
    operational_supply:{inventory_domain:'operations',stock_role:'operational_supply',inventory_type:'operational_supply'}
  };
  assert.deepEqual(Object.keys(STOCK_INTAKE_CLASSIFICATIONS),Object.keys(expected));
  for(const [code,fields] of Object.entries(expected)){
    assert.deepEqual(stockIntakeClassification(code),fields);
    const row=parseStockIntakeCsv('item,proposed_quantity,proposed_unit,screenshot_line_php\nItem,2,unit,100')[0];
    assert.equal(validStockIntakeRow(row),false);
    assert.equal(reviseStockIntakeRow(row,'classificationCode',code),true);
    assert.equal(row.classificationCode,code);
    assert.equal(validStockIntakeRow(row),true);
    assert.equal(reviseStockIntakeRow(row,'classificationCode',code),false);
  }
  for(const code of ['',null,'__proto__','constructor','unknown','food',' FOOD_INGREDIENT '])
    assert.equal(stockIntakeClassification(code),null,String(code));
  const misleadingCsv=parseStockIntakeCsv(
    'item,proposed_quantity,proposed_unit,screenshot_line_php,inventory_type\nDetergent,2,unit,180,ingredient'
  )[0];
  assert.equal(misleadingCsv.classificationCode,'','unverified CSV cannot authorize classification');
  assert.equal(validStockIntakeRow(misleadingCsv),false);
  assert.ok(js.includes('const classification=stockIntakeClassification(row.classificationCode);'));
  assert.ok(js.includes('item:row.item,...classification,'));
  assert.doesNotMatch(js,/item:row\.item,inventory_domain:'food',stock_role:'ingredient',inventory_type:'ingredient'/);
  assert.match(ui,/choose the correct verified Inventory category/i);
});

test('changing stock category revokes human review and both paid-batch approvals',()=>{
  const row=parseStockIntakeCsv('item,proposed_quantity,proposed_unit,screenshot_line_php\nSoap,2,unit,180')[0];
  assert.equal(reviseStockIntakeRow(row,'classificationCode','cleaning_sanitation'),true);
  assert.equal(row.requiresReview,false,'initial human choice does not need a duplicate row checkbox');
  row.selected=true;row.reviewConfirmed=true;
  assert.equal(reviseStockIntakeRow(row,'classificationCode','packaging'),true);
  assert.equal(row.classificationCode,'packaging');
  assert.equal(row.selected,false);
  assert.equal(row.reviewConfirmed,false);
  assert.equal(row.requiresReview,true);
  assert.equal(validStockIntakeRow(row),false);
  row.reviewConfirmed=true;
  assert.equal(validStockIntakeRow(row),true);
  row.selected=true;
  assert.equal(reviseStockIntakeRow(row,'classificationCode','not_a_class'),true);
  assert.equal(row.classificationCode,'');
  assert.equal(row.selected,false);
  assert.equal(validStockIntakeRow(row),false);
  assert.match(js,/if\(reviseStockIntakeRow\(row,'classificationCode',value\)\)revokeBatchConfirmations\(\)/);
  assert.match(js,/stockIntakeClassification\(row.classificationCode\)/);
});

test('a changed CSV selection immediately revokes OLD paid approvals before the new file is read',()=>{
  const state={
    rows:[{item:'Old paid Rice',selected:true,reviewConfirmed:true}],
    resultLog:['Previous Merchant expense and purchase IDs']
  };
  const physical={checked:true},money={checked:true},paid={value:'3772.50'};
  clearPreviousCsvReview(state,physical,money,paid);
  assert.deepEqual(state.rows,[],'previous physical lines are no longer selectable');
  assert.deepEqual(state.resultLog,[],'old paid-batch results cannot be reused as new evidence');
  assert.equal(physical.checked,false);
  assert.equal(money.checked,false);
  assert.equal(paid.value,'','previous paid total must not survive file selection');

  // Actual page wiring: cancellation and revocation happen synchronously
  // before empty-file, oversized-file and asynchronous read branches.
  const start=js.indexOf('  async function readFile(){');
  const end=js.indexOf('  async function assertMerchantContext(){',start);
  assert.ok(start>0&&end>start);
  const handler=js.slice(start,end);
  const revision=handler.indexOf('const ticket=++state.csvReadRevision;');
  const revoke=handler.indexOf('clearPreviousCsvReview(state,');
  const disable=handler.indexOf('renderRows(); // Disable Post synchronously');
  const empty=handler.indexOf('if(!file){');
  const tooLarge=handler.indexOf('if(file.size>250000)');
  const asyncRead=handler.indexOf('await file.arrayBuffer()');
  assert.ok(revision>=0&&revision<revoke,'old pending file read is invalidated first');
  assert.ok(revoke<disable&&disable<empty&&empty<tooLarge&&tooLarge<asyncRead,
    'old batch is no longer postable even when replacement is missing, oversized or still reading');
  assert.ok(js.includes("$('post').disabled=state.busy||!state.context"),'renderRows disables Post via current controls');
  assert.ok(handler.includes('if(!csvReadIsCurrent(ticket,state.csvReadRevision,state.busy))return;'),
    'stale new-file responses cannot restore a previous batch');
});

test('reviewed stock CSV binds purchase origin to immutable verified Merchant business, not later preference',()=>{
  const initial={accountId:91,businessId:101,businessName:'Synthetic Merchant A'};
  const headers=stockIntakeOriginHeaders(initial);
  assert.deepEqual(headers,{'x-abl-inventory-origin-business':'101'});
  assert.equal(Object.isFrozen(headers),true,'a later callback cannot retarget a dispatched origin');
  initial.businessId=202; // Later workspace preference changes: already captured A remains A.
  assert.equal(headers['x-abl-inventory-origin-business'],'101');
  assert.deepEqual(stockIntakeOriginHeaders(initial),{'x-abl-inventory-origin-business':'202'});
  for(const invalid of [null,undefined,{}, {accountId:91},{businessId:101},
    {accountId:91,businessId:0},{accountId:91,businessId:-1},
    {accountId:91,businessId:'101'},{accountId:'91',businessId:101},
    {accountId:91,businessId:1.5},{accountId:91,businessId:Number.MAX_SAFE_INTEGER+1},
    {accountId:0,businessId:101}]){
    assert.throws(()=>stockIntakeOriginHeaders(invalid),/Verified Merchant business origin unavailable/,
      'bad Merchant origin must fail closed before any POST: '+JSON.stringify(invalid));
  }
});

test('the shipped paid CSV purchase POST carries origin captured before asynchronous preflight',()=>{
  const start=js.indexOf('  async function saveSelected(){');
  const end=js.indexOf("  document.addEventListener('abl:auth-expired'",start);
  assert.ok(start>=0&&end>start,'actual Merchant receiving handler must exist');
  const handler=js.slice(start,end);
  const snapshot=handler.indexOf('const originalContext=state.context&&{...state.context};');
  const header=handler.indexOf('purchaseOriginHeaders=stockIntakeOriginHeaders(originalContext)');
  const preflight=handler.indexOf('await assertLiveContext()');
  const dispatch=handler.indexOf("const result=await api('/api/inventory/purchase'");
  assert.ok(snapshot>=0&&header>snapshot&&preflight>header&&dispatch>preflight,
    'capture originating business before asynchronous account/business/Inventory rechecks');
  const purchase=handler.slice(dispatch,dispatch+480);
  assert.match(purchase,/method:'POST',headers:purchaseOriginHeaders,body:JSON\.stringify\(/);
  assert.match(handler,/if\(!sameContext\(originalContext,state\.context\)\)/);
  assert.doesNotMatch(purchase,/workspace\.active_business_id|state\.context\.businessId|req\.body\.business_id/,
    'never retarget purchase from mutable selection or CSV-provided data');
  assert.match(handler,/row\.result='uncertain'/,
    'an interrupted POST must remain unknown and must not be retried automatically');
});

test('reviewed CSV purchase keeps one stable literal key, different purchases stay distinct',()=>{
  const row={result:'pending',quantity:2,unit:'kg',total:120,classificationCode:'food_ingredient'};
  let calls=0;
  const first=stockIntakePurchaseIntentKey(row,()=>{calls++;return 'row_20261104_random_AAAA_12345'});
  assert.equal(stockIntakePurchaseIntentKey(row,()=>{throw Error('unexpected regeneration')}),first);
  assert.equal(calls,1);
  const next={...row,purchaseIntentKey:undefined};
  assert.notEqual(stockIntakePurchaseIntentKey(next,()=> 'row_20261104_random_BBBB_12345'),first);
});

test('editing approved physical quantity revokes the old receipt intent',()=>{
  const row={result:'pending',quantity:2,unit:'kg',total:120,classificationCode:'food_ingredient',reviewConfirmed:true,selected:true};
  stockIntakePurchaseIntentKey(row,()=> 'row_20261104_old_stable_12345');
  assert.equal(reviseStockIntakeRow(row,'quantity','3'),true);
  assert.equal(row.purchaseIntentKey,undefined);
  assert.equal(row.reviewConfirmed,false);
  assert.equal(row.selected,false);
  assert.equal(stockIntakePurchaseIntentKey(row,()=> 'row_20261104_new_stable_12345'),'row_20261104_new_stable_12345');
});

test('insecure, corrupted or uncertain purchase intents fail closed',()=>{
  for(const key of [undefined,null,'','tiny','a'.repeat(129),' whitespace_token_12345',32]){
    const row={result:'pending'};
    assert.throws(()=>stockIntakePurchaseIntentKey(row,()=>key),/Secure purchase intent key unavailable/);
    assert.equal(row.purchaseIntentKey,undefined);
  }
  assert.throws(()=>stockIntakePurchaseIntentKey({result:'pending',purchaseIntentKey:'short'},()=> 'valid_stable_key_12345'),
    /Existing stock purchase intent key is invalid/);
  assert.throws(()=>stockIntakePurchaseIntentKey({result:'uncertain'},()=> 'valid_stable_key_12345'),
    /reviewed pending stock purchase/);
});

test('actual CSV purchase includes reviewed origin and secure per-row intent but no retry',()=>{
  const start=js.indexOf('  async function saveSelected(){');
  const end=js.indexOf("  document.addEventListener('abl:auth-expired'",start);
  const handler=js.slice(start,end);
  const origin=handler.indexOf('purchaseOriginHeaders=stockIntakeOriginHeaders(originalContext)');
  const preflight=handler.indexOf('guardNewPaidStockIntakeRow(row,state.inventory)');
  const key=handler.indexOf('const intentKey=stockIntakePurchaseIntentKey(row)');
  const dispatch=handler.indexOf("const result=await api('/api/inventory/purchase'");
  assert.ok(origin>=0&&preflight>origin&&key>preflight&&dispatch>key);
  assert.match(handler,/method:'POST',headers:purchaseOriginHeaders,body:JSON\.stringify\(\{\s*purchase_intent_key:intentKey,/);
  assert.doesNotMatch(handler,/x-abl-inventory-purchase-intent-key/);
  assert.match(handler,/row\.result='uncertain'/);
  assert.match(js,/delete row\.purchaseIntentKey/);
});

test('Stop while Stock preflight is pending keeps the approved item unposted',async()=>{
  const start=js.indexOf('  async function saveSelected(){');
  const end=js.indexOf("  document.addEventListener('abl:auth-expired'",start);
  const context={accountId:11,businessId:31,businessName:'Synthetic Merchant'};
  const [row]=parseStockIntakeCsv(example);
  row.classificationCode='food_ingredient';
  row.selected=true;
  const state={context,inventory:[],rows:[row],busy:false,stop:false,accountId:11,
    resultLog:[],csvReadRevision:0,contextReadRevision:0};
  const fields={post:{disabled:false},purchaseAccount:{value:'cash'},purchaseDate:{value:'2026-11-08'}};
  const sent=[];
  let finish;
  const preflight=new Promise(resolve=>{finish=resolve});
  const saveSelected=runInNewContext('('+js.slice(start,end)+')',{
    state,$:id=>fields[id],window:{ABLSession:{csrfToken:()=>'test-csrf'}},
    stockIntakeOriginHeaders,intakeOperationIsCurrent,validStockIntakeRow,
    guardNewPaidStockIntakeBatch,guardNewPaidStockIntakeRow,stockIntakeClassification,
    stockIntakePurchaseIntentKey:row=>stockIntakePurchaseIntentKey(row,()=> 'valid_stable_key_12345'),
    assertLiveContext:()=>preflight,sameContext:(a,b)=>a?.businessId===b?.businessId,
    api:async path=>{sent.push(path);throw Error('unexpected durable request')},
    updateControls(){},renderRows(){},message(){},CENTS:Number
  });
  const saving=saveSelected();
  assert.equal(state.busy,true,'approved item is still in the asynchronous preflight');
  state.stop=true;
  finish();
  await saving;
  assert.deepEqual(sent,[]);
  assert.equal(row.result,'pending');
  assert.equal(row.purchaseIntentKey,undefined);
  assert.equal(state.busy,false);
});

test('defensive paid stock row guard rejects sub-unit mutations and implicit object coercion',()=>{
  // An imported CSV starts from strict decimals; a later review-object mutation
  // must never be allowed to silently round stock or Money at posting time.
  const row=parseStockIntakeCsv(example)[0];
  row.classificationCode='food_ingredient';
  row.reviewConfirmed=true;
  assert.equal(validStockIntakeRow(row),true,'existing reviewed physical stock remains valid');
  assert.equal(validStockIntakeRow({...row,quantity:3.0000000001}),false,
    'sub-4dp quantities previously passed the epsilon validation');
  assert.equal(validStockIntakeRow({...row,total:345.000000001}),false,
    'sub-cent money amounts previously passed the epsilon validation');
  for(const value of [[12.5],{toString:()=> '12.50'},true,false,new Number(12.5),null]){
    assert.equal(parsePhpMoney(value),null,'non-scalar paid totals cannot be coerced');
    assert.equal(parseStockQuantity(value),null,'non-scalar physical quantities cannot be coerced');
  }
  assert.equal(parsePhpMoney('12.50'),12.5);
  assert.equal(parseStockQuantity('3.0000'),3);
  assert.equal(parsePhpMoney(12.5),12.5);
  assert.equal(parseStockQuantity(3),3);
});


test('paid CSV receiving refuses stock amounts PostgreSQL physical NUMERIC(12,3) would round',()=>{
  // Canonical stock is in base g/ml/unit, while purchased quantity/lot retains 4dp.
  for(const [quantity,unit,expected] of [
    ['0.0001','g',false],['0.0005','ml',false],['1.2345','unit',false],
    ['0.0001','kg',true],['0.0001','L',true],['0.001','g',true],
    ['1.234','ml',true],['1.2340','unit',true],['0.0009','unit',false],
    ['1.00001','kg',false],['1.0001','not-unit',false],
    ['999999.9999','kg',true],['999999.9999','L',true],
    ['1000000','kg',false],['1000000','L',false],['1000000','unit',true]
  ])assert.equal(stockIntakeBaseQuantityExact(quantity,unit),expected,quantity+' '+unit);

  const row=parseStockIntakeCsv('item,proposed_quantity,proposed_unit,screenshot_line_php\nRice,0.0001,g,120')[0];
  reviseStockIntakeRow(row,'classificationCode','food_ingredient');
  assert.equal(validStockIntakeRow(row),false,'positive 4dp gram quantity must not create a paid receipt with zero physical stock');
  reviseStockIntakeRow(row,'unit','kg');
  row.reviewConfirmed=true;
  assert.equal(validStockIntakeRow(row),true,'0.0001 kg converts to exactly 0.1 base g');
  reviseStockIntakeRow(row,'unit','unit');
  row.reviewConfirmed=true;
  assert.equal(validStockIntakeRow(row),false,'no silent rounding on count inventory');
  const tooLarge=parseStockIntakeCsv('item,proposed_quantity,proposed_unit,screenshot_line_php\nRice,1000000,kg,120')[0];
  tooLarge.classificationCode='food_ingredient';
  assert.equal(validStockIntakeRow(tooLarge),false,'one million kg exceeds the physical base NUMERIC(12,3) bound');
  tooLarge.quantity=999999.9999;
  assert.equal(validStockIntakeRow(tooLarge),true,'max valid 4dp kg quantity fits nine base-unit whole digits');
  assert.match(js,/stockIntakeBaseQuantityExact\(row\.quantity,row\.unit\)/);
  assert.match(js,/Physical stock supports at most 999,999,999\.999 base g\/ml\/unit/);
});

test('canonical session/workspace identity refuses numeric coercion before paid Stock receiving',()=>{
  for(const val of [11,'11',31,'31',Number.MAX_SAFE_INTEGER,String(Number.MAX_SAFE_INTEGER)])
    assert.equal(canonicalStockIntakeIdentityId(val),Number(val));
  for(const val of [null,undefined,0,-1,'0','031',' 31','31 ','3.1e1','31.0',
    [31],true,{},Infinity,31.5,'9007199254740993'])
    assert.equal(canonicalStockIntakeIdentityId(val),null,String(val));
});

test('actual Merchant snapshot rejects malformed origin IDs while preserving canonical PostgreSQL IDs',async()=>{
  const begin=js.indexOf('  async function snapshot(){');
  const end=js.indexOf('  function sameContext(',begin);
  assert.ok(begin>=0&&end>begin);
  const source=js.slice(begin,end).trim();
  const factory=new Function('api','window','canonicalStockIntakeIdentityId','return ('+source+');');
  const run=(accountId,businessId,activeId)=>{
    const called=[];
    const api=async path=>{
      called.push(path);
      if(path==='/api/me')return{account:{id:accountId,active_role:'merchant'},
        profiles:[{role:'merchant',enabled:true}]};
      if(path==='/api/accounting/workspaces')return{role:'merchant',
        businesses:[{id:businessId,name:'Synthetic Merchant',country_code:'PH'}],
        active_business_id:activeId};
      throw Error('unexpected Stock/Money read '+path);
    };
    return{snapshot:factory(api,{ABLSession:{authenticated:()=>true}},canonicalStockIntakeIdentityId),called};
  };
  for(const [a,b,c] of [['11','31','31'],[11,31,31]]){
    const {snapshot,called}=run(a,b,c);
    assert.deepEqual(await snapshot(),{accountId:11,businessId:31,businessName:'Synthetic Merchant'});
    assert.deepEqual(called,['/api/me','/api/accounting/workspaces']);
  }
  for(const malformed of ['031',' 31','3.1e1','31.0',[31],true,{},0,'9007199254740993']){
    for(const [a,b,c] of [[malformed,'31','31'],['11',malformed,'31'],['11','31',malformed]]){
      const {snapshot,called}=run(a,b,c);
      await assert.rejects(snapshot(),/identifier invalid|business changed/i);
      assert.ok(!called.some(path=>path==='/api/inventory'||path==='/api/transactions'));
    }
  }
  assert.match(source,/canonicalStockIntakeIdentityId\(me\?\.account\?\.id\)/);
  assert.match(source,/canonicalStockIntakeIdentityId\(business\?\.id\)/);
  assert.match(source,/canonicalStockIntakeIdentityId\(workspace\.active_business_id\)/);
});

test('paid-stock and dated expense acknowledgements require a fresh live Merchant binding',async()=>{
  const original={accountId:11,businessId:31,businessName:'Synthetic Merchant A'};
  const other={accountId:11,businessId:32,businessName:'Synthetic Merchant B'};
  let bound=original,authorized=true;
  const check=readLive=>postWriteMerchantAuthorityIsCurrent(
    original,readLive,()=>authorized,()=>bound
  );
  assert.equal(await check(async()=>({...original})),true);
  assert.equal(await check(async()=>other),false,
    'a silent Merchant A to B switch must revoke the previous paid receipt');
  bound=other;
  assert.equal(await check(async()=>original),false,
    'a stale A snapshot cannot override an already changed cached selection');
  bound=original;authorized=false;
  assert.equal(await check(async()=>original),false,'an expired/replaced session cannot display A');
  authorized=true;
  assert.equal(await check(async()=>{throw new Error('Session read failed')}),false,
    'unverifiable post-write outcome must not be advertised as SAVED');
  let finish;
  const delayed=new Promise(resolve=>{finish=resolve});
  const pending=check(()=>delayed);
  bound=other;finish(original);
  assert.equal(await pending,false,
    'a Merchant workspace switch during the post-write snapshot must revoke late ACK');
  bound=original;
  assert.equal(await postWriteMerchantAuthorityIsCurrent(
    original,()=>delayed,()=>authorized,()=>({accountId:11,businessId:'31',businessName:'Synthetic Merchant A'})
  ),false,'malformed current authority does not gain Merchant identity through coercion');
  assert.equal(await postWriteMerchantAuthorityIsCurrent(
    original,async()=>original,()=>authorized,()=>original
  ),true);
});

test('actual paid-stock controller checks live Merchant after every durable response before private evidence',()=>{
  const post=js.indexOf("const result=await api('/api/inventory/purchase'");
  const postAuth=js.indexOf('await postWriteMerchantAuthorityIsCurrent(',post);
  const receipt=js.indexOf('verifyPaidStockIntakeReceipt(result,originalContext,row,paidFrom)',post);
  const savedPending=js.indexOf("row.result='saved-date-pending'",post);
  assert.ok(post>=0&&postAuth>post&&receipt>postAuth&&savedPending>receipt,
    'fresh live identity must gate paid-stock ACK and private expense IDs before SAVED');
  const patch=js.indexOf("const dated=await api('/api/transactions/'",savedPending);
  const patchAuth=js.indexOf('await postWriteMerchantAuthorityIsCurrent(',patch);
  const checked=js.indexOf('verifyPaidStockIntakeExpenseDatePatch(dated,result.transaction,originalContext,originalDate)',patch);
  const saved=js.indexOf("row.result='saved';",patch);
  assert.ok(patch>savedPending&&patchAuth>patch&&checked>patchAuth&&saved>checked,
    'historical expense ACK must be reauthorized before reporting posted Money evidence');
  const paths=js.match(/if\(!await postWriteMerchantAuthorityIsCurrent\([\s\S]*?\)\)\{invalidatePrivateReview\(\);break;\}/g)||[];
  assert.equal(paths.length,2,'both post-write failures must purge old private Merchant data without retry');
});
