const BLOCK_REASONS=new Set(['safety','harassment','privacy','fraud_concern','unwanted_contact','other']);

function positiveId(value,label='Account'){
  const id=Number(value);
  if(!Number.isInteger(id)||id<1)throw Object.assign(new Error(label+' ID is invalid'),{status:400});
  return id;
}
function reason(value){
  const next=String(value||'other').trim().toLowerCase();
  return BLOCK_REASONS.has(next)?next:'other';
}

export async function ensureTrustSafetySchema(pool){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_blocks (
      blocker_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      blocked_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      reason_category TEXT NOT NULL DEFAULT 'other',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      removed_at TIMESTAMPTZ,
      PRIMARY KEY(blocker_account_id,blocked_account_id),
      CHECK(blocker_account_id<>blocked_account_id),
      CHECK(reason_category IN ('safety','harassment','privacy','fraud_concern','unwanted_contact','other'))
    );
    CREATE INDEX IF NOT EXISTS user_blocks_active_blocker_idx
      ON user_blocks(blocker_account_id,created_at DESC) WHERE removed_at IS NULL;
    CREATE INDEX IF NOT EXISTS user_blocks_active_blocked_idx
      ON user_blocks(blocked_account_id,created_at DESC) WHERE removed_at IS NULL;

    CREATE TABLE IF NOT EXISTS user_block_events (
      id BIGSERIAL PRIMARY KEY,
      blocker_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      blocked_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL CHECK(event_type IN ('blocked','unblocked','reason_updated')),
      reason_category TEXT NOT NULL DEFAULT 'other',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS user_block_events_actor_idx
      ON user_block_events(blocker_account_id,created_at DESC);
  `);
}

export async function accountsBlocked(pool,accountA,accountB){
  const a=positiveId(accountA),b=positiveId(accountB);
  if(a===b)return false;
  const q=await pool.query(`
    SELECT 1
      FROM user_blocks
     WHERE removed_at IS NULL
       AND (
         (blocker_account_id=$1 AND blocked_account_id=$2)
         OR
         (blocker_account_id=$2 AND blocked_account_id=$1)
       )
     LIMIT 1
  `,[a,b]);
  return q.rowCount>0;
}

export async function blockAccount(pool,{blockerAccountId,blockedAccountId,reasonCategory='other'}){
  const blocker=positiveId(blockerAccountId,'Blocker'),blocked=positiveId(blockedAccountId,'Blocked account');
  if(blocker===blocked)throw Object.assign(new Error('You cannot block your own account'),{status:409});
  const exists=await pool.query('SELECT id FROM accounts WHERE id=$1',[blocked]);
  if(!exists.rowCount)throw Object.assign(new Error('Account not found'),{status:404});
  const why=reason(reasonCategory),client=await pool.connect();
  try{
    await client.query('BEGIN');
    const prior=await client.query(
      'SELECT reason_category,removed_at FROM user_blocks WHERE blocker_account_id=$1 AND blocked_account_id=$2 FOR UPDATE',
      [blocker,blocked]
    );
    const eventType=prior.rowCount&&prior.rows[0].removed_at==null
      ?(prior.rows[0].reason_category===why?'blocked':'reason_updated')
      :'blocked';
    await client.query(`
      INSERT INTO user_blocks(blocker_account_id,blocked_account_id,reason_category,removed_at)
      VALUES($1,$2,$3,NULL)
      ON CONFLICT(blocker_account_id,blocked_account_id) DO UPDATE SET
        reason_category=EXCLUDED.reason_category,
        removed_at=NULL,
        updated_at=NOW()
    `,[blocker,blocked,why]);
    if(eventType!=='blocked'||!prior.rowCount||prior.rows[0].removed_at!=null){
      await client.query(`
        INSERT INTO user_block_events(blocker_account_id,blocked_account_id,event_type,reason_category)
        VALUES($1,$2,$3,$4)
      `,[blocker,blocked,eventType,why]);
    }else if(!prior.rowCount){
      await client.query(`
        INSERT INTO user_block_events(blocker_account_id,blocked_account_id,event_type,reason_category)
        VALUES($1,$2,'blocked',$3)
      `,[blocker,blocked,why]);
    }
    await client.query('COMMIT');
    return{ok:true,blocked_account_id:blocked,reason_category:why};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
}

export async function unblockAccount(pool,{blockerAccountId,blockedAccountId}){
  const blocker=positiveId(blockerAccountId,'Blocker'),blocked=positiveId(blockedAccountId,'Blocked account'),client=await pool.connect();
  try{
    await client.query('BEGIN');
    const q=await client.query(`
      UPDATE user_blocks
         SET removed_at=NOW(),updated_at=NOW()
       WHERE blocker_account_id=$1 AND blocked_account_id=$2 AND removed_at IS NULL
       RETURNING reason_category
    `,[blocker,blocked]);
    if(q.rowCount){
      await client.query(`
        INSERT INTO user_block_events(blocker_account_id,blocked_account_id,event_type,reason_category)
        VALUES($1,$2,'unblocked',$3)
      `,[blocker,blocked,q.rows[0].reason_category||'other']);
    }
    await client.query('COMMIT');
    return{ok:true,blocked_account_id:blocked,was_blocked:q.rowCount>0};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
}

export async function listBlockedAccounts(pool,blockerAccountId){
  const blocker=positiveId(blockerAccountId,'Blocker');
  const q=await pool.query(`
    SELECT b.blocked_account_id,b.reason_category,b.created_at,b.updated_at,
           a.display_name
      FROM user_blocks b
      JOIN accounts a ON a.id=b.blocked_account_id
     WHERE b.blocker_account_id=$1 AND b.removed_at IS NULL
     ORDER BY b.updated_at DESC,b.blocked_account_id
  `,[blocker]);
  return q.rows.map(row=>({
    blocked_account_id:Number(row.blocked_account_id),
    display_name:row.display_name||'Blocked account',
    reason_category:row.reason_category,
    created_at:row.created_at,
    updated_at:row.updated_at
  }));
}
