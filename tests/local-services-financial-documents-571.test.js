import test from 'node:test';
import assert from 'node:assert/strict';
import {synchronizeFinancialDocumentsForScope} from '../financial-document-core.js';

const job=(overrides={})=>({
  id:44,provider_account_id:7,customer_confirmed_at:'2026-10-28T10:00:00Z',
  status:'completed',currency_code:'PHP',service_label:'Fitting',
  accepted_quote_id:91,agreed_total:'1275.50',pricing_locked_at:'2026-10-28T09:00:00Z',
  final_price:'1275.50',legacy_final_adjustment:null,quote_amount:'1000.00',
  accepted_quote_ref_id:91,accepted_quote_job_id:44,accepted_quote_status:'accepted',
  accepted_quote_total:'1275.50',accepted_quote_currency:'PHP',accepted_quote_legacy:false,
  ...overrides
});
function syntheticPool(rows){
  const writes=[],reads=[];
  return {
    writes,reads,
    pool:{
      async query(sql){
        reads.push(sql);
        return{rows:/FROM service_jobs j/.test(sql)?rows:[]};
      },
      async connect(){
        return{
          async query(sql,args){
            if(/INSERT INTO financial_documents/.test(sql)){
              writes.push({sql,args});
              return{rows:[{id:102}]};
            }
            if(/^\s*INSERT INTO/.test(sql))writes.push({sql,args});
            return{rows:[]};
          },
          release(){}
        };
      }
    }
  };
}
const sync=pool=>synchronizeFinancialDocumentsForScope(pool,{
  accountId:7,profileRole:'service_provider'
});
const integrity=error=>error?.code==='SERVICE_JOB_PRICE_INTEGRITY_MISMATCH'&&error.status===409;

test('Service Provider invoice candidate uses the actual accepted quote authority',async()=>{
  const {pool,reads,writes}=syntheticPool([job()]);
  assert.deepEqual(await sync(pool),{synchronized:1});
  assert.match(reads.find(sql=>/FROM service_jobs j/.test(sql)),/LEFT JOIN service_job_quotes q ON q.id=j.accepted_quote_id/);
  const document=writes.find(x=>/INSERT INTO financial_documents/.test(x.sql));
  assert.ok(document);
  assert.equal(document.args[12],1275.5);
  assert.equal(JSON.parse(document.args[15]).payable_authority,'accepted_quote');
  assert.equal(JSON.parse(document.args[15]).accepted_quote_id,91);
});

test('Service Provider invoice candidate refuses missing, changed and withdrawn quotes before write',async()=>{
  const invalid=[
    {accepted_quote_ref_id:null,accepted_quote_job_id:null,accepted_quote_status:null},
    {accepted_quote_job_id:45},
    {accepted_quote_status:'withdrawn'},
    {accepted_quote_status:'superseded'},
    {accepted_quote_total:'1250.00'},
    {accepted_quote_currency:'EUR'},
    {accepted_quote_currency:null},
    {accepted_quote_legacy:false,legacy_final_adjustment:'20.00',final_price:'1295.50'}
  ];
  for(const override of invalid){
    const {pool,writes}=syntheticPool([job(override)]);
    await assert.rejects(()=>sync(pool),integrity,JSON.stringify(override));
    assert.equal(writes.length,0,'invalid quote should not write financial evidence');
  }
});

test('historical pre-V2 invoice candidates remain available without a quote row',async()=>{
  const historical=job({
    accepted_quote_id:null,agreed_total:null,pricing_locked_at:null,
    accepted_quote_ref_id:null,accepted_quote_job_id:null,accepted_quote_status:null,
    accepted_quote_total:null,accepted_quote_currency:null,
    final_price:'350.00',quote_amount:'300.00'
  });
  const {pool,writes}=syntheticPool([historical]);
  assert.deepEqual(await sync(pool),{synchronized:1});
  const document=writes.find(x=>/INSERT INTO financial_documents/.test(x.sql));
  assert.equal(document.args[12],350);
  assert.equal(JSON.parse(document.args[15]).payable_authority,'legacy_final_price');
});
