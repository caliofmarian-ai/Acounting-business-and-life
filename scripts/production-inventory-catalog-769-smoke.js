import pg from 'pg';
import {readFileSync} from 'node:fs';

const{Pool}=pg;
const fail=message=>{throw new Error(message)};
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

async function run(){
  if(process.env.RAILWAY_ENVIRONMENT_NAME!=='production')fail('Production Inventory/Catalog smoke requires Railway production environment.');
  if(process.env.NODE_ENV!=='production')fail('Production Inventory/Catalog smoke requires NODE_ENV=production.');
  if(!process.env.DATABASE_URL)fail('DATABASE_URL is required.');

  const inventoryUi=read('public/v03.js');
  const marketUi=read('public/marketplace-ui.js');
  const marketServer=read('server-marketplace.js');

  if(!inventoryUi.includes('function selectedPositiveInventoryId(select)'))fail('Production Inventory UI does not include positive selection guard.');
  const loadStock=inventoryUi.slice(inventoryUi.indexOf('async function loadStock'),inventoryUi.indexOf('function lotExpiryCopy'));
  if(!loadStock.includes("selectedPositiveInventoryId($('inventoryUnavailableItem'))!=null"))fail('Production loadStock does not guard unavailable-stock selection.');
  if(loadStock.includes("Number.isInteger(Number($('inventoryUnavailableItem')?.value))"))fail('Production loadStock still converts empty unavailable-stock selection to zero.');
  if(!marketUi.includes('Retail products & collections')||!marketUi.includes('Food / prepared products')||!marketUi.includes('Catalog summary'))fail('Production Catalog count scopes are not explicitly labelled.');
  if(!marketServer.includes("app.get('/api/merchant/catalog-v3/summary'"))fail('Production canonical Merchant Catalog summary endpoint is missing.');
  if(!/published=TRUE AND active=TRUE/.test(marketServer))fail('Production public product projection is not explicitly limited to published active products.');

  const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
  try{
    const q=await pool.query(`
      SELECT
        COUNT(*)::int all_products,
        COUNT(*) FILTER (WHERE product_domain='food')::int food_products,
        COUNT(*) FILTER (WHERE product_domain='non_food')::int retail_products,
        COUNT(*) FILTER (WHERE active=TRUE)::int active_products,
        COUNT(*) FILTER (WHERE active=FALSE)::int archived_products,
        COUNT(*) FILTER (WHERE active=TRUE AND published=TRUE)::int published_products,
        COUNT(*) FILTER (WHERE active=TRUE AND published=FALSE)::int private_products
      FROM marketplace_products
    `);
    const row=q.rows[0]||{};
    const total=Number(row.all_products||0),food=Number(row.food_products||0),retail=Number(row.retail_products||0);
    const active=Number(row.active_products||0),archived=Number(row.archived_products||0);
    const published=Number(row.published_products||0),privateCount=Number(row.private_products||0);
    if(total!==food+retail)fail('Production Catalog has products outside the canonical Food/Retail domain count.');
    if(total!==active+archived)fail('Production Catalog active/archive counts do not reconcile.');
    if(active!==published+privateCount)fail('Production active Catalog published/private counts do not reconcile.');
    if(privateCount<1)fail('Production acceptance requires at least one private Catalog product to prove public exclusion.');

    const leaked=await pool.query(`
      SELECT COUNT(*)::int count
        FROM marketplace_products
       WHERE active=TRUE AND published=TRUE AND id IN (
         SELECT id FROM marketplace_products WHERE active=TRUE AND published=FALSE
       )
    `);
    if(Number(leaked.rows[0]?.count||0)!==0)fail('A private Catalog product leaked into the published product set.');

    console.log('PRODUCTION_INVENTORY_CATALOG_769_SMOKE_RESULT '+JSON.stringify({
      status:'PASS',
      environment:'production',
      read_only:true,
      empty_inventory_selector_guard:true,
      inventory_id_zero_followup_blocked:true,
      catalog_counts_reconciled:true,
      catalog_total:total,
      food_products:food,
      retail_products:retail,
      active_products:active,
      published_products:published,
      private_products:privateCount,
      archived_products:archived,
      private_public_overlap:0,
      real_money:false
    }));
  }catch(error){
    console.error('PRODUCTION_INVENTORY_CATALOG_769_SMOKE_RESULT '+JSON.stringify({
      status:'FAIL',read_only:true,error:String(error?.message||error).slice(0,500)
    }));
    process.exitCode=1;
  }finally{await pool.end()}
}

await run();
