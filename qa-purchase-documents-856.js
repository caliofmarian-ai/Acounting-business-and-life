// Isolated authenticated QA for bounded receipt-document release #883/#856.
// No production accounts, orders or financial payments. Only temporary QA businesses.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {deletePrivateEvidence} from './private-evidence-core.js';

export const PURCHASE_DOCUMENTS_856_WAVE='purchase_documents_856';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2s5YAAAAASUVORK5CYII=';

export async function runPurchaseDocuments856Acceptance({pool,base,secret,aliases,helpers}){
  const {requestJson,requestBinary,qaAccountSession,ensureActiveRole}=helpers;
  const merchant=await qaAccountSession({pool,base,secret,email:aliases.merchant,role:'merchant',label:'Purchase documents 856 Merchant QA'});
  const marker=crypto.randomUUID(),businesses=[];
  const scope='QA 856 '+marker;
  let original=null,problem=null,checks=0,cleaned=false;
  let supportingEvidenceId=null,supportingFileName=null,supportingKey=null,supportingDocumentId=null,supportingBusinessId=null;
  const exact=(actual,expected,label)=>{assert.equal(actual,expected,'Purchase documents 856: '+label);checks++};
  const truth=(condition,label)=>{assert.ok(condition,'Purchase documents 856: '+label);checks++};
  const call=(path,options={})=>requestJson(base,path,{token:merchant.token,...options});
  const post=(path,body)=>call(path,{method:'POST',body});
  const select=async id=>pool.query("INSERT INTO account_business_preferences(account_id,role,business_id) VALUES($1,'merchant',$2) ON CONFLICT(account_id,role) DO UPDATE SET business_id=EXCLUDED.business_id",[merchant.accountId,id]);
  const newKey=()=>('qa856_'+crypto.randomUUID().replaceAll('-',''));
  const payload=(business_id,key,overrides={})=>({
    business_id,client_request_key:key,document_kind:'purchase_receipt',
    issuer_name:'Controlled QA local merchant',document_number:'QA856-'+marker.slice(0,8),
    issue_date:'2026-11-08',currency_code:'PHP',gross_amount:'12.34',
    note:'Controlled QA document, no real purchase or payment',links:[],...overrides
  });
  const makePurchase=async(businessId,suffix)=>{
    const r=await call('/api/inventory/purchase',{method:'POST',headers:{'x-abl-inventory-origin-business':String(businessId)},
      body:{item:scope+' ingredient '+suffix,purchase_quantity:1,purchase_unit:'kg',
        total_cost:5.25,inventory_type:'ingredient',inventory_domain:'food',stock_role:'ingredient',
        storage_condition:'dry',storage_area_type:'pantry',account:'cash',record_expense:false}});
    exact(r.status,201,'synthetic inventory purchase '+suffix);
    truth(Number(r.json?.purchase?.id)>0,'synthetic purchase ID');
    return Number(r.json.purchase.id);
  };
  try{
    const me=await call('/api/me');
    exact(me.status,200,'authenticated Merchant session');
    exact(me.json?.account?.account_mode,'company_test','classified QA account');
    exact(me.json?.account?.test_role,'merchant','Merchant-only fixture');
    await ensureActiveRole({base,token:merchant.token,role:'merchant',label:'Purchase documents 856 QA'});
    original=await pool.query("SELECT business_id FROM account_business_preferences WHERE account_id=$1 AND role='merchant'",[merchant.accountId]);
    for(const suffix of ['A','B']){
      const r=await pool.query("INSERT INTO businesses(name,country_code,currency_code) VALUES($1,'PH','PHP') RETURNING id",[scope+' '+suffix]);
      const id=Number(r.rows[0].id);businesses.push(id);
      await pool.query("INSERT INTO business_memberships(business_id,account_id,membership_role,active) VALUES($1,$2,'owner',TRUE)",[id,merchant.accountId]);
      await pool.query("INSERT INTO profile_business_bindings(account_id,role,business_id,status,is_primary) VALUES($1,'merchant',$2,'active',FALSE)",[merchant.accountId,id]);
    }
    const [a,b]=businesses;
    await select(a);
    const one=await makePurchase(a,'one'),two=await makePurchase(a,'two');
    const foreign=await makePurchase(b,'foreign');
    const key=newKey();
    const input=payload(a,key,{links:[{kind:'inventory_purchase',id:one},{kind:'inventory_purchase',id:two}]});
    const created=await post('/api/procurement/purchase-documents',input);
    exact(created.status,201,'new metadata-only receipt');
    exact(created.json?.already_saved,false,'new intent');
    const docId=Number(created.json?.document?.id);
    truth(Number.isSafeInteger(docId)&&docId>0,'new receipt ID');
    exact(created.json?.document?.has_attachment,false,'save without photo');
    truth(typeof created.json?.document?.updated_at==='string','metadata version is exposed');
    const metadataPatch={business_id:a,expected_updated_at:created.json.document.updated_at,
      issuer_name:'Controlled QA corrected merchant',document_number:'QA856-EDIT-'+marker.slice(0,8),
      gross_amount:'13.45',note:'Corrected receipt metadata only'};
    const metadataUpdated=await call('/api/procurement/purchase-documents/'+docId,{method:'PATCH',body:metadataPatch});
    exact(metadataUpdated.status,200,'metadata-only correction');
    exact(metadataUpdated.json?.already_applied,false,'new metadata revision');
    exact(metadataUpdated.json?.document?.id,docId,'metadata keeps the same receipt');
    exact(metadataUpdated.json?.document?.issuer_name,metadataPatch.issuer_name,'issuer metadata corrected');
    exact(metadataUpdated.json?.document?.gross_amount,13.45,'evidence amount corrected without accounting write');
    exact(metadataUpdated.json?.document?.has_attachment,false,'metadata edit does not add or remove original');
    const metadataDetail=await call('/api/procurement/purchase-documents/'+docId+'?business_id='+a);
    exact(metadataDetail.status,200,'updated private detail');
    exact(metadataDetail.json?.metadata_history?.length,1,'one immutable metadata revision');
    truth(metadataDetail.json?.metadata_history?.[0]?.changed_fields?.includes('issuer_name'),'audit names changed metadata');
    const metadataReplay=await call('/api/procurement/purchase-documents/'+docId,{method:'PATCH',body:metadataPatch});
    exact(metadataReplay.status,200,'same metadata PATCH replay');
    exact(metadataReplay.json?.already_applied,true,'lost acknowledgement replay is idempotent');
    const metadataAfterReplay=await call('/api/procurement/purchase-documents/'+docId+'?business_id='+a);
    exact(metadataAfterReplay.json?.metadata_history?.length,1,'replay does not duplicate audit');
    const staleMetadata=await call('/api/procurement/purchase-documents/'+docId,{method:'PATCH',body:{...metadataPatch,note:'stale conflicting edit'}});
    exact(staleMetadata.status,409,'stale concurrent metadata edit rejected');
    await select(b);
    const foreignMetadata=await call('/api/procurement/purchase-documents/'+docId,{method:'PATCH',body:{...metadataPatch,business_id:b}});
    exact(foreignMetadata.status,404,'foreign-business metadata edit denied');
    await select(a);
    const replay=await post('/api/procurement/purchase-documents',input);
    exact(replay.status,200,'stable intent replay');
    exact(replay.json?.already_saved,true,'replay acknowledged');
    exact(Number(replay.json?.document?.id),docId,'no duplicate receipt row');
    const conflict=await post('/api/procurement/purchase-documents',{...input,note:'Different same-key payload must fail'});
    exact(conflict.status,409,'conflicting duplicate request rejected');
    const detail=await call('/api/procurement/purchase-documents/'+docId+'?business_id='+a);
    exact(detail.status,200,'private receipt detail');
    exact(detail.json?.links?.length,2,'one receipt linked to two purchase rows');
    const linked=await call('/api/procurement/purchase-documents/linkable-purchases?business_id='+a);
    exact(linked.status,200,'linkable purchases list');
    truth(linked.json?.purchases?.some(x=>Number(x.id)===one),'first linked purchase visible');
    truth(linked.json?.purchases?.some(x=>Number(x.id)===two),'second linked purchase visible');
    const archive=await call('/api/procurement/purchase-documents?business_id='+a);
    exact(archive.status,200,'private receipt archive');
    truth(archive.json?.documents?.some(x=>Number(x.id)===docId),'new receipt visible in correct archive');
    exact((await post('/api/procurement/purchase-documents',payload(a,newKey(),{issue_date:'2026-11-08junk'}))).status,400,'date suffix denied');
    exact((await post('/api/procurement/purchase-documents',payload(a,newKey(),{gross_amount:'12.345'}))).status,400,'centavo precision denied');
    exact((await post('/api/procurement/purchase-documents',payload(a,newKey(),{gross_amount:'1000000000000.00'}))).status,400,'NUMERIC overflow denied');
    exact((await post('/api/procurement/purchase-documents',payload(a,newKey(),{links:[{kind:'inventory_purchase',id:foreign}]}))).status,404,'foreign-business link denied');
    exact((await requestJson(base,'/api/procurement/purchase-documents?business_id='+a)).status,401,'guest archive denied');
    exact((await requestJson(base,'/api/procurement/purchase-documents',{method:'POST',body:payload(a,newKey())})).status,401,'guest receipt write denied');
    const fileName='qa856-'+marker+'.png',fileInput=payload(a,newKey(),{file_name:fileName,data_url:png});
    const uploaded=await post('/api/procurement/purchase-documents',fileInput);
    exact(uploaded.status,201,'real scanned private QA PNG upload');
    truth(uploaded.json?.document?.has_attachment===true,'scanned object is bound to receipt');
    const fileId=Number(uploaded.json?.document?.id);
    const originalObject=await pool.query('SELECT private_evidence_object_id FROM merchant_purchase_documents WHERE id=$1 AND business_id=$2',[fileId,a]);
    truth(Number(originalObject.rows[0]?.private_evidence_object_id)>0,'original private object is linked');
    const file=await requestBinary(base,'/api/procurement/purchase-documents/'+fileId+'/file?business_id='+a,{token:merchant.token});
    exact(file.status,200,'authorized original download');
    exact(file.headers.get('cache-control'),'private, no-store, max-age=0','no-store original');
    truth(file.bytes.length>8&&file.bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')),'genuine PNG signature');
    const uploadReplay=await post('/api/procurement/purchase-documents',fileInput);
    exact(uploadReplay.status,200,'scanned original idempotent retry');
    exact(uploadReplay.json?.already_saved,true,'replay must not upload a second original');
    const fileMetadata=await call('/api/procurement/purchase-documents/'+fileId,{method:'PATCH',body:{
      business_id:a,expected_updated_at:uploaded.json.document.updated_at,
      note:'Scanned original retained while metadata is corrected'
    }});
    exact(fileMetadata.status,200,'metadata correction on scanned receipt');
    exact(fileMetadata.json?.document?.has_attachment,true,'scanned original remains attached');
    const objectAfter=await pool.query('SELECT private_evidence_object_id FROM merchant_purchase_documents WHERE id=$1 AND business_id=$2',[fileId,a]);
    exact(Number(objectAfter.rows[0]?.private_evidence_object_id),Number(originalObject.rows[0]?.private_evidence_object_id),'metadata edit preserves original evidence object');
    const fileAfterEdit=await requestBinary(base,'/api/procurement/purchase-documents/'+fileId+'/file?business_id='+a,{token:merchant.token});
    exact(fileAfterEdit.status,200,'original still downloads after metadata edit');
    exact(fileAfterEdit.headers.get('cache-control'),'private, no-store, max-age=0','original remains private after edit');
    supportingDocumentId=fileId;
    supportingBusinessId=a;
    supportingKey=newKey();
    supportingFileName='qa856-support-'+marker+'.png';
    const supportingPath='/api/procurement/purchase-documents/'+fileId+'/evidence';
    const supportingInput={business_id:a,client_request_key:supportingKey,file_name:supportingFileName,data_url:png};
    const economicBefore=await pool.query(`
      SELECT (SELECT COUNT(*)::int FROM inventory_purchases WHERE business_id=$1) purchase_count,
             (SELECT COUNT(*)::int FROM transactions WHERE business_id=$1) transaction_count
    `,[a]);
    const supporting=await post(supportingPath,supportingInput);
    exact(supporting.status,201,'new supplementary private evidence');
    exact(supporting.json?.already_saved,false,'new supplementary intent');
    const returnedSupportingId=Number(supporting.json?.evidence?.id);
    supportingEvidenceId=Number.isSafeInteger(returnedSupportingId)&&returnedSupportingId>0?returnedSupportingId:null;
    truth(supportingEvidenceId!==null,'supplementary evidence ID');
    exact(Number(supporting.json?.evidence?.document_id),fileId,'supporting file belongs to original receipt');
    exact(Number(supporting.json?.evidence?.business_id),a,'supporting file belongs to original business');
    exact(supporting.json?.evidence?.file_name,supportingFileName,'supporting filename retained');
    const supportingReplay=await post(supportingPath,supportingInput);
    exact(supportingReplay.status,200,'same supplementary intent replay');
    exact(supportingReplay.json?.already_saved,true,'supplementary replay acknowledged');
    exact(Number(supportingReplay.json?.evidence?.id),supportingEvidenceId,'replay returns same evidence row');
    const supportingConflict=await post(supportingPath,{...supportingInput,file_name:'changed-'+supportingFileName});
    exact(supportingConflict.status,409,'changed supplementary payload rejected');
    const detailWithSupport=await call('/api/procurement/purchase-documents/'+fileId+'?business_id='+a);
    exact(detailWithSupport.status,200,'receipt detail after supplementary append');
    exact(detailWithSupport.json?.supplementary_evidence?.length,1,'one supporting file appears in private detail');
    exact(Number(detailWithSupport.json?.supplementary_evidence?.[0]?.id),supportingEvidenceId,'detail identifies appended evidence');
    const supportFile=await requestBinary(base,'/api/procurement/purchase-documents/'+fileId+'/evidence/'+supportingEvidenceId+'/file?business_id='+a,{token:merchant.token});
    exact(supportFile.status,200,'authorized supplementary download');
    exact(supportFile.headers.get('cache-control'),'private, no-store, max-age=0','supplementary download is no-store');
    truth(supportFile.bytes.length>8&&supportFile.bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')),'supplementary PNG signature');
    const attachmentObject=await pool.query(`
      SELECT e.id,e.private_evidence_object_id,p.owner_account_id,p.source_type,p.source_id,p.original_file_name
        FROM merchant_purchase_document_evidence e
        JOIN private_evidence_objects p ON p.id=e.private_evidence_object_id
       WHERE e.id=$1 AND e.document_id=$2 AND e.business_id=$3
    `,[supportingEvidenceId,fileId,a]);
    exact(attachmentObject.rowCount,1,'supplementary object is bound to evidence row');
    exact(Number(attachmentObject.rows[0]?.owner_account_id),merchant.accountId,'supplementary object owner is authenticated Merchant');
    exact(attachmentObject.rows[0]?.source_type,'merchant_purchase_document_attachment','supplementary object has final source type');
    exact(attachmentObject.rows[0]?.source_id,String(supportingEvidenceId),'supplementary object source is evidence ID');
    exact(attachmentObject.rows[0]?.original_file_name,supportingFileName,'supplementary object filename is exact');
    const originalAfterSupport=await pool.query('SELECT private_evidence_object_id FROM merchant_purchase_documents WHERE id=$1 AND business_id=$2',[fileId,a]);
    exact(Number(originalAfterSupport.rows[0]?.private_evidence_object_id),Number(originalObject.rows[0]?.private_evidence_object_id),'supplementary append preserves original scan');
    const economicAfter=await pool.query(`
      SELECT (SELECT COUNT(*)::int FROM inventory_purchases WHERE business_id=$1) purchase_count,
             (SELECT COUNT(*)::int FROM transactions WHERE business_id=$1) transaction_count
    `,[a]);
    exact(economicAfter.rows[0]?.purchase_count,economicBefore.rows[0]?.purchase_count,'supplementary evidence does not change Inventory purchases');
    exact(economicAfter.rows[0]?.transaction_count,economicBefore.rows[0]?.transaction_count,'supplementary evidence does not create transactions');
    await select(b);
    const foreignFileName='qa856-foreign-'+marker+'.png';
    const foreignAppend=await post('/api/procurement/purchase-documents/'+fileId+'/evidence',{
      business_id:b,client_request_key:newKey(),file_name:foreignFileName,data_url:png
    });
    exact(foreignAppend.status,404,'B cannot append evidence to A receipt');
    const foreignObjects=await pool.query(`
      SELECT COUNT(*)::int n FROM private_evidence_objects
       WHERE owner_account_id=$1 AND original_file_name=$2
         AND source_type IN ('merchant_purchase_document_attachment_pending','merchant_purchase_document_attachment')
    `,[merchant.accountId,foreignFileName]);
    exact(foreignObjects.rows[0]?.n,0,'foreign receipt denial occurs before private upload');
    const foreignDetail=await call('/api/procurement/purchase-documents/'+fileId+'?business_id='+b);
    exact(foreignDetail.status,404,'B cannot read A receipt detail');
    const foreignSupportFile=await call('/api/procurement/purchase-documents/'+fileId+'/evidence/'+supportingEvidenceId+'/file?business_id='+b);
    exact(foreignSupportFile.status,404,'B cannot download A supplementary evidence');
    const otherArchive=await call('/api/procurement/purchase-documents?business_id='+b);
    exact(otherArchive.status,200,'B scoped archive');
    truth(!(otherArchive.json?.documents||[]).some(x=>Number(x.id)===docId||Number(x.id)===fileId),'B archive excludes A originals');
    exact((await call('/api/procurement/purchase-documents/'+docId+'?business_id='+b)).status,404,'B cannot read A detail');
    exact((await call('/api/procurement/purchase-documents/'+fileId+'/file?business_id='+b)).status,404,'B cannot download A file');
    await select(a);
    const restoredDetail=await call('/api/procurement/purchase-documents/'+fileId+'?business_id='+a);
    exact(restoredDetail.status,200,'A receipt detail is available after switching back');
    exact(restoredDetail.json?.supplementary_evidence?.length,1,'A supporting file remains attached after context switch');
    const persisted=await pool.query('SELECT COUNT(*)::int n FROM merchant_purchase_documents WHERE business_id=$1',[a]);
    exact(persisted.rows[0]?.n,2,'only original metadata and scanned receipt persisted');
  }catch(error){problem=error}
  finally{
    try{
      if(original?.rowCount)await select(original.rows[0].business_id);
      else await pool.query("DELETE FROM account_business_preferences WHERE account_id=$1 AND role='merchant'",[merchant.accountId]);
      for(const id of businesses){
        const owned=await pool.query('SELECT name FROM businesses WHERE id=$1',[id]);
        if(!owned.rows[0]?.name?.startsWith(scope+' '))throw new Error('QA 856 cleanup business ownership mismatch');
        const docs=await pool.query("SELECT id,private_evidence_object_id FROM merchant_purchase_documents WHERE business_id=$1",[id]);
        if(supportingDocumentId&&id===supportingBusinessId){
          const attachments=await pool.query(`
            SELECT e.id,e.private_evidence_object_id,p.owner_account_id,p.source_type,p.source_id,p.original_file_name
              FROM merchant_purchase_document_evidence e
              LEFT JOIN private_evidence_objects p ON p.id=e.private_evidence_object_id
             WHERE e.business_id=$1 AND e.document_id=$2 AND e.created_by_account_id=$3
          `,[id,supportingDocumentId,merchant.accountId]);
          if(attachments.rowCount>1)throw new Error('QA 856 cleanup found unexpected supplementary evidence rows');
          for(const attachment of attachments.rows){
            const objectId=Number(attachment.private_evidence_object_id);
            if(!Number.isSafeInteger(objectId)||objectId<1||
               Number(attachment.owner_account_id)!==merchant.accountId||
               attachment.source_type!=='merchant_purchase_document_attachment'||
               attachment.source_id!==String(attachment.id)||
               attachment.original_file_name!==supportingFileName||
               (supportingEvidenceId!==null&&Number(attachment.id)!==supportingEvidenceId)){
              throw new Error('QA 856 cleanup supplementary object ownership/source mismatch');
            }
            await deletePrivateEvidence(pool,{objectId,actorAccountId:merchant.accountId,purpose:'qa_856_fixture_cleanup'});
            await pool.query('DELETE FROM merchant_purchase_document_evidence WHERE id=$1 AND business_id=$2 AND created_by_account_id=$3',
              [attachment.id,id,merchant.accountId]);
            await pool.query('DELETE FROM private_evidence_access_audit WHERE object_id=$1',[objectId]);
            await pool.query(`
              DELETE FROM private_evidence_objects
               WHERE id=$1 AND owner_account_id=$2
                 AND source_type='merchant_purchase_document_attachment' AND source_id=$3
                 AND original_file_name=$4
            `,[objectId,merchant.accountId,String(attachment.id),supportingFileName]);
          }
          const pending=await pool.query(`
            SELECT id FROM private_evidence_objects
             WHERE owner_account_id=$1 AND source_type='merchant_purchase_document_attachment_pending'
               AND source_id=$2 AND original_file_name=$3
          `,[merchant.accountId,String(supportingDocumentId)+':'+String(supportingKey),supportingFileName]);
          if(pending.rowCount>1)throw new Error('QA 856 cleanup found duplicate pending private objects');
          for(const object of pending.rows){
            const objectId=Number(object.id);
            await deletePrivateEvidence(pool,{objectId,actorAccountId:merchant.accountId,purpose:'qa_856_fixture_cleanup'});
            await pool.query('DELETE FROM private_evidence_access_audit WHERE object_id=$1',[objectId]);
            await pool.query(`
              DELETE FROM private_evidence_objects
               WHERE id=$1 AND owner_account_id=$2
                 AND source_type='merchant_purchase_document_attachment_pending'
                 AND source_id=$3 AND original_file_name=$4
            `,[objectId,merchant.accountId,String(supportingDocumentId)+':'+String(supportingKey),supportingFileName]);
          }
        }
        await pool.query('DELETE FROM merchant_purchase_document_metadata_audit WHERE business_id=$1',[id]);
        await pool.query('DELETE FROM merchant_purchase_document_links WHERE document_id IN (SELECT id FROM merchant_purchase_documents WHERE business_id=$1)',[id]);
        await pool.query('DELETE FROM merchant_purchase_documents WHERE business_id=$1',[id]);
        for(const row of docs.rows){
          if(!row.private_evidence_object_id)continue;
          const objectId=Number(row.private_evidence_object_id);
          const object=await pool.query("SELECT id FROM private_evidence_objects WHERE id=$1 AND owner_account_id=$2 AND source_type='merchant_purchase_document' AND original_file_name=$3",[objectId,merchant.accountId,'qa856-'+marker+'.png']);
          if(object.rowCount!==1)throw new Error('QA 856 cleanup private object source mismatch');
          await deletePrivateEvidence(pool,{objectId,actorAccountId:merchant.accountId,purpose:'qa_856_fixture_cleanup'});
          await pool.query('DELETE FROM private_evidence_access_audit WHERE object_id=$1',[objectId]);
          await pool.query('DELETE FROM private_evidence_objects WHERE id=$1',[objectId]);
        }
        for(const table of ['inventory_count_sessions','inventory_lot_location_balances','inventory_location_balances',
          'inventory_purchases','supply_lots','transactions','inventory','inventory_storage_locations','budgets'])
          await pool.query('DELETE FROM '+table+' WHERE business_id=$1',[id]);
        await pool.query('DELETE FROM businesses WHERE id=$1',[id]);
      }
      cleaned=true;
    }catch(e){problem=new Error('QA 856 fixture cleanup failed'+(problem?' after test failure':''),{cause:e})}
    try{await requestJson(base,'/api/auth/logout',{method:'POST',token:merchant.token,body:{}})}
    catch(e){if(!problem)problem=e}
  }
  if(problem)throw problem;
  return{status:'PASS',wave:PURCHASE_DOCUMENTS_856_WAVE,checks,authenticated_http:true,
    isolated_businesses:true,receipt_multi_purchase:true,replay_conflict_guard:true,
    scanned_original_download:true,metadata_archive:true,metadata_edit_audit:true,
    scanned_original_preserved_on_edit:true,cross_business_guest_denial:true,
    supplementary_evidence_append:true,supplementary_evidence_replay:true,
    supplementary_evidence_conflict:true,supplementary_evidence_private_download:true,
    supplementary_evidence_foreign_denial:true,merchant_context_switch:true,
    supplementary_evidence_cleanup:true,economic_records_unchanged:true,
    exact_amount_date_denials:true,fixtures_removed:cleaned};
}
