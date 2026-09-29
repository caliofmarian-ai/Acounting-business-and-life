import crypto from 'node:crypto';

export const SESSION_COOKIE_NAME='__Host-abl_session';
export const CSRF_COOKIE_NAME='__Host-abl_csrf';
export const SESSION_COOKIE_MAX_AGE_SECONDS=24*60*60;

const SAFE_METHODS=new Set(['GET','HEAD','OPTIONS']);
// Credential bootstrap and recovery must remain reachable when a revoked or
// expired HttpOnly cookie outlives its readable CSRF companion. These routes
// either establish a fresh session, consume a one-time credential, or clear it.
const SESSION_BOOTSTRAP_PATHS=new Set([
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/email/preflight',
  '/api/auth/registration/verify',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/owner-migrate',
  '/api/auth/oauth/handoff',
  '/api/auth/email-verification/verify',
  '/api/auth/logout'
]);

function headerValue(headers,name){
  if(!headers)return'';
  if(typeof headers.get==='function')return String(headers.get(name)||'');
  const lower=String(name).toLowerCase();
  if(headers[lower]!=null)return String(headers[lower]);
  for(const [key,value] of Object.entries(headers))if(String(key).toLowerCase()===lower)return String(value??'');
  return'';
}

function decodeCookieValue(value){
  try{return decodeURIComponent(String(value||''))}catch{return''}
}

export function parseCookieHeader(header=''){
  const cookies={};
  for(const part of String(header||'').split(';')){
    const separator=part.indexOf('=');
    if(separator<1)continue;
    const name=part.slice(0,separator).trim();
    if(!name||Object.prototype.hasOwnProperty.call(cookies,name))continue;
    cookies[name]=decodeCookieValue(part.slice(separator+1).trim());
  }
  return cookies;
}

export function sessionCredentialFromHeaders(headers={}){
  const authorization=headerValue(headers,'authorization');
  const bearer=authorization.replace(/^Bearer\s+/i,'').trim();
  if(bearer)return{token:bearer,transport:'bearer'};
  const token=parseCookieHeader(headerValue(headers,'cookie'))[SESSION_COOKIE_NAME]||'';
  return token?{token,transport:'cookie'}:{token:'',transport:'none'};
}

export function attachSessionCredential(req,_res,next){
  if(req.ablAuthTransport)return next();
  const credential=sessionCredentialFromHeaders(req.headers||{});
  req.ablAuthTransport=credential.transport;
  req.ablSessionToken=credential.token;
  if(credential.transport==='cookie')req.headers.authorization=`Bearer ${credential.token}`;
  next();
}

function validCsrfToken(value){return /^[A-Za-z0-9_-]{32,160}$/.test(String(value||''))}
function safeEqualText(a,b){
  const aa=Buffer.from(String(a||''));
  const bb=Buffer.from(String(b||''));
  return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb);
}

export function enforceCookieCsrf(req,res,next){
  if(req.ablCsrfChecked)return next();
  req.ablCsrfChecked=true;
  const method=String(req.method||'GET').toUpperCase();
  const pathname=String(req.path||req.url||'').split('?')[0];
  if(req.ablAuthTransport!=='cookie'||SAFE_METHODS.has(method)||!pathname.startsWith('/api')||SESSION_BOOTSTRAP_PATHS.has(pathname))return next();
  const cookies=parseCookieHeader(headerValue(req.headers,'cookie'));
  const cookieToken=cookies[CSRF_COOKIE_NAME]||'';
  const headerToken=headerValue(req.headers,'x-csrf-token');
  if(validCsrfToken(cookieToken)&&validCsrfToken(headerToken)&&safeEqualText(cookieToken,headerToken))return next();
  res.setHeader('Cache-Control','private, no-store, max-age=0');
  return res.status(403).json({error:'Security validation failed. Refresh the page and try again.',code:'CSRF_VALIDATION_FAILED'});
}

export function sessionSecurityMiddleware(req,res,next){
  attachSessionCredential(req,res,error=>error?next(error):enforceCookieCsrf(req,res,next));
}

function appendSetCookie(res,value){
  if(typeof res.append==='function')res.append('Set-Cookie',value);
  else{
    const current=res.getHeader?.('Set-Cookie');
    const values=Array.isArray(current)?current:current?[current]:[];
    res.setHeader('Set-Cookie',[...values,value]);
  }
}

function cookie(name,value,{httpOnly=false,maxAge=SESSION_COOKIE_MAX_AGE_SECONDS}={}){
  const attributes=[`${name}=${encodeURIComponent(String(value||''))}`,'Path=/','Secure','SameSite=Lax',`Max-Age=${Math.max(0,Number(maxAge)||0)}`];
  if(httpOnly)attributes.push('HttpOnly');
  return attributes.join('; ');
}

export function issueBrowserSessionCookies(res,sessionToken,{csrfToken=crypto.randomBytes(32).toString('base64url')}={}){
  if(!sessionToken)throw new TypeError('Session token is required');
  appendSetCookie(res,cookie(SESSION_COOKIE_NAME,sessionToken,{httpOnly:true}));
  appendSetCookie(res,cookie(CSRF_COOKIE_NAME,csrfToken));
  res.setHeader('Cache-Control','private, no-store, max-age=0');
  return{csrfToken};
}

export function clearBrowserSessionCookies(res){
  appendSetCookie(res,cookie(SESSION_COOKIE_NAME,'',{httpOnly:true,maxAge:0}));
  appendSetCookie(res,cookie(CSRF_COOKIE_NAME,'',{maxAge:0}));
  res.setHeader('Cache-Control','private, no-store, max-age=0');
}
