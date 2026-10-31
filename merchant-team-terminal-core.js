/**
 * #863 Restricted Merchant staff terminal. The worker uses an opaque, scoped
 * HttpOnly session, NEVER an account bearer/cookie. The owner issues a short-
 * lived pairing code from the existing Merchant profile after password step-up.
 * No new Business & Life accounts, Merchant profiles or ledgers are created.
 */
import crypto from 'node:crypto';
import {assertMerchantTeamOwner,verifyOperatorPin,merchantTeamPermissions,withTeamTransaction} from './merchant-team-operators.js';

export const TERMINAL_COOKIE='__Host-abl_operator';
const OWNER_COOKIE='__Host-abl_session';
const err=(status,code,msg)=>Object.assign(new Error(msg),{status,code});
const validId=v=>Number.isSafeInteger(Number(v))&&Number(v)>0;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const codeRx=/^[A-Za-z0-9_-]{30,100}$/;
const nowTime=(now)=>now instanceof Date?now:new Date(now);
const secretKey=v=>{const b=Buffer.isBuffer(v)?v:Buffer.from(String(v||''));if(b.length<24)throw err(503,'OPERATOR_TERMINAL_UNAVAILABLE','Operator access is not configured.');return b;};
const hmac=(secret,purpose,input)=>crypto.createHmac('sha256',secretKey(secret)).update(purpose+':').update(String(input)).digest('hex');
const validAccess=role=>merchantTeamPermissions(role).includes('orders.voice_draft');

export function terminalCookieValue(cookieHeader='',name=TERMINAL_COOKIE){
  for(const piece of String(cookieHeader||'').split(';')){
    const trimmed=piece.trim(),i=trimmed.indexOf('=');
    if(i>0&&trimmed.slice(0,i)===name)return trimmed.slice(i+1);
  }
  return '';
}
export function forbidOwnerSession(cookieHeader=''){
  if(terminalCookieValue(cookieHeader,OWNER_COOKIE))
    throw err(409,'OPERATOR_OWNER_SESSION','Sign out of the primary Business & Life account before opening a staff terminal on this browser.');
}
export function terminalCsrf(secret,rawToken){
  if(!codeRx.test(String(rawToken||'')))throw err(401,'OPERATOR_SESSION_REQUIRED','Sign in as a staff operator.');
  return hmac(secret,'terminal-csrf',rawToken);
}
export function verifyTerminalCsrf(secret,rawToken,header){
  if(typeof header!=='string'||!/^[a-f0-9]{64}$/.test(header))return false;
  const expected=terminalCsrf(secret,rawToken);
  return crypto.timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(header,'hex'));
}
export function terminalSessionBinding(secret,rawToken,operatorId,businessId){
  if(!uuid.test(String(operatorId||''))||!validId(businessId)||!codeRx.test(String(rawToken||'')))
    throw err(401,'OPERATOR_SESSION_REQUIRED','Staff session unavailable.');
  return hmac(secret,'terminal-voice',`${businessId}:${operatorId}:${rawToken}`).slice(0,48);
}

export async function ensureMerchantTeamTerminalSchema(db){
  await db.query(`
    CREATE TABLE IF NOT EXISTS merchant_team_terminal_pairs (
      id UUID PRIMARY KEY,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      owner_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      pair_digest CHAR(64) NOT NULL UNIQUE,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 6),
      consumed_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS merchant_team_terminal_pairs_scope
      ON merchant_team_terminal_pairs(business_id,owner_account_id,expires_at DESC);
    CREATE TABLE IF NOT EXISTS merchant_team_terminal_sessions (
      id UUID PRIMARY KEY,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      owner_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      operator_id UUID NOT NULL REFERENCES merchant_team_operators(id) ON DELETE CASCADE,
      token_digest CHAR(64) NOT NULL UNIQUE,
      paired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS merchant_team_terminal_sessions_scope
      ON merchant_team_terminal_sessions(business_id,operator_id,expires_at DESC);
  `);
}

/** Pairing code is displayed once to the owner, never persisted or logged raw. */
export async function issueMerchantTeamPairing(db,{businessId,accountId,token,tokenSecret,secret,now=new Date()}={}){
  if(!validId(businessId)||!validId(accountId))throw err(403,'TEAM_OWNER_REQUIRED','Merchant owner required.');
  const code=crypto.randomBytes(24).toString('base64url');
  const digest=hmac(secret,'team-pair',code);
  const at=nowTime(now),expiresAt=new Date(at.getTime()+10*60_000),id=crypto.randomUUID();
  await withTeamTransaction(db,async client=>{
    await assertMerchantTeamOwner(client,{businessId,accountId,token,tokenSecret,now:at});
    const count=await client.query(`SELECT COUNT(*)::int count FROM merchant_team_terminal_pairs
      WHERE owner_account_id=$1 AND business_id=$2 AND expires_at>NOW()
        AND revoked_at IS NULL AND consumed_at IS NULL`,[accountId,businessId]);
    if(Number(count.rows?.[0]?.count||0)>=5)throw err(429,'OPERATOR_PAIR_LIMIT','Too many active links. Try again later.');
    await client.query(`INSERT INTO merchant_team_terminal_pairs
      (id,business_id,owner_account_id,pair_digest,expires_at)
      VALUES($1,$2,$3,$4,$5)`,[id,businessId,accountId,digest,expiresAt]);
  });
  return{pair_code:code,expires_at:expiresAt.toISOString()};
}

function assertValidPair(row,now){
  if(!row||row.consumed_at||row.revoked_at||new Date(row.expires_at).getTime()<=now.getTime()
      ||Number(row.attempt_count)>=5)
    throw err(401,'OPERATOR_PAIR_INVALID','This staff pairing link has expired or was used. Ask the owner for a new link.');
}
export async function listPairingOperators(db,{code,secret,now=new Date()}={}){
  if(!codeRx.test(String(code||'')))throw err(401,'OPERATOR_PAIR_INVALID','Pairing code invalid.');
  const digest=hmac(secret,'team-pair',code);
  const q=await db.query(`SELECT business_id,owner_account_id,expires_at,attempt_count,consumed_at,revoked_at
    FROM merchant_team_terminal_pairs WHERE pair_digest=$1`,[digest]);
  const pair=q.rows?.[0];assertValidPair(pair,nowTime(now));
  const r=await db.query(`SELECT id,display_name,role FROM merchant_team_operators
    WHERE business_id=$1 AND owner_account_id=$2 AND is_active=TRUE AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at>NOW()) ORDER BY display_name,id`,
    [pair.business_id,pair.owner_account_id]);
  return{operators:(r.rows||[]).filter(o=>validAccess(o.role)).map(o=>({id:o.id,name:o.display_name,role:o.role})),
    expires_at:pair.expires_at};
}
/** Wrong PIN is recorded in a committed transaction; no session or account cookie is minted. */
export async function activateMerchantTeamTerminal(db,{
  code,operatorId,pin,secret,pepper,now=new Date()
}={}){
  if(!codeRx.test(String(code||''))||!uuid.test(String(operatorId||'')))
    throw err(401,'OPERATOR_PAIR_INVALID','Pairing link or operator is invalid.');
  const digest=hmac(secret,'team-pair',code),at=nowTime(now);
  const rawToken=crypto.randomBytes(36).toString('base64url');
  const outcome=await withTeamTransaction(db,async client=>{
    const q=await client.query(`SELECT * FROM merchant_team_terminal_pairs WHERE pair_digest=$1 FOR UPDATE`,[digest]);
    const pair=q.rows?.[0];assertValidPair(pair,at);
    const owner=await client.query(`SELECT a.id FROM accounts a
      JOIN profiles p ON p.account_id=a.id AND p.role='merchant' AND p.enabled=TRUE
      JOIN business_memberships bm ON bm.account_id=a.id AND bm.business_id=$2
        AND bm.active=TRUE AND bm.membership_role='owner'
      WHERE a.id=$1 AND a.auth_status='active' FOR SHARE OF a,p,bm`,
      [pair.owner_account_id,pair.business_id]);
    if(owner.rowCount!==1)throw err(403,'OPERATOR_PAIR_INVALID','The Merchant no longer permits staff access.');
    const candidate=await client.query(`SELECT * FROM merchant_team_operators
      WHERE id=$1 AND business_id=$2 AND owner_account_id=$3 FOR UPDATE`,
      [operatorId,pair.business_id,pair.owner_account_id]);
    const operator=candidate.rows?.[0];
    if(!operator||!operator.is_active||operator.revoked_at||operator.expires_at&&new Date(operator.expires_at)<=at||!validAccess(operator.role))
      throw err(403,'TEAM_OPERATOR_INACTIVE','This operator is not authorized.');
    const correct=await verifyOperatorPin(pin,operator,{pepper});
    if(!correct){
      await client.query(`UPDATE merchant_team_terminal_pairs
        SET attempt_count=attempt_count+1 WHERE id=$1`,[pair.id]);
      return{denied:true};
    }
    const sessionId=crypto.randomUUID(),expiry=new Date(Math.min(at.getTime()+8*3600_000,
      operator.expires_at?new Date(operator.expires_at).getTime():Infinity));
    await client.query(`INSERT INTO merchant_team_terminal_sessions
      (id,business_id,owner_account_id,operator_id,token_digest,expires_at)
      VALUES($1,$2,$3,$4,$5,$6)`,[sessionId,pair.business_id,pair.owner_account_id,
      operatorId,hmac(secret,'terminal-session',rawToken),expiry]);
    await client.query(`UPDATE merchant_team_terminal_pairs SET consumed_at=NOW() WHERE id=$1`,[pair.id]);
    await client.query(`INSERT INTO merchant_team_events
      (business_id,operator_id,actor_account_id,event_code)
      VALUES($1,$2,$3,'terminal.paired')`,[pair.business_id,operatorId,pair.owner_account_id]);
    return{token:rawToken,operator_id:operatorId,business_id:Number(pair.business_id),
      owner_account_id:Number(pair.owner_account_id),name:operator.display_name,role:operator.role,
      session_id:sessionId,expires_at:expiry.toISOString()};
  });
  if(outcome.denied)throw err(403,'OPERATOR_PIN_REJECTED','Incorrect operator PIN.');
  return outcome;
}

export async function resolveMerchantTeamTerminal(db,{token,secret,permission='orders.voice_draft',now=new Date()}={}){
  if(!codeRx.test(String(token||'')))throw err(401,'OPERATOR_SESSION_REQUIRED','Start a staff shift to continue.');
  const digest=hmac(secret,'terminal-session',token);
  const q=await db.query(`SELECT s.id session_id,s.business_id,s.owner_account_id,s.operator_id,
      s.expires_at session_expires_at,s.revoked_at session_revoked,
      o.display_name,o.role,o.expires_at operator_expires_at,o.is_active,o.revoked_at operator_revoked
    FROM merchant_team_terminal_sessions s
    JOIN merchant_team_operators o ON o.id=s.operator_id
      AND o.business_id=s.business_id AND o.owner_account_id=s.owner_account_id
    JOIN business_memberships bm ON bm.business_id=s.business_id
      AND bm.account_id=s.owner_account_id AND bm.active=TRUE AND bm.membership_role='owner'
    JOIN accounts a ON a.id=s.owner_account_id AND a.auth_status='active'
    JOIN profiles p ON p.account_id=a.id AND p.role='merchant' AND p.enabled=TRUE
    WHERE s.token_digest=$1 FOR SHARE OF s,o,bm,a,p`,[digest]);
  const row=q.rows?.[0],at=nowTime(now);
  if(!row||row.session_revoked||!row.is_active||row.operator_revoked||
     new Date(row.session_expires_at)<=at||row.operator_expires_at&&new Date(row.operator_expires_at)<=at)
    throw err(401,'OPERATOR_SESSION_REQUIRED','Staff shift expired or was disabled. Sign in again.');
  if(permission&&!merchantTeamPermissions(row.role).includes(permission))
    throw err(403,'OPERATOR_PERMISSION_DENIED','This operator cannot use that function.');
  return{session_id:row.session_id,operator_id:row.operator_id,name:row.display_name,role:row.role,
    business_id:Number(row.business_id),owner_account_id:Number(row.owner_account_id),
    permissions:merchantTeamPermissions(row.role),expires_at:row.session_expires_at,
    voice_session_id:terminalSessionBinding(secret,token,row.operator_id,row.business_id)};
}

export async function endMerchantTeamTerminal(db,{token,secret}={}){
  const current=await resolveMerchantTeamTerminal(db,{token,secret,permission:null});
  await withTeamTransaction(db,async client=>{
    const changed=await client.query(`UPDATE merchant_team_terminal_sessions SET revoked_at=NOW()
      WHERE id=$1 AND revoked_at IS NULL RETURNING id`,[current.session_id]);
    if(changed.rowCount!==1)throw err(409,'OPERATOR_SESSION_REQUIRED','Staff shift already ended.');
    await client.query(`INSERT INTO merchant_team_events
      (business_id,operator_id,actor_account_id,event_code)
      VALUES($1,$2,$3,'terminal.ended')`,[current.business_id,current.operator_id,current.owner_account_id]);
  });
  return{ended:true};
}