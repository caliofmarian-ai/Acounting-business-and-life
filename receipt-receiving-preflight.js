import {toBaseQuantity,measurementUnit} from './merchant-catalog-core.js';
import {receiptMoneyCents,RECEIPT_LIMITS} from './receipt-intelligence-core.js';

const err=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const positiveId=value=>{
  const n=Number(value);
  return Number.isSafeInteger(n)&&n>0?n:null;
};
const money=cents=>Number((cents/100).toFixed(2));
const MONEY_LIMIT=9_999_999_999_999;
const safeCents=value=>{
  const n=receiptMoneyCents(value);
  if(n==null||n<0||n>MONEY_LIMIT)err('A received line needs a confirmed nonnegative PHP cost');
  return n;
};
const issue=(issues,code)=>{if(!issues.includes(code))issues.push(code)};

/**
 * Read-only preflight for a reviewed receipt.
 * Never modifies stock, fees, payments, lots, supplier balances or source documents.
 * A future atomic receiving adapter must recheck all values under the same database transaction.
 */
export function buildReceiptReceivingPreflight({
  document,extraction,review,inventoryRows=[],linkedPurchaseIds=[],duplicateDocumentIds=[]
}={}){
  const businessId=positiveId(document?.business_id),documentId=positiveId(document?.id);
  if(!businessId||!documentId)err('An authorized Merchant receipt is required');
  if(Number(review?.business_id)!==businessId||review?.status!=='reviewed_pending_physical_receiving')
    err('A Merchant-reviewed plan for this exact receipt business is required',409);
  const sourceLines=extraction?.lines;
  if(!Array.isArray(sourceLines)||sourceLines.length<1||sourceLines.length>RECEIPT_LIMITS.lines)
    err('Original receipt line evidence is required',409);
  const actions=review.actions;
  if(!Array.isArray(actions)||actions.length!==sourceLines.length)
    err('Every extracted line must be reviewed before receiving',409);
  const byId=new Map((Array.isArray(inventoryRows)?inventoryRows:[])
    .filter(x=>Number(x.business_id)===businessId&&positiveId(x.id))
    .map(x=>[Number(x.id),x]));
  const issues=[],warnings=[],seen=new Set(),buckets=new Map();
  const resultLines=[];
  let receivedCents=0,otherCents=0,unresolved=0;
  for(const action of actions){
    const index=Number(action.line_index);
    if(!Number.isInteger(index)||index<0||index>=sourceLines.length||seen.has(index))
      err('Repeated, missing or invalid receipt line',409);
    seen.add(index);
    const kind=String(action.action||'');
    const src=sourceLines[index];
    if(!['receive','exclude','non_stock_expense','follow_up'].includes(kind))
      err('Unsupported receipt review decision',409);
    const line={
      line_index:index,action:kind,source_description:String(src.description||'').slice(0,200),
      original_line_value:src.line_total,
      source_text:String(src.raw_text||'').slice(0,300)
    };
    if(kind==='follow_up'){
      unresolved+=1;
      issue(issues,'UNRESOLVED_LINE');
      resultLines.push(line);
      continue;
    }
    if(kind!=='receive'){
      const cents=receiptMoneyCents(action.source_amount);
      if(cents==null)issue(issues,'NONSTOCK_VALUE_UNVERIFIED');
      else otherCents+=cents;
      resultLines.push({...line,source_value:cents==null?null:money(cents)});
      continue;
    }
    const inventoryId=positiveId(action.inventory_id);
    const item=byId.get(inventoryId);
    if(!inventoryId||!item)err('Reviewed Inventory product is outside this Merchant business',403);
    const quantity=Number(action.received_quantity),unit=String(action.received_unit||'').trim();
    if(!Number.isFinite(quantity)||quantity<=0||!unit)err('Physically received quantity and unit are required',409);
    let converted;
    try{converted=toBaseQuantity(quantity,unit)}catch{err('Received quantity must use a verified supported unit',409)}
    const target=measurementUnit(item.base_unit||item.unit);
    if(!target||target.family!==converted.family||target.base_unit!==converted.base_unit)
      err('Reviewed Inventory unit does not match the current product unit',409);
    if(Math.abs(Number(action.base_quantity)-converted.base_quantity)>0.000001
      ||String(action.base_unit||'')!==converted.base_unit)
      err('Reviewed stock quantity changed after confirmation',409);
    const cents=safeCents(action.line_total);
    receivedCents+=cents;
    const key=String(inventoryId)+':'+converted.base_unit;
    const row=buckets.get(key)||{
      inventory_id:inventoryId,product_name:String(item.item||'').slice(0,200),
      unit:converted.base_unit,base_quantity:0,confirmed_total_cost_cents:0,line_indices:[]
    };
    row.base_quantity+=converted.base_quantity;
    row.confirmed_total_cost_cents+=cents;
    row.line_indices.push(index);
    buckets.set(key,row);
    resultLines.push({...line,inventory_id:inventoryId,
      received_base_quantity:converted.base_quantity,base_unit:converted.base_unit,
      confirmed_total_cost:money(cents)});
    if(src.suggested_base_quantity!=null
      &&Math.abs(Number(src.suggested_base_quantity)-converted.base_quantity)>0.000001)
      issue(warnings,'PHYSICAL_QUANTITY_DIFFERS_FROM_PRINTED_SUGGESTION');
  }
  if(seen.size!==sourceLines.length)err('Receipt review is incomplete',409);
  const receiptCents=receiptMoneyCents(document.gross_amount);
  const extractedCents=receiptMoneyCents(extraction.document_total);
  if(extraction.currency_code!=='PHP')issue(issues,'CURRENCY_REQUIRES_MANUAL_RECONCILIATION');
  if(extraction.reconciliation?.status!=='balanced')issue(issues,'ORIGINAL_TOTAL_NOT_BALANCED');
  if(receiptCents==null||extractedCents==null)issue(issues,'RECEIPT_TOTAL_NOT_CONFIRMED');
  else if(receiptCents!==extractedCents)issue(issues,'UPLOADED_DOCUMENT_TOTAL_CONFLICT');
  const reviewedCents=receivedCents+otherCents;
  const printedLineCents=sourceLines.reduce((sum,x)=>{
    const cents=receiptMoneyCents(x.line_total);
    return cents==null?sum:sum+cents;
  },0);
  if(sourceLines.some(x=>receiptMoneyCents(x.line_total)==null))
    issue(issues,'SOME_SOURCE_LINE_TOTALS_UNKNOWN');
  if(printedLineCents!==reviewedCents)
    issue(issues,'REVIEWED_LINE_AMOUNTS_CHANGED');
  if(!buckets.size)issue(issues,'NO_PHYSICAL_STOCK_LINES_CONFIRMED');
  if((linkedPurchaseIds||[]).length)issue(issues,'RECEIPT_ALREADY_LINKED_TO_STOCK_PURCHASE');
  if((duplicateDocumentIds||[]).length)issue(issues,'POSSIBLE_DUPLICATE_RECEIPT');
  const ancillaryCents=
    (receiptMoneyCents(extraction.tax_amount)||0)+
    (receiptMoneyCents(extraction.shipping_amount)||0)+
    (receiptMoneyCents(extraction.other_charge_amount)||0)-
    (receiptMoneyCents(extraction.discount_amount)||0);
  if(ancillaryCents!==0)issue(warnings,'CHARGES_AND_DISCOUNTS_NEED_EXPLICIT_COST_ALLOCATION');
  const groups=[...buckets.values()]
    .sort((a,b)=>a.inventory_id-b.inventory_id)
    .map(x=>({
      inventory_id:x.inventory_id,product_name:x.product_name,
      base_quantity:Number(x.base_quantity.toFixed(6)),
      base_unit:x.unit,confirmed_line_cost:money(x.confirmed_total_cost_cents),
      source_line_indices:x.line_indices
    }));
  // Even a clean preflight never authorizes stock posting while the canonical
  // Inventory batch-receiving transaction and the release safety gates are incomplete.
  return{
    schema_version:1,document_id:documentId,business_id:businessId,
    source:'merchant_reviewed_receipt_evidence',
    receipt_total:receiptCents==null?null:money(receiptCents),
    parsed_receipt_total:extractedCents==null?null:money(extractedCents),
    received_line_cost:money(receivedCents),
    nonstock_and_excluded_line_value:money(otherCents),
    unallocated_charges_or_discounts:money(ancillaryCents),
    reviewed_lines:resultLines,
    grouped_inventory_candidates:groups,
    unresolved_lines:unresolved,
    existing_purchase_links:(linkedPurchaseIds||[]).length,
    possible_duplicate_documents:(duplicateDocumentIds||[]).length,
    issues,warnings,
    status:issues.length?'needs_reconciliation':'ready_for_future_controlled_receiving',
    can_post_stock:false,stock_posted:false,payment_recorded:false,
    release_hold:'Batch physical receiving is not active. No stock or money has changed.'
  };
}
