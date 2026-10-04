import pg from 'pg';
import {
  SUBSCRIPTION_CANONICAL_PLAN_DRAFTS,
  SUBSCRIPTION_SERVICE_SCOPES,
  subscriptionActivationEvidence,
  subscriptionLifecycleSimulation,
  subscriptionPolicyActivationState
} from '../profile-subscription-core.js';

const{Pool}=pg;
const fail=message=>{throw new Error(message)};

async function run(){
  if(process.env.RAILWAY_ENVIRONMENT_NAME!=='production')fail('Production Subscription Billing smoke requires Railway production environment.');
  if(process.env.NODE_ENV!=='production')fail('Production Subscription Billing smoke requires NODE_ENV=production.');
  if(!process.env.DATABASE_URL)fail('DATABASE_URL is required.');

  const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
  try{
    const plans=await pool.query(`
      SELECT DISTINCT ON(service_scope)
        id,public_id,policy_code,version,status,service_scope,currency_code,monthly_amount,
        promo_days,policy_hash,lifecycle_rules,activation_requirements,created_at
      FROM profile_subscription_policy_versions
      WHERE country_code='PH' AND service_scope=ANY($1::text[])
      ORDER BY service_scope,version DESC,id DESC
    `,[SUBSCRIPTION_SERVICE_SCOPES]);
    if(plans.rowCount!==3)fail('Every subscription-bearing role must have one latest immutable plan draft.');

    const byScope=new Map(plans.rows.map(row=>[row.service_scope,row]));
    for(const scope of SUBSCRIPTION_SERVICE_SCOPES){
      const row=byScope.get(scope),expected=SUBSCRIPTION_CANONICAL_PLAN_DRAFTS[scope];
      if(!row)fail('Missing plan for '+scope);
      if(Number(row.monthly_amount)!==Number(expected.monthly_amount))fail(scope+' monthly plan amount is not the Owner-approved PHP 99 target.');
      if(Number(row.promo_days)!==90)fail(scope+' plan does not preserve the 90-day promotion.');
      if(!/^[a-f0-9]{64}$/.test(String(row.policy_hash||'')))fail(scope+' plan hash is missing.');
      if(row.lifecycle_rules?.cancellation!=='cancel_at_period_end_no_new_cycle')fail(scope+' cancellation rule is missing.');
      if(!Array.isArray(row.lifecycle_rules?.retry_schedule_days)||row.lifecycle_rules.retry_schedule_days.join(',')!=='1,3,7')fail(scope+' retry schedule is not deterministic.');
      if(row.activation_requirements?.profile_acceptance_before_charge!==true)fail(scope+' plan does not require profile acceptance before charge.');
    }

    const evidence=await subscriptionActivationEvidence(pool);
    for(const row of plans.rows){
      const state=subscriptionPolicyActivationState({policy:row,evidence});
      if(row.status!=='active'&&state.state==='ACTIVE')fail('Inactive plan cannot report ACTIVE.');
      if((!evidence.legal.ready||!evidence.provider.ready)&&state.ready)fail('Plan cannot become activation-ready while legal/provider evidence is missing.');
    }

    const unsafeInvoices=await pool.query(`
      SELECT COUNT(*)::int count
        FROM profile_subscription_invoices i
        JOIN profile_subscription_policy_versions p ON p.id=i.policy_version_id
       WHERE i.status IN ('open','paid','past_due')
         AND p.status<>'active'
    `);
    if(Number(unsafeInvoices.rows[0]?.count||0)!==0)fail('Billable subscription invoice exists without an active policy.');

    for(const scenario of ['renewal_success','payment_failure','cancellation','grandfathering']){
      const result=subscriptionLifecycleSimulation({scenario,monthlyAmount:99});
      if(result.charge_attempted!==false)fail('Lifecycle simulation attempted a charge: '+scenario);
    }

    console.log('PRODUCTION_SUBSCRIPTION_BILLING_770_SMOKE_RESULT '+JSON.stringify({
      status:'PASS',
      environment:'production',
      read_only:true,
      plans:plans.rows.map(row=>({
        scope:row.service_scope,version:Number(row.version),status:row.status,
        monthly_amount:Number(row.monthly_amount),promo_days:Number(row.promo_days),
        policy_hash:String(row.policy_hash).slice(0,16)
      })),
      legal_ready:Boolean(evidence.legal.ready),
      provider_ready:Boolean(evidence.provider.ready),
      unsafe_invoice_count:0,
      lifecycle_scenarios_no_charge:true,
      real_money:false
    }));
  }catch(error){
    console.error('PRODUCTION_SUBSCRIPTION_BILLING_770_SMOKE_RESULT '+JSON.stringify({
      status:'FAIL',read_only:true,error:String(error?.message||error).slice(0,500)
    }));
    process.exitCode=1;
  }finally{await pool.end()}
}

await run();
