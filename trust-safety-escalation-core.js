const URGENCY_INDICATORS=Object.freeze([
  'none',
  'immediate_danger',
  'child_or_vulnerable_person',
  'credible_threat_stalking_or_doxxing',
  'account_takeover_or_identity_theft',
  'payment_fraud_or_money_mule',
  'severe_illegal_or_exploitative_content'
]);
const ESCALATION_STATES=Object.freeze(['pending_acknowledgement','acknowledged','resolved']);
const POLICY_VERSION='ph-severe-escalation-v1';

const POLICY_BY_URGENCY=Object.freeze({
  immediate_danger:Object.freeze({
    trigger_source:'user_indicator',trigger_code:'immediate_danger',route_code:'immediate_personal_safety',
    severity:'critical',response_minutes:15,legal_review_required:true,evidence_preservation_required:true,country_scoped:true
  }),
  child_or_vulnerable_person:Object.freeze({
    trigger_source:'user_indicator',trigger_code:'child_or_vulnerable_person',route_code:'child_vulnerable_safety',
    severity:'critical',response_minutes:30,legal_review_required:true,evidence_preservation_required:true,country_scoped:true
  }),
  credible_threat_stalking_or_doxxing:Object.freeze({
    trigger_source:'user_indicator',trigger_code:'credible_threat_stalking_or_doxxing',route_code:'threat_stalking_doxxing',
    severity:'critical',response_minutes:30,legal_review_required:true,evidence_preservation_required:true,country_scoped:true
  }),
  account_takeover_or_identity_theft:Object.freeze({
    trigger_source:'user_indicator',trigger_code:'account_takeover_or_identity_theft',route_code:'account_security_fraud',
    severity:'high',response_minutes:240,legal_review_required:false,evidence_preservation_required:true,country_scoped:false
  }),
  payment_fraud_or_money_mule:Object.freeze({
    trigger_source:'user_indicator',trigger_code:'payment_fraud_or_money_mule',route_code:'payments_fraud',
    severity:'high',response_minutes:240,legal_review_required:true,evidence_preservation_required:true,country_scoped:false
  }),
  severe_illegal_or_exploitative_content:Object.freeze({
    trigger_source:'user_indicator',trigger_code:'severe_illegal_or_exploitative_content',route_code:'illegal_exploitative_content',
    severity:'critical',response_minutes:30,legal_review_required:true,evidence_preservation_required:true,country_scoped:true
  })
});

const CATEGORY_POLICIES=Object.freeze({
  'exploitation concern':Object.freeze({
    trigger_source:'report_category',trigger_code:'exploitation_concern',route_code:'child_vulnerable_safety',
    severity:'critical',response_minutes:30,legal_review_required:true,evidence_preservation_required:true,country_scoped:true
  }),
  'harassment / threat':Object.freeze({
    trigger_source:'report_category',trigger_code:'harassment_or_threat',route_code:'personal_safety',
    severity:'high',response_minutes:240,legal_review_required:false,evidence_preservation_required:true,country_scoped:false
  }),
  'dangerous / unsafe product or service':Object.freeze({
    trigger_source:'report_category',trigger_code:'dangerous_product_or_service',route_code:'product_service_safety',
    severity:'high',response_minutes:240,legal_review_required:false,evidence_preservation_required:true,country_scoped:false
  })
});

const SUPPORT_POLICY=Object.freeze({
  trigger_source:'admin_support',trigger_code:'admin_support_escalation',route_code:'trust_safety_priority',
  severity:'high',response_minutes:240,legal_review_required:false,evidence_preservation_required:true,country_scoped:false
});

const clean=(value,max=180)=>String(value??'').trim().slice(0,max);
const positiveId=(value,label='Record')=>{
  const id=Number(value);
  if(!Number.isSafeInteger(id)||id<1)throw Object.assign(new Error(`${label} ID is invalid`),{status:400});
  return id;
};
const clonePolicy=policy=>policy?Object.freeze({...policy,policy_version:POLICY_VERSION}):null;
const severityRank=value=>({low:0,moderate:1,high:2,critical:3})[String(value)]??-1;

export function severeEscalationPolicyVersion(){return POLICY_VERSION}
export function incidentUrgencyIndicators(){return[...URGENCY_INDICATORS]}
export function severeEscalationStates(){return[...ESCALATION_STATES]}
export function incidentUrgencyIndicator(value='none'){
  const indicator=clean(value,80).toLowerCase().replace(/[^a-z0-9_]+/g,'_').replace(/^_+|_+$/g,'')||'none';
  if(!URGENCY_INDICATORS.includes(indicator))throw Object.assign(new Error('Unknown incident urgency indicator'),{status:400});
  return indicator;
}

// Only closed, structured fields enter this policy. Report descriptions and attachments are intentionally absent.
export function severeIncidentEscalationPolicy({category='',urgencyIndicator='none',sourceSignal=''}={}){
  const signal=clean(sourceSignal,80).toLowerCase();
  if(signal==='admin_support_escalation')return clonePolicy(SUPPORT_POLICY);
  if(signal)throw Object.assign(new Error('Unknown severe escalation source signal'),{status:400});
  const urgency=incidentUrgencyIndicator(urgencyIndicator);
  const urgencyPolicy=urgency==='none'?null:POLICY_BY_URGENCY[urgency];
  const categoryPolicy=CATEGORY_POLICIES[clean(category,120).toLowerCase()]||null;
  if(!urgencyPolicy)return clonePolicy(categoryPolicy);
  if(!categoryPolicy)return clonePolicy(urgencyPolicy);
  if(severityRank(categoryPolicy.severity)>severityRank(urgencyPolicy.severity))return clonePolicy(categoryPolicy);
  if(severityRank(categoryPolicy.severity)<severityRank(urgencyPolicy.severity))return clonePolicy(urgencyPolicy);
  return clonePolicy(categoryPolicy.response_minutes<urgencyPolicy.response_minutes?categoryPolicy:urgencyPolicy);
}

export async function ensureSevereEscalationSchema(pool){
  await pool.query(`
    ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS urgency_indicator TEXT NOT NULL DEFAULT 'none';
    UPDATE incident_reports SET urgency_indicator='none'
      WHERE urgency_indicator IS NULL OR urgency_indicator NOT IN (
        'none','immediate_danger','child_or_vulnerable_person','credible_threat_stalking_or_doxxing',
        'account_takeover_or_identity_theft','payment_fraud_or_money_mule','severe_illegal_or_exploitative_content'
      );
    DO $incident_urgency_constraint$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid='incident_reports'::regclass AND conname='incident_reports_urgency_indicator_check'
      ) THEN
        ALTER TABLE incident_reports ADD CONSTRAINT incident_reports_urgency_indicator_check CHECK(
          urgency_indicator IN (
            'none','immediate_danger','child_or_vulnerable_person','credible_threat_stalking_or_doxxing',
            'account_takeover_or_identity_theft','payment_fraud_or_money_mule','severe_illegal_or_exploitative_content'
          )
        );
      END IF;
    END
    $incident_urgency_constraint$;

    CREATE TABLE IF NOT EXISTS trust_case_escalations (
      id BIGSERIAL PRIMARY KEY,
      case_id BIGINT NOT NULL REFERENCES trust_cases(id) ON DELETE RESTRICT,
      source_incident_id BIGINT NOT NULL UNIQUE REFERENCES incident_reports(id) ON DELETE RESTRICT,
      dedupe_key TEXT NOT NULL UNIQUE,
      policy_version TEXT NOT NULL,
      trigger_source TEXT NOT NULL,
      trigger_code TEXT NOT NULL,
      route_code TEXT NOT NULL,
      severity TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending_acknowledgement',
      response_due_at TIMESTAMPTZ NOT NULL,
      country_scoped BOOLEAN NOT NULL DEFAULT FALSE,
      legal_review_required BOOLEAN NOT NULL DEFAULT FALSE,
      evidence_preservation_required BOOLEAN NOT NULL DEFAULT TRUE,
      external_reporting_state TEXT NOT NULL DEFAULT 'not_determined',
      created_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      acknowledged_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      acknowledged_at TIMESTAMPTZ,
      acknowledgement_rationale TEXT NOT NULL DEFAULT '',
      resolved_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      resolved_at TIMESTAMPTZ,
      resolution_rationale TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(severity IN ('high','critical')),
      CHECK(state IN ('pending_acknowledgement','acknowledged','resolved')),
      CHECK(external_reporting_state='not_determined'),
      CHECK(state='pending_acknowledgement' OR acknowledged_at IS NOT NULL),
      CHECK(state<>'resolved' OR resolved_at IS NOT NULL)
    );
    CREATE INDEX IF NOT EXISTS trust_case_escalations_active_idx
      ON trust_case_escalations(state,response_due_at,severity,case_id);
    CREATE INDEX IF NOT EXISTS trust_case_escalations_case_idx
      ON trust_case_escalations(case_id,created_at,id);

    INSERT INTO trust_case_escalations(
      case_id,source_incident_id,dedupe_key,policy_version,trigger_source,trigger_code,route_code,severity,
      state,response_due_at,country_scoped,legal_review_required,evidence_preservation_required,
      external_reporting_state,created_by_account_id,created_at,updated_at
    )
    SELECT i.trust_case_id,i.id,'incident:'||i.id||':severe-escalation','ph-severe-escalation-v1',
      'legacy_incident_status','legacy_escalated_status','trust_safety_priority','high',
      'pending_acknowledgement',i.updated_at+INTERVAL '4 hours',FALSE,FALSE,TRUE,'not_determined',
      i.reporter_account_id,i.updated_at,i.updated_at
    FROM incident_reports i JOIN trust_cases c ON c.id=i.trust_case_id
    WHERE i.status='escalated' AND c.status NOT IN ('resolved','dismissed','linked')
    ON CONFLICT(source_incident_id) DO NOTHING;
  `);
}

export async function createIncidentSevereEscalation(db,{
  caseId,incidentId,category='',urgencyIndicator='none',sourceSignal='',actorAccountId=null
}){
  const policy=severeIncidentEscalationPolicy({category,urgencyIndicator,sourceSignal});
  if(!policy)return null;
  const cid=positiveId(caseId,'Trust & Safety case'),iid=positiveId(incidentId,'Incident');
  const actor=actorAccountId==null?null:positiveId(actorAccountId,'Actor');
  const q=await db.query(`
    INSERT INTO trust_case_escalations(
      case_id,source_incident_id,dedupe_key,policy_version,trigger_source,trigger_code,route_code,severity,
      response_due_at,country_scoped,legal_review_required,evidence_preservation_required,
      external_reporting_state,created_by_account_id
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW()+($9::int*INTERVAL '1 minute'),$10,$11,$12,'not_determined',$13)
    ON CONFLICT(source_incident_id) DO UPDATE SET case_id=EXCLUDED.case_id,updated_at=NOW()
    RETURNING *
  `,[cid,iid,`incident:${iid}:severe-escalation`,policy.policy_version,policy.trigger_source,policy.trigger_code,policy.route_code,policy.severity,policy.response_minutes,policy.country_scoped,policy.legal_review_required,policy.evidence_preservation_required,actor]);
  await db.query(`
    UPDATE trust_cases SET
      severity=CASE WHEN severity='critical' OR $2='critical' THEN 'critical' ELSE 'high' END,
      territory_id=CASE WHEN $3 THEN NULL ELSE territory_id END,
      last_event_at=NOW(),updated_at=NOW()
    WHERE id=$1
  `,[cid,policy.severity,policy.country_scoped]);
  return{record:q.rows[0]||null,policy};
}

export async function assertSevereCaseTransitionAllowed(db,{caseId,status,severity}){
  const cid=positiveId(caseId,'Trust & Safety case');
  const q=await db.query(`
    SELECT severity,state FROM trust_case_escalations
    WHERE case_id=$1 AND state<>'resolved'
    ORDER BY CASE severity WHEN 'critical' THEN 0 ELSE 1 END,response_due_at,id
  `,[cid]);
  if(!q.rowCount)return;
  if(['resolved','dismissed','linked'].includes(String(status)))throw Object.assign(new Error('Resolve every active severe escalation before closing or linking this case'),{status:409,code:'ACTIVE_SEVERE_ESCALATION'});
  const floor=q.rows.some(x=>x.severity==='critical')?'critical':'high';
  if(severityRank(severity)<severityRank(floor))throw Object.assign(new Error(`Case severity cannot be lower than its active ${floor} escalation`),{status:409,code:'ACTIVE_SEVERE_ESCALATION'});
}

export async function assertSevereIncidentCanClose(db,incidentId){
  const iid=positiveId(incidentId,'Incident');
  const q=await db.query(`SELECT 1 FROM trust_case_escalations WHERE source_incident_id=$1 AND state<>'resolved' LIMIT 1`,[iid]);
  if(q.rowCount)throw Object.assign(new Error('Resolve the active severe escalation before closing this Incident'),{status:409,code:'ACTIVE_SEVERE_ESCALATION'});
}

async function lockedEscalation(db,caseId,escalationId){
  const cid=positiveId(caseId,'Trust & Safety case'),eid=positiveId(escalationId,'Escalation');
  const q=await db.query(`
    SELECT e.*,c.status case_status,c.severity case_severity,c.assigned_admin_account_id
    FROM trust_case_escalations e JOIN trust_cases c ON c.id=e.case_id
    WHERE e.id=$1 AND e.case_id=$2 FOR UPDATE OF e,c
  `,[eid,cid]);
  if(!q.rowCount)throw Object.assign(new Error('Severe escalation not found'),{status:404});
  return q.rows[0];
}

export async function acknowledgeSevereEscalation(db,{caseId,escalationId,actorAccountId,rationale}){
  const actor=positiveId(actorAccountId,'Actor'),note=clean(rationale,3000);
  if(note.length<5)throw Object.assign(new Error('A clear acknowledgement rationale is required'),{status:400});
  const before=await lockedEscalation(db,caseId,escalationId);
  if(before.state!=='pending_acknowledgement')throw Object.assign(new Error('Only a pending severe escalation can be acknowledged'),{status:409});
  const q=await db.query(`
    UPDATE trust_case_escalations SET state='acknowledged',acknowledged_by_account_id=$1,
      acknowledged_at=NOW(),acknowledgement_rationale=$2,updated_at=NOW()
    WHERE id=$3 RETURNING *
  `,[actor,note,positiveId(escalationId,'Escalation')]);
  const c=await db.query(`
    UPDATE trust_cases SET status=CASE WHEN status='open' THEN 'investigating' ELSE status END,
      assigned_admin_account_id=COALESCE(assigned_admin_account_id,$1),last_event_at=NOW(),updated_at=NOW()
    WHERE id=$2 RETURNING *
  `,[actor,positiveId(caseId,'Trust & Safety case')]);
  return{before,escalation:q.rows[0],case:c.rows[0]};
}

export async function resolveSevereEscalation(db,{caseId,escalationId,actorAccountId,rationale}){
  const actor=positiveId(actorAccountId,'Actor'),note=clean(rationale,3000);
  if(note.length<5)throw Object.assign(new Error('A clear resolution rationale is required'),{status:400});
  const before=await lockedEscalation(db,caseId,escalationId);
  if(before.state!=='acknowledged')throw Object.assign(new Error('A severe escalation must be acknowledged before it can be resolved'),{status:409});
  const q=await db.query(`
    UPDATE trust_case_escalations SET state='resolved',resolved_by_account_id=$1,
      resolved_at=NOW(),resolution_rationale=$2,updated_at=NOW()
    WHERE id=$3 RETURNING *
  `,[actor,note,positiveId(escalationId,'Escalation')]);
  await db.query(`UPDATE trust_cases SET last_event_at=NOW(),updated_at=NOW() WHERE id=$1`,[positiveId(caseId,'Trust & Safety case')]);
  return{before,escalation:q.rows[0]};
}
