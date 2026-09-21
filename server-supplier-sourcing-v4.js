import crypto from 'node:crypto';
import {supplierDomainV2Internals} from './server-supplier-domain-v2.js';
import {
  normalizeDiscoverySettings,normalizeRfq,compareQuotes,validatePreferenceRanks,reorderPackSuggestion
} from './supplier-sourcing-core.js';

const {exactProfileBusiness}=supplierDomainV2Internals;
const clean=(v,max=500)=>String(v??'').trim().slice(0,max);
const positive=v=>Number.isFinite(Number(v))&&Number(v)>0;
const nonNegative=v=>Number.isFinite(Number(v))&&Number(v)>=0;
const money=v=>Math.round((Number(v)+Number.EPSILON)*100)/100;
const err=(status,message)=>Object.assign(new Error(message),{status});
const token=()=>crypto.randomBytes(24).toString('base64url');
const poNumber=id=>`PO-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${String(id).padStart(5,'0')}`;

async function acceptedRelationship(pool,businessId,supplierAccountId){
  const {rows}=await pool.query(
    `SELECT * FROM supplier_relationships
      WHERE business_id=$1 AND supplier_account_id=$2 AND state='accepted'`,
    [Number(businessId),Number(supplierAccountId)]
  );
  return rows[0]||null;
}

async function sourcingSettings(pool,businessId){
  const [settings,cats,published]=await Promise.all([
    pool.query(`SELECT * FROM supplier_sourcing_settings WHERE business_id=$1`,[Number(businessId)]),
    pool.query(`SELECT category_code FROM supplier_sourcing_categories WHERE business_id=$1 ORDER BY category_code`,[Number(businessId)]),
    pool.query(`SELECT catalog_item_id FROM supplier_sourcing_published_items WHERE business_id=$1 ORDER BY catalog_item_id`,[Number(businessId)])
  ]);
  return{
    ...(settings.rows[0]||{business_id:Number(businessId),visibility:'private',accepts_rfqs:false}),
    categories:cats.rows.map(x=>x.category_code),
    published_catalog_item_ids:published.rows.map(x=>Number(x.catalog_item_id))
  };
}

async function rfqOwnedByMerchant(pool,me,id){
  const q=await pool.query(`SELECT * FROM supplier_rfqs WHERE id=$1`,[Number(id)]);
  if(!q.rowCount)throw err(404,'RFQ not found');
  const b=await exactProfileBusiness(pool,me,'merchant',q.rows[0].business_id);
  return{rfq:q.rows[0],business:b};
}

async function rfqTargetForSupplier(pool,rfqId,supplierBusinessId,accountId){
  const {rows}=await pool.query(
    `SELECT t.*,r.business_id merchant_business_id,r.status rfq_status,r.expires_at rfq_expires_at
       FROM supplier_rfq_targets t
       JOIN supplier_rfqs r ON r.id=t.rfq_id
      WHERE t.rfq_id=$1 AND t.supplier_business_id=$2 AND t.supplier_account_id=$3`,
    [Number(rfqId),Number(supplierBusinessId),Number(accountId)]
  );
  return rows[0]||null;
}

async function quoteRows(pool,rfqId){
  const {rows}=await pool.query(
    `SELECT q.*,
       COALESCE(sp.supplier_name,sb.name,a.display_name,party.display_name,'Supplier') supplier_name,
       CASE WHEN q.source_type='external' THEN party.source_type ELSE 'connected' END supplier_source_type
       FROM supplier_quotes q
       LEFT JOIN accounts a ON a.id=q.supplier_account_id
       LEFT JOIN businesses sb ON sb.id=q.supplier_business_id
       LEFT JOIN supplier_profiles sp ON sp.account_id=q.supplier_account_id
       LEFT JOIN merchant_supply_parties party ON party.id=q.supply_party_id
      WHERE q.rfq_id=$1
      ORDER BY q.created_at,q.id`,
    [Number(rfqId)]
  );
  return rows;
}

async function comparison(pool,rfq){
  return compareQuotes({rfq,quotes:await quoteRows(pool,rfq.id)});
}

export async function ensureSupplierSourcingV4Schema(pool){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS supplier_sourcing_settings(
      business_id BIGINT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
      supplier_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      visibility TEXT NOT NULL DEFAULT 'private',
      accepts_rfqs BOOLEAN NOT NULL DEFAULT FALSE,
      updated_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(visibility IN ('private','directory','rfq_only'))
    );

    CREATE TABLE IF NOT EXISTS supplier_sourcing_categories(
      business_id BIGINT NOT NULL REFERENCES supplier_sourcing_settings(business_id) ON DELETE CASCADE,
      category_code TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(business_id,category_code),
      CHECK(category_code IN (
        'fresh_produce','meat_poultry','fish_seafood','rice_grains','beverages','packaged_foods',
        'frozen_foods','bakery','household_fmcg','personal_care','packaging','cleaning_supplies',
        'lpg_fuel','equipment','services','other'
      ))
    );

    CREATE TABLE IF NOT EXISTS supplier_sourcing_published_items(
      business_id BIGINT NOT NULL REFERENCES supplier_sourcing_settings(business_id) ON DELETE CASCADE,
      catalog_item_id BIGINT NOT NULL REFERENCES supplier_catalog_items(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(business_id,catalog_item_id)
    );

    CREATE TABLE IF NOT EXISTS supplier_rfqs(
      id BIGSERIAL PRIMARY KEY,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      created_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      item_specification TEXT NOT NULL,
      requested_quantity NUMERIC(16,6) NOT NULL CHECK(requested_quantity>0),
      requested_unit TEXT NOT NULL,
      needed_by DATE,
      fulfilment_mode TEXT NOT NULL DEFAULT 'either',
      service_area TEXT NOT NULL DEFAULT '',
      quality_requirements TEXT NOT NULL DEFAULT '',
      substitution_policy TEXT NOT NULL DEFAULT 'approval_required',
      target_budget NUMERIC(14,2),
      currency_code TEXT NOT NULL DEFAULT 'PHP',
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(fulfilment_mode IN ('delivery','pickup','either')),
      CHECK(substitution_policy IN ('allowed','approval_required','no_substitution')),
      CHECK(target_budget IS NULL OR target_budget>=0),
      CHECK(status IN ('open','quoted','closed','cancelled'))
    );

    CREATE TABLE IF NOT EXISTS supplier_rfq_targets(
      rfq_id BIGINT NOT NULL REFERENCES supplier_rfqs(id) ON DELETE CASCADE,
      supplier_business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      supplier_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      state TEXT NOT NULL DEFAULT 'invited',
      invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      viewed_at TIMESTAMPTZ,
      responded_at TIMESTAMPTZ,
      PRIMARY KEY(rfq_id,supplier_business_id),
      CHECK(state IN ('invited','viewed','declined','quoted','withdrawn'))
    );

    CREATE TABLE IF NOT EXISTS supplier_quotes(
      id BIGSERIAL PRIMARY KEY,
      rfq_id BIGINT NOT NULL REFERENCES supplier_rfqs(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL,
      supplier_business_id BIGINT REFERENCES businesses(id) ON DELETE CASCADE,
      supplier_account_id BIGINT REFERENCES accounts(id) ON DELETE CASCADE,
      supply_party_id BIGINT REFERENCES merchant_supply_parties(id) ON DELETE CASCADE,
      catalog_item_id BIGINT REFERENCES supplier_catalog_items(id) ON DELETE SET NULL,
      offered_name TEXT NOT NULL,
      package_unit TEXT NOT NULL,
      base_unit TEXT NOT NULL,
      base_units_per_pack NUMERIC(16,6) NOT NULL CHECK(base_units_per_pack>0),
      quoted_packs NUMERIC(16,6) NOT NULL CHECK(quoted_packs>0),
      minimum_packs NUMERIC(16,6) NOT NULL DEFAULT 1 CHECK(minimum_packs>0),
      price_per_pack NUMERIC(14,2) NOT NULL CHECK(price_per_pack>=0),
      delivery_fee NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(delivery_fee>=0),
      lead_days INTEGER NOT NULL DEFAULT 0 CHECK(lead_days>=0 AND lead_days<=365),
      earliest_fulfilment_date DATE,
      valid_until DATE NOT NULL,
      availability_status TEXT NOT NULL DEFAULT 'available',
      substitution_note TEXT NOT NULL DEFAULT '',
      payment_term_note TEXT NOT NULL DEFAULT '',
      supplier_note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(source_type IN ('connected_supplier','external')),
      CHECK(availability_status IN ('available','limited','unavailable')),
      CHECK(status IN ('active','withdrawn','converted','expired')),
      CHECK(
        (source_type='connected_supplier' AND supplier_business_id IS NOT NULL AND supplier_account_id IS NOT NULL AND supply_party_id IS NULL)
        OR
        (source_type='external' AND supplier_business_id IS NULL AND supplier_account_id IS NULL AND supply_party_id IS NOT NULL)
      )
    );
    CREATE UNIQUE INDEX IF NOT EXISTS supplier_quotes_connected_unique
      ON supplier_quotes(rfq_id,supplier_business_id)
      WHERE source_type='connected_supplier' AND status IN ('active','converted');
    CREATE UNIQUE INDEX IF NOT EXISTS supplier_quotes_external_unique
      ON supplier_quotes(rfq_id,supply_party_id)
      WHERE source_type='external' AND status IN ('active','converted');

    CREATE TABLE IF NOT EXISTS merchant_inventory_supplier_sources(
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      inventory_id BIGINT NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
      catalog_item_id BIGINT NOT NULL REFERENCES supplier_catalog_items(id) ON DELETE CASCADE,
      supplier_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      preference_rank INTEGER NOT NULL CHECK(preference_rank>0),
      note TEXT NOT NULL DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(business_id,inventory_id,catalog_item_id),
      UNIQUE(business_id,inventory_id,preference_rank)
    );

    ALTER TABLE purchase_orders
      ADD COLUMN IF NOT EXISTS source_quote_id BIGINT REFERENCES supplier_quotes(id) ON DELETE SET NULL;
  `);
}

export function registerSupplierSourcingV4Routes({app,pool,body,identity}){
  app.get('/api/supplier/v4/sourcing-settings',async(req,res,next)=>{
    try{
      const me=await identity(req);
      const b=await exactProfileBusiness(pool,me,'supplier',req.query.business_id||null);
      res.json(await sourcingSettings(pool,b.id));
    }catch(e){next(e)}
  });

  app.put('/api/supplier/v4/sourcing-settings',body,async(req,res,next)=>{
    try{
      const me=await identity(req);
      const b=await exactProfileBusiness(pool,me,'supplier',req.body?.business_id||null);
      const normalized=normalizeDiscoverySettings({
        visibility:req.body?.visibility,acceptsRfqs:req.body?.accepts_rfqs,categories:req.body?.categories||[]
      });
      const publishIds=[...new Set((Array.isArray(req.body?.published_catalog_item_ids)?req.body.published_catalog_item_ids:[])
        .map(Number).filter(Number.isInteger))];
      if(publishIds.length){
        const owned=await pool.query(
          `SELECT id FROM supplier_catalog_items WHERE supplier_account_id=$1 AND active=TRUE AND id=ANY($2::bigint[])`,
          [me.account.id,publishIds]
        );
        if(owned.rowCount!==publishIds.length)return res.status(409).json({error:'One or more published catalog items are unavailable'});
      }
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO supplier_sourcing_settings(business_id,supplier_account_id,visibility,accepts_rfqs,updated_by_account_id)
           VALUES($1,$2,$3,$4,$2)
           ON CONFLICT(business_id) DO UPDATE SET supplier_account_id=EXCLUDED.supplier_account_id,
             visibility=EXCLUDED.visibility,accepts_rfqs=EXCLUDED.accepts_rfqs,
             updated_by_account_id=EXCLUDED.updated_by_account_id,updated_at=NOW()`,
          [b.id,me.account.id,normalized.visibility,normalized.accepts_rfqs]
        );
        await client.query(`DELETE FROM supplier_sourcing_categories WHERE business_id=$1`,[b.id]);
        for(const code of normalized.categories)await client.query(
          `INSERT INTO supplier_sourcing_categories(business_id,category_code) VALUES($1,$2)`,[b.id,code]
        );
        await client.query(`DELETE FROM supplier_sourcing_published_items WHERE business_id=$1`,[b.id]);
        for(const id of publishIds)await client.query(
          `INSERT INTO supplier_sourcing_published_items(business_id,catalog_item_id) VALUES($1,$2)`,[b.id,id]
        );
        await client.query('COMMIT');
      }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
      finally{client.release()}
      res.json(await sourcingSettings(pool,b.id));
    }catch(e){next(e)}
  });

  app.get('/api/procurement/sourcing/directory',async(req,res,next)=>{
    try{
      const me=await identity(req);
      const merchant=await exactProfileBusiness(pool,me,'merchant',req.query.business_id||null);
      const q=clean(req.query.q,120).toLowerCase();
      const category=clean(req.query.category,60).toLowerCase();
      const params=[me.account.id,merchant.id];
      let extra='';
      if(category){
        params.push(category);
        extra+=` AND EXISTS(SELECT 1 FROM supplier_sourcing_categories sc
          WHERE sc.business_id=ss.business_id AND sc.category_code=$${params.length})`;
      }
      if(q){
        params.push('%'+q+'%');
        extra+=` AND (LOWER(COALESCE(sp.supplier_name,sb.name,a.display_name)) LIKE $${params.length}
          OR LOWER(COALESCE(sp.description,'')) LIKE $${params.length}
          OR LOWER(COALESCE(sp.service_area,'')) LIKE $${params.length})`;
      }
      const {rows}=await pool.query(
        `SELECT ss.business_id supplier_business_id,ss.supplier_account_id,ss.visibility,ss.accepts_rfqs,
          COALESCE(sp.supplier_name,sb.name,a.display_name) supplier_name,
          COALESCE(sp.description,'') description,COALESCE(sp.service_area,'') service_area,
          COALESCE(sp.delivery_available,FALSE) delivery_available,COALESCE(sp.normal_lead_days,1) normal_lead_days,
          sp.minimum_order_value,
          EXISTS(SELECT 1 FROM supplier_relationships r
            WHERE r.business_id=$2 AND r.supplier_account_id=ss.supplier_account_id AND r.state='accepted') relationship_accepted,
          ARRAY(SELECT sc.category_code FROM supplier_sourcing_categories sc
            WHERE sc.business_id=ss.business_id ORDER BY sc.category_code) categories
         FROM supplier_sourcing_settings ss
         JOIN businesses sb ON sb.id=ss.business_id
         JOIN accounts a ON a.id=ss.supplier_account_id
         JOIN profiles p ON p.account_id=ss.supplier_account_id AND p.role='supplier' AND p.enabled=TRUE
         JOIN profile_business_bindings pb ON pb.business_id=ss.business_id AND pb.account_id=ss.supplier_account_id
           AND pb.role='supplier' AND pb.status='active'
         LEFT JOIN supplier_profiles sp ON sp.account_id=ss.supplier_account_id
         WHERE ss.visibility IN ('directory','rfq_only') AND ss.supplier_account_id<>$1
         ${extra}
         ORDER BY relationship_accepted DESC,supplier_name,ss.business_id LIMIT 100`,
        params
      );
      const ids=rows.map(x=>Number(x.supplier_business_id));
      const pub=ids.length?await pool.query(
        `SELECT pi.business_id,c.id,c.product_name,c.unit_name,c.base_unit,c.base_units_per_pack,
          c.price_per_pack,c.minimum_packs,c.availability_status,c.lead_time_days
         FROM supplier_sourcing_published_items pi
         JOIN supplier_catalog_items c ON c.id=pi.catalog_item_id AND c.active=TRUE
         JOIN supplier_sourcing_settings ss ON ss.business_id=pi.business_id AND ss.visibility='directory'
         WHERE pi.business_id=ANY($1::bigint[]) ORDER BY pi.business_id,c.product_name,c.id`,[ids]
      ):{rows:[]};
      const byBusiness=new Map();
      for(const item of pub.rows){
        const id=Number(item.business_id);if(!byBusiness.has(id))byBusiness.set(id,[]);byBusiness.get(id).push(item);
      }
      res.json(rows.map(row=>({...row,published_catalog:byBusiness.get(Number(row.supplier_business_id))||[]})));
    }catch(e){next(e)}
  });

  app.post('/api/procurement/sourcing/rfqs',body,async(req,res,next)=>{
    try{
      const me=await identity(req);
      const merchant=await exactProfileBusiness(pool,me,'merchant',req.body?.business_id||null);
      const r=normalizeRfq({
        itemSpecification:req.body?.item_specification,quantity:req.body?.requested_quantity,unit:req.body?.requested_unit,
        fulfilmentMode:req.body?.fulfilment_mode,substitutionPolicy:req.body?.substitution_policy,
        targetBudget:req.body?.target_budget,currencyCode:req.body?.currency_code
      });
      const targetBusinessIds=[...new Set((Array.isArray(req.body?.supplier_business_ids)?req.body.supplier_business_ids:[])
        .map(Number).filter(Number.isInteger))];
      if(!targetBusinessIds.length||targetBusinessIds.length>5)return res.status(400).json({error:'RFQ requires 1–5 Supplier targets'});
      const targets=[];
      for(const supplierBusinessId of targetBusinessIds){
        const supplier=await pool.query(
          `SELECT pb.business_id,pb.account_id supplier_account_id,ss.visibility,ss.accepts_rfqs
           FROM profile_business_bindings pb
           JOIN profiles p ON p.account_id=pb.account_id AND p.role='supplier' AND p.enabled=TRUE
           LEFT JOIN supplier_sourcing_settings ss ON ss.business_id=pb.business_id
           WHERE pb.business_id=$1 AND pb.role='supplier' AND pb.status='active'`,[supplierBusinessId]
        );
        if(!supplier.rowCount)throw err(404,'Supplier target not found');
        const x=supplier.rows[0],relationship=await acceptedRelationship(pool,merchant.id,x.supplier_account_id);
        if(!(relationship||(Boolean(x.accepts_rfqs)&&['directory','rfq_only'].includes(x.visibility)))){
          throw err(409,'One or more Supplier targets do not accept sourcing requests');
        }
        if(Number(x.supplier_account_id)===Number(me.account.id))throw err(409,'Merchant cannot target its own Supplier account');
        targets.push(x);
      }
      const defaultExpiry=new Date(Date.now()+7*86400000);
      const requestedExpiry=req.body?.expires_at?new Date(req.body.expires_at):null;
      const expires=requestedExpiry&&!Number.isNaN(requestedExpiry.getTime())?requestedExpiry:defaultExpiry;
      if(expires.getTime()<=Date.now())return res.status(400).json({error:'RFQ expiry must be in the future'});
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const rfq=await client.query(
          `INSERT INTO supplier_rfqs(
            business_id,created_by_account_id,item_specification,requested_quantity,requested_unit,needed_by,
            fulfilment_mode,service_area,quality_requirements,substitution_policy,target_budget,currency_code,note,status,expires_at
          ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'open',$14) RETURNING *`,
          [
            merchant.id,me.account.id,r.item_specification,r.requested_quantity,r.requested_unit,
            req.body?.needed_by?String(req.body.needed_by).slice(0,10):null,r.fulfilment_mode,
            clean(req.body?.service_area,300),clean(req.body?.quality_requirements,1000),r.substitution_policy,
            r.target_budget,r.currency_code,clean(req.body?.note,1000),expires.toISOString()
          ]
        );
        for(const t of targets)await client.query(
          `INSERT INTO supplier_rfq_targets(rfq_id,supplier_business_id,supplier_account_id) VALUES($1,$2,$3)`,
          [rfq.rows[0].id,t.business_id,t.supplier_account_id]
        );
        await client.query('COMMIT');
        res.status(201).json({...rfq.rows[0],target_count:targets.length});
      }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
      finally{client.release()}
    }catch(e){next(e)}
  });

  app.get('/api/procurement/sourcing/rfqs',async(req,res,next)=>{
    try{
      const me=await identity(req),merchant=await exactProfileBusiness(pool,me,'merchant',req.query.business_id||null);
      const {rows}=await pool.query(
        `SELECT r.*,(SELECT COUNT(*)::int FROM supplier_rfq_targets t WHERE t.rfq_id=r.id) target_count,
          (SELECT COUNT(*)::int FROM supplier_quotes q WHERE q.rfq_id=r.id AND q.status='active') quote_count
         FROM supplier_rfqs r WHERE r.business_id=$1 ORDER BY r.created_at DESC,r.id DESC LIMIT 200`,[merchant.id]
      );
      res.json(rows);
    }catch(e){next(e)}
  });

  app.get('/api/procurement/sourcing/rfqs/:id',async(req,res,next)=>{
    try{
      const me=await identity(req),{rfq}=await rfqOwnedByMerchant(pool,me,req.params.id);
      const [targets,comp]=await Promise.all([
        pool.query(
          `SELECT t.*,COALESCE(sp.supplier_name,b.name,a.display_name) supplier_name
           FROM supplier_rfq_targets t JOIN businesses b ON b.id=t.supplier_business_id
           JOIN accounts a ON a.id=t.supplier_account_id LEFT JOIN supplier_profiles sp ON sp.account_id=t.supplier_account_id
           WHERE t.rfq_id=$1 ORDER BY supplier_name,t.supplier_business_id`,[rfq.id]
        ),
        comparison(pool,rfq)
      ]);
      res.json({...rfq,targets:targets.rows,...comp});
    }catch(e){next(e)}
  });

  app.get('/api/supplier/v4/rfqs',async(req,res,next)=>{
    try{
      const me=await identity(req),supplier=await exactProfileBusiness(pool,me,'supplier',req.query.business_id||null);
      const {rows}=await pool.query(
        `SELECT r.*,t.state target_state,t.invited_at,t.viewed_at,t.responded_at,b.name merchant_business_name
         FROM supplier_rfq_targets t JOIN supplier_rfqs r ON r.id=t.rfq_id JOIN businesses b ON b.id=r.business_id
         WHERE t.supplier_business_id=$1 AND t.supplier_account_id=$2
         ORDER BY r.created_at DESC,r.id DESC LIMIT 200`,[supplier.id,me.account.id]
      );
      res.json(rows);
    }catch(e){next(e)}
  });

  app.post('/api/supplier/v4/rfqs/:id/decline',body,async(req,res,next)=>{
    try{
      const me=await identity(req),supplier=await exactProfileBusiness(pool,me,'supplier',req.body?.business_id||null);
      const target=await rfqTargetForSupplier(pool,req.params.id,supplier.id,me.account.id);
      if(!target)return res.status(404).json({error:'RFQ target not found'});
      const {rows}=await pool.query(
        `UPDATE supplier_rfq_targets SET state='declined',responded_at=NOW()
         WHERE rfq_id=$1 AND supplier_business_id=$2 AND supplier_account_id=$3 RETURNING *`,
        [Number(req.params.id),supplier.id,me.account.id]
      );
      res.json(rows[0]);
    }catch(e){next(e)}
  });

  app.put('/api/supplier/v4/rfqs/:id/quote',body,async(req,res,next)=>{
    try{
      const me=await identity(req),supplier=await exactProfileBusiness(pool,me,'supplier',req.body?.business_id||null);
      const target=await rfqTargetForSupplier(pool,req.params.id,supplier.id,me.account.id);
      if(!target)return res.status(404).json({error:'RFQ target not found'});
      if(!['invited','viewed','quoted'].includes(target.state))return res.status(409).json({error:'RFQ is unavailable for quotation'});
      if(target.rfq_status!=='open'&&target.rfq_status!=='quoted')return res.status(409).json({error:'RFQ is closed'});
      if(new Date(target.rfq_expires_at).getTime()<=Date.now())return res.status(409).json({error:'RFQ is expired'});
      const catalogItemId=req.body?.catalog_item_id?Number(req.body.catalog_item_id):null;
      let catalog=null;
      if(catalogItemId){
        const q=await pool.query(
          `SELECT c.* FROM supplier_catalog_items c
           JOIN supplier_sourcing_published_items p ON p.catalog_item_id=c.id AND p.business_id=$1
           WHERE c.id=$2 AND c.supplier_account_id=$3 AND c.active=TRUE`,[supplier.id,catalogItemId,me.account.id]
        );
        if(!q.rowCount)return res.status(409).json({error:'Catalog item is not assigned to this Supplier sourcing profile'});
        catalog=q.rows[0];
      }
      const offeredName=clean(req.body?.offered_name??catalog?.product_name,180);
      const packageUnit=clean(req.body?.package_unit??catalog?.unit_name,50),baseUnit=clean(req.body?.base_unit??catalog?.base_unit,50);
      const baseUnits=Number(req.body?.base_units_per_pack??catalog?.base_units_per_pack);
      const quotedPacks=Number(req.body?.quoted_packs),minimumPacks=Number(req.body?.minimum_packs??catalog?.minimum_packs??1);
      const price=Number(req.body?.price_per_pack??catalog?.price_per_pack),fee=Number(req.body?.delivery_fee??0);
      if(!offeredName||!packageUnit||!baseUnit||!positive(baseUnits)||!positive(quotedPacks)||!positive(minimumPacks)||!nonNegative(price)||!nonNegative(fee)){
        return res.status(400).json({error:'Complete quote item, package, quantity and price are required'});
      }
      if(quotedPacks+1e-9<minimumPacks)return res.status(400).json({error:'Quoted quantity cannot be below the quote MOQ'});
      const validUntil=String(req.body?.valid_until||'').slice(0,10);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(validUntil)||new Date(validUntil+'T23:59:59Z').getTime()<Date.now()){
        return res.status(400).json({error:'Quote validity date must be current or future'});
      }
      const earliest=req.body?.earliest_fulfilment_date?String(req.body.earliest_fulfilment_date).slice(0,10):null;
      const availability=['available','limited','unavailable'].includes(req.body?.availability_status)
        ?req.body.availability_status:(catalog?.availability_status||'available');
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const existing=await client.query(
          `SELECT id FROM supplier_quotes WHERE rfq_id=$1 AND supplier_business_id=$2
           AND source_type='connected_supplier' AND status IN ('active','converted') FOR UPDATE`,
          [Number(req.params.id),supplier.id]
        );
        let rows;
        if(existing.rowCount){
          ({rows}=await client.query(
            `UPDATE supplier_quotes SET catalog_item_id=$1,offered_name=$2,package_unit=$3,base_unit=$4,
              base_units_per_pack=$5,quoted_packs=$6,minimum_packs=$7,price_per_pack=$8,delivery_fee=$9,
              lead_days=$10,earliest_fulfilment_date=$11,valid_until=$12,availability_status=$13,
              substitution_note=$14,payment_term_note=$15,supplier_note=$16,status='active',updated_at=NOW()
             WHERE id=$17 RETURNING *`,
            [
              catalogItemId,offeredName,packageUnit,baseUnit,baseUnits,quotedPacks,minimumPacks,price,fee,
              Math.max(0,Math.min(365,Math.trunc(Number(req.body?.lead_days??catalog?.lead_time_days??0)))),
              earliest,validUntil,availability,clean(req.body?.substitution_note,600),
              clean(req.body?.payment_term_note,500),clean(req.body?.supplier_note,1000),existing.rows[0].id
            ]
          ));
        }else{
          ({rows}=await client.query(
            `INSERT INTO supplier_quotes(
              rfq_id,source_type,supplier_business_id,supplier_account_id,catalog_item_id,offered_name,
              package_unit,base_unit,base_units_per_pack,quoted_packs,minimum_packs,price_per_pack,
              delivery_fee,lead_days,earliest_fulfilment_date,valid_until,availability_status,
              substitution_note,payment_term_note,supplier_note,status,created_by_account_id
            ) VALUES($1,'connected_supplier',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'active',$3)
            RETURNING *`,
            [
              Number(req.params.id),supplier.id,me.account.id,catalogItemId,offeredName,packageUnit,baseUnit,
              baseUnits,quotedPacks,minimumPacks,price,fee,
              Math.max(0,Math.min(365,Math.trunc(Number(req.body?.lead_days??catalog?.lead_time_days??0)))),
              earliest,validUntil,availability,clean(req.body?.substitution_note,600),
              clean(req.body?.payment_term_note,500),clean(req.body?.supplier_note,1000)
            ]
          ));
        }
        await client.query(`UPDATE supplier_rfq_targets SET state='quoted',responded_at=NOW()
          WHERE rfq_id=$1 AND supplier_business_id=$2`,[Number(req.params.id),supplier.id]);
        await client.query(`UPDATE supplier_rfqs SET status='quoted',updated_at=NOW()
          WHERE id=$1 AND status='open'`,[Number(req.params.id)]);
        await client.query('COMMIT');
        res.json(rows[0]);
      }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
      finally{client.release()}
    }catch(e){next(e)}
  });

  app.post('/api/procurement/sourcing/rfqs/:id/external-quotes',body,async(req,res,next)=>{
    try{
      const me=await identity(req),{rfq,business}=await rfqOwnedByMerchant(pool,me,req.params.id);
      const partyId=Number(req.body?.supply_party_id);
      const party=await pool.query(
        `SELECT * FROM merchant_supply_parties WHERE id=$1 AND business_id=$2 AND status='active'`,[partyId,business.id]
      );
      if(!party.rowCount)return res.status(404).json({error:'External Supplier record not found'});
      if(!['open','quoted'].includes(rfq.status)||new Date(rfq.expires_at).getTime()<=Date.now()){
        return res.status(409).json({error:'RFQ is closed or expired'});
      }
      const offeredName=clean(req.body?.offered_name,180),packageUnit=clean(req.body?.package_unit,50),baseUnit=clean(req.body?.base_unit,50);
      const baseUnits=Number(req.body?.base_units_per_pack),packs=Number(req.body?.quoted_packs),minimum=Number(req.body?.minimum_packs??1);
      const price=Number(req.body?.price_per_pack),fee=Number(req.body?.delivery_fee??0);
      if(!offeredName||!packageUnit||!baseUnit||!positive(baseUnits)||!positive(packs)||!positive(minimum)||!nonNegative(price)||!nonNegative(fee)){
        return res.status(400).json({error:'Complete external quote evidence is required'});
      }
      if(packs+1e-9<minimum)return res.status(400).json({error:'Quoted quantity cannot be below the quote MOQ'});
      const validUntil=String(req.body?.valid_until||'').slice(0,10);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(validUntil)||new Date(validUntil+'T23:59:59Z').getTime()<Date.now()){
        return res.status(400).json({error:'Quote validity date must be current or future'});
      }
      const existing=await pool.query(
        `SELECT id FROM supplier_quotes WHERE rfq_id=$1 AND supply_party_id=$2
         AND source_type='external' AND status IN ('active','converted')`,[rfq.id,partyId]
      );
      const params=[
        offeredName,packageUnit,baseUnit,baseUnits,packs,minimum,price,fee,
        Math.max(0,Math.min(365,Math.trunc(Number(req.body?.lead_days)||0))),
        req.body?.earliest_fulfilment_date?String(req.body.earliest_fulfilment_date).slice(0,10):null,
        validUntil,['available','limited','unavailable'].includes(req.body?.availability_status)?req.body.availability_status:'available',
        clean(req.body?.substitution_note,600),clean(req.body?.payment_term_note,500),clean(req.body?.supplier_note,1000)
      ];
      let rows;
      if(existing.rowCount){
        ({rows}=await pool.query(
          `UPDATE supplier_quotes SET offered_name=$1,package_unit=$2,base_unit=$3,base_units_per_pack=$4,
           quoted_packs=$5,minimum_packs=$6,price_per_pack=$7,delivery_fee=$8,lead_days=$9,
           earliest_fulfilment_date=$10,valid_until=$11,availability_status=$12,substitution_note=$13,
           payment_term_note=$14,supplier_note=$15,status='active',updated_at=NOW()
           WHERE id=$16 RETURNING *`,[...params,existing.rows[0].id]
        ));
      }else{
        ({rows}=await pool.query(
          `INSERT INTO supplier_quotes(
            rfq_id,source_type,supply_party_id,offered_name,package_unit,base_unit,base_units_per_pack,
            quoted_packs,minimum_packs,price_per_pack,delivery_fee,lead_days,earliest_fulfilment_date,
            valid_until,availability_status,substitution_note,payment_term_note,supplier_note,status,created_by_account_id
          ) VALUES($1,'external',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'active',$19)
          RETURNING *`,
          [rfq.id,partyId,...params,me.account.id]
        ));
      }
      res.status(existing.rowCount?200:201).json(rows[0]);
    }catch(e){next(e)}
  });

  app.put('/api/procurement/inventory/:inventoryId/supplier-sources',body,async(req,res,next)=>{
    try{
      const me=await identity(req),inventoryId=Number(req.params.inventoryId);
      const inv=await pool.query(`SELECT * FROM inventory WHERE id=$1`,[inventoryId]);
      if(!inv.rowCount)return res.status(404).json({error:'Inventory item not found'});
      const merchant=await exactProfileBusiness(pool,me,'merchant',inv.rows[0].business_id);
      const sources=validatePreferenceRanks(req.body?.sources||[]),catalogIds=sources.map(x=>x.catalog_item_id);
      const catalogs=catalogIds.length?await pool.query(
        `SELECT c.id,c.supplier_account_id FROM supplier_catalog_items c
         WHERE c.id=ANY($1::bigint[]) AND c.active=TRUE`,[catalogIds]
      ):{rows:[]};
      if(catalogs.rowCount!==catalogIds.length)return res.status(409).json({error:'One or more Supplier sources are unavailable'});
      const byCatalog=new Map(catalogs.rows.map(x=>[Number(x.id),x]));
      for(const s of sources){
        const cat=byCatalog.get(s.catalog_item_id);
        if(!await acceptedRelationship(pool,merchant.id,cat.supplier_account_id)){
          throw err(409,'Preferred reorder sources require accepted Supplier relationships');
        }
      }
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        await client.query(`DELETE FROM merchant_inventory_supplier_sources WHERE business_id=$1 AND inventory_id=$2`,[merchant.id,inventoryId]);
        for(const s of sources){
          const cat=byCatalog.get(s.catalog_item_id);
          await client.query(
            `INSERT INTO merchant_inventory_supplier_sources(
              business_id,inventory_id,catalog_item_id,supplier_account_id,preference_rank,note,created_by_account_id
            ) VALUES($1,$2,$3,$4,$5,$6,$7)`,
            [merchant.id,inventoryId,s.catalog_item_id,cat.supplier_account_id,s.preference_rank,s.note,me.account.id]
          );
        }
        await client.query('COMMIT');
      }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
      finally{client.release()}
      const {rows}=await pool.query(
        `SELECT s.*,c.product_name,c.unit_name,c.base_unit,c.base_units_per_pack,c.price_per_pack,c.availability_status,
          COALESCE(sp.supplier_name,a.display_name) supplier_name
         FROM merchant_inventory_supplier_sources s JOIN supplier_catalog_items c ON c.id=s.catalog_item_id
         JOIN accounts a ON a.id=s.supplier_account_id LEFT JOIN supplier_profiles sp ON sp.account_id=s.supplier_account_id
         WHERE s.business_id=$1 AND s.inventory_id=$2 ORDER BY s.preference_rank`,[merchant.id,inventoryId]
      );
      res.json(rows);
    }catch(e){next(e)}
  });

  app.get('/api/procurement/inventory/:inventoryId/supplier-sources',async(req,res,next)=>{
    try{
      const me=await identity(req);
      const inv=await pool.query(`SELECT business_id FROM inventory WHERE id=$1`,[Number(req.params.inventoryId)]);
      if(!inv.rowCount)return res.status(404).json({error:'Inventory item not found'});
      const merchant=await exactProfileBusiness(pool,me,'merchant',inv.rows[0].business_id);
      const {rows}=await pool.query(
        `SELECT s.*,c.product_name,c.unit_name,c.base_unit,c.base_units_per_pack,c.price_per_pack,c.availability_status,
          COALESCE(sp.supplier_name,a.display_name) supplier_name
         FROM merchant_inventory_supplier_sources s JOIN supplier_catalog_items c ON c.id=s.catalog_item_id
         JOIN accounts a ON a.id=s.supplier_account_id LEFT JOIN supplier_profiles sp ON sp.account_id=s.supplier_account_id
         WHERE s.business_id=$1 AND s.inventory_id=$2 AND s.active=TRUE ORDER BY s.preference_rank`,
        [merchant.id,Number(req.params.inventoryId)]
      );
      res.json(rows);
    }catch(e){next(e)}
  });

  app.post('/api/procurement/sourcing/quotes/:quoteId/create-po',body,async(req,res,next)=>{
    try{
      const me=await identity(req);
      const quoteQ=await pool.query(
        `SELECT q.*,r.business_id merchant_business_id,r.fulfilment_mode rfq_fulfilment_mode,r.needed_by
         FROM supplier_quotes q JOIN supplier_rfqs r ON r.id=q.rfq_id WHERE q.id=$1`,[Number(req.params.quoteId)]
      );
      if(!quoteQ.rowCount)return res.status(404).json({error:'Quote not found'});
      const quote=quoteQ.rows[0],merchant=await exactProfileBusiness(pool,me,'merchant',quote.merchant_business_id);
      if(quote.source_type!=='connected_supplier')return res.status(409).json({error:'External Supplier quote cannot create an in-app PO'});
      const quoteValidDate=quote.valid_until instanceof Date
        ?quote.valid_until.toISOString().slice(0,10)
        :String(quote.valid_until||'').slice(0,10);
      if(quote.status!=='active'||!/^\d{4}-\d{2}-\d{2}$/.test(quoteValidDate)
        ||new Date(quoteValidDate+'T23:59:59Z').getTime()<Date.now()){
        return res.status(409).json({error:'Quote is no longer active'});
      }
      if(!await acceptedRelationship(pool,merchant.id,quote.supplier_account_id)){
        return res.status(409).json({error:'Accepted Supplier relationship required before creating a PO'});
      }
      const packs=Number(req.body?.order_packs??quote.quoted_packs);
      if(!positive(packs)||packs<Number(quote.minimum_packs)||packs>Number(quote.quoted_packs)+1e-9){
        return res.status(400).json({error:'Order quantity must fit the quoted quantity and MOQ'});
      }
      let handling='sealed_resale',sku='';
      if(quote.catalog_item_id){
        const catalog=await pool.query(
          `SELECT * FROM supplier_catalog_items WHERE id=$1 AND supplier_account_id=$2 AND active=TRUE`,
          [quote.catalog_item_id,quote.supplier_account_id]
        );
        if(catalog.rowCount){handling=catalog.rows[0].handling_mode||'sealed_resale';sku=catalog.rows[0].sku||''}
      }
      const subtotal=money(packs*Number(quote.price_per_pack));
      const mode=req.body?.fulfilment_mode==='pickup'?'pickup'
        :req.body?.fulfilment_mode==='delivery'?'delivery'
        :quote.rfq_fulfilment_mode==='pickup'?'pickup':'delivery';
      const deliveryFee=mode==='pickup'?0:Number(quote.delivery_fee),total=money(subtotal+deliveryFee);
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const po=await client.query(
          `INSERT INTO purchase_orders(
            public_token,business_id,supplier_account_id,status,fulfilment_mode,subtotal,delivery_fee,
            expected_total,requested_date,merchant_note,sent_at,source_quote_id
          ) VALUES($1,$2,$3,'sent',$4,$5,$6,$7,$8,$9,NOW(),$10) RETURNING *`,
          [
            token(),merchant.id,quote.supplier_account_id,mode,subtotal,deliveryFee,total,quote.needed_by||null,
            clean(req.body?.merchant_note,1000),quote.id
          ]
        );
        const poId=Number(po.rows[0].id);await client.query(`UPDATE purchase_orders SET po_number=$1 WHERE id=$2`,[poNumber(poId),poId]);
        await client.query(
          `INSERT INTO purchase_order_items(
            purchase_order_id,catalog_item_id,name_snapshot,sku_snapshot,unit_name_snapshot,base_unit_snapshot,
            base_units_per_pack_snapshot,handling_mode_snapshot,ordered_packs,price_per_pack_snapshot,line_total
          ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            poId,quote.catalog_item_id,quote.offered_name,sku,quote.package_unit,quote.base_unit,
            quote.base_units_per_pack,handling,packs,quote.price_per_pack,subtotal
          ]
        );
        await client.query(`UPDATE supplier_quotes SET status='converted',updated_at=NOW() WHERE id=$1`,[quote.id]);
        await client.query(`UPDATE supplier_rfqs SET status='closed',updated_at=NOW() WHERE id=$1`,[quote.rfq_id]);
        await client.query('COMMIT');
        res.status(201).json({purchase_order_id:poId,po_number:poNumber(poId),source_quote_id:Number(quote.id),expected_total:total});
      }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
      finally{client.release()}
    }catch(e){next(e)}
  });
}

export async function supplierReorderSuggestions(pool,businessId){
  const {rows}=await pool.query(
    `SELECT
       i.id inventory_id,i.item,i.quantity,i.reorder_level,i.unit,i.unit_cost,i.base_unit inventory_base_unit,
       src.catalog_item_id,src.preference_rank,
       c.product_name,c.unit_name,c.base_unit,c.base_units_per_pack,c.price_per_pack,c.minimum_packs,
       c.lead_time_days,c.supplier_account_id,c.availability_status,
       COALESCE(sp.supplier_name,a.display_name) supplier_name
     FROM inventory i
     LEFT JOIN LATERAL (
       SELECT ms.catalog_item_id,ms.preference_rank,ms.supplier_account_id
       FROM merchant_inventory_supplier_sources ms
       JOIN supplier_catalog_items sc
         ON sc.id=ms.catalog_item_id
        AND sc.active=TRUE
        AND sc.availability_status<>'unavailable'
       JOIN supplier_relationships rel
         ON rel.business_id=ms.business_id
        AND rel.supplier_account_id=ms.supplier_account_id
        AND rel.state='accepted'
       WHERE ms.business_id=i.business_id
         AND ms.inventory_id=i.id
         AND ms.active=TRUE
       ORDER BY ms.preference_rank,ms.catalog_item_id
       LIMIT 1
     ) src ON TRUE
     LEFT JOIN supplier_catalog_items c ON c.id=src.catalog_item_id
     LEFT JOIN accounts a ON a.id=c.supplier_account_id
     LEFT JOIN supplier_profiles sp ON sp.account_id=c.supplier_account_id
     WHERE i.business_id=$1
       AND i.quantity<=i.reorder_level
     ORDER BY (i.reorder_level-i.quantity) DESC,i.item,i.id`,
    [Number(businessId)]
  );
  return rows.map(x=>{
    if(!x.catalog_item_id)return{...x,source_status:'NO_CONFIGURED_SOURCE',suggested_packs:null};
    const suggestion=reorderPackSuggestion({
      quantity:Number(x.quantity),reorderLevel:Number(x.reorder_level),
      inventoryUnit:x.inventory_base_unit||x.unit,
      baseUnitsPerPack:Number(x.base_units_per_pack),supplierBaseUnit:x.base_unit,
      minimumPacks:Number(x.minimum_packs||1)
    });
    return{
      ...x,
      source_status:suggestion.status==='COMPARABLE'?'PREFERRED_SOURCE':suggestion.status,
      suggested_packs:suggestion.suggested_packs
    };
  });
}

export const supplierSourcingV4Internals={
  sourcingSettings,rfqOwnedByMerchant,rfqTargetForSupplier,quoteRows,comparison,acceptedRelationship
};
