import test from 'node:test';
import assert from 'node:assert/strict';
import {
  postProfileBudgetEntry,transferProfileBudgetAllocation,
  createProfileMoneyMovementRequest,createProfileMoneyEntry,createProfileFinancialAccount,
  updateProfileFinancialAccount,upsertMoneyPreference,
  transferFundsBetweenProfiles,reverseProfileMoneyEntry
} from '../profile-finance-core.js';

// Actual public finance primitives, synthetic inputs. Invalid amounts must be
// refused BEFORE even a DB connection/query. No provider, account or DB used.
const noDb={
  connect(){throw new Error('DB was touched before input validation');},
  async query(){throw new Error('DB was touched before input validation');}
};
function entry(amount){
  return postProfileBudgetEntry(noDb,{
    accountId:11,envelopeId:22,entryKey:'budget-case',amount
  });
}
const mutations=[
  ['budget entry',entry],
  ['budget transfer',amount=>transferProfileBudgetAllocation(noDb,{
    publicId:'budget-transfer',transferKey:'budget-transfer',accountId:11,
    sourceEnvelopeId:22,destinationEnvelopeId:23,amount
  })],
  ['provider-HOLD movement',amount=>createProfileMoneyMovementRequest(noDb,{
    publicId:'movement',idempotencyKey:'movement',accountId:11,movementType:'transfer',
    sourceFinancialAccountId:1,destinationFinancialAccountId:2,amount
  })],
  ['Customer money entry',amount=>createProfileMoneyEntry(noDb,{
    publicId:'personal',entryKey:'personal',accountId:11,profileRole:'customer',
    entryType:'expense',direction:'out',category:'groceries',amount
  })],
  ['cross-profile internal transfer',amount=>transferFundsBetweenProfiles(noDb,{
    publicId:'profile-transfer',transferKey:'profile-transfer',accountId:11,
    sourceProfileRole:'customer',destinationProfileRole:'courier',amount
  })]
];
const invalid=[
  0,'0.00','0.001','0.004','0.005',0.001,0.005,'1.001','1.005','1.234',
  '1e3','0x10','0b10',true,false,[],[1],{},null,Infinity,NaN,-1,
  '1000000000000','999999999999.999','1.000','1.',' .5 '
];
for(const [label,fn] of mutations){
  test(label+' rejects amounts which cannot be posted as exact NUMERIC(14,2)',async()=>{
    for(const value of invalid){
      await assert.rejects(fn(value),error=>{
        assert.equal(error.status,400);
        assert.match(error.message,/decimal amount|between 0.01/);
        return true;
      },'invalid money value: '+String(value));
    }
  });
}

// Idempotency collisions across distinct long keys can acknowledge the wrong
// already-posted money instruction. Validate the literal key before ANY SQL.
test('all finance mutations reject oversized/coerced replay keys before database I/O',async()=>{
  const common='f'.repeat(220);
  const requests=[
    ['budget allocation',key=>postProfileBudgetEntry(noDb,{
      accountId:11,envelopeId:22,entryKey:key,amount:'1.23'
    })],
    ['budget transfer',key=>transferProfileBudgetAllocation(noDb,{
      publicId:'budget-transfer',transferKey:key,accountId:11,
      sourceEnvelopeId:22,destinationEnvelopeId:23,amount:'1.23'
    })],
    ['provider-HOLD transfer',key=>createProfileMoneyMovementRequest(noDb,{
      publicId:'movement',idempotencyKey:key,accountId:11,movementType:'transfer',
      sourceFinancialAccountId:1,destinationFinancialAccountId:2,amount:'1.23'
    })],
    ['personal expense',key=>createProfileMoneyEntry(noDb,{
      publicId:'entry',entryKey:key,accountId:11,profileRole:'customer',
      entryType:'expense',direction:'out',category:'groceries',amount:'1.23'
    })],
    ['personal correction',key=>reverseProfileMoneyEntry(noDb,{
      publicId:'reverse',reversalKey:key,accountId:11,profileRole:'customer',entryId:4
    })],
    ['internal profile funds',key=>transferFundsBetweenProfiles(noDb,{
      publicId:'transfer',transferKey:key,accountId:11,
      sourceProfileRole:'customer',destinationProfileRole:'courier',amount:'1.23'
    })]
  ];
  for(const [label,request] of requests){
    for(const invalid of [common+'A',common+'B',12,true,{},null,'  ',
      ' padded-key','padded-key ','\tpadded-key','padded-key\n',
      'padded\u0000key','padded\u007fkey']){
      await assert.rejects(request(invalid),e=>e.status===400&&/Idempotency key/.test(e.message),
        label+' must reject malformed/overlong key before DB access');
    }
  }
});

test('a 220-character finance replay key passes through the SQL lock unchanged',async()=>{
  const key='g'.repeat(220);
  const {pool}=budgetStub(1.23,key);
  const posted=await postProfileBudgetEntry(pool,{
    accountId:11,envelopeId:22,entryKey:key,amount:'1.23'
  });
  assert.equal(posted.amount,1.23);
});

// A real ledger operation is not necessary for valid amount conversion:
// stub the exact SQL boundary and inspect the numeric bind parameter.
function budgetStub(expected,expectedKey=null){
  const calls=[];
  const client={
    release(){},
    async query(sql,args=[]){
      calls.push(sql);
      if(sql==='BEGIN'||sql==='COMMIT')return{rowCount:0,rows:[]};
      if(sql.includes('pg_advisory_xact_lock(hashtextextended(')){
        assert.equal(args.length,1,'advisory lock must bind the original idempotency key');
        if(expectedKey!==null)assert.equal(args[0],expectedKey,'SQL lock must use untruncated key');
        return{rowCount:1,rows:[]};
      }
      if(sql.includes('FROM profile_budget_entries be')&&sql.includes('WHERE be.entry_key='))return{rowCount:0,rows:[]};
      if(sql.includes('SELECT * FROM profile_budget_envelopes WHERE id='))return{
        rowCount:1,rows:[{id:22,status:'active',profile_role:'customer',business_id:null}]
      };
      if(sql.includes('SELECT COALESCE(SUM(CASE WHEN direction='))return{rowCount:1,rows:[{balance:'0'}]};
      if(sql.includes('INSERT INTO profile_budget_entries(')){
        assert.equal(args[4],expected,'SQL bind must equal submitted exact cents');
        return{rowCount:1,rows:[{id:99,amount:args[4]}]};
      }
      if(sql.includes('INSERT INTO profile_finance_audit_events('))return{rowCount:1,rows:[]};
      throw new Error('Unexpected SQL in synthetic budget stub');
    }
  };
  return{calls,pool:{connect:async()=>client}};
}
test('valid decimal PHP values bind exact cents; no accidental provider movement',async()=>{
  for(const [input,expected] of [
    ['0.01',0.01],['1.23',1.23],['123.40',123.4],
    [0.1,0.1],[12.5,12.5],['999999999999.99',999999999999.99]
  ]){
    const {pool,calls}=budgetStub(expected);
    const posted=await postProfileBudgetEntry(pool,{
      accountId:11,envelopeId:22,entryKey:'valid-'+String(input),amount:input
    });
    assert.equal(posted.amount,expected);
    assert.ok(calls.includes('COMMIT'));
    const lockAt=calls.findIndex(sql=>sql.includes('pg_advisory_xact_lock(hashtextextended('));
    const replayAt=calls.findIndex(sql=>sql.includes('FROM profile_budget_entries be'));
    assert.ok(lockAt>=0&&replayAt>lockAt,'same-key transaction lock must precede replay lookup');
    assert.ok(!calls.includes('ROLLBACK'));
  }
});


// Same-key finance requests must replay *only identical* monetary instructions.
// These use the real exported routines and deterministic read-only DB adapters;
// production PostgreSQL precision/rollback remains tested by the separate job.
test('provider HOLD replay rejects changed cents/account/source without creating a new movement',async()=>{
  const prior={
    id:71,account_id:11,movement_type:'transfer',
    source_financial_account_id:1,destination_financial_account_id:2,
    amount:'1.23',currency_code:'PHP',provider_code:'',note:'approved',
    source_profile_role:'customer',destination_profile_role:'customer',
    status:'pending_provider',hold_code:'PROVIDER_MONEY_MOVEMENT_ADAPTER_NOT_CONNECTED'
  };
  const calls=[];
  const client={release(){},async query(sql){
    calls.push(sql);
    if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return{rowCount:0,rows:[]};
    if(sql.includes('pg_advisory_xact_lock(hashtextextended('))return{rowCount:1,rows:[]};
    if(sql.includes('SELECT * FROM profile_money_movements WHERE idempotency_key='))return{rowCount:1,rows:[prior]};
    if(sql.includes('FROM profile_money_movements m'))return{rowCount:1,rows:[prior]};
    throw Error('Unexpected movement replay SQL: '+sql);
  }};
  const pool={async connect(){return client}};
  const input={
    publicId:'new-id-unused',idempotencyKey:'hold-original',accountId:11,
    movementType:'transfer',sourceFinancialAccountId:1,destinationFinancialAccountId:2,
    amount:'1.23',currencyCode:'PHP',note:'approved'
  };
  for(const delta of [
    {amount:'1.24'},{sourceFinancialAccountId:4},
    {destinationFinancialAccountId:5},{note:'different approval'},
    {movementType:'withdrawal'}
  ])await assert.rejects(createProfileMoneyMovementRequest(pool,{...input,...delta}),e=>e.status===409);
  await assert.rejects(createProfileMoneyMovementRequest(pool,{...input,accountId:12}),e=>e.status===404);
  const restored=await createProfileMoneyMovementRequest(pool,input);
  assert.equal(restored.id,71);
  assert.equal(restored.amount,1.23);
  assert.equal(calls.filter(sql=>sql.includes('SELECT * FROM profile_money_movements WHERE idempotency_key=')).length,7,
    'six rejected replays and one accepted replay each look up the full key');
  assert.equal(calls.filter(sql=>sql.includes('pg_advisory_xact_lock(hashtextextended(')).length,7,
    'each replay takes the global key lock before lookup');
  assert.equal(calls.filter(sql=>sql==='ROLLBACK').length,6,'rejected replays roll back');
  assert.equal(calls.filter(sql=>sql==='COMMIT').length,1,'matching replay commits once');
});

test('personal Money entry replay rejects changed cents/category/direction and preserves original',async()=>{
  const prior={
    id:72,account_id:11,profile_role:'customer',entry_type:'expense',
    direction:'out',category:'groceries',amount:'2.31',currency_code:'PHP',
    financial_account_id:null,source_type:'manual',source_id:null,note:'groceries',
    evidence_reference:'',actor_account_id:11,occurred_at:'2026-11-01T12:00:00.000Z',
    status:'active'
  };
  const calls=[];
  const client={release(){},async query(sql){
    calls.push(sql);
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return{rowCount:0,rows:[]};
    if(sql.includes('pg_advisory_xact_lock(hashtextextended('))return{rowCount:1,rows:[]};
    if(sql.includes('SELECT * FROM profile_money_entries WHERE entry_key='))return{rowCount:1,rows:[prior]};
    if(sql.includes('FROM profile_money_entries e LEFT JOIN'))return{rowCount:1,rows:[prior]};
    throw Error('Unexpected personal replay SQL: '+sql);
  }};
  const pool={async connect(){return client}};
  const input={
    publicId:'unused-new-id',entryKey:'pme-original',accountId:11,profileRole:'customer',
    entryType:'expense',direction:'out',category:'groceries',amount:'2.31',
    currencyCode:'PHP',sourceType:'manual',note:'groceries'
  };
  for(const delta of [
    {amount:'2.32'},{entryType:'money_in',direction:'in',category:'income'},
    {category:'housing'},{note:'changed'},
    {sourceType:'external'},{financialAccountId:5}
  ])await assert.rejects(createProfileMoneyEntry(pool,{...input,...delta}),e=>e.status===409);
  await assert.rejects(createProfileMoneyEntry(pool,{...input,accountId:12}),e=>e.status===409);
  const restored=await createProfileMoneyEntry(pool,input);
  assert.equal(restored.id,72);
  assert.equal(restored.amount,2.31);
  assert.equal(calls.filter(sql=>sql.includes('SELECT * FROM profile_money_entries WHERE entry_key=')).length,8,
    'seven rejected replays and one accepted replay inspect the literal key under lock');
  assert.equal(calls.filter(sql=>sql.includes('pg_advisory_xact_lock(hashtextextended(')).length,8);
  assert.equal(calls.filter(sql=>sql==='ROLLBACK').length,7);
  assert.equal(calls.filter(sql=>sql==='COMMIT').length,1);
});

test('internal profile transfer replay rejects changed money instruction',async()=>{
  const prior={
    id:73,account_id:11,source_profile_role:'customer',source_business_id:null,
    destination_profile_role:'courier',destination_business_id:null,
    amount:'4.56',currency_code:'PHP',note:'move reserve',status:'succeeded'
  };
  const calls=[];
  const client={release(){},async query(sql){
    calls.push(sql);
    if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return{rowCount:0,rows:[]};
    if(sql.includes('pg_advisory_xact_lock('))return{rowCount:1,rows:[]};
    if(sql.includes('SELECT * FROM profile_fund_transfers WHERE transfer_key='))return{rowCount:1,rows:[prior]};
    throw Error('Unexpected internal transfer SQL: '+sql);
  }};
  const pool={
    async connect(){return client},
    async query(sql){
      calls.push(sql);
      throw Error('Replay must use the already scoped transaction row, not check out a second Pool client: '+sql);
    }
  };
  const input={
    publicId:'unused-transfer-id',transferKey:'transfer-original',
    accountId:11,sourceProfileRole:'customer',destinationProfileRole:'courier',
    amount:'4.56',currencyCode:'PHP',note:'move reserve'
  };
  for(const delta of [
    {amount:'4.57'},{sourceProfileRole:'service_provider'},
    {destinationProfileRole:'merchant',destinationBusinessId:3},
    {currencyCode:'USD'},{note:'different intent'}
  ])await assert.rejects(transferFundsBetweenProfiles(pool,{...input,...delta}),e=>e.status===409);
  await assert.rejects(transferFundsBetweenProfiles(pool,{...input,accountId:12}),e=>e.status===409);
  const restored=await transferFundsBetweenProfiles(pool,input);
  assert.equal(restored.id,73);
  assert.equal(restored.idempotent,true);
  assert.equal(calls.filter(x=>x.includes("hashtextextended('profile_fund_transfers:")).length,7,
    'global transfer-key lock is acquired for every conflicting/replayed request');
  assert.equal(calls.filter(x=>x==='SELECT pg_advisory_xact_lock($1)').length,7,
    'original per-account balance lock remains in place');
  assert.equal(calls.filter(x=>x.includes('LIMIT 100')).length,0,
    'replay must never depend on a capped 100-transfer history list');
  assert.equal(calls.some(x=>x.includes('WHERE id=$1 AND account_id=$2')),false,
    'replay returns the already fetched account-scoped transaction row');
  assert.equal(calls.filter(x=>x==='ROLLBACK').length,6);
  assert.equal(calls.filter(x=>x==='COMMIT').length,1);
});


// #871 financial-account metadata must never outlive its mandatory audit
// when the database rejects the audit insert. This exercises the exported
// primitive with a deterministic SQL boundary, not a real financial account.
test('financial account creation commits account metadata and audit atomically',async()=>{
  const input={publicId:'synthetic-account-871',accountId:11,profileRole:'customer',
    ownerScope:'account',accountKind:'cash',displayName:'Test cash'};
  const run=async(rejectAudit)=>{
    const calls=[];
    let released=false;
    const client={
      release(){released=true;},
      async query(sql){
        calls.push(sql);
        if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return{rowCount:0,rows:[]};
        if(sql.includes('INSERT INTO profile_financial_accounts('))return{
          rowCount:1,rows:[{id:42,public_id:input.publicId,profile_role:'customer',
            owner_scope:'account',business_id:null,account_kind:'cash',
            display_name:'Test cash',status:'active',currency_code:'PHP'}]
        };
        if(sql.includes('INSERT INTO profile_finance_audit_events(')){
          if(rejectAudit)throw Object.assign(new Error('synthetic audit failure'),{code:'23514'});
          return{rowCount:1,rows:[]};
        }
        throw new Error('Unexpected SQL: '+sql);
      }
    };
    const db={async connect(){return client},async query(){throw Error('Unscoped pool.query is forbidden')}};
    if(rejectAudit){
      await assert.rejects(createProfileFinancialAccount(db,input),error=>error.code==='23514');
      assert.equal(calls.includes('COMMIT'),false,'no commit on audit failure');
      assert.equal(calls.at(-1),'ROLLBACK','rejected audit must undo account INSERT');
    }else{
      const saved=await createProfileFinancialAccount(db,input);
      assert.equal(saved.id,42);
      assert.equal(calls.at(-1),'COMMIT','audit succeeds before committing account');
      assert.equal(calls.includes('ROLLBACK'),false);
    }
    const insertAt=calls.findIndex(sql=>sql.includes('INSERT INTO profile_financial_accounts('));
    const auditAt=calls.findIndex(sql=>sql.includes('INSERT INTO profile_finance_audit_events('));
    assert.equal(calls[0],'BEGIN');
    assert.ok(insertAt>0&&auditAt>insertAt,'account and audit use the same checked-out client');
    assert.equal(released,true,'client released after success or failure');
  };
  await run(true);
  await run(false);
});


test('financial account edits require audit success on one locked transaction',async()=>{
  const row={id:42,account_id:11,profile_role:'customer',business_id:null,public_id:'synthetic-a',
    owner_scope:'account',account_kind:'cash',currency_code:'PHP',status:'active',
    display_name:'Old cash',provider_destination_ref:'',verification_status:'unverified',
    can_pay:true,can_receive:false,can_payout:false};
  for(const rejectAudit of [true,false]){
    const events=[];let released=false;
    const client={
      release(){released=true},
      async query(sql,args){
        events.push(sql);
        if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return{rowCount:0,rows:[]};
        if(sql.includes('SELECT * FROM profile_financial_accounts'))return{rowCount:1,rows:[row]};
        if(sql.includes('UPDATE profile_financial_accounts SET'))
          return{rowCount:1,rows:[{...row,display_name:args[0],status:args[10]}]};
        if(sql.includes('INSERT INTO profile_finance_audit_events(')){
          if(rejectAudit)throw Object.assign(new Error('audit rejected'),{code:'23514'});
          return{rowCount:1,rows:[]};
        }
        throw Error('Unexpected SQL: '+sql);
      }
    };
    const db={async connect(){return client},async query(){throw Error('Unscoped pool.query forbidden')}};
    const change=updateProfileFinancialAccount(db,{accountId:11,id:42,displayName:'New cash',status:'inactive'});
    if(rejectAudit){
      await assert.rejects(change,e=>e.code==='23514');
      assert.equal(events.includes('COMMIT'),false);
      assert.equal(events.at(-1),'ROLLBACK');
    }else{
      const updated=await change;
      assert.equal(updated.display_name,'New cash');
      assert.equal(updated.status,'inactive');
      assert.equal(events.at(-1),'COMMIT');
    }
    assert.equal(events[0],'BEGIN');
    assert.match(events[1],/FOR UPDATE/);
    assert.ok(events.findIndex(e=>e.includes('UPDATE profile_financial_accounts SET'))<
      events.findIndex(e=>e.includes('INSERT INTO profile_finance_audit_events(')));
    assert.equal(released,true);
  }
});

test('money preferences and audit are atomic for initial or repeated upsert',async()=>{
  for(const rejectAudit of [true,false]){
    const events=[];let released=false;
    const client={
      release(){released=true},
      async query(sql){
        events.push(sql);
        if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return{rowCount:0,rows:[]};
        if(sql.includes('INSERT INTO profile_money_preferences('))return{rowCount:1,rows:[{
          id:24,profile_role:'customer',business_id:null,
          accepted_methods:['cash'],payout_schedule_preference:'daily',
          default_receive_account_id:null,default_spend_account_id:null,
          default_payout_account_id:null,updated_at:new Date(0)
        }]};
        if(sql.includes('INSERT INTO profile_finance_audit_events(')){
          if(rejectAudit)throw Object.assign(new Error('audit rejected'),{code:'23514'});
          return{rowCount:1,rows:[]};
        }
        throw Error('Unexpected SQL: '+sql);
      }
    };
    const db={async connect(){return client},async query(){throw Error('Unscoped pool.query forbidden')}};
    const change=upsertMoneyPreference(db,{accountId:11,profileRole:'customer',
      acceptedMethods:['cash'],payoutSchedulePreference:'daily'});
    if(rejectAudit){
      await assert.rejects(change,e=>e.code==='23514');
      assert.equal(events.includes('COMMIT'),false);
      assert.equal(events.at(-1),'ROLLBACK');
    }else{
      const stored=await change;
      assert.equal(stored.payout_schedule_preference,'daily');
      assert.deepEqual(stored.accepted_methods,['cash']);
      assert.equal(events.at(-1),'COMMIT');
    }
    assert.equal(events[0],'BEGIN');
    assert.ok(events.findIndex(e=>e.includes('INSERT INTO profile_money_preferences('))<
      events.findIndex(e=>e.includes('INSERT INTO profile_finance_audit_events(')));
    assert.equal(released,true);
  }
});

test('backdated Money entry returns the committed scoped row, not a capped recent-history page',async()=>{
  let committed=false,released=false,reads=0;
  const recorded={
    id:911,public_id:'ci-backdated-911',entry_type:'expense',direction:'out',
    category:'groceries',amount:'1.23',currency_code:'PHP',financial_account_id:null,
    source_type:'manual',source_id:null,note:'backdated',evidence_reference:'',
    status:'active',reversal_of_id:null,occurred_at:new Date('2005-01-01T00:00:00Z'),
    created_at:new Date('2026-11-02T00:00:00Z')
  };
  const client={release(){released=true},async query(sql){
    if(sql==='BEGIN'||sql==='ROLLBACK')return{rowCount:0,rows:[]};
    if(sql==='COMMIT'){committed=true;return{rowCount:0,rows:[]}}
    if(sql.includes('pg_advisory_xact_lock'))return{rowCount:1,rows:[]};
    if(sql.includes('SELECT * FROM profile_money_entries WHERE entry_key='))return{rowCount:0,rows:[]};
    if(sql.includes('INSERT INTO profile_money_entries('))return{rowCount:1,rows:[recorded]};
    if(sql.includes('INSERT INTO profile_finance_audit_events('))return{rowCount:1,rows:[]};
    throw Error('Unexpected transaction SQL: '+sql);
  }};
  const db={async connect(){return client},async query(sql,args){
    reads++;
    assert.equal(committed,true,'row reload happens after ledger + audit commit');
    assert.match(sql,/WHERE e\.id=\$1 AND e\.account_id=\$2 AND e\.profile_role=\$3/);
    assert.doesNotMatch(sql,/ORDER BY|LIMIT/i,'never silently use a 250-row recent page');
    assert.deepEqual(args,[911,11,'customer'],'lookup is scoped to account and profile');
    return{rowCount:1,rows:[recorded]};
  }};
  const posted=await createProfileMoneyEntry(db,{
    publicId:recorded.public_id,entryKey:'backdated-key-911',accountId:11,
    profileRole:'customer',entryType:'expense',direction:'out',category:'groceries',
    amount:'1.23',occurredAt:'2005-01-01T00:00:00Z',note:'backdated'
  });
  assert.equal(posted.id,911);
  assert.equal(posted.amount,1.23);
  assert.equal(posted.public_id,'ci-backdated-911');
  assert.equal(reads,1);
  assert.equal(released,true);
});


test('Money reversal serializes its key BEFORE replay lookup, and returns the original reversal',async()=>{
  const events=[];let released=false;
  const prior={id:9002,account_id:11,profile_role:'customer',reversal_of_id:9001};
  const client={release(){released=true},async query(sql,args=[]){
    if(sql==='BEGIN'||sql==='COMMIT'){events.push(sql);return{rowCount:0,rows:[]}}
    if(sql.includes('pg_advisory_xact_lock')){
      assert.match(sql,/profile_money_entries:/);
      assert.deepEqual(args,['ci-same-reversal-key']);
      events.push('LOCK');return{rowCount:1,rows:[]};
    }
    if(sql.includes('SELECT id,account_id,profile_role,reversal_of_id FROM profile_money_entries')){
      assert.deepEqual(args,['ci-same-reversal-key']);
      events.push('REPLAY');return{rowCount:1,rows:[prior]};
    }
    throw Error('Unexpected reversal SQL: '+sql);
  }};
  const pool={async connect(){return client},async query(){throw Error('Unscoped query forbidden')}};
  const result=await reverseProfileMoneyEntry(pool,{
    publicId:'ci-reversal-9002',reversalKey:'ci-same-reversal-key',
    accountId:11,profileRole:'customer',entryId:9001
  });
  assert.deepEqual(events,['BEGIN','LOCK','REPLAY','COMMIT']);
  assert.equal(result.reversal_id,9002);
  assert.equal(result.idempotent,true);
  assert.equal(result.status,'reversed');
  assert.equal(released,true);
});
