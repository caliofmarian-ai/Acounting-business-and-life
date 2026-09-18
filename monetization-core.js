const clean=(v,max=300)=>String(v??'').trim().slice(0,max);
const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;

export const PROMOTIONAL_DAYS=90;
export const MONETIZATION_SERVICE_SCOPES=Object.freeze(['marketplace','delivery','supplier','local_services']);
export const MONETIZATION_SUBJECT_TYPES=Object.freeze(['business','account']);

function validId(v,label){
  const n=Number(v);
  if(!Number.isInteger(n)||n<=0)throw Object.assign(new Error(label+' must be a positive integer'),{status:400});
  return n;
}
function validScope(v){
  const x=clean(v,40);
  if(!MONETIZATION_SERVICE_SCOPES.includes(x))throw Object.assign(new Error('Unsupported monetization service scope'),{status:400});
  return x;
}
function validSubjectType(v){
  const x=clean(v,30);
  if(!MONETIZATION_SUBJECT_TYPES.includes(x))throw Object.assign(new Error('Unsupported monetization subject type'),{status:400});
  return x;
}
function iso(v,label='completed_at'){
  const d=v instanceof Date?v:new Date(v||Date.now());
  if(Number.isNaN(d.getTime()))throw Object.assign(new Error(label+' must be a valid date/time'),{status:400});
  return d.toISOString();
}
function eventKey({serviceScope,subjectType,subjectId,sourceType,sourceId}){
  return [serviceScope,subjectType,String(subjectId),clean(sourceType,60),String(sourceId)].join(':');
}
function phaseAt(completedAt,promoEndsAt){
  return new Date(completedAt)<new Date(promoEndsAt)?'promotional':'post_promo';
}

export async function ensureMonetizationSchema(pool){
  const statements=[
    "CREATE TABLE IF NOT EXISTS service_monetization_entitlements(id BIGSERIAL PRIMARY KEY,country_code TEXT NOT NULL DEFAULT 'PH',service_scope TEXT NOT NULL,subject_type TEXT NOT NULL,subject_id BIGINT NOT NULL,territory_id BIGINT REFERENCES territories(id),promo_duration_days INTEGER NOT NULL DEFAULT 90,promo_started_at TIMESTAMPTZ NOT NULL,promo_ends_at TIMESTAMPTZ NOT NULL,first_event_type TEXT NOT NULL,first_event_id BIGINT NOT NULL,first_post_promo_completed_at TIMESTAMPTZ,first_post_promo_event_type TEXT NOT NULL DEFAULT '',first_post_promo_event_id BIGINT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(country_code,service_scope,subject_type,subject_id),CHECK(service_scope IN ('marketplace','delivery','supplier','local_services')),CHECK(subject_type IN ('business','account')),CHECK(promo_duration_days=90),CHECK(promo_ends_at>promo_started_at))",
    "CREATE INDEX IF NOT EXISTS service_monetization_entitlements_period_idx ON service_monetization_entitlements(country_code,service_scope,promo_started_at,promo_ends_at)",
    "CREATE INDEX IF NOT EXISTS service_monetization_entitlements_territory_idx ON service_monetization_entitlements(territory_id,service_scope,promo_ends_at)",
    "CREATE TABLE IF NOT EXISTS service_monetization_events(id BIGSERIAL PRIMARY KEY,event_key TEXT NOT NULL UNIQUE,entitlement_id BIGINT NOT NULL REFERENCES service_monetization_entitlements(id) ON DELETE RESTRICT,country_code TEXT NOT NULL DEFAULT 'PH',service_scope TEXT NOT NULL,subject_type TEXT NOT NULL,subject_id BIGINT NOT NULL,territory_id BIGINT REFERENCES territories(id),source_type TEXT NOT NULL,source_id BIGINT NOT NULL,completed_at TIMESTAMPTZ NOT NULL,phase_snapshot TEXT NOT NULL,gross_value NUMERIC(14,2) NOT NULL DEFAULT 0,currency_code TEXT NOT NULL DEFAULT 'PHP',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),CHECK(service_scope IN ('marketplace','delivery','supplier','local_services')),CHECK(subject_type IN ('business','account')),CHECK(phase_snapshot IN ('promotional','post_promo')),CHECK(gross_value>=0))",
    "CREATE INDEX IF NOT EXISTS service_monetization_events_period_idx ON service_monetization_events(country_code,service_scope,phase_snapshot,completed_at)",
    "CREATE INDEX IF NOT EXISTS service_monetization_events_subject_idx ON service_monetization_events(subject_type,subject_id,service_scope,completed_at)"
  ];
  for(const sql of statements)await pool.query(sql);
}

export async function recordMonetizableCompletion(db,input={}){
  const serviceScope=validScope(input.serviceScope);
  const subjectType=validSubjectType(input.subjectType);
  const subjectId=validId(input.subjectId,'subject_id');
  const sourceType=clean(input.sourceType,60);
  const sourceId=validId(input.sourceId,'source_id');
  if(!sourceType)throw Object.assign(new Error('source_type is required'),{status:400});
  const completedAt=iso(input.completedAt);
  const territoryId=input.territoryId==null?null:validId(input.territoryId,'territory_id');
  const grossValue=Math.max(0,money(input.grossValue||0));
  const currencyCode=clean(input.currencyCode||'PHP',10)||'PHP';
  const key=eventKey({serviceScope,subjectType,subjectId,sourceType,sourceId});

  const entitlement=await db.query(`
    INSERT INTO service_monetization_entitlements(
      country_code,service_scope,subject_type,subject_id,territory_id,promo_duration_days,
      promo_started_at,promo_ends_at,first_event_type,first_event_id
    ) VALUES('PH',$1,$2,$3,$4,$5,$6::timestamptz,$6::timestamptz+($5::text||' days')::interval,$7,$8)
    ON CONFLICT(country_code,service_scope,subject_type,subject_id) DO UPDATE SET
      territory_id=COALESCE(service_monetization_entitlements.territory_id,EXCLUDED.territory_id),
      promo_started_at=LEAST(service_monetization_entitlements.promo_started_at,EXCLUDED.promo_started_at),
      promo_ends_at=LEAST(service_monetization_entitlements.promo_started_at,EXCLUDED.promo_started_at)+INTERVAL '90 days',
      first_event_type=CASE WHEN EXCLUDED.promo_started_at<service_monetization_entitlements.promo_started_at THEN EXCLUDED.first_event_type ELSE service_monetization_entitlements.first_event_type END,
      first_event_id=CASE WHEN EXCLUDED.promo_started_at<service_monetization_entitlements.promo_started_at THEN EXCLUDED.first_event_id ELSE service_monetization_entitlements.first_event_id END,
      updated_at=NOW()
    RETURNING *
  `,[serviceScope,subjectType,subjectId,territoryId,PROMOTIONAL_DAYS,completedAt,sourceType,sourceId]);

  const e=entitlement.rows[0];
  const phase=phaseAt(completedAt,e.promo_ends_at);
  const event=await db.query(`
    INSERT INTO service_monetization_events(
      event_key,entitlement_id,country_code,service_scope,subject_type,subject_id,territory_id,
      source_type,source_id,completed_at,phase_snapshot,gross_value,currency_code
    ) VALUES($1,$2,'PH',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT(event_key) DO UPDATE SET event_key=service_monetization_events.event_key
    RETURNING *
  `,[key,e.id,serviceScope,subjectType,subjectId,territoryId,sourceType,sourceId,completedAt,phase,grossValue,currencyCode]);

  if(phase==='post_promo'){
    await db.query(`
      UPDATE service_monetization_entitlements SET
        first_post_promo_completed_at=CASE
          WHEN first_post_promo_completed_at IS NULL OR $1::timestamptz<first_post_promo_completed_at THEN $1::timestamptz
          ELSE first_post_promo_completed_at END,
        first_post_promo_event_type=CASE
          WHEN first_post_promo_completed_at IS NULL OR $1::timestamptz<first_post_promo_completed_at THEN $2
          ELSE first_post_promo_event_type END,
        first_post_promo_event_id=CASE
          WHEN first_post_promo_completed_at IS NULL OR $1::timestamptz<first_post_promo_completed_at THEN $3
          ELSE first_post_promo_event_id END,
        updated_at=NOW()
      WHERE id=$4
    `,[completedAt,sourceType,sourceId,e.id]);
  }
  return{entitlement:e,event:event.rows[0],phase};
}

export async function monetizationStatus(pool,{serviceScope,subjectType,subjectId,at=new Date()}={}){
  const scope=validScope(serviceScope),type=validSubjectType(subjectType),id=validId(subjectId,'subject_id');
  const q=await pool.query("SELECT * FROM service_monetization_entitlements WHERE country_code='PH' AND service_scope=$1 AND subject_type=$2 AND subject_id=$3",[scope,type,id]);
  if(!q.rowCount)return{service_scope:scope,subject_type:type,subject_id:id,state:'not_started',promo_days:PROMOTIONAL_DAYS};
  const row=q.rows[0],now=iso(at,'at');
  const state=new Date(now)<new Date(row.promo_ends_at)?'promotional':'post_promo';
  return{...row,state,promo_days:Number(row.promo_duration_days),days_remaining:state==='promotional'?Math.max(0,Math.ceil((new Date(row.promo_ends_at)-new Date(now))/86400000)):0};
}

async function historicalRows(pool){
  const queries=[
    {
      serviceScope:'marketplace',subjectType:'business',sourceType:'order',
      sql:`SELECT o.id source_id,o.business_id subject_id,b.territory_id,o.completed_at completed_at,o.subtotal gross_value,o.currency_code
           FROM orders o JOIN businesses b ON b.id=o.business_id
           LEFT JOIN service_monetization_events e ON e.event_key=('marketplace:business:'||o.business_id||':order:'||o.id)
           WHERE o.order_status='completed' AND o.completed_at IS NOT NULL AND e.id IS NULL
           ORDER BY o.completed_at,o.id LIMIT 5000`
    },
    {
      serviceScope:'delivery',subjectType:'account',sourceType:'delivery',
      sql:`SELECT d.id source_id,d.courier_account_id subject_id,b.territory_id,d.delivered_at completed_at,d.delivery_fee gross_value,d.currency_code
           FROM deliveries d JOIN businesses b ON b.id=d.business_id
           LEFT JOIN service_monetization_events e ON e.event_key=('delivery:account:'||d.courier_account_id||':delivery:'||d.id)
           WHERE d.status='delivered' AND d.delivered_at IS NOT NULL AND d.courier_account_id IS NOT NULL AND e.id IS NULL
           ORDER BY d.delivered_at,d.id LIMIT 5000`
    },
    {
      serviceScope:'supplier',subjectType:'account',sourceType:'purchase_order',
      sql:`SELECT p.id source_id,p.supplier_account_id subject_id,b.territory_id,p.received_at completed_at,p.actual_received_total gross_value,'PHP' currency_code
           FROM purchase_orders p JOIN businesses b ON b.id=p.business_id
           LEFT JOIN service_monetization_events e ON e.event_key=('supplier:account:'||p.supplier_account_id||':purchase_order:'||p.id)
           WHERE p.status='received' AND p.received_at IS NOT NULL AND e.id IS NULL
           ORDER BY p.received_at,p.id LIMIT 5000`
    },
    {
      serviceScope:'local_services',subjectType:'account',sourceType:'service_job',
      sql:`SELECT j.id source_id,j.provider_account_id subject_id,NULL::bigint territory_id,j.customer_confirmed_at completed_at,COALESCE(j.final_price,j.quote_amount,0) gross_value,j.currency_code
           FROM service_jobs j
           LEFT JOIN service_monetization_events e ON e.event_key=('local_services:account:'||j.provider_account_id||':service_job:'||j.id)
           WHERE j.status='completed' AND j.customer_confirmed_at IS NOT NULL AND e.id IS NULL
           ORDER BY j.customer_confirmed_at,j.id LIMIT 5000`
    }
  ];
  const out=[];
  for(const spec of queries){
    try{
      const q=await pool.query(spec.sql);
      for(const row of q.rows)out.push({...spec,...row,sql:undefined});
    }catch(e){
      if(e.code==='42P01'||e.code==='42703')continue;
      throw e;
    }
  }
  return out;
}

export async function backfillMonetizationHistory(pool){
  const rows=await historicalRows(pool);
  let created=0;
  for(const row of rows){
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await recordMonetizableCompletion(client,{
        serviceScope:row.serviceScope,subjectType:row.subjectType,subjectId:row.subject_id,
        sourceType:row.sourceType,sourceId:row.source_id,territoryId:row.territory_id,
        completedAt:row.completed_at,grossValue:row.gross_value,currencyCode:row.currency_code||'PHP'
      });
      await client.query('COMMIT');created++;
    }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
    finally{client.release()}
  }
  return{processed:rows.length,created};
}

export async function promotionKpi(pool,{from,to,territoryId=null}={}){
  const start=iso(from,'from'),end=iso(to,'to');
  const territory=territoryId==null?null:validId(territoryId,'territory_id');
  const ent=await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE promo_started_at<$2 AND promo_ends_at>$2)::int active_promotional_subjects,
      COUNT(*) FILTER (WHERE promo_started_at>=$1 AND promo_started_at<$2)::int trials_started,
      COUNT(*) FILTER (WHERE promo_ends_at>=$1 AND promo_ends_at<$2)::int trials_ending,
      COUNT(*) FILTER (WHERE promo_ends_at<=$2)::int expired_subjects,
      COUNT(*) FILTER (WHERE promo_ends_at<=$2 AND first_post_promo_completed_at IS NOT NULL)::int post_promo_active_subjects
    FROM service_monetization_entitlements
    WHERE country_code='PH' AND ($3::bigint IS NULL OR territory_id=$3 OR territory_id IS NULL)
  `,[start,end,territory]);
  const events=await pool.query(`
    SELECT service_scope,phase_snapshot,COUNT(*)::int completed_events,COUNT(DISTINCT entitlement_id)::int active_subjects,
      COALESCE(SUM(gross_value),0) gross_value
    FROM service_monetization_events
    WHERE country_code='PH' AND completed_at>=$1 AND completed_at<$2
      AND ($3::bigint IS NULL OR territory_id=$3 OR territory_id IS NULL)
    GROUP BY service_scope,phase_snapshot ORDER BY service_scope,phase_snapshot
  `,[start,end,territory]);
  const totals=await pool.query(`
    SELECT phase_snapshot,COUNT(*)::int completed_events,COUNT(DISTINCT entitlement_id)::int active_subjects,COALESCE(SUM(gross_value),0) gross_value
    FROM service_monetization_events
    WHERE country_code='PH' AND completed_at>=$1 AND completed_at<$2
      AND ($3::bigint IS NULL OR territory_id=$3 OR territory_id IS NULL)
    GROUP BY phase_snapshot
  `,[start,end,territory]);
  const x=ent.rows[0]||{};
  const expired=Number(x.expired_subjects||0),post=Number(x.post_promo_active_subjects||0);
  return{
    promotional_days:PROMOTIONAL_DAYS,
    active_promotional_subjects:Number(x.active_promotional_subjects||0),
    trials_started:Number(x.trials_started||0),
    trials_ending:Number(x.trials_ending||0),
    expired_subjects:expired,
    post_promo_active_subjects:post,
    post_promo_activity_conversion_pct:expired>0?Math.round((post/expired)*10000)/100:null,
    paid_conversion_status:'NOT_AVAILABLE_UNTIL_ACTIVE_FEE_POLICY',
    totals:totals.rows.map(r=>({phase:r.phase_snapshot,completed_events:Number(r.completed_events),active_subjects:Number(r.active_subjects),gross_value:money(r.gross_value)})),
    services:events.rows.map(r=>({service_scope:r.service_scope,phase:r.phase_snapshot,completed_events:Number(r.completed_events),active_subjects:Number(r.active_subjects),gross_value:money(r.gross_value)}))
  };
}

export const monetizationInternals=Object.freeze({eventKey,phaseAt});
