import express from 'express';
import crypto from 'node:crypto';
import pg from 'pg';
import { ensurePersonIdentitySchema, withPublicProfileIds } from './person-profile-identity.js';
import {courierEligibilityProfileView} from './courier-eligibility-core.js';

const { Pool } = pg;
const app = express();
const port = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined });
const APP_PIN = process.env.APP_PIN || '';
const TOKEN_SECRET = process.env.TOKEN_SECRET || '';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const ROLES = new Set(['merchant','customer','supplier','courier']);

app.use(express.json({ limit: '100kb' }));
app.use(express.static('identity-public'));

function clean(v,max=250){return String(v??'').trim().slice(0,max)}
function signToken(){const payload=`${Date.now()}.${crypto.randomUUID()}`;const sig=crypto.createHmac('sha256',TOKEN_SECRET).update(payload).digest('hex');return `${payload}.${sig}`}
function validToken(token=''){if(!TOKEN_SECRET||!token)return false;const p=token.split('.');if(p.length!==3)return false;const issued=Number(p[0]);if(!Number.isFinite(issued)||Date.now()-issued>TOKEN_TTL_MS||issued>Date.now()+60000)return false;const payload=`${p[0]}.${p[1]}`;const expected=crypto.createHmac('sha256',TOKEN_SECRET).update(payload).digest('hex');try{return crypto.timingSafeEqual(Buffer.from(p[2]),Buffer.from(expected))}catch{return false}}
function auth(req,res,next){const token=req.headers.authorization?.replace(/^Bearer\s+/i,'');if(!validToken(token))return res.status(401).json({error:'Unauthorized'});req.accountId=1;next()}

async function initDb(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id BIGSERIAL PRIMARY KEY,
      display_name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS profiles (
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('merchant','customer','supplier','courier')),
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(account_id, role)
    );

    CREATE TABLE IF NOT EXISTS businesses (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'My Business',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS business_memberships (
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      membership_role TEXT NOT NULL DEFAULT 'owner',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(business_id, account_id)
    );

    CREATE TABLE IF NOT EXISTS customer_profiles (
      account_id BIGINT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      preferred_address TEXT NOT NULL DEFAULT '',
      notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS supplier_profiles (
      account_id BIGINT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      supplier_name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      delivery_available BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS courier_profiles (
      account_id BIGINT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL DEFAULT '',
      vehicle_type TEXT NOT NULL DEFAULT '',
      available BOOLEAN NOT NULL DEFAULT FALSE,
      max_weight_kg NUMERIC(10,2),
      max_volume_l NUMERIC(10,2),
      service_radius_km NUMERIC(10,2),
      eligibility_status TEXT NOT NULL DEFAULT 'not_requested',
      approved_vehicle_class TEXT NOT NULL DEFAULT '',
      eligibility_expires_at TIMESTAMPTZ,
      approval_note TEXT NOT NULL DEFAULT '',
      eligibility_reviewed_by_account_id BIGINT REFERENCES accounts(id),
      eligibility_reviewed_at TIMESTAMPTZ,
      eligibility_policy_version TEXT NOT NULL DEFAULT '',
      non_commercial_test_only BOOLEAN NOT NULL DEFAULT FALSE,
      operating_psgc_code TEXT NOT NULL DEFAULT '',
      operating_area_name TEXT NOT NULL DEFAULT '',
      operating_area_path TEXT NOT NULL DEFAULT '',
      operating_area_source_version TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE courier_profiles ADD COLUMN IF NOT EXISTS eligibility_status TEXT NOT NULL DEFAULT 'not_requested';
    ALTER TABLE courier_profiles ADD COLUMN IF NOT EXISTS approved_vehicle_class TEXT NOT NULL DEFAULT '';
    ALTER TABLE courier_profiles ADD COLUMN IF NOT EXISTS eligibility_expires_at TIMESTAMPTZ;
    ALTER TABLE courier_profiles ADD COLUMN IF NOT EXISTS approval_note TEXT NOT NULL DEFAULT '';
    ALTER TABLE courier_profiles ADD COLUMN IF NOT EXISTS eligibility_reviewed_by_account_id BIGINT REFERENCES accounts(id);
    ALTER TABLE courier_profiles ADD COLUMN IF NOT EXISTS eligibility_reviewed_at TIMESTAMPTZ;
    ALTER TABLE courier_profiles ADD COLUMN IF NOT EXISTS eligibility_policy_version TEXT NOT NULL DEFAULT '';
    ALTER TABLE courier_profiles ADD COLUMN IF NOT EXISTS non_commercial_test_only BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE courier_profiles ADD COLUMN IF NOT EXISTS operating_psgc_code TEXT NOT NULL DEFAULT '';
    ALTER TABLE courier_profiles ADD COLUMN IF NOT EXISTS operating_area_name TEXT NOT NULL DEFAULT '';
    ALTER TABLE courier_profiles ADD COLUMN IF NOT EXISTS operating_area_path TEXT NOT NULL DEFAULT '';
    ALTER TABLE courier_profiles ADD COLUMN IF NOT EXISTS operating_area_source_version TEXT NOT NULL DEFAULT '';

    INSERT INTO accounts(id,display_name) VALUES(1,'Business owner') ON CONFLICT(id) DO NOTHING;
    INSERT INTO profiles(account_id,role,enabled) VALUES(1,'merchant',TRUE) ON CONFLICT(account_id,role) DO NOTHING;
    INSERT INTO businesses(id,name) VALUES(1,'My Business') ON CONFLICT(id) DO NOTHING;
    INSERT INTO business_memberships(business_id,account_id,membership_role,active) VALUES(1,1,'owner',TRUE) ON CONFLICT(business_id,account_id) DO NOTHING;
    SELECT setval(pg_get_serial_sequence('accounts','id'), GREATEST((SELECT MAX(id) FROM accounts),1));
    SELECT setval(pg_get_serial_sequence('businesses','id'), GREATEST((SELECT MAX(id) FROM businesses),1));
  `);
  await ensurePersonIdentitySchema(pool);
}

async function profileSnapshot(accountId=1){
  const [account,profiles,business,cust,supp,cour,courierDocuments]=await Promise.all([
    pool.query(`SELECT id,display_name,phone,email,address,identity_country_code,personal_public_id,account_mode,test_role,created_at,updated_at FROM accounts WHERE id=$1`,[accountId]),
    pool.query(`SELECT role,enabled,created_at,updated_at FROM profiles WHERE account_id=$1 ORDER BY role`,[accountId]),
    pool.query(`SELECT b.id,b.name,bm.membership_role,bm.active FROM businesses b JOIN business_memberships bm ON bm.business_id=b.id WHERE bm.account_id=$1 AND bm.active=TRUE ORDER BY b.id`,[accountId]),
    pool.query(`SELECT * FROM customer_profiles WHERE account_id=$1`,[accountId]),
    pool.query(`SELECT * FROM supplier_profiles WHERE account_id=$1`,[accountId]),
    pool.query(`SELECT * FROM courier_profiles WHERE account_id=$1`,[accountId]),
    pool.query(`SELECT document_type,vehicle_class,issue_date,expiry_date,private_evidence_object_id,verification_status,verified_by_account_id,verified_at FROM courier_documents WHERE account_id=$1`,[accountId]).catch(error=>{
      if(['42P01','42703'].includes(error?.code))return{rows:[]};
      throw error;
    })
  ]);
  const accountRow=account.rows[0];
  const courier=cour.rows[0]?courierEligibilityProfileView({
    ...cour.rows[0],account_mode:accountRow?.account_mode,test_role:accountRow?.test_role
  },courierDocuments.rows):null;
  return withPublicProfileIds({account:accountRow,profiles:profiles.rows,businesses:business.rows,customer:cust.rows[0]||null,supplier:supp.rows[0]||null,courier});
}

app.get('/health',async(_req,res)=>{try{await pool.query('SELECT 1');res.json({ok:true,db:true,version:'0.3.5-profile-foundation'})}catch{res.status(503).json({ok:false,db:false,version:'0.3.5-profile-foundation'})}});

app.post('/api/login',(req,res)=>{if(!APP_PIN||!TOKEN_SECRET)return res.status(503).json({error:'Preview security is not configured'});if(String(req.body?.pin||'')!==APP_PIN)return res.status(401).json({error:'Incorrect PIN'});res.json({token:signToken(),account_id:1,expires_in_hours:24})});

app.get('/api/me',auth,async(req,res)=>res.json(await profileSnapshot(req.accountId)));

app.patch('/api/me',auth,async(req,res)=>{
  const name=clean(req.body?.display_name,120),phone=clean(req.body?.phone,40),email=clean(req.body?.email,160),address=clean(req.body?.address,250);
  if(!name)return res.status(400).json({error:'Display name is required'});
  await pool.query(`UPDATE accounts SET display_name=$1,phone=$2,email=$3,address=$4,updated_at=NOW() WHERE id=$5`,[name,phone,email,address,req.accountId]);
  res.json(await profileSnapshot(req.accountId));
});

app.put('/api/profiles/:role',auth,async(req,res)=>{
  const role=req.params.role;if(!ROLES.has(role))return res.status(400).json({error:'Unknown profile role'});
  const enabled=req.body?.enabled!==false;
  await pool.query(`INSERT INTO profiles(account_id,role,enabled) VALUES($1,$2,$3) ON CONFLICT(account_id,role) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=NOW()`,[req.accountId,role,enabled]);
  if(enabled&&role==='customer')await pool.query(`INSERT INTO customer_profiles(account_id) VALUES($1) ON CONFLICT(account_id) DO NOTHING`,[req.accountId]);
  if(enabled&&role==='supplier')await pool.query(`INSERT INTO supplier_profiles(account_id,supplier_name) SELECT id,display_name FROM accounts WHERE id=$1 ON CONFLICT(account_id) DO NOTHING`,[req.accountId]);
  if(enabled&&role==='courier')await pool.query(`INSERT INTO courier_profiles(account_id,display_name) SELECT id,display_name FROM accounts WHERE id=$1 ON CONFLICT(account_id) DO NOTHING`,[req.accountId]);
  if(!enabled){const next=await pool.query(`SELECT role FROM profiles WHERE account_id=$1 AND enabled=TRUE AND role<>$2 ORDER BY created_at LIMIT 1`,[req.accountId,role]);await pool.query(`UPDATE accounts SET active_role=$1,updated_at=NOW() WHERE id=$2 AND active_role=$3`,[next.rows[0]?.role||null,req.accountId,role])}
  res.json(await profileSnapshot(req.accountId));
});

app.get('/api/context/:role',auth,async(req,res)=>{
  const role=req.params.role;if(!ROLES.has(role))return res.status(400).json({error:'Unknown profile role'});
  const p=await pool.query(`SELECT enabled FROM profiles WHERE account_id=$1 AND role=$2`,[req.accountId,role]);
  if(!p.rowCount||!p.rows[0].enabled)return res.status(403).json({error:'This profile is not enabled'});
  const capabilities={
    merchant:['accounting','inventory','menu','orders','storefront','suppliers'],
    customer:['marketplace','orders','payments','pickup','delivery tracking'],
    supplier:['catalog','incoming purchase orders','production ETA','pickup/delivery response'],
    courier:['availability','assigned deliveries','pickup','live delivery status','proof of delivery']
  };
  res.json({role,capabilities:capabilities[role]});
});

app.patch('/api/courier',auth,async(req,res,next)=>{
  try{
    const enabled=await pool.query(`SELECT 1 FROM profiles WHERE account_id=$1 AND role='courier' AND enabled=TRUE`,[req.accountId]);if(!enabled.rowCount)return res.status(403).json({error:'Enable Courier profile first'});
    const vehicle=clean(req.body?.vehicle_type,80);
    const n=v=>v==null||v===''?null:Number(v);
    for(const v of [n(req.body?.max_weight_kg),n(req.body?.max_volume_l),n(req.body?.service_radius_km)])if(v!=null&&(!Number.isFinite(v)||v<0))return res.status(400).json({error:'Courier capacity values must be zero or greater'});
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query(`UPDATE courier_profiles SET display_name=COALESCE(NULLIF($1,''),display_name),vehicle_type=$2,available=FALSE,max_weight_kg=$3,max_volume_l=$4,service_radius_km=$5,eligibility_status=CASE WHEN eligibility_status='approved' THEN 'pending' ELSE eligibility_status END,updated_at=NOW() WHERE account_id=$6`,[clean(req.body?.display_name,120),vehicle,n(req.body?.max_weight_kg),n(req.body?.max_volume_l),n(req.body?.service_radius_km),req.accountId]);
      const offersTable=await client.query(`SELECT to_regclass('public.delivery_offers') table_name`);
      if(offersTable.rows[0]?.table_name)await client.query(`UPDATE delivery_offers SET status='withdrawn',responded_at=COALESCE(responded_at,NOW()),updated_at=NOW() WHERE courier_account_id=$1 AND status='pending'`,[req.accountId]);
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}
    finally{client.release()}
    res.json(await profileSnapshot(req.accountId));
  }catch(error){next(error)}
});

app.use((err,_req,res,_next)=>{console.error(err);res.status(500).json({error:'Unexpected server error'})});
initDb().then(()=>app.listen(port,'0.0.0.0',()=>console.log(`Identity preview listening on ${port}`))).catch(err=>{console.error(err);process.exit(1)});
