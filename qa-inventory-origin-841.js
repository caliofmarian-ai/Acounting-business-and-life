import assert from 'node:assert/strict';
import crypto from 'node:crypto';

export const INVENTORY_ORIGIN_841_WAVE='inventory_origin_841';

// Only the guarded Preview runner or the disposable localhost CI runner calls
// this fixture. Every created business/stock/expense belongs to this unique run.
export async function exerciseInventoryOrigin841({pool,base,token,accountId,beforePurchase}){
  const label='QA Inventory origin 841 '+crypto.randomUUID();
  const ids=[];
  let checks=0,primaryError=null;
  const same=(actual,expected,message)=>{assert.equal(actual,expected,message);checks++};
  const original=await pool.query("SELECT business_id FROM account_business_preferences WHERE account_id=$1 AND role='merchant'",[accountId]);
  const call=async(path,{method='GET',origin,body,authenticated=true}={})=>{
    const r=await fetch(base+path,{method,signal:AbortSignal.timeout(25000),headers:{
      'Content-Type':'application/json',...(authenticated?{Authorization:'Bearer '+token}:{}),
      ...(origin==null?{}:{'x-abl-inventory-origin-business':String(origin)})
    },...(body==null?{}:{body:JSON.stringify(body)})});
    return{status:r.status,body:await r.json().catch(()=>null)};
  };
  const fingerprint=async id=>{
    const tables=['inventory','inventory_purchases','transactions','supply_lots',
      'inventory_storage_locations','inventory_location_balances','inventory_lot_location_balances',
      'inventory_count_sessions'];
    const rows=await Promise.all(tables.map(table=>pool.query(
      `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM ${table} t WHERE business_id=$1`,[id]
    )));
    return JSON.stringify(rows.map(r=>r.rows[0].rows));
  };
  try{
    for(const suffix of ['A','B']){
      const b=await pool.query("INSERT INTO businesses(name,country_code,currency_code) VALUES($1,'PH','PHP') RETURNING id",[label+' '+suffix]);
      const id=Number(b.rows[0].id);ids.push(id);
      await pool.query("INSERT INTO business_memberships(business_id,account_id,membership_role,active) VALUES($1,$2,'owner',TRUE)",[id,accountId]);
      await pool.query("INSERT INTO profile_business_bindings(account_id,role,business_id,status,is_primary) VALUES($1,'merchant',$2,'active',FALSE)",[accountId,id]);
    }
    const [a,b]=ids;
    await pool.query("INSERT INTO account_business_preferences(account_id,role,business_id) VALUES($1,'merchant',$2) ON CONFLICT(account_id,role) DO UPDATE SET business_id=EXCLUDED.business_id",[accountId,a]);
    // B has deliberate location drift. An A request must not even repair B.
    await pool.query("INSERT INTO inventory(business_id,item,unit,base_unit,quantity,unit_cost,inventory_type,inventory_domain,stock_role,storage_condition,storage_area_type) VALUES($1,$2,'g','g',7,1,'ingredient','food','ingredient','dry','pantry')",[b,label+' untouched B']);
    const beforeB=await fingerprint(b);
    const purchaseBody={item:label+' flour',purchase_quantity:2,purchase_unit:'kg',total_cost:12.34,
      inventory_type:'ingredient',inventory_domain:'food',stock_role:'ingredient',
      storage_condition:'dry',storage_area_type:'pantry',account:'cash',record_expense:true};
    let purchased;
    if(beforePurchase){
      purchased=await beforePurchase({a,b,call,body:purchaseBody});
    }else{
      await pool.query("UPDATE account_business_preferences SET business_id=$2 WHERE account_id=$1 AND role='merchant'",[accountId,b]);
      purchased=await call('/api/inventory/purchase',{method:'POST',origin:a,body:purchaseBody});
    }
    same(purchased.status,201,'origin A purchase succeeds while B is selected');
    for(const key of ['inventory','purchase','lot','transaction'])
      same(Number(purchased.body?.[key]?.business_id),a,key+' remains in A');
    same(Number(purchased.body.inventory.quantity),2000,'converted A stock quantity');
    same(Number(purchased.body.transaction.amount),12.34,'exact A expense');
    same(await fingerprint(b),beforeB,'A purchase cannot derive any B stock/lot/expense');
    const preference=await pool.query("SELECT business_id FROM account_business_preferences WHERE account_id=$1 AND role='merchant'",[accountId]);
    same(Number(preference.rows[0].business_id),b,'A completion must not reset B preference');
    const afterA=await fingerprint(a);
    for(const origin of [undefined,'0','-1','01','1e3','9007199254740993']){
      same((await call('/api/inventory/purchase',{method:'POST',origin,body:purchaseBody})).status,409,'missing/invalid origin denied');
    }
    same((await call('/api/inventory/purchase',{method:'POST',origin:2147483647,body:purchaseBody})).status,403,'unbound origin denied');
    same((await call('/api/inventory/purchase',{method:'POST',origin:a,body:purchaseBody,authenticated:false})).status,401,'guest denied');
    same(await fingerprint(a),afterA,'denied purchases leave A unchanged');
    same(await fingerprint(b),beforeB,'denied purchases leave B unchanged');
    const inventoryId=Number(purchased.body.inventory.id);
    for(const [path,method,body] of [
      [`/api/inventory/${inventoryId}/identifiers`,'PATCH',{internal_sku:'QA841'}],
      [`/api/inventory/${inventoryId}/storage`,'PUT',{storage_condition:'dry',storage_area_type:'pantry'}],
      ['/api/inventory/purchase','POST',{...purchaseBody,inventory_id:inventoryId}]
    ]){
      same((await call(path,{method,origin:b,body})).status,404,'B cannot mutate an A item');
    }
    same(await fingerprint(b),beforeB,'foreign item mutations leave B unchanged');
    const identifiers=await call(`/api/inventory/${inventoryId}/identifiers`,{method:'PATCH',origin:a,body:{internal_sku:'QA841-'+inventoryId}});
    same(identifiers.status,200,'same-business identifiers control');
    same(Number(identifiers.body.business_id),a,'identifier update stays in A');

    // All three optimized/legacy read paths can repair drift, so require origin.
    await pool.query('DELETE FROM inventory_lot_location_balances WHERE business_id=$1',[a]);
    await pool.query('DELETE FROM inventory_location_balances WHERE business_id=$1',[a]);
    for(const path of ['/api/inventory/locations','/api/inventory/location-balances','/api/inventory/location-summary']){
      same((await call(path)).status,409,'repairing GET requires origin');
      same((await call(path,{origin:2147483647})).status,403,'repairing GET rejects unbound origin');
      same((await call(path,{origin:a})).status,200,'repairing GET is pinned to A');
      same(await fingerprint(b),beforeB,'A read repair never touches B drift');
    }
    const repaired=await pool.query('SELECT SUM(quantity) quantity FROM inventory_location_balances WHERE business_id=$1 AND inventory_id=$2',[a,inventoryId]);
    same(Number(repaired.rows[0].quantity),2000,'A location repair keeps physical total');
    const lots=await pool.query('SELECT SUM(quantity) quantity FROM inventory_lot_location_balances WHERE business_id=$1',[a]);
    same(Number(lots.rows[0].quantity),2000,'A lot repair keeps physical total');
    const started=await call('/api/inventory/count-sessions',{method:'POST',origin:a,body:{count_type:'full',scope_type:'all',scope_value:''}});
    same(started.status,201,'same-business count control');
    same(Number(started.body.business_id),a,'count session stays in A');
    same(await fingerprint(b),beforeB,'A count leaves B unchanged');
    // Legitimate explicit B operation is still accepted.
    const location=await call('/api/inventory/locations',{method:'POST',origin:b,body:{name:label+' B location',storage_condition:'dry',storage_area_type:'pantry'}});
    same(location.status,201,'legitimate B location control');
    same(Number(location.body.business_id),b,'B control is bound to B');
    return{status:'PASS',wave:INVENTORY_ORIGIN_841_WAVE,checks,authenticated_http:true,
      stock_lot_expense_origin:true,repairing_reads_origin:true,fixtures_removed:true};
  }catch(error){primaryError=error;throw error}
  finally{
    try{
      if(original.rowCount)await pool.query("UPDATE account_business_preferences SET business_id=$2 WHERE account_id=$1 AND role='merchant'",[accountId,original.rows[0].business_id]);
      else await pool.query("DELETE FROM account_business_preferences WHERE account_id=$1 AND role='merchant'",[accountId]);
      // Exact private run IDs only. Never delete or alter pre-existing stock.
      for(const id of ids){
        const owned=await pool.query('SELECT id FROM businesses WHERE id=$1 AND name LIKE $2',[id,label+' %']);
        if(owned.rowCount!==1)throw new Error('Inventory 841 cleanup ownership mismatch');
        for(const table of ['inventory_count_sessions','inventory_lot_location_balances','inventory_location_balances','inventory_purchases','supply_lots','transactions','inventory','inventory_storage_locations','budgets'])
          await pool.query(`DELETE FROM ${table} WHERE business_id=$1`,[id]);
        await pool.query('DELETE FROM businesses WHERE id=$1',[id]);
      }
    }catch(cleanupError){
      throw new Error('Inventory 841 fixture cleanup failed'+(primaryError?' after acceptance failure':''),{cause:cleanupError});
    }
  }
}

export async function runInventoryOrigin841Acceptance({pool,base,secret,aliases,helpers}){
  const {requestJson,expectStatus,qaAccountSession,ensureActiveRole}=helpers;
  const merchant=await qaAccountSession({pool,base,secret,email:aliases.merchant,role:'merchant',label:'Inventory origin 841 QA'});
  try{
    const me=await requestJson(base,'/api/me',{token:merchant.token});expectStatus(me,200,'Inventory 841 QA identity');
    if(me.json?.account?.account_mode!=='company_test'||me.json?.account?.test_role!=='merchant')
      throw new Error('Inventory 841 requires the classified company_test Merchant');
    await ensureActiveRole({base,token:merchant.token,role:'merchant',label:'Inventory 841 Merchant'});
    return await exerciseInventoryOrigin841({pool,base,token:merchant.token,accountId:merchant.accountId});
  }finally{
    await requestJson(base,'/api/auth/logout',{method:'POST',token:merchant.token,body:{}});
  }
}
