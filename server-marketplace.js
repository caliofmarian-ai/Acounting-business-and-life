import express from 'express';
import pg from 'pg';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureCatalogMediaSchema,mediaForEntities,listCatalogMedia,buildPreparedFoodImagePrompt,generateCatalogImage,approveCatalogMedia,archiveCatalogMedia } from './catalog-media-core.js';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const internalOrdersPort = Number(process.env.INTERNAL_ORDERS_PORT || 3307);
const internalAuthPort = Number(process.env.INTERNAL_AUTH_PORT || 3207);
const internalAccountingPort = Number(process.env.INTERNAL_ACCOUNTING_PORT || 3107);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined });
const jsonBody = express.json({ limit: '500kb' });
const body = (req,res,next) => req.body !== undefined ? next() : jsonBody(req,res,next);
let ordersChild;
let ordersReady=false;
let shuttingDown = false;

function clean(v,max=300){return String(v??'').trim().slice(0,max)}
function n(v){return Number(v)}
function positive(v){return Number.isFinite(n(v))&&n(v)>0}
function money(v){return Math.round((n(v)+Number.EPSILON)*100)/100}
function token(){return crypto.randomBytes(24).toString('base64url')}
function authHeader(req){return req.headers.authorization || ''}
async function childFetch(path,options={}){return fetch(`http://127.0.0.1:${internalOrdersPort}${path}`,options)}
export function isMarketplaceOwnedPath(path='',method='GET'){
  const pathname=String(path||'').split('?')[0];
  if(['/marketplace.css','/marketplace-ui.js','/guest-explore.css','/guest-explore.js'].includes(pathname))return true;
  if(pathname.startsWith('/api/public/marketplace/'))return true;
  if(pathname.startsWith('/api/marketplace/'))return true;
  if(pathname==='/api/merchant/storefront'||pathname.startsWith('/api/merchant/storefront/'))return true;
  if(/^\/api\/orders\/merchant\/[^/]+\/(?:start|cancel)$/.test(pathname))return true;
  return false;
}
export async function marketplaceFetch(path,options={}){
  const pathname=String(path||'').split('?')[0];
  const method=String(options.method||'GET').toUpperCase();
  if(isMarketplaceOwnedPath(pathname,method)){
    throw Object.assign(new Error('Marketplace-owned paths require in-process Marketplace dispatch'),{
      status:500,code:'MARKETPLACE_EMBEDDED_DISPATCH_REQUIRED'
    });
  }
  if(pathname==='/health'){
    try{
      await pool.query('SELECT 1');
      const orders=await childFetch('/health',{headers:options.headers||{}});
      const ok=ordersReady&&orders.ok;
      return new Response(JSON.stringify({ok,db:true,orders:ok,version:'0.7-marketplace'}),{
        status:ok?200:503,headers:{'content-type':'application/json; charset=utf-8'}
      });
    }catch{
      return new Response(JSON.stringify({ok:false,db:false,orders:false,version:'0.7-marketplace'}),{
        status:503,headers:{'content-type':'application/json; charset=utf-8'}
      });
    }
  }
  if(pathname==='/'||pathname==='/index.html'){
    const headers={...(options.headers||{}),host:`127.0.0.1:${internalOrdersPort}`};
    const r=await childFetch(path,{...options,headers});
    let html=await r.text();
    html=html.replace('</head>','  <link rel="stylesheet" href="/marketplace.css" />\n  <link rel="stylesheet" href="/guest-explore.css" />\n</head>')
      .replace('</body>','  <script type="module" src="/marketplace-ui.js"></script>\n  <script type="module" src="/guest-explore.js"></script>\n</body>');
    return new Response(html,{status:r.status,headers:{'content-type':'text/html; charset=utf-8'}});
  }
  return childFetch(path,options);
}
async function identity(req){const r=await marketplaceFetch('/api/me',{headers:{Authorization:authHeader(req)}});const b=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(b.error||'Unauthorized'),{status:r.status});return b}
function enabled(me,role){return me?.profiles?.some(p=>p.role===role&&p.enabled)}
function merchantBusiness(me,id=null){const list=me?.businesses||[];return id==null?(list[0]||null):(list.find(b=>Number(b.id)===Number(id))||null)}
async function requireMerchant(req,businessId=null){const me=await identity(req);if(!enabled(me,'merchant'))throw Object.assign(new Error('Merchant profile required'),{status:403});const business=merchantBusiness(me,businessId);if(!business)throw Object.assign(new Error('Business workspace not available'),{status:403});return{me,business}}
async function requireCustomer(req){const me=await identity(req);if(!enabled(me,'customer'))throw Object.assign(new Error('Customer profile required'),{status:403});return me}

async function initDb(){await pool.query(`
  CREATE TABLE IF NOT EXISTS merchant_storefronts (
    business_id BIGINT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
    store_name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    merchant_domain TEXT NOT NULL DEFAULT 'food',
    publication_status TEXT NOT NULL DEFAULT 'draft',
    pickup_address TEXT NOT NULL DEFAULT '',
    opening_status TEXT NOT NULL DEFAULT 'open',
    preparation_eta_minutes INTEGER NOT NULL DEFAULT 15,
    pickup_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    delivery_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    cash_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    online_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    public_reputation_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    price_comparison_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    logo_data_url TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (merchant_domain IN ('food','non_food','mixed')),
    CHECK (publication_status IN ('draft','published','paused')),
    CHECK (opening_status IN ('open','busy','closed'))
  );

  CREATE TABLE IF NOT EXISTS marketplace_products (
    id BIGSERIAL PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    legacy_product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
    inventory_id BIGINT REFERENCES inventory(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'General',
    product_domain TEXT NOT NULL DEFAULT 'food',
    product_kind TEXT NOT NULL DEFAULT 'prepared_food',
    unit_code TEXT NOT NULL DEFAULT 'item',
    quantity_per_unit NUMERIC(12,4) NOT NULL DEFAULT 1,
    selling_price NUMERIC(12,2) NOT NULL CHECK (selling_price >= 0),
    stock_tracked BOOLEAN NOT NULL DEFAULT FALSE,
    stock_quantity NUMERIC(14,4),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    published BOOLEAN NOT NULL DEFAULT FALSE,
    image_data_url TEXT NOT NULL DEFAULT '',
    price_comparison_override BOOLEAN,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (product_domain IN ('food','non_food')),
    UNIQUE(business_id,name)
  );
  ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS inventory_id BIGINT REFERENCES inventory(id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS marketplace_products_inventory_idx ON marketplace_products(business_id,inventory_id) WHERE inventory_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS marketplace_products_public_idx ON marketplace_products(business_id,product_domain,published,active);
  CREATE UNIQUE INDEX IF NOT EXISTS marketplace_products_legacy_unique ON marketplace_products(business_id,legacy_product_id) WHERE legacy_product_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS marketplace_stock_events (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    marketplace_product_id BIGINT NOT NULL REFERENCES marketplace_products(id),
    quantity NUMERIC(14,4) NOT NULL,
    action TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(order_id,marketplace_product_id,action)
  );

  INSERT INTO merchant_storefronts(business_id,store_name,description,merchant_domain,publication_status,pickup_address,preparation_eta_minutes,pickup_enabled,cash_enabled)
    SELECT b.id,b.name,'Local business on Business & Life','food','draft','',15,TRUE,TRUE
    FROM businesses b WHERE b.id=1
    ON CONFLICT(business_id) DO NOTHING;
`);await ensureCatalogMediaSchema(pool)}

async function publicStorefronts(domain=''){const args=[];let extra='';if(['food','non_food'].includes(domain)){args.push(domain);extra=` AND (s.merchant_domain=$1 OR s.merchant_domain='mixed')`}const{rows}=await pool.query(`SELECT s.business_id,s.store_name,s.description,s.merchant_domain,s.pickup_address,s.opening_status,s.preparation_eta_minutes,s.pickup_enabled,s.delivery_enabled,s.cash_enabled,s.online_enabled,s.public_reputation_enabled,s.logo_data_url,COUNT(p.id)::int product_count,MIN(p.selling_price) min_price FROM merchant_storefronts s LEFT JOIN marketplace_products p ON p.business_id=s.business_id AND p.published=TRUE AND p.active=TRUE WHERE s.publication_status='published'${extra} GROUP BY s.business_id ORDER BY s.opening_status='open' DESC,s.store_name`,args);return rows}
async function storefront(businessId,includePrivate=false){const q=await pool.query(`SELECT s.*,b.country_code,b.currency_code FROM merchant_storefronts s JOIN businesses b ON b.id=s.business_id WHERE s.business_id=$1 ${includePrivate?'':"AND s.publication_status='published'"}`,[businessId]);return q.rows[0]||null}
async function attachProductMedia(rows,publicOnly=false){
  const media=await mediaForEntities(pool,{entityType:'marketplace_product',entityIds:rows.map(x=>x.id),publicOnly});
  return rows.map(row=>{
    const images=media.get(Number(row.id))||[];
    const primary=images.find(x=>x.is_primary&&x.approval_status==='approved'&&x.public_visible)||null;
    return{...row,images,image_data_url:primary?.data_url||row.image_data_url||'',image_source_type:primary?.source_type||(row.image_data_url?'legacy_upload':'')};
  });
}
async function products(businessId,includePrivate=false){
  const query=includePrivate
    ?`SELECT p.*,i.item inventory_item_name,i.quantity inventory_quantity,i.unit inventory_unit,i.unit_cost inventory_unit_cost FROM marketplace_products p LEFT JOIN inventory i ON i.id=p.inventory_id AND i.business_id=p.business_id WHERE p.business_id=$1 ORDER BY p.category,p.name`
    :`SELECT p.* FROM marketplace_products p WHERE p.business_id=$1 AND p.published=TRUE AND p.active=TRUE ORDER BY p.category,p.name`;
  const{rows}=await pool.query(query,[businessId]);return attachProductMedia(rows,!includePrivate)
}

// Guest/public read-only boundary. These projections intentionally do not reuse internal objects.
async function guestPublicStorefronts(domain=''){
  const args=[];let extra='';
  if(['food','non_food'].includes(domain)){args.push(domain);extra=` AND (s.merchant_domain=$1 OR s.merchant_domain='mixed')`}
  const {rows}=await pool.query(`SELECT s.business_id,s.store_name,s.description,s.merchant_domain,s.opening_status,s.preparation_eta_minutes,s.pickup_enabled,s.delivery_enabled,s.cash_enabled,s.online_enabled,s.public_reputation_enabled,s.logo_data_url,COUNT(p.id)::int product_count,MIN(p.selling_price) min_price FROM merchant_storefronts s LEFT JOIN marketplace_products p ON p.business_id=s.business_id AND p.published=TRUE AND p.active=TRUE WHERE s.publication_status='published'${extra} GROUP BY s.business_id ORDER BY s.opening_status='open' DESC,s.store_name`,args);
  return rows;
}
async function guestPublicStorefront(businessId){
  const q=await pool.query(`SELECT s.business_id,s.store_name,s.description,s.merchant_domain,s.opening_status,s.preparation_eta_minutes,s.pickup_enabled,s.delivery_enabled,s.cash_enabled,s.online_enabled,s.public_reputation_enabled,s.logo_data_url,b.country_code,b.currency_code FROM merchant_storefronts s JOIN businesses b ON b.id=s.business_id WHERE s.business_id=$1 AND s.publication_status='published'`,[businessId]);
  return q.rows[0]||null;
}
async function guestPublicProducts(businessId){
  const {rows}=await pool.query(`SELECT id,business_id,name,description,category,product_domain,product_kind,unit_code,quantity_per_unit,selling_price,image_data_url FROM marketplace_products WHERE business_id=$1 AND published=TRUE AND active=TRUE ORDER BY category,name`,[businessId]);
  return attachProductMedia(rows,true);
}

async function importLegacyProducts(businessId){const r=await pool.query(`INSERT INTO marketplace_products(business_id,legacy_product_id,name,description,category,product_domain,product_kind,unit_code,quantity_per_unit,selling_price,stock_tracked,stock_quantity,active,published) SELECT p.business_id,p.id,p.name,'',p.category,'food','prepared_food','item',1,p.selling_price,FALSE,NULL,p.active,FALSE FROM products p WHERE p.business_id=$1 AND COALESCE(p.product_kind,'prepared_recipe')='prepared_recipe' ON CONFLICT(business_id,legacy_product_id) WHERE legacy_product_id IS NOT NULL DO UPDATE SET name=EXCLUDED.name,category=EXCLUDED.category,selling_price=EXCLUDED.selling_price,active=EXCLUDED.active,updated_at=NOW() RETURNING id`,[businessId]);return r.rowCount}

function manilaStamp(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const x=Object.fromEntries(parts.map(p=>[p.type,p.value]));return `${x.year}${x.month}${x.day}`}
async function trust(client,businessId,customerId){const count=await client.query(`SELECT COUNT(*)::int count FROM orders WHERE business_id=$1 AND customer_account_id=$2 AND order_status='completed'`,[businessId,customerId]);const s=await client.query(`SELECT allow_remote_cash_prep,trust_suspended_at FROM merchant_customer_settings WHERE business_id=$1 AND customer_account_id=$2`,[businessId,customerId]);const c=Number(count.rows[0]?.count||0),row=s.rows[0];return{eligible:c>=5&&!row?.trust_suspended_at,allowed:c>=5&&Boolean(row?.allow_remote_cash_prep)&&!row?.trust_suspended_at}}

async function createMarketplaceOrder(req){
  const me=await requireCustomer(req);
  const customerId=Number(me.account.id),businessId=Number(req.body?.business_id),ids=[],qty=new Map();
  for(const raw of req.body?.items||[]){
    const id=Number(raw.product_id),q=Number(raw.quantity);
    if(!Number.isInteger(id)||!positive(q))throw Object.assign(new Error('Every basket item needs a valid quantity'),{status:400});
    ids.push(id);qty.set(id,(qty.get(id)||0)+q);
  }
  if(!ids.length||ids.length>50)throw Object.assign(new Error('Basket needs 1–50 items'),{status:400});
  const store=await storefront(businessId,false);
  if(!store)throw Object.assign(new Error('Storefront is not available'),{status:404});
  if(store.opening_status==='closed')throw Object.assign(new Error('This merchant is currently closed'),{status:409});
  const fulfilment=clean(req.body?.fulfilment_method,20),payment=clean(req.body?.payment_method,20);
  if(!['pickup','delivery'].includes(fulfilment))throw Object.assign(new Error('Choose pickup or delivery'),{status:400});
  if(!['cash','online'].includes(payment))throw Object.assign(new Error('Choose cash or online payment'),{status:400});
  if(fulfilment==='pickup'&&!store.pickup_enabled)throw Object.assign(new Error('Pickup is not enabled for this merchant'),{status:409});
  if(fulfilment==='delivery'&&!store.delivery_enabled)throw Object.assign(new Error('Delivery is not enabled for this merchant'),{status:409});
  if(payment==='cash'&&!store.cash_enabled)throw Object.assign(new Error('Cash is not enabled for this merchant'),{status:409});
  if(payment==='online'&&!store.online_enabled)throw Object.assign(new Error('Online payment is not enabled for this merchant yet'),{status:409});
  if(fulfilment==='delivery'&&payment==='cash')throw Object.assign(new Error('Cash delivery is not enabled yet'),{status:409});

  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const p=await client.query(`SELECT * FROM marketplace_products WHERE business_id=$1 AND id=ANY($2::bigint[]) AND published=TRUE AND active=TRUE FOR SHARE`,[businessId,[...new Set(ids)]]);
    if(p.rowCount!==new Set(ids).size)throw Object.assign(new Error('One or more basket items are unavailable'),{status:409});
    let subtotal=0;
    const snapshots=[];
    for(const row of p.rows){
      const q=qty.get(Number(row.id));
      let unitCost=0;
      if(row.inventory_id){
        const inv=await client.query(`SELECT item,quantity,unit,unit_cost FROM inventory WHERE id=$1 AND business_id=$2 FOR SHARE`,[row.inventory_id,businessId]);
        if(!inv.rowCount)throw Object.assign(new Error(`${row.name} is not linked to valid Merchant stock`),{status:409});
        const required=Number(row.quantity_per_unit)*q;
        if(Number(inv.rows[0].quantity)+1e-9<required)throw Object.assign(new Error(`${row.name} does not have enough stock`),{status:409});
        unitCost=Number(row.quantity_per_unit)*Number(inv.rows[0].unit_cost);
      }else if(row.legacy_product_id){
        const cost=await client.query(`SELECT COALESCE(SUM(r.quantity*i.unit_cost),0) cost FROM recipes r JOIN inventory i ON i.id=r.inventory_id WHERE r.product_id=$1 AND i.business_id=$2`,[row.legacy_product_id,businessId]);
        unitCost=Number(cost.rows[0]?.cost||0);
      }else if(row.stock_tracked&&row.stock_quantity!=null){
        if(Number(row.stock_quantity)+1e-9<q)throw Object.assign(new Error(`${row.name} does not have enough stock`),{status:409});
      }
      const line=money(Number(row.selling_price)*q),cogs=money(unitCost*q),gross=money(line-cogs);
      subtotal+=line;snapshots.push({row,q,line,unitCost,cogs,gross});
    }
    subtotal=money(subtotal);

    const t=await trust(client,businessId,customerId);
    let status='awaiting_payment';
    if(payment==='cash'&&fulfilment==='pickup')status=t.allowed?'accepted':'awaiting_customer_presence';
    const deliveryAddress=fulfilment==='delivery'?clean(req.body?.delivery_address||me.account.address,400):'';
    if(fulfilment==='delivery'&&!deliveryAddress)throw Object.assign(new Error('Delivery address is required'),{status:400});
    const publicToken=token();
    const o=await client.query(`INSERT INTO orders(public_token,business_id,customer_account_id,customer_name_snapshot,customer_contact_snapshot,fulfilment_method,delivery_address,order_status,payment_status,payment_method,currency_code,subtotal,delivery_fee,total,paid_amount,outstanding_amount,preparation_eta_minutes,note,remote_cash_eligible,remote_cash_allowed,accepted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'unpaid',$9,$10,$11,0,$11,0,$11,$12,$13,$14,$15,CASE WHEN $8='accepted' THEN NOW() END) RETURNING *`,[publicToken,businessId,customerId,me.account.display_name,me.account.email||me.account.phone,fulfilment,deliveryAddress,status,payment,store.currency_code||'PHP',subtotal,Math.max(1,Math.min(240,Number(store.preparation_eta_minutes)||15)),clean(req.body?.note,400),t.eligible,t.allowed]);
    const orderId=Number(o.rows[0].id),number=`BL-${manilaStamp()}-${String(orderId).padStart(5,'0')}`;
    await client.query(`UPDATE orders SET order_number=$1 WHERE id=$2`,[number,orderId]);
    for(const x of snapshots){
      await client.query(`INSERT INTO order_items(order_id,source_kind,source_id,name_snapshot,category_snapshot,quantity,unit_price_snapshot,unit_cost_snapshot,line_total,estimated_cogs,estimated_gross_profit) VALUES($1,'marketplace_product',$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[orderId,x.row.id,x.row.name,x.row.category,x.q,x.row.selling_price,x.unitCost,x.line,x.cogs,x.gross]);
    }
    await client.query(`INSERT INTO order_status_events(order_id,from_status,to_status,actor_account_id,note) VALUES($1,NULL,$2,$3,'Marketplace checkout')`,[orderId,status,customerId]);
    await client.query('COMMIT');
    return(await childFetch(`/api/orders/${orderId}`,{headers:{Authorization:authHeader(req)}})).json();
  }catch(e){
    try{await client.query('ROLLBACK')}catch{}
    throw e;
  }finally{client.release()}
}

async function marketplaceOrderKind(orderId){const r=await pool.query(`SELECT EXISTS(SELECT 1 FROM order_items WHERE order_id=$1 AND source_kind='marketplace_product') has_marketplace`,[orderId]);return Boolean(r.rows[0]?.has_marketplace)}
async function marketplaceStart(req,res,next){
  const id=Number(req.params.id);
  if(!(await marketplaceOrderKind(id)))return proxy(req,res);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const r=await client.query(`SELECT * FROM orders WHERE id=$1 FOR UPDATE`,[id]);
    if(!r.rowCount)throw Object.assign(new Error('Order not found'),{status:404});
    const o=r.rows[0],{me}=await requireMerchant(req,o.business_id);
    if(o.order_status==='awaiting_payment')throw Object.assign(new Error('Payment must be confirmed before preparation'),{status:409});
    if(o.order_status==='awaiting_customer_presence'&&!(o.remote_cash_eligible&&o.remote_cash_allowed))throw Object.assign(new Error('Customer presence must be confirmed before preparation'),{status:409});
    if(!['accepted','awaiting_customer_presence'].includes(o.order_status))throw Object.assign(new Error('Order cannot start from its current status'),{status:409});

    const items=await client.query(`
      SELECT oi.source_id,oi.quantity,p.name,p.stock_tracked,p.stock_quantity,p.legacy_product_id,
             p.inventory_id,p.quantity_per_unit,p.business_id
        FROM order_items oi
        JOIN marketplace_products p ON p.id=oi.source_id
       WHERE oi.order_id=$1 AND oi.source_kind='marketplace_product'
       FOR UPDATE OF p
    `,[id]);

    for(const x of items.rows){
      if(x.inventory_id){
        const inv=await client.query(`SELECT id,item,quantity,unit,unit_cost FROM inventory WHERE id=$1 AND business_id=$2 FOR UPDATE`,[x.inventory_id,o.business_id]);
        if(!inv.rowCount)throw Object.assign(new Error(`${x.name} is not linked to valid Merchant stock`),{status:409});
        const required=Number(x.quantity_per_unit)*Number(x.quantity);
        if(Number(inv.rows[0].quantity)+1e-9<required)throw Object.assign(new Error(`${inv.rows[0].item} is short for ${x.name}`),{status:409});
        await client.query(`UPDATE inventory SET quantity=quantity-$1,updated_at=NOW() WHERE id=$2 AND business_id=$3`,[required,x.inventory_id,o.business_id]);
        await client.query(`
          INSERT INTO order_stock_consumptions(order_id,inventory_id,item_name_snapshot,quantity_used,unit_cost_snapshot,cost_snapshot)
          VALUES($1,$2,$3,$4,$5,$6)
          ON CONFLICT(order_id,inventory_id) DO UPDATE SET
            quantity_used=order_stock_consumptions.quantity_used+EXCLUDED.quantity_used,
            cost_snapshot=order_stock_consumptions.cost_snapshot+EXCLUDED.cost_snapshot
        `,[id,x.inventory_id,inv.rows[0].item,required,inv.rows[0].unit_cost,required*Number(inv.rows[0].unit_cost)]);
      }else if(x.stock_tracked&&x.stock_quantity!=null){
        if(Number(x.stock_quantity)+1e-9<Number(x.quantity))throw Object.assign(new Error(`${x.name} does not have enough stock`),{status:409});
        await client.query(`UPDATE marketplace_products SET stock_quantity=stock_quantity-$1,updated_at=NOW() WHERE id=$2`,[x.quantity,x.source_id]);
        await client.query(`INSERT INTO marketplace_stock_events(order_id,marketplace_product_id,quantity,action) VALUES($1,$2,$3,'consume') ON CONFLICT DO NOTHING`,[id,x.source_id,x.quantity]);
      }

      if(x.legacy_product_id){
        const recipe=await client.query(`SELECT r.inventory_id,r.quantity recipe_quantity,i.item,i.quantity stock_quantity,i.unit_cost FROM recipes r JOIN inventory i ON i.id=r.inventory_id WHERE r.product_id=$1 AND i.business_id=$2 ORDER BY i.id FOR UPDATE OF i`,[x.legacy_product_id,o.business_id]);
        for(const ing of recipe.rows){
          const used=Number(ing.recipe_quantity)*Number(x.quantity);
          if(Number(ing.stock_quantity)+1e-9<used)throw Object.assign(new Error(`${ing.item} is short for ${x.name}`),{status:409});
          await client.query(`UPDATE inventory SET quantity=quantity-$1,updated_at=NOW() WHERE id=$2 AND business_id=$3`,[used,ing.inventory_id,o.business_id]);
          await client.query(`
            INSERT INTO order_stock_consumptions(order_id,inventory_id,item_name_snapshot,quantity_used,unit_cost_snapshot,cost_snapshot)
            VALUES($1,$2,$3,$4,$5,$6)
            ON CONFLICT(order_id,inventory_id) DO UPDATE SET
              quantity_used=order_stock_consumptions.quantity_used+EXCLUDED.quantity_used,
              cost_snapshot=order_stock_consumptions.cost_snapshot+EXCLUDED.cost_snapshot
          `,[id,ing.inventory_id,ing.item,used,ing.unit_cost,used*Number(ing.unit_cost)]);
        }
      }
    }

    await client.query(`UPDATE orders SET stock_consumed_at=COALESCE(stock_consumed_at,NOW()),order_status='preparing',preparing_at=COALESCE(preparing_at,NOW()),expected_ready_at=COALESCE(expected_ready_at,NOW()+(preparation_eta_minutes*INTERVAL '1 minute')),updated_at=NOW() WHERE id=$1`,[id]);
    await client.query(`INSERT INTO order_status_events(order_id,from_status,to_status,actor_account_id,note) VALUES($1,$2,'preparing',$3,'Preparation started')`,[id,o.order_status,me.account.id]);
    await client.query('COMMIT');
    const out=await childFetch(`/api/orders/${id}`,{headers:{Authorization:authHeader(req)}});
    res.status(out.status).json(await out.json());
  }catch(e){
    try{await client.query('ROLLBACK')}catch{}
    next(e);
  }finally{client.release()}
}
async function marketplaceCancel(req,res,next){const id=Number(req.params.id);if(!(await marketplaceOrderKind(id)))return proxy(req,res);const client=await pool.connect();try{await client.query('BEGIN');const r=await client.query(`SELECT * FROM orders WHERE id=$1 FOR UPDATE`,[id]);if(!r.rowCount)throw Object.assign(new Error('Order not found'),{status:404});const o=r.rows[0];const{me}=await requireMerchant(req,o.business_id);if(['completed','cancelled'].includes(o.order_status))throw Object.assign(new Error('Order can no longer be cancelled'),{status:409});if(o.stock_consumed_at&&!o.stock_reversed_at){const mp=await client.query(`SELECT * FROM marketplace_stock_events WHERE order_id=$1 AND action='consume'`,[id]);for(const e of mp.rows){await client.query(`UPDATE marketplace_products SET stock_quantity=stock_quantity+$1,updated_at=NOW() WHERE id=$2`,[e.quantity,e.marketplace_product_id]);await client.query(`INSERT INTO marketplace_stock_events(order_id,marketplace_product_id,quantity,action) VALUES($1,$2,$3,'reverse') ON CONFLICT DO NOTHING`,[id,e.marketplace_product_id,e.quantity])}const inv=await client.query(`SELECT * FROM order_stock_consumptions WHERE order_id=$1 AND reversed_at IS NULL`,[id]);for(const x of inv.rows){await client.query(`UPDATE inventory SET quantity=quantity+$1,updated_at=NOW() WHERE id=$2`,[x.quantity_used,x.inventory_id]);await client.query(`UPDATE order_stock_consumptions SET reversed_at=NOW() WHERE order_id=$1 AND inventory_id=$2`,[id,x.inventory_id])}await client.query(`UPDATE orders SET stock_reversed_at=NOW() WHERE id=$1`,[id])}const reason=clean(req.body?.reason,300);await client.query(`UPDATE orders SET order_status='cancelled',cancelled_at=NOW(),cancellation_reason=$1,updated_at=NOW() WHERE id=$2`,[reason,id]);await client.query(`INSERT INTO order_status_events(order_id,from_status,to_status,actor_account_id,note) VALUES($1,$2,'cancelled',$3,$4)`,[id,o.order_status,me.account.id,reason||'Cancelled']);await client.query('COMMIT');const out=await childFetch(`/api/orders/${id}`,{headers:{Authorization:authHeader(req)}});res.status(out.status).json(await out.json())}catch(e){try{await client.query('ROLLBACK')}catch{}next(e)}finally{client.release()}}

app.get('/health',async(_req,res)=>{try{await pool.query('SELECT 1');const r=await childFetch('/health');const ok=ordersReady&&r.ok;res.status(ok?200:503).json({ok,db:true,orders:ok,version:'0.7-marketplace'})}catch{res.status(503).json({ok:false,db:false,orders:false,version:'0.7-marketplace'})}})
app.get('/marketplace.css',(_q,r)=>r.type('text/css').send(readFileSync(join(__dirname,'public','marketplace.css'),'utf8')))
app.get('/marketplace-ui.js',(_q,r)=>r.type('application/javascript').send(readFileSync(join(__dirname,'public','marketplace-ui.js'),'utf8')))
app.get('/guest-explore.css',(_q,r)=>r.type('text/css').send(readFileSync(join(__dirname,'public','guest-explore.css'),'utf8')))
app.get('/guest-explore.js',(_q,r)=>r.type('application/javascript').send(readFileSync(join(__dirname,'public','guest-explore.js'),'utf8')))
async function root(req,res){const r=await childFetch(req.path,{headers:{...req.headers,host:`127.0.0.1:${internalOrdersPort}`}});let html=await r.text();html=html.replace('</head>','  <link rel="stylesheet" href="/marketplace.css" />\n  <link rel="stylesheet" href="/guest-explore.css" />\n</head>').replace('</body>','  <script type="module" src="/marketplace-ui.js"></script>\n  <script type="module" src="/guest-explore.js"></script>\n</body>');res.status(r.status).type('html').send(html)}
app.get('/',root);app.get('/index.html',root)

app.get('/api/public/marketplace/storefronts',async(req,res,next)=>{try{res.set('Cache-Control','public, max-age=30');res.json(await guestPublicStorefronts(clean(req.query.domain,20)))}catch(e){next(e)}})
app.get('/api/public/marketplace/storefronts/:businessId',async(req,res,next)=>{try{const businessId=Number(req.params.businessId);if(!Number.isInteger(businessId)||businessId<1)return res.status(400).json({error:'Invalid storefront'});const store=await guestPublicStorefront(businessId);if(!store)return res.status(404).json({error:'Storefront not found'});res.set('Cache-Control','public, max-age=30');res.json({...store,products:await guestPublicProducts(businessId)})}catch(e){next(e)}})

app.get('/api/marketplace/storefronts',async(req,res,next)=>{try{await requireCustomer(req);res.json(await publicStorefronts(clean(req.query.domain,20)))}catch(e){next(e)}})
app.get('/api/marketplace/storefronts/:businessId',async(req,res,next)=>{try{await requireCustomer(req);const s=await storefront(Number(req.params.businessId),false);if(!s)return res.status(404).json({error:'Storefront not found'});res.json({...s,products:await products(Number(req.params.businessId),false)})}catch(e){next(e)}})
app.post('/api/marketplace/checkout',body,async(req,res,next)=>{try{res.status(201).json(await createMarketplaceOrder(req))}catch(e){next(e)}})

app.get('/api/merchant/storefront',async(req,res,next)=>{try{const{business}=await requireMerchant(req,Number(req.query.business_id||undefined));let s=await storefront(business.id,true);if(!s){await pool.query(`INSERT INTO merchant_storefronts(business_id,store_name) VALUES($1,$2)`,[business.id,business.name]);s=await storefront(business.id,true)}res.json({...s,products:await products(business.id,true)})}catch(e){next(e)}})
app.put('/api/merchant/storefront',body,async(req,res,next)=>{try{const{business}=await requireMerchant(req,Number(req.body?.business_id||undefined));const domain=['food','non_food','mixed'].includes(req.body?.merchant_domain)?req.body.merchant_domain:'food';const status=['draft','published','paused'].includes(req.body?.publication_status)?req.body.publication_status:'draft';const open=['open','busy','closed'].includes(req.body?.opening_status)?req.body.opening_status:'open';const logo=clean(req.body?.logo_data_url,320000);if(logo&&!/^data:image\/(png|jpeg|webp);base64,/.test(logo))return res.status(400).json({error:'Logo must be PNG, JPEG or WebP'});const{rows}=await pool.query(`INSERT INTO merchant_storefronts(business_id,store_name,description,merchant_domain,publication_status,pickup_address,opening_status,preparation_eta_minutes,pickup_enabled,delivery_enabled,cash_enabled,online_enabled,public_reputation_enabled,price_comparison_enabled,logo_data_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT(business_id) DO UPDATE SET store_name=EXCLUDED.store_name,description=EXCLUDED.description,merchant_domain=EXCLUDED.merchant_domain,publication_status=EXCLUDED.publication_status,pickup_address=EXCLUDED.pickup_address,opening_status=EXCLUDED.opening_status,preparation_eta_minutes=EXCLUDED.preparation_eta_minutes,pickup_enabled=EXCLUDED.pickup_enabled,delivery_enabled=EXCLUDED.delivery_enabled,cash_enabled=EXCLUDED.cash_enabled,online_enabled=EXCLUDED.online_enabled,public_reputation_enabled=EXCLUDED.public_reputation_enabled,price_comparison_enabled=EXCLUDED.price_comparison_enabled,logo_data_url=EXCLUDED.logo_data_url,updated_at=NOW() RETURNING *`,[business.id,clean(req.body?.store_name,120)||business.name,clean(req.body?.description,1000),domain,status,clean(req.body?.pickup_address,400),open,Math.max(1,Math.min(240,Number(req.body?.preparation_eta_minutes)||15)),req.body?.pickup_enabled!==false,Boolean(req.body?.delivery_enabled),req.body?.cash_enabled!==false,Boolean(req.body?.online_enabled),Boolean(req.body?.public_reputation_enabled),Boolean(req.body?.price_comparison_enabled),logo]);res.json(rows[0])}catch(e){next(e)}})
app.post('/api/merchant/storefront/import-legacy',body,async(req,res,next)=>{try{const{business}=await requireMerchant(req,Number(req.body?.business_id||1));res.json({imported_or_updated:await importLegacyProducts(business.id),products:await products(business.id,true)})}catch(e){next(e)}})
app.post('/api/merchant/storefront/products',body,async(req,res,next)=>{
  try{
    const{business}=await requireMerchant(req,Number(req.body?.business_id||undefined));
    const kind=['prepared_food','fresh_direct','packaged_resale','non_food_resale'].includes(clean(req.body?.product_kind,40))?clean(req.body.product_kind,40):'prepared_food';
    const domain=kind==='non_food_resale'?'non_food':'food';
    const price=Number(req.body?.selling_price);
    const quantityPerUnit=positive(req.body?.quantity_per_unit)?Number(req.body.quantity_per_unit):1;
    if(!clean(req.body?.name,120)||!Number.isFinite(price)||price<0)return res.status(400).json({error:'Name and valid selling price are required'});
    let inventoryId=req.body?.inventory_id?Number(req.body.inventory_id):null;
    const direct=kind!=='prepared_food';
    if(direct){
      if(!Number.isInteger(inventoryId))return res.status(400).json({error:'Choose the stock item this product sells from.'});
      const inv=await pool.query(`SELECT id,item,unit FROM inventory WHERE id=$1 AND business_id=$2`,[inventoryId,business.id]);
      if(!inv.rowCount)return res.status(404).json({error:'Inventory item not found in this business'});
    }else inventoryId=null;
    const unitCode=clean(req.body?.unit_code,40)||(direct?`${quantityPerUnit} stock units`:'item');
    const{rows}=await pool.query(`
      INSERT INTO marketplace_products(
        business_id,inventory_id,name,description,category,product_domain,product_kind,unit_code,
        quantity_per_unit,selling_price,stock_tracked,stock_quantity,active,published,price_comparison_override
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,TRUE,$12,$13)
      RETURNING *
    `,[business.id,inventoryId,clean(req.body.name,120),clean(req.body?.description,800),clean(req.body?.category,100)||'General',domain,kind,unitCode,quantityPerUnit,price,direct,Boolean(req.body?.published),req.body?.price_comparison_override==null?null:Boolean(req.body.price_comparison_override)]);
    res.status(201).json(rows[0]);
  }catch(e){if(e.code==='23505')return res.status(409).json({error:'A product with this name already exists in this store'});next(e)}
})
app.patch('/api/merchant/storefront/products/:id',body,async(req,res,next)=>{
  try{
    const id=Number(req.params.id);const own=await pool.query(`SELECT * FROM marketplace_products WHERE id=$1`,[id]);
    if(!own.rowCount)return res.status(404).json({error:'Product not found'});
    const old=own.rows[0],{business}=await requireMerchant(req,old.business_id);
    const kind=['prepared_food','fresh_direct','packaged_resale','non_food_resale'].includes(clean(req.body?.product_kind??old.product_kind,40))?clean(req.body?.product_kind??old.product_kind,40):old.product_kind;
    const domain=kind==='non_food_resale'?'non_food':'food';
    const direct=kind!=='prepared_food';
    let inventoryId=req.body?.inventory_id===undefined?old.inventory_id:(req.body.inventory_id?Number(req.body.inventory_id):null);
    if(direct){
      if(!Number.isInteger(Number(inventoryId)))return res.status(400).json({error:'Choose the stock item this product sells from.'});
      const inv=await pool.query(`SELECT id FROM inventory WHERE id=$1 AND business_id=$2`,[Number(inventoryId),business.id]);
      if(!inv.rowCount)return res.status(404).json({error:'Inventory item not found in this business'});
    }else inventoryId=null;
    const quantityPerUnit=Number(req.body?.quantity_per_unit??old.quantity_per_unit);
    if(!positive(quantityPerUnit))return res.status(400).json({error:'Stock quantity per sold unit must be greater than zero'});
    const{rows}=await pool.query(`
      UPDATE marketplace_products SET
        inventory_id=$1,name=$2,description=$3,category=$4,product_domain=$5,product_kind=$6,
        unit_code=$7,quantity_per_unit=$8,selling_price=$9,stock_tracked=$10,stock_quantity=$11,
        active=$12,published=$13,price_comparison_override=$14,updated_at=NOW()
      WHERE id=$15 RETURNING *
    `,[inventoryId,clean(req.body?.name??old.name,120),clean(req.body?.description??old.description,800),clean(req.body?.category??old.category,100),domain,kind,clean(req.body?.unit_code??old.unit_code,40),quantityPerUnit,Number(req.body?.selling_price??old.selling_price),direct?true:(req.body?.stock_tracked??old.stock_tracked),direct?null:(req.body?.stock_quantity===undefined?old.stock_quantity:req.body.stock_quantity),req.body?.active??old.active,req.body?.published??old.published,req.body?.price_comparison_override===undefined?old.price_comparison_override:req.body.price_comparison_override,id]);
    res.json(rows[0]);
  }catch(e){next(e)}
})

async function merchantOwnedMarketplaceProduct(req){
  const id=Number(req.params.id);
  if(!Number.isInteger(id)||id<1)throw Object.assign(new Error('Invalid product.'),{status:400});
  const q=await pool.query(`SELECT * FROM marketplace_products WHERE id=$1`,[id]);
  if(!q.rowCount)throw Object.assign(new Error('Product not found.'),{status:404});
  const product=q.rows[0];
  const owner=await requireMerchant(req,product.business_id);
  return{product,...owner};
}
async function confirmedRecipeForMarketplaceProduct(product){
  if(!product.legacy_product_id)return[];
  const {rows}=await pool.query(`
    SELECT i.item,r.quantity,i.unit
      FROM recipes r
      JOIN inventory i ON i.id=r.inventory_id
      JOIN products p ON p.id=r.product_id
     WHERE r.product_id=$1 AND p.business_id=$2 AND i.business_id=$2
     ORDER BY i.item
  `,[Number(product.legacy_product_id),Number(product.business_id)]);
  return rows;
}

app.post('/api/merchant/storefront/products/:id/images/generate',body,async(req,res,next)=>{
  try{
    const{product,me}=await merchantOwnedMarketplaceProduct(req);
    if(product.product_domain!=='food'||product.product_kind!=='prepared_food'){
      return res.status(409).json({error:'AI fallback generation is currently limited to Merchant-confirmed prepared recipes. Use a real or authorized image for exact resale products.'});
    }
    const recipe=await confirmedRecipeForMarketplaceProduct(product);
    if(!recipe.length)return res.status(409).json({error:'Confirm this product recipe before generating its reference image.'});
    const prompt=buildPreparedFoodImagePrompt({name:product.name,description:product.description,category:product.category,recipe});
    const media=await generateCatalogImage(pool,{
      accountId:Number(me.account.id),
      entityType:'marketplace_product',
      entityId:Number(product.id),
      prompt,
      altText:`${product.name} — AI-generated reference image`
    });
    res.status(201).json({media,disclosure:'AI-generated reference image',approval_required:true});
  }catch(e){next(e)}
});

app.post('/api/merchant/storefront/products/:id/images/:mediaId/approve',body,async(req,res,next)=>{
  try{
    const{product,me}=await merchantOwnedMarketplaceProduct(req);
    const media=await approveCatalogMedia(pool,{
      accountId:Number(me.account.id),
      entityType:'marketplace_product',
      entityId:Number(product.id),
      mediaId:Number(req.params.mediaId),
      makePrimary:req.body?.primary!==false
    });
    res.json({media,images:await listCatalogMedia(pool,{entityType:'marketplace_product',entityId:Number(product.id)})});
  }catch(e){next(e)}
});

app.post('/api/merchant/storefront/products/:id/images/:mediaId/archive',body,async(req,res,next)=>{
  try{
    const{product}=await merchantOwnedMarketplaceProduct(req);
    res.json(await archiveCatalogMedia(pool,{entityType:'marketplace_product',entityId:Number(product.id),mediaId:Number(req.params.mediaId)}));
  }catch(e){next(e)}
});

app.post('/api/orders/merchant/:id/start',body,marketplaceStart)
app.post('/api/orders/merchant/:id/cancel',body,marketplaceCancel)

function proxy(req,res){
  const parsedJsonBody=req.body!==undefined&&!['GET','HEAD'].includes(req.method)&&Boolean(req.is('application/json'));
  const payload=parsedJsonBody?Buffer.from(JSON.stringify(req.body??{})):null;
  const headers={...req.headers,host:`127.0.0.1:${internalOrdersPort}`};
  if(payload){headers['content-length']=String(payload.length);delete headers['transfer-encoding'];}
  const up=http.request({hostname:'127.0.0.1',port:internalOrdersPort,path:req.originalUrl,method:req.method,headers},ur=>{
    res.statusCode=ur.statusCode||502;for(const[k,v]of Object.entries(ur.headers))if(v!==undefined)res.setHeader(k,v);ur.pipe(res)
  });
  up.on('error',e=>{console.error(e);if(!res.headersSent)res.status(502).json({error:'Marketplace upstream unavailable'})});
  if(payload)up.end(payload);else req.pipe(up);
}
app.use(proxy)
app.use((err,_req,res,_next)=>{console.error(err);if(res.headersSent)return;res.status(err.status||500).json({error:err.status?err.message:'Unexpected server error'})})

function startOrders(){ordersChild=spawn(process.execPath,['server-orders.js'],{cwd:__dirname,env:{...process.env,PORT:String(internalOrdersPort),INTERNAL_AUTH_PORT:String(internalAuthPort),INTERNAL_ACCOUNTING_PORT:String(internalAccountingPort)},stdio:'inherit'});ordersChild.on('exit',code=>{if(!shuttingDown){console.error(`Orders child exited ${code}`);process.exit(code||1)}})}
async function waitOrders(){for(let i=0;i<80;i++){try{const r=await childFetch('/health');if(r.ok)return}catch{}await new Promise(r=>setTimeout(r,250))}throw new Error('Orders child failed health check')}
let embeddedStartPromise=null;
export async function startEmbeddedMarketplace(){
  if(!embeddedStartPromise){
    embeddedStartPromise=(async()=>{
      startOrders();await waitOrders();ordersReady=true;await initDb();
      console.log('Business & Life Marketplace mounted in-process');return app;
    })();
  }
  return embeddedStartPromise;
}
async function stopMarketplace(){
  if(shuttingDown)return;shuttingDown=true;ordersReady=false;
  if(ordersChild&&!ordersChild.killed)ordersChild.kill('SIGTERM');
  await pool.end().catch(()=>{});
}
export async function stopEmbeddedMarketplace(){await stopMarketplace()}
async function shutdown(sig){console.log(`Received ${sig}`);await stopMarketplace();process.exit(0)}
const directExecution=Boolean(process.argv[1])&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(directExecution){
  process.on('SIGTERM',()=>shutdown('SIGTERM'));process.on('SIGINT',()=>shutdown('SIGINT'));
  startEmbeddedMarketplace()
    .then(()=>app.listen(port,'0.0.0.0',()=>console.log(`Business & Life marketplace server listening on ${port}`)))
    .catch(e=>{console.error(e);process.exit(1)});
}
