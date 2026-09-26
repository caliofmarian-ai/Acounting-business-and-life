const clean=(v,max=200)=>String(v??'').trim().slice(0,max);
const DEMAND_ROLES=new Set(['customer','merchant','supplier','courier','service_provider']);

export async function ensureTerritoryDemandSchema(pool){
  await pool.query(
    "CREATE TABLE IF NOT EXISTS territory_profile_interest_signals("+
      "account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,"+
      "country_code TEXT NOT NULL DEFAULT 'PH',psgc_code TEXT NOT NULL,profile_role TEXT NOT NULL,"+
      "first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),"+
      "attempt_count INTEGER NOT NULL DEFAULT 1,"+
      "PRIMARY KEY(account_id,country_code,psgc_code,profile_role),"+
      "CHECK(profile_role IN ('customer','merchant','supplier','courier','service_provider'))"+
    ");"+
    "CREATE INDEX IF NOT EXISTS territory_profile_interest_psgc_idx ON territory_profile_interest_signals(country_code,psgc_code,last_seen_at DESC);"+
    "CREATE INDEX IF NOT EXISTS territory_profile_interest_role_idx ON territory_profile_interest_signals(profile_role,last_seen_at DESC)"
  );
}

export async function recordUnavailableProfileInterest(pool,{accountId,psgcCode,role}={}){
  const account=Number(accountId),code=clean(psgcCode,20),profileRole=clean(role,40);
  if(!Number.isInteger(account)||account<=0||!/^\d{10}$/.test(code)||!DEMAND_ROLES.has(profileRole))return null;
  await ensureTerritoryDemandSchema(pool);
  const q=await pool.query(
    "INSERT INTO territory_profile_interest_signals(account_id,country_code,psgc_code,profile_role) VALUES($1,'PH',$2,$3) "+
    "ON CONFLICT(account_id,country_code,psgc_code,profile_role) DO UPDATE SET last_seen_at=NOW(),attempt_count=territory_profile_interest_signals.attempt_count+1 "+
    "RETURNING account_id,psgc_code,profile_role,first_seen_at,last_seen_at,attempt_count",
    [account,code,profileRole]
  );
  return q.rows[0]||null;
}

async function latestRegistryVersion(pool){
  const q=await pool.query(
    "SELECT source_version FROM ph_geographic_registry_imports WHERE country_code='PH' AND status='success' ORDER BY completed_at DESC NULLS LAST,id DESC LIMIT 1"
  );
  return q.rows[0]?.source_version||null;
}

function allowedLevel(value){
  const level=clean(value,40).toLowerCase();
  return ['region','province','city','municipality','district','submunicipality','special_geographic_unit','barangay'].includes(level)?level:'barangay';
}

export async function territoryDemandOverview(pool,{level='barangay',limit=50}={}){
  await ensureTerritoryDemandSchema(pool);
  const sourceVersion=await latestRegistryVersion(pool);
  if(!sourceVersion)return{source_version:null,level:allowedLevel(level),items:[]};
  const targetLevel=allowedLevel(level),bounded=Math.max(1,Math.min(100,Number(limit)||50));
  const presence=await pool.query(
    "WITH RECURSIVE lineage AS ("+
      "SELECT a.account_id,a.updated_at,g.psgc_code,g.parent_psgc_code,g.name,g.geographic_level,g.path_text,g.source_version "+
      "FROM account_geography_assignments a JOIN ph_geographic_registry g ON g.country_code='PH' AND g.source_version=$1 AND g.psgc_code=a.psgc_code "+
      "WHERE a.country_code='PH' "+
      "UNION ALL "+
      "SELECT l.account_id,l.updated_at,p.psgc_code,p.parent_psgc_code,p.name,p.geographic_level,p.path_text,p.source_version "+
      "FROM lineage l JOIN ph_geographic_registry p ON p.country_code='PH' AND p.source_version=$1 AND p.psgc_code=l.parent_psgc_code"+
    ") "+
    "SELECT l.psgc_code,l.name,l.geographic_level,l.path_text,l.source_version,"+
      "COUNT(DISTINCT l.account_id)::int registered_accounts,"+
      "COUNT(DISTINCT l.account_id) FILTER(WHERE l.updated_at>=NOW()-INTERVAL '7 days')::int new_accounts_7d,"+
      "COUNT(DISTINCT l.account_id) FILTER(WHERE l.updated_at>=NOW()-INTERVAL '30 days')::int new_accounts_30d,"+
      "t.id operating_territory_id,t.status operating_status "+
    "FROM lineage l LEFT JOIN territories t ON t.country_code='PH' AND t.psgc_code=l.psgc_code "+
    "WHERE l.geographic_level=$2 GROUP BY l.psgc_code,l.name,l.geographic_level,l.path_text,l.source_version,t.id,t.status "+
    "ORDER BY registered_accounts DESC,new_accounts_30d DESC,l.name LIMIT $3",
    [sourceVersion,targetLevel,bounded]
  );

  const codes=presence.rows.map(x=>x.psgc_code);
  if(!codes.length)return{source_version:sourceVersion,level:targetLevel,items:[]};

  const interests=await pool.query(
    "WITH RECURSIVE lineage AS ("+
      "SELECT s.account_id,s.profile_role,s.last_seen_at,g.psgc_code,g.parent_psgc_code,g.geographic_level "+
      "FROM territory_profile_interest_signals s JOIN ph_geographic_registry g ON g.country_code='PH' AND g.source_version=$1 AND g.psgc_code=s.psgc_code "+
      "WHERE s.country_code='PH' "+
      "UNION ALL "+
      "SELECT l.account_id,l.profile_role,l.last_seen_at,p.psgc_code,p.parent_psgc_code,p.geographic_level "+
      "FROM lineage l JOIN ph_geographic_registry p ON p.country_code='PH' AND p.source_version=$1 AND p.psgc_code=l.parent_psgc_code"+
    ") "+
    "SELECT psgc_code,profile_role,COUNT(DISTINCT account_id)::int interested_accounts,MAX(last_seen_at) last_interest_at "+
    "FROM lineage WHERE geographic_level=$2 AND psgc_code=ANY($3::text[]) "+
    "GROUP BY psgc_code,profile_role",
    [sourceVersion,targetLevel,codes]
  );
  const byCode=new Map();
  for(const row of interests.rows){
    const entry=byCode.get(row.psgc_code)||{total:new Set(),roles:{}};
    entry.roles[row.profile_role]=Number(row.interested_accounts||0);
    byCode.set(row.psgc_code,entry);
  }
  const totals=await pool.query(
    "WITH RECURSIVE lineage AS ("+
      "SELECT s.account_id,s.psgc_code leaf_code,g.psgc_code,g.parent_psgc_code,g.geographic_level "+
      "FROM territory_profile_interest_signals s JOIN ph_geographic_registry g ON g.country_code='PH' AND g.source_version=$1 AND g.psgc_code=s.psgc_code WHERE s.country_code='PH' "+
      "UNION ALL "+
      "SELECT l.account_id,l.leaf_code,p.psgc_code,p.parent_psgc_code,p.geographic_level FROM lineage l JOIN ph_geographic_registry p ON p.country_code='PH' AND p.source_version=$1 AND p.psgc_code=l.parent_psgc_code"+
    ") SELECT psgc_code,COUNT(DISTINCT account_id)::int interested_accounts FROM lineage WHERE geographic_level=$2 AND psgc_code=ANY($3::text[]) GROUP BY psgc_code",
    [sourceVersion,targetLevel,codes]
  );
  const totalMap=new Map(totals.rows.map(x=>[x.psgc_code,Number(x.interested_accounts||0)]));
  return{
    source_version:sourceVersion,
    level:targetLevel,
    items:presence.rows.map(row=>({
      psgc_code:row.psgc_code,name:row.name,geographic_level:row.geographic_level,path_text:row.path_text,
      registered_accounts:Number(row.registered_accounts||0),
      new_accounts_7d:Number(row.new_accounts_7d||0),
      new_accounts_30d:Number(row.new_accounts_30d||0),
      profile_interest_accounts:totalMap.get(row.psgc_code)||0,
      role_interest:byCode.get(row.psgc_code)?.roles||{},
      operating_territory_id:row.operating_territory_id?Number(row.operating_territory_id):null,
      operating_status:row.operating_status||'not_opened'
    }))
  };
}
