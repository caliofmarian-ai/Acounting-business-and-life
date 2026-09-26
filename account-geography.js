const clean=(v,max=500)=>String(v??'').trim().slice(0,max);
let accountGeographySchemaReady=false;

export function normalizeHomePsgcCode(value){
  const code=clean(value,32).replace(/\D/g,'');
  return code.length===10?code:'';
}

export function barangaySearchTokens(value){
  return clean(value,120).toLowerCase().split(/[^a-z0-9]+/).map(x=>x.trim()).filter(x=>x.length>=2).slice(0,8);
}

export async function ensureAccountGeographySchema(pool){
  if(accountGeographySchemaReady)return;
  await pool.query(
    "CREATE TABLE IF NOT EXISTS account_geography_assignments("+
    "account_id BIGINT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,"+
    "country_code TEXT NOT NULL DEFAULT 'PH',psgc_code TEXT NOT NULL,source_version TEXT NOT NULL,"+
    "geographic_level TEXT NOT NULL,geographic_name TEXT NOT NULL,path_text TEXT NOT NULL DEFAULT '',"+
    "assignment_source TEXT NOT NULL DEFAULT 'self_selected_psgc',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),"+
    "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),CHECK(geographic_level='barangay'));"+
    "CREATE INDEX IF NOT EXISTS account_geography_psgc_idx ON account_geography_assignments(country_code,psgc_code);"+
    "CREATE TABLE IF NOT EXISTS account_geography_events(id BIGSERIAL PRIMARY KEY,account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,before_psgc_code TEXT NOT NULL DEFAULT '',after_psgc_code TEXT NOT NULL,assignment_source TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());"+
    "CREATE INDEX IF NOT EXISTS account_geography_events_account_idx ON account_geography_events(account_id,created_at DESC)"
  );
  accountGeographySchemaReady=true;
}

async function latestRegistryVersion(pool){
  try{
    const q=await pool.query("SELECT source_version FROM ph_geographic_registry_imports WHERE country_code='PH' AND status='success' ORDER BY completed_at DESC NULLS LAST,id DESC LIMIT 1");
    return q.rows[0]?.source_version||null;
  }catch(error){
    if(error?.code==='42P01')return null;
    throw error;
  }
}

export async function resolveOfficialBarangay(pool,psgcCode){
  const code=normalizeHomePsgcCode(psgcCode);
  if(!code)return null;
  const version=await latestRegistryVersion(pool);
  if(!version)return null;
  const q=await pool.query(
    "SELECT country_code,psgc_code,source_version,name,geographic_level,parent_psgc_code,path_text "+
    "FROM ph_geographic_registry WHERE country_code='PH' AND source_version=$1 AND psgc_code=$2 AND geographic_level='barangay' LIMIT 1",
    [version,code]
  );
  return q.rows[0]||null;
}

export async function searchOfficialBarangays(pool,{query='',limit=20}={}){
  const q=clean(query,120);
  const version=await latestRegistryVersion(pool);
  if(!version)return{source_version:null,items:[]};
  const bounded=Math.max(1,Math.min(30,Number(limit)||20));
  if(!q){
    const rows=await pool.query(
      "SELECT g.psgc_code,g.name,g.path_text,g.source_version,t.id operating_territory_id,t.status operating_status "+
      "FROM ph_geographic_registry g JOIN territories t ON t.country_code='PH' AND t.psgc_code=g.psgc_code "+
      "WHERE g.country_code='PH' AND g.source_version=$1 AND g.geographic_level='barangay' "+
      "AND t.status IN ('onboarding','active') "+
      "ORDER BY CASE t.status WHEN 'onboarding' THEN 0 ELSE 1 END,g.name LIMIT $2",
      [version,bounded]
    );
    return{source_version:version,items:rows.rows,suggestions:true};
  }
  const tokens=barangaySearchTokens(q);
  if(!tokens.length)return{source_version:version,items:[]};
  const params=[version];
  const clauses=[];
  for(const token of tokens){
    params.push('%'+token+'%');
    const p='$'+params.length;
    clauses.push("(LOWER(g.name) LIKE "+p+" OR LOWER(g.path_text) LIKE "+p+" OR g.psgc_code LIKE REPLACE("+p+",'%','')||'%')");
  }
  params.push(q.toLowerCase());
  const exactParam='$'+params.length;
  params.push(bounded);
  const limitParam='$'+params.length;
  const rows=await pool.query(
    "SELECT g.psgc_code,g.name,g.path_text,g.source_version,t.id operating_territory_id,t.status operating_status "+
    "FROM ph_geographic_registry g LEFT JOIN territories t ON t.country_code='PH' AND t.psgc_code=g.psgc_code "+
    "WHERE g.country_code='PH' AND g.source_version=$1 AND g.geographic_level='barangay' AND "+clauses.join(' AND ')+" "+
    "ORDER BY CASE WHEN LOWER(g.name)="+exactParam+" THEN 0 ELSE 1 END,"+
      "CASE WHEN t.status='onboarding' THEN 0 WHEN t.status='active' THEN 1 WHEN t.id IS NOT NULL THEN 2 ELSE 3 END,g.name "+
    "LIMIT "+limitParam,
    params
  );
  return{source_version:version,items:rows.rows,suggestions:false};
}

export async function geographyAvailabilityForCode(pool,psgcCode){
  const unit=await resolveOfficialBarangay(pool,psgcCode);
  if(!unit)return null;
  const chain=await pool.query(
    "WITH RECURSIVE geo AS ("+
      "SELECT psgc_code,parent_psgc_code,name,geographic_level,path_text,0 AS depth "+
      "FROM ph_geographic_registry WHERE country_code='PH' AND source_version=$1 AND psgc_code=$2 "+
      "UNION ALL "+
      "SELECT p.psgc_code,p.parent_psgc_code,p.name,p.geographic_level,p.path_text,g.depth+1 "+
      "FROM ph_geographic_registry p JOIN geo g ON p.psgc_code=g.parent_psgc_code "+
      "WHERE p.country_code='PH' AND p.source_version=$1 AND g.depth<8"+
    ") "+
    "SELECT g.*,t.id territory_id,t.status territory_status,t.name territory_name,t.territory_type "+
    "FROM geo g LEFT JOIN territories t ON t.country_code='PH' AND t.psgc_code=g.psgc_code ORDER BY g.depth",
    [unit.source_version,unit.psgc_code]
  );
  const exact=chain.rows.find(x=>Number(x.depth)===0&&x.territory_id)||null;
  const nearest=chain.rows.find(x=>x.territory_id)||null;
  return{
    country_code:'PH',psgc_code:unit.psgc_code,source_version:unit.source_version,
    geographic_level:'barangay',name:unit.name,path_text:unit.path_text,
    exact_territory:exact?{id:Number(exact.territory_id),name:exact.territory_name,type:exact.territory_type,status:exact.territory_status}:null,
    nearest_opened_scope:nearest?{id:Number(nearest.territory_id),name:nearest.territory_name,type:nearest.territory_type,status:nearest.territory_status,exact:Number(nearest.depth)===0}:null,
    operational_onboarding_available:Boolean(exact&&['onboarding','active'].includes(exact.territory_status))
  };
}

export function geographyAvailabilityMessage(snapshot){
  if(!snapshot?.psgc_code)return'Choose your official barangay before starting an operational profile.';
  const exact=snapshot.exact_territory;
  if(exact?.status==='active')return'Business & Life is active in '+snapshot.name+'.';
  if(exact?.status==='onboarding')return snapshot.name+' is open for onboarding.';
  if(exact?.status==='planned')return snapshot.name+' is planned but not open for onboarding yet.';
  if(exact?.status==='paused')return snapshot.name+' is temporarily paused.';
  if(exact?.status==='suspended')return snapshot.name+' is currently restricted.';
  if(exact?.status==='closed')return snapshot.name+' is currently closed.';
  const parent=snapshot.nearest_opened_scope;
  if(parent)return snapshot.name+' is not open yet. The nearest Business & Life scope, '+parent.name+', is '+clean(parent.status,40)+'.';
  return snapshot.name+' is not open yet in Business & Life.';
}

export async function saveAccountGeography(pool,accountId,psgcCode,{source='self_selected_psgc'}={}){
  await ensureAccountGeographySchema(pool);
  const unit=await resolveOfficialBarangay(pool,psgcCode);
  if(!unit)throw Object.assign(new Error('Choose an official Philippine barangay from the PSGC list'),{status:400});
  const before=await pool.query("SELECT psgc_code FROM account_geography_assignments WHERE account_id=$1",[Number(accountId)]);
  const beforeCode=clean(before.rows[0]?.psgc_code,20);
  const assignmentSource=clean(source,80)||'self_selected_psgc';
  await pool.query(
    "INSERT INTO account_geography_assignments(account_id,country_code,psgc_code,source_version,geographic_level,geographic_name,path_text,assignment_source) "+
    "VALUES($1,'PH',$2,$3,'barangay',$4,$5,$6) "+
    "ON CONFLICT(account_id) DO UPDATE SET psgc_code=EXCLUDED.psgc_code,source_version=EXCLUDED.source_version,"+
    "geographic_level='barangay',geographic_name=EXCLUDED.geographic_name,path_text=EXCLUDED.path_text,"+
    "assignment_source=EXCLUDED.assignment_source,updated_at=NOW()",
    [Number(accountId),unit.psgc_code,unit.source_version,unit.name,unit.path_text,assignmentSource]
  );
  if(beforeCode!==unit.psgc_code){
    await pool.query(
      "INSERT INTO account_geography_events(account_id,before_psgc_code,after_psgc_code,assignment_source) VALUES($1,$2,$3,$4)",
      [Number(accountId),beforeCode,unit.psgc_code,assignmentSource]
    );
  }
  return geographyAvailabilityForCode(pool,unit.psgc_code);
}

export async function accountGeographySnapshot(pool,accountId){
  const q=await pool.query("SELECT * FROM account_geography_assignments WHERE account_id=$1",[Number(accountId)]);
  const row=q.rows[0];
  if(!row)return{assigned:false,country_code:'PH',required:true,operational_onboarding_available:false};
  const chain=await pool.query(
    "WITH RECURSIVE geo AS ("+
      "SELECT psgc_code,parent_psgc_code,name,geographic_level,path_text,0 AS depth "+
      "FROM ph_geographic_registry WHERE country_code='PH' AND source_version=$1 AND psgc_code=$2 "+
      "UNION ALL "+
      "SELECT p.psgc_code,p.parent_psgc_code,p.name,p.geographic_level,p.path_text,g.depth+1 "+
      "FROM ph_geographic_registry p JOIN geo g ON p.psgc_code=g.parent_psgc_code "+
      "WHERE p.country_code='PH' AND p.source_version=$1 AND g.depth<8"+
    ") SELECT g.*,t.id territory_id,t.status territory_status,t.name territory_name,t.territory_type "+
    "FROM geo g LEFT JOIN territories t ON t.country_code='PH' AND t.psgc_code=g.psgc_code ORDER BY g.depth",
    [row.source_version,row.psgc_code]
  );
  if(!chain.rowCount)return{
    assigned:true,country_code:'PH',psgc_code:row.psgc_code,source_version:row.source_version,
    geographic_level:'barangay',name:row.geographic_name,path_text:row.path_text,
    operational_onboarding_available:false,registry_resolution:'unavailable'
  };
  const exact=chain.rows.find(x=>Number(x.depth)===0&&x.territory_id)||null;
  const nearest=chain.rows.find(x=>x.territory_id)||null;
  const live={
    country_code:'PH',psgc_code:row.psgc_code,source_version:row.source_version,
    geographic_level:'barangay',name:row.geographic_name,path_text:row.path_text,
    exact_territory:exact?{id:Number(exact.territory_id),name:exact.territory_name,type:exact.territory_type,status:exact.territory_status}:null,
    nearest_opened_scope:nearest?{id:Number(nearest.territory_id),name:nearest.territory_name,type:nearest.territory_type,status:nearest.territory_status,exact:Number(nearest.depth)===0}:null,
    operational_onboarding_available:Boolean(exact&&['onboarding','active'].includes(exact.territory_status))
  };
  return{assigned:true,...live,message:geographyAvailabilityMessage(live)};
}

export async function accountIdsInPsgcScope(pool,psgcCode){
  const code=normalizeHomePsgcCode(psgcCode);
  if(!code)return[];
  const version=await latestRegistryVersion(pool);
  if(!version)return[];
  const q=await pool.query(
    "WITH RECURSIVE geo AS ("+
      "SELECT psgc_code FROM ph_geographic_registry WHERE country_code='PH' AND source_version=$1 AND psgc_code=$2 "+
      "UNION ALL "+
      "SELECT child.psgc_code FROM ph_geographic_registry child JOIN geo parent ON child.parent_psgc_code=parent.psgc_code "+
      "WHERE child.country_code='PH' AND child.source_version=$1"+
    ") SELECT DISTINCT a.account_id FROM account_geography_assignments a JOIN geo g ON g.psgc_code=a.psgc_code "+
    "WHERE a.country_code='PH' ORDER BY a.account_id",
    [version,code]
  );
  return q.rows.map(x=>Number(x.account_id)).filter(Number.isInteger);
}

export async function requireAssignedOpenBarangay(pool,accountId){
  const snapshot=await accountGeographySnapshot(pool,accountId);
  if(!snapshot.assigned)throw Object.assign(new Error('Complete your official barangay in Account Settings before starting onboarding'),{status:409,code:'ACCOUNT_GEOGRAPHY_REQUIRED'});
  if(!snapshot.operational_onboarding_available){
    throw Object.assign(new Error(geographyAvailabilityMessage(snapshot)),{status:409,code:'ACCOUNT_TERRITORY_NOT_OPEN',geography:snapshot});
  }
  return snapshot.exact_territory;
}
