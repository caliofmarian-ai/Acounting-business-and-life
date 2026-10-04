import pg from 'pg';
import {currentReleaseEvidence} from '../release-evidence.js';

const{Pool}=pg;
const fail=message=>{throw new Error(message)};
const present=value=>value!==null&&value!==undefined&&String(value).trim()!=='';

async function run(){
  if(process.env.RAILWAY_ENVIRONMENT_NAME!=='production')fail('Production Admin Evidence smoke requires Railway production environment.');
  if(process.env.NODE_ENV!=='production')fail('Production Admin Evidence smoke requires NODE_ENV=production.');
  if(!process.env.DATABASE_URL)fail('DATABASE_URL is required.');

  const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
  try{
    const release=currentReleaseEvidence();
    if(release.source_issue!==758||release.status!=='hold'||release.product_quality?.parity_policy!=='production_only'){
      fail('Repository release evidence is not pinned to the Production audit source.');
    }
    if(!Array.isArray(release.owner_decisions)||release.owner_decisions.length!==3){
      fail('Owner release decision evidence is incomplete.');
    }

    const pricing=await pool.query(`
      SELECT r.id,r.version,r.active,r.route_factor,r.created_by_account_id,r.created_at,
             creator.display_name created_by_name,
             COUNT(v.id)::int vehicle_rule_count,
             BOOL_AND(
               v.base_fee IS NOT NULL AND v.per_km IS NOT NULL AND v.per_kg IS NOT NULL
               AND v.per_liter IS NOT NULL AND v.minimum_fee IS NOT NULL
               AND v.included_distance_km IS NOT NULL AND v.distance_bands IS NOT NULL
               AND v.extra_stop_fee IS NOT NULL AND v.free_wait_minutes IS NOT NULL
               AND v.waiting_fee_per_minute IS NOT NULL AND v.demand_adjustment_cap_pct IS NOT NULL
               AND v.route_profile IS NOT NULL AND v.expressway_eligible IS NOT NULL
               AND v.toll_policy IS NOT NULL AND v.parking_policy IS NOT NULL AND v.stacking_policy IS NOT NULL
             ) complete_vehicle_rules
        FROM delivery_pricing_rules r
        LEFT JOIN accounts creator ON creator.id=r.created_by_account_id
        LEFT JOIN delivery_vehicle_pricing_rules v ON v.pricing_rule_id=r.id
       WHERE r.country_code='PH' AND r.active=TRUE
       GROUP BY r.id,creator.display_name
       ORDER BY r.version DESC
       LIMIT 1
    `);
    const tariff=pricing.rows[0];
    if(!tariff)fail('No active PH delivery tariff exists.');
    if(Number(tariff.vehicle_rule_count)<1||tariff.complete_vehicle_rules!==true)fail('Active PH delivery tariff evidence is incomplete.');
    if(!tariff.created_at||!tariff.created_by_account_id)fail('Active PH delivery tariff creator evidence is incomplete.');

    const auditSchema=await pool.query(`
      SELECT column_name
        FROM information_schema.columns
       WHERE table_schema='public' AND table_name='admin_audit_events'
         AND column_name IN (
           'actor_account_id','target_type','target_id','territory_id',
           'event_code','reason','correlation_id','created_at'
         )
    `);
    if(new Set(auditSchema.rows.map(row=>row.column_name)).size!==8)fail('Admin audit investigation schema is incomplete.');

    const audit=await pool.query(`
      SELECT e.id,e.actor_account_id,a.display_name actor_name,e.target_type,e.target_id,
             e.territory_id,e.event_code,e.correlation_id,e.created_at
        FROM admin_audit_events e
        LEFT JOIN accounts a ON a.id=e.actor_account_id
       WHERE e.country_code='PH'
       ORDER BY e.created_at DESC
       LIMIT 50
    `);
    if(!audit.rowCount)fail('No Production Admin audit evidence exists.');
    const reconstructable=audit.rows.some(row=>
      row.actor_account_id&&present(row.actor_name)&&present(row.target_type)&&present(row.target_id)
      &&present(row.event_code)&&present(row.correlation_id)&&row.created_at
    );
    if(!reconstructable)fail('Recent Admin audit evidence has no fully reconstructable actor/target/request row.');

    const application=await pool.query(`
      SELECT pa.id,pa.status,pa.reviewed_by_account_id,reviewer.display_name reviewer_name,
             pa.reviewed_at,pa.decision_reason,
             h.id review_id,h.from_status,h.decision,h.to_status,h.reviewer_account_id,
             h.reviewer_note,h.evidence_attested,h.adult_eligibility_attested,
             h.approved_category_ids,h.correlation_id,h.created_at review_created_at
        FROM profile_applications pa
        LEFT JOIN accounts reviewer ON reviewer.id=pa.reviewed_by_account_id
        LEFT JOIN LATERAL (
          SELECT *
            FROM profile_application_reviews x
           WHERE x.application_id=pa.id
           ORDER BY x.created_at DESC,x.id DESC
           LIMIT 1
        ) h ON TRUE
       WHERE pa.id=7
       LIMIT 1
    `);
    const app=application.rows[0];
    if(!app)fail('Historical Application #7 is unavailable in Production.');
    if(!app.review_id)fail('Historical Application #7 has no immutable review-history row.');
    if(!app.reviewer_account_id||!present(app.reviewer_name)||!app.review_created_at)fail('Application #7 reviewer/time evidence is incomplete.');
    if(!present(app.decision)||!present(app.to_status))fail('Application #7 decision transition is incomplete.');
    if(typeof app.evidence_attested!=='boolean'||typeof app.adult_eligibility_attested!=='boolean')fail('Application #7 attestation evidence is incomplete.');
    if(!present(app.correlation_id))fail('Application #7 request correlation evidence is incomplete.');

    console.log('PRODUCTION_ADMIN_EVIDENCE_766_SMOKE_RESULT '+JSON.stringify({
      status:'PASS',
      environment:'production',
      read_only:true,
      release_source_issue:release.source_issue,
      owner_decisions:release.owner_decisions.map(item=>item.decision_code),
      active_tariff_version:Number(tariff.version),
      active_tariff_vehicle_rules:Number(tariff.vehicle_rule_count),
      audit_reconstructable:true,
      application_7_review_id:Number(app.review_id),
      application_7_attestation_recorded:true,
      application_7_correlation_recorded:true,
      private_evidence_exposed:false,
      real_money:false
    }));
  }catch(error){
    console.error('PRODUCTION_ADMIN_EVIDENCE_766_SMOKE_RESULT '+JSON.stringify({
      status:'FAIL',read_only:true,error:String(error?.message||error).slice(0,500)
    }));
    process.exitCode=1;
  }finally{
    await pool.end();
  }
}

await run();
