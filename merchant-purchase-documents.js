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
  // Record/business identity is never Number()-coerced from booleans, arrays or exponent strings.
  if((typeof value!=='number'&&typeof value!=='string')||
     (typeof value==='string'&&!/^\d+$/.test(value))){
    throw error(400,label+' must be a positive integer');
  }
  const id=Number(value);
  if(!Number.isSafeInteger(id)||id<1)throw error(400,label+' must be a positive integer');
  return id;
};
// Optional receipt evidence is normalized only after checking the ENTIRE supplied
// value. Silent truncation/coercion would seal different source records under
// the same client-intent fingerprint and make a retry impossible to repair.
const evidenceField=(value,max,label)=>{
  if(value==null)return '';
  if(typeof value!=='string')throw error(400,label+' must be a string');
  if(value.length>max)throw error(400,label+' exceeds supported length');
  return value.trim();
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

// The Philippines uses UTC+08 year-round; the server may run on UTC.
export function philippinesPurchaseDocumentDate(instant=new Date()){
  const t=instant instanceof Date?instant.getTime():NaN;
  if(!Number.isFinite(t))throw error(400,'Invalid purchase document clock');
  const ph=new Date(t+28800000);
  if(!Number.isFinite(ph.getTime()))throw error(400,'Invalid purchase document clock');
  return ph.toISOString().slice(0,10);
}

export function normalizeMerchantPurchaseDocument(input={}){
  const businessId=positiveId(input.business_id,'business_id');
  // Never truncate an intent identifier: distinct overlong keys must not alias.
  const key=input.client_request_key;
  if(typeof key!=='string'||!/^[a-zA-Z0-9_-]{12,100}$/.test(key)){
    throw error(400,'A stable client_request_key is required');
  }
  const kind=(input.document_kind==null||input.document_kind===''?'purchase_receipt':
    evidenceField(input.document_kind,40,'Document kind')).toLowerCase();
  if(!allowedKinds.has(kind))throw error(400,'Invalid purchase document kind');
  // Validate the *entire* submitted date: never turn a malformed date into a valid one by truncation.
  const issueDate=input.issue_date==null||input.issue_date===''?philippinesPurchaseDocumentDate():input.issue_date;
  if(typeof issueDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)||issueDate.startsWith('0000-')||Number.isNaN(Date.parse(issueDate))||new Date(issueDate).toISOString().slice(0,10)!==issueDate)throw error(400,'Invalid issue date');
  // Validate the entire code, not its first three characters (PHPOOPS is not PHP).
  const rawCurrency=input.currency_code==null||input.currency_code===''?'PHP':input.currency_code;
  const currency=typeof rawCurrency==='string'?rawCurrency.trim().toUpperCase():'';
  if(!/^[A-Z]{3}$/.test(currency))throw error(400,'Invalid currency');
  // PostgreSQL NUMERIC(14,2) must not silently round or reject a value accepted by the API.
  // Keep Number for backward-compatible request fingerprints on previously valid receipts.
  const rawAmount=input.gross_amount;
  if(rawAmount!==null&&rawAmount!==undefined&&rawAmount!==''&&
     (typeof rawAmount!=='number'&&typeof rawAmount!=='string'||Object.is(rawAmount,-0)))throw error(400,'Invalid document amount');
  const amountText=rawAmount==null||rawAmount===''?null:String(rawAmount);
  if(amountText!==null&&!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(amountText))throw error(400,'Invalid document amount');
  const amount=amountText===null?null:Number(amountText);
  if(amount!==null&&(!Number.isFinite(amount)||amount>=1e12))throw error(400,'Invalid document amount');
  // A malformed supplied association must not be silently dropped and then sealed by the intent key.
  if(input.links!=null&&!Array.isArray(input.links))throw error(400,'Purchase links must be an array');
  const links=input.links??[];
  if(links.length>100)throw error(400,'A document can link at most 100 purchase records');
  const unique=new Set();
  const normalizedLinks=links.map(item=>{
    const kind=evidenceField(item?.kind,32,'Linked record kind'),id=positiveId(item?.id,'Linked record');
    if(!Object.hasOwn(linkTables,kind))throw error(400,'Unsupported purchase record link');
    const key=kind+':'+id;
    if(unique.has(key))throw error(400,'Duplicate linked purchase record');
    unique.add(key);
    return{kind,id};
  });
  // Do not coerce supplied evidence metadata (e.g. [] to '') into an apparently attachment-free receipt.
  if(input.data_url!=null&&typeof input.data_url!=='string')throw error(400,'Evidence data must be a string');
  if(input.file_name!=null&&typeof input.file_name!=='string')throw error(400,'File name must be a string');
  const dataUrl=clean(input.data_url,9*1024*1024);
  const fileName=evidenceField(input.file_name,220,'File name');
  if(dataUrl&&!fileName)throw error(400,'File name is required for uploaded evidence');
  if(dataUrl&&!/^data:(image\/jpeg|image\/png|image\/webp|application\/pdf);base64,/i.test(dataUrl))throw error(400,'Only JPEG, PNG, WEBP or PDF files are accepted');
  if(dataUrl.length>8*1024*1024+100)throw error(413,'Evidence file is too large');
  if(fileName&&!dataUrl)throw error(400,'An uploaded file must contain evidence data');
  return{
    businessId,key,kind,issueDate,currency,amount,
    issuer:evidenceField(input.issuer_name,180,'Issuer name'),
    documentNumber:evidenceField(input.document_number,120,'Document number'),
    note:evidenceField(input.note,1000,'Document note'),
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
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(document_kind IN ('invoice','purchase_receipt','order_slip','other')),
      CHECK(gross_amount IS NULL OR gross_amount>=0),
      UNIQUE(business_id,client_request_key)
    );
    CREATE INDEX IF NOT EXISTS merchant_purchase_documents_scope_idx
      ON merchant_purchase_documents(business_id,issue_date DESC,id DESC);
    ALTER TABLE merchant_purchase_documents
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    CREATE TABLE IF NOT EXISTS merchant_purchase_document_links(
      document_id BIGINT NOT NULL REFERENCES merchant_purchase_documents(id) ON DELETE RESTRICT,
      link_kind TEXT NOT NULL,
      linked_id BIGINT NOT NULL,
      PRIMARY KEY(document_id,link_kind,linked_id),
      CHECK(link_kind IN ('inventory_purchase','purchase_order','supplier_invoice','expense_transaction'))
    );
    CREATE TABLE IF NOT EXISTS merchant_purchase_document_metadata_audit(
      id BIGSERIAL PRIMARY KEY,
      document_id BIGINT NOT NULL REFERENCES merchant_purchase_documents(id) ON DELETE RESTRICT,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
      actor_account_id BIGINT NOT NULL,
      before_metadata JSONB NOT NULL,
      after_metadata JSONB NOT NULL,
      changed_fields TEXT[] NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS merchant_purchase_document_metadata_audit_idx
      ON merchant_purchase_document_metadata_audit(business_id,document_id,id DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS merchant_purchase_documents_id_business_unique
      ON merchant_purchase_documents(id,business_id);
    CREATE TABLE IF NOT EXISTS merchant_purchase_document_evidence(
      id BIGSERIAL PRIMARY KEY,
      document_id BIGINT NOT NULL,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
      created_by_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      client_request_key TEXT NOT NULL,
      request_fingerprint TEXT NOT NULL CHECK(request_fingerprint ~ '^[a-f0-9]{64}$'),
      private_evidence_object_id BIGINT NOT NULL UNIQUE REFERENCES private_evidence_objects(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      FOREIGN KEY(document_id,business_id)
        REFERENCES merchant_purchase_documents(id,business_id) ON DELETE RESTRICT,
      UNIQUE(document_id,client_request_key)
    );
    CREATE INDEX IF NOT EXISTS merchant_purchase_document_evidence_scope_idx
      ON merchant_purchase_document_evidence(business_id,document_id,id);
  `);
}

async function requireMerchantDocumentBusiness(pool,identity,req,source='query'){
  const me=await identity(req);
  const requestedId=source==='body'?req.body?.business_id:req.query?.business_id;
  const businessId=positiveId(requestedId,'business_id');
  const business=await exactProfileBusiness(pool,me,'merchant',businessId);
  return{me,businessId:Number(business.id)};
}

// The first preflight may use the pool; the final pre-insert verification
// holds share locks on the linked source rows through the receipt COMMIT.
// A concurrent business reassignment or deletion cannot outrun that check.
async function validatePurchaseLinks(db,businessId,links,{lockRows=false}={}){
  for(const link of links){
    const table=linkTables[link.kind];
    const extra=link.kind==='expense_transaction'?" AND type='business_expense'":'';
    const result=await db.query('SELECT 1 FROM '+table+' WHERE id=$1 AND business_id=$2'+extra+(lockRows?' FOR SHARE':''),[link.id,businessId]);
    if(!result.rowCount)throw error(404,'Linked purchase record unavailable in this Merchant workspace');
  }
}

const shape=row=>({
  id:Number(row.id),business_id:Number(row.business_id),document_kind:row.document_kind,
  issuer_name:row.issuer_name,document_number:row.document_number,issue_date:row.issue_date,
  currency_code:row.currency_code,gross_amount:row.gross_amount==null?null:Number(row.gross_amount),
  note:row.note,has_attachment:row.private_evidence_object_id!=null,created_at:row.created_at,
  updated_at:row.updated_at?new Date(row.updated_at).toISOString():null
});

async function scopedDocument(pool,id,businessId){
  const q=await pool.query('SELECT * FROM merchant_purchase_documents WHERE id=$1 AND business_id=$2',[positiveId(id),businessId]);
  if(!q.rowCount)throw error(404,'Purchase document not found');
  return q.rows[0];
}

// Lock the *current* Merchant grant after scanning and before the final write.
// FOR SHARE serializes a simultaneous binding/membership revocation with receipt commit.
// The initial request authorization alone is not sufficient across a slow private upload.
async function lockMerchantDocumentWriteAuthority(db,actorAccountId,businessId){
  const allowed=await db.query(`
    SELECT pb.business_id FROM profile_business_bindings pb
      JOIN business_memberships bm
        ON bm.business_id=pb.business_id AND bm.account_id=pb.account_id
     WHERE pb.account_id=$1 AND pb.role='merchant' AND pb.business_id=$2
       AND pb.status='active' AND bm.active=TRUE
     FOR SHARE OF pb,bm
  `,[actorAccountId,businessId]);
  if(!allowed.rowCount)throw error(403,'Merchant purchase document access changed; retry after authorization');
}

const metadataFields=Object.freeze([
  'document_kind','issuer_name','document_number','issue_date','currency_code','gross_amount','note'
]);

function metadataDate(value){
  if(value instanceof Date)return value.toISOString().slice(0,10);
  return String(value??'').slice(0,10);
}
function metadataAmount(value){
  if(value==null||value==='')return null;
  const text=String(value);
  if(!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(text))throw error(400,'Invalid document amount');
  const [whole,fraction='']=text.split('.');
  return whole+'.'+fraction.padEnd(2,'0');
}
function metadataSnapshot(row){
  return{
    document_kind:row.document_kind,
    issuer_name:row.issuer_name,
    document_number:row.document_number,
    issue_date:metadataDate(row.issue_date),
    currency_code:String(row.currency_code||'').trim(),
    gross_amount:metadataAmount(row.gross_amount),
    note:row.note
  };
}
function exactTimestamp(value,label){
  if(typeof value!=='string')throw error(400,label+' must be an ISO timestamp');
  const parsed=new Date(value);
  if(!Number.isFinite(parsed.getTime())||parsed.toISOString()!==value)throw error(400,label+' must be an ISO timestamp');
  return parsed.toISOString();
}

export function normalizeMerchantPurchaseDocumentMetadata(row,input={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw error(400,'Purchase document metadata must be an object');
  const allowed=new Set([...metadataFields,'expected_updated_at']);
  if(Object.keys(input).some(key=>!allowed.has(key)))throw error(400,'Only purchase document metadata can be edited');
  const expectedUpdatedAt=exactTimestamp(input.expected_updated_at,'expected_updated_at');
  const current=metadataSnapshot(row);
  const value=field=>Object.hasOwn(input,field)?input[field]:current[field];
  const normalized=normalizeMerchantPurchaseDocument({
    business_id:row.business_id,
    client_request_key:row.client_request_key,
    document_kind:value('document_kind'),
    issuer_name:value('issuer_name'),
    document_number:value('document_number'),
    issue_date:value('issue_date'),
    currency_code:value('currency_code'),
    gross_amount:value('gross_amount'),
    note:value('note'),
    links:[]
  });
  return{
    expectedUpdatedAt,
    metadata:{
      document_kind:normalized.kind,
      issuer_name:normalized.issuer,
      document_number:normalized.documentNumber,
      issue_date:normalized.issueDate,
      currency_code:normalized.currency,
      gross_amount:metadataAmount(normalized.amount),
      note:normalized.note
    }
  };
}

async function updatePurchaseDocumentMetadata(pool,{actorAccountId,businessId,documentId,input}){
  const id=positiveId(documentId,'Document identifier');
  let client=null,transactionStarted=false,commitAttempted=false,connectionUnsafe=false;
  try{
    client=await pool.connect();
    try{await client.query('BEGIN');transactionStarted=true}
    catch(e){connectionUnsafe=true;throw e}
    await lockMerchantDocumentWriteAuthority(client,actorAccountId,businessId);
    const selected=await client.query(
      'SELECT * FROM merchant_purchase_documents WHERE id=$1 AND business_id=$2 FOR UPDATE',
      [id,businessId]
    );
    if(!selected.rowCount)throw error(404,'Purchase document not found');
    const row=selected.rows[0];
    const normalized=normalizeMerchantPurchaseDocumentMetadata(row,input);
    const before=metadataSnapshot(row),after=normalized.metadata;
    const changedFields=metadataFields.filter(field=>before[field]!==after[field]);
    const currentVersion=exactTimestamp(new Date(row.updated_at||row.created_at).toISOString(),'stored updated_at');
    // A lost PATCH acknowledgement can be retried with the same old version.
    // If the exact requested metadata is already present, acknowledge it without
    // adding another audit revision; a different concurrent edit fails closed.
    if(!changedFields.length){
      commitAttempted=true;await client.query('COMMIT');transactionStarted=false;
      return{document:shape(row),already_applied:true};
    }
    if(currentVersion!==normalized.expectedUpdatedAt)throw error(409,'Purchase document changed. Refresh its details before editing again.');
    const updated=await client.query(
      'UPDATE merchant_purchase_documents\n'+
      '   SET document_kind=$3,issuer_name=$4,document_number=$5,issue_date=$6,\n'+
      '       currency_code=$7,gross_amount=$8,note=$9,updated_at=GREATEST(clock_timestamp(),updated_at+INTERVAL '1 millisecond')\n'+
      ' WHERE id=$1 AND business_id=$2\n'+
      ' RETURNING *',
      [id,businessId,after.document_kind,after.issuer_name,after.document_number,
        after.issue_date,after.currency_code,after.gross_amount,after.note]);
    if(!updated.rowCount)throw error(404,'Purchase document not found');
    await client.query(
      'INSERT INTO merchant_purchase_document_metadata_audit(\n'+
      '  document_id,business_id,actor_account_id,before_metadata,after_metadata,changed_fields\n'+
      ') VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6::text[])',
      [id,businessId,actorAccountId,JSON.stringify(before),JSON.stringify(after),changedFields]);
    commitAttempted=true;await client.query('COMMIT');transactionStarted=false;
    return{document:shape(updated.rows[0]),already_applied:false};
  }catch(e){
    if(commitAttempted)connectionUnsafe=true;
    if(transactionStarted){
      try{await client.query('ROLLBACK');transactionStarted=false}
      catch{connectionUnsafe=true}
    }
    throw e;
  }finally{
    client?.release(connectionUnsafe?new Error('UNSAFE_PURCHASE_DOCUMENT_METADATA_DB_CLIENT'):undefined);
  }
}


export function normalizeMerchantPurchaseDocumentEvidence(input={},context={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw error(400,'Supplementary evidence must be an object');
  const allowed=new Set(['client_request_key','file_name','data_url']);
  if(Object.keys(input).some(key=>!allowed.has(key)))throw error(400,'Only supplementary evidence fields are accepted');
  const key=input.client_request_key;
  if(typeof key!=='string'||!/^[a-zA-Z0-9_-]{12,100}$/.test(key)){
    throw error(400,'A stable supplementary evidence request key is required');
  }
  const fileName=evidenceField(input.file_name,220,'Supplementary evidence file name');
  if(!fileName)throw error(400,'A file name is required for supplementary evidence');
  const dataUrl=input.data_url;
  if(typeof dataUrl!=='string'||!dataUrl)throw error(400,'Supplementary evidence data is required');
  if(!/^data:(image\/jpeg|image\/png|image\/webp|application\/pdf);base64,/i.test(dataUrl)){
    throw error(400,'Only JPEG, PNG, WEBP or PDF files are accepted');
  }
  if(dataUrl.length>8*1024*1024+100)throw error(413,'Supplementary evidence file is too large');
  const businessId=positiveId(context.businessId,'business_id');
  const documentId=positiveId(context.documentId,'Document identifier');
  const dataDigest=crypto.createHash('sha256').update(dataUrl).digest('hex');
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify({
    businessId,documentId,key,fileName,dataDigest
  })).digest('hex');
  return{businessId,documentId,key,fileName,dataUrl,fingerprint};
}

function shapeSupplementaryEvidence(row){
  return{
    id:Number(row.id),document_id:Number(row.document_id),business_id:Number(row.business_id),
    file_name:String(row.file_name||''),mime_type:String(row.mime_type||''),
    byte_size:Number(row.byte_size),created_at:new Date(row.created_at).toISOString()
  };
}

async function findSupplementaryEvidence(db,record){
  const q=await db.query(`
    SELECT e.id,e.document_id,e.business_id,e.request_fingerprint,e.created_at,
           p.original_file_name file_name,p.detected_mime mime_type,p.byte_size
      FROM merchant_purchase_document_evidence e
      JOIN private_evidence_objects p ON p.id=e.private_evidence_object_id
       AND p.owner_account_id=e.created_by_account_id
       AND p.source_type='merchant_purchase_document_attachment'
       AND p.source_id=e.id::text
     WHERE e.document_id=$1 AND e.business_id=$2 AND e.client_request_key=$3
  `,[record.documentId,record.businessId,record.key]);
  return q.rows[0]||null;
}

async function replaySupplementaryEvidence(pool,{actorAccountId,record}){
  let client=null,transactionStarted=false,commitAttempted=false,connectionUnsafe=false;
  try{
    client=await pool.connect();
    try{await client.query('BEGIN');transactionStarted=true}
    catch(e){connectionUnsafe=true;throw e}
    await lockMerchantDocumentWriteAuthority(client,actorAccountId,record.businessId);
    const doc=await client.query(
      'SELECT id FROM merchant_purchase_documents WHERE id=$1 AND business_id=$2 FOR UPDATE',
      [record.documentId,record.businessId]
    );
    if(!doc.rowCount)throw error(404,'Purchase document not found');
    const existing=await findSupplementaryEvidence(client,record);
    if(!existing){
      commitAttempted=true;await client.query('COMMIT');transactionStarted=false;
      return null;
    }
    if(existing.request_fingerprint!==record.fingerprint){
      throw error(409,'This evidence request key already belongs to a different file');
    }
    commitAttempted=true;await client.query('COMMIT');transactionStarted=false;
    return{evidence:shapeSupplementaryEvidence(existing),already_saved:true};
  }catch(e){
    if(commitAttempted)connectionUnsafe=true;
    if(transactionStarted){
      try{await client.query('ROLLBACK');transactionStarted=false}
      catch{connectionUnsafe=true}
    }
    throw e;
  }finally{
    client?.release(connectionUnsafe?new Error('UNSAFE_PURCHASE_DOCUMENT_EVIDENCE_DB_CLIENT'):undefined);
  }
}

async function appendPurchaseDocumentEvidence(pool,{
  actorAccountId,businessId,documentId,record,
  storeEvidence=storePrivateEvidence,bindEvidence=bindPrivateEvidenceSource,deleteEvidence=deletePrivateEvidence
}){
  if(record.businessId!==positiveId(businessId,'business_id')||
     record.documentId!==positiveId(documentId,'Document identifier')){
    throw error(403,'Merchant business or document mismatch');
  }
  // Avoid scanning/storing a file for a missing or foreign-business receipt.
  // The post-upload row lock below remains authoritative against concurrent reassignment.
  const visible=await pool.query(
    'SELECT id FROM merchant_purchase_documents WHERE id=$1 AND business_id=$2',
    [record.documentId,record.businessId]
  );
  if(!visible.rowCount)throw error(404,'Purchase document not found');
  const prior=await pool.query(
    'SELECT 1 FROM merchant_purchase_document_evidence WHERE document_id=$1 AND business_id=$2 AND client_request_key=$3',
    [record.documentId,record.businessId,record.key]
  );
  if(prior.rowCount){
    const replay=await replaySupplementaryEvidence(pool,{actorAccountId,record});
    if(replay)return replay;
  }
  let evidence=null,client=null,transactionStarted=false,commitAttempted=false,connectionUnsafe=false;
  try{
    evidence=await storeEvidence(pool,{
      dataUrl:record.dataUrl,fileName:record.fileName,allowedMimes:fileTypes,
      maxBytes:MERCHANT_PURCHASE_FILE_MAX_BYTES,ownerAccountId:actorAccountId,actorAccountId,
      sourceType:'merchant_purchase_document_attachment_pending',
      sourceId:record.documentId+':'+record.key,
      purpose:'purchase_accounting_supplement',classification:'purchase_accounting'
    });
    client=await pool.connect();
    try{await client.query('BEGIN');transactionStarted=true}
    catch(e){connectionUnsafe=true;throw e}
    await lockMerchantDocumentWriteAuthority(client,actorAccountId,record.businessId);
    const doc=await client.query(
      'SELECT id FROM merchant_purchase_documents WHERE id=$1 AND business_id=$2 FOR UPDATE',
      [record.documentId,record.businessId]
    );
    if(!doc.rowCount)throw error(404,'Purchase document not found');
    const added=await client.query(`
      INSERT INTO merchant_purchase_document_evidence(
        document_id,business_id,created_by_account_id,client_request_key,request_fingerprint,private_evidence_object_id
      ) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(document_id,client_request_key) DO NOTHING
      RETURNING id,document_id,business_id,created_at
    `,[record.documentId,record.businessId,actorAccountId,record.key,record.fingerprint,evidence.id]);
    if(!added.rowCount){
      const existing=await findSupplementaryEvidence(client,record);
      if(!existing)throw error(409,'Supplementary evidence intent could not be reconciled');
      if(existing.request_fingerprint!==record.fingerprint){
        throw error(409,'This evidence request key already belongs to a different file');
      }
      commitAttempted=true;await client.query('COMMIT');transactionStarted=false;
      try{await deleteEvidence(pool,{objectId:evidence.id,actorAccountId,purpose:'duplicate_purchase_document_attachment_cleanup'})}
      catch{console.warn('MERCHANT_PURCHASE_ATTACHMENT_DUPLICATE_CLEANUP_FAILED')}
      return{evidence:shapeSupplementaryEvidence(existing),already_saved:true};
    }
    await bindEvidence(client,{
      objectId:evidence.id,sourceType:'merchant_purchase_document_attachment',
      sourceId:String(added.rows[0].id),actorAccountId,purpose:'purchase_accounting_supplement_bind'
    });
    commitAttempted=true;await client.query('COMMIT');transactionStarted=false;
    return{evidence:shapeSupplementaryEvidence({
      ...added.rows[0],file_name:evidence.original_file_name,
      mime_type:evidence.detected_mime,byte_size:evidence.byte_size
    }),already_saved:false};
  }catch(e){
    if(commitAttempted)connectionUnsafe=true;
    if(transactionStarted){
      try{await client.query('ROLLBACK');transactionStarted=false}
      catch{connectionUnsafe=true}
    }
    // A lost COMMIT acknowledgement is ambiguous: preserve the private object
    // so a retry can discover the committed attachment instead of deleting it.
    if(evidence&&!commitAttempted){
      await deleteEvidence(pool,{objectId:evidence.id,actorAccountId,purpose:'failed_purchase_document_attachment_cleanup'}).catch(()=>{});
    }
    throw e;
  }finally{
    client?.release(connectionUnsafe?new Error('UNSAFE_PURCHASE_DOCUMENT_EVIDENCE_DB_CLIENT'):undefined);
  }
}

async function savePurchaseDocument(pool,{actorAccountId,record}){
  const fingerprintForLinks=links=>crypto.createHash('sha256').update(JSON.stringify({
    kind:record.kind,issueDate:record.issueDate,currency:record.currency,amount:record.amount,
    issuer:record.issuer,number:record.documentNumber,note:record.note,
    links,fileName:record.fileName,
    fileDigest:record.dataUrl?crypto.createHash('sha256').update(record.dataUrl).digest('hex'):''
  })).digest('hex');
  // Linked records are a set, not a display-ordered sequence. Preserve the
  // original-order fingerprint for backwards-compatible exact replay of old rows.
  const canonicalLinks=[...record.links].sort((a,b)=>
    a.kind===b.kind?a.id-b.id:(a.kind<b.kind?-1:1));
  const fingerprint=fingerprintForLinks(canonicalLinks);
  const legacyFingerprint=fingerprintForLinks(record.links);
  const sameReceiptFingerprint=saved=>saved===fingerprint||saved===legacyFingerprint;
  const existing=await pool.query(
    'SELECT * FROM merchant_purchase_documents WHERE business_id=$1 AND client_request_key=$2',
    [record.businessId,record.key]
  );
  if(existing.rowCount){
    // The initial HTTP Merchant check may have happened before a concurrent grant
    // revocation. A replay also returns private document metadata: re-authorize
    // under a transaction-held grant lock, not just the initial unlocked lookup.
    let replayClient=null,replayTxStarted=false,replayCommitAttempted=false,replayConnectionUnsafe=false;
    try{
      replayClient=await pool.connect();
      try{await replayClient.query('BEGIN');replayTxStarted=true}
      catch(e){replayConnectionUnsafe=true;throw e}
      await lockMerchantDocumentWriteAuthority(replayClient,actorAccountId,record.businessId);
      const current=await replayClient.query(
        'SELECT * FROM merchant_purchase_documents WHERE business_id=$1 AND client_request_key=$2',
        [record.businessId,record.key]
      );
      if(current.rowCount){
        if(!sameReceiptFingerprint(current.rows[0].request_fingerprint))throw error(409,'This request key already belongs to a different receipt');
        replayCommitAttempted=true;
        await replayClient.query('COMMIT');
        replayTxStarted=false;
        return{document:shape(current.rows[0]),already_saved:true};
      }
      // If the preliminary record disappeared, use the normal, guarded create path.
      replayCommitAttempted=true;
      await replayClient.query('COMMIT');
      replayTxStarted=false;
    }catch(e){
      // COMMIT acknowledgement may be lost after a durable commit; an uncertain
      // BEGIN or failed ROLLBACK can leave a transaction open. Evict the client.
      if(replayCommitAttempted)replayConnectionUnsafe=true;
      if(replayTxStarted){
        try{await replayClient.query('ROLLBACK');replayTxStarted=false}
        catch{replayConnectionUnsafe=true}
      }
      throw e;
    }finally{
      replayClient?.release(replayConnectionUnsafe?new Error('UNSAFE_PURCHASE_RECEIPT_DB_CLIENT'):undefined);
    }
  }

  await validatePurchaseLinks(pool,record.businessId,record.links);
  let evidence=null,client=null;
  // An error from COMMIT can mean the database committed but its acknowledgement
  // was lost. Never tombstone the only original of a possibly committed receipt.
  let newReceiptInserted=false,commitAttempted=false,transactionStarted=false,connectionUnsafe=false;
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
    try{await client.query('BEGIN');transactionStarted=true}
    catch(e){connectionUnsafe=true;throw e}
    await lockMerchantDocumentWriteAuthority(client,actorAccountId,record.businessId);
    await validatePurchaseLinks(client,record.businessId,record.links,{lockRows:true});
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
      if(!sameReceiptFingerprint(saved.rows[0]?.request_fingerprint))throw error(409,'This request key already belongs to a different receipt');
      commitAttempted=true;
      await client.query('COMMIT');
      transactionStarted=false;
      if(evidence){
        // ON CONFLICT resolved to a previously committed receipt. Failure to
        // delete this separate, unused upload cannot undo that committed
        // receipt or turn a confirmed replay into a failed save. The warning
        // contains no filename, evidence ID or customer/business details.
        try{
          await deletePrivateEvidence(pool,{objectId:evidence.id,actorAccountId,purpose:'duplicate_upload_cleanup'});
        }catch{
          console.warn('MERCHANT_PURCHASE_DUPLICATE_EVIDENCE_CLEANUP_FAILED');
        }
      }
      return{document:shape(saved.rows[0]),already_saved:true};
    }
    newReceiptInserted=true;
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
    commitAttempted=true;
    await client.query('COMMIT');
    transactionStarted=false;
    return{document:shape(document),already_saved:false};
  }catch(e){
    if(commitAttempted)connectionUnsafe=true;
    if(transactionStarted){
      try{await client.query('ROLLBACK');transactionStarted=false}
      catch{connectionUnsafe=true}
    }
    // COMMIT status is unknowable after a lost acknowledgement. Preserve scanned
    // evidence for reconciliation/replay rather than deleting a committed original.
    if(evidence&&!(newReceiptInserted&&commitAttempted)){
      await deletePrivateEvidence(pool,{objectId:evidence.id,actorAccountId,purpose:'failed_purchase_receipt_cleanup'}).catch(()=>{});
    }
    throw e;
  }finally{
    client?.release(connectionUnsafe?new Error('UNSAFE_PURCHASE_RECEIPT_DB_CLIENT'):undefined);
  }
}

export function registerMerchantPurchaseDocumentRoutes({app,pool,body,identity}){
  // These routes expose account/business-private purchase evidence. Guard the
  // complete route family before authentication, including errors and files.
  app.use('/api/procurement/purchase-documents',(req,res,next)=>{
    res.set('Cache-Control','private, no-store, max-age=0');
    res.vary('Cookie');
    res.vary('Authorization');
    // Express may otherwise answer a repeated private JSON GET with 304 from
    // a stale ETag even after an account/business switch.
    delete req.headers['if-none-match'];
    delete req.headers['if-modified-since'];
    next();
  });
  app.get('/api/procurement/purchase-documents/linkable-purchases',async(req,res,next)=>{
    try{
      const {businessId}=await requireMerchantDocumentBusiness(pool,identity,req);
      const q=await pool.query(`
        SELECT p.id,p.business_id,p.created_at,p.total_cost,p.purchase_quantity,p.purchase_unit,
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
      const [links,history,supplementary]=await Promise.all([
        pool.query(
          'SELECT link_kind kind,linked_id id FROM merchant_purchase_document_links WHERE document_id=$1 ORDER BY link_kind,linked_id',
          [doc.id]
        ),
        pool.query(`
          SELECT actor_account_id,before_metadata,after_metadata,changed_fields,created_at
            FROM merchant_purchase_document_metadata_audit
           WHERE document_id=$1 AND business_id=$2 ORDER BY id DESC LIMIT 50
        `,[doc.id,businessId]),
        pool.query(`
          SELECT e.id,e.document_id,e.business_id,e.created_at,
                 p.original_file_name file_name,p.detected_mime mime_type,p.byte_size
            FROM merchant_purchase_document_evidence e
            JOIN private_evidence_objects p ON p.id=e.private_evidence_object_id
             AND p.owner_account_id=e.created_by_account_id
             AND p.source_type='merchant_purchase_document_attachment'
             AND p.source_id=e.id::text
           WHERE e.document_id=$1 AND e.business_id=$2
             AND p.scan_status='clean' AND p.retention_state='active'
           ORDER BY e.id
        `,[doc.id,businessId])
      ]);
      res.json({
        document:shape(doc),links:links.rows,metadata_history:history.rows,
        supplementary_evidence:supplementary.rows.map(shapeSupplementaryEvidence)
      });
    }catch(e){next(e)}
  });

  app.post('/api/procurement/purchase-documents/:id/evidence',body,async(req,res,next)=>{
    try{
      if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))throw error(400,'Supplementary evidence must be an object');
      const {me,businessId}=await requireMerchantDocumentBusiness(pool,identity,req,'body');
      const input={...req.body};delete input.business_id;
      const record=normalizeMerchantPurchaseDocumentEvidence(input,{businessId,documentId:req.params.id});
      const outcome=await appendPurchaseDocumentEvidence(pool,{
        actorAccountId:me.account.id,businessId,documentId:req.params.id,record
      });
      res.status(outcome.already_saved?200:201).json(outcome);
    }catch(e){next(e)}
  });

  app.patch('/api/procurement/purchase-documents/:id',body,async(req,res,next)=>{
    try{
      if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))throw error(400,'Purchase document metadata must be an object');
      const {me,businessId}=await requireMerchantDocumentBusiness(pool,identity,req,'body');
      const input={...req.body};delete input.business_id;
      const outcome=await updatePurchaseDocumentMetadata(pool,{
        actorAccountId:me.account.id,businessId,documentId:req.params.id,input
      });
      res.json(outcome);
    }catch(e){next(e)}
  });

  app.get('/api/procurement/purchase-documents/:id/evidence/:evidenceId/file',async(req,res,next)=>{
    try{
      const {me,businessId}=await requireMerchantDocumentBusiness(pool,identity,req);
      const doc=await scopedDocument(pool,req.params.id,businessId);
      const evidenceId=positiveId(req.params.evidenceId,'Evidence identifier');
      const attached=await pool.query(`
        SELECT e.private_evidence_object_id
          FROM merchant_purchase_document_evidence e
          JOIN private_evidence_objects p ON p.id=e.private_evidence_object_id
           AND p.owner_account_id=e.created_by_account_id
           AND p.source_type='merchant_purchase_document_attachment'
           AND p.source_id=e.id::text
         WHERE e.id=$1 AND e.document_id=$2 AND e.business_id=$3
      `,[evidenceId,doc.id,businessId]);
      if(!attached.rowCount)throw error(404,'Supplementary evidence not found');
      const file=await readPrivateEvidence(pool,{
        objectId:attached.rows[0].private_evidence_object_id,actorAccountId:me.account.id,
        purpose:'merchant_purchase_document_supplementary_download'
      });
      sendPrivateEvidence(res,file);
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

export const merchantPurchaseDocumentInternals={
  validatePurchaseLinks,savePurchaseDocument,lockMerchantDocumentWriteAuthority,
  updatePurchaseDocumentMetadata,metadataSnapshot,
  normalizeMerchantPurchaseDocumentEvidence,appendPurchaseDocumentEvidence
};
