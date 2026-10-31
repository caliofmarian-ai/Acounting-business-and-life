/**
 * Issue #863: authenticated, feature-gated, non-posting voice order draft turns.
 * The existing Orders service owns authentication, Catalog and all future order
 * posting. Nothing here writes to Orders, Inventory, payments or accounting.
 */
import crypto from 'node:crypto';
import {applyVoiceOrderTurn,voiceDraftForQuote} from './merchant-voice-order-core.js';
import {authoritativeVoiceOrderQuote} from './merchant-voice-order-quote.js';
import {interpretVoiceOrderText,voiceOrderAIConfig} from './merchant-voice-order-provider.js';

const fail=(status,code,message)=>Object.assign(new Error(message),{status,code});
const positiveId=value=>Number.isSafeInteger(Number(value))&&Number(value)>0;
const privateMessage='The voice-order assistant could not process this turn. Edit the text or try again.';
const allowedCodes=new Set([
  'VOICE_CONTEXT_STALE','VOICE_CONTEXT_REQUIRED','VOICE_TURN_INVALID','VOICE_ACTION_INVALID',
  'CATALOG_LIMIT','CROSS_BUSINESS_CATALOG','DUPLICATE_CATALOG_ID',
  'DRAFT_INVALID','DRAFT_PRODUCT_STALE','PRODUCT_UNKNOWN','PRODUCT_AMBIGUOUS',
  'PRODUCT_UNCLEAR','PRODUCT_UNAVAILABLE','VARIANT_REQUIRED','VARIANT_INVALID',
  'VARIANT_AMBIGUOUS','VARIANT_UNKNOWN','VARIANT_UNAVAILABLE',
  'MODIFIER_INVALID','MODIFIER_AMBIGUOUS','MODIFIER_UNKNOWN',
  'MODIFIER_DUPLICATE','MODIFIER_GROUP_INVALID','MODIFIER_SELECTION_REQUIRED',
  'QUANTITY_UNCLEAR','QUANTITY_LIMIT','LINE_LIMIT','LINE_UNCLEAR',
  'LINE_UNKNOWN','LINE_AMBIGUOUS','VOICE_CLEAR_UNCLEAR','CUSTOMER_UNCLEAR',
  'ORDER_TOTAL_LIMIT','INVALID_CATALOG_PRICE','DRAFT_EMPTY','VOICE_QUOTE_STALE'
]);

function responseError(res,error){
  const status=[400,401,403,409,413,422,429,503].includes(error?.status)?error.status:503;
  // Do not log transcripts, customer names, credentials or untrusted provider responses.
  const code=String(error?.code||'');
  const safe=allowedCodes.has(code) || ['ORDER_VOICE_RATE_LIMIT','ORDER_VOICE_BAD_REQUEST',
    'ORDER_VOICE_NOT_CONFIGURED','ORDER_VOICE_CONSENT_REQUIRED',
    'ORDER_VOICE_SESSION_REQUIRED','ORDER_VOICE_CATALOG_EMPTY','ORDER_VOICE_QUOTA',
    'TEAM_SHIFT_REQUIRED','TEAM_PERMISSION_DENIED','TEAM_OPERATOR_INACTIVE','TEAM_ACCOUNT_SESSION'].includes(code);
  const payload={error:safe?String(error.message).slice(0,230):privateMessage,code:safe?code:'ORDER_VOICE_UNAVAILABLE'};
  if(status===429)res.set('Retry-After','60');
  return res.status(status).json(payload);
}
export function safeSessionId(req,accountId,businessId,secret){
  const token=String(req.ablSessionToken||req.headers?.authorization||'').replace(/^Bearer\s+/i,'').trim();
  if(!token || token.length>10000)throw fail(401,'ORDER_VOICE_SESSION_REQUIRED','Sign in again to use the Merchant assistant.');
  return crypto.createHmac('sha256',secret).update(`${accountId}:${businessId}:`).update(token).digest('base64url').slice(0,48);
}
const MAX_TRANSCRIPT=1200;
function guardBody(body){
  if(!body||typeof body!=='object'||Array.isArray(body)||!positiveId(body.business_id))
    throw fail(400,'ORDER_VOICE_BAD_REQUEST','Choose a valid Merchant business.');
  if(body.consent!==true)throw fail(403,'ORDER_VOICE_CONSENT_REQUIRED','Allow voice/text processing for this turn first.');
  if(typeof body.transcript!=='string'||!body.transcript.trim()||body.transcript.length>MAX_TRANSCRIPT)
    throw fail(400,'ORDER_VOICE_BAD_REQUEST','Enter a spoken or typed instruction of up to 1,200 characters.');
  if(body.previous_draft!=null){
    if(typeof body.previous_draft!=='object'||Array.isArray(body.previous_draft))
      throw fail(400,'ORDER_VOICE_BAD_REQUEST','Voice order draft is invalid. Start again.');
    // Previous drafts are revalidated line by line against server Catalog.
    if(JSON.stringify(body.previous_draft).length>40000)
      throw fail(413,'ORDER_VOICE_BAD_REQUEST','Voice order draft is too large. Start again.');
  }
}

/** Atomic database cost guard across workers; distinct rows for minute and day. */
export async function ensureVoiceOrderUsageSchema(db){
  await db.query(`CREATE TABLE IF NOT EXISTS merchant_voice_order_ai_usage (
    business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    window_kind TEXT NOT NULL CHECK (window_kind IN ('minute','day')),
    window_start TIMESTAMPTZ NOT NULL,
    calls INTEGER NOT NULL CHECK (calls BETWEEN 0 AND 100000),
    PRIMARY KEY(business_id,account_id,window_kind,window_start)
  )`);
}
export async function chargeVoiceOrderQuota(db,{businessId,accountId,now=new Date(),minuteLimit=6,dayLimit=60}={}){
  const bid=Number(businessId),aid=Number(accountId);
  if(!positiveId(bid)||!positiveId(aid))throw fail(403,'ORDER_VOICE_SESSION_REQUIRED','Merchant operator is required.');
  const minute=new Date(Math.floor(now.getTime()/60000)*60000),day=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));
  const client=await db.connect();
  try{
    await client.query('BEGIN');
    for(const [kind,start,limit] of [['minute',minute,minuteLimit],['day',day,dayLimit]]){
      const result=await client.query(`INSERT INTO merchant_voice_order_ai_usage (business_id,account_id,window_kind,window_start,calls)
        VALUES($1,$2,$3,$4,1)
        ON CONFLICT (business_id,account_id,window_kind,window_start)
        DO UPDATE SET calls=merchant_voice_order_ai_usage.calls+1
         WHERE merchant_voice_order_ai_usage.calls<$5 RETURNING calls`,[bid,aid,kind,start,limit]);
      if(result.rowCount!==1)throw fail(429,'ORDER_VOICE_RATE_LIMIT','Voice assistant limit reached. Enter orders manually or try again later.');
    }
    await client.query('COMMIT');
    return true;
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}
  finally{client.release()}
}

/** Allows fake Express app, authorized catalog and provider in isolated tests. */
export function installMerchantVoiceOrderRoutes(app,{
  db,requireMerchant,catalogForBusiness,snapshotsForBusiness,bodyMiddleware=null,
  env=process.env,fetchImpl=fetch,secret=crypto.randomBytes(32),
  interpret=interpretVoiceOrderText,chargeQuota=chargeVoiceOrderQuota,
  confirmationReady=()=>false,passkeyReady=()=>false,
  teamEnabled=()=>false,operatorResolver=null
}={}){
  if(!app||typeof app.get!=='function'||typeof app.post!=='function'||typeof requireMerchant!=='function'||typeof catalogForBusiness!=='function')
    throw new TypeError('Voice Orders requires the canonical Orders router, auth and Merchant Catalog.');
  const secretBytes=Buffer.isBuffer(secret)?secret:Buffer.from(secret);
  const flagOn=()=>env.ORDER_VOICE_UI_ENABLED==='1';
  const ready=()=>flagOn()&&voiceOrderAIConfig(env).ready;
  const requireContext=async(req,businessId)=>{
    if(!positiveId(businessId))throw fail(400,'ORDER_VOICE_BAD_REQUEST','Choose a valid Merchant business.');
    const {me,business}=await requireMerchant(req,Number(businessId));
    if(!positiveId(me?.account?.id)||Number(business?.id)!==Number(businessId))
      throw fail(403,'ORDER_VOICE_SESSION_REQUIRED','Merchant operator or business is unavailable.');
    const accountId=Number(me.account.id),businessId=Number(business.id);
    let sessionId=safeSessionId(req,accountId,businessId,secretBytes),operator=null;
    if(teamEnabled()){
      if(typeof operatorResolver!=='function')
        throw fail(503,'ORDER_VOICE_NOT_CONFIGURED','Operator shifts are not configured.');
      operator=await operatorResolver(req,{accountId,businessId,permission:'orders.voice_draft'});
      if(!operator?.operator_id||!operator?.shift_id)
        throw fail(403,'TEAM_SHIFT_REQUIRED','Choose an authorized operator before using voice orders.');
      // Shift ID and operator identity are cryptographically bound into the
      // session. A different helper cannot reuse this unfinished draft/quote.
      sessionId=crypto.createHmac('sha256',secretBytes)
        .update('merchant-team-voice:'+sessionId+':'+operator.operator_id+':'+operator.shift_id)
        .digest('hex').slice(0,48);
    }
    return{accountId,businessId,sessionId,operator};
  };
  app.get('/api/orders/voice/capabilities',async(req,res)=>{
    res.set('Cache-Control','private, no-store');
    try{
      const ctx=await requireContext(req,req.query?.business_id);
      res.json({business_id:ctx.businessId,enabled:ready(),mode:'push_to_talk_turns',
        languages:['en-PH','fil-PH'],creates_orders:false,
        team_enabled:teamEnabled(),operator:ctx.operator?{id:ctx.operator.operator_id,name:ctx.operator.name,shift_id:ctx.operator.shift_id}:null,
        can_confirm_order:!teamEnabled()&&ready()&&env.ORDER_VOICE_CREATE_ENABLED==='1'&&confirmationReady(),
        passkey_enrollment_available:!teamEnabled()&&ready()&&passkeyReady(),
        reason:ready()?null:'Voice AI is not available for this Merchant yet. Use the regular counter order.'});
    }catch(error){responseError(res,error)}
  });
  const quoteHandler=async(req,res)=>{
    res.set('Cache-Control','private, no-store');
    try{
      const ctx=await requireContext(req,req.body?.business_id);
      if(!ready())throw fail(503,'ORDER_VOICE_NOT_CONFIGURED','Voice AI is not available. Use the normal counter order.');
      if(req.body?.consent!==true)throw fail(403,'ORDER_VOICE_CONSENT_REQUIRED','Consent is required for an order quote.');
      if(!req.body?.draft||typeof req.body.draft!=='object'||Array.isArray(req.body.draft)||JSON.stringify(req.body.draft).length>40000)
        throw fail(400,'ORDER_VOICE_BAD_REQUEST','Provide a current Merchant voice order draft.');
      if(typeof snapshotsForBusiness!=='function')throw fail(503,'ORDER_VOICE_NOT_CONFIGURED','Authoritative quoting is not configured.');
      const catalog=await catalogForBusiness(ctx.businessId);
      const validated=applyVoiceOrderTurn({businessId:ctx.businessId,sessionId:ctx.sessionId,catalog,
        previousDraft:req.body.draft,turn:{operations:[]}}).draft;
      const items=voiceDraftForQuote(validated).items;
      await chargeQuota(db,{businessId:ctx.businessId,accountId:ctx.accountId});
      const snapshots=await snapshotsForBusiness({businessId:ctx.businessId,items});
      const quote=authoritativeVoiceOrderQuote({draft:validated,snapshots,accountId:ctx.accountId,
        businessId:ctx.businessId,sessionId:ctx.sessionId,secret:secretBytes});
      if(ctx.operator)await db.query(`INSERT INTO merchant_team_events(business_id,operator_id,shift_id,actor_account_id,event_code)
        VALUES($1,$2,$3,$4,'voice.quote')`,[ctx.businessId,ctx.operator.operator_id,ctx.operator.shift_id,ctx.accountId]);
      res.json({...quote,operator_id:ctx.operator?.operator_id||null});
    }catch(error){responseError(res,error)}
  };
  if(bodyMiddleware)app.post('/api/orders/voice/quote',bodyMiddleware,quoteHandler);
  else app.post('/api/orders/voice/quote',quoteHandler);

  const handler=async(req,res)=>{
    res.set('Cache-Control','private, no-store');
    try{
      // Verify authenticated exact Merchant BEFORE reading or invoking the model.
      const ctx=await requireContext(req,req.body?.business_id);
      if(!ready())throw fail(503,'ORDER_VOICE_NOT_CONFIGURED','Voice AI is not available. Use the normal counter order.');
      guardBody(req.body);
      const catalog=await catalogForBusiness(ctx.businessId);
      if(!Array.isArray(catalog)||!catalog.some(p=>p.active!==false&&p.available===true))
        throw fail(409,'ORDER_VOICE_CATALOG_EMPTY','Create active sellable products in Catalog first.');
      // First revalidate the previous client-held draft even if the provider fails.
      const checked=applyVoiceOrderTurn({businessId:ctx.businessId,sessionId:ctx.sessionId,catalog,
        previousDraft:req.body.previous_draft??null,turn:{operations:[]}});
      await chargeQuota(db,{businessId:ctx.businessId,accountId:ctx.accountId});
      const turn=await interpret({transcript:req.body.transcript,catalog,priorLines:checked.draft.lines,
        consent:true,env,fetchImpl});
      const output=applyVoiceOrderTurn({businessId:ctx.businessId,sessionId:ctx.sessionId,catalog,
        previousDraft:checked.draft,turn});
      if(ctx.operator)await db.query(`INSERT INTO merchant_team_events(business_id,operator_id,shift_id,actor_account_id,event_code)
        VALUES($1,$2,$3,$4,'voice.turn')`,[ctx.businessId,ctx.operator.operator_id,ctx.operator.shift_id,ctx.accountId]);
      res.json({...output,mode:'push_to_talk_turns',creates_orders:false,
        operator_id:ctx.operator?.operator_id||null});
    }catch(error){responseError(res,error)}
  };
  if(bodyMiddleware)app.post('/api/orders/voice/turn',bodyMiddleware,handler);
  else app.post('/api/orders/voice/turn',handler);
  return {ready};
}