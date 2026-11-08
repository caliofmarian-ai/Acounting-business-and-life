// #877/#884 disposable PostgreSQL 16; NEVER connect to a real Merchant database.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {estimatedPreparedRemovalCost as cost} from '../prepared-portion-removal-core.js';
if (process.env.NODE_ENV!=='test'||process.env.ABL_PREPARED_REMOVAL_877_CI!=='1'||
    process.env.PGHOST!=='127.0.0.1'||process.env.PGDATABASE!=='abl_prepared_removal_877_ci'||
    process.env.DATABASE_URL||process.env.PAYMONGO_LIVE_ENABLED!=='false')
  throw Error('Only the disposable PostgreSQL CI service is authorized');
const money=(q,c,p)=>cost([{recipe_quantity:q,unit_cost:c}],p);
const conflict=e=>e?.status===409&&e.code==='PREPARED_REMOVAL_STOCK_PRECISION';
test('real NUMERIC(12,3) debit / exact PHP cents / transaction rollback',async()=>{
  const db=new pg.Pool({max:1});
  let c,tx=false;
  try{
    c=await db.connect();
    assert.equal(c.connection.stream.remoteAddress,'127.0.0.1');
    const v=Number((await c.query('SHOW server_version_num')).rows[0].server_version_num);
    assert.ok(v>=160000&&v<170000);
    assert.equal((await c.query('SELECT current_database() AS db')).rows[0].db,'abl_prepared_removal_877_ci');
    await c.query('BEGIN');tx=true;
    await c.query('CREATE TEMP TABLE prepared_ci(item_id INTEGER PRIMARY KEY,quantity NUMERIC(12,3),unit_cost NUMERIC(12,4)) ON COMMIT DROP');
    await c.query('INSERT INTO prepared_ci VALUES (1,3.000,68.4200),(2,1.000,2.1350)');
    const rounded=await c.query('SELECT (1.000::numeric-0.0001::numeric)::numeric(12,3)::text AS zero_debit,(1.000::numeric-0.3333::numeric*3)::numeric(12,3)::text AS remainder');
    assert.equal(rounded.rows[0].zero_debit,'1.000');
    assert.equal(rounded.rows[0].remainder,'0.000');
    for(const [q,p] of [['0.0001',1],['0.0005',1],['0.3333',3],['1.0000','0.0001']])
      assert.throws(()=>money(q,'2.1350',p),conflict);
    assert.throws(()=>cost([{recipe_quantity:'1',unit_cost:'68.4200'},{recipe_quantity:'0.0001',unit_cost:'2.1350'}],1),conflict);
    assert.equal((await c.query('SELECT quantity::text FROM prepared_ci WHERE item_id=1')).rows[0].quantity,'3.000');
    assert.equal(money('1','68.4200',2),136.84);
    const valid=await c.query('UPDATE prepared_ci SET quantity=quantity-$1::numeric WHERE item_id=1 AND quantity>=$1::numeric RETURNING quantity::text',['2.000']);
    assert.equal(valid.rowCount,1);
    assert.equal(valid.rows[0].quantity,'1.000');
    assert.equal(money('0.0005','2.1350',2),0);
    const small=await c.query('UPDATE prepared_ci SET quantity=quantity-$1::numeric WHERE item_id=2 AND quantity>=$1::numeric RETURNING quantity::text',['0.001']);
    assert.equal(small.rows[0].quantity,'0.999');
    assert.equal(money('1','2.1350',1),2.14);
    assert.equal(money('1','4.0150',1),4.02);
    await c.query('ROLLBACK');tx=false;
    assert.equal((await c.query("SELECT to_regclass('pg_temp.prepared_ci') AS t")).rows[0].t,null);
    console.log('Prepared #877 isolated PostgreSQL assertion group PASS');
  }finally{
    if(c&&tx)await c.query('ROLLBACK').catch(()=>{});
    c?.release();await db.end();
  }
});
