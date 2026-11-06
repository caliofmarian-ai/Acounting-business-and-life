// Real PostgreSQL only, disposable database and synthetic actors. No app route
// is mounted; this contract is intentionally not a Production fix on its own.
import assert from 'node:assert/strict';
import pg from 'pg';
import {
  INVENTORY_PURCHASE_INTENT_SCHEMA,
  claimInventoryPurchaseIntent,
  finishInventoryPurchaseIntent,
  lockInventoryPurchaseBusiness,executeInventoryPurchaseIntent,inspectInventoryPurchaseIntent
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
  businessId,accountId:501,intentKey,payload:body,
  // A real PostgreSQL authorization lock protects against permission
  // revocation after waiting for an Inventory business or intent lock.
  // This is a synthetic fixture, never a real Merchant membership grant.
  verifyCurrentMerchantAuthority:async(tx,ctx)=>{
    const grant=await tx.query(
      'SELECT enabled FROM synthetic_purchase_grants WHERE business_id=$1 AND account_id=$2 FOR SHARE',
      [ctx.businessId,ctx.accountId]);
    return grant.rowCount===1&&grant.rows[0].enabled===true;
  }
});
async function post(client,businessId,intentKey,body=payload){
  // Exercise the same transaction coordinator that the later authorized
  // Express integration must invoke; no isolated test-only BEGIN/COMMIT path.
  return executeInventoryPurchaseIntent(client,params(businessId,intentKey,body),async tx=>{
    const old=await tx.query(
      'SELECT * FROM inventory WHERE business_id=$1 AND lower(item)=lower($2) FOR UPDATE',
      [businessId,body.item]);
    let inventoryId;
    if(old.rowCount){
      inventoryId=old.rows[0].id;
      await tx.query('UPDATE inventory SET quantity=quantity+$1 WHERE id=$2',
        [body.quantity,inventoryId]);
    }else{
      inventoryId=(await tx.query(
        'INSERT INTO inventory(business_id,item,quantity) VALUES($1,$2,$3) RETURNING id',
        [businessId,body.item,body.quantity])).rows[0].id;
    }
    const purchase=(await tx.query(
      'INSERT INTO inventory_purchases(business_id,inventory_id) VALUES($1,$2) RETURNING id',
      [businessId,inventoryId])).rows[0];
    const lot=(await tx.query(
      'INSERT INTO synthetic_lots(purchase_id) VALUES($1) RETURNING id',[purchase.id])).rows[0];
    const expense=(await tx.query(
      'INSERT INTO synthetic_expenses(purchase_id) VALUES($1) RETURNING id',[purchase.id])).rows[0];
    return{purchaseId:purchase.id,
      response:{inventory:{id:inventoryId},purchase,lot,transaction:expense}};
  });
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
    'CREATE TABLE synthetic_purchase_grants(business_id BIGINT REFERENCES businesses(id),'+
      'account_id BIGINT REFERENCES accounts(id),enabled BOOLEAN NOT NULL,'+
      'PRIMARY KEY(business_id,account_id));'+
    'INSERT INTO businesses VALUES(101),(102); INSERT INTO accounts VALUES(501),(502);'+
    'INSERT INTO synthetic_purchase_grants VALUES(101,501,true),(102,501,true)');
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

    // A completed intent is permanent private economic evidence. Rewriting the
    // fingerprint, purchase link or replay JSON after COMMIT would silently
    // change the meaning of a later same-key retry. Exercise real PG triggers.
    const savedIntent=await pool.query(
      'SELECT payload_sha256,purchase_id,response_json::text AS response_text,committed_at FROM inventory_purchase_intents WHERE business_id=101 AND account_id=501 AND intent_key=$1',
      [key]);
    eq(savedIntent.rowCount,1,'original completed intent is present for tamper check');
    const immutableChanges=[
      ['payload fingerprint',"payload_sha256=repeat('0',64)"],
      ['source purchase','purchase_id=NULL'],
      ['replay snapshot',"response_json='{}'::jsonb"],
      ['commit timestamp','committed_at=NULL'],
      ['idempotency key',"intent_key='different-committed-key-881'"]
    ];
    for(const [label,change] of immutableChanges){
      let denied=null;
      try{
        await pool.query(
          'UPDATE inventory_purchase_intents SET '+change+
          ' WHERE business_id=101 AND account_id=501 AND intent_key=$1',[key]);
      }catch(error){denied=error}
      eq(denied?.code,'23514',label+' cannot rewrite completed intent');
      eq(denied?.constraint,'inventory_purchase_intent_immutable',
        label+' rejected by the immutable committed-evidence trigger');
    }
    const afterTamper=await pool.query(
      'SELECT payload_sha256,purchase_id,response_json::text AS response_text,committed_at FROM inventory_purchase_intents WHERE business_id=101 AND account_id=501 AND intent_key=$1',
      [key]);
    eq(afterTamper.rowCount,1,'original intent key remains present');
    eq(afterTamper.rows[0].payload_sha256,savedIntent.rows[0].payload_sha256,
      'original payload fingerprint remains intact');
    eq(String(afterTamper.rows[0].purchase_id),String(savedIntent.rows[0].purchase_id),
      'original purchase provenance remains intact');
    eq(afterTamper.rows[0].response_text,savedIntent.rows[0].response_text,
      'original response JSON remains intact');
    eq(afterTamper.rows[0].committed_at.getTime(),savedIntent.rows[0].committed_at.getTime(),
      'original completed timestamp remains intact');
    const immutableReplay=await post(a,101,key);
    eq(immutableReplay.kind,'replay','immutable committed evidence still replays');
    eq(String(immutableReplay.purchaseId),String(p.id),
      'post-tamper replay preserves original purchase identifier');

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

    // A callback failure after writing a fresh item must atomically erase the
    // item, reservation and every ledger effect. The same literal key can then
    // complete one legitimate purchase via the transaction coordinator.
    const callbackKey='31234567-0000-4000-9000-123456789012';
    const callbackBody={...payload,item:'Synthetic rollback item 881'};
    let callbackFailure=null;
    try{
      await executeInventoryPurchaseIntent(a,params(101,callbackKey,callbackBody),async tx=>{
        await tx.query(
          'INSERT INTO inventory(business_id,item,quantity) VALUES($1,$2,$3)',
          [101,callbackBody.item,callbackBody.quantity]);
        throw new Error('synthetic failure after stock write');
      });
    }catch(error){callbackFailure=error}
    eq(callbackFailure?.message,'synthetic failure after stock write',
      'failed callback surfaces original error');
    eq((await pool.query(
      'SELECT count(*)::int AS n FROM inventory WHERE business_id=$1 AND item=$2',
      [101,callbackBody.item])).rows[0].n,0,'callback rollback erases inserted item');
    eq((await pool.query(
      'SELECT count(*)::int AS n FROM inventory_purchase_intents WHERE intent_key=$1',
      [callbackKey])).rows[0].n,0,'callback rollback erases intent reservation');
    const callbackRetry=await post(a,101,callbackKey,callbackBody);
    eq(callbackRetry.kind,'new','same key succeeds once after callback rollback');
    const priorPurchases=(await pool.query(
      'SELECT count(*)::int AS n FROM inventory_purchases WHERE business_id=101')).rows[0].n;
    const secondRetry=await post(a,101,callbackKey,callbackBody);
    eq(secondRetry.kind,'replay','second retry returns stored committed result');
    eq(String(secondRetry.response.purchase.id),String(callbackRetry.response.purchase.id),
      'replay retains original purchase ID through transaction coordinator');
    eq((await pool.query(
      'SELECT count(*)::int AS n FROM inventory_purchases WHERE business_id=101')).rows[0].n,
      priorPurchases,'replay did not insert another purchase');
    eq((await pool.query(
      'SELECT count(*)::int AS n FROM synthetic_expenses')).rows[0].n,
      priorPurchases+1,'replay did not insert another linked business expense');

    // A callback may create all underlying rows but accidentally return the
    // ID of another purchase. Never COMMIT this inconsistent replay snapshot:
    // roll back the fresh item, purchase, lot, expense and intent together.
    const mismatchKey='41234567-0000-4000-9000-123456789012';
    const mismatchBody={...payload,item:'Synthetic mismatched response 881'};
    const beforeMismatch=await Promise.all([
      pool.query('SELECT count(*)::int AS n FROM inventory_purchases'),
      pool.query('SELECT count(*)::int AS n FROM synthetic_lots'),
      pool.query('SELECT count(*)::int AS n FROM synthetic_expenses')
    ]);
    let mismatchError=null;
    try{
      await executeInventoryPurchaseIntent(a,params(101,mismatchKey,mismatchBody),async tx=>{
        const item=(await tx.query(
          'INSERT INTO inventory(business_id,item,quantity) VALUES($1,$2,$3) RETURNING id',
          [101,mismatchBody.item,mismatchBody.quantity])).rows[0];
        const purchase=(await tx.query(
          'INSERT INTO inventory_purchases(business_id,inventory_id) VALUES($1,$2) RETURNING id',
          [101,item.id])).rows[0];
        await tx.query('INSERT INTO synthetic_lots(purchase_id) VALUES($1)',[purchase.id]);
        await tx.query('INSERT INTO synthetic_expenses(purchase_id) VALUES($1)',[purchase.id]);
        return{purchaseId:purchase.id,response:{purchase:{id:(BigInt(purchase.id)+1n).toString()}}};
      });
    }catch(error){mismatchError=error}
    eq(mismatchError?.code,'INVENTORY_PURCHASE_INTENT_CONFLICT',
      'mismatched response ID fails before transaction COMMIT');
    eq((await pool.query('SELECT count(*)::int AS n FROM inventory WHERE business_id=$1 AND item=$2',
      [101,mismatchBody.item])).rows[0].n,0,'inconsistent response rolls back stock');
    eq((await pool.query('SELECT count(*)::int AS n FROM inventory_purchase_intents WHERE intent_key=$1',
      [mismatchKey])).rows[0].n,0,'inconsistent response rolls back intent');
    const afterMismatch=await Promise.all([
      pool.query('SELECT count(*)::int AS n FROM inventory_purchases'),
      pool.query('SELECT count(*)::int AS n FROM synthetic_lots'),
      pool.query('SELECT count(*)::int AS n FROM synthetic_expenses')
    ]);
    for(let i=0;i<3;i++)eq(afterMismatch[i].rows[0].n,beforeMismatch[i].rows[0].n,
      'inconsistent response does not commit purchase/lot/expense '+i);
    const corrected=await post(a,101,mismatchKey,mismatchBody);
    eq(corrected.kind,'new','same key can complete a valid purchase after full rollback');
    const correctedReplay=await post(a,101,mismatchKey,mismatchBody);
    eq(correctedReplay.kind,'replay','successful corrected purchase replays without a second write');
    eq(String(correctedReplay.response.purchase.id),String(corrected.response.purchase.id),
      'replay purchase ID matches the recorded purchase');


    // Check the actual serialized response, not only its in-memory ID.
    // A callback can return a response whose nested toJSON changes purchase
    // identity after preliminary validation. This must roll back all effects.
    const serializedKey='51234567-0000-4000-9000-123456789012';
    const serializedBody={...payload,item:'Synthetic serialized identity 881'};
    const beforeSerialized=await Promise.all([
      pool.query('SELECT count(*)::int AS n FROM inventory_purchases'),
      pool.query('SELECT count(*)::int AS n FROM synthetic_lots'),
      pool.query('SELECT count(*)::int AS n FROM synthetic_expenses')
    ]);
    let serializedError=null;
    try{
      await executeInventoryPurchaseIntent(a,params(101,serializedKey,serializedBody),async tx=>{
        const item=(await tx.query(
          'INSERT INTO inventory(business_id,item,quantity) VALUES($1,$2,$3) RETURNING id',
          [101,serializedBody.item,serializedBody.quantity])).rows[0];
        const purchase=(await tx.query(
          'INSERT INTO inventory_purchases(business_id,inventory_id) VALUES($1,$2) RETURNING id',
          [101,item.id])).rows[0];
        await tx.query('INSERT INTO synthetic_lots(purchase_id) VALUES($1)',[purchase.id]);
        await tx.query('INSERT INTO synthetic_expenses(purchase_id) VALUES($1)',[purchase.id]);
        return{purchaseId:purchase.id,response:{purchase:{
          id:purchase.id,toJSON(){return{id:'999999999'}}
        }}};
      });
    }catch(error){serializedError=error}
    eq(serializedError?.code,'INVENTORY_PURCHASE_INTENT_CONFLICT',
      'serialized purchase ID mismatch is rejected inside the DB transaction');
    eq((await pool.query('SELECT count(*)::int AS n FROM inventory WHERE business_id=$1 AND item=$2',
      [101,serializedBody.item])).rows[0].n,0,'serialized mismatch rolls back Inventory item');
    eq((await pool.query('SELECT count(*)::int AS n FROM inventory_purchase_intents WHERE intent_key=$1',
      [serializedKey])).rows[0].n,0,'serialized mismatch rolls back intent');
    const afterSerialized=await Promise.all([
      pool.query('SELECT count(*)::int AS n FROM inventory_purchases'),
      pool.query('SELECT count(*)::int AS n FROM synthetic_lots'),
      pool.query('SELECT count(*)::int AS n FROM synthetic_expenses')
    ]);
    for(let i=0;i<3;i++)eq(afterSerialized[i].rows[0].n,beforeSerialized[i].rows[0].n,
      'serialized mismatch rolls back purchase, lot and expense '+i);
    const serialRetry=await post(a,101,serializedKey,serializedBody);
    eq(serialRetry.kind,'new','same literal key safely retries after serialization rollback');
    const serialReplay=await post(a,101,serializedKey,serializedBody);
    eq(serialReplay.kind,'replay','safe retry commits one replayable snapshot');
    eq(String(serialReplay.response.purchase.id),String(serialRetry.response.purchase.id),
      'serialized response retry and replay share the same purchase identity');


    // Real disposable PostgreSQL COMMIT plus SYNTHETIC lost acknowledgement.
    // This is not a physical TCP disconnect or an HTTP/Preview acceptance test.
    const lostAckKey='81234567-0000-4000-9000-123456789012';
    const lostAckBody={...payload,item:'Synthetic lost commit ACK 881'};
    const beforeLostAck=await Promise.all([
      pool.query('SELECT count(*)::int AS n FROM inventory_purchases'),
      pool.query('SELECT count(*)::int AS n FROM synthetic_lots'),
      pool.query('SELECT count(*)::int AS n FROM synthetic_expenses')
    ]);
    let ackFaultInjected=false,lostAckError=null;
    const lostAckClient={query:async(...args)=>{
      const result=await a.query(...args);
      if(args[0]==='COMMIT'&&!ackFaultInjected){
        ackFaultInjected=true;
        throw Object.assign(new Error('Synthetic lost COMMIT acknowledgement'),{code:'ECONNRESET'});
      }
      return result;
    }};
    try{await post(lostAckClient,101,lostAckKey,lostAckBody)}
    catch(error){lostAckError=error}
    eq(ackFaultInjected,true,'acknowledgement fault occurs AFTER actual PostgreSQL COMMIT');
    eq(lostAckError?.code,'INVENTORY_PURCHASE_INTENT_COMMIT_UNKNOWN',
      'durably committed purchase is classified as indeterminate');
    eq(lostAckError?.cause?.code,'ECONNRESET','original injected cause is preserved');
    const durable=await pool.query(
      'SELECT i.id AS inventory_id,i.quantity,p.id AS purchase_id,'+
      'l.id AS lot_id,e.id AS expense_id,t.response_json AS replay_response '+
      'FROM inventory AS i JOIN inventory_purchases AS p ON p.inventory_id=i.id '+
      'JOIN synthetic_lots AS l ON l.purchase_id=p.id '+
      'JOIN synthetic_expenses AS e ON e.purchase_id=p.id '+
      'JOIN inventory_purchase_intents AS t ON t.purchase_id=p.id '+
      'WHERE i.business_id=$1 AND i.item=$2 AND t.intent_key=$3',
      [101,lostAckBody.item,lostAckKey]);
    eq(durable.rowCount,1,'real COMMIT stored one purchase, lot, expense and intent');
    eq(Number(durable.rows[0].quantity),lostAckBody.quantity,
      'real COMMIT stored original quantity once');
    eq(String(durable.rows[0].replay_response.purchase.id),
      String(durable.rows[0].purchase_id),'saved JSONB refers to original purchase');
    const afterCommit=await Promise.all([
      pool.query('SELECT count(*)::int AS n FROM inventory_purchases'),
      pool.query('SELECT count(*)::int AS n FROM synthetic_lots'),
      pool.query('SELECT count(*)::int AS n FROM synthetic_expenses')
    ]);
    for(let i=0;i<3;i++)eq(afterCommit[i].rows[0].n,beforeLostAck[i].rows[0].n+1,
      'one real PostgreSQL purchase/lot/expense write '+i);
    const replayAfterLostAck=await post(a,101,lostAckKey,lostAckBody);
    eq(replayAfterLostAck.kind,'replay','recovery uses saved intent, not new purchase');
    eq(String(replayAfterLostAck.response.purchase.id),String(durable.rows[0].purchase_id),
      'recovery returns original durable purchase ID');
    const afterReplay=await Promise.all([
      pool.query('SELECT count(*)::int AS n FROM inventory_purchases'),
      pool.query('SELECT count(*)::int AS n FROM synthetic_lots'),
      pool.query('SELECT count(*)::int AS n FROM synthetic_expenses'),
      pool.query('SELECT quantity FROM inventory WHERE id=$1',[durable.rows[0].inventory_id])
    ]);
    for(let i=0;i<3;i++)eq(afterReplay[i].rows[0].n,afterCommit[i].rows[0].n,
      'recovery does not duplicate economic record '+i);
    eq(Number(afterReplay[3].rows[0].quantity),lostAckBody.quantity,
      'recovery does not increment stock again');


    // Negative control: the wrapper throws BEFORE it sends COMMIT to real PG.
    // We know the disposable DB rolled back, but the HTTP caller must still
    // fail closed as COMMIT_UNKNOWN because it cannot infer this over a wire.
    const rejectedAckKey='91234567-0000-4000-9000-123456789012';
    const rejectedAckBody={...payload,item:'Synthetic pre-commit fault 881'};
    let refusedCommit=false,rejectedAckError=null;
    const rejectedCommitClient={query:async(...args)=>{
      if(args[0]==='COMMIT'){
        refusedCommit=true;
        throw Object.assign(new Error('Synthetic failure before COMMIT'),{code:'ECONNRESET'});
      }
      return a.query(...args);
    }};
    try{await post(rejectedCommitClient,101,rejectedAckKey,rejectedAckBody)}
    catch(error){rejectedAckError=error}
    eq(refusedCommit,true,'negative control intercepted COMMIT before PostgreSQL');
    eq(rejectedAckError?.code,'INVENTORY_PURCHASE_INTENT_COMMIT_UNKNOWN',
      'unacknowledged pre-commit failure remains conservative');
    eq((await pool.query(
      'SELECT count(*)::int AS n FROM inventory_purchase_intents WHERE intent_key=$1',
      [rejectedAckKey])).rows[0].n,0,
      'actual PostgreSQL ROLLBACK erased uncommitted intent');
    eq((await pool.query(
      'SELECT count(*)::int AS n FROM inventory WHERE business_id=$1 AND item=$2',
      [101,rejectedAckBody.item])).rows[0].n,0,
      'actual PostgreSQL ROLLBACK erased uncommitted stock');
    const rejectedRecovered=await post(a,101,rejectedAckKey,rejectedAckBody);
    eq(rejectedRecovered.kind,'new','rolled-back intent can safely post once with same key');
    const rejectedReplay=await post(a,101,rejectedAckKey,rejectedAckBody);
    eq(rejectedReplay.kind,'replay','second same-key call replays the newly durable purchase');
    eq(String(rejectedReplay.response.purchase.id),
      String(rejectedRecovered.response.purchase.id),
      'rolled-back recovery and replay preserve one purchase ID');

    // Verify authorization at the actual lock boundary, not from a cached
    // HTTP session that may have been revoked while PostgreSQL was waiting.
    const revokedKey='61234567-0000-4000-9000-123456789012';
    const revokedBody={...payload,item:'Synthetic revoked grant 881'};
    const stockBeforeRevoked=(await pool.query(
      'SELECT count(*)::int AS n FROM inventory WHERE business_id=101')).rows[0].n;
    await pool.query(
      'UPDATE synthetic_purchase_grants SET enabled=false WHERE business_id=101 AND account_id=501');
    let revokedNew=null;
    try{await post(a,101,revokedKey,revokedBody)}catch(error){revokedNew=error}
    eq(revokedNew?.code,'INVENTORY_PURCHASE_INTENT_FORBIDDEN',
      'revoked Merchant grant prevents new purchase after business lock');
    eq((await pool.query(
      'SELECT count(*)::int AS n FROM inventory_purchase_intents WHERE intent_key=$1',
      [revokedKey])).rows[0].n,0,'revoked grant rolls back new intent reservation');
    eq((await pool.query(
      'SELECT count(*)::int AS n FROM inventory WHERE business_id=101')).rows[0].n,
      stockBeforeRevoked,'revoked grant causes no new stock write');
    let revokedReplay=null;
    try{await post(a,101,callbackKey,callbackBody)}catch(error){revokedReplay=error}
    eq(revokedReplay?.code,'INVENTORY_PURCHASE_INTENT_FORBIDDEN',
      'revoked Merchant grant cannot retrieve previously committed purchase snapshot');
    await pool.query(
      'UPDATE synthetic_purchase_grants SET enabled=true WHERE business_id=101 AND account_id=501');
    const authorizedAfter=await post(a,101,revokedKey,revokedBody);
    eq(authorizedAfter.kind,'new','restored authorized Merchant can complete the same rolled-back key');
    const authorizedReplay=await post(a,101,revokedKey,revokedBody);
    eq(authorizedReplay.kind,'replay','authorized replay is still idempotent');

    // Put a real PostgreSQL advisory lock between HTTP's initial context
    // and the mutation. Revoke the grant WHILE the waiting connection is
    // blocked, then release the lock and assert no stock/expense/intent.
    const waitedKey='71234567-0000-4000-9000-123456789012';
    const waitedBody={...payload,item:'Synthetic revoked while waiting 881'};
    const blocker=await pool.connect();
    let blockedPromise=null,blockedError=null,observedWait=false;
    try{
      const pid=(await a.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await blocker.query('BEGIN');
      await lockInventoryPurchaseBusiness(blocker,101);
      blockedPromise=post(a,101,waitedKey,waitedBody).catch(error=>{blockedError=error});
      for(let i=0;i<40;i++){
        const status=await pool.query(
          'SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid]);
        if(status.rows[0]?.wait_event_type==='Lock'){observedWait=true;break}
        await sleep(50);
      }
      eq(observedWait,true,'purchase actually waits on a PostgreSQL advisory business lock');
      await pool.query(
        'UPDATE synthetic_purchase_grants SET enabled=false WHERE business_id=101 AND account_id=501');
    }finally{
      await blocker.query('ROLLBACK').catch(()=>{});
      blocker.release();
      if(blockedPromise)await blockedPromise;
    }
    eq(blockedError?.code,'INVENTORY_PURCHASE_INTENT_FORBIDDEN',
      'grant revoked DURING lock wait denies the resumed purchase');
    eq((await pool.query(
      'SELECT count(*)::int AS n FROM inventory_purchase_intents WHERE intent_key=$1',
      [waitedKey])).rows[0].n,0,'blocked revoked grant leaves no durable intent');
    eq((await pool.query(
      'SELECT count(*)::int AS n FROM inventory WHERE business_id=101 AND item=$1',
      [waitedBody.item])).rows[0].n,0,'blocked revoked grant leaves no stock');
    eq((await pool.query(
      'SELECT count(*)::int AS n FROM synthetic_expenses WHERE purchase_id IN ('+
      'SELECT id FROM inventory_purchases WHERE business_id=101 AND inventory_id IN ('+
      'SELECT id FROM inventory WHERE item=$1))',[waitedBody.item])).rows[0].n,0,
      'blocked revoked grant leaves no expense');
    await pool.query(
      'UPDATE synthetic_purchase_grants SET enabled=true WHERE business_id=101 AND account_id=501');

    // Actual PostgreSQL interleaving of mutable purchase provenance.
    // The new intent must hold a source-row lock through its COMMIT, and a
    // later owner change must make the old business replay fail closed.
    const originKey='a1234567-0000-4000-9000-123456789012';
    const originItem=(await pool.query(
      "INSERT INTO inventory(business_id,item,quantity) VALUES(101,'Origin lock 881',0) RETURNING id"
    )).rows[0];
    const originPurchase=(await pool.query(
      'INSERT INTO inventory_purchases(business_id,inventory_id) VALUES(101,$1) RETURNING id',
      [originItem.id])).rows[0];
    let inTx=false,move=null;
    try{
      await a.query('BEGIN');inTx=true;
      eq((await claimInventoryPurchaseIntent(a,params(101,originKey))).kind,'new',
        'new provenance intent reserved');
      await finishInventoryPurchaseIntent(a,{
        businessId:101,accountId:501,intentKey:originKey,purchaseId:originPurchase.id,
        response:{purchase:{id:originPurchase.id},transaction:{total:'0.00'}}
      });
      const moverPid=(await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      move=b.query('UPDATE inventory_purchases SET business_id=102 WHERE id=$1',
        [originPurchase.id]);
      let waiting=false;
      for(let i=0;i<40;i++){
        const state=await pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',
          [moverPid]);
        if(state.rows[0]?.wait_event_type==='Lock'){waiting=true;break}
        await sleep(50);
      }
      eq(waiting,true,'real PostgreSQL update waits on purchase ownership lock');
      await a.query('COMMIT');inTx=false;
      await move;move=null;
      let movedReplay=null;
      try{await post(a,101,originKey)}catch(e){movedReplay=e}
      eq(movedReplay?.status,409,'moved source purchase cannot replay original business response');
      await pool.query('UPDATE inventory_purchases SET business_id=101 WHERE id=$1',
        [originPurchase.id]);
      eq((await post(a,101,originKey)).kind,'replay',
        'original-business provenance restored permits exact response replay');
    }finally{
      if(inTx)await a.query('ROLLBACK').catch(()=>{});
      if(move)await move.catch(()=>{});
      await pool.query('UPDATE inventory_purchases SET business_id=101 WHERE id=$1',
        [originPurchase.id]).catch(()=>{});
    }

    // Real isolated PG reconciliation after the synthetic lost acknowledgement:
    // unlike a same-key POST, a missing key is never inserted or retried.
    const beforeInspect=(await pool.query(
      'SELECT count(*)::int AS n FROM inventory_purchase_intents')).rows[0].n;
    const beforeInspectPurchases=(await pool.query(
      'SELECT count(*)::int AS n FROM inventory_purchases')).rows[0].n;
    const seen=await inspectInventoryPurchaseIntent(a,params(101,lostAckKey,lostAckBody));
    eq(seen.kind,'committed','inspect confirms real durable purchase');
    eq(seen.safeToRetry,false,'confirmed result never requests new posting');
    eq(String(seen.purchaseId),String(durable.rows[0].purchase_id),
      'inspect returns original source purchase');
    const absent=await inspectInventoryPurchaseIntent(a,params(101,
      'b1234567-0000-4000-9000-123456789013',lostAckBody));
    eq(absent.kind,'unconfirmed','absent intent is ambiguous, not failed');
    eq(absent.safeToRetry,false,'missing key does not authorize retry');
    eq((await pool.query('SELECT count(*)::int AS n FROM inventory_purchase_intents')).rows[0].n,
      beforeInspect,'reconciliation cannot reserve an absent key');
    eq((await pool.query('SELECT count(*)::int AS n FROM inventory_purchases')).rows[0].n,
      beforeInspectPurchases,'reconciliation cannot create a purchase');
    let mismatch=null;
    try{await inspectInventoryPurchaseIntent(a,params(101,lostAckKey,{
      ...lostAckBody,cost:'12.51'}))}catch(error){mismatch=error}
    eq(mismatch?.code,'INVENTORY_PURCHASE_INTENT_CONFLICT',
      'reconciliation rejects changed paid instructions');
    await pool.query(
      'UPDATE synthetic_purchase_grants SET enabled=false WHERE business_id=101 AND account_id=501');
    let denied=null;
    try{await inspectInventoryPurchaseIntent(a,params(101,lostAckKey,lostAckBody))}
    catch(error){denied=error}
    eq(denied?.code,'INVENTORY_PURCHASE_INTENT_FORBIDDEN',
      'revoked Merchant cannot inspect private purchase');
    await pool.query(
      'UPDATE synthetic_purchase_grants SET enabled=true WHERE business_id=101 AND account_id=501');

    console.log(JSON.stringify({ok:true,realPostgresAssertions:checks,
      isolatedDb:'abl_purchase_intent_ci',liveRouteIntegrated:false}));
  }finally{a.release();b.release()}
}finally{await pool.end()}
