import crypto from 'node:crypto';

export const ADMIN_PERMISSIONS = Object.freeze([
  'admin.console',
  'admin.assign_limited',
  'admin.delegate',
  'territory.manage',
  'profiles.invite_merchant',
  'profiles.invite_supplier',
  'profiles.invite_courier',
  'merchant.approve',
  'supplier.approve',
  'courier.verify',
  'delivery.dispatch.manage',
  'delivery.pricing.manage',
  'profiles.review_service_provider',
  'credential.verify',
  'profile.suspend',
  'incident.triage',
  'support.manage',
  'finance.summary.view',
  'finance.cost.manage',
  'finance.ledger.view',
  'finance.ledger.manage',
  'finance.budget.manage',
  'finance.owner_distribution.manage',
  'accounting.export.view',
  'audit.view',
  'metrics.view',
  'legal.view',
  'legal.manage',
  'payment.view',
  'payment.manage',
  'payment.reconcile',
  'settlement.manage',
  'fee_policy.manage_limited'
]);

const clean=(v,max=300)=>String(v??'').trim().slice(0,max);
const safeEqual=(a,b)=>{
  try{
    const sa=String(a),sb=String(b);
    if(!/^[0-9a-f]{64}$/i.test(sa)||!/^[0-9a-f]{64}$/i.test(sb))return false;
    const aa=Buffer.from(sa,'hex'),bb=Buffer.from(sb,'hex');
    return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb);
  }catch{return false}
};

export async function ensureAdminSchema(pool){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_admin_assignments (
      id BIGSERIAL PRIMARY KEY,
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      admin_role TEXT NOT NULL,
      country_code TEXT NOT NULL DEFAULT 'PH',
      territory_id BIGINT REFERENCES territories(id) ON DELETE RESTRICT,
      status TEXT NOT NULL DEFAULT 'active',
      assigned_by_account_id BIGINT REFERENCES accounts(id),
      effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      effective_until TIMESTAMPTZ,
      reason TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(admin_role IN ('super_admin','country_admin','territory_admin')),
      CHECK(status IN ('active','suspended','revoked','expired'))
    );
    ALTER TABLE platform_admin_assignments ADD COLUMN IF NOT EXISTS authority_rank TEXT NOT NULL DEFAULT '';
    UPDATE platform_admin_assignments SET authority_rank=admin_role WHERE authority_rank='';

    CREATE UNIQUE INDEX IF NOT EXISTS platform_admin_assignment_scope_unique
      ON platform_admin_assignments(account_id,admin_role,country_code,COALESCE(territory_id,0));

    CREATE TABLE IF NOT EXISTS admin_permission_grants (
      assignment_id BIGINT NOT NULL REFERENCES platform_admin_assignments(id) ON DELETE CASCADE,
      permission_code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      granted_by_account_id BIGINT REFERENCES accounts(id),
      effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      effective_until TIMESTAMPTZ,
      reason TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(assignment_id,permission_code),
      CHECK(status IN ('active','revoked','expired'))
    );

    CREATE TABLE IF NOT EXISTS admin_function_assignments (
      assignment_id BIGINT NOT NULL REFERENCES platform_admin_assignments(id) ON DELETE CASCADE,
      function_code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      granted_by_account_id BIGINT REFERENCES accounts(id),
      effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      effective_until TIMESTAMPTZ,
      reason TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(assignment_id,function_code),
      CHECK(status IN ('active','revoked','expired'))
    );
    CREATE INDEX IF NOT EXISTS admin_function_assignments_code_idx ON admin_function_assignments(function_code,status,assignment_id);

    CREATE TABLE IF NOT EXISTS admin_audit_events (
      id BIGSERIAL PRIMARY KEY,
      actor_account_id BIGINT REFERENCES accounts(id),
      assignment_id BIGINT REFERENCES platform_admin_assignments(id),
      permission_code TEXT NOT NULL DEFAULT '',
      country_code TEXT NOT NULL DEFAULT 'PH',
      territory_id BIGINT REFERENCES territories(id),
      target_type TEXT NOT NULL DEFAULT '',
      target_id TEXT NOT NULL DEFAULT '',
      event_code TEXT NOT NULL,
      before_json JSONB,
      after_json JSONB,
      reason TEXT NOT NULL DEFAULT '',
      correlation_id TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS admin_audit_events_scope_idx ON admin_audit_events(country_code,territory_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS admin_audit_events_actor_idx ON admin_audit_events(actor_account_id,created_at DESC);

    INSERT INTO platform_admin_assignments(account_id,admin_role,authority_rank,country_code,territory_id,status,assigned_by_account_id,reason)
    VALUES(1,'super_admin','super_admin','PH',NULL,'active',1,'Bootstrap Platform Owner / Super Admin')
    ON CONFLICT(account_id,admin_role,country_code,COALESCE(territory_id,0))
    DO UPDATE SET status='active',effective_until=NULL,updated_at=NOW();
  `);
}

export function signAdminAssertion(secret,{accountId,permission,territoryId=null,assignmentId=null}){
  if(!secret) throw new Error('TOKEN_SECRET is required for admin assertions');
  const payload={
    v:1,
    ts:Date.now(),
    accountId:Number(accountId),
    permission:clean(permission,100),
    territoryId:territoryId==null?null:Number(territoryId),
    assignmentId:assignmentId==null?null:Number(assignmentId)
  };
  const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig=crypto.createHmac('sha256',secret).update(encoded).digest('hex');
  return encoded+'.'+sig;
}

export function verifyAdminAssertion(secret,token,accountId){
  if(!secret||!token) return null;
  const [encoded,sig,...rest]=String(token).split('.');
  if(!encoded||!sig||rest.length) return null;
  const expected=crypto.createHmac('sha256',secret).update(encoded).digest('hex');
  if(!safeEqual(sig,expected)) return null;
  let payload;
  try{payload=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'))}catch{return null}
  if(payload?.v!==1) return null;
  if(accountId!=null&&Number(payload.accountId)!==Number(accountId)) return null;
  if(!Number.isFinite(Number(payload.ts))||Math.abs(Date.now()-Number(payload.ts))>90_000) return null;
  return payload;
}

export async function getAdminAssignments(pool,accountId){
  const {rows}=await pool.query(`
    SELECT a.*,COALESCE(NULLIF(a.authority_rank,''),a.admin_role) effective_rank,
      t.name territory_name,t.parent_id territory_parent_id,
      COALESCE((
        SELECT jsonb_agg(g.permission_code ORDER BY g.permission_code)
        FROM admin_permission_grants g
        WHERE g.assignment_id=a.id AND g.status='active'
          AND g.effective_from<=NOW()
          AND (g.effective_until IS NULL OR g.effective_until>NOW())
      ),'[]'::jsonb) permissions,
      COALESCE((
        SELECT jsonb_agg(f.function_code ORDER BY f.function_code)
        FROM admin_function_assignments f
        WHERE f.assignment_id=a.id AND f.status='active'
          AND f.effective_from<=NOW()
          AND (f.effective_until IS NULL OR f.effective_until>NOW())
      ),'[]'::jsonb) functions
    FROM platform_admin_assignments a
    LEFT JOIN territories t ON t.id=a.territory_id
    WHERE a.account_id=$1
      AND a.status='active'
      AND a.effective_from<=NOW()
      AND (a.effective_until IS NULL OR a.effective_until>NOW())
    ORDER BY CASE COALESCE(NULLIF(a.authority_rank,''),a.admin_role) WHEN 'super_admin' THEN 0 WHEN 'country_admin' THEN 1 WHEN 'territory_admin' THEN 2 ELSE 3 END,a.id
  `,[accountId]);
  return rows;
}

async function territoryWithin(pool,rootId,targetId){
  if(rootId==null) return true;
  if(targetId==null) return false;
  if(Number(rootId)===Number(targetId)) return true;
  const q=await pool.query(`
    WITH RECURSIVE tree AS (
      SELECT id,parent_id FROM territories WHERE id=$1
      UNION ALL
      SELECT t.id,t.parent_id FROM territories t JOIN tree x ON t.parent_id=x.id
    )
    SELECT 1 FROM tree WHERE id=$2 LIMIT 1
  `,[rootId,targetId]);
  return Boolean(q.rowCount);
}

export async function hasAdminPermission(pool,accountId,permission,territoryId=null){
  const assignments=await getAdminAssignments(pool,accountId);
  for(const a of assignments){
    const rank=String(a.effective_rank||a.authority_rank||a.admin_role||'');
    if(rank==='super_admin'||a.admin_role==='super_admin') return {allowed:true,assignment:a};
    const perms=new Set(Array.isArray(a.permissions)?a.permissions:[]);
    if(!perms.has(permission)) continue;
    // Delegated Admin workspaces may be opened without a target territory.
    // Scope is still carried by the assignment and downstream list/query filters.
    if(a.territory_id!=null){
      if(territoryId==null||await territoryWithin(pool,a.territory_id,territoryId)){
        return {allowed:true,assignment:a};
      }
      continue;
    }
    if(a.country_code==='PH') return {allowed:true,assignment:a};
  }
  return {allowed:false,assignment:null};
}

export async function requireAdminPermission(pool,accountId,permission,territoryId=null){
  const result=await hasAdminPermission(pool,accountId,permission,territoryId);
  if(!result.allowed) throw Object.assign(new Error('Admin permission or territory scope is not available'),{status:403});
  return result.assignment;
}

export async function visibleTerritoryIds(pool,accountId,permission='admin.console'){
  const assignments=await getAdminAssignments(pool,accountId);
  if(assignments.some(a=>a.admin_role==='super_admin')) {
    const {rows}=await pool.query(`SELECT id FROM territories WHERE country_code='PH'`);
    return rows.map(r=>Number(r.id));
  }
  const ids=new Set();
  for(const a of assignments){
    const perms=new Set(Array.isArray(a.permissions)?a.permissions:[]);
    if(!perms.has(permission)) continue;
    if(a.admin_role==='country_admin'){
      const {rows}=await pool.query(`SELECT id FROM territories WHERE country_code=$1`,[a.country_code]);
      rows.forEach(r=>ids.add(Number(r.id)));
    }else if(a.admin_role==='territory_admin'&&a.territory_id){
      const {rows}=await pool.query(`
        WITH RECURSIVE tree AS (
          SELECT id,parent_id FROM territories WHERE id=$1
          UNION ALL SELECT t.id,t.parent_id FROM territories t JOIN tree x ON t.parent_id=x.id
        ) SELECT id FROM tree
      `,[a.territory_id]);
      rows.forEach(r=>ids.add(Number(r.id)));
    }
  }
  return [...ids];
}

export async function appendAdminAudit(pool,{
  actorAccountId,assignmentId=null,permission='',territoryId=null,targetType='',targetId='',
  eventCode,before=null,after=null,reason='',correlationId=''
}){
  await pool.query(`
    INSERT INTO admin_audit_events(
      actor_account_id,assignment_id,permission_code,country_code,territory_id,
      target_type,target_id,event_code,before_json,after_json,reason,correlation_id
    ) VALUES($1,$2,$3,'PH',$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)
  `,[
    actorAccountId||null,assignmentId||null,clean(permission,100),territoryId||null,
    clean(targetType,80),clean(targetId,120),clean(eventCode,120),
    before==null?null:JSON.stringify(before),after==null?null:JSON.stringify(after),
    clean(reason,1200),clean(correlationId,120)
  ]).catch(()=>{});
}
