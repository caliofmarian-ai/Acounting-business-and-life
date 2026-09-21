export function startupWaitAttempts(baseAttempts,env=process.env){
  const base=Math.max(1,Math.floor(Number(baseAttempts)||1));
  return String(env.APP_ENV||'').trim().toLowerCase()==='qa'?base*2:base;
}
