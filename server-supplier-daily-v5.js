import {supplierDomainV2Internals} from './server-supplier-domain-v2.js';
import {summarizeSupplierToday} from './supplier-daily-core.js';

const {exactProfileBusiness}=supplierDomainV2Internals;
const clean=(v,max=500)=>String(v??'').trim().slice(0,max);

async function supplierBindingCount(pool,accountId){
  const {rows}=await pool.query(
    `SELECT COUNT(*)::int c
       FROM profile_business_bindings
      WHERE account_id=$1 AND role='supplier' AND status='active'`,
    [Number(accountId)]
  );
  return Number(rows[0]?.c||0);
}

async function supplierTodayOrders(pool,accountId){
  const {rows}=await pool.query(
    `SELECT
       p.*,b.name business_name,
       COALESCE(inv.invoice_total,0) invoice_total,
       inv.earliest_due_date,
       COALESCE(cr.confirmed_credits,0) confirmed_credits,
       GREATEST(
         CASE
           WHEN COALESCE(inv.invoice_total,0)>0 THEN inv.invoice_total
           ELSE COALESCE(p.actual_received_total,0)
         END
         -COALESCE(cr.confirmed_credits,0)-p.paid_amount,
         0
       ) commercial_outstanding
     FROM purchase_orders p
     JOIN businesses b ON b.id=p.business_id
     LEFT JOIN (
       SELECT purchase_order_id,
              COALESCE(SUM(gross_amount) FILTER(WHERE evidence_status='active'),0) invoice_total,
              MIN(due_date) FILTER(WHERE evidence_status='active') earliest_due_date
       FROM purchase_invoice_evidence
       GROUP BY purchase_order_id
     ) inv ON inv.purchase_order_id=p.id
     LEFT JOIN (
       SELECT purchase_order_id,
              COALESCE(SUM(confirmed_credit) FILTER(
                WHERE status='resolved' AND resolution_type IN ('credit','refund_expected')
              ),0) confirmed_credits
       FROM purchase_returns
       GROUP BY purchase_order_id
     ) cr ON cr.purchase_order_id=p.id
     WHERE p.supplier_account_id=$1
       AND p.status NOT IN ('cancelled','rejected')
     ORDER BY p.created_at DESC,p.id DESC
     LIMIT 300`,
    [Number(accountId)]
  );
  return rows;
}

async function supplierTodayRfqs(pool,{businessId,accountId}){
  const {rows}=await pool.query(
    `SELECT r.*,t.state target_state,t.invited_at,t.viewed_at,b.name merchant_business_name
       FROM supplier_rfq_targets t
       JOIN supplier_rfqs r ON r.id=t.rfq_id
       JOIN businesses b ON b.id=r.business_id
      WHERE t.supplier_business_id=$1
        AND t.supplier_account_id=$2
        AND t.state IN ('invited','viewed')
        AND r.status IN ('open','quoted')
        AND r.expires_at>NOW()
      ORDER BY r.created_at,r.id`,
    [Number(businessId),Number(accountId)]
  );
  return rows;
}

async function supplierTodayReturns(pool,accountId){
  const {rows}=await pool.query(
    `SELECT r.*,b.name business_name
       FROM purchase_returns r
       JOIN businesses b ON b.id=r.business_id
      WHERE r.supplier_account_id=$1
        AND r.status IN ('requested','returned')
      ORDER BY r.created_at,r.id`,
    [Number(accountId)]
  );
  return rows;
}

async function supplierTodayCatalog(pool,accountId){
  const {rows}=await pool.query(
    `SELECT id,product_name,sku,unit_name,base_unit,base_units_per_pack,price_per_pack,
            minimum_packs,availability_status,lead_time_days,active,
            availability_note,expected_restock_date,updated_at
       FROM supplier_catalog_items
      WHERE supplier_account_id=$1 AND active=TRUE
      ORDER BY availability_status='available',product_name,id`,
    [Number(accountId)]
  );
  return rows;
}

async function supplierMoneyReceived(pool,accountId){
  const {rows}=await pool.query(
    `SELECT COALESCE(SUM(paid_amount) FILTER(
       WHERE status NOT IN ('cancelled','rejected')
     ),0) money_received_recorded
       FROM purchase_orders
      WHERE supplier_account_id=$1`,
    [Number(accountId)]
  );
  return Number(rows[0]?.money_received_recorded||0);
}

export async function ensureSupplierDailyV5Schema(pool){
  await pool.query(`
    ALTER TABLE supplier_catalog_items
      ADD COLUMN IF NOT EXISTS availability_note TEXT NOT NULL DEFAULT '';
    ALTER TABLE supplier_catalog_items
      ADD COLUMN IF NOT EXISTS expected_restock_date DATE;
  `);
}

export function registerSupplierDailyV5Routes({app,pool,body,identity}){
  app.get('/api/supplier/v5/today',async(req,res,next)=>{
    try{
      const me=await identity(req);
      const business=await exactProfileBusiness(pool,me,'supplier',req.query.business_id||null);
      const [orders,rfqs,returns,catalog,bindingCount,moneyReceived]=await Promise.all([
        supplierTodayOrders(pool,me.account.id),
        supplierTodayRfqs(pool,{businessId:business.id,accountId:me.account.id}),
        supplierTodayReturns(pool,me.account.id),
        supplierTodayCatalog(pool,me.account.id),
        supplierBindingCount(pool,me.account.id),
        supplierMoneyReceived(pool,me.account.id)
      ]);
      const summary=summarizeSupplierToday({orders,rfqs,returns,catalog,now:new Date()});
      res.json({
        generated_at:new Date().toISOString(),
        business:{id:Number(business.id),name:business.name,currency_code:business.currency_code||'PHP'},
        attribution_status:bindingCount===1?'SINGLE_SUPPLIER_BUSINESS_BINDING':'ACCOUNT_LEVEL_ORDER_ACTIVITY',
        ...summary,
        money:{
          ...summary.money,
          money_received_recorded:Math.round(moneyReceived*100)/100
        },
        authority:{
          orders:'existing purchase_order lifecycle states',
          receivables:'Operational Supplier receivables: invoice evidence when present, otherwise received value; minus credits and payments. Unreceived PO commitment is not money due.',
          catalog_availability:'Supplier-declared availability evidence; not exact warehouse stock',
          priority_score:false
        }
      });
    }catch(e){next(e)}
  });

  app.patch('/api/supplier/v5/catalog/:id/availability',body,async(req,res,next)=>{
    try{
      const me=await identity(req);
      await exactProfileBusiness(pool,me,'supplier',req.body?.business_id||null);
      const id=Number(req.params.id);
      const current=await pool.query(
        `SELECT * FROM supplier_catalog_items WHERE id=$1 AND supplier_account_id=$2 AND active=TRUE`,
        [id,me.account.id]
      );
      if(!current.rowCount)return res.status(404).json({error:'Catalog item not found'});
      const x=current.rows[0];
      const availability=['available','limited','unavailable'].includes(req.body?.availability_status)
        ?req.body.availability_status:x.availability_status;
      const lead=req.body?.lead_time_days==null
        ?Number(x.lead_time_days)
        :Math.max(0,Math.min(365,Math.trunc(Number(req.body.lead_time_days)||0)));
      let restock=x.expected_restock_date;
      if(Object.prototype.hasOwnProperty.call(req.body||{},'expected_restock_date')){
        const raw=req.body?.expected_restock_date;
        if(raw==null||String(raw).trim()==='')restock=null;
        else{
          const s=String(raw).slice(0,10);
          if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(new Date(s+'T00:00:00Z').getTime())){
            return res.status(400).json({error:'Expected restock date is invalid'});
          }
          restock=s;
        }
      }
      const note=Object.prototype.hasOwnProperty.call(req.body||{},'availability_note')
        ?clean(req.body.availability_note,600)
        :x.availability_note;
      const {rows}=await pool.query(
        `UPDATE supplier_catalog_items
            SET availability_status=$1,lead_time_days=$2,availability_note=$3,
                expected_restock_date=$4,updated_at=NOW()
          WHERE id=$5 AND supplier_account_id=$6
          RETURNING *`,
        [availability,lead,note,restock,id,me.account.id]
      );
      res.json({
        ...rows[0],
        stock_claim:'AVAILABILITY_EVIDENCE_ONLY',
        exact_on_hand_quantity:null
      });
    }catch(e){next(e)}
  });
}

export const supplierDailyV5Internals={
  supplierBindingCount,supplierTodayOrders,supplierTodayRfqs,
  supplierTodayReturns,supplierTodayCatalog,supplierMoneyReceived
};
