const onlineMethods=new Set(['gcash','paymaya','qrph','card','grab_pay','shopeepay']);

export function payMongoPilotReadiness(config={},webhookState={},stage='controlled_pilot',evidence={}){
  const mode=String(config.mode||'test');
  const methods=Array.isArray(config.methods)?config.methods:[];
  const activeMethods=methods.filter(x=>onlineMethods.has(String(x)));
  const blockers=[];
  const liveStage=stage==='live_validation'||stage==='controlled_pilot';
  const controlled=stage==='controlled_pilot';

  if(!config.secretReady)blockers.push('PAYMONGO_SECRET_KEY_NOT_READY');
  if(!webhookState.ready&&!config.webhookReady)blockers.push('PAYMONGO_WEBHOOK_NOT_READY');
  if(!activeMethods.length)blockers.push('PAYMONGO_NO_ONLINE_METHOD_ENABLED');

  if(liveStage){
    if(mode!=='live')blockers.push('PAYMONGO_LIVE_MODE_REQUIRED_FOR_REAL_CUSTOMER_PILOT');
    if(!config.liveAllowed)blockers.push('PAYMONGO_LIVE_NOT_EXPLICITLY_ENABLED');
    if(config.keyMode!=='live')blockers.push('PAYMONGO_LIVE_SECRET_KEY_REQUIRED');
  }

  if(controlled){
    if(!evidence.live_payment_confirmed)blockers.push('PAYMONGO_LIVE_PAYMENT_EVIDENCE_MISSING');
    if(!evidence.live_reconciliation_matched)blockers.push('PAYMONGO_LIVE_RECONCILIATION_EVIDENCE_MISSING');
  }

  return{
    stage,
    state:blockers.length?'HOLD':'READY',
    paymongo_required:true,
    cash_supported:true,
    online_payment_required:true,
    provider:'paymongo',
    mode,
    enabled_methods:activeMethods,
    evidence:{
      live_payment_confirmed:Boolean(evidence.live_payment_confirmed),
      live_reconciliation_matched:Boolean(evidence.live_reconciliation_matched),
      latest_live_intent_public_id:evidence.latest_live_intent_public_id||'',
      latest_live_provider_payment_id:evidence.latest_live_provider_payment_id||'',
      latest_live_succeeded_at:evidence.latest_live_succeeded_at||null,
      reconciliation_run_public_id:evidence.reconciliation_run_public_id||''
    },
    blockers
  };
}

export function payMongoCheckoutPolicy(config={},webhookState={},{
  productionSurface=false,
  allowSandboxOnProduction=false,
  evidence={}
}={}){
  const requiredStage=productionSurface&&!allowSandboxOnProduction?'controlled_pilot':'internal';
  const readiness=payMongoPilotReadiness(config,webhookState,requiredStage,evidence);
  return{
    required_stage:requiredStage,
    production_surface:Boolean(productionSurface),
    sandbox_override:Boolean(allowSandboxOnProduction),
    checkout_enabled:readiness.state==='READY',
    state:readiness.state,
    mode:readiness.mode,
    enabled_methods:readiness.enabled_methods,
    evidence:readiness.evidence,
    blockers:readiness.blockers
  };
}
