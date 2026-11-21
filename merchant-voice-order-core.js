/**
 * Merchant conversational order draft reducer (issue #863).
 * Untrusted AI/ASR output is a suggestion, NOT an order, payment or stock write.
 * The authenticated integration must supply the current exact-business counter
 * Catalog and a server-bound session identifier. Do not accept a client Catalog.
 */
const fail=(code,message,status=422)=>Object.assign(new Error(message),{code,status});
const int=value=>Number.isSafeInteger(Number(value))&&Number(value)>0;
const limitedString=(value,max)=>typeof value==='string' ? value.normalize('NFKC').replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max) : '';
const searchKey=value=>limitedString(value,160).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const phpCents=value=>{
  const amount=Number(value);
  if(!Number.isFinite(amount)||amount<0||amount>9999999)throw fail('INVALID_CATALOG_PRICE','Catalog has an invalid price.');
  const cents=Math.round((amount+Number.EPSILON)*100);
  if(!Number.isSafeInteger(cents)||Math.abs(cents-amount*100)>0.001)throw fail('INVALID_CATALOG_PRICE','Catalog price must use valid PHP centavos.');
  return cents;
};
const safeProduct=product=>product&&int(product.id)&&['product','marketplace_product'].includes(product.source_kind)&&typeof product.name==='string'&&product.name.trim().length>0;
const productKey=p=>`${p.source_kind}:${Number(p.id)}`;
const variantOptionKey=options=>(options||[]).map(Number).sort((a,b)=>a-b).join(',');
export const voiceOrderLineKey=(sourceKind,id,variantId=null,modifierIds=[])=>`${sourceKind}:${Number(id)}:${variantId??0}:${variantOptionKey(modifierIds)}`;
const maxOperations=16, maxCatalog=1000, maxQuantity=999, maxLines=50;

function catalogIndex(catalog,businessId){
  if(!Array.isArray(catalog)||catalog.length>maxCatalog)throw fail('CATALOG_LIMIT','Current Catalog is unavailable or too large.',400);
  const byId=new Map(),byName=new Map();
  for(const product of catalog){
    if(!safeProduct(product))continue;
    // For integrations whose Catalog includes business_id, reject cross-business rows.
    if(product.business_id!=null&&Number(product.business_id)!==businessId)throw fail('CROSS_BUSINESS_CATALOG','Catalog does not match the current Merchant.',403);
    const key=productKey(product);
    if(byId.has(key))throw fail('DUPLICATE_CATALOG_ID','Current Catalog contains duplicate product identities.',409);
    byId.set(key,product);
    const name=searchKey(product.name);
    if(!byName.has(name))byName.set(name,[]);
    byName.get(name).push(product);
  }
  return{byId,byName};
}
function resolveProduct(name,index){
  const key=searchKey(name);
  if(!key||key==='this'||key==='that'||key==='those'||key==='it')throw fail('PRODUCT_UNCLEAR','Which product do you mean?');
  let candidates=index.byName.get(key)||[];
  // Allow *unique* word-boundary abbreviation, never silently choose a fuzzy match.
  if(!candidates.length&&key.length>=3){
    const target=key.split(' ');
    candidates=[...index.byId.values()].filter(p=>{
      const parts=searchKey(p.name).split(' ');
      return parts.some((_,i)=>parts.slice(i,i+target.length).join(' ')===key);
    });
  }
  if(!candidates.length)throw fail('PRODUCT_UNKNOWN',`I couldn't find “${limitedString(name,90)}” in this Merchant Catalog.`);
  if(candidates.length!==1)throw fail('PRODUCT_AMBIGUOUS',`Several Catalog products match “${limitedString(name,90)}”. Please specify which.`);
  const product=candidates[0];
  if(product.active===false||product.available!==true)throw fail('PRODUCT_UNAVAILABLE',`${product.name} is currently unavailable.`);
  phpCents(product.selling_price);
  return product;
}
function resolveVariant(product,hint){
  const label=searchKey(hint);
  if(!product.variant_mode){
    if(label)throw fail('VARIANT_INVALID',`${product.name} does not have variants.`);
    return{variant_id:null,variant_delta_centavos:0};
  }
  if(!label)throw fail('VARIANT_REQUIRED',`Which variant of ${product.name} should I add?`);
  const variants=Array.isArray(product.variants)?product.variants:[];
  const found=variants.filter(v=>{
    const names=[v.variant_key,v.name,...(v.option_values||[]).map(o=>o.value_label),
      (v.option_values||[]).map(o=>o.value_label).join(' / ')].filter(Boolean).map(searchKey);
    return names.includes(label);
  });
  if(found.length!==1)throw fail(found.length?'VARIANT_AMBIGUOUS':'VARIANT_UNKNOWN',`Choose an exact available variant for ${product.name}.`);
  const v=found[0];
  if(!int(v.id)||v.active===false||v.in_stock===false)throw fail('VARIANT_UNAVAILABLE',`That variant of ${product.name} is unavailable.`);
  // Price overrides are an exact Catalog projection; no AI-supplied prices.
  const effective=v.price_override==null?product.selling_price:v.price_override;
  return{variant_id:Number(v.id),variant_delta_centavos:phpCents(effective)-phpCents(product.selling_price)};
}
function resolveModifiers(product,names){
  if(!Array.isArray(names)||names.length>20||names.some(n=>typeof n!=='string'))throw fail('MODIFIER_INVALID','Check the selected product options.');
  const groups=Array.isArray(product.modifier_groups)?product.modifier_groups:[];
  const selected=[],counts=new Map();
  for(const name of names){
    const key=searchKey(name);
    const hits=groups.flatMap(g=>(g.options||[]).filter(o=>o.active!==false&&searchKey(o.name)===key).map(o=>({group:g,option:o})));
    if(hits.length!==1)throw fail(hits.length?'MODIFIER_AMBIGUOUS':'MODIFIER_UNKNOWN',`Please specify the exact option “${limitedString(name,70)}” for ${product.name}.`);
    const hit=hits[0];
    if(!int(hit.option.id)||selected.some(o=>o.id===Number(hit.option.id)))throw fail('MODIFIER_DUPLICATE','Choose each product option only once.');
    selected.push({id:Number(hit.option.id),group:hit.group,price_delta_centavos:phpCents(hit.option.price_delta??0)});
    counts.set(hit.group.id,(counts.get(hit.group.id)||0)+1);
  }
  for(const g of groups){
    const min=Number(g.min_select),max=Number(g.max_select),n=counts.get(g.id)||0;
    if(!Number.isInteger(min)||!Number.isInteger(max)||min<0||max<min)throw fail('MODIFIER_GROUP_INVALID','Catalog product options are not configured correctly.');
    if(n<min||n>max)throw fail('MODIFIER_SELECTION_REQUIRED',`${product.name}: ${g.name} requires ${min===max?min:`${min}–${max}`} choice(s).`);
  }
  return{modifier_option_ids:selected.map(o=>o.id).sort((a,b)=>a-b),modifier_delta_centavos:selected.reduce((s,o)=>s+o.price_delta_centavos,0)};
}
function resolveSelection(product,operation){
  const variant=resolveVariant(product,operation.variant_name);
  const mods=resolveModifiers(product,operation.modifier_names??[]);
  const price=phpCents(product.selling_price)+variant.variant_delta_centavos+mods.modifier_delta_centavos;
  if(!Number.isSafeInteger(price)||price<0)throw fail('INVALID_CATALOG_PRICE','Product options produced an invalid price.');
  return{
    source_kind:product.source_kind,product_id:Number(product.id),name:product.name,
    variant_name:limitedString(operation.variant_name,100),modifier_names:(operation.modifier_names||[]).map(n=>limitedString(n,100)),
    variant_id:variant.variant_id,modifier_option_ids:mods.modifier_option_ids,
    unit_price_centavos:price,
    line_key:voiceOrderLineKey(product.source_kind,product.id,variant.variant_id,mods.modifier_option_ids)
  };
}
function reconcilePrior(draft,index,businessId,sessionId){
  if(!draft)return{business_id:businessId,session_id:sessionId,customer_name:'',lines:[],last_added_line_key:null};
  if(Number(draft.business_id)!==businessId||draft.session_id!==sessionId)
    throw fail('VOICE_CONTEXT_STALE','Merchant business or operator session changed; discard this voice draft.',409);
  if(!Array.isArray(draft.lines)||draft.lines.length>maxLines)throw fail('DRAFT_INVALID','Voice draft is invalid.',400);
  const lines=[],seen=new Set();
  for(const row of draft.lines){
    const product=index.byId.get(`${row?.source_kind}:${Number(row?.product_id)}`);
    if(!product||product.active===false||product.available!==true)throw fail('DRAFT_PRODUCT_STALE','Catalog changed; review the order again.',409);
    if(!Number.isInteger(Number(row.quantity))||row.quantity<1||row.quantity>maxQuantity)throw fail('DRAFT_INVALID','Voice draft has an invalid quantity.',400);
    const variants=product.variant_mode?(product.variants||[]):[];
    let variant_name='';
    if(product.variant_mode){
      const v=variants.find(x=>Number(x.id)===Number(row.variant_id));
      if(!v||v.active===false||v.in_stock===false)throw fail('DRAFT_PRODUCT_STALE','A selected Catalog variant is no longer available.',409);
      variant_name=v.variant_key||v.name||(v.option_values||[]).map(x=>x.value_label).join(' / ');
    }else if(row.variant_id!=null)throw fail('DRAFT_PRODUCT_STALE','Product variant configuration changed.',409);
    const options=(product.modifier_groups||[]).flatMap(g=>g.options||[]);
    if(!Array.isArray(row.modifier_option_ids))throw fail('DRAFT_INVALID','Draft options are invalid.',400);
    const selected=row.modifier_option_ids.map(Number);
    if(new Set(selected).size!==selected.length||selected.some(id=>!int(id)||!options.some(o=>Number(o.id)===id)))throw fail('DRAFT_PRODUCT_STALE','Product options changed; review the order again.',409);
    const names=selected.map(id=>options.find(o=>Number(o.id)===id).name);
    const item=resolveSelection(product,{variant_name,modifier_names:names});
    if(seen.has(item.line_key))throw fail('DRAFT_INVALID','Duplicate product line in voice draft.',400);
    seen.add(item.line_key);lines.push({...item,quantity:Number(row.quantity)});
  }
  return{business_id:businessId,session_id:sessionId,customer_name:limitedString(draft.customer_name,120),lines,last_added_line_key:lines.some(row=>row.line_key===draft.last_added_line_key)?draft.last_added_line_key:null};
}
function matchExistingLine(op,draft,index){
  if(op.product_name===null||op.product_name===''||op.product_name==null){
    if(op.line_reference==='last'&&draft.last_added_line_key)return draft.lines.find(x=>x.line_key===draft.last_added_line_key);
    if(draft.lines.length===1&&op.line_reference==='only')return draft.lines[0];
    throw fail('LINE_UNCLEAR','Which line should I change?');
  }
  const product=resolveProduct(op.product_name,index);
  const found=draft.lines.filter(row=>row.source_kind===product.source_kind&&row.product_id===Number(product.id));
  if(!found.length)throw fail('LINE_UNKNOWN',`${product.name} is not in the order yet.`);
  if(found.length>1)throw fail('LINE_AMBIGUOUS',`Which option/variant of ${product.name} should I change?`);
  return found[0];
}
function readback(draft){
  const parts=draft.lines.map(x=>`${x.quantity} × ${x.name}${[x.variant_name,...(x.modifier_names||[])].filter(Boolean).length?' ('+[x.variant_name,...(x.modifier_names||[])].filter(Boolean).join(', ')+')':''}`);
  const subtotal=draft.lines.reduce((n,x)=>n+x.unit_price_centavos*x.quantity,0);
  const name=draft.customer_name||'Walk-in customer';
  return `Draft for ${name}: ${parts.join(', ')||'no items'}. Estimated items subtotal PHP ${(subtotal/100).toFixed(2)}. Not confirmed or paid.`;
}
/**
 * Applies ONE proposed structured conversational turn atomically. On ambiguity,
 * no proposed changes are committed, including changes earlier in that turn.
 * Returns a draft/clarification, never a create-order payload or payment state.
 */
export function applyVoiceOrderTurn({businessId,sessionId,catalog,previousDraft=null,turn}={}){
  const bid=Number(businessId),sid=limitedString(sessionId,120);
  if(!int(bid)||!sid)throw fail('VOICE_CONTEXT_REQUIRED','Authenticated Merchant context is required.',403);
  const index=catalogIndex(catalog,bid);
  const previous=reconcilePrior(previousDraft,index,bid,sid);
  if(!turn||!Array.isArray(turn.operations)||turn.operations.length>maxOperations)throw fail('VOICE_TURN_INVALID','Voice interpretation is invalid.',422);
  const work={...previous,lines:previous.lines.map(x=>({...x,modifier_option_ids:[...x.modifier_option_ids]}))};
  let additions=0,addedKey=null;
  try{
    if(turn.operations.some(x=>x?.action==='clear')&&turn.operations.length!==1)throw fail('VOICE_CLEAR_UNCLEAR','Please clear the draft as a separate instruction.');
    for(const op of turn.operations){
      if(!op||typeof op.action!=='string')throw fail('VOICE_ACTION_INVALID','Unrecognized voice instruction.');
      if(op.action==='set_customer'){
        const name=limitedString(op.customer_name,120);
        if(!name||name.length<2)throw fail('CUSTOMER_UNCLEAR','What customer name should I use?');
        work.customer_name=name;
      }else if(op.action==='clear'){
        work.lines=[];work.customer_name='';work.last_added_line_key=null;
      }else if(op.action==='add'){
        const n=Number(op.quantity);
        if(!Number.isInteger(n)||n<1||n>maxQuantity)throw fail('QUANTITY_UNCLEAR','Please say a whole quantity between 1 and 999.');
        const product=resolveProduct(op.product_name,index);
        const item=resolveSelection(product,op);
        const found=work.lines.find(x=>x.line_key===item.line_key);
        if(found){if(found.quantity+n>maxQuantity)throw fail('QUANTITY_LIMIT','Quantity limit exceeded.');found.quantity+=n;}
        else{if(work.lines.length>=maxLines)throw fail('LINE_LIMIT','One order can contain up to 50 different items.');work.lines.push({...item,quantity:n});}
        additions++;addedKey=item.line_key;
      }else if(['set_quantity','decrease','remove'].includes(op.action)){
        const found=matchExistingLine(op,work,index);
        if(!found)throw fail('LINE_UNCLEAR','Choose a product line to change.');
        if(op.action==='remove')work.lines=work.lines.filter(x=>x.line_key!==found.line_key);
        else{
          const n=Number(op.quantity);
          if(!Number.isInteger(n)||n<1||n>maxQuantity)throw fail('QUANTITY_UNCLEAR','Please say a whole quantity between 1 and 999.');
          const revised=op.action==='decrease'?found.quantity-n:n;
          if(revised<0)throw fail('QUANTITY_UNCLEAR','Cannot remove more items than the current quantity.');
          if(revised===0)work.lines=work.lines.filter(x=>x.line_key!==found.line_key);
          else found.quantity=revised;
        }
        work.last_added_line_key=null;
      }else if(op.action==='readback'){
        // Readback never confirms or writes an order.
      }else throw fail('VOICE_ACTION_FORBIDDEN','Voice cannot create orders, charge payments or change stock.');
    }
  }catch(e){
    if(e?.code&&e.status===422)return{draft:buildResult(previous),needs_clarification:true,question:e.message,reason:e.code,can_create:false};
    throw e;
  }
  if(additions===1)work.last_added_line_key=addedKey;
  else if(additions>1)work.last_added_line_key=null;
  return{draft:buildResult(work),needs_clarification:false,question:null,reason:null,can_create:false};
}
function buildResult(work){
  const subtotal=work.lines.reduce((sum,row)=>sum+row.unit_price_centavos*row.quantity,0);
  if(!Number.isSafeInteger(subtotal)||subtotal>999999999)throw fail('ORDER_TOTAL_LIMIT','Order subtotal exceeds the safe draft limit.');
  const draft={...work,lines:work.lines.map(line=>({...line,modifier_option_ids:[...line.modifier_option_ids],line_total_centavos:line.unit_price_centavos*line.quantity})),currency_code:'PHP',subtotal_centavos:subtotal,readback:readback(work),status:'unposted_draft'};
  return draft;
}
/** Serializable payload for later *server-side* quote (never direct creation). */
export function voiceDraftForQuote(draft){
  if(draft?.status!=='unposted_draft'||!Array.isArray(draft.lines)||!draft.lines.length)throw fail('DRAFT_EMPTY','Add at least one product before quoting.',409);
  return{business_id:Number(draft.business_id),customer_name:draft.customer_name||'Walk-in customer',
    items:draft.lines.map(x=>({source_kind:x.source_kind,product_id:x.product_id,quantity:x.quantity,variant_id:x.variant_id,modifier_option_ids:[...x.modifier_option_ids]}))};
}