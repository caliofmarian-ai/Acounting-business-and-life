/* #853: disposable PostgreSQL 16, never a Railway or production database. */
import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {readRestaurantBacoorDatabaseSnapshot as readSnapshot} from '../qa/restaurant-bacoor-db-snapshot-853.js';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.QA_BACOOR_DISPOSABLE_PG!=='1'||
  process.env.PGHOST!=='127.0.0.1'||process.env.PGDATABASE!=='abl_bacoor_853_ci')
  throw Error('Refusing non-disposable database for #853');
const pool=new pg.Pool({host:'127.0.0.1',port:5432,user:'postgres',database:'abl_bacoor_853_ci'});
const schema='qa_bacoor_853',A='987654320',B='987654321',OTHER='987654322';
const fixture=JSON.parse(readFileSync(new URL('../qa/fixtures/ph-restaurant-bacoor-v1.json',import.meta.url),'utf8'));
async function session(fn){
  const c=await pool.connect();
  try{await c.query('SET search_path TO '+schema);return await fn(c);}
  finally{c.release();}
}
async function connected(afterAuthority){
  const c=await pool.connect();
  await c.query('SET search_path TO '+schema);
  let once=false;
  return {query:async(sql,args)=>{
    const r=await c.query(sql,args);
    if(!once&&afterAuthority&&sql.includes('FROM businesses b')){
      once=true;await afterAuthority(c);
    }
    return r;
  },release:()=>c.release()};
}
const read=(more={})=>readSnapshot({connect:()=>connected(more.afterAuthority),
  accountId:A,businessId:more.businessId||B,fixture});
const ddl=[
'CREATE TABLE businesses(id BIGINT,name TEXT,country_code TEXT,currency_code TEXT)',
'CREATE TABLE accounts(id BIGINT,active_role TEXT,account_mode TEXT,test_role TEXT,auth_status TEXT)',
'CREATE TABLE profiles(account_id BIGINT,role TEXT,enabled BOOLEAN,status TEXT)',
'CREATE TABLE profile_business_bindings(business_id BIGINT,account_id BIGINT,role TEXT,status TEXT)',
'CREATE TABLE business_memberships(business_id BIGINT,account_id BIGINT,active BOOLEAN)',
'CREATE TABLE merchant_storefronts(business_id BIGINT,publication_status TEXT,merchant_domain TEXT,pickup_enabled BOOLEAN,delivery_enabled BOOLEAN,cash_enabled BOOLEAN,online_enabled BOOLEAN,public_location_enabled BOOLEAN,public_reputation_enabled BOOLEAN,price_comparison_enabled BOOLEAN)',
'CREATE TABLE inventory(id BIGINT,business_id BIGINT,item TEXT,unit TEXT,base_unit TEXT,measurement_family TEXT,inventory_type TEXT,quantity NUMERIC,reorder_level NUMERIC,target_level NUMERIC,unit_cost NUMERIC)',
'CREATE TABLE products(id BIGINT,business_id BIGINT,name TEXT,category TEXT,selling_price NUMERIC,active BOOLEAN,product_kind TEXT)',
'CREATE TABLE marketplace_products(id BIGINT,business_id BIGINT,legacy_product_id BIGINT,inventory_id BIGINT,name TEXT,description TEXT,category TEXT,selling_price NUMERIC,unit_code TEXT,quantity_per_unit NUMERIC,price_comparison_override BOOLEAN,stock_tracked BOOLEAN,stock_quantity NUMERIC,active BOOLEAN,published BOOLEAN,product_kind TEXT)',
'CREATE TABLE product_recipe_batches(product_id BIGINT)',
'CREATE TABLE recipe_batch_components(product_id BIGINT,inventory_id BIGINT,base_quantity NUMERIC)',
'CREATE TABLE recipes(product_id BIGINT,inventory_id BIGINT,quantity NUMERIC)'
];
before(async()=>{
  await pool.query('CREATE SCHEMA '+schema);
  await session(async c=>{
    for(const sql of ddl)await c.query(sql);
    await c.query('INSERT INTO businesses VALUES ($1,$2,$3,$4),($5,$6,$7,$8)',
      [B,fixture.business.name,'PH','PHP',OTHER,'Unrelated test store','PH','PHP']);
    await c.query("INSERT INTO accounts VALUES ($1,'merchant','company_test','merchant','active')",[A]);
    await c.query("INSERT INTO profiles VALUES ($1,'merchant',TRUE,'active')",[A]);
    await c.query("INSERT INTO profile_business_bindings VALUES ($1,$2,'merchant','active')",[B,A]);
    await c.query('INSERT INTO business_memberships VALUES ($1,$2,TRUE)',[B,A]);
    await c.query("INSERT INTO merchant_storefronts VALUES ($1,'draft','food',FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,FALSE)",[B]);
    await c.query("INSERT INTO inventory VALUES (1,$1,'Unrelated tenant item','g','g','mass','ingredient',1,1,1,1)",[OTHER]);
  });
});
beforeEach(async()=>session(async c=>{
  await c.query("UPDATE accounts SET account_mode='company_test',test_role='merchant',auth_status='active' WHERE id=$1",[A]);
  await c.query("UPDATE profiles SET status='active' WHERE account_id=$1",[A]);
  await c.query("UPDATE merchant_storefronts SET publication_status='draft',cash_enabled=FALSE WHERE business_id=$1",[B]);
}));
after(async()=>{try{await pool.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');}finally{await pool.end();}});
test('real PostgreSQL: authorized private restaurant is empty and NO WRITES',async()=>{
  const result=await read();
  assert.equal(result.status,'ALL_STORES_EMPTY_UNAPPROVED');
  assert.equal(result.readOnly,true);
  assert.equal(result.consistentSnapshot,true);
  assert.equal(result.executable,false);
  assert.doesNotMatch(JSON.stringify(result),/98765432|Unrelated tenant/);
});
test('real PostgreSQL: wrong account mode and wrong tenant fail closed',async()=>{
  await session(c=>c.query("UPDATE accounts SET account_mode='personal' WHERE id=$1",[A]));
  await assert.rejects(read(),/exact active QA Merchant\/business binding unavailable/);
  await session(c=>c.query("UPDATE accounts SET account_mode='company_test' WHERE id=$1",[A]));
  await assert.rejects(read({businessId:OTHER}),/exact active QA Merchant\/business binding unavailable/);
});
test('real PostgreSQL: published or cash-enabled Storefront is rejected',async()=>{
  await session(c=>c.query("UPDATE merchant_storefronts SET publication_status='published' WHERE business_id=$1",[B]));
  await assert.rejects(read(),/storefront is not a private non-commercial QA draft/);
  await session(c=>c.query("UPDATE merchant_storefronts SET publication_status='draft',cash_enabled=TRUE WHERE business_id=$1",[B]));
  await assert.rejects(read(),/storefront is not a private non-commercial QA draft/);
});
test('real PostgreSQL: concurrent committed change cannot split repeatable-read snapshot',async()=>{
  const result=await read({afterAuthority:()=>session(c=>c.query(
    "UPDATE merchant_storefronts SET publication_status='published' WHERE business_id=$1",[B]))});
  assert.equal(result.status,'ALL_STORES_EMPTY_UNAPPROVED');
  const current=await session(async c=>(await c.query(
    'SELECT publication_status FROM merchant_storefronts WHERE business_id=$1',[B])).rows[0].publication_status);
  assert.equal(current,'published');
});
test('real PostgreSQL: attempted write denied by READ ONLY; entire read rolls back',async()=>{
  let code;
  await assert.rejects(read({afterAuthority:async c=>{
    try{await c.query("UPDATE businesses SET name='corrupted' WHERE id=$1",[B]);}
    catch(e){code=e.code;}
  }}),/current transaction is aborted/);
  assert.equal(code,'25006');
  const name=await session(async c=>(await c.query('SELECT name FROM businesses WHERE id=$1',[B])).rows[0].name);
  assert.equal(name,fixture.business.name);
});
