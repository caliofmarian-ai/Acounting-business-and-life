// #881: reusable HTTP adapter for the receiving-intent coordinator.
// NOT mounted by the application until #841/#821 origin binding is released.
// The integrator must provide current session + Merchant authorization and
// one transaction-scoped PostgreSQL grant checker (never a cached role flag).
import {
  executeInventoryPurchaseIntent,
  inspectInventoryPurchaseIntent,
  inventoryPurchaseFingerprint
} from './inventory-purchase-intent-core.js';

const httpError=(message,code,status)=>
  Object.assign(new Error(message),{code,status});
const identifier=value=>{
  if(typeof value==='number'&&(!Number.isSafeInteger(value)||value<=0))return null;
  if(typeof value!=='number'&&typeof value!=='string'&&typeof value!=='bigint')return null;
  const raw=String(value);
  if(!/^[1-9][0-9]{0,18}$/.test(raw)||BigInt(raw)>9223372036854775807n)return null;
  return raw;
};

export function createInventoryPurchaseIntentHttpHandlers({
  pool,authorizeOrigin,verifyCurrentMerchantAuthority,createPurchase
}){
  if(typeof pool?.connect!=='function'||typeof authorizeOrigin!=='function'||
     typeof verifyCurrentMerchantAuthority!=='function'||typeof createPurchase!=='function'){
    throw new Error('HTTP purchase intent requires transactional pool, bound session authority, live DB grant and writer');
  }
  async function handle(req,res,next,readOnly){
    // Purchase and reconciliation responses can include private Merchant
    // stock/expense evidence. Never allow browser/intermediary caching, even
    // for authorization failures, replays or indeterminate transaction errors.
    // Real Express ServerResponse always exposes setHeader; local synthetic
    // response fakes may omit it.
    if(typeof res.setHeader==='function'){
      res.setHeader('Cache-Control','private, no-store');
    }
    let client;
    // A lost COMMIT acknowledgement leaves transaction state indeterminate.
    // node-postgres removes a connection from the pool when release(err) is used;
    // never lend that potentially broken session to another Merchant request.
    let discardConnectionError=null;
    try{
      if(!req.body||typeof req.body!=='object'||Array.isArray(req.body)){
        throw httpError('Purchase instructions must be a JSON object',
          'INVENTORY_PURCHASE_INTENT_INVALID',400);
      }
      // Capture the economic instructions BEFORE the first asynchronous gap.
      // A later replacement of req.body must never let the writer post a
      // different stock/expense payload than the intent's original fingerprint.
      const initiatingPayload=req.body;
      const initiatingFingerprint=inventoryPurchaseFingerprint(initiatingPayload);
      const assertInitiatingPayloadUnchanged=()=>{
        try{
          if(req.body!==initiatingPayload||
             inventoryPurchaseFingerprint(initiatingPayload)!==initiatingFingerprint){
            throw new Error('Request body replaced or mutated');
          }
        }catch{
          throw httpError('Purchase instructions changed during receiving; reopen the original operation',
            'INVENTORY_PURCHASE_INTENT_CONFLICT',409);
        }
      };
      const origin=await authorizeOrigin(req);
      assertInitiatingPayloadUnchanged();
      const businessId=identifier(origin?.businessId);
      const accountId=identifier(origin?.accountId);
      if(origin?.role!=='merchant'||!businessId||!accountId){
        throw httpError('Current Merchant session required',
          'INVENTORY_PURCHASE_INTENT_FORBIDDEN',403);
      }
      // Never infer the intended business from a new/current preference after
      // transport. The originating business is explicit and must still match
      // the authenticated, currently bound Merchant business.
      if(!identifier(initiatingPayload.origin_business_id)||
         identifier(initiatingPayload.origin_business_id)!==businessId){
        throw httpError('Purchase originated in a different Merchant business',
          'INVENTORY_PURCHASE_INTENT_CONFLICT',409);
      }
      const intentKey=req.get('Idempotency-Key');
      // Reject edits/replacements even after authorization and all subsequent
      // asynchronous DB waits; the coordinator separately enforces this on its
      // captured body at each transaction boundary.
      assertInitiatingPayloadUnchanged();
      const guardedContext={
        businessId,accountId,intentKey,payload:initiatingPayload,
        verifyCurrentMerchantAuthority:async(tx,claim)=>{
          assertInitiatingPayloadUnchanged();
          const allowed=await verifyCurrentMerchantAuthority(tx,claim,req);
          assertInitiatingPayloadUnchanged();
          return allowed===true;
        }
      };
      client=await pool.connect();
      assertInitiatingPayloadUnchanged();
      if(readOnly){
        const result=await inspectInventoryPurchaseIntent(client,guardedContext);
        if(result.kind==='unconfirmed'){
          return res.status(202).json({status:'unconfirmed',safe_to_retry:false,
            message:'No committed record confirmed. Do not post again without reconciliation.'});
        }
        return res.status(200).json({status:'committed',safe_to_retry:false,
          purchase_id:result.purchaseId,original_response:result.response});
      }
      const result=await executeInventoryPurchaseIntent(client,guardedContext,
        tx=>createPurchase(tx,Object.freeze({businessId,accountId,intentKey}),initiatingPayload));
      return res.status(result.kind==='new'?201:200).json(result.response);
    }catch(error){
      if(error?.code==='INVENTORY_PURCHASE_INTENT_BEGIN_UNKNOWN'||
         error?.code==='INVENTORY_PURCHASE_INTENT_COMMIT_UNKNOWN'||
         error?.code==='INVENTORY_PURCHASE_INTENT_READ_COMMIT_UNKNOWN'||
         error?.code==='INVENTORY_PURCHASE_INTENT_ROLLBACK_UNKNOWN'){
        discardConnectionError=error.cause instanceof Error?error.cause:error;
        return res.status(503).json({code:error.code,safe_to_retry:false,
          message:error.code==='INVENTORY_PURCHASE_INTENT_BEGIN_UNKNOWN'
            ?'Transaction start acknowledgement lost. Reconcile the original intent before attempting another purchase.'
            :error.code==='INVENTORY_PURCHASE_INTENT_COMMIT_UNKNOWN'
            ?'Outcome unknown. Inspect this original intent key before any further purchase.'
            :error.code==='INVENTORY_PURCHASE_INTENT_READ_COMMIT_UNKNOWN'
              ?'Replay or inspection acknowledgement lost. Reconcile the original intent before another purchase.'
              :'Rollback could not be confirmed. Reconcile the original intent before another purchase.'});
      }
      if(Number.isInteger(error?.status)&&error.status>=400&&error.status<500){
        return res.status(error.status).json({code:error.code||'INVENTORY_PURCHASE_INTENT_INVALID',
          error:error.message});
      }
      return next(error);
    }finally{
      if(client){
        if(discardConnectionError)client.release(discardConnectionError);
        else client.release();
      }
    }
  }
  return Object.freeze({
    purchase:(req,res,next)=>handle(req,res,next,false),
    inspect:(req,res,next)=>handle(req,res,next,true)
  });
}
