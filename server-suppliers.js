import express from 'express';
import crypto from 'node:crypto';
import pg from 'pg';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureCatalogMediaSchema,mediaForEntities,listCatalogMedia,createCatalogUpload,reorderCatalogMedia,approveCatalogMedia,archiveCatalogMedia } from './catalog-media-core.js';
import { ensureMonetizationSchema,recordMonetizableCompletion } from './monetization-core.js';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const upstreamPort = Number(process.env.INTERNAL_SERVICES_PORT || 3507);
const marketplacePort = Number(process.env.INTERNAL_MARKETPLACE_PORT || 3407);
const ordersPort = Number(process.env.INTERNAL_ORDERS_PORT || 3307);
const authPort = Number(process.env.INTERNAL_AUTH_PORT || 3207);
const accountingPort = Number(process.env.INTERNAL_ACCOUNTING_PORT || 3107);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined });
const body = express.json({ limit: '3mb' });
let child;
let shuttingDown = false;

function clean(v,max=500){return String(v??'').trim().slice(0,max)}
function num(v){return Number(v)}
function finite(v){return Number.isFinite(num(v))}
function positive(v){return finite(v)&&num(v)>0}
function tok(){return crypto.randomBytes(24).toString('base64url')}
function authHeader(req){return req.headers.authorization||''}
async function upstream(path,options={}){return fetch(`http://127.0.0.1:${upstreamPort}${path}`,options)}
async function identity(req){const r=await upstream('/api/me',{headers:{Authorization:authHeader(req)}});const b=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(b.error||'Unauthorized'),{status:r.status});return b}
function enabled(me,role){return me?.profiles?.some(p=>p.role===role&&p.enabled)}
function business(me,id=null){const list=me?.businesses||[];return id==null?(list[0]||null):(list.find(b=>Number(b.id)===Number(id))||null)}
async function requireMerchant(req,businessId=null){const me=await identity(req);if(!enabled(me,'merchant'))throw Object.assign(new Error('Merchant profile required'),{status:403});const b=business(me,businessId);if(!b)throw Object.assign(new Error('Business workspace unavailable'),{status:403});return{me,business:b}}
async function requireSupplier(req){const me=await identity(req);if(!enabled(me,'supplier'))throw Object.assign(new Error('Supplier profile required'),{status:403});return me}
async function supplierOwnedCatalogItem(req){
  const me=await requireSupplier(req),id=Number(req.params.id);
  if(!Number.isInteger(id)||id<1)throw Object.assign(new Error('Invalid catalog item'),{status:400});
  const q=await pool.query(`SELECT * FROM supplier_catalog_items WHERE id=$1 AND supplier_account_id=$2`,[id,me.account.id]);
  if(!q.rowCount)throw Object.assign(new Error('Catalog item not found'),{status:404});
  return{me,item:q.rows[0]};
}
function orderNumber(id){return `PO-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${String(id).padStart(5,'0')}`}

async function initDb(){await ensureMonetizationSchema(pool);await pool.query(`
  ALTER TABLE supplier_profiles ADD COLUMN IF NOT EXISTS service_area TEXT NOT NULL DEFAULT '';
  ALTER TABLE supplier_profiles ADD COLUMN IF NOT EXISTS normal_lead_days INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE supplier_profiles ADD COLUMN IF NOT EXISTS minimum_order_value NUMERIC(12,2);
  ALTER TABLE supplier_profiles ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';

  CREATE TABLE IF NOT EXISTS supplier_relationships (
    business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    supplier_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    state TEXT NOT NULL DEFAULT 'pending',
    invited_by_account_id BIGINT REFERENCES accounts(id),
    invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    note TEXT NOT NULL DEFAULT '',
    PRIMARY KEY(business_id,supplier_account_id),
    CHECK (state IN ('invited','pending','accepted','blocked','revoked'))
  );

  CREATE TABLE IF NOT EXISTS supplier_catalog_items (
    id BIGSERIAL PRIMARY KEY,
    supplier_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    product_name TEXT NOT NULL,
    sku TEXT NOT NULL DEFAULT '',
    unit_name TEXT NOT NULL DEFAULT 'pack',
    base_unit TEXT NOT NULL DEFAULT 'unit',
    base_units_per_pack NUMERIC(14,4) NOT NULL DEFAULT 1 CHECK(base_units_per_pack>0),
    price_per_pack NUMERIC(12,2) NOT NULL CHECK(price_per_pack>=0),
    minimum_packs NUMERIC(12,3) NOT NULL DEFAULT 1,
    availability_status TEXT NOT NULL DEFAULT 'available',
    lead_time_days INTEGER NOT NULL DEFAULT 1,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (availability_status IN ('available','limited','unavailable')),
    UNIQUE(supplier_account_id,product_name,sku)
  );

  CREATE TABLE IF NOT EXISTS merchant_supplier_item_links (
    business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    catalog_item_id BIGINT NOT NULL REFERENCES supplier_catalog_items(id) ON DELETE CASCADE,
    legacy_inventory_id BIGINT REFERENCES inventory(id) ON DELETE SET NULL,
    merchant_item_name TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(business_id,catalog_item_id)
  );

  CREATE TABLE IF NOT EXISTS purchase_orders (
    id BIGSERIAL PRIMARY KEY,
    po_number TEXT UNIQUE,
    public_token TEXT UNIQUE NOT NULL,
    business_id BIGINT NOT NULL REFERENCES businesses(id),
    supplier_account_id BIGINT NOT NULL REFERENCES accounts(id),
    status TEXT NOT NULL DEFAULT 'draft',
    fulfilment_mode TEXT NOT NULL DEFAULT 'delivery',
    subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
    delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
    expected_total NUMERIC(12,2) NOT NULL DEFAULT 0,
    actual_received_total NUMERIC(12,2) NOT NULL DEFAULT 0,
    payment_status TEXT NOT NULL DEFAULT 'unpaid',
    paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    requested_date DATE,
    supplier_ready_at TIMESTAMPTZ,
    supplier_delivery_eta TIMESTAMPTZ,
    supplier_note TEXT NOT NULL DEFAULT '',
    merchant_note TEXT NOT NULL DEFAULT '',
    sent_at TIMESTAMPTZ,
    accepted_at TIMESTAMPTZ,
    dispatched_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK(status IN ('draft','sent','supplier_received','accepted','partially_accepted','preparing','ready_for_pickup','out_for_delivery','delivered','partially_received','received','cancelled','rejected')),
    CHECK(fulfilment_mode IN ('delivery','pickup'))
  );

  CREATE TABLE IF NOT EXISTS purchase_order_items (
    id BIGSERIAL PRIMARY KEY,
    purchase_order_id BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    catalog_item_id BIGINT REFERENCES supplier_catalog_items(id),
    name_snapshot TEXT NOT NULL,
    sku_snapshot TEXT NOT NULL DEFAULT '',
    unit_name_snapshot TEXT NOT NULL,
    base_unit_snapshot TEXT NOT NULL,
    base_units_per_pack_snapshot NUMERIC(14,4) NOT NULL,
    ordered_packs NUMERIC(12,3) NOT NULL CHECK(ordered_packs>0),
    confirmed_packs NUMERIC(12,3),
    received_packs NUMERIC(12,3) NOT NULL DEFAULT 0,
    price_per_pack_snapshot NUMERIC(12,2) NOT NULL,
    confirmed_price_per_pack NUMERIC(12,2),
    line_total NUMERIC(12,2) NOT NULL,
    supplier_note TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS po_items_po_idx ON purchase_order_items(purchase_order_id);

  CREATE TABLE IF NOT EXISTS purchase_receipts (
    id BIGSERIAL PRIMARY KEY,
    purchase_order_id BIGINT NOT NULL REFERENCES purchase_orders(id),
    received_by_account_id BIGINT REFERENCES accounts(id),
    note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS purchase_receipt_items (
    receipt_id BIGINT NOT NULL REFERENCES purchase_receipts(id) ON DELETE CASCADE,
    purchase_order_item_id BIGINT NOT NULL REFERENCES purchase_order_items(id),
    received_packs NUMERIC(12,3) NOT NULL CHECK(received_packs>0),
    received_base_units NUMERIC(14,4) NOT NULL,
    actual_price_per_pack NUMERIC(12,2) NOT NULL,
    legacy_inventory_id BIGINT REFERENCES inventory(id),
    PRIMARY KEY(receipt_id,purchase_order_item_id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS supplier_payment_tx_unique ON transactions(source,source_id) WHERE source='supplier_payment';
`);await ensureCatalogMediaSchema(pool)}

async function relationship(businessId,supplierId){const r=await pool.query(`SELECT r.*,a.display_name,s.supplier_name,s.description,s.delivery_available,s.service_area,s.normal_lead_days,s.minimum_order_value FROM supplier_relationships r JOIN accounts a ON a.id=r.supplier_account_id LEFT JOIN supplier_profiles s ON s.account_id=r.supplier_account_id WHERE r.business_id=$1 AND r.supplier_account_id=$2`,[businessId,supplierId]);return r.rows[0]||null}
async function catalog(supplierId){const{rows}=await pool.query(`SELECT * FROM supplier_catalog_items WHERE supplier_account_id=$1 AND active=TRUE ORDER BY availability_status='available' DESC,product_name`,[supplierId]);const media=await mediaForEntities(pool,{entityType:'supplier_catalog_item',entityIds:rows.map(x=>x.id),publicOnly:false});return rows.map(row=>{const images=media.get(Number(row.id))||[];const primary=images.find(x=>x.is_primary&&x.approval_status==='approved'&&x.public_visible)||null;return{...row,images,image_data_url:primary?.data_url||'',image_source_type:primary?.source_type||''}})}
async function poDetail(id){const q=await pool.query(`SELECT p.*,b.name business_name,a.display_name supplier_account_name,s.supplier_name FROM purchase_orders p JOIN businesses b ON b.id=p.business_id JOIN accounts a ON a.id=p.supplier_account_id LEFT JOIN supplier_profiles s ON s.account_id=a.id WHERE p.id=$1`,[id]);if(!q.rowCount)return null;const items=await pool.query(`SELECT i.*,l.legacy_inventory_id,inv.item legacy_inventory_name FROM purchase_order_items i LEFT JOIN merchant_supplier_item_links l ON l.business_id=$1 AND l.catalog_item_id=i.catalog_item_id LEFT JOIN inventory inv ON inv.id=l.legacy_inventory_id WHERE i.purchase_order_id=$2 ORDER BY i.id`,[q.rows[0].business_id,id]);return{...q.rows[0],items:items.rows}}

app.get('/health',async(_q,r)=>{try{await pool.query('SELECT 1');const c=await upstream('/health');r.status(c.ok?200:503).json({ok:c.ok,db:true,services:c.ok,version:'0.5-supplier-procurement'})}catch{r.status(503).json({ok:false,db:false,services:false,version:'0.5-supplier-procurement'})}})
app.get('/suppliers.css',(_q,r)=>r.type('text/css').send(readFileSync(join(__dirname,'public','suppliers.css'),'utf8')))
app.get('/suppliers-ui.js',(_q,r)=>r.type('application/javascript').send(readFileSync(join(__dirname,'public','suppliers-ui.js'),'utf8')))
async function root(req,res){const r=await upstream(req.path,{headers:{...req.headers,host:`127.0.0.1:${upstreamPort}`}});let html=await r.text();html=html.replace('</head>','  <link rel="stylesheet" href="/suppliers.css" />\n</head>').replace('</body>','  <script type="module" src="/suppliers-ui.js"></script>\n</body>');res.status(r.status).type('html').send(html)}
app.get('/',root);app.get('/index.html',root)

app.get('/api/supplier/me',async(req,res,next)=>{try{const me=await requireSupplier(req);res.json({profile:me.supplier||null,catalog:await catalog(me.account.id)})}catch(e){next(e)}})
app.put('/api/supplier/me',body,async(req,res,next)=>{try{const me=await requireSupplier(req);await pool.query(`INSERT INTO supplier_profiles(account_id,supplier_name,description,delivery_available,service_area,normal_lead_days,minimum_order_value,notes,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW()) ON CONFLICT(account_id) DO UPDATE SET supplier_name=EXCLUDED.supplier_name,description=EXCLUDED.description,delivery_available=EXCLUDED.delivery_available,service_area=EXCLUDED.service_area,normal_lead_days=EXCLUDED.normal_lead_days,minimum_order_value=EXCLUDED.minimum_order_value,notes=EXCLUDED.notes,updated_at=NOW()`,[me.account.id,clean(req.body?.supplier_name,150)||me.account.display_name,clean(req.body?.description,1200),Boolean(req.body?.delivery_available),clean(req.body?.service_area,300),Math.max(0,Math.min(365,Number(req.body?.normal_lead_days)||1)),req.body?.minimum_order_value===''||req.body?.minimum_order_value==null?null:Number(req.body.minimum_order_value),clean(req.body?.notes,1000)]);res.json({profile:(await identity(req)).supplier,catalog:await catalog(me.account.id)})}catch(e){next(e)}})
app.post('/api/supplier/catalog',body,async(req,res,next)=>{try{const me=await requireSupplier(req);if(!clean(req.body?.product_name,160)||!finite(req.body?.price_per_pack)||Number(req.body.price_per_pack)<0||!positive(req.body?.base_units_per_pack))return res.status(400).json({error:'Product name, pack conversion and price are required'});const{rows}=await pool.query(`INSERT INTO supplier_catalog_items(supplier_account_id,product_name,sku,unit_name,base_unit,base_units_per_pack,price_per_pack,minimum_packs,availability_status,lead_time_days,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE) RETURNING *`,[me.account.id,clean(req.body.product_name,160),clean(req.body?.sku,80),clean(req.body?.unit_name,50)||'pack',clean(req.body?.base_unit,50)||'unit',Number(req.body.base_units_per_pack),Number(req.body.price_per_pack),positive(req.body?.minimum_packs)?Number(req.body.minimum_packs):1,['available','limited','unavailable'].includes(req.body?.availability_status)?req.body.availability_status:'available',Math.max(0,Math.min(365,Number(req.body?.lead_time_days)||1))]);res.status(201).json(rows[0])}catch(e){if(e.code==='23505')return res.status(409).json({error:'This catalog item already exists'});next(e)}})
app.patch('/api/supplier/catalog/:id',body,async(req,res,next)=>{try{const me=await requireSupplier(req);const old=await pool.query(`SELECT * FROM supplier_catalog_items WHERE id=$1 AND supplier_account_id=$2`,[Number(req.params.id),me.account.id]);if(!old.rowCount)return res.status(404).json({error:'Catalog item not found'});const x=old.rows[0];const{rows}=await pool.query(`UPDATE supplier_catalog_items SET product_name=$1,sku=$2,unit_name=$3,base_unit=$4,base_units_per_pack=$5,price_per_pack=$6,minimum_packs=$7,availability_status=$8,lead_time_days=$9,active=$10,updated_at=NOW() WHERE id=$11 RETURNING *`,[clean(req.body?.product_name??x.product_name,160),clean(req.body?.sku??x.sku,80),clean(req.body?.unit_name??x.unit_name,50),clean(req.body?.base_unit??x.base_unit,50),Number(req.body?.base_units_per_pack??x.base_units_per_pack),Number(req.body?.price_per_pack??x.price_per_pack),Number(req.body?.minimum_packs??x.minimum_packs),['available','limited','unavailable'].includes(req.body?.availability_status)?req.body.availability_status:x.availability_status,Number(req.body?.lead_time_days??x.lead_time_days),req.body?.active??x.active,x.id]);res.json(rows[0])}catch(e){next(e)}})


app.post('/api/supplier/catalog/:id/images/upload',body,async(req,res,next)=>{
  try{
    const{me,item}=await supplierOwnedCatalogItem(req);
    const media=await createCatalogUpload(pool,{
      accountId:Number(me.account.id),
      entityType:'supplier_catalog_item',
      entityId:Number(item.id),
      sourceType:'supplier_upload',
      dataUrl:req.body?.data_url,
      altText:clean(req.body?.alt_text,300)||`${item.product_name} supplier product photo`
    });
    res.status(201).json({
      media,
      images:await listCatalogMedia(pool,{entityType:'supplier_catalog_item',entityId:Number(item.id)}),
      approval_required:true,
      image_standard:{aspect_ratio:'1:1',background:'#FFFFFF'}
    });
  }catch(e){next(e)}
});

app.post('/api/supplier/catalog/:id/images/reorder',body,async(req,res,next)=>{
  try{
    const{item}=await supplierOwnedCatalogItem(req);
    res.json({images:await reorderCatalogMedia(pool,{
      entityType:'supplier_catalog_item',entityId:Number(item.id),mediaIds:req.body?.media_ids
    })});
  }catch(e){next(e)}
});

app.post('/api/supplier/catalog/:id/images/:mediaId/approve',body,async(req,res,next)=>{
  try{
    const{me,item}=await supplierOwnedCatalogItem(req);
    const media=await approveCatalogMedia(pool,{
      accountId:Number(me.account.id),entityType:'supplier_catalog_item',entityId:Number(item.id),
      mediaId:Number(req.params.mediaId),makePrimary:req.body?.primary!==false
    });
    res.json({media,images:await listCatalogMedia(pool,{entityType:'supplier_catalog_item',entityId:Number(item.id)})});
  }catch(e){next(e)}
});

app.post('/api/supplier/catalog/:id/images/:mediaId/archive',body,async(req,res,next)=>{
  try{
    const{item}=await supplierOwnedCatalogItem(req);
    res.json(await archiveCatalogMedia(pool,{entityType:'supplier_catalog_item',entityId:Number(item.id),mediaId:Number(req.params.mediaId)}));
  }catch(e){next(e)}
});

app.post('/api/procurement/relationships/invite',body,async(req,res,next)=>{try{const{me,business:b}=await requireMerchant(req,Number(req.body?.business_id||undefined));const email=clean(req.body?.supplier_email,160).toLowerCase();const a=await pool.query(`SELECT a.id,a.display_name FROM accounts a JOIN profiles p ON p.account_id=a.id AND p.role='supplier' AND p.enabled=TRUE WHERE LOWER(a.email)=$1`,[email]);if(!a.rowCount)return res.status(404).json({error:'No active Supplier profile uses that email yet'});if(Number(a.rows[0].id)===Number(me.account.id))return res.status(409).json({error:'Use a different Supplier account for this relationship'});await pool.query(`INSERT INTO supplier_relationships(business_id,supplier_account_id,state,invited_by_account_id,note) VALUES($1,$2,'invited',$3,$4) ON CONFLICT(business_id,supplier_account_id) DO UPDATE SET state='invited',invited_by_account_id=EXCLUDED.invited_by_account_id,invited_at=NOW(),revoked_at=NULL,note=EXCLUDED.note`,[b.id,a.rows[0].id,me.account.id,clean(req.body?.note,500)]);res.status(201).json(await relationship(b.id,a.rows[0].id))}catch(e){next(e)}})
app.get('/api/procurement/relationships',async(req,res,next)=>{try{const me=await identity(req);if(enabled(me,'merchant')){const b=business(me,Number(req.query.business_id||undefined));if(!b)return res.status(403).json({error:'Business unavailable'});const{rows}=await pool.query(`SELECT r.*,a.display_name,s.supplier_name,s.description,s.delivery_available,s.service_area,s.normal_lead_days,s.minimum_order_value FROM supplier_relationships r JOIN accounts a ON a.id=r.supplier_account_id LEFT JOIN supplier_profiles s ON s.account_id=a.id WHERE r.business_id=$1 ORDER BY r.state='accepted' DESC,COALESCE(s.supplier_name,a.display_name)`,[b.id]);return res.json(rows)}if(enabled(me,'supplier')){const{rows}=await pool.query(`SELECT r.*,b.name business_name FROM supplier_relationships r JOIN businesses b ON b.id=r.business_id WHERE r.supplier_account_id=$1 ORDER BY r.invited_at DESC`,[me.account.id]);return res.json(rows)}res.status(403).json({error:'Merchant or Supplier profile required'})}catch(e){next(e)}})
app.post('/api/supplier/relationships/:businessId/respond',body,async(req,res,next)=>{try{const me=await requireSupplier(req);const state=req.body?.accept?'accepted':'revoked';const{rows}=await pool.query(`UPDATE supplier_relationships SET state=$1,accepted_at=CASE WHEN $1='accepted' THEN NOW() ELSE accepted_at END,revoked_at=CASE WHEN $1='revoked' THEN NOW() ELSE NULL END WHERE business_id=$2 AND supplier_account_id=$3 AND state IN ('invited','pending','accepted') RETURNING *`,[state,Number(req.params.businessId),me.account.id]);if(!rows.length)return res.status(404).json({error:'Relationship invitation not found'});res.json(rows[0])}catch(e){next(e)}})
app.get('/api/procurement/suppliers/:supplierId/catalog',async(req,res,next)=>{try{const{business:b}=await requireMerchant(req,Number(req.query.business_id||undefined));const rel=await relationship(b.id,Number(req.params.supplierId));if(!rel||rel.state!=='accepted')return res.status(403).json({error:'Accepted Supplier relationship required'});const items=await catalog(Number(req.params.supplierId));const links=await pool.query(`SELECT * FROM merchant_supplier_item_links WHERE business_id=$1`,[b.id]);const map=new Map(links.rows.map(x=>[Number(x.catalog_item_id),x]));res.json({supplier:rel,items:items.map(x=>({...x,link:map.get(Number(x.id))||null}))})}catch(e){next(e)}})
app.put('/api/procurement/catalog/:catalogId/link',body,async(req,res,next)=>{try{const{business:b}=await requireMerchant(req,Number(req.body?.business_id||undefined));const catalogId=Number(req.params.catalogId);const item=await pool.query(`SELECT supplier_account_id,product_name FROM supplier_catalog_items WHERE id=$1`,[catalogId]);if(!item.rowCount)return res.status(404).json({error:'Catalog item not found'});const rel=await relationship(b.id,item.rows[0].supplier_account_id);if(!rel||rel.state!=='accepted')return res.status(403).json({error:'Accepted relationship required'});const inventoryId=req.body?.legacy_inventory_id?Number(req.body.legacy_inventory_id):null;if(inventoryId&&Number(b.id)!==1)return res.status(409).json({error:'Legacy inventory linking is currently available only for the initial Merchant workspace'});if(inventoryId){const inv=await pool.query(`SELECT id FROM inventory WHERE id=$1`,[inventoryId]);if(!inv.rowCount)return res.status(404).json({error:'Inventory item not found'})}await pool.query(`INSERT INTO merchant_supplier_item_links(business_id,catalog_item_id,legacy_inventory_id,merchant_item_name) VALUES($1,$2,$3,$4) ON CONFLICT(business_id,catalog_item_id) DO UPDATE SET legacy_inventory_id=EXCLUDED.legacy_inventory_id,merchant_item_name=EXCLUDED.merchant_item_name`,[b.id,catalogId,inventoryId,clean(req.body?.merchant_item_name,150)||item.rows[0].product_name]);res.json({ok:true})}catch(e){next(e)}})

app.post('/api/procurement/orders',body,async(req,res,next)=>{try{const{business:b}=await requireMerchant(req,Number(req.body?.business_id||undefined));const supplierId=Number(req.body?.supplier_account_id);const rel=await relationship(b.id,supplierId);if(!rel||rel.state!=='accepted')return res.status(403).json({error:'Accepted Supplier relationship required'});const raw=Array.isArray(req.body?.items)?req.body.items:[];if(!raw.length||raw.length>100)return res.status(400).json({error:'Purchase order needs 1–100 items'});const ids=[...new Set(raw.map(x=>Number(x.catalog_item_id)).filter(Number.isInteger))];const c=await pool.query(`SELECT * FROM supplier_catalog_items WHERE supplier_account_id=$1 AND id=ANY($2::bigint[]) AND active=TRUE`,[supplierId,ids]);if(c.rowCount!==ids.length)return res.status(409).json({error:'One or more Supplier items are unavailable'});const byId=new Map(c.rows.map(x=>[Number(x.id),x]));const client=await pool.connect();try{await client.query('BEGIN');let subtotal=0;const lines=[];for(const r of raw){const item=byId.get(Number(r.catalog_item_id)),packs=Number(r.packs);if(!item||!positive(packs)||packs<Number(item.minimum_packs))throw Object.assign(new Error(`Invalid quantity for ${item?.product_name||'item'}`),{status:400});const line=Math.round(Number(item.price_per_pack)*packs*100)/100;subtotal+=line;lines.push({item,packs,line})}subtotal=Math.round(subtotal*100)/100;const deliveryFee=Math.max(0,Number(req.body?.delivery_fee)||0),total=Math.round((subtotal+deliveryFee)*100)/100;const po=await client.query(`INSERT INTO purchase_orders(public_token,business_id,supplier_account_id,status,fulfilment_mode,subtotal,delivery_fee,expected_total,requested_date,merchant_note,sent_at) VALUES($1,$2,$3,'sent',$4,$5,$6,$7,$8,$9,NOW()) RETURNING *`,[tok(),b.id,supplierId,req.body?.fulfilment_mode==='pickup'?'pickup':'delivery',subtotal,deliveryFee,total,req.body?.requested_date||null,clean(req.body?.merchant_note,1000)]);const id=Number(po.rows[0].id),number=orderNumber(id);await client.query(`UPDATE purchase_orders SET po_number=$1 WHERE id=$2`,[number,id]);for(const l of lines)await client.query(`INSERT INTO purchase_order_items(purchase_order_id,catalog_item_id,name_snapshot,sku_snapshot,unit_name_snapshot,base_unit_snapshot,base_units_per_pack_snapshot,ordered_packs,price_per_pack_snapshot,line_total) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[id,l.item.id,l.item.product_name,l.item.sku,l.item.unit_name,l.item.base_unit,l.item.base_units_per_pack,l.packs,l.item.price_per_pack,l.line]);await client.query('COMMIT');res.status(201).json(await poDetail(id))}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}}catch(e){next(e)}})
app.get('/api/procurement/orders',async(req,res,next)=>{try{const me=await identity(req);let rows;if(enabled(me,'merchant')){const b=business(me,Number(req.query.business_id||undefined));if(!b)return res.status(403).json({error:'Business unavailable'});({rows}=await pool.query(`SELECT p.*,COALESCE(s.supplier_name,a.display_name) supplier_name FROM purchase_orders p JOIN accounts a ON a.id=p.supplier_account_id LEFT JOIN supplier_profiles s ON s.account_id=a.id WHERE p.business_id=$1 ORDER BY p.created_at DESC LIMIT 200`,[b.id]))}else if(enabled(me,'supplier'))({rows}=await pool.query(`SELECT p.*,b.name business_name FROM purchase_orders p JOIN businesses b ON b.id=p.business_id WHERE p.supplier_account_id=$1 ORDER BY p.created_at DESC LIMIT 200`,[me.account.id]));else return res.status(403).json({error:'Merchant or Supplier profile required'});res.json(rows)}catch(e){next(e)}})
app.get('/api/procurement/orders/:id',async(req,res,next)=>{try{const me=await identity(req),po=await poDetail(Number(req.params.id));if(!po)return res.status(404).json({error:'PO not found'});const allowed=Number(po.supplier_account_id)===Number(me.account.id)||Boolean(business(me,po.business_id));if(!allowed)return res.status(403).json({error:'Not allowed'});res.json(po)}catch(e){next(e)}})
app.post('/api/supplier/orders/:id/respond',body,async(req,res,next)=>{try{const me=await requireSupplier(req),id=Number(req.params.id),client=await pool.connect();try{await client.query('BEGIN');const po=await client.query(`SELECT * FROM purchase_orders WHERE id=$1 AND supplier_account_id=$2 FOR UPDATE`,[id,me.account.id]);if(!po.rowCount)throw Object.assign(new Error('PO not found'),{status:404});if(!['sent','supplier_received','accepted','partially_accepted'].includes(po.rows[0].status))throw Object.assign(new Error('PO cannot be changed now'),{status:409});if(req.body?.reject){await client.query(`UPDATE purchase_orders SET status='rejected',supplier_note=$1,updated_at=NOW() WHERE id=$2`,[clean(req.body?.supplier_note,1000),id]);await client.query('COMMIT');return res.json(await poDetail(id))}const changes=Array.isArray(req.body?.items)?req.body.items:[];let partial=false;for(const ch of changes){const itemId=Number(ch.item_id),packs=Number(ch.confirmed_packs),price=Number(ch.confirmed_price_per_pack);if(!Number.isInteger(itemId)||!Number.isFinite(packs)||packs<0||!Number.isFinite(price)||price<0)continue;const old=await client.query(`SELECT ordered_packs FROM purchase_order_items WHERE id=$1 AND purchase_order_id=$2`,[itemId,id]);if(!old.rowCount)continue;if(packs<Number(old.rows[0].ordered_packs))partial=true;await client.query(`UPDATE purchase_order_items SET confirmed_packs=$1,confirmed_price_per_pack=$2,supplier_note=$3 WHERE id=$4`,[packs,price,clean(ch.supplier_note,500),itemId])}await client.query(`UPDATE purchase_order_items SET confirmed_packs=COALESCE(confirmed_packs,ordered_packs),confirmed_price_per_pack=COALESCE(confirmed_price_per_pack,price_per_pack_snapshot) WHERE purchase_order_id=$1`,[id]);const sum=await client.query(`SELECT COALESCE(SUM(confirmed_packs*confirmed_price_per_pack),0) subtotal FROM purchase_order_items WHERE purchase_order_id=$1`,[id]);await client.query(`UPDATE purchase_orders SET status=$1,subtotal=$2,expected_total=$2+delivery_fee,supplier_ready_at=$3,supplier_delivery_eta=$4,supplier_note=$5,accepted_at=COALESCE(accepted_at,NOW()),updated_at=NOW() WHERE id=$6`,[partial?'partially_accepted':'accepted',sum.rows[0].subtotal,req.body?.supplier_ready_at||null,req.body?.supplier_delivery_eta||null,clean(req.body?.supplier_note,1000),id]);await client.query('COMMIT');res.json(await poDetail(id))}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}}catch(e){next(e)}})
app.post('/api/supplier/orders/:id/status',body,async(req,res,next)=>{try{const me=await requireSupplier(req),id=Number(req.params.id),status=clean(req.body?.status,40);if(!['preparing','ready_for_pickup','out_for_delivery','delivered'].includes(status))return res.status(400).json({error:'Unsupported Supplier status'});const{rows}=await pool.query(`UPDATE purchase_orders SET status=$1,dispatched_at=CASE WHEN $1='out_for_delivery' THEN NOW() ELSE dispatched_at END,supplier_ready_at=CASE WHEN $1='ready_for_pickup' THEN COALESCE(supplier_ready_at,NOW()) ELSE supplier_ready_at END,supplier_note=COALESCE(NULLIF($2,''),supplier_note),updated_at=NOW() WHERE id=$3 AND supplier_account_id=$4 AND status NOT IN ('received','cancelled','rejected') RETURNING *`,[status,clean(req.body?.supplier_note,800),id,me.account.id]);if(!rows.length)return res.status(409).json({error:'PO cannot move to that status'});res.json(await poDetail(id))}catch(e){next(e)}})

app.post('/api/procurement/orders/:id/receive',body,async(req,res,next)=>{try{const id=Number(req.params.id),po=await poDetail(id);if(!po)return res.status(404).json({error:'PO not found'});const{me,business:b}=await requireMerchant(req,po.business_id);const received=Array.isArray(req.body?.items)?req.body.items:[];if(!received.length)return res.status(400).json({error:'Enter received quantities'});const client=await pool.connect();try{await client.query('BEGIN');const lock=await client.query(`SELECT * FROM purchase_orders WHERE id=$1 FOR UPDATE`,[id]);if(['received','cancelled','rejected'].includes(lock.rows[0].status))throw Object.assign(new Error('PO can no longer be received'),{status:409});const receipt=await client.query(`INSERT INTO purchase_receipts(purchase_order_id,received_by_account_id,note) VALUES($1,$2,$3) RETURNING id`,[id,me.account.id,clean(req.body?.note,800)]);let actual=0;for(const r of received){const itemId=Number(r.item_id),packs=Number(r.received_packs);if(!positive(packs))continue;const item=await client.query(`SELECT i.*,l.legacy_inventory_id FROM purchase_order_items i LEFT JOIN merchant_supplier_item_links l ON l.business_id=$1 AND l.catalog_item_id=i.catalog_item_id WHERE i.id=$2 AND i.purchase_order_id=$3 FOR UPDATE`,[b.id,itemId,id]);if(!item.rowCount)continue;const x=item.rows[0],maxPacks=Number(x.confirmed_packs??x.ordered_packs),remaining=maxPacks-Number(x.received_packs);if(packs>remaining+1e-9)throw Object.assign(new Error(`Received quantity for ${x.name_snapshot} exceeds remaining confirmed quantity`),{status:409});const baseUnits=packs*Number(x.base_units_per_pack_snapshot),price=Number(r.actual_price_per_pack??x.confirmed_price_per_pack??x.price_per_pack_snapshot);if(!Number.isFinite(price)||price<0)throw Object.assign(new Error('Actual price is invalid'),{status:400});if(x.legacy_inventory_id){if(Number(b.id)!==1)throw Object.assign(new Error('Legacy inventory mapping does not belong to this business'),{status:409});await client.query(`UPDATE inventory SET quantity=quantity+$1,unit_cost=$2,updated_at=NOW() WHERE id=$3`,[baseUnits,price/Number(x.base_units_per_pack_snapshot),x.legacy_inventory_id])}await client.query(`INSERT INTO purchase_receipt_items(receipt_id,purchase_order_item_id,received_packs,received_base_units,actual_price_per_pack,legacy_inventory_id) VALUES($1,$2,$3,$4,$5,$6)`,[receipt.rows[0].id,x.id,packs,baseUnits,price,x.legacy_inventory_id]);await client.query(`UPDATE purchase_order_items SET received_packs=received_packs+$1 WHERE id=$2`,[packs,x.id]);actual+=packs*price}const remaining=await client.query(`SELECT COUNT(*)::int open_count FROM purchase_order_items WHERE purchase_order_id=$1 AND received_packs+0.000001<COALESCE(confirmed_packs,ordered_packs)`,[id]);const status=Number(remaining.rows[0].open_count)===0?'received':'partially_received';await client.query(`UPDATE purchase_orders SET status=$1,actual_received_total=actual_received_total+$2,received_at=CASE WHEN $1='received' THEN NOW() ELSE received_at END,updated_at=NOW() WHERE id=$3`,[status,Math.round(actual*100)/100,id]);if(status==='received'){const done=await client.query(`SELECT p.received_at,p.actual_received_total,p.supplier_account_id,b.territory_id FROM purchase_orders p JOIN businesses b ON b.id=p.business_id WHERE p.id=$1`,[id]);const x=done.rows[0];await recordMonetizableCompletion(client,{serviceScope:'supplier',subjectType:'account',subjectId:x.supplier_account_id,sourceType:'purchase_order',sourceId:id,territoryId:x.territory_id,completedAt:x.received_at,grossValue:x.actual_received_total,currencyCode:'PHP'})}await client.query('COMMIT');res.json(await poDetail(id))}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}}catch(e){next(e)}})
app.post('/api/procurement/orders/:id/payment',body,async(req,res,next)=>{try{const id=Number(req.params.id),po=await poDetail(id);if(!po)return res.status(404).json({error:'PO not found'});const{me,business:b}=await requireMerchant(req,po.business_id);const amount=Number(req.body?.amount),account=clean(req.body?.account,30);if(!positive(amount)||!['cash','gcash','bank','other'].includes(account))return res.status(400).json({error:'Valid payment amount and account required'});const outstanding=Math.max(0,Number(po.expected_total)-Number(po.paid_amount));if(amount>outstanding+0.001)return res.status(409).json({error:'Payment exceeds PO outstanding amount'});const paid=Math.round((Number(po.paid_amount)+amount)*100)/100,status=paid+0.001>=Number(po.expected_total)?'paid':'partial';const client=await pool.connect();try{await client.query('BEGIN');await client.query(`UPDATE purchase_orders SET paid_amount=$1,payment_status=$2,updated_at=NOW() WHERE id=$3`,[paid,status,id]);if(Number(b.id)===1){const tx=await client.query(`INSERT INTO transactions(type,category,amount,payment_method,account,note,source,source_id,occurred_at) VALUES('business_expense','Supplier payment',$1,$2,$2,$3,'supplier_payment',$4,NOW()) RETURNING id`,[amount,account,`Payment for ${po.po_number}`,id*1000000+Math.round(paid*100)]);void tx}await client.query('COMMIT');res.json(await poDetail(id))}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}}catch(e){next(e)}})

app.get('/api/procurement/reorder-suggestions',async(req,res,next)=>{try{const{business:b}=await requireMerchant(req,Number(req.query.business_id||undefined));if(Number(b.id)!==1)return res.json([]);const{rows}=await pool.query(`SELECT i.id inventory_id,i.item,i.quantity,i.reorder_level,i.unit,i.unit_cost,l.catalog_item_id,c.product_name,c.unit_name,c.base_unit,c.base_units_per_pack,c.price_per_pack,c.minimum_packs,c.lead_time_days,c.supplier_account_id,COALESCE(s.supplier_name,a.display_name) supplier_name FROM inventory i LEFT JOIN merchant_supplier_item_links l ON l.business_id=1 AND l.legacy_inventory_id=i.id LEFT JOIN supplier_catalog_items c ON c.id=l.catalog_item_id AND c.active=TRUE LEFT JOIN accounts a ON a.id=c.supplier_account_id LEFT JOIN supplier_profiles s ON s.account_id=c.supplier_account_id WHERE i.quantity<=i.reorder_level ORDER BY (i.reorder_level-i.quantity) DESC`);res.json(rows.map(x=>({...x,suggested_packs:x.catalog_item_id?Math.max(Number(x.minimum_packs||1),Math.ceil(Math.max(0,Number(x.reorder_level)-Number(x.quantity))/Number(x.base_units_per_pack||1))):null})))}catch(e){next(e)}})

app.get('/api/procurement/respond/:token',async(req,res,next)=>{try{const po=await pool.query(`SELECT p.id,p.po_number,p.status,p.fulfilment_mode,p.subtotal,p.delivery_fee,p.expected_total,p.requested_date,p.merchant_note,b.name business_name FROM purchase_orders p JOIN businesses b ON b.id=p.business_id WHERE p.public_token=$1`,[clean(req.params.token,100)]);if(!po.rowCount)return res.status(404).json({error:'Purchase order not found'});const items=await pool.query(`SELECT id,name_snapshot,sku_snapshot,unit_name_snapshot,ordered_packs,price_per_pack_snapshot,line_total FROM purchase_order_items WHERE purchase_order_id=$1 ORDER BY id`,[po.rows[0].id]);res.json({...po.rows[0],items:items.rows})}catch(e){next(e)}})

function proxy(req,res){const headers={...req.headers,host:`127.0.0.1:${upstreamPort}`};const up=http.request({hostname:'127.0.0.1',port:upstreamPort,path:req.originalUrl,method:req.method,headers},ur=>{res.statusCode=ur.statusCode||502;for(const[k,v]of Object.entries(ur.headers))if(v!==undefined)res.setHeader(k,v);ur.pipe(res)});up.on('error',e=>{console.error(e);if(!res.headersSent)res.status(502).json({error:'Supplier upstream unavailable'})});req.pipe(up)}
app.use(proxy)
app.use((err,_req,res,_next)=>{console.error(err);if(res.headersSent)return;res.status(err.status||500).json({error:err.status?err.message:'Unexpected server error'})})

function start(){child=spawn(process.execPath,['server-services.js'],{cwd:__dirname,env:{...process.env,PORT:String(upstreamPort),INTERNAL_MARKETPLACE_PORT:String(marketplacePort),INTERNAL_ORDERS_PORT:String(ordersPort),INTERNAL_AUTH_PORT:String(authPort),INTERNAL_ACCOUNTING_PORT:String(accountingPort)},stdio:'inherit'});child.on('exit',code=>{if(!shuttingDown){console.error(`Services child exited ${code}`);process.exit(code||1)}})}
async function wait(){for(let i=0;i<120;i++){try{const r=await upstream('/health');if(r.ok)return}catch{}await new Promise(r=>setTimeout(r,250))}throw new Error('Services child failed health check')}
async function shutdown(sig){if(shuttingDown)return;shuttingDown=true;console.log(`Received ${sig}`);if(child&&!child.killed)child.kill('SIGTERM');await pool.end().catch(()=>{});process.exit(0)}
process.on('SIGTERM',()=>shutdown('SIGTERM'));process.on('SIGINT',()=>shutdown('SIGINT'));
start();wait().then(initDb).then(()=>app.listen(port,'0.0.0.0',()=>console.log(`Business & Life supplier procurement server listening on ${port}`))).catch(e=>{console.error(e);process.exit(1)});
