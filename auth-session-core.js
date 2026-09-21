import crypto from 'node:crypto';

export const AUTH_SESSION_TTL_MS=24*60*60*1000;

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

export async function createV2Session(pool,tokenSecret,accountId,{userAgent='',ipHash='',sessionId=crypto.randomUUID(),issued=Date.now()}={}){
  const id=Number(accountId);
  if(!pool||!Number.isInteger(id)||id<1)throw new Error('Valid account required');
  await pool.query(
    `INSERT INTO account_sessions(session_id,account_id,expires_at,user_agent,ip_hash) VALUES($1,$2,NOW()+INTERVAL '24 hours',$3,$4)`,
    [sessionId,id,String(userAgent||''),String(ipHash||'')]
  );
  return{sessionId,token:signV2SessionToken(tokenSecret,id,sessionId,{issued})};
}
