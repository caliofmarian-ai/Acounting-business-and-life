import crypto from 'node:crypto';

const RULES=Object.freeze({
  order_create:[{windowSeconds:300,maxAttempts:8},{windowSeconds:3600,maxAttempts:40},{windowSeconds:86400,maxAttempts:120}],
  order_cancel:[{windowSeconds:3600,maxAttempts:10},{windowSeconds:86400,maxAttempts:25}],
  service_job_create:[{windowSeconds:3600,maxAttempts:12},{windowSeconds:86400,maxAttempts:50}],
  service_job_cancel:[{windowSeconds:3600,maxAttempts:10},{windowSeconds:86400,maxAttempts:25}],
  service_exact_location_access:[{windowSeconds:60,maxAttempts:20},{windowSeconds:3600,maxAttempts:100},{windowSeconds:86400,maxAttempts:300}],
  refund_request:[{windowSeconds:3600,maxAttempts:6},{windowSeconds:86400,maxAttempts:20}],
  payout_destination_change:[{windowSeconds:3600,maxAttempts:6},{windowSeconds:86400,maxAttempts:15}],
  upload_private:[{windowSeconds:3600,maxAttempts:20},{windowSeconds:86400,maxAttempts:100}],
  upload_public:[{windowSeconds:3600,maxAttempts:30},{windowSeconds:86400,maxAttempts:150}],
  incident_submit:[{windowSeconds:3600,maxAttempts:12},{windowSeconds:86400,maxAttempts:40}],
  incident_note:[{windowSeconds:3600,maxAttempts:30},{windowSeconds:86400,maxAttempts:120}],
  review_submit:[{windowSeconds:3600,maxAttempts:10},{windowSeconds:86400,maxAttempts:30}],
  invitation_create:[{windowSeconds:3600,maxAttempts:20},{windowSeconds:86400,maxAttempts:80}],
  referral_event_account:[{windowSeconds:60,maxAttempts:120},{windowSeconds:86400,maxAttempts:1500}],
  referral_event_public:[{windowSeconds:60,maxAttempts:60},{windowSeconds:86400,maxAttempts:1000}],
  adult_eligibility_attestation:[{windowSeconds:3600,maxAttempts:5},{windowSeconds:86400,maxAttempts:12}],
  account_location_change:[{windowSeconds:3600,maxAttempts:10},{windowSeconds:86400,maxAttempts:30}],
  store_location_change:[{windowSeconds:3600,maxAttempts:10},{windowSeconds:86400,maxAttempts:30}],
  courier_location_update:[{windowSeconds:60,maxAttempts:120},{windowSeconds:3600,maxAttempts:1500}]
});

function positiveAccountId(value){
  if(value==null)return null;
  const id=Number(value);
  if(!Number.isInteger(id)||id<1)throw Object.assign(new Error('Velocity actor account is invalid'),{status:400});
  return id;
}
function safeCode(value,max=80){return String(value??'').trim().replace(/[^a-z0-9_.:-]/gi,'_').slice(0,max)}
function actorHash({actorAccountId,actorKey,secret}){
  if(actorAccountId!=null)return crypto.createHash('sha256').update(`account:${actorAccountId}`).digest('hex');
  const raw=String(actorKey||'').trim();
  if(!raw)throw Object.assign(new Error('Velocity actor is required'),{status:400});
  const key=String(secret||process.env.VELOCITY_HASH_SECRET||process.env.TOKEN_SECRET||'');
  if(!key&&process.env.NODE_ENV==='production')throw Object.assign(new Error('Public abuse-control hashing is not configured'),{status:503});
  return crypto.createHmac('sha256',key||'business-life-local-velocity-v1').update(`public:${raw}`).digest('hex');
}

export function highRiskVelocityRules(actionCode){
  const code=safeCode(actionCode);
  const rules=RULES[code];
  if(!rules)throw Object.assign(new Error('Unknown high-risk velocity action'),{status:500,code:'UNKNOWN_VELOCITY_ACTION'});
  return rules.map(rule=>({...rule}));
}

export function highRiskVelocityErrorBody(error){
  const status=Number(error?.status)||500;
  const body={error:status<500?error.message:'Unexpected server error'};
  if(error?.code==='HIGH_RISK_VELOCITY_LIMIT'){
    body.code=error.code;
    body.retry_after_seconds=Math.max(1,Number(error.retryAfterSeconds)||1);
  }
  return body;
}

export async function ensureHighRiskVelocitySchema(pool){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS high_risk_velocity_buckets (
      actor_key_hash TEXT NOT NULL,
      actor_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      action_code TEXT NOT NULL,
      window_seconds INTEGER NOT NULL CHECK(window_seconds>0),
      window_started_at TIMESTAMPTZ NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
      denied_count INTEGER NOT NULL DEFAULT 0 CHECK(denied_count>=0),
      last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(actor_key_hash,action_code,window_seconds,window_started_at)
    );
    CREATE INDEX IF NOT EXISTS high_risk_velocity_buckets_account_idx
      ON high_risk_velocity_buckets(actor_account_id,action_code,last_attempt_at DESC);

    CREATE TABLE IF NOT EXISTS high_risk_velocity_denials (
      id BIGSERIAL PRIMARY KEY,
      actor_key_hash TEXT NOT NULL,
      actor_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      action_code TEXT NOT NULL,
      subject_type TEXT NOT NULL DEFAULT '',
      subject_id TEXT NOT NULL DEFAULT '',
      limit_count INTEGER NOT NULL CHECK(limit_count>0),
      window_seconds INTEGER NOT NULL CHECK(window_seconds>0),
      retry_after_seconds INTEGER NOT NULL CHECK(retry_after_seconds>0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS high_risk_velocity_denials_account_idx
      ON high_risk_velocity_denials(actor_account_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS high_risk_velocity_denials_action_idx
      ON high_risk_velocity_denials(action_code,created_at DESC);

    DELETE FROM high_risk_velocity_buckets
      WHERE window_started_at < NOW()-INTERVAL '8 days';
  `);
}

export async function enforceHighRiskVelocity(pool,{
  actorAccountId=null,actorKey='',actionCode,subjectType='',subjectId='',secret=''
}={}){
  const accountId=positiveAccountId(actorAccountId);
  const code=safeCode(actionCode),rules=highRiskVelocityRules(code).sort((a,b)=>a.windowSeconds-b.windowSeconds);
  const hash=actorHash({actorAccountId:accountId,actorKey,secret});
  const safeSubjectType=safeCode(subjectType,60),safeSubjectId=safeCode(subjectId,120);
  const client=await pool.connect();
  let denial=null;
  try{
    await client.query('BEGIN');
    const counters=[];
    for(const rule of rules){
      const q=await client.query(`
        INSERT INTO high_risk_velocity_buckets(
          actor_key_hash,actor_account_id,action_code,window_seconds,window_started_at,attempt_count,last_attempt_at
        ) VALUES(
          $1,$2,$3,$4::integer,
          TO_TIMESTAMP(FLOOR(EXTRACT(EPOCH FROM clock_timestamp())/($4::integer))*($4::integer)),
          1,NOW()
        )
        ON CONFLICT(actor_key_hash,action_code,window_seconds,window_started_at)
        DO UPDATE SET
          actor_account_id=COALESCE(high_risk_velocity_buckets.actor_account_id,EXCLUDED.actor_account_id),
          attempt_count=high_risk_velocity_buckets.attempt_count+1,
          last_attempt_at=NOW()
        RETURNING attempt_count,window_started_at
      `,[hash,accountId,code,rule.windowSeconds]);
      counters.push({...rule,count:Number(q.rows[0].attempt_count),windowStartedAt:q.rows[0].window_started_at});
    }
    const exceeded=counters.filter(x=>x.count>x.maxAttempts).sort((a,b)=>a.windowSeconds-b.windowSeconds)[0];
    if(exceeded){
      const elapsed=Math.max(0,Math.floor((Date.now()-new Date(exceeded.windowStartedAt).getTime())/1000));
      const retryAfter=Math.max(1,exceeded.windowSeconds-elapsed);
      await client.query(`
        UPDATE high_risk_velocity_buckets
           SET denied_count=denied_count+1
         WHERE actor_key_hash=$1 AND action_code=$2 AND window_seconds=$3 AND window_started_at=$4
      `,[hash,code,exceeded.windowSeconds,exceeded.windowStartedAt]);
      await client.query(`
        INSERT INTO high_risk_velocity_denials(
          actor_key_hash,actor_account_id,action_code,subject_type,subject_id,
          limit_count,window_seconds,retry_after_seconds
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      `,[hash,accountId,code,safeSubjectType,safeSubjectId,exceeded.maxAttempts,exceeded.windowSeconds,retryAfter]);
      denial={retryAfter,maxAttempts:exceeded.maxAttempts,windowSeconds:exceeded.windowSeconds};
    }
    await client.query('COMMIT');
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{client.release()}
  if(denial){
    throw Object.assign(new Error('Too many recent attempts. Try again later.'),{
      status:429,code:'HIGH_RISK_VELOCITY_LIMIT',retryAfterSeconds:denial.retryAfter,
      limit:denial.maxAttempts,windowSeconds:denial.windowSeconds
    });
  }
  return{allowed:true,action_code:code};
}
