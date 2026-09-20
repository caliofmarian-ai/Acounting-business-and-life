import crypto from 'node:crypto';
import {supplierDomainV2Internals} from './server-supplier-domain-v2.js';
import {
  normalizePaymentTerms,
  dueDateForTerms,
  commercialPosition,
  returnCreditAmount
} from './supplier-commercial-core.js';

const {exactProfileBusiness}=supplierDomainV2Internals;

const clean=(value,max=500)=>String(value??'').trim().slice(0,max);
const money=value=>Math.round((Number(value)+Number.EPSILON)*100)/100;
const finite=value=>Number.isFinite(Number(value));
const positive=value=>finite(value)&&Number(value)>0;
const nonNegative=value=>finite(value)&&Number(value)>=0;
const httpError=(status,message)=>Object.assign(new Error(message),{status});
const lotCode=()=>`LOT-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

function enabledSupplier(me){
  return Boolean(me?.account?.id&&me?.profiles?.some(p=>p.role==='supplier'&&p.enabled));
}

async function loadPo(pool,id){
  const {rows}=await pool.query(
    `SELECT p.*,b.name business_name
       FROM purchase_orders p
       JOIN businesses b ON b.id=p.business_id
      WHERE p.id=$1`,
    [Number(id)]
  );
  return rows[0]||null;
}

async function requireMerchantPo(pool,me,id){
  const po=await loadPo(pool,id);
  if(!po)throw httpError(404,'Purchase order not found');
  const business=await exactProfileBusiness(pool,me,'merchant',po.business_id);
  return{po,business};
}

async function requireSupplierPo(pool,me,id){
  if(!enabledSupplier(me))throw httpError(403,'Supplier profile required');
  const po=await loadPo(pool,id);
  if(!po||Number(po.supplier_account_id)!==Number(me.account.id))throw httpError(404,'Purchase order not found');
  return po;
}

async function connectedTerms(pool,businessId,supplierAccountId){
  const {rows}=await pool.query(
    `SELECT * FROM supplier_trade_terms
      WHERE business_id=$1 AND supplier_account_id=$2 AND status<>'inactive'
      ORDER BY updated_at DESC,id DESC LIMIT 1`,
    [Number(businessId),Number(supplierAccountId)]
  );
  return rows[0]||null;
}

async function externalTerms(pool,businessId,supplyPartyId){
  const {rows}=await pool.query(
    `SELECT * FROM supplier_trade_terms
      WHERE business_id=$1 AND supply_party_id=$2 AND status<>'inactive'
      ORDER BY updated_at DESC,id DESC LIMIT 1`,
    [Number(businessId),Number(supplyPartyId)]
  );
  return rows[0]||null;
}

async function invoiceTotals(pool,purchaseOrderId){
  const {rows}=await pool.query(
    `SELECT
       COALESCE(SUM(gross_amount) FILTER(WHERE evidence_status='active'),0) invoice_total,
       MIN(due_date) FILTER(WHERE evidence_status='active') earliest_due_date,
       COUNT(*) FILTER(WHERE evidence_status='active')::int invoice_count
       FROM purchase_invoice_evidence
      WHERE purchase_order_id=$1`,
    [Number(purchaseOrderId)]
  );
  return rows[0]||{};
}

async function returnCredits(pool,purchaseOrderId){
  const {rows}=await pool.query(
    `SELECT
       COALESCE(SUM(confirmed_credit) FILTER(
         WHERE status='resolved' AND resolution_type IN ('credit','refund_expected')
       ),0) confirmed_credits,
       COUNT(*) FILTER(WHERE status NOT IN ('cancelled','rejected'))::int return_count
       FROM purchase_returns
      WHERE purchase_order_id=$1`,
    [Number(purchaseOrderId)]
  );
  return rows[0]||{};
}

export async function commercialOutstandingForPo(pool,purchaseOrderId){
  const po=await loadPo(pool,purchaseOrderId);
  if(!po)throw httpError(404,'Purchase order not found');
  const [inv,credits]=await Promise.all([
    invoiceTotals(pool,purchaseOrderId),
    returnCredits(pool,purchaseOrderId)
  ]);
  return commercialPosition({
    expectedTotal:Number(po.expected_total)||0,
    receivedTotal:Number(po.actual_received_total)||0,
    invoiceTotal:Number(inv.invoice_total)||0,
    paidAmount:Number(po.paid_amount)||0,
    confirmedCredits:Number(credits.confirmed_credits)||0,
    earliestDueDate:inv.earliest_due_date?String(inv.earliest_due_date).slice(0,10):null
  });
}

function safeDate(value,label,{required=false}={}){
  if(value==null||String(value).trim()===''){
    if(required)throw httpError(400,`${label} is required`);
    return null;
  }
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))throw httpError(400,`${label} is invalid`);
  return d.toISOString();
}

async function invoiceDueDate(pool,{po,businessId,supplierAccountId,supplyPartyId,issueDate,explicitDueDate}){
  if(explicitDueDate)return safeDate(explicitDueDate,'Due date').slice(0,10);
  const terms=supplierAccountId
    ?await connectedTerms(pool,businessId,supplierAccountId)
    :await externalTerms(pool,businessId,supplyPartyId);
  if(!terms)return null;
  return dueDateForTerms({
    issueDate:String(issueDate).slice(0,10),
    receivedDate:po?.received_at?String(po.received_at).slice(0,10):null,
    paymentTermCode:terms.payment_term_code,
    customDays:terms.custom_days
  });
}

async function createInvoiceEvidence(pool,{
  businessId,
  supplierAccountId=null,
  supplyPartyId=null,
  purchaseOrderId=null,
  supplyLotId=null,
  sourceSide,
  actorAccountId,
  payload={}
}){
  const documentNumber=clean(payload.document_number,120);
  const documentKind=clean(payload.document_kind||'invoice',40).toLowerCase();
  const allowedKinds=new Set(['invoice','sales_invoice','charge_invoice','billing_invoice','other_supplier_document']);
  if(!allowedKinds.has(documentKind))throw httpError(400,'Unsupported Supplier document kind');
  const issueDate=safeDate(payload.issue_date||new Date().toISOString(),'Issue date',{required:true}).slice(0,10);
  const grossAmount=Number(payload.gross_amount);
  if(!positive(grossAmount))throw httpError(400,'Document gross amount must be greater than zero');
  const currency=clean(payload.currency_code||'PHP',3).toUpperCase();
  if(!/^[A-Z]{3}$/.test(currency))throw httpError(400,'Currency code is invalid');

  const po=purchaseOrderId?await loadPo(pool,purchaseOrderId):null;
  const dueDate=await invoiceDueDate(pool,{
    po,businessId,supplierAccountId,supplyPartyId,issueDate,
    explicitDueDate:payload.due_date||null
  });

  try{
    const {rows}=await pool.query(
      `INSERT INTO purchase_invoice_evidence(
        business_id,supplier_account_id,supply_party_id,purchase_order_id,supply_lot_id,
        document_number,document_kind,issue_date,due_date,currency_code,gross_amount,
        source_side,fiscal_status,evidence_reference,note,created_by_account_id
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'internal_evidence',$13,$14,$15)
      RETURNING *`,
      [
        Number(businessId),supplierAccountId?Number(supplierAccountId):null,supplyPartyId?Number(supplyPartyId):null,
        purchaseOrderId?Number(purchaseOrderId):null,supplyLotId?Number(supplyLotId):null,
        documentNumber,documentKind,issueDate,dueDate,currency,money(grossAmount),
        sourceSide,clean(payload.evidence_reference,500),clean(payload.note,1000),Number(actorAccountId)
      ]
    );
    return rows[0];
  }catch(e){
    if(e.code==='23505')throw httpError(409,'This Supplier document number is already recorded for this business');
    throw e;
  }
}

async function lotForReturn(pool,businessId,lotId,{lock=false,client=pool}={}){
  const {rows}=await client.query(
    `SELECT l.*,
       po.supplier_account_id po_supplier_account_id,
       sp.supplier_account_id party_supplier_account_id,
       sp.source_type supply_party_source_type,
       sp.id linked_supply_party_id
       FROM supply_lots l
       LEFT JOIN purchase_orders po ON po.id=l.purchase_order_id
       LEFT JOIN merchant_supply_parties sp ON sp.id=l.supply_party_id
      WHERE l.id=$1 AND l.business_id=$2
      ${lock?'FOR UPDATE OF l':''}`,
    [Number(lotId),Number(businessId)]
  );
  return rows[0]||null;
}

async function returnDetail(pool,id){
  const r=await pool.query(
    `SELECT r.*,b.name business_name,COALESCE(sp.display_name,a.display_name) supplier_name
       FROM purchase_returns r
       JOIN businesses b ON b.id=r.business_id
       LEFT JOIN accounts a ON a.id=r.supplier_account_id
       LEFT JOIN merchant_supply_parties sp ON sp.id=r.supply_party_id
      WHERE r.id=$1`,
    [Number(id)]
  );
  if(!r.rowCount)return null;
  const items=await pool.query(
    `SELECT i.*,l.item_name,l.internal_lot_code,l.supplier_lot_code,l.inventory_id,l.lot_state
       FROM purchase_return_items i
       JOIN supply_lots l ON l.id=i.supply_lot_id
      WHERE i.purchase_return_id=$1 ORDER BY i.id`,
    [Number(id)]
  );
  return{...r.rows[0],items:items.rows};
}

async function applyRecallMatches(client,noticeId,rows){
  for(const row of rows){
    await client.query(
      `INSERT INTO supply_recall_lot_matches(notice_id,lot_id,business_id,match_reason,lot_status)
       VALUES($1,$2,$3,$4,'quarantined')
       ON CONFLICT(notice_id,lot_id) DO NOTHING`,
      [Number(noticeId),Number(row.id),Number(row.business_id),'exact_supplier_lot']
    );
    await client.query(
      `UPDATE supply_lots
          SET lot_state=CASE WHEN quantity_remaining_base>0 THEN 'quarantined' ELSE lot_state END
        WHERE id=$1`,
      [Number(row.id)]
    );
  }
}

export async function recordPoReceiptLot(client,{
  businessId,
  purchaseOrderId,
  receiptId,
  itemRow,
  packs,
  baseUnits,
  price,
  receiptInput={},
  actorAccountId
}){
  const supplierLot=clean(receiptInput?.supplier_lot_code,90);
  const expires=safeDate(receiptInput?.expires_at,'Expiry date');
  const manufactured=safeDate(receiptInput?.manufactured_at,'Manufactured date');
  const packed=safeDate(receiptInput?.packed_at,'Packed date');
  const basePerPack=Number(itemRow.base_units_per_pack_snapshot);
  const unitCost=baseUnits>0?Number(price)/basePerPack:0;
  const handling=clean(itemRow.handling_mode_snapshot||'sealed_resale',30);
  const internal=clean(receiptInput?.internal_lot_code,90)||lotCode();

  const {rows}=await client.query(
    `INSERT INTO supply_lots(
      business_id,purchase_order_id,purchase_receipt_id,purchase_order_item_id,
      inventory_id,catalog_item_id,item_name,internal_lot_code,supplier_lot_code,
      handling_mode,lot_state,base_unit,quantity_received_base,quantity_remaining_base,
      unit_cost_base,package_unit_name,package_size_base,package_count_received,
      manufactured_at,packed_at,expires_at,received_at,note,created_by_account_id
    ) VALUES(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'available',$11,$12,$12,$13,$14,$15,$16,
      $17,$18,$19,NOW(),$20,$21
    ) RETURNING *`,
    [
      Number(businessId),Number(purchaseOrderId),Number(receiptId),Number(itemRow.id),
      itemRow.legacy_inventory_id?Number(itemRow.legacy_inventory_id):null,
      itemRow.catalog_item_id?Number(itemRow.catalog_item_id):null,
      clean(itemRow.name_snapshot,180),internal,supplierLot,handling,
      clean(itemRow.base_unit_snapshot,50),Number(baseUnits),Number(unitCost),
      clean(itemRow.unit_name_snapshot,50),basePerPack,Number(packs),
      manufactured,packed,expires,clean(receiptInput?.lot_note,1000),Number(actorAccountId)
    ]
  );
  return rows[0];
}

export async function ensureSupplierCommercialV3Schema(pool){
  await pool.query(`
    ALTER TABLE purchase_order_items
      ADD COLUMN IF NOT EXISTS handling_mode_snapshot TEXT NOT NULL DEFAULT 'sealed_resale';
    ALTER TABLE purchase_order_items
      DROP CONSTRAINT IF EXISTS purchase_order_items_handling_mode_snapshot_check;
    ALTER TABLE purchase_order_items
      ADD CONSTRAINT purchase_order_items_handling_mode_snapshot_check
      CHECK(handling_mode_snapshot IN ('sealed_resale','break_pack','bulk','repacked','produced'));

    ALTER TABLE supply_lots
      ADD COLUMN IF NOT EXISTS catalog_item_id BIGINT REFERENCES supplier_catalog_items(id) ON DELETE SET NULL;
    ALTER TABLE supply_lots
      ADD COLUMN IF NOT EXISTS lot_state TEXT NOT NULL DEFAULT 'available';
    ALTER TABLE supply_lots
      DROP CONSTRAINT IF EXISTS supply_lots_lot_state_check;
    ALTER TABLE supply_lots
      ADD CONSTRAINT supply_lots_lot_state_check
      CHECK(lot_state IN ('available','quarantined','recalled','returned','depleted'));

    CREATE TABLE IF NOT EXISTS supplier_trade_terms(
      id BIGSERIAL PRIMARY KEY,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      supplier_account_id BIGINT REFERENCES accounts(id) ON DELETE CASCADE,
      supply_party_id BIGINT REFERENCES merchant_supply_parties(id) ON DELETE CASCADE,
      payment_term_code TEXT NOT NULL DEFAULT 'cod',
      custom_days INTEGER,
      credit_limit NUMERIC(14,2),
      currency_code TEXT NOT NULL DEFAULT 'PHP',
      status TEXT NOT NULL DEFAULT 'merchant_recorded',
      source_side TEXT NOT NULL,
      effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
      note TEXT NOT NULL DEFAULT '',
      created_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK((supplier_account_id IS NOT NULL)::int+(supply_party_id IS NOT NULL)::int=1),
      CHECK(payment_term_code IN ('prepaid','cod','due_on_receipt','net_7','net_15','net_30','net_45','net_60','custom')),
      CHECK(custom_days IS NULL OR (custom_days>=0 AND custom_days<=365)),
      CHECK(credit_limit IS NULL OR credit_limit>=0),
      CHECK(status IN ('merchant_recorded','supplier_confirmed','inactive')),
      CHECK(source_side IN ('merchant','supplier'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS supplier_trade_terms_connected_unique
      ON supplier_trade_terms(business_id,supplier_account_id)
      WHERE supplier_account_id IS NOT NULL AND status<>'inactive';
    CREATE UNIQUE INDEX IF NOT EXISTS supplier_trade_terms_external_unique
      ON supplier_trade_terms(business_id,supply_party_id)
      WHERE supply_party_id IS NOT NULL AND status<>'inactive';

    CREATE TABLE IF NOT EXISTS purchase_invoice_evidence(
      id BIGSERIAL PRIMARY KEY,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      supplier_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      supply_party_id BIGINT REFERENCES merchant_supply_parties(id) ON DELETE SET NULL,
      purchase_order_id BIGINT REFERENCES purchase_orders(id) ON DELETE SET NULL,
      supply_lot_id BIGINT REFERENCES supply_lots(id) ON DELETE SET NULL,
      document_number TEXT NOT NULL DEFAULT '',
      document_kind TEXT NOT NULL DEFAULT 'invoice',
      issue_date DATE NOT NULL,
      due_date DATE,
      currency_code TEXT NOT NULL DEFAULT 'PHP',
      gross_amount NUMERIC(14,2) NOT NULL CHECK(gross_amount>0),
      source_side TEXT NOT NULL,
      fiscal_status TEXT NOT NULL DEFAULT 'internal_evidence',
      evidence_status TEXT NOT NULL DEFAULT 'active',
      evidence_reference TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      created_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK((supplier_account_id IS NOT NULL)::int+(supply_party_id IS NOT NULL)::int=1),
      CHECK(document_kind IN ('invoice','sales_invoice','charge_invoice','billing_invoice','other_supplier_document')),
      CHECK(source_side IN ('merchant','supplier')),
      CHECK(fiscal_status IN ('internal_evidence','fiscal_candidate','fiscal_validated','not_applicable')),
      CHECK(evidence_status IN ('active','void','reversed'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS purchase_invoice_document_unique
      ON purchase_invoice_evidence(business_id,supplier_account_id,document_number)
      WHERE supplier_account_id IS NOT NULL AND document_number<>'';
    CREATE INDEX IF NOT EXISTS purchase_invoice_po_idx
      ON purchase_invoice_evidence(purchase_order_id,evidence_status,due_date);

    CREATE TABLE IF NOT EXISTS purchase_returns(
      id BIGSERIAL PRIMARY KEY,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      supplier_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      supply_party_id BIGINT REFERENCES merchant_supply_parties(id) ON DELETE SET NULL,
      purchase_order_id BIGINT REFERENCES purchase_orders(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'requested',
      reason_code TEXT NOT NULL,
      merchant_note TEXT NOT NULL DEFAULT '',
      supplier_note TEXT NOT NULL DEFAULT '',
      expected_credit NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(expected_credit>=0),
      confirmed_credit NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(confirmed_credit>=0),
      resolution_type TEXT NOT NULL DEFAULT 'pending',
      created_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      authorized_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      resolved_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      authorized_at TIMESTAMPTZ,
      returned_at TIMESTAMPTZ,
      resolved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK((supplier_account_id IS NOT NULL)::int+(supply_party_id IS NOT NULL)::int=1),
      CHECK(status IN ('requested','authorized','rejected','returned','resolved','cancelled')),
      CHECK(reason_code IN ('damaged','expired','wrong_item','quality','recall','over_delivery','other')),
      CHECK(resolution_type IN ('pending','credit','refund_expected','replacement','no_credit'))
    );
    CREATE INDEX IF NOT EXISTS purchase_returns_business_idx
      ON purchase_returns(business_id,status,created_at DESC);
    CREATE INDEX IF NOT EXISTS purchase_returns_supplier_idx
      ON purchase_returns(supplier_account_id,status,created_at DESC);

    CREATE TABLE IF NOT EXISTS purchase_return_items(
      id BIGSERIAL PRIMARY KEY,
      purchase_return_id BIGINT NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
      supply_lot_id BIGINT NOT NULL REFERENCES supply_lots(id) ON DELETE RESTRICT,
      purchase_order_item_id BIGINT REFERENCES purchase_order_items(id) ON DELETE SET NULL,
      quantity_base NUMERIC(16,6) NOT NULL CHECK(quantity_base>0),
      base_unit TEXT NOT NULL,
      unit_cost_base NUMERIC(16,6) NOT NULL DEFAULT 0 CHECK(unit_cost_base>=0),
      expected_credit NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(expected_credit>=0),
      UNIQUE(purchase_return_id,supply_lot_id)
    );

    CREATE TABLE IF NOT EXISTS supply_recall_notices(
      id BIGSERIAL PRIMARY KEY,
      business_id BIGINT REFERENCES businesses(id) ON DELETE CASCADE,
      supplier_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      supply_party_id BIGINT REFERENCES merchant_supply_parties(id) ON DELETE SET NULL,
      catalog_item_id BIGINT REFERENCES supplier_catalog_items(id) ON DELETE SET NULL,
      supplier_lot_code TEXT NOT NULL,
      product_name TEXT NOT NULL DEFAULT '',
      notice_level TEXT NOT NULL DEFAULT 'recall',
      requested_action TEXT NOT NULL DEFAULT 'isolate',
      status TEXT NOT NULL DEFAULT 'active',
      source_side TEXT NOT NULL,
      reason TEXT NOT NULL,
      source_reference TEXT NOT NULL DEFAULT '',
      created_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ,
      CHECK(source_side IN ('supplier','merchant_external')),
      CHECK(notice_level IN ('advisory','withdrawal','recall')),
      CHECK(requested_action IN ('review','isolate','return','destroy')),
      CHECK(status IN ('active','closed'))
    );
    CREATE INDEX IF NOT EXISTS supply_recall_supplier_lot_idx
      ON supply_recall_notices(supplier_account_id,supplier_lot_code,status);

    CREATE TABLE IF NOT EXISTS supply_recall_lot_matches(
      notice_id BIGINT NOT NULL REFERENCES supply_recall_notices(id) ON DELETE CASCADE,
      lot_id BIGINT NOT NULL REFERENCES supply_lots(id) ON DELETE CASCADE,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      match_reason TEXT NOT NULL,
      lot_status TEXT NOT NULL DEFAULT 'quarantined',
      matched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      released_at TIMESTAMPTZ,
      PRIMARY KEY(notice_id,lot_id),
      CHECK(lot_status IN ('quarantined','returned','destroyed','released'))
    );
  `);
}

export function registerSupplierCommercialV3Routes({app,pool,body,identity}){
  app.get('/api/procurement/relationships/:supplierId/terms',async(req,res,next)=>{
    try{
      const me=await identity(req);
      const b=await exactProfileBusiness(pool,me,'merchant',req.query.business_id||null);
      const supplierId=Number(req.params.supplierId);
      const rel=await pool.query(
        `SELECT 1 FROM supplier_relationships WHERE business_id=$1 AND supplier_account_id=$2 AND state='accepted'`,
        [b.id,supplierId]
      );
      if(!rel.rowCount)return res.status(404).json({error:'Accepted Supplier relationship not found'});
      res.json(await connectedTerms(pool,b.id,supplierId));
    }catch(e){next(e)}
  });

  app.put('/api/supplier/relationships/:businessId/terms',body,async(req,res,next)=>{
    try{
      const me=await identity(req);
      if(!enabledSupplier(me))return res.status(403).json({error:'Supplier profile required'});
      const businessId=Number(req.params.businessId);
      const rel=await pool.query(
        `SELECT 1 FROM supplier_relationships WHERE business_id=$1 AND supplier_account_id=$2 AND state='accepted'`,
        [businessId,me.account.id]
      );
      if(!rel.rowCount)return res.status(404).json({error:'Accepted Merchant relationship not found'});
      const terms=normalizePaymentTerms(req.body||{});
      const {rows}=await pool.query(
        `INSERT INTO supplier_trade_terms(
          business_id,supplier_account_id,payment_term_code,custom_days,credit_limit,currency_code,
          status,source_side,note,created_by_account_id
        ) VALUES($1,$2,$3,$4,$5,$6,'supplier_confirmed','supplier',$7,$2)
        ON CONFLICT(business_id,supplier_account_id)
        WHERE supplier_account_id IS NOT NULL AND status<>'inactive'
        DO UPDATE SET
          payment_term_code=EXCLUDED.payment_term_code,
          custom_days=EXCLUDED.custom_days,
          credit_limit=EXCLUDED.credit_limit,
          currency_code=EXCLUDED.currency_code,
          status='supplier_confirmed',
          source_side='supplier',
          note=EXCLUDED.note,
          updated_at=NOW()
        RETURNING *`,
        [
          businessId,me.account.id,terms.payment_term_code,terms.custom_days,terms.credit_limit,
          terms.currency_code,clean(req.body?.note,1000)
        ]
      );
      res.json(rows[0]);
    }catch(e){next(e)}
  });

  app.get('/api/procurement/supply-parties/:id/terms',async(req,res,next)=>{
    try{
      const me=await identity(req);
      const party=await pool.query(`SELECT * FROM merchant_supply_parties WHERE id=$1`,[Number(req.params.id)]);
      if(!party.rowCount)return res.status(404).json({error:'Supplier record not found'});
      const b=await exactProfileBusiness(pool,me,'merchant',party.rows[0].business_id);
      res.json(await externalTerms(pool,b.id,party.rows[0].id));
    }catch(e){next(e)}
  });

  app.put('/api/procurement/supply-parties/:id/terms',body,async(req,res,next)=>{
    try{
      const me=await identity(req);
      const partyQ=await pool.query(`SELECT * FROM merchant_supply_parties WHERE id=$1`,[Number(req.params.id)]);
      if(!partyQ.rowCount)return res.status(404).json({error:'Supplier record not found'});
      const party=partyQ.rows[0];
      const b=await exactProfileBusiness(pool,me,'merchant',party.business_id);
      const terms=normalizePaymentTerms(req.body||{});
      const {rows}=await pool.query(
        `INSERT INTO supplier_trade_terms(
          business_id,supply_party_id,payment_term_code,custom_days,credit_limit,currency_code,
          status,source_side,note,created_by_account_id
        ) VALUES($1,$2,$3,$4,$5,$6,'merchant_recorded','merchant',$7,$8)
        ON CONFLICT(business_id,supply_party_id)
        WHERE supply_party_id IS NOT NULL AND status<>'inactive'
        DO UPDATE SET
          payment_term_code=EXCLUDED.payment_term_code,
          custom_days=EXCLUDED.custom_days,
          credit_limit=EXCLUDED.credit_limit,
          currency_code=EXCLUDED.currency_code,
          status='merchant_recorded',
          source_side='merchant',
          note=EXCLUDED.note,
          updated_at=NOW()
        RETURNING *`,
        [
          b.id,party.id,terms.payment_term_code,terms.custom_days,terms.credit_limit,
          terms.currency_code,clean(req.body?.note,1000),me.account.id
        ]
      );
      res.json(rows[0]);
    }catch(e){next(e)}
  });

  app.post('/api/procurement/orders/:id/invoices',body,async(req,res,next)=>{
    try{
      const me=await identity(req);
      const {po,business}=await requireMerchantPo(pool,me,req.params.id);
      const row=await createInvoiceEvidence(pool,{
        businessId:business.id,supplierAccountId:po.supplier_account_id,purchaseOrderId:po.id,
        sourceSide:'merchant',actorAccountId:me.account.id,payload:req.body||{}
      });
      res.status(201).json(row);
    }catch(e){next(e)}
  });

  app.post('/api/supplier/orders/:id/invoices',body,async(req,res,next)=>{
    try{
      const me=await identity(req);
      const po=await requireSupplierPo(pool,me,req.params.id);
      const row=await createInvoiceEvidence(pool,{
        businessId:po.business_id,supplierAccountId:po.supplier_account_id,purchaseOrderId:po.id,
        sourceSide:'supplier',actorAccountId:me.account.id,payload:req.body||{}
      });
      res.status(201).json(row);
    }catch(e){next(e)}
  });

  app.post('/api/procurement/supply-parties/:id/invoices',body,async(req,res,next)=>{
    try{
      const me=await identity(req);
      const partyQ=await pool.query(`SELECT * FROM merchant_supply_parties WHERE id=$1`,[Number(req.params.id)]);
      if(!partyQ.rowCount)return res.status(404).json({error:'Supplier record not found'});
      const party=partyQ.rows[0];
      const b=await exactProfileBusiness(pool,me,'merchant',party.business_id);
      const lotId=req.body?.supply_lot_id?Number(req.body.supply_lot_id):null;
      if(lotId){
        const lot=await lotForReturn(pool,b.id,lotId);
        if(!lot||Number(lot.supply_party_id)!==Number(party.id))return res.status(404).json({error:'Supplier lot not found'});
      }
      const row=await createInvoiceEvidence(pool,{
        businessId:b.id,supplyPartyId:party.id,supplyLotId:lotId,
        sourceSide:'merchant',actorAccountId:me.account.id,payload:req.body||{}
      });
      res.status(201).json(row);
    }catch(e){next(e)}
  });

  app.get('/api/procurement/orders/:id/commercial',async(req,res,next)=>{
    try{
      const me=await identity(req);
      const po=await loadPo(pool,req.params.id);
      if(!po)return res.status(404).json({error:'Purchase order not found'});
      if(Number(po.supplier_account_id)===Number(me.account.id)){
        if(!enabledSupplier(me))return res.status(403).json({error:'Supplier profile required'});
      }else{
        await exactProfileBusiness(pool,me,'merchant',po.business_id);
      }
      const [summary,invoices,returns,terms]=await Promise.all([
        commercialOutstandingForPo(pool,po.id),
        pool.query(`SELECT * FROM purchase_invoice_evidence WHERE purchase_order_id=$1 ORDER BY issue_date,id`,[po.id]),
        pool.query(`SELECT * FROM purchase_returns WHERE purchase_order_id=$1 ORDER BY created_at,id`,[po.id]),
        connectedTerms(pool,po.business_id,po.supplier_account_id)
      ]);
      res.json({
        purchase_order:po,
        terms,
        invoices:invoices.rows,
        returns:returns.rows,
        summary,
        authority:{
          po_is_not_invoice:true,
          invoice_is_not_payment:true,
          credit_is_not_cash_refund:true,
          fiscal_validation_automatic:false
        }
      });
    }catch(e){next(e)}
  });

  app.post('/api/procurement/returns',body,async(req,res,next)=>{
    try{
      const me=await identity(req);
      const lotId=Number(req.body?.supply_lot_id);
      const quantity=Number(req.body?.quantity_base);
      if(!Number.isInteger(lotId)||!positive(quantity))return res.status(400).json({error:'Lot and return quantity are required'});
      const lotLookup=await pool.query(`SELECT business_id FROM supply_lots WHERE id=$1`,[lotId]);
      if(!lotLookup.rowCount)return res.status(404).json({error:'Supply lot not found'});
      const b=await exactProfileBusiness(pool,me,'merchant',lotLookup.rows[0].business_id);
      const lot=await lotForReturn(pool,b.id,lotId);
      if(!lot)return res.status(404).json({error:'Supply lot not found'});
      if(lot.parent_lot_id)return res.status(409).json({error:'Repacked/derived lots cannot be returned upstream directly in V3'});
      if(quantity>Number(lot.quantity_remaining_base)+1e-9)return res.status(409).json({error:'Return quantity exceeds lot quantity remaining'});

      const supplierAccountId=Number(lot.po_supplier_account_id||lot.party_supplier_account_id)||null;
      const supplyPartyId=supplierAccountId?null:(lot.linked_supply_party_id?Number(lot.linked_supply_party_id):null);
      if(!supplierAccountId&&!supplyPartyId)return res.status(409).json({error:'Lot has no traceable Supplier source'});
      const reason=clean(req.body?.reason_code,30);
      if(!['damaged','expired','wrong_item','quality','recall','over_delivery','other'].includes(reason)){
        return res.status(400).json({error:'Valid return reason is required'});
      }
      const expected=returnCreditAmount({
        quantityBase:quantity,
        unitCostBase:Number(lot.unit_cost_base)||0,
        explicitExpectedCredit:req.body?.expected_credit
      });
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const ret=await client.query(
          `INSERT INTO purchase_returns(
            business_id,supplier_account_id,supply_party_id,purchase_order_id,status,reason_code,
            merchant_note,expected_credit,created_by_account_id
          ) VALUES($1,$2,$3,$4,'requested',$5,$6,$7,$8) RETURNING *`,
          [
            b.id,supplierAccountId,supplyPartyId,lot.purchase_order_id?Number(lot.purchase_order_id):null,
            reason,clean(req.body?.note,1000),expected,me.account.id
          ]
        );
        await client.query(
          `INSERT INTO purchase_return_items(
            purchase_return_id,supply_lot_id,purchase_order_item_id,quantity_base,base_unit,
            unit_cost_base,expected_credit
          ) VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [
            ret.rows[0].id,lot.id,lot.purchase_order_item_id?Number(lot.purchase_order_item_id):null,
            quantity,lot.base_unit,Number(lot.unit_cost_base)||0,expected
          ]
        );
        await client.query('COMMIT');
        res.status(201).json(await returnDetail(pool,ret.rows[0].id));
      }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
      finally{client.release()}
    }catch(e){next(e)}
  });

  app.get('/api/procurement/returns',async(req,res,next)=>{
    try{
      const me=await identity(req);
      const b=await exactProfileBusiness(pool,me,'merchant',req.query.business_id||null);
      const {rows}=await pool.query(
        `SELECT r.*,COALESCE(sp.display_name,a.display_name) supplier_name
           FROM purchase_returns r
           LEFT JOIN accounts a ON a.id=r.supplier_account_id
           LEFT JOIN merchant_supply_parties sp ON sp.id=r.supply_party_id
          WHERE r.business_id=$1 ORDER BY r.created_at DESC,r.id DESC LIMIT 300`,
        [b.id]
      );
      res.json(rows);
    }catch(e){next(e)}
  });

  app.get('/api/supplier/returns',async(req,res,next)=>{
    try{
      const me=await identity(req);
      if(!enabledSupplier(me))return res.status(403).json({error:'Supplier profile required'});
      const {rows}=await pool.query(
        `SELECT r.*,b.name business_name
           FROM purchase_returns r JOIN businesses b ON b.id=r.business_id
          WHERE r.supplier_account_id=$1 ORDER BY r.created_at DESC,r.id DESC LIMIT 300`,
        [me.account.id]
      );
      res.json(rows);
    }catch(e){next(e)}
  });

  app.post('/api/supplier/returns/:id/respond',body,async(req,res,next)=>{
    try{
      const me=await identity(req);
      if(!enabledSupplier(me))return res.status(403).json({error:'Supplier profile required'});
      const decision=clean(req.body?.decision,20);
      if(!['authorize','reject'].includes(decision))return res.status(400).json({error:'Return decision must be authorize or reject'});
      const status=decision==='authorize'?'authorized':'rejected';
      const {rows}=await pool.query(
        `UPDATE purchase_returns
            SET status=$1,supplier_note=$2,authorized_by_account_id=$3,
                authorized_at=CASE WHEN $1='authorized' THEN NOW() ELSE authorized_at END,updated_at=NOW()
          WHERE id=$4 AND supplier_account_id=$3 AND status='requested'
          RETURNING *`,
        [status,clean(req.body?.supplier_note,1000),me.account.id,Number(req.params.id)]
      );
      if(!rows.length)return res.status(409).json({error:'Return is unavailable for this response'});
      res.json(await returnDetail(pool,rows[0].id));
    }catch(e){next(e)}
  });

  app.post('/api/procurement/returns/:id/dispatch',body,async(req,res,next)=>{
    try{
      const me=await identity(req);
      const current=await returnDetail(pool,req.params.id);
      if(!current)return res.status(404).json({error:'Return not found'});
      const b=await exactProfileBusiness(pool,me,'merchant',current.business_id);
      if(current.supplier_account_id&&current.status!=='authorized'){
        return res.status(409).json({error:'Connected Supplier must authorize the return first'});
      }
      if(!current.supplier_account_id&&!['requested','authorized'].includes(current.status)){
        return res.status(409).json({error:'External Supplier return is not ready to dispatch'});
      }
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const ret=await client.query(
          `SELECT * FROM purchase_returns WHERE id=$1 AND business_id=$2 FOR UPDATE`,
          [Number(req.params.id),b.id]
        );
        if(!ret.rowCount)throw httpError(404,'Return not found');
        if(ret.rows[0].returned_at)throw httpError(409,'Return stock was already dispatched');
        const items=await client.query(
          `SELECT * FROM purchase_return_items WHERE purchase_return_id=$1 ORDER BY id FOR UPDATE`,
          [ret.rows[0].id]
        );
        for(const item of items.rows){
          const lot=await lotForReturn(pool,b.id,item.supply_lot_id,{lock:true,client});
          if(!lot)throw httpError(404,'Return lot not found');
          const qty=Number(item.quantity_base);
          if(Number(lot.quantity_remaining_base)+1e-9<qty)throw httpError(409,'Return quantity exceeds lot quantity remaining');
          if(lot.inventory_id){
            const inv=await client.query(
              `SELECT * FROM inventory WHERE id=$1 AND business_id=$2 FOR UPDATE`,
              [Number(lot.inventory_id),b.id]
            );
            if(!inv.rowCount)throw httpError(409,'Linked Inventory item is unavailable');
            if(Number(inv.rows[0].quantity)+1e-9<qty)throw httpError(409,'Inventory quantity is lower than the return quantity');
            await client.query(
              `UPDATE inventory SET quantity=quantity-$1,updated_at=NOW() WHERE id=$2 AND business_id=$3`,
              [qty,lot.inventory_id,b.id]
            );
          }
          await client.query(
            `UPDATE supply_lots
                SET quantity_remaining_base=quantity_remaining_base-$1,
                    lot_state=CASE
                      WHEN quantity_remaining_base-$1<=0.000001 THEN 'returned'
                      ELSE lot_state
                    END
              WHERE id=$2`,
            [qty,lot.id]
          );
        }
        await client.query(
          `UPDATE purchase_returns
              SET status='returned',returned_at=NOW(),updated_at=NOW()
            WHERE id=$1`,
          [ret.rows[0].id]
        );
        await client.query('COMMIT');
        res.json(await returnDetail(pool,ret.rows[0].id));
      }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
      finally{client.release()}
    }catch(e){next(e)}
  });

  app.post('/api/supplier/returns/:id/resolve',body,async(req,res,next)=>{
    try{
      const me=await identity(req);
      if(!enabledSupplier(me))return res.status(403).json({error:'Supplier profile required'});
      const type=clean(req.body?.resolution_type,30);
      if(!['credit','refund_expected','replacement','no_credit'].includes(type)){
        return res.status(400).json({error:'Valid return resolution is required'});
      }
      const credit=['credit','refund_expected'].includes(type)?Number(req.body?.confirmed_credit??0):0;
      if(!nonNegative(credit))return res.status(400).json({error:'Confirmed credit cannot be negative'});
      const {rows}=await pool.query(
        `UPDATE purchase_returns
            SET status='resolved',resolution_type=$1,confirmed_credit=$2,supplier_note=$3,
                resolved_by_account_id=$4,resolved_at=NOW(),updated_at=NOW()
          WHERE id=$5 AND supplier_account_id=$4 AND status='returned'
          RETURNING *`,
        [type,money(credit),clean(req.body?.supplier_note,1000),me.account.id,Number(req.params.id)]
      );
      if(!rows.length)return res.status(409).json({error:'Return is unavailable for resolution'});
      res.json(await returnDetail(pool,rows[0].id));
    }catch(e){next(e)}
  });

  app.post('/api/procurement/returns/:id/external-resolution',body,async(req,res,next)=>{
    try{
      const me=await identity(req);
      const ret=await returnDetail(pool,req.params.id);
      if(!ret)return res.status(404).json({error:'Return not found'});
      const b=await exactProfileBusiness(pool,me,'merchant',ret.business_id);
      if(ret.supplier_account_id)return res.status(409).json({error:'Connected Supplier must resolve this return'});
      const type=clean(req.body?.resolution_type,30);
      if(!['credit','refund_expected','replacement','no_credit'].includes(type)){
        return res.status(400).json({error:'Valid return resolution is required'});
      }
      const credit=['credit','refund_expected'].includes(type)?Number(req.body?.confirmed_credit??0):0;
      if(!nonNegative(credit))return res.status(400).json({error:'Confirmed credit cannot be negative'});
      const {rows}=await pool.query(
        `UPDATE purchase_returns
            SET status='resolved',resolution_type=$1,confirmed_credit=$2,supplier_note=$3,
                resolved_by_account_id=$4,resolved_at=NOW(),updated_at=NOW()
          WHERE id=$5 AND business_id=$6 AND supplier_account_id IS NULL AND status='returned'
          RETURNING *`,
        [
          type,money(credit),clean(req.body?.external_evidence_note,1000),me.account.id,
          Number(req.params.id),b.id
        ]
      );
      if(!rows.length)return res.status(409).json({error:'External Supplier return is unavailable for resolution'});
      res.json(await returnDetail(pool,rows[0].id));
    }catch(e){next(e)}
  });

  app.post('/api/supplier/recalls',body,async(req,res,next)=>{
    try{
      const me=await identity(req);
      if(!enabledSupplier(me))return res.status(403).json({error:'Supplier profile required'});
      const supplierLot=clean(req.body?.supplier_lot_code,90);
      if(!supplierLot)return res.status(400).json({error:'Supplier lot/batch code is required'});
      const catalogId=req.body?.catalog_item_id?Number(req.body.catalog_item_id):null;
      if(catalogId){
        const own=await pool.query(
          `SELECT product_name FROM supplier_catalog_items WHERE id=$1 AND supplier_account_id=$2`,
          [catalogId,me.account.id]
        );
        if(!own.rowCount)return res.status(404).json({error:'Supplier catalog item not found'});
      }
      const level=clean(req.body?.notice_level||'recall',20);
      const action=clean(req.body?.requested_action||'isolate',20);
      if(!['advisory','withdrawal','recall'].includes(level)||!['review','isolate','return','destroy'].includes(action)){
        return res.status(400).json({error:'Recall level or requested action is invalid'});
      }
      const reason=clean(req.body?.reason,2000);
      if(!reason)return res.status(400).json({error:'Recall reason is required'});
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const notice=await client.query(
          `INSERT INTO supply_recall_notices(
            supplier_account_id,catalog_item_id,supplier_lot_code,product_name,notice_level,
            requested_action,status,source_side,reason,source_reference,created_by_account_id
          ) VALUES($1,$2,$3,$4,$5,$6,'active','supplier',$7,$8,$1) RETURNING *`,
          [
            me.account.id,catalogId,supplierLot,clean(req.body?.product_name,180),
            level,action,reason,clean(req.body?.source_reference,500)
          ]
        );
        const matches=await client.query(
          `SELECT DISTINCT l.id,l.business_id
             FROM supply_lots l
             LEFT JOIN purchase_orders po ON po.id=l.purchase_order_id
             LEFT JOIN merchant_supply_parties sp ON sp.id=l.supply_party_id
             LEFT JOIN purchase_order_items poi ON poi.id=l.purchase_order_item_id
            WHERE l.supplier_lot_code=$1
              AND (po.supplier_account_id=$2 OR sp.supplier_account_id=$2)
              AND ($3::bigint IS NULL OR COALESCE(l.catalog_item_id,poi.catalog_item_id)=$3)`,
          [supplierLot,me.account.id,catalogId]
        );
        await applyRecallMatches(client,notice.rows[0].id,matches.rows);
        await client.query('COMMIT');
        res.status(201).json({...notice.rows[0],matched_lots:matches.rowCount,aggregate_inventory_sale_blocking:false});
      }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
      finally{client.release()}
    }catch(e){next(e)}
  });

  app.post('/api/procurement/recalls/external',body,async(req,res,next)=>{
    try{
      const me=await identity(req);
      const partyId=Number(req.body?.supply_party_id);
      const partyQ=await pool.query(`SELECT * FROM merchant_supply_parties WHERE id=$1`,[partyId]);
      if(!partyQ.rowCount)return res.status(404).json({error:'Supplier record not found'});
      const party=partyQ.rows[0];
      const b=await exactProfileBusiness(pool,me,'merchant',party.business_id);
      const supplierLot=clean(req.body?.supplier_lot_code,90);
      const reason=clean(req.body?.reason,2000);
      if(!supplierLot||!reason)return res.status(400).json({error:'Supplier lot/batch and reason are required'});
      const level=clean(req.body?.notice_level||'recall',20);
      const action=clean(req.body?.requested_action||'isolate',20);
      if(!['advisory','withdrawal','recall'].includes(level)||!['review','isolate','return','destroy'].includes(action)){
        return res.status(400).json({error:'Recall level or requested action is invalid'});
      }
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const notice=await client.query(
          `INSERT INTO supply_recall_notices(
            business_id,supply_party_id,supplier_lot_code,product_name,notice_level,
            requested_action,status,source_side,reason,source_reference,created_by_account_id
          ) VALUES($1,$2,$3,$4,$5,$6,'active','merchant_external',$7,$8,$9) RETURNING *`,
          [
            b.id,party.id,supplierLot,clean(req.body?.product_name,180),level,action,
            reason,clean(req.body?.source_reference,500),me.account.id
          ]
        );
        const matches=await client.query(
          `SELECT id,business_id FROM supply_lots
            WHERE business_id=$1 AND supply_party_id=$2 AND supplier_lot_code=$3`,
          [b.id,party.id,supplierLot]
        );
        await applyRecallMatches(client,notice.rows[0].id,matches.rows);
        await client.query('COMMIT');
        res.status(201).json({...notice.rows[0],matched_lots:matches.rowCount,aggregate_inventory_sale_blocking:false});
      }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
      finally{client.release()}
    }catch(e){next(e)}
  });

  app.get('/api/procurement/recalls',async(req,res,next)=>{
    try{
      const me=await identity(req);
      const b=await exactProfileBusiness(pool,me,'merchant',req.query.business_id||null);
      const {rows}=await pool.query(
        `SELECT n.*,m.lot_id,m.lot_status,m.match_reason,l.item_name,l.internal_lot_code,l.supplier_lot_code
           FROM supply_recall_lot_matches m
           JOIN supply_recall_notices n ON n.id=m.notice_id
           JOIN supply_lots l ON l.id=m.lot_id
          WHERE m.business_id=$1
          ORDER BY n.created_at DESC,n.id DESC,l.id`,
        [b.id]
      );
      res.json({
        matches:rows,
        aggregate_inventory_sale_blocking:false,
        warning:'Recall lot quarantine is traceability evidence; aggregate Inventory is not yet fully lot-allocated for every sale.'
      });
    }catch(e){next(e)}
  });
}

export const supplierCommercialV3Internals={
  loadPo,
  connectedTerms,
  externalTerms,
  invoiceTotals,
  returnCredits,
  returnDetail,
  lotForReturn,
  createInvoiceEvidence
};
