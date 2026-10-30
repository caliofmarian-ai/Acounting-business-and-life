import crypto from 'node:crypto';
import {supplierDomainV2Internals} from './server-supplier-domain-v2.js';
import {
  ensurePrivateEvidenceSchema,storePrivateEvidence,bindPrivateEvidenceSource,
  readPrivateEvidence,sendPrivateEvidence,deletePrivateEvidence
} from './private-evidence-core.js';

const {exactProfileBusiness}=supplierDomainV2Internals;
const clean=(value,max=300)=>String(value??'').trim().slice(0,max);
const error=(status,message)=>Object.assign(new Error(message),{status});
const positiveId=(value,label='Identifier')=>{
  const id=Number(value);
  if(!Number.isSafeInteger(id)||id<1)throw error(400,label+' must be a positive integer');
  return id;
};
const allowedKinds=new Set(['invoice','purchase_receipt','order_slip','other']);
const linkTables=Object.freeze({
  inventory_purchase:'inventory_purchases',
  purchase_order:'purchase_orders',
  supplier_invoice:'purchase_invoice_evidence',
  expense_transaction:'transactions'
});
const fileTypes=['image/jpeg','image/png','image/webp','application/pdf'];
export const MERCHANT_PURCHASE_FILE_MAX_BYTES=6*1024*1024;

export function normalizeMerchantPurchaseDocument(input={}){
  const businessId=positiveId(input.business_id,'business_id');
  const key=clean(input.client_request_key,100);
  if(!/^[a-zA-Z0-9_-]{12,100}$/.test(key))throw error(400,'A stable client_request_key is required');
  const kind=clean(input.document_kind||'purchase_receipt',40).toLowerCase();
  if(!allowedKinds.has(kind))throw error(400,'Invalid purchase document kind');
  const issueDate=clean(input.issue_date||new Date().toISOString().slice(0,10),10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)||Number.isNaN(Date.parse(issueDate))||new Date(issueDate).toISOString().slice(0,10)!==issueDate)throw error(400,'Invalid issue date');
  const currency=clean(input.currency_code||'PHP',3).toUpperCase();
  if(!/^[A-Z]{3}$/.test(currency))throw error(400,'Invalid currency');
  const amount=input.gross_amount==null||input.gross_amount===''?null:Number(input.gross_amount);
  if(amount!==null&&(!Number.isFinite(amount)||amount<0||amount>1e12))throw error(400,'Invalid document amount');
  const links=Array.isArray(input.links)?input.links:[];
  if(links.length>100)throw error(400,'A document can link at most 100 purchase records');
  const unique=new Set();
  const normalizedLinks=links.map(item=>{
    const kind=clean(item?.kind,32),id=positiveId(item?.id,'Linked record');
    if(!Object.hasOwn(linkTables,kind))throw error(400,'Unsupported purchase record link');
    const key=kind+':'+id;
    if(unique.has(key))throw error(400,'Duplicate linked purchase record');
    unique.add(key);
    return{kind,id};
  });
  const dataUrl=clean(input.data_url,9*1024*1024);
  const fileName=clean(input.file_name,220);
  if(dataUrl&&!fileName)throw error(400,'File name is required for uploaded evidence');
  if(dataUrl&&!/^data:(image\/jpeg|image\/png|image\/webp|application\/pdf);base64,/i.test(dataUrl))throw error(400,'Only JPEG, PNG, WEBP or PDF files are accepted');
  if(dataUrl.length>8*1024*1024+100)throw error(413,'Evidence file is too large');
  if(fileName&&!dataUrl)throw error(400,'An uploaded file must contain evidence data');
  return{
    businessId,key,kind,issueDate,currency,amount,
    issuer:clean(input.issuer_name,180),
    documentNumber:clean(input.document_number,120),
    note:clean(input.note,1000),
    links:normalizedLinks,dataUrl,fileName
  };
}

export async function ensureMerchantPurchaseDocumentSchema(pool){
  await ensurePrivateEvidenceSchema(pool);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS merchant_purchase_documents(
      id BIGSERIAL PRIMARY KEY,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
      created_by_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      client_request_key TEXT NOT NULL,
      request_fingerprint TEXT NOT NULL,
      document_kind TEXT NOT NULL,
      issuer_name TEXT NOT NULL DEFAULT '',
      document_number TEXT NOT NULL DEFAULT '',
      issue_date DATE NOT NULL,
      currency_code CHAR(3) NOT NULL DEFAULT 'PHP',
      gross_amount NUMERIC(14,2),
      note TEXT NOT NULL DEFAULT '',
      private_evidence_object_id BIGINT REFERENCES private_evidence_objects(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(document_kind IN ('invoice','purchase_receipt','order_slip','other')),
      CHECK(gross_amount IS NULL OR gross_amount>=0),
      UNIQUE(business_id,client_request_key)
    );
    CREATE INDEX IF NOT EXISTS merchant_purchase_documents_scope_idx
      ON merchant_purchase_documents(business_id,issue_date DESC,id DESC);
    CREATE TABLE IF NOT EXISTS merchant_purchase_document_links(
      document_id BIGINT NOT NULL REFERENCES merchant_purchase_documents(id) ON DELETE RESTRICT,
      link_kind TEXT NOT NULL,
      linked_id BIGINT NOT NULL,
      PRIMARY KEY(document_id,link_kind,linked_id),
      CHECK(link_kind IN ('inventory_purchase','purchase_order','supplier_invoice','expense_transaction'))
    );
  `);
}

async function requireMerchantDocumentBusiness(pool,identity,req,source='query'){
  const me=await identity(req);
  const requestedId=source==='body'?req.body?.business_id:req.query?.business_id;
  const businessId=positiveId(requestedId,'business_id');
  const business=await exactProfileBusiness(pool,me,'merchant',businessId);
  return{me,businessId:Number(business.id)};
}

async function validatePurchaseLinks(db,businessId,links){
  for(const link of links){
    const table=linkTables[link.kind];
    const extra=link.kind==='expense_transaction'?" AND type='business_expense'":'';
    const result=await db.query('SELECT 1 FROM '+table+' WHERE id=$1 AND business_id=$2'+extra,[link.id,businessId]);
    if(!result.rowCount)throw error(404,'Linked purchase record unavailable in this Merchant workspace');
  }
}

const shape=row=>({
  id:Number(row.id),business_id:Number(row.business_id),document_kind:row.document_kind,
  issuer_name:row.issuer_name,document_number:row.document_number,issue_date:row.issue_date,
  currency_code:row.currency_code,gross_amount:row.gross_amount==null?null:Number(row.gross_amount),
  note:row.note,has_attachment:row.private_evidence_object_id!=null,created_at:row.created_at
});

async function scopedDocument(pool,id,businessId){
  const q=await pool.query('SELECT * FROM merchant_purchase_documents WHERE id=$1 AND business_id=$2',[positiveId(id),businessId]);
  if(!q.rowCount)throw error(404,'Purchase document not found');
  return q.rows[0];
}

async function savePurchaseDocument(pool,{actorAccountId,record}){
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify({
    kind:record.kind,issueDate:record.issueDate,currency:record.currency,amount:record.amount,
    issuer:record.issuer,number:record.documentNumber,note:record.note,
    links:record.links,fileName:record.fileName,
    fileDigest:record.dataUrl?crypto.createHash('sha256').update(record.dataUrl).digest('hex'):''
  })).digest('hex');
  const existing=await pool.query(
    'SELECT * FROM merchant_purchase_documents WHERE business_id=$1 AND client_request_key=$2',
    [record.businessId,record.key]
  );
  if(existing.rowCount){
    if(existing.rows[0].request_fingerprint!==fingerprint)throw error(409,'This request key already belongs to a different receipt');
    return{document:shape(existing.rows[0]),already_saved:true};
  }

  await validatePurchaseLinks(pool,record.businessId,record.links);
  let evidence=null,client=null;
  try{
    if(record.dataUrl){
      evidence=await storePrivateEvidence(pool,{
        dataUrl:record.dataUrl,fileName:record.fileName,
        allowedMimes:fileTypes,maxBytes:MERCHANT_PURCHASE_FILE_MAX_BYTES,
        ownerAccountId:actorAccountId,actorAccountId,
        sourceType:'merchant_purchase_document',sourceId:'pending',
        purpose:'purchase_accounting_original',classification:'purchase_accounting'
      });
    }
    client=await pool.connect();
    await client.query('BEGIN');
    await validatePurchaseLinks(client,record.businessId,record.links);
    const added=await client.query(`
      INSERT INTO merchant_purchase_documents(
        business_id,created_by_account_id,client_request_key,request_fingerprint,
        document_kind,issuer_name,document_number,issue_date,currency_code,gross_amount,
        note,private_evidence_object_id
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT(business_id,client_request_key) DO NOTHING
      RETURNING *
    `,[
      record.businessId,actorAccountId,record.key,fingerprint,
      record.kind,record.issuer,record.documentNumber,record.issueDate,
      record.currency,record.amount,record.note,evidence?.id||null
    ]);
    if(!added.rowCount){
      const saved=await client.query(
        'SELECT * FROM merchant_purchase_documents WHERE business_id=$1 AND client_request_key=$2',
        [record.businessId,record.key]
      );
      if(saved.rows[0]?.request_fingerprint!==fingerprint)throw error(409,'This request key already belongs to a different receipt');
      await client.query('COMMIT');
      if(evidence)await deletePrivateEvidence(pool,{objectId:evidence.id,actorAccountId,purpose:'duplicate_upload_cleanup'});
      return{document:shape(saved.rows[0]),already_saved:true};
    }
    const document=added.rows[0];
    for(const link of record.links){
      await client.query(
        'INSERT INTO merchant_purchase_document_links(document_id,link_kind,linked_id) VALUES($1,$2,$3)',
        [document.id,link.kind,link.id]
      );
    }
    if(evidence)await bindPrivateEvidenceSource(client,{
      objectId:evidence.id,sourceType:'merchant_purchase_document',
      sourceId:String(document.id),actorAccountId,purpose:'purchase_accounting_bind'
    });
    await client.query('COMMIT');
    return{document:shape(document),already_saved:false};
  }catch(e){
    if(client)await client.query('ROLLBACK').catch(()=>{});
    if(evidence)await deletePrivateEvidence(pool,{objectId:evidence.id,actorAccountId,purpose:'failed_purchase_receipt_cleanup'}).catch(()=>{});
    throw e;
  }finally{client?.release()}
}

export function registerMerchantPurchaseDocumentRoutes({app,pool,body,identity}){
  app.get('/api/procurement/purchase-documents/linkable-purchases',async(req,res,next)=>{
    try{
      const {businessId}=await requireMerchantDocumentBusiness(pool,identity,req);
      const q=await pool.query(`
        SELECT p.id,p.created_at,p.total_cost,p.purchase_quantity,p.purchase_unit,
               p.transaction_id,i.item inventory_name
          FROM inventory_purchases p JOIN inventory i ON i.id=p.inventory_id
         WHERE p.business_id=$1 AND i.business_id=$1
         ORDER BY p.created_at DESC,p.id DESC LIMIT 100
      `,[businessId]);
      res.json({purchases:q.rows});
    }catch(e){next(e)}
  });

  app.get('/api/procurement/purchase-documents',async(req,res,next)=>{
    try{
      const {businessId}=await requireMerchantDocumentBusiness(pool,identity,req);
      const q=await pool.query(
        'SELECT * FROM merchant_purchase_documents WHERE business_id=$1 ORDER BY issue_date DESC,id DESC LIMIT 300',
        [businessId]
      );
      res.json({documents:q.rows.map(shape)});
    }catch(e){next(e)}
  });

  app.post('/api/procurement/purchase-documents',body,async(req,res,next)=>{
    try{
      const {me,businessId}=await requireMerchantDocumentBusiness(pool,identity,req,'body');
      const record=normalizeMerchantPurchaseDocument(req.body||{});
      if(record.businessId!==businessId)throw error(403,'Merchant business mismatch');
      const outcome=await savePurchaseDocument(pool,{actorAccountId:me.account.id,record});
      res.status(outcome.already_saved?200:201).json(outcome);
    }catch(e){next(e)}
  });

  app.get('/api/procurement/purchase-documents/:id',async(req,res,next)=>{
    try{
      const {businessId}=await requireMerchantDocumentBusiness(pool,identity,req);
      const doc=await scopedDocument(pool,req.params.id,businessId);
      const links=await pool.query(
        'SELECT link_kind kind,linked_id id FROM merchant_purchase_document_links WHERE document_id=$1 ORDER BY link_kind,linked_id',
        [doc.id]
      );
      res.json({document:shape(doc),links:links.rows});
    }catch(e){next(e)}
  });

  app.get('/api/procurement/purchase-documents/:id/file',async(req,res,next)=>{
    try{
      const {me,businessId}=await requireMerchantDocumentBusiness(pool,identity,req);
      const doc=await scopedDocument(pool,req.params.id,businessId);
      if(!doc.private_evidence_object_id)throw error(404,'No scanned original is attached');
      const file=await readPrivateEvidence(pool,{
        objectId:doc.private_evidence_object_id,actorAccountId:me.account.id,
        purpose:'merchant_purchase_document_download'
      });
      sendPrivateEvidence(res,file);
    }catch(e){next(e)}
  });
}

export const merchantPurchaseDocumentInternals={validatePurchaseLinks,savePurchaseDocument};
