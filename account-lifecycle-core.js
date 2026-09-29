const clean=(value,max=1200)=>String(value??'').trim().slice(0,max);
const numericId=value=>{const n=Number(value);if(!Number.isInteger(n)||n<=0)throw Object.assign(new Error('Valid account id required'),{status:400});return n};

function optionalSchemaError(error){
  return ['42P01','42703','42883'].includes(String(error?.code||''));
}
async function optionalCount(pool,sql,args=[]){
  try{
    const q=await pool.query(sql,args);
    return Number(q.rows?.[0]?.count||0);
  }catch(error){
    if(optionalSchemaError(error))return 0;
    throw error;
  }
}
let optionalSavepointCounter=0;
async function optionalExec(client,sql,args=[]){
  const savepoint='account_lifecycle_optional_'+(++optionalSavepointCounter);
  await client.query('SAVEPOINT '+savepoint);
  try{
    const result=await client.query(sql,args);
    await client.query('RELEASE SAVEPOINT '+savepoint);
    return result;
  }catch(error){
    if(optionalSchemaError(error)){
      await client.query('ROLLBACK TO SAVEPOINT '+savepoint);
      await client.query('RELEASE SAVEPOINT '+savepoint);
      return{rowCount:0,rows:[]};
    }
    throw error;
  }
}
function blocker(code,category,count,message,nextAction){
  return{code,category,count:Number(count||0),message,next_action:nextAction};
}

export async function ensureAccountLifecycleSchema(pool){
  await pool.query(`
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS closure_requested_at TIMESTAMPTZ;
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS closure_mode TEXT NOT NULL DEFAULT '';
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS closure_reason TEXT NOT NULL DEFAULT '';

    CREATE TABLE IF NOT EXISTS account_closure_holds(
      id BIGSERIAL PRIMARY KEY,
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      hold_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      reason TEXT NOT NULL,
      source_ref TEXT NOT NULL DEFAULT '',
      created_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      released_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      released_at TIMESTAMPTZ,
      CHECK(hold_type IN ('financial','security','legal','privacy','compliance','support','other')),
      CHECK(status IN ('active','released'))
    );
    CREATE INDEX IF NOT EXISTS account_closure_holds_owner_idx
      ON account_closure_holds(account_id,status,created_at DESC);

    CREATE TABLE IF NOT EXISTS account_closure_events(
      id BIGSERIAL PRIMARY KEY,
      account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      account_public_id TEXT NOT NULL DEFAULT '',
      actor_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      actor_type TEXT NOT NULL,
      action_code TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(actor_type IN ('self','admin','system'))
    );
    CREATE INDEX IF NOT EXISTS account_closure_events_owner_idx
      ON account_closure_events(account_id,created_at DESC,id DESC);
  `);
}

export async function accountClosureAssessment(pool,rawAccountId){
  const accountId=numericId(rawAccountId);
  await ensureAccountLifecycleSchema(pool);
  const accountQ=await pool.query(
    `SELECT id,personal_public_id,email_verified_at,auth_status,account_mode,closed_at,closure_mode
       FROM accounts WHERE id=$1`,[accountId]
  );
  if(!accountQ.rowCount)throw Object.assign(new Error('Account not found'),{status:404});
  const account=accountQ.rows[0];

  const checks=await Promise.all([
    optionalCount(pool,`SELECT COUNT(*)::int count FROM account_closure_holds WHERE account_id=$1 AND status='active'`,[accountId]),
    optionalCount(pool,`SELECT COUNT(*)::int count FROM platform_admin_assignments WHERE account_id=$1 AND status='active'`,[accountId]),
    optionalCount(pool,`SELECT COUNT(*)::int count FROM business_memberships WHERE account_id=$1 AND active=TRUE`,[accountId]),
    optionalCount(pool,`SELECT COUNT(*)::int count FROM profile_applications WHERE account_id=$1 AND status NOT IN ('rejected','revoked','expired','cancelled','withdrawn')`,[accountId]),
    optionalCount(pool,`SELECT COUNT(*)::int count FROM profile_authorizations WHERE account_id=$1 AND status IN ('active','suspended')`,[accountId]),
    optionalCount(pool,`SELECT COUNT(*)::int count FROM service_category_authorizations WHERE account_id=$1 AND status IN ('pending','active','suspended')`,[accountId]),
    optionalCount(pool,`SELECT COUNT(*)::int count FROM orders WHERE customer_account_id=$1 AND order_status NOT IN ('completed','cancelled')`,[accountId]),
    optionalCount(pool,`SELECT COUNT(*)::int count FROM purchase_orders WHERE supplier_account_id=$1 AND status NOT IN ('received','cancelled','rejected')`,[accountId]),
    optionalCount(pool,`SELECT COUNT(*)::int count FROM deliveries WHERE (customer_account_id=$1 OR courier_account_id=$1) AND status NOT IN ('delivered','failed','cancelled')`,[accountId]),
    optionalCount(pool,`SELECT COUNT(*)::int count FROM service_jobs WHERE (customer_account_id=$1 OR provider_account_id=$1) AND NOT(status='cancelled' OR (status='completed' AND customer_confirmed_at IS NOT NULL))`,[accountId]),
    optionalCount(pool,`SELECT COUNT(*)::int count FROM payment_intents WHERE payer_account_id=$1 AND status NOT IN ('succeeded','failed','cancelled')`,[accountId]),
    optionalCount(pool,`SELECT COUNT(*)::int count FROM refunds r JOIN payment_intents p ON p.id=r.payment_intent_id WHERE p.payer_account_id=$1 AND r.status NOT IN ('succeeded','failed','cancelled')`,[accountId]),
    optionalCount(pool,`SELECT COUNT(*)::int count FROM profile_money_movements WHERE account_id=$1 AND status NOT IN ('succeeded','failed','reversed','cancelled')`,[accountId]),
    optionalCount(pool,`SELECT COUNT(*)::int count FROM support_tickets WHERE requester_account_id=$1 AND status NOT IN ('resolved','closed')`,[accountId]),
    optionalCount(pool,`SELECT COUNT(*)::int count FROM incident_reports WHERE reporter_account_id=$1 AND status NOT IN ('resolved','dismissed')`,[accountId]),
    optionalCount(pool,`SELECT COUNT(*)::int count FROM trust_case_entities e JOIN trust_cases c ON c.id=e.case_id WHERE e.entity_type='account' AND e.entity_id=$1::text AND c.status NOT IN ('resolved','dismissed','linked')`,[String(accountId)])
  ]);
  const [
    holds,adminAuthority,businessMemberships,profileApplications,profileAuthorizations,serviceCategoryAuthorizations,
    orders,purchaseOrders,deliveries,serviceJobs,payments,refunds,moneyMovements,support,safetyIncidents,trustCases
  ]=checks;

  const blockers=[];
  if(holds)blockers.push(blocker('ACCOUNT_CLOSURE_HOLD','legal_security_finance',holds,'A closure hold is still active.','Resolve the recorded hold with the responsible Admin team.'));
  if(adminAuthority)blockers.push(blocker('ACTIVE_ADMIN_AUTHORITY','security',adminAuthority,'Active Admin authority must be removed before closure.','Revoke or transfer Admin authority first.'));
  if(businessMemberships)blockers.push(blocker('ACTIVE_BUSINESS_MEMBERSHIP','financial',businessMemberships,'An active business membership or ownership relationship remains.','Transfer ownership or close/deactivate the business membership.'));
  if(profileApplications)blockers.push(blocker('OPEN_PROFILE_APPLICATION','governance',profileApplications,'A profile application is still open.','Finish, reject or withdraw the application.'));
  if(profileAuthorizations)blockers.push(blocker('PROFILE_AUTHORIZATION','governance',profileAuthorizations,'An operational profile authorization remains.','Revoke or close the authorization.'));
  if(serviceCategoryAuthorizations)blockers.push(blocker('SERVICE_CATEGORY_AUTHORIZATION','governance',serviceCategoryAuthorizations,'A Local Services category authorization is still pending or active.','Resolve or revoke the category authorization.'));
  if(account.account_mode==='company_test')blockers.push(blocker('COMPANY_MANAGED_ACCOUNT','security',1,'Company-managed test identities cannot be closed with the personal account deletion flow.','Use the governed company test-account administration process.'));
  if(orders)blockers.push(blocker('OPEN_ORDER','financial',orders,'One or more Customer orders are still open.','Complete or cancel the orders and settle any related payment.'));
  if(purchaseOrders)blockers.push(blocker('OPEN_PURCHASE_ORDER','financial',purchaseOrders,'One or more Supplier purchase orders are still open.','Receive, reject or cancel the purchase orders and settle obligations.'));
  if(deliveries)blockers.push(blocker('OPEN_DELIVERY','operational',deliveries,'A delivery is still active.','Complete, fail or cancel the delivery safely.'));
  if(serviceJobs)blockers.push(blocker('OPEN_SERVICE_JOB','operational',serviceJobs,'A Local Services job is still active or awaiting Customer confirmation.','Finish or cancel the job and resolve its payment.'));
  if(payments)blockers.push(blocker('UNSETTLED_PAYMENT','financial',payments,'A payment is not in a terminal state.','Resolve the payment before closing the account.'));
  if(refunds)blockers.push(blocker('UNSETTLED_REFUND','financial',refunds,'A refund is not in a terminal state.','Finish or resolve the refund.'));
  if(moneyMovements)blockers.push(blocker('UNSETTLED_MONEY_MOVEMENT','financial',moneyMovements,'A payout, withdrawal or transfer is still pending or under review.','Finish or resolve the money movement.'));
  if(support)blockers.push(blocker('OPEN_SUPPORT_OR_PRIVACY_CASE','support_privacy',support,'A Support or privacy request is still open.','Resolve or close the case before account closure.'));
  if(safetyIncidents||trustCases)blockers.push(blocker('OPEN_TRUST_SAFETY_CASE','security_legal',safetyIncidents+trustCases,'A Trust & Safety matter is unresolved.','Resolve the safety/security case before account closure.'));

  const historyChecks=await Promise.all([
    optionalCount(pool,`SELECT COUNT(*)::int count FROM profiles WHERE account_id=$1`,[accountId]),
    optionalCount(pool,`SELECT COUNT(*)::int count FROM business_memberships WHERE account_id=$1`,[accountId]),
    optionalCount(pool,`SELECT COUNT(*)::int count FROM orders WHERE customer_account_id=$1`,[accountId]),
    optionalCount(pool,`SELECT COUNT(*)::int count FROM purchase_orders WHERE supplier_account_id=$1`,[accountId]),
    optionalCount(pool,`SELECT COUNT(*)::int count FROM deliveries WHERE customer_account_id=$1 OR courier_account_id=$1`,[accountId]),
    optionalCount(pool,`SELECT COUNT(*)::int count FROM service_jobs WHERE customer_account_id=$1 OR provider_account_id=$1`,[accountId]),
    optionalCount(pool,`SELECT COUNT(*)::int count FROM payment_intents WHERE payer_account_id=$1`,[accountId]),
    optionalCount(pool,`SELECT COUNT(*)::int count FROM support_tickets WHERE requester_account_id=$1`,[accountId]),
    optionalCount(pool,`SELECT COUNT(*)::int count FROM incident_reports WHERE reporter_account_id=$1`,[accountId]),
    optionalCount(pool,`SELECT COUNT(*)::int count FROM platform_admin_assignments WHERE account_id=$1`,[accountId]),
    optionalCount(pool,`SELECT COUNT(*)::int count FROM service_category_authorizations WHERE account_id=$1`,[accountId])
  ]);
  const meaningfulHistory=historyChecks.reduce((sum,value)=>sum+Number(value||0),0);
  const purgeEligible=account.account_mode!=='company_test'&&!account.email_verified_at&&blockers.length===0&&meaningfulHistory===0&&account.auth_status!=='closed';
  const alreadyClosed=account.auth_status==='closed'||Boolean(account.closed_at);
  return{
    account_id:accountId,
    personal_id:account.personal_public_id||'',
    state:alreadyClosed?'closed':blockers.length?'blocked':'ready',
    blockers,
    blocker_count:blockers.length,
    retained_history_present:meaningfulHistory>0,
    purge_eligible:Boolean(purgeEligible),
    close_mode:purgeEligible?'purge_empty_unverified':'anonymize_and_retain_required_history',
    already_closed:alreadyClosed
  };
}

export async function closeAccountSafely(pool,{
  accountId:rawAccountId,actorAccountId=null,actorType='self',reason='Account closure requested'
}={}){
  const accountId=numericId(rawAccountId),actor=actorAccountId==null?null:numericId(actorAccountId);
  const why=clean(reason,1200)||'Account closure requested';
  const assessment=await accountClosureAssessment(pool,accountId);
  if(assessment.already_closed)return{ok:true,assessment,closed:true};
  if(assessment.blockers.length){
    const error=Object.assign(new Error('Account closure is blocked until outstanding matters are resolved'),{
      status:409,code:'ACCOUNT_CLOSURE_BLOCKED',assessment
    });
    throw error;
  }
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const locked=await client.query(`SELECT id,personal_public_id,auth_status FROM accounts WHERE id=$1 FOR UPDATE`,[accountId]);
    if(!locked.rowCount)throw Object.assign(new Error('Account not found'),{status:404});
    if(locked.rows[0].auth_status==='closed'){await client.query('COMMIT');return{ok:true,assessment,closed:true}}

    await optionalExec(client,`UPDATE profiles SET enabled=FALSE,visibility='private',status=CASE WHEN status='active' THEN 'disabled' ELSE status END,updated_at=NOW() WHERE account_id=$1`,[accountId]);
    await optionalExec(client,`UPDATE courier_profiles SET available=FALSE,updated_at=NOW() WHERE account_id=$1`,[accountId]);

    await optionalExec(client,`UPDATE account_financial_destinations SET status='inactive',is_default_payout=FALSE,provider_destination_ref='',display_name='',institution_name='',account_name='',reference_last4='',updated_at=NOW() WHERE account_id=$1`,[accountId]);
    await optionalExec(client,`UPDATE account_saved_payment_methods SET status='inactive',is_default=FALSE,provider_customer_ref='',provider_payment_method_ref='',display_label='',brand='',last4='',expiry_month=NULL,expiry_year=NULL,updated_at=NOW() WHERE account_id=$1`,[accountId]);
    await optionalExec(client,`UPDATE account_money_identities SET legal_name='',provider_customer_ref='',provider_wallet_ref='',capabilities_json='{}'::jsonb,updated_at=NOW() WHERE account_id=$1`,[accountId]);

    await optionalExec(client,`UPDATE account_auth_identities SET provider_subject=('closed:'||account_id::text||':'||id::text),provider_email_snapshot='',revoked_at=COALESCE(revoked_at,NOW()) WHERE account_id=$1`,[accountId]);
    await optionalExec(client,`DELETE FROM auth_action_tokens WHERE account_id=$1`,[accountId]);
    await optionalExec(client,`UPDATE account_sessions SET revoked_at=COALESCE(revoked_at,NOW()) WHERE account_id=$1`,[accountId]);

    await client.query(`
      UPDATE accounts SET
        display_name='Closed account',phone='',email='',address='',avatar_data_url='',
        active_role=NULL,password_salt=NULL,password_hash=NULL,auth_status='closed',
        closure_requested_at=COALESCE(closure_requested_at,NOW()),closed_at=NOW(),
        closure_mode='anonymize_and_retain_required_history',closure_reason=$2,updated_at=NOW()
      WHERE id=$1
    `,[accountId,why]);

    await client.query(`
      INSERT INTO account_closure_events(account_id,account_public_id,actor_account_id,actor_type,action_code,reason,detail_json)
      VALUES($1,$2,$3,$4,'account_closed',$5,$6::jsonb)
    `,[accountId,locked.rows[0].personal_public_id||'',actor,actorType,why,JSON.stringify({retained_history_present:assessment.retained_history_present,mode:'anonymize_and_retain_required_history'})]);
    await client.query('COMMIT');
    return{ok:true,closed:true,mode:'anonymize_and_retain_required_history',account_id:accountId};
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{client.release()}
}

export async function purgeEmptyUnverifiedAccount(pool,{
  accountId:rawAccountId,actorAccountId=null,actorType='admin',reason='Empty unverified registration purge'
}={}){
  const accountId=numericId(rawAccountId),actor=actorAccountId==null?null:numericId(actorAccountId),why=clean(reason,1200);
  const assessment=await accountClosureAssessment(pool,accountId);
  if(!assessment.purge_eligible){
    const error=Object.assign(new Error('This account is not eligible for destructive purge'),{
      status:409,code:'ACCOUNT_PURGE_NOT_ELIGIBLE',assessment
    });
    throw error;
  }
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const locked=await client.query(`SELECT id,personal_public_id,email_verified_at FROM accounts WHERE id=$1 FOR UPDATE`,[accountId]);
    if(!locked.rowCount)throw Object.assign(new Error('Account not found'),{status:404});
    if(locked.rows[0].email_verified_at)throw Object.assign(new Error('Verified accounts cannot use empty-registration purge'),{status:409});
    await client.query(`
      INSERT INTO account_closure_events(account_id,account_public_id,actor_account_id,actor_type,action_code,reason,detail_json)
      VALUES($1,$2,$3,$4,'empty_unverified_registration_purged',$5,$6::jsonb)
    `,[accountId,locked.rows[0].personal_public_id||'',actor,actorType,why||'Empty unverified registration purge',JSON.stringify({mode:'purge_empty_unverified'})]);
    const deleted=await client.query(`DELETE FROM accounts WHERE id=$1 RETURNING id`,[accountId]);
    if(deleted.rowCount!==1)throw Object.assign(new Error('Account purge did not complete'),{status:409});
    await client.query('COMMIT');
    return{ok:true,purged:true,mode:'purge_empty_unverified',account_id:accountId};
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{client.release()}
}
