const clean=(value,max=500)=>String(value??'').trim().slice(0,max);
export const PROFILE_OPERATING_LOCATION_ROLES=Object.freeze(['supplier','service_provider']);

export function operatingLocationScopeKey(profileRole,businessId=null){
  const role=clean(profileRole,40);
  if(!PROFILE_OPERATING_LOCATION_ROLES.includes(role))throw Object.assign(new Error('Operating location is not supported for this profile'),{status:400});
  if(role==='supplier'){
    const id=Number(businessId);
    if(!Number.isSafeInteger(id)||id<1)throw Object.assign(new Error('Choose the Supplier business workspace for this operating location'),{status:400});
    return 'business:'+id;
  }
  return 'profile';
}

export function normalizeProfileOperatingLocationInput(input={},profileRole=''){
  const role=clean(profileRole,40);
  if(!PROFILE_OPERATING_LOCATION_ROLES.includes(role))throw Object.assign(new Error('Operating location is not supported for this profile'),{status:400});
  const mode=input?.location_mode==='override'?'override':'personal';
  const exactAddress=mode==='override'?clean(input?.exact_address,400):'';
  const psgcCode=mode==='override'?clean(input?.psgc_code,32):'';
  const radiusRaw=input?.service_radius_km;
  const serviceRadius=radiusRaw==null||radiusRaw===''?null:Number(radiusRaw);
  if(mode==='override'&&!exactAddress)throw Object.assign(new Error('Enter the work address for this profile'),{status:400});
  if(mode==='override'&&!psgcCode)throw Object.assign(new Error('Choose the official barangay for this work address'),{status:400});
  if(serviceRadius!=null&&(!Number.isFinite(serviceRadius)||serviceRadius<0||serviceRadius>500))throw Object.assign(new Error('Service radius must be between 0 and 500 km'),{status:400});
  return{
    profile_role:role,
    location_mode:mode,
    exact_address:exactAddress,
    psgc_code:psgcCode,
    service_radius_km:role==='service_provider'?serviceRadius:null
  };
}

export async function ensureProfileOperatingLocationSchema(pool){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS profile_operating_locations (
      id BIGSERIAL PRIMARY KEY,
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      profile_role TEXT NOT NULL CHECK (profile_role IN ('supplier','service_provider')),
      scope_key TEXT NOT NULL,
      business_id BIGINT REFERENCES businesses(id) ON DELETE CASCADE,
      location_mode TEXT NOT NULL DEFAULT 'personal' CHECK (location_mode IN ('personal','override')),
      exact_address TEXT NOT NULL DEFAULT '',
      psgc_code TEXT NOT NULL DEFAULT '',
      source_version TEXT NOT NULL DEFAULT '',
      area_name TEXT NOT NULL DEFAULT '',
      area_path TEXT NOT NULL DEFAULT '',
      service_radius_km NUMERIC(10,2),
      public_exact_location_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(account_id,profile_role,scope_key)
    );
    CREATE INDEX IF NOT EXISTS profile_operating_locations_scope_idx
      ON profile_operating_locations(account_id,profile_role,business_id);
  `);
}

export async function profileOperatingLocation(pool,{accountId,profileRole,businessId=null}={}){
  const role=clean(profileRole,40),scopeKey=operatingLocationScopeKey(role,businessId);
  const q=await pool.query(
    `SELECT id,account_id,profile_role,business_id,location_mode,exact_address,psgc_code,source_version,area_name,area_path,service_radius_km,public_exact_location_enabled,updated_at
       FROM profile_operating_locations
      WHERE account_id=$1 AND profile_role=$2 AND scope_key=$3
      LIMIT 1`,
    [Number(accountId),role,scopeKey]
  );
  return q.rows[0]||{
    account_id:Number(accountId),profile_role:role,business_id:role==='supplier'?Number(businessId):null,
    location_mode:'personal',exact_address:'',psgc_code:'',source_version:'',area_name:'',area_path:'',
    service_radius_km:null,public_exact_location_enabled:false
  };
}

export async function saveProfileOperatingLocation(pool,{
  accountId,profileRole,businessId=null,locationMode='personal',exactAddress='',geography=null,serviceRadiusKm=null
}={}){
  const role=clean(profileRole,40),scopeKey=operatingLocationScopeKey(role,businessId);
  const mode=locationMode==='override'?'override':'personal';
  if(mode==='override'&&(!geography?.psgc_code||!clean(exactAddress,400)))throw Object.assign(new Error('A private work address and official barangay are required for an override'),{status:400});
  const address=mode==='override'?clean(exactAddress,400):'';
  const psgc=mode==='override'?clean(geography.psgc_code,32):'';
  const sourceVersion=mode==='override'?clean(geography.source_version,80):'';
  const areaName=mode==='override'?clean(geography.name,180):'';
  const areaPath=mode==='override'?clean(geography.path_text,500):'';
  const radius=role==='service_provider'&&serviceRadiusKm!=null?Number(serviceRadiusKm):null;
  const q=await pool.query(
    `INSERT INTO profile_operating_locations(
       account_id,profile_role,scope_key,business_id,location_mode,exact_address,psgc_code,source_version,area_name,area_path,service_radius_km,public_exact_location_enabled,updated_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,FALSE,NOW())
     ON CONFLICT(account_id,profile_role,scope_key) DO UPDATE SET
       business_id=EXCLUDED.business_id,
       location_mode=EXCLUDED.location_mode,
       exact_address=EXCLUDED.exact_address,
       psgc_code=EXCLUDED.psgc_code,
       source_version=EXCLUDED.source_version,
       area_name=EXCLUDED.area_name,
       area_path=EXCLUDED.area_path,
       service_radius_km=EXCLUDED.service_radius_km,
       public_exact_location_enabled=FALSE,
       updated_at=NOW()
     RETURNING id,account_id,profile_role,business_id,location_mode,exact_address,psgc_code,source_version,area_name,area_path,service_radius_km,public_exact_location_enabled,updated_at`,
    [Number(accountId),role,scopeKey,role==='supplier'?Number(businessId):null,mode,address,psgc,sourceVersion,areaName,areaPath,radius]
  );
  return q.rows[0];
}
