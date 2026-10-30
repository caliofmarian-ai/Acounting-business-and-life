import {performance} from 'node:perf_hooks';
import {validateRuntimeSafety} from './runtime-safety.js';

export const INVENTORY_LOCATION_READ_862_WAVE='inventory_location_read_862';
export const INVENTORY_862_PATHS=Object.freeze([
  '/api/inventory/locations',
  '/api/inventory/location-balances'
]);

export function inventory862Percentile(values,percentage=0.95){
  const samples=(values||[]).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!samples.length)throw new Error('Inventory 862 requires actual latency samples.');
  if(!(percentage>=0&&percentage<=1))throw new TypeError('Invalid percentile.');
  return Number(samples[Math.max(0,Math.ceil(samples.length*percentage)-1)].toFixed(2));
}
export function inventory862AssertScopedRows(rows,businessId,path){
  if(!Array.isArray(rows))throw new Error('Inventory 862 '+path+' returned a non-array payload.');
  if(rows.some(row=>Number(row.business_id)!==Number(businessId)))
    throw new Error('Inventory 862 cross-business rows detected in '+path);
  return rows.length;
}
export function inventory862ValidateRuntime(env=process.env){
  const runtime=validateRuntimeSafety(env);
  if(!runtime.previewService||runtime.appEnvironment!=='qa'||
      !/(?:^|_)(?:qa|test)$/.test(runtime.databaseName)){
    throw new Error('Inventory 862 authenticated performance QA requires isolated Preview QA only.');
  }
  return runtime;
}

const BUSINESS_FINGERPRINT_SQL=[
  "SELECT",
  "(SELECT md5(COALESCE(string_agg(i.id::text||':'||i.quantity::text||':'||i.updated_at::text,',' ORDER BY i.id),'')) FROM inventory i WHERE i.business_id=$1) AS inventory,",
  "(SELECT md5(COALESCE(string_agg(l.id::text||':'||l.quantity_remaining_base::text,',' ORDER BY l.id),'')) FROM supply_lots l WHERE l.business_id=$1) AS lots,",
  "(SELECT md5(COALESCE(string_agg(b.inventory_id::text||':'||b.location_id::text||':'||b.quantity::text,',' ORDER BY b.inventory_id,b.location_id),'')) FROM inventory_location_balances b WHERE b.business_id=$1) AS location_balances,",
  "(SELECT md5(COALESCE(string_agg(b.lot_id::text||':'||b.location_id::text||':'||b.quantity::text,',' ORDER BY b.lot_id,b.location_id),'')) FROM inventory_lot_location_balances b WHERE b.business_id=$1) AS lot_location_balances,",
  "(SELECT md5(COALESCE(string_agg(t.id::text||':'||t.amount::text||':'||t.account,',' ORDER BY t.id),'')) FROM transactions t WHERE t.business_id=$1) AS transactions,",
  "(SELECT md5(COALESCE(string_agg(p.id::text||':'||p.total_cost::text,',' ORDER BY p.id),'')) FROM inventory_purchases p WHERE p.business_id=$1) AS purchases"
].join(' ');

async function fingerprintBusiness(pool,businessId){
  const result=await pool.query(BUSINESS_FINGERPRINT_SQL,[businessId]);
  if(result.rows.length!==1)throw new Error('Inventory 862 fingerprint unavailable.');
  return result.rows[0];
}
async function measureAuthorized(base,path,token=''){
  const started=performance.now();
  const headers={Accept:'application/json','Cache-Control':'no-store'};
  if(token)headers.Authorization='Bearer '+token;
  const response=await fetch(base+path,{headers,cache:'no-store',signal:AbortSignal.timeout(12000)});
  const body=await response.json().catch(()=>null);
  const elapsed=Number((performance.now()-started).toFixed(2));
  return{status:response.status,body,elapsed};
}
function assertHttp(result,status,label){
  if(result.status!==status)throw new Error(label+' returned HTTP '+result.status+' instead of '+status);
}
async function selectBusiness({base,token,businessId}){
  const response=await fetch(base+'/api/accounting/active-workspace',{
    method:'PATCH',
    headers:{Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+token},
    body:JSON.stringify({business_id:businessId}),
    signal:AbortSignal.timeout(12000)
  });
  if(response.status!==200)throw new Error('Inventory 862 QA business switch failed with '+response.status);
  const body=await response.json();
  if(Number(body?.business?.id)!==Number(businessId))throw new Error('Inventory 862 QA business switch mismatch.');
}

export async function runInventoryLocationRead862Acceptance({
  pool,base,secret,env=process.env,aliases,helpers,rounds=12
}){
  const runtime=inventory862ValidateRuntime(env);
  const url=new URL(base);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1')
    throw new Error('Inventory 862 QA accepts only internal loopback Preview URLs.');
  if(!Number.isInteger(rounds)||rounds<8||rounds>30)
    throw new Error('Inventory 862 QA requires 8–30 measurement rounds.');
  const {qaAccountSession,requestJson,expectStatus}=helpers;
  const currentDb=await pool.query('SELECT current_database() AS name');
  if(currentDb.rows[0]?.name!==runtime.databaseName)
    throw new Error('Inventory 862 QA database target mismatch.');
  let merchant=null,customer=null,originalBusinessId=null,changedBusiness=false;
  let failed=null;
  const timings=Object.fromEntries(INVENTORY_862_PATHS.map(path=>[path,[]]));
  try{
    // Existing QA harness rotates only pre-classified company-test account passwords.
    // Its outer finally restores their original password salts/hashes.
    merchant=await qaAccountSession({pool,base,secret,email:aliases.merchant,
      role:'merchant',label:'Inventory Location 862 Merchant QA'});
    const me=await requestJson(base,'/api/me',{token:merchant.token});
    expectStatus(me,200,'Inventory 862 Merchant session');
    if(me.json?.account?.account_mode!=='company_test'||me.json?.account?.test_role!=='merchant'||
       me.json?.account?.active_role!=='merchant'){
      throw new Error('Inventory 862 session must be a dedicated active QA Merchant.');
    }
    const space=await requestJson(base,'/api/accounting/workspaces',{token:merchant.token});
    expectStatus(space,200,'Inventory 862 Merchant workspaces');
    if(space.json?.role!=='merchant'||!Array.isArray(space.json?.businesses)||
       !space.json.businesses.length)throw new Error('Inventory 862 QA Merchant has no authorized business.');
    originalBusinessId=Number(space.json.active_business_id);
    if(!originalBusinessId||!space.json.businesses.some(b=>Number(b.id)===originalBusinessId))
      throw new Error('Inventory 862 active Merchant workspace is not bound.');

    const before=await fingerprintBusiness(pool,originalBusinessId);
    for(const path of INVENTORY_862_PATHS)
      assertHttp(await measureAuthorized(base,path),401,'Guest '+path);

    customer=await qaAccountSession({pool,base,secret,email:aliases.customer,
      role:'customer',label:'Inventory Location 862 Customer QA'});
    const customerMe=await requestJson(base,'/api/me',{token:customer.token});
    expectStatus(customerMe,200,'Inventory 862 Customer session');
    if(customerMe.json?.account?.account_mode!=='company_test'||
       customerMe.json?.account?.test_role!=='customer'||
       customerMe.json?.account?.active_role!=='customer'){
      throw new Error('Inventory 862 customer negative must use Customer QA profile.');
    }
    for(const path of INVENTORY_862_PATHS)
      assertHttp(await measureAuthorized(base,path,customer.token),403,'Customer '+path);

    const warmups=[];
    for(const path of INVENTORY_862_PATHS){
      const warm=await measureAuthorized(base,path,merchant.token);
      assertHttp(warm,200,'Warm Merchant '+path);
      inventory862AssertScopedRows(warm.body,originalBusinessId,path);
      warmups.push(warm.elapsed);
    }

    // Replicate the concurrent GET pair performed by Merchant Storage UI.
    for(let n=0;n<rounds;n++){
      const responses=await Promise.all(INVENTORY_862_PATHS.map(path=>
        measureAuthorized(base,path,merchant.token)
      ));
      for(let idx=0;idx<responses.length;idx++){
        const path=INVENTORY_862_PATHS[idx],response=responses[idx];
        assertHttp(response,200,'Merchant '+path);
        inventory862AssertScopedRows(response.body,originalBusinessId,path);
        if(response.elapsed>10000)throw new Error('Inventory 862 unexplained >10 s request: '+path);
        timings[path].push(response.elapsed);
      }
    }

    const otherId=space.json.businesses.map(b=>Number(b.id)).find(id=>id!==originalBusinessId);
    if(otherId){
      const foreignInventory=await pool.query(
        'SELECT id FROM inventory WHERE business_id=$1 ORDER BY id LIMIT 1',[otherId]
      );
      for(const path of INVENTORY_862_PATHS){
        const suffix=path.includes('location-balances')&&foreignInventory.rows.length
          ?'&inventory_id='+Number(foreignInventory.rows[0].id):'';
        const forged=await measureAuthorized(base,path+'?business_id='+otherId+suffix,merchant.token);
        assertHttp(forged,200,'Forged business query '+path);
        inventory862AssertScopedRows(forged.body,originalBusinessId,path);
        if(suffix&&forged.body.length)throw new Error('Foreign Inventory item leaked in scoped balance GET.');
      }
      await selectBusiness({base,token:merchant.token,businessId:otherId});
      changedBusiness=true;
      const switched=await requestJson(base,'/api/accounting/workspaces',{token:merchant.token});
      expectStatus(switched,200,'Inventory 862 switched Merchant workspace');
      if(Number(switched.json?.active_business_id)!==otherId)
        throw new Error('Inventory 862 selected workspace did not update.');
      const beforeB=await fingerprintBusiness(pool,otherId);
      for(const path of INVENTORY_862_PATHS){
        const result=await measureAuthorized(base,path,merchant.token);
        assertHttp(result,200,'Merchant switched B '+path);
        inventory862AssertScopedRows(result.body,otherId,path);
      }
      const afterB=await fingerprintBusiness(pool,otherId);
      if(JSON.stringify(beforeB)!==JSON.stringify(afterB))
        throw new Error('Inventory 862 GETs unexpectedly changed business B stock or ledger.');
      await selectBusiness({base,token:merchant.token,businessId:originalBusinessId});
      changedBusiness=false;
      const back=await measureAuthorized(base,INVENTORY_862_PATHS[0],merchant.token);
      assertHttp(back,200,'Merchant restored A');
      inventory862AssertScopedRows(back.body,originalBusinessId,INVENTORY_862_PATHS[0]);
    }
    const after=await fingerprintBusiness(pool,originalBusinessId);
    if(JSON.stringify(before)!==JSON.stringify(after))
      throw new Error('Inventory 862 GETs unexpectedly changed business A stock or ledger.');

    const p95=Object.fromEntries(INVENTORY_862_PATHS.map(path=>[path,inventory862Percentile(timings[path])]));
    if(Object.values(p95).some(n=>n>=2000))
      throw new Error('Inventory 862 authenticated p95 >=2000 ms: '+JSON.stringify(p95));
    return {
      status:'PASS',wave:INVENTORY_LOCATION_READ_862_WAVE,
      authenticated_qa_merchant:true,customer_403:true,guest_401:true,
      business_a_b_verified:Boolean(otherId),queried_business_override_ignored:Boolean(otherId),
      rounds,concurrent_requests:rounds*2,
      location_p95_ms:p95[INVENTORY_862_PATHS[0]],
      location_balances_p95_ms:p95[INVENTORY_862_PATHS[1]],
      location_max_ms:Math.max(...timings[INVENTORY_862_PATHS[0]]),
      location_balances_max_ms:Math.max(...timings[INVENTORY_862_PATHS[1]]),
      warmup_ms:warmups,
      no_stock_or_money_write:true,credentials_restored_by_outer_harness:true
    };
  }catch(error){failed=error;throw error}
  finally{
    const cleanupErrors=[];
    if(changedBusiness&&merchant?.token&&originalBusinessId){
      try{await selectBusiness({base,token:merchant.token,businessId:originalBusinessId})}
      catch{cleanupErrors.push('QA Merchant workspace restoration failed');}
    }
    for(const session of [merchant,customer]){
      if(session?.token){
        const response=await requestJson(base,'/api/auth/logout',{method:'POST',token:session.token,body:{}})
          .catch(()=>({status:0}));
        if(response.status!==200)cleanupErrors.push('QA session logout failed');
      }
    }
    if(cleanupErrors.length&&!failed)
      throw new Error('Inventory 862 QA cleanup failed: '+cleanupErrors.join('; '));
  }
}
