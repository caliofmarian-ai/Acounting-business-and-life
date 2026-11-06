// #877 / PR #884: actual shipped Express route, isolated real PostgreSQL+FEFO; synthetic local identity ONLY.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import express from 'express';
import pg from 'pg';
import {parsePreparedRemoval,estimatedPreparedRemovalCost} from '../prepared-portion-removal-core.js';
import {planInventoryFefo,applyLotAllocations} from '../inventory-lot-runtime.js';
if(process.env.NODE_ENV!=='test'||process.env.ABL_PREPARED_REMOVAL_877_CI!=='1'||
 process.env.PGHOST!=='127.0.0.1'||process.env.PGDATABASE!=='abl_prepared_removal_877_ci'||
 process.env.DATABASE_URL||process.env.PAYMONGO_LIVE_ENABLED!=='false')
 throw Error('Refusing any non-disposable/live database or provider');
const source=readFileSync(new URL('../server-business-accounting.js',import.meta.url),'utf8');
const start=source.indexOf("app.post('/api/prepared-product-removals'");
const end=source.indexOf("app.post('/api/product-sales'",start);
assert.ok(start>0&&end>start,'Shipped handler not found');
const handler=source.slice(start,end);
assert.match(handler,/estimatedPreparedRemovalCost\(ingredients\.rows,parsed\.quantity\)/);
assert.match(handler,/FOR UPDATE OF i/);
const pool=new pg.Pool({max:4});
let server,fixtureCreated=false;
const setup=async()=>{
 const db=await pool.connect();
 try{
  assert.equal(db.connection.stream.remoteAddress,'127.0.0.1');
  const meta=(await db.query("SELECT current_database() db,current_setting('server_version_num')::int version")).rows[0];
  assert.equal(meta.db,'abl_prepared_removal_877_ci');
  assert.ok(meta.version>=160000&&meta.version<170000);
  assert.equal((await db.query("SELECT to_regclass('public.products') AS t")).rows[0].t,null,'Refuse pre-existing tables');
  fixtureCreated=true;
  await db.query(`
   CREATE TABLE products(id BIGINT PRIMARY KEY,business_id BIGINT,name TEXT,product_kind TEXT);
   CREATE TABLE product_recipe_batches(product_id BIGINT PRIMARY KEY,yield_quantity NUMERIC(14,4),yield_unit TEXT,selling_quantity NUMERIC(14,4),selling_unit TEXT,sale_units_per_batch NUMERIC(14,4));
   CREATE TABLE inventory(id BIGINT PRIMARY KEY,business_id BIGINT,item TEXT,unit TEXT,quantity NUMERIC(12,3),unit_cost NUMERIC(12,4),updated_at TIMESTAMPTZ DEFAULT NOW());
   CREATE TABLE recipes(product_id BIGINT,inventory_id BIGINT,quantity NUMERIC(14,4));
   CREATE TABLE supply_lots(id BIGINT PRIMARY KEY,business_id BIGINT,inventory_id BIGINT,item_name TEXT,internal_lot_code TEXT,supplier_lot_code TEXT,lot_state TEXT DEFAULT 'available',base_unit TEXT,quantity_received_base NUMERIC(16,6),quantity_remaining_base NUMERIC(16,6),unit_cost_base NUMERIC(12,4),expires_at TIMESTAMPTZ,received_at TIMESTAMPTZ DEFAULT NOW(),created_at TIMESTAMPTZ DEFAULT NOW());
   CREATE TABLE prepared_product_removals(id BIGSERIAL PRIMARY KEY,business_id BIGINT,product_id BIGINT,product_name_snapshot TEXT,removal_reason TEXT,accounting_treatment TEXT,quantity NUMERIC(14,4),unit_cost_snapshot NUMERIC(14,6),estimated_cost NUMERIC(14,2),recipe_batch_snapshot JSONB,note TEXT,actor_account_id BIGINT,idempotency_key TEXT,occurred_at TIMESTAMPTZ DEFAULT NOW(),UNIQUE(business_id,idempotency_key));
   CREATE TABLE prepared_product_removal_ingredients(removal_id BIGINT,inventory_id BIGINT,ingredient_name_snapshot TEXT,quantity_used NUMERIC(14,4),unit_cost_snapshot NUMERIC(12,4),cost_snapshot NUMERIC(12,4));
   CREATE TABLE prepared_product_removal_lots(removal_id BIGINT,inventory_id BIGINT,lot_id BIGINT,quantity_used NUMERIC(16,6),expires_at_snapshot TIMESTAMPTZ);
   INSERT INTO products VALUES (81,12,'Prepared meal','prepared_recipe'),(82,12,'Precision meal','prepared_recipe'),(83,12,'Rollback meal','prepared_recipe'),(91,13,'Foreign meal','prepared_recipe');
   INSERT INTO product_recipe_batches VALUES (81,11,'portion',1,'portion',11),(82,1,'portion',1,'portion',1),(83,1,'portion',1,'portion',1);
   INSERT INTO inventory(id,business_id,item,unit,quantity,unit_cost) VALUES (101,12,'Main ingredient','kg',3,68.4200),(102,12,'Tiny ingredient','kg',1,2.1350),(103,12,'Rollback ingredient','kg',1,4.0150),(201,13,'Foreign item','kg',8,7);
   INSERT INTO recipes VALUES (81,101,1),(82,102,0.0001),(83,103,1);
   INSERT INTO supply_lots(id,business_id,inventory_id,item_name,internal_lot_code,base_unit,quantity_received_base,quantity_remaining_base,unit_cost_base) VALUES
    (501,12,101,'Main ingredient','LOT-A','kg',3,3,68.4200),(502,12,102,'Tiny ingredient','LOT-B','kg',1,1,2.1350),(503,12,103,'Rollback ingredient','LOT-C','kg',1,1,4.0150);
  `);
 }finally{db.release()}
};
const snapshot=async()=>{
 const [stock,lots,removals,ingredients,allocations]=await Promise.all([
  pool.query('SELECT id,quantity::text quantity FROM inventory ORDER BY id'),
  pool.query('SELECT id,quantity_remaining_base::text quantity FROM supply_lots ORDER BY id'),
  pool.query('SELECT id,business_id,product_id,quantity::text,estimated_cost::text FROM prepared_product_removals ORDER BY id'),
  pool.query('SELECT removal_id,inventory_id,quantity_used::text FROM prepared_product_removal_ingredients ORDER BY removal_id'),
  pool.query('SELECT removal_id,inventory_id,lot_id,quantity_used::text FROM prepared_product_removal_lots ORDER BY removal_id')
 ]);
 return JSON.stringify([stock.rows,lots.rows,removals.rows,ingredients.rows,allocations.rows]);
};
async function main(){
 await setup();
 const app=express();
 // Only the identity boundary is synthetic; the real shipped route, SQL and FEFO functions run unmodified.
 const accountingContext=async req=>{
  const identity=req.get('x-ci-identity');
  if(!identity)throw Object.assign(new Error('Identity required'),{status:401});
  if(identity==='nonmerchant')return{role:'customer',business:{id:12},me:{account:{id:612}}};
  if(identity==='merchantA')return{role:'merchant',business:{id:12},me:{account:{id:612}}};
  if(identity==='merchantB')return{role:'merchant',business:{id:13},me:{account:{id:613}}};
  throw Object.assign(new Error('Identity denied'),{status:401});
 };
 new Function('app','jsonBody','accountingContext','pool','planInventoryFefo','applyLotAllocations',
  'parsePreparedRemoval','estimatedPreparedRemovalCost','clean',handler)(
  app,express.json(),accountingContext,pool,planInventoryFefo,applyLotAllocations,
  parsePreparedRemoval,estimatedPreparedRemovalCost,(v,n)=>String(v??'').trim().slice(0,n));
 app.use((err,_req,res,_next)=>res.status(err.status||500).json({error:err.message,code:err.code||null}));
 await new Promise((resolve,reject)=>{server=app.listen(0,'127.0.0.1',resolve);server.once('error',reject)});
 const url=`http://127.0.0.1:${server.address().port}/api/prepared-product-removals`;
 const send=async (body,identity='merchantA')=>{
  const headers={'content-type':'application/json'};
  if(identity)headers['x-ci-identity']=identity;
  const res=await fetch(url,{method:'POST',headers,body:JSON.stringify(body)});
  return {status:res.status,data:await res.json()};
 };
 const base={business_id:12,product_id:81,quantity:2,reason:'owner_consumption',idempotency_key:'prepared-ci-0001',note:'synthetic'};
 let r=await send(base);assert.equal(r.status,201,JSON.stringify(r));
 assert.equal(Number(r.data.removal.estimated_cost),136.84);
 assert.equal(r.data.removal.accounting_treatment,'noncash_owner_draw');
 let states=JSON.parse(await snapshot());
 assert.equal(states[0].find(x=>Number(x.id)===101).quantity,'1.000');
 assert.equal(states[1].find(x=>Number(x.id)===501).quantity,'1.000000');
 assert.deepEqual(states.slice(2).map(rows=>rows.length),[1,1,1]);
 const saved=await snapshot();
 r=await send(base);assert.equal(r.status,200);assert.equal(r.data.already_recorded,true);
 assert.equal(await snapshot(),saved);
 r=await send({...base,quantity:1});assert.equal(r.status,409);assert.equal(await snapshot(),saved);
 for(const [payload,identity,status] of [
  [base,null,401],[base,'nonmerchant',403],[{...base,business_id:13},'merchantA',409],
  [{...base,idempotency_key:'prepared-ci-0002'},'merchantB',409],
  [{...base,product_id:91,idempotency_key:'prepared-ci-0003'},'merchantA',404]
 ]){
  r=await send(payload,identity);assert.equal(r.status,status,JSON.stringify(r));
  assert.equal(await snapshot(),saved,'Denied HTTP must not post any ledger or stock');
 }
 const tiny={...base,product_id:82,quantity:1,idempotency_key:'prepared-ci-0004'};
 r=await send(tiny);assert.equal(r.status,409,JSON.stringify(r));
 assert.equal(r.data.code,'PREPARED_REMOVAL_STOCK_PRECISION');
 assert.equal(await snapshot(),saved,'Precision conflict rolls back the inserted record');
 await pool.query('UPDATE recipes SET quantity=1.0000 WHERE product_id=82');
 r=await send(tiny);assert.equal(r.status,201,JSON.stringify(r));
 assert.equal(Number(r.data.removal.estimated_cost),2.14,'Half-cent must round up');
 const exact=await snapshot();r=await send(tiny);assert.equal(r.status,200);assert.equal(await snapshot(),exact);
 await pool.query(`CREATE FUNCTION prepared_ci_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated forced audit failure'; END $$;
 CREATE TRIGGER prepared_ci_reject BEFORE INSERT ON prepared_product_removal_ingredients FOR EACH ROW EXECUTE FUNCTION prepared_ci_reject()`);
 const failed={...base,product_id:83,quantity:1,idempotency_key:'prepared-ci-0005'};
 r=await send(failed);assert.equal(r.status,500,'Forced SQL trigger must surface an error');
 assert.equal(await snapshot(),exact,'Real PostgreSQL trigger error must rollback removal, lot and stock');
 await pool.query('DROP TRIGGER prepared_ci_reject ON prepared_product_removal_ingredients; DROP FUNCTION prepared_ci_reject()');
 r=await send(failed);assert.equal(r.status,201,JSON.stringify(r));
 assert.equal(Number(r.data.removal.estimated_cost),4.02);
 const retried=await snapshot();r=await send(failed);assert.equal(r.status,200);assert.equal(await snapshot(),retried);
 // Same-key race: two *simultaneous* real HTTP requests must serialize at
 // the PostgreSQL business+key barrier, not deduct stock/lots twice.
 // At this point ingredient 101 and lot 501 each have exactly 1.000 left.
 const concurrent={...base,quantity:1,idempotency_key:'prepared-ci-concurrent-0006'};
 const beforeConcurrent=JSON.parse(await snapshot());
 const attempts=await Promise.all([send(concurrent),send(concurrent)]);
 assert.deepEqual(attempts.map(v=>v.status).sort((a,b)=>a-b),[200,201],
  'Concurrent requests with same key must be one create and one replay');
 assert.equal(attempts[0].data.removal.id,attempts[1].data.removal.id,
  'Both responses must refer to one exact saved removal');
 assert.equal(attempts.find(v=>v.status===200).data.already_recorded,true);
 assert.equal(attempts.find(v=>v.status===201).data.already_recorded,false);
 assert.equal(Number(attempts[0].data.removal.estimated_cost),68.42);
 const afterConcurrent=JSON.parse(await snapshot());
 assert.equal(afterConcurrent[0].find(v=>Number(v.id)===101).quantity,'0.000');
 assert.equal(afterConcurrent[1].find(v=>Number(v.id)===501).quantity,'0.000000');
 for(let i=2;i<5;i++)assert.equal(afterConcurrent[i].length,beforeConcurrent[i].length+1,
  'Concurrent replay must produce exactly one removal, ingredient and lot row');
 const concurrentSaved=await snapshot();
 r=await send(concurrent);assert.equal(r.status,200);assert.equal(r.data.already_recorded,true);
 assert.equal(await snapshot(),concurrentSaved,'Late replay must not change physical stock');
 r=await send({...concurrent,quantity:2});assert.equal(r.status,409);
 assert.equal(await snapshot(),concurrentSaved,'Same key with different payload cannot post');
 r=await send({...concurrent,idempotency_key:'prepared-ci-shortage-0007'});
 assert.equal(r.status,409,'New intent cannot spend stock already consumed');
 assert.equal(await snapshot(),concurrentSaved,'Shortage rollback must not create records');

 console.log('PREPARED_REMOVAL_HTTP_POSTGRES_877_PASS literalExpress=true realFEFO=true syntheticIdentity=true realRollback=true replay=true');
}
try{await main()}
finally{
 if(server)await new Promise(resolve=>server.close(resolve));
 if(fixtureCreated)await pool.query(`DROP TABLE IF EXISTS prepared_product_removal_lots,prepared_product_removal_ingredients,prepared_product_removals,supply_lots,recipes,product_recipe_batches,inventory,products CASCADE`).catch(()=>{});
 await pool.end();
}