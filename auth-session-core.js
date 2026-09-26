import crypto from 'node:crypto';

export const AUTH_SESSION_TTL_MS=24*60*60*1000;
export const AUTH_STEP_UP_TTL_MS=10*60*1000;

function safeEqualHex(a,b){
  try{
    const aa=Buffer.from(String(a||''),'hex');
    const bb=Buffer.from(String(b||''),'hex');
    return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb);
  }catch{return false}
}

export function isLegacyBearerToken(token=''){
  return Boolean(token)&&String(token).split('.').length===3;
}

export function signV2SessionToken(tokenSecret,accountId,sessionId,{issued=Date.now()}={}){
  const id=Number(accountId),sid=String(sessionId||'');
  if(!tokenSecret||!Number.isInteger(id)||id<1||!sid)throw new Error('Valid V2 session signing inputs required');
  const payload=`v2.${issued}.${id}.${sid}`;
  const sig=crypto.createHmac('sha256',String(tokenSecret)).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export async function resolveV2SessionToken(pool,tokenSecret,token='',{now=Date.now(),ttlMs=AUTH_SESSION_TTL_MS}={}){
  if(!pool||!tokenSecret||!token)return null;
  const parts=String(token).split('.');
  if(parts.length!==5||parts[0]!=='v2')return null;
  const issued=Number(parts[1]),accountId=Number(parts[2]),sessionId=parts[3];
  if(!Number.isInteger(accountId)||accountId<1||!sessionId||!Number.isFinite(issued))return null;
  if(now-issued>ttlMs||issued>now+60_000)return null;
  const payload=parts.slice(0,4).join('.');
  const expected=crypto.createHmac('sha256',String(tokenSecret)).update(payload).digest('hex');
  if(!safeEqualHex(parts[4],expected))return null;
  const session=await pool.query(
    `SELECT account_id FROM account_sessions WHERE session_id=$1 AND account_id=$2 AND revoked_at IS NULL AND expires_at>NOW()`,
    [sessionId,accountId]
  );
  if(!session.rowCount)return null;
  return{accountId,sessionId,issued,legacy:false};
}

export async function createV2Session(pool,tokenSecret,accountId,{
  userAgent='',ipHash='',sessionId=crypto.randomUUID(),issued=Date.now(),stepUpVerified=false
}={}){
  const id=Number(accountId);
  if(!pool||!Number.isInteger(id)||id<1)throw new Error('Valid account required');
  await pool.query(
    `INSERT INTO account_sessions(session_id,account_id,expires_at,user_agent,ip_hash,step_up_verified_at)
     VALUES($1,$2,NOW()+INTERVAL '24 hours',$3,$4,CASE WHEN $5 THEN NOW() END)`,
    [sessionId,id,String(userAgent||''),String(ipHash||''),Boolean(stepUpVerified)]
  );
  return{sessionId,token:signV2SessionToken(tokenSecret,id,sessionId,{issued})};
}

export async function markV2SessionStepUp(pool,{accountId,sessionId}){
  const q=await pool.query(
    `UPDATE account_sessions
        SET step_up_verified_at=NOW()
      WHERE session_id=$1 AND account_id=$2 AND revoked_at IS NULL AND expires_at>NOW()
      RETURNING step_up_verified_at`,
    [String(sessionId||''),Number(accountId)]
  );
  if(!q.rowCount)return null;
  return q.rows[0].step_up_verified_at;
}

export async function resolveV2SessionStepUp(pool,tokenSecret,token='',{
  now=Date.now(),ttlMs=AUTH_SESSION_TTL_MS,maxAgeMs=AUTH_STEP_UP_TTL_MS
}={}){
  const session=await resolveV2SessionToken(pool,tokenSecret,token,{now,ttlMs});
  if(!session)return null;
  const q=await pool.query(
    `SELECT step_up_verified_at
       FROM account_sessions
      WHERE session_id=$1 AND account_id=$2 AND revoked_at IS NULL AND expires_at>NOW()`,
    [session.sessionId,session.accountId]
  );
  if(!q.rowCount)return null;
  const verifiedAt=q.rows[0].step_up_verified_at||null;
  const verifiedMs=verifiedAt?new Date(verifiedAt).getTime():NaN;
  const age=Number.isFinite(verifiedMs)?now-verifiedMs:Infinity;
  return{
    ...session,
    stepUpVerifiedAt:verifiedAt,
    stepUpValid:Number.isFinite(age)&&age>=0&&age<=maxAgeMs
  };
}
