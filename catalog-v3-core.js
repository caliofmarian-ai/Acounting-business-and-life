const CATALOG_V3_SCHEMA_VERSION='catalog-v3a-2026-10-03';

const clean=(value,max=200)=>String(value??'').trim().slice(0,max);
const isFiniteNumber=value=>Number.isFinite(Number(value));

const categories=[
  {code:'prepared_food',parent_code:null,label:'Prepared food',domain_hint:'food',sort_order:10},
  {code:'fresh_food',parent_code:null,label:'Fresh food',domain_hint:'food',sort_order:20},
  {code:'packaged_food_drink',parent_code:null,label:'Packaged food & drink',domain_hint:'food',sort_order:30},
  {code:'clothing_fashion',parent_code:null,label:'Clothing & fashion',domain_hint:'non_food',sort_order:100},
  {code:'footwear',parent_code:'clothing_fashion',label:'Footwear',domain_hint:'non_food',sort_order:110},
  {code:'beauty_cosmetics',parent_code:null,label:'Beauty & cosmetics',domain_hint:'non_food',sort_order:120},
  {code:'mobile_phone',parent_code:null,label:'Mobile phones',domain_hint:'non_food',sort_order:130},
  {code:'consumer_electronics',parent_code:null,label:'Consumer electronics',domain_hint:'non_food',sort_order:140},
  {code:'furniture_home',parent_code:null,label:'Furniture & home',domain_hint:'non_food',sort_order:150},
  {code:'hardware_tools',parent_code:null,label:'Hardware & tools',domain_hint:'non_food',sort_order:160},
  {code:'construction_material',parent_code:null,label:'Construction materials',domain_hint:'non_food',sort_order:170},
  {code:'automotive_part',parent_code:null,label:'Automotive parts',domain_hint:'non_food',sort_order:180},
  {code:'books_stationery',parent_code:null,label:'Books & stationery',domain_hint:'non_food',sort_order:190},
  {code:'jewellery_accessories',parent_code:null,label:'Jewellery & accessories',domain_hint:'non_food',sort_order:200},
  {code:'general_retail',parent_code:null,label:'General retail',domain_hint:'non_food',sort_order:900}
];

const attributes=[
  {code:'color',label:'Colour',value_type:'text',unit_family:'',allowed_values:[],public_visible:true},
  {code:'size',label:'Size',value_type:'text',unit_family:'',allowed_values:[],public_visible:true},
  {code:'material',label:'Material',value_type:'text',unit_family:'',allowed_values:[],public_visible:true},
  {code:'fit',label:'Fit',value_type:'text',unit_family:'',allowed_values:[],public_visible:true},
  {code:'target_audience',label:'Target audience',value_type:'select',unit_family:'',allowed_values:['men','women','unisex','kids','baby'],public_visible:true},
  {code:'storage_capacity',label:'Storage capacity',value_type:'text',unit_family:'',allowed_values:[],public_visible:true},
  {code:'ram',label:'RAM',value_type:'text',unit_family:'',allowed_values:[],public_visible:true},
  {code:'screen_size_in',label:'Screen size',value_type:'number',unit_family:'inch',allowed_values:[],public_visible:true},
  {code:'warranty_months',label:'Warranty',value_type:'number',unit_family:'month',allowed_values:[],public_visible:true},
  {code:'length_cm',label:'Length',value_type:'number',unit_family:'cm',allowed_values:[],public_visible:true},
  {code:'width_cm',label:'Width',value_type:'number',unit_family:'cm',allowed_values:[],public_visible:true},
  {code:'height_cm',label:'Height',value_type:'number',unit_family:'cm',allowed_values:[],public_visible:true},
  {code:'weight_kg',label:'Weight',value_type:'number',unit_family:'kg',allowed_values:[],public_visible:true},
  {code:'diameter_mm',label:'Diameter',value_type:'number',unit_family:'mm',allowed_values:[],public_visible:true},
  {code:'gauge',label:'Gauge',value_type:'text',unit_family:'',allowed_values:[],public_visible:true},
  {code:'length_m',label:'Length',value_type:'number',unit_family:'m',allowed_values:[],public_visible:true},
  {code:'shade',label:'Shade',value_type:'text',unit_family:'',allowed_values:[],public_visible:true},
  {code:'volume_ml',label:'Volume',value_type:'number',unit_family:'ml',allowed_values:[],public_visible:true},
  {code:'assembly_required',label:'Assembly required',value_type:'boolean',unit_family:'',allowed_values:[],public_visible:true},
  {code:'vehicle_compatibility',label:'Vehicle compatibility',value_type:'text',unit_family:'',allowed_values:[],public_visible:true},
  {code:'isbn',label:'ISBN',value_type:'text',unit_family:'',allowed_values:[],public_visible:true},
  {code:'publisher',label:'Publisher',value_type:'text',unit_family:'',allowed_values:[],public_visible:true},
  {code:'customizable',label:'Customizable',value_type:'boolean',unit_family:'',allowed_values:[],public_visible:true}
];

const categoryAttributes=[
  ['clothing_fashion','color',false,true,10],['clothing_fashion','size',false,true,20],['clothing_fashion','material',false,false,30],['clothing_fashion','fit',false,false,40],['clothing_fashion','target_audience',false,false,50],
  ['footwear','color',false,true,10],['footwear','size',true,true,20],['footwear','material',false,false,30],['footwear','target_audience',false,false,40],
  ['beauty_cosmetics','shade',false,true,10],['beauty_cosmetics','volume_ml',false,true,20],['beauty_cosmetics','color',false,true,30],
  ['mobile_phone','color',false,true,10],['mobile_phone','storage_capacity',false,true,20],['mobile_phone','ram',false,false,30],['mobile_phone','screen_size_in',false,false,40],['mobile_phone','warranty_months',false,false,50],
  ['consumer_electronics','color',false,true,10],['consumer_electronics','warranty_months',false,false,20],['consumer_electronics','weight_kg',false,false,30],
  ['furniture_home','material',false,false,10],['furniture_home','color',false,true,20],['furniture_home','length_cm',false,false,30],['furniture_home','width_cm',false,false,40],['furniture_home','height_cm',false,false,50],['furniture_home','weight_kg',false,false,60],['furniture_home','assembly_required',false,false,70],
  ['hardware_tools','material',false,false,10],['hardware_tools','size',false,true,20],['hardware_tools','length_m',false,true,30],['hardware_tools','diameter_mm',false,true,40],['hardware_tools','gauge',false,true,50],
  ['construction_material','material',false,false,10],['construction_material','length_m',false,true,20],['construction_material','width_cm',false,true,30],['construction_material','height_cm',false,true,40],['construction_material','diameter_mm',false,true,50],['construction_material','gauge',false,true,60],
  ['automotive_part','vehicle_compatibility',false,false,10],
  ['books_stationery','isbn',false,false,10],['books_stationery','publisher',false,false,20],['books_stationery','size',false,true,30],
  ['jewellery_accessories','material',false,false,10],['jewellery_accessories','color',false,true,20],['jewellery_accessories','size',false,true,30],['jewellery_accessories','weight_kg',false,false,40],['jewellery_accessories','customizable',false,false,50],
  ['general_retail','color',false,true,10],['general_retail','size',false,true,20],['general_retail','material',false,false,30],['general_retail','weight_kg',false,false,40]
].map(([category_code,attribute_code,required,variant_axis,sort_order])=>({category_code,attribute_code,required,variant_axis,sort_order}));

const categoryByCode=new Map(categories.map(x=>[x.code,x]));
const attributeByCode=new Map(attributes.map(x=>[x.code,x]));
const mappingsByCategory=new Map();
for(const mapping of categoryAttributes){
  const list=mappingsByCategory.get(mapping.category_code)||[];
  list.push(mapping);mappingsByCategory.set(mapping.category_code,list);
}

export { CATALOG_V3_SCHEMA_VERSION };
export const CATALOG_CATEGORIES=Object.freeze(categories.map(x=>Object.freeze({...x})));
export const CATALOG_ATTRIBUTE_DEFINITIONS=Object.freeze(attributes.map(x=>Object.freeze({...x,allowed_values:Object.freeze([...x.allowed_values])})));
export const CATALOG_CATEGORY_ATTRIBUTES=Object.freeze(categoryAttributes.map(x=>Object.freeze({...x})));

export function catalogCategory(code){
  const row=categoryByCode.get(clean(code,80));
  return row?{...row}:null;
}

export function catalogCategoryAttributes(code){
  return (mappingsByCategory.get(clean(code,80))||[])
    .slice().sort((a,b)=>a.sort_order-b.sort_order)
    .map(mapping=>({
      ...mapping,
      definition:{...attributeByCode.get(mapping.attribute_code),allowed_values:[...(attributeByCode.get(mapping.attribute_code)?.allowed_values||[])]}
    }));
}

export function catalogEditorSchema(domain=''){
  const requested=clean(domain,20);
  const allowed=requested==='food'||requested==='non_food'?requested:'';
  return{
    version:CATALOG_V3_SCHEMA_VERSION,
    categories:categories.filter(x=>!allowed||x.domain_hint===allowed).map(category=>({
      ...category,
      attributes:catalogCategoryAttributes(category.code)
    }))
  };
}

export function normalizeCatalogIdentity(input={},context={}){
  const domain=clean(context.domain||input.product_domain,20);
  const categoryCode=clean(input.catalog_category_code,80);
  if(categoryCode){
    const category=categoryByCode.get(categoryCode);
    if(!category)throw new TypeError('Choose a supported product category.');
    if(domain&&['food','non_food'].includes(domain)&&category.domain_hint!==domain){
      throw new TypeError('Product category does not match the selected Food/Non-food domain.');
    }
  }
  const conditionCode=clean(input.condition_code,24).toLowerCase();
  if(conditionCode&&!['new','used','refurbished','other'].includes(conditionCode)){
    throw new TypeError('Condition must be New, Used, Refurbished or Other.');
  }
  return{
    catalog_category_code:categoryCode||null,
    brand:clean(input.brand,120),
    model:clean(input.model,120),
    condition_code:conditionCode,
    manufacturer_part_number:clean(input.manufacturer_part_number,120),
    catalog_schema_version:CATALOG_V3_SCHEMA_VERSION
  };
}

function normalizeBoolean(value,label){
  if(value===true||value===false)return value;
  if(value==='true')return true;
  if(value==='false')return false;
  throw new TypeError(`${label} must be true or false.`);
}

export function normalizeCatalogAttributes(categoryCode,rawAttributes={}){
  const category=categoryByCode.get(clean(categoryCode,80));
  if(!category){
    if(rawAttributes&&Object.keys(rawAttributes).length)throw new TypeError('Choose a product category before adding category details.');
    return{};
  }
  const mappings=catalogCategoryAttributes(category.code);
  const allowed=new Map(mappings.map(x=>[x.attribute_code,x]));
  const raw=rawAttributes&&typeof rawAttributes==='object'&&!Array.isArray(rawAttributes)?rawAttributes:{};
  const normalized={};
  for(const [code,value] of Object.entries(raw)){
    const mapping=allowed.get(clean(code,80));
    if(!mapping)throw new TypeError(`${code} is not a supported attribute for ${category.label}.`);
    const def=mapping.definition;
    if(value==null||value==='')continue;
    if(def.value_type==='number'){
      if(!isFiniteNumber(value)||Number(value)<0)throw new TypeError(`${def.label} must be a valid zero-or-greater number.`);
      normalized[code]=Number(value);
    }else if(def.value_type==='boolean'){
      normalized[code]=normalizeBoolean(value,def.label);
    }else if(def.value_type==='select'){
      const v=clean(value,120).toLowerCase();
      if(!def.allowed_values.includes(v))throw new TypeError(`${def.label} has an unsupported value.`);
      normalized[code]=v;
    }else{
      normalized[code]=clean(value,300);
    }
  }
  for(const mapping of mappings){
    if(mapping.required&&!Object.prototype.hasOwnProperty.call(normalized,mapping.attribute_code)){
      throw new TypeError(`${mapping.definition.label} is required for ${category.label}.`);
    }
  }
  return normalized;
}

export async function ensureCatalogV3Schema(db){
  await db.query(`
    CREATE TABLE IF NOT EXISTS catalog_categories (
      code TEXT PRIMARY KEY,
      parent_code TEXT REFERENCES catalog_categories(code) ON DELETE SET NULL,
      label TEXT NOT NULL,
      domain_hint TEXT NOT NULL CHECK(domain_hint IN ('food','non_food')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS catalog_attribute_definitions (
      code TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      value_type TEXT NOT NULL CHECK(value_type IN ('text','number','boolean','select','multiselect')),
      unit_family TEXT NOT NULL DEFAULT '',
      allowed_values_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      public_visible BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS catalog_category_attributes (
      category_code TEXT NOT NULL REFERENCES catalog_categories(code) ON DELETE CASCADE,
      attribute_code TEXT NOT NULL REFERENCES catalog_attribute_definitions(code) ON DELETE CASCADE,
      required BOOLEAN NOT NULL DEFAULT FALSE,
      variant_axis BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(category_code,attribute_code)
    );

    ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS catalog_category_code TEXT REFERENCES catalog_categories(code) ON DELETE SET NULL;
    ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS brand TEXT NOT NULL DEFAULT '';
    ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS model TEXT NOT NULL DEFAULT '';
    ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS condition_code TEXT NOT NULL DEFAULT '';
    ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS manufacturer_part_number TEXT NOT NULL DEFAULT '';
    ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS catalog_schema_version TEXT NOT NULL DEFAULT '';

    CREATE INDEX IF NOT EXISTS marketplace_products_catalog_category_idx
      ON marketplace_products(business_id,catalog_category_code,published,active);
    CREATE INDEX IF NOT EXISTS marketplace_products_identity_idx
      ON marketplace_products(business_id,brand,model);

    CREATE TABLE IF NOT EXISTS catalog_product_attribute_values (
      product_id BIGINT NOT NULL REFERENCES marketplace_products(id) ON DELETE CASCADE,
      attribute_code TEXT NOT NULL REFERENCES catalog_attribute_definitions(code) ON DELETE CASCADE,
      value_json JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(product_id,attribute_code)
    );
  `);

  await db.query(`
    INSERT INTO catalog_categories(code,parent_code,label,domain_hint,sort_order,active)
    SELECT x.code,NULLIF(x.parent_code,''),x.label,x.domain_hint,x.sort_order,TRUE
      FROM jsonb_to_recordset($1::jsonb)
      AS x(code TEXT,parent_code TEXT,label TEXT,domain_hint TEXT,sort_order INTEGER)
    ON CONFLICT(code) DO UPDATE SET
      parent_code=EXCLUDED.parent_code,label=EXCLUDED.label,domain_hint=EXCLUDED.domain_hint,
      sort_order=EXCLUDED.sort_order,active=TRUE,updated_at=NOW()
  `,[JSON.stringify(categories.map(x=>({...x,parent_code:x.parent_code||''})))]);

  await db.query(`
    INSERT INTO catalog_attribute_definitions(code,label,value_type,unit_family,allowed_values_json,public_visible)
    SELECT x.code,x.label,x.value_type,x.unit_family,COALESCE(x.allowed_values,'[]'::jsonb),x.public_visible
      FROM jsonb_to_recordset($1::jsonb)
      AS x(code TEXT,label TEXT,value_type TEXT,unit_family TEXT,allowed_values JSONB,public_visible BOOLEAN)
    ON CONFLICT(code) DO UPDATE SET
      label=EXCLUDED.label,value_type=EXCLUDED.value_type,unit_family=EXCLUDED.unit_family,
      allowed_values_json=EXCLUDED.allowed_values_json,public_visible=EXCLUDED.public_visible,updated_at=NOW()
  `,[JSON.stringify(attributes)]);

  await db.query(`
    INSERT INTO catalog_category_attributes(category_code,attribute_code,required,variant_axis,sort_order)
    SELECT x.category_code,x.attribute_code,x.required,x.variant_axis,x.sort_order
      FROM jsonb_to_recordset($1::jsonb)
      AS x(category_code TEXT,attribute_code TEXT,required BOOLEAN,variant_axis BOOLEAN,sort_order INTEGER)
    ON CONFLICT(category_code,attribute_code) DO UPDATE SET
      required=EXCLUDED.required,variant_axis=EXCLUDED.variant_axis,sort_order=EXCLUDED.sort_order
  `,[JSON.stringify(categoryAttributes)]);
}

export async function replaceCatalogProductAttributes(db,{productId,categoryCode,attributes:rawAttributes}={}){
  const id=Number(productId);
  if(!Number.isInteger(id)||id<1)throw new TypeError('A valid product is required.');
  const normalized=normalizeCatalogAttributes(categoryCode,rawAttributes);
  await db.query('DELETE FROM catalog_product_attribute_values WHERE product_id=$1',[id]);
  for(const [attributeCode,value] of Object.entries(normalized)){
    await db.query(`
      INSERT INTO catalog_product_attribute_values(product_id,attribute_code,value_json)
      VALUES($1,$2,$3::jsonb)
      ON CONFLICT(product_id,attribute_code) DO UPDATE SET value_json=EXCLUDED.value_json,updated_at=NOW()
    `,[id,attributeCode,JSON.stringify(value)]);
  }
  return normalized;
}

export async function readCatalogProductAttributes(db,productId){
  const id=Number(productId);
  if(!Number.isInteger(id)||id<1)return{};
  const {rows}=await db.query(`
    SELECT attribute_code,value_json
      FROM catalog_product_attribute_values
     WHERE product_id=$1
     ORDER BY attribute_code
  `,[id]);
  return Object.fromEntries(rows.map(row=>[row.attribute_code,row.value_json]));
}
