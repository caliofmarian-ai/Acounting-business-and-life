const BLOCK_REASONS=new Set(['safety','harassment','privacy','fraud_concern','unwanted_contact','other']);
const BLOCK_SCOPES=new Set(['local_services']);
const BLOCK_ACTION_HOURLY_LIMIT=20;
const BLOCK_ACTION_DAILY_LIMIT=60;

function positiveId(value,label='Account'){
  const id=Number(value);
  if(!Number.isInteger(id)||id<1)throw Object.assign(new Error(label+' ID is invalid'),{status:400});
  return id;
}
function reason(value){
  const next=String(value||'other').trim().toLowerCase();
  return BLOCK_REASONS.has(next)?next:'other';
}
function scope(value){
  const next=String(value||'local_services').trim().toLowerCase();
  if(!BLOCK_SCOPES.has(next))throw Object.assign(new Error('Block scope is not supported'),{status:400});
  return next;
}

export async function ensureTrustSafetySchema(pool){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_blocks (
      blocker_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      blocked_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      scope TEXT NOT NULL DEFAULT 'local_services',
      reason_category TEXT NOT NULL DEFAULT 'other',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      removed_at TIMESTAMPTZ,
      PRIMARY KEY(blocker_account_id,blocked_account_id,scope),
      CHECK(blocker_account_id<>blocked_account_id),
      CHECK(scope IN ('local_services')),
      CHECK(reason_category IN ('safety','harassment','privacy','fraud_concern','unwanted_contact','other'))
    );
    ALTER TABLE user_blocks ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'local_services';
    CREATE UNIQUE INDEX IF NOT EXISTS user_blocks_identity_idx
      ON user_blocks(blocker_account_id,blocked_account_id,scope);
    ALTER TABLE user_blocks DROP CONSTRAINT IF EXISTS user_blocks_scope_check;
    ALTER TABLE user_blocks ADD CONSTRAINT user_blocks_scope_check CHECK(scope IN ('local_services'));
    CREATE INDEX IF NOT EXISTS user_blocks_active_blocker_idx
      ON user_blocks(blocker_account_id,scope,created_at DESC) WHERE removed_at IS NULL;
    CREATE INDEX IF NOT EXISTS user_blocks_active_blocked_idx
      ON user_blocks(blocked_account_id,scope,created_at DESC) WHERE removed_at IS NULL;

    CREATE TABLE IF NOT EXISTS user_block_events (
      id BIGSERIAL PRIMARY KEY,
      blocker_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      blocked_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      scope TEXT NOT NULL DEFAULT 'local_services',
      event_type TEXT NOT NULL CHECK(event_type IN ('blocked','unblocked','reason_updated')),
      reason_category TEXT NOT NULL DEFAULT 'other',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE user_block_events ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'local_services';
    ALTER TABLE user_block_events DROP CONSTRAINT IF EXISTS user_block_events_scope_check;
    ALTER TABLE user_block_events ADD CONSTRAINT user_block_events_scope_check CHECK(scope IN ('local_services'));
    CREATE INDEX IF NOT EXISTS user_block_events_actor_idx
      ON user_block_events(blocker_account_id,created_at DESC);
  `);
}

async function assertBlockActionAllowed(pool,blockerAccountId){
  const q=await pool.query(`
    SELECT COUNT(*) FILTER(WHERE created_at>=NOW()-INTERVAL '1 hour')::int hourly,
           COUNT(*)::int daily
      FROM user_block_events
     WHERE blocker_account_id=$1 AND created_at>=NOW()-INTERVAL '24 hours'
  `,[blockerAccountId]);
  if(Number(q.rows[0]?.hourly||0)>=BLOCK_ACTION_HOURLY_LIMIT||Number(q.rows[0]?.daily||0)>=BLOCK_ACTION_DAILY_LIMIT){
    throw Object.assign(new Error('Too many block changes. Try again later.'),{status:429});
  }
}

export async function hasActiveBlock(pool,{blockerAccountId,blockedAccountId,blockScope='local_services'}){
  const blocker=positiveId(blockerAccountId,'Blocker'),blocked=positiveId(blockedAccountId,'Blocked account'),selectedScope=scope(blockScope);
  if(blocker===blocked)return false;
  const q=await pool.query(`SELECT 1 FROM user_blocks WHERE blocker_account_id=$1 AND blocked_account_id=$2 AND scope=$3 AND removed_at IS NULL LIMIT 1`,[blocker,blocked,selectedScope]);
  return q.rowCount>0;
}

export async function accountsBlocked(pool,accountA,accountB,blockScope='local_services'){
  const a=positiveId(accountA),b=positiveId(accountB);
  if(a===b)return false;
  const selectedScope=scope(blockScope);
  const q=await pool.query(`
    SELECT 1
      FROM user_blocks
     WHERE removed_at IS NULL
       AND scope=$3
       AND (
         (blocker_account_id=$1 AND blocked_account_id=$2)
         OR
         (blocker_account_id=$2 AND blocked_account_id=$1)
       )
     LIMIT 1
  `,[a,b,selectedScope]);
  return q.rowCount>0;
}

export async function blockAccount(pool,{blockerAccountId,blockedAccountId,reasonCategory='other',blockScope='local_services'}){
  const blocker=positiveId(blockerAccountId,'Blocker'),blocked=positiveId(blockedAccountId,'Blocked account');
  if(blocker===blocked)throw Object.assign(new Error('You cannot block your own account'),{status:409});
  if(blocked===1)throw Object.assign(new Error('The platform safety function cannot be blocked'),{status:403});
  const exists=await pool.query('SELECT id FROM accounts WHERE id=$1',[blocked]);
  if(!exists.rowCount)throw Object.assign(new Error('Account not found'),{status:404});
  const why=reason(reasonCategory),selectedScope=scope(blockScope);
  await assertBlockActionAllowed(pool,blocker);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const prior=await client.query(
      'SELECT reason_category,removed_at FROM user_blocks WHERE blocker_account_id=$1 AND blocked_account_id=$2 AND scope=$3 FOR UPDATE',
      [blocker,blocked,selectedScope]
    );
    const wasActive=Boolean(prior.rowCount&&prior.rows[0].removed_at==null);
    const eventType=!wasActive?'blocked':prior.rows[0].reason_category===why?null:'reason_updated';
    await client.query(`
      INSERT INTO user_blocks(blocker_account_id,blocked_account_id,scope,reason_category,removed_at)
      VALUES($1,$2,$3,$4,NULL)
      ON CONFLICT(blocker_account_id,blocked_account_id,scope) DO UPDATE SET
        reason_category=EXCLUDED.reason_category,
        created_at=CASE WHEN user_blocks.removed_at IS NOT NULL THEN NOW() ELSE user_blocks.created_at END,
        removed_at=NULL,
        updated_at=NOW()
    `,[blocker,blocked,selectedScope,why]);
    if(eventType){
      await client.query(`
        INSERT INTO user_block_events(blocker_account_id,blocked_account_id,scope,event_type,reason_category)
        VALUES($1,$2,$3,$4,$5)
      `,[blocker,blocked,selectedScope,eventType,why]);
    }
    await client.query('COMMIT');
    return{ok:true,blocked_account_id:blocked,scope:selectedScope,reason_category:why};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
}

export async function unblockAccount(pool,{blockerAccountId,blockedAccountId,blockScope='local_services'}){
  const blocker=positiveId(blockerAccountId,'Blocker'),blocked=positiveId(blockedAccountId,'Blocked account'),selectedScope=scope(blockScope);
  await assertBlockActionAllowed(pool,blocker);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const q=await client.query(`
      UPDATE user_blocks
         SET removed_at=NOW(),updated_at=NOW()
       WHERE blocker_account_id=$1 AND blocked_account_id=$2 AND scope=$3 AND removed_at IS NULL
       RETURNING reason_category
    `,[blocker,blocked,selectedScope]);
    if(q.rowCount){
      await client.query(`
        INSERT INTO user_block_events(blocker_account_id,blocked_account_id,scope,event_type,reason_category)
        VALUES($1,$2,$3,'unblocked',$4)
      `,[blocker,blocked,selectedScope,q.rows[0].reason_category||'other']);
    }
    await client.query('COMMIT');
    return{ok:true,blocked_account_id:blocked,scope:selectedScope,was_blocked:q.rowCount>0};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
}

export async function listBlockedAccounts(pool,blockerAccountId,blockScope='local_services'){
  const blocker=positiveId(blockerAccountId,'Blocker'),selectedScope=scope(blockScope);
  const q=await pool.query(`
    SELECT b.blocked_account_id,b.scope,b.reason_category,b.created_at,b.updated_at,
           a.display_name
      FROM user_blocks b
      JOIN accounts a ON a.id=b.blocked_account_id
     WHERE b.blocker_account_id=$1 AND b.scope=$2 AND b.removed_at IS NULL
     ORDER BY b.updated_at DESC,b.blocked_account_id
  `,[blocker,selectedScope]);
  return q.rows.map(row=>({
    blocked_account_id:Number(row.blocked_account_id),
    display_name:row.display_name||'Blocked account',
    scope:row.scope,
    reason_category:row.reason_category,
    created_at:row.created_at,
    updated_at:row.updated_at
  }));
}
