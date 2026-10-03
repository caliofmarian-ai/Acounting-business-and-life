export const FOOD_ALLERGENS=Object.freeze([
  {code:'wheat',label:'Wheat / gluten cereals'},
  {code:'rye',label:'Rye / gluten cereals'},
  {code:'barley',label:'Barley / gluten cereals'},
  {code:'crustaceans',label:'Crustaceans'},
  {code:'egg',label:'Egg'},
  {code:'fish',label:'Fish'},
  {code:'peanut',label:'Peanut'},
  {code:'soy',label:'Soybean'},
  {code:'milk',label:'Milk'},
  {code:'sesame',label:'Sesame'},
  {code:'almond',label:'Almond'},
  {code:'cashew',label:'Cashew'},
  {code:'hazelnut',label:'Hazelnut'},
  {code:'pecan',label:'Pecan'},
  {code:'pistachio',label:'Pistachio'},
  {code:'walnut',label:'Walnut'},
  {code:'other_tree_nut',label:'Other tree nut'},
  {code:'sulphites',label:'Sulphites'}
]);
export const FOOD_ALLERGEN_CODES=Object.freeze(FOOD_ALLERGENS.map(x=>x.code));
const CODE_SET=new Set(FOOD_ALLERGEN_CODES);
const LABELS=new Map(FOOD_ALLERGENS.map(x=>[x.code,x.label]));
const clean=(v,max=500)=>String(v??'').trim().slice(0,max);

export function normalizeAllergenCodes(values=[]){
  const input=Array.isArray(values)?values:[];
  return [...new Set(input.map(v=>clean(v,40)).filter(v=>CODE_SET.has(v)))].sort();
}
export function allergenLabels(codes=[]){
  return normalizeAllergenCodes(codes).map(code=>({code,label:LABELS.get(code)||code}));
}
export function deriveAllergenEvidence({ingredientEvidence=[],crossContact=[]}={}){
  const contains=new Set(),may=new Set();
  for(const row of Array.isArray(ingredientEvidence)?ingredientEvidence:[]){
    const code=clean(row?.allergen_code,40);
    if(!CODE_SET.has(code))continue;
    if(row?.evidence_kind==='contains')contains.add(code);
    else if(row?.evidence_kind==='may_contain')may.add(code);
  }
  for(const code of contains)may.delete(code);
  const cross=new Set(normalizeAllergenCodes(crossContact));
  for(const code of contains)cross.delete(code);
  return{
    contains:[...contains].sort(),
    may_contain:[...may].sort(),
    cross_contact:[...cross].sort()
  };
}
export function allergenPublicProjection(summary={}){
  const derived=deriveAllergenEvidence({
    ingredientEvidence:[
      ...(summary.contains||[]).map(allergen_code=>({allergen_code,evidence_kind:'contains'})),
      ...(summary.may_contain||[]).map(allergen_code=>({allergen_code,evidence_kind:'may_contain'}))
    ],
    crossContact:summary.cross_contact||[]
  });
  return{
    contains:allergenLabels(derived.contains),
    may_contain:allergenLabels(derived.may_contain),
    cross_contact:allergenLabels(derived.cross_contact),
    declaration_basis:'merchant_declared_ingredient_and_kitchen_evidence',
    notice:'Allergen information is based on Merchant-declared ingredient and kitchen evidence. If you have a food allergy, contact the Merchant before ordering.'
  };
}

export async function ensureFoodAllergenSchema(pool){
  await pool.query(`
    ALTER TABLE products ADD COLUMN IF NOT EXISTS allergen_revision INTEGER NOT NULL DEFAULT 1;

    CREATE TABLE IF NOT EXISTS inventory_allergen_evidence (
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      inventory_id BIGINT NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
      allergen_code TEXT NOT NULL,
      evidence_kind TEXT NOT NULL CHECK(evidence_kind IN ('contains','may_contain')),
      note TEXT NOT NULL DEFAULT '',
      updated_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(inventory_id,allergen_code,evidence_kind)
    );
    CREATE INDEX IF NOT EXISTS inventory_allergen_evidence_business_idx
      ON inventory_allergen_evidence(business_id,inventory_id);

    CREATE TABLE IF NOT EXISTS product_cross_contact_allergens (
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      allergen_code TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      updated_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(product_id,allergen_code)
    );
    CREATE INDEX IF NOT EXISTS product_cross_contact_business_idx
      ON product_cross_contact_allergens(business_id,product_id);

    CREATE TABLE IF NOT EXISTS product_allergen_reviews (
      product_id BIGINT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      reviewed_revision INTEGER NOT NULL,
      reviewed_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      review_note TEXT NOT NULL DEFAULT '',
      reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function deriveProductAllergenSummary(db,{businessId,productId}={}){
  const bid=Number(businessId),pid=Number(productId);
  const product=await db.query(`SELECT id,business_id,allergen_revision FROM products WHERE id=$1 AND business_id=$2`,[pid,bid]);
  if(!product.rowCount)return null;
  const [ingredient,cross,review]=await Promise.all([
    db.query(`
      SELECT DISTINCT e.allergen_code,e.evidence_kind
        FROM recipes r
        JOIN inventory_allergen_evidence e
          ON e.inventory_id=r.inventory_id AND e.business_id=$2
       WHERE r.product_id=$1
       ORDER BY e.allergen_code,e.evidence_kind
    `,[pid,bid]),
    db.query(`
      SELECT allergen_code,note FROM product_cross_contact_allergens
       WHERE product_id=$1 AND business_id=$2 ORDER BY allergen_code
    `,[pid,bid]),
    db.query(`SELECT * FROM product_allergen_reviews WHERE product_id=$1 AND business_id=$2`,[pid,bid])
  ]);
  const derived=deriveAllergenEvidence({
    ingredientEvidence:ingredient.rows,
    crossContact:cross.rows.map(x=>x.allergen_code)
  });
  const revision=Number(product.rows[0].allergen_revision||1);
  const r=review.rows[0]||null;
  return{
    product_id:pid,
    revision,
    ...derived,
    review_current:Boolean(r&&Number(r.reviewed_revision)===revision),
    reviewed_revision:r?Number(r.reviewed_revision):null,
    reviewed_at:r?.reviewed_at||null,
    review_note:r?.review_note||'',
    public:allergenPublicProjection(derived)
  };
}

export async function invalidateProductAllergenReview(db,{businessId,productId}={}){
  const bid=Number(businessId),pid=Number(productId);
  await db.query(`UPDATE products SET allergen_revision=allergen_revision+1,updated_at=NOW() WHERE id=$1 AND business_id=$2`,[pid,bid]);
  try{
    await db.query(`UPDATE marketplace_products SET published=FALSE,updated_at=NOW() WHERE business_id=$1 AND legacy_product_id=$2 AND product_kind='prepared_food' AND published=TRUE`,[bid,pid]);
  }catch(error){
    if(String(error?.code||'')!=='42P01')throw error;
  }
}

export async function invalidateAllergenReviewForInventory(db,{businessId,inventoryId}={}){
  const bid=Number(businessId),iid=Number(inventoryId);
  const {rows}=await db.query(`
    SELECT DISTINCT p.id
      FROM products p JOIN recipes r ON r.product_id=p.id
     WHERE p.business_id=$1 AND r.inventory_id=$2
  `,[bid,iid]);
  for(const row of rows)await invalidateProductAllergenReview(db,{businessId:bid,productId:Number(row.id)});
  return rows.map(x=>Number(x.id));
}
