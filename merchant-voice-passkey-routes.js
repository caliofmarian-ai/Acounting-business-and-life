/**
 * Merchant #863 WebAuthn passkey enrolment and per-quote device approval.
 * This is *not* a login endpoint. Existing V2 session, Merchant authorisation,
 * CSRF, fresh password step-up and canonical Orders transactions remain required.
 */
import crypto from 'node:crypto';
import {requireVoiceOperatorStepUp} from './merchant-voice-order-confirm.js';
import {verifyVoiceOrderSignedQuote} from './merchant-voice-order-quote.js';
import {safeSessionId} from './merchant-voice-order-routes.js';
import {verifyPasskeyRegistration,verifyPasskeyAssertion,passkeyConfig,
  passkeyBase64Url as b64,passkeySha256 as sha,passkeyError} from './merchant-voice-passkey-core.js';

const err=(code,msg,status=409)=>passkeyError(msg,code,status);
const positiveId=v=>Number.isSafeInteger(Number(v))&&Number(v)>0;
const phraseWords=['amber','bamboo','coconut','coral','dawn','ember','forest','ginger',
  'harbor','island','jasmine','lagoon','mango','moon','orchid','palm','quartz','river',
  'sunrise','tiger','umber','violet','water','yellow'];
const safeCodes=new Set(['VOICE_PASSKEY_UNAVAILABLE','VOICE_PASSKEY_NOT_ENROLLED',
  'VOICE_PASSKEY_LIMIT','VOICE_PASSKEY_EXPIRED','VOICE_PASSKEY_INVALID',
  'VOICE_PASSKEY_STEP_UP_REQUIRED','VOICE_PASSKEY_PHRASE_INVALID','VOICE_PASSKEY_RETRY_LIMIT',
  'VOICE_PASSKEY_MISSING','VOICE_CONTEXT_STALE','VOICE_CONFIRM_QUOTE_INVALID','VOICE_QUOTE_STALE']);
const text=v=>String(v??'');
const tokenFromReq=req=>text(req.ablSessionToken||req.headers?.authorization||'').replace(/^Bearer\s+/i,'').trim();
const digest=b=>sha(Buffer.from(b));
const hex=b=>digest(b).toString('hex');
const timeLimit=90;
const serialiseCredential=record=>({id:record.credential_id,type:'public-key'});

function intentPhrase(){
  const pick=()=>phraseWords[crypto.randomInt(phraseWords.length)];
  return `${pick()} ${pick()} ${crypto.randomInt(100,1000)}`;
}
function phraseHash(challengeId,phrase){return hex(`${challengeId}:${text(phrase).trim().toLowerCase().replace(/\s+/g,' ')}`)}
function equalHash(a,b){const x=Buffer.from(text(a),'hex'),y=Buffer.from(text(b),'hex');return x.length===32&&y.length===32&&crypto.timingSafeEqual(x,y)}

export async function ensureMerchantVoicePasskeySchema(db){
  await db.query(`CREATE TABLE IF NOT EXISTS merchant_voice_passkey_credentials (
    credential_id TEXT PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    rp_id TEXT NOT NULL,
    public_key_pem TEXT NOT NULL,
    user_handle TEXT NOT NULL,
    sign_count BIGINT NOT NULL DEFAULT 0 CHECK(sign_count>=0),
    backup_eligible BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
  );
  CREATE INDEX IF NOT EXISTS voice_passkey_account_idx
    ON merchant_voice_passkey_credentials(account_id,rp_id) WHERE revoked_at IS NULL;
  CREATE TABLE IF NOT EXISTS merchant_voice_passkey_challenges (
    id UUID PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    session_binding CHAR(48) NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('register','approve')),
    challenge_digest CHAR(64) NOT NULL,
    quote_hash CHAR(64),
    request_key TEXT,
    phrase_digest CHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    CHECK((kind='register' AND quote_hash IS NULL AND request_key IS NULL AND phrase_digest IS NULL)
       OR (kind='approve' AND quote_hash IS NOT NULL AND request_key IS NOT NULL AND phrase_digest IS NOT NULL))
  );
  CREATE INDEX IF NOT EXISTS voice_passkey_challenge_scope_idx
    ON merchant_voice_passkey_challenges(account_id,business_id,kind,created_at DESC);
  `);
}

/** Enforce challenge state, expiry and exact scoped user/business/session. */
async function lockChallenge(client,{id,kind,accountId,businessId,sessionId,quoteHash=null,requestKey=null}){
  if(typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id))throw err('VOICE_PASSKEY_INVALID','Device approval was not valid.');
  const q=await client.query(`SELECT * FROM merchant_voice_passkey_challenges
     WHERE id=$1 AND kind=$2 AND account_id=$3 AND business_id=$4
       AND session_binding=$5 FOR UPDATE`,[id,kind,accountId,businessId,sessionId]);
  const c=q.rows?.[0];
  if(!c)throw err('VOICE_PASSKEY_INVALID','Device challenge does not match this Merchant session.');
  if(c.consumed_at||new Date(c.expires_at).getTime()<=Date.now())
    throw err('VOICE_PASSKEY_EXPIRED','Device challenge expired or was already used. Start approval again.');
  if(kind==='approve'&&(c.quote_hash!==quoteHash||c.request_key!==requestKey))
    throw err('VOICE_CONTEXT_STALE','The order or operator changed. Start device approval again.');
  return c;
}

/** Runs inside the SAME transaction that creates the canonical order and stock reservation. */
export async function verifyVoiceDevicePasskey(client,{
  req,accountId,businessId,sessionId,quoteHash,requestKey,config
}={}){
  if(!config?.ready)throw err('VOICE_PASSKEY_UNAVAILABLE','Secure device approval is unavailable.',503);
  const supplied=req?.body?.device_approval;
  if(!supplied||typeof supplied!=='object'||Array.isArray(supplied)||!supplied.credential)
    throw err('VOICE_PASSKEY_MISSING','Use your phone passkey to approve the order.',428);
  const record=await lockChallenge(client,{id:supplied.challenge_id,kind:'approve',
    accountId,businessId,sessionId,quoteHash,requestKey});
  if(!equalHash(record.phrase_digest,phraseHash(record.id,supplied.confirmation_phrase)))
    throw err('VOICE_PASSKEY_PHRASE_INVALID','Type the displayed approval phrase exactly.',428);
  const credentialId=text(supplied.credential?.id);
  if(!/^[A-Za-z0-9_-]{20,1400}$/.test(credentialId))
    throw err('VOICE_PASSKEY_INVALID','Invalid passkey credential.');
  const candidate=await client.query(`SELECT credential_id,public_key_pem,rp_id,sign_count,backup_eligible,user_handle
     FROM merchant_voice_passkey_credentials
    WHERE credential_id=$1 AND account_id=$2 AND rp_id=$3 AND revoked_at IS NULL FOR UPDATE`,
    [credentialId,accountId,config.rpId]);
  const stored=candidate.rows?.[0];
  if(!stored)throw err('VOICE_PASSKEY_INVALID','Passkey is not enrolled for this operator.');
  const verified=verifyPasskeyAssertion({credential:supplied.credential,credentialRecord:stored,
    challengeHash:b64(Buffer.from(record.challenge_digest,'hex')),origin:config.origin,rpId:config.rpId});
  if(supplied.credential.response?.userHandle!=null&&
     supplied.credential.response.userHandle!==stored.user_handle)
    throw err('VOICE_PASSKEY_INVALID','The passkey account handle does not match.');
  await client.query(`UPDATE merchant_voice_passkey_credentials
    SET sign_count=$1,last_used_at=NOW() WHERE credential_id=$2`,
    [verified.signCount,stored.credential_id]);
  const consumed=await client.query(`UPDATE merchant_voice_passkey_challenges SET consumed_at=NOW()
    WHERE id=$1 AND consumed_at IS NULL RETURNING id`,[record.id]);
  if(consumed.rowCount!==1)throw err('VOICE_PASSKEY_EXPIRED','This device approval was already used.');
  return true;
}

/** Express route installation; ownership remains with the existing Orders service. */
export function installMerchantVoicePasskeyRoutes(app,{
  db,requireMerchant,quoteSecret,tokenSecret,bodyMiddleware,
  env=process.env,now=()=>new Date(),verifyStepUp=requireVoiceOperatorStepUp
}={}){
  if(!app?.post||typeof requireMerchant!=='function'||!db?.connect)
    throw new TypeError('Passkey routes require authenticated Merchant Orders and PostgreSQL.');
  const config=passkeyConfig(env);
  const ready=()=>env.ORDER_VOICE_UI_ENABLED==='1'&&config.ready&&Boolean(tokenSecret)&&
    (Buffer.isBuffer(quoteSecret)?quoteSecret.length:Buffer.byteLength(String(quoteSecret||'')))>=16;
  const route=(path,handler)=>app.post(path,...(bodyMiddleware?[bodyMiddleware]:[]),async(req,res)=>{
    res.set('Cache-Control','private, no-store, max-age=0');
    try{
      if(!ready())throw err('VOICE_PASSKEY_UNAVAILABLE','Passkey approval is not configured for this Merchant.',503);
      const bid=Number(req.body?.business_id);
      if(!positiveId(bid))throw err('VOICE_CONTEXT_STALE','Select an active Merchant business.',400);
      const {me,business}=await requireMerchant(req,bid),aid=Number(me?.account?.id);
      if(!positiveId(aid)||Number(business.id)!==bid)throw err('VOICE_CONTEXT_STALE','Merchant context unavailable.',403);
      const sessionId=safeSessionId(req,aid,bid,quoteSecret),token=tokenFromReq(req);
      const output=await handler({req,businessId:bid,accountId:aid,sessionId,token});
      res.json(output);
    }catch(e){const status=[400,401,403,409,422,428,429,503].includes(e?.status)?e.status:503;
      res.status(status).json({error:safeCodes.has(e?.code)?e.message:'Device approval failed. Try again.',
        code:safeCodes.has(e?.code)?e.code:'VOICE_PASSKEY_INVALID'});}
  });
  const userHandle=aid=>b64(crypto.createHmac('sha256',quoteSecret).update(`voice-passkey-user:${aid}`).digest());
  const sessionCheck=(client,ctx)=>verifyStepUp(client,{
    token:ctx.token,tokenSecret,accountId:ctx.accountId,now:now()});
  async function transaction(cb){const client=await db.connect();try{
    await client.query('BEGIN');const value=await cb(client);await client.query('COMMIT');return value;
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}}
  async function limitChallenges(client,{businessId,accountId,kind}){
    // Avoid unbounded challenges/verification attempts while protecting registration by step-up.
    await client.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE',[accountId]);
    const q=await client.query(`SELECT COUNT(*)::int count FROM merchant_voice_passkey_challenges
      WHERE account_id=$1 AND business_id=$2 AND kind=$3
        AND created_at>NOW()-INTERVAL '1 minute'`,[accountId,businessId,kind]);
    if(Number(q.rows[0]?.count||0)>=6)throw err('VOICE_PASSKEY_RETRY_LIMIT','Too many device prompts. Try again later.',429);
  }
  async function createChallenge(client,ctx,kind,{quoteHash=null,requestKey=null,phrase=null}={}){
    await limitChallenges(client,{businessId:ctx.businessId,accountId:ctx.accountId,kind});
    const challenge=crypto.randomBytes(32),id=crypto.randomUUID();
    await client.query(`INSERT INTO merchant_voice_passkey_challenges
       (id,business_id,account_id,session_binding,kind,challenge_digest,quote_hash,request_key,phrase_digest,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()+INTERVAL '90 seconds')`,
       [id,ctx.businessId,ctx.accountId,ctx.sessionId,kind,hex(challenge),quoteHash,requestKey,
        phrase?phraseHash(id,phrase):null]);
    return{id,challenge:b64(challenge),expires_in_seconds:timeLimit};
  }
  route('/api/orders/voice/passkey/enroll/options',ctx=>transaction(async client=>{
    await sessionCheck(client,ctx);
    const existing=await client.query(`SELECT credential_id FROM merchant_voice_passkey_credentials
      WHERE account_id=$1 AND rp_id=$2 AND revoked_at IS NULL ORDER BY created_at LIMIT 6`,
      [ctx.accountId,config.rpId]);
    if(existing.rowCount>=5)throw err('VOICE_PASSKEY_LIMIT','Maximum of five active passkeys. Revoke an unused passkey first.',409);
    const challenge=await createChallenge(client,ctx,'register');
    return{challenge_id:challenge.id,publicKey:{challenge:challenge.challenge,
      rp:{id:config.rpId,name:'Business & Life'},
      user:{id:userHandle(ctx.accountId),name:'merchant-operator',displayName:'Merchant operator'},
      pubKeyCredParams:[{type:'public-key',alg:-7}],timeout:60000,
      authenticatorSelection:{residentKey:'preferred',userVerification:'required'},
      attestation:'none',excludeCredentials:existing.rows.map(serialiseCredential)}};
  }));
  route('/api/orders/voice/passkey/enroll/verify',ctx=>transaction(async client=>{
    await sessionCheck(client,ctx);
    const record=await lockChallenge(client,{id:reqId(ctx),kind:'register',
      accountId:ctx.accountId,businessId:ctx.businessId,sessionId:ctx.sessionId});
    const saved=verifyPasskeyRegistration({credential:ctx.req.body?.credential,
      challengeHash:b64(Buffer.from(record.challenge_digest,'hex')),origin:config.origin,rpId:config.rpId});
    await client.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE',[ctx.accountId]);
    const other=await client.query(`SELECT credential_id FROM merchant_voice_passkey_credentials
      WHERE account_id=$1 AND rp_id=$2 AND revoked_at IS NULL`,[ctx.accountId,config.rpId]);
    if(other.rowCount>=5)throw err('VOICE_PASSKEY_LIMIT','Maximum five passkeys reached.');
    const inserted=await client.query(`INSERT INTO merchant_voice_passkey_credentials
       (credential_id,account_id,rp_id,public_key_pem,user_handle,sign_count,backup_eligible)
       VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING credential_id`,
       [saved.credentialId,ctx.accountId,config.rpId,saved.publicKeyPem,userHandle(ctx.accountId),saved.signCount,saved.backupEligible]);
    if(inserted.rowCount!==1)throw err('VOICE_PASSKEY_INVALID','This passkey is already enrolled.');
    await client.query('UPDATE merchant_voice_passkey_challenges SET consumed_at=NOW() WHERE id=$1',[record.id]);
    return{enrolled:true,passkey_id:saved.credentialId};
  }));
  function reqId(ctx){return ctx.req.body?.challenge_id}
  route('/api/orders/voice/passkey/approval/options',ctx=>transaction(async client=>{
    await sessionCheck(client,ctx);
    const quote=verifyVoiceOrderSignedQuote({signedQuote:ctx.req.body?.signed_quote,
      businessId:ctx.businessId,accountId:ctx.accountId,sessionId:ctx.sessionId,
      secret:quoteSecret,now:now()});
    const key=ctx.req.body?.request_key;
    if(typeof key!=='string'||!/^[A-Za-z0-9_-]{24,100}$/.test(key))
      throw err('VOICE_PASSKEY_INVALID','Start a new order confirmation.');
    const saved=await client.query(`SELECT credential_id FROM merchant_voice_passkey_credentials
      WHERE account_id=$1 AND rp_id=$2 AND revoked_at IS NULL ORDER BY created_at LIMIT 6`,
      [ctx.accountId,config.rpId]);
    if(!saved.rowCount)throw err('VOICE_PASSKEY_NOT_ENROLLED','Register a phone passkey before confirming orders.',428);
    // Serialize replacement of outstanding challenges for this user before issuing a new one.
    await client.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE',[ctx.accountId]);
    await client.query(`UPDATE merchant_voice_passkey_challenges SET consumed_at=NOW()
      WHERE account_id=$1 AND business_id=$2 AND session_binding=$3 AND kind='approve'
        AND quote_hash=$4 AND request_key=$5 AND consumed_at IS NULL`,
      [ctx.accountId,ctx.businessId,ctx.sessionId,quote.quoteHash,key]);
    const phrase=intentPhrase(),challenge=await createChallenge(client,ctx,'approve',{
      quoteHash:quote.quoteHash,requestKey:key,phrase});
    return{challenge_id:challenge.id,confirmation_phrase:phrase,expires_in_seconds:challenge.expires_in_seconds,
      publicKey:{challenge:challenge.challenge,rpId:config.rpId,
        allowCredentials:saved.rows.map(serialiseCredential),userVerification:'required',timeout:60000}};
  }));
  return {ready,config,verifyDeviceApproval:(client,ctx)=>verifyVoiceDevicePasskey(client,{...ctx,config})};
}