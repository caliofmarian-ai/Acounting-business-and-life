import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  receiptMoneyCents,normalizeReceiptExtraction,buildReceiptIntelligenceDraft,
  suggestReceiptInventoryMatches,validateReceiptReceivingReview,
  receiptExtractionFingerprint
} from '../receipt-intelligence-core.js';
import {receiptVisionConfig,extractReceiptImage,RECEIPT_JSON_SCHEMA,fromTextractExpense} from '../receipt-intelligence-provider.js';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const rows=[
  {id:10,business_id:5,item:'Cooking Oil',unit:'ml',base_unit:'ml',barcode:'4801234560001',internal_sku:'OIL-1L'},
  {id:11,business_id:5,item:'Chicken Breast',unit:'g',base_unit:'g'},
  {id:12,business_id:5,item:'Eggs',unit:'unit',base_unit:'unit'},
  {id:99,business_id:6,item:'Cooking Oil',unit:'ml',barcode:'4801234560001'}
];
const input=()=>({
  vendor_name:'Market',document_number:'123',issue_date:'2026-10-30',currency_code:'PHP',
  document_total:'285.00',subtotal:'285.00',lines:[
    {raw_text:'OIL 1L x2 ₱180',description:'Cooking Oil',barcode:'4801234560001',
      quantity:'2',unit:'pack',pack_quantity:'1',pack_unit:'L',line_total:'180.00',confidence:0.98},
    {raw_text:'CKN BRST 1kg 105',description:'Chicken Breast',quantity:'1',unit:'kg',
      line_total:'105.00',confidence:0.67}
  ]
});
test('financial amount parsing is exact in cents, rejects unsupported evidence',()=>{
  assert.equal(receiptMoneyCents('₱ 1,234.05'),123405);
  assert.equal(receiptMoneyCents('0.01'),1);
  for(const value of ['-1.00','12.345','abc','PHP 2$'])assert.equal(receiptMoneyCents(value),null);
});
test('receipt extraction is a suggestion; multipack base quantity is visible but unconfirmed',()=>{
  const result=normalizeReceiptExtraction(input());
  assert.equal(result.lines[0].suggested_base_quantity,2000);
  assert.equal(result.lines[0].suggested_base_unit,'ml');
  assert.equal(result.reconciliation.status,'balanced');
  assert.equal(result.stock_posted,false);
  assert.equal(result.payment_recorded,false);
  assert.equal(result.fiscal_validated,false);
  assert.ok(result.lines[1].flags.includes('LOW_CONFIDENCE'));
});
test('unknown tray quantity, unreadable totals and wrong dates require manual review',()=>{
  const result=normalizeReceiptExtraction({...input(),issue_date:'2026-02-30',document_total:'60',lines:[
    {raw_text:'EGGS 1 TRAY',description:'Eggs',quantity:'1',unit:'tray',line_total:null}
  ]});
  assert.equal(result.issue_date,null);
  assert.equal(result.lines[0].suggested_base_quantity,null);
  assert.equal(result.reconciliation.status,'incomplete');
  assert.ok(result.lines[0].flags.includes('UNIT_CONFIRMATION_REQUIRED'));
  assert.throws(()=>normalizeReceiptExtraction({...input(),lines:[]}),/1–80/);
  assert.throws(()=>normalizeReceiptExtraction({...input(),lines:Array(81).fill(input().lines[0])}),/1–80/);
});
test('wrong total is flagged, not silently adjusted',()=>{
  const r=normalizeReceiptExtraction({...input(),document_total:'300'});
  assert.equal(r.reconciliation.status,'mismatch');
  assert.equal(r.reconciliation.difference,15);
  assert.ok(r.warnings.includes('TOTAL_MISMATCH'));
});
test('match same-business barcode and names, never use another Merchant inventory row',()=>{
  const e=normalizeReceiptExtraction(input());
  const result=suggestReceiptInventoryMatches({extraction:e,businessId:5,inventoryRows:rows});
  assert.equal(result[0].suggested_inventory_id,10);
  assert.equal(result[0].match_type,'barcode_exact');
  assert.equal(result[1].suggested_inventory_id,11);
  assert.ok(result.every(x=>x.needs_user_selection===true));
  assert.ok(result.every(x=>x.candidates.every(y=>y.inventory_id!==99)));
});
test('review validation prohibits unknown business product, wrong measurement and unconfirmed cost',()=>{
  const draft=buildReceiptIntelligenceDraft({extraction:input(),businessId:5,inventoryRows:rows});
  const decide=(item=10,unit='L',cost='180')=>({decisions:[
    {line_index:0,action:'receive',inventory_id:item,received_quantity:2,received_unit:unit,confirmed_total_cost:cost},
    {line_index:1,action:'follow_up',reason:'Check physical count'}
  ]});
  const result=validateReceiptReceivingReview({draft,submission:decide(),businessId:5,inventoryRows:rows});
  assert.equal(result.actions[0].base_quantity,2000);
  assert.equal(result.stock_posted,false);
  assert.equal(result.manual_receiving_required,true);
  assert.throws(()=>validateReceiptReceivingReview({draft,submission:decide(99),businessId:5,inventoryRows:rows}),/does not belong/);
  assert.throws(()=>validateReceiptReceivingReview({draft,submission:decide(10,'kg'),businessId:5,inventoryRows:rows}),/Incompatible/);
  assert.throws(()=>validateReceiptReceivingReview({draft,submission:decide(10,'L',''),businessId:5,inventoryRows:rows}),/Line cost/);
  assert.throws(()=>validateReceiptReceivingReview({draft,submission:{decisions:[]},businessId:5,inventoryRows:rows}),/Every line/);
});
test('same photo fingerprint is stable, and source IDs cannot be forged as arbitrary strings',()=>{
  const one=receiptExtractionFingerprint({documentId:11,sha256:'a'.repeat(64)});
  assert.equal(one,receiptExtractionFingerprint({documentId:11,sha256:'a'.repeat(64)}));
  assert.notEqual(one,receiptExtractionFingerprint({documentId:12,sha256:'a'.repeat(64)}));
  assert.throws(()=>receiptExtractionFingerprint({documentId:11,sha256:'abc'}),/SHA256/);
});
test('external AI is disabled without deliberate configuration and per-document consent',async()=>{
  const env={RECEIPT_AI_ENABLED:'1',RECEIPT_AI_PROVIDER:'openai',RECEIPT_AI_MODEL:'test-image-model',RECEIPT_AI_API_KEY:'fake'};
  assert.equal(receiptVisionConfig({}).ready,false);
  await assert.rejects(()=>extractReceiptImage({bytes:Buffer.from('x'),mime:'image/jpeg',env}),/unavailable/);
  await assert.rejects(()=>extractReceiptImage({bytes:Buffer.from('x'),mime:'image/jpeg',env:{},consent:true}),/unavailable/);
  await assert.rejects(()=>extractReceiptImage({bytes:Buffer.from('x'),mime:'application/pdf',env,consent:true}),/unavailable/);
});
test('vision provider uses original image, strict JSON, zero persistence and no receipt instructions',async()=>{
  const env={RECEIPT_AI_ENABLED:'1',RECEIPT_AI_PROVIDER:'openai',RECEIPT_AI_MODEL:'test-image-model',RECEIPT_AI_API_KEY:'fake'};
  const raw=input();
  const result=await extractReceiptImage({bytes:Buffer.from([0xff,0xd8,0xff]),mime:'image/jpeg',env,consent:true,
    fetchImpl:async(url,options)=>{
      assert.equal(url,'https://api.openai.com/v1/responses');
      assert.equal(options.method,'POST');
      const body=JSON.parse(options.body);
      assert.equal(body.store,false);
      assert.equal(body.text.format.strict,true);
      assert.equal(body.input[1].content[1].detail,'original');
      assert.match(body.input[1].content[1].image_url,/^data:image\/jpeg;base64,/);
      return{ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({status:'completed',
        output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(raw)}]}]})};
    }
  });
  assert.equal(result.extraction.stock_posted,false);
  assert.equal(result.extraction.reconciliation.status,'balanced');
  assert.equal(RECEIPT_JSON_SCHEMA.additionalProperties,false);
});
test('Textract adapter does not invent units or dates',()=>{
  const parsed=fromTextractExpense({ExpenseDocuments:[{
    SummaryFields:[{Type:{Text:'VENDOR_NAME'},ValueDetection:{Text:'Market'}},{Type:{Text:'TOTAL'},ValueDetection:{Text:'50.00'}}],
    LineItemGroups:[{LineItems:[{LineItemExpenseFields:[
      {Type:{Text:'ITEM'},ValueDetection:{Text:'Rice',Confidence:95}},
      {Type:{Text:'QUANTITY'},ValueDetection:{Text:'1',Confidence:95}},
      {Type:{Text:'PRICE'},ValueDetection:{Text:'50.00',Confidence:95}}
    ]}]}]
  }]});
  assert.equal(parsed.lines[0].suggested_base_quantity,null);
  assert.equal(parsed.stock_posted,false);
});
test('route and UI preserve scope, verified originals, blind-count gate and NO inventory mutation',()=>{
  const routes=read('receipt-intelligence-routes.js');
  const server=read('server-suppliers.js');
  const ui=read('public/receipt-intelligence-ui.js');
  assert.match(routes,/exactProfileBusiness\(pool,who,'merchant',bid\)/);
  assert.match(routes,/merchant_purchase_documents WHERE id=\$1 AND business_id=\$2/);
  assert.match(routes,/readPrivateEvidence\(pool/);
  assert.match(routes,/allow_external_processing!==true/);
  assert.match(routes,/status='processing'/);
  assert.match(routes,/ON CONFLICT\(purchase_document_id,source_sha256\) DO NOTHING/);
  assert.match(routes,/receipt_intelligence_reviews/);
  assert.match(routes,/SELECT status FROM inventory_count_sessions WHERE id=\$1 AND business_id=\$2/);
  assert.match(routes,/Finish blind counting/);
  assert.doesNotMatch(routes,/UPDATE inventory SET|INSERT INTO inventory_purchases|INSERT INTO transactions/);
  assert.match(server,/registerReceiptIntelligenceRoutes/);
  assert.match(server,/ensureReceiptIntelligenceSchema/);
  assert.match(ui,/Read receipt → Prepare stock/);
  assert.match(ui,/stock unchanged|Stock unchanged/i);
  assert.doesNotMatch(ui,/fetch\(['"]\/api\/inventory\/purchase/);
});

test('unspecified currency cannot be mistaken for confirmed PHP and aliases stay local to one supplier',()=>{
  const x=normalizeReceiptExtraction({...input(),currency_code:null});
  assert.equal(x.currency_observed_on_document,false);
  assert.ok(x.warnings.includes('CURRENCY_NOT_VISIBLE_REVIEW'));
  const matches=suggestReceiptInventoryMatches({
    extraction:normalizeReceiptExtraction({...input(),lines:[{raw_text:'CKN BRST',description:'CKN BRST',line_total:'30'}],document_total:'30',subtotal:null}),
    businessId:5,inventoryRows:rows,
    confirmedAliases:[{business_id:5,inventory_id:11,alias:'CKN BRST'},{business_id:6,inventory_id:99,alias:'CKN BRST'}]
  });
  assert.equal(matches[0].match_type,'confirmed_alias');
  assert.equal(matches[0].suggested_inventory_id,11);
});
test('duplicate receipt checks, daily AI spend cap and same-business alias SQL are present',()=>{
  const routes=read('receipt-intelligence-routes.js');
  assert.match(routes,/possible_duplicates/);
  assert.match(routes,/same_original_file/);
  assert.match(routes,/other.business_id=\$1 AND other.id<>\$2/);
  assert.match(routes,/RECEIPT_AI_DAILY_LIMIT/);
  assert.match(routes,/provider='openai_vision' AND created_at>=NOW\(\)-INTERVAL '24 hours'/);
  assert.match(routes,/receipt_intelligence_aliases/);
  assert.match(routes,/i.id=\$4 AND i.business_id=\$1/);
  const ui=read('public/receipt-intelligence-ui.js');
  assert.match(ui,/Possible duplicate receipt/);
});
