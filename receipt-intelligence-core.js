import crypto from 'node:crypto';
import {toBaseQuantity,measurementUnit} from './merchant-catalog-core.js';
import {normalizeBarcode,normalizeInternalSku} from './inventory-identifiers.js';

// A receipt photo can suggest a purchase; it can never authorize stock or money movement.
export const RECEIPT_LIMITS=Object.freeze({lines:80,inventoryCandidates:4000,bodyBytes:160000});
const trim=(v,n=250)=>String(v??'').trim().replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,n);
const error=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const validId=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
const moneyFromCents=v=>v==null?null:Number((v/100).toFixed(2));
const itemName=v=>trim(v,200).toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');

export function receiptMoneyCents(value){
  if(value==null||value==='')return null;
  const v=String(value).trim().replace(/^PHP\s*/i,'').replace(/^₱\s*/,'').replace(/,/g,'');
  const match=v.match(/^(\d{1,12})(?:\.(\d{1,2}))?$/);
  if(!match)return null;
  const amount=BigInt(match[1])*100n+BigInt((match[2]||'').padEnd(2,'0'));
  return amount>9_999_999_999_999n?null:Number(amount);
}
const numberOrNull=v=>{if(v==null||v==='')return null;const n=Number(v);return Number.isFinite(n)&&n>0&&n<1e9?Math.round(n*1e6)/1e6:null};
const monetary=(v,warnings,key)=>{const result=receiptMoneyCents(v);if(v!=null&&v!==''&&result==null)warnings.push(key+'_INVALID');return moneyFromCents(result)};
const dateValue=v=>{const s=trim(v,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;const d=new Date(s+'T00:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===s?s:null};

export function normalizeReceiptExtraction(input){
  if(!input||typeof input!=='object'||Array.isArray(input))error('Structured receipt extraction is required');
  if(JSON.stringify(input).length>RECEIPT_LIMITS.bodyBytes)error('Receipt extraction exceeds size limit',413);
  if(!Array.isArray(input.lines)||input.lines.length<1||input.lines.length>RECEIPT_LIMITS.lines)error('Receipt must contain 1–80 lines');
  const warnings=[],currencyVisible=Boolean(trim(input.currency_code,3));
  const currency=trim(input.currency_code||'PHP',3).toUpperCase();
  if(!/^[A-Z]{3}$/.test(currency))error('Unsupported currency format');
  if(!currencyVisible)warnings.push('CURRENCY_NOT_VISIBLE_REVIEW');
  if(currency!=='PHP')warnings.push('NON_PHP_CURRENCY_REVIEW');
  const totals={};
  for(const field of ['document_total','subtotal','tax_amount','discount_amount','shipping_amount','other_charge_amount']){
    totals[field]=monetary(input[field],warnings,field.toUpperCase());
  }
  const lines=input.lines.map((raw,index)=>{
    if(!raw||typeof raw!=='object'||Array.isArray(raw))error('Invalid receipt product row');
    const flags=[],description=trim(raw.description,200),printed=trim(raw.raw_text||raw.description,300);
    const quantity=numberOrNull(raw.quantity),packQuantity=numberOrNull(raw.pack_quantity);
    const unit=trim(raw.unit,30),packUnit=trim(raw.pack_unit,30);
    if(!description)flags.push('NAME_MISSING');
    if(!quantity)flags.push('QUANTITY_UNCONFIRMED');
    if(raw.pack_quantity!=null&&!packQuantity)flags.push('PACK_SIZE_INVALID');
    if(packQuantity&&!packUnit)flags.push('PACK_UNIT_MISSING');
    const lineTotal=monetary(raw.line_total,flags,'LINE_TOTAL');
    if(lineTotal==null)flags.push('LINE_TOTAL_UNCONFIRMED');
    const confidence=raw.confidence==null?null:Number(raw.confidence);
    if(confidence==null||!Number.isFinite(confidence)||confidence<0.8)flags.push('LOW_CONFIDENCE');
    let converted=null;
    if(quantity&&unit)try{converted=toBaseQuantity(quantity,unit)}catch{}
    if(quantity&&packQuantity&&packUnit)try{converted=toBaseQuantity(quantity*packQuantity,packUnit)}catch{}
    if(!converted)flags.push('UNIT_CONFIRMATION_REQUIRED');
    return{
      line_index:index,raw_text:printed,description,
      sku:normalizeInternalSku(raw.sku),barcode:normalizeBarcode(raw.barcode),
      quantity,unit,pack_quantity:packQuantity,pack_unit:packUnit,
      unit_price:monetary(raw.unit_price,flags,'UNIT_PRICE'),line_total:lineTotal,
      confidence:Number.isFinite(confidence)?Math.max(0,Math.min(1,confidence)):null,
      evidence:trim(raw.evidence,320),
      suggested_base_quantity:converted?.base_quantity??null,
      suggested_base_unit:converted?.base_unit??null,
      flags:[...new Set(flags)]
    };
  });
  const sum=lines.reduce((a,x)=>a+(receiptMoneyCents(x.line_total)||0),0);
  const complete=lines.every(x=>x.line_total!=null);
  const total=receiptMoneyCents(totals.document_total);
  const subtotal=receiptMoneyCents(totals.subtotal);
  const predicted=sum+(receiptMoneyCents(totals.tax_amount)||0)+(receiptMoneyCents(totals.shipping_amount)||0)
    +(receiptMoneyCents(totals.other_charge_amount)||0)-(receiptMoneyCents(totals.discount_amount)||0);
  const difference=total==null?null:total-predicted;
  const subtotalDifference=subtotal==null?null:subtotal-sum;
  const status=!complete||total==null?'incomplete':difference===0&&(subtotalDifference==null||subtotalDifference===0)?'balanced':'mismatch';
  if(status!=='balanced')warnings.push(status==='mismatch'?'TOTAL_MISMATCH':'TOTAL_UNVERIFIED');
  const date=dateValue(input.issue_date);
  if(input.issue_date&&!date)warnings.push('DATE_UNRECOGNIZED');
  return{
    schema_version:1,source:'untrusted_receipt_suggestion',vendor_name:trim(input.vendor_name,180),
    document_number:trim(input.document_number,100),issue_date:date,currency_code:currency,
    currency_observed_on_document:currencyVisible,
    ...totals,lines,reconciliation:{status,line_sum:moneyFromCents(sum),
      predicted_total:moneyFromCents(predicted),difference:moneyFromCents(difference),
      subtotal_difference:moneyFromCents(subtotalDifference),parsed_lines:lines.filter(x=>x.line_total!=null).length},
    warnings:[...new Set(warnings)],fiscal_status:'internal_evidence',
    requires_human_review:true,stock_posted:false,payment_recorded:false,fiscal_validated:false
  };
}
function similarity(a,b){
  const A=new Set(itemName(a).split(' ').filter(x=>x.length>1)),B=new Set(itemName(b).split(' ').filter(x=>x.length>1));
  if(!A.size||!B.size)return 0;let intersection=0;for(const word of A)if(B.has(word))intersection++;
  return intersection/(A.size+B.size-intersection);
}
export function suggestReceiptInventoryMatches({extraction,businessId,inventoryRows=[],confirmedAliases=[]}){
  if(!Array.isArray(extraction?.lines)||!validId(businessId))error('Receipt and authorized business required');
  const rows=(Array.isArray(inventoryRows)?inventoryRows:[]).filter(r=>validId(r.id)&&Number(r.business_id)===Number(businessId)).slice(0,RECEIPT_LIMITS.inventoryCandidates);
  const aliases=new Map();
  for(const alias of Array.isArray(confirmedAliases)?confirmedAliases:[]){
    if(Number(alias.business_id)!==Number(businessId)||!rows.some(r=>Number(r.id)===Number(alias.inventory_id)))continue;
    const k=itemName(alias.alias),v=aliases.get(k)||new Set();v.add(Number(alias.inventory_id));aliases.set(k,v);
  }
  return extraction.lines.map(line=>{
    let matches=[],kind='unmatched';const name=itemName(line.description);
    if(line.barcode){matches=rows.filter(r=>normalizeBarcode(r.barcode)===line.barcode&&line.barcode);if(matches.length)kind='barcode_exact'}
    if(!matches.length&&line.sku){matches=rows.filter(r=>normalizeInternalSku(r.internal_sku)===line.sku&&line.sku);if(matches.length)kind='sku_exact'}
    if(!matches.length&&name){matches=rows.filter(r=>itemName(r.item)===name);if(matches.length)kind='name_exact'}
    if(!matches.length&&aliases.has(name)){matches=rows.filter(r=>aliases.get(name).has(Number(r.id)));if(matches.length)kind='confirmed_alias'}
    if(!matches.length&&name){
      matches=rows.map(r=>({...r,score:similarity(line.description,r.item)})).filter(r=>r.score>=0.54)
        .sort((a,b)=>b.score-a.score||Number(a.id)-Number(b.id)).slice(0,4);
      if(matches.length)kind='similar_name_candidate';
    }
    const ambiguous=kind==='similar_name_candidate'||matches.length!==1;
    return{
      line_index:line.line_index,match_type:kind,ambiguous,needs_user_selection:true,
      suggested_inventory_id:ambiguous?null:Number(matches[0].id),
      candidates:matches.map(r=>({inventory_id:Number(r.id),name:trim(r.item,200),unit:trim(r.unit,30),
        match_reason:kind,score:typeof r.score==='number'?Number(r.score.toFixed(3)):null}))
    };
  });
}
export function buildReceiptIntelligenceDraft({extraction,businessId,inventoryRows=[],aliases=[],meta={}}){
  const normalized=normalizeReceiptExtraction(extraction);
  return{
    ...normalized,
    matches:suggestReceiptInventoryMatches({extraction:normalized,businessId,inventoryRows,confirmedAliases:aliases}),
    processing:{provider:trim(meta.provider,60)||'manual',model:trim(meta.model,100)||'none'},
    decision:'awaiting_human_review'
  };
}
export function validateReceiptReceivingReview({draft,submission,businessId,inventoryRows=[]}){
  if(!Array.isArray(draft?.lines)||!Array.isArray(submission?.decisions))error('Receipt review is required');
  if(submission.decisions.length!==draft.lines.length)error('Every line must be reviewed');
  if(!validId(businessId))error('Business scope required');
  const known=new Map((Array.isArray(inventoryRows)?inventoryRows:[]).filter(r=>Number(r.business_id)===Number(businessId))
    .map(r=>[Number(r.id),r]));
  const seen=new Set(),actions=[];
  for(const decision of submission.decisions){
    const idx=Number(decision.line_index),action=trim(decision.action,30);
    if(!Number.isInteger(idx)||idx<0||idx>=draft.lines.length||seen.has(idx))error('Repeated or invalid receipt line');
    seen.add(idx);
    if(!['receive','non_stock_expense','exclude','follow_up'].includes(action))error('Review action is required');
    const source=draft.lines[idx];
    let row={line_index:idx,action,source_text:source.raw_text,source_amount:source.line_total,reason:trim(decision.reason,200)};
    if(action==='receive'){
      const item=known.get(Number(decision.inventory_id)),quantity=numberOrNull(decision.received_quantity),unit=trim(decision.received_unit,30);
      if(!item)error('Inventory item does not belong to this Merchant business',403);
      if(!quantity||!unit)error('Physically received quantity and unit must be confirmed');
      let converted;try{converted=toBaseQuantity(quantity,unit)}catch{error('Unit must be a verified supported base unit')}
      const existing=measurementUnit(item.base_unit||item.unit);
      if(existing&&converted.family!==existing.family)error('Incompatible Inventory measurement family');
      const cost=receiptMoneyCents(decision.confirmed_total_cost);
      if(cost==null)error('Line cost must be explicitly confirmed');
      row={...row,inventory_id:Number(item.id),received_quantity:quantity,received_unit:unit,
        base_quantity:converted.base_quantity,base_unit:converted.base_unit,line_total:moneyFromCents(cost)};
    }
    actions.push(row);
  }
  actions.sort((a,b)=>a.line_index-b.line_index);
  return{review_version:1,business_id:Number(businessId),status:'reviewed_pending_physical_receiving',
    source_document_total:draft.document_total,actions,stock_posted:false,payment_recorded:false,
    manual_receiving_required:true,warning:'This review does not change Inventory.'};
}
export function receiptExtractionFingerprint({documentId,sha256,provider='manual',version='v1'}){
  if(!validId(documentId)||!/^[a-f0-9]{64}$/i.test(String(sha256||'')))error('Valid receipt document and source SHA256 required');
  return crypto.createHash('sha256').update([documentId,sha256,provider,version].join(':')).digest('hex');
}
