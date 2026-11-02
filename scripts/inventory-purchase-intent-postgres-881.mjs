// Real PostgreSQL only, disposable database and synthetic actors. No app route
// is mounted; this contract is intentionally not a Production fix on its own.
import assert from 'node:assert/strict';
import pg from 'pg';
import {
  INVENTORY_PURCHASE_INTENT_SCHEMA,
  claimInventoryPurchaseIntent,
  finishInventoryPurchaseIntent,
  lockInventoryPurchaseBusiness
} from '../inventory-purchase-intent-core.js';

if(process.env.NODE_ENV!=='test' || process.env.ABL_PURCHASE_INTENT_CI!=='1' ||
   process.env.PGHOST!=='127.0.0.1' || process.env.PGDATABASE!=='abl_purchase_intent_ci'){
  throw new Error('Only an isolated loopback PostgreSQL CI database is permitted');
}
const pool=new pg.Pool({max:8,connectionTimeoutMillis:5000});
const payload={item:'Beans',quantity:2,cost:'12.50',account:'cash'};
const key='b1234567-0000-4000-9000-123456789012';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let checks=0;
function eq(x,y,label){assert.equal(x,y,label);checks++}
const params=(businessId,intentKey,body=payload)=>({
  businessId,accountId:501,intentKey,payload:body
});
async function post(client,businessId,intentKey,body=payload){
  await client.query('BEGIN');
  try{
    const claim=await claimInventoryPurchaseIntent(client,params(businessId,intentKey,body));
    if(claim.kind==='replay'){await client.query('COMMIT');return claim}
    await lockInventoryPurchaseBusiness(client,businessId);
    const old=await client.query(
      'SELECT * FROM inventory WHERE business_id=$1 AND lower(item)=lower($2) FOR UPDATE',
      [businessId,body.item]);
    let inventoryId;
    if(old.rowCount){
      inventoryId=old.rows[0].id;
      await client.query('UPDATE inventory SET quantity=quantity+$1 WHERE id=$2',
        [body.quantity,inventoryId]);
    }else{
      inventoryId=(await client.query(
        'INSERT INTO inventory(business_id,item,quantity) VALUES($1,$2,$3) RETURNING id',
        [businessId,body.item,body.quantity])).rows[0].id;
    }
    const purchase=(await client.query(
      'INSERT INTO inventory_purchases(business_id,inventory_id) VALUES($1,$2) RETURNING id',
      [businessId,inventoryId])).rows[0];
    const lot=(await client.query(
      'INSERT INTO synthetic_lots(purchase_id) VALUES($1) RETURNING id',[purchase.id])).rows[0];
    const expense=(await client.query(
      'INSERT INTO synthetic_expenses(purchase_id) VALUES($1) RETURNING id',[purchase.id])).rows[0];
    const response={inventory:{id:inventoryId},purchase,lot,transaction:expense};
    await finishInventoryPurchaseIntent(client,{businessId,accountId:501,intentKey,
      purchaseId:purchase.id,response});
    await client.query('COMMIT');
    return{kind:'new',response};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
}

try{
  eq((await pool.query('SELECT current_database() AS db')).rows[0].db,
    'abl_purchase_intent_ci','correct disposable database');
  await pool.query('CREATE TABLE businesses(id BIGINT PRIMARY KEY);'+
    'CREATE TABLE accounts(id BIGINT PRIMARY KEY);'+
    'CREATE TABLE inventory(id BIGSERIAL PRIMARY KEY,business_id BIGINT REFERENCES businesses(id),'+
       'item TEXT NOT NULL,quantity NUMERIC(14,4) NOT NULL);'+
    'CREATE UNIQUE INDEX inventory_business_item_unique ON inventory(business_id,item);'+
    'CREATE TABLE inventory_purchases(id BIGSERIAL PRIMARY KEY,'+
      'business_id BIGINT REFERENCES businesses(id),inventory_id BIGINT REFERENCES inventory(id));'+
    'CREATE TABLE synthetic_lots(id BIGSERIAL PRIMARY KEY,purchase_id BIGINT REFERENCES inventory_purchases(id));'+
    'CREATE TABLE synthetic_expenses(id BIGSERIAL PRIMARY KEY,purchase_id BIGINT REFERENCES inventory_purchases(id));'+
    'INSERT INTO businesses VALUES(101),(102); INSERT INTO accounts VALUES(501),(502)');
  await pool.query(INVENTORY_PURCHASE_INTENT_SCHEMA);
  const a=await pool.connect(),b=await pool.connect();
  try{
    // Real blocking across two independent sessions, not a mocked adapter.
    await a.query('BEGIN');
    eq((await claimInventoryPurchaseIntent(a,params(101,key))).kind,'new',
      'first request reserves intent');
    await lockInventoryPurchaseBusiness(a,101);
    const inv=(await a.query(
      "INSERT INTO inventory(business_id,item,quantity) VALUES(101,'Beans',2) RETURNING id")).rows[0];
    const p=(await a.query(
      'INSERT INTO inventory_purchases(business_id,inventory_id) VALUES(101,$1) RETURNING id',
      [inv.id])).rows[0];
    await a.query('INSERT INTO synthetic_lots(purchase_id) VALUES($1)',[p.id]);
    await a.query('INSERT INTO synthetic_expenses(purchase_id) VALUES($1)',[p.id]);
    let settled=false;
    const second=(async()=>{
      await b.query('BEGIN');
      const c=await claimInventoryPurchaseIntent(b,params(101,key,
        {account:'cash',cost:'12.50',quantity:2,item:'Beans'}));
      settled=true;
      await b.query('COMMIT');
      return c;
    })();
    await sleep(120);
    eq(settled,false,'second connection blocks until first COMMIT');
    await finishInventoryPurchaseIntent(a,{businessId:101,accountId:501,intentKey:key,
      purchaseId:p.id,response:{inventory:inv,purchase:p}});
    await a.query('COMMIT');
    const replay=await second;
    eq(replay.kind,'replay','same intent replays');
    eq(String(replay.response.purchase.id),String(p.id),'replay returns original purchase');
    eq((await pool.query('SELECT count(*)::int AS n FROM inventory_purchases')).rows[0].n,
      1,'one purchase');
    eq((await pool.query('SELECT count(*)::int AS n FROM synthetic_lots')).rows[0].n,
      1,'one lot');
    eq((await pool.query('SELECT count(*)::int AS n FROM synthetic_expenses')).rows[0].n,
      1,'one expense');

    await b.query('BEGIN');
    let conflicting=false;
    try{
      await claimInventoryPurchaseIntent(b,params(101,key,{...payload,cost:'13.00'}));
    }catch(e){conflicting=e.status===409}
    await b.query('ROLLBACK');
    eq(conflicting,true,'same key with new price rejected');

    const distinct=await post(a,101,'c1234567-0000-4000-9000-123456789012',
      {...payload,item:'beans'});
    eq(distinct.kind,'new','distinct intent succeeds');
    eq((await pool.query("SELECT count(*)::int AS n FROM inventory WHERE business_id=101 AND lower(item)='beans'")).rows[0].n,
      1,'case-insensitive first-time item shares one row');
    eq(Number((await pool.query('SELECT quantity FROM inventory WHERE business_id=101')).rows[0].quantity),
      4,'two distinct purchases both increment stock');

    // The original Production defect concerned two DIFFERENT legitimate
    // purchase intents creating the same new item. The same-key replay test
    // above cannot prove this cross-intent missing-row/unique-index race.
    // Observe a real second PostgreSQL backend waiting on the business lock
    // while the first purchase has NOT yet committed its fresh item.
    const concurrentItem='CI parallel herb 881';
    const firstBody={...payload,item:concurrentItem,quantity:2};
    const secondBody={...payload,item:concurrentItem,quantity:3};
    const firstKey='e1234567-0000-4000-9000-123456789012';
    const secondKey='f1234567-0000-4000-9000-123456789012';
    let firstTransactionOpen=false,secondPurchase=null;
    try{
      await a.query('BEGIN');
      firstTransactionOpen=true;
      eq((await claimInventoryPurchaseIntent(a,params(101,firstKey,firstBody))).kind,
        'new','first distinct intent reserves its own key');
      await lockInventoryPurchaseBusiness(a,101);
      const priorItem=await a.query(
        'SELECT id FROM inventory WHERE business_id=$1 AND item=$2',
        [101,concurrentItem]);
      eq(priorItem.rowCount,0,'parallel first-item fixture genuinely starts absent');
      const secondPid=Number((await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      secondPurchase=post(b,101,secondKey,secondBody);
      let observedWait=false;
      for(let attempt=0;attempt<150;attempt++){
        const observed=await pool.query(
          'SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE pid=$1',
          [secondPid]);
        if(observed.rows[0]?.wait_event_type==='Lock'&&
           observed.rows[0]?.wait_event==='advisory'){
          observedWait=true;
          break;
        }
        await sleep(25);
      }
      // The second caller is blocked BEFORE its missing-row lookup, so the
      // first caller can create and commit its own unique inventory row.
      const createdItem=(await a.query(
        'INSERT INTO inventory(business_id,item,quantity) VALUES($1,$2,$3) RETURNING id',
        [101,concurrentItem,2])).rows[0];
      const firstPurchase=(await a.query(
        'INSERT INTO inventory_purchases(business_id,inventory_id) VALUES($1,$2) RETURNING id',
        [101,createdItem.id])).rows[0];
      await a.query('INSERT INTO synthetic_lots(purchase_id) VALUES($1)',[firstPurchase.id]);
      await a.query('INSERT INTO synthetic_expenses(purchase_id) VALUES($1)',[firstPurchase.id]);
      await finishInventoryPurchaseIntent(a,{businessId:101,accountId:501,
        intentKey:firstKey,purchaseId:firstPurchase.id,
        response:{inventory:createdItem,purchase:firstPurchase}});
      await a.query('COMMIT');
      firstTransactionOpen=false;
      const secondResult=await secondPurchase;
      eq(observedWait,true,'distinct-key concurrent purchase waited on actual PostgreSQL business advisory lock');
      eq(secondResult.kind,'new','different intent posts a second legitimate purchase');
      const itemRows=await pool.query(
        'SELECT id,quantity FROM inventory WHERE business_id=$1 AND item=$2',
        [101,concurrentItem]);
      eq(itemRows.rowCount,1,'two simultaneous distinct intents share exactly one inventory item');
      eq(Number(itemRows.rows[0].quantity),5,'both distinct purchase quantities are retained');
      const [purchaseCount,lotCount,expenseCount]=await Promise.all([
        pool.query('SELECT COUNT(*)::int AS n FROM inventory_purchases WHERE inventory_id=$1',
          [itemRows.rows[0].id]),
        pool.query('SELECT COUNT(*)::int AS n FROM synthetic_lots WHERE purchase_id IN (SELECT id FROM inventory_purchases WHERE inventory_id=$1)',
          [itemRows.rows[0].id]),
        pool.query('SELECT COUNT(*)::int AS n FROM synthetic_expenses WHERE purchase_id IN (SELECT id FROM inventory_purchases WHERE inventory_id=$1)',
          [itemRows.rows[0].id])
      ]);
      eq(purchaseCount.rows[0].n,2,'both legitimate purchase records committed');
      eq(lotCount.rows[0].n,2,'each concurrent purchase has one real PostgreSQL test lot');
      eq(expenseCount.rows[0].n,2,'each concurrent purchase has one test expense, without duplicates');
    }finally{
      if(firstTransactionOpen)await a.query('ROLLBACK').catch(()=>{});
      if(secondPurchase)await secondPurchase.catch(()=>{});
    }

    const rolledKey='d1234567-0000-4000-9000-123456789012';
    await a.query('BEGIN');
    eq((await claimInventoryPurchaseIntent(a,params(101,rolledKey))).kind,'new',
      'reserve rollback intent');
    await a.query('INSERT INTO inventory_purchases(business_id,inventory_id) VALUES(101,$1)',
      [inv.id]);
    await a.query('ROLLBACK');
    eq((await pool.query('SELECT count(*)::int AS n FROM inventory_purchase_intents WHERE intent_key=$1',
      [rolledKey])).rows[0].n,0,'rollback deletes reservation');
    eq((await post(a,101,rolledKey)).kind,'new','retry after rollback succeeds');

    await a.query('BEGIN');
    await lockInventoryPurchaseBusiness(a,101);
    await b.query('BEGIN');
    await Promise.race([
      lockInventoryPurchaseBusiness(b,102),
      sleep(1200).then(()=>{throw new Error('different-business lock blocked')})
    ]);
    checks++;
    await b.query('ROLLBACK');
    await a.query('ROLLBACK');
    const foreign=await post(a,102,key);
    eq(foreign.kind,'new','same key separate business not replayed');
    eq((await pool.query('SELECT count(*)::int AS n FROM inventory_purchase_intents WHERE intent_key=$1',
      [key])).rows[0].n,2,'keys are business/account scoped');
    // A transaction that reserves an intent but forgets to finish it must
    // fail at the real PostgreSQL COMMIT, not poison the key for future retry.
    const incompleteKey='11234567-0000-4000-9000-123456789012';
    await a.query('BEGIN');
    eq((await claimInventoryPurchaseIntent(a,params(101,incompleteKey))).kind,
      'new','incomplete test intent reserved within transaction');
    let incompleteError=null;
    try{await a.query('COMMIT')}catch(error){incompleteError=error}
    eq(incompleteError?.code,'23514','incomplete intent COMMIT fails with check violation');
    eq(incompleteError?.constraint,'inventory_purchase_intents_complete_commit',
      'deferred trigger identifies the rejected incomplete commit');
    eq((await pool.query('SELECT count(*)::int AS n FROM inventory_purchase_intents WHERE intent_key=$1',
      [incompleteKey])).rows[0].n,0,'failed commit rolls back the incomplete reservation');
    eq((await post(a,101,incompleteKey)).kind,'new',
      'retry after an incomplete-commit rollback can post normally');

    // A valid purchase from business 102 must not be linkable to an intent
    // owned by business 101. PostgreSQL enforces this at the UPDATE itself.
    const foreignKey='21234567-0000-4000-9000-123456789012';
    await a.query('BEGIN');
    eq((await claimInventoryPurchaseIntent(a,params(101,foreignKey))).kind,
      'new','cross-business fixture reserves a fresh local intent');
    let crossBusinessError=null;
    try{
      await finishInventoryPurchaseIntent(a,{
        businessId:101,accountId:501,intentKey:foreignKey,
        purchaseId:foreign.response.purchase.id,
        response:{purchase:{id:foreign.response.purchase.id}}
      });
    }catch(error){crossBusinessError=error}
    eq(crossBusinessError?.code,'INVENTORY_PURCHASE_INTENT_CONFLICT',
      'foreign business purchase cannot complete local intent');
    await a.query('ROLLBACK');
    eq((await pool.query('SELECT count(*)::int AS n FROM inventory_purchase_intents WHERE intent_key=$1',
      [foreignKey])).rows[0].n,0,'foreign association never commits');

    console.log(JSON.stringify({ok:true,realPostgresAssertions:checks,
      isolatedDb:'abl_purchase_intent_ci',liveRouteIntegrated:false}));
  }finally{a.release();b.release()}
}finally{await pool.end()}
