import {validateRuntimeSafety} from './runtime-safety.js';
import {ensurePhGeographicRegistrySchema,syncPhGeographicRegistry,resolvePhGeographicUnit} from './ph-geographic-registry.js';

const truthy=value=>['1','true','yes','on'].includes(String(value||'').trim().toLowerCase());

export function qaPhTestContextConfig(env=process.env){
  const runtime=validateRuntimeSafety(env);
  const enabled=truthy(env.QA_PH_TEST_CONTEXT);
  if(!enabled)return{enabled:false,runtime};
  if(!runtime.previewService||runtime.appEnvironment!=='qa'||!/(?:^|_)(?:qa|test)$/.test(runtime.databaseName)){
    throw new Error('QA PH test context may run only on isolated accounting-preview QA data');
  }
  return{enabled:true,runtime,country_code:'PH'};
}

async function latestSuccessfulRegistry(pool){
  const q=await pool.query(
    "SELECT id,source_version,row_count,completed_at FROM ph_geographic_registry_imports "+
    "WHERE country_code='PH' AND status='success' ORDER BY completed_at DESC NULLS LAST,id DESC LIMIT 1"
  );
  return q.rows[0]||null;
}

async function ensureRegistry(pool){
  await ensurePhGeographicRegistrySchema(pool);
  const existing=await latestSuccessfulRegistry(pool);
  if(existing&&Number(existing.row_count)>=43000)return existing;
  const result=await syncPhGeographicRegistry(pool,{
    importedByAccountId:null,
    fetchImpl:async()=>({ok:false,status:403,headers:{get:()=>null},arrayBuffer:async()=>new ArrayBuffer(0)})
  });
  return result.latest||null;
}

async function upsertPilotTerritory(pool,{unit,status,parentId=null}){
  const existing=await pool.query(
    "SELECT * FROM territories WHERE country_code='PH' AND psgc_code=$1 LIMIT 1",
    [unit.psgc_code]
  );
  if(existing.rowCount){
    const q=await pool.query(
      "UPDATE territories SET parent_id=$1,territory_type=$2,name=$3,code=$4,status=$5,"+
      "geographic_source='PSA_PSGC',geographic_source_version=$6,updated_at=NOW() "+
      "WHERE id=$7 RETURNING *",
      [parentId,unit.geographic_level==='special_geographic_unit'?'district':unit.geographic_level,unit.name,unit.psgc_code,status,unit.source_version,existing.rows[0].id]
    );
    return q.rows[0];
  }
  const q=await pool.query(
    "INSERT INTO territories(country_code,parent_id,territory_type,name,code,status,created_by_account_id,psgc_code,geographic_source,geographic_source_version) "+
    "VALUES('PH',$1,$2,$3,$4,$5,NULL,$6,'PSA_PSGC',$7) RETURNING *",
    [parentId,unit.geographic_level==='special_geographic_unit'?'district':unit.geographic_level,unit.name,unit.psgc_code,status,unit.psgc_code,unit.source_version]
  );
  return q.rows[0];
}

async function unit(pool,code){
  const row=await resolvePhGeographicUnit(pool,code);
  if(!row)throw new Error('QA PH context cannot resolve official PSGC '+code);
  return row;
}

export async function ensureQaPhTestContext(pool,{env=process.env}={}){
  const config=qaPhTestContextConfig(env);
  if(!config.enabled)return{status:'SKIPPED',enabled:false};
  const registry=await ensureRegistry(pool);
  const region=await upsertPilotTerritory(pool,{unit:await unit(pool,'0400000000'),status:'planned'});
  const province=await upsertPilotTerritory(pool,{unit:await unit(pool,'0402100000'),status:'planned',parentId:Number(region.id)});
  const city=await upsertPilotTerritory(pool,{unit:await unit(pool,'0402103000'),status:'planned',parentId:Number(province.id)});
  let barangay=await resolvePhGeographicUnit(pool,'0402103028');
  if(!barangay||String(barangay.name).toLowerCase()!=='queens row west'){
    const q=await pool.query(
      "SELECT * FROM ph_geographic_registry WHERE country_code='PH' AND source_version=$1 "+
      "AND geographic_level='barangay' AND parent_psgc_code=$2 AND LOWER(name)=LOWER('Queens Row West') LIMIT 1",
      [city.source_version,city.psgc_code]
    );
    barangay=q.rows[0]||null;
  }
  if(!barangay)throw new Error('QA PH context cannot resolve Queens Row West');
  const launch=await upsertPilotTerritory(pool,{unit:barangay,status:'onboarding',parentId:Number(city.id)});
  return{
    status:'READY',enabled:true,country_code:'PH',
    registry_version:registry?.source_version||barangay.source_version,
    pilot:{
      region:{id:Number(region.id),name:region.name,status:region.status,psgc_code:region.psgc_code},
      province:{id:Number(province.id),name:province.name,status:province.status,psgc_code:province.psgc_code},
      city:{id:Number(city.id),name:city.name,status:city.status,psgc_code:city.psgc_code},
      barangay:{id:Number(launch.id),name:launch.name,status:launch.status,psgc_code:launch.psgc_code}
    }
  };
}
