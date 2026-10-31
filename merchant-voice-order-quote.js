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

/** Verify an immutable server-issued quote before a separately authorized create. */
export function verifyVoiceOrderSignedQuote({signedQuote,accountId,businessId,sessionId,secret,
  now=new Date(),allowExpired=false}={}){
  if(!signedQuote||typeof signedQuote!=='object'||Array.isArray(signedQuote)||
     !signedQuote.quote||typeof signedQuote.quote!=='object'||Array.isArray(signedQuote.quote)||
     typeof signedQuote.signature!=='string'||signedQuote.signature.length!==43)
    reject('Create a fresh server-checked quote before confirming.','VOICE_CONFIRM_QUOTE_INVALID');
  const quote=signedQuote.quote;
  const json=JSON.stringify(quote);
  if(!json||json.length>28000)reject('Order quote is invalid.','VOICE_CONFIRM_QUOTE_INVALID');
  const key=Buffer.isBuffer(secret)?secret:Buffer.from(secret||'');
  if(key.length<16)reject('Order confirmation is not configured.','VOICE_QUOTE_KEY_REQUIRED');
  const expected=crypto.createHmac('sha256',key).update(json).digest();
  let provided;
  try{provided=Buffer.from(signedQuote.signature,'base64url')}catch{}
  if(!provided||provided.length!==expected.length||!crypto.timingSafeEqual(provided,expected))
    reject('Order quote has changed. Check the current total again.','VOICE_CONFIRM_QUOTE_INVALID');
  if(quote.business_id!==Number(businessId)||quote.operator_account_id!==Number(accountId)||
     quote.session_id!==sessionId)
    reject('Merchant or signed-in operator changed. Check the order again.','VOICE_CONTEXT_STALE');
  const issued=Date.parse(quote.issued_at),expires=Date.parse(quote.expires_at),clock=now.getTime();
  if(!Number.isFinite(issued)||!Number.isFinite(expires)||!Number.isFinite(clock)||
     expires<=issued||expires-issued>120000||issued>clock+15000||(!allowExpired&&clock>=expires))
    reject('Order quote has expired. Check the current total again.','VOICE_QUOTE_STALE');
  if(quote.fulfilment_method!=='pickup'||quote.payment_method!=='cash'||
     quote.currency_code!=='PHP'||quote.payment_status!=='unpaid'||
     quote.delivery_fee_centavos!==0||typeof quote.customer_name!=='string'||quote.customer_name.length>120)
    reject('Quote payment or delivery terms are invalid.','VOICE_CONFIRM_QUOTE_INVALID');
  const lines=quote.line_items;
  if(!Array.isArray(lines)||!lines.length||lines.length>50)
    reject('Quote must have 1–50 products.','VOICE_CONFIRM_QUOTE_INVALID');
  const seen=new Set();let total=0;
  for(const line of lines){
    if(!line||typeof line!=='object'||!['product','marketplace_product'].includes(line.source_kind)||
       !Number.isSafeInteger(line.product_id)||line.product_id<1||
       !Number.isSafeInteger(line.quantity)||line.quantity<1||line.quantity>999||
       !Number.isSafeInteger(line.unit_price_centavos)||line.unit_price_centavos<0||
       !Number.isSafeInteger(line.line_total_centavos)||line.line_total_centavos<0||
       line.line_total_centavos!==line.unit_price_centavos*line.quantity||
       typeof line.name!=='string'||!line.name.trim()||line.name.length>160||
       (line.variant_id!==null&&(!Number.isSafeInteger(line.variant_id)||line.variant_id<1))||
       !Array.isArray(line.modifier_option_ids)||line.modifier_option_ids.length>20||
       line.modifier_option_ids.some(id=>!Number.isSafeInteger(id)||id<1)||
       new Set(line.modifier_option_ids).size!==line.modifier_option_ids.length)
      reject('Quote has an invalid product selection or amount.','VOICE_CONFIRM_QUOTE_INVALID');
    const key=voiceOrderLineKey(line.source_kind,line.product_id,line.variant_id,line.modifier_option_ids);
    if(seen.has(key))reject('Quote contains duplicate product configurations.','VOICE_CONFIRM_QUOTE_INVALID');
    seen.add(key);total+=line.line_total_centavos;
  }
  if(!Number.isSafeInteger(total)||total>999999999||quote.subtotal_centavos!==total||quote.total_centavos!==total)
    reject('Quote total does not match its products.','VOICE_CONFIRM_QUOTE_INVALID');
  return {quote,quoteHash:crypto.createHash('sha256').update(json).update('.').update(signedQuote.signature).digest('hex'),
    orderItems:lines.map(l=>({product_id:l.product_id,source_kind:l.source_kind,quantity:l.quantity,
      variant_id:l.variant_id,modifier_option_ids:[...l.modifier_option_ids]}))};
}

/** Canonical PostgreSQL price/option snapshot checks, before posting in that same transaction. */
export function assertVoiceQuoteMatchesSnapshots(quote,snapshots){
  if(!quote||!Array.isArray(quote.line_items)||!Array.isArray(snapshots)||
     snapshots.length!==quote.line_items.length)
    reject('The Catalog changed. Check the order again.');
  const expected=new Map(quote.line_items.map(line=>[
    voiceOrderLineKey(line.source_kind,line.product_id,line.variant_id,line.modifier_option_ids),line
  ]));
  let total=0;
  for(const snapshot of snapshots){
    const key=rowKey(snapshot),line=expected.get(key);
    if(!line||Number(snapshot.quantity)!==line.quantity||
       String(snapshot.name_snapshot||'').slice(0,160)!==line.name||
       cents(snapshot.unit_price_snapshot)!==line.unit_price_centavos||
       cents(snapshot.line_total)!==line.line_total_centavos)
      reject('Product, price or options changed. Check the current total again.');
    expected.delete(key);total+=line.line_total_centavos;
  }
  if(expected.size||total!==quote.total_centavos)
    reject('Current Catalog quote no longer matches the order.');
  return true;
}