import test from 'node:test';
import assert from 'node:assert/strict';
import {monetizationInternals} from '../monetization-core.js';

const job=overrides=>({
  id:44,status:'completed',currency_code:'PHP',provider_account_id:7,
  customer_confirmed_at:'2026-10-27T11:00:00.000Z',
  accepted_quote_id:91,agreed_total:'1275.50',
  pricing_locked_at:'2026-10-27T09:00:00.000Z',
  legacy_final_adjustment:null,final_price:'1275.50',quote_amount:'1000.00',
  ...overrides
});
const quote=overrides=>({
  id:91,job_id:44,status:'accepted',total_amount:'1275.50',
  currency_code:'PHP',legacy_record:false,...overrides
});
function projection(j=job(),q=quote()){
  return{
    source_id:j.id,service_job_id:j.id,subject_id:j.provider_account_id,
    territory_id:null,completed_at:j.customer_confirmed_at,
    job_status:j.status,pricing_locked_at:j.pricing_locked_at,
    accepted_quote_id:j.accepted_quote_id,agreed_total:j.agreed_total,
    legacy_final_adjustment:j.legacy_final_adjustment,final_price:j.final_price,
    quote_amount:j.quote_amount,currency_code:j.currency_code,
    accepted_quote_ref_id:q?.id??null,accepted_quote_job_id:q?.job_id??null,
    accepted_quote_status:q?.status??null,accepted_quote_total:q?.total_amount??null,
    accepted_quote_currency:q?.currency_code??null,accepted_quote_legacy:q?.legacy_record??null
  };
}
function syntheticReadOnlyPool(localRows){
  const reads=[];
  return{
    reads,
    async query(sql){
      reads.push(sql);
      if(/FROM service_jobs j/.test(sql))return{rows:localRows};
      return{rows:[]};
    }
  };
}
const checkIntegrity=error=>error?.code==='SERVICE_JOB_PRICE_INTEGRITY_MISMATCH'&&error.status===409;

test('history backfill uses the same accepted V2 quote authority as Payment Core',async()=>{
  const pool=syntheticReadOnlyPool([projection()]);
  const history=await monetizationInternals.historicalRows(pool);
  assert.equal(history.length,1);
  assert.equal(history[0].gross_value,1275.5);
  assert.equal(history[0].serviceScope,'local_services');
  const sql=pool.reads.find(x=>/FROM service_jobs j/.test(x));
  assert.match(sql,/LEFT JOIN service_job_quotes q ON q.id=j.accepted_quote_id/);
  assert.match(sql,/q.total_amount accepted_quote_total/);
  assert.doesNotMatch(sql,/COALESCE\(j.agreed_total\+COALESCE/);
  assert.ok(pool.reads.every(x=>/^\s*SELECT\b/.test(x)), 'preflight is read-only');
});

test('history refuses absent quote, changed quote owner/status/total/currency',async()=>{
  for(const q of [null,quote({job_id:45}),quote({status:'withdrawn'}),
    quote({total_amount:'1000.00'}),quote({currency_code:'EUR'})]){
    const pool=syntheticReadOnlyPool([projection(job(),q)]);
    await assert.rejects(()=>monetizationInternals.historicalRows(pool),checkIntegrity);
    assert.ok(pool.reads.every(x=>/^\s*SELECT\b/.test(x)));
  }
});

test('history refuses incomplete approval snapshots rather than emitting zero gross',async()=>{
  for(const j of [
    job({accepted_quote_id:null,agreed_total:'1275.50'}),
    job({accepted_quote_id:91,agreed_total:null}),
    job({accepted_quote_id:null,agreed_total:null,pricing_locked_at:'2026-10-27T09:00:00Z'})
  ]){
    await assert.rejects(
      ()=>monetizationInternals.historicalRows(syntheticReadOnlyPool([projection(j,null)])),
      checkIntegrity
    );
  }
});

test('history refuses a completed price mismatch or an unapproved legacy adjustment',async()=>{
  await assert.rejects(
    ()=>monetizationInternals.historicalRows(syntheticReadOnlyPool([
      projection(job({final_price:'1276.00'}))
    ])),checkIntegrity
  );
  await assert.rejects(
    ()=>monetizationInternals.historicalRows(syntheticReadOnlyPool([
      projection(job({legacy_final_adjustment:'25.00',final_price:'1300.50'}))
    ])),checkIntegrity
  );
});

test('history preserves evidenced migrated adjustment and pre-V2 legacy amount',async()=>{
  const legacy=projection(job({
    agreed_total:'1275.50',legacy_final_adjustment:'25.00',final_price:'1300.50'
  }),quote({legacy_record:true}));
  const oldJob=job({
    id:45,accepted_quote_id:null,agreed_total:null,pricing_locked_at:null,
    legacy_final_adjustment:null,final_price:'350.00',quote_amount:'300.00'
  });
  const rows=await monetizationInternals.historicalRows(
    syntheticReadOnlyPool([legacy,projection(oldJob,null)])
  );
  assert.deepEqual(rows.map(x=>x.gross_value),[1300.5,350]);
});

test('a malformed later job blocks preflight before any monetization write',async()=>{
  const pool=syntheticReadOnlyPool([projection(),projection(job({id:46,final_price:'9999.00'}))]);
  await assert.rejects(()=>monetizationInternals.historicalRows(pool),checkIntegrity);
  assert.ok(pool.reads.every(x=>/^\s*SELECT\b/.test(x)));
});

test('historical backfill refuses missing approved quote or job currency evidence',async()=>{
  for(const q of [quote({currency_code:null}),quote({currency_code:''})]){
    await assert.rejects(
      ()=>monetizationInternals.historicalRows(syntheticReadOnlyPool([projection(job(),q)])),
      checkIntegrity
    );
  }
  for(const j of [job({currency_code:null}),job({currency_code:''})]){
    await assert.rejects(
      ()=>monetizationInternals.historicalRows(syntheticReadOnlyPool([projection(j)])),
      checkIntegrity
    );
  }
});
