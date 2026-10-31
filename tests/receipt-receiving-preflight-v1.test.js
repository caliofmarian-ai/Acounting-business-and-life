import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeReceiptExtraction,receiptReviewSubmissionFingerprint} from '../receipt-intelligence-core.js';
import {buildReceiptReceivingPreflight} from '../receipt-receiving-preflight.js';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const document={id:801,business_id:5,gross_amount:'200.00',issuer_name:'Demo Vendor',document_number:'INV-71'};
const inventory=[
  {id:10,business_id:5,item:'Cooking oil',unit:'ml',base_unit:'ml'},
  {id:99,business_id:6,item:'Other merchant oil',unit:'ml',base_unit:'ml'}
];
const extraction=()=>normalizeReceiptExtraction({
  currency_code:'PHP',issue_date:'2026-10-30',document_total:'200.00',subtotal:'200.00',
  lines:[
    {description:'Cooking oil 1L',raw_text:'OIL 1L 100',quantity:1,unit:'L',line_total:'100.00',confidence:.96},
    {description:'Cooking oil 500ml',raw_text:'OIL 500ML 50',quantity:500,unit:'ml',line_total:'50.00',confidence:.95},
    {description:'Cleaning cloth',raw_text:'CLOTH 50',quantity:1,unit:'unit',line_total:'50.00',confidence:.97}
  ]
});
const review=()=>({
  business_id:5,status:'reviewed_pending_physical_receiving',
  actions:[
    {line_index:0,action:'receive',inventory_id:10,received_quantity:1,received_unit:'L',base_quantity:1000,base_unit:'ml',line_total:100},
    {line_index:1,action:'receive',inventory_id:10,received_quantity:500,received_unit:'ml',base_quantity:500,base_unit:'ml',line_total:50},
    {line_index:2,action:'non_stock_expense',source_amount:50,source_text:'CLOTH 50'}
  ]
});
const run=(overrides={})=>buildReceiptReceivingPreflight({
  document,extraction:extraction(),review:review(),inventoryRows:inventory,...overrides
});

test('a multi-line receipt groups repeated purchases of one Inventory product without posting',()=>{
  const p=run();
  assert.equal(p.status,'ready_for_future_controlled_receiving');
  assert.equal(p.grouped_inventory_candidates.length,1);
  assert.equal(p.grouped_inventory_candidates[0].inventory_id,10);
  assert.equal(p.grouped_inventory_candidates[0].base_quantity,1500);
  assert.equal(p.grouped_inventory_candidates[0].base_unit,'ml');
  assert.equal(p.grouped_inventory_candidates[0].confirmed_line_cost,150);
  assert.equal(p.nonstock_and_excluded_line_value,50);
  assert.equal(p.receipt_total,200);
  assert.equal(p.can_post_stock,false);
  assert.equal(p.stock_posted,false);
  assert.equal(p.payment_recorded,false);
  assert.deepEqual(p.issues,[]);
});

test('existing linked stock purchase and duplicate source are blocking, even with balanced receipt',()=>{
  const p=run({linkedPurchaseIds:[40],duplicateDocumentIds:[70,71]});
  assert.equal(p.status,'needs_reconciliation');
  assert.ok(p.issues.includes('RECEIPT_ALREADY_LINKED_TO_STOCK_PURCHASE'));
  assert.ok(p.issues.includes('POSSIBLE_DUPLICATE_RECEIPT'));
  assert.equal(p.existing_purchase_links,1);
  assert.equal(p.possible_duplicate_documents,2);
});

test('printed total vs receipt vault amount conflict is not silently written off',()=>{
  const p=run({document:{...document,gross_amount:'250.00'}});
  assert.ok(p.issues.includes('UPLOADED_DOCUMENT_TOTAL_CONFLICT'));
  assert.equal(p.can_post_stock,false);
});

test('unresolved receipt line prohibits a future ready state',()=>{
  const r=review();
  r.actions[2]={line_index:2,action:'follow_up',source_amount:50};
  const p=run({review:r});
  assert.equal(p.unresolved_lines,1);
  assert.ok(p.issues.includes('UNRESOLVED_LINE'));
  assert.ok(p.issues.includes('REVIEWED_LINE_AMOUNTS_CHANGED'));
});

test('Inventory cross-business IDs and stale reviewed base quantities are refused',()=>{
  const foreign=review();foreign.actions[0].inventory_id=99;
  assert.throws(()=>run({review:foreign}),/outside this Merchant business/);
  const stale=review();stale.actions[0].base_quantity=2000;
  assert.throws(()=>run({review:stale}),/changed after confirmation/);
  assert.throws(()=>run({review:{...review(),business_id:6}}),/exact receipt business/);
});

test('reconciled receiving warns when ancillary costs need explicit allocation',()=>{
  const e=extraction();
  e.tax_amount=5;
  e.document_total=205;
  e.reconciliation.status='balanced';
  const p=run({extraction:e,document:{...document,gross_amount:'205.00'}});
  assert.ok(p.warnings.includes('CHARGES_AND_DISCOUNTS_NEED_EXPLICIT_COST_ALLOCATION'));
  assert.equal(p.unallocated_charges_or_discounts,5);
  assert.equal(p.can_post_stock,false);
});

test('changed review payload using the same client key has different SHA256 fingerprint',()=>{
  const a={draftId:17,expectedVersion:1,decisions:[{line_index:0,action:'receive',received_quantity:2}]};
  const one=receiptReviewSubmissionFingerprint(a);
  assert.equal(one,receiptReviewSubmissionFingerprint(a));
  assert.notEqual(one,receiptReviewSubmissionFingerprint({
    ...a,decisions:[{line_index:0,action:'receive',received_quantity:20}]
  }));
  assert.match(one,/^[a-f0-9]{64}$/);
  assert.throws(()=>receiptReviewSubmissionFingerprint({...a,draftId:0}),/Valid draft/);
});

test('API exposes only read-only readiness and keeps blind counts behind server gate',()=>{
  const api=read('receipt-intelligence-routes.js');
  const core=read('receipt-receiving-preflight.js');
  const ui=read('public/receipt-intelligence-ui.js');
  assert.match(api,/GET|app\.get\('\/api\/procurement\/purchase-documents\/:id\/intelligence\/receiving-readiness'/);
  assert.match(api,/buildReceiptReceivingPreflight/);
  assert.match(api,/other\.business_id=\$1 AND other\.id<>\$2/);
  assert.match(api,/SELECT status FROM inventory_count_sessions WHERE id=\$1 AND business_id=\$2/);
  assert.match(api,/Finish blind counting before viewing documents/);
  assert.match(api,/submission_sha256/);
  assert.match(api,/different receipt review/);
  assert.match(ui,/receiptCountEvidenceButton/);
  assert.match(ui,/countSessionReviewPane/);
  assert.match(ui,/session\.status!=='review'/);
  assert.match(ui,/stock_posting_enabled:false|Stock posting is disabled/);
  assert.doesNotMatch(api,/app\.post\('\/api\/inventory\/purchase/);
  assert.doesNotMatch(core,/INSERT INTO |UPDATE inventory SET|app\.post\(/);
  assert.doesNotMatch(ui,/fetch\(['"]\/api\/inventory\/purchase/);
});
