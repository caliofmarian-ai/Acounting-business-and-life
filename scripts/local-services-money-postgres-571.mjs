import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {serviceProviderMoneyHomeSnapshot,serviceProviderMoneySnapshot} from '../profile-money-core.js';

// Existing CI PostgreSQL only. TEMP tables and rollback prevent persistent writes.
test('Service Provider Money SQL and quote evidence on isolated PostgreSQL 16', {timeout:60000}, async t=>{
  assert.equal(process.env.NODE_ENV,'test');
  assert.equal(process.env.PGHOST,'127.0.0.1');
  assert.equal(process.env.PGDATABASE,'abl_admin_ci');
  assert.equal(process.env.RAILWAY_SERVICE_NAME,'accounting-admin-runtime-ci');
  const pool=new pg.Pool({max:1,connectionTimeoutMillis:5000});
  const client=await pool.connect();
  try{
    const ctx=await client.query("SELECT current_database() db,current_setting('server_version_num')::integer version");
    assert.equal(ctx.rows[0].db,'abl_admin_ci');
    assert.ok(ctx.rows[0].version>=160000);
    await client.query('BEGIN');
    for(const ddl of [
      'CREATE TEMP TABLE service_jobs(id bigint,provider_account_id bigint,service_label text,status text,quote_amount numeric(14,2),final_price numeric(14,2),accepted_quote_id bigint,agreed_total numeric(14,2),legacy_final_adjustment numeric(14,2),pricing_locked_at timestamptz,currency_code text,scheduled_at timestamptz,provider_completed_at timestamptz,customer_confirmed_at timestamptz,created_at timestamptz) ON COMMIT DROP',
      'CREATE TEMP TABLE service_job_quotes(id bigint,job_id bigint,status text,total_amount numeric(14,2),currency_code text,legacy_record boolean) ON COMMIT DROP',
      'CREATE TEMP TABLE payment_intents(id bigint,source_type text,source_id bigint,amount numeric(14,2),status text,expires_at timestamptz) ON COMMIT DROP',
      'CREATE TEMP TABLE refunds(id bigint,payment_intent_id bigint,amount numeric(14,2),status text) ON COMMIT DROP',
      'CREATE TEMP TABLE payment_allocations(component_code text,economic_party_id text,amount numeric(14,2),settlement_status text) ON COMMIT DROP'
    ])await client.query(ddl);

    const jobColumns=['id','provider_account_id','service_label','status','quote_amount','final_price','accepted_quote_id','agreed_total','legacy_final_adjustment','pricing_locked_at','currency_code','scheduled_at','provider_completed_at','customer_confirmed_at','created_at'];
    const quoteColumns=['id','job_id','status','total_amount','currency_code','legacy_record'];
    const intentColumns=['id','source_type','source_id','amount','status','expires_at'];
    const baseJob={
      id:44,provider_account_id:7,service_label:'CI service fitting',status:'completed',
      quote_amount:'1000.00',final_price:'1275.50',accepted_quote_id:91,
      agreed_total:'1275.50',legacy_final_adjustment:null,
      pricing_locked_at:'2026-10-27T09:00:00Z',currency_code:'PHP',
      scheduled_at:null,provider_completed_at:'2026-10-27T10:00:00Z',
      customer_confirmed_at:'2026-10-27T11:00:00Z',created_at:'2026-10-26T08:00:00Z'
    };
    const baseQuote={
      id:91,job_id:44,status:'accepted',total_amount:'1275.50',
      currency_code:'PHP',legacy_record:false
    };
    const insert=(table,columns,row)=>client.query(
      'INSERT INTO '+table+'('+columns.join(',')+') VALUES('+columns.map((_,i)=>'$'+(i+1)).join(',')+')',
      columns.map(column=>row[column]??null)
    );
    const insertJob=row=>insert('service_jobs',jobColumns,row);
    const insertQuote=row=>insert('service_job_quotes',quoteColumns,row);
    const insertIntent=row=>insert('payment_intents',intentColumns,row);
    const seed=async(job=baseJob,quote=baseQuote)=>{
      await client.query('TRUNCATE refunds,payment_intents,payment_allocations,service_job_quotes,service_jobs');
      await insertJob(job);
      if(quote)await insertQuote(quote);
    };
    const readOnly={query:(sql,args)=>{
      assert.match(sql,/^\s*(SELECT|WITH)\b/i,'Money model must only read');
      return client.query(sql,args);
    }};
    const invalid=e=>e?.code==='SERVICE_JOB_PRICE_INTEGRITY_MISMATCH'&&e?.status===409;

    await t.test('accepted quote and Payment Intents yield exact payable, paid, refunded and receivable',async()=>{
      await seed();
      await insertIntent({id:1,source_type:'service_job',source_id:44,amount:'500.00',status:'succeeded'});
      await insertIntent({id:2,source_type:'service_job',source_id:44,amount:'100.00',status:'processing'});
      await client.query("INSERT INTO refunds(id,payment_intent_id,amount,status) VALUES(1,1,25.00,'succeeded')");
      const result=await serviceProviderMoneySnapshot(readOnly,7);
      assert.equal(result.summary.confirmed_completed_count,1);
      assert.equal(result.summary.confirmed_job_value,1275.5);
      assert.equal(result.summary.payments.confirmed_customer_payments,475);
      assert.equal(result.summary.payments.pending_customer_payments,100);
      assert.equal(result.summary.payments.refunded_customer_payments,25);
      assert.equal(result.summary.payments.outstanding_receivables,800.5);
      assert.equal(result.summary.payments.receivable_job_count,1);
      assert.equal(result.summary.income.tracked,false);
      assert.equal(result.recent_jobs.length,1);
      assert.equal(result.recent_jobs[0].payable_value,1275.5);
      assert.equal(result.recent_jobs[0].outstanding_receivable,800.5);
      assert.equal((await client.query('SELECT COUNT(*)::int n FROM payment_intents')).rows[0].n,2);
    });

    await t.test('missing, moved, withdrawn, wrong amount/currency or incomplete snapshot fails closed',async()=>{
      const cases=[
        [baseJob,null],
        [baseJob,{...baseQuote,job_id:100}],
        [baseJob,{...baseQuote,status:'withdrawn'}],
        [baseJob,{...baseQuote,total_amount:'1200.00'}],
        [baseJob,{...baseQuote,currency_code:'USD'}],
        [{...baseJob,agreed_total:null},baseQuote],
        [{...baseJob,final_price:'1300.00'},baseQuote],
        [{...baseJob,legacy_final_adjustment:'10.00',final_price:'1285.50'},baseQuote]
      ];
      for(const [job,quote] of cases){
        await seed(job,quote);
        await assert.rejects(()=>serviceProviderMoneyHomeSnapshot(readOnly,7),invalid);
        await assert.rejects(()=>serviceProviderMoneySnapshot(readOnly,7),invalid);
      }
    });

    await t.test('historical pre-V2 price and migrated adjustment are preserved',async()=>{
      await seed({...baseJob,accepted_quote_id:null,agreed_total:null,
        pricing_locked_at:null,final_price:'350.00',quote_amount:'300.00'},null);
      assert.equal((await serviceProviderMoneyHomeSnapshot(readOnly,7)).summary.confirmed_job_value,350);
      await seed({...baseJob,legacy_final_adjustment:'25.00',final_price:'1300.50'},
        {...baseQuote,legacy_record:true});
      assert.equal((await serviceProviderMoneyHomeSnapshot(readOnly,7)).summary.confirmed_job_value,1300.5);
    });

    await t.test('another Provider invalid quote is not exposed by scoped queries',async()=>{
      await seed();
      await insertJob({...baseJob,id:45,provider_account_id:8,accepted_quote_id:92,
        created_at:'2026-10-28T12:00:00Z'});
      await insertQuote({...baseQuote,id:92,job_id:45,status:'withdrawn'});
      const result=await serviceProviderMoneySnapshot(readOnly,7);
      assert.equal(result.summary.confirmed_completed_count,1);
      assert.deepEqual(result.recent_jobs.map(j=>Number(j.id)),[44]);
    });

    await t.test('malformed later row rejects whole read without modifying quote rows',async()=>{
      await seed();
      await insertJob({...baseJob,id:45,accepted_quote_id:92,
        created_at:'2026-10-28T12:00:00Z'});
      await assert.rejects(()=>serviceProviderMoneySnapshot(readOnly,7),invalid);
      const count=await client.query('SELECT COUNT(*)::int n FROM service_job_quotes');
      assert.equal(count.rows[0].n,1);
    });
  }finally{
    await client.query('ROLLBACK').catch(()=>{});
    client.release();
    await pool.end();
  }
});
