import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {readFileSync} from 'node:fs';
import {
  normalizeMerchantPurchaseDocument,normalizeMerchantPurchaseDocumentEvidence,philippinesPurchaseDocumentDate,MERCHANT_PURCHASE_FILE_MAX_BYTES,
  registerMerchantPurchaseDocumentRoutes
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


test('purchase receipt link permutations replay once, but changed link sets fail closed; legacy key still replays',async()=>{
  const {merchantPurchaseDocumentInternals}=await import('../merchant-purchase-documents.js');
  const crypto=(await import('node:crypto')).default;
  const reversed=normalizeMerchantPurchaseDocument({...base(),links:[...base().links].reverse()});
  const sorted=normalizeMerchantPurchaseDocument(base());
  let saved=null,insertions=0,linkWrites=0;
  const query=async(sql,args=[])=>{
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return{rowCount:0,rows:[]};
    if(sql.includes('FROM profile_business_bindings'))return{rowCount:1,rows:[{business_id:14}]};
    if(sql.includes('SELECT * FROM merchant_purchase_documents'))return{rowCount:saved?1:0,rows:saved?[saved]:[]};
    if(sql.includes('SELECT 1 FROM inventory_purchases')){
      assert.equal(args[1],14);
      return{rowCount:1,rows:[{id:args[0]}]};
    }
    if(sql.includes('INSERT INTO merchant_purchase_documents(')){
      insertions++;
      saved={id:700,business_id:14,request_fingerprint:args[3],document_kind:args[4],
        issuer_name:args[5],document_number:args[6],issue_date:args[7],
        currency_code:args[8],gross_amount:args[9],note:args[10],private_evidence_object_id:null};
      return{rowCount:1,rows:[saved]};
    }
    if(sql.includes('INSERT INTO merchant_purchase_document_links(')){
      linkWrites++;return{rowCount:1,rows:[]};
    }
    throw new Error('Unexpected query: '+sql);
  };
  const pool={query,connect:async()=>({query,release(){}})};
  const first=await merchantPurchaseDocumentInternals.savePurchaseDocument(pool,{actorAccountId:9,record:reversed});
  assert.equal(first.already_saved,false);
  assert.equal(insertions,1);
  assert.equal(linkWrites,2);
  const replay=await merchantPurchaseDocumentInternals.savePurchaseDocument(pool,{actorAccountId:9,record:sorted});
  assert.equal(replay.already_saved,true);
  assert.equal(replay.document.id,700);
  assert.equal(insertions,1);
  assert.equal(linkWrites,2);
  await assert.rejects(()=>merchantPurchaseDocumentInternals.savePurchaseDocument(pool,{
    actorAccountId:9,record:normalizeMerchantPurchaseDocument({...base(),links:[base().links[0]]})
  }),e=>e.status===409);
  assert.equal(insertions,1);

  // Rows written by the earlier algorithm hashed links in original input order.
  saved.request_fingerprint=crypto.createHash('sha256').update(JSON.stringify({
    kind:reversed.kind,issueDate:reversed.issueDate,currency:reversed.currency,amount:reversed.amount,
    issuer:reversed.issuer,number:reversed.documentNumber,note:reversed.note,
    links:reversed.links,fileName:reversed.fileName,fileDigest:''
  })).digest('hex');
  const legacy=await merchantPurchaseDocumentInternals.savePurchaseDocument(pool,{actorAccountId:9,record:reversed});
  assert.equal(legacy.already_saved,true);
  assert.equal(insertions,1);
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

test('confirmed competing receipt replay stays successful when unused duplicate-upload cleanup fails',async()=>{
  // Reproduce the actual post-commit path with disposable synthetic adapters:
  // the unique intent already committed elsewhere while this request uploaded.
  const crypto=(await import('node:crypto')).default;
  const source=read('merchant-purchase-documents.js')
    .replace(/^import[\s\S]*?;\n/gm,'')
    .replace(/^export /gm,'');
  const dependencies=[
    'crypto','supplierDomainV2Internals','ensurePrivateEvidenceSchema',
    'storePrivateEvidence','bindPrivateEvidenceSource','readPrivateEvidence',
    'sendPrivateEvidence','deletePrivateEvidence','console'
  ];
  const makeCoordinator=new Function(...dependencies,source+'\nreturn savePurchaseDocument;');
  const record=normalizeMerchantPurchaseDocument({
    ...base(),links:[],file_name:'original.pdf',
    data_url:'data:application/pdf;base64,JVBERi0xLjQK'
  });
  const events=[],warnings=[];
  let fingerprint=null;
  const receipt=()=>({
    id:99,business_id:14,request_fingerprint:fingerprint,
    document_kind:'purchase_receipt',issuer_name:'Local market',
    document_number:'',issue_date:'2026-10-30',currency_code:'PHP',
    gross_amount:'145.25',note:'',private_evidence_object_id:123
  });
  const client={
    query:async(sql,args=[])=>{
      if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK'){
        events.push(sql);return{rowCount:0,rows:[]};
      }
      if(sql.includes('FROM profile_business_bindings')){
        events.push('grant');return{rowCount:1,rows:[{business_id:14}]};
      }
      if(sql.includes('INSERT INTO merchant_purchase_documents(')){
        events.push('insert-conflict');fingerprint=args[3];
        return{rowCount:0,rows:[]};
      }
      if(sql.includes('SELECT * FROM merchant_purchase_documents')){
        events.push('select-existing');return{rowCount:1,rows:[receipt()]};
      }
      throw new Error('Unexpected SQL '+sql);
    },
    release:()=>events.push('release')
  };
  const pool={
    query:async()=>{events.push('precheck');return{rowCount:0,rows:[]}},
    connect:async()=>client
  };
  const save=makeCoordinator(
    crypto,{exactProfileBusiness:()=>{}},async()=>{},
    async()=>{events.push('upload');return{id:555}},async()=>{},
    async()=>{},()=>{},
    async()=>{events.push('delete');throw new Error('private storage cleanup unavailable')},
    {warn:warning=>warnings.push(warning)}
  );
  const result=await save(pool,{actorAccountId:9,record});
  assert.equal(result.already_saved,true);
  assert.equal(result.document.id,99);
  assert.deepEqual(events,['precheck','upload','BEGIN','grant','insert-conflict',
    'select-existing','COMMIT','delete','release']);
  assert.deepEqual(warnings,['MERCHANT_PURCHASE_DUPLICATE_EVIDENCE_CLEANUP_FAILED']);
  assert.ok(!events.includes('ROLLBACK'),'a committed replay cannot be misreported as rollback');
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


test('immutable purchase evidence rejects coerced and silently truncated receipt metadata',()=>{
  const original=base();
  const valid=normalizeMerchantPurchaseDocument({...original,
    document_kind:'invoice',issuer_name:'I'.repeat(180),
    document_number:'N'.repeat(120),note:'M'.repeat(1000),
    file_name:'r'.repeat(216)+'.pdf',data_url:'data:application/pdf;base64,JVBERi0xLjQK'
  });
  assert.equal(valid.kind,'invoice');
  assert.equal(valid.issuer.length,180);
  assert.equal(valid.documentNumber.length,120);
  assert.equal(valid.note.length,1000);
  assert.equal(valid.fileName.length,220);
  for(const [field,max,label] of [
    ['issuer_name',180,'Issuer name'],['document_number',120,'Document number'],
    ['note',1000,'Document note'],['file_name',220,'File name']
  ]){
    for(const invalid of ['X'.repeat(max+1),[],['X'],false,42,{}]){
      assert.throws(()=>normalizeMerchantPurchaseDocument({...original,[field]:invalid}),
        e=>e.status===400&&e.message.includes(label),field+' must not silently alias source evidence');
    }
  }
  for(const invalid of [['invoice'],true,123,{},'x'.repeat(41)]){
    assert.throws(()=>normalizeMerchantPurchaseDocument({...original,document_kind:invalid}),
      e=>e.status===400,'document class must be explicit, never coerced or truncated');
  }
  for(const kind of [['inventory_purchase'],{toString:()=> 'inventory_purchase'},'x'.repeat(33)]){
    assert.throws(()=>normalizeMerchantPurchaseDocument({...original,
      links:[{kind,id:101}]
    }),e=>e.status===400,'typed link kinds must not alias other evidence');
  }
  assert.equal(normalizeMerchantPurchaseDocument({...original,
    issuer_name:null,document_number:null,note:null,file_name:null
  }).issuer,'','omitted optional metadata remains supported');
});

test('linked receipt sources receive transaction-held share locks on the final recheck',async()=>{
  const {merchantPurchaseDocumentInternals}=await import('../merchant-purchase-documents.js');
  const sql=[];
  const db={query:async(query,params)=>{
    sql.push({query,params});
    return{rowCount:1,rows:[{id:101}]};
  }};
  const linked=[{kind:'inventory_purchase',id:101},{kind:'expense_transaction',id:202}];
  await merchantPurchaseDocumentInternals.validatePurchaseLinks(db,14,linked);
  assert.equal(sql.length,2);
  assert.ok(sql.every(x=>!x.query.includes('FOR SHARE')),'initial preflight must not hold locks');
  sql.length=0;
  await merchantPurchaseDocumentInternals.validatePurchaseLinks(db,14,linked,{lockRows:true});
  assert.ok(sql.every(x=>x.query.endsWith('FOR SHARE')),'commit-time association check must lock source rows');
  assert.match(sql[1].query,/type='business_expense' FOR SHARE/);
  assert.deepEqual(sql[0].params,[101,14]);
});

test('uncertain purchase-receipt COMMIT preserves the original evidence; definite precommit failure cleans it',async()=>{
  // Run the actual coordinator with synthetic private-object and database adapters.
  // An ambiguous transport error is NOT proof of database rollback.
  const nodeCrypto=(await import('node:crypto')).default;
  const source=read('merchant-purchase-documents.js')
    .replace(/^import[\s\S]*?;\n/gm,'')
    .replace(/^export /gm,'');
  const dependencies=[
    'crypto','supplierDomainV2Internals','ensurePrivateEvidenceSchema',
    'storePrivateEvidence','bindPrivateEvidenceSource','readPrivateEvidence',
    'sendPrivateEvidence','deletePrivateEvidence'
  ];
  const makeCoordinator=new Function(...dependencies,source+'\nreturn savePurchaseDocument;');
  const record=normalizeMerchantPurchaseDocument({
    ...base(),links:[],file_name:'original.pdf',
    data_url:'data:application/pdf;base64,JVBERi0xLjQK'
  });
  async function scenario(failure){
    const calls=[];
    const client={
      query:async(sql)=>{
        if(sql==='BEGIN'||sql==='ROLLBACK'){
          calls.push(sql);
          if(failure==='begin'&&sql==='BEGIN')throw new Error('BEGIN acknowledgement lost');
          if(failure==='rollback'&&sql==='ROLLBACK')throw new Error('ROLLBACK acknowledgement lost');
          return{rowCount:0,rows:[]};
        }
        if(sql==='COMMIT'){
          calls.push('COMMIT');
          if(failure==='commit')throw new Error('COMMIT acknowledgement lost');
          return{rowCount:0,rows:[]};
        }
        if(sql.includes('FROM profile_business_bindings')){
          calls.push('grant');return{rowCount:1,rows:[{business_id:14}]};
        }
        if(sql.includes('INSERT INTO merchant_purchase_documents(')){
          calls.push('insert');
          if(failure==='insert'||failure==='rollback')throw new Error('definite insert failure');
          return{rowCount:1,rows:[{
            id:99,business_id:14,document_kind:'purchase_receipt',
            issuer_name:'Local market',document_number:'',issue_date:'2026-10-30',
            currency_code:'PHP',gross_amount:'145.25',note:'',
            private_evidence_object_id:555
          }]};
        }
        throw new Error('Unexpected SQL '+sql);
      },
      release:err=>calls.push(err?'release-unsafe':'release')
    };
    const pool={
      query:async()=>({rowCount:0,rows:[]}),
      connect:async()=>client
    };
    const save=makeCoordinator(
      nodeCrypto,{exactProfileBusiness:()=>{}},async()=>{},
      async()=>{calls.push('store');return{id:555}},
      async()=>{calls.push('bind')},async()=>{},()=>{},
      async()=>{calls.push('delete')}
    );
    const operation=save(pool,{actorAccountId:9,record});
    if(['commit','insert','begin','rollback'].includes(failure)){
      await assert.rejects(operation,new RegExp(['commit','begin'].includes(failure)?'acknowledgement lost':'insert failure'));
    }else{
      const result=await operation;
      assert.equal(result.already_saved,false);
      assert.equal(result.document.id,99);
    }
    return calls;
  }
  const ambiguous=await scenario('commit');
  assert.ok(ambiguous.includes('bind')&&ambiguous.includes('COMMIT'));
  assert.ok(ambiguous.includes('ROLLBACK'),'rollback may be attempted but does not prove commit was undone');
  assert.ok(!ambiguous.includes('delete'),'original cannot be tombstoned after ambiguous COMMIT');
  assert.ok(ambiguous.includes('release-unsafe'),'ambiguous COMMIT must destroy pooled client');
  const definite=await scenario('insert');
  assert.ok(definite.includes('ROLLBACK')&&definite.includes('delete'));
  assert.ok(!definite.includes('COMMIT'));
  assert.ok(definite.includes('release'),'confirmed ROLLBACK allows connection reuse');
  const unknownBegin=await scenario('begin');
  assert.ok(unknownBegin.includes('release-unsafe'),'unknown BEGIN must evict pooled client');
  const badRollback=await scenario('rollback');
  assert.ok(badRollback.includes('release-unsafe'),'failed ROLLBACK must evict pooled client');
  const successful=await scenario('ok');
  assert.ok(successful.includes('COMMIT')&&!successful.includes('delete'));
  assert.ok(successful.includes('release'));
});


test('receipt replay evicts a pooled client after uncertain BEGIN, COMMIT or ROLLBACK',async()=>{
  const {merchantPurchaseDocumentInternals}=await import('../merchant-purchase-documents.js');
  const crypto=(await import('node:crypto')).default;
  const record=normalizeMerchantPurchaseDocument({...base(),links:[]});
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify({
    kind:record.kind,issueDate:record.issueDate,currency:record.currency,amount:record.amount,
    issuer:record.issuer,number:record.documentNumber,note:record.note,
    links:[],fileName:record.fileName,fileDigest:''
  })).digest('hex');
  for(const failure of ['begin','commit','rollback','ok']){
    let released=null;
    const row={id:23,business_id:14,request_fingerprint:failure==='rollback'?'not-the-same':fingerprint,
      document_kind:'purchase_receipt',issuer_name:'Local market',document_number:'',
      issue_date:'2026-10-30',currency_code:'PHP',gross_amount:'145.25',note:''};
    const client={
      query:async(sql)=>{
        if(sql==='BEGIN'){
          if(failure==='begin')throw new Error('BEGIN acknowledgement lost');
          return{rowCount:0,rows:[]};
        }
        if(sql==='COMMIT'){
          if(failure==='commit')throw new Error('COMMIT acknowledgement lost');
          return{rowCount:0,rows:[]};
        }
        if(sql==='ROLLBACK'){
          if(failure==='rollback')throw new Error('ROLLBACK acknowledgement lost');
          return{rowCount:0,rows:[]};
        }
        if(sql.includes('FROM profile_business_bindings'))return{rowCount:1,rows:[{business_id:14}]};
        if(sql.includes('SELECT * FROM merchant_purchase_documents'))return{rowCount:1,rows:[row]};
        throw new Error('Unexpected replay SQL '+sql);
      },
      release:error=>{released=error||'healthy';}
    };
    const pool={query:async()=>({rowCount:1,rows:[row]}),connect:async()=>client};
    const operation=merchantPurchaseDocumentInternals.savePurchaseDocument(pool,{actorAccountId:9,record});
    if(failure==='ok')assert.equal((await operation).already_saved,true);
    else await assert.rejects(operation,/acknowledgement lost|different receipt/);
    assert.equal(failure==='ok'?released==='healthy':released instanceof Error,true,
      failure+' must release with the correct pool health state');
  }
});

test('private Merchant purchase-document HTTP routes refuse stale conditional 304 and forbid caching',async()=>{
  // Real Express HTTP/ETag behavior over loopback; identities are denied synthetic
  // sessions. This is a cache/auth negative, NOT Merchant Preview acceptance.
  const app=express();
  registerMerchantPurchaseDocumentRoutes({
    app,pool:{},body:express.json(),
    identity:async()=>{throw Object.assign(new Error('Unauthorized'),{status:401});}
  });
  app.use((err,req,res,next)=>res.status(err.status||500).json({error:err.message}));
  const server=await new Promise(resolve=>{
    const listening=app.listen(0,'127.0.0.1',()=>resolve(listening));
  });
  const baseUrl='http://127.0.0.1:'+server.address().port;
  const assertPrivate=response=>{
    const cache=response.headers.get('cache-control')||'';
    const vary=response.headers.get('vary')||'';
    assert.match(cache,/private/i);
    assert.match(cache,/no-store/i);
    assert.match(vary,/Cookie/i);
    assert.match(vary,/Authorization/i);
  };
  try{
    for(const path of [
      '/api/procurement/purchase-documents?business_id=14',
      '/api/procurement/purchase-documents/linkable-purchases?business_id=14',
      '/api/procurement/purchase-documents/23?business_id=14',
      '/api/procurement/purchase-documents/23/file?business_id=14'
    ]){
      const first=await fetch(baseUrl+path);
      assert.equal(first.status,401,path);
      assertPrivate(first);
      const etag=first.headers.get('etag');
      assert.ok(etag,'Express should generate a JSON ETag for the negative control');
      const repeated=await fetch(baseUrl+path,{headers:{
        'If-None-Match':etag,'If-Modified-Since':'Wed, 21 Oct 2099 07:28:00 GMT'
      }});
      assert.equal(repeated.status,401,'no conditional 304 from a private route: '+path);
      assertPrivate(repeated);
      assert.equal((await repeated.json()).error,'Unauthorized');
    }
    const submit=await fetch(baseUrl+'/api/procurement/purchase-documents',{
      method:'POST',headers:{'Content-Type':'application/json'},body:'{}'
    });
    assert.equal(submit.status,401);
    assertPrivate(submit);
    const patch=await fetch(baseUrl+'/api/procurement/purchase-documents/23',{
      method:'PATCH',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({business_id:14,expected_updated_at:'2026-11-13T12:00:00.000Z',issuer_name:'Denied'})
    });
    assert.equal(patch.status,401,'anonymous metadata editing is denied');
    assertPrivate(patch);
  }finally{
    await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
  }
});


test('purchase-document metadata edits are strict, versioned and never accept file or financial links',async()=>{
  const {normalizeMerchantPurchaseDocumentMetadata}=await import('../merchant-purchase-documents.js');
  const row={
    id:23,business_id:14,client_request_key:'purchase-2026-10-30-001',
    document_kind:'purchase_receipt',issuer_name:'Old shop',document_number:'',
    issue_date:'2026-10-30',currency_code:'PHP',gross_amount:'145.25',note:'old note',
    private_evidence_object_id:555,updated_at:new Date('2026-11-13T12:00:00.000Z')
  };
  const result=normalizeMerchantPurchaseDocumentMetadata(row,{
    expected_updated_at:row.updated_at.toISOString(),
    issuer_name:'Corrected shop',gross_amount:'150.00',note:'corrected note'
  });
  assert.equal(result.expectedUpdatedAt,'2026-11-13T12:00:00.000Z');
  assert.deepEqual(result.metadata,{
    document_kind:'purchase_receipt',issuer_name:'Corrected shop',document_number:'',
    issue_date:'2026-10-30',currency_code:'PHP',gross_amount:'150.00',note:'corrected note'
  });
  for(const extra of [
    {business_id:99},{links:[]},{data_url:'data:image/png;base64,AAAA'},
    {file_name:'other.png'},{private_evidence_object_id:777},{client_request_key:'different'}
  ])assert.throws(()=>normalizeMerchantPurchaseDocumentMetadata(row,{
    expected_updated_at:row.updated_at.toISOString(),...extra
  }),/Only purchase document metadata can be edited/);
  assert.throws(()=>normalizeMerchantPurchaseDocumentMetadata(row,{issuer_name:'No version'}),/expected_updated_at/);
  assert.throws(()=>normalizeMerchantPurchaseDocumentMetadata(row,{
    expected_updated_at:row.updated_at.toISOString(),gross_amount:'100.005'
  }),/Invalid document amount/);
  assert.throws(()=>normalizeMerchantPurchaseDocumentMetadata(row,{
    expected_updated_at:row.updated_at.toISOString(),issue_date:'2026-10-30T00:00:00Z'
  }),/Invalid issue date/);
});

test('metadata edit locks Merchant grant and receipt row, audits before/after and leaves file/links/finance untouched',async()=>{
  const {merchantPurchaseDocumentInternals}=await import('../merchant-purchase-documents.js');
  const original={
    id:23,business_id:14,created_by_account_id:9,client_request_key:'purchase-2026-10-30-001',
    document_kind:'purchase_receipt',issuer_name:'Old shop',document_number:'',
    issue_date:'2026-10-30',currency_code:'PHP',gross_amount:'145.25',note:'old note',
    private_evidence_object_id:555,created_at:new Date('2026-10-30T00:00:00.000Z'),
    updated_at:new Date('2026-11-13T12:00:00.000Z')
  };
  let current={...original},auditRows=[],released=null;
  const calls=[];
  const client={
    query:async(sql,params=[])=>{
      calls.push({sql,params});
      if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return{rowCount:0,rows:[]};
      if(sql.includes('FROM profile_business_bindings'))return{rowCount:1,rows:[{business_id:14}]};
      if(sql.includes('SELECT * FROM merchant_purchase_documents'))return{rowCount:1,rows:[{...current}]};
      if(sql.includes('UPDATE merchant_purchase_documents')){
        current={...current,document_kind:params[2],issuer_name:params[3],document_number:params[4],
          issue_date:params[5],currency_code:params[6],gross_amount:params[7],note:params[8],
          updated_at:new Date('2026-11-13T12:00:01.000Z')};
        return{rowCount:1,rows:[{...current}]};
      }
      if(sql.includes('INSERT INTO merchant_purchase_document_metadata_audit')){
        auditRows.push({before:JSON.parse(params[3]),after:JSON.parse(params[4]),fields:params[5]});
        return{rowCount:1,rows:[{id:1}]};
      }
      throw new Error('Unexpected metadata SQL '+sql);
    },
    release:error=>{released=error||'healthy'}
  };
  const pool={connect:async()=>client};
  const result=await merchantPurchaseDocumentInternals.updatePurchaseDocumentMetadata(pool,{
    actorAccountId:9,businessId:14,documentId:23,
    input:{expected_updated_at:original.updated_at.toISOString(),issuer_name:'Corrected shop',gross_amount:'150.00'}
  });
  assert.equal(result.already_applied,false);
  assert.equal(result.document.id,23);
  assert.equal(result.document.issuer_name,'Corrected shop');
  assert.equal(result.document.gross_amount,150);
  assert.equal(result.document.has_attachment,true);
  assert.equal(result.document.updated_at,'2026-11-13T12:00:01.000Z');
  assert.equal(current.private_evidence_object_id,555,'the scanned original object is unchanged');
  assert.deepEqual(auditRows,[{
    before:{document_kind:'purchase_receipt',issuer_name:'Old shop',document_number:'',issue_date:'2026-10-30',
      currency_code:'PHP',gross_amount:'145.25',note:'old note'},
    after:{document_kind:'purchase_receipt',issuer_name:'Corrected shop',document_number:'',issue_date:'2026-10-30',
      currency_code:'PHP',gross_amount:'150.00',note:'old note'},
    fields:['issuer_name','gross_amount']
  }]);
  assert.ok(calls.some(x=>x.sql.includes('FOR SHARE OF pb,bm')),'current Merchant grant is locked');
  assert.ok(calls.some(x=>x.sql.includes('FOR UPDATE')),'the exact receipt row is locked');
  assert.ok(calls.some(x=>x.sql.includes('clock_timestamp()')),'version changes use the database wall clock');
  assert.ok(calls.some(x=>x.sql.includes('merchant_purchase_document_metadata_audit')),'audit is in the same transaction');
  assert.ok(!calls.some(x=>/inventory_purchases|transactions|supply_lots/i.test(x.sql)),
    'metadata editing must not write or reread financial/stock sources');
  assert.equal(calls.at(-1).sql,'COMMIT');
  assert.equal(released,'healthy');
});

test('uncertain metadata PATCH acknowledgement is replay-safe and stale competing edits fail closed',async()=>{
  const {merchantPurchaseDocumentInternals}=await import('../merchant-purchase-documents.js');
  const initial={
    id:31,business_id:14,client_request_key:'purchase-2026-10-30-002',
    document_kind:'purchase_receipt',issuer_name:'Old shop',document_number:'',
    issue_date:'2026-10-30',currency_code:'PHP',gross_amount:'145.25',note:'old note',
    private_evidence_object_id:null,created_at:new Date('2026-10-30T00:00:00.000Z'),
    updated_at:new Date('2026-11-13T13:00:00.000Z')
  };
  let current={...initial},auditCount=0,loseCommit=true;
  const makePool=()=>({connect:async()=>({
    query:async(sql,params=[])=>{
      if(sql==='BEGIN'||sql==='ROLLBACK')return{rowCount:0,rows:[]};
      if(sql==='COMMIT'){
        if(loseCommit){loseCommit=false;throw new Error('COMMIT acknowledgement lost');}
        return{rowCount:0,rows:[]};
      }
      if(sql.includes('FROM profile_business_bindings'))return{rowCount:1,rows:[{business_id:14}]};
      if(sql.includes('SELECT * FROM merchant_purchase_documents'))return{rowCount:1,rows:[{...current}]};
      if(sql.includes('UPDATE merchant_purchase_documents')){
        current={...current,document_kind:params[2],issuer_name:params[3],document_number:params[4],
          issue_date:params[5],currency_code:params[6],gross_amount:params[7],note:params[8],
          updated_at:new Date('2026-11-13T13:00:01.000Z')};
        return{rowCount:1,rows:[{...current}]};
      }
      if(sql.includes('INSERT INTO merchant_purchase_document_metadata_audit')){auditCount++;return{rowCount:1,rows:[]};}
      throw new Error('Unexpected metadata SQL '+sql);
    },
    release:error=>{if(error){}}
  })});
  const input={expected_updated_at:initial.updated_at.toISOString(),issuer_name:'Corrected shop'};
  await assert.rejects(()=>merchantPurchaseDocumentInternals.updatePurchaseDocumentMetadata(makePool(),{
    actorAccountId:9,businessId:14,documentId:31,input
  }),/COMMIT acknowledgement lost/);
  assert.equal(auditCount,1,'the uncertain first attempt may have committed once');
  const replay=await merchantPurchaseDocumentInternals.updatePurchaseDocumentMetadata(makePool(),{
    actorAccountId:9,businessId:14,documentId:31,input
  });
  assert.equal(replay.already_applied,true,'same metadata is recognized after a lost acknowledgement');
  assert.equal(auditCount,1,'replay does not duplicate the audit revision');
  await assert.rejects(()=>merchantPurchaseDocumentInternals.updatePurchaseDocumentMetadata(makePool(),{
    actorAccountId:9,businessId:14,documentId:31,
    input:{expected_updated_at:initial.updated_at.toISOString(),note:'different concurrent edit'}
  }),error=>error.status===409);
  assert.equal(auditCount,1,'stale competing metadata does not append an audit row');
});



test('supplementary receipt evidence normalization is strict and bound to one document/business intent',()=>{
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2s5YAAAAASUVORK5CYII=';
  const input={client_request_key:'supporting-20261113-001',file_name:'delivery-note.png',data_url:png};
  const record=normalizeMerchantPurchaseDocumentEvidence(input,{businessId:14,documentId:23});
  assert.equal(record.businessId,14);
  assert.equal(record.documentId,23);
  assert.equal(record.key,input.client_request_key);
  assert.equal(record.fileName,input.file_name);
  assert.match(record.fingerprint,/^[a-f0-9]{64}$/);
  for(const invalid of [
    {...input,client_request_key:'short'},
    {...input,client_request_key:'x'.repeat(101)},
    {...input,file_name:42},
    {...input,file_name:' '},
    {...input,data_url:[]},
    {...input,data_url:'data:text/html;base64,PHNjcmlwdD4='},
    {...input,private_evidence_object_id:777},
    {...input,business_id:99}
  ])assert.throws(()=>normalizeMerchantPurchaseDocumentEvidence(invalid,{businessId:14,documentId:23}));
  assert.throws(()=>normalizeMerchantPurchaseDocumentEvidence(input,{businessId:15,documentId:0}),/positive integer/);
});

test('supplementary evidence appends a distinct private object under Merchant and receipt locks',async()=>{
  const {merchantPurchaseDocumentInternals}=await import('../merchant-purchase-documents.js');
  const record=normalizeMerchantPurchaseDocumentEvidence({
    client_request_key:'supporting-20261113-002',file_name:'supplier-slip.png',
    data_url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2s5YAAAAASUVORK5CYII='
  },{businessId:14,documentId:23});
  const calls=[],bound=[],deleted=[];
  const client={
    query:async(sql,params=[])=>{
      calls.push({sql,params});
      if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return{rowCount:0,rows:[]};
      if(sql.includes('FROM profile_business_bindings'))return{rowCount:1,rows:[{business_id:14}]};
      if(sql.includes('SELECT id FROM merchant_purchase_documents'))return{rowCount:1,rows:[{id:23}]};
      if(sql.includes('INSERT INTO merchant_purchase_document_evidence')){
        assert.deepEqual(params.slice(0,5),[23,14,9,record.key,record.fingerprint]);
        return{rowCount:1,rows:[{id:501,document_id:23,business_id:14,created_at:new Date('2026-11-13T12:00:00.000Z')}]};
      }
      throw new Error('Unexpected supplementary evidence SQL '+sql);
    },
    release:error=>{if(error)throw error}
  };
  const pool={
    query:async(sql,params)=>{
      assert.match(sql,/merchant_purchase_document_evidence/);
      assert.deepEqual(params,[23,14,record.key]);
      return{rowCount:0,rows:[]};
    },
    connect:async()=>client
  };
  const result=await merchantPurchaseDocumentInternals.appendPurchaseDocumentEvidence(pool,{
    actorAccountId:9,businessId:14,documentId:23,record,
    storeEvidence:async(db,input)=>{
      assert.equal(db,pool);
      assert.equal(input.sourceType,'merchant_purchase_document_attachment_pending');
      assert.equal(input.sourceId,'23:'+record.key);
      assert.equal(input.maxBytes,MERCHANT_PURCHASE_FILE_MAX_BYTES);
      return{id:777,original_file_name:record.fileName,detected_mime:'image/png',byte_size:68};
    },
    bindEvidence:async(db,input)=>bound.push({db,input}),
    deleteEvidence:async(db,input)=>deleted.push(input)
  });
  assert.equal(result.already_saved,false);
  assert.deepEqual(result.evidence,{
    id:501,document_id:23,business_id:14,file_name:'supplier-slip.png',
    mime_type:'image/png',byte_size:68,created_at:'2026-11-13T12:00:00.000Z'
  });
  assert.equal(bound.length,1);
  assert.equal(bound[0].db,client);
  assert.equal(bound[0].input.objectId,777);
  assert.equal(bound[0].input.sourceType,'merchant_purchase_document_attachment');
  assert.equal(bound[0].input.sourceId,'501');
  assert.equal(deleted.length,0);
  assert.ok(calls.some(x=>x.sql.includes('FOR SHARE OF pb,bm')),'current Merchant grant is locked');
  assert.ok(calls.some(x=>x.sql.includes('FOR UPDATE')),'exact receipt is locked');
  assert.ok(calls.at(-1).sql==='COMMIT');
  assert.ok(!calls.some(x=>/inventory_purchases|transactions|UPDATE merchant_purchase_documents/i.test(x.sql)),
    'supplementary evidence never changes original receipt, stock or financial records');
});

test('supplementary evidence replay reauthorizes, returns the same attachment and rejects a changed file',async()=>{
  const {merchantPurchaseDocumentInternals}=await import('../merchant-purchase-documents.js');
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2s5YAAAAASUVORK5CYII=';
  const input={client_request_key:'supporting-20261113-003',file_name:'supplier-slip.png',data_url:png};
  const record=normalizeMerchantPurchaseDocumentEvidence(input,{businessId:14,documentId:23});
  const existing={id:501,document_id:23,business_id:14,request_fingerprint:record.fingerprint,
    file_name:input.file_name,mime_type:'image/png',byte_size:68,created_at:new Date('2026-11-13T12:00:00.000Z')};
  let stored=0,commits=0;
  const pool={
    query:async()=>({rowCount:1,rows:[{id:501}]}),
    connect:async()=>({
      query:async(sql)=>{
        if(sql==='BEGIN'||sql==='ROLLBACK')return{rowCount:0,rows:[]};
        if(sql==='COMMIT'){commits++;return{rowCount:0,rows:[]};}
        if(sql.includes('FROM profile_business_bindings'))return{rowCount:1,rows:[{business_id:14}]};
        if(sql.includes('SELECT id FROM merchant_purchase_documents'))return{rowCount:1,rows:[{id:23}]};
        if(sql.includes('FROM merchant_purchase_document_evidence e'))return{rowCount:1,rows:[existing]};
        throw new Error('Unexpected replay SQL '+sql);
      },
      release:error=>{if(error)throw error}
    })
  };
  const options={actorAccountId:9,businessId:14,documentId:23,record,
    storeEvidence:async()=>{stored++;throw new Error('Replay must not upload another file')}};
  const replay=await merchantPurchaseDocumentInternals.appendPurchaseDocumentEvidence(pool,options);
  assert.equal(replay.already_saved,true);
  assert.equal(replay.evidence.id,501);
  assert.equal(stored,0);
  assert.equal(commits,1);
  const changed=normalizeMerchantPurchaseDocumentEvidence({...input,file_name:'different.png'},{businessId:14,documentId:23});
  await assert.rejects(()=>merchantPurchaseDocumentInternals.appendPurchaseDocumentEvidence(pool,{...options,record:changed}),
    error=>error.status===409);
  assert.equal(stored,0,'a conflicting key is rejected before another upload');
});

test('supplementary evidence is removed when the post-upload Merchant grant or receipt check fails',async()=>{
  const {merchantPurchaseDocumentInternals}=await import('../merchant-purchase-documents.js');
  const record=normalizeMerchantPurchaseDocumentEvidence({
    client_request_key:'supporting-20261113-004',file_name:'supplier-slip.png',
    data_url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2s5YAAAAASUVORK5CYII='
  },{businessId:14,documentId:23});
  let deleted=0;
  const client={
    query:async(sql)=>{
      if(sql==='BEGIN'||sql==='ROLLBACK')return{rowCount:0,rows:[]};
      if(sql.includes('FROM profile_business_bindings'))return{rowCount:0,rows:[]};
      throw new Error('Receipt row must not be read after grant revocation');
    },
    release:error=>{if(error)throw error}
  };
  const pool={query:async()=>({rowCount:0,rows:[]}),connect:async()=>client};
  await assert.rejects(()=>merchantPurchaseDocumentInternals.appendPurchaseDocumentEvidence(pool,{
    actorAccountId:9,businessId:14,documentId:23,record,
    storeEvidence:async()=>({id:777,original_file_name:record.fileName,detected_mime:'image/png',byte_size:68}),
    bindEvidence:async()=>{throw new Error('Must not bind after revoked grant')},
    deleteEvidence:async(db,input)=>{assert.equal(input.objectId,777);deleted++}
  }),error=>error.status===403);
  assert.equal(deleted,1,'uncommitted private upload is cleaned after the grant check fails');
});
