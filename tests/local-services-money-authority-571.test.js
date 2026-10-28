import test from 'node:test';
import assert from 'node:assert/strict';
import {serviceProviderMoneyHomeSnapshot,serviceProviderMoneySnapshot} from '../profile-money-core.js';

const approved=(overrides={})=>({
  id:'101',service_label:'Kitchen fitting',status:'completed',created_at:'2026-10-28T10:00:00Z',
  customer_confirmed_at:'2026-10-28T11:00:00Z',quote_amount:'950.00',
  final_price:'1000.00',accepted_quote_id:'201',agreed_total:'1000.00',
  legacy_final_adjustment:null,pricing_locked_at:'2026-10-25T10:00:00Z',
  currency_code:'PHP',is_recent:true,
  accepted_quote_ref_id:'201',accepted_quote_job_id:'101',
  accepted_quote_status:'accepted',accepted_quote_total:'1000.00',
  accepted_quote_currency:'PHP',accepted_quote_legacy:false,
  payment_received:'650.00',payment_pending:'50.00',payment_refunded:'100.00',
  ...overrides
});
const legacy=(overrides={})=>({
  id:'102',service_label:'Repair',status:'completed',created_at:'2026-10-27T10:00:00Z',
  customer_confirmed_at:'2026-10-27T11:00:00Z',quote_amount:'180.00',
  final_price:'200.00',accepted_quote_id:null,agreed_total:null,
  legacy_final_adjustment:null,pricing_locked_at:null,currency_code:'PHP',is_recent:false,
  accepted_quote_ref_id:null,accepted_quote_job_id:null,accepted_quote_status:null,
  accepted_quote_total:null,accepted_quote_currency:null,accepted_quote_legacy:null,
  payment_received:'200.00',payment_pending:'0',payment_refunded:'0',
  ...overrides
});
const fakePool=rows=>{
  const calls=[];
  return{
    calls,
    query:async(sql,params)=>{
      calls.push({sql,params});
      if(sql.includes('WITH recent_ids AS'))return{rows};
      if(sql.includes('FROM payment_allocations'))return{rows:[{}]};
      throw new Error('Unexpected Service Provider Money query');
    }
  };
};

test('Service Provider Money values and receivables depend on accepted quote or legacy evidence',async()=>{
  const openV2=approved({
    id:'103',status:'accepted',created_at:'2026-10-26T10:00:00Z',
    customer_confirmed_at:null,final_price:null,
    accepted_quote_id:'203',agreed_total:'125.00',
    accepted_quote_ref_id:'203',accepted_quote_job_id:'103',
    accepted_quote_total:'125.00',payment_received:0,payment_pending:0,payment_refunded:0
  });
  const openLegacy=legacy({
    id:'104',status:'quoted',created_at:'2026-10-25T10:00:00Z',
    customer_confirmed_at:null,quote_amount:'50.00',final_price:null,
    is_recent:true,payment_received:0
  });
  const pool=fakePool([approved(),legacy(),openV2,openLegacy]);
  const snapshot=await serviceProviderMoneySnapshot(pool,66);
  assert.deepEqual(pool.calls[0].params,[66]);
  assert.equal(pool.calls.length,2,'one coherent quote/payment read + settlement allocations');
  assert.match(pool.calls[0].sql,/LEFT JOIN service_job_quotes q ON q.id=j.accepted_quote_id/);
  assert.match(pool.calls[0].sql,/j.provider_account_id=\$1/);
  assert.match(pool.calls[0].sql,/pi.source_type='service_job'/);
  assert.match(pool.calls[0].sql,/r.status='succeeded'/);
  assert.doesNotMatch(pool.calls[0].sql,/agreed_total\s*\+\s*COALESCE/);
  assert.equal(snapshot.summary.confirmed_completed_count,2);
  assert.equal(snapshot.summary.confirmed_job_value,1200);
  assert.equal(snapshot.summary.open_commercial_jobs,2);
  assert.equal(snapshot.summary.open_commercial_value,175);
  assert.equal(snapshot.summary.payments.paid_job_count,2);
  assert.equal(snapshot.summary.payments.receivable_job_count,1);
  assert.equal(snapshot.summary.payments.confirmed_customer_payments,850);
  assert.equal(snapshot.summary.payments.pending_customer_payments,50);
  assert.equal(snapshot.summary.payments.refunded_customer_payments,100);
  assert.equal(snapshot.summary.payments.outstanding_receivables,350);
  assert.equal(snapshot.summary.income.tracked,false);
  assert.deepEqual(snapshot.recent_jobs.map(job=>job.id),['101','103','104']);
  assert.equal(snapshot.recent_jobs[0].outstanding_receivable,350);
  assert.equal(snapshot.recent_jobs[1].payable_value,125);
  assert.equal(snapshot.recent_jobs[2].payable_value,50);
  assert.ok(!('accepted_quote_ref_id' in snapshot.recent_jobs[0]));
});

test('Service Provider home and detail fail closed on missing or changed approved quote evidence',async()=>{
  const cases=[
    {accepted_quote_ref_id:null},
    {accepted_quote_job_id:'999'},
    {accepted_quote_status:'withdrawn'},
    {accepted_quote_total:'999.00'},
    {accepted_quote_currency:'USD'},
    {accepted_quote_currency:null},
    {final_price:'1400.00'},
    {legacy_final_adjustment:'5.00'},
    {accepted_quote_id:null},
    {agreed_total:null}
  ];
  for(const mutation of cases){
    const pool=fakePool([approved(mutation)]);
    await assert.rejects(serviceProviderMoneyHomeSnapshot(pool,66),
      error=>error.code==='SERVICE_JOB_PRICE_INTEGRITY_MISMATCH'&&error.status===409,
      JSON.stringify(mutation));
    await assert.rejects(serviceProviderMoneySnapshot(pool,66),
      error=>error.code==='SERVICE_JOB_PRICE_INTEGRITY_MISMATCH'&&error.status===409,
      JSON.stringify(mutation));
  }
});

test('Migrated legacy adjustment is accepted without inventing Provider payout',async()=>{
  const pool=fakePool([approved({
    accepted_quote_legacy:true,legacy_final_adjustment:'50.00',final_price:'1050.00',
    payment_received:'0',payment_pending:'0',payment_refunded:'0'
  })]);
  const snapshot=await serviceProviderMoneySnapshot(pool,66);
  assert.equal(snapshot.summary.confirmed_job_value,1050);
  assert.equal(snapshot.summary.payments.outstanding_receivables,1050);
  assert.equal(snapshot.summary.income.tracked,false);
  assert.match(snapshot.authority.note,/NOT_CONFIGURED/);
});

test('A bad later row prevents a partial financial snapshot',async()=>{
  const pool=fakePool([approved(),legacy(),approved({
    id:'105',accepted_quote_id:'205',accepted_quote_ref_id:null
  })]);
  await assert.rejects(serviceProviderMoneySnapshot(pool,66),
    error=>error.code==='SERVICE_JOB_PRICE_INTEGRITY_MISMATCH');
});
