import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {deletePrivateEvidence} from './private-evidence-core.js';
import {validateRuntimeSafety} from './runtime-safety.js';

export const RECEIPT_INTELLIGENCE_860_WAVE='receipt_intelligence_860';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2s5YAAAAASUVORK5CYII=';

export function assertReceiptIntelligenceLoopback(base){
  let url;
  try{url=new URL(base)}catch{throw new Error('Receipt Intelligence QA requires an internal Preview URL.')}
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password){
    throw new Error('Receipt Intelligence QA accepts only the internal loopback Preview URL.');
  }
  return url;
}

export async function runReceiptIntelligence860Acceptance({pool,base,secret,env=process.env,aliases,helpers}){
  const runtime=validateRuntimeSafety(env);
  if(!runtime.previewService||runtime.appEnvironment!=='qa'||!/(?:^|_)(?:qa|test)$/.test(runtime.databaseName)){
    throw new Error('Receipt Intelligence QA requires the isolated accounting-preview QA database.');
  }
  assertReceiptIntelligenceLoopback(base);
  if(String(secret||'').length<32)throw new Error('Receipt Intelligence QA requires the dedicated QA automation secret.');
  const database=await pool.query('SELECT current_database() AS name');
  if(database.rows[0]?.name!==runtime.databaseName)throw new Error('Receipt Intelligence QA database target mismatch.');
  const {qaAccountSession,ensureActiveRole,requestJson}=helpers||{};
  if(typeof qaAccountSession!=='function'||typeof ensureActiveRole!=='function'||typeof requestJson!=='function'){
    throw new Error('Receipt Intelligence QA helpers are incomplete.');
  }

  const marker=crypto.randomUUID(),scope='QA Receipt Intelligence 860 '+marker;
  const businesses=[],fileName='qa856-ri-'+marker+'.png';
  const documentKey='qa860_'+marker.replaceAll('-','');
  let merchant=null,customer=null,originalPreference=null,preferenceChanged=false;
  let documentId=null,failure=null,checks=0,fixturesRemoved=false;
  const exact=(actual,expected,label)=>{assert.equal(actual,expected,'Receipt Intelligence 860: '+label);checks++};
  const truth=(condition,label)=>{assert.ok(condition,'Receipt Intelligence 860: '+label);checks++};
  const safeMessage=error=>String(error?.message||'unknown error').replace(/[\r\n\t]+/g,' ').slice(0,220);
  const request=(token,path,options={})=>requestJson(base,path,{token,...options});
  const call=(path,options={})=>request(merchant?.token,path,options);
  const post=(path,body)=>call(path,{method:'POST',body});
  const select=businessId=>pool.query(
    "INSERT INTO account_business_preferences(account_id,role,business_id) VALUES($1,'merchant',$2) "+
    "ON CONFLICT(account_id,role) DO UPDATE SET business_id=EXCLUDED.business_id",
    [merchant.accountId,businessId]
  );
  const makeBusiness=async suffix=>{
    const name=scope+' '+suffix;
    const result=await pool.query(
      "INSERT INTO businesses(name,country_code,currency_code) VALUES($1,'PH','PHP') RETURNING id",[name]
    );
    const id=Number(result.rows[0]?.id);
    if(!Number.isSafeInteger(id)||id<1)throw new Error('Receipt Intelligence QA business fixture was not created.');
    businesses.push({id,name});
    await pool.query(
      "INSERT INTO business_memberships(business_id,account_id,membership_role,active) VALUES($1,$2,'owner',TRUE)",
      [id,merchant.accountId]
    );
    await pool.query(
      "INSERT INTO profile_business_bindings(account_id,role,business_id,status,is_primary) VALUES($1,'merchant',$2,'active',FALSE)",
      [merchant.accountId,id]
    );
    return id;
  };
  const addInventory=async(businessId,item)=>{
    const result=await pool.query(
      "INSERT INTO inventory(business_id,item,unit,base_unit,quantity,unit_cost,inventory_type,inventory_domain,stock_role,storage_condition,storage_area_type) "+
      "VALUES($1,$2,'g','g',1000,0.05,'ingredient','food','ingredient','dry','pantry') RETURNING id",
      [businessId,item]
    );
    const id=Number(result.rows[0]?.id);
    if(!Number.isSafeInteger(id)||id<1)throw new Error('Receipt Intelligence QA Inventory fixture was not created.');
    return id;
  };
  const economicSnapshot=async(businessId,inventoryId)=>{
    const result=await pool.query(
      'SELECT i.quantity::text quantity,'+
      '(SELECT COUNT(*)::int FROM inventory_purchases WHERE business_id=$1) purchases,'+
      '(SELECT COUNT(*)::int FROM supply_lots WHERE business_id=$1) lots,'+
      '(SELECT COUNT(*)::int FROM transactions WHERE business_id=$1) transactions '+
      'FROM inventory i WHERE i.id=$2 AND i.business_id=$1',[businessId,inventoryId]
    );
    if(result.rowCount!==1)throw new Error('Receipt Intelligence QA Inventory fixture disappeared.');
    return result.rows[0];
  };
  const extraction={
    vendor_name:'Controlled QA receipt market',document_number:'QA860-'+marker.slice(0,8),
    issue_date:'2026-11-15',currency_code:'PHP',document_total:'50.00',subtotal:'50.00',
    lines:[{raw_text:'Rice 1 kg 50.00',description:'Rice',quantity:'1',unit:'kg',
      unit_price:'50.00',line_total:'50.00',confidence:0.98,evidence:'Rice 1 kg 50.00'}]
  };

  try{
    merchant=await qaAccountSession({pool,base,secret,email:aliases.merchant,role:'merchant',label:'Receipt Intelligence 860 Merchant QA'});
    const me=await call('/api/me');
    exact(me.status,200,'authenticated Merchant session');
    exact(me.json?.account?.account_mode,'company_test','controlled company_test identity');
    exact(me.json?.account?.test_role,'merchant','Merchant-only identity');
    exact(me.json?.account?.active_role,'merchant','active Merchant profile');
    await ensureActiveRole({base,token:merchant.token,role:'merchant',label:'Receipt Intelligence 860 Merchant QA'});

    const prior=await pool.query(
      "SELECT 1 FROM businesses b JOIN business_memberships m ON m.business_id=b.id "+
      "WHERE m.account_id=$1 AND b.name LIKE 'QA Receipt Intelligence 860 %' LIMIT 1",[merchant.accountId]
    );
    if(prior.rowCount)throw new Error('A prior Receipt Intelligence QA fixture remains; refusing to overwrite it.');
    originalPreference=await pool.query(
      "SELECT business_id FROM account_business_preferences WHERE account_id=$1 AND role='merchant'",[merchant.accountId]
    );
    const businessA=await makeBusiness('A'),businessB=await makeBusiness('B');
    preferenceChanged=true;
    await select(businessA);
    const inventoryA=await addInventory(businessA,'Rice');
    const inventoryB=await addInventory(businessB,'Foreign Rice');
    const workspacesA=await call('/api/accounting/workspaces');
    exact(workspacesA.status,200,'Merchant workspace list');
    exact(Number(workspacesA.json?.active_business_id),businessA,'A workspace selected');
    const before=await economicSnapshot(businessA,inventoryA);

    const uploaded=await post('/api/procurement/purchase-documents',{
      business_id:businessA,client_request_key:documentKey,document_kind:'purchase_receipt',
      issuer_name:'Controlled QA receipt market',document_number:extraction.document_number,
      issue_date:'2026-11-15',currency_code:'PHP',gross_amount:'50.00',
      note:'Synthetic QA receipt only; no purchase or payment.',links:[],file_name:fileName,data_url:png
    });
    exact(uploaded.status,201,'authenticated synthetic original upload');
    exact(uploaded.json?.document?.has_attachment,true,'private original is bound to receipt');
    documentId=Number(uploaded.json?.document?.id);
    truth(Number.isSafeInteger(documentId)&&documentId>0,'receipt document ID');

    const objectId=Number((await pool.query(
      'SELECT private_evidence_object_id FROM merchant_purchase_documents WHERE id=$1 AND business_id=$2',
      [documentId,businessA]
    )).rows[0]?.private_evidence_object_id);
    const object=await pool.query(
      'SELECT id,owner_account_id,created_by_account_id,source_type,source_id,original_file_name,scan_status,retention_state '+
      'FROM private_evidence_objects WHERE id=$1',[objectId]
    );
    exact(object.rowCount,1,'private evidence metadata exists');
    exact(Number(object.rows[0].owner_account_id),merchant.accountId,'private evidence owner');
    exact(Number(object.rows[0].created_by_account_id),merchant.accountId,'private evidence creator');
    exact(object.rows[0].source_type,'merchant_purchase_document','private evidence source type');
    exact(object.rows[0].source_id,String(documentId),'private evidence bound to exact receipt');
    exact(object.rows[0].original_file_name,fileName,'private evidence QA filename');
    exact(object.rows[0].scan_status,'clean','private original passed malware scan');
    exact(object.rows[0].retention_state,'active','private original remains active');

    const file=await fetch(base+'/api/procurement/purchase-documents/'+documentId+'/file?business_id='+businessA,{
      headers:{Authorization:'Bearer '+merchant.token,Accept:'*/*','Cache-Control':'no-store'},
      cache:'no-store',signal:AbortSignal.timeout(15000)
    });
    const fileBytes=Buffer.from(await file.arrayBuffer());
    exact(file.status,200,'authenticated original download');
    exact(file.headers.get('cache-control'),'private, no-store, max-age=0','private no-store original');
    truth(fileBytes.length>0,'original download has content');

    const config=await call('/api/procurement/receipt-intelligence/config?business_id='+businessA);
    exact(config.status,200,'Receipt Intelligence configuration');
    exact(config.json?.manual_entry,true,'manual transcription remains available');
    exact(config.json?.stock_posting_enabled,false,'stock posting remains disabled');
    exact(config.json?.pdf_ai_enabled,false,'PDF AI remains disabled');
    const inventory=await call('/api/procurement/receipt-intelligence/inventory?business_id='+businessA);
    exact(inventory.status,200,'same-business Inventory candidates');
    truth((inventory.json?.inventory||[]).some(row=>Number(row.id)===inventoryA),'A Inventory candidate is visible');
    truth(!(inventory.json?.inventory||[]).some(row=>Number(row.id)===inventoryB),'B Inventory candidate is excluded');

    const noConsent=await post('/api/procurement/purchase-documents/'+documentId+'/intelligence/analyze',{
      business_id:businessA,allow_external_processing:false
    });
    exact(noConsent.status,403,'AI analysis without per-document consent is denied');
    const aiDrafts=await pool.query(
      "SELECT COUNT(*)::int n FROM receipt_intelligence_drafts WHERE business_id=$1 AND purchase_document_id=$2 AND provider='openai_vision'",
      [businessA,documentId]
    );
    exact(aiDrafts.rows[0]?.n,0,'no external provider analysis was created');

    const manualPath='/api/procurement/purchase-documents/'+documentId+'/intelligence/manual';
    const manualBody={business_id:businessA,extraction};
    const manual=await post(manualPath,manualBody);
    exact(manual.status,201,'manual extraction draft saved');
    const draftId=Number(manual.json?.draft?.id);
    truth(Number.isSafeInteger(draftId)&&draftId>0,'manual draft ID');
    exact(manual.json?.draft?.provider,'manual','manual provider provenance');
    exact(manual.json?.draft?.status,'draft','draft awaits human review');
    exact(manual.json?.draft?.stock_posted,false,'draft cannot post stock');
    exact(manual.json?.draft?.payment_recorded,false,'draft cannot record payment');
    exact(manual.json?.draft?.fiscal_validated,false,'draft is not a fiscal invoice');
    exact(manual.json?.draft?.extraction?.reconciliation?.status,'balanced','exact receipt total reconciliation');
    exact(Number(manual.json?.draft?.extraction?.matches?.[0]?.suggested_inventory_id),inventoryA,'same-business Inventory match is only a suggestion');

    const replay=await post(manualPath,manualBody);
    exact(replay.status,200,'manual extraction replay');
    exact(replay.json?.already_saved,true,'manual extraction replay is acknowledged');
    exact(Number(replay.json?.draft?.id),draftId,'manual replay does not create a second draft');
    const current=await call('/api/procurement/purchase-documents/'+documentId+'/intelligence?business_id='+businessA);
    exact(current.status,200,'saved draft read');
    exact(Number(current.json?.draft?.id),draftId,'saved draft belongs to original receipt');

    const reviewPath='/api/procurement/purchase-documents/'+documentId+'/intelligence/review';
    const reviewKey='qa860review_'+marker.replaceAll('-','');
    const reviewBody={
      business_id:businessA,draft_id:draftId,expected_version:1,client_request_key:reviewKey,
      decisions:[{line_index:0,action:'receive',inventory_id:inventoryA,
        received_quantity:1,received_unit:'kg',confirmed_total_cost:'50.00'}]
    };
    const reviewed=await post(reviewPath,reviewBody);
    exact(reviewed.status,200,'human review is saved');
    exact(reviewed.json?.already_saved,false,'first review intent');
    exact(reviewed.json?.review?.status,'reviewed_pending_physical_receiving','review requires physical receiving');
    exact(reviewed.json?.stock_posted,false,'review never posts stock');
    exact(reviewed.json?.review?.payment_recorded,false,'review never records payment');
    const reviewReplay=await post(reviewPath,reviewBody);
    exact(reviewReplay.status,200,'review replay');
    exact(reviewReplay.json?.already_saved,true,'review replay is acknowledged');
    const changedReview={...reviewBody,decisions:[{...reviewBody.decisions[0],received_quantity:2}]};
    exact((await post(reviewPath,changedReview)).status,409,'same review key with changed quantity is rejected');

    const readiness=await call('/api/procurement/purchase-documents/'+documentId+
      '/intelligence/receiving-readiness?business_id='+businessA);
    exact(readiness.status,200,'read-only receiving readiness');
    exact(readiness.json?.stock_posting_enabled,false,'receiving endpoint cannot post stock');
    exact(readiness.json?.preflight?.can_post_stock,false,'preflight has no stock-post permission');
    exact(readiness.json?.preflight?.stock_posted,false,'preflight stock remains unchanged');
    exact(readiness.json?.preflight?.payment_recorded,false,'preflight payment remains unchanged');
    exact(readiness.json?.preflight?.status,'ready_for_future_controlled_receiving','balanced review is ready for future controlled receiving');

    const duplicates=await call('/api/procurement/purchase-documents/'+documentId+
      '/intelligence/duplicates?business_id='+businessA);
    exact(duplicates.status,200,'same-business duplicate check');
    truth(Array.isArray(duplicates.json?.possible_duplicates),'duplicate result is structured');

    await select(businessB);
    const workspacesB=await call('/api/accounting/workspaces');
    exact(Number(workspacesB.json?.active_business_id),businessB,'B workspace selected');
    const inventoryBResponse=await call('/api/procurement/receipt-intelligence/inventory?business_id='+businessB);
    exact(inventoryBResponse.status,200,'B Inventory candidate list');
    truth((inventoryBResponse.json?.inventory||[]).some(row=>Number(row.id)===inventoryB),'B candidate remains in B');
    truth(!(inventoryBResponse.json?.inventory||[]).some(row=>Number(row.id)===inventoryA),'A candidate does not leak into B');
    exact((await call('/api/procurement/purchase-documents/'+documentId+
      '/intelligence?business_id='+businessB)).status,404,'B cannot read A intelligence draft');
    exact((await post(manualPath,{business_id:businessB,extraction})).status,404,'B cannot create draft for A original');

    await select(businessA);
    const restored=await call('/api/procurement/purchase-documents/'+documentId+'/intelligence?business_id='+businessA);
    exact(restored.status,200,'A context is restored after B');
    exact(Number(restored.json?.draft?.id),draftId,'A draft remains bound to A');

    const guest=await requestJson(base,'/api/procurement/receipt-intelligence/config?business_id='+businessA);
    exact(guest.status,401,'guest cannot read private Receipt Intelligence configuration');
    customer=await qaAccountSession({pool,base,secret,email:aliases.customer,role:'customer',label:'Receipt Intelligence 860 Customer QA'});
    const customerDenied=await request(customer.token,'/api/procurement/receipt-intelligence/config?business_id='+businessA);
    truth([403,404].includes(customerDenied.status),'Customer profile cannot read Merchant Receipt Intelligence');

    const after=await economicSnapshot(businessA,inventoryA);
    assert.deepEqual(after,before,'Receipt Intelligence must not mutate Inventory, lots, purchases or expenses');
    checks++;
  }catch(error){
    failure=error;
    console.error('Receipt Intelligence 860 assertion failure:',safeMessage(error));
  }finally{
    try{
      if(preferenceChanged&&merchant){
        if(originalPreference?.rowCount&&originalPreference.rows[0].business_id!=null){
          await pool.query(
            "UPDATE account_business_preferences SET business_id=$2 WHERE account_id=$1 AND role='merchant'",
            [merchant.accountId,originalPreference.rows[0].business_id]
          );
        }else{
          await pool.query("DELETE FROM account_business_preferences WHERE account_id=$1 AND role='merchant'",[merchant.accountId]);
        }
      }
      for(const business of businesses){
        const owned=await pool.query('SELECT name FROM businesses WHERE id=$1',[business.id]);
        if(!owned.rowCount)continue;
        if(owned.rows[0].name!==business.name)throw new Error('Receipt Intelligence QA cleanup business ownership mismatch');
        const docs=await pool.query(
          'SELECT id,private_evidence_object_id FROM merchant_purchase_documents '+
          'WHERE business_id=$1 AND created_by_account_id=$2 AND client_request_key=$3',
          [business.id,merchant.accountId,documentKey]
        );
        if(docs.rowCount>1)throw new Error('Receipt Intelligence QA cleanup found duplicate receipt rows');
        for(const doc of docs.rows){
          const id=Number(doc.id),objectId=Number(doc.private_evidence_object_id);
          if(documentId&&id!==documentId)throw new Error('Receipt Intelligence QA cleanup receipt ID mismatch');
          await pool.query(
            'DELETE FROM receipt_intelligence_reviews WHERE draft_id IN '+
            '(SELECT id FROM receipt_intelligence_drafts WHERE business_id=$1 AND purchase_document_id=$2)',
            [business.id,id]
          );
          await pool.query('DELETE FROM receipt_intelligence_drafts WHERE business_id=$1 AND purchase_document_id=$2',[business.id,id]);
          await pool.query('DELETE FROM receipt_intelligence_aliases WHERE business_id=$1 AND confirmed_by_account_id=$2',[business.id,merchant.accountId]);
          await pool.query('DELETE FROM merchant_purchase_document_evidence WHERE business_id=$1 AND document_id=$2',[business.id,id]);
          await pool.query('DELETE FROM merchant_purchase_document_metadata_audit WHERE business_id=$1 AND document_id=$2',[business.id,id]);
          await pool.query('DELETE FROM merchant_purchase_document_links WHERE document_id=$1',[id]);
          await pool.query(
            'DELETE FROM merchant_purchase_documents WHERE id=$1 AND business_id=$2 AND created_by_account_id=$3',
            [id,business.id,merchant.accountId]
          );
          if(Number.isSafeInteger(objectId)&&objectId>0){
            const evidence=await pool.query(
              "SELECT id,owner_account_id,created_by_account_id,source_type,source_id,original_file_name "+
              "FROM private_evidence_objects WHERE id=$1",[objectId]
            );
            if(evidence.rowCount!==1||Number(evidence.rows[0].owner_account_id)!==merchant.accountId||
               Number(evidence.rows[0].created_by_account_id)!==merchant.accountId||
               evidence.rows[0].source_type!=='merchant_purchase_document'||
               evidence.rows[0].source_id!==String(id)||evidence.rows[0].original_file_name!==fileName){
              throw new Error('Receipt Intelligence QA cleanup private evidence ownership mismatch');
            }
            await deletePrivateEvidence(pool,{objectId,actorAccountId:merchant.accountId,purpose:'qa_856_fixture_cleanup'});
            await pool.query('DELETE FROM private_evidence_access_audit WHERE object_id=$1',[objectId]);
            await pool.query(
              "DELETE FROM private_evidence_objects WHERE id=$1 AND owner_account_id=$2 AND source_type='merchant_purchase_document' AND source_id=$3 AND original_file_name=$4",
              [objectId,merchant.accountId,String(id),fileName]
            );
          }
        }
        const pending=await pool.query(
          "SELECT id,owner_account_id,created_by_account_id FROM private_evidence_objects "+
          "WHERE owner_account_id=$1 AND source_type='merchant_purchase_document' AND source_id='pending' AND original_file_name=$2",
          [merchant.accountId,fileName]
        );
        if(pending.rowCount>1)throw new Error('Receipt Intelligence QA cleanup found duplicate pending objects');
        for(const row of pending.rows){
          const objectId=Number(row.id);
          if(Number(row.owner_account_id)!==merchant.accountId||Number(row.created_by_account_id)!==merchant.accountId){
            throw new Error('Receipt Intelligence QA cleanup pending object ownership mismatch');
          }
          await deletePrivateEvidence(pool,{objectId,actorAccountId:merchant.accountId,purpose:'qa_856_fixture_cleanup'});
          await pool.query('DELETE FROM private_evidence_access_audit WHERE object_id=$1',[objectId]);
          await pool.query(
            "DELETE FROM private_evidence_objects WHERE id=$1 AND owner_account_id=$2 AND source_type='merchant_purchase_document' AND source_id='pending' AND original_file_name=$3",
            [objectId,merchant.accountId,fileName]
          );
        }
        await pool.query('DELETE FROM receipt_intelligence_aliases WHERE business_id=$1',[business.id]);
        await pool.query('DELETE FROM merchant_purchase_document_metadata_audit WHERE business_id=$1',[business.id]);
        await pool.query('DELETE FROM merchant_purchase_document_links WHERE document_id IN (SELECT id FROM merchant_purchase_documents WHERE business_id=$1)',[business.id]);
        await pool.query('DELETE FROM merchant_purchase_documents WHERE business_id=$1',[business.id]);
        for(const table of ['inventory_count_session_items','inventory_count_sessions','inventory_lot_location_balances',
          'inventory_location_balances','inventory_purchases','supply_lots','transactions','inventory',
          'inventory_storage_locations','budgets']){
          await pool.query('DELETE FROM '+table+' WHERE business_id=$1',[business.id]);
        }
        await pool.query('DELETE FROM profile_business_bindings WHERE account_id=$1 AND business_id=$2',[merchant.accountId,business.id]);
        await pool.query('DELETE FROM business_memberships WHERE account_id=$1 AND business_id=$2',[merchant.accountId,business.id]);
        await pool.query('DELETE FROM businesses WHERE id=$1',[business.id]);
      }
      fixturesRemoved=true;
    }catch(error){
      console.error('Receipt Intelligence 860 cleanup failure:',safeMessage(error));
      failure=new Error('Receipt Intelligence 860 fixture cleanup failed'+(failure?' after an acceptance failure':''),{cause:error});
    }
    for(const session of [customer,merchant]){
      if(!session?.token)continue;
      await requestJson(base,'/api/auth/logout',{method:'POST',token:session.token,body:{}})
        .catch(error=>{if(!failure)failure=error});
    }
  }
  if(failure)throw failure;
  return{
    status:'PASS',wave:RECEIPT_INTELLIGENCE_860_WAVE,checks,
    authenticated_http:true,company_test_merchant:true,private_original_upload_download:true,
    manual_draft_and_review:true,stable_replay_and_conflict:true,read_only_receiving_preflight:true,
    no_consent_ai_denied:true,foreign_business_and_customer_denied:true,
    merchant_context_a_b_a:true,economic_records_unchanged:true,fixtures_removed:fixturesRemoved
  };
}
