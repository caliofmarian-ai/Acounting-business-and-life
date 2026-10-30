/**
 * Read-only, server-authoritative Merchant voice order quote (#863).
 * Reconciles each approved draft identity with canonical, existing Orders
 * product/variant/modifier snapshots. No stock reservation or order write.
 */
import crypto from 'node:crypto';
import {voiceDraftForQuote,voiceOrderLineKey} from './merchant-voice-order-core.js';
const reject=(message,code='VOICE_QUOTE_STALE')=>{throw Object.assign(new Error(message),{status:409,code})};
const cents=amount=>{
  const value=Number(amount);if(!Number.isFinite(value)||value<0||value>9999999)reject('Catalog has an invalid amount.');
  const result=Math.round((value+Number.EPSILON)*100);
  if(!Number.isSafeInteger(result)||Math.abs(result-value*100)>0.001)reject('Catalog amount is not exact PHP cents.');
  return result;
};
const optionIds=snapshot=>(snapshot?.groups||[]).flatMap(group=>(group.options||[]).map(option=>Number(option.option_id))).sort((a,b)=>a-b);
const rowKey=row=>voiceOrderLineKey(row.source_kind,row.source_id,row.catalog_variant_id||null,optionIds(row.modifier_snapshot_json));
export function authoritativeVoiceOrderQuote({draft,snapshots,accountId,sessionId,businessId,secret,now=new Date()}={}){
  const proposal=voiceDraftForQuote(draft);
  if(Number(businessId)!==proposal.business_id||draft.session_id!==sessionId||!Number.isSafeInteger(Number(accountId))||Number(accountId)<1)
    reject('Merchant context changed. Start a fresh quote.','VOICE_CONTEXT_STALE');
  if(!Array.isArray(snapshots)||snapshots.length!==proposal.items.length)reject('Products or options changed. Refresh the draft.');
  const expected=new Map(proposal.items.map(line=>[voiceOrderLineKey(line.source_kind,line.product_id,line.variant_id,line.modifier_option_ids),line]));
  const matched=[];let subtotal=0;
  for(const row of snapshots){
    const key=rowKey(row);const line=expected.get(key);
    if(!line)reject('Catalog product selection changed. Refresh the draft.');
    if(Number(row.quantity)!==Number(line.quantity))reject('Catalog quantity changed. Refresh the draft.');
    const price=cents(row.unit_price_snapshot),total=cents(row.line_total);
    if(Math.abs(total-price*Number(line.quantity))>1)reject('Catalog price calculation changed. Refresh the draft.');
    subtotal+=total;
    if(subtotal>999999999)reject('Order exceeds the quote limit.');
    matched.push({source_kind:row.source_kind,product_id:Number(row.source_id),name:String(row.name_snapshot||'').slice(0,160),
      quantity:Number(row.quantity),variant_id:row.catalog_variant_id||null,modifier_option_ids:optionIds(row.modifier_snapshot_json),
      unit_price_centavos:price,line_total_centavos:total});
    expected.delete(key);
  }
  if(expected.size||!matched.length)reject('Catalog lines changed. Refresh the draft.');
  const expiry=new Date(now.getTime()+2*60_000);
  const quote={business_id:Number(businessId),operator_account_id:Number(accountId),session_id:sessionId,
    customer_name:proposal.customer_name,fulfilment_method:'pickup',payment_method:'cash',
    line_items:matched,currency_code:'PHP',subtotal_centavos:subtotal,delivery_fee_centavos:0,
    total_centavos:subtotal,payment_status:'unpaid',issued_at:now.toISOString(),expires_at:expiry.toISOString()};
  const key=Buffer.isBuffer(secret)?secret:Buffer.from(secret||'');
  if(key.length<16)throw Object.assign(new Error('Voice quote server key missing.'),{status:503,code:'VOICE_QUOTE_KEY_REQUIRED'});
  const signature=crypto.createHmac('sha256',key).update(JSON.stringify(quote)).digest('base64url');
  return {status:'quote_only',creates_orders:false,stock_reserved:false,quote,signature};
}