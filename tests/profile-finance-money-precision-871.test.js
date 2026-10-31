import test from 'node:test';
import assert from 'node:assert/strict';
import {
  postProfileBudgetEntry,transferProfileBudgetAllocation,
  createProfileMoneyMovementRequest,createProfileMoneyEntry,
  transferFundsBetweenProfiles
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

// A real ledger operation is not necessary for valid amount conversion:
// stub the exact SQL boundary and inspect the numeric bind parameter.
function budgetStub(expected){
  const calls=[];
  const client={
    release(){},
    async query(sql,args=[]){
      calls.push(sql);
      if(sql==='BEGIN'||sql==='COMMIT')return{rowCount:0,rows:[]};
      if(sql.includes('SELECT * FROM profile_budget_entries WHERE entry_key='))return{rowCount:0,rows:[]};
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
    assert.ok(!calls.includes('ROLLBACK'));
  }
});
