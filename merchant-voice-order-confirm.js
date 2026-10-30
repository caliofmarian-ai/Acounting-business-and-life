/**
 * Merchant #863: separately authenticated, transaction-bound voice order approval.
 * This is a feature-gated explicit BUTTON action, never a speech/model tool.
 * The existing canonical Orders engine performs the only Order/stock writes.
 */
import {verifyV2SessionTokenSignature,AUTH_STEP_UP_TTL_MS} from './auth-session-core.js';
import {verifyVoiceOrderSignedQuote,assertVoiceQuoteMatchesSnapshots} from './merchant-voice-order-quote.js';
import {safeSessionId} from './merchant-voice-order-routes.js';
import {withVoiceOrderExactlyOnce} from './merchant-voice-order-idempotency.js';

const problem=(status,code,message)=>Object.assign(new Error(message),{status,code});
const positiveId=v=>Number.isSafeInteger(Number(v))&&Number(v)>0;
const allowed=new Set(['VOICE_CONFIRM_QUOTE_INVALID','VOICE_CONTEXT_STALE','VOICE_QUOTE_STALE',
  'VOICE_CREATE_BAD_REQUEST','VOICE_CREATE_KEY_REUSED','VOICE_CREATE_PENDING',
  'VOICE_STEP_UP_REQUIRED','VOICE_CONFIRMATION_REQUIRED','VOICE_CREATE_DISABLED',
  'HIGH_RISK_VELOCITY_LIMIT','VOICE_DEVICE_APPROVAL_REQUIRED',
  'VOICE_PASSKEY_INVALID','VOICE_PASSKEY_MISSING','VOICE_PASSKEY_EXPIRED',
  'VOICE_PASSKEY_PHRASE_INVALID','VOICE_CONTEXT_STALE','VOICE_PASSKEY_UNAVAILABLE']);

export async function requireVoiceOperatorStepUp(client,{token,tokenSecret,accountId,now=new Date()}={}){
  const current=verifyV2SessionTokenSignature(tokenSecret,token,{now:now.getTime()});
  if(!current||current.accountId!==Number(accountId))
    throw problem(428,'VOICE_STEP_UP_REQUIRED','Sign in again and verify your password to confirm the order.');
  // SAME database transaction and a shared lock: revocation cannot race approval.
  const locked=await client.query(`SELECT step_up_verified_at FROM account_sessions
    WHERE session_id=$1 AND account_id=$2 AND revoked_at IS NULL AND expires_at>NOW() FOR SHARE`,
    [current.sessionId,Number(accountId)]);
  const stamp=locked.rows?.[0]?.step_up_verified_at;
  const age=stamp?now.getTime()-new Date(stamp).getTime():Infinity;
  if(locked.rowCount!==1||!Number.isFinite(age)||age<0||age>AUTH_STEP_UP_TTL_MS)
    throw problem(428,'VOICE_STEP_UP_REQUIRED','Re-enter your password to verify this Merchant order.');
  return current;
}

export function installMerchantVoiceOrderConfirmation(app,{
  db,requireMerchant,quoteSecret,tokenSecret,canonicalSnapshots,createCanonicalOrder,orderDetail,
  bodyMiddleware,env=process.env,now=()=>new Date(),guard=withVoiceOrderExactlyOnce,
  checkCreateVelocity=async()=>{},verifyDeviceApproval=null
}={}){
  if(!app?.post||!db?.connect||typeof requireMerchant!=='function'||
     typeof canonicalSnapshots!=='function'||typeof createCanonicalOrder!=='function'||
     typeof orderDetail!=='function')throw new TypeError('Voice approval requires canonical Orders transaction services.');
  // The current Product has no verified device-held/passkey challenge adapter.
  // Deliberately fail CLOSED even when all environment flags are switched on.
  const ready=()=>env.ORDER_VOICE_UI_ENABLED==='1'&&env.ORDER_VOICE_AI_ENABLED==='1'&&
    env.ORDER_VOICE_CREATE_ENABLED==='1'&&typeof verifyDeviceApproval==='function';
  const route=async(req,res)=>{
    res.set('Cache-Control','private, no-store, max-age=0');
    try{
      const bid=Number(req.body?.business_id);
      if(!positiveId(bid))throw problem(400,'VOICE_CREATE_BAD_REQUEST','Select a valid Merchant business.');
      const {me,business}=await requireMerchant(req,bid);
      const aid=Number(me?.account?.id);
      if(!positiveId(aid)||Number(business?.id)!==bid)
        throw problem(403,'VOICE_CONTEXT_STALE','Merchant profile or business is unavailable.');
      if(!ready())throw problem(503,'VOICE_CREATE_DISABLED','Secure voice order confirmation is not enabled.');
      if(req.body?.operator_confirmed!==true)
        throw problem(400,'VOICE_CONFIRMATION_REQUIRED','Review the entire order and explicitly confirm it.');
      const token=String(req.ablSessionToken||req.headers?.authorization||'').replace(/^Bearer\s+/i,'').trim();
      const sessionId=safeSessionId(req,aid,bid,quoteSecret);
      // Authenticate the signed quote, including operator/session/business HMAC,
      // BEFORE any idempotent insertion. Expired signed quotes are only eligible
      // for retrieving the exact same previously created order on retries.
      const parsed=verifyVoiceOrderSignedQuote({signedQuote:req.body?.signed_quote,
        businessId:bid,accountId:aid,sessionId,secret:quoteSecret,now:now(),allowExpired:true});
      const result=await guard(db,{
        businessId:bid,accountId:aid,requestKey:req.body?.request_key,
        quoteHash:parsed.quoteHash,
        createWithClient:async client=>{
          if(Date.parse(parsed.quote.expires_at)<=now().getTime())
            throw problem(409,'VOICE_QUOTE_STALE','Order quote expired. Check the current price again.');
          await requireVoiceOperatorStepUp(client,{token,tokenSecret,accountId:aid,now:now()});
          // A separate server-side, device-held challenge verification must be
          // implemented and consumed atomically before the create release gate.
          // A browser-supplied boolean or transcribed phrase is NEVER proof.
          const deviceOk=await verifyDeviceApproval(client,{req,accountId:aid,businessId:bid,
            sessionId,quoteHash:parsed.quoteHash,requestKey:req.body?.request_key});
          if(deviceOk!==true)throw problem(428,'VOICE_DEVICE_APPROVAL_REQUIRED',
            'Device approval is required before creating a voice order.');
          const snapshots=await canonicalSnapshots(client,{businessId:bid,items:parsed.orderItems});
          assertVoiceQuoteMatchesSnapshots(parsed.quote,snapshots);
          // Match the same anti-abuse decision used by manual Merchant create.
          // This callback runs only for a new idempotency claim, not a retry.
          await checkCreateVelocity({accountId:aid,businessId:bid});
          // Existing canonical engine: SAME PostgreSQL client/transaction,
          // quantity/prices locked and revalidated, stock reserves only once.
          return createCanonicalOrder({businessId:bid,customerAccountId:null,
            customerName:parsed.quote.customer_name,customerContact:'',items:parsed.orderItems,
            fulfilmentMethod:'pickup',paymentMethod:'cash',counterPresence:false,
            merchantCounter:true,expectedCurrencyCode:'PHP',client});
        }
      });
      const order=await orderDetail(result.order_id);
      if(!order||Number(order.business_id)!==bid)
        throw problem(503,'VOICE_CREATE_RESULT_INVALID','The order was recorded but details could not be read. Refresh Orders.');
      // Never present unpaid cash/pickup as a payment, even after successful creation.
      return res.status(result.replayed?200:201).json({order_id:result.order_id,
        order_number:String(order.order_number||''),replayed:result.replayed,
        payment_status:order.payment_status,order_status:order.order_status,
        currency_code:order.currency_code,subtotal:order.subtotal,total:order.total});
    }catch(error){
      const code=String(error?.code||'');const status=[400,401,403,409,422,428,429,503].includes(error?.status)?error.status:503;
      if(status===429)res.set('Retry-After',String(Math.max(1,Number(error.retryAfterSeconds)||60)));
      if(status===428)res.set('Cache-Control','private, no-store, max-age=0');
      return res.status(status).json({code:allowed.has(code)?code:'VOICE_CREATE_UNAVAILABLE',
        error:allowed.has(code)?String(error.message||'Please try again.').slice(0,220):
          'Order confirmation failed. Check the current order status before retrying.'});
    }
  };
  if(bodyMiddleware)app.post('/api/orders/voice/confirm',bodyMiddleware,route);
  else app.post('/api/orders/voice/confirm',route);
  return {ready};
}