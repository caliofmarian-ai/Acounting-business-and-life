export const CRYPTO_LOGICAL_METHOD='crypto';
export const CRYPTO_CANONICAL_CURRENCY='PHP';

export const CRYPTO_PROVIDER_METHODS=Object.freeze([
  'createQuote',
  'createPaymentIntent',
  'getPaymentStatus',
  'verifyWebhook',
  'reconcilePayment',
  'requestRefund',
  'getSettlementEvidence'
]);

const clean=(v,max=200)=>String(v??'').trim().slice(0,max);
const positive=(v,label)=>{
  const n=Number(v);
  if(!Number.isFinite(n)||n<=0)throw Object.assign(new Error(label+' must be greater than zero'),{status:400});
  return n;
};

export function cryptoProviderContractStatus(adapter){
  const missing=CRYPTO_PROVIDER_METHODS.filter(name=>typeof adapter?.[name]!=='function');
  return{
    ready:missing.length===0,
    logical_method:CRYPTO_LOGICAL_METHOD,
    canonical_currency:CRYPTO_CANONICAL_CURRENCY,
    missing_methods:missing
  };
}

export function normalizeCryptoQuote(input,{expectedPhpAmount,now=Date.now()}={}){
  const providerCode=clean(input?.provider_code,80);
  const quoteId=clean(input?.quote_id,160);
  const asset=clean(input?.asset,40);
  const network=clean(input?.network,80);
  const destination=clean(input?.destination,500);
  const currency=clean(input?.fiat_currency||CRYPTO_CANONICAL_CURRENCY,10).toUpperCase();
  const phpAmount=positive(input?.fiat_amount,'Fiat amount');
  const cryptoAmount=positive(input?.crypto_amount,'Crypto amount');
  const expiresAt=new Date(input?.expires_at||0);
  if(!providerCode)throw Object.assign(new Error('Crypto quote provider is required'),{status:400});
  if(!quoteId)throw Object.assign(new Error('Crypto quote id is required'),{status:400});
  if(!asset)throw Object.assign(new Error('Crypto asset is required'),{status:400});
  if(!network)throw Object.assign(new Error('Crypto network is required'),{status:400});
  if(!destination)throw Object.assign(new Error('Crypto payment destination is required'),{status:400});
  if(currency!==CRYPTO_CANONICAL_CURRENCY)throw Object.assign(new Error('PH crypto checkout must keep PHP as canonical fiat currency'),{status:409});
  if(Number.isFinite(Number(expectedPhpAmount))&&Math.abs(phpAmount-Number(expectedPhpAmount))>0.001){
    throw Object.assign(new Error('Crypto quote does not match the canonical PHP commercial amount'),{status:409});
  }
  if(Number.isNaN(expiresAt.getTime())||expiresAt.getTime()<=Number(now)){
    throw Object.assign(new Error('Crypto quote is expired or invalid'),{status:409});
  }
  const rate=input?.exchange_rate==null?null:positive(input.exchange_rate,'Exchange rate');
  return{
    provider_code:providerCode,
    quote_id:quoteId,
    fiat_currency:currency,
    fiat_amount:Math.round((phpAmount+Number.EPSILON)*100)/100,
    asset,
    network,
    crypto_amount:cryptoAmount,
    destination,
    qr_payload:clean(input?.qr_payload,2000),
    exchange_rate:rate,
    created_at:input?.created_at?new Date(input.created_at).toISOString():new Date(Number(now)).toISOString(),
    expires_at:expiresAt.toISOString(),
    provider_fee_php:input?.provider_fee_php==null?null:Math.max(0,Number(input.provider_fee_php)||0),
    network_fee_asset:input?.network_fee_asset==null?null:Math.max(0,Number(input.network_fee_asset)||0),
    raw_reference:clean(input?.raw_reference,300)
  };
}

export function cryptoActivationGate({providerConfigured=false,providerRegulatoryVerified=false,kybReady=false,webhookReady=false,reconciliationReady=false,liveMoneyEvidence=false}={}){
  const blockers=[];
  if(!providerConfigured)blockers.push('CRYPTO_PROVIDER_NOT_CONFIGURED');
  if(!providerRegulatoryVerified)blockers.push('VASP_REGULATORY_STATUS_NOT_VERIFIED');
  if(!kybReady)blockers.push('PROVIDER_KYB_KYC_AML_NOT_READY');
  if(!webhookReady)blockers.push('CRYPTO_WEBHOOK_NOT_READY');
  if(!reconciliationReady)blockers.push('CRYPTO_RECONCILIATION_NOT_READY');
  if(!liveMoneyEvidence)blockers.push('LIVE_CRYPTO_MONEY_EVIDENCE_MISSING');
  return{
    state:blockers.length?'HOLD':'READY',
    enabled:blockers.length===0,
    logical_method:CRYPTO_LOGICAL_METHOD,
    canonical_currency:CRYPTO_CANONICAL_CURRENCY,
    blockers
  };
}
