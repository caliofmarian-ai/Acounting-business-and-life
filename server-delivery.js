import express from 'express';
import crypto from 'node:crypto';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureMonetizationSchema,recordMonetizableCompletion } from './monetization-core.js';
import {selectDeliveryVehicleQuote,courierCanServeDelivery,normalizeVehiclePricingRule,deliveryVehicleRuleEligible,calculateDeliveryQuoteTotal,deliveryPriceSplit,canonicalDeliveryVehicleClass} from './delivery-pricing-v2-core.js';
import {deliveryRoutingConfig,resolveDeliveryRoute,fallbackDeliveryRouteEstimate} from './delivery-routing-core.js';
import {verifyAdminAssertion} from './admin-authorization.js';
import {suppliersFetch,startEmbeddedSuppliers,stopEmbeddedSuppliers} from './server-suppliers.js';
import {createEmbeddedMarketplaceOrder} from './server-marketplace.js';
import {readOrderDetail} from './orders-read-core.js';

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

function clean(v,max=700){return String(v??'').trim().slice(0,max)}
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
function evidence(v){const x=String(v||'');if(!x)return'';if(x.length>1_900_000)throw Object.assign(new Error('Document is too large for this preview'),{status:413});if(!/^data:(application\/pdf|image\/(png|jpeg|webp));base64,[A-Za-z0-9+/=]+$/.test(x))throw Object.assign(new Error('Document must be PDF, PNG, JPEG or WebP'),{status:400});return x}
function haversine(lat1,lon1,lat2,lon2){const R=6371,dLat=(lat2-lat1)*Math.PI/180,dLon=(lon2-lon1)*Math.PI/180;const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))}
function completionCode(deliveryId){if(!TOKEN_SECRET)return null;const hex=crypto.createHmac('sha256',TOKEN_SECRET).update(`delivery:${deliveryId}`).digest('hex');return String(parseInt(hex.slice(0,12),16)%1_000_000).padStart(6,'0')}

async function initDb(){await ensureMonetizationSchema(pool);await pool.query(`
  ALTER TABLE merchant_storefronts ADD COLUMN IF NOT EXISTS pickup_lat DOUBLE PRECISION;
  ALTER TABLE merchant_storefronts ADD COLUMN IF NOT EXISTS pickup_lng DOUBLE PRECISION;
  ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS estimated_weight_kg NUMERIC(12,4) NOT NULL DEFAULT 0;
  ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS estimated_volume_l NUMERIC(12,4) NOT NULL DEFAULT 0;
  ALTER TABLE courier_profiles ADD COLUMN IF NOT EXISTS approved_vehicle_class TEXT NOT NULL DEFAULT '';
  ALTER TABLE courier_profiles ADD COLUMN IF NOT EXISTS eligibility_expires_at TIMESTAMPTZ;
  ALTER TABLE courier_profiles ADD COLUMN IF NOT EXISTS approval_note TEXT NOT NULL DEFAULT '';

  CREATE TABLE IF NOT EXISTS courier_documents (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    document_type TEXT NOT NULL,
    vehicle_class TEXT NOT NULL DEFAULT '',
    reference_number TEXT NOT NULL DEFAULT '',
    issue_date DATE,
    expiry_date DATE,
    evidence_data_url TEXT NOT NULL,
    verification_status TEXT NOT NULL DEFAULT 'submitted',
    verified_by_account_id BIGINT REFERENCES accounts(id),
    verified_at TIMESTAMPTZ,
    rejection_reason TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK(verification_status IN ('submitted','verified','rejected','expired'))
  );
  CREATE INDEX IF NOT EXISTS courier_documents_account_idx ON courier_documents(account_id,verification_status);

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
  ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS required_vehicle_class TEXT NOT NULL DEFAULT '';
  ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS service_fare NUMERIC(12,2) NOT NULL DEFAULT 0;
  ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS platform_fee_basis_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
  ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS pass_through_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
  ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS price_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb;
  ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS route_source TEXT NOT NULL DEFAULT 'straight_line_estimate';
  ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS route_profile TEXT NOT NULL DEFAULT '';
  ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS route_eta_minutes INTEGER;
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
  return{
    detail_mode:'home',
    profile:profile?{
      eligibility_status:profile.eligibility_status,
      eligibility_expires_at:profile.eligibility_expires_at,
      approved_vehicle_class:profile.approved_vehicle_class,
      vehicle_type:profile.vehicle_type,
      available:Boolean(profile.available)
    }:null,
    deliveries:workResult.rows,
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

app.get('/api/delivery/config',async(req,res,next)=>{try{
  await identity(req);
  const rule=await activeRule(),routing=deliveryRoutingConfig();
  res.json({
    enabled:Boolean(rule),
    pricing_rule_version:rule?.version||null,
    routing_provider:routing.google_routes_ready?'google_routes':'straight_line_estimate',
    routing_provider_configured:routing.provider,
    routing_provider_ready:routing.google_routes_ready,
    routing_fallback:'straight_line_estimate',
    live_map_provider:'OpenStreetMap/Leaflet preview'
  });
}catch(e){next(e)}})
app.post('/api/delivery/quote',body,async(req,res,next)=>{try{
  const me=await requireCustomer(req),businessId=Number(req.body?.business_id),lat=Number(req.body?.dropoff_lat),lng=Number(req.body?.dropoff_lng);
  if(!finite(lat)||!finite(lng)||lat<-90||lat>90||lng<-180||lng>180)return res.status(400).json({error:'Valid delivery coordinates are required'});
  const store=await pool.query(`SELECT business_id,pickup_lat,pickup_lng,delivery_enabled FROM merchant_storefronts WHERE business_id=$1 AND publication_status='published'`,[businessId]);
  if(!store.rowCount||!store.rows[0].delivery_enabled)return res.status(409).json({error:'Delivery is not enabled for this merchant'});
  const s=store.rows[0];
  if(!finite(s.pickup_lat)||!finite(s.pickup_lng))return res.status(409).json({error:'Merchant pickup location is not configured yet'});
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

  const straight=haversine(Number(s.pickup_lat),Number(s.pickup_lng),lat,lng);
  const fallbackDistance=straight*Number(rule.route_factor||1);
  const requestedRouteChoice=clean(req.body?.route_choice,40)||'avoid_tolls';
  const routingConfig=deliveryRoutingConfig();

  let quoteCalc,quoteTotal,vehiclePricingRuleId=null,requiredVehicleClass='',formulaType='',pricingSnapshot={},route=null;
  let providerRouteCalls=0;

  if(vehicleRules.length){
    const capacityShipment={distanceKm:0,weightKg:weight,volumeL:volume,minimumVehicleClass:req.body?.minimum_vehicle_class||null};
    const initialQuote=selectDeliveryVehicleQuote(vehicleRules,capacityShipment);
    let selectedRule=initialQuote.rule;

    const resolveForRule=async vehicleRule=>{
      if(routingConfig.google_routes_ready)providerRouteCalls+=1;
      return resolveDeliveryRoute({
        pickupLat:Number(s.pickup_lat),
        pickupLng:Number(s.pickup_lng),
        dropoffLat:lat,
        dropoffLng:lng,
        routeFactor:Number(rule.route_factor||1),
        routeProfile:vehicleRule.route_profile,
        routeChoice:requestedRouteChoice,
        includeTolls:vehicleRule.toll_policy==='pass_through',
        env:process.env
      });
    };

    route=await resolveForRule(selectedRule);
    let shipment={
      distanceKm:Number(route.distance_km),
      weightKg:weight,
      volumeL:volume,
      minimumVehicleClass:req.body?.minimum_vehicle_class||null
    };
    quoteCalc=selectDeliveryVehicleQuote(vehicleRules,shipment);

    if(quoteCalc.rule.route_profile!==selectedRule.route_profile){
      selectedRule=quoteCalc.rule;
      route=await resolveForRule(selectedRule);
      shipment={...shipment,distanceKm:Number(route.distance_km)};
      const stabilized=selectDeliveryVehicleQuote(vehicleRules,shipment);
      if(stabilized.rule.route_profile!==selectedRule.route_profile){
        return res.status(409).json({error:'Delivery route could not stabilize within the safe vehicle-routing limit. Adjust the shipment or destination.'});
      }
      quoteCalc=stabilized;
    }

    if(providerRouteCalls>2){
      return res.status(500).json({error:'Delivery routing exceeded its bounded provider-call limit.'});
    }
    if(rule.maximum_distance_km!=null&&Number(route.distance_km)>Number(rule.maximum_distance_km)){
      return res.status(409).json({error:'Delivery destination is outside the configured service distance'});
    }

    const selected=vehicleRules.find(x=>{
      try{return canonicalDeliveryVehicleClass(x.vehicle_class)===quoteCalc.vehicle_class}catch{return false}
    });
    vehiclePricingRuleId=selected?.id||null;
    requiredVehicleClass=quoteCalc.vehicle_class;
    formulaType=quoteCalc.formula_type;

    const verifiedToll=route.toll_status==='estimated'&&Number.isFinite(Number(route.toll_amount))
      ?Number(route.toll_amount)
      :0;
    quoteTotal=calculateDeliveryQuoteTotal(quoteCalc.rule,{
      distanceKm:Number(route.distance_km),weightKg:weight,volumeL:volume
    },{
      toll_amount:verifiedToll
    });

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
      route_profile:quoteCalc.rule.route_profile,
      expressway_eligible:quoteCalc.rule.expressway_eligible,
      toll_policy:quoteCalc.rule.toll_policy,
      parking_policy:quoteCalc.rule.parking_policy,
      stacking_policy:quoteCalc.rule.stacking_policy,
      route_source:route.source,
      routing_provider:route.provider,
      route_choice:route.route_choice,
      route_distance_km:Number(route.distance_km),
      route_eta_minutes:route.eta_minutes,
      route_fallback_estimate:Boolean(route.fallback_estimate),
      route_provider_ready:Boolean(route.provider_ready),
      route_provider_error_code:route.provider_error_code||null,
      route_restrictions_partially_ignored:Boolean(route.route_restrictions_partially_ignored),
      provider_route_calls:providerRouteCalls,
      toll_status:route.toll_status,
      toll_amount:route.toll_amount,
      toll_currency_code:route.toll_currency_code||'PHP',
      route_factor:Number(rule.route_factor||1),
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
    if(rule.maximum_distance_km!=null&&fallbackDistance>Number(rule.maximum_distance_km)){
      return res.status(409).json({error:'Delivery destination is outside the configured service distance'});
    }
    route=fallbackDeliveryRouteEstimate({
      pickupLat:Number(s.pickup_lat),
      pickupLng:Number(s.pickup_lng),
      dropoffLat:lat,
      dropoffLng:lng,
      routeFactor:Number(rule.route_factor||1),
      routeProfile:'car_optional_tolls',
      routeChoice:requestedRouteChoice,
      reason:'legacy_pricing_rule'
    });
    quoteCalc=legacyDeliveryPrice(rule,{distanceKm:Number(route.distance_km),weightKg:weight,volumeL:volume});
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
      pricing_rule_version:Number(rule.version),
      formula_type:'legacy_generic',
      route_source:route.source,
      routing_provider:route.provider,
      route_choice:route.route_choice,
      route_distance_km:Number(route.distance_km),
      route_eta_minutes:null,
      route_fallback_estimate:true,
      route_provider_error_code:route.provider_error_code,
      provider_route_calls:0,
      toll_status:route.toll_status,
      route_factor:Number(rule.route_factor||1),
      service_fare:quoteCalc.delivery_price,
      platform_fee_basis_amount:quoteCalc.delivery_price,
      pass_through_amount:0,
      customer_delivery_total:quoteCalc.delivery_price
    };
  }

  const priceBreakdown={
    service_fare:quoteTotal.service_fare,
    base:quoteCalc.base_component||Number(rule.base_fee||0),
    distance:quoteCalc.distance_component||Math.round(Number(route.distance_km)*Number(rule.per_km||0)*100)/100,
    weight:quoteCalc.weight_component||0,
    volume:quoteCalc.volume_component||0,
    extra_stops:quoteTotal.extra_stop_amount||0,
    waiting:quoteTotal.waiting_amount||0,
    special_handling:quoteTotal.special_handling_amount||0,
    demand_adjustment:quoteTotal.demand_adjustment_amount||0,
    promotion_discount:quoteTotal.promotion_discount||0,
    toll:quoteTotal.toll_amount||0,
    parking:quoteTotal.parking_amount||0,
    pass_through:quoteTotal.pass_through_amount||0,
    platform_fee_basis:quoteTotal.platform_fee_basis_amount,
    total:quoteTotal.customer_delivery_total
  };
  const routeProfile=quoteTotal.route_policy?.route_profile||pricingSnapshot.route_profile||'legacy_straight_line';
  const routeSource=route.source||'straight_line_estimate';

  const {rows}=await pool.query(`
    INSERT INTO delivery_quotes(
      customer_account_id,business_id,pricing_rule_id,pricing_rule_version,vehicle_pricing_rule_id,
      pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,route_distance_km,
      estimated_weight_kg,estimated_volume_l,required_vehicle_class,formula_type,pricing_snapshot,
      fee,service_fare,platform_fee_basis_amount,pass_through_amount,price_breakdown,route_source,route_profile,route_eta_minutes,
      currency_code,status,expires_at
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18,$19,$20::jsonb,$21,$22,$23,'PHP','quoted',NOW()+INTERVAL '15 minutes')
    RETURNING *
  `,[
    me.account.id,businessId,rule.id,rule.version,vehiclePricingRuleId,
    s.pickup_lat,s.pickup_lng,lat,lng,Number(route.distance_km),weight,volume,
    requiredVehicleClass,formulaType,JSON.stringify(pricingSnapshot),quoteTotal.customer_delivery_total,
    quoteTotal.service_fare,quoteTotal.platform_fee_basis_amount,quoteTotal.pass_through_amount,
    JSON.stringify(priceBreakdown),routeSource,routeProfile,route.eta_minutes
  ]);
  res.status(201).json({...rows[0],price_breakdown:priceBreakdown,route:{
    source:routeSource,
    provider:route.provider,
    profile:routeProfile,
    choice:route.route_choice,
    distance_km:Number(route.distance_km),
    eta_minutes:route.eta_minutes,
    fallback_estimate:Boolean(route.fallback_estimate),
    provider_ready:Boolean(route.provider_ready),
    provider_error_code:route.provider_error_code||null,
    provider_route_calls:providerRouteCalls,
    toll_status:route.toll_status,
    toll_amount:route.toll_amount,
    toll_currency_code:route.toll_currency_code||'PHP'
  }});
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
    const d=await client.query(`INSERT INTO deliveries(order_id,quote_id,business_id,customer_account_id,status,delivery_fee,service_fare,platform_fee_basis_amount,pass_through_amount,price_breakdown,route_source,route_profile,route_eta_minutes,currency_code,route_distance_km,estimated_weight_kg,estimated_volume_l,required_vehicle_class,pickup_address,pickup_lat,pickup_lng,dropoff_address,dropoff_lat,dropoff_lng) VALUES($1,$2,$3,$4,'quoted',$5,$6,$7,$8,$9::jsonb,$10,$11,$12,'PHP',$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING id`,[order.id,quote.id,quote.business_id,me.account.id,quote.fee,serviceFare,feeBasis,passThrough,JSON.stringify(quote.price_breakdown||{}),quote.route_source||'straight_line_estimate',quote.route_profile||'',quote.route_eta_minutes||null,quote.route_distance_km,quote.estimated_weight_kg,quote.estimated_volume_l,quote.required_vehicle_class||'',store.rows[0]?.pickup_address||'',quote.pickup_lat,quote.pickup_lng,clean(req.body?.delivery_address||me.account.address,500),quote.dropoff_lat,quote.dropoff_lng]);
    await client.query('COMMIT');
    const updated=await readOrderDetail(pool,order.id);
    if(!updated)throw Object.assign(new Error('Order detail unavailable after Delivery checkout'),{status:500});
    res.status(201).json({...updated,delivery_id:d.rows[0].id});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
}catch(e){next(e)}})

app.put('/api/delivery/store-location',body,async(req,res,next)=>{try{const{business:b}=await requireMerchant(req,Number(req.body?.business_id||undefined)),lat=Number(req.body?.lat),lng=Number(req.body?.lng);if(!finite(lat)||!finite(lng)||lat<-90||lat>90||lng<-180||lng>180)return res.status(400).json({error:'Valid coordinates required'});await pool.query(`UPDATE merchant_storefronts SET pickup_lat=$1,pickup_lng=$2,updated_at=NOW() WHERE business_id=$3`,[lat,lng,b.id]);res.json({ok:true,pickup_lat:lat,pickup_lng:lng})}catch(e){next(e)}})
app.get('/api/delivery/merchant',async(req,res,next)=>{try{const{business:b}=await requireMerchant(req,Number(req.query.business_id||undefined));const{rows}=await pool.query(`SELECT d.*,o.order_number,o.order_status,o.payment_status,cp.display_name courier_name,cp.vehicle_type FROM deliveries d JOIN orders o ON o.id=d.order_id LEFT JOIN courier_profiles cp ON cp.account_id=d.courier_account_id WHERE d.business_id=$1 ORDER BY d.created_at DESC LIMIT 200`,[b.id]);res.json(rows)}catch(e){next(e)}})
app.post('/api/delivery/:id/request-courier',body,async(req,res,next)=>{try{const id=Number(req.params.id),d=await deliveryDetail(id);if(!d)return res.status(404).json({error:'Delivery not found'});const{me}=await requireMerchant(req,d.business_id);if(d.order_status!=='ready')return res.status(409).json({error:'Order must be ready before courier dispatch'});if(d.payment_status!=='paid')return res.status(409).json({error:'Delivery order must be paid before dispatch'});if(!['quoted','requested'].includes(d.status))return res.status(409).json({error:'Delivery is already in dispatch'});await pool.query(`UPDATE deliveries SET status='awaiting_courier',requested_at=COALESCE(requested_at,NOW()),updated_at=NOW() WHERE id=$1`,[id]);res.json(await deliveryDetail(id))}catch(e){next(e)}})

app.get('/api/courier/home',async(req,res,next)=>{try{const me=await requireCourier(req);res.json(await courierHomeSnapshot(me.account.id,me.courier))}catch(e){next(e)}})
app.get('/api/courier/delivery-profile',async(req,res,next)=>{try{const me=await requireCourier(req);const [p,docs,deliveries]=await Promise.all([pool.query(`SELECT * FROM courier_profiles WHERE account_id=$1`,[me.account.id]),pool.query(`SELECT id,document_type,vehicle_class,reference_number,issue_date,expiry_date,verification_status,rejection_reason,created_at FROM courier_documents WHERE account_id=$1 ORDER BY created_at DESC`,[me.account.id]),pool.query(`SELECT d.*,o.order_number,b.name business_name FROM deliveries d JOIN orders o ON o.id=d.order_id JOIN businesses b ON b.id=d.business_id WHERE d.courier_account_id=$1 ORDER BY d.created_at DESC LIMIT 100`,[me.account.id])]);res.json({profile:p.rows[0]||null,documents:docs.rows,deliveries:deliveries.rows})}catch(e){next(e)}})
app.post('/api/courier/documents',body,async(req,res,next)=>{try{const me=await requireCourier(req),doc=evidence(req.body?.evidence_data_url);if(!doc||!clean(req.body?.document_type,80))return res.status(400).json({error:'Document type and evidence are required'});const{rows}=await pool.query(`INSERT INTO courier_documents(account_id,document_type,vehicle_class,reference_number,issue_date,expiry_date,evidence_data_url,verification_status) VALUES($1,$2,$3,$4,$5,$6,$7,'submitted') RETURNING id,document_type,vehicle_class,reference_number,issue_date,expiry_date,verification_status,created_at`,[me.account.id,clean(req.body.document_type,80),clean(req.body?.vehicle_class,40),clean(req.body?.reference_number,120),req.body?.issue_date||null,req.body?.expiry_date||null,doc]);res.status(201).json(rows[0])}catch(e){next(e)}})
app.put('/api/courier/availability',body,async(req,res,next)=>{try{const me=await requireCourier(req);const p=await pool.query(`SELECT eligibility_status,eligibility_expires_at FROM courier_profiles WHERE account_id=$1`,[me.account.id]);if(!p.rowCount)return res.status(404).json({error:'Courier profile missing'});const row=p.rows[0],expired=row.eligibility_expires_at&&new Date(row.eligibility_expires_at)<new Date();if(req.body?.available&&(row.eligibility_status!=='approved'||expired))return res.status(403).json({error:'Admin approval is required before becoming available'});await pool.query(`UPDATE courier_profiles SET available=$1,updated_at=NOW() WHERE account_id=$2`,[Boolean(req.body?.available),me.account.id]);res.json({ok:true,available:Boolean(req.body?.available)})}catch(e){next(e)}})
app.post('/api/courier/deliveries/:id/status',body,async(req,res,next)=>{try{const me=await requireCourier(req),id=Number(req.params.id),nextStatus=clean(req.body?.status,60);const d=await deliveryDetail(id);if(!d||Number(d.courier_account_id)!==Number(me.account.id))return res.status(404).json({error:'Assigned delivery not found'});const flow={courier_assigned:['courier_en_route_to_merchant'],courier_en_route_to_merchant:['courier_arrived_at_merchant'],courier_arrived_at_merchant:['picked_up'],picked_up:['in_transit'],in_transit:['courier_arrived_at_customer']}[d.status]||[];if(!flow.includes(nextStatus))return res.status(409).json({error:`Cannot move delivery from ${d.status} to ${nextStatus}`});const stamp={courier_en_route_to_merchant:'en_route_to_merchant_at',courier_arrived_at_merchant:'arrived_merchant_at',picked_up:'picked_up_at',in_transit:'in_transit_at',courier_arrived_at_customer:'arrived_customer_at'}[nextStatus];const client=await pool.connect();try{await client.query('BEGIN');await client.query(`UPDATE deliveries SET status=$1,${stamp}=NOW(),updated_at=NOW() WHERE id=$2`,[nextStatus,id]);if(nextStatus==='picked_up'){await client.query(`UPDATE orders SET order_status='handoff_to_delivery',handoff_at=COALESCE(handoff_at,NOW()),updated_at=NOW() WHERE id=$1 AND order_status='ready'`,[d.order_id]);await client.query(`INSERT INTO order_status_events(order_id,from_status,to_status,actor_account_id,note) SELECT id,'ready','handoff_to_delivery',$1,'Courier picked up order' FROM orders WHERE id=$2`,[me.account.id,d.order_id])}await client.query('COMMIT');res.json(await deliveryDetail(id))}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}}catch(e){next(e)}})
app.post('/api/courier/deliveries/:id/location',body,async(req,res,next)=>{try{const me=await requireCourier(req),id=Number(req.params.id),lat=Number(req.body?.lat),lng=Number(req.body?.lng);if(!finite(lat)||!finite(lng)||lat<-90||lat>90||lng<-180||lng>180)return res.status(400).json({error:'Valid coordinates required'});const d=await deliveryDetail(id);if(!d||Number(d.courier_account_id)!==Number(me.account.id))return res.status(404).json({error:'Assigned delivery not found'});if(!activeTracking(d.status))return res.status(409).json({error:'Tracking is closed for this delivery'});await pool.query(`UPDATE deliveries SET last_lat=$1,last_lng=$2,last_location_at=NOW(),updated_at=NOW() WHERE id=$3`,[lat,lng,id]);res.json({ok:true,at:new Date().toISOString()})}catch(e){next(e)}})
app.post('/api/courier/deliveries/:id/complete',body,async(req,res,next)=>{try{const me=await requireCourier(req),id=Number(req.params.id),d=await deliveryDetail(id);if(!d||Number(d.courier_account_id)!==Number(me.account.id))return res.status(404).json({error:'Assigned delivery not found'});if(d.status!=='courier_arrived_at_customer')return res.status(409).json({error:'Courier must arrive at customer before completion'});if(clean(req.body?.completion_code,20)!==completionCode(id))return res.status(403).json({error:'Customer delivery code is incorrect'});const client=await pool.connect();try{await client.query('BEGIN');await client.query(`UPDATE deliveries SET status='delivered',delivered_at=NOW(),last_lat=NULL,last_lng=NULL,last_location_at=NULL,updated_at=NOW() WHERE id=$1`,[id]);await client.query(`UPDATE orders SET order_status='completed',completed_at=COALESCE(completed_at,NOW()),updated_at=NOW() WHERE id=$1`,[d.order_id]);await client.query(`INSERT INTO order_status_events(order_id,from_status,to_status,actor_account_id,note) VALUES($1,$2,'completed',$3,'Delivery completed with customer code')`,[d.order_id,d.order_status,me.account.id]);const done=await client.query(`SELECT d.delivered_at,d.delivery_fee,d.service_fare,d.platform_fee_basis_amount,d.pass_through_amount,d.currency_code,d.courier_account_id,o.completed_at,o.subtotal,o.business_id,b.territory_id FROM deliveries d JOIN orders o ON o.id=d.order_id JOIN businesses b ON b.id=d.business_id WHERE d.id=$1`,[id]);const x=done.rows[0],deliveryFeeBasis=Number(x.platform_fee_basis_amount||x.service_fare||x.delivery_fee||0);await recordMonetizableCompletion(client,{serviceScope:'marketplace',subjectType:'business',subjectId:x.business_id,sourceType:'order',sourceId:d.order_id,territoryId:x.territory_id,completedAt:x.completed_at,grossValue:x.subtotal,currencyCode:x.currency_code||'PHP'});await recordMonetizableCompletion(client,{serviceScope:'delivery',subjectType:'account',subjectId:x.courier_account_id,sourceType:'delivery',sourceId:id,territoryId:x.territory_id,completedAt:x.delivered_at,grossValue:deliveryFeeBasis,currencyCode:x.currency_code||'PHP'});await client.query('COMMIT');res.json(await deliveryDetail(id))}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}}catch(e){next(e)}})

app.get('/api/delivery/mine',async(req,res,next)=>{try{
  const me=await requireCustomer(req);
  if(String(req.query.view||'')==='home'){
    const{rows}=await pool.query(`SELECT d.id,d.order_id,d.status,d.updated_at,d.created_at,o.order_number,b.name business_name FROM deliveries d JOIN orders o ON o.id=d.order_id JOIN businesses b ON b.id=d.business_id WHERE d.customer_account_id=$1 AND d.status NOT IN ('delivered','failed','cancelled') ORDER BY d.updated_at DESC LIMIT 12`,[me.account.id]);
    return res.json(rows);
  }
  const{rows}=await pool.query(`SELECT d.*,o.order_number,b.name business_name,cp.display_name courier_name,cp.vehicle_type FROM deliveries d JOIN orders o ON o.id=d.order_id JOIN businesses b ON b.id=d.business_id LEFT JOIN courier_profiles cp ON cp.account_id=d.courier_account_id WHERE d.customer_account_id=$1 ORDER BY d.created_at DESC LIMIT 100`,[me.account.id]);
  res.json(rows.map(d=>({...d,completion_code:activeTracking(d.status)?completionCode(d.id):null,last_lat:activeTracking(d.status)?d.last_lat:null,last_lng:activeTracking(d.status)?d.last_lng:null})))
}catch(e){next(e)}})
app.get('/api/delivery/:id/live',async(req,res,next)=>{try{const d=await deliveryDetail(Number(req.params.id));if(!d)return res.status(404).json({error:'Delivery not found'});const me=await allowedDelivery(req,d),rule=await activeRule();const customer=Number(me.account.id)===Number(d.customer_account_id);res.json({...d,last_lat:activeTracking(d.status)?d.last_lat:null,last_lng:activeTracking(d.status)?d.last_lng:null,completion_code:customer&&activeTracking(d.status)?completionCode(d.id):undefined,eta_minutes:etaMinutes(d,rule),distance_to_dropoff_km:d.last_lat&&d.last_lng?Math.round(haversine(Number(d.last_lat),Number(d.last_lng),Number(d.dropoff_lat),Number(d.dropoff_lng))*100)/100:null})}catch(e){next(e)}})

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

app.get('/api/admin/couriers',async(req,res,next)=>{try{const me=await requireAdmin(req,'courier.verify'),territoryId=me.admin_assertion.territoryId;const values=[],scope=territoryId==null?'TRUE':`EXISTS(SELECT 1 FROM profile_authorizations pa WHERE pa.account_id=a.id AND pa.role='courier' AND pa.territory_id=$1 AND pa.status='active')`;if(territoryId!=null)values.push(territoryId);const{rows}=await pool.query(`SELECT a.id account_id,a.display_name,a.email,c.display_name courier_name,c.vehicle_type,c.max_weight_kg,c.max_volume_l,c.service_radius_km,c.available,c.eligibility_status,c.approved_vehicle_class,c.eligibility_expires_at,c.approval_note,(SELECT COUNT(*) FROM courier_documents d WHERE d.account_id=a.id AND d.verification_status='submitted')::int submitted_documents FROM accounts a JOIN profiles p ON p.account_id=a.id AND p.role='courier' AND p.enabled=TRUE JOIN courier_profiles c ON c.account_id=a.id WHERE ${scope} ORDER BY c.eligibility_status='approved' DESC,a.display_name`,values);res.json(rows)}catch(e){next(e)}})
app.get('/api/admin/couriers/:accountId',async(req,res,next)=>{try{
  const me=await requireAdmin(req,'courier.verify'),id=Number(req.params.accountId),territoryId=me.admin_assertion.territoryId;
  if(!Number.isInteger(id)||id<=0)return res.status(400).json({error:'Valid Courier account required'});
  if(territoryId!=null){const scope=await pool.query(`SELECT 1 FROM profile_authorizations WHERE account_id=$1 AND role='courier' AND territory_id=$2 AND status='active'`,[id,territoryId]);if(!scope.rowCount)return res.status(403).json({error:'Courier is outside your delegated territory'})}
  const [courier,documents]=await Promise.all([
    pool.query(`SELECT a.id account_id,a.display_name,a.email,c.display_name courier_name,c.vehicle_type,c.max_weight_kg,c.max_volume_l,c.service_radius_km,c.available,c.eligibility_status,c.approved_vehicle_class,c.eligibility_expires_at,c.approval_note FROM accounts a JOIN profiles p ON p.account_id=a.id AND p.role='courier' AND p.enabled=TRUE JOIN courier_profiles c ON c.account_id=a.id WHERE a.id=$1`,[id]),
    pool.query(`SELECT id,document_type,vehicle_class,reference_number,issue_date,expiry_date,verification_status,rejection_reason,created_at,updated_at FROM courier_documents WHERE account_id=$1 ORDER BY created_at DESC,id DESC`,[id])
  ]);
  if(!courier.rowCount)return res.status(404).json({error:'Courier not found'});
  res.json({courier:courier.rows[0],documents:documents.rows});
}catch(e){next(e)}})
app.get('/api/admin/couriers/:accountId/documents/:documentId',async(req,res,next)=>{try{
  const me=await requireAdmin(req,'courier.verify'),accountId=Number(req.params.accountId),documentId=Number(req.params.documentId),territoryId=me.admin_assertion.territoryId;
  if(territoryId!=null){const scope=await pool.query(`SELECT 1 FROM profile_authorizations WHERE account_id=$1 AND role='courier' AND territory_id=$2 AND status='active'`,[accountId,territoryId]);if(!scope.rowCount)return res.status(403).json({error:'Courier is outside your delegated territory'})}
  const q=await pool.query(`SELECT id,document_type,vehicle_class,reference_number,issue_date,expiry_date,verification_status,rejection_reason,evidence_data_url FROM courier_documents WHERE id=$1 AND account_id=$2`,[documentId,accountId]);
  if(!q.rowCount)return res.status(404).json({error:'Courier document not found'});
  res.json(q.rows[0]);
}catch(e){next(e)}})
app.patch('/api/admin/couriers/:accountId',body,async(req,res,next)=>{try{const me=await requireAdmin(req,'courier.verify'),id=Number(req.params.accountId),territoryId=me.admin_assertion.territoryId,status=clean(req.body?.eligibility_status,30);if(!['pending','approved','suspended','revoked','expired'].includes(status))return res.status(400).json({error:'Invalid eligibility status'});if(territoryId!=null){const scope=await pool.query(`SELECT 1 FROM profile_authorizations WHERE account_id=$1 AND role='courier' AND territory_id=$2 AND status='active'`,[id,territoryId]);if(!scope.rowCount)return res.status(403).json({error:'Courier is outside your delegated territory'})}await pool.query(`UPDATE courier_profiles SET eligibility_status=$1,approved_vehicle_class=$2,eligibility_expires_at=$3,approval_note=$4,available=CASE WHEN $1='approved' THEN available ELSE FALSE END,updated_at=NOW() WHERE account_id=$5`,[status,clean(req.body?.approved_vehicle_class,40),req.body?.eligibility_expires_at||null,clean(req.body?.approval_note,600),id]);if(Array.isArray(req.body?.document_updates))for(const d of req.body.document_updates){if(!['verified','rejected','expired'].includes(d.status))continue;await pool.query(`UPDATE courier_documents SET verification_status=$1,verified_by_account_id=$2,verified_at=CASE WHEN $1='verified' THEN NOW() ELSE verified_at END,rejection_reason=$3,updated_at=NOW() WHERE id=$4 AND account_id=$5`,[d.status,me.account.id,clean(d.rejection_reason,500),Number(d.id),id])}res.json({ok:true})}catch(e){next(e)}})
app.get('/api/admin/deliveries',async(req,res,next)=>{try{const me=await requireAdmin(req,'delivery.dispatch.manage'),territoryId=me.admin_assertion.territoryId,status=clean(req.query?.status,40);const values=[],where=[];if(territoryId!=null){values.push(territoryId);where.push(`b.territory_id=$${values.length}`)}if(status){values.push(status);where.push(`d.status=$${values.length}`)}const{rows}=await pool.query(`SELECT d.*,o.order_number,o.order_status,o.payment_status,b.name business_name,b.territory_id,cp.display_name courier_name FROM deliveries d JOIN orders o ON o.id=d.order_id JOIN businesses b ON b.id=d.business_id LEFT JOIN courier_profiles cp ON cp.account_id=d.courier_account_id ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY d.updated_at DESC LIMIT 150`,values);res.json(rows)}catch(e){next(e)}})
app.get('/api/admin/delivery/eligible-couriers',async(req,res,next)=>{try{const me=await requireAdmin(req,'delivery.dispatch.manage'),territoryId=me.admin_assertion.territoryId;const values=[],scope=territoryId==null?'TRUE':`EXISTS(SELECT 1 FROM profile_authorizations pa WHERE pa.account_id=c.account_id AND pa.role='courier' AND pa.territory_id=$1 AND pa.status='active')`;if(territoryId!=null)values.push(territoryId);const{rows}=await pool.query(`SELECT c.account_id,c.display_name courier_name,c.vehicle_type,c.approved_vehicle_class,c.max_weight_kg,c.max_volume_l,c.service_radius_km FROM courier_profiles c WHERE c.eligibility_status='approved' AND c.available=TRUE AND (c.eligibility_expires_at IS NULL OR c.eligibility_expires_at>NOW()) AND ${scope} ORDER BY c.display_name`,values);res.json(rows)}catch(e){next(e)}})
app.post('/api/admin/deliveries/:id/assign',body,async(req,res,next)=>{try{
  const me=await requireAdmin(req,'delivery.dispatch.manage');
  const id=Number(req.params.id),courierId=Number(req.body?.courier_account_id),d=await deliveryDetail(id);
  if(!d)return res.status(404).json({error:'Delivery not found'});
  if(me.admin_assertion.territoryId!=null){const scoped=await pool.query(`SELECT 1 FROM businesses WHERE id=$1 AND territory_id=$2`,[d.business_id,me.admin_assertion.territoryId]);if(!scoped.rowCount)return res.status(403).json({error:'Delivery is outside your delegated territory'})}
  if(!['awaiting_courier','requested'].includes(d.status))return res.status(409).json({error:'Delivery is not waiting for assignment'});
  const cq=await pool.query(`
    SELECT * FROM courier_profiles
    WHERE account_id=$1
      AND eligibility_status='approved'
      AND available=TRUE
      AND (eligibility_expires_at IS NULL OR eligibility_expires_at>NOW())
  `,[courierId]);
  if(!cq.rowCount)return res.status(409).json({error:'Courier is not approved and available'});
  const courier=cq.rows[0];
  let approvedClass=clean(courier.approved_vehicle_class||courier.vehicle_type,40);
  if(approvedClass){try{approvedClass=canonicalDeliveryVehicleClass(approvedClass)}catch(e){return res.status(e.status||409).json({error:e.message})}}
  if(d.required_vehicle_class){
    let gate;
    try{gate=courierCanServeDelivery(courier,d)}
    catch(e){return res.status(e.status||409).json({error:e.message})}
    if(!gate.allowed){
      const copy={
        VEHICLE_CLASS_MISMATCH:`Delivery requires ${d.required_vehicle_class}; this Courier is approved for ${approvedClass||'no vehicle class'}`,
        COURIER_WEIGHT_CAPACITY_EXCEEDED:'Courier weight capacity is below this delivery requirement',
        COURIER_VOLUME_CAPACITY_EXCEEDED:'Courier volume capacity is below this delivery requirement',
        COURIER_SERVICE_RADIUS_EXCEEDED:'Delivery distance exceeds this Courier service radius'
      };
      return res.status(409).json({error:copy[gate.reason]||'Courier cannot serve this delivery',code:gate.reason});
    }
  }
  await pool.query(`
    UPDATE deliveries
       SET courier_account_id=$1,
           vehicle_class=$2,
           status='courier_assigned',
           assigned_at=NOW(),
           updated_at=NOW()
     WHERE id=$3
  `,[courierId,approvedClass,id]);
  res.json(await deliveryDetail(id));
}catch(e){next(e)}})

function proxy(req,res,next){
  if(!suppliersApp)return res.status(503).json({error:'Supplier runtime is not ready'});
  return suppliersApp(req,res,next);
}
app.use(proxy)
app.use((err,_req,res,_next)=>{console.error(err);if(res.headersSent)return;res.status(err.status||500).json({error:err.status?err.message:'Unexpected server error'})})

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
