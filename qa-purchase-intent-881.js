import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export const PURCHASE_INTENT_881_WAVE='purchase_intent_881';
const PURCHASE_PATH='/api/inventory/purchase';

async function removeFixtures(pool,businesses){
  if(!businesses.length)return;
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    for(const {id,name} of businesses){
      const owned=await client.query('SELECT name FROM businesses WHERE id=$1 FOR UPDATE',[id]);
      if(owned.rows[0]?.name!==name)throw new Error('Purchase intent QA cleanup business ownership mismatch');
    }
    const ids=businesses.map(({id})=>id);
    const intentTable=await client.query("SELECT to_regclass('inventory_purchase_intents') AS name");
    if(intentTable.rows[0]?.name){
      await client.query('DELETE FROM inventory_purchase_intents WHERE business_id=ANY($1::bigint[])',[ids]);
    }
    for(const table of ['inventory_lot_location_balances','inventory_location_balances','inventory_purchases',
      'supply_lots','transactions','inventory','inventory_storage_locations','budgets']){
      await client.query(`DELETE FROM ${table} WHERE business_id=ANY($1::bigint[])`,[ids]);
    }
    const removed=await client.query('DELETE FROM businesses WHERE id=ANY($1::bigint[])',[ids]);
    assert.equal(removed.rowCount,ids.length,'Every synthetic purchase business must be removed');
    await client.query('COMMIT');
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{client.release()}
}

// The dispatcher permits this runner only in the isolated Preview database.
// A synthetic Cash ledger entry checks atomicity without initiating a payment.
export async function runPurchaseIntent881Acceptance({pool,base,secret,aliases,helpers}){
  const {requestJson,qaAccountSession,ensureActiveRole,withRejectedExpense}=helpers;
  const scope='QA 881 '+randomUUID(),businesses=[],sessions=[];
  let checks=0;
  const exact=(actual,expected,label)=>{
    assert.deepEqual(actual,expected,'Purchase intent 881: '+label);
    checks++;
  };
  const signIn=async role=>{
    const label='Purchase intent 881 '+role+' QA';
    const session=await qaAccountSession({pool,base,secret,email:aliases[role],role,label});
    const tracked={...session,role};
    sessions.push(tracked);
    const me=await requestJson(base,'/api/me',{token:session.token});
    exact(me.status,200,'authenticated '+role);
    exact(me.json?.account?.account_mode,'company_test','classified '+role);
    exact(me.json?.account?.test_role,role,'designated '+role);
    const previous=me.json?.account?.active_role??null;
    if(previous!==role){
      tracked.previousRole=previous;
      await ensureActiveRole({base,token:session.token,role,label});
    }
    return tracked;
  };
  const receive=(businessId,body,token)=>requestJson(base,PURCHASE_PATH,{
    method:'POST',token,body,headers:{'x-abl-inventory-origin-business':String(businessId)}
  });

  let failure;
  try{
    const merchant=await signIn('merchant');
    const customer=await signIn('customer');
    for(const suffix of ['Merchant stock','Unbound business']){
      const name=scope+' '+suffix;
      const row=await pool.query("INSERT INTO businesses(name,country_code,currency_code) VALUES($1,'PH','PHP') RETURNING id",[name]);
      businesses.push({id:row.rows[0].id,name});
    }
    const [{id:a},{id:b}]=businesses;
    await pool.query("INSERT INTO business_memberships(business_id,account_id,membership_role,active) VALUES($1,$2,'owner',TRUE)",[a,merchant.accountId]);
    await pool.query("INSERT INTO profile_business_bindings(account_id,role,business_id,status,is_primary) VALUES($1,'merchant',$2,'active',FALSE)",[merchant.accountId,a]);

    const item=scope+' ingredient';
    const firstKey=randomUUID();
    const secondKey=randomUUID();
    const purchase={purchase_intent_key:firstKey,create_only:true,item,purchase_quantity:125,purchase_unit:'g',total_cost:'12.34',
      inventory_type:'ingredient',inventory_domain:'food',stock_role:'ingredient',storage_condition:'dry',
      storage_area_type:'pantry',account:'cash',record_expense:true,note:'Synthetic QA inventory expense'};
    const [first,concurrent]=await Promise.all([
      receive(a,purchase,merchant.token),receive(a,purchase,merchant.token)
    ]);
    exact(first.status,201,'keyed purchase receipt status');
    exact(concurrent.status,201,'parallel replay returns original receipt status');
    exact(concurrent.json,first.json,'parallel replay returns original receipt');
    assert.ok(first.json?.purchase?.id,'Purchase intent 881: purchase ID is present');
    exact(String(first.json?.inventory?.business_id),String(a),'receipt is scoped to initiating business');
    exact(Number(first.json?.inventory?.quantity),125,'parallel retry increases stock once');
    exact((await receive(a,{...purchase,purchase_intent_key:randomUUID()},merchant.token)).status,409,
      'distinct create-only intent cannot add quantity or expense to an existing same-business name');
    exact((await receive(a,{...purchase,purchase_intent_key:randomUUID(),create_only:'true'},merchant.token)).status,400,
      'non-boolean create-only authority fails closed');
    exact((await receive(a,{...purchase,purchase_intent_key:randomUUID(),inventory_id:first.json.inventory.id},merchant.token)).status,400,
      'create-only cannot target an existing Inventory ID');
    exact((await receive(a,{...purchase,total_cost:'13.34'},merchant.token)).status,409,'same key with different amount is rejected');

    const second=await receive(a,{...purchase,purchase_intent_key:secondKey,create_only:false},merchant.token);
    exact(second.status,201,'new intent can receive the same item again');
    assert.ok(second.json?.purchase?.id&&second.json.purchase.id!==first.json.purchase.id,
      'Purchase intent 881: distinct intent creates another purchase');
    exact(second.json?.inventory?.id,first.json.inventory.id,'new receipt updates same stock item');
    exact(Number(second.json?.inventory?.quantity),250,'two distinct intents increase stock twice');
    const replay=await receive(a,purchase,merchant.token);
    exact(replay.status,201,'older committed intent retains original receipt status');
    exact(replay.json,first.json,'older replay remains the original snapshot after a later purchase');

    if(withRejectedExpense){
      const rejectedKey=randomUUID(),rejectedItem=scope+' rollback ingredient';
      const rejected=await withRejectedExpense(a,()=>receive(a,{
        ...purchase,item:rejectedItem,purchase_intent_key:rejectedKey
      },merchant.token));
      exact(rejected.status,500,'forced PostgreSQL expense write failure reaches HTTP');
      const rolledBack=await pool.query(`SELECT
        (SELECT COUNT(*)::int FROM inventory WHERE business_id=$1 AND item=$2) AS stock,
        (SELECT COUNT(*)::int FROM inventory_purchase_intents WHERE business_id=$1 AND intent_key=$3) AS intents`,
      [a,rejectedItem,rejectedKey]);
      exact(rolledBack.rows[0],{stock:0,intents:0},'expense write failure rolls back stock and intent reservation');
    }

    const {purchase_intent_key:ignored,...unkeyed}=purchase;
    const legacy=await receive(a,{...unkeyed,create_only:false,item:scope+' legacy ingredient',purchase_quantity:25,total_cost:0,record_expense:false},merchant.token);
    exact(legacy.status,201,'existing request without a key still works');
    exact(legacy.json?.transaction,null,'legacy no-expense request remains a stock-only receive');

    exact((await receive(a,purchase)).status,401,'guest cannot retrieve the committed receipt');
    exact((await receive(a,purchase,customer.token)).status,403,'customer cannot retrieve a Merchant receipt');
    exact((await receive(b,purchase,merchant.token)).status,403,'unbound business cannot receive stock');
    await pool.query("UPDATE profile_business_bindings SET status='revoked' WHERE account_id=$1 AND role='merchant' AND business_id=$2",[merchant.accountId,a]);
    exact((await receive(a,purchase,merchant.token)).status,403,'revoked Merchant origin cannot replay its earlier receipt');

    const inventory=await pool.query('SELECT quantity::numeric FROM inventory WHERE business_id=$1 AND item=$2',[a,item]);
    exact(inventory.rowCount,1,'one stock row for the two keyed purchases');
    exact(Number(inventory.rows[0].quantity),250,'stock persisted only for two distinct keys');
    const purchases=await pool.query(`
      SELECT i.intent_key,p.id AS purchase_id,p.transaction_id,t.id AS expense_id,t.source_id,t.amount,
             l.quantity_remaining_base AS lot_quantity
        FROM inventory_purchase_intents i
        JOIN inventory_purchases p ON p.id=i.purchase_id AND p.business_id=i.business_id
        JOIN transactions t ON t.id=p.transaction_id AND t.business_id=p.business_id AND t.source='inventory_purchase'
        JOIN supply_lots l ON l.business_id=p.business_id AND l.internal_lot_code='INV-'||p.business_id||'-'||p.id
       WHERE i.business_id=$1 AND i.account_id=$2 AND i.committed_at IS NOT NULL`,[a,merchant.accountId]);
    exact(purchases.rows.map(row=>row.intent_key).sort(),[firstKey,secondKey].sort(),'two committed receipt intents and matching lots/expenses');
    for(const row of purchases.rows){
      exact(String(row.source_id),String(row.purchase_id),'expense source is the corresponding purchase');
      exact(Number(row.amount),12.34,'expense amount recorded once per intent');
      exact(Number(row.lot_quantity),125,'lot quantity recorded once per intent');
    }
    const totals=await pool.query(`SELECT
      (SELECT COUNT(*)::int FROM inventory_purchases WHERE business_id=$1) AS purchases,
      (SELECT COUNT(*)::int FROM supply_lots WHERE business_id=$1) AS lots,
      (SELECT COUNT(*)::int FROM transactions WHERE business_id=$1) AS expenses,
      (SELECT COUNT(*)::int FROM inventory_purchase_intents WHERE business_id=$1) AS intents`,[a]);
    exact(totals.rows[0],{purchases:3,lots:3,expenses:2,intents:2},'exact persisted row counts including legacy receive');
  }catch(error){failure=error}
  finally{
    try{await removeFixtures(pool,businesses)}
    catch(error){failure=new Error('Purchase intent 881 synthetic fixture cleanup failed',{cause:failure??error})}
    for(const session of sessions){
      try{
        if(Object.hasOwn(session,'previousRole')){
          await pool.query(`UPDATE accounts SET active_role=$1 WHERE id=$2 AND account_mode='company_test'
            AND test_role=$3 AND active_role=$3`,[session.previousRole,session.accountId,session.role]);
        }
        await requestJson(base,'/api/auth/logout',{method:'POST',token:session.token,body:{}});
      }catch(error){if(!failure)failure=error}
    }
  }
  if(failure)throw failure;
  return {status:'PASS',wave:PURCHASE_INTENT_881_WAVE,checks,authenticated_http:true,
    original_receipt_replay:true,stock_lot_expense_atomicity:true,legacy_compatibility:true,
    guest_customer_revoked_denied:true,fixtures_removed:true,
    ...(withRejectedExpense?{forced_expense_rollback:true}:{})};
}
