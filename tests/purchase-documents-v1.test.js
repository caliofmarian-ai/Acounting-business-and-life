import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  normalizeMerchantPurchaseDocument,philippinesPurchaseDocumentDate,MERCHANT_PURCHASE_FILE_MAX_BYTES
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

test('purchase receipt identity, intent key and currency reject coercion or truncation',()=>{
  const good=normalizeMerchantPurchaseDocument(base());
  assert.equal(good.businessId,14);
  assert.equal(good.currency,'PHP');
  assert.equal(normalizeMerchantPurchaseDocument({...base(),business_id:'14'}).businessId,14);
  assert.equal(normalizeMerchantPurchaseDocument({...base(),links:[{kind:'inventory_purchase',id:'101'}]}).links[0].id,101);
  for(const business_id of [true,[14],{valueOf:()=>14},'1e2','14.0',' 14 ','+14']){
    assert.throws(()=>normalizeMerchantPurchaseDocument({...base(),business_id}),/positive integer/);
  }
  for(const id of [true,[101],{valueOf:()=>101},'1e2','101.0',' 101 ','+101']){
    assert.throws(()=>normalizeMerchantPurchaseDocument({...base(),links:[{kind:'inventory_purchase',id}]}),/positive integer/);
  }
  for(const client_request_key of ['x'.repeat(101),' '+base().client_request_key,base().client_request_key+' ',123456789012]){
    assert.throws(()=>normalizeMerchantPurchaseDocument({...base(),client_request_key}),/stable client_request_key/);
  }
  for(const currency_code of ['PHPX','PHP-fake','PHPjunk',123,[],{}]){
    assert.throws(()=>normalizeMerchantPurchaseDocument({...base(),currency_code}),/Invalid currency/);
  }
  assert.equal(normalizeMerchantPurchaseDocument({...base(),currency_code:'php'}).currency,'PHP');
});

test('purchase evidence rejects date truncation and NUMERIC(14,2) rounding/overflow',()=>{
  for(const issue_date of ['2026-10-30XXXXX','2026-10-30T00:00:00Z',' 2026-10-30','2026-10-30 ',
    '2026-02-29','0000-01-01',7,true]) {
    assert.throws(()=>normalizeMerchantPurchaseDocument({...base(),issue_date}),/Invalid issue date/);
  }
  assert.equal(normalizeMerchantPurchaseDocument({...base(),issue_date:'2028-02-29'}).issueDate,'2028-02-29');
  for(const gross_amount of ['100.005','0.001','1e3','-0.01','+1.00','999999999999.999',
    '1000000000000',' 145.25','145.25 ',100.005,0.001,1e12,NaN,Infinity,-Infinity,-0,
    false,true,[],{}]) {
    assert.throws(()=>normalizeMerchantPurchaseDocument({...base(),gross_amount}),/Invalid document amount/);
  }
  for(const [gross_amount,expected] of [['0.01',0.01],['145.25',145.25],['999999999999.99',999999999999.99],
    [0.01,0.01],[145.25,145.25],[999999999999.99,999999999999.99],[1000,1000]]) {
    assert.equal(normalizeMerchantPurchaseDocument({...base(),gross_amount}).amount,expected);
  }
  assert.equal(normalizeMerchantPurchaseDocument({...base(),gross_amount:''}).amount,null);
  assert.equal(normalizeMerchantPurchaseDocument({...base(),gross_amount:null}).amount,null);
  assert.equal(normalizeMerchantPurchaseDocument({...base(),gross_amount:'0.00'}).amount,0);
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
  const calls=[];
  const pool={
    query:async(sql,params)=>{
      calls.push('precheck');
      assert.match(sql,/SELECT \* FROM merchant_purchase_documents/);
      assert.deepEqual(params,[14,record.key]);
      return{rowCount:1,rows:[row]};
    },
    connect:async()=>({
      query:async(sql,params)=>{
        if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK'){
          calls.push(sql);return{rowCount:0,rows:[]};
        }
        if(sql.includes('FROM profile_business_bindings')){
          calls.push('grant');
          assert.match(sql,/FOR SHARE OF pb,bm/);
          assert.deepEqual(params,[9,14]);
          return{rowCount:1,rows:[{business_id:14}]};
        }
        assert.match(sql,/SELECT \* FROM merchant_purchase_documents/);
        calls.push('replay');
        assert.deepEqual(params,[14,record.key]);
        return{rowCount:1,rows:[row]};
      },
      release:()=>calls.push('release')
    })
  };
  const result=await merchantPurchaseDocumentInternals.savePurchaseDocument(pool,{actorAccountId:9,record});
  assert.equal(result.already_saved,true);
  assert.equal(result.document.id,23);
  assert.deepEqual(calls,['precheck','BEGIN','grant','replay','COMMIT','release']);
});

test('replayed purchase receipt fails closed when Merchant grant was revoked after HTTP authorization',async()=>{
  const {merchantPurchaseDocumentInternals}=await import('../merchant-purchase-documents.js');
  const record=normalizeMerchantPurchaseDocument({...base(),links:[]});
  const calls=[];
  const pool={
    query:async(sql)=>{
      assert.match(sql,/SELECT \* FROM merchant_purchase_documents/);
      calls.push('precheck');
      return{rowCount:1,rows:[{id:23}]};
    },
    connect:async()=>({
      query:async(sql,params)=>{
        if(sql==='BEGIN'||sql==='ROLLBACK'||sql==='COMMIT'){
          calls.push(sql);return{rowCount:0,rows:[]};
        }
        assert.match(sql,/FOR SHARE OF pb,bm/);
        assert.deepEqual(params,[9,14]);
        calls.push('revoked-grant');
        return{rowCount:0,rows:[]};
      },
      release:()=>calls.push('release')
    })
  };
  await assert.rejects(
    ()=>merchantPurchaseDocumentInternals.savePurchaseDocument(pool,{actorAccountId:9,record}),
    e=>e.status===403&&/access changed/.test(e.message)
  );
  assert.deepEqual(calls,['precheck','BEGIN','revoked-grant','ROLLBACK','release']);
});

test('Philippines date fallback and explicit receipt date',()=>{
  assert.equal(philippinesPurchaseDocumentDate(new Date('2026-11-04T15:59:59.999Z')),'2026-11-04');
  assert.equal(philippinesPurchaseDocumentDate(new Date('2026-11-04T16:00:00Z')),'2026-11-05');
  assert.equal(philippinesPurchaseDocumentDate(new Date('2026-12-31T16:00:00Z')),'2027-01-01');
  const prior=philippinesPurchaseDocumentDate();
  const d=normalizeMerchantPurchaseDocument({...base(),issue_date:null});
  const next=philippinesPurchaseDocumentDate();
  assert.ok(d.issueDate===prior||d.issueDate===next,'fallback must be the current Philippines calendar day');
  assert.equal(normalizeMerchantPurchaseDocument(base()).issueDate,'2026-10-30');
});

test('malformed supplied purchase associations and evidence metadata fail closed',()=>{
  const expected=normalizeMerchantPurchaseDocument(base());
  assert.equal(expected.links.length,2);
  assert.deepEqual(normalizeMerchantPurchaseDocument({...base(),links:null}).links,[]);
  assert.deepEqual(normalizeMerchantPurchaseDocument({...base(),links:[]}).links,[]);
  for(const links of [false,true,0,12,'inventory_purchase:101',{kind:'inventory_purchase',id:101}]){
    assert.throws(()=>normalizeMerchantPurchaseDocument({...base(),links}),/Purchase links must be an array/);
  }
  for(const data_url of [false,true,123,[],{}]){
    assert.throws(()=>normalizeMerchantPurchaseDocument({...base(),data_url}),/Evidence data must be a string/);
  }
  for(const file_name of [false,true,123,[],{}]){
    assert.throws(()=>normalizeMerchantPurchaseDocument({...base(),file_name}),/File name must be a string/);
  }
  assert.equal(normalizeMerchantPurchaseDocument({...base(),data_url:null,file_name:null}).dataUrl,'');
  assert.equal(normalizeMerchantPurchaseDocument({...base(),file_name:'invoice.pdf',data_url:'data:application/pdf;base64,JVBERi0xLjQK'}).fileName,'invoice.pdf');
});
