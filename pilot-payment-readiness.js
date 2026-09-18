const onlineMethods=new Set(['gcash','paymaya','qrph','card','grab_pay','shopeepay']);

export function payMongoPilotReadiness(config={},webhookState={},stage='controlled_pilot'){
  const mode=String(config.mode||'test');
  const methods=Array.isArray(config.methods)?config.methods:[];
  const activeMethods=methods.filter(x=>onlineMethods.has(String(x)));
  const blockers=[];
  const controlled=stage==='controlled_pilot';

  if(!config.secretReady)blockers.push('PAYMONGO_SECRET_KEY_NOT_READY');
  if(!webhookState.ready&&!config.webhookReady)blockers.push('PAYMONGO_WEBHOOK_NOT_READY');
  if(!activeMethods.length)blockers.push('PAYMONGO_NO_ONLINE_METHOD_ENABLED');

  if(controlled){
    if(mode!=='live')blockers.push('PAYMONGO_LIVE_MODE_REQUIRED_FOR_REAL_CUSTOMER_PILOT');
    if(!config.liveAllowed)blockers.push('PAYMONGO_LIVE_NOT_EXPLICITLY_ENABLED');
    if(config.keyMode!=='live')blockers.push('PAYMONGO_LIVE_SECRET_KEY_REQUIRED');
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
    blockers
  };
}
