const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function applicationFrom(rows,id){
  return (Array.isArray(rows)?rows:[]).find(row=>Number(row.id)===Number(id));
}

function profileFrom(rows){
  return (Array.isArray(rows)?rows:[]).find(row=>row.role==='merchant');
}

async function restoreFixture(pool,{application,profile,authorizations,reviewMaxId}){
  await pool.query(`
    UPDATE profile_applications
       SET territory_id=$1,invitation_id=$2,status=$3,proposed_business_name=$4,
           applicant_note=$5,responsibility_acknowledged=$6,application_data=$7::jsonb,
           submitted_at=$8,reviewed_by_account_id=$9,reviewed_at=$10,
           decision_reason=$11,updated_at=$12
     WHERE id=$13
  `,[
    application.territory_id,application.invitation_id,application.status,
    application.proposed_business_name,application.applicant_note,
    application.responsibility_acknowledged,JSON.stringify(application.application_data||{}),
    application.submitted_at,application.reviewed_by_account_id,application.reviewed_at,
    application.decision_reason,application.updated_at,application.id
  ]);
  if(profile){
    await pool.query(`UPDATE profiles SET enabled=$1,visibility=$2,status=$3,updated_at=$4 WHERE account_id=$5 AND role='merchant'`,[
      profile.enabled,profile.visibility,profile.status,profile.updated_at,application.account_id
    ]);
  }
  const baselineIds=authorizations.map(row=>Number(row.id));
  for(const row of authorizations){
    await pool.query(`
      UPDATE profile_authorizations
         SET status=$1,approved_by_account_id=$2,approved_at=$3,expires_at=$4,reason=$5,updated_at=$6
       WHERE id=$7
    `,[row.status,row.approved_by_account_id,row.approved_at,row.expires_at,row.reason,row.updated_at,row.id]);
  }
  await pool.query(`
    DELETE FROM profile_authorizations
     WHERE account_id=$1 AND role='merchant' AND application_id=$2
       AND NOT (id=ANY($3::bigint[]))
  `,[application.account_id,application.id,baselineIds]);
  await pool.query(`DELETE FROM profile_application_reviews WHERE application_id=$1 AND id>$2`,[application.id,reviewMaxId]);
}

async function notificationEvidence(pool,{applicationId,reviewEventId,accountId}){
  const key=`profile-app:${applicationId}:review:${reviewEventId}`;
  for(let attempt=0;attempt<30;attempt+=1){
    const q=await pool.query(`
      SELECT e.event_key,e.data_json,r.account_id,d.channel,d.status
        FROM notification_events e
        JOIN notification_recipients r ON r.event_id=e.id
        JOIN notification_deliveries d ON d.recipient_id=r.id
       WHERE e.event_key=$1 AND r.account_id=$2
       ORDER BY d.channel
    `,[key,accountId]);
    if(q.rows.some(row=>row.channel==='in_app')&&q.rows.some(row=>row.channel==='email'))return q.rows;
    await sleep(100);
  }
  throw new Error('Merchant Governance notification evidence did not materialize for the committed review event.');
}

export async function runMerchantGovernanceV1Acceptance({pool,base,secret,aliases,helpers}){
  const{requestJson,expectStatus,qaAccountSession,ensureQaTerritory}=helpers;
  let merchantToken='',adminToken='',fixture=null,passed=false;
  try{
    const admin=await qaAccountSession({
      pool,base,secret,email:aliases.superAdmin,role:'super_admin',label:'Merchant Governance Super Admin QA'
    });
    const merchant=await qaAccountSession({
      pool,base,secret,email:aliases.merchant,role:'merchant',label:'Merchant Governance Merchant QA'
    });
    adminToken=admin.token;merchantToken=merchant.token;
    const territoryId=await ensureQaTerritory({pool,base,adminToken});

    let application=(await pool.query(`
      SELECT * FROM profile_applications
       WHERE account_id=$1 AND role='merchant' AND status NOT IN ('rejected','revoked')
       ORDER BY id DESC LIMIT 1
    `,[merchant.accountId])).rows[0]||null;
    if(!application){
      const started=await requestJson(base,'/api/governance/profiles/merchant/start',{
        method:'POST',token:merchantToken,body:{territory_id:territoryId}
      });
      expectStatus(started,201,'Merchant Governance application start');
      application=(await pool.query(`SELECT * FROM profile_applications WHERE id=$1`,[started.json.id])).rows[0];
    }
    if(!application)throw new Error('Merchant Governance controlled application is unavailable.');

    const [profileResult,authorizationResult,reviewResult]=await Promise.all([
      pool.query(`SELECT enabled,visibility,status,updated_at FROM profiles WHERE account_id=$1 AND role='merchant'`,[merchant.accountId]),
      pool.query(`SELECT id,status,approved_by_account_id,approved_at,expires_at,reason,updated_at FROM profile_authorizations WHERE account_id=$1 AND role='merchant' ORDER BY id`,[merchant.accountId]),
      pool.query(`SELECT COALESCE(MAX(id),0)::bigint max_id,COUNT(*)::int count FROM profile_application_reviews WHERE application_id=$1`,[application.id])
    ]);
    fixture={
      application:{...application},profile:profileResult.rows[0]||null,
      authorizations:authorizationResult.rows,
      reviewMaxId:Number(reviewResult.rows[0].max_id),reviewCount:Number(reviewResult.rows[0].count)
    };

    await pool.query(`UPDATE territories SET status='active',updated_at=NOW() WHERE id=$1`,[application.territory_id]);
    await pool.query(`
      UPDATE profile_applications
         SET status='application_started',proposed_business_name='',applicant_note='',
             responsibility_acknowledged=FALSE,application_data='{}'::jsonb,
             submitted_at=NULL,reviewed_by_account_id=NULL,reviewed_at=NULL,
             decision_reason='',updated_at=NOW()
       WHERE id=$1
    `,[application.id]);
    await pool.query(`
      INSERT INTO profiles(account_id,role,enabled,visibility,status)
      VALUES($1,'merchant',FALSE,'private','application_started')
      ON CONFLICT(account_id,role) DO UPDATE SET enabled=FALSE,visibility='private',status='application_started',updated_at=NOW()
    `,[merchant.accountId]);
    await pool.query(`UPDATE profile_authorizations SET status='suspended',updated_at=NOW() WHERE account_id=$1 AND role='merchant'`,[merchant.accountId]);

    const edited=await requestJson(base,`/api/governance/applications/${application.id}`,{
      method:'PUT',token:merchantToken,
      body:{
        proposed_business_name:'Business & Life QA Fish Kitchen',
        applicant_note:'Controlled Merchant Governance synchronization acceptance.',
        responsibility_acknowledged:true,
        application_data:{test_fixture:true,onboarding_version:'merchant-governance-v1'}
      }
    });
    expectStatus(edited,200,'Merchant Governance draft save');
    if(edited.json?.status!=='application_started'||edited.json?.profile_status!=='application_started'||edited.json?.profile_enabled!==false){
      throw new Error('Merchant Governance draft save invented a review state or failed to project the profile.');
    }

    const draftState=await requestJson(base,'/api/governance/state',{token:merchantToken});
    expectStatus(draftState,200,'Merchant Governance draft state');
    const draftApplication=applicationFrom(draftState.json?.applications,application.id);
    if(draftApplication?.status!=='application_started')throw new Error('Merchant Governance modal state disagrees after draft save.');

    const submitted=await requestJson(base,`/api/governance/applications/${application.id}/submit`,{
      method:'POST',token:merchantToken,body:{}
    });
    expectStatus(submitted,200,'Merchant Governance submit');
    if(submitted.json?.status!=='submitted'||submitted.json?.profile_status!=='submitted'||submitted.json?.profile_enabled!==false){
      throw new Error('Merchant Governance submit did not return the committed application/profile state.');
    }

    const bootstrap=await requestJson(base,'/api/session/bootstrap',{token:merchantToken});
    expectStatus(bootstrap,200,'Merchant Governance shell bootstrap');
    const submittedProfile=profileFrom(bootstrap.json?.profile?.profiles);
    if(submittedProfile?.status!=='submitted'||submittedProfile?.enabled!==false){
      throw new Error('Merchant Governance profile card disagrees with submitted application state.');
    }

    const historyBeforeFailure=await pool.query(`SELECT COUNT(*)::int count FROM profile_application_reviews WHERE application_id=$1`,[application.id]);
    const missingAttestation=await requestJson(base,`/api/governance/admin/applications/${application.id}/review`,{
      method:'POST',token:adminToken,body:{decision:'approve',reason:'Must fail without evidence attestation'}
    });
    expectStatus(missingAttestation,400,'Merchant Governance missing-attestation denial');
    const unchanged=await pool.query(`
      SELECT pa.status,p.status profile_status,p.enabled,
             (SELECT COUNT(*)::int FROM profile_application_reviews h WHERE h.application_id=pa.id) review_count
        FROM profile_applications pa JOIN profiles p ON p.account_id=pa.account_id AND p.role=pa.role
       WHERE pa.id=$1
    `,[application.id]);
    if(unchanged.rows[0]?.status!=='submitted'||unchanged.rows[0]?.profile_status!=='submitted'||unchanged.rows[0]?.enabled!==false||Number(unchanged.rows[0]?.review_count)!==Number(historyBeforeFailure.rows[0].count)){
      throw new Error('Merchant Governance failed review mutation changed committed state or history.');
    }

    const underReview=await requestJson(base,`/api/governance/admin/applications/${application.id}/review`,{
      method:'POST',token:adminToken,
      body:{decision:'under_review',reason:'Controlled review is in progress'}
    });
    expectStatus(underReview,200,'Merchant Governance under-review transition');
    if(underReview.json?.committed!==true||underReview.json?.status!=='under_review'||underReview.json?.profile_status!=='under_review'){
      throw new Error('Merchant Governance under-review response is not the committed canonical state.');
    }

    const approvalBody={
      decision:'approve',reason:'Controlled Merchant Governance approval',
      approved_category_ids:[],evidence_attested:true
    };
    const duplicateResults=await Promise.all([
      requestJson(base,`/api/governance/admin/applications/${application.id}/review`,{method:'POST',token:adminToken,body:approvalBody}),
      requestJson(base,`/api/governance/admin/applications/${application.id}/review`,{method:'POST',token:adminToken,body:approvalBody})
    ]);
    const committed=duplicateResults.find(result=>result.status===200);
    const duplicate=duplicateResults.find(result=>result.status===409);
    if(!committed||!duplicate)throw new Error('Merchant Governance concurrent duplicate review was not serialized to one commit.');
    if(committed.json?.committed!==true||committed.json?.status!=='approved'||committed.json?.profile_status!=='active'||committed.json?.profile_enabled!==true){
      throw new Error('Merchant Governance approval response did not return the committed active projection.');
    }
    const reviewEventId=Number(committed.json?.review_event_id);
    if(!Number.isSafeInteger(reviewEventId)||reviewEventId<1)throw new Error('Merchant Governance approval lacks an immutable review event.');

    const [applicantState,adminDetail,adminOverview,finalBootstrap,history]=await Promise.all([
      requestJson(base,'/api/governance/state',{token:merchantToken}),
      requestJson(base,`/api/governance/admin/applications/${application.id}`,{token:adminToken}),
      requestJson(base,'/api/governance/admin/overview',{token:adminToken}),
      requestJson(base,'/api/session/bootstrap',{token:merchantToken}),
      pool.query(`SELECT * FROM profile_application_reviews WHERE application_id=$1 ORDER BY id DESC`,[application.id])
    ]);
    for(const[result,label]of [[applicantState,'applicant state'],[adminDetail,'Admin detail'],[adminOverview,'Admin overview'],[finalBootstrap,'final shell bootstrap']])expectStatus(result,200,'Merchant Governance '+label);
    const applicantApplication=applicationFrom(applicantState.json?.applications,application.id);
    const queueApplication=applicationFrom(adminOverview.json?.applications,application.id);
    const finalProfile=profileFrom(finalBootstrap.json?.profile?.profiles);
    if(applicantApplication?.status!=='approved'||adminDetail.json?.status!=='approved'||queueApplication?.status!=='approved'||finalProfile?.status!=='active'||finalProfile?.enabled!==true){
      throw new Error('Merchant Governance applicant, Admin queue, detail and profile card do not agree after approval.');
    }
    if((adminOverview.json?.applications||[]).filter(row=>Number(row.id)===Number(application.id)&&['submitted','under_review'].includes(row.status)).length){
      throw new Error('Merchant Governance committed application remained in the pending Admin queue.');
    }
    const latestHistory=history.rows[0];
    if(history.rows.length!==fixture.reviewCount+2||Number(latestHistory?.id)!==reviewEventId||latestHistory?.to_status!=='approved'||latestHistory?.reviewer_note!==approvalBody.reason||latestHistory?.evidence_attested!==true||!latestHistory?.created_at){
      throw new Error('Merchant Governance immutable review history is incomplete or disagrees with approval.');
    }

    const deliveries=await notificationEvidence(pool,{
      applicationId:application.id,reviewEventId,accountId:merchant.accountId
    });
    for(const row of deliveries){
      if(row.data_json?.status!=='approved'||row.data_json?.reviewer_note!==approvalBody.reason||Number(row.data_json?.review_event_id)!==reviewEventId||!row.data_json?.reviewed_at){
        throw new Error('Merchant Governance applicant notification disagrees with Admin review history.');
      }
    }
    if(deliveries.find(row=>row.channel==='in_app')?.status!=='delivered')throw new Error('Merchant Governance in-app review notification was not delivered.');

    const [adminAsset,applicantAsset]=await Promise.all([fetch(base+'/admin-console.js'),fetch(base+'/profile-governance-ui.js')]);
    const adminJs=await adminAsset.text(),applicantJs=await applicantAsset.text();
    if(adminAsset.status!==200||!adminJs.includes('The committed result will appear here')||!adminJs.includes('setApplicationReviewBusy(form,false)')||!adminJs.includes('setAdminApplicationRoute(a.id)')){
      throw new Error('Merchant Governance Admin pending, retry or navigation feedback contract is missing.');
    }
    if(applicantAsset.status!==200||!applicantJs.includes('Submitting for review…')||!applicantJs.includes('reconcileGovApplication')){
      throw new Error('Merchant Governance applicant immediate reconciliation contract is missing.');
    }

    passed=true;
    return{
      status:'PASS',wave:'merchant_governance_v1',application_id:Number(application.id),
      review_event_id:reviewEventId,draft_projection:true,submit_projection:true,
      failed_mutation_atomic:true,retry_succeeded:true,duplicate_commit_prevented:true,
      admin_queue_reconciled:true,applicant_state_reconciled:true,
      immutable_history:true,notification_parity:true,slow_feedback_contract:true,
      navigation_context_preserved:true
    };
  }finally{
    if(!passed&&fixture)await restoreFixture(pool,fixture).catch(error=>console.error('Merchant Governance fixture restore failed:',error.message));
    if(merchantToken)await requestJson(base,'/api/auth/logout',{method:'POST',token:merchantToken,body:{}}).catch(()=>{});
    if(adminToken)await requestJson(base,'/api/auth/logout',{method:'POST',token:adminToken,body:{}}).catch(()=>{});
  }
}
