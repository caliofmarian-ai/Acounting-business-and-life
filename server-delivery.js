import express from 'express';
import crypto from 'node:crypto';
import pg from 'pg';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const upstreamPort = Number(process.env.INTERNAL_SUPPLIERS_PORT || 3607);
const servicesPort = Number(process.env.INTERNAL_SERVICES_PORT || 3507);
const marketplacePort = Number(process.env.INTERNAL_MARKETPLACE_PORT || 3407);
const ordersPort = Number(process.env.INTERNAL_ORDERS_PORT || 3307);
const authPort = Number(process.env.INTERNAL_AUTH_PORT || 3207);
const accountingPort = Number(process.env.INTERNAL_ACCOUNTING_PORT || 3107);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined });
const TOKEN_SECRET = process.env.TOKEN_SECRET || '';
const body = express.json({ limit: '2500kb' });
let child;
let shuttingDown = false;

function clean(v,max=700){return String(v??'').trim().slice(0,max)}
function num(v){return Number(v)}
function finite(v){return Number.isFinite(num(v))}
function clamp(v,min,max){return Math.max(min,Math.min(max,num(v)))}
function authHeader(req){return req.headers.authorization||''}
async function upstream(path,options={}){return fetch(`http://127.0.0.1:${upstreamPort}${path}`,options)}
async function identity(req){const r=await upstream('/api/me',{headers:{Authorization:authHeader(req)}});const b=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(b.error||'Unauthorized'),{status:r.status});return b}
function enabled(me,role){return me?.profiles?.some(p=>p.role===role&&p.enabled)}
function business(me,id=null){const list=me?.businesses||[];return id==null?(list[0]||null):(list.find(b=>Number(b.id)===Number(id))||null)}
async function requireMerchant(req,businessId=null){const me=await identity(req);if(!enabled(me,'merchant'))throw Object.assign(new Error('Merchant profile required'),{status:403});const b=business(me,businessId);if(!b)throw Object.assign(new Error('Business workspace unavailable'),{status:403});return{me,business:b}}
async function requireCustomer(req){const me=await identity(req);if(!enabled(me,'customer'))throw Object.assign(new Error('Customer profile required'),{status:403});return me}
async function requireCourier(req){const me=await identity(req);if(!enabled(me,'courier'))throw Object.assign(new Error('Delivery profile required'),{status:403});return me}
async function requireAdmin(req){const me=await identity(req);if(Number(me.account.id)!==1)throw Object.assign(new Error('Admin access required'),{status:403});return me}
function evidence(v){const x=String(v||'');if(!x)return'';if(x.length>1_900_000)throw Object.assign(new Error('Document is too large for this preview'),{status:413});if(!/^data:(application\/pdf|image\/(png|jpeg|webp));base64,[A-Za-z0-9+/=]+$/.test(x))throw Object.assign(new Error('Document must be PDF, PNG, JPEG or WebP'),{status:400});return x}
function haversine(lat1,lon1,lat2,lon2){const R=6371,dLat=(lat2-lat1)*Math.PI/180,dLon=(lon2-lon1)*Math.PI/180;const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))}
function completionCode(deliveryId){if(!TOKEN_SECRET)return null;const hex=crypto.createHmac('sha256',TOKEN_SECRET).update(`delivery:${deliveryId}`).digest('hex');return String(parseInt(hex.slice(0,12),16)%1_000_000).padStart(6,'0')}

async function initDb(){await pool.query(`
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

  ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS merchandise_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
  ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS delivery_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
`)}

async function activeRule(){const r=await pool.query(`SELECT * FROM delivery_pricing_rules WHERE country_code='PH' AND active=TRUE ORDER BY version DESC LIMIT 1`);return r.rows[0]||null}
async function deliveryDetail(id){const r=await pool.query(`SELECT d.*,o.order_number,o.order_status,o.payment_status,b.name business_name,cu.display_name customer_name,cp.display_name courier_name,cp.vehicle_type courier_vehicle FROM deliveries d JOIN orders o ON o.id=d.order_id JOIN businesses b ON b.id=d.business_id JOIN accounts cu ON cu.id=d.customer_account_id LEFT JOIN courier_profiles cp ON cp.account_id=d.courier_account_id WHERE d.id=$1`,[id]);return r.rows[0]||null}
async function allowedDelivery(req,d){const me=await identity(req);const id=Number(me.account.id);if(id===Number(d.customer_account_id)||id===Number(d.courier_account_id)||Boolean(business(me,d.business_id))||id===1)return me;throw Object.assign(new Error('Not allowed to view this delivery'),{status:403})}
function activeTracking(status){return !['delivered','failed','cancelled'].includes(status)}
function etaMinutes(d,rule){if(!d.last_lat||!d.last_lng||!rule||!d.vehicle_class)return null;const dist=haversine(Number(d.last_lat),Number(d.last_lng),Number(d.dropoff_lat),Number(d.dropoff_lng))*Number(rule.route_factor||1);let speed=null;if(d.vehicle_class==='bicycle')speed=rule.average_speed_bicycle_kmh;else if(['motorbike','scooter'].includes(d.vehicle_class))speed=rule.average_speed_motorbike_kmh;else if(['car','van'].includes(d.vehicle_class))speed=rule.average_speed_car_kmh;if(!speed||Number(speed)<=0)return null;return Math.ceil(dist/Number(speed)*60)}

app.get('/health',async(_q,r)=>{try{await pool.query('SELECT 1');const u=await upstream('/health');r.status(u.ok?200:503).json({ok:u.ok,db:true,suppliers:u.ok,version:'0.7-delivery'})}catch{r.status(503).json({ok:false,db:false,suppliers:false,version:'0.7-delivery'})}})
app.get('/delivery.css',(_q,r)=>r.type('text/css').send(readFileSync(join(__dirname,'public','delivery.css'),'utf8')))
app.get('/delivery-ui.js',(_q,r)=>r.type('application/javascript').send(readFileSync(join(__dirname,'public','delivery-ui.js'),'utf8')))
async function root(req,res){const r=await upstream(req.path,{headers:{...req.headers,host:`127.0.0.1:${upstreamPort}`}});let html=await r.text();html=html.replace('</head>','  <link rel="stylesheet" href="/delivery.css" />\n</head>').replace('</body>','  <script type="module" src="/delivery-ui.js"></script>\n</body>');res.status(r.status).type('html').send(html)}
app.get('/',root);app.get('/index.html',root)

app.get('/api/delivery/config',async(req,res,next)=>{try{await identity(req);const rule=await activeRule();res.json({enabled:Boolean(rule),pricing_rule_version:rule?.version||null,routing_provider:'straight_line_estimate',live_map_provider:'OpenStreetMap/Leaflet preview'})}catch(e){next(e)}})
app.post('/api/delivery/quote',body,async(req,res,next)=>{try{const me=await requireCustomer(req),businessId=Number(req.body?.business_id),lat=Number(req.body?.dropoff_lat),lng=Number(req.body?.dropoff_lng);if(!finite(lat)||!finite(lng)||lat<-90||lat>90||lng<-180||lng>180)return res.status(400).json({error:'Valid delivery coordinates are required'});const store=await pool.query(`SELECT business_id,pickup_lat,pickup_lng,delivery_enabled FROM merchant_storefronts WHERE business_id=$1 AND publication_status='published'`,[businessId]);if(!store.rowCount||!store.rows[0].delivery_enabled)return res.status(409).json({error:'Delivery is not enabled for this merchant'});const s=store.rows[0];if(!finite(s.pickup_lat)||!finite(s.pickup_lng))return res.status(409).json({error:'Merchant pickup location is not configured yet'});const rule=await activeRule();if(!rule)return res.status(409).json({error:'Delivery pricing is not configured by Admin yet'});const raw=Array.isArray(req.body?.items)?req.body.items:[];let weight=0,volume=0;if(raw.length){const ids=[...new Set(raw.map(x=>Number(x.product_id)).filter(Number.isInteger))];const p=await pool.query(`SELECT id,estimated_weight_kg,estimated_volume_l FROM marketplace_products WHERE business_id=$1 AND id=ANY($2::bigint[]) AND published=TRUE`,[businessId,ids]);const map=new Map(p.rows.map(x=>[Number(x.id),x]));for(const x of raw){const item=map.get(Number(x.product_id)),q=Number(x.quantity);if(item&&q>0){weight+=Number(item.estimated_weight_kg||0)*q;volume+=Number(item.estimated_volume_l||0)*q}}}const straight=haversine(Number(s.pickup_lat),Number(s.pickup_lng),lat,lng),distance=straight*Number(rule.route_factor||1);if(rule.maximum_distance_km!=null&&distance>Number(rule.maximum_distance_km))return res.status(409).json({error:'Delivery destination is outside the configured service distance'});let fee=Number(rule.base_fee)+distance*Number(rule.per_km)+weight*Number(rule.per_kg)+volume*Number(rule.per_liter);fee=Math.max(Number(rule.minimum_fee||0),fee);fee=Math.round(fee*100)/100;const{rows}=await pool.query(`INSERT INTO delivery_quotes(customer_account_id,business_id,pricing_rule_id,pricing_rule_version,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,route_distance_km,estimated_weight_kg,estimated_volume_l,fee,currency_code,status,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'PHP','quoted',NOW()+INTERVAL '15 minutes') RETURNING *`,[me.account.id,businessId,rule.id,rule.version,s.pickup_lat,s.pickup_lng,lat,lng,distance,weight,volume,fee]);res.status(201).json(rows[0])}catch(e){next(e)}})

app.post('/api/marketplace/checkout',body,async(req,res,next)=>{try{if(req.body?.fulfilment_method!=='delivery'){const r=await upstream('/api/marketplace/checkout',{method:'POST',headers:{Authorization:authHeader(req),'Content-Type':'application/json'},body:JSON.stringify(req.body)});return res.status(r.status).json(await r.json())}const me=await requireCustomer(req),quoteId=Number(req.body?.delivery_quote_id);const q=await pool.query(`SELECT * FROM delivery_quotes WHERE id=$1 AND customer_account_id=$2 AND business_id=$3 AND status='quoted' AND expires_at>NOW() FOR UPDATE`,[quoteId,me.account.id,Number(req.body.business_id)]);if(!q.rowCount)return res.status(409).json({error:'Delivery quote is missing or expired. Get a new quote.'});if(req.body?.payment_method!=='online')return res.status(409).json({error:'Cash delivery is not enabled. Use online/digital payment.'});const quote=q.rows[0];const r=await upstream('/api/marketplace/checkout',{method:'POST',headers:{Authorization:authHeader(req),'Content-Type':'application/json'},body:JSON.stringify(req.body)});const order=await r.json();if(!r.ok)return res.status(r.status).json(order);const store=await pool.query(`SELECT pickup_address FROM merchant_storefronts WHERE business_id=$1`,[quote.business_id]);const client=await pool.connect();try{await client.query('BEGIN');await client.query(`UPDATE delivery_quotes SET status='used' WHERE id=$1`,[quote.id]);await client.query(`UPDATE orders SET delivery_fee=$1,total=subtotal+$1,outstanding_amount=(subtotal+$1)-paid_amount,updated_at=NOW() WHERE id=$2`,[quote.fee,order.id]);const d=await client.query(`INSERT INTO deliveries(order_id,quote_id,business_id,customer_account_id,status,delivery_fee,currency_code,route_distance_km,estimated_weight_kg,estimated_volume_l,pickup_address,pickup_lat,pickup_lng,dropoff_address,dropoff_lat,dropoff_lng) VALUES($1,$2,$3,$4,'quoted',$5,'PHP',$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,[order.id,quote.id,quote.business_id,me.account.id,quote.fee,quote.route_distance_km,quote.estimated_weight_kg,quote.estimated_volume_l,store.rows[0]?.pickup_address||'',quote.pickup_lat,quote.pickup_lng,clean(req.body?.delivery_address||me.account.address,500),quote.dropoff_lat,quote.dropoff_lng]);await client.query('COMMIT');const updated=await upstream(`/api/orders/${order.id}`,{headers:{Authorization:authHeader(req)}}).then(x=>x.json());res.status(201).json({...updated,delivery_id:d.rows[0].id})}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}}catch(e){next(e)}})

app.put('/api/delivery/store-location',body,async(req,res,next)=>{try{const{business:b}=await requireMerchant(req,Number(req.body?.business_id||undefined)),lat=Number(req.body?.lat),lng=Number(req.body?.lng);if(!finite(lat)||!finite(lng)||lat<-90||lat>90||lng<-180||lng>180)return res.status(400).json({error:'Valid coordinates required'});await pool.query(`UPDATE merchant_storefronts SET pickup_lat=$1,pickup_lng=$2,updated_at=NOW() WHERE business_id=$3`,[lat,lng,b.id]);res.json({ok:true,pickup_lat:lat,pickup_lng:lng})}catch(e){next(e)}})
app.get('/api/delivery/merchant',async(req,res,next)=>{try{const{business:b}=await requireMerchant(req,Number(req.query.business_id||undefined));const{rows}=await pool.query(`SELECT d.*,o.order_number,o.order_status,o.payment_status,cp.display_name courier_name,cp.vehicle_type FROM deliveries d JOIN orders o ON o.id=d.order_id LEFT JOIN courier_profiles cp ON cp.account_id=d.courier_account_id WHERE d.business_id=$1 ORDER BY d.created_at DESC LIMIT 200`,[b.id]);res.json(rows)}catch(e){next(e)}})
app.post('/api/delivery/:id/request-courier',body,async(req,res,next)=>{try{const id=Number(req.params.id),d=await deliveryDetail(id);if(!d)return res.status(404).json({error:'Delivery not found'});const{me}=await requireMerchant(req,d.business_id);if(d.order_status!=='ready')return res.status(409).json({error:'Order must be ready before courier dispatch'});if(d.payment_status!=='paid')return res.status(409).json({error:'Delivery order must be paid before dispatch'});if(!['quoted','requested'].includes(d.status))return res.status(409).json({error:'Delivery is already in dispatch'});await pool.query(`UPDATE deliveries SET status='awaiting_courier',requested_at=COALESCE(requested_at,NOW()),updated_at=NOW() WHERE id=$1`,[id]);res.json(await deliveryDetail(id))}catch(e){next(e)}})

app.get('/api/courier/delivery-profile',async(req,res,next)=>{try{const me=await requireCourier(req);const [p,docs,deliveries]=await Promise.all([pool.query(`SELECT * FROM courier_profiles WHERE account_id=$1`,[me.account.id]),pool.query(`SELECT id,document_type,vehicle_class,reference_number,issue_date,expiry_date,verification_status,rejection_reason,created_at FROM courier_documents WHERE account_id=$1 ORDER BY created_at DESC`,[me.account.id]),pool.query(`SELECT d.*,o.order_number,b.name business_name FROM deliveries d JOIN orders o ON o.id=d.order_id JOIN businesses b ON b.id=d.business_id WHERE d.courier_account_id=$1 ORDER BY d.created_at DESC LIMIT 100`,[me.account.id])]);res.json({profile:p.rows[0]||null,documents:docs.rows,deliveries:deliveries.rows})}catch(e){next(e)}})
app.post('/api/courier/documents',body,async(req,res,next)=>{try{const me=await requireCourier(req),doc=evidence(req.body?.evidence_data_url);if(!doc||!clean(req.body?.document_type,80))return res.status(400).json({error:'Document type and evidence are required'});const{rows}=await pool.query(`INSERT INTO courier_documents(account_id,document_type,vehicle_class,reference_number,issue_date,expiry_date,evidence_data_url,verification_status) VALUES($1,$2,$3,$4,$5,$6,$7,'submitted') RETURNING id,document_type,vehicle_class,reference_number,issue_date,expiry_date,verification_status,created_at`,[me.account.id,clean(req.body.document_type,80),clean(req.body?.vehicle_class,40),clean(req.body?.reference_number,120),req.body?.issue_date||null,req.body?.expiry_date||null,doc]);res.status(201).json(rows[0])}catch(e){next(e)}})
app.put('/api/courier/availability',body,async(req,res,next)=>{try{const me=await requireCourier(req);const p=await pool.query(`SELECT eligibility_status,eligibility_expires_at FROM courier_profiles WHERE account_id=$1`,[me.account.id]);if(!p.rowCount)return res.status(404).json({error:'Courier profile missing'});const row=p.rows[0],expired=row.eligibility_expires_at&&new Date(row.eligibility_expires_at)<new Date();if(req.body?.available&&(row.eligibility_status!=='approved'||expired))return res.status(403).json({error:'Admin approval is required before becoming available'});await pool.query(`UPDATE courier_profiles SET available=$1,updated_at=NOW() WHERE account_id=$2`,[Boolean(req.body?.available),me.account.id]);res.json({ok:true,available:Boolean(req.body?.available)})}catch(e){next(e)}})
app.post('/api/courier/deliveries/:id/status',body,async(req,res,next)=>{try{const me=await requireCourier(req),id=Number(req.params.id),nextStatus=clean(req.body?.status,60);const d=await deliveryDetail(id);if(!d||Number(d.courier_account_id)!==Number(me.account.id))return res.status(404).json({error:'Assigned delivery not found'});const flow={courier_assigned:['courier_en_route_to_merchant'],courier_en_route_to_merchant:['courier_arrived_at_merchant'],courier_arrived_at_merchant:['picked_up'],picked_up:['in_transit'],in_transit:['courier_arrived_at_customer']}[d.status]||[];if(!flow.includes(nextStatus))return res.status(409).json({error:`Cannot move delivery from ${d.status} to ${nextStatus}`});const stamp={courier_en_route_to_merchant:'en_route_to_merchant_at',courier_arrived_at_merchant:'arrived_merchant_at',picked_up:'picked_up_at',in_transit:'in_transit_at',courier_arrived_at_customer:'arrived_customer_at'}[nextStatus];const client=await pool.connect();try{await client.query('BEGIN');await client.query(`UPDATE deliveries SET status=$1,${stamp}=NOW(),updated_at=NOW() WHERE id=$2`,[nextStatus,id]);if(nextStatus==='picked_up'){await client.query(`UPDATE orders SET order_status='handoff_to_delivery',handoff_at=COALESCE(handoff_at,NOW()),updated_at=NOW() WHERE id=$1 AND order_status='ready'`,[d.order_id]);await client.query(`INSERT INTO order_status_events(order_id,from_status,to_status,actor_account_id,note) SELECT id,'ready','handoff_to_delivery',$1,'Courier picked up order' FROM orders WHERE id=$2`,[me.account.id,d.order_id])}await client.query('COMMIT');res.json(await deliveryDetail(id))}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}}catch(e){next(e)}})
app.post('/api/courier/deliveries/:id/location',body,async(req,res,next)=>{try{const me=await requireCourier(req),id=Number(req.params.id),lat=Number(req.body?.lat),lng=Number(req.body?.lng);if(!finite(lat)||!finite(lng)||lat<-90||lat>90||lng<-180||lng>180)return res.status(400).json({error:'Valid coordinates required'});const d=await deliveryDetail(id);if(!d||Number(d.courier_account_id)!==Number(me.account.id))return res.status(404).json({error:'Assigned delivery not found'});if(!activeTracking(d.status))return res.status(409).json({error:'Tracking is closed for this delivery'});await pool.query(`UPDATE deliveries SET last_lat=$1,last_lng=$2,last_location_at=NOW(),updated_at=NOW() WHERE id=$3`,[lat,lng,id]);res.json({ok:true,at:new Date().toISOString()})}catch(e){next(e)}})
app.post('/api/courier/deliveries/:id/complete',body,async(req,res,next)=>{try{const me=await requireCourier(req),id=Number(req.params.id),d=await deliveryDetail(id);if(!d||Number(d.courier_account_id)!==Number(me.account.id))return res.status(404).json({error:'Assigned delivery not found'});if(d.status!=='courier_arrived_at_customer')return res.status(409).json({error:'Courier must arrive at customer before completion'});if(clean(req.body?.completion_code,20)!==completionCode(id))return res.status(403).json({error:'Customer delivery code is incorrect'});const client=await pool.connect();try{await client.query('BEGIN');await client.query(`UPDATE deliveries SET status='delivered',delivered_at=NOW(),last_lat=NULL,last_lng=NULL,last_location_at=NULL,updated_at=NOW() WHERE id=$1`,[id]);await client.query(`UPDATE orders SET order_status='completed',completed_at=COALESCE(completed_at,NOW()),updated_at=NOW() WHERE id=$1`,[d.order_id]);await client.query(`INSERT INTO order_status_events(order_id,from_status,to_status,actor_account_id,note) VALUES($1,$2,'completed',$3,'Delivery completed with customer code')`,[d.order_id,d.order_status,me.account.id]);await client.query('COMMIT');res.json(await deliveryDetail(id))}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}}catch(e){next(e)}})

app.get('/api/delivery/mine',async(req,res,next)=>{try{const me=await requireCustomer(req);const{rows}=await pool.query(`SELECT d.*,o.order_number,b.name business_name,cp.display_name courier_name,cp.vehicle_type FROM deliveries d JOIN orders o ON o.id=d.order_id JOIN businesses b ON b.id=d.business_id LEFT JOIN courier_profiles cp ON cp.account_id=d.courier_account_id WHERE d.customer_account_id=$1 ORDER BY d.created_at DESC LIMIT 100`,[me.account.id]);res.json(rows.map(d=>({...d,completion_code:activeTracking(d.status)?completionCode(d.id):null,last_lat:activeTracking(d.status)?d.last_lat:null,last_lng:activeTracking(d.status)?d.last_lng:null})))}catch(e){next(e)}})
app.get('/api/delivery/:id/live',async(req,res,next)=>{try{const d=await deliveryDetail(Number(req.params.id));if(!d)return res.status(404).json({error:'Delivery not found'});const me=await allowedDelivery(req,d),rule=await activeRule();const customer=Number(me.account.id)===Number(d.customer_account_id);res.json({...d,last_lat:activeTracking(d.status)?d.last_lat:null,last_lng:activeTracking(d.status)?d.last_lng:null,completion_code:customer&&activeTracking(d.status)?completionCode(d.id):undefined,eta_minutes:etaMinutes(d,rule),distance_to_dropoff_km:d.last_lat&&d.last_lng?Math.round(haversine(Number(d.last_lat),Number(d.last_lng),Number(d.dropoff_lat),Number(d.dropoff_lng))*100)/100:null})}catch(e){next(e)}})

app.get('/api/admin/delivery/pricing',async(req,res,next)=>{try{await requireAdmin(req);const{rows}=await pool.query(`SELECT * FROM delivery_pricing_rules WHERE country_code='PH' ORDER BY version DESC`);res.json(rows)}catch(e){next(e)}})
app.put('/api/admin/delivery/pricing',body,async(req,res,next)=>{try{const me=await requireAdmin(req);for(const k of ['base_fee','per_km','per_kg','per_liter','minimum_fee','route_factor'])if(!finite(req.body?.[k])||Number(req.body[k])<0)return res.status(400).json({error:`${k} must be zero or greater`});if(Number(req.body.route_factor)<1)return res.status(400).json({error:'route_factor must be at least 1'});const v=await pool.query(`SELECT COALESCE(MAX(version),0)+1 version FROM delivery_pricing_rules WHERE country_code='PH'`),version=Number(v.rows[0].version);const client=await pool.connect();try{await client.query('BEGIN');if(req.body?.active!==false)await client.query(`UPDATE delivery_pricing_rules SET active=FALSE WHERE country_code='PH'`);const{rows}=await client.query(`INSERT INTO delivery_pricing_rules(country_code,version,active,base_fee,per_km,per_kg,per_liter,minimum_fee,maximum_distance_km,route_factor,average_speed_bicycle_kmh,average_speed_motorbike_kmh,average_speed_car_kmh,created_by_account_id) VALUES('PH',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,[version,req.body?.active!==false,req.body.base_fee,req.body.per_km,req.body.per_kg,req.body.per_liter,req.body.minimum_fee,req.body?.maximum_distance_km==null?null:Number(req.body.maximum_distance_km),req.body.route_factor,req.body?.average_speed_bicycle_kmh||null,req.body?.average_speed_motorbike_kmh||null,req.body?.average_speed_car_kmh||null,me.account.id]);await client.query('COMMIT');res.json(rows[0])}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}}catch(e){next(e)}})
app.get('/api/admin/couriers',async(req,res,next)=>{try{await requireAdmin(req);const{rows}=await pool.query(`SELECT a.id account_id,a.display_name,a.email,c.display_name courier_name,c.vehicle_type,c.available,c.eligibility_status,c.approved_vehicle_class,c.eligibility_expires_at,c.approval_note,(SELECT COUNT(*) FROM courier_documents d WHERE d.account_id=a.id AND d.verification_status='submitted')::int submitted_documents FROM accounts a JOIN profiles p ON p.account_id=a.id AND p.role='courier' AND p.enabled=TRUE JOIN courier_profiles c ON c.account_id=a.id ORDER BY c.eligibility_status='approved' DESC,a.display_name`);res.json(rows)}catch(e){next(e)}})
app.patch('/api/admin/couriers/:accountId',body,async(req,res,next)=>{try{const me=await requireAdmin(req),id=Number(req.params.accountId),status=clean(req.body?.eligibility_status,30);if(!['pending','approved','suspended','revoked','expired'].includes(status))return res.status(400).json({error:'Invalid eligibility status'});await pool.query(`UPDATE courier_profiles SET eligibility_status=$1,approved_vehicle_class=$2,eligibility_expires_at=$3,approval_note=$4,available=CASE WHEN $1='approved' THEN available ELSE FALSE END,updated_at=NOW() WHERE account_id=$5`,[status,clean(req.body?.approved_vehicle_class,40),req.body?.eligibility_expires_at||null,clean(req.body?.approval_note,600),id]);if(Array.isArray(req.body?.document_updates))for(const d of req.body.document_updates){if(!['verified','rejected','expired'].includes(d.status))continue;await pool.query(`UPDATE courier_documents SET verification_status=$1,verified_by_account_id=$2,verified_at=CASE WHEN $1='verified' THEN NOW() ELSE verified_at END,rejection_reason=$3,updated_at=NOW() WHERE id=$4 AND account_id=$5`,[d.status,me.account.id,clean(d.rejection_reason,500),Number(d.id),id])}res.json({ok:true})}catch(e){next(e)}})
app.post('/api/admin/deliveries/:id/assign',body,async(req,res,next)=>{try{await requireAdmin(req);const id=Number(req.params.id),courierId=Number(req.body?.courier_account_id),d=await deliveryDetail(id);if(!d)return res.status(404).json({error:'Delivery not found'});if(!['awaiting_courier','requested'].includes(d.status))return res.status(409).json({error:'Delivery is not waiting for assignment'});const c=await pool.query(`SELECT * FROM courier_profiles WHERE account_id=$1 AND eligibility_status='approved' AND available=TRUE AND (eligibility_expires_at IS NULL OR eligibility_expires_at>NOW())`,[courierId]);if(!c.rowCount)return res.status(409).json({error:'Courier is not approved and available'});await pool.query(`UPDATE deliveries SET courier_account_id=$1,vehicle_class=COALESCE(NULLIF($2,''),$3),status='courier_assigned',assigned_at=NOW(),updated_at=NOW() WHERE id=$4`,[courierId,clean(req.body?.vehicle_class,40),c.rows[0].approved_vehicle_class||c.rows[0].vehicle_type,id]);res.json(await deliveryDetail(id))}catch(e){next(e)}})

function proxy(req,res){const headers={...req.headers,host:`127.0.0.1:${upstreamPort}`};const up=http.request({hostname:'127.0.0.1',port:upstreamPort,path:req.originalUrl,method:req.method,headers},ur=>{res.statusCode=ur.statusCode||502;for(const[k,v]of Object.entries(ur.headers))if(v!==undefined)res.setHeader(k,v);ur.pipe(res)});up.on('error',e=>{console.error(e);if(!res.headersSent)res.status(502).json({error:'Delivery upstream unavailable'})});req.pipe(up)}
app.use(proxy)
app.use((err,_req,res,_next)=>{console.error(err);if(res.headersSent)return;res.status(err.status||500).json({error:err.status?err.message:'Unexpected server error'})})

function start(){child=spawn(process.execPath,['server-suppliers.js'],{cwd:__dirname,env:{...process.env,PORT:String(upstreamPort),INTERNAL_SERVICES_PORT:String(servicesPort),INTERNAL_MARKETPLACE_PORT:String(marketplacePort),INTERNAL_ORDERS_PORT:String(ordersPort),INTERNAL_AUTH_PORT:String(authPort),INTERNAL_ACCOUNTING_PORT:String(accountingPort)},stdio:'inherit'});child.on('exit',code=>{if(!shuttingDown){console.error(`Supplier child exited ${code}`);process.exit(code||1)}})}
async function wait(){for(let i=0;i<140;i++){try{const r=await upstream('/health');if(r.ok)return}catch{}await new Promise(r=>setTimeout(r,250))}throw new Error('Supplier child failed health check')}
async function shutdown(sig){if(shuttingDown)return;shuttingDown=true;console.log(`Received ${sig}`);if(child&&!child.killed)child.kill('SIGTERM');await pool.end().catch(()=>{});process.exit(0)}
process.on('SIGTERM',()=>shutdown('SIGTERM'));process.on('SIGINT',()=>shutdown('SIGINT'));
start();wait().then(initDb).then(()=>app.listen(port,'0.0.0.0',()=>console.log(`Business & Life delivery server listening on ${port}`))).catch(e=>{console.error(e);process.exit(1)});
