import pg from 'pg';
import {
  applicationStatusAfterReview,
  applicationStatusAfterSave,
  applicationStatusAfterSubmit,
  profileProjectionForApplication
} from '../profile-application-state-core.js';

const{Pool}=pg;
const fail=message=>{throw new Error(message)};

async function projectProfile(client,{accountId,status}){
  const projection=profileProjectionForApplication(status);
  await client.query(`
    UPDATE profiles
       SET enabled=$1,visibility=$2,status=$3,updated_at=NOW()
     WHERE account_id=$4 AND role='merchant'
  `,[projection.enabled,projection.visibility,projection.status,accountId]);
  return projection;
}

async function run(){
  if(process.env.RAILWAY_ENVIRONMENT_NAME!=='production')fail('Production Merchant Governance smoke requires Railway production environment.');
  if(process.env.NODE_ENV!=='production')fail('Production Merchant Governance smoke requires NODE_ENV=production.');
  if(!process.env.DATABASE_URL)fail('DATABASE_URL is required.');

  const pool=new Pool({
    connectionString:process.env.DATABASE_URL,
    ssl:{rejectUnauthorized:false}
  });
  const client=await pool.connect();
  const suffix=String(Date.now())+'-'+String(process.pid);
  const merchantEmail=`production-smoke-governance-merchant-${suffix}@business-life.invalid`;
  let began=false;
  try{
    await client.query('BEGIN');
    began=true;
    const schema=await client.query(`SELECT to_regclass('public.profile_application_reviews') review_table`);
    if(!schema.rows[0]?.review_table)fail('Production review-history schema is unavailable.');

    const admin=await client.query(`
      INSERT INTO accounts(display_name,email,account_mode,test_role,email_verified_at,auth_status)
      VALUES('Production Smoke Governance Reviewer',$1,'company_test','super_admin',NOW(),'active')
      RETURNING id
    `,[`production-smoke-governance-admin-${suffix}@business-life.invalid`]);
    const merchant=await client.query(`
      INSERT INTO accounts(display_name,email,account_mode,test_role,email_verified_at,auth_status)
      VALUES('Production Smoke Governance Merchant',$1,'company_test','merchant',NOW(),'active')
      RETURNING id
    `,[merchantEmail]);
    const adminId=Number(admin.rows[0]?.id),merchantId=Number(merchant.rows[0]?.id);
    if(!adminId||!merchantId)fail('Production smoke accounts were not created.');

    const territory=await client.query(`
      INSERT INTO territories(country_code,territory_type,name,code,status,created_by_account_id)
      VALUES('PH','custom_cell','Production Governance Smoke',$1,'onboarding',$2)
      RETURNING id
    `,[`PROD-GOV-SMOKE-${suffix}`,adminId]);
    const territoryId=Number(territory.rows[0]?.id);
    const application=await client.query(`
      INSERT INTO profile_applications(account_id,role,territory_id,status)
      VALUES($1,'merchant',$2,'application_started')
      RETURNING id,status
    `,[merchantId,territoryId]);
    const applicationId=Number(application.rows[0]?.id);
    await client.query(`
      INSERT INTO profiles(account_id,role,enabled,visibility,status)
      VALUES($1,'merchant',FALSE,'private','application_started')
    `,[merchantId]);

    const savedStatus=applicationStatusAfterSave(application.rows[0].status);
    if(savedStatus!=='application_started')fail('Draft save invented an Admin state.');
    await client.query(`
      UPDATE profile_applications
         SET status=$1,proposed_business_name='Production Smoke Business',
             applicant_note='Rollback-only governance smoke',responsibility_acknowledged=TRUE,
             application_data='{"production_smoke":true}'::jsonb,updated_at=NOW()
       WHERE id=$2
    `,[savedStatus,applicationId]);
    await projectProfile(client,{accountId:merchantId,status:savedStatus});

    const submittedStatus=applicationStatusAfterSubmit(savedStatus);
    await client.query(`UPDATE profile_applications SET status=$1,submitted_at=NOW(),updated_at=NOW() WHERE id=$2`,[submittedStatus,applicationId]);
    await projectProfile(client,{accountId:merchantId,status:submittedStatus});
    const failureBaseline=await client.query(`SELECT COUNT(*)::int count FROM profile_application_reviews WHERE application_id=$1`,[applicationId]);
    if(Number(failureBaseline.rows[0].count)!==0)fail('Temporary application unexpectedly has review history.');

    const underReviewStatus=applicationStatusAfterReview(submittedStatus,'under_review');
    await client.query(`UPDATE profile_applications SET status=$1,reviewed_by_account_id=$2,reviewed_at=NOW(),decision_reason=$3,updated_at=NOW() WHERE id=$4`,[
      underReviewStatus,adminId,'Rollback-only review in progress',applicationId
    ]);
    await projectProfile(client,{accountId:merchantId,status:underReviewStatus});
    await client.query(`
      INSERT INTO profile_application_reviews(
        application_id,from_status,decision,to_status,reviewer_account_id,reviewer_note,
        evidence_attested,adult_eligibility_attested,approved_category_ids,correlation_id
      ) VALUES($1,'submitted','under_review',$2,$3,$4,FALSE,FALSE,'[]'::jsonb,$5)
    `,[applicationId,underReviewStatus,adminId,'Rollback-only review in progress',`production-smoke-${suffix}`]);

    const approvedStatus=applicationStatusAfterReview(underReviewStatus,'approve');
    await client.query(`UPDATE profile_applications SET status=$1,reviewed_by_account_id=$2,reviewed_at=NOW(),decision_reason=$3,updated_at=NOW() WHERE id=$4`,[
      approvedStatus,adminId,'Rollback-only governed approval',applicationId
    ]);
    const projection=await projectProfile(client,{accountId:merchantId,status:approvedStatus});
    await client.query(`
      INSERT INTO profile_application_reviews(
        application_id,from_status,decision,to_status,reviewer_account_id,reviewer_note,
        evidence_attested,adult_eligibility_attested,approved_category_ids,correlation_id
      ) VALUES($1,'under_review','approve',$2,$3,$4,TRUE,FALSE,'[]'::jsonb,$5)
    `,[applicationId,approvedStatus,adminId,'Rollback-only governed approval',`production-smoke-${suffix}`]);

    const committed=await client.query(`
      SELECT pa.status application_status,pa.decision_reason,pa.reviewed_at,
             p.status profile_status,p.enabled,p.visibility,
             COUNT(h.id)::int review_count,
             BOOL_AND(h.reviewer_account_id=$2) actor_retained,
             BOOL_OR(h.evidence_attested) evidence_attestation_retained,
             BOOL_AND(h.created_at IS NOT NULL) review_time_retained
        FROM profile_applications pa
        JOIN profiles p ON p.account_id=pa.account_id AND p.role=pa.role
        JOIN profile_application_reviews h ON h.application_id=pa.id
       WHERE pa.id=$1
       GROUP BY pa.status,pa.decision_reason,pa.reviewed_at,p.status,p.enabled,p.visibility
    `,[applicationId,adminId]);
    const row=committed.rows[0];
    if(row?.application_status!=='approved'||row?.profile_status!=='active'||row?.enabled!==true||row?.visibility!=='private'||Number(row?.review_count)!==2||row?.actor_retained!==true||row?.evidence_attestation_retained!==true||row?.review_time_retained!==true||!row?.reviewed_at||!row?.decision_reason){
      fail('Production committed governance projection or immutable history is inconsistent.');
    }
    if(projection.enabled!==true||projection.status!=='active')fail('Production state core returned an invalid approved projection.');

    await client.query('ROLLBACK');
    began=false;
    const residue=await pool.query(`SELECT COUNT(*)::int count FROM accounts WHERE email=$1`,[merchantEmail]);
    if(Number(residue.rows[0].count)!==0)fail('Production rollback left temporary governance data behind.');
    console.log('PRODUCTION_MERCHANT_GOVERNANCE_SMOKE_RESULT '+JSON.stringify({
      status:'PASS',environment:'production',rollback:true,
      draft_state_preserved:true,submit_projection:true,review_projection:true,
      immutable_history:true,attestation_retained:true,real_money:false
    }));
  }catch(error){
    if(began)await client.query('ROLLBACK').catch(()=>{});
    console.error('PRODUCTION_MERCHANT_GOVERNANCE_SMOKE_RESULT '+JSON.stringify({
      status:'FAIL',rollback:true,error:String(error?.message||error).slice(0,500)
    }));
    process.exitCode=1;
  }finally{
    client.release();
    await pool.end();
  }
}

await run();
