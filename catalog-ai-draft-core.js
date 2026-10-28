// Internal-only, inert model suggestion envelope. No network, database or publication.
import {catalogCategory,catalogCategoryAttributes} from './catalog-v3-core.js';
export const AI_CATALOG_DRAFT_SCHEMA='ai-catalog-review-v1-2026-10-27';
export const AI_CATALOG_MODES=Object.freeze(['merchant_prepared_food','merchant_fresh_food','merchant_packaged_food','merchant_non_food','supplier_catalog']);
const FOOD=Object.freeze({merchant_prepared_food:'prepared_food',merchant_fresh_food:'fresh_food',merchant_packaged_food:'packaged_food_drink'});
const WITHHELD=Object.freeze(['price','selling_price','stock','stock_quantity','inventory_id','product_id','business_id','account_id','payout_destination','expiry','expiry_date','certification','legal_claims','warranty','allergens','ingredient_quantities','recipe_cost','serving_quantity','published','visibility','publication_status']);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const clean=(v,n)=>typeof v==='string'?v.replace(/[<>\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n):'';
// Model JSON can inherit polluted Object.prototype properties. Only fields
// actually present on the supplied JSON object may become unverified hints.
const own=(v,name)=>Object.hasOwn(v,name)?v[name]:undefined;
function unique(v,max=12,len=40){
  if(!Array.isArray(v))return [];
  const out=[],seen=new Set();
  for(const raw of v.slice(0,60)){
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
  const allowed=new Set(catalogCategoryAttributes(category).map(x=>x.attribute_code));
  const out=[];
  for(const key of Object.keys(raw).slice(0,40)){
    if(!allowed.has(key)||key==='warranty_months')continue;
    const value=clean(raw[key],120);
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
  let size;
  try{size=Buffer.byteLength(JSON.stringify(modelOutput),'utf8');}
  catch{throw new TypeError('Invalid AI catalog JSON.');}
  if(size>32768)throw new RangeError('AI suggestion exceeds the 32 KiB limit.');
  const category=categoryFor(mode,own(modelOutput,'catalog_category_code'));
  const hints={
    name:clean(own(modelOutput,'name')||own(modelOutput,'title'),120),
    description:clean(own(modelOutput,'description'),600),
    catalog_category_code:category,
    supplier_category_text:mode==='supplier_catalog'?clean(own(modelOutput,'category'),80):'',
    tags:unique(own(modelOutput,'tags')),
    brand:clean(own(modelOutput,'brand'),120),
    pack_name:mode==='supplier_catalog'?clean(own(modelOutput,'pack_name'),100):'',
    base_unit:mode==='supplier_catalog'?clean(own(modelOutput,'base_unit'),24):'',
    sku:clean(own(modelOutput,'sku'),80),
    barcode:clean(own(modelOutput,'barcode'),80),
    variant_attributes:attributeHints(category,own(modelOutput,'variant_attributes'))
  };
  const ingredient_names=mode==='merchant_prepared_food'
    ?unique((Array.isArray(own(modelOutput,'ingredients'))?own(modelOutput,'ingredients'):[]).map(x=>typeof x==='string'?x:(plain(x)?own(x,'name'):'')),30,100)
    :[];
  const required_review=['identity_description','category_attributes','price_and_stock_in_canonical_editor'];
  if(mode==='merchant_prepared_food')required_review.push('ingredient_quantities_in_canonical_recipe_editor');
  if(mode==='merchant_packaged_food')required_review.push('packaging_expiry_allergens_labels');
  if(mode==='supplier_catalog')required_review.push('pack_conversions_business_links');
  return {schema:AI_CATALOG_DRAFT_SCHEMA,mode,state:'REVIEW_REQUIRED',draft_only:true,
    publishable:false,canonical_write_payload:false,model_authority:'UNVERIFIED',
    hints,ingredient_names,withheld_fields:[...WITHHELD],required_review};
}
