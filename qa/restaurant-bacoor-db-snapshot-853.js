/**
 * #853: repeatable-read, READ ONLY snapshot of one explicitly selected QA
 * Merchant business. This module never opens a DB connection, provisions a
 * business, writes rows, or grants permission to seed/replay anything.
 *
 * The caller must separately establish that its connection points to the
 * existing isolated company-test database, not Production. A valid membership
 * on its own is NOT proof of an approved QA environment.
 */
import {buildRestaurantBacoorDryRunPlan} from './restaurant-bacoor-dry-run-853.js';
import {auditRestaurantBacoorCompleteSnapshots} from './restaurant-bacoor-composite-audit-853.js';

const fail=message=>{throw new TypeError('QA database snapshot refused: '+message);};
const positiveId=(raw,label)=>{
  const value=typeof raw==='number'&&Number.isSafeInteger(raw)?String(raw):raw;
  if(typeof value!=='string'||!/^[1-9][0-9]{0,14}$/.test(value)||
     !Number.isSafeInteger(Number(value)))fail('invalid '+label);
  return value;
};
const SQL={
  authority:[
    'SELECT DISTINCT b.id,b.name,b.country_code,b.currency_code',
    'FROM businesses b',
    'JOIN profile_business_bindings pb ON pb.business_id=b.id',
    "AND pb.account_id=$2 AND pb.role='merchant' AND pb.status='active'",
    'JOIN business_memberships bm ON bm.business_id=b.id',
    'AND bm.account_id=$2 AND bm.active=TRUE',
    'JOIN profiles p ON p.account_id=$2 AND p.role=\'merchant\' AND p.enabled=TRUE',
    "JOIN accounts a ON a.id=$2 AND a.active_role='merchant'",
    'WHERE b.id=$1'
  ].join(' '),
  storefront:[
    'SELECT business_id,publication_status,merchant_domain,pickup_enabled,delivery_enabled,',
    'cash_enabled,online_enabled,public_location_enabled,public_reputation_enabled,',
    'price_comparison_enabled FROM merchant_storefronts WHERE business_id=$1'
  ].join(' '),
  inventory:[
    'SELECT id,business_id,item,unit,base_unit,measurement_family,inventory_type,',
    'quantity,reorder_level,target_level,unit_cost',
    'FROM inventory WHERE business_id=$1 ORDER BY id'
  ].join(' '),
  products:[
    'SELECT id,business_id,name,category,selling_price,active,product_kind',
    'FROM products WHERE business_id=$1 ORDER BY id'
  ].join(' '),
  catalog:[
    'SELECT id,business_id,legacy_product_id,inventory_id,name,description,category,',
    'selling_price,unit_code,quantity_per_unit,price_comparison_override,',
    'stock_tracked,stock_quantity,active,published,product_kind',
    'FROM marketplace_products WHERE business_id=$1 ORDER BY id'
  ].join(' '),
  batches:[
    'SELECT rb.* FROM product_recipe_batches rb',
    'JOIN products p ON p.id=rb.product_id',
    'WHERE p.business_id=$1 ORDER BY rb.product_id'
  ].join(' '),
  components:[
    'SELECT rc.*,i.item,i.unit,i.unit_cost,',
    '(rc.base_quantity * i.unit_cost) AS batch_cost',
    'FROM recipe_batch_components rc',
    'JOIN products p ON p.id=rc.product_id',
    'LEFT JOIN inventory i ON i.id=rc.inventory_id AND i.business_id=p.business_id',
    'WHERE p.business_id=$1 ORDER BY rc.product_id,rc.inventory_id'
  ].join(' '),
  legacy:[
    'SELECT r.product_id,r.inventory_id,r.quantity,i.item,i.unit',
    'FROM recipes r JOIN products p ON p.id=r.product_id',
    'LEFT JOIN inventory i ON i.id=r.inventory_id AND i.business_id=p.business_id',
    'WHERE p.business_id=$1 ORDER BY r.product_id,r.inventory_id'
  ].join(' ')
};
const rows=result=>{
  if(!Array.isArray(result?.rows))fail('malformed database result');
  return result.rows;
};
const groupByProduct=records=>{
  const groups=new Map();
  for(const record of records){
    const key=String(record.product_id);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(record);
  }
  return groups;
};

/**
 * @param {Object} options - caller-supplied connected QA client factory,
 * explicit existing Merchant account/business IDs and immutable V1 manifest.
 * @returns {Promise<Object>} anonymized diagnostic ONLY; never row IDs, names
 * or any permission to seed a missing fixture.
 */
export async function readRestaurantBacoorDatabaseSnapshot({
  connect,accountId,businessId,fixture
}={}){
  const plan=buildRestaurantBacoorDryRunPlan(fixture);
  if(plan.mode!=='DRY_RUN_ONLY'||plan.executable!==false)fail('unreviewed fixture');
  const account=positiveId(accountId,'account ID');
  const business=positiveId(businessId,'business ID');
  if(typeof connect!=='function')fail('caller-supplied connected QA client required');
  const client=await connect();
  if(!client||typeof client.query!=='function'||typeof client.release!=='function')
    fail('a dedicated PostgreSQL client is required');
  let begun=false;
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    begun=true;
    await client.query("SET LOCAL statement_timeout = '12000ms'");
    const authority=rows(await client.query(SQL.authority,[business,account]));
    if(authority.length!==1||
       String(authority[0].id)!==business||
       authority[0].name!==plan.target.name||
       authority[0].country_code!=='PH'||authority[0].currency_code!=='PHP'){
      fail('exact active QA Merchant/business binding unavailable');
    }
    const storefront=rows(await client.query(SQL.storefront,[business]));
    if(storefront.length>1)fail('duplicate storefront');
    if(storefront.length){
      const s=storefront[0];
      if(String(s.business_id)!==business||
         s.publication_status!=='draft'||s.merchant_domain!=='food'||
         ['pickup_enabled','delivery_enabled','cash_enabled','online_enabled',
          'public_location_enabled','public_reputation_enabled',
          'price_comparison_enabled'].some(k=>s[k]!==false)){
        fail('storefront is not a private non-commercial QA draft');
      }
    }
    // All business-scoped projections come from ONE PostgreSQL MVCC snapshot.
    // Never use Promise.all on the same transaction client.
    const inventoryRows=rows(await client.query(SQL.inventory,[business]));
    const products=rows(await client.query(SQL.products,[business]));
    const catalogProducts=rows(await client.query(SQL.catalog,[business]));
    const batches=groupByProduct(rows(await client.query(SQL.batches,[business])));
    const components=groupByProduct(rows(await client.query(SQL.components,[business])));
    const legacy=groupByProduct(rows(await client.query(SQL.legacy,[business])));
    const recipeProducts=products.map(p=>{
      const key=String(p.id);
      return {...p,recipe_batch:batches.get(key)?.[0]||null,
        recipe_batch_components:components.get(key)||[],
        recipe:legacy.get(key)||[]};
    });
    const result=auditRestaurantBacoorCompleteSnapshots(fixture,{
      targetBusinessId:business,inventoryRows,recipeProducts,catalogProducts
    });
    if(result.status==='EXACT_PRIVATE_CROSS_STORE_SNAPSHOTS_ONLY'&&
       storefront.length!==1)fail('seeded restaurant has no private draft storefront');
    return {...result,readOnly:true,consistentSnapshot:true,
      authority:'existing-active-merchant-binding-only',
      gate:'NO WRITES: isolated QA environment/provisioning and owner-controlled acceptance remain independently required'};
  }finally{
    try{
      if(begun)await client.query('ROLLBACK');
    }finally{client.release()}
  }
}
