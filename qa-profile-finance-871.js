import crypto from 'node:crypto';

// Executed only by the QA_ACCEPTANCE_WAVE allowlist on the isolated Preview DB.
// Uses real authenticated company_test sessions; no provider transfer or customer account.
export const PROFILE_FINANCE_MONEY_871_WAVE='profile_finance_money_871';

export async function runProfileFinanceMoney871Acceptance({pool,base,secret,aliases,helpers}){
  const {requestJson,expectStatus,qaAccountSession,ensureActiveRole}=helpers;
  const label='QA Profile Finance 871 '+crypto.randomUUID();
  let customer,other,budgetId=null,originalFailure=null;
  const key='qa871-'+crypto.randomUUID();
  const request=(token,amount,requestKey=key,note='QA exact-cent budget allocation')=>
    requestJson(base,`/api/settings/budgets/${budgetId}/entries`,{
      method:'POST',token,headers:{'Idempotency-Key':requestKey},
      body:{direction:'credit',entry_type:'allocation',amount,note}
    });
  const counts=async()=>{
    const entries=await pool.query(
      'SELECT id,amount,entry_key FROM profile_budget_entries WHERE envelope_id=$1 ORDER BY id',
      [budgetId]
    );
    const audits=await pool.query(
      `SELECT id,event_code FROM profile_finance_audit_events
       WHERE account_id=$1 AND event_code IN ('budget_envelope_created','budget_allocation_changed')
         AND detail_json->>'budget_envelope_id'=$2`,
      [customer.accountId,String(budgetId)]
    );
    return{entries:entries.rows,audits:audits.rows};
  };
  try{
    [customer,other]=await Promise.all([
      qaAccountSession({pool,base,secret,email:aliases.customer,role:'customer',label:'Finance 871 Customer QA'}),
      qaAccountSession({pool,base,secret,email:aliases.other,role:'merchant',label:'Finance 871 foreign-account QA'})
    ]);
    const me=await requestJson(base,'/api/me',{token:customer.token});
    expectStatus(me,200,'Finance 871 QA identity');
    if(me.json?.account?.account_mode!=='company_test'||me.json?.account?.test_role!=='customer'||
       Number(me.json?.account?.id)!==Number(customer.accountId))
      throw new Error('Finance 871 requires the existing classified company_test Customer.');
    const merchantMe=await requestJson(base,'/api/me',{token:other.token});
    expectStatus(merchantMe,200,'Finance 871 foreign QA identity');
    if(merchantMe.json?.account?.account_mode!=='company_test'||
       merchantMe.json?.account?.test_role!=='merchant'||
       Number(merchantMe.json?.account?.id)===Number(customer.accountId))
      throw new Error('Finance 871 foreign-account guard did not find a distinct classified QA account.');
    const activation=await requestJson(base,'/api/profiles/customer/activate',{
      method:'POST',token:customer.token,body:{}
    });
    expectStatus(activation,[200,201],'Finance 871 QA Customer profile');
    await ensureActiveRole({base,token:customer.token,role:'customer',label:'Finance 871 QA Customer'});
    const created=await requestJson(base,'/api/settings/budgets',{
      method:'POST',token:customer.token,
      body:{profile_role:'customer',label,purpose:'custom',currency_code:'PHP'}
    });
    expectStatus(created,201,'Finance 871 QA budget envelope');
    budgetId=Number(created.json?.id);
    if(!Number.isSafeInteger(budgetId)||budgetId<=0)
      throw new Error('Finance 871 QA budget ID was not returned.');
    const owned=await pool.query(
      `SELECT id FROM profile_budget_envelopes
       WHERE id=$1 AND account_id=$2 AND profile_role='customer' AND label=$3`,
      [budgetId,customer.accountId,label]
    );
    if(owned.rowCount!==1)throw new Error('Finance 871 QA envelope ownership mismatch.');
    const initial=await counts();
    if(initial.entries.length!==0||initial.audits.filter(x=>x.event_code==='budget_envelope_created').length!==1)
      throw new Error('Finance 871 QA initial budget/audit state is incorrect.');

    // Two HTTP requests through real auth and PostgreSQL, not a synthetic identity stub.
    const simultaneous=await Promise.all([
      request(customer.token,'1.23'),request(customer.token,'1.23')
    ]);
    simultaneous.forEach((r,i)=>expectStatus(r,201,'Finance 871 authenticated concurrent replay '+i));
    const firstId=Number(simultaneous[0].json?.id);
    if(!firstId||Number(simultaneous[1].json?.id)!==firstId)
      throw new Error('Finance 871 concurrent same-intent requests created separate entries.');
    const repeated=await request(customer.token,'1.23');
    expectStatus(repeated,201,'Finance 871 authenticated replay');
    if(Number(repeated.json?.id)!==firstId)
      throw new Error('Finance 871 replay did not return the original entry.');

    const mismatch=await request(customer.token,'1.24');
    expectStatus(mismatch,409,'Finance 871 replay amount mismatch');
    const noteMismatch=await requestJson(base,`/api/settings/budgets/${budgetId}/entries`,{
      method:'POST',token:customer.token,headers:{'Idempotency-Key':key},
      body:{direction:'credit',entry_type:'allocation',amount:'1.23',note:'different instruction'}
    });
    expectStatus(noteMismatch,409,'Finance 871 replay note mismatch');
    const denied=await request(other.token,'1.23');
    expectStatus(denied,404,'Finance 871 foreign-account replay denial');
    const withoutAuth=await request('', '1.23');
    expectStatus(withoutAuth,401,'Finance 871 unauthenticated denial');
    for(const [i,amount] of ['0.001','1.234','1e3','0x10','999999999999.999',true,0].entries()){
      const bad=await request(customer.token,amount,key+'-reject-'+i);
      expectStatus(bad,400,'Finance 871 malformed amount rejection '+i);
    }
    const after=await counts();
    if(after.entries.length!==1||after.entries[0].entry_key!==key||
       Number(after.entries[0].amount)!==1.23||
       after.audits.filter(x=>x.event_code==='budget_allocation_changed').length!==1)
      throw new Error('Finance 871 replay, invalid input or audit invariants failed.');
    const finance=await requestJson(base,'/api/settings/finance',{token:customer.token});
    expectStatus(finance,200,'Finance 871 authenticated Settings/Finance read');
    if(!(finance.json?.budgets||[]).some(x=>Number(x.id)===budgetId))
      throw new Error('Finance 871 QA budget is missing from the authenticated Settings read.');
    return{
      status:'PASS',wave:PROFILE_FINANCE_MONEY_871_WAVE,
      authenticated_company_test:true,cross_account_denied:true,
      concurrent_replay_single_entry:true,exact_cent_amount:true,
      malformed_inputs_denied:7,unauthorized_denied:true,
      one_audit_per_committed_entry:true,settings_read:true,
      provider_money_moved:false,fixture_cleanup:'finally'
    };
  }catch(e){originalFailure=e;throw e}
  finally{
    let cleanupFailure=null;
    if(budgetId&&customer){
      try{
        // Remove only this uniquely created company_test envelope and its own
        // planning records/audit, even after a mid-wave assertion failure.
        const client=await pool.connect();
        try{
          await client.query('BEGIN');
          await client.query(
            `DELETE FROM profile_finance_audit_events
              WHERE account_id=$1 AND event_code IN ('budget_envelope_created','budget_allocation_changed')
                AND detail_json->>'budget_envelope_id'=$2`,
            [customer.accountId,String(budgetId)]
          );
          await client.query(
            'DELETE FROM profile_budget_entries WHERE envelope_id=$1',
            [budgetId]
          );
          const removed=await client.query(
            `DELETE FROM profile_budget_envelopes
              WHERE id=$1 AND account_id=$2 AND profile_role='customer' AND label=$3
              RETURNING id`,
            [budgetId,customer.accountId,label]
          );
          if(removed.rowCount!==1)throw new Error('Finance 871 QA cleanup did not remove exactly its own budget.');
          await client.query('COMMIT');
        }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
        finally{client.release()}
        const remaining=await pool.query(
          'SELECT id FROM profile_budget_envelopes WHERE id=$1 AND account_id=$2',
          [budgetId,customer.accountId]
        );
        if(remaining.rowCount)throw new Error('Finance 871 QA fixture persists after cleanup.');
      }catch(e){cleanupFailure=e}
    }
    for(const session of [customer,other]){
      if(session?.token){
        try{await requestJson(base,'/api/auth/logout',{
          method:'POST',token:session.token,body:{}
        })}catch(e){cleanupFailure??=e}
      }
    }
    if(cleanupFailure){
      if(originalFailure)throw new AggregateError([originalFailure,cleanupFailure],'Finance 871 QA failed and cleanup also failed.');
      throw cleanupFailure;
    }
  }
}
