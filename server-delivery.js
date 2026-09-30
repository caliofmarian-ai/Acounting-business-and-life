import express from 'express';
import crypto from 'node:crypto';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureMonetizationSchema,recordMonetizableCompletion } from './monetization-core.js';
import {selectDeliveryVehicleQuote,courierCanServeDelivery,normalizeVehiclePricingRule,deliveryVehicleRuleEligible,calculateDeliveryQuoteTotal,deliveryPriceSplit,canonicalDeliveryVehicleClass} from './delivery-pricing-v2-core.js';
import {allocateCourierCompensation} from './courier-compensation-core.js';
import {verifyAdminAssertion} from './admin-authorization.js';
import {suppliersFetch,startEmbeddedSuppliers,stopEmbeddedSuppliers} from './server-suppliers.js';
import {createEmbeddedMarketplaceOrder} from './server-marketplace.js';
import {readOrderDetail} from './orders-read-core.js';
import {
  bindPrivateEvidenceSource,deletePrivateEvidence,ensurePrivateEvidenceSchema,
  readPrivateEvidence,sendPrivateEvidence,storePrivateEvidence
} from './private-evidence-core.js';
import {handoffLockActive,nextHandoffFailureState} from './delivery-handoff-security.js';
import {enforceHighRiskVelocity,highRiskVelocityErrorBody} from './abuse-velocity-core.js';
import {deliveryRoutingPublicConfig,resolveDeliveryRoute} from './delivery-routing-v2c.js';
import {geographyAvailabilityForCode} from './account-geography.js';
import {DELIVERY_ROUTE_POINT_LIMIT,deliveryRouteTrackingActive,deliveryRoutePointDecision,deliveryProofAllowed} from './delivery-tracking-v2e-core.js';
import {deliveryOfferSafeView,deliveryOfferCourierGate,deliveryAssignmentActive} from './delivery-dispatch-v2f-core.js';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined });
const TOKEN_SECRET = process.env.TOKEN_SECRET || '';
const jsonBody = express.json({ limit: '2500kb' });
const body = (req,res,next) => req.body !== undefined ? next() : jsonBody(req,res,next);
let suppliersApp=null;
let supplierReady=false;
let shuttingDown = false;
const COURIER_DOCUMENT_MIMES=new Set(['application/pdf','image/png','image/jpeg','image/webp']);
const MAX_COURIER_DOCUMENT_BYTES=1_400_000;
const DELIVERY_PROOF_MIMES=new Set(['image/png','image/jpeg','image/webp']);
const MAX_DELIVERY_PROOF_BYTES=1_400_000;
const MAX_DELIVERY_PROOFS_PER_TYPE=3;

function clean(v,max=700){return String(v??'').trim().slice(0,max)}
function correlation(req){return clean(req.headers['x-request-id']||req.headers['x-correlation-id']||'',160)}
function num(v){return Number(v)}
function finite(v){return Number.isFinite(num(v))}
function clamp(v,min,max){return Math.max(min,Math.min(max,num(v)))}
function authHeader(req){return req.headers.authorization||''}
async function upstream(path,options={}){return suppliersFetch(path,options)}
export function isDeliveryOwnedPath(path='',method='GET'){
  const pathname=String(path||'').split('?')[0];
  const verb=String(method||'GET').toUpperCase();
  if(pathname==='/delivery.css'||pathname==='/delivery-ui.js')return true;
  if(pathname.startsWith('/api/delivery/'))return true;
  if(verb==='POST'&&pathname==='/api/marketplace/checkout')return true;
  if(pathname==='/api/courier/delivery-profile')return true;
  if(pathname==='/api/courier/operating-area')return true;
  if(pathname==='/api/courier/home')return true;
  if(pathname==='/api/courier/documents')return true;
  if(pathname==='/api/courier/availability')return true;
  if(pathname.startsWith('/api/courier/deliveries/'))return true;
  if(pathname.startsWith('/api/admin/delivery/'))return true;
  if(pathname==='/api/admin/deliveries'||pathname.startsWith('/api/admin/deliveries/'))return true;
  if(pathname==='/api/admin/couriers'||pathname.startsWith('/api/admin/couriers/'))return true;
  return false;
}
export async function deliveryFetch(path,options={}){
  const pathname=String(path||'').split('?')[0];
  const method=String(options.method||'GET').toUpperCase();
  if(isDeliveryOwnedPath(pathname,method)){
    throw Object.assign(new Error('Delivery-owned paths require in-process Delivery dispatch'),{
      status:500,code:'DELIVERY_EMBEDDED_DISPATCH_REQUIRED'
    });
  }
  if(pathname==='/health'){
    try{
      await pool.query('SELECT 1');
      const supplier=await upstream('/health',{headers:options.headers||{}});
      const ok=supplierReady&&supplier.ok;
      return new Response(JSON.stringify({ok,db:true,suppliers:ok,version:'0.7-delivery'}),{
        status:ok?200:503,
        headers:{'content-type':'application/json; charset=utf-8'}
      });
    }catch{
      return new Response(JSON.stringify({ok:false,db:false,suppliers:false,version:'0.7-delivery'}),{
        status:503,
        headers:{'content-type':'application/json; charset=utf-8'}
      });
    }
  }
  if(pathname==='/'||pathname==='/index.html'){
    const r=await upstream(path,options);
    let html=await r.text();
    html=html.replace('</head>','  <link rel="stylesheet" href="/delivery.css" />\n</head>').replace('</body>','  <script type="module" src="/delivery-ui.js"></script>\n</body>');
    return new Response(html,{status:r.status,headers:{'content-type':'text/html; charset=utf-8'}});
  }
  return upstream(path,options);
}
async function identity(req){const r=await upstream('/api/me',{headers:{Authorization:authHeader(req)}});const b=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(b.error||'Unauthorized'),{status:r.status});return b}
function enabled(me,role){return me?.profiles?.some(p=>p.role===role&&p.enabled)}
function business(me,id=null){const list=me?.businesses||[];return id==null?(list[0]||null):(list.find(b=>Number(b.id)===Number(id))||null)}
async function requireMerchant(req,businessId=null){const me=await identity(req);if(!enabled(me,'merchant'))throw Object.assign(new Error('Merchant profile required'),{status:403});const b=business(me,businessId);if(!b)throw Object.assign(new Error('Business workspace unavailable'),{status:403});return{me,business:b}}
async function requireCustomer(req){const me=await identity(req);if(!enabled(me,'customer'))throw Object.assign(new Error('Customer profile required'),{status:403});return me}
async function requireCourier(req){const me=await identity(req);if(!enabled(me,'courier'))throw Object.assign(new Error('Delivery profile required'),{status:403});return me}
async function requireAdmin(req,permission){const me=await identity(req);const assertion=verifyAdminAssertion(TOKEN_SECRET,req.headers['x-bl-admin-assertion'],me.account.id);if(!assertion||assertion.permission!==permission)throw Object.assign(new Error('Scoped Admin assertion required'),{status:403});me.admin_assertion=assertion;return me}
function haversine(lat1,lon1,lat2,lon2){const R=6371,dLat=(lat2-lat1)*Math.PI/180,dLon=(lon2-lon1)*Math.PI/180;const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))}
function completionCode(deliveryId){if(!TOKEN_SECRET)return null;const hex=crypto.createHmac('sha256',TOKEN_SECRET).update(`delivery:${deliveryId}`).digest('hex');return String(parseInt(hex.slice(0,12),16)%1_000_000).padStart(6,'0')}

async function initDb(){await ensureMonetizationSchema(pool);await ensurePrivateEvidenceSchema(pool);await pool.query(`
  ALTER TABLE merchant_storefronts ADD COLUMN IF NOT EXISTS pickup_lat DOUBLE PRECISION;
  ALTER TABLE merchant_storefronts ADD COLUMN IF NOT EXISTS pickup_lng DOUBLE PRECISION;
  ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS estimated_weight_kg NUMERIC(12,4) NOT NULL DEFAULT 0;
  ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS estimated_volume_l NUMERIC(12,4) NOT NULL DEFAULT 0;
  ALTER TABLE courier_profiles ADD COLUMN IF NOT EXISTS approved_vehicle_class TEXT NOT NULL DEFAULT '';
  ALTER TABLE courier_profiles ADD COLUMN IF NOT EXISTS eligibility_expires_at TIMESTAMPTZ;
  ALTER TABLE courier_profiles ADD COLUMN IF NOT EXISTS approval_note TEXT NOT NULL DEFAULT '';
  ALTER TABLE courier_profiles ADD COLUMN IF NOT EXISTS operating_psgc_code TEXT NOT NULL DEFAULT '';
  ALTER TABLE courier_profiles ADD COLUMN IF NOT EXISTS operating_area_name TEXT NOT NULL DEFAULT '';
  ALTER TABLE courier_profiles ADD COLUMN IF NOT EXISTS operating_area_path TEXT NOT NULL DEFAULT '';
  ALTER TABLE courier_profiles ADD COLUMN IF NOT EXISTS operating_area_source_version TEXT NOT NULL DEFAULT '';
  CREATE INDEX IF NOT EXISTS courier_profiles_operating_psgc_idx ON courier_profiles(operating_psgc_code) WHERE operating_psgc_code<>'';

  CREATE TABLE IF NOT EXISTS courier_documents (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    document_type TEXT NOT NULL,
    vehicle_class TEXT NOT NULL DEFAULT '',
    reference_number TEXT NOT NULL DEFAULT '',
    issue_date DATE,
    expiry_date DATE,
    evidence_data_url TEXT,
    private_evidence_object_id BIGINT REFERENCES private_evidence_objects(id),
    verification_status TEXT NOT NULL DEFAULT 'submitted',
    verified_by_account_id BIGINT REFERENCES accounts(id),
    verified_at TIMESTAMPTZ,
    rejection_reason TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK(verification_status IN ('submitted','verified','rejected','expired'))
  );
  ALTER TABLE courier_documents ALTER COLUMN evidence_data_url DROP NOT NULL;
  ALTER TABLE courier_documents ADD COLUMN IF NOT EXISTS private_evidence_object_id BIGINT REFERENCES private_evidence_objects(id);
  CREATE INDEX IF NOT EXISTS courier_documents_account_idx ON courier_documents(account_id,verification_status);
  CREATE INDEX IF NOT EXISTS courier_documents_private_evidence_idx ON courier_documents(private_evidence_object_id);

  CREATE TABLE IF NOT EXISTS delivery_pricing_rules (
    id BIGSERIAL PRIMARY KEY,
    country_code TEXT NOT NULL DEFAULT 'PH',
    version INTEGER NOT NULL,
    active BOOLEAN NOT NULL DEFAULT FALSE,
    base_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
    per_km NUMERIC(12,2) NOT NULL DEFAULT 0,
    per_kg NUMERIC(12,2) NOT NULL DEFAULT 0,
    per_liter NUMERIC(12,2) NOT NULL DEFAULT 0,
    minimum_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
    maximum_distance_km NUMERIC(12,2),
    route_factor NUMERIC(8,4) NOT NULL DEFAULT 1,
    average_speed_bicycle_kmh NUMERIC(8,2),
    average_speed_motorbike_kmh NUMERIC(8,2),
    average_speed_car_kmh NUMERIC(8,2),
    created_by_account_id BIGINT REFERENCES accounts(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(country_code,version)
  );

  CREATE TABLE IF NOT EXISTS delivery_vehicle_pricing_rules (
    id BIGSERIAL PRIMARY KEY,
    pricing_rule_id BIGINT NOT NULL REFERENCES delivery_pricing_rules(id) ON DELETE CASCADE,
    vehicle_class TEXT NOT NULL,
    formula_type TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 100,
    base_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
    per_km NUMERIC(12,2) NOT NULL DEFAULT 0,
    per_kg NUMERIC(12,2) NOT NULL DEFAULT 0,
    per_liter NUMERIC(12,2) NOT NULL DEFAULT 0,
    minimum_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
    maximum_distance_km NUMERIC(12,2),
    max_weight_kg NUMERIC(12,4),
    max_volume_l NUMERIC(12,4),
    included_distance_km NUMERIC(12,4) NOT NULL DEFAULT 0,
    distance_bands JSONB NOT NULL DEFAULT '[]'::jsonb,
    extra_stop_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
    free_wait_minutes INTEGER NOT NULL DEFAULT 0,
    waiting_fee_per_minute NUMERIC(12,2) NOT NULL DEFAULT 0,
    demand_adjustment_cap_pct NUMERIC(8,4) NOT NULL DEFAULT 0,
    route_profile TEXT NOT NULL DEFAULT '',
    expressway_eligible BOOLEAN NOT NULL DEFAULT TRUE,
    toll_policy TEXT NOT NULL DEFAULT 'pass_through',
    parking_policy TEXT NOT NULL DEFAULT 'pass_through',
    stacking_policy TEXT NOT NULL DEFAULT 'direct_only',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(pricing_rule_id,vehicle_class),
    CHECK(vehicle_class IN ('bicycle','motorcycle','sedan','mpv_suv','pickup','l300_van','car','van')),
    CHECK(formula_type IN ('base_plus_km','distance_weight_volume','tiered_distance'))
  );
  CREATE INDEX IF NOT EXISTS delivery_vehicle_pricing_rule_parent_idx
    ON delivery_vehicle_pricing_rules(pricing_rule_id,priority,vehicle_class);

  ALTER TABLE delivery_vehicle_pricing_rules ADD COLUMN IF NOT EXISTS included_distance_km NUMERIC(12,4) NOT NULL DEFAULT 0;
  ALTER TABLE delivery_vehicle_pricing_rules ADD COLUMN IF NOT EXISTS distance_bands JSONB NOT NULL DEFAULT '[]'::jsonb;
  ALTER TABLE delivery_vehicle_pricing_rules ADD COLUMN IF NOT EXISTS extra_stop_fee NUMERIC(12,2) NOT NULL DEFAULT 0;
  ALTER TABLE delivery_vehicle_pricing_rules ADD COLUMN IF NOT EXISTS free_wait_minutes INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE delivery_vehicle_pricing_rules ADD COLUMN IF NOT EXISTS waiting_fee_per_minute NUMERIC(12,2) NOT NULL DEFAULT 0;
  ALTER TABLE delivery_vehicle_pricing_rules ADD COLUMN IF NOT EXISTS demand_adjustment_cap_pct NUMERIC(8,4) NOT NULL DEFAULT 0;
  ALTER TABLE delivery_vehicle_pricing_rules ADD COLUMN IF NOT EXISTS route_profile TEXT NOT NULL DEFAULT '';
  ALTER TABLE delivery_vehicle_pricing_rules ADD COLUMN IF NOT EXISTS expressway_eligible BOOLEAN NOT NULL DEFAULT TRUE;
  ALTER TABLE delivery_vehicle_pricing_rules ADD COLUMN IF NOT EXISTS toll_policy TEXT NOT NULL DEFAULT 'pass_through';
  ALTER TABLE delivery_vehicle_pricing_rules ADD COLUMN IF NOT EXISTS parking_policy TEXT NOT NULL DEFAULT 'pass_through';
  ALTER TABLE delivery_vehicle_pricing_rules ADD COLUMN IF NOT EXISTS stacking_policy TEXT NOT NULL DEFAULT 'direct_only';
  ALTER TABLE delivery_vehicle_pricing_rules DROP CONSTRAINT IF EXISTS delivery_vehicle_pricing_rules_vehicle_class_check;
  ALTER TABLE delivery_vehicle_pricing_rules ADD CONSTRAINT delivery_vehicle_pricing_rules_vehicle_class_check CHECK(vehicle_class IN ('bicycle','motorcycle','sedan','mpv_suv','pickup','l300_van','car','van'));
  ALTER TABLE delivery_vehicle_pricing_rules DROP CONSTRAINT IF EXISTS delivery_vehicle_pricing_rules_formula_type_check;
  ALTER TABLE delivery_vehicle_pricing_rules ADD CONSTRAINT delivery_vehicle_pricing_rules_formula_type_check CHECK(formula_type IN ('base_plus_km','distance_weight_volume','tiered_distance'));

  CREATE TABLE IF NOT EXISTS delivery_quotes (
    id BIGSERIAL PRIMARY KEY,
    customer_account_id BIGINT NOT NULL REFERENCES accounts(id),
    business_id BIGINT NOT NULL REFERENCES businesses(id),
    pricing_rule_id BIGINT NOT NULL REFERENCES delivery_pricing_rules(id),
    pricing_rule_version INTEGER NOT NULL,
    pickup_lat DOUBLE PRECISION NOT NULL,
    pickup_lng DOUBLE PRECISION NOT NULL,
    dropoff_lat DOUBLE PRECISION NOT NULL,
    dropoff_lng DOUBLE PRECISION NOT NULL,
    route_distance_km NUMERIC(12,4) NOT NULL,
    estimated_weight_kg NUMERIC(12,4) NOT NULL DEFAULT 0,
    estimated_volume_l NUMERIC(12,4) NOT NULL DEFAULT 0,
    fee NUMERIC(12,2) NOT NULL,
    service_fare NUMERIC(12,2) NOT NULL DEFAULT 0,
    platform_fee_basis_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    pass_through_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    price_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
    route_source TEXT NOT NULL DEFAULT 'straight_line_estimate',
    route_profile TEXT NOT NULL DEFAULT '',
    route_eta_minutes INTEGER,
    route_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    currency_code TEXT NOT NULL DEFAULT 'PHP',
    status TEXT NOT NULL DEFAULT 'quoted',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK(status IN ('quoted','used','expired','cancelled'))
  );

  CREATE TABLE IF NOT EXISTS deliveries (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT UNIQUE NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    quote_id BIGINT REFERENCES delivery_quotes(id),
    business_id BIGINT NOT NULL REFERENCES businesses(id),
    customer_account_id BIGINT NOT NULL REFERENCES accounts(id),
    courier_account_id BIGINT REFERENCES accounts(id),
    status TEXT NOT NULL DEFAULT 'quoted',
    delivery_fee NUMERIC(12,2) NOT NULL,
    service_fare NUMERIC(12,2) NOT NULL DEFAULT 0,
    platform_fee_basis_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    pass_through_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    price_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
    route_source TEXT NOT NULL DEFAULT 'straight_line_estimate',
    route_profile TEXT NOT NULL DEFAULT '',
    route_eta_minutes INTEGER,
    currency_code TEXT NOT NULL DEFAULT 'PHP',
    route_distance_km NUMERIC(12,4) NOT NULL,
    estimated_weight_kg NUMERIC(12,4) NOT NULL DEFAULT 0,
    estimated_volume_l NUMERIC(12,4) NOT NULL DEFAULT 0,
    pickup_address TEXT NOT NULL DEFAULT '',
    pickup_lat DOUBLE PRECISION NOT NULL,
    pickup_lng DOUBLE PRECISION NOT NULL,
    dropoff_address TEXT NOT NULL,
    dropoff_lat DOUBLE PRECISION NOT NULL,
    dropoff_lng DOUBLE PRECISION NOT NULL,
    vehicle_class TEXT NOT NULL DEFAULT '',
    last_lat DOUBLE PRECISION,
    last_lng DOUBLE PRECISION,
    last_location_at TIMESTAMPTZ,
    requested_at TIMESTAMPTZ,
    assigned_at TIMESTAMPTZ,
    en_route_to_merchant_at TIMESTAMPTZ,
    arrived_merchant_at TIMESTAMPTZ,
    picked_up_at TIMESTAMPTZ,
    in_transit_at TIMESTAMPTZ,
    arrived_customer_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    failure_reason TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK(status IN ('quoted','requested','awaiting_courier','courier_assigned','courier_en_route_to_merchant','courier_arrived_at_merchant','picked_up','in_transit','courier_arrived_at_customer','delivered','failed','cancelled'))
  );
  CREATE INDEX IF NOT EXISTS deliveries_business_idx ON deliveries(business_id,status,created_at DESC);
  CREATE INDEX IF NOT EXISTS deliveries_customer_idx ON deliveries(customer_account_id,status,created_at DESC);
  CREATE INDEX IF NOT EXISTS deliveries_courier_idx ON deliveries(courier_account_id,status,created_at DESC);
  ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS dispatch_round INTEGER NOT NULL DEFAULT 0;

  CREATE TABLE IF NOT EXISTS delivery_offers (
    id BIGSERIAL PRIMARY KEY,
    delivery_id BIGINT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
    courier_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    offer_round INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    offered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    responded_at TIMESTAMPTZ,
    decline_reason TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(delivery_id,courier_account_id,offer_round),
    CHECK(status IN ('pending','accepted','declined','withdrawn','expired'))
  );
  CREATE INDEX IF NOT EXISTS delivery_offers_courier_idx
    ON delivery_offers(courier_account_id,status,offered_at DESC);
  CREATE INDEX IF NOT EXISTS delivery_offers_delivery_idx
    ON delivery_offers(delivery_id,offer_round,status);

  CREATE TABLE IF NOT EXISTS delivery_dispatch_events (
    id BIGSERIAL PRIMARY KEY,
    delivery_id BIGINT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
    actor_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
    courier_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
    event_code TEXT NOT NULL,
    offer_round INTEGER,
    detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS delivery_dispatch_events_delivery_idx
    ON delivery_dispatch_events(delivery_id,created_at DESC);

  CREATE TABLE IF NOT EXISTS delivery_location_points (
    id BIGSERIAL PRIMARY KEY,
    delivery_id BIGINT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
    courier_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    sequence_no INTEGER NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    accuracy_m NUMERIC(10,2),
    heading_deg NUMERIC(8,2),
    speed_mps NUMERIC(10,3),
    delivery_status TEXT NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    retention_until TIMESTAMPTZ,
    UNIQUE(delivery_id,sequence_no)
  );
  CREATE INDEX IF NOT EXISTS delivery_location_points_delivery_idx
    ON delivery_location_points(delivery_id,sequence_no);
  CREATE INDEX IF NOT EXISTS delivery_location_points_courier_idx
    ON delivery_location_points(courier_account_id,recorded_at DESC);

  CREATE TABLE IF NOT EXISTS delivery_proof_media (
    id BIGSERIAL PRIMARY KEY,
    delivery_id BIGINT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
    courier_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    proof_type TEXT NOT NULL CHECK(proof_type IN ('pickup','delivery')),
    private_evidence_object_id BIGINT NOT NULL REFERENCES private_evidence_objects(id),
    courier_note TEXT NOT NULL DEFAULT '',
    delivery_status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS delivery_proof_media_delivery_idx
    ON delivery_proof_media(delivery_id,proof_type,created_at DESC);
  CREATE INDEX IF NOT EXISTS delivery_proof_media_object_idx
    ON delivery_proof_media(private_evidence_object_id);

  ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS handoff_failed_attempts INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS handoff_locked_until TIMESTAMPTZ;
  ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS handoff_last_failed_at TIMESTAMPTZ;

  CREATE TABLE IF NOT EXISTS delivery_security_events (
    id BIGSERIAL PRIMARY KEY,
    delivery_id BIGINT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
    actor_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
    event_code TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
    locked_until TIMESTAMPTZ,
    detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS delivery_security_events_delivery_idx
    ON delivery_security_events(delivery_id,created_at DESC);

  CREATE TABLE IF NOT EXISTS delivery_financial_events (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT REFERENCES orders(id) ON DELETE CASCADE,
    delivery_id BIGINT REFERENCES deliveries(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    currency_code TEXT NOT NULL DEFAULT 'PHP',
    source_payment_id BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(event_type,source_payment_id)
  );

  ALTER TABLE delivery_quotes ADD COLUMN IF NOT EXISTS vehicle_pricing_rule_id BIGINT REFERENCES delivery_vehicle_pricing_rules(id);
  ALTER TABLE delivery_quotes ADD COLUMN IF NOT EXISTS required_vehicle_class TEXT NOT NULL DEFAULT '';
  ALTER TABLE delivery_quotes ADD COLUMN IF NOT EXISTS formula_type TEXT NOT NULL DEFAULT '';
  ALTER TABLE delivery_quotes ADD COLUMN IF NOT EXISTS pricing_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;
  ALTER TABLE delivery_quotes ADD COLUMN IF NOT EXISTS service_fare NUMERIC(12,2) NOT NULL DEFAULT 0;
  ALTER TABLE delivery_quotes ADD COLUMN IF NOT EXISTS platform_fee_basis_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
  ALTER TABLE delivery_quotes ADD COLUMN IF NOT EXISTS pass_through_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
  ALTER TABLE delivery_quotes ADD COLUMN IF NOT EXISTS price_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb;
  ALTER TABLE delivery_quotes ADD COLUMN IF NOT EXISTS route_source TEXT NOT NULL DEFAULT 'straight_line_estimate';
  ALTER TABLE delivery_quotes ADD COLUMN IF NOT EXISTS route_profile TEXT NOT NULL DEFAULT '';
  ALTER TABLE delivery_quotes ADD COLUMN IF NOT EXISTS route_eta_minutes INTEGER;
  ALTER TABLE delivery_quotes ADD COLUMN IF NOT EXISTS route_evidence JSONB NOT NULL DEFAULT '{}'::jsonb;
  ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS required_vehicle_class TEXT NOT NULL DEFAULT '';
  ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS service_fare NUMERIC(12,2) NOT NULL DEFAULT 0;
  ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS platform_fee_basis_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
  ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS pass_through_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
  ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS price_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb;
  ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS route_source TEXT NOT NULL DEFAULT 'straight_line_estimate';
  ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS route_profile TEXT NOT NULL DEFAULT '';
  ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS route_eta_minutes INTEGER;
  ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS route_evidence JSONB NOT NULL DEFAULT '{}'::jsonb;
  UPDATE delivery_quotes SET service_fare=fee WHERE service_fare=0 AND fee>0;
  UPDATE delivery_quotes SET platform_fee_basis_amount=service_fare WHERE platform_fee_basis_amount=0 AND service_fare>0;
  UPDATE deliveries SET service_fare=delivery_fee WHERE service_fare=0 AND delivery_fee>0;
  UPDATE deliveries SET platform_fee_basis_amount=service_fare WHERE platform_fee_basis_amount=0 AND service_fare>0;
  ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS merchandise_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
  ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS delivery_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
`)}

async function activeRule(){const r=await pool.query(`SELECT * FROM delivery_pricing_rules WHERE country_code='PH' AND active=TRUE ORDER BY version DESC LIMIT 1`);return r.rows[0]||null}
async function vehicleRulesForPricingRule(pricingRuleId){
  const {rows}=await pool.query(`SELECT * FROM delivery_vehicle_pricing_rules WHERE pricing_rule_id=$1 ORDER BY priority,vehicle_class`,[pricingRuleId]);
  return rows;
}
async function activePricingBundle(){
  const rule=await activeRule();
  if(!rule)return null;
  const vehicleRules=await vehicleRulesForPricingRule(rule.id);
  return{rule,vehicleRules};
}
function legacyDeliveryPrice(rule,{distanceKm,weightKg,volumeL}){
  let fee=Number(rule.base_fee)+Number(distanceKm)*Number(rule.per_km)+Number(weightKg)*Number(rule.per_kg)+Number(volumeL)*Number(rule.per_liter);
  fee=Math.max(Number(rule.minimum_fee||0),fee);
  return{
    vehicle_class:'',
    formula_type:'legacy_generic',
    distance_km:Number(distanceKm),
    weight_kg:Number(weightKg),
    volume_l:Number(volumeL),
    delivery_price:Math.round(fee*100)/100,
    rule:null
  };
}
async function deliveryDetail(id){const r=await pool.query(`SELECT d.*,o.order_number,o.order_status,o.payment_status,b.name business_name,cu.display_name customer_name,cp.display_name courier_name,cp.vehicle_type courier_vehicle FROM deliveries d JOIN orders o ON o.id=d.order_id JOIN businesses b ON b.id=d.business_id JOIN accounts cu ON cu.id=d.customer_account_id LEFT JOIN courier_profiles cp ON cp.account_id=d.courier_account_id WHERE d.id=$1`,[id]);return r.rows[0]||null}
async function allowedDelivery(req,d){const me=await identity(req);const id=Number(me.account.id);if(id===Number(d.customer_account_id)||id===Number(d.courier_account_id)||Boolean(business(me,d.business_id))||id===1)return me;throw Object.assign(new Error('Not allowed to view this delivery'),{status:403})}
function activeTracking(status){return !['delivered','failed','cancelled'].includes(status)}
function deliveryAudience(me,d){
  const accountId=Number(me?.account?.id);
  if(accountId===Number(d.customer_account_id))return'customer';
  if(accountId===Number(d.courier_account_id))return'courier';
  if(Boolean(business(me,d.business_id)))return'merchant';
  if(accountId===1)return'admin';
  return'other';
}
function deliveryPrivacyView(d,audience='other'){
  const active=activeTracking(d.status);
  const exactDestination=audience==='customer'||(active&&['courier','merchant','admin'].includes(audience));
  return{
    ...d,
    dropoff_address:exactDestination?d.dropoff_address:'',
    dropoff_lat:exactDestination?d.dropoff_lat:null,
    dropoff_lng:exactDestination?d.dropoff_lng:null,
    last_lat:active?d.last_lat:null,
    last_lng:active?d.last_lng:null,
    last_location_at:active?d.last_location_at:null
  };
}
async function deliveryRoutePoints(deliveryId,{afterSequence=0,limit=DELIVERY_ROUTE_POINT_LIMIT}={}){
  const safeAfter=Math.max(0,Number(afterSequence)||0);
  const safeLimit=Math.max(1,Math.min(DELIVERY_ROUTE_POINT_LIMIT,Number(limit)||DELIVERY_ROUTE_POINT_LIMIT));
  const{rows}=await pool.query(
    `SELECT sequence_no,latitude,longitude,accuracy_m,heading_deg,speed_mps,delivery_status,recorded_at
       FROM delivery_location_points
      WHERE delivery_id=$1 AND sequence_no>$2
      ORDER BY sequence_no ASC
      LIMIT $3`,
    [Number(deliveryId),safeAfter,safeLimit]
  );
  return rows.map(row=>({
    sequence_no:Number(row.sequence_no),
    lat:Number(row.latitude),
    lng:Number(row.longitude),
    accuracy_m:row.accuracy_m==null?null:Number(row.accuracy_m),
    heading_deg:row.heading_deg==null?null:Number(row.heading_deg),
    speed_mps:row.speed_mps==null?null:Number(row.speed_mps),
    delivery_status:row.delivery_status,
    recorded_at:row.recorded_at
  }));
}
async function deliveryProofRows(deliveryId){
  const{rows}=await pool.query(
    `SELECT id,delivery_id,courier_account_id,proof_type,courier_note,delivery_status,created_at
       FROM delivery_proof_media
      WHERE delivery_id=$1
      ORDER BY created_at ASC,id ASC`,
    [Number(deliveryId)]
  );
  return rows;
}

async function deliveryTerritoryId(db,businessId){
  const q=await db.query('SELECT territory_id FROM businesses WHERE id=$1',[Number(businessId)]);
  return q.rows[0]?.territory_id==null?null:Number(q.rows[0].territory_id);
}
async function courierTerritoryAuthorized(db,accountId,territoryId){
  const values=[Number(accountId)];
  let scope='';
  if(territoryId!=null){values.push(Number(territoryId));scope=' AND territory_id=$2'}
  const q=await db.query(
    `SELECT 1
       FROM profile_authorizations
      WHERE account_id=$1 AND role='courier' AND status='active'
        AND (expires_at IS NULL OR expires_at>NOW())${scope}
      LIMIT 1`,
    values
  );
  return Boolean(q.rowCount);
}
async function courierHasActiveDelivery(db,accountId,{excludeDeliveryId=null}={}){
  const values=[Number(accountId)],extra=excludeDeliveryId==null?'':` AND id<>${values.push(Number(excludeDeliveryId))}`;
  const q=await db.query(
    `SELECT 1 FROM deliveries
      WHERE courier_account_id=$1
        AND status IN ('courier_assigned','courier_en_route_to_merchant','courier_arrived_at_merchant','picked_up','in_transit','courier_arrived_at_customer')
        ${extra}
      LIMIT 1`,
    values
  );
  return Boolean(q.rowCount);
}
async function courierOfferGateFromDb(db,courier,delivery){
  const territoryId=await deliveryTerritoryId(db,delivery.business_id);
  const [territoryAuthorized,hasActiveDelivery]=await Promise.all([
    courierTerritoryAuthorized(db,courier.account_id,territoryId),
    courierHasActiveDelivery(db,courier.account_id,{excludeDeliveryId:delivery.id})
  ]);
  return deliveryOfferCourierGate(courier,delivery,{territoryAuthorized,hasActiveDelivery});
}
async function eligibleCouriersForDelivery(db,delivery){
  const q=await db.query(`
    SELECT c.*,a.display_name courier_name
      FROM courier_profiles c
      JOIN accounts a ON a.id=c.account_id
      JOIN profiles p ON p.account_id=c.account_id AND p.role='courier'
     WHERE p.enabled=TRUE AND p.status='active'
       AND c.eligibility_status='approved'
       AND c.available=TRUE
       AND (c.eligibility_expires_at IS NULL OR c.eligibility_expires_at>NOW())
     ORDER BY c.account_id
  `);
  const eligible=[];
  for(const courier of q.rows){
    const gate=await courierOfferGateFromDb(db,courier,delivery);
    if(gate.allowed)eligible.push({...courier,dispatch_gate:gate});
  }
  return eligible;
}
async function pendingCourierOffers(db,accountId,{limit=20}={}){
  const safeLimit=Math.max(1,Math.min(50,Number(limit)||20));
  const{rows}=await db.query(`
    SELECT dof.id,dof.delivery_id,dof.offer_round,dof.status,dof.offered_at,dof.responded_at,
           o.order_number,b.name business_name,d.route_distance_km,d.estimated_weight_kg,
           d.estimated_volume_l,d.required_vehicle_class,d.delivery_fee,d.currency_code
      FROM delivery_offers dof
      JOIN deliveries d ON d.id=dof.delivery_id
      JOIN orders o ON o.id=d.order_id
      JOIN businesses b ON b.id=d.business_id
     WHERE dof.courier_account_id=$1
       AND dof.status='pending'
       AND d.status='awaiting_courier'
       AND dof.offer_round=d.dispatch_round
     ORDER BY dof.offered_at ASC,dof.id ASC
     LIMIT $2
  `,[Number(accountId),safeLimit]);
  return rows.map(deliveryOfferSafeView);
}
async function recordDispatchEvent(db,{deliveryId,actorAccountId=null,courierAccountId=null,eventCode,offerRound=null,detail={}}){
  await db.query(`
    INSERT INTO delivery_dispatch_events(
      delivery_id,actor_account_id,courier_account_id,event_code,offer_round,detail_json
    ) VALUES($1,$2,$3,$4,$5,$6::jsonb)
  `,[
    Number(deliveryId),actorAccountId==null?null:Number(actorAccountId),
    courierAccountId==null?null:Number(courierAccountId),
    clean(eventCode,80),offerRound==null?null:Number(offerRound),JSON.stringify(detail||{})
  ]);
}
async function createOfferRound(db,delivery,{actorAccountId=null}={}){
  const currentRound=Number(delivery.dispatch_round||0);
  if(delivery.status==='awaiting_courier'&&currentRound>0){
    const pending=await db.query(
      "SELECT COUNT(*)::int count FROM delivery_offers WHERE delivery_id=$1 AND offer_round=$2 AND status='pending'",
      [Number(delivery.id),currentRound]
    );
    if(Number(pending.rows[0]?.count||0)>0){
      throw Object.assign(new Error('Courier offers are already pending for this delivery'),{status:409,code:'DELIVERY_OFFERS_PENDING'});
    }
  }
  const nextRound=currentRound+1;
  const candidates=await eligibleCouriersForDelivery(db,delivery);
  await db.query(`
    UPDATE deliveries
       SET status='awaiting_courier',
           dispatch_round=$1,
           requested_at=COALESCE(requested_at,NOW()),
           updated_at=NOW()
     WHERE id=$2
  `,[nextRound,Number(delivery.id)]);
  const offerIds=[],courierIds=[];
  for(const courier of candidates){
    const inserted=await db.query(`
      INSERT INTO delivery_offers(delivery_id,courier_account_id,offer_round,status)
      VALUES($1,$2,$3,'pending')
      ON CONFLICT(delivery_id,courier_account_id,offer_round) DO NOTHING
      RETURNING id
    `,[Number(delivery.id),Number(courier.account_id),nextRound]);
    if(inserted.rowCount){
      offerIds.push(Number(inserted.rows[0].id));
      courierIds.push(Number(courier.account_id));
      await recordDispatchEvent(db,{
        deliveryId:delivery.id,actorAccountId,courierAccountId:courier.account_id,
        eventCode:'offer_created',offerRound:nextRound,
        detail:{required_vehicle_class:delivery.required_vehicle_class||'',route_distance_km:Number(delivery.route_distance_km||0)}
      });
    }
  }
  await recordDispatchEvent(db,{
    deliveryId:delivery.id,actorAccountId,eventCode:'offer_round_opened',offerRound:nextRound,
    detail:{offer_count:offerIds.length}
  });
  return{round:nextRound,offerIds,courierIds};
}
async function offerWaitingDeliveriesToCourier(db,courierAccountId,{limit=5}={}){
  const courierQ=await db.query('SELECT * FROM courier_profiles WHERE account_id=$1',[Number(courierAccountId)]);
  if(!courierQ.rowCount)return[];
  const courier=courierQ.rows[0],q=await db.query(`
    SELECT d.*
      FROM deliveries d
     WHERE d.status='awaiting_courier'
       AND d.courier_account_id IS NULL
       AND d.dispatch_round>0
       AND NOT EXISTS(
         SELECT 1 FROM delivery_offers dof
          WHERE dof.delivery_id=d.id
            AND dof.courier_account_id=$1
            AND dof.offer_round=d.dispatch_round
       )
     ORDER BY d.requested_at ASC NULLS LAST,d.id ASC
     LIMIT $2
  `,[Number(courierAccountId),Math.max(1,Math.min(10,Number(limit)||5))]);
  const created=[];
  for(const delivery of q.rows){
    const gate=await courierOfferGateFromDb(db,courier,delivery);
    if(!gate.allowed)continue;
    const inserted=await db.query(`
      INSERT INTO delivery_offers(delivery_id,courier_account_id,offer_round,status)
      VALUES($1,$2,$3,'pending')
      ON CONFLICT(delivery_id,courier_account_id,offer_round) DO NOTHING
      RETURNING id
    `,[Number(delivery.id),Number(courierAccountId),Number(delivery.dispatch_round)]);
    if(inserted.rowCount){
      created.push({offer_id:Number(inserted.rows[0].id),delivery_id:Number(delivery.id)});
      await recordDispatchEvent(db,{
        deliveryId:delivery.id,courierAccountId,eventCode:'offer_created_on_availability',
        offerRound:delivery.dispatch_round,detail:{}
      });
    }
  }
  return created;
}
async function scopedAdminDelivery(req,deliveryId){
  const me=await requireAdmin(req,'delivery.dispatch.manage');
  const d=await deliveryDetail(Number(deliveryId));
  if(!d)throw Object.assign(new Error('Delivery not found'),{status:404});
  if(me.admin_assertion.territoryId!=null){
    const q=await pool.query('SELECT 1 FROM businesses WHERE id=$1 AND territory_id=$2',[d.business_id,me.admin_assertion.territoryId]);
    if(!q.rowCount)throw Object.assign(new Error('Delivery is outside your delegated territory'),{status:403});
  }
  return{me,d};
}
async function auditDeliveryEvidenceView({deliveryId,actorAccountId,eventCode,detail={}}){
  await pool.query(
    `INSERT INTO delivery_security_events(
       delivery_id,actor_account_id,event_code,attempt_count,detail_json
     ) VALUES($1,$2,$3,0,$4::jsonb)`,
    [Number(deliveryId),Number(actorAccountId),clean(eventCode,80),JSON.stringify(detail||{})]
  );
}
function etaMinutes(d,rule){if(!d.last_lat||!d.last_lng||!rule||!d.vehicle_class)return null;const dist=haversine(Number(d.last_lat),Number(d.last_lng),Number(d.dropoff_lat),Number(d.dropoff_lng))*Number(rule.route_factor||1);let cls;try{cls=canonicalDeliveryVehicleClass(d.vehicle_class)}catch{return null}let speed=null;if(cls==='bicycle')speed=rule.average_speed_bicycle_kmh;else if(cls==='motorcycle')speed=rule.average_speed_motorbike_kmh;else speed=rule.average_speed_car_kmh;if(!speed||Number(speed)<=0)return null;return Math.ceil(dist/Number(speed)*60)}

async function courierHomeSnapshot(accountId,profile=null){
  const [workResult,complianceResult]=await Promise.all([
    pool.query(`
      SELECT d.id,d.order_id,d.status,o.order_number,b.name business_name,d.created_at
      FROM deliveries d
      JOIN orders o ON o.id=d.order_id
      JOIN businesses b ON b.id=d.business_id
      WHERE d.courier_account_id=$1
        AND d.status NOT IN ('delivered','failed','cancelled','quoted')
      ORDER BY
        CASE WHEN d.status IN (
          'courier_en_route_to_merchant','courier_arrived_at_merchant',
          'picked_up','in_transit','courier_arrived_at_customer'
        ) THEN 0 ELSE 1 END,
        d.created_at DESC,d.id DESC
      LIMIT 1
    `,[Number(accountId)]),
    pool.query(`
      SELECT
        COUNT(*) FILTER(WHERE verification_status IN ('rejected','expired'))::int blocking_count,
        COUNT(*) FILTER(WHERE verification_status='submitted')::int pending_count,
        COUNT(*) FILTER(
          WHERE verification_status='verified'
            AND expiry_date IS NOT NULL
            AND expiry_date<=CURRENT_DATE+INTERVAL '30 days'
        )::int expiring_soon_count
      FROM courier_documents
      WHERE account_id=$1
    `,[Number(accountId)])
  ]);
  const compliance=complianceResult.rows[0]||{};
  const offers=await pendingCourierOffers(pool,accountId,{limit:3});
  return{
    detail_mode:'home',
    profile:profile?{
      eligibility_status:profile.eligibility_status,
      eligibility_expires_at:profile.eligibility_expires_at,
      approved_vehicle_class:profile.approved_vehicle_class,
      vehicle_type:profile.vehicle_type,
      available:Boolean(profile.available),
      operating_psgc_code:profile.operating_psgc_code||'',
      operating_area_name:profile.operating_area_name||'',
      operating_area_path:profile.operating_area_path||''
    }:null,
    deliveries:workResult.rows,
    offers,
    offer_count:offers.length,
    compliance:{
      blocking_count:Number(compliance.blocking_count||0),
      pending_count:Number(compliance.pending_count||0),
      expiring_soon_count:Number(compliance.expiring_soon_count||0)
    },
    deferred:{
      delivery_history:true,
      document_detail:true,
      route_coordinates:true,
      live_map:true
    }
  };
}

app.get('/health',async(req,res)=>{const r=await deliveryFetch('/health',{headers:req.headers});const payload=await r.json().catch(()=>({ok:false,db:false,suppliers:false,version:'0.7-delivery'}));res.status(r.status).json(payload)})
app.get('/delivery.css',(_q,r)=>r.type('text/css').send(readFileSync(join(__dirname,'public','delivery.css'),'utf8')))
app.get('/delivery-ui.js',(_q,r)=>r.type('application/javascript').send(readFileSync(join(__dirname,'public','delivery-ui.js'),'utf8')))
async function root(req,res){const r=await deliveryFetch(req.path,{headers:req.headers});res.status(r.status).type('html').send(await r.text())}
app.get('/',root);app.get('/index.html',root)

app.get('/api/delivery/config',async(req,res,next)=>{try{await identity(req);const rule=await activeRule(),routing=deliveryRoutingPublicConfig();res.json({enabled:Boolean(rule),pricing_rule_version:rule?.version||null,routing_provider:routing.provider,routing_requested_provider:routing.requested_provider,routing_configured:routing.configured,routing_reason:routing.reason,live_map_provider:'OpenStreetMap/Leaflet preview'})}catch(e){next(e)}})
app.post('/api/delivery/quote',body,async(req,res,next)=>{try{
  const me=await requireCustomer(req),businessId=Number(req.body?.business_id),lat=Number(req.body?.dropoff_lat),lng=Number(req.body?.dropoff_lng);
  if(!finite(lat)||!finite(lng)||lat<-90||lat>90||lng<-180||lng>180)return res.status(400).json({error:'Valid delivery coordinates are required'});
  const store=await pool.query(`SELECT business_id,pickup_lat,pickup_lng,delivery_enabled FROM merchant_storefronts WHERE business_id=$1 AND publication_status='published'`,[businessId]);
  if(!store.rowCount||!store.rows[0].delivery_enabled)return res.status(409).json({error:'Delivery is not enabled for this merchant'});
  const pickup=store.rows[0];
  if(!finite(pickup.pickup_lat)||!finite(pickup.pickup_lng))return res.status(409).json({error:'Merchant pickup location is not configured yet'});
  const bundle=await activePricingBundle();
  if(!bundle)return res.status(409).json({error:'Delivery pricing is not configured by Admin yet'});
  const {rule,vehicleRules}=bundle;

  const raw=Array.isArray(req.body?.items)?req.body.items:[];
  let weight=0,volume=0;
  if(raw.length){
    const ids=[...new Set(raw.map(x=>Number(x.product_id)).filter(Number.isInteger))];
    const p=await pool.query(`SELECT id,estimated_weight_kg,estimated_volume_l FROM marketplace_products WHERE business_id=$1 AND id=ANY($2::bigint[]) AND published=TRUE`,[businessId,ids]);
    const map=new Map(p.rows.map(x=>[Number(x.id),x]));
    for(const x of raw){
      const item=map.get(Number(x.product_id)),q=Number(x.quantity);
      if(item&&q>0){
        weight+=Number(item.estimated_weight_kg||0)*q;
        volume+=Number(item.estimated_volume_l||0)*q;
      }
    }
  }

  const origin={lat:Number(pickup.pickup_lat),lng:Number(pickup.pickup_lng)};
  const destination={lat,lng};
  const straight=haversine(origin.lat,origin.lng,destination.lat,destination.lng);
  const fallbackDistance=straight*Number(rule.route_factor||1);
  const routeChoice=clean(req.body?.route_choice||'avoid_tolls',40);
  let distance=fallbackDistance,routeCalls=0,routeEvidence={
    provider:'fallback',provider_route_source:'haversine_route_factor',source:'straight_line_estimate',
    provider_status:'legacy_fallback',distance_km:Math.round(fallbackDistance*10000)/10000,eta_minutes:null,
    route_profile:'legacy_straight_line',route_choice:'avoid_tolls',travel_mode:'DRIVE',
    avoid_tolls:false,avoid_highways:false,fallback_used:true,restriction_status:'not_verified',
    toll_status:'unknown',toll_amount:null,toll_currency:'',provider_warning:''
  };

  let quoteCalc,quoteTotal,vehiclePricingRuleId=null,requiredVehicleClass='',formulaType='',pricingSnapshot={};
  if(vehicleRules.length){
    const findRule=calc=>vehicleRules.find(x=>{
      try{return canonicalDeliveryVehicleClass(x.vehicle_class)===calc.vehicle_class}catch{return false}
    })||null;
    let shipment={distanceKm:fallbackDistance,weightKg:weight,volumeL:volume,minimumVehicleClass:req.body?.minimum_vehicle_class||null};
    let initial=selectDeliveryVehicleQuote(vehicleRules,shipment);
    let selected=findRule(initial);
    routeEvidence=await resolveDeliveryRoute({
      origin,destination,routeFactor:rule.route_factor,vehicleClass:initial.vehicle_class,
      routeProfile:initial.rule.route_profile,routeChoice
    });
    if(routeEvidence.provider_attempted)routeCalls++;
    distance=Number(routeEvidence.distance_km);
    shipment={...shipment,distanceKm:distance};
    quoteCalc=selectDeliveryVehicleQuote(vehicleRules,shipment);
    selected=findRule(quoteCalc);

    if(
      routeEvidence.provider==='google_routes'&&selected&&
      canonicalDeliveryVehicleClass(selected.vehicle_class)!==initial.vehicle_class&&
      String(selected.route_profile||'')!==String(routeEvidence.route_profile||'')
    ){
      const secondRoute=await resolveDeliveryRoute({
        origin,destination,routeFactor:rule.route_factor,vehicleClass:quoteCalc.vehicle_class,
        routeProfile:quoteCalc.rule.route_profile,routeChoice
      });
      if(secondRoute.provider==='google_routes')routeCalls++;
      routeEvidence=secondRoute;
      distance=Number(routeEvidence.distance_km);
      shipment={...shipment,distanceKm:distance};
      quoteCalc=selectDeliveryVehicleQuote(vehicleRules,shipment);
      selected=findRule(quoteCalc);
    }

    if(rule.maximum_distance_km!=null&&distance>Number(rule.maximum_distance_km)){
      return res.status(409).json({error:'Delivery destination is outside the configured service distance'});
    }
    vehiclePricingRuleId=selected?.id||null;
    requiredVehicleClass=quoteCalc.vehicle_class;
    formulaType=quoteCalc.formula_type;
    const verifiedToll=routeEvidence.toll_status==='estimated'&&routeEvidence.toll_currency==='PHP'
      ?Number(routeEvidence.toll_amount||0):0;
    quoteTotal=calculateDeliveryQuoteTotal(quoteCalc.rule,shipment,{toll_amount:verifiedToll});
    const selectedRouteProfile=quoteCalc.rule.route_profile;
    routeEvidence={
      ...routeEvidence,
      provider_call_count:routeCalls,
      pricing_vehicle_class:requiredVehicleClass,
      pricing_route_profile:selectedRouteProfile,
      profile_recalculation_limited:routeCalls>=2&&selectedRouteProfile!==routeEvidence.route_profile
    };
    pricingSnapshot={
      pricing_rule_version:Number(rule.version),
      vehicle_pricing_rule_id:vehiclePricingRuleId,
      vehicle_class:requiredVehicleClass,
      formula_type:formulaType,
      base_fee:quoteCalc.rule.base_fee,
      included_distance_km:quoteCalc.rule.included_distance_km,
      distance_bands:quoteCalc.rule.distance_bands,
      per_km:quoteCalc.rule.per_km,
      per_kg:quoteCalc.rule.per_kg,
      per_liter:quoteCalc.rule.per_liter,
      minimum_fee:quoteCalc.rule.minimum_fee,
      maximum_distance_km:quoteCalc.rule.maximum_distance_km,
      max_weight_kg:quoteCalc.rule.max_weight_kg,
      max_volume_l:quoteCalc.rule.max_volume_l,
      extra_stop_fee:quoteCalc.rule.extra_stop_fee,
      free_wait_minutes:quoteCalc.rule.free_wait_minutes,
      waiting_fee_per_minute:quoteCalc.rule.waiting_fee_per_minute,
      demand_adjustment_cap_pct:quoteCalc.rule.demand_adjustment_cap_pct,
      route_profile:selectedRouteProfile,
      expressway_eligible:quoteCalc.rule.expressway_eligible,
      toll_policy:quoteCalc.rule.toll_policy,
      parking_policy:quoteCalc.rule.parking_policy,
      stacking_policy:quoteCalc.rule.stacking_policy,
      route_source:routeEvidence.source,
      route_factor:Number(rule.route_factor||1),
      route_evidence:routeEvidence,
      service_fare:quoteTotal.service_fare,
      platform_fee_basis_amount:quoteTotal.platform_fee_basis_amount,
      pass_through_amount:quoteTotal.pass_through_amount,
      customer_delivery_total:quoteTotal.customer_delivery_total,
      distance_component:quoteCalc.distance_component,
      distance_band_components:quoteCalc.distance_band_components,
      weight_component:quoteCalc.weight_component,
      volume_component:quoteCalc.volume_component
    };
  }else{
    distance=fallbackDistance;
    if(rule.maximum_distance_km!=null&&distance>Number(rule.maximum_distance_km))return res.status(409).json({error:'Delivery destination is outside the configured service distance'});
    quoteCalc=legacyDeliveryPrice(rule,{distanceKm:distance,weightKg:weight,volumeL:volume});
    quoteTotal={
      service_fare:quoteCalc.delivery_price,
      platform_fee_basis_amount:quoteCalc.delivery_price,
      pass_through_amount:0,
      customer_delivery_total:quoteCalc.delivery_price,
      extra_stop_amount:0,waiting_amount:0,special_handling_amount:0,
      demand_adjustment_amount:0,promotion_discount:0,toll_amount:0,parking_amount:0,
      route_policy:{route_profile:'legacy_straight_line',expressway_eligible:true,toll_policy:'pass_through',parking_policy:'pass_through',stacking_policy:'direct_only'}
    };
    pricingSnapshot={
      pricing_rule_version:Number(rule.version),formula_type:'legacy_generic',
      route_source:routeEvidence.source,route_factor:Number(rule.route_factor||1),route_evidence:routeEvidence,
      service_fare:quoteCalc.delivery_price,platform_fee_basis_amount:quoteCalc.delivery_price,
      pass_through_amount:0,customer_delivery_total:quoteCalc.delivery_price
    };
  }

  const priceBreakdown={
    service_fare:quoteTotal.service_fare,
    base:quoteCalc.base_component||Number(rule.base_fee||0),
    distance:quoteCalc.distance_component||Math.round(distance*Number(rule.per_km||0)*100)/100,
    weight:quoteCalc.weight_component||0,
    volume:quoteCalc.volume_component||0,
    extra_stops:quoteTotal.extra_stop_amount||0,
    waiting:quoteTotal.waiting_amount||0,
    special_handling:quoteTotal.special_handling_amount||0,
    demand_adjustment:quoteTotal.demand_adjustment_amount||0,
    promotion_discount:quoteTotal.promotion_discount||0,
    toll:routeEvidence.toll_status==='unknown'?null:(quoteTotal.toll_amount||0),
    toll_status:routeEvidence.toll_status||'unknown',
    toll_estimate_included:routeEvidence.toll_status==='estimated',
    parking:quoteTotal.parking_amount||0,
    pass_through:quoteTotal.pass_through_amount||0,
    platform_fee_basis:quoteTotal.platform_fee_basis_amount,
    total:quoteTotal.customer_delivery_total
  };
  const routeSource=routeEvidence.source;
  const routeProfile=routeEvidence.route_profile||quoteTotal.route_policy?.route_profile||pricingSnapshot.route_profile||'legacy_straight_line';

  const {rows}=await pool.query(`
    INSERT INTO delivery_quotes(
      customer_account_id,business_id,pricing_rule_id,pricing_rule_version,vehicle_pricing_rule_id,
      pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,route_distance_km,
      estimated_weight_kg,estimated_volume_l,required_vehicle_class,formula_type,pricing_snapshot,
      fee,service_fare,platform_fee_basis_amount,pass_through_amount,price_breakdown,route_source,route_profile,
      route_eta_minutes,route_evidence,currency_code,status,expires_at
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18,$19,$20::jsonb,$21,$22,$23,$24::jsonb,'PHP','quoted',NOW()+INTERVAL '15 minutes')
    RETURNING *
  `,[
    me.account.id,businessId,rule.id,rule.version,vehiclePricingRuleId,
    pickup.pickup_lat,pickup.pickup_lng,lat,lng,distance,weight,volume,
    requiredVehicleClass,formulaType,JSON.stringify(pricingSnapshot),quoteTotal.customer_delivery_total,
    quoteTotal.service_fare,quoteTotal.platform_fee_basis_amount,quoteTotal.pass_through_amount,
    JSON.stringify(priceBreakdown),routeSource,routeProfile,routeEvidence.eta_minutes||null,JSON.stringify(routeEvidence)
  ]);
  res.status(201).json({...rows[0],price_breakdown:priceBreakdown,route:routeEvidence});
}catch(e){next(e)}})
app.post('/api/marketplace/checkout',body,async(req,res,next)=>{try{
  const createOrder=()=>createEmbeddedMarketplaceOrder({authorization:authHeader(req),body:req.body??{}});
  if(req.body?.fulfilment_method!=='delivery')return res.status(201).json(await createOrder());
  const me=await requireCustomer(req),businessId=Number(req.body?.business_id);
  if(!Number.isInteger(businessId)||businessId<1)return res.status(400).json({error:'Valid Merchant is required for delivery checkout.'});
  const storeCapability=await pool.query(`SELECT delivery_enabled FROM merchant_storefronts WHERE business_id=$1`,[businessId]);
  if(storeCapability.rowCount&&storeCapability.rows[0].delivery_enabled===false)return res.status(409).json({error:'Delivery is not enabled for this Merchant.'});
  const quoteId=Number(req.body?.delivery_quote_id);
  if(!Number.isInteger(quoteId)||quoteId<1)return res.status(409).json({error:'Delivery quote is missing or expired. Get a new quote.'});
  const q=await pool.query(`SELECT * FROM delivery_quotes WHERE id=$1 AND customer_account_id=$2 AND business_id=$3 AND status='quoted' AND expires_at>NOW() FOR UPDATE`,[quoteId,me.account.id,businessId]);
  if(!q.rowCount)return res.status(409).json({error:'Delivery quote is missing or expired. Get a new quote.'});
  if(req.body?.payment_method!=='online')return res.status(409).json({error:'Cash delivery is not enabled. Use online/digital payment.'});
  const quote=q.rows[0],order=await createOrder();
  const store=await pool.query(`SELECT pickup_address FROM merchant_storefronts WHERE business_id=$1`,[quote.business_id]);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query(`UPDATE delivery_quotes SET status='used' WHERE id=$1`,[quote.id]);
    await client.query(`UPDATE orders SET delivery_fee=$1,total=subtotal+$1,outstanding_amount=(subtotal+$1)-paid_amount,updated_at=NOW() WHERE id=$2`,[quote.fee,order.id]);
    const serviceFare=Number(quote.service_fare||quote.fee||0),feeBasis=Number(quote.platform_fee_basis_amount||serviceFare),passThrough=Number(quote.pass_through_amount||0);
    const d=await client.query(`INSERT INTO deliveries(order_id,quote_id,business_id,customer_account_id,status,delivery_fee,service_fare,platform_fee_basis_amount,pass_through_amount,price_breakdown,route_source,route_profile,route_eta_minutes,route_evidence,currency_code,route_distance_km,estimated_weight_kg,estimated_volume_l,required_vehicle_class,pickup_address,pickup_lat,pickup_lng,dropoff_address,dropoff_lat,dropoff_lng) VALUES($1,$2,$3,$4,'quoted',$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13::jsonb,'PHP',$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING id`,[order.id,quote.id,quote.business_id,me.account.id,quote.fee,serviceFare,feeBasis,passThrough,JSON.stringify(quote.price_breakdown||{}),quote.route_source||'straight_line_estimate',quote.route_profile||'',quote.route_eta_minutes||null,JSON.stringify(quote.route_evidence||{}),quote.route_distance_km,quote.estimated_weight_kg,quote.estimated_volume_l,quote.required_vehicle_class||'',store.rows[0]?.pickup_address||'',quote.pickup_lat,quote.pickup_lng,clean(req.body?.delivery_address||me.account.address,500),quote.dropoff_lat,quote.dropoff_lng]);
    await client.query('COMMIT');
    const updated=await readOrderDetail(pool,order.id);
    if(!updated)throw Object.assign(new Error('Order detail unavailable after Delivery checkout'),{status:500});
    res.status(201).json({...updated,delivery_id:d.rows[0].id});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
}catch(e){next(e)}})

app.put('/api/delivery/store-location',body,async(req,res,next)=>{try{const{me,business:b}=await requireMerchant(req,Number(req.body?.business_id||undefined)),lat=Number(req.body?.lat),lng=Number(req.body?.lng);if(!finite(lat)||!finite(lng)||lat<-90||lat>90||lng<-180||lng>180)return res.status(400).json({error:'Valid coordinates required'});await enforceHighRiskVelocity(pool,{actorAccountId:me.account.id,actionCode:'store_location_change',subjectType:'merchant_storefront',subjectId:b.id});await pool.query(`UPDATE merchant_storefronts SET pickup_lat=$1,pickup_lng=$2,updated_at=NOW() WHERE business_id=$3`,[lat,lng,b.id]);res.json({ok:true,pickup_lat:lat,pickup_lng:lng})}catch(e){next(e)}})
app.get('/api/delivery/merchant',async(req,res,next)=>{try{const{business:b}=await requireMerchant(req,Number(req.query.business_id||undefined));const{rows}=await pool.query(`SELECT d.*,o.order_number,o.order_status,o.payment_status,cp.display_name courier_name,cp.vehicle_type FROM deliveries d JOIN orders o ON o.id=d.order_id LEFT JOIN courier_profiles cp ON cp.account_id=d.courier_account_id WHERE d.business_id=$1 ORDER BY d.created_at DESC LIMIT 200`,[b.id]);res.json(rows.map(d=>deliveryPrivacyView(d,'merchant')))}catch(e){next(e)}})
app.post('/api/delivery/:id/request-courier',body,async(req,res,next)=>{
  const client=await pool.connect();
  try{
    const id=Number(req.params.id),initial=await deliveryDetail(id);
    if(!initial)return res.status(404).json({error:'Delivery not found'});
    const{me}=await requireMerchant(req,initial.business_id);
    await client.query('BEGIN');
    const locked=await client.query(`
      SELECT d.*,o.order_status,o.payment_status
        FROM deliveries d
        JOIN orders o ON o.id=d.order_id
       WHERE d.id=$1
       FOR UPDATE OF d
    `,[id]);
    if(!locked.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Delivery not found'})}
    const d=locked.rows[0];
    if(d.order_status!=='ready'){await client.query('ROLLBACK');return res.status(409).json({error:'Order must be ready before courier dispatch'})}
    if(d.payment_status!=='paid'){await client.query('ROLLBACK');return res.status(409).json({error:'Delivery order must be paid before dispatch'})}
    if(!['quoted','requested','awaiting_courier'].includes(d.status)){await client.query('ROLLBACK');return res.status(409).json({error:'Delivery is already assigned or active'})}
    const round=await createOfferRound(client,d,{actorAccountId:me.account.id});
    await client.query('COMMIT');
    const out=deliveryPrivacyView(await deliveryDetail(id),'merchant');
    res.json({...out,dispatch_round:round.round,dispatch_offer_count:round.offerIds.length,dispatch_state:round.offerIds.length?'offers_sent':'waiting_for_available_courier'});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});next(e)}
  finally{client.release()}
})

app.get('/api/courier/home',async(req,res,next)=>{try{const me=await requireCourier(req);res.json(await courierHomeSnapshot(me.account.id,me.courier))}catch(e){next(e)}})
app.get('/api/courier/delivery-profile',async(req,res,next)=>{try{
  const me=await requireCourier(req);
  const [p,docs,deliveries,offers]=await Promise.all([
    pool.query(`SELECT * FROM courier_profiles WHERE account_id=$1`,[me.account.id]),
    pool.query(`SELECT id,document_type,vehicle_class,reference_number,issue_date,expiry_date,verification_status,rejection_reason,created_at FROM courier_documents WHERE account_id=$1 ORDER BY created_at DESC`,[me.account.id]),
    pool.query(`SELECT d.*,o.order_number,b.name business_name FROM deliveries d JOIN orders o ON o.id=d.order_id JOIN businesses b ON b.id=d.business_id WHERE d.courier_account_id=$1 ORDER BY d.created_at DESC LIMIT 100`,[me.account.id]),
    pendingCourierOffers(pool,me.account.id,{limit:20})
  ]);
  res.json({profile:p.rows[0]||null,documents:docs.rows,deliveries:deliveries.rows.map(d=>deliveryPrivacyView(d,'courier')),offers})
}catch(e){next(e)}})
app.put('/api/courier/operating-area',body,async(req,res,next)=>{try{
  const me=await requireCourier(req);
  const psgcCode=clean(req.body?.psgc_code,20);
  if(!psgcCode)return res.status(400).json({error:'Choose an official operating barangay'});
  const area=await geographyAvailabilityForCode(pool,psgcCode);
  if(!area)return res.status(400).json({error:'Choose an official Philippine barangay from the PSGC list'});
  const q=await pool.query(`
    UPDATE courier_profiles
       SET operating_psgc_code=$1,
           operating_area_name=$2,
           operating_area_path=$3,
           operating_area_source_version=$4,
           updated_at=NOW()
     WHERE account_id=$5
     RETURNING operating_psgc_code,operating_area_name,operating_area_path,operating_area_source_version,service_radius_km
  `,[area.psgc_code,area.name,area.path_text||'',area.source_version||'',me.account.id]);
  if(!q.rowCount)return res.status(404).json({error:'Courier profile missing'});
  res.set('Cache-Control','private, no-store, max-age=0');
  res.json({
    ok:true,
    operating_area:q.rows[0],
    territory_status:area.exact_territory?.status||area.nearest_opened_scope?.status||'not_opened',
    operational_onboarding_available:Boolean(area.operational_onboarding_available),
    authorization_boundary:'Preferred operating area does not grant Courier authority. Active profile authorization remains required for dispatch.'
  });
}catch(e){next(e)}})
app.post('/api/courier/documents',body,async(req,res,next)=>{
  let stored=null,me=null;
  try{
    me=await requireCourier(req);
    const documentType=clean(req.body?.document_type,80),fileName=clean(req.body?.file_name,220);
    if(!documentType||!req.body?.evidence_data_url||!fileName)return res.status(400).json({error:'Document type, filename and evidence are required'});
    await enforceHighRiskVelocity(pool,{actorAccountId:me.account.id,actionCode:'upload_private',subjectType:'courier_document',subjectId:me.account.id});
    stored=await storePrivateEvidence(pool,{
      dataUrl:req.body.evidence_data_url,fileName,
      allowedMimes:[...COURIER_DOCUMENT_MIMES],maxBytes:MAX_COURIER_DOCUMENT_BYTES,
      ownerAccountId:me.account.id,actorAccountId:me.account.id,
      sourceType:'courier_document',sourceId:`pending:${me.account.id}`,
      purpose:'courier_document_upload',classification:'courier_document',
      correlationId:correlation(req)
    });
    const{rows}=await pool.query(`
      INSERT INTO courier_documents(
        account_id,document_type,vehicle_class,reference_number,issue_date,expiry_date,
        evidence_data_url,private_evidence_object_id,verification_status
      ) VALUES($1,$2,$3,$4,$5,$6,NULL,$7,'submitted')
      RETURNING id,document_type,vehicle_class,reference_number,issue_date,expiry_date,verification_status,created_at
    `,[
      me.account.id,documentType,clean(req.body?.vehicle_class,40),clean(req.body?.reference_number,120),
      req.body?.issue_date||null,req.body?.expiry_date||null,stored.id
    ]);
    await bindPrivateEvidenceSource(pool,{
      objectId:stored.id,sourceType:'courier_document',sourceId:String(rows[0].id),
      actorAccountId:me.account.id,purpose:'courier_document_bind',correlationId:correlation(req)
    });
    res.status(201).json(rows[0]);
  }catch(e){
    if(stored?.id)await deletePrivateEvidence(pool,{objectId:stored.id,actorAccountId:me?.account?.id,purpose:'courier_document_rollback',correlationId:correlation(req)}).catch(()=>{});
    next(e);
  }
})
app.put('/api/courier/availability',body,async(req,res,next)=>{try{
  const me=await requireCourier(req),available=Boolean(req.body?.available);
  const p=await pool.query(`SELECT eligibility_status,eligibility_expires_at FROM courier_profiles WHERE account_id=$1`,[me.account.id]);
  if(!p.rowCount)return res.status(404).json({error:'Courier profile missing'});
  const row=p.rows[0],expired=row.eligibility_expires_at&&new Date(row.eligibility_expires_at)<new Date();
  if(available&&(row.eligibility_status!=='approved'||expired))return res.status(403).json({error:'Admin approval is required before becoming available'});
  if(available&&await courierHasActiveDelivery(pool,me.account.id))return res.status(409).json({error:'Finish the active delivery before becoming available for another offer'});
  await pool.query(`UPDATE courier_profiles SET available=$1,updated_at=NOW() WHERE account_id=$2`,[available,me.account.id]);
  const created=available?await offerWaitingDeliveriesToCourier(pool,me.account.id,{limit:5}):[];
  res.json({ok:true,available,new_offer_count:created.length,new_offer_delivery_ids:created.map(x=>x.delivery_id)});
}catch(e){next(e)}})
app.get('/api/courier/delivery-offers',async(req,res,next)=>{try{
  const me=await requireCourier(req);
  res.set('Cache-Control','private, no-store, max-age=0');
  res.json(await pendingCourierOffers(pool,me.account.id,{limit:req.query?.limit}));
}catch(e){next(e)}})

app.post('/api/courier/delivery-offers/:offerId/decline',body,async(req,res,next)=>{
  const client=await pool.connect();
  try{
    const me=await requireCourier(req),offerId=Number(req.params.offerId);
    await client.query('BEGIN');
    const q=await client.query(`
      SELECT dof.*,d.status delivery_status,d.dispatch_round
        FROM delivery_offers dof
        JOIN deliveries d ON d.id=dof.delivery_id
       WHERE dof.id=$1 AND dof.courier_account_id=$2
       FOR UPDATE OF dof,d
    `,[offerId,me.account.id]);
    if(!q.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Delivery offer not found'})}
    const offer=q.rows[0];
    if(offer.status!=='pending'){await client.query('ROLLBACK');return res.status(409).json({error:'This delivery offer is no longer pending'})}
    if(offer.delivery_status!=='awaiting_courier'||Number(offer.offer_round)!==Number(offer.dispatch_round)){
      await client.query(`UPDATE delivery_offers SET status='withdrawn',responded_at=NOW(),updated_at=NOW() WHERE id=$1`,[offerId]);
      await client.query('COMMIT');
      return res.status(409).json({error:'This delivery offer is no longer available'});
    }
    await client.query(`
      UPDATE delivery_offers
         SET status='declined',decline_reason=$1,responded_at=NOW(),updated_at=NOW()
       WHERE id=$2
    `,[clean(req.body?.reason,300),offerId]);
    await recordDispatchEvent(client,{
      deliveryId:offer.delivery_id,actorAccountId:me.account.id,courierAccountId:me.account.id,
      eventCode:'offer_declined',offerRound:offer.offer_round,detail:{reason:clean(req.body?.reason,300)}
    });
    await client.query('COMMIT');
    res.json({ok:true,offer_id:offerId,delivery_id:Number(offer.delivery_id),status:'declined'});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});next(e)}
  finally{client.release()}
})

app.post('/api/courier/delivery-offers/:offerId/accept',body,async(req,res,next)=>{
  const client=await pool.connect();
  try{
    const me=await requireCourier(req),offerId=Number(req.params.offerId);
    await client.query('BEGIN');
    const q=await client.query(`
      SELECT dof.*,d.*,b.territory_id
        FROM delivery_offers dof
        JOIN deliveries d ON d.id=dof.delivery_id
        JOIN businesses b ON b.id=d.business_id
       WHERE dof.id=$1 AND dof.courier_account_id=$2
       FOR UPDATE OF dof,d
    `,[offerId,me.account.id]);
    if(!q.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Delivery offer not found'})}
    const row=q.rows[0],deliveryId=Number(row.delivery_id);
    if(row.status!=='pending'){await client.query('ROLLBACK');return res.status(409).json({error:'This delivery offer is no longer pending'})}
    if(row.delivery_status&&row.delivery_status!=='awaiting_courier'){
      await client.query('ROLLBACK');return res.status(409).json({error:'This delivery has already been taken'});
    }
    if(row.status==='pending'&&String(row.status)!=='pending'){await client.query('ROLLBACK');return res.status(409).json({error:'This delivery offer is no longer pending'})}
    const delivery=await client.query('SELECT * FROM deliveries WHERE id=$1 FOR UPDATE',[deliveryId]);
    const d=delivery.rows[0];
    if(!d||d.status!=='awaiting_courier'||d.courier_account_id!=null||Number(row.offer_round)!==Number(d.dispatch_round)){
      await client.query(`UPDATE delivery_offers SET status='withdrawn',responded_at=NOW(),updated_at=NOW() WHERE id=$1`,[offerId]);
      await client.query('COMMIT');
      return res.status(409).json({error:'This delivery has already been taken or re-offered'});
    }
    const courierQ=await client.query('SELECT * FROM courier_profiles WHERE account_id=$1 FOR UPDATE',[me.account.id]);
    if(!courierQ.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Courier profile missing'})}
    const courier=courierQ.rows[0];
    const gate=await courierOfferGateFromDb(client,courier,d);
    if(!gate.allowed){await client.query('ROLLBACK');return res.status(409).json({error:'You are no longer eligible for this delivery',code:gate.reason})}
    await client.query(`
      UPDATE deliveries
         SET courier_account_id=$1,vehicle_class=$2,status='courier_assigned',
             assigned_at=NOW(),updated_at=NOW()
       WHERE id=$3
    `,[me.account.id,gate.approved_vehicle_class,deliveryId]);
    await client.query(`
      UPDATE delivery_offers
         SET status=CASE WHEN id=$1 THEN 'accepted' ELSE 'withdrawn' END,
             responded_at=NOW(),updated_at=NOW()
       WHERE delivery_id=$2 AND offer_round=$3 AND status='pending'
    `,[offerId,deliveryId,d.dispatch_round]);
    await client.query(`
      UPDATE delivery_offers
         SET status='withdrawn',responded_at=NOW(),updated_at=NOW()
       WHERE courier_account_id=$1 AND delivery_id<>$2 AND status='pending'
    `,[me.account.id,deliveryId]);
    await client.query('UPDATE courier_profiles SET available=FALSE,updated_at=NOW() WHERE account_id=$1',[me.account.id]);
    await recordDispatchEvent(client,{
      deliveryId,actorAccountId:me.account.id,courierAccountId:me.account.id,
      eventCode:'offer_accepted',offerRound:d.dispatch_round,detail:{offer_id:offerId}
    });
    await client.query('COMMIT');
    res.json({...deliveryPrivacyView(await deliveryDetail(deliveryId),'courier'),assignment_mode:'courier_accept'});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});next(e)}
  finally{client.release()}
})

app.post('/api/courier/deliveries/:id/status',body,async(req,res,next)=>{try{const me=await requireCourier(req),id=Number(req.params.id),nextStatus=clean(req.body?.status,60);const d=await deliveryDetail(id);if(!d||Number(d.courier_account_id)!==Number(me.account.id))return res.status(404).json({error:'Assigned delivery not found'});const flow={courier_assigned:['courier_en_route_to_merchant'],courier_en_route_to_merchant:['courier_arrived_at_merchant'],courier_arrived_at_merchant:['picked_up'],picked_up:['in_transit'],in_transit:['courier_arrived_at_customer']}[d.status]||[];if(!flow.includes(nextStatus))return res.status(409).json({error:`Cannot move delivery from ${d.status} to ${nextStatus}`});const stamp={courier_en_route_to_merchant:'en_route_to_merchant_at',courier_arrived_at_merchant:'arrived_merchant_at',picked_up:'picked_up_at',in_transit:'in_transit_at',courier_arrived_at_customer:'arrived_customer_at'}[nextStatus];const client=await pool.connect();try{await client.query('BEGIN');await client.query(`UPDATE deliveries SET status=$1,${stamp}=NOW(),updated_at=NOW() WHERE id=$2`,[nextStatus,id]);if(nextStatus==='picked_up'){await client.query(`UPDATE orders SET order_status='handoff_to_delivery',handoff_at=COALESCE(handoff_at,NOW()),updated_at=NOW() WHERE id=$1 AND order_status='ready'`,[d.order_id]);await client.query(`INSERT INTO order_status_events(order_id,from_status,to_status,actor_account_id,note) SELECT id,'ready','handoff_to_delivery',$1,'Courier picked up order' FROM orders WHERE id=$2`,[me.account.id,d.order_id])}await client.query('COMMIT');res.json(deliveryPrivacyView(await deliveryDetail(id),'courier'))}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}}catch(e){next(e)}})
app.post('/api/courier/deliveries/:id/location',body,async(req,res,next)=>{
  const client=await pool.connect();
  try{
    const me=await requireCourier(req),id=Number(req.params.id);
    const point=deliveryRoutePointDecision({next:{
      lat:req.body?.lat,lng:req.body?.lng,accuracy_m:req.body?.accuracy_m,
      heading_deg:req.body?.heading_deg,speed_mps:req.body?.speed_mps
    }}).point;
    await enforceHighRiskVelocity(pool,{actorAccountId:me.account.id,actionCode:'courier_location_update',subjectType:'delivery',subjectId:id});
    await client.query('BEGIN');
    const locked=await client.query(
      `SELECT id,status,courier_account_id
         FROM deliveries
        WHERE id=$1
        FOR UPDATE`,
      [id]
    );
    if(!locked.rowCount||Number(locked.rows[0].courier_account_id)!==Number(me.account.id)){
      await client.query('ROLLBACK');
      return res.status(404).json({error:'Assigned delivery not found'});
    }
    const d=locked.rows[0];
    if(!deliveryRouteTrackingActive(d.status)){
      await client.query('ROLLBACK');
      return res.status(409).json({error:'Route tracking starts only after Start route and closes when the delivery ends'});
    }
    const last=await client.query(
      `SELECT sequence_no,latitude,longitude,recorded_at
         FROM delivery_location_points
        WHERE delivery_id=$1
        ORDER BY sequence_no DESC
        LIMIT 1`,
      [id]
    );
    const previous=last.rows[0]||null;
    const pointCount=previous?Number(previous.sequence_no):0;
    const decision=deliveryRoutePointDecision({previous,next:point,pointCount,nowMs:Date.now()});
    let sequenceNo=previous?Number(previous.sequence_no):0;
    if(decision.append){
      sequenceNo+=1;
      await client.query(
        `INSERT INTO delivery_location_points(
           delivery_id,courier_account_id,sequence_no,latitude,longitude,
           accuracy_m,heading_deg,speed_mps,delivery_status
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id,me.account.id,sequenceNo,point.latitude,point.longitude,
         point.accuracy_m,point.heading_deg,point.speed_mps,d.status]
      );
    }
    await client.query(
      `UPDATE deliveries
          SET last_lat=$1,last_lng=$2,last_location_at=NOW(),updated_at=NOW()
        WHERE id=$3`,
      [point.latitude,point.longitude,id]
    );
    await client.query('COMMIT');
    res.json({
      ok:true,
      at:new Date().toISOString(),
      route_point_stored:decision.append,
      route_point_reason:decision.reason,
      sequence_no:sequenceNo
    });
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    next(e);
  }finally{client.release()}
})

app.post('/api/courier/deliveries/:id/proof',body,async(req,res,next)=>{
  let stored=null,me=null;
  try{
    me=await requireCourier(req);
    const id=Number(req.params.id),proofType=clean(req.body?.proof_type,30),fileName=clean(req.body?.file_name,220);
    if(!['pickup','delivery'].includes(proofType))return res.status(400).json({error:'Choose pickup or delivery proof'});
    if(!fileName||!req.body?.evidence_data_url)return res.status(400).json({error:'Photo and filename are required'});
    const d=await deliveryDetail(id);
    if(!d||Number(d.courier_account_id)!==Number(me.account.id))return res.status(404).json({error:'Assigned delivery not found'});
    if(!deliveryProofAllowed(proofType,d.status))return res.status(409).json({error:proofType==='pickup'?'Pickup proof is available only at Merchant pickup':'Delivery proof is available only after arriving at the Customer'});
    const count=await pool.query('SELECT COUNT(*)::int count FROM delivery_proof_media WHERE delivery_id=$1 AND proof_type=$2',[id,proofType]);
    if(Number(count.rows[0]?.count||0)>=MAX_DELIVERY_PROOFS_PER_TYPE)return res.status(409).json({error:'Maximum proof photos reached for this delivery stage'});
    await enforceHighRiskVelocity(pool,{actorAccountId:me.account.id,actionCode:'upload_private',subjectType:'delivery_proof',subjectId:id});
    stored=await storePrivateEvidence(pool,{
      dataUrl:req.body.evidence_data_url,fileName,
      allowedMimes:[...DELIVERY_PROOF_MIMES],maxBytes:MAX_DELIVERY_PROOF_BYTES,
      ownerAccountId:me.account.id,actorAccountId:me.account.id,
      sourceType:'delivery_proof',sourceId:`pending:${id}`,
      purpose:`delivery_${proofType}_proof_upload`,classification:'delivery_proof',
      correlationId:correlation(req)
    });
    const{rows}=await pool.query(
      `INSERT INTO delivery_proof_media(
         delivery_id,courier_account_id,proof_type,private_evidence_object_id,
         courier_note,delivery_status
       ) VALUES($1,$2,$3,$4,$5,$6)
       RETURNING id,delivery_id,courier_account_id,proof_type,courier_note,delivery_status,created_at`,
      [id,me.account.id,proofType,stored.id,clean(req.body?.note,500),d.status]
    );
    await bindPrivateEvidenceSource(pool,{
      objectId:stored.id,sourceType:'delivery_proof',sourceId:String(rows[0].id),
      actorAccountId:me.account.id,purpose:'delivery_proof_bind',correlationId:correlation(req)
    });
    res.status(201).json(rows[0]);
  }catch(e){
    if(stored?.id)await deletePrivateEvidence(pool,{objectId:stored.id,actorAccountId:me?.account?.id,purpose:'delivery_proof_rollback',correlationId:correlation(req)}).catch(()=>{});
    next(e);
  }
})

app.post('/api/courier/deliveries/:id/complete',body,async(req,res,next)=>{
  const client=await pool.connect();
  try{
    const me=await requireCourier(req),id=Number(req.params.id);
    await client.query('BEGIN');
    const locked=await client.query(`
      SELECT d.*,o.order_status
      FROM deliveries d
      JOIN orders o ON o.id=d.order_id
      WHERE d.id=$1
      FOR UPDATE OF d
    `,[id]);
    if(!locked.rowCount||Number(locked.rows[0].courier_account_id)!==Number(me.account.id)){
      await client.query('ROLLBACK');
      return res.status(404).json({error:'Assigned delivery not found'});
    }
    const d=locked.rows[0];
    if(d.status!=='courier_arrived_at_customer'){
      await client.query('ROLLBACK');
      return res.status(409).json({error:'Courier must arrive at customer before completion'});
    }

    const now=Date.now();
    if(handoffLockActive(d.handoff_locked_until,now)){
      await client.query(`
        INSERT INTO delivery_security_events(
          delivery_id,actor_account_id,event_code,attempt_count,locked_until,detail_json
        ) VALUES($1,$2,'handoff_code_locked_attempt',$3,$4,$5::jsonb)
      `,[id,me.account.id,Number(d.handoff_failed_attempts||0),d.handoff_locked_until,JSON.stringify({status:d.status})]);
      await client.query('COMMIT');
      return res.status(429).json({
        error:'Too many incorrect handoff-code attempts. Try again later.',
        code:'HANDOFF_CODE_LOCKED',
        attempts_remaining:0,
        retry_at:new Date(d.handoff_locked_until).toISOString()
      });
    }

    if(clean(req.body?.completion_code,20)!==completionCode(id)){
      const state=nextHandoffFailureState({
        failedAttempts:d.handoff_failed_attempts,
        lockedUntil:d.handoff_locked_until,
        now
      });
      await client.query(`
        UPDATE deliveries
        SET handoff_failed_attempts=$1,
            handoff_locked_until=$2,
            handoff_last_failed_at=NOW(),
            updated_at=NOW()
        WHERE id=$3
      `,[state.failedAttempts,state.lockedUntil,id]);
      await client.query(`
        INSERT INTO delivery_security_events(
          delivery_id,actor_account_id,event_code,attempt_count,locked_until,detail_json
        ) VALUES($1,$2,$3,$4,$5,$6::jsonb)
      `,[
        id,me.account.id,
        state.locked?'handoff_code_lockout':'handoff_code_failed',
        state.failedAttempts,state.lockedUntil,
        JSON.stringify({status:d.status,attempts_remaining:state.attemptsRemaining})
      ]);
      await client.query('COMMIT');
      return res.status(state.locked?429:403).json({
        error:state.locked
          ?'Too many incorrect handoff-code attempts. Try again later.'
          :'Customer delivery code is incorrect',
        code:state.locked?'HANDOFF_CODE_LOCKED':'HANDOFF_CODE_INCORRECT',
        attempts_remaining:state.attemptsRemaining,
        retry_at:state.lockedUntil
      });
    }

    await client.query(`
      UPDATE deliveries
      SET status='delivered',
          delivered_at=NOW(),
          last_lat=NULL,last_lng=NULL,last_location_at=NULL,
          handoff_failed_attempts=0,
          handoff_locked_until=NULL,
          handoff_last_failed_at=NULL,
          updated_at=NOW()
      WHERE id=$1
    `,[id]);
    await client.query(`
      INSERT INTO delivery_security_events(
        delivery_id,actor_account_id,event_code,attempt_count,detail_json
      ) VALUES($1,$2,'handoff_code_verified',$3,$4::jsonb)
    `,[id,me.account.id,Number(d.handoff_failed_attempts||0),JSON.stringify({status:d.status})]);
    await client.query(`
      UPDATE orders
      SET order_status='completed',completed_at=COALESCE(completed_at,NOW()),updated_at=NOW()
      WHERE id=$1
    `,[d.order_id]);
    await client.query(`
      INSERT INTO order_status_events(order_id,from_status,to_status,actor_account_id,note)
      VALUES($1,$2,'completed',$3,'Delivery completed with customer code')
    `,[d.order_id,d.order_status,me.account.id]);
    const done=await client.query(`
      SELECT d.delivered_at,d.delivery_fee,d.service_fare,d.platform_fee_basis_amount,
             d.pass_through_amount,d.currency_code,d.courier_account_id,
             o.completed_at,o.subtotal,o.business_id,b.territory_id
      FROM deliveries d
      JOIN orders o ON o.id=d.order_id
      JOIN businesses b ON b.id=d.business_id
      WHERE d.id=$1
    `,[id]);
    const x=done.rows[0],deliveryFeeBasis=Number(x.platform_fee_basis_amount||x.service_fare||x.delivery_fee||0);
    await recordMonetizableCompletion(client,{serviceScope:'marketplace',subjectType:'business',subjectId:x.business_id,
      sourceType:'order',sourceId:d.order_id,territoryId:x.territory_id,
      completedAt:x.completed_at,grossValue:x.subtotal,currencyCode:x.currency_code||'PHP'
    });
    const deliveryMonetization=await recordMonetizableCompletion(client,{serviceScope:'delivery',subjectType:'account',subjectId:x.courier_account_id,
      sourceType:'delivery',sourceId:id,territoryId:x.territory_id,
      completedAt:x.delivered_at,grossValue:deliveryFeeBasis,currencyCode:x.currency_code||'PHP'
    });
    const courierCompensation=await allocateCourierCompensation(client,{
      deliveryId:id,
      orderId:d.order_id,
      courierAccountId:x.courier_account_id,
      territoryId:x.territory_id,
      deliveryPrice:Number(x.delivery_fee||0),
      feeBasis:deliveryFeeBasis,
      passThrough:Number(x.pass_through_amount||0),
      currencyCode:x.currency_code||'PHP',
      completedAt:x.delivered_at,
      phase:deliveryMonetization.phase
    });
    if(courierCompensation.status==='HOLD'){
      console.warn('Courier compensation HOLD',courierCompensation.reason,'delivery',id);
    }
    await client.query('COMMIT');
    res.json(deliveryPrivacyView(await deliveryDetail(id),'courier'));
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    next(e);
  }finally{
    client.release();
  }
})

app.get('/api/delivery/mine',async(req,res,next)=>{try{
  const me=await requireCustomer(req);
  if(String(req.query.view||'')==='home'){
    const{rows}=await pool.query(`SELECT d.id,d.order_id,d.status,d.updated_at,d.created_at,o.order_number,b.name business_name FROM deliveries d JOIN orders o ON o.id=d.order_id JOIN businesses b ON b.id=d.business_id WHERE d.customer_account_id=$1 AND d.status NOT IN ('delivered','failed','cancelled') ORDER BY d.updated_at DESC LIMIT 12`,[me.account.id]);
    return res.json(rows);
  }
  const{rows}=await pool.query(`SELECT d.*,o.order_number,b.name business_name,cp.display_name courier_name,cp.vehicle_type FROM deliveries d JOIN orders o ON o.id=d.order_id JOIN businesses b ON b.id=d.business_id LEFT JOIN courier_profiles cp ON cp.account_id=d.courier_account_id WHERE d.customer_account_id=$1 ORDER BY d.created_at DESC LIMIT 100`,[me.account.id]);
  res.json(rows.map(d=>({...d,completion_code:activeTracking(d.status)?completionCode(d.id):null,last_lat:activeTracking(d.status)?d.last_lat:null,last_lng:activeTracking(d.status)?d.last_lng:null})))
}catch(e){next(e)}})
app.get('/api/delivery/:id/route',async(req,res,next)=>{try{
  const id=Number(req.params.id),d=await deliveryDetail(id);
  if(!d)return res.status(404).json({error:'Delivery not found'});
  await allowedDelivery(req,d);
  if(!deliveryRouteTrackingActive(d.status))return res.json({delivery_id:id,active:false,closed:!activeTracking(d.status),points:[]});
  const points=await deliveryRoutePoints(id,{afterSequence:req.query?.after_sequence,limit:req.query?.limit});
  res.set('Cache-Control','private, no-store, max-age=0');
  res.json({delivery_id:id,active:true,closed:false,points});
}catch(e){next(e)}})

app.get('/api/delivery/:id/proofs',async(req,res,next)=>{try{
  const id=Number(req.params.id),d=await deliveryDetail(id);
  if(!d)return res.status(404).json({error:'Delivery not found'});
  await allowedDelivery(req,d);
  res.set('Cache-Control','private, no-store, max-age=0');
  res.json(await deliveryProofRows(id));
}catch(e){next(e)}})

app.get('/api/delivery/:id/proofs/:proofId/file',async(req,res,next)=>{try{
  const id=Number(req.params.id),proofId=Number(req.params.proofId),d=await deliveryDetail(id);
  if(!d)return res.status(404).json({error:'Delivery not found'});
  const me=await allowedDelivery(req,d);
  const q=await pool.query('SELECT private_evidence_object_id FROM delivery_proof_media WHERE id=$1 AND delivery_id=$2',[proofId,id]);
  if(!q.rowCount)return res.status(404).json({error:'Delivery proof not found'});
  const evidence=await readPrivateEvidence(pool,{
    objectId:q.rows[0].private_evidence_object_id,actorAccountId:me.account.id,
    purpose:'delivery_proof_participant_read',correlationId:correlation(req)
  });
  return sendPrivateEvidence(res,evidence);
}catch(e){next(e)}})

app.get('/api/delivery/:id/live',async(req,res,next)=>{try{const d=await deliveryDetail(Number(req.params.id));if(!d)return res.status(404).json({error:'Delivery not found'});const me=await allowedDelivery(req,d),rule=await activeRule(),audience=deliveryAudience(me,d),view=deliveryPrivacyView(d,audience);const customer=audience==='customer';res.json({...view,completion_code:customer&&activeTracking(d.status)?completionCode(d.id):undefined,eta_minutes:etaMinutes(d,rule),distance_to_dropoff_km:activeTracking(d.status)&&d.last_lat&&d.last_lng?Math.round(haversine(Number(d.last_lat),Number(d.last_lng),Number(d.dropoff_lat),Number(d.dropoff_lng))*100)/100:null})}catch(e){next(e)}})

app.get('/api/admin/delivery/pricing',async(req,res,next)=>{try{
  const me=await requireAdmin(req,'delivery.pricing.manage');
  if(me.admin_assertion.territoryId!=null)return res.status(403).json({error:'Delivery pricing is country-scoped'});
  const {rows}=await pool.query(`
    SELECT r.*,
      COALESCE((
        SELECT jsonb_agg(v ORDER BY v.priority,v.vehicle_class)
        FROM delivery_vehicle_pricing_rules v
        WHERE v.pricing_rule_id=r.id
      ),'[]'::jsonb) vehicle_rules
    FROM delivery_pricing_rules r
    WHERE r.country_code='PH'
    ORDER BY r.version DESC
  `);
  res.json(rows);
}catch(e){next(e)}})

app.put('/api/admin/delivery/pricing',body,async(req,res,next)=>{try{
  const me=await requireAdmin(req,'delivery.pricing.manage');
  if(me.admin_assertion.territoryId!=null)return res.status(403).json({error:'Delivery pricing is country-scoped'});
  const routeFactor=Number(req.body?.route_factor);
  if(!Number.isFinite(routeFactor)||routeFactor<1)return res.status(400).json({error:'route_factor must be at least 1'});
  const rawVehicleRules=Array.isArray(req.body?.vehicle_rules)?req.body.vehicle_rules:null;

  let normalizedVehicleRules=[];
  if(rawVehicleRules){
    try{normalizedVehicleRules=rawVehicleRules.map(normalizeVehiclePricingRule)}
    catch(e){return res.status(e.status||400).json({error:e.message})}
    if(!normalizedVehicleRules.length)return res.status(400).json({error:'V2 pricing requires at least one vehicle rule'});
    const classes=new Set(normalizedVehicleRules.map(x=>x.vehicle_class));
    if(classes.size!==normalizedVehicleRules.length)return res.status(400).json({error:'Each canonical V2 vehicle class may appear only once'});
  }else{
    for(const k of ['base_fee','per_km','per_kg','per_liter','minimum_fee'])if(!finite(req.body?.[k])||Number(req.body[k])<0)return res.status(400).json({error:`${k} must be zero or greater`});
  }

  const v=await pool.query(`SELECT COALESCE(MAX(version),0)+1 version FROM delivery_pricing_rules WHERE country_code='PH'`);
  const version=Number(v.rows[0].version);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    if(req.body?.active!==false)await client.query(`UPDATE delivery_pricing_rules SET active=FALSE WHERE country_code='PH'`);
    const parent=await client.query(`
      INSERT INTO delivery_pricing_rules(
        country_code,version,active,base_fee,per_km,per_kg,per_liter,minimum_fee,
        maximum_distance_km,route_factor,
        average_speed_bicycle_kmh,average_speed_motorbike_kmh,average_speed_car_kmh,
        created_by_account_id
      ) VALUES('PH',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *
    `,[
      version,req.body?.active!==false,
      rawVehicleRules?0:Number(req.body.base_fee),
      rawVehicleRules?0:Number(req.body.per_km),
      rawVehicleRules?0:Number(req.body.per_kg),
      rawVehicleRules?0:Number(req.body.per_liter),
      rawVehicleRules?0:Number(req.body.minimum_fee),
      req.body?.maximum_distance_km==null?null:Number(req.body.maximum_distance_km),
      routeFactor,
      req.body?.average_speed_bicycle_kmh||null,
      req.body?.average_speed_motorbike_kmh||null,
      req.body?.average_speed_car_kmh||null,
      me.account.id
    ]);
    const pricingRule=parent.rows[0];

    const saved=[];
    for(const vr of normalizedVehicleRules){
      const q=await client.query(`
        INSERT INTO delivery_vehicle_pricing_rules(
          pricing_rule_id,vehicle_class,formula_type,priority,
          base_fee,per_km,per_kg,per_liter,minimum_fee,
          maximum_distance_km,max_weight_kg,max_volume_l,
          included_distance_km,distance_bands,extra_stop_fee,free_wait_minutes,waiting_fee_per_minute,
          demand_adjustment_cap_pct,route_profile,expressway_eligible,toll_policy,parking_policy,stacking_policy
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18,$19,$20,$21,$22,$23)
        RETURNING *
      `,[
        pricingRule.id,vr.vehicle_class,vr.formula_type,vr.priority,
        vr.base_fee,vr.per_km,vr.per_kg,vr.per_liter,vr.minimum_fee,
        vr.maximum_distance_km,vr.max_weight_kg,vr.max_volume_l,
        vr.included_distance_km,JSON.stringify(vr.distance_bands),vr.extra_stop_fee,vr.free_wait_minutes,vr.waiting_fee_per_minute,
        vr.demand_adjustment_cap_pct,vr.route_profile,vr.expressway_eligible,vr.toll_policy,vr.parking_policy,vr.stacking_policy
      ]);
      saved.push(q.rows[0]);
    }

    await client.query('COMMIT');
    res.json({...pricingRule,vehicle_rules:saved});
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    throw e;
  }finally{client.release()}
}catch(e){next(e)}})

app.post('/api/admin/delivery/pricing/preview',body,async(req,res,next)=>{try{
  const me=await requireAdmin(req,'delivery.pricing.manage');
  if(me.admin_assertion.territoryId!=null)return res.status(403).json({error:'Delivery pricing preview is country-scoped'});
  const rawRules=Array.isArray(req.body?.vehicle_rules)?req.body.vehicle_rules:[];
  if(!rawRules.length)return res.status(400).json({error:'Add at least one vehicle rule to preview'});
  let rules;
  try{rules=rawRules.map(normalizeVehiclePricingRule)}catch(e){return res.status(e.status||400).json({error:e.message})}
  const classes=new Set(rules.map(x=>x.vehicle_class));
  if(classes.size!==rules.length)return res.status(400).json({error:'Each canonical V2 vehicle class may appear only once'});
  const rawDistances=Array.isArray(req.body?.distances_km)&&req.body.distances_km.length?req.body.distances_km:[3,5,10,15,20,30,40];
  const distances=[...new Set(rawDistances.map(Number).filter(x=>Number.isFinite(x)&&x>=0&&x<=500))].sort((a,b)=>a-b).slice(0,30);
  if(!distances.length)return res.status(400).json({error:'Preview requires valid distances'});
  const weight=Number(req.body?.weight_kg||0),volume=Number(req.body?.volume_l||0);
  if(!Number.isFinite(weight)||weight<0||!Number.isFinite(volume)||volume<0)return res.status(400).json({error:'Preview weight and volume must be zero or greater'});
  const extras={
    extra_stops:Number(req.body?.extra_stops||0),
    waiting_minutes:Number(req.body?.waiting_minutes||0),
    toll_amount:Number(req.body?.toll_amount||0),
    parking_amount:Number(req.body?.parking_amount||0),
    special_handling_amount:Number(req.body?.special_handling_amount||0),
    demand_adjustment_pct:Number(req.body?.demand_adjustment_pct||0),
    promotion_discount:Number(req.body?.promotion_discount||0)
  };
  const rows=[];
  for(const rule of rules){
    for(const distance of distances){
      let quote=null,error=null;
      try{
        if(!deliveryVehicleRuleEligible(rule,{distanceKm:distance,weightKg:weight,volumeL:volume}))throw Object.assign(new Error('OUTSIDE_VEHICLE_LIMITS'),{code:'OUTSIDE_VEHICLE_LIMITS'});
        quote=calculateDeliveryQuoteTotal(rule,{distanceKm:distance,weightKg:weight,volumeL:volume},extras);
      }catch(e){error=e.code||e.message}
      if(!quote){rows.push({vehicle_class:rule.vehicle_class,distance_km:distance,eligible:false,error});continue}
      const promo=deliveryPriceSplit(quote.customer_delivery_total,{postPromo:false,excludedPassThrough:quote.pass_through_amount});
      const postPromo=deliveryPriceSplit(quote.customer_delivery_total,{postPromo:true,excludedPassThrough:quote.pass_through_amount});
      rows.push({
        vehicle_class:rule.vehicle_class,distance_km:distance,eligible:true,
        service_fare:quote.service_fare,extra_stop_amount:quote.extra_stop_amount,waiting_amount:quote.waiting_amount,
        demand_adjustment_amount:quote.demand_adjustment_amount,toll_amount:quote.toll_amount,parking_amount:quote.parking_amount,
        pass_through_amount:quote.pass_through_amount,platform_fee_basis_amount:quote.platform_fee_basis_amount,
        customer_delivery_total:quote.customer_delivery_total,
        promo:{business_life_fee:promo.business_life_delivery_fee,courier_gross_entitlement:promo.courier_gross_entitlement},
        post_promo:{business_life_fee:postPromo.business_life_delivery_fee,courier_gross_entitlement:postPromo.courier_gross_entitlement},
        route_policy:quote.route_policy
      });
    }
  }
  res.json({
    mode:'simulation_only',country_code:'PH',currency_code:'PHP',
    activation_changed:false,quote_created:false,
    assumptions:{weight_kg:weight,volume_l:volume,...extras},
    distances_km:distances,rows,
    note:'Preview only. No pricing rule or Customer quote was created or activated.'
  });
}catch(e){next(e)}})

app.get('/api/admin/couriers',async(req,res,next)=>{try{const me=await requireAdmin(req,'courier.verify'),territoryId=me.admin_assertion.territoryId;const values=[],scope=territoryId==null?'TRUE':`EXISTS(SELECT 1 FROM profile_authorizations pa WHERE pa.account_id=a.id AND pa.role='courier' AND pa.territory_id=$1 AND pa.status='active')`;if(territoryId!=null)values.push(territoryId);const{rows}=await pool.query(`SELECT a.id account_id,a.display_name,a.email,c.display_name courier_name,c.vehicle_type,c.max_weight_kg,c.max_volume_l,c.service_radius_km,c.operating_psgc_code,c.operating_area_name,c.operating_area_path,c.available,c.eligibility_status,c.approved_vehicle_class,c.eligibility_expires_at,c.approval_note,(SELECT COUNT(*) FROM courier_documents d WHERE d.account_id=a.id AND d.verification_status='submitted')::int submitted_documents FROM accounts a JOIN profiles p ON p.account_id=a.id AND p.role='courier' AND p.enabled=TRUE JOIN courier_profiles c ON c.account_id=a.id WHERE ${scope} ORDER BY c.eligibility_status='approved' DESC,a.display_name`,values);res.json(rows)}catch(e){next(e)}})
app.get('/api/admin/couriers/:accountId',async(req,res,next)=>{try{
  const me=await requireAdmin(req,'courier.verify'),id=Number(req.params.accountId),territoryId=me.admin_assertion.territoryId;
  if(!Number.isInteger(id)||id<=0)return res.status(400).json({error:'Valid Courier account required'});
  if(territoryId!=null){const scope=await pool.query(`SELECT 1 FROM profile_authorizations WHERE account_id=$1 AND role='courier' AND territory_id=$2 AND status='active'`,[id,territoryId]);if(!scope.rowCount)return res.status(403).json({error:'Courier is outside your delegated territory'})}
  const [courier,documents]=await Promise.all([
    pool.query(`SELECT a.id account_id,a.display_name,a.email,c.display_name courier_name,c.vehicle_type,c.max_weight_kg,c.max_volume_l,c.service_radius_km,c.operating_psgc_code,c.operating_area_name,c.operating_area_path,c.available,c.eligibility_status,c.approved_vehicle_class,c.eligibility_expires_at,c.approval_note FROM accounts a JOIN profiles p ON p.account_id=a.id AND p.role='courier' AND p.enabled=TRUE JOIN courier_profiles c ON c.account_id=a.id WHERE a.id=$1`,[id]),
    pool.query(`SELECT id,document_type,vehicle_class,reference_number,issue_date,expiry_date,verification_status,rejection_reason,created_at,updated_at FROM courier_documents WHERE account_id=$1 ORDER BY created_at DESC,id DESC`,[id])
  ]);
  if(!courier.rowCount)return res.status(404).json({error:'Courier not found'});
  res.json({courier:courier.rows[0],documents:documents.rows});
}catch(e){next(e)}})
app.get('/api/admin/couriers/:accountId/documents/:documentId',async(req,res,next)=>{try{
  const me=await requireAdmin(req,'courier.verify'),accountId=Number(req.params.accountId),documentId=Number(req.params.documentId),territoryId=me.admin_assertion.territoryId;
  if(territoryId!=null){const scope=await pool.query(`SELECT 1 FROM profile_authorizations WHERE account_id=$1 AND role='courier' AND territory_id=$2 AND status='active'`,[accountId,territoryId]);if(!scope.rowCount)return res.status(403).json({error:'Courier is outside your delegated territory'})}
  const q=await pool.query(`SELECT id,private_evidence_object_id FROM courier_documents WHERE id=$1 AND account_id=$2`,[documentId,accountId]);
  if(!q.rowCount)return res.status(404).json({error:'Courier document not found'});
  if(!q.rows[0].private_evidence_object_id)return res.status(409).json({error:'Private evidence migration is required before this Courier document can be read',code:'PRIVATE_EVIDENCE_MIGRATION_REQUIRED'});
  const evidence=await readPrivateEvidence(pool,{
    objectId:q.rows[0].private_evidence_object_id,actorAccountId:me.account.id,
    purpose:'courier_document_read',correlationId:correlation(req)
  });
  return sendPrivateEvidence(res,evidence);
}catch(e){next(e)}})
app.patch('/api/admin/couriers/:accountId',body,async(req,res,next)=>{try{const me=await requireAdmin(req,'courier.verify'),id=Number(req.params.accountId),territoryId=me.admin_assertion.territoryId,status=clean(req.body?.eligibility_status,30);if(!['pending','approved','suspended','revoked','expired'].includes(status))return res.status(400).json({error:'Invalid eligibility status'});if(territoryId!=null){const scope=await pool.query(`SELECT 1 FROM profile_authorizations WHERE account_id=$1 AND role='courier' AND territory_id=$2 AND status='active'`,[id,territoryId]);if(!scope.rowCount)return res.status(403).json({error:'Courier is outside your delegated territory'})}await pool.query(`UPDATE courier_profiles SET eligibility_status=$1,approved_vehicle_class=$2,eligibility_expires_at=$3,approval_note=$4,available=CASE WHEN $1='approved' THEN available ELSE FALSE END,updated_at=NOW() WHERE account_id=$5`,[status,clean(req.body?.approved_vehicle_class,40),req.body?.eligibility_expires_at||null,clean(req.body?.approval_note,600),id]);if(Array.isArray(req.body?.document_updates))for(const d of req.body.document_updates){if(!['verified','rejected','expired'].includes(d.status))continue;await pool.query(`UPDATE courier_documents SET verification_status=$1,verified_by_account_id=$2,verified_at=CASE WHEN $1='verified' THEN NOW() ELSE verified_at END,rejection_reason=$3,updated_at=NOW() WHERE id=$4 AND account_id=$5`,[d.status,me.account.id,clean(d.rejection_reason,500),Number(d.id),id])}res.json({ok:true})}catch(e){next(e)}})
app.get('/api/admin/deliveries/:id/route-evidence',async(req,res,next)=>{try{
  const id=Number(req.params.id),{me,d}=await scopedAdminDelivery(req,id);
  const points=await deliveryRoutePoints(id,{afterSequence:req.query?.after_sequence,limit:req.query?.limit});
  await auditDeliveryEvidenceView({deliveryId:id,actorAccountId:me.account.id,eventCode:'admin_route_evidence_viewed',detail:{status:d.status,point_count:points.length}});
  res.set('Cache-Control','private, no-store, max-age=0');
  res.json({delivery_id:id,status:d.status,points});
}catch(e){next(e)}})

app.get('/api/admin/deliveries/:id/proofs',async(req,res,next)=>{try{
  const id=Number(req.params.id),{me,d}=await scopedAdminDelivery(req,id);
  const proofs=await deliveryProofRows(id);
  await auditDeliveryEvidenceView({deliveryId:id,actorAccountId:me.account.id,eventCode:'admin_delivery_proof_list_viewed',detail:{status:d.status,proof_count:proofs.length}});
  res.set('Cache-Control','private, no-store, max-age=0');
  res.json(proofs);
}catch(e){next(e)}})

app.get('/api/admin/deliveries/:id/proofs/:proofId/file',async(req,res,next)=>{try{
  const id=Number(req.params.id),proofId=Number(req.params.proofId),{me,d}=await scopedAdminDelivery(req,id);
  const q=await pool.query('SELECT private_evidence_object_id,proof_type FROM delivery_proof_media WHERE id=$1 AND delivery_id=$2',[proofId,id]);
  if(!q.rowCount)return res.status(404).json({error:'Delivery proof not found'});
  await auditDeliveryEvidenceView({deliveryId:id,actorAccountId:me.account.id,eventCode:'admin_delivery_proof_viewed',detail:{status:d.status,proof_id:proofId,proof_type:q.rows[0].proof_type}});
  const evidence=await readPrivateEvidence(pool,{
    objectId:q.rows[0].private_evidence_object_id,actorAccountId:me.account.id,
    purpose:'delivery_proof_admin_read',correlationId:correlation(req)
  });
  return sendPrivateEvidence(res,evidence);
}catch(e){next(e)}})

app.get('/api/admin/deliveries',async(req,res,next)=>{try{const me=await requireAdmin(req,'delivery.dispatch.manage'),territoryId=me.admin_assertion.territoryId,status=clean(req.query?.status,40);const values=[],where=[];if(territoryId!=null){values.push(territoryId);where.push(`b.territory_id=$${values.length}`)}if(status){values.push(status);where.push(`d.status=$${values.length}`)}const{rows}=await pool.query(`SELECT d.*,o.order_number,o.order_status,o.payment_status,b.name business_name,b.territory_id,cp.display_name courier_name FROM deliveries d JOIN orders o ON o.id=d.order_id JOIN businesses b ON b.id=d.business_id LEFT JOIN courier_profiles cp ON cp.account_id=d.courier_account_id ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY d.updated_at DESC LIMIT 150`,values);res.json(rows.map(d=>deliveryPrivacyView(d,'admin')))}catch(e){next(e)}})
app.get('/api/admin/delivery/eligible-couriers',async(req,res,next)=>{try{const me=await requireAdmin(req,'delivery.dispatch.manage'),territoryId=me.admin_assertion.territoryId;const values=[],scope=territoryId==null?'TRUE':`EXISTS(SELECT 1 FROM profile_authorizations pa WHERE pa.account_id=c.account_id AND pa.role='courier' AND pa.territory_id=$1 AND pa.status='active')`;if(territoryId!=null)values.push(territoryId);const{rows}=await pool.query(`SELECT c.account_id,c.display_name courier_name,c.vehicle_type,c.approved_vehicle_class,c.max_weight_kg,c.max_volume_l,c.service_radius_km,c.operating_psgc_code,c.operating_area_name,c.operating_area_path FROM courier_profiles c WHERE c.eligibility_status='approved' AND c.available=TRUE AND (c.eligibility_expires_at IS NULL OR c.eligibility_expires_at>NOW()) AND ${scope} ORDER BY c.display_name`,values);res.json(rows)}catch(e){next(e)}})
app.post('/api/admin/deliveries/:id/assign',body,async(req,res,next)=>{
  const client=await pool.connect();
  try{
    const me=await requireAdmin(req,'delivery.dispatch.manage');
    const id=Number(req.params.id),courierId=Number(req.body?.courier_account_id),reason=clean(req.body?.override_reason,500);
    if(!reason)return res.status(400).json({error:'Admin manual assignment is an exception and requires an override reason'});
    const initial=await deliveryDetail(id);
    if(!initial)return res.status(404).json({error:'Delivery not found'});
    if(me.admin_assertion.territoryId!=null){
      const scoped=await pool.query(`SELECT 1 FROM businesses WHERE id=$1 AND territory_id=$2`,[initial.business_id,me.admin_assertion.territoryId]);
      if(!scoped.rowCount)return res.status(403).json({error:'Delivery is outside your delegated territory'});
    }
    await client.query('BEGIN');
    const locked=await client.query('SELECT * FROM deliveries WHERE id=$1 FOR UPDATE',[id]);
    if(!locked.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Delivery not found'})}
    const d=locked.rows[0];
    if(d.status!=='awaiting_courier'||d.courier_account_id!=null){await client.query('ROLLBACK');return res.status(409).json({error:'Admin override is available only while the delivery is awaiting Courier acceptance'})}
    const cq=await client.query('SELECT * FROM courier_profiles WHERE account_id=$1 FOR UPDATE',[courierId]);
    if(!cq.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'Courier profile missing'})}
    const gate=await courierOfferGateFromDb(client,cq.rows[0],d);
    if(!gate.allowed){await client.query('ROLLBACK');return res.status(409).json({error:'Courier is not currently eligible and available for this delivery',code:gate.reason})}
    await client.query(`
      UPDATE deliveries
         SET courier_account_id=$1,vehicle_class=$2,status='courier_assigned',
             assigned_at=NOW(),updated_at=NOW()
       WHERE id=$3
    `,[courierId,gate.approved_vehicle_class,id]);
    await client.query(`
      UPDATE delivery_offers
         SET status='withdrawn',responded_at=NOW(),updated_at=NOW()
       WHERE delivery_id=$1 AND status='pending'
    `,[id]);
    await client.query(`
      UPDATE delivery_offers
         SET status='withdrawn',responded_at=NOW(),updated_at=NOW()
       WHERE courier_account_id=$1 AND delivery_id<>$2 AND status='pending'
    `,[courierId,id]);
    await client.query('UPDATE courier_profiles SET available=FALSE,updated_at=NOW() WHERE account_id=$1',[courierId]);
    await recordDispatchEvent(client,{
      deliveryId:id,actorAccountId:me.account.id,courierAccountId:courierId,
      eventCode:'admin_assignment_override',offerRound:d.dispatch_round,
      detail:{reason}
    });
    await client.query('COMMIT');
    res.json({...deliveryPrivacyView(await deliveryDetail(id),'admin'),assignment_mode:'admin_override',override_reason:reason});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});next(e)}
  finally{client.release()}
})

function proxy(req,res,next){
  if(!suppliersApp)return res.status(503).json({error:'Supplier runtime is not ready'});
  return suppliersApp(req,res,next);
}
app.use(proxy)
app.use((err,_req,res,_next)=>{console.error(err);if(res.headersSent)return;if(err?.code==='HIGH_RISK_VELOCITY_LIMIT')res.set('Retry-After',String(Math.max(1,Number(err.retryAfterSeconds)||1)));const payload=err?.code==='HIGH_RISK_VELOCITY_LIMIT'?highRiskVelocityErrorBody(err):{error:err.status?err.message:'Unexpected server error'};res.status(err.status||500).json(payload)})

let embeddedStartPromise=null;
export async function startEmbeddedDelivery(){
  if(!embeddedStartPromise){
    embeddedStartPromise=(async()=>{
      suppliersApp=await startEmbeddedSuppliers();
      supplierReady=true;
      await initDb();
      console.log('Business & Life delivery mounted in-process');
      return app;
    })();
  }
  return embeddedStartPromise;
}

async function stopDelivery(){
  if(shuttingDown)return;
  shuttingDown=true;
  supplierReady=false;
  suppliersApp=null;
  await stopEmbeddedSuppliers().catch(()=>{});
  await pool.end().catch(()=>{});
}
export async function stopEmbeddedDelivery(){await stopDelivery()}

async function shutdown(sig){
  console.log(`Received ${sig}`);
  await stopDelivery();
  process.exit(0);
}
const directExecution=Boolean(process.argv[1])&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(directExecution){
  process.on('SIGTERM',()=>shutdown('SIGTERM'));
  process.on('SIGINT',()=>shutdown('SIGINT'));
  startEmbeddedDelivery()
    .then(()=>app.listen(port,'0.0.0.0',()=>console.log(`Business & Life delivery server listening on ${port}`)))
    .catch(e=>{console.error(e);process.exit(1)});
}
