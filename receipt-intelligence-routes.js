import crypto from 'node:crypto';
import {supplierDomainV2Internals} from './server-supplier-domain-v2.js';
import {readPrivateEvidence} from './private-evidence-core.js';
import {
  buildReceiptIntelligenceDraft,validateReceiptReceivingReview,
  receiptExtractionFingerprint,receiptReviewSubmissionFingerprint,RECEIPT_LIMITS
} from './receipt-intelligence-core.js';
import {receiptVisionConfig,extractReceiptImage} from './receipt-intelligence-provider.js';

const {exactProfileBusiness}=supplierDomainV2Internals;
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const id=(v,label='ID')=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<=0)fail('Invalid '+label);return n};
const requestKey=v=>{const x=String(v??'').trim().slice(0,100);if(!/^[A-Za-z0-9_-]{12,100}$/.test(x))fail('Stable request key required');return x};
const view=row=>({
  id:Number(row.id),business_id:Number(row.business_id),document_id:Number(row.purchase_document_id),
  status:row.status,version:Number(row.version),provider:row.provider,model:row.model,
  extraction:row.extraction_json,review:row.review_json,
  external_processing_consent_recorded:Boolean(row.external_consent_at),
  stock_posted:false,payment_recorded:false,fiscal_validated:false,
  created_at:row.created_at,updated_at:row.updated_at
});
export async function ensureReceiptIntelligenceSchema(pool){
  const q=await pool.query("SELECT to_regclass('public.merchant_purchase_documents') vault");
  if(!q.rows[0]?.vault)return{ready:false,reason:'receipt_vault_856_required'};
  await pool.query(`
    CREATE TABLE IF NOT EXISTS receipt_intelligence_drafts(
      id BIGSERIAL PRIMARY KEY,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
      purchase_document_id BIGINT NOT NULL REFERENCES merchant_purchase_documents(id) ON DELETE RESTRICT,
      source_sha256 TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'manual',
      model TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      extraction_json JSONB,
      review_json JSONB,
      version INTEGER NOT NULL DEFAULT 1,
      created_by_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      reviewed_by_account_id BIGINT REFERENCES accounts(id) ON DELETE RESTRICT,
      external_consent_at TIMESTAMPTZ,
      external_consent_actor_account_id BIGINT REFERENCES accounts(id) ON DELETE RESTRICT,
      last_error_code TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(status IN ('processing','draft','reviewed','failed')),
      UNIQUE(purchase_document_id,source_sha256)
    );
    CREATE INDEX IF NOT EXISTS receipt_intelligence_scope
      ON receipt_intelligence_drafts(business_id,purchase_document_id,updated_at DESC);
    CREATE TABLE IF NOT EXISTS receipt_intelligence_reviews(
      id BIGSERIAL PRIMARY KEY,
      draft_id BIGINT NOT NULL REFERENCES receipt_intelligence_drafts(id) ON DELETE RESTRICT,
      actor_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      client_request_key TEXT NOT NULL,
      submission_sha256 TEXT NOT NULL DEFAULT '',
      review_json JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(draft_id,client_request_key)
    );
    ALTER TABLE receipt_intelligence_reviews ADD COLUMN IF NOT EXISTS submission_sha256 TEXT NOT NULL DEFAULT '';
    CREATE TABLE IF NOT EXISTS receipt_intelligence_aliases(
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
      supplier_key TEXT NOT NULL,
      alias TEXT NOT NULL,
      inventory_id BIGINT NOT NULL REFERENCES inventory(id) ON DELETE RESTRICT,
      confirmed_by_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(business_id,supplier_key,alias)
    );
  `);
  return{ready:true};
}
async function scope(pool,identity,req,body=false){
  const who=await identity(req);
  const bid=id(body?req.body?.business_id:req.query?.business_id,'business_id');
  const b=await exactProfileBusiness(pool,who,'merchant',bid);
  if(Number(b.id)!==bid)fail('Merchant workspace mismatch',403);
  return{businessId:bid,actorId:id(who.account.id,'account_id')};
}
async function receiptFor(pool,businessId,receiptId){
  const table=await pool.query("SELECT to_regclass('public.merchant_purchase_documents') vault");
  if(!table.rows[0]?.vault)fail('Receipt archive must be deployed first',503);
  const result=await pool.query(
    'SELECT * FROM merchant_purchase_documents WHERE id=$1 AND business_id=$2',
    [id(receiptId,'document_id'),businessId]
  );
  if(!result.rowCount)fail('Receipt not found for this Merchant',404);
  return result.rows[0];
}
async function businessInventory(db,businessId){
  return(await db.query(
    'SELECT id,business_id,item,unit,base_unit,internal_sku,barcode FROM inventory WHERE business_id=$1 ORDER BY id LIMIT $2',
    [businessId,RECEIPT_LIMITS.inventoryCandidates]
  )).rows;
}
async function supplierAliases(pool,businessId,vendorName){
  const supplierKey=String(vendorName||'').trim().toLowerCase().slice(0,180);
  if(!supplierKey)return[];
  const result=await pool.query(
    'SELECT business_id,inventory_id,alias FROM receipt_intelligence_aliases WHERE business_id=$1 AND supplier_key=$2 LIMIT 300',
    [businessId,supplierKey]
  );
  return result.rows;
}
async function latestDraft(pool,businessId,documentId){
  const q=await pool.query(
    'SELECT * FROM receipt_intelligence_drafts WHERE business_id=$1 AND purchase_document_id=$2 ORDER BY updated_at DESC,id DESC LIMIT 1',
    [businessId,documentId]
  );
  if(!q.rowCount)fail('Analysis not found',404);
  return q.rows[0];
}
export function registerReceiptIntelligenceRoutes({app,pool,body,identity,analyzer=extractReceiptImage}){
  app.get('/api/procurement/receipt-intelligence/config',async(req,res,next)=>{
    try{
      await scope(pool,identity,req);
      const cfg=receiptVisionConfig();
      res.json({provider_available:cfg.ready,provider:cfg.ready?cfg.provider:'unavailable',
        manual_entry:true,stock_posting_enabled:false,pdf_ai_enabled:false});
    }catch(e){next(e)}
  });
  app.get('/api/procurement/receipt-intelligence/inventory',async(req,res,next)=>{
    try{
      const {businessId}=await scope(pool,identity,req);
      const rows=await businessInventory(pool,businessId);
      res.json({inventory:rows.map(x=>({id:Number(x.id),item:x.item,unit:x.base_unit||x.unit,
        sku:x.internal_sku||'',barcode:x.barcode||''}))});
    }catch(e){next(e)}
  });
  // A scan can repeat under another request key: warn about suspected duplicate originals.
  app.get('/api/procurement/purchase-documents/:id/intelligence/duplicates',async(req,res,next)=>{
    try{
      const {businessId}=await scope(pool,identity,req);
      const receipt=await receiptFor(pool,businessId,req.params.id);
      const q=await pool.query(`
        SELECT other.id,other.issuer_name,other.document_number,other.issue_date,
          other.gross_amount,
          CASE WHEN original.sha256 IS NOT NULL AND original.sha256=copy.sha256
            THEN 'same_original_file' ELSE 'same_supplier_reference' END reason
          FROM merchant_purchase_documents other
          LEFT JOIN private_evidence_objects original ON original.id=$3
          LEFT JOIN private_evidence_objects copy ON copy.id=other.private_evidence_object_id
         WHERE other.business_id=$1 AND other.id<>$2
           AND (
             (original.sha256 IS NOT NULL AND original.sha256=copy.sha256)
             OR ($4<>'' AND LOWER(other.document_number)=LOWER($4)
                 AND LOWER(other.issuer_name)=LOWER($5)
                 AND other.issue_date=$6::date
                 AND other.gross_amount IS NOT DISTINCT FROM $7::numeric)
           )
         ORDER BY other.id DESC LIMIT 20
      `,[
        businessId,receipt.id,receipt.private_evidence_object_id,
        receipt.document_number||'',receipt.issuer_name||'',
        receipt.issue_date,receipt.gross_amount
      ]);
      res.json({possible_duplicates:q.rows.map(x=>({...x,id:Number(x.id)})),
        note:'Potential duplicates are warnings; they never create or reverse stock.'});
    }catch(e){next(e)}
  });

  app.get('/api/procurement/purchase-documents/:id/intelligence',async(req,res,next)=>{
    try{
      const {businessId}=await scope(pool,identity,req);
      const receipt=await receiptFor(pool,businessId,req.params.id);
      res.json({draft:view(await latestDraft(pool,businessId,receipt.id))});
    }catch(e){next(e)}
  });
  app.post('/api/procurement/purchase-documents/:id/intelligence/manual',body,async(req,res,next)=>{
    try{
      const {businessId,actorId}=await scope(pool,identity,req,true);
      const receipt=await receiptFor(pool,businessId,req.params.id);
      if(!req.body?.extraction||typeof req.body.extraction!=='object')fail('Structured receipt lines required');
      const fingerprint=crypto.createHash('sha256').update(JSON.stringify(req.body.extraction)).digest('hex');
      const source=receiptExtractionFingerprint({documentId:receipt.id,sha256:fingerprint,provider:'manual'});
      const inventory=await businessInventory(pool,businessId);
      const aliases=await supplierAliases(pool,businessId,req.body.extraction.vendor_name);
      const draft=buildReceiptIntelligenceDraft({
        extraction:req.body.extraction,businessId,inventoryRows:inventory,aliases,
        meta:{provider:'manual',model:'manual_input_v1'}
      });
      const insert=await pool.query(`
        INSERT INTO receipt_intelligence_drafts(
          business_id,purchase_document_id,source_sha256,provider,model,status,extraction_json,created_by_account_id
        ) VALUES($1,$2,$3,'manual','manual_input_v1','draft',$4::jsonb,$5)
        ON CONFLICT(purchase_document_id,source_sha256) DO NOTHING RETURNING *
      `,[businessId,receipt.id,source,JSON.stringify(draft),actorId]);
      const row=insert.rows[0]||(await pool.query(
        'SELECT * FROM receipt_intelligence_drafts WHERE business_id=$1 AND purchase_document_id=$2 AND source_sha256=$3',
        [businessId,receipt.id,source]
      )).rows[0];
      res.status(insert.rowCount?201:200).json({draft:view(row),already_saved:!insert.rowCount});
    }catch(e){next(e)}
  });
  app.post('/api/procurement/purchase-documents/:id/intelligence/analyze',body,async(req,res,next)=>{
    let claimId=null;
    try{
      const {businessId,actorId}=await scope(pool,identity,req,true);
      const receipt=await receiptFor(pool,businessId,req.params.id);
      if(req.body?.allow_external_processing!==true)fail('Explicit permission to process the photo is required',403);
      const cfg=receiptVisionConfig();
      if(!cfg.ready)fail('AI is not configured. Use manual entry.',503);
      if(!receipt.private_evidence_object_id)fail('Save a photo before analyzing',409);
      const dailyLimit=Math.max(1,Math.min(100,Number(process.env.RECEIPT_AI_DAILY_LIMIT)||30));
      const recent=await pool.query(
        "SELECT COUNT(*)::int attempts FROM receipt_intelligence_drafts WHERE business_id=$1 AND provider='openai_vision' AND created_at>=NOW()-INTERVAL '24 hours'",
        [businessId]
      );
      if(Number(recent.rows[0]?.attempts||0)>=dailyLimit)fail('Daily receipt AI analysis limit reached. Use manual entry.',429);
      const file=await readPrivateEvidence(pool,{objectId:receipt.private_evidence_object_id,
        actorAccountId:actorId,purpose:'merchant_receipt_analysis'});
      const source=receiptExtractionFingerprint({
        documentId:receipt.id,sha256:file.metadata.sha256,provider:'openai_vision'
      });
      const insert=await pool.query(`
        INSERT INTO receipt_intelligence_drafts(
          business_id,purchase_document_id,source_sha256,provider,model,status,created_by_account_id,
          external_consent_at,external_consent_actor_account_id
        ) VALUES($1,$2,$3,'openai_vision',$4,'processing',$5,NOW(),$5)
        ON CONFLICT(purchase_document_id,source_sha256) DO NOTHING RETURNING *
      `,[businessId,receipt.id,source,cfg.model,actorId]);
      if(!insert.rowCount){
        const existing=(await pool.query(
          'SELECT * FROM receipt_intelligence_drafts WHERE business_id=$1 AND purchase_document_id=$2 AND source_sha256=$3',
          [businessId,receipt.id,source]
        )).rows[0];
        if(existing.status==='failed')fail('Previous analysis failed. Use manual entry.',409);
        return res.status(existing.status==='processing'?202:200).json({draft:view(existing),already_saved:true});
      }
      claimId=Number(insert.rows[0].id);
      const result=await analyzer({bytes:file.bytes,mime:file.metadata.detected_mime,consent:true});
      const inventory=await businessInventory(pool,businessId);
      const aliases=await supplierAliases(pool,businessId,result.extraction.vendor_name);
      const draft=buildReceiptIntelligenceDraft({extraction:result.extraction,businessId,inventoryRows:inventory,aliases,
        meta:{provider:result.provider||'openai_vision',model:result.model||cfg.model}});
      const update=await pool.query(`
        UPDATE receipt_intelligence_drafts SET status='draft',extraction_json=$1::jsonb,
          updated_at=NOW() WHERE id=$2 AND business_id=$3 AND status='processing' RETURNING *
      `,[JSON.stringify(draft),claimId,businessId]);
      if(!update.rowCount)fail('Draft state changed during analysis',409);
      res.status(201).json({draft:view(update.rows[0]),already_saved:false});
    }catch(e){
      if(claimId)await pool.query(`
        UPDATE receipt_intelligence_drafts SET status='failed',last_error_code=$1,updated_at=NOW()
        WHERE id=$2 AND status='processing'
      `,[String(e.code||'ANALYSIS_FAILED').slice(0,100),claimId]).catch(()=>{});
      next(e);
    }
  });
  app.post('/api/procurement/purchase-documents/:id/intelligence/review',body,async(req,res,next)=>{
    let client;
    try{
      const {businessId,actorId}=await scope(pool,identity,req,true);
      const receipt=await receiptFor(pool,businessId,req.params.id);
      const did=id(req.body?.draft_id,'draft_id'),key=requestKey(req.body?.client_request_key);
      const submissionHash=receiptReviewSubmissionFingerprint({
        draftId:did,expectedVersion:req.body?.expected_version,decisions:req.body?.decisions
      });
      client=await pool.connect();
      await client.query('BEGIN');
      const q=await client.query(
        'SELECT * FROM receipt_intelligence_drafts WHERE id=$1 AND purchase_document_id=$2 AND business_id=$3 FOR UPDATE',
        [did,receipt.id,businessId]
      );
      if(!q.rowCount)fail('Draft not found in this business',404);
      const draft=q.rows[0];
      const previous=await client.query(
        'SELECT review_json,submission_sha256 FROM receipt_intelligence_reviews WHERE draft_id=$1 AND client_request_key=$2',
        [did,key]
      );
      if(previous.rowCount){
        if(previous.rows[0].submission_sha256&&previous.rows[0].submission_sha256!==submissionHash)
          fail('This request key was already used for a different receipt review',409);
        await client.query('COMMIT');
        return res.json({review:previous.rows[0].review_json,already_saved:true,stock_posted:false});
      }
      if(!['draft','reviewed'].includes(draft.status)||!draft.extraction_json)fail('Draft not ready to review',409);
      if(Number(req.body?.expected_version)!==Number(draft.version))fail('Draft changed. Refresh first.',409);
      const inventory=await businessInventory(client,businessId);
      const review=validateReceiptReceivingReview({
        draft:draft.extraction_json,submission:req.body,businessId,inventoryRows:inventory
      });
      await client.query(`
        INSERT INTO receipt_intelligence_reviews(draft_id,actor_account_id,client_request_key,submission_sha256,review_json)
        VALUES($1,$2,$3,$4,$5::jsonb)
      `,[did,actorId,key,submissionHash,JSON.stringify(review)]);
      await client.query(`
        UPDATE receipt_intelligence_drafts SET status='reviewed',review_json=$1::jsonb,
          reviewed_by_account_id=$2,version=version+1,updated_at=NOW()
        WHERE id=$3 AND business_id=$4
      `,[JSON.stringify(review),actorId,did,businessId]);
      // Learn only Merchant-confirmed inventory aliases for this exact supplier and business.
      const supplierKey=String(draft.extraction_json.vendor_name||'').trim().toLowerCase().slice(0,180);
      if(supplierKey){
        for(const action of review.actions){
          if(action.action!=='receive')continue;
          const alias=String(draft.extraction_json.lines[action.line_index]?.description||'').trim().toLowerCase().slice(0,180);
          if(!alias)continue;
          await client.query(`
            INSERT INTO receipt_intelligence_aliases(
              business_id,supplier_key,alias,inventory_id,confirmed_by_account_id
            )
            SELECT $1,$2,$3,i.id,$5 FROM inventory i WHERE i.id=$4 AND i.business_id=$1
            ON CONFLICT(business_id,supplier_key,alias) DO UPDATE SET
              inventory_id=EXCLUDED.inventory_id,
              confirmed_by_account_id=EXCLUDED.confirmed_by_account_id,
              confirmed_at=NOW()
          `,[businessId,supplierKey,alias,action.inventory_id,actorId]);
        }
      }
      await client.query('COMMIT');
      res.json({review,already_saved:false,stock_posted:false});
    }catch(e){if(client)await client.query('ROLLBACK').catch(()=>{});next(e)}
    finally{client?.release()}
  });
  app.get('/api/procurement/receipt-intelligence/count-sessions/:id/variance-evidence',async(req,res,next)=>{
    try{
      const {businessId}=await scope(pool,identity,req);
      const vault=await pool.query("SELECT to_regclass('public.merchant_purchase_documents') vault");
      if(!vault.rows[0]?.vault)fail('Receipt archive is not installed',503);
      const session=id(req.params.id,'count_session_id');
      const q=await pool.query(
        'SELECT status FROM inventory_count_sessions WHERE id=$1 AND business_id=$2',
        [session,businessId]
      );
      if(!q.rowCount)fail('Count session not found',404);
      if(!['review','posted'].includes(q.rows[0].status))fail('Finish blind counting before viewing documents',409);
      const rows=await pool.query(`
        SELECT si.inventory_id,i.item,i.unit,si.expected_quantity,si.counted_quantity,
          p.id purchase_id,p.total_cost,p.purchase_quantity,p.purchase_unit,p.created_at purchase_at,
          d.id receipt_id,d.issuer_name,d.document_number,d.issue_date
        FROM inventory_count_session_items si
        JOIN inventory i ON i.id=si.inventory_id AND i.business_id=$2
        LEFT JOIN LATERAL(
          SELECT id,total_cost,purchase_quantity,purchase_unit,created_at
          FROM inventory_purchases
          WHERE business_id=$2 AND inventory_id=si.inventory_id
          ORDER BY created_at DESC,id DESC LIMIT 1
        ) p ON TRUE
        LEFT JOIN merchant_purchase_document_links l
          ON l.link_kind='inventory_purchase' AND l.linked_id=p.id
        LEFT JOIN merchant_purchase_documents d
          ON d.id=l.document_id AND d.business_id=$2
        WHERE si.session_id=$1 AND si.counted_quantity IS NOT NULL
          AND ABS(si.expected_quantity-si.counted_quantity)>0.000001
        ORDER BY i.item,d.issue_date DESC NULLS LAST LIMIT 120
      `,[session,businessId]);
      res.json({count_session_id:session,session_status:q.rows[0].status,
        stock_posted:false,findings:rows.rows.map(row=>({
          inventory_id:Number(row.inventory_id),name:row.item,unit:row.unit,
          expected:Number(row.expected_quantity),counted:Number(row.counted_quantity),
          variance:Number(row.counted_quantity)-Number(row.expected_quantity),
          last_purchase:row.purchase_id==null?null:{id:Number(row.purchase_id),
            quantity:Number(row.purchase_quantity),unit:row.purchase_unit,
            total_cost:Number(row.total_cost),date:row.purchase_at},
          receipt:row.receipt_id==null?null:{id:Number(row.receipt_id),
            supplier:row.issuer_name,number:row.document_number,date:row.issue_date},
          message:'Purchase evidence suggests what to investigate, not actual shelf quantity.'
        }))});
    }catch(e){next(e)}
  });
}
