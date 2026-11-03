import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inventoryPurchaseFingerprint,claimInventoryPurchaseIntent,
  lockInventoryPurchaseBusiness,finishInventoryPurchaseIntent,
  executeInventoryPurchaseIntent,
  INVENTORY_PURCHASE_INTENT_SCHEMA
} from '../inventory-purchase-intent-core.js';

const key='a2345678-b123-4123-9abc-123456789012';
const payload={item:'Beans',purchase_quantity:2,total_cost:'12.50',account:'cash',note:'Invoice A'};
const noDb={query(){throw new Error('SQL used before validation')}};

test('stable fingerprint ignores JSON object member order, not value changes',()=>{
  assert.equal(inventoryPurchaseFingerprint(payload),inventoryPurchaseFingerprint({note:'Invoice A',account:'cash',total_cost:'12.50',purchase_quantity:2,item:'Beans'}));
  for(const change of [{total_cost:'12.51'},{account:'gcash'},{item:'beans'},{purchase_quantity:3},{note:'Invoice B'}]){
    assert.notEqual(inventoryPurchaseFingerprint(payload),inventoryPurchaseFingerprint({...payload,...change}));
  }
  assert.match(inventoryPurchaseFingerprint(payload),/^[a-f0-9]{64}$/);
});

test('invalid key, identity or payload never reaches PostgreSQL',async()=>{
  for(const invalid of [null,42,true,'','short',' padded-key-1234','padded-key-1234 ','has space 123456','a'.repeat(129),'a\u0000'.repeat(12)]){
    await assert.rejects(claimInventoryPurchaseIntent(noDb,{businessId:1,accountId:2,intentKey:invalid,payload}),e=>e.status===400);
  }
  for(const invalid of [0,-1,1.23,Number.MAX_SAFE_INTEGER+1,'0','1.2','9999999999999999999999']){
    await assert.rejects(claimInventoryPurchaseIntent(noDb,{businessId:invalid,accountId:2,intentKey:key,payload}),e=>e.status===400);
  }
  let deep={leaf:1};for(let i=0;i<18;i++)deep={a:deep};
  for(const invalid of [null,[],{item:Infinity},{item:undefined},{item:()=>1},deep]){
    assert.throws(()=>inventoryPurchaseFingerprint(invalid),e=>e.status===400);
  }
});

test('claim new, save a purchase snapshot, then replay exact committed response',async()=>{
  let row=null;const seen=[];
  const client={async query(sql,args){seen.push({sql,args});
    if(sql.includes('INSERT INTO inventory_purchase_intents')){
      if(!row){row={payload_sha256:args[3],purchase_id:null,response_json:null};return{rowCount:1,rows:[{intent_key:args[2]}]}}
      return{rowCount:0,rows:[]};
    }
    if(sql.includes('SELECT payload_sha256,purchase_id,response_json'))return{rowCount:1,rows:[row]};
    if(sql.includes('UPDATE inventory_purchase_intents')){
      assert.equal(args[0],'1');assert.equal(args[1],'2');assert.equal(args[2],key);
      row.purchase_id=args[3];row.response_json=JSON.parse(args[4]);return{rowCount:1,rows:[{purchase_id:args[3]}]};
    }
    if(sql.includes('pg_advisory_xact_lock'))return{rowCount:1,rows:[]};
    throw new Error('Unexpected SQL');
  }};
  const args={businessId:1,accountId:2,intentKey:key,payload};
  assert.equal((await claimInventoryPurchaseIntent(client,args)).kind,'new');
  await lockInventoryPurchaseBusiness(client,1);
  const response={inventory:{id:51,quantity:'2'},purchase:{id:100},lot:{id:66},transaction:{id:80},conversion:{stored:'2 kg'}};
  assert.deepEqual(await finishInventoryPurchaseIntent(client,{...args,purchaseId:100,response}),response);
  const replay=await claimInventoryPurchaseIntent(client,{...args,payload:{...payload,account:'cash'}});
  assert.equal(replay.kind,'replay');assert.deepEqual(replay.response,response);
  assert.equal(replay.purchaseId,'100');
  assert.ok(seen.find(x=>x.sql.includes('pg_advisory_xact_lock')));
  assert.ok(seen.find(x=>x.sql.includes('FOR UPDATE')));
  assert.ok(!seen.some(x=>JSON.stringify(x.args).includes('Invoice A')),'raw payload not persisted in intent SQL');
});

test('same literal key with changed instruction fails before replay',async()=>{
  const client={async query(sql,args){if(sql.includes('INSERT'))return{rowCount:0,rows:[]};return{rowCount:1,rows:[{payload_sha256:inventoryPurchaseFingerprint(payload),purchase_id:44,response_json:{purchase:{id:44}}}]};}};
  await assert.rejects(claimInventoryPurchaseIntent(client,{businessId:1,accountId:2,intentKey:key,payload:{...payload,total_cost:'17.00'}}),e=>e.status===409&&e.code==='INVENTORY_PURCHASE_INTENT_CONFLICT');
});

test('schema includes scoped unique reservation, FK and private committed response',()=>{
  assert.match(INVENTORY_PURCHASE_INTENT_SCHEMA,/PRIMARY KEY \(business_id, account_id, intent_key\)/);
  assert.match(INVENTORY_PURCHASE_INTENT_SCHEMA,/REFERENCES inventory_purchases\(id\) ON DELETE RESTRICT/);
  assert.match(INVENTORY_PURCHASE_INTENT_SCHEMA,/response_json JSONB/);
  assert.match(INVENTORY_PURCHASE_INTENT_SCHEMA,/CREATE CONSTRAINT TRIGGER inventory_purchase_intents_complete_commit/);
  assert.match(INVENTORY_PURCHASE_INTENT_SCHEMA,/DEFERRABLE INITIALLY DEFERRED/);
});

test('finish binds the purchase row to the same authorized business',async()=>{
  let statement='';
  const absent={async query(sql){statement=sql;return{rowCount:0,rows:[]}}};
  await assert.rejects(
    finishInventoryPurchaseIntent(absent,{
      businessId:101,accountId:501,intentKey:key,purchaseId:800,response:{purchase:{id:800}}
    }),
    e=>e.code==='INVENTORY_PURCHASE_INTENT_CONFLICT' && e.status===409
  );
  assert.match(statement,/FROM inventory_purchases AS purchase/);
  assert.match(statement,/purchase.id=\$4 AND purchase.business_id=intent.business_id/);
});

test('a mismatched purchase response cannot be persisted or replayed',async()=>{
  const blockSql={query(){throw new Error('Unexpected SQL: invalid response must fail first')}};
  const ctx={businessId:1,accountId:2,intentKey:key,purchaseId:44};
  for(const response of [{},{purchase:{}},{purchase:{id:45}},{purchase:{id:0}},{purchase:{id:44.5}},{purchase:[]}]){
    await assert.rejects(finishInventoryPurchaseIntent(blockSql,{...ctx,response}),
      error=>error.code==='INVENTORY_PURCHASE_INTENT_CONFLICT'&&error.status===409);
  }
  const replayClient={async query(sql){
    if(sql.includes('INSERT INTO inventory_purchase_intents'))return{rowCount:0,rows:[]};
    if(sql.includes('SELECT payload_sha256,purchase_id,response_json')){
      return{rowCount:1,rows:[{
        payload_sha256:inventoryPurchaseFingerprint(payload),
        purchase_id:'44',response_json:{purchase:{id:'45'}}
      }]};
    }
    throw new Error('Unexpected SQL');
  }};
  await assert.rejects(claimInventoryPurchaseIntent(replayClient,{
    businessId:1,accountId:2,intentKey:key,payload
  }),error=>error.code==='INVENTORY_PURCHASE_INTENT_CONFLICT'&&error.status===409);
});

test('transaction executor commits one purchase, then replays without touching inventory',async()=>{
  const events=[];let committed=null;let draft=null;
  const client={async query(sql,args){
    if(sql==='BEGIN'){events.push('BEGIN');return{rowCount:0,rows:[]}}
    if(sql==='COMMIT'){events.push('COMMIT');committed=draft||committed;return{rowCount:0,rows:[]}}
    if(sql==='ROLLBACK'){events.push('ROLLBACK');draft=null;return{rowCount:0,rows:[]}}
    if(sql.includes('INSERT INTO inventory_purchase_intents')){
      events.push('claim');
      if(committed)return{rowCount:0,rows:[]};
      draft={payload_sha256:args[3],purchase_id:null,response_json:null};
      return{rowCount:1,rows:[{intent_key:args[2]}]};
    }
    if(sql.includes('SELECT payload_sha256,purchase_id,response_json')){
      events.push('replay');return{rowCount:1,rows:[committed]};
    }
    if(sql.includes('pg_advisory_xact_lock')){events.push('lock');return{rowCount:1,rows:[]}}
    if(sql.includes('UPDATE inventory_purchase_intents')){
      events.push('finish');
      draft.purchase_id=args[3];draft.response_json=JSON.parse(args[4]);
      return{rowCount:1,rows:[{purchase_id:args[3]}]};
    }
    throw new Error('Unexpected SQL');
  }};
  const opts={businessId:1,accountId:2,intentKey:key,payload};
  const response={purchase:{id:42},inventory:{quantity:'2'},lot:{id:75},transaction:{id:80}};
  const first=await executeInventoryPurchaseIntent(client,opts,async connection=>{
    assert.equal(connection,client);events.push('purchase');
    return{purchaseId:42,response};
  });
  assert.deepEqual(first,{kind:'new',purchaseId:'42',response});
  assert.deepEqual(events,['BEGIN','claim','lock','purchase','finish','COMMIT']);
  const second=await executeInventoryPurchaseIntent(client,opts,async()=>{
    throw new Error('Must not post a replay');
  });
  assert.equal(second.kind,'replay');
  assert.deepEqual(second.response,response);
  assert.deepEqual(events.slice(6),['BEGIN','claim','replay','COMMIT']);
});

test('transaction executor rolls back failed callback and validates before BEGIN',async()=>{
  const events=[];
  const client={async query(sql){
    if(sql==='BEGIN'||sql==='ROLLBACK'||sql==='COMMIT'){events.push(sql);return{rowCount:0,rows:[]}}
    if(sql.includes('INSERT INTO inventory_purchase_intents')){events.push('claim');return{rowCount:1,rows:[{intent_key:key}]}}
    if(sql.includes('pg_advisory_xact_lock')){events.push('lock');return{rowCount:1,rows:[]}}
    throw new Error('Unexpected query');
  }};
  const opts={businessId:1,accountId:2,intentKey:key,payload};
  await assert.rejects(executeInventoryPurchaseIntent(client,opts,async()=>{
    events.push('purchase');throw new Error('synthetic purchase failure');
  }),/synthetic purchase failure/);
  assert.deepEqual(events,['BEGIN','claim','lock','purchase','ROLLBACK']);
  events.length=0;
  await assert.rejects(executeInventoryPurchaseIntent(client,{...opts,intentKey:'bad'},async()=>{}),
    e=>e.status===400);
  await assert.rejects(executeInventoryPurchaseIntent(client,opts,null),e=>e.status===400);
  assert.deepEqual(events,[],'invalid input never begins a transaction');
});
