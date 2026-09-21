import {supplierDomainV2Internals} from './server-supplier-domain-v2.js';
import {
  validateBackorderProposal,validateSubstitutionProposal,
  exceptionStateAfterMerchantDecision,backorderFulfilmentDelta
} from './supplier-exceptions-core.js';

const {exactProfileBusiness}=supplierDomainV2Internals;
const clean=(v,max=800)=>String(v??'').trim().slice(0,max);
const httpError=(status,message)=>Object.assign(new Error(message),{status});

function enabledSupplier(me){
  return Boolean(me?.account?.id&&me?.profiles?.some(p=>p.role==='supplier'&&p.enabled));
}

async function activeSupplierBindingCount(pool,accountId){
  const {rows}=await pool.query(
    `SELECT COUNT(*)::int c
       FROM profile_business_bindings
      WHERE account_id=$1 AND role='supplier' AND status='active'`,
    [Number(accountId)]
  );
  return Number(rows[0]?.c||0);
}

async function supplierPoContext(pool,me,poId,requestedBusinessId=null){
  if(!enabledSupplier(me))throw httpError(403,'Supplier profile required');
  const business=await exactProfileBusiness(pool,me,'supplier',requestedBusinessId);
  const {rows}=await pool.query(
    `SELECT p.*,q.supplier_business_id quote_supplier_business_id
       FROM purchase_orders p
       LEFT JOIN supplier_quotes q ON q.id=p.source_quote_id
      WHERE p.id=$1 AND p.supplier_account_id=$2`,
    [Number(poId),Number(me.account.id)]
  );
  if(!rows.length)throw httpError(404,'Purchase order not found');
  const po=rows[0];
  if(po.quote_supplier_business_id!=null
    &&Number(po.quote_supplier_business_id)!==Number(business.id)){
    throw httpError(404,'Purchase order is not attributed to this Supplier business');
  }
  if(po.quote_supplier_business_id==null
    &&await activeSupplierBindingCount(pool,me.account.id)>1){
    throw httpError(409,'Purchase order Supplier-business attribution is ambiguous for this multi-business account');
  }
  return{po,business};
}

async function merchantPoBusiness(pool,me,poId){
  const {rows}=await pool.query(`SELECT * FROM purchase_orders WHERE id=$1`,[Number(poId)]);
  if(!rows.length)throw httpError(404,'Purchase order not found');
  const business=await exactProfileBusiness(pool,me,'merchant',rows[0].business_id);
  return{po:rows[0],business};
}

async function poItem(pool,poId,itemId,{client=pool,lock=false}={}){
  const {rows}=await client.query(
    `SELECT * FROM purchase_order_items
      WHERE id=$1 AND purchase_order_id=$2
      ${lock?'FOR UPDATE':''}`,
    [Number(itemId),Number(poId)]
  );
  return rows[0]||null;
}

function validFutureOrTodayDate(value,label,{required=true}={}){
  if(value==null||String(value).trim()===''){
    if(required)throw httpError(400,`${label} is required`);
    return null;
  }
  const s=String(value).slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(new Date(s+'T00:00:00Z').getTime())){
    throw httpError(400,`${label} is invalid`);
  }
  const today=new Date().toISOString().slice(0,10);
  if(s<today)throw httpError(400,`${label} cannot be in the past`);
  return s;
}

export async function ensureSupplierExceptionsV5Schema(pool){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS supplier_backorders(
      id BIGSERIAL PRIMARY KEY,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      supplier_business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      supplier_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      purchase_order_id BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
      purchase_order_item_id BIGINT NOT NULL REFERENCES purchase_order_items(id) ON DELETE CASCADE,
      proposed_packs NUMERIC(16,6) NOT NULL CHECK(proposed_packs>0),
      expected_available_date DATE NOT NULL,
      state TEXT NOT NULL DEFAULT 'proposed',
      supplier_note TEXT NOT NULL DEFAULT '',
      merchant_note TEXT NOT NULL DEFAULT '',
      created_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      merchant_responded_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      fulfilled_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      merchant_responded_at TIMESTAMPTZ,
      fulfilled_at TIMESTAMPTZ,
      CHECK(state IN ('proposed','merchant_accepted','merchant_declined','fulfilled','cancelled'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS supplier_backorders_active_item_unique
      ON supplier_backorders(purchase_order_item_id)
      WHERE state IN ('proposed','merchant_accepted');

    CREATE TABLE IF NOT EXISTS supplier_substitution_proposals(
      id BIGSERIAL PRIMARY KEY,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      supplier_business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      supplier_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      purchase_order_id BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
      original_purchase_order_item_id BIGINT NOT NULL REFERENCES purchase_order_items(id) ON DELETE CASCADE,
      substitute_catalog_item_id BIGINT NOT NULL REFERENCES supplier_catalog_items(id) ON DELETE RESTRICT,
      substitute_name_snapshot TEXT NOT NULL,
      substitute_unit_name_snapshot TEXT NOT NULL,
      substitute_base_unit_snapshot TEXT NOT NULL,
      substitute_base_units_per_pack_snapshot NUMERIC(16,6) NOT NULL CHECK(substitute_base_units_per_pack_snapshot>0),
      substitute_handling_mode_snapshot TEXT NOT NULL,
      proposed_packs NUMERIC(16,6) NOT NULL CHECK(proposed_packs>0),
      substitute_price_per_pack NUMERIC(14,2) NOT NULL CHECK(substitute_price_per_pack>=0),
      expected_available_date DATE,
      reason_code TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'proposed',
      supplier_note TEXT NOT NULL DEFAULT '',
      merchant_note TEXT NOT NULL DEFAULT '',
      created_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      merchant_responded_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      merchant_responded_at TIMESTAMPTZ,
      CHECK(reason_code IN ('unavailable','quality','pack_size','brand_request','other')),
      CHECK(state IN ('proposed','merchant_accepted','merchant_declined','cancelled'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS supplier_substitutions_active_item_unique
      ON supplier_substitution_proposals(original_purchase_order_item_id)
      WHERE state IN ('proposed','merchant_accepted');
  `);
}

async function backorderDetail(pool,id){
  const {rows}=await pool.query(
    `SELECT b.*,p.po_number,p.status purchase_order_status,
            i.name_snapshot original_item_name,i.ordered_packs,i.confirmed_packs,
            mb.name merchant_business_name,sb.name supplier_business_name
       FROM supplier_backorders b
       JOIN purchase_orders p ON p.id=b.purchase_order_id
       JOIN purchase_order_items i ON i.id=b.purchase_order_item_id
       JOIN businesses mb ON mb.id=b.business_id
       JOIN businesses sb ON sb.id=b.supplier_business_id
      WHERE b.id=$1`,
    [Number(id)]
  );
  return rows[0]||null;
}

async function substitutionDetail(pool,id){
  const {rows}=await pool.query(
    `SELECT s.*,p.po_number,p.status purchase_order_status,
            i.name_snapshot original_item_name,i.ordered_packs,i.confirmed_packs,
            mb.name merchant_business_name,sb.name supplier_business_name
       FROM supplier_substitution_proposals s
       JOIN purchase_orders p ON p.id=s.purchase_order_id
       JOIN purchase_order_items i ON i.id=s.original_purchase_order_item_id
       JOIN businesses mb ON mb.id=s.business_id
       JOIN businesses sb ON sb.id=s.supplier_business_id
      WHERE s.id=$1`,
    [Number(id)]
  );
  return rows[0]||null;
}

export function registerSupplierExceptionsV5Routes({app,pool,body,identity}){
  app.post('/api/supplier/orders/:id/backorders',body,async(req,res,next)=>{
    try{
      const me=await identity(req);
      const {po,business}=await supplierPoContext(pool,me,req.params.id,req.body?.supplier_business_id||null);
      if(!['partially_accepted','preparing'].includes(po.status)){
        return res.status(409).json({error:'Backorder proposal requires a partially accepted or preparing PO'});
      }
      const item=await poItem(pool,po.id,req.body?.purchase_order_item_id);
      if(!item)return res.status(404).json({error:'Purchase order item not found'});
      const proposal=validateBackorderProposal({
        orderedPacks:item.ordered_packs,confirmedPacks:item.confirmed_packs,proposedPacks:req.body?.proposed_packs
      });
      const expected=validFutureOrTodayDate(req.body?.expected_available_date,'Expected available date');
      try{
        const {rows}=await pool.query(
          `INSERT INTO supplier_backorders(
            business_id,supplier_business_id,supplier_account_id,purchase_order_id,purchase_order_item_id,
            proposed_packs,expected_available_date,supplier_note,created_by_account_id
          ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$3) RETURNING *`,
          [po.business_id,business.id,me.account.id,po.id,item.id,proposal.proposed_packs,expected,clean(req.body?.supplier_note)]
        );
        res.status(201).json({...rows[0],po_quantities_changed:false});
      }catch(e){
        if(e.code==='23505')return res.status(409).json({error:'An active backorder already exists for this PO item'});
        throw e;
      }
    }catch(e){next(e)}
  });

  app.get('/api/supplier/v5/backorders',async(req,res,next)=>{
    try{
      const me=await identity(req);
      const business=await exactProfileBusiness(pool,me,'supplier',req.query.business_id||null);
      const {rows}=await pool.query(
        `SELECT b.*,p.po_number,i.name_snapshot original_item_name,mb.name merchant_business_name
           FROM supplier_backorders b
           JOIN purchase_orders p ON p.id=b.purchase_order_id
           JOIN purchase_order_items i ON i.id=b.purchase_order_item_id
           JOIN businesses mb ON mb.id=b.business_id
          WHERE b.supplier_business_id=$1 AND b.supplier_account_id=$2
          ORDER BY b.created_at DESC,b.id DESC LIMIT 300`,
        [business.id,me.account.id]
      );
      res.json(rows);
    }catch(e){next(e)}
  });

  app.post('/api/procurement/backorders/:id/respond',body,async(req,res,next)=>{
    try{
      const me=await identity(req);
      const current=await backorderDetail(pool,req.params.id);
      if(!current)return res.status(404).json({error:'Backorder not found'});
      const {business}=await merchantPoBusiness(pool,me,current.purchase_order_id);
      if(Number(current.business_id)!==Number(business.id))return res.status(404).json({error:'Backorder not found'});
      const accept=Boolean(req.body?.accept);
      const state=exceptionStateAfterMerchantDecision({currentState:current.state,accept});
      const {rows}=await pool.query(
        `UPDATE supplier_backorders
            SET state=$1,merchant_note=$2,merchant_responded_by_account_id=$3,
                merchant_responded_at=NOW(),updated_at=NOW()
          WHERE id=$4 AND business_id=$5 AND state='proposed'
          RETURNING *`,
        [state,clean(req.body?.merchant_note),me.account.id,current.id,business.id]
      );
      if(!rows.length)return res.status(409).json({error:'Backorder is no longer awaiting Merchant decision'});
      res.json({...await backorderDetail(pool,current.id),po_quantities_changed:false,inventory_changed:false,money_changed:false});
    }catch(e){next(e)}
  });

  app.get('/api/procurement/backorders',async(req,res,next)=>{
    try{
      const me=await identity(req);
      const business=await exactProfileBusiness(pool,me,'merchant',req.query.business_id||null);
      const {rows}=await pool.query(
        `SELECT b.*,p.po_number,i.name_snapshot original_item_name,sb.name supplier_business_name
           FROM supplier_backorders b
           JOIN purchase_orders p ON p.id=b.purchase_order_id
           JOIN purchase_order_items i ON i.id=b.purchase_order_item_id
           JOIN businesses sb ON sb.id=b.supplier_business_id
          WHERE b.business_id=$1
          ORDER BY b.created_at DESC,b.id DESC LIMIT 300`,
        [business.id]
      );
      res.json(rows);
    }catch(e){next(e)}
  });

  app.post('/api/supplier/backorders/:id/fulfil',body,async(req,res,next)=>{
    try{
      const me=await identity(req);
      const current=await backorderDetail(pool,req.params.id);
      if(!current||Number(current.supplier_account_id)!==Number(me.account.id))return res.status(404).json({error:'Backorder not found'});
      await exactProfileBusiness(pool,me,'supplier',current.supplier_business_id);
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const bq=await client.query(`SELECT * FROM supplier_backorders WHERE id=$1 FOR UPDATE`,[current.id]);
        if(!bq.rowCount)throw httpError(404,'Backorder not found');
        const b=bq.rows[0];
        const item=await poItem(pool,b.purchase_order_id,b.purchase_order_item_id,{client,lock:true});
        if(!item)throw httpError(404,'Purchase order item not found');
        const delta=backorderFulfilmentDelta({
          state:b.state,orderedPacks:item.ordered_packs,confirmedPacks:item.confirmed_packs,proposedPacks:b.proposed_packs
        });
        await client.query(
          `UPDATE purchase_order_items SET confirmed_packs=$1 WHERE id=$2`,
          [delta.new_confirmed_packs,item.id]
        );
        await client.query(
          `UPDATE supplier_backorders
              SET state='fulfilled',fulfilled_by_account_id=$1,fulfilled_at=NOW(),updated_at=NOW()
            WHERE id=$2`,
          [me.account.id,b.id]
        );
        const all=await client.query(
          `SELECT BOOL_AND(confirmed_packs+0.000001>=ordered_packs) all_confirmed
             FROM purchase_order_items WHERE purchase_order_id=$1`,
          [b.purchase_order_id]
        );
        if(all.rows[0]?.all_confirmed){
          await client.query(
            `UPDATE purchase_orders
                SET status=CASE WHEN status='partially_accepted' THEN 'accepted' ELSE status END,updated_at=NOW()
              WHERE id=$1`,
            [b.purchase_order_id]
          );
        }
        await client.query('COMMIT');
        res.json({
          ...await backorderDetail(pool,b.id),
          added_confirmed_packs:delta.add_confirmed_packs,
          ordered_packs_unchanged:true,
          inventory_changed:false,
          money_changed:false
        });
      }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
      finally{client.release()}
    }catch(e){next(e)}
  });

  app.post('/api/supplier/orders/:id/substitutions',body,async(req,res,next)=>{
    try{
      const me=await identity(req);
      const {po,business}=await supplierPoContext(pool,me,req.params.id,req.body?.supplier_business_id||null);
      if(!['partially_accepted','preparing'].includes(po.status)){
        return res.status(409).json({error:'Substitution proposal requires a partially accepted or preparing PO'});
      }
      const item=await poItem(pool,po.id,req.body?.purchase_order_item_id);
      if(!item)return res.status(404).json({error:'Purchase order item not found'});
      if(await activeSupplierBindingCount(pool,me.account.id)!==1){
        return res.status(409).json({
          error:'Substitution requires explicit catalog-to-business attribution for multi-business Supplier accounts.',
          code:'SUPPLIER_SUBSTITUTE_CATALOG_ATTRIBUTION_REQUIRED',
          supplier_business_id:Number(business.id)
        });
      }
      const substituteId=Number(req.body?.substitute_catalog_item_id);
      const cat=await pool.query(
        `SELECT * FROM supplier_catalog_items
          WHERE id=$1 AND supplier_account_id=$2 AND active=TRUE AND availability_status<>'unavailable'`,
        [substituteId,me.account.id]
      );
      if(!cat.rowCount)return res.status(404).json({error:'Substitute catalog item is unavailable'});
      if(Number(item.catalog_item_id)===substituteId)return res.status(409).json({error:'Substitute must be a different catalog item'});
      const substitute=cat.rows[0];
      const validated=validateSubstitutionProposal({
        orderedPacks:item.ordered_packs,confirmedPacks:item.confirmed_packs,
        proposedPacks:req.body?.proposed_packs,pricePerPack:req.body?.price_per_pack??substitute.price_per_pack
      });
      const reason=clean(req.body?.reason_code,40);
      if(!['unavailable','quality','pack_size','brand_request','other'].includes(reason)){
        return res.status(400).json({error:'Valid substitution reason is required'});
      }
      const expected=validFutureOrTodayDate(req.body?.expected_available_date,'Expected available date',{required:false});
      try{
        const {rows}=await pool.query(
          `INSERT INTO supplier_substitution_proposals(
            business_id,supplier_business_id,supplier_account_id,purchase_order_id,original_purchase_order_item_id,
            substitute_catalog_item_id,substitute_name_snapshot,substitute_unit_name_snapshot,
            substitute_base_unit_snapshot,substitute_base_units_per_pack_snapshot,substitute_handling_mode_snapshot,
            proposed_packs,substitute_price_per_pack,expected_available_date,reason_code,supplier_note,created_by_account_id
          ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$3) RETURNING *`,
          [
            po.business_id,business.id,me.account.id,po.id,item.id,substitute.id,substitute.product_name,
            substitute.unit_name,substitute.base_unit,substitute.base_units_per_pack,
            substitute.handling_mode||'sealed_resale',validated.proposed_packs,validated.price_per_pack,
            expected,reason,clean(req.body?.supplier_note)
          ]
        );
        res.status(201).json({...rows[0],po_mutated:false,inventory_changed:false,money_changed:false});
      }catch(e){
        if(e.code==='23505')return res.status(409).json({error:'An active substitution already exists for this PO item'});
        throw e;
      }
    }catch(e){next(e)}
  });

  app.get('/api/supplier/v5/substitutions',async(req,res,next)=>{
    try{
      const me=await identity(req);
      const business=await exactProfileBusiness(pool,me,'supplier',req.query.business_id||null);
      const {rows}=await pool.query(
        `SELECT s.*,p.po_number,i.name_snapshot original_item_name,mb.name merchant_business_name
           FROM supplier_substitution_proposals s
           JOIN purchase_orders p ON p.id=s.purchase_order_id
           JOIN purchase_order_items i ON i.id=s.original_purchase_order_item_id
           JOIN businesses mb ON mb.id=s.business_id
          WHERE s.supplier_business_id=$1 AND s.supplier_account_id=$2
          ORDER BY s.created_at DESC,s.id DESC LIMIT 300`,
        [business.id,me.account.id]
      );
      res.json(rows);
    }catch(e){next(e)}
  });

  app.get('/api/procurement/substitutions',async(req,res,next)=>{
    try{
      const me=await identity(req);
      const business=await exactProfileBusiness(pool,me,'merchant',req.query.business_id||null);
      const {rows}=await pool.query(
        `SELECT s.*,p.po_number,i.name_snapshot original_item_name,sb.name supplier_business_name
           FROM supplier_substitution_proposals s
           JOIN purchase_orders p ON p.id=s.purchase_order_id
           JOIN purchase_order_items i ON i.id=s.original_purchase_order_item_id
           JOIN businesses sb ON sb.id=s.supplier_business_id
          WHERE s.business_id=$1
          ORDER BY s.created_at DESC,s.id DESC LIMIT 300`,
        [business.id]
      );
      res.json(rows);
    }catch(e){next(e)}
  });

  app.post('/api/procurement/substitutions/:id/respond',body,async(req,res,next)=>{
    try{
      const me=await identity(req);
      const current=await substitutionDetail(pool,req.params.id);
      if(!current)return res.status(404).json({error:'Substitution proposal not found'});
      const {business}=await merchantPoBusiness(pool,me,current.purchase_order_id);
      if(Number(current.business_id)!==Number(business.id))return res.status(404).json({error:'Substitution proposal not found'});
      const accept=Boolean(req.body?.accept);
      const state=exceptionStateAfterMerchantDecision({currentState:current.state,accept});
      const {rows}=await pool.query(
        `UPDATE supplier_substitution_proposals
            SET state=$1,merchant_note=$2,merchant_responded_by_account_id=$3,
                merchant_responded_at=NOW(),updated_at=NOW()
          WHERE id=$4 AND business_id=$5 AND state='proposed'
          RETURNING *`,
        [state,clean(req.body?.merchant_note),me.account.id,current.id,business.id]
      );
      if(!rows.length)return res.status(409).json({error:'Substitution proposal is no longer awaiting Merchant decision'});
      res.json({
        ...await substitutionDetail(pool,current.id),
        po_mutated:false,inventory_changed:false,money_changed:false,
        fulfilment_status:accept?'MERCHANT_APPROVED_NOT_YET_FULFILLED':'DECLINED'
      });
    }catch(e){next(e)}
  });
}

export const supplierExceptionsV5Internals={
  activeSupplierBindingCount,supplierPoContext,merchantPoBusiness,poItem,
  backorderDetail,substitutionDetail
};
