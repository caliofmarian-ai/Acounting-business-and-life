import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  normalizeMerchantPurchaseDocument,MERCHANT_PURCHASE_FILE_MAX_BYTES
} from '../merchant-purchase-documents.js';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const base=()=>({
  business_id:14,
  client_request_key:'purchase-2026-10-30-001',
  document_kind:'purchase_receipt',
  issuer_name:'Local market',
  issue_date:'2026-10-30',
  currency_code:'PHP',
  gross_amount:145.25,
  links:[
    {kind:'inventory_purchase',id:101},
    {kind:'inventory_purchase',id:102}
  ]
});

test('single purchased-shop receipt links several Inventory purchases without inventing transactions',()=>{
  const d=normalizeMerchantPurchaseDocument(base());
  assert.equal(d.businessId,14);
  assert.deepEqual(d.links,[{kind:'inventory_purchase',id:101},{kind:'inventory_purchase',id:102}]);
  assert.equal(d.amount,145.25);
  assert.equal(d.dataUrl,'');
  assert.equal(MERCHANT_PURCHASE_FILE_MAX_BYTES,6*1024*1024);
});

test('photo/PDF metadata requires valid evidence type and a filename',()=>{
  const d=normalizeMerchantPurchaseDocument({...base(),
    document_kind:'invoice',file_name:'invoice.pdf',data_url:'data:application/pdf;base64,JVBERi0xLjQK'});
  assert.equal(d.kind,'invoice');
  assert.equal(d.fileName,'invoice.pdf');
  assert.throws(()=>normalizeMerchantPurchaseDocument({...base(),file_name:'bill.exe',data_url:'data:application/octet-stream;base64,AAAA'}),/Only JPEG/);
  assert.throws(()=>normalizeMerchantPurchaseDocument({...base(),data_url:'data:image/jpeg;base64,AAAA'}),/File name is required/);
  assert.throws(()=>normalizeMerchantPurchaseDocument({...base(),file_name:'receipt.png'}),/must contain evidence data/);
});

test('fail closed for invalid business IDs, evidence amount, dates, links and request keys',()=>{
  for(const business_id of [0,-1,1.5,'NaN',null])assert.throws(
    ()=>normalizeMerchantPurchaseDocument({...base(),business_id}),/positive integer/
  );
  assert.throws(()=>normalizeMerchantPurchaseDocument({...base(),gross_amount:-4}),/Invalid document amount/);
  assert.throws(()=>normalizeMerchantPurchaseDocument({...base(),issue_date:'2026-02-30'}),/Invalid issue date/);
  assert.throws(()=>normalizeMerchantPurchaseDocument({...base(),document_kind:'tax_invoice_auto_approved'}),/Invalid purchase document kind/);
  assert.throws(()=>normalizeMerchantPurchaseDocument({...base(),client_request_key:'1'}),/stable client_request_key/);
  assert.throws(()=>normalizeMerchantPurchaseDocument({...base(),links:[{kind:'cash_account',id:1}]}),/Unsupported purchase record link/);
  assert.throws(()=>normalizeMerchantPurchaseDocument({...base(),links:[{kind:'purchase_order',id:8},{kind:'purchase_order',id:8}]}),/Duplicate linked purchase record/);
});

test('exact Merchant authorization, cross-business linked-record checks, and private audited file reads are wired',()=>{
  const core=read('merchant-purchase-documents.js');
  const entry=read('server-suppliers.js');
  assert.match(core,/exactProfileBusiness\(pool,me,'merchant',businessId\)/);
  assert.match(core,/SELECT 1 FROM '\+table\+' WHERE id=\$1 AND business_id=\$2/);
  assert.match(core,/expense_transaction.*transactions/);
  assert.match(core,/type='business_expense'/);
  assert.match(core,/storePrivateEvidence\(pool/);
  assert.match(core,/bindPrivateEvidenceSource\(client/);
  assert.match(core,/readPrivateEvidence\(pool/);
  assert.match(core,/sendPrivateEvidence\(res,file\)/);
  assert.match(core,/ON CONFLICT\(business_id,client_request_key\) DO NOTHING/);
  assert.match(core,/deletePrivateEvidence\(pool/);
  assert.match(core,/CREATE TABLE IF NOT EXISTS merchant_purchase_document_links/);
  assert.match(entry,/ensureMerchantPurchaseDocumentSchema\(pool\)/);
  assert.match(entry,/registerMerchantPurchaseDocumentRoutes/);
  assert.match(entry,/purchase-documents-ui.js/);
  assert.match(entry,/pathname.startsWith\('\/api\/procurement\/'\)/);
});

test('no public file/blob URL and original accounting source stays authoritative',()=>{
  const core=read('merchant-purchase-documents.js');
  assert.doesNotMatch(core,/res\.json\(.*data_url/);
  assert.doesNotMatch(core,/INSERT INTO transactions/i);
  assert.doesNotMatch(core,/UPDATE inventory_purchases/i);
  assert.match(core,/SELECT \* FROM merchant_purchase_documents WHERE id=\$1 AND business_id=\$2/);
});

test('cross-business purchase link is rejected before a scanned original can be saved',async()=>{
  const {merchantPurchaseDocumentInternals}=await import('../merchant-purchase-documents.js');
  const calls=[];
  const pool={query:async(sql,params)=>{
    calls.push({sql,params});
    if(sql.includes('SELECT * FROM merchant_purchase_documents'))return{rowCount:0,rows:[]};
    return{rowCount:0,rows:[]}; // foreign or missing purchase
  }};
  await assert.rejects(
    ()=>merchantPurchaseDocumentInternals.savePurchaseDocument(pool,{
      actorAccountId:9,record:normalizeMerchantPurchaseDocument({
        ...base(),links:[{kind:'inventory_purchase',id:808}]
      })
    }),
    /Linked purchase record unavailable/
  );
  assert.equal(calls.length,2);
  assert.equal(calls[1].params[1],14);
  assert.match(calls[1].sql,/business_id=\$2/);
});

test('replayed identical request returns existing evidence without adding stock, expenses or files',async()=>{
  const {merchantPurchaseDocumentInternals}=await import('../merchant-purchase-documents.js');
  const record=normalizeMerchantPurchaseDocument({...base(),links:[]});
  const fingerprint=(await import('node:crypto')).default.createHash('sha256').update(JSON.stringify({
    kind:record.kind,issueDate:record.issueDate,currency:record.currency,amount:record.amount,
    issuer:record.issuer,number:record.documentNumber,note:record.note,
    links:record.links,fileName:record.fileName,fileDigest:''
  })).digest('hex');
  const row={
    id:23,business_id:14,request_fingerprint:fingerprint,
    document_kind:'purchase_receipt',issuer_name:'Local market',
    document_number:'',issue_date:'2026-10-30',currency_code:'PHP',
    gross_amount:'145.25',note:'',private_evidence_object_id:null
  };
  let queries=0;
  const pool={query:async(sql,params)=>{
    queries++;
    assert.match(sql,/SELECT \* FROM merchant_purchase_documents/);
    assert.deepEqual(params,[14,record.key]);
    return{rowCount:1,rows:[row]};
  }};
  const result=await merchantPurchaseDocumentInternals.savePurchaseDocument(pool,{actorAccountId:9,record});
  assert.equal(result.already_saved,true);
  assert.equal(result.document.id,23);
  assert.equal(queries,1);
});
