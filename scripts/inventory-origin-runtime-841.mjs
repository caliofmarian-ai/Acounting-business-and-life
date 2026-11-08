import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import {exerciseInventoryOrigin841} from '../qa-inventory-origin-841.js';

if(process.env.ABL_INVENTORY_ORIGIN_CI!=='1'||process.env.NODE_ENV!=='test'||
   process.env.PGDATABASE!=='abl_admin_ci'||process.env.PGHOST!=='127.0.0.1'||
   process.env.PAYMONGO_MODE!=='sandbox'||!process.env.TOKEN_SECRET)
  throw new Error('Inventory 841 requires disposable localhost CI PostgreSQL');
const pool=new pg.Pool({max:8});
const sessionId='ci-inventory841-'+crypto.randomUUID();
let locker;
try{
  await pool.query("UPDATE accounts SET email_verified_at=NOW(),active_role='merchant' WHERE id=1");
  await pool.query("UPDATE profiles SET enabled=TRUE,status='active' WHERE account_id=1 AND role='merchant'");
  await pool.query("INSERT INTO account_sessions(session_id,account_id,expires_at,user_agent,ip_hash) VALUES($1,1,NOW()+INTERVAL '30 minutes','ci-inventory841','synthetic')",[sessionId]);
  const raw=['v2',Date.now(),'1',sessionId].join('.');
  const token=raw+'.'+crypto.createHmac('sha256',process.env.TOKEN_SECRET).update(raw).digest('hex');
  const result=await exerciseInventoryOrigin841({pool,base:'http://127.0.0.1:3000',token,accountId:1,
    async beforePurchase({a,b,call,body}){
      locker=await pool.connect();
      await locker.query('BEGIN');
      await locker.query('LOCK TABLE profile_business_bindings IN ACCESS EXCLUSIVE MODE');
      const request=call('/api/inventory/purchase',{method:'POST',origin:a,body});
      request.catch(()=>{});
      let waiting=false;
      for(let i=0;i<160;i++){
        const blocked=await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%profile_business_bindings%' AND pid<>pg_backend_pid()");
        if(blocked.rowCount){waiting=true;break}
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      if(!waiting){
        await locker.query('ROLLBACK');locker.release();locker=null;
        await request.catch(()=>{});
        assert.fail('actual HTTP auth/context resolution did not wait on real PostgreSQL binding lock');
      }
      await locker.query("UPDATE account_business_preferences SET business_id=$2 WHERE account_id=$1 AND role='merchant'",[1,b]);
      await locker.query('COMMIT');locker.release();locker=null;
      return await request;
    }
  });
  const left=await pool.query("SELECT id FROM businesses WHERE name LIKE 'QA Inventory origin 841 %'");
  assert.equal(left.rowCount,0,'private fixture businesses removed');
  console.log('INVENTORY_ORIGIN_HTTP_POSTGRES_841_PASS '+JSON.stringify({...result,
    real_postgres_lock_observed:true,synthetic_ci_principal:true,physical_android:false}));
}finally{
  if(locker){await locker.query('ROLLBACK');locker.release()}
  await pool.query('DELETE FROM account_sessions WHERE session_id=$1',[sessionId]);
  await pool.end();
}
