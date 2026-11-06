import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inventoryPurchaseFingerprint,claimInventoryPurchaseIntent,
  lockInventoryPurchaseBusiness,finishInventoryPurchaseIntent,
  executeInventoryPurchaseIntent,inspectInventoryPurchaseIntent,
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

test('fingerprint streams bounded canonical bytes without changing existing intent keys',()=>{
  // Literal hash from the prior canonical JSON + domain-separator implementation.
  assert.equal(inventoryPurchaseFingerprint(payload),
    '4b3a485040bf42ea9034e2e264f4a0d3f382c557e88ed7e22bbda3c5e1ee95d5');
  assert.equal(inventoryPurchaseFingerprint({v:'x'.repeat(32760)}).length,64,
    '32 KiB canonical UTF-8 JSON remains accepted at the exact boundary');
  assert.throws(()=>inventoryPurchaseFingerprint({v:'x'.repeat(32761)}),
    e=>e.status===400&&/fingerprint limit/.test(e.message));
  assert.throws(()=>inventoryPurchaseFingerprint({v:'é'.repeat(16381)}),
    e=>e.status===400&&/fingerprint limit/.test(e.message),
    'UTF-8 byte size, not JavaScript character count, governs the limit');
  const sparse=[1,,3];
  assert.throws(()=>inventoryPurchaseFingerprint({items:sparse}),
    e=>e.status===400&&/JSON-only/.test(e.message));
  const decorated=[1];decorated.hidden='unhashed instruction';
  assert.throws(()=>inventoryPurchaseFingerprint({items:decorated}),
    e=>e.status===400&&/JSON-only/.test(e.message));
  const getter=Object.defineProperty({},'item',{enumerable:true,get(){throw Error('must not execute')}});
  assert.throws(()=>inventoryPurchaseFingerprint(getter),
    e=>e.status===400&&/data-only/.test(e.message));
});

test('fingerprint rejects non-enumerable economic instructions rather than silently omitting them',()=>{
  const approved={...payload};
  const baseline=inventoryPurchaseFingerprint(approved);
  const hidden={...approved};
  Object.defineProperty(hidden,'hidden_total_cost',{value:'300.00'});
  assert.throws(()=>inventoryPurchaseFingerprint(hidden),
    e=>e.code==='INVENTORY_PURCHASE_INTENT_INVALID'&&e.status===400);
  const nested={...approved,lines:[{item:'Beans',cost:'12.50'}]};
  const goodNested=inventoryPurchaseFingerprint(nested);
  Object.defineProperty(nested.lines[0],'hidden_cost',{value:'900.00'});
  assert.throws(()=>inventoryPurchaseFingerprint(nested),
    e=>e.code==='INVENTORY_PURCHASE_INTENT_INVALID'&&e.status===400);
  const decorated=[{item:'Beans'}];
  Object.defineProperty(decorated,'hidden_account',{value:'gcash'});
  assert.throws(()=>inventoryPurchaseFingerprint({...approved,lines:decorated}),
    e=>e.code==='INVENTORY_PURCHASE_INTENT_INVALID'&&e.status===400);
  assert.equal(inventoryPurchaseFingerprint(approved),baseline);
  assert.equal(inventoryPurchaseFingerprint({...approved,lines:[{item:'Beans',cost:'12.50'}]}),goodNested);
});

test('invalid key, identity or payload never reaches PostgreSQL',async()=>{
  for(const invalid of [null,42,true,'','short',' padded-key-1234','padded-key-1234 ','has space 123456','a'.repeat(129),'a\u0000'.repeat(12)]){
    await assert.rejects(claimInventoryPurchaseIntent(noDb,{businessId:1,accountId:2,intentKey:invalid,payload}),e=>e.status===400);
  }
  for(const invalid of [0,-1,1.23,Number.MAX_SAFE_INTEGER+1,'0','1.2','9999999999999999999999']){
    await assert.rejects(claimInventoryPurchaseIntent(noDb,{businessId:invalid,accountId:2,intentKey:key,payload}),e=>e.status===400);
  }
  // Economic identifiers are literal: no array/object/wrapper String coercion.
  const coerced=[true,false,[1],{toString:()=> '1'},new Number(1),new String('1'),
    {toString(){throw Error('Identity toString must not execute')}}];
  for(const invalid of coerced){
    await assert.rejects(claimInventoryPurchaseIntent(noDb,{
      businessId:invalid,accountId:2,intentKey:key,payload
    }),e=>e.status===400);
    await assert.rejects(claimInventoryPurchaseIntent(noDb,{
      businessId:1,accountId:invalid,intentKey:key,payload
    }),e=>e.status===400);
    await assert.rejects(lockInventoryPurchaseBusiness(noDb,invalid),e=>e.status===400);
    await assert.rejects(executeInventoryPurchaseIntent(noDb,{
      businessId:invalid,accountId:2,intentKey:key,payload,
      verifyCurrentMerchantAuthority:async()=>true
    },async()=>({purchaseId:1,response:{purchase:{id:1}}})),e=>e.status===400);
  }
  // Genuine PostgreSQL BIGINT identifiers remain accepted.
  assert.equal((await claimInventoryPurchaseIntent({
    async query(sql,args){
      assert.equal(args[0],'1');assert.equal(args[1],'2');
      return{rowCount:1,rows:[{intent_key:key}]};
    }
  },{businessId:1n,accountId:2n,intentKey:key,payload})).kind,'new');
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
  assert.match(INVENTORY_PURCHASE_INTENT_SCHEMA,/CREATE TRIGGER inventory_purchase_intent_immutable/);
  assert.match(INVENTORY_PURCHASE_INTENT_SCHEMA,/OLD\.committed_at IS NOT NULL/);
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
  for(const response of [{},{purchase:{}},{purchase:{id:45}},{purchase:{id:0}},{purchase:{id:44.5}},
    {purchase:{id:[44]}},{purchase:{id:{toString:()=> '44'}}},{purchase:[]}]){
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


test('serialized purchase identity is validated before SQL and first response matches saved JSON',async()=>{
  const context={businessId:1,accountId:2,intentKey:key,purchaseId:44};
  let calls=0;
  const rejectSql={async query(){calls++;throw Error('No SQL for mismatched serialized identity')}};
  const inconsistent={purchase:{id:44,toJSON(){return{id:45}}}};
  await assert.rejects(
    finishInventoryPurchaseIntent(rejectSql,{...context,response:inconsistent}),
    e=>e.code==='INVENTORY_PURCHASE_INTENT_CONFLICT'&&e.status===409
  );
  const omitted={purchase:{id:44,toJSON(){return{reference:'hidden'}}}};
  await assert.rejects(
    finishInventoryPurchaseIntent(rejectSql,{...context,response:omitted}),
    e=>e.code==='INVENTORY_PURCHASE_INTENT_CONFLICT'&&e.status===409
  );
  assert.equal(calls,0,'invalid serialized representations cannot reach the database');

  let persisted;
  const accepted={async query(sql,args){
    assert.match(sql,/UPDATE inventory_purchase_intents/);
    persisted=JSON.parse(args[4]);
    return{rowCount:1,rows:[{purchase_id:44}]};
  }};
  const original={purchase:{id:44},created_at:new Date('2026-11-03T00:00:00.000Z')};
  const result=await finishInventoryPurchaseIntent(accepted,{...context,response:original});
  assert.deepEqual(result,persisted,'new response equals replay JSON snapshot');
  assert.equal(result.created_at,'2026-11-03T00:00:00.000Z');
  assert.notEqual(result,original);
});

test('response snapshot rejects silently dropped or nullified financial evidence before SQL',async()=>{
  const ctx={businessId:1,accountId:2,intentKey:key,purchaseId:44};
  let queries=0;
  const noWrites={async query(){queries++;throw Error('Invalid response must not reach SQL')}};
  const badSnapshots=[
    {purchase:{id:44},expense:{total:NaN}},
    {purchase:{id:44},inventory:{stock_balance:Infinity}},
    {purchase:{id:44},lot:{unit_cost:-Infinity}},
    {purchase:{id:44},expense:{total:undefined}},
    {purchase:{id:44},items:[1,,3]},
    {purchase:{id:44},expense:{total:1n}},
    {purchase:{id:44},entries:Object.defineProperty([1],'hidden_total',{value:50})},
    {purchase:{id:44},created_at:Object.assign(new Date('2026-11-05T00:00:00Z'),{hidden_total:99})},
    {purchase:{id:44},created_at:Object.assign(new Date('2026-11-05T00:00:00Z'),{toJSON(){return 'tampered'}})},
    {purchase:{id:44},created_at:new Date(NaN)},
    {purchase:{id:44},expense:{toJSON(){return{total:1}}}},
    {purchase:{id:44},expense:Object.defineProperty({},'amount',{get(){throw Error('getter executed')},enumerable:true})}
  ];
  const cyclic={purchase:{id:44}};cyclic.self=cyclic;
  badSnapshots.push(cyclic);
  for(const response of badSnapshots){
    await assert.rejects(finishInventoryPurchaseIntent(noWrites,{...ctx,response}),
      e=>e.code==='INVENTORY_PURCHASE_INTENT_CONFLICT'&&e.status===409);
  }
  assert.equal(queries,0,'lossy evidence must be rejected before any persisted intent update');
  let stored=null;
  const accepted={async query(_sql,args){stored=JSON.parse(args[4]);return{rowCount:1,rows:[{purchase_id:44}]}}};
  const valid={purchase:{id:44},expense:{total:0},
    generated_at:new Date('2026-11-05T00:00:00.000Z')};
  assert.deepEqual(await finishInventoryPurchaseIntent(accepted,{...ctx,response:valid}),stored);
  assert.equal(stored.generated_at,'2026-11-05T00:00:00.000Z');
  assert.equal(stored.expense.total,0);
});

test('inherited JSON serializers cannot rewrite a committed purchase evidence snapshot',async()=>{
  const context={businessId:1,accountId:2,intentKey:key,purchaseId:44};
  let queries=0;
  const noWrites={async query(){queries++;throw Error('A lossy response reached purchase SQL')}};
  const restore=async (prototype,serializer,response)=>{
    const before=Object.getOwnPropertyDescriptor(prototype,'toJSON');
    try{
      Object.defineProperty(prototype,'toJSON',{configurable:true,writable:true,value:serializer});
      await assert.rejects(finishInventoryPurchaseIntent(noWrites,{...context,response}),
        error=>error.code==='INVENTORY_PURCHASE_INTENT_CONFLICT'&&error.status===409);
    }finally{
      if(before)Object.defineProperty(prototype,'toJSON',before);
      else delete prototype.toJSON;
    }
  };
  // In each case JSON.stringify would silently discard valid original fields
  // without the new guard. A normal native Date already has a separate control.
  await restore(Object.prototype,function(){return{purchase:{id:44}}},
    {purchase:{id:44},expense:{total:'12.50'},stock:{quantity:'2.000'}});
  await restore(Array.prototype,function(){return[]},
    {purchase:{id:44},expense:{total:'12.50'},lot_allocations:[{lot_id:5,quantity:'2.000'}]});
  await restore(Date.prototype,function(){return 'altered timestamp'},
    {purchase:{id:44},received_at:new Date('2026-11-05T12:00:00.000Z')});
  assert.equal(queries,0,'Inherited serializers must be rejected before any financial SQL');
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
  const opts={businessId:1,accountId:2,intentKey:key,payload,
    verifyCurrentMerchantAuthority:async (connection,authority)=>{
      assert.equal(connection,client);
      events.push('authorize:'+authority.stage);
      return true;
    }};
  const response={purchase:{id:42},inventory:{quantity:'2'},lot:{id:75},transaction:{id:80}};
  const first=await executeInventoryPurchaseIntent(client,opts,async connection=>{
    assert.equal(connection,client);events.push('purchase');
    return{purchaseId:42,response};
  });
  assert.deepEqual(first,{kind:'new',purchaseId:'42',response});
  assert.deepEqual(events,['BEGIN','claim','lock','authorize:before-write','purchase','finish','authorize:before-commit','COMMIT']);
  const second=await executeInventoryPurchaseIntent(client,opts,async()=>{
    throw new Error('Must not post a replay');
  });
  assert.equal(second.kind,'replay');
  assert.deepEqual(second.response,response);
  assert.deepEqual(events.slice(8),['BEGIN','claim','replay','authorize:replay','COMMIT']);
});

test('transaction executor rolls back failed callback and validates before BEGIN',async()=>{
  const events=[];
  const client={async query(sql){
    if(sql==='BEGIN'||sql==='ROLLBACK'||sql==='COMMIT'){events.push(sql);return{rowCount:0,rows:[]}}
    if(sql.includes('INSERT INTO inventory_purchase_intents')){events.push('claim');return{rowCount:1,rows:[{intent_key:key}]}}
    if(sql.includes('pg_advisory_xact_lock')){events.push('lock');return{rowCount:1,rows:[]}}
    throw new Error('Unexpected query');
  }};
  const opts={businessId:1,accountId:2,intentKey:key,payload,
    verifyCurrentMerchantAuthority:async(_client,authority)=>{
      events.push('authorize:'+authority.stage);return true;
    }};
  await assert.rejects(executeInventoryPurchaseIntent(client,opts,async()=>{
    events.push('purchase');throw new Error('synthetic purchase failure');
  }),/synthetic purchase failure/);
  assert.deepEqual(events,['BEGIN','claim','lock','authorize:before-write','purchase','ROLLBACK']);
  events.length=0;
  await assert.rejects(executeInventoryPurchaseIntent(client,{...opts,intentKey:'bad'},async()=>{}),
    e=>e.status===400);
  await assert.rejects(executeInventoryPurchaseIntent(client,opts,null),e=>e.status===400);
  assert.deepEqual(events,[],'invalid input never begins a transaction');
});

test('no authority verifier fails closed without BEGIN; denied locked origin cannot write or replay',async()=>{
  const events=[];
  const client={async query(sql){
    if(sql==='BEGIN'||sql==='ROLLBACK'||sql==='COMMIT'){
      events.push(sql);return{rowCount:0,rows:[]};
    }
    if(sql.includes('INSERT INTO inventory_purchase_intents')){
      events.push('claim');return{rowCount:1,rows:[{intent_key:key}]};
    }
    if(sql.includes('pg_advisory_xact_lock')){
      events.push('lock');return{rowCount:1,rows:[]};
    }
    throw new Error('Unexpected SQL after denial');
  }};
  const baseline={businessId:1,accountId:2,intentKey:key,payload};
  await assert.rejects(executeInventoryPurchaseIntent(client,baseline,async()=>{}),
    e=>e.code==='INVENTORY_PURCHASE_INTENT_AUTH_REQUIRED'&&e.status===403);
  assert.deepEqual(events,[],'missing verifier must not begin a transaction');
  await assert.rejects(executeInventoryPurchaseIntent(client,{
    ...baseline,verifyCurrentMerchantAuthority:async (connection,authority)=>{
      assert.equal(connection,client);
      assert.equal(authority.stage,'before-write');
      events.push('deny');return false;
    }
  },async()=>{throw new Error('Purchase must never run after revoked grant')}),
  e=>e.code==='INVENTORY_PURCHASE_INTENT_FORBIDDEN'&&e.status===403);
  assert.deepEqual(events,['BEGIN','claim','lock','deny','ROLLBACK']);
});

test('lost COMMIT acknowledgement is explicitly unknown; same-key reconciliation replays without a second purchase',async()=>{
  const events=[];let staged=null,committed=null,creationCalls=0,loseAcknowledgement=true;
  const lostAck=new Error('synthetic PostgreSQL transport loss after COMMIT');
  const client={async query(sql,args){
    if(sql==='BEGIN'){events.push('BEGIN');return{rowCount:0,rows:[]};}
    if(sql==='ROLLBACK'){
      events.push('ROLLBACK');
      staged=null; // Cannot undo an earlier durable COMMIT.
      return{rowCount:0,rows:[]};
    }
    if(sql==='COMMIT'){
      events.push('COMMIT');
      if(loseAcknowledgement){
        committed=staged;staged=null;loseAcknowledgement=false;
        throw lostAck; // Server committed, caller did not get acknowledgement.
      }
      return{rowCount:0,rows:[]};
    }
    if(sql.includes('INSERT INTO inventory_purchase_intents')){
      events.push('claim');
      if(committed)return{rowCount:0,rows:[]};
      staged={payload_sha256:args[3],purchase_id:null,response_json:null};
      return{rowCount:1,rows:[{intent_key:args[2]}]};
    }
    if(sql.includes('SELECT payload_sha256,purchase_id,response_json')){
      events.push('replay');return{rowCount:1,rows:[committed]};
    }
    if(sql.includes('pg_advisory_xact_lock')){
      events.push('lock');return{rowCount:1,rows:[]};
    }
    if(sql.includes('UPDATE inventory_purchase_intents')){
      events.push('finish');
      staged.purchase_id=args[3];staged.response_json=JSON.parse(args[4]);
      return{rowCount:1,rows:[{purchase_id:args[3]}]};
    }
    throw Error('Unexpected SQL in uncertain-COMMIT regression');
  }};
  const opts={businessId:1,accountId:2,intentKey:key,payload,
    verifyCurrentMerchantAuthority:async(_client,{stage})=>{
      events.push('authorize:'+stage);return true;
    }};
  const createPurchase=async()=>{
    creationCalls++;
    return{purchaseId:73,response:{purchase:{id:73},lot:{id:85},expense:{total:'2.75'}}};
  };
  await assert.rejects(executeInventoryPurchaseIntent(client,opts,createPurchase),error=>{
    assert.equal(error.code,'INVENTORY_PURCHASE_INTENT_COMMIT_UNKNOWN');
    assert.equal(error.status,503);
    assert.equal(error.cause,lostAck);
    assert.match(error.message,/outcome is unknown/i);
    return true;
  });
  assert.equal(creationCalls,1);
  assert.equal(committed.purchase_id,'73','COMMIT might have persisted economic effects');
  assert.deepEqual(events.slice(-3),['authorize:before-commit','COMMIT','ROLLBACK']);
  const replay=await executeInventoryPurchaseIntent(client,opts,async()=>{
    throw Error('Reconciliation must not create a duplicate purchase');
  });
  assert.equal(replay.kind,'replay');
  assert.equal(replay.purchaseId,'73');
  assert.equal(replay.response.expense.total,'2.75');
  assert.equal(creationCalls,1);
  assert.deepEqual(events.slice(-5),['BEGIN','claim','replay','authorize:replay','COMMIT']);
});

test('read-only reconciliation distinguishes unconfirmed from committed without INSERT',async()=>{
  let committed=false,permitted=true,ownership=true;
  const queries=[];
  const client={async query(sql){
    queries.push(sql);
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return{rowCount:0,rows:[]};
    if(sql.includes('FROM inventory_purchase_intents'))return committed?{
      rowCount:1,rows:[{payload_sha256:inventoryPurchaseFingerprint(payload),
        purchase_id:44,response_json:{purchase:{id:44},expense:{total:'12.50'}}}]
    }:{rowCount:0,rows:[]};
    if(sql.includes('FROM inventory_purchases'))return{rowCount:ownership?1:0,rows:ownership?[{id:44}]:[]};
    throw Error('Unexpected query during read-only reconciliation');
  }};
  const opts={businessId:1,accountId:2,intentKey:key,payload,
    verifyCurrentMerchantAuthority:async(_db,grant)=>{
      assert.equal(grant.stage,'reconcile');return permitted;
    }};
  assert.deepEqual(await inspectInventoryPurchaseIntent(client,opts),
    {kind:'unconfirmed',safeToRetry:false});
  committed=true;
  const result=await inspectInventoryPurchaseIntent(client,opts);
  assert.equal(result.kind,'committed');
  assert.equal(result.purchaseId,'44');
  assert.equal(result.response.expense.total,'12.50');
  assert.equal(result.safeToRetry,false);
  assert.ok(queries.every(sql=>!/(INSERT|UPDATE|DELETE|pg_advisory_xact_lock)/i.test(sql)));
  ownership=false;
  await assert.rejects(inspectInventoryPurchaseIntent(client,opts),
    e=>e.code==='INVENTORY_PURCHASE_INTENT_CONFLICT');
  assert.equal(queries.at(-1),'ROLLBACK');
  permitted=false;
  const seen=queries.length;
  await assert.rejects(inspectInventoryPurchaseIntent(client,opts),
    e=>e.code==='INVENTORY_PURCHASE_INTENT_FORBIDDEN');
  assert.deepEqual(queries.slice(seen),['BEGIN','ROLLBACK']);
  await assert.rejects(inspectInventoryPurchaseIntent(client,{...opts,
    payload:{...payload,total_cost:'999.00'},verifyCurrentMerchantAuthority:async()=>true}),
    e=>e.code==='INVENTORY_PURCHASE_INTENT_CONFLICT');
});

test('unverified or malformed inspection never begins a database transaction',async()=>{
  let queries=0;const db={query(){queries++;throw Error('unexpected SQL')}};
  const options={businessId:1,accountId:2,intentKey:key,payload};
  await assert.rejects(inspectInventoryPurchaseIntent(db,options),
    e=>e.code==='INVENTORY_PURCHASE_INTENT_AUTH_REQUIRED');
  await assert.rejects(inspectInventoryPurchaseIntent(db,{
    ...options,payload:{cost:NaN},verifyCurrentMerchantAuthority:async()=>true
  }),e=>e.status===400);
  assert.equal(queries,0);
});

test('transaction coordinator refuses in-flight purchase-body changes at every async boundary',async()=>{
  // Deterministic simulated asynchronous mutation of a shared request body.
  // The old coordinator permitted new work after a changed lock result and
  // could COMMIT financial effects no longer matching its reserved fingerprint.
  for(const phase of ['begin','lock','authorization','callback','before-commit','replay']){
    const body={...payload};
    const originalHash=inventoryPurchaseFingerprint(body);
    const events=[];
    let callbackRuns=0;
    const change=()=>{body.total_cost='900.00'};
    const replay=phase==='replay';
    const db={async query(sql){
      if(sql==='BEGIN'){
        events.push('BEGIN');
        if(phase==='begin')change();
        return{rowCount:0,rows:[]};
      }
      if(sql==='ROLLBACK'||sql==='COMMIT'){
        events.push(sql);return{rowCount:0,rows:[]};
      }
      if(sql.includes('INSERT INTO inventory_purchase_intents')){
        events.push('claim');
        return replay?{rowCount:0,rows:[]}:
          {rowCount:1,rows:[{intent_key:key}]};
      }
      if(sql.includes('SELECT payload_sha256,purchase_id,response_json')){
        events.push('replay-row');
        return{rowCount:1,rows:[{
          payload_sha256:originalHash,purchase_id:'42',response_json:{purchase:{id:42}}
        }]};
      }
      if(sql.includes('pg_advisory_xact_lock')){
        events.push('lock');
        if(phase==='lock')change();
        return{rowCount:1,rows:[]};
      }
      if(sql.includes('UPDATE inventory_purchase_intents')){
        events.push('finish');
        return{rowCount:1,rows:[{purchase_id:'42'}]};
      }
      throw new Error('Unexpected purchase SQL');
    }};
    const opts={
      businessId:1,accountId:2,intentKey:key,payload:body,
      verifyCurrentMerchantAuthority:async(_db,ctx)=>{
        events.push('authorize:'+ctx.stage);
        if((phase==='authorization'&&ctx.stage==='before-write')||
           (phase==='before-commit'&&ctx.stage==='before-commit')||
           (phase==='replay'&&ctx.stage==='replay'))change();
        return true;
      }
    };
    await assert.rejects(
      executeInventoryPurchaseIntent(db,opts,async()=>{
        callbackRuns++;events.push('purchase');
        if(phase==='callback')change();
        return{purchaseId:42,response:{purchase:{id:42},expense:{total:'12.50'}}};
      }),
      error=>error.code==='INVENTORY_PURCHASE_INTENT_CONFLICT'&&error.status===409,
      'changed instructions must fail closed: '+phase
    );
    assert.equal(events.at(-1),'ROLLBACK','transaction rolled back: '+phase);
    assert.ok(!events.includes('COMMIT'),'never committed changed instructions: '+phase);
    assert.equal(callbackRuns,['callback','before-commit'].includes(phase)?1:0,
      'no unauthorized purchase callback: '+phase);
    if(phase==='begin')assert.ok(!events.includes('claim'),
      'mutated body cannot reserve a fingerprint after BEGIN');
    if(phase==='callback')assert.ok(!events.includes('finish'),
      'mutated post-write body cannot finalize reservation');
  }
});

test('read-only inspection rejects mutated or replaced instructions at every async boundary',async()=>{
  // Explicitly simulate shared request mutation during awaited grant/SQL.
  for(const phase of ['begin','authority','replace','missing-row','committed-row','source-row']){
    const body={...payload};
    const options={businessId:1,accountId:2,intentKey:key,payload:body};
    const fingerprint=inventoryPurchaseFingerprint(body);
    const events=[];
    const mutate=()=>{body.total_cost='400.00'};
    const committed=phase!=='missing-row';
    options.verifyCurrentMerchantAuthority=async(_db,grant)=>{
      assert.equal(grant.stage,'reconcile');
      events.push('authority');
      if(phase==='authority')mutate();
      if(phase==='replace')options.payload={...body,total_cost:'401.00'};
      return true;
    };
    const db={async query(sql){
      if(sql==='BEGIN'){
        events.push(sql);
        if(phase==='begin')mutate();
        return{rowCount:0,rows:[]};
      }
      if(sql==='COMMIT'||sql==='ROLLBACK'){
        events.push(sql);return{rowCount:0,rows:[]};
      }
      if(sql.includes('FROM inventory_purchase_intents')){
        events.push('intent-read');
        if(phase==='missing-row'||phase==='committed-row')mutate();
        return committed?{rowCount:1,rows:[{
          payload_sha256:fingerprint,purchase_id:'44',
          response_json:{purchase:{id:44},expense:{total:'12.50'}}
        }]}:{rowCount:0,rows:[]};
      }
      if(sql.includes('FROM inventory_purchases')){
        events.push('purchase-read');
        if(phase==='source-row')mutate();
        return{rowCount:1,rows:[{id:'44'}]};
      }
      throw Error('Unexpected write or SQL in read-only inspection');
    }};
    await assert.rejects(inspectInventoryPurchaseIntent(db,options),
      error=>error.code==='INVENTORY_PURCHASE_INTENT_CONFLICT'&&error.status===409,
      'changed instructions must be rejected: '+phase);
    assert.equal(events.at(-1),'ROLLBACK','transaction rolled back: '+phase);
    assert.ok(!events.includes('COMMIT'),'changed instructions never accepted: '+phase);
    if(phase==='begin')assert.ok(!events.includes('authority'),'early rejection: '+phase);
    if(phase==='missing-row')assert.ok(events.includes('intent-read'),
      'even absent-key inspection checks original instructions');
  }
});

test('mutable origin or replaced body cannot change the purchase intent between SQL awaits',async()=>{
  for(const mutation of ['body','business','account','key','invalid']){
    for(const phase of ['begin','lock','authorize','callback','before-commit','replay']){
      const opts={businessId:1,accountId:2,intentKey:key,payload:{...payload}};
      const hash=inventoryPurchaseFingerprint(opts.payload);
      const events=[];
      let posted=0;
      const change=()=>{
        if(mutation==='body')opts.payload={...opts.payload,total_cost:'99.99'};
        if(mutation==='business')opts.businessId=3;
        if(mutation==='account')opts.accountId=4;
        if(mutation==='key')opts.intentKey='b2345678-b123-4123-9abc-123456789012';
        if(mutation==='invalid')opts.businessId={id:3};
      };
      const db={async query(sql){
        if(sql==='BEGIN'){
          events.push('BEGIN');if(phase==='begin')change();return{rowCount:0,rows:[]};
        }
        if(sql==='ROLLBACK'||sql==='COMMIT'){
          events.push(sql);return{rowCount:0,rows:[]};
        }
        if(sql.includes('INSERT INTO inventory_purchase_intents')){
          events.push('claim');return phase==='replay'?{rowCount:0,rows:[]}:
            {rowCount:1,rows:[{intent_key:key}]};
        }
        if(sql.includes('SELECT payload_sha256,purchase_id,response_json'))return{
          rowCount:1,rows:[{payload_sha256:hash,purchase_id:42,response_json:{purchase:{id:42}}}]
        };
        if(sql.includes('pg_advisory_xact_lock')){
          if(phase==='lock')change();return{rowCount:1,rows:[]};
        }
        if(sql.includes('UPDATE inventory_purchase_intents'))return{rowCount:1,rows:[{purchase_id:42}]};
        throw Error('Unexpected SQL in intent mutation test');
      }};
      opts.verifyCurrentMerchantAuthority=async(_db,{stage})=>{
        if((phase==='authorize'&&stage==='before-write')||
           (phase==='before-commit'&&stage==='before-commit')||
           (phase==='replay'&&stage==='replay'))change();
        return true;
      };
      await assert.rejects(executeInventoryPurchaseIntent(db,opts,async()=>{
        posted++;if(phase==='callback')change();
        return{purchaseId:42,response:{purchase:{id:42}}};
      }),e=>e.code==='INVENTORY_PURCHASE_INTENT_CONFLICT'&&e.status===409,
      mutation+'/'+phase);
      assert.equal(events.at(-1),'ROLLBACK');
      assert.ok(!events.includes('COMMIT'));
      assert.equal(posted,['callback','before-commit'].includes(phase)?1:0);
    }
  }
});

test('read-only purchase reconciliation rejects option/origin replacement and old body mutation',async()=>{
  for(const mutation of ['body','old-body','business','account','key']){
    for(const phase of ['begin','authorize','intent','purchase']){
      const oldBody={...payload};
      const opts={businessId:1,accountId:2,intentKey:key,payload:oldBody};
      const hash=inventoryPurchaseFingerprint(oldBody),events=[];
      const change=()=>{
        if(mutation==='body')opts.payload={...payload,total_cost:'99.99'};
        if(mutation==='old-body'){opts.payload={...payload};oldBody.total_cost='99.99';}
        if(mutation==='business')opts.businessId=3;
        if(mutation==='account')opts.accountId=4;
        if(mutation==='key')opts.intentKey='b2345678-b123-4123-9abc-123456789012';
      };
      opts.verifyCurrentMerchantAuthority=async()=>{
        if(phase==='authorize')change();return true;
      };
      const db={async query(sql){
        if(sql==='BEGIN'){
          events.push(sql);if(phase==='begin')change();return{rowCount:0,rows:[]};
        }
        if(sql==='COMMIT'||sql==='ROLLBACK'){
          events.push(sql);return{rowCount:0,rows:[]};
        }
        if(sql.includes('FROM inventory_purchase_intents')){
          if(phase==='intent')change();
          return{rowCount:1,rows:[{payload_sha256:hash,purchase_id:42,response_json:{purchase:{id:42}}}]};
        }
        if(sql.includes('FROM inventory_purchases')){
          if(phase==='purchase')change();return{rowCount:1,rows:[{id:42}]};
        }
        throw Error('Read-only inspection attempted unexpected SQL');
      }};
      await assert.rejects(inspectInventoryPurchaseIntent(db,opts),
        e=>e.code==='INVENTORY_PURCHASE_INTENT_CONFLICT'&&e.status===409,
        mutation+'/'+phase);
      assert.equal(events.at(-1),'ROLLBACK');
      assert.ok(!events.includes('COMMIT'));
    }
  }
});
