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
  transferFundsBetweenProfiles
} from '../profile-finance-core.js';

if(process.env.NODE_ENV!=='test'||
   process.env.ABL_FINANCE_PRECISION_CI!=='1'||
   process.env.PGHOST!=='127.0.0.1'||
   process.env.PGDATABASE!=='abl_finance_precision_ci'){
  throw new Error('Disposable localhost PostgreSQL CI only; never execute against live accounts.');
}
const pool=new pg.Pool({max:3,connectionTimeoutMillis:5000});
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
    CREATE TABLE profile_finance_audit_events(
      id BIGSERIAL PRIMARY KEY,account_id BIGINT NOT NULL,profile_role TEXT NOT NULL,
      business_id BIGINT,event_code TEXT NOT NULL,detail_json JSONB NOT NULL
    );
    INSERT INTO profile_budget_envelopes
      (id,account_id,status,profile_role,business_id,currency_code)
      VALUES (22,11,'active','customer',NULL,'PHP'),
             (23,11,'active','customer',NULL,'PHP');
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
  eq(await rowCount('profile_budget_entries'),3,'valid requests only three entries');
  eq(await rowCount('profile_finance_audit_events'),3,'valid requests only three audit events');

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

  console.log('PROFILE_FINANCE_REAL_POSTGRES_871_PASS assertions='+assertions+
    ' database=abl_finance_precision_ci no external payments');
}finally{
  await pool.end();
}
