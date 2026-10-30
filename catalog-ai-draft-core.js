// Internal-only, inert model suggestion envelope. No network, database or publication.
import {catalogCategory,catalogCategoryAttributes} from './catalog-v3-core.js';
export const AI_CATALOG_DRAFT_SCHEMA='ai-catalog-review-v1-2026-10-27';
export const AI_CATALOG_MODES=Object.freeze(['merchant_prepared_food','merchant_fresh_food','merchant_packaged_food','merchant_non_food','supplier_catalog']);
const FOOD=Object.freeze({merchant_prepared_food:'prepared_food',merchant_fresh_food:'fresh_food',merchant_packaged_food:'packaged_food_drink'});
const WITHHELD=Object.freeze(['price','selling_price','stock','stock_quantity','inventory_id','product_id','business_id','account_id','payout_destination','expiry','expiry_date','certification','legal_claims','warranty','allergens','ingredient_quantities','recipe_cost','serving_quantity','published','visibility','publication_status']);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const clean=(v,n)=>typeof v==='string'?v.replace(/[<>\u0000-\u001f\u007f\u061c\u200b\u200e-\u200f\u202a-\u202e\u2060\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim().slice(0,n):'';
// Model JSON can inherit polluted Object.prototype properties. Only fields
// actually present on the supplied JSON object may become unverified hints.
const own=(v,name)=>Object.hasOwn(v,name)?v[name]:undefined;
// Measure actual enumerable JSON; inherited or model-owned toJSON serializers
// must never conceal oversized untrusted suggestions from the 32 KiB gate.
function snapshotJsonData(value){
  // Count serialized JSON bytes during traversal. Serializing the whole copied
  // tree at the end can allocate far more than the stated 32 KiB input limit.
  const visited=new WeakSet();
  const MAX_BYTES=32768;
  let bytes=0;
  const charge=fragment=>{
    bytes+=Buffer.byteLength(fragment,'utf8');
    if(bytes>MAX_BYTES)throw new RangeError('AI suggestion exceeds the 32 KiB limit.');
  };
  const chargePrimitive=value=>{
    // JSON UTF-8 needs at least one byte per UTF-16 code unit. Fail fast
    // before escaping a giant string into a giant temporary allocation.
    if(typeof value==='string'&&value.length>MAX_BYTES)
      throw new RangeError('AI suggestion exceeds the 32 KiB limit.');
    charge(JSON.stringify(value));
  };
  function copyJsonData(raw,depth){
    if(depth>64)throw new TypeError('AI catalog JSON is too deeply nested.');
    if(raw===null||typeof raw==='string'||typeof raw==='boolean'){
      chargePrimitive(raw);
      return raw;
    }
    if(typeof raw==='number'&&Number.isFinite(raw)){
      chargePrimitive(raw);
      return raw;
    }
    const array=Array.isArray(raw);
    if(!array&&!plain(raw))throw new TypeError('AI catalog JSON contains a non-JSON value.');
    if(visited.has(raw))throw new TypeError('AI catalog JSON cannot reuse an object reference.');
    visited.add(raw);
    let out;
    if(array){
      if(raw.length>MAX_BYTES)throw new RangeError('AI suggestion exceeds the 32 KiB limit.');
      if(Reflect.ownKeys(raw).length!==raw.length+1)
        throw new TypeError('Invalid AI catalog array.');
      out=[];
      Object.setPrototypeOf(out,null);
      charge('[');
      for(let i=0;i<raw.length;i++){
        const field=Object.getOwnPropertyDescriptor(raw,String(i));
        if(!field||!Object.hasOwn(field,'value'))throw new TypeError('Invalid AI catalog array.');
        if(i>0)charge(',');
        out[i]=copyJsonData(field.value,depth+1);
      }
      charge(']');
    }else{
      const keys=Object.keys(raw);
      if(keys.length>MAX_BYTES)throw new RangeError('AI suggestion exceeds the 32 KiB limit.');
      if(Reflect.ownKeys(raw).length!==keys.length)
        throw new TypeError('Invalid AI catalog object.');
      // Validate every own descriptor before traversing values. A malformed
      // own serializer after an enormous early string must stay a JSON-shape
      // error (and must never be invoked), not be obscured by the byte cap.
      const fields=keys.map(key=>{
        const field=Object.getOwnPropertyDescriptor(raw,key);
        if(!field||!Object.hasOwn(field,'value')||
          field.value===undefined||typeof field.value==='function'||
          typeof field.value==='symbol'||typeof field.value==='bigint')
          throw new TypeError('Invalid AI catalog field.');
        return field.value;
      });
      out=Object.create(null);
      charge('{');
      for(let i=0;i<keys.length;i++){
        const key=keys[i];
        if(i>0)charge(',');
        chargePrimitive(key);
        charge(':');
        out[key]=copyJsonData(fields[i],depth+1);
      }
      charge('}');
    }
    return out;
  }
  const data=copyJsonData(value,0);
  return {bytes,data};
}
function unique(v,max=12,len=40){
  if(!Array.isArray(v))return [];
  const out=[],seen=new Set();
  // Preflight snapshots use null-prototype arrays to avoid inherited toJSON.
  for(let i=0;i<Math.min(v.length,60);i++){const raw=v[i];
    const value=clean(raw,len),key=value.toLocaleLowerCase('en');
    if(!value||seen.has(key))continue;
    seen.add(key);out.push(value);if(out.length===max)break;
  }
  return out;
}
function categoryFor(mode,raw){
  // A missing suggestion can be completed by the human reviewer. A supplied,
  // incompatible category must fail closed instead of looking like a valid draft.
  if(raw===undefined)return null;
  if(typeof raw!=='string'||!raw.trim()||raw.length>80)
    throw new TypeError('Invalid AI catalog category.');
  if(mode==='supplier_catalog')
    throw new TypeError('Supplier catalog does not accept Merchant category codes.');
  // Category codes are identifiers, not display strings. Never sanitize a
  // malformed model hint into a trusted taxonomy key (for example <fresh_food>).
  const suggestion=clean(raw,80);
  if(suggestion!==raw||!/^[a-z][a-z0-9_]*$/.test(raw))
    throw new TypeError('Invalid AI catalog category.');
  if(FOOD[mode]){
    if(suggestion!==FOOD[mode])throw new TypeError('AI category does not match intake mode.');
    return suggestion;
  }
  const category=catalogCategory(suggestion);
  if(category?.domain_hint!=='non_food')throw new TypeError('AI category does not match intake mode.');
  return category.code;
}
function attributeHints(category,raw){
  if(!category||!plain(raw))return [];
  // Preserve V3's attribute type: untrusted model JSON often uses real
  // numbers and booleans instead of preformatted strings. They remain
  // display-only hints, never normalized Catalog write values or approvals.
  const allowed=new Map(catalogCategoryAttributes(category)
    .map(x=>[x.attribute_code,x.definition]));
  const out=[];
  for(const key of Object.keys(raw).slice(0,40)){
    if(!allowed.has(key)||key==='warranty_months')continue;
    const definition=allowed.get(key),type=definition?.value_type,hint=raw[key];
    let candidate=hint;
    if(typeof hint==='number'){
      if(type!=='number'||!Number.isFinite(hint)||hint<0)continue;
      candidate=String(hint);
    }else if(typeof hint==='boolean'){
      if(type!=='boolean')continue;
      candidate=String(hint);
    }else if(type==='number'||type==='boolean'){
      // Canonical V3 accepts finite, nonnegative numbers and only literal
      // true/false. Unverified hints must not display invalid typed values.
      if(typeof hint!=='string')continue;
      const trimmed=hint.trim();
      if(!trimmed||trimmed.length>120||clean(trimmed,120)!==trimmed)continue;
      if(type==='number'){
        const parsed=Number(trimmed);
        if(!Number.isFinite(parsed)||parsed<0)continue;
        candidate=String(parsed);
      }else{
        if(trimmed!=='true'&&trimmed!=='false')continue;
        candidate=trimmed;
      }
    }else if(type==='select'){
      // Select hints must match V3 canonical choices, not just an allowed key.
      // Never sanitize malformed model codes (e.g. <kids>) into trusted values.
      if(typeof hint!=='string')continue;
      const trimmed=hint.trim();
      if(!trimmed||trimmed.length>120||clean(trimmed,120)!==trimmed)continue;
      const choice=trimmed.toLocaleLowerCase('en');
      if(!definition.allowed_values?.includes(choice))continue;
      candidate=choice;
    }
    const value=clean(candidate,120);
    if(value)out.push({code:key,value,authority:'UNVERIFIED_MODEL_SUGGESTION'});
    if(out.length===20)break;
  }
  return out;
}
/** Never treat this object as a canonical write payload. Actual saving and
 * publishing require existing authenticated business scope, manual confirmation
 * and the Universal Catalog/Recipe/Supplier editors and validation. */
export function normalizeAiCatalogDraft({mode,modelOutput}={}){
  if(!AI_CATALOG_MODES.includes(mode))throw new TypeError('Choose a supported AI catalog intake mode.');
  if(!plain(modelOutput))throw new TypeError('AI suggestions must be a JSON object.');
  let snapshot;
  try{snapshot=snapshotJsonData(modelOutput);}
  catch(error){
    if(error instanceof RangeError&&error.message==='AI suggestion exceeds the 32 KiB limit.')throw error;
    throw new TypeError('Invalid AI catalog JSON.');
  }
  if(snapshot.bytes>32768)throw new RangeError('AI suggestion exceeds the 32 KiB limit.');
  const data=snapshot.data;
  const category=categoryFor(mode,own(data,'catalog_category_code'));
  const hints={
    name:clean(own(data,'name')||own(data,'title'),120),
    description:clean(own(data,'description'),600),
    catalog_category_code:category,
    supplier_category_text:mode==='supplier_catalog'?clean(own(data,'category'),80):'',
    tags:unique(own(data,'tags')),
    brand:clean(own(data,'brand'),120),
    pack_name:mode==='supplier_catalog'?clean(own(data,'pack_name'),100):'',
    base_unit:mode==='supplier_catalog'?clean(own(data,'base_unit'),24):'',
    sku:clean(own(data,'sku'),80),
    barcode:clean(own(data,'barcode'),80),
    variant_attributes:attributeHints(category,own(data,'variant_attributes'))
  };
  const rawIngredients=own(data,'ingredients');
  const ingredient_names=[];
  if(mode==='merchant_prepared_food'&&Array.isArray(rawIngredients)){
    const names=[];
    for(let i=0;i<Math.min(rawIngredients.length,60);i++){
      const item=rawIngredients[i];
      names.push(typeof item==='string'?item:(plain(item)?own(item,'name'):''));
    }
    ingredient_names.push(...unique(names,30,100));
  }
  const required_review=['identity_description','category_attributes','price_and_stock_in_canonical_editor'];
  if(mode==='merchant_prepared_food')required_review.push('ingredient_quantities_in_canonical_recipe_editor');
  if(mode==='merchant_packaged_food')required_review.push('packaging_expiry_allergens_labels');
  if(mode==='supplier_catalog')required_review.push('pack_conversions_business_links');
  return {schema:AI_CATALOG_DRAFT_SCHEMA,mode,state:'REVIEW_REQUIRED',draft_only:true,
    publishable:false,canonical_write_payload:false,model_authority:'UNVERIFIED',
    hints,ingredient_names,withheld_fields:[...WITHHELD],required_review};
}
