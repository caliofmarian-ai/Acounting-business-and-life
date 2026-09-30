export const DELIVERY_OFFER_TTL_DEFAULT_SECONDS=120;
export const DELIVERY_OFFER_TTL_MIN_SECONDS=30;
export const DELIVERY_OFFER_TTL_MAX_SECONDS=600;

export function deliveryOfferTtlSeconds(env=process.env){
  const raw=Number(env?.DELIVERY_OFFER_TTL_SECONDS);
  if(!Number.isFinite(raw))return DELIVERY_OFFER_TTL_DEFAULT_SECONDS;
  return Math.max(
    DELIVERY_OFFER_TTL_MIN_SECONDS,
    Math.min(DELIVERY_OFFER_TTL_MAX_SECONDS,Math.round(raw))
  );
}

export function deliveryOfferExpiresAt({
  nowMs=Date.now(),
  ttlSeconds=DELIVERY_OFFER_TTL_DEFAULT_SECONDS
}={}){
  const bounded=Math.max(
    DELIVERY_OFFER_TTL_MIN_SECONDS,
    Math.min(DELIVERY_OFFER_TTL_MAX_SECONDS,Math.round(Number(ttlSeconds)||DELIVERY_OFFER_TTL_DEFAULT_SECONDS))
  );
  return new Date(Number(nowMs)+bounded*1000).toISOString();
}

export function deliveryOfferExpired(expiresAt,{nowMs=Date.now()}={}){
  if(!expiresAt)return false;
  const expiry=new Date(expiresAt).getTime();
  if(!Number.isFinite(expiry))return true;
  return expiry<=Number(nowMs);
}
