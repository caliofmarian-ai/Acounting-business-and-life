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
    `WITH scoped AS (
       SELECT p.id,p.po_number,p.business_id,p.status,p.expected_total,p.fulfilment_mode,
              p.supplier_ready_at,p.supplier_delivery_eta,p.actual_received_total,p.paid_amount,
              p.created_at,b.name business_name
         FROM purchase_orders p
         JOIN businesses b ON b.id=p.business_id
        WHERE p.supplier_account_id=$1
          AND p.status NOT IN ('cancelled','rejected','received')
        ORDER BY p.created_at DESC,p.id DESC
        LIMIT 60
     ),
     inv AS (
       SELECT purchase_order_id,
              COALESCE(SUM(gross_amount) FILTER(WHERE evidence_status='active'),0) invoice_total,
              MIN(due_date) FILTER(WHERE evidence_status='active') earliest_due_date
         FROM purchase_invoice_evidence
        WHERE purchase_order_id IN (SELECT id FROM scoped)
        GROUP BY purchase_order_id
     ),
     cr AS (
       SELECT purchase_order_id,
              COALESCE(SUM(confirmed_credit) FILTER(
                WHERE status='resolved' AND resolution_type IN ('credit','refund_expected')
              ),0) confirmed_credits
         FROM purchase_returns
        WHERE purchase_order_id IN (SELECT id FROM scoped)
        GROUP BY purchase_order_id
     )
     SELECT s.*,
            COALESCE(inv.invoice_total,0) invoice_total,
            inv.earliest_due_date,
            COALESCE(cr.confirmed_credits,0) confirmed_credits,
            GREATEST(
              CASE
                WHEN COALESCE(inv.invoice_total,0)>0 THEN inv.invoice_total
                ELSE COALESCE(s.actual_received_total,0)
              END
              -COALESCE(cr.confirmed_credits,0)-s.paid_amount,
              0
            ) commercial_outstanding
       FROM scoped s
       LEFT JOIN inv ON inv.purchase_order_id=s.id
       LEFT JOIN cr ON cr.purchase_order_id=s.id
      ORDER BY s.created_at DESC,s.id DESC`,
    [Number(accountId)]
  );
  return rows;
}

async function supplierTodayRfqs(pool,{businessId,accountId}){
  const {rows}=await pool.query(
    `SELECT r.id,r.business_id,r.item_specification,r.requested_quantity,r.requested_unit,
            r.expires_at,r.status,r.created_at,t.state target_state,t.invited_at,t.viewed_at,
            b.name merchant_business_name,COUNT(*) OVER()::int queue_total
       FROM supplier_rfq_targets t
       JOIN supplier_rfqs r ON r.id=t.rfq_id
       JOIN businesses b ON b.id=r.business_id
      WHERE t.supplier_business_id=$1
        AND t.supplier_account_id=$2
        AND t.state IN ('invited','viewed')
        AND r.status IN ('open','quoted')
        AND r.expires_at>NOW()
      ORDER BY r.created_at,r.id
      LIMIT 24`,
    [Number(businessId),Number(accountId)]
  );
  return rows;
}

async function supplierTodayReturns(pool,accountId){
  const {rows}=await pool.query(
    `SELECT r.id,r.purchase_order_id,r.business_id,r.status,r.expected_credit,
            r.resolution_type,r.confirmed_credit,r.created_at,b.name business_name,
            COUNT(*) OVER()::int queue_total
       FROM purchase_returns r
       JOIN businesses b ON b.id=r.business_id
      WHERE r.supplier_account_id=$1
        AND r.status IN ('requested','returned')
      ORDER BY r.created_at,r.id
      LIMIT 24`,
    [Number(accountId)]
  );
  return rows;
}

async function supplierTodayBackorders(pool,{businessId,accountId}){
  const {rows}=await pool.query(
    `SELECT b.id,b.purchase_order_id,b.purchase_order_item_id,b.proposed_packs,
            b.expected_available_date,b.created_at,p.po_number,
            i.name_snapshot original_item_name,mb.name merchant_business_name,
            COUNT(*) OVER()::int queue_total
       FROM supplier_backorders b
       JOIN purchase_orders p ON p.id=b.purchase_order_id
       JOIN purchase_order_items i ON i.id=b.purchase_order_item_id
       JOIN businesses mb ON mb.id=b.business_id
      WHERE b.supplier_business_id=$1
        AND b.supplier_account_id=$2
        AND b.state='merchant_accepted'
      ORDER BY b.expected_available_date,b.created_at,b.id
      LIMIT 24`,
    [Number(businessId),Number(accountId)]
  );
  return rows;
}

async function supplierTodaySubstitutions(pool,{businessId,accountId}){
  const {rows}=await pool.query(
    `SELECT s.id,s.purchase_order_id,s.original_purchase_order_item_id,s.proposed_packs,
            s.expected_available_date,s.substitute_name_snapshot,s.created_at,p.po_number,
            i.name_snapshot original_item_name,mb.name merchant_business_name,
            COUNT(*) OVER()::int queue_total
       FROM supplier_substitution_proposals s
       JOIN purchase_orders p ON p.id=s.purchase_order_id
       JOIN purchase_order_items i ON i.id=s.original_purchase_order_item_id
       JOIN businesses mb ON mb.id=s.business_id
      WHERE s.supplier_business_id=$1
        AND s.supplier_account_id=$2
        AND s.state='merchant_accepted'
      ORDER BY COALESCE(s.expected_available_date,CURRENT_DATE),s.created_at,s.id
      LIMIT 24`,
    [Number(businessId),Number(accountId)]
  );
  return rows;
}

async function supplierTodayCatalog(pool,accountId){
  const {rows}=await pool.query(
    `SELECT id,product_name,availability_status,lead_time_days,expected_restock_date,updated_at,
            COUNT(*) OVER()::int queue_total
       FROM supplier_catalog_items
      WHERE supplier_account_id=$1
        AND active=TRUE
        AND availability_status IN ('limited','unavailable')
      ORDER BY availability_status='limited' DESC,updated_at DESC,id DESC
      LIMIT 40`,
    [Number(accountId)]
  );
  return rows;
}

async function supplierTodayMoney(pool,accountId){
  const {rows}=await pool.query(
    `WITH inv AS (
       SELECT purchase_order_id,
              COALESCE(SUM(gross_amount) FILTER(WHERE evidence_status='active'),0) invoice_total,
              MIN(due_date) FILTER(WHERE evidence_status='active') earliest_due_date
         FROM purchase_invoice_evidence
        GROUP BY purchase_order_id
     ),
     cr AS (
       SELECT purchase_order_id,
              COALESCE(SUM(confirmed_credit) FILTER(
                WHERE status='resolved' AND resolution_type IN ('credit','refund_expected')
              ),0) confirmed_credits
         FROM purchase_returns
        GROUP BY purchase_order_id
     ),
     scoped AS (
       SELECT p.id,p.business_id,p.status,p.paid_amount,inv.earliest_due_date,
              GREATEST(
                CASE
                  WHEN COALESCE(inv.invoice_total,0)>0 THEN inv.invoice_total
                  ELSE COALESCE(p.actual_received_total,0)
                END
                -COALESCE(cr.confirmed_credits,0)-p.paid_amount,
                0
              ) commercial_outstanding
         FROM purchase_orders p
         LEFT JOIN inv ON inv.purchase_order_id=p.id
         LEFT JOIN cr ON cr.purchase_order_id=p.id
        WHERE p.supplier_account_id=$1
          AND p.status NOT IN ('cancelled','rejected')
     )
     SELECT
       COALESCE(SUM(commercial_outstanding),0) receivable_total,
       COALESCE(SUM(commercial_outstanding) FILTER(
         WHERE commercial_outstanding>0 AND earliest_due_date<CURRENT_DATE
       ),0) overdue_receivable_total,
       COUNT(DISTINCT business_id) FILTER(WHERE commercial_outstanding>0)::int merchant_balances,
       COALESCE(SUM(paid_amount),0) money_received_recorded,
       COUNT(*) FILTER(WHERE status IN ('sent','supplier_received'))::int new_orders,
       COUNT(*) FILTER(WHERE status IN ('accepted','partially_accepted','preparing'))::int prepare,
       COUNT(*) FILTER(WHERE status IN ('ready_for_pickup','out_for_delivery','delivered','partially_received'))::int ready,
       COUNT(*) FILTER(WHERE status='received')::int completed
       FROM scoped`,
    [Number(accountId)]
  );
  const row=rows[0]||{};
  return{
    receivable_total:Number(row.receivable_total||0),
    overdue_receivable_total:Number(row.overdue_receivable_total||0),
    merchant_balances:Number(row.merchant_balances||0),
    money_received_recorded:Number(row.money_received_recorded||0),
    new_orders:Number(row.new_orders||0),
    prepare:Number(row.prepare||0),
    ready:Number(row.ready||0),
    completed:Number(row.completed||0)
  };
}

async function supplierMoneyOrders(pool,accountId){
  const {rows}=await pool.query(
    `WITH inv AS (
       SELECT purchase_order_id,
              COALESCE(SUM(gross_amount) FILTER(WHERE evidence_status='active'),0) invoice_total,
              MIN(due_date) FILTER(WHERE evidence_status='active') earliest_due_date
         FROM purchase_invoice_evidence
        GROUP BY purchase_order_id
     ),
     cr AS (
       SELECT purchase_order_id,
              COALESCE(SUM(confirmed_credit) FILTER(
                WHERE status='resolved' AND resolution_type IN ('credit','refund_expected')
              ),0) confirmed_credits
         FROM purchase_returns
        GROUP BY purchase_order_id
     ),
     scoped AS (
       SELECT p.id,p.po_number,p.business_id,p.status,b.name business_name,
              inv.earliest_due_date,
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
         LEFT JOIN inv ON inv.purchase_order_id=p.id
         LEFT JOIN cr ON cr.purchase_order_id=p.id
        WHERE p.supplier_account_id=$1
          AND p.status NOT IN ('cancelled','rejected')
     )
     SELECT id,po_number,business_id,status,business_name,earliest_due_date,
            commercial_outstanding,
            (commercial_outstanding>0 AND earliest_due_date<CURRENT_DATE) receivable_overdue
       FROM scoped
      WHERE commercial_outstanding>0
      ORDER BY receivable_overdue DESC,earliest_due_date NULLS LAST,id DESC
      LIMIT 100`,
    [Number(accountId)]
  );
  return rows;
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
      const bindingCount=await supplierBindingCount(pool,me.account.id);
      if(bindingCount!==1){
        return res.status(409).json({
          error:'Supplier Today is unavailable until this multi-business account has explicit business attribution for orders and catalog items.',
          code:'SUPPLIER_BUSINESS_ATTRIBUTION_REQUIRED',
          business_id:Number(business.id),
          active_supplier_businesses:bindingCount
        });
      }
      const moneyView=String(req.query.view||'today')==='money';
      const [orders,rfqs,returns,catalog,backorders,substitutions,money,moneyOrders]=await Promise.all([
        supplierTodayOrders(pool,me.account.id),
        supplierTodayRfqs(pool,{businessId:business.id,accountId:me.account.id}),
        supplierTodayReturns(pool,me.account.id),
        supplierTodayCatalog(pool,me.account.id),
        supplierTodayBackorders(pool,{businessId:business.id,accountId:me.account.id}),
        supplierTodaySubstitutions(pool,{businessId:business.id,accountId:me.account.id}),
        supplierTodayMoney(pool,me.account.id),
        moneyView?supplierMoneyOrders(pool,me.account.id):Promise.resolve([])
      ]);
      const queueCount=rows=>Number(rows[0]?.queue_total||rows.length);
      const stripQueueMeta=rows=>rows.map(({queue_total,...row})=>row);
      const rfqCount=queueCount(rfqs);
      const returnCount=queueCount(returns);
      const catalogCount=queueCount(catalog);
      const backorderCount=queueCount(backorders);
      const substitutionCount=queueCount(substitutions);
      const cleanRfqs=stripQueueMeta(rfqs);
      const cleanReturns=stripQueueMeta(returns);
      const cleanCatalog=stripQueueMeta(catalog);
      const cleanBackorders=stripQueueMeta(backorders);
      const cleanSubstitutions=stripQueueMeta(substitutions);
      const summary=summarizeSupplierToday({
        orders,rfqs:cleanRfqs,returns:cleanReturns,catalog:cleanCatalog,now:new Date()
      });
      res.json({
        generated_at:new Date().toISOString(),
        detail_mode:moneyView?'money':'today',
        business:{id:Number(business.id),name:business.name,currency_code:business.currency_code||'PHP'},
        attribution_status:'SINGLE_SUPPLIER_BUSINESS_BINDING',
        ...summary,
        rfqs:cleanRfqs,
        returns:cleanReturns,
        catalog_attention:summary.catalog_attention,
        backorders:cleanBackorders,
        substitutions:cleanSubstitutions,
        money_orders:moneyView?moneyOrders:undefined,
        counts:{
          ...summary.counts,
          new_orders:money.new_orders,
          prepare:money.prepare,
          ready:money.ready,
          completed:money.completed,
          rfqs:rfqCount,
          returns:returnCount,
          catalog_attention:catalogCount,
          backorders:backorderCount,
          substitutions:substitutionCount,
          merchant_balances:money.merchant_balances
        },
        money:{
          receivable_total:Math.round(money.receivable_total*100)/100,
          overdue_receivable_total:Math.round(money.overdue_receivable_total*100)/100,
          money_received_recorded:Math.round(money.money_received_recorded*100)/100
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
      const business=await exactProfileBusiness(pool,me,'supplier',req.body?.business_id||null);
      const bindingCount=await supplierBindingCount(pool,me.account.id);
      if(bindingCount!==1){
        return res.status(409).json({
          error:'Catalog availability update requires explicit catalog-to-business attribution for multi-business Supplier accounts.',
          code:'SUPPLIER_CATALOG_BUSINESS_ATTRIBUTION_REQUIRED',
          business_id:Number(business.id),
          active_supplier_businesses:bindingCount
        });
      }
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
  supplierTodayReturns,supplierTodayCatalog,supplierTodayBackorders,supplierTodaySubstitutions,
  supplierTodayMoney,supplierMoneyOrders
};
