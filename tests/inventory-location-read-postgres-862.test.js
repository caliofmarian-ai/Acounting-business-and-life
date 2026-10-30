import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {reconcileBusinessInventoryLocationsForRead} from '../inventory-locations.js';

const {Pool}=pg;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('862: isolated real PostgreSQL clean reads, coalescing, lock repair and isolation',{
  skip:!process.env.INVENTORY_862_PG_URL,timeout:60000
},async t=>{
  const pool=new Pool({connectionString:process.env.INVENTORY_862_PG_URL,
    application_name:'inventory_862_isolated_QA',max:8});
  try{
    await pool.query("CREATE TABLE inventory (id BIGINT PRIMARY KEY,business_id BIGINT NOT NULL,quantity NUMERIC(16,6) NOT NULL,storage_area_type TEXT DEFAULT 'pantry',storage_location_label TEXT DEFAULT '',storage_condition TEXT DEFAULT 'dry',storage_segregated BOOLEAN DEFAULT FALSE)");
    await pool.query("CREATE TABLE inventory_storage_locations (id BIGINT PRIMARY KEY,business_id BIGINT NOT NULL,name TEXT NOT NULL,storage_condition TEXT DEFAULT 'dry',storage_area_type TEXT DEFAULT 'pantry',location_label TEXT DEFAULT '',storage_segregated BOOLEAN DEFAULT FALSE,created_by_account_id BIGINT,active BOOLEAN DEFAULT TRUE)");
    await pool.query("CREATE TABLE inventory_location_balances (business_id BIGINT NOT NULL,inventory_id BIGINT NOT NULL,location_id BIGINT NOT NULL,quantity NUMERIC(16,6) NOT NULL DEFAULT 0,updated_at TIMESTAMPTZ DEFAULT NOW(),PRIMARY KEY(inventory_id,location_id))");
    await pool.query("INSERT INTO inventory_storage_locations(id,business_id,name) VALUES (100,1,'Pantry'),(200,2,'Pantry')");
    await pool.query("INSERT INTO inventory(id,business_id,quantity) SELECT gs,1,3 FROM generate_series(1,1000) AS gs");
    await pool.query("INSERT INTO inventory_location_balances(business_id,inventory_id,location_id,quantity) SELECT 1,gs,100,3 FROM generate_series(1,1000) AS gs");
    await pool.query("INSERT INTO inventory(id,business_id,quantity) VALUES (2001,2,9)");
    await pool.query("INSERT INTO inventory_location_balances(business_id,inventory_id,location_id,quantity) VALUES (2,2001,200,3)");

    await t.test('1000 settled rows use bounded actual PostgreSQL SELECTs without row locks',async()=>{
      const sqlLog=[];
      const counted={async query(sql,args){sqlLog.push({sql,args});return pool.query(sql,args)}};
      await reconcileBusinessInventoryLocationsForRead(counted,{businessId:1});
      assert.equal(sqlLog.length,3);
      assert.ok(sqlLog.every(x=>!x.sql.includes('FOR UPDATE')&&(!x.args?.length||x.args[0]===1)));
      const clean=await pool.query('SELECT COUNT(*) AS count FROM inventory_location_balances WHERE business_id=1');
      assert.equal(Number(clean.rows[0].count),1000);
      t.diagnostic('real PostgreSQL: 1000 inventory rows, three SELECTs, no per-item row locks');
    });

    await t.test('same-business concurrent GETs use one DB scan and B repair leaves A unchanged',async()=>{
      const counters={a:0,b:0};
      let unlock;const barrier=new Promise(resolve=>{unlock=resolve});
      let started;const entered=new Promise(resolve=>{started=resolve});
      let held=false;
      const counted={async query(sql,args=[]){
        if(sql.startsWith('SELECT i.id,i.quantity')){
          if(args[0]===1){counters.a++;if(!held){held=true;started();await barrier}}
          else if(args[0]===2)counters.b++;
        }
        return pool.query(sql,args);
      }};
      const first=reconcileBusinessInventoryLocationsForRead(counted,{businessId:1});
      await entered;
      const second=reconcileBusinessInventoryLocationsForRead(counted,{businessId:1});
      unlock();
      await Promise.all([first,second]);
      assert.equal(counters.a,1);
      await reconcileBusinessInventoryLocationsForRead(counted,{businessId:2});
      assert.equal(counters.b,1);
      const corrected=await pool.query('SELECT quantity FROM inventory_location_balances WHERE inventory_id=2001');
      assert.equal(Number(corrected.rows[0].quantity),9);
      const aStock=await pool.query('SELECT SUM(quantity) AS total FROM inventory_location_balances WHERE business_id=1');
      assert.equal(Number(aStock.rows[0].total),3000);
    });

    await t.test('real PostgreSQL FOR UPDATE lock is observed while two GETs share one repair',async()=>{
      await pool.query('UPDATE inventory_location_balances SET quantity=2 WHERE inventory_id=2001');
      const blocker=await pool.connect();
      let began=false;
      try{
        await blocker.query('BEGIN');began=true;
        await blocker.query('SELECT id FROM inventory WHERE id=2001 FOR UPDATE');
        const preflights=[];
        const counted={async query(sql,args=[]){
          if(sql.startsWith('SELECT i.id,i.quantity'))preflights.push(args[0]);
          return pool.query(sql,args);
        }};
        const first=reconcileBusinessInventoryLocationsForRead(counted,{businessId:2});
        const second=reconcileBusinessInventoryLocationsForRead(counted,{businessId:2});
        let observed=false;
        for(let i=0;i<65;i++){
          const stat=await pool.query("SELECT COUNT(*) AS waiting FROM pg_stat_activity WHERE application_name='inventory_862_isolated_QA' AND wait_event_type='Lock' AND state='active' AND query LIKE '%FROM inventory WHERE id=%FOR UPDATE%'");
          if(Number(stat.rows[0].waiting)>0){observed=true;break}
          await sleep(60);
        }
        await blocker.query('COMMIT');began=false;
        await Promise.all([first,second]);
        assert.equal(observed,true,'expected real lock in pg_stat_activity');
        assert.equal(preflights.length,1);
        const corrected=await pool.query('SELECT quantity FROM inventory_location_balances WHERE inventory_id=2001');
        assert.equal(Number(corrected.rows[0].quantity),9);
        const a=await pool.query('SELECT SUM(quantity) AS total FROM inventory_location_balances WHERE business_id=1');
        assert.equal(Number(a.rows[0].total),3000);
        t.diagnostic('real row lock observed and business B repaired without changing business A');
      }finally{
        if(began)await blocker.query('ROLLBACK').catch(()=>{});
        blocker.release();
      }
    });

    await t.test('uncommitted stock plus allocation writer leaves reads on one committed snapshot',async()=>{
      // A real writer holds both row locks until COMMIT. A read-only preflight must
      // see the previous committed pair without blocking or triggering repair.
      const writer=await pool.connect();
      let inTransaction=false,timeoutId;
      const snapshots=[],sqlMillis=[];
      const observed={async query(sql,args=[]){
        const started=performance.now();
        const result=await pool.query(sql,args);
        sqlMillis.push(Math.round((performance.now()-started)*1000)/1000);
        if(sql.startsWith('SELECT i.id,i.quantity')){
          const row=result.rows.find(item=>Number(item.id)===2001);
          assert.ok(row,'expected isolated business B item');
          snapshots.push([Number(row.quantity),Number(row.allocated)]);
        }
        return result;
      }};
      try{
        await writer.query('BEGIN');inTransaction=true;
        await writer.query('UPDATE inventory SET quantity=11 WHERE id=2001 AND business_id=2');
        await writer.query('UPDATE inventory_location_balances SET quantity=11 WHERE business_id=2 AND inventory_id=2001');
        await Promise.race([
          reconcileBusinessInventoryLocationsForRead(observed,{businessId:2}),
          new Promise((_,reject)=>{timeoutId=setTimeout(()=>reject(new Error('clean preflight blocked behind uncommitted writer')),3500)})
        ]);
        clearTimeout(timeoutId);timeoutId=null;
        assert.deepEqual(snapshots,[[9,9]],'one MVCC statement must see old committed stock and allocation');
        assert.equal(sqlMillis.length,3,'no locked repair during uncommitted consistent update');
        await writer.query('COMMIT');inTransaction=false;
        await reconcileBusinessInventoryLocationsForRead(observed,{businessId:2});
        assert.deepEqual(snapshots,[[9,9],[11,11]],'subsequent GET observes both committed changes');
        assert.equal(sqlMillis.length,6,'no cached preflight and no repair of valid committed stock');
        const a=await pool.query('SELECT SUM(quantity) AS total FROM inventory_location_balances WHERE business_id=1');
        assert.equal(Number(a.rows[0].total),3000,'other tenant is untouched');
        t.diagnostic('real PostgreSQL uncommitted writer: old/new MVCC pairs verified; per-statement read times (ms) '+JSON.stringify(sqlMillis));
      }finally{
        clearTimeout(timeoutId);
        if(inTransaction)await writer.query('ROLLBACK').catch(()=>{});
        writer.release();
      }
      // Restore the original synthetic fixture for the following supply-lot case.
      await pool.query('UPDATE inventory SET quantity=9 WHERE id=2001 AND business_id=2');
      await pool.query('UPDATE inventory_location_balances SET quantity=9 WHERE business_id=2 AND inventory_id=2001');
    });

    await t.test('real supply-lot drift repair remains tenant-scoped and a settled repeat read is bounded',async()=>{
      // The generic clean-path scenarios intentionally start without supply_lots.
      // This final subtest covers the actual PostgreSQL lot and lot-balance joins.
      await pool.query("CREATE TABLE supply_lots (id BIGINT PRIMARY KEY,business_id BIGINT NOT NULL,inventory_id BIGINT NOT NULL,quantity_remaining_base NUMERIC(16,6) NOT NULL)");
      await pool.query("CREATE TABLE inventory_lot_location_balances (business_id BIGINT NOT NULL,inventory_id BIGINT NOT NULL,lot_id BIGINT NOT NULL,location_id BIGINT NOT NULL,quantity NUMERIC(16,6) NOT NULL DEFAULT 0,updated_at TIMESTAMPTZ DEFAULT NOW(),PRIMARY KEY(lot_id,location_id))");
      await pool.query("INSERT INTO supply_lots(id,business_id,inventory_id,quantity_remaining_base) VALUES (1001,1,1,2),(2001,2,2001,2)");
      await pool.query("INSERT INTO inventory_lot_location_balances(business_id,inventory_id,lot_id,location_id,quantity) VALUES (1,1,1001,100,2),(2,2001,2001,200,1)");

      const repairSql=[];
      const counted={async query(sql,args=[]){repairSql.push({sql,args});return pool.query(sql,args)}};
      await reconcileBusinessInventoryLocationsForRead(counted,{businessId:2});
      assert.equal(repairSql.filter(x=>x.sql.startsWith('SELECT id FROM inventory WHERE business_id=$1 ORDER BY id')).length,1,'lot drift must use canonical locked reconciler');
      const b=await pool.query('SELECT quantity FROM inventory_lot_location_balances WHERE lot_id=2001');
      const a=await pool.query('SELECT quantity FROM inventory_lot_location_balances WHERE lot_id=1001');
      assert.equal(Number(b.rows[0].quantity),2,'same-business lot drift was repaired');
      assert.equal(Number(a.rows[0].quantity),2,'business A lot remained unchanged');

      const cleanSql=[];
      const settled={async query(sql,args=[]){cleanSql.push({sql,args});return pool.query(sql,args)}};
      await reconcileBusinessInventoryLocationsForRead(settled,{businessId:2});
      assert.equal(cleanSql.length,4,'clean lot inventory should need four read-only SQL queries');
      assert.ok(cleanSql.every(({sql})=>sql.trimStart().startsWith('SELECT')&&!sql.includes('FOR UPDATE')),'clean preflight must not request row locks');
      assert.ok(cleanSql.filter(x=>x.args?.length).every(x=>x.args[0]===2),'preflight binds the originating business');
      t.diagnostic('real PostgreSQL supply lots: B drift repaired, A unchanged, clean repeat 4 SELECTs');
    });

  }finally{await pool.end()}
});
