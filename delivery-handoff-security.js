export const HANDOFF_MAX_FAILED_ATTEMPTS=5;
export const HANDOFF_LOCK_MS=15*60*1000;

function timestamp(value){
  if(value==null||value==='')return NaN;
  if(value instanceof Date)return value.getTime();
  if(typeof value==='number')return value;
  return Date.parse(String(value));
}

export function handoffLockActive(lockedUntil,now=Date.now()){
  const current=Number(now);
  const locked=timestamp(lockedUntil);
  return Number.isFinite(current)&&Number.isFinite(locked)&&locked>current;
}

export function nextHandoffFailureState({failedAttempts=0,lockedUntil=null,now=Date.now()}={}){
  const current=Number(now);
  if(!Number.isFinite(current))throw new Error('Valid current time required');
  const lockedAt=timestamp(lockedUntil);
  if(Number.isFinite(lockedAt)&&lockedAt>current){
    return{
      failedAttempts:Math.max(0,Math.trunc(Number(failedAttempts)||0)),
      locked:true,
      lockedUntil:new Date(lockedAt).toISOString(),
      attemptsRemaining:0
    };
  }
  const base=Number.isFinite(lockedAt)&&lockedAt<=current
    ?0
    :Math.max(0,Math.trunc(Number(failedAttempts)||0));
  const next=base+1;
  const locked=next>=HANDOFF_MAX_FAILED_ATTEMPTS;
  return{
    failedAttempts:next,
    locked,
    lockedUntil:locked?new Date(current+HANDOFF_LOCK_MS).toISOString():null,
    attemptsRemaining:locked?0:HANDOFF_MAX_FAILED_ATTEMPTS-next
  };
}
