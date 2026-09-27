const CASE_STATUSES=Object.freeze(['open','triaged','investigating','awaiting_information','monitoring','resolved','dismissed','linked']);
const CASE_SEVERITIES=Object.freeze(['low','moderate','high','critical']);
const CONFIDENCE_CLASSES=Object.freeze(['allegation','system_signal','corroborated','verified']);
const CASE_TITLES=Object.freeze({
  vulnerable_person_safety:'Vulnerable-person safety report',
  personal_safety:'Personal safety report',
  payment_abuse:'Payment abuse report',
  fraud_or_identity:'Fraud or identity report',
  prohibited_commerce:'Prohibited commerce report',
  privacy_safety:'Privacy safety report',
  user_report:'Incident report'
});
const FORBIDDEN_DETAIL_KEY=/(?:^|_)(?:email|phone|address|latitude|longitude|lat|lng|ip|user_agent|token|secret|password|payment_destination|evidence|data_url|request_body)(?:_|$)/i;
const EMAIL_VALUE=/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/;
const IPV4_VALUE=/\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const IPV6_VALUE=/\b(?:[a-f0-9]{1,4}:){2,}[a-f0-9:]{1,}\b/i;
const PHONE_VALUE=/\+?\d[\d\s().-]{7,}\d/;
const DATA_URL_VALUE=/^data:/i;

const clean=(value,max=300)=>String(value??'').trim().slice(0,max);
const code=(value,max=80)=>clean(value,max).toLowerCase().replace(/[^a-z0-9_.:-]+/g,'_').replace(/^_+|_+$/g,'');
const positiveId=value=>{
  const id=Number(value);
  if(!Number.isInteger(id)||id<1)throw Object.assign(new Error('Trust & Safety record ID is invalid'),{status:400});
  return id;
};

export function trustCaseStatuses(){return[...CASE_STATUSES]}
export function trustCaseSeverities(){return[...CASE_SEVERITIES]}
export function trustCaseStatus(value){
  const status=code(value,40);
  if(!CASE_STATUSES.includes(status))throw Object.assign(new Error('Unknown Trust & Safety case status'),{status:400});
  return status;
}
export function trustCaseSeverity(value){
  const severity=code(value,30);
  if(!CASE_SEVERITIES.includes(severity))throw Object.assign(new Error('Unknown Trust & Safety case severity'),{status:400});
  return severity;
}
export function trustConfidenceClass(value){
  const confidence=code(value,40);
  if(!CONFIDENCE_CLASSES.includes(confidence))throw Object.assign(new Error('Unknown Trust & Safety confidence class'),{status:400});
  return confidence;
}
export function privacySafeRiskDetails(input={}){
  if(input==null)return{};
  if(typeof input!=='object'||Array.isArray(input))throw Object.assign(new Error('Risk event details must be an object'),{status:400});
  const output={};
  for(const[key,value]of Object.entries(input).slice(0,20)){
    const safeKey=code(key,60);
    if(!safeKey||FORBIDDEN_DETAIL_KEY.test(safeKey))throw Object.assign(new Error('Risk event details contain a prohibited sensitive field'),{status:400});
    if(value==null||typeof value==='boolean')output[safeKey]=value;
    else if(typeof value==='number'&&Number.isFinite(value))output[safeKey]=value;
    else if(typeof value==='string'){
      const safeValue=clean(value,180);
      if(EMAIL_VALUE.test(safeValue)||IPV4_VALUE.test(safeValue)||IPV6_VALUE.test(safeValue)||PHONE_VALUE.test(safeValue)||DATA_URL_VALUE.test(safeValue))throw Object.assign(new Error('Risk event details contain a prohibited sensitive value'),{status:400});
      output[safeKey]=safeValue;
    }else throw Object.assign(new Error('Risk event details support scalar values only'),{status:400});
  }
  return output;
}

export function incidentCaseType(category=''){
  const value=clean(category,120).toLowerCase();
  if(/minor|child|vulnerable|exploit/.test(value))return'vulnerable_person_safety';
  if(/harass|threat|stalk|dox|blackmail|extort|safety/.test(value))return'personal_safety';
  if(/payment|refund|chargeback|payout/.test(value))return'payment_abuse';
  if(/identity|account takeover|imperson|fraud|scam|mule/.test(value))return'fraud_or_identity';
  if(/illegal|prohibited|counterfeit|stolen|product|listing/.test(value))return'prohibited_commerce';
  if(/privacy|address|location/.test(value))return'privacy_safety';
  return'user_report';
}
export function trustCaseTitle(caseType){return CASE_TITLES[caseType]||CASE_TITLES.user_report}

export async function ensureTrustSafetyCaseSchema(pool){
  await pool.query(`
    ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS territory_id BIGINT;

    CREATE TABLE IF NOT EXISTS trust_cases (
      id BIGSERIAL PRIMARY KEY,
      public_id TEXT NOT NULL UNIQUE,
      case_type TEXT NOT NULL DEFAULT 'user_report',
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      severity TEXT NOT NULL DEFAULT 'moderate',
      country_code TEXT NOT NULL DEFAULT 'PH',
      territory_id BIGINT,
      source_incident_id BIGINT UNIQUE REFERENCES incident_reports(id) ON DELETE SET NULL,
      assigned_admin_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      created_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      resolution_summary TEXT NOT NULL DEFAULT '',
      merged_into_case_id BIGINT REFERENCES trust_cases(id) ON DELETE SET NULL,
      last_event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ,
      CHECK(status IN ('open','triaged','investigating','awaiting_information','monitoring','resolved','dismissed','linked')),
      CHECK(severity IN ('low','moderate','high','critical')),
      CHECK(status<>'linked' OR merged_into_case_id IS NOT NULL)
    );
    CREATE INDEX IF NOT EXISTS trust_cases_queue_idx ON trust_cases(country_code,territory_id,status,severity,last_event_at DESC);
    CREATE INDEX IF NOT EXISTS trust_cases_assignee_idx ON trust_cases(assigned_admin_account_id,status,updated_at DESC);

    ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS trust_case_id BIGINT REFERENCES trust_cases(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS incident_reports_trust_case_idx ON incident_reports(trust_case_id,updated_at DESC);

    CREATE TABLE IF NOT EXISTS trust_case_entities (
      id BIGSERIAL PRIMARY KEY,
      case_id BIGINT NOT NULL REFERENCES trust_cases(id) ON DELETE RESTRICT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      relation_type TEXT NOT NULL DEFAULT 'subject',
      added_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(case_id,entity_type,entity_id,relation_type)
    );
    CREATE INDEX IF NOT EXISTS trust_case_entities_lookup_idx ON trust_case_entities(entity_type,entity_id,case_id);

    CREATE TABLE IF NOT EXISTS trust_risk_events (
      id BIGSERIAL PRIMARY KEY,
      case_id BIGINT REFERENCES trust_cases(id) ON DELETE SET NULL,
      dedupe_key TEXT NOT NULL UNIQUE,
      event_code TEXT NOT NULL,
      subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      source_surface TEXT NOT NULL,
      severity TEXT NOT NULL,
      confidence_class TEXT NOT NULL,
      country_code TEXT NOT NULL DEFAULT 'PH',
      territory_id BIGINT,
      related_object_type TEXT NOT NULL DEFAULT '',
      related_object_id TEXT NOT NULL DEFAULT '',
      correlation_id TEXT NOT NULL DEFAULT '',
      automated BOOLEAN NOT NULL DEFAULT FALSE,
      signal_details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(severity IN ('low','moderate','high','critical')),
      CHECK(confidence_class IN ('allegation','system_signal','corroborated','verified'))
    );
    CREATE INDEX IF NOT EXISTS trust_risk_events_case_idx ON trust_risk_events(case_id,created_at,id);
    CREATE INDEX IF NOT EXISTS trust_risk_events_subject_idx ON trust_risk_events(subject_type,subject_id,created_at DESC);

    CREATE TABLE IF NOT EXISTS trust_actions (
      id BIGSERIAL PRIMARY KEY,
      case_id BIGINT NOT NULL REFERENCES trust_cases(id) ON DELETE RESTRICT,
      actor_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      action_code TEXT NOT NULL,
      reason_category TEXT NOT NULL,
      rationale TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT,
      from_severity TEXT,
      to_severity TEXT,
      before_json JSONB,
      after_json JSONB,
      human_reviewed BOOLEAN NOT NULL DEFAULT FALSE,
      correlation_id TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS trust_actions_case_idx ON trust_actions(case_id,created_at,id);

    DO $trust_safety_territory_fks$
    BEGIN
      IF to_regclass('public.territories') IS NOT NULL THEN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid='incident_reports'::regclass AND conname='incident_reports_territory_id_fkey'
        ) THEN
          EXECUTE 'ALTER TABLE incident_reports ADD CONSTRAINT incident_reports_territory_id_fkey FOREIGN KEY(territory_id) REFERENCES territories(id) ON DELETE SET NULL';
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid='trust_cases'::regclass AND conname='trust_cases_territory_id_fkey'
        ) THEN
          EXECUTE 'ALTER TABLE trust_cases ADD CONSTRAINT trust_cases_territory_id_fkey FOREIGN KEY(territory_id) REFERENCES territories(id) ON DELETE SET NULL';
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid='trust_risk_events'::regclass AND conname='trust_risk_events_territory_id_fkey'
        ) THEN
          EXECUTE 'ALTER TABLE trust_risk_events ADD CONSTRAINT trust_risk_events_territory_id_fkey FOREIGN KEY(territory_id) REFERENCES territories(id) ON DELETE SET NULL';
        END IF;
      END IF;
    END
    $trust_safety_territory_fks$;

    INSERT INTO trust_cases(
      public_id,case_type,title,status,severity,country_code,territory_id,source_incident_id,
      created_by_account_id,last_event_at,created_at,updated_at,closed_at
    )
    SELECT 'TSC-I'||i.id,'user_report','Incident report',
      CASE i.status WHEN 'triaged' THEN 'triaged' WHEN 'investigating' THEN 'investigating'
        WHEN 'awaiting_information' THEN 'awaiting_information' WHEN 'resolved' THEN 'resolved'
        WHEN 'dismissed' THEN 'dismissed' WHEN 'escalated' THEN 'investigating' ELSE 'open' END,
      CASE WHEN i.status='escalated' THEN 'high' ELSE 'moderate' END,
      'PH',i.territory_id,i.id,i.reporter_account_id,i.updated_at,i.submitted_at,i.updated_at,
      CASE WHEN i.status IN ('resolved','dismissed') THEN COALESCE(i.resolved_at,i.updated_at) ELSE NULL END
    FROM incident_reports i
    ON CONFLICT(source_incident_id) DO NOTHING;

    UPDATE incident_reports i SET trust_case_id=c.id
      FROM trust_cases c WHERE c.source_incident_id=i.id AND i.trust_case_id IS NULL;
    UPDATE trust_cases c SET territory_id=i.territory_id
      FROM incident_reports i
      WHERE c.source_incident_id=i.id AND c.territory_id IS NULL AND i.territory_id IS NOT NULL;

    INSERT INTO trust_case_entities(case_id,entity_type,entity_id,relation_type,added_by_account_id)
      SELECT i.trust_case_id,'incident',i.id::text,'source',i.reporter_account_id
      FROM incident_reports i WHERE i.trust_case_id IS NOT NULL
      ON CONFLICT DO NOTHING;
    INSERT INTO trust_case_entities(case_id,entity_type,entity_id,relation_type,added_by_account_id)
      SELECT i.trust_case_id,'account',i.reporter_account_id::text,'reporter',i.reporter_account_id
      FROM incident_reports i WHERE i.trust_case_id IS NOT NULL
      ON CONFLICT DO NOTHING;
    INSERT INTO trust_case_entities(case_id,entity_type,entity_id,relation_type,added_by_account_id)
      SELECT i.trust_case_id,i.related_type,i.related_id::text,'reported_subject',i.reporter_account_id
      FROM incident_reports i WHERE i.trust_case_id IS NOT NULL AND i.related_id IS NOT NULL
      ON CONFLICT DO NOTHING;

    INSERT INTO trust_risk_events(
      case_id,dedupe_key,event_code,subject_type,subject_id,source_surface,severity,confidence_class,
      territory_id,related_object_type,related_object_id,automated,signal_details,created_by_account_id,created_at
    )
      SELECT i.trust_case_id,'incident:'||i.id||':submitted','incident_reported','incident',i.id::text,
        'incidents',CASE WHEN i.status='escalated' THEN 'high' ELSE 'moderate' END,'allegation',i.territory_id,
        i.related_type,COALESCE(i.related_id::text,''),FALSE,'{"report_status":"allegation"}'::jsonb,
        i.reporter_account_id,i.submitted_at
      FROM incident_reports i WHERE i.trust_case_id IS NOT NULL
      ON CONFLICT(dedupe_key) DO NOTHING;
  `);
}

async function incidentRow(db,incidentId,lock=false){
  const q=await db.query(`SELECT * FROM incident_reports WHERE id=$1${lock?' FOR UPDATE':''}`,[positiveId(incidentId)]);
  if(!q.rowCount)throw Object.assign(new Error('Incident not found'),{status:404});
  return q.rows[0];
}

export async function addIncidentEntitiesToCase(db,{caseId,incident,actorAccountId=null}){
  const id=positiveId(caseId),actor=actorAccountId==null?null:positiveId(actorAccountId);
  const entities=[
    ['incident',String(positiveId(incident.id)),'source'],
    ['account',String(positiveId(incident.reporter_account_id)),'reporter']
  ];
  if(incident.related_id!=null)entities.push([code(incident.related_type,60)||'other',String(incident.related_id),'reported_subject']);
  for(const[entityType,entityId,relationType]of entities){
    await db.query(`INSERT INTO trust_case_entities(case_id,entity_type,entity_id,relation_type,added_by_account_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[id,entityType,clean(entityId,120),relationType,actor]);
  }
}

export async function recordTrustRiskEvent(db,{
  caseId=null,dedupeKey,eventCode,subjectType,subjectId,sourceSurface,severity='moderate',confidenceClass='system_signal',
  territoryId=null,relatedObjectType='',relatedObjectId='',correlationId='',automated=false,details={},createdByAccountId=null
}){
  const safeDetails=privacySafeRiskDetails(details),safeSeverity=trustCaseSeverity(severity),safeConfidence=trustConfidenceClass(confidenceClass);
  const q=await db.query(`
    INSERT INTO trust_risk_events(
      case_id,dedupe_key,event_code,subject_type,subject_id,source_surface,severity,confidence_class,
      territory_id,related_object_type,related_object_id,correlation_id,automated,signal_details,created_by_account_id
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15)
    ON CONFLICT(dedupe_key) DO NOTHING RETURNING *
  `,[caseId==null?null:positiveId(caseId),clean(dedupeKey,180),code(eventCode,80),code(subjectType,60),clean(subjectId,120),code(sourceSurface,80),safeSeverity,safeConfidence,territoryId==null?null:positiveId(territoryId),code(relatedObjectType,60),clean(relatedObjectId,120),clean(correlationId,120),Boolean(automated),JSON.stringify(safeDetails),createdByAccountId==null?null:positiveId(createdByAccountId)]);
  if(caseId!=null)await db.query(`UPDATE trust_cases SET last_event_at=NOW(),updated_at=NOW() WHERE id=$1`,[positiveId(caseId)]);
  return q.rows[0]||null;
}

export async function ensureIncidentTrustCase(db,{
  incidentId,actorAccountId=null,sourceSurface='incidents',severity='',correlationId=''
}){
  const incident=await incidentRow(db,incidentId,false),caseType=incidentCaseType(incident.category),caseSeverity=severity?trustCaseSeverity(severity):(incident.status==='escalated'?'high':'moderate');
  const q=await db.query(`
    INSERT INTO trust_cases(
      public_id,case_type,title,status,severity,territory_id,source_incident_id,created_by_account_id,last_event_at
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW())
    ON CONFLICT(source_incident_id) DO UPDATE SET
      territory_id=COALESCE(trust_cases.territory_id,EXCLUDED.territory_id),updated_at=NOW()
    RETURNING *
  `,[`TSC-I${incident.id}`,caseType,trustCaseTitle(caseType),incident.status==='escalated'?'investigating':'open',caseSeverity,incident.territory_id||null,incident.id,actorAccountId||incident.reporter_account_id]);
  const trustCase=q.rows[0];
  await db.query(`UPDATE incident_reports SET trust_case_id=$1 WHERE id=$2`,[trustCase.id,incident.id]);
  await addIncidentEntitiesToCase(db,{caseId:trustCase.id,incident,actorAccountId:actorAccountId||incident.reporter_account_id});
  await recordTrustRiskEvent(db,{
    caseId:trustCase.id,dedupeKey:`incident:${incident.id}:submitted`,eventCode:'incident_reported',subjectType:'incident',subjectId:String(incident.id),
    sourceSurface,severity:caseSeverity,confidenceClass:'allegation',territoryId:incident.territory_id||null,
    relatedObjectType:incident.related_type,relatedObjectId:incident.related_id==null?'':String(incident.related_id),correlationId,
    automated:false,details:{report_status:'allegation'},createdByAccountId:actorAccountId||incident.reporter_account_id
  });
  return trustCase;
}

export async function syncIncidentTrustCaseTerritory(db,incidentId,territoryId){
  const iid=positiveId(incidentId),tid=positiveId(territoryId);
  await db.query(`UPDATE incident_reports SET territory_id=$1 WHERE id=$2`,[tid,iid]);
  await db.query(`
    UPDATE trust_cases c SET
      territory_id=CASE WHEN EXISTS(
        SELECT 1 FROM trust_case_escalations e
        WHERE e.case_id=c.id AND e.country_scoped=TRUE AND e.state<>'resolved'
      ) THEN NULL ELSE COALESCE(c.territory_id,$1) END,
      updated_at=NOW()
    WHERE c.id=(SELECT trust_case_id FROM incident_reports WHERE id=$2)
  `,[tid,iid]);
}

export async function recordTrustAction(db,{
  caseId,actorAccountId,actionCode,reasonCategory,rationale,fromStatus=null,toStatus=null,
  fromSeverity=null,toSeverity=null,before=null,after=null,humanReviewed=false,correlationId=''
}){
  const note=clean(rationale,3000),reason=code(reasonCategory,80);
  if(!note||!reason)throw Object.assign(new Error('A reason category and rationale are required'),{status:400});
  const q=await db.query(`
    INSERT INTO trust_actions(
      case_id,actor_account_id,action_code,reason_category,rationale,from_status,to_status,
      from_severity,to_severity,before_json,after_json,human_reviewed,correlation_id
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13) RETURNING *
  `,[positiveId(caseId),actorAccountId==null?null:positiveId(actorAccountId),code(actionCode,80),reason,note,fromStatus,toStatus,fromSeverity,toSeverity,before==null?null:JSON.stringify(before),after==null?null:JSON.stringify(after),Boolean(humanReviewed),clean(correlationId,120)]);
  return q.rows[0];
}

export async function linkIncidentToTrustCase(db,{
  caseId,incidentId,actorAccountId,rationale,reasonCategory='linked_reports',correlationId=''
}){
  const targetId=positiveId(caseId),iid=positiveId(incidentId),actor=positiveId(actorAccountId);
  const targetQ=await db.query(`SELECT * FROM trust_cases WHERE id=$1 FOR UPDATE`,[targetId]);
  if(!targetQ.rowCount)throw Object.assign(new Error('Trust & Safety case not found'),{status:404});
  const target=targetQ.rows[0];
  if(['resolved','dismissed','linked'].includes(target.status))throw Object.assign(new Error('Reopen the target case before linking another incident'),{status:409});
  const incident=await incidentRow(db,iid,true),oldCaseId=incident.trust_case_id==null?null:Number(incident.trust_case_id);
  if(oldCaseId===targetId)return{case:target,incident,alreadyLinked:true,linkedCaseId:null};
  await db.query(`UPDATE incident_reports SET trust_case_id=$1,updated_at=NOW() WHERE id=$2`,[targetId,iid]);
  await db.query(`UPDATE trust_case_escalations SET case_id=$1,updated_at=NOW() WHERE source_incident_id=$2`,[targetId,iid]);
  const raised=await db.query(`
    UPDATE trust_cases c SET
      severity=CASE
        WHEN c.severity='critical' OR EXISTS(SELECT 1 FROM trust_case_escalations e WHERE e.case_id=c.id AND e.state<>'resolved' AND e.severity='critical') THEN 'critical'
        WHEN c.severity='high' OR EXISTS(SELECT 1 FROM trust_case_escalations e WHERE e.case_id=c.id AND e.state<>'resolved' AND e.severity='high') THEN 'high'
        ELSE c.severity END,
      territory_id=CASE WHEN EXISTS(SELECT 1 FROM trust_case_escalations e WHERE e.case_id=c.id AND e.state<>'resolved' AND e.country_scoped=TRUE) THEN NULL ELSE c.territory_id END,
      updated_at=NOW()
    WHERE c.id=$1 RETURNING c.*
  `,[targetId]);
  const raisedTarget=raised.rows[0]||target;
  await addIncidentEntitiesToCase(db,{caseId:targetId,incident,actorAccountId:actor});
  await recordTrustRiskEvent(db,{
    caseId:targetId,dedupeKey:`case:${targetId}:incident:${iid}:linked`,eventCode:'incident_linked',subjectType:'incident',subjectId:String(iid),
    sourceSurface:'admin_case_link',severity:raisedTarget.severity,confidenceClass:'allegation',territoryId:incident.territory_id||raisedTarget.territory_id||null,
    relatedObjectType:incident.related_type,relatedObjectId:incident.related_id==null?'':String(incident.related_id),correlationId,
    automated:false,details:{link_basis:'human_review'},createdByAccountId:actor
  });
  await recordTrustAction(db,{caseId:targetId,actorAccountId:actor,actionCode:'incident_linked',reasonCategory,rationale,fromStatus:target.status,toStatus:raisedTarget.status,fromSeverity:target.severity,toSeverity:raisedTarget.severity,before:{incident_case_id:oldCaseId},after:{incident_case_id:targetId,incident_id:iid},humanReviewed:true,correlationId});
  let linkedCaseId=null;
  if(oldCaseId&&oldCaseId!==targetId){
    const remaining=await db.query(`SELECT COUNT(*)::int n FROM incident_reports WHERE trust_case_id=$1`,[oldCaseId]);
    if(Number(remaining.rows[0]?.n||0)===0){
      const oldBefore=await db.query(`SELECT * FROM trust_cases WHERE id=$1 FOR UPDATE`,[oldCaseId]);
      const old=await db.query(`UPDATE trust_cases SET status='linked',merged_into_case_id=$1,closed_at=NOW(),updated_at=NOW() WHERE id=$2 AND status<>'linked' RETURNING *`,[targetId,oldCaseId]);
      if(old.rowCount){
        linkedCaseId=oldCaseId;
        await recordTrustAction(db,{caseId:oldCaseId,actorAccountId:actor,actionCode:'case_linked',reasonCategory,rationale,fromStatus:oldBefore.rows[0]?.status||null,toStatus:'linked',fromSeverity:oldBefore.rows[0]?.severity||old.rows[0].severity,toSeverity:old.rows[0].severity,before:{standalone_case:true},after:{merged_into_case_id:targetId},humanReviewed:true,correlationId});
      }
    }
  }
  if(target.territory_id==null||incident.territory_id==null||Number(target.territory_id)!==Number(incident.territory_id))await db.query(`UPDATE trust_cases SET territory_id=NULL,updated_at=NOW() WHERE id=$1`,[targetId]);
  const finalTarget=(await db.query(`SELECT * FROM trust_cases WHERE id=$1`,[targetId])).rows[0]||raisedTarget;
  return{case:finalTarget,incident,alreadyLinked:false,linkedCaseId};
}
