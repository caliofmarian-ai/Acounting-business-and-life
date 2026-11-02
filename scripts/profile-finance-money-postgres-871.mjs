// #871: Exact-cent finance contract against disposable PostgreSQL 16 only.
// This tests the real exported budget primitive and its SQL transactions.
// It does NOT imply authenticated UI, payment-provider, Preview or Production acceptance.
import assert from 'node:assert/strict';
import pg from 'pg';
import {
  postProfileBudgetEntry,
  transferProfileBudgetAllocation,
  createProfileMoneyMovementRequest,
  createProfileMoneyEntry,
  createProfileFinancialAccount,updateProfileFinancialAccount,upsertMoneyPreference,
  transferFundsBetweenProfiles
} from '../profile-finance-core.js';

if(process.env.NODE_ENV!=='test'||
   process.env.ABL_FINANCE_PRECISION_CI!=='1'||
   process.env.PGHOST!=='127.0.0.1'||
   process.env.PGDATABASE!=='abl_finance_precision_ci'){
  throw new Error('Disposable localhost PostgreSQL CI only; never execute against live accounts.');
}
const pool=new pg.Pool({max:2,connectionTimeoutMillis:5000});
const rowCount=async(table)=>Number((await pool.query('SELECT COUNT(*)::int AS count FROM '+table)).rows[0].count);
let assertions=0;
const eq=(a,b,message)=>{assert.equal(a,b,message);assertions++};
const writeBudget=(amount,key)=>postProfileBudgetEntry(pool,{
  accountId:11,envelopeId:22,entryKey:key,amount
});
const invalid=[
  '0.001','0.005','1.001','1.005','1.234','1e3','0x10',
  '0b10','1.',' .5 ','1.000','1000000000000','999999999999.999',
  '-1','0','0.00','Infinity','NaN','1,000.00',
  true,false,null,[],{},-1,0,0.005,Infinity,NaN
];
const invalidMutations=[
  amount=>writeBudget(amount,'invalid-budget'),
  amount=>transferProfileBudgetAllocation(pool,{
    publicId:'invalid-transfer',transferKey:'invalid-transfer',accountId:11,
    sourceEnvelopeId:22,destinationEnvelopeId:23,amount
  }),
  amount=>createProfileMoneyMovementRequest(pool,{
    publicId:'invalid-hold',idempotencyKey:'invalid-hold',accountId:11,
    movementType:'transfer',sourceFinancialAccountId:1,destinationFinancialAccountId:2,amount
  }),
  amount=>createProfileMoneyEntry(pool,{
    publicId:'invalid-entry',entryKey:'invalid-entry',accountId:11,
    profileRole:'customer',entryType:'expense',direction:'out',category:'groceries',amount
  }),
  amount=>transferFundsBetweenProfiles(pool,{
    publicId:'invalid-profile-transfer',transferKey:'invalid-profile-transfer',accountId:11,
    sourceProfileRole:'customer',destinationProfileRole:'courier',amount
  })
];

try{
  eq((await pool.query('SELECT current_database() AS db')).rows[0].db,
    'abl_finance_precision_ci','must use dedicated disposable database');
  await pool.query(`
    CREATE TABLE profile_budget_envelopes(
      id BIGINT PRIMARY KEY,account_id BIGINT NOT NULL,status TEXT NOT NULL,
      profile_role TEXT NOT NULL,business_id BIGINT,currency_code TEXT NOT NULL
    );
    CREATE TABLE profile_budget_entries(
      id BIGSERIAL PRIMARY KEY,entry_key TEXT NOT NULL UNIQUE,
      envelope_id BIGINT NOT NULL,direction TEXT NOT NULL,entry_type TEXT NOT NULL,
      amount NUMERIC(14,2) NOT NULL CHECK(amount>0),
      source_type TEXT,source_id TEXT,note TEXT,actor_account_id BIGINT
    );
    CREATE TABLE profile_budget_transfers(
      id BIGSERIAL PRIMARY KEY,public_id TEXT NOT NULL UNIQUE,transfer_key TEXT NOT NULL UNIQUE,
      account_id BIGINT NOT NULL,source_envelope_id BIGINT NOT NULL,
      destination_envelope_id BIGINT NOT NULL,amount NUMERIC(14,2) NOT NULL CHECK(amount>0),
      currency_code TEXT NOT NULL,transfer_type TEXT NOT NULL
        DEFAULT 'internal_budget_reallocation'
    );
    CREATE TABLE profile_finance_audit_events(
      id BIGSERIAL PRIMARY KEY,account_id BIGINT NOT NULL,profile_role TEXT NOT NULL,
      business_id BIGINT,financial_account_id BIGINT,event_code TEXT NOT NULL,detail_json JSONB NOT NULL
    );
    CREATE TABLE profile_financial_accounts(
      id BIGINT PRIMARY KEY,account_id BIGINT NOT NULL,status TEXT NOT NULL,
      currency_code TEXT NOT NULL,account_kind TEXT NOT NULL,
      can_pay BOOLEAN NOT NULL,can_receive BOOLEAN NOT NULL,can_payout BOOLEAN NOT NULL,
      provider_code TEXT,profile_role TEXT NOT NULL,business_id BIGINT,
      display_name TEXT,reference_last4 TEXT
    );
    CREATE TABLE profile_money_movements(
      id BIGSERIAL PRIMARY KEY,public_id TEXT NOT NULL UNIQUE,
      idempotency_key TEXT NOT NULL UNIQUE,account_id BIGINT NOT NULL,
      movement_type TEXT NOT NULL,source_financial_account_id BIGINT NOT NULL,
      destination_financial_account_id BIGINT NOT NULL,
      source_profile_role TEXT,source_business_id BIGINT,
      destination_profile_role TEXT,destination_business_id BIGINT,
      amount NUMERIC(14,2) NOT NULL CHECK(amount>0),
      currency_code TEXT NOT NULL,provider_code TEXT,
      status TEXT NOT NULL,hold_code TEXT,note TEXT,
      provider_reference TEXT,evidence_reference TEXT,failure_code TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    INSERT INTO profile_financial_accounts
      (id,account_id,status,currency_code,account_kind,can_pay,can_receive,can_payout,provider_code,profile_role,display_name)
    VALUES (101,11,'active','PHP','cash',true,true,false,'','customer','Source cash'),
           (102,11,'active','PHP','bank',true,true,true,'','customer','Destination bank'),
           (103,12,'active','PHP','cash',true,true,false,'','customer','Other account cash'),
           (104,12,'active','PHP','bank',true,true,true,'','customer','Other account bank');
    INSERT INTO profile_budget_envelopes
      (id,account_id,status,profile_role,business_id,currency_code)
      VALUES (22,11,'active','customer',NULL,'PHP'),
             (23,11,'active','customer',NULL,'PHP'),
             (24,12,'active','customer',NULL,'PHP');
  `);
  // Before any accepted operation, each malformed amount must fail prior to
  // connecting or issuing INSERTs in all five finance write primitives.
  for(const [index,mutation] of invalidMutations.entries()){
    for(const bad of invalid){
      await assert.rejects(mutation(bad),error=>
        error.status===400&&/decimal amount|between 0.01/.test(error.message),
        'mutation '+index+' should reject '+String(bad));
      assertions++;
    }
  }
  eq(await rowCount('profile_budget_entries'),0,'invalid input created no budget entry');
  eq(await rowCount('profile_finance_audit_events'),0,'invalid input created no audit event');

  for(const [i,amount] of ['0.01','1.23','999999999999.99'].entries()){
    const key='valid-precision-'+i;
    const saved=await writeBudget(amount,key);
    const db=await pool.query(
      'SELECT amount::text AS amount FROM profile_budget_entries WHERE entry_key=$1',[key]);
    eq(db.rows[0].amount,amount,'PostgreSQL NUMERIC(14,2) stored submitted cents');
    eq(Number(saved.amount),Number(amount),'returned amount preserved');
    const replay=await writeBudget(amount,key);
    eq(Number(replay.id),Number(saved.id),'idempotent replay returns same entry');
  }
  // Reusing a key with a different amount, destination, direction or note
  // cannot silently report the first posting as a successful new instruction.
  // The globally unique key also cannot return another account's budget row.
  for(const [label,attempt] of [
    ['changed cents',()=>writeBudget('1.24','valid-precision-1')],
    ['changed envelope',()=>postProfileBudgetEntry(pool,{
      accountId:11,envelopeId:23,entryKey:'valid-precision-1',amount:'1.23'
    })],
    ['changed direction',()=>postProfileBudgetEntry(pool,{
      accountId:11,envelopeId:22,entryKey:'valid-precision-1',amount:'1.23',
      direction:'debit'
    })],
    ['changed note',()=>postProfileBudgetEntry(pool,{
      accountId:11,envelopeId:22,entryKey:'valid-precision-1',amount:'1.23',
      note:'different approval'
    })]
  ]){
    await assert.rejects(attempt(),error=>error.status===409,
      label+' must not be acknowledged as an idempotent replay');
    assertions++;
  }
  await assert.rejects(postProfileBudgetEntry(pool,{
    accountId:12,envelopeId:24,entryKey:'valid-precision-1',amount:'1.23'
  }),error=>error.status===404,
  'cross-account key collision must not disclose or acknowledge an existing budget row');
  assertions++;
  eq(await rowCount('profile_budget_entries'),3,'valid requests only three entries');
  eq(await rowCount('profile_finance_audit_events'),3,'valid requests only three audit events');

  // Real PostgreSQL concurrency: both callers begin with a previously absent
  // key. Without per-key serialization, the second pre-insert SELECT can race
  // the first INSERT and surface a raw 23505 instead of an idempotent replay.
  const [sameA,sameB]=await Promise.all([
    writeBudget('2.37','concurrent-valid-replay'),
    writeBudget('2.37','concurrent-valid-replay')
  ]);
  eq(Number(sameA.id),Number(sameB.id),
    'parallel identical instructions resolve to the same committed entry');
  eq(await rowCount('profile_budget_entries'),4,
    'parallel replay writes exactly one additional budget entry');
  eq(await rowCount('profile_finance_audit_events'),4,
    'parallel replay writes exactly one additional audit event');

  // A simultaneous reuse of the same key for differing amounts must
  // acknowledge exactly one posting and return a deliberate 409 for the other.
  const conflicting=await Promise.allSettled([
    writeBudget('2.41','concurrent-conflicting-instructions'),
    writeBudget('2.42','concurrent-conflicting-instructions')
  ]);
  eq(conflicting.filter(item=>item.status==='fulfilled').length,1,
    'only one conflicting instruction can commit');
  const rejected=conflicting.filter(item=>item.status==='rejected');
  eq(rejected.length,1,'other instruction must be rejected');
  eq(rejected[0].reason.status,409,
    'conflicting concurrent replay gets 409, not a raw database unique violation');
  eq(await rowCount('profile_budget_entries'),5,
    'conflicting parallel instructions commit just one extra entry');
  eq(await rowCount('profile_finance_audit_events'),5,
    'conflicting parallel instructions append just one audit event');

  // Force an actual database error *after* the entry INSERT. The primitive
  // must ROLLBACK both the entry and audit; no partial financial history.
  await pool.query(`
    ALTER TABLE profile_finance_audit_events
      ADD CONSTRAINT synthetic_audit_rejection
      CHECK (NOT (event_code = 'budget_allocation_changed' AND detail_json->>'amount' = '9.99'))
  `);
  const entriesBefore=await rowCount('profile_budget_entries');
  const auditsBefore=await rowCount('profile_finance_audit_events');
  await assert.rejects(writeBudget('9.99','rollback-on-audit'),
    error=>error.code==='23514','actual PostgreSQL constraint must abort transaction');
  assertions++;
  eq(await rowCount('profile_budget_entries'),entriesBefore,
    'audit failure rolled back entry insert');
  eq(await rowCount('profile_finance_audit_events'),auditsBefore,
    'audit failure left no partial audit row');
  await pool.query('ALTER TABLE profile_finance_audit_events DROP CONSTRAINT synthetic_audit_rejection');
  const retry=await writeBudget('9.99','rollback-on-audit');
  eq(Number(retry.amount),9.99,'retry after rollback creates exactly one valid entry');
  eq(await rowCount('profile_budget_entries'),entriesBefore+1,'single retry entry');
  eq(await rowCount('profile_finance_audit_events'),auditsBefore+1,'single retry audit');

  // Separate budget-transfer keys are global, too. The prior transfer code
  // acknowledged any matching key before checking account or instructions.
  // Keep accepted replays unique, preserve the debit-entry note/actor, and
  // serialize same-key requests on actual separate PostgreSQL transactions.
  const transfer=(key,amount='0.12',overrides={})=>transferProfileBudgetAllocation(pool,{
    publicId:'precision-transfer-'+key,transferKey:key,accountId:11,
    sourceEnvelopeId:22,destinationEnvelopeId:23,amount,
    actorAccountId:11,note:'approved planned reallocation',...overrides
  });
  const firstTransfer=await transfer('transfer-replay');
  const transferAgain=await transfer('transfer-replay');
  eq(Number(firstTransfer.id),Number(transferAgain.id),'same transfer request returns original');
  eq(transferAgain.idempotent,true,'replay reports idempotent');
  eq(transferAgain.provider_money_moved,false,'budget move is never a provider payment');
  eq(await rowCount('profile_budget_transfers'),1,'replay has just one transfer');
  for(const [label,fn] of [
    ['amount',()=>transfer('transfer-replay','0.13')],
    ['source envelope',()=>transfer('transfer-replay','0.12',{sourceEnvelopeId:23,destinationEnvelopeId:22})],
    ['note',()=>transfer('transfer-replay','0.12',{note:'other instruction'})],
    ['actor',()=>transfer('transfer-replay','0.12',{actorAccountId:13})]
  ]){
    await assert.rejects(fn(),error=>error.status===409,
      'reused key with different '+label+' must get deliberate 409');
    assertions++;
  }
  await assert.rejects(transfer('transfer-replay','0.12',{
    accountId:12,sourceEnvelopeId:24,destinationEnvelopeId:23
  }),error=>error.status===404,'other account must not see or replay transfer');
  assertions++;
  eq(await rowCount('profile_budget_transfers'),1,'invalid replays created no transfer');

  const [parallelA,parallelB]=await Promise.all([
    transfer('transfer-parallel-same','0.21'),
    transfer('transfer-parallel-same','0.21')
  ]);
  eq(Number(parallelA.id),Number(parallelB.id),
    'concurrent identical transfer instruction resolves to same row');
  eq(await rowCount('profile_budget_transfers'),2,
    'identical concurrent calls add exactly one transfer');
  const conflictingTransfer=await Promise.allSettled([
    transfer('transfer-parallel-conflict','0.31'),
    transfer('transfer-parallel-conflict','0.32')
  ]);
  eq(conflictingTransfer.filter(x=>x.status==='fulfilled').length,1,
    'one concurrent conflicting transfer succeeds');
  eq(conflictingTransfer.filter(x=>x.status==='rejected').length,1,
    'other concurrent conflicting transfer rejects');
  eq(conflictingTransfer.find(x=>x.status==='rejected').reason.status,409,
    'conflict returns controlled 409, not raw 23505');
  eq(await rowCount('profile_budget_transfers'),3,
    'conflicting concurrent instructions append one transfer only');

  // A failed audit after both debit/credit ledger rows must roll back the
  // transfer and both entries as one atomic PostgreSQL transaction.
  await pool.query(`
    ALTER TABLE profile_finance_audit_events
      ADD CONSTRAINT synthetic_transfer_audit_rejection
      CHECK (NOT (event_code='internal_budget_reallocation'
        AND detail_json->>'amount'='4.44'))
  `);
  const transfersBefore=await rowCount('profile_budget_transfers');
  const ledgersBefore=await rowCount('profile_budget_entries');
  const transferAuditsBefore=await rowCount('profile_finance_audit_events');
  await assert.rejects(transfer('transfer-audit-rollback','4.44'),
    error=>error.code==='23514','real PostgreSQL transfer audit must fail');
  assertions++;
  eq(await rowCount('profile_budget_transfers'),transfersBefore,
    'audit rejection rolls back transfer row');
  eq(await rowCount('profile_budget_entries'),ledgersBefore,
    'audit rejection rolls back both debit and credit ledger entries');
  eq(await rowCount('profile_finance_audit_events'),transferAuditsBefore,
    'audit rejection leaves no partial finance audit');
  await pool.query(
    'ALTER TABLE profile_finance_audit_events DROP CONSTRAINT synthetic_transfer_audit_rejection'
  );
  await transfer('transfer-audit-rollback','4.44');
  eq(await rowCount('profile_budget_transfers'),transfersBefore+1,
    'valid retry after rollback writes one transfer');
  eq(await rowCount('profile_budget_entries'),ledgersBefore+2,
    'valid retry after rollback writes two balanced ledger entries');
  eq(await rowCount('profile_finance_audit_events'),transferAuditsBefore+1,
    'valid retry after rollback writes one audit');

  // Provider-adapter HOLD requests cannot move money. Replays use a
  // database-scoped key lock; the movement and its audit commit atomically.
  const hold=(key,amount='1.23',overrides={})=>createProfileMoneyMovementRequest(pool,{
    publicId:'ci-hold-'+key,idempotencyKey:key,accountId:11,
    movementType:'transfer',sourceFinancialAccountId:101,
    destinationFinancialAccountId:102,amount,note:'reviewed HOLD',...overrides
  });
  const [holdA,holdB]=await Promise.all([
    hold('parallel-same-hold'),hold('parallel-same-hold')
  ]);
  eq(holdA.id,holdB.id,'parallel same-key HOLD returns identical movement');
  eq(holdA.status,'pending_provider','HOLD remains pending, not a payout');
  eq(holdA.execution_ready,false,'HOLD cannot execute a provider transfer');
  eq(await rowCount('profile_money_movements'),1,'only one HOLD committed');
  const holdAudits=()=>pool.query("SELECT COUNT(*)::int AS count FROM profile_finance_audit_events WHERE event_code='money_movement_request_created'");
  eq(Number((await holdAudits()).rows[0].count),1,'one audit for same-key parallel HOLD');
  const conflictHolds=await Promise.allSettled([
    hold('parallel-conflict-hold','2.31'),
    hold('parallel-conflict-hold','2.32')
  ]);
  eq(conflictHolds.filter(x=>x.status==='fulfilled').length,1,
    'parallel conflicting HOLD keys commit only one instruction');
  eq(conflictHolds.find(x=>x.status==='rejected').reason.status,409,
    'conflicting HOLD replay returns a deliberate 409');
  eq(await rowCount('profile_money_movements'),2,'conflicting requests add one HOLD');
  eq(Number((await holdAudits()).rows[0].count),2,'conflicting requests add one audit');
  await assert.rejects(hold('parallel-same-hold','1.24'),
    e=>e.status===409,'reused HOLD key with new cents must be rejected');
  assertions++;
  await assert.rejects(hold('parallel-same-hold','1.23',{
    accountId:12,sourceFinancialAccountId:103,destinationFinancialAccountId:104
  }),e=>e.status===404,'other account must not observe replayed HOLD');
  assertions++;

  await pool.query(`
    ALTER TABLE profile_finance_audit_events
      ADD CONSTRAINT synthetic_hold_audit_rejection
      CHECK (NOT (event_code='money_movement_request_created'
        AND detail_json->>'amount'='9.99'))
  `);
  const holdsBefore=await rowCount('profile_money_movements');
  const holdAuditsBefore=Number((await holdAudits()).rows[0].count);
  await assert.rejects(hold('audit-rollback-hold','9.99'),
    error=>error.code==='23514','real PostgreSQL audit failure must abort HOLD');
  assertions++;
  eq(await rowCount('profile_money_movements'),holdsBefore,
    'audit failure rolled back movement and its idempotency key');
  eq(Number((await holdAudits()).rows[0].count),holdAuditsBefore,
    'audit failure left no partial movement audit');
  await pool.query('ALTER TABLE profile_finance_audit_events DROP CONSTRAINT synthetic_hold_audit_rejection');
  const recoveredHold=await hold('audit-rollback-hold','9.99');
  eq(recoveredHold.status,'pending_provider','retry after audit failure saves HOLD');
  eq(await rowCount('profile_money_movements'),holdsBefore+1,
    'retry after rolled-back audit writes exactly one movement');
  eq(Number((await holdAudits()).rows[0].count),holdAuditsBefore+1,
    'retry after rollback writes exactly one audit');


  // New personal Money regression: real PostgreSQL lock, concurrent idempotent
  // replay and full entry+audit rollback, never real account/provider data.
  await pool.query(`
    CREATE TABLE profile_money_entries(
      id BIGSERIAL PRIMARY KEY,public_id TEXT NOT NULL UNIQUE,
      entry_key TEXT NOT NULL UNIQUE,account_id BIGINT NOT NULL,
      profile_role TEXT NOT NULL,financial_account_id BIGINT,
      source_type TEXT NOT NULL,source_id BIGINT,
      entry_type TEXT NOT NULL,direction TEXT NOT NULL,category TEXT NOT NULL,
      amount NUMERIC(14,2) NOT NULL CHECK(amount>0),
      currency_code TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',
      evidence_reference TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',reversal_of_id BIGINT,
      actor_account_id BIGINT,occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  const expense=(key,amount='1.23')=>createProfileMoneyEntry(pool,{
    publicId:'ci-personal-'+key,entryKey:key,accountId:11,
    profileRole:'customer',entryType:'expense',direction:'out',
    category:'groceries',amount,currencyCode:'PHP',
    sourceType:'manual',note:'disposable test expense'
  });
  const personalAudits=async()=>Number((await pool.query(
    "SELECT COUNT(*)::int AS count FROM profile_finance_audit_events WHERE event_code='profile_money_entry_created'"
  )).rows[0].count);
  const [personalA,personalB]=await Promise.all([
    expense('parallel-same-personal'),expense('parallel-same-personal')
  ]);
  eq(personalA.id,personalB.id,'parallel same-key personal Money returns original entry');
  eq(await rowCount('profile_money_entries'),1,'parallel same key writes one entry');
  eq(await personalAudits(),1,'parallel same key writes one audit');
  const personalConflict=await Promise.allSettled([
    expense('parallel-conflict-personal','2.31'),
    expense('parallel-conflict-personal','2.32')
  ]);
  eq(personalConflict.filter(x=>x.status==='fulfilled').length,1,
    'one conflicting concurrent personal instruction commits');
  eq(personalConflict.filter(x=>x.status==='rejected').length,1,
    'other conflicting instruction rejects');
  eq(personalConflict.find(x=>x.status==='rejected').reason.status,409,
    'conflicting personal replay returns deliberate 409, not raw unique error');
  eq(await rowCount('profile_money_entries'),2,'conflicting instructions write one more entry');
  eq(await personalAudits(),2,'conflicting instructions write one more audit');
  await pool.query(`
    ALTER TABLE profile_finance_audit_events
    ADD CONSTRAINT synthetic_personal_audit_rejection
    CHECK (NOT (event_code='profile_money_entry_created'
      AND detail_json->>'amount'='9.99'))
  `);
  const personalBefore=await rowCount('profile_money_entries');
  const auditBefore=await personalAudits();
  await assert.rejects(expense('rollback-personal','9.99'),
    error=>error.code==='23514','actual PostgreSQL audit failure aborts personal entry');
  assertions++;
  eq(await rowCount('profile_money_entries'),personalBefore,
    'failed audit rolls back personal entry');
  eq(await personalAudits(),auditBefore,
    'failed audit leaves no partial personal audit');
  await pool.query('ALTER TABLE profile_finance_audit_events DROP CONSTRAINT synthetic_personal_audit_rejection');
  const personalRetry=await expense('rollback-personal','9.99');
  eq(personalRetry.amount,9.99,'successful retry preserves exact cents');
  eq(await rowCount('profile_money_entries'),personalBefore+1,'retry writes one personal entry');
  eq(await personalAudits(),auditBefore+1,'retry writes one personal audit');


  // Real PostgreSQL constraint rejection must roll back creation of a
  // financial account (including prospective payout destination metadata).
  // Existing fixture IDs remain explicit; identity generates the fresh ID.
  await pool.query(`
    ALTER TABLE profile_financial_accounts
      ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY,
      ALTER COLUMN status SET DEFAULT 'active',
      ADD COLUMN public_id TEXT UNIQUE,
      ADD COLUMN owner_scope TEXT DEFAULT 'account',
      ADD COLUMN provider_destination_ref TEXT,
      ADD COLUMN institution_name TEXT,
      ADD COLUMN account_name TEXT,
      ADD COLUMN verification_status TEXT DEFAULT 'unverified',
      ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW(),
      ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW()
  `);
  const createAccount=()=>createProfileFinancialAccount(pool,{
    publicId:'ci-financial-account-audit-871',accountId:11,
    profileRole:'customer',ownerScope:'account',accountKind:'cash',
    displayName:'Disposable account',currencyCode:'PHP'
  });
  const financialCountBefore=await rowCount('profile_financial_accounts');
  const accountAuditBefore=await rowCount('profile_finance_audit_events');
  await pool.query(`
    ALTER TABLE profile_finance_audit_events
    ADD CONSTRAINT synthetic_financial_account_audit_rejection
    CHECK (event_code <> 'financial_account_created')
  `);
  await assert.rejects(createAccount(),error=>error.code==='23514',
    'actual PostgreSQL audit rejection must abort financial account creation');
  assertions++;
  eq(await rowCount('profile_financial_accounts'),financialCountBefore,
    'no account/payout-destination metadata persists without its audit');
  eq(await rowCount('profile_finance_audit_events'),accountAuditBefore,
    'failed account creation leaves no partial audit');
  await pool.query(
    'ALTER TABLE profile_finance_audit_events DROP CONSTRAINT synthetic_financial_account_audit_rejection'
  );
  const createdAccount=await createAccount();
  eq(createdAccount.public_id,'ci-financial-account-audit-871',
    'retry after actual database rollback creates original account instruction');
  eq(await rowCount('profile_financial_accounts'),financialCountBefore+1,
    'successful retry adds exactly one financial account');
  eq(await rowCount('profile_finance_audit_events'),accountAuditBefore+1,
    'successful retry adds exactly one audit event');
  const linkedAccountAudit=await pool.query(`
    SELECT financial_account_id FROM profile_finance_audit_events
    WHERE event_code='financial_account_created'
    ORDER BY id DESC LIMIT 1
  `);
  eq(Number(linkedAccountAudit.rows[0].financial_account_id),createdAccount.id,
    'audit links to the exact created account in the same transaction');


  // Actual PostgreSQL audit failure must roll back account metadata UPDATE.
  const changeAccount=()=>updateProfileFinancialAccount(pool,{
    accountId:11,id:createdAccount.id,displayName:'Updated CI account',status:'inactive'
  });
  const accountUpdateAuditBefore=await rowCount('profile_finance_audit_events');
  await pool.query(`ALTER TABLE profile_finance_audit_events
    ADD CONSTRAINT synthetic_financial_update_audit_rejection
    CHECK (event_code <> 'financial_account_updated')`);
  await assert.rejects(changeAccount(),error=>error.code==='23514');assertions++;
  const oldMetadata=await pool.query(
    'SELECT display_name,status FROM profile_financial_accounts WHERE id=$1',[createdAccount.id]);
  eq(oldMetadata.rows[0].display_name,'Disposable account','audit failure rolls back account name');
  eq(oldMetadata.rows[0].status,'active','audit failure rolls back account status');
  eq(await rowCount('profile_finance_audit_events'),accountUpdateAuditBefore,
    'failed account update added no audit');
  await pool.query('ALTER TABLE profile_finance_audit_events DROP CONSTRAINT synthetic_financial_update_audit_rejection');
  const updatedAccount=await changeAccount();
  eq(updatedAccount.display_name,'Updated CI account','account update retry succeeds');
  eq(updatedAccount.status,'inactive','valid account change updates status');
  eq(await rowCount('profile_finance_audit_events'),accountUpdateAuditBefore+1,
    'account update retry appends one audit');

  // Preferences: both initial INSERT and ON CONFLICT UPDATE must be rollback-safe.
  await pool.query(`
    CREATE TABLE profile_money_preferences(
      id BIGSERIAL PRIMARY KEY,
      account_id BIGINT NOT NULL,profile_role TEXT NOT NULL,business_id BIGINT,
      default_receive_account_id BIGINT,default_spend_account_id BIGINT,
      default_payout_account_id BIGINT,accepted_methods JSONB NOT NULL,
      payout_schedule_preference TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX synthetic_finance_preferences_scope
      ON profile_money_preferences(account_id,profile_role,COALESCE(business_id,0));
  `);
  const preferences=methods=>upsertMoneyPreference(pool,{accountId:11,profileRole:'customer',
    acceptedMethods:methods,payoutSchedulePreference:'daily'});
  const prefAuditBefore=await rowCount('profile_finance_audit_events');
  await pool.query(`ALTER TABLE profile_finance_audit_events
    ADD CONSTRAINT synthetic_preferences_audit_rejection
    CHECK (event_code <> 'money_preferences_updated')`);
  await assert.rejects(preferences(['cash']),error=>error.code==='23514');assertions++;
  eq(await rowCount('profile_money_preferences'),0,'failed new preferences have no row');
  eq(await rowCount('profile_finance_audit_events'),prefAuditBefore,'failed preferences have no audit');
  await pool.query('ALTER TABLE profile_finance_audit_events DROP CONSTRAINT synthetic_preferences_audit_rejection');
  const prefCreated=await preferences(['cash']);
  eq(prefCreated.accepted_methods[0],'cash','preferences retry succeeds');
  eq(await rowCount('profile_money_preferences'),1,'retry stores one preference row');
  eq(await rowCount('profile_finance_audit_events'),prefAuditBefore+1,'retry adds one preference audit');
  await pool.query(`ALTER TABLE profile_finance_audit_events
    ADD CONSTRAINT synthetic_preferences_audit_rejection
    CHECK (event_code <> 'money_preferences_updated')`);
  await assert.rejects(preferences(['bank_transfer']),error=>error.code==='23514');assertions++;
  const preserved=await pool.query('SELECT accepted_methods FROM profile_money_preferences WHERE id=$1',
    [prefCreated.id]);
  eq(preserved.rows[0].accepted_methods[0],'cash','failed preferences update preserves old methods');
  eq(await rowCount('profile_finance_audit_events'),prefAuditBefore+1,'failed upsert adds no audit');
  await pool.query('ALTER TABLE profile_finance_audit_events DROP CONSTRAINT synthetic_preferences_audit_rejection');
  const prefUpdated=await preferences(['bank_transfer']);
  eq(prefUpdated.accepted_methods[0],'bank_transfer','valid preference update succeeds');
  eq(await rowCount('profile_money_preferences'),1,'upsert preserves one scope row');
  eq(await rowCount('profile_finance_audit_events'),prefAuditBefore+2,'update adds one preference audit');

  console.log('PROFILE_FINANCE_REAL_POSTGRES_871_PASS assertions='+assertions+
    ' database=abl_finance_precision_ci no external payments');
}finally{
  await pool.end();
}
