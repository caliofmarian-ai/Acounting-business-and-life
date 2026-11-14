import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {validateRuntimeSafety} from './runtime-safety.js';

export const RECEIPT_VARIANCE_860_WAVE='receipt_variance_860';

export function assertReceiptVarianceLoopback(base){
  let url;
  try{url=new URL(base)}catch{throw new Error('Receipt variance QA requires an internal Preview URL.')}
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password){
    throw new Error('Receipt variance QA accepts only the internal loopback Preview URL.');
  }
  return url;
}

async function waitForLock(pool,pattern,label){
  for(let attempt=0;attempt<160;attempt++){
    const result=await pool.query(
      'SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type=$2 AND query LIKE $1 LIMIT 1',
      [pattern,'Lock']
    );
    if(result.rowCount)return;
    await sleep(40);
  }
  throw new Error('Receipt variance QA did not observe the expected PostgreSQL lock wait: '+label);
}

export async function runReceiptVariance860Acceptance({
  pool,base,secret,env=process.env,aliases,helpers
}){
  const runtime=validateRuntimeSafety(env);
  if(!runtime.previewService||runtime.appEnvironment!=='qa'||
      !/(?:^|_)(?:qa|test)$/.test(runtime.databaseName)){
    throw new Error('Receipt variance QA requires the isolated accounting-preview QA database.');
  }
  assertReceiptVarianceLoopback(base);
  if(String(secret||'').length<32)throw new Error('Receipt variance QA requires the dedicated QA automation secret.');
  const database=await pool.query('SELECT current_database() AS name');
  if(database.rows[0]?.name!==runtime.databaseName)throw new Error('Receipt variance QA database target mismatch.');

  const {qaAccountSession,ensureActiveRole}=helpers;
  const marker=crypto.randomUUID(),businesses=[],names=[];
  let merchant=null,originalPreference=null,preferenceChanged=false;
  let inventoryId=null,purchaseId=null,documentId=null,sessionId=null;
  let failure=null,checks=0,fixturesRemoved=false;
  const exact=(actual,expected,label)=>{assert.equal(actual,expected,'Receipt variance 860: '+label);checks++};
  const truth=(condition,label)=>{assert.ok(condition,'Receipt variance 860: '+label);checks++};
  const httpJson=async(path,{method='GET',token='',body,headers:extraHeaders={}}={})=>{
    const headers={Accept:'application/json','Cache-Control':'no-store',...extraHeaders};
    if(token)headers.Authorization='Bearer '+token;
    let payload;
    if(body!==undefined){headers['Content-Type']='application/json';payload=JSON.stringify(body)}
    const response=await fetch(base+path,{
      method,headers,body:payload,cache:'no-store',signal:AbortSignal.timeout(15000)
    });
    const json=await response.json().catch(()=>({}));
    return{status:response.status,json,headers:response.headers};
  };
  const call=(path,options={})=>httpJson(path,{...options,token:merchant.token});
  const evidencePath=()=>'/api/procurement/receipt-intelligence/count-sessions/'+sessionId+'/variance-evidence?business_id='+businesses[0];
  const stockSnapshot=async()=>{
    const result=await pool.query(
      'SELECT i.quantity::text quantity,'+
      '(SELECT COUNT(*)::int FROM inventory_purchases WHERE business_id=$1) purchases,'+
      '(SELECT COUNT(*)::int FROM transactions WHERE business_id=$1) transactions '+
      'FROM inventory i WHERE i.id=$2 AND i.business_id=$1',
      [businesses[0],inventoryId]
    );
    if(result.rowCount!==1)throw new Error('Receipt variance QA stock fixture disappeared.');
    return result.rows[0];
  };

  try{
    merchant=await qaAccountSession({
      pool,base,secret,email:aliases.merchant,role:'merchant',label:'Receipt variance 860 Merchant QA'
    });
    const me=await call('/api/me');
    exact(me.status,200,'authenticated Merchant session');
    exact(me.json?.account?.account_mode,'company_test','controlled company_test identity');
    exact(me.json?.account?.test_role,'merchant','Merchant-only test identity');
    exact(me.json?.account?.active_role,'merchant','active Merchant profile');
    await ensureActiveRole({base,token:merchant.token,role:'merchant',label:'Receipt variance 860 Merchant QA'});

    originalPreference=await pool.query(
      "SELECT business_id FROM account_business_preferences WHERE account_id=$1 AND role='merchant'",
      [merchant.accountId]
    );
    for(const suffix of ['A','B']){
      const name='QA Receipt Variance 860 '+marker+' '+suffix;
      const created=await pool.query(
        "INSERT INTO businesses(name,country_code,currency_code) VALUES($1,'PH','PHP') RETURNING id",
        [name]
      );
      const id=Number(created.rows[0]?.id);
      if(!Number.isSafeInteger(id)||id<=0)throw new Error('Receipt variance QA business fixture was not created.');
      businesses.push(id);names.push(name);
    }
    const [businessA,businessB]=businesses;
    await pool.query(
      "INSERT INTO business_memberships(business_id,account_id,membership_role,active) VALUES($1,$2,'owner',TRUE)",
      [businessA,merchant.accountId]
    );
    await pool.query(
      "INSERT INTO profile_business_bindings(account_id,role,business_id,status,is_primary) VALUES($1,'merchant',$2,'active',FALSE)",
      [merchant.accountId,businessA]
    );
    await pool.query(
      "INSERT INTO account_business_preferences(account_id,role,business_id) VALUES($1,'merchant',$2) "+
      "ON CONFLICT(account_id,role) DO UPDATE SET business_id=EXCLUDED.business_id",
      [merchant.accountId,businessA]
    );
    preferenceChanged=true;

    const inventory=await pool.query(
      "INSERT INTO inventory(business_id,item,unit,base_unit,quantity,unit_cost,inventory_type,inventory_domain,stock_role,storage_condition,storage_area_type) "+
      "VALUES($1,$2,'g','g',1000,0.05,'ingredient','food','ingredient','dry','pantry') RETURNING id",
      [businessA,'QA860 '+marker+' synthetic rice']
    );
    inventoryId=Number(inventory.rows[0]?.id);
    const purchase=await pool.query(
      "INSERT INTO inventory_purchases(business_id,inventory_id,purchase_quantity,purchase_unit,base_quantity,base_unit,total_cost,account,note) "+
      "VALUES($1,$2,1,'kg',1000,'g',50,'cash','Synthetic QA fixture only') RETURNING id",
      [businessA,inventoryId]
    );
    purchaseId=Number(purchase.rows[0]?.id);
    const documentKey='qa860_'+marker.replaceAll('-','');
    const fingerprint=crypto.createHash('sha256').update('receipt-variance-860:'+marker).digest('hex');
    const document=await pool.query(
      "INSERT INTO merchant_purchase_documents(business_id,created_by_account_id,client_request_key,request_fingerprint,document_kind,issuer_name,document_number,issue_date,currency_code,gross_amount,note) "+
      "VALUES($1,$2,$3,$4,'purchase_receipt','QA synthetic market',$5,'2026-11-14','PHP',50,'Synthetic QA receipt metadata only') RETURNING id",
      [businessA,merchant.accountId,documentKey,fingerprint,'QA860-'+marker.slice(0,8)]
    );
    documentId=Number(document.rows[0]?.id);
    await pool.query(
      "INSERT INTO merchant_purchase_document_links(document_id,link_kind,linked_id) VALUES($1,'inventory_purchase',$2)",
      [documentId,purchaseId]
    );
    const session=await pool.query(
      "INSERT INTO inventory_count_sessions(business_id,count_type,scope_type,scope_value,status,actor_account_id,reviewed_by_account_id,reviewed_at) "+
      "VALUES($1,'full','all','','review',$2,$2,NOW()) RETURNING id",
      [businessA,merchant.accountId]
    );
    sessionId=Number(session.rows[0]?.id);
    await pool.query(
      "INSERT INTO inventory_count_session_items(session_id,inventory_id,expected_quantity,unit_snapshot,unit_cost_snapshot,counted_quantity,counted_by_account_id,counted_at) "+
      "VALUES($1,$2,1000,'g',0.05,800,$3,NOW())",
      [sessionId,inventoryId,merchant.accountId]
    );

    const workspaces=await call('/api/accounting/workspaces');
    exact(workspaces.status,200,'Merchant workspace list');
    exact(Number(workspaces.json?.active_business_id),businessA,'isolated A workspace selected');
    truth((workspaces.json?.businesses||[]).some(row=>Number(row.id)===businessA),'A workspace is authorized');

    const initial=await call(evidencePath());
    exact(initial.status,200,'reviewed count evidence');
    exact(initial.json?.count_session_id,sessionId,'exact count session');
    exact(initial.json?.session_status,'review','review status');
    exact(initial.json?.stock_posted,false,'evidence is never stock posting');
    exact(initial.json?.findings?.length,1,'one synthetic variance finding');
    exact(Number(initial.json.findings[0].expected),1000,'expected quantity');
    exact(Number(initial.json.findings[0].counted),800,'counted quantity');
    exact(Number(initial.json.findings[0].variance),-200,'variance quantity');
    exact(Number(initial.json.findings[0].last_purchase?.id),purchaseId,'latest purchase association');
    exact(Number(initial.json.findings[0].receipt?.id),documentId,'linked receipt association');
    exact(initial.headers.get('cache-control'),'private, no-store, max-age=0','private no-store response');

    const guest=await httpJson(evidencePath());
    exact(guest.status,401,'guest cannot read private variance evidence');
    const foreign=await call('/api/procurement/receipt-intelligence/count-sessions/'+sessionId+
      '/variance-evidence?business_id='+businessB);
    truth([403,404].includes(foreign.status),'unbound foreign business denied');
    truth(!Array.isArray(foreign.json?.findings),'foreign denial returns no evidence');

    const before=await stockSnapshot();

    let firstBlocker=null,firstEvidence=null;
    try{
      firstBlocker=await pool.connect();
      await firstBlocker.query('BEGIN');
      await firstBlocker.query(
        'SELECT id FROM inventory_count_sessions WHERE id=$1 AND business_id=$2 FOR UPDATE',
        [sessionId,businessA]
      );
      await firstBlocker.query(
        "UPDATE inventory_count_sessions SET status='in_progress' WHERE id=$1 AND business_id=$2",
        [sessionId,businessA]
      );
      firstEvidence=call(evidencePath());
      await waitForLock(pool,'SELECT status FROM inventory_count_sessions%FOR SHARE','resume-first evidence lock');
      await firstBlocker.query('COMMIT');
      const denied=await firstEvidence;
      exact(denied.status,409,'resume-first denial');
      exact(denied.json?.error,'Finish blind counting before viewing documents','resume-first error');
      exact(denied.headers.get('cache-control'),'private, no-store, max-age=0','resume-first no-store');
    }finally{
      if(firstBlocker){
        await firstBlocker.query('ROLLBACK').catch(()=>{});
        firstBlocker.release();
      }
      if(firstEvidence)await firstEvidence.catch(()=>{});
    }

    await pool.query(
      "UPDATE inventory_count_sessions SET status='review' WHERE id=$1 AND business_id=$2",
      [sessionId,businessA]
    );

    let secondBlocker=null,secondEvidence=null,secondResume=null;
    try{
      secondBlocker=await pool.connect();
      await secondBlocker.query('BEGIN');
      await secondBlocker.query('LOCK TABLE inventory_count_session_items IN ACCESS EXCLUSIVE MODE');
      secondEvidence=call(evidencePath());
      await waitForLock(pool,'%FROM inventory_count_session_items si%','evidence-first findings lock');
      secondResume=call('/api/inventory/count-sessions/'+sessionId+'/resume',{method:'POST',headers:{'x-abl-inventory-origin-business':String(businessA)},body:{}});
      await waitForLock(pool,'%FROM inventory_count_sessions%FOR UPDATE%','evidence-first resume lock');
      await secondBlocker.query('COMMIT');
      const [visible,resumed]=await Promise.all([secondEvidence,secondResume]);
      exact(visible.status,200,'evidence-first reviewed snapshot');
      exact(visible.json?.session_status,'review','review status held through findings read');
      exact(visible.json?.findings?.length,1,'evidence-first finding');
      exact(visible.headers.get('cache-control'),'private, no-store, max-age=0','evidence-first no-store');
      exact(resumed.status,200,'real authenticated resume endpoint');
      exact(resumed.json?.status,'in_progress','resume proceeds only after evidence read commits');
    }finally{
      if(secondBlocker){
        await secondBlocker.query('ROLLBACK').catch(()=>{});
        secondBlocker.release();
      }
      if(secondEvidence)await secondEvidence.catch(()=>{});
      if(secondResume)await secondResume.catch(()=>{});
    }

    const afterResume=await call(evidencePath());
    exact(afterResume.status,409,'resumed blind count hides variance evidence');
    const after=await stockSnapshot();
    exact(after.quantity,before.quantity,'evidence and resume do not change Inventory quantity');
    exact(after.purchases,before.purchases,'evidence and resume do not create purchases');
    exact(after.transactions,before.transactions,'evidence and resume do not create financial transactions');
    truth(Number(after.transactions)===0,'synthetic route acceptance created no cash or expense transaction');
  }catch(error){
    failure=error;
  }finally{
    try{
      if(merchant){
        const cleanup=await pool.connect();
        try{
          await cleanup.query('BEGIN');
          if(preferenceChanged){
            if(originalPreference?.rowCount){
              await cleanup.query(
                "UPDATE account_business_preferences SET business_id=$2 WHERE account_id=$1 AND role='merchant'",
                [merchant.accountId,originalPreference.rows[0].business_id]
              );
            }else{
              await cleanup.query(
                "DELETE FROM account_business_preferences WHERE account_id=$1 AND role='merchant'",
                [merchant.accountId]
              );
            }
          }
          if(sessionId){
            const row=await cleanup.query(
              'SELECT business_id,actor_account_id FROM inventory_count_sessions WHERE id=$1 FOR UPDATE',
              [sessionId]
            );
            if(row.rowCount&&(Number(row.rows[0].business_id)!==businesses[0]||
                Number(row.rows[0].actor_account_id)!==merchant.accountId)){
              throw new Error('Receipt variance QA count-session cleanup ownership mismatch.');
            }
            await cleanup.query(
              'DELETE FROM inventory_count_sessions WHERE id=$1 AND business_id=$2 AND actor_account_id=$3',
              [sessionId,businesses[0],merchant.accountId]
            );
          }
          if(documentId){
            const row=await cleanup.query(
              'SELECT business_id,created_by_account_id,client_request_key FROM merchant_purchase_documents WHERE id=$1 FOR UPDATE',
              [documentId]
            );
            if(row.rowCount&&(Number(row.rows[0].business_id)!==businesses[0]||
                Number(row.rows[0].created_by_account_id)!==merchant.accountId||
                row.rows[0].client_request_key!=='qa860_'+marker.replaceAll('-',''))){
              throw new Error('Receipt variance QA receipt cleanup ownership mismatch.');
            }
            await cleanup.query('DELETE FROM merchant_purchase_document_links WHERE document_id=$1',[documentId]);
            await cleanup.query(
              'DELETE FROM merchant_purchase_documents WHERE id=$1 AND business_id=$2 AND created_by_account_id=$3',
              [documentId,businesses[0],merchant.accountId]
            );
          }
          if(purchaseId){
            const row=await cleanup.query(
              'SELECT business_id,inventory_id FROM inventory_purchases WHERE id=$1 FOR UPDATE',[purchaseId]
            );
            if(row.rowCount&&(Number(row.rows[0].business_id)!==businesses[0]||
                Number(row.rows[0].inventory_id)!==inventoryId)){
              throw new Error('Receipt variance QA purchase cleanup ownership mismatch.');
            }
            await cleanup.query(
              'DELETE FROM inventory_purchases WHERE id=$1 AND business_id=$2 AND inventory_id=$3',
              [purchaseId,businesses[0],inventoryId]
            );
          }
          for(const businessId of businesses){
            await cleanup.query(
              'DELETE FROM inventory_adjustment_lot_allocations WHERE inventory_id IN (SELECT id FROM inventory WHERE business_id=$1)',
              [businessId]
            );
            for(const table of ['inventory_lot_location_balances','inventory_location_balances','supply_lots',
              'inventory_adjustments','transactions','inventory_storage_locations','budgets']){
              await cleanup.query('DELETE FROM '+table+' WHERE business_id=$1',[businessId]);
            }
          }
          if(inventoryId){
            const row=await cleanup.query(
              'SELECT business_id,item FROM inventory WHERE id=$1 FOR UPDATE',[inventoryId]
            );
            if(row.rowCount&&(Number(row.rows[0].business_id)!==businesses[0]||
                row.rows[0].item!=='QA860 '+marker+' synthetic rice')){
              throw new Error('Receipt variance QA Inventory cleanup ownership mismatch.');
            }
            await cleanup.query(
              'DELETE FROM inventory WHERE id=$1 AND business_id=$2 AND item=$3',
              [inventoryId,businesses[0],'QA860 '+marker+' synthetic rice']
            );
          }
          for(let index=0;index<businesses.length;index++){
            const businessId=businesses[index],name=names[index];
            const row=await cleanup.query('SELECT name FROM businesses WHERE id=$1 FOR UPDATE',[businessId]);
            if(!row.rowCount)continue;
            if(row.rows[0].name!==name)throw new Error('Receipt variance QA business cleanup ownership mismatch.');
            await cleanup.query(
              "DELETE FROM profile_business_bindings WHERE account_id=$1 AND role='merchant' AND business_id=$2",
              [merchant.accountId,businessId]
            );
            await cleanup.query(
              'DELETE FROM business_memberships WHERE account_id=$1 AND business_id=$2',
              [merchant.accountId,businessId]
            );
            await cleanup.query('DELETE FROM businesses WHERE id=$1 AND name=$2',[businessId,name]);
          }
          await cleanup.query('COMMIT');
          fixturesRemoved=true;
        }catch(cleanupError){
          await cleanup.query('ROLLBACK').catch(()=>{});
          throw cleanupError;
        }finally{cleanup.release()}
      }
    }catch(cleanupError){
      failure=new Error('Receipt variance 860 fixture cleanup failed'+(failure?' after acceptance failure':''),{cause:cleanupError});
    }
    if(merchant){
      try{await httpJson('/api/auth/logout',{method:'POST',token:merchant.token,body:{}})}
      catch(logoutError){if(!failure)failure=logoutError}
    }
  }
  if(failure)throw failure;
  return{
    status:'PASS',wave:RECEIPT_VARIANCE_860_WAVE,checks,
    authenticated_company_test:true,reviewed_variance_private:true,
    resume_first_denied:true,evidence_first_serialized:true,
    foreign_business_denied:true,guest_denied:true,
    stock_finance_unchanged:true,fixtures_removed:fixturesRemoved
  };
}
