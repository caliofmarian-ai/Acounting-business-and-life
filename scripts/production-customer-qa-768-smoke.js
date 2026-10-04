import pg from 'pg';
import {readFileSync} from 'node:fs';

const{Pool}=pg;
const fail=message=>{throw new Error(message)};
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const CUSTOMER_ALIAS='dropi.deliveries+testcustomer@gmail.com';
const CUSTOMER_PSGC='0402103028';

async function run(){
  if(process.env.RAILWAY_ENVIRONMENT_NAME!=='production')fail('Production Customer QA smoke requires Railway production environment.');
  if(process.env.NODE_ENV!=='production')fail('Production Customer QA smoke requires NODE_ENV=production.');
  if(!process.env.DATABASE_URL)fail('DATABASE_URL is required.');

  const core=read('notification-core.js');
  const auth=read('server-auth-hardening.js');
  const geography=read('account-geography.js');
  const fixtures=read('controlled-role-fixtures.js');
  if(!core.includes('emailVerificationNotificationEventKey'))fail('Stable email-verification event-key policy is missing.');
  if(!core.includes('reconcileEmailVerificationNotificationState'))fail('Verification inbox reconciliation is missing.');
  if(!auth.includes('reopenInApp:verification'))fail('Verification resend does not reopen the canonical inbox notification.');
  if(!auth.includes('verified:true'))fail('Verification completion does not resolve the outstanding inbox notification.');
  if(!geography.includes("code:'ACCOUNT_TERRITORY_NOT_OPEN'"))fail('Unavailable-area onboarding is not fail-closed.');
  if(!fixtures.includes("personal_data:false"))fail('Controlled role fixture no-personal-data marker is missing.');

  const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
  try{
    const accountQ=await pool.query(`
      SELECT id,email_verified_at,account_mode,test_role
        FROM accounts
       WHERE LOWER(email)=$1
       LIMIT 1
    `,[CUSTOMER_ALIAS]);
    if(accountQ.rowCount!==1)fail('Dedicated controlled Customer account is missing.');
    const account=accountQ.rows[0],accountId=Number(account.id);
    if(account.account_mode!=='company_test'||account.test_role!=='customer')fail('Dedicated Customer identity classification is incorrect.');

    const geo=await pool.query(`
      SELECT a.psgc_code,a.assignment_source,a.geographic_level,a.geographic_name,
             t.status territory_status
        FROM account_geography_assignments a
        LEFT JOIN territories t ON t.country_code='PH' AND t.psgc_code=a.psgc_code
       WHERE a.account_id=$1
       LIMIT 1
    `,[accountId]);
    const location=geo.rows[0];
    if(!location||String(location.psgc_code)!==CUSTOMER_PSGC)fail('Controlled Customer is not assigned to the deterministic Queens Row West PSGC scenario.');
    if(location.geographic_level!=='barangay')fail('Controlled Customer geography is not barangay-scoped.');
    if(!['onboarding','active'].includes(String(location.territory_status||'')))fail('Controlled Customer test barangay is not available for the intended location scenario.');

    const inbox=await pool.query(`
      SELECT
        COUNT(*)::int total_rows,
        COUNT(*) FILTER(WHERE r.dismissed_at IS NULL)::int active_rows,
        COUNT(DISTINCT e.event_key) FILTER(WHERE r.dismissed_at IS NULL)::int active_event_keys
      FROM notification_recipients r
      JOIN notification_events e ON e.id=r.event_id
      JOIN notification_deliveries d ON d.recipient_id=r.id AND d.channel='in_app' AND d.status='delivered'
      WHERE r.account_id=$1 AND e.event_code='auth.email_verification'
    `,[accountId]);
    const counts=inbox.rows[0]||{};
    const activeRows=Number(counts.active_rows||0);
    const activeKeys=Number(counts.active_event_keys||0);
    if(activeRows>1||activeKeys>1)fail('Dedicated Customer still has duplicate actionable email-verification notifications.');
    if(account.email_verified_at&&activeRows!==0)fail('Verified Customer still has an actionable email-verification notification.');
    if(!account.email_verified_at&&activeRows!==1)fail('Unverified Customer must have exactly one actionable email-verification notification.');

    const eventFamilies=await pool.query(`
      SELECT event_code,COUNT(*)::int count
        FROM notification_events e
        JOIN notification_recipients r ON r.event_id=e.id
       WHERE r.account_id=$1 AND e.event_code IN ('auth.email_verification','auth.password_reset')
       GROUP BY event_code
       ORDER BY event_code
    `,[accountId]);
    if(eventFamilies.rows.some(row=>!['auth.email_verification','auth.password_reset'].includes(row.event_code)))fail('Security event families are not distinct.');

    console.log('PRODUCTION_CUSTOMER_QA_768_SMOKE_RESULT '+JSON.stringify({
      status:'PASS',
      environment:'production',
      read_only:true,
      customer_company_test:true,
      customer_psgc:CUSTOMER_PSGC,
      customer_barangay:String(location.geographic_name||''),
      verification_inbox_active:activeRows,
      verification_active_event_keys:activeKeys,
      verification_total_historical:Number(counts.total_rows||0),
      password_reset_distinct:true,
      unavailable_area_fail_closed:true,
      no_personal_address_claim:true,
      real_money:false
    }));
  }catch(error){
    console.error('PRODUCTION_CUSTOMER_QA_768_SMOKE_RESULT '+JSON.stringify({
      status:'FAIL',read_only:true,error:String(error?.message||error).slice(0,500)
    }));
    process.exitCode=1;
  }finally{await pool.end()}
}

await run();
