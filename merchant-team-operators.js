/** Merchant Voice #863: scoped human operators INSIDE one existing Merchant business.
 * No account, profile or business creation. The owner account remains the root.
 * A team shift is restricted to the voice/order assistant: NOT a browser login,
 * NOT an account credential, NOT authorisation for payment/stock/admin endpoints.
 */
import crypto from 'node:crypto';
import {promisify} from 'node:util';
import {verifyV2SessionTokenSignature,AUTH_STEP_UP_TTL_MS} from './auth-session-core.js';

const scrypt=promisify(crypto.scrypt);
const goodId=x=>Number.isSafeInteger(Number(x))&&Number(x)>0;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const shiftTokenPattern=/^[A-Za-z0-9_-]{38,128}$/;
const permissions=Object.freeze({
  manager:['orders.voice_draft','orders.read','stock.read'],
  order_operator:['orders.voice_draft','orders.read'],
  stock_helper:['stock.read'],
  temporary:['orders.voice_draft','orders.read']
});
const err=(status,code,message)=>Object.assign(new Error(message),{status,code});
export const MERCHANT_TEAM_ROLES=Object.freeze(Object.keys(permissions));
export const merchantTeamPermissions=role=>[...(permissions[role]||[])];
export const teamShiftFlag=(env=process.env)=>env.MERCHANT_TEAM_ENABLED==='1';

function teamKey(secret){
  if(!secret||String(secret).length<24)throw err(503,'TEAM_NOT_CONFIGURED','Operator sessions are not configured.');
  return Buffer.isBuffer(secret)?secret:Buffer.from(secret);
}
export function teamSessionBinding({token,accountId,businessId,secret}){
  if(!goodId(accountId)||!goodId(businessId)||typeof token!=='string'||token.length<20||token.length>10000)
    throw err(401,'TEAM_ACCOUNT_SESSION','Sign in to the Merchant account before choosing an operator.');
  return crypto.createHmac('sha256',teamKey(secret))
    .update(`team-owner-session:${accountId}:${businessId}:`).update(token).digest('hex').slice(0,48);
}
function operatorTokenDigest({token,businessId,accountId,secret}){
  if(!shiftTokenPattern.test(String(token||'')))throw err(401,'TEAM_SHIFT_REQUIRED','Choose an operator and begin a shift.');
  return crypto.createHmac('sha256',teamKey(secret))
    .update(`team-shift:${accountId}:${businessId}:`).update(token).digest('hex');
}
function safeName(value){
  const name=String(value??'').trim().replace(/\s+/g,' ');
  if(name.length<2||name.length>80||/[<>\x00-\x1f]/.test(name))throw err(400,'TEAM_NAME_INVALID','Enter an operator name (2–80 characters).');
  return name;
}
function safePin(pin){
  if(typeof pin!=='string'||!/^[0-9]{6,10}$/.test(pin)||/^([0-9])\1+$/.test(pin))
    throw err(400,'TEAM_PIN_INVALID','Set an individual PIN of 6–10 digits (not all identical).');
  return pin;
}
export async function hashOperatorPin(pin,{pepper,random=crypto.randomBytes}={}){
  safePin(pin);
  if(typeof pepper!=='string'||pepper.length<24)throw err(503,'TEAM_NOT_CONFIGURED','Operator PIN security is not configured.');
  const salt=random(24).toString('hex');
  const hash=await scrypt(`${pin}:${pepper}`,Buffer.from(salt,'hex'),64,{N:16384,r:8,p:1,maxmem:32*1024*1024});
  return{salt,hash:hash.toString('hex')};
}
export async function verifyOperatorPin(pin,record,{pepper}={}){
  if(typeof pepper!=='string'||pepper.length<24)throw err(503,'TEAM_NOT_CONFIGURED','Operator PIN security is not configured.');
  // The work factor is paid for every valid-sized PIN, including failures.
  const valid=typeof pin==='string'&&/^[0-9]{6,10}$/.test(pin);
  const salt=String(record?.pin_salt||'');const hex=String(record?.pin_hash||'');
  if(!/^[a-f0-9]{48}$/i.test(salt)||!/^[a-f0-9]{128}$/i.test(hex))throw err(503,'TEAM_CREDENTIAL_INVALID','Operator credentials are unavailable.');
  const actual=await scrypt(`${valid?pin:'000000'}:${pepper}`,Buffer.from(salt,'hex'),64,{N:16384,r:8,p:1,maxmem:32*1024*1024});
  return valid&&crypto.timingSafeEqual(actual,Buffer.from(hex,'hex'));
}
export function operatorExpiry(input,{now=new Date()}={}){
  if(input==null||input==='')return null;
  const value=new Date(input),ms=value.getTime();
  if(!Number.isFinite(ms)||ms<=now.getTime()||ms>now.getTime()+90*86400_000)
    throw err(400,'TEAM_EXPIRY_INVALID','Temporary access must expire within 90 days.');
  return value;
}
export function validateOperatorInput({name,role,pin,expiresAt}={},now=new Date()){
  if(!Object.hasOwn(permissions,role))throw err(400,'TEAM_ROLE_INVALID','Choose a valid operator role.');
  return{name:safeName(name),role,pin:safePin(pin),expiresAt:operatorExpiry(expiresAt,{now})};
}

/** Additive. No modification to the existing Business & Life identity model. */
export async function ensureMerchantTeamSchema(db){
  await db.query(`
    CREATE TABLE IF NOT EXISTS merchant_team_operators (
      id UUID PRIMARY KEY,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      owner_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 2 AND 80),
      role TEXT NOT NULL CHECK (role IN ('manager','order_operator','stock_helper','temporary')),
      pin_salt CHAR(48) NOT NULL,
      pin_hash CHAR(128) NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      expires_at TIMESTAMPTZ,
      created_by_account_id BIGINT NOT NULL REFERENCES accounts(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS merchant_team_scope_idx
      ON merchant_team_operators(business_id,owner_account_id,is_active);
    CREATE TABLE IF NOT EXISTS merchant_team_shifts (
      id UUID PRIMARY KEY,
      operator_id UUID NOT NULL REFERENCES merchant_team_operators(id) ON DELETE CASCADE,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      owner_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      session_binding CHAR(48) NOT NULL,
      token_digest CHAR(64) NOT NULL UNIQUE,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      ended_at TIMESTAMPTZ,
      last_seen_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS merchant_team_shifts_operator_idx
      ON merchant_team_shifts(operator_id,ended_at,expires_at);
    CREATE TABLE IF NOT EXISTS merchant_team_pin_attempts (
      operator_id UUID NOT NULL REFERENCES merchant_team_operators(id) ON DELETE CASCADE,
      window_start TIMESTAMPTZ NOT NULL,
      attempt_count INT NOT NULL CHECK (attempt_count BETWEEN 0 AND 10000),
      PRIMARY KEY(operator_id,window_start)
    );
    CREATE TABLE IF NOT EXISTS merchant_team_events (
      id BIGSERIAL PRIMARY KEY,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      operator_id UUID REFERENCES merchant_team_operators(id) ON DELETE SET NULL,
      shift_id UUID REFERENCES merchant_team_shifts(id) ON DELETE SET NULL,
      actor_account_id BIGINT NOT NULL REFERENCES accounts(id),
      event_code TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS merchant_team_events_scope_idx
      ON merchant_team_events(business_id,created_at DESC);
  `);
}
export async function withTeamTransaction(db,callback){
  const client=await db.connect();
  try{
    await client.query('BEGIN');const result=await callback(client);
    await client.query('COMMIT');return result;
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
  finally{client.release()}
}
export async function assertMerchantTeamOwner(client,{accountId,businessId,token,tokenSecret,now=new Date()}={}){
  if(!goodId(accountId)||!goodId(businessId))throw err(403,'TEAM_OWNER_REQUIRED','Merchant owner permission is required.');
  const parsed=verifyV2SessionTokenSignature(tokenSecret,token,{now:now.getTime()});
  if(!parsed||parsed.accountId!==Number(accountId))throw err(428,'TEAM_OWNER_STEP_UP_REQUIRED','Sign in again to manage staff.');
  const result=await client.query(`SELECT s.step_up_verified_at FROM account_sessions s
    JOIN business_memberships bm ON bm.account_id=s.account_id AND bm.business_id=$3
      AND bm.active=TRUE AND bm.membership_role='owner'
    WHERE s.session_id=$1 AND s.account_id=$2 AND s.revoked_at IS NULL
      AND s.expires_at>NOW() FOR SHARE OF s,bm`,[parsed.sessionId,accountId,businessId]);
  const stamp=result.rows?.[0]?.step_up_verified_at;
  if(result.rowCount!==1)throw err(403,'TEAM_OWNER_REQUIRED','Only the Merchant owner can manage operators.');
  const age=stamp?now.getTime()-new Date(stamp).getTime():Infinity;
  if(!Number.isFinite(age)||age<0||age>AUTH_STEP_UP_TTL_MS)
    throw err(428,'TEAM_OWNER_STEP_UP_REQUIRED','Re-enter the main account password to change team access.');
  return true;
}
export async function addTeamOperator(db,{businessId,accountId,token,tokenSecret,pepper,secret,input,now=new Date()}={}){
  const data=validateOperatorInput(input,now);
  const hashed=await hashOperatorPin(data.pin,{pepper});
  return withTeamTransaction(db,async client=>{
    await assertMerchantTeamOwner(client,{accountId,businessId,token,tokenSecret,now});
    const existing=await client.query(`SELECT COUNT(*)::int count FROM merchant_team_operators
      WHERE business_id=$1 AND owner_account_id=$2 AND is_active=TRUE`,[businessId,accountId]);
    if(Number(existing.rows[0]?.count)>=30)throw err(409,'TEAM_LIMIT','This business has reached the 30-operator limit.');
    const id=crypto.randomUUID();
    await client.query(`INSERT INTO merchant_team_operators(id,business_id,owner_account_id,display_name,
      role,pin_salt,pin_hash,expires_at,created_by_account_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$3)`,[id,businessId,accountId,data.name,data.role,hashed.salt,hashed.hash,data.expiresAt]);
    await client.query(`INSERT INTO merchant_team_events(business_id,operator_id,actor_account_id,event_code)
      VALUES($1,$2,$3,'operator.added')`,[businessId,id,accountId]);
    return{id,business_id:Number(businessId),name:data.name,role:data.role,permissions:merchantTeamPermissions(data.role),active:true,
      expires_at:data.expiresAt?.toISOString()||null};
  });
}
export async function listTeamOperators(db,{businessId,accountId}={}){
  const q=await db.query(`SELECT id,display_name,role,is_active,expires_at
    FROM merchant_team_operators WHERE business_id=$1 AND owner_account_id=$2
    ORDER BY display_name,id`,[businessId,accountId]);
  return(q.rows||[]).map(row=>({id:row.id,name:row.display_name,role:row.role,
    permissions:merchantTeamPermissions(row.role),active:Boolean(row.is_active)&&(!row.expires_at||new Date(row.expires_at)>new Date()),
    expires_at:row.expires_at||null}));
}
export async function stopTeamOperator(db,{businessId,accountId,operatorId,token,tokenSecret,now=new Date()}={}){
  if(!uuid.test(String(operatorId||'')))throw err(400,'TEAM_OPERATOR_INVALID','Choose a valid operator.');
  return withTeamTransaction(db,async client=>{
    await assertMerchantTeamOwner(client,{accountId,businessId,token,tokenSecret,now});
    const result=await client.query(`UPDATE merchant_team_operators SET is_active=FALSE,
      revoked_at=COALESCE(revoked_at,NOW()),updated_at=NOW()
      WHERE id=$1 AND business_id=$2 AND owner_account_id=$3 AND is_active=TRUE RETURNING id`,
      [operatorId,businessId,accountId]);
    if(result.rowCount!==1)throw err(404,'TEAM_OPERATOR_NOT_FOUND','Operator not found or already disabled.');
    await client.query(`UPDATE merchant_team_shifts SET ended_at=COALESCE(ended_at,NOW())
      WHERE operator_id=$1 AND ended_at IS NULL`,[operatorId]);
    await client.query(`INSERT INTO merchant_team_events(business_id,operator_id,actor_account_id,event_code)
      VALUES($1,$2,$3,'operator.disabled')`,[businessId,operatorId,accountId]);
    return{disabled:true,operator_id:operatorId};
  });
}
export async function beginTeamShift(db,{businessId,accountId,operatorId,pin,sessionBinding,secret,pepper,now=new Date()}={}){
  if(!goodId(businessId)||!goodId(accountId)||!uuid.test(String(operatorId||'')))
    throw err(400,'TEAM_OPERATOR_INVALID','Choose an operator for this Merchant.');
  if(typeof sessionBinding!=='string'||sessionBinding.length!==48)throw err(401,'TEAM_ACCOUNT_SESSION','Sign in again.');
  return withTeamTransaction(db,async client=>{
    const operator=await client.query(`SELECT * FROM merchant_team_operators
      WHERE id=$1 AND business_id=$2 AND owner_account_id=$3 FOR UPDATE`,[operatorId,businessId,accountId]);
    const row=operator.rows?.[0];
    if(!row||!row.is_active||row.revoked_at||row.expires_at&&new Date(row.expires_at)<=now)
      throw err(403,'TEAM_OPERATOR_INACTIVE','This operator cannot start a shift.');
    const start=new Date(Math.floor(now.getTime()/900000)*900000);
    const attempted=await client.query(`INSERT INTO merchant_team_pin_attempts(operator_id,window_start,attempt_count)
      VALUES($1,$2,1) ON CONFLICT(operator_id,window_start)
      DO UPDATE SET attempt_count=merchant_team_pin_attempts.attempt_count+1 RETURNING attempt_count`,[operatorId,start]);
    if(Number(attempted.rows[0]?.attempt_count)>5){
      // We intentionally COMMIT the rate-limit count even though access is denied.
      return {error:'TEAM_PIN_LOCKED',status:429};
    }
    const correct=await verifyOperatorPin(pin,row,{pepper});
    if(!correct)return{error:'TEAM_PIN_REJECTED',status:403};
    await client.query(`DELETE FROM merchant_team_pin_attempts WHERE operator_id=$1 AND window_start=$2`,[operatorId,start]);
    const random=crypto.randomBytes(36).toString('base64url');
    const digest=operatorTokenDigest({token:random,businessId,accountId,secret});
    const shiftId=crypto.randomUUID();const endBy=new Date(Math.min(now.getTime()+8*3600_000,
      row.expires_at?new Date(row.expires_at).getTime():Infinity));
    await client.query(`INSERT INTO merchant_team_shifts(id,operator_id,business_id,owner_account_id,session_binding,
      token_digest,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [shiftId,operatorId,businessId,accountId,sessionBinding,digest,endBy]);
    await client.query(`INSERT INTO merchant_team_events(business_id,operator_id,shift_id,actor_account_id,event_code)
      VALUES($1,$2,$3,$4,'shift.started')`,[businessId,operatorId,shiftId,accountId]);
    return{shift_id:shiftId,operator_id:operatorId,name:row.display_name,role:row.role,
      permissions:merchantTeamPermissions(row.role),expires_at:endBy.toISOString(),token:random};
  }).then(result=>{if(result?.error)throw err(result.status,result.error,result.status===429?
    'Too many PIN attempts. Try again later.':'Incorrect operator PIN.');return result});
}
export async function resolveTeamShift(db,{businessId,accountId,sessionBinding,secret,token,requiredPermission='orders.voice_draft',now=new Date()}={}){
  const digest=operatorTokenDigest({token,businessId,accountId,secret});
  const r=await db.query(`SELECT s.id shift_id,s.operator_id,o.display_name,o.role,o.is_active,
      o.revoked_at,o.expires_at operator_expires_at,s.expires_at shift_expires_at,s.ended_at
    FROM merchant_team_shifts s
    JOIN merchant_team_operators o ON o.id=s.operator_id
    WHERE s.token_digest=$1 AND s.session_binding=$2
      AND s.business_id=$3 AND s.owner_account_id=$4
      AND o.business_id=$3 AND o.owner_account_id=$4
    FOR SHARE OF s,o`,[digest,sessionBinding,businessId,accountId]);
  const row=r.rows?.[0];
  if(!row||!row.is_active||row.revoked_at||row.ended_at||
    new Date(row.shift_expires_at)<=now||row.operator_expires_at&&new Date(row.operator_expires_at)<=now)
    throw err(403,'TEAM_SHIFT_REQUIRED','Operator shift expired or was disabled. Start another shift.');
  if(requiredPermission&&!merchantTeamPermissions(row.role).includes(requiredPermission))
    throw err(403,'TEAM_PERMISSION_DENIED','This operator cannot use this Merchant tool.');
  return{operator_id:row.operator_id,shift_id:row.shift_id,name:row.display_name,
    role:row.role,permissions:merchantTeamPermissions(row.role),business_id:Number(businessId)};
}
export async function endTeamShift(db,{businessId,accountId,sessionBinding,secret,token}={}){
  const current=await resolveTeamShift(db,{businessId,accountId,sessionBinding,secret,token,requiredPermission:null});
  const digest=operatorTokenDigest({token,businessId,accountId,secret});
  return withTeamTransaction(db,async client=>{
    const res=await client.query(`UPDATE merchant_team_shifts SET ended_at=NOW()
      WHERE token_digest=$1 AND session_binding=$2 AND ended_at IS NULL RETURNING id`,[digest,sessionBinding]);
    if(res.rowCount!==1)throw err(409,'TEAM_SHIFT_ENDED','Operator shift ended.');
    await client.query(`INSERT INTO merchant_team_events(business_id,operator_id,shift_id,actor_account_id,event_code)
      VALUES($1,$2,$3,$4,'shift.ended')`,[businessId,current.operator_id,current.shift_id,accountId]);
    return{ended:true};
  });
}
