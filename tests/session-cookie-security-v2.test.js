import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {extname} from 'node:path';
import {
  CSRF_COOKIE_NAME,SESSION_COOKIE_NAME,attachSessionCredential,
  enforceCookieCsrf,issueBrowserSessionCookies,parseCookieHeader,
  sessionCredentialFromHeaders
} from '../session-cookie-core.js';

function responseRecorder(){
  const cookies=[];
  const headers=new Map();
  return{
    cookies,headers,statusCode:200,payload:null,
    append(name,value){if(String(name).toLowerCase()==='set-cookie')cookies.push(value)},
    setHeader(name,value){headers.set(String(name).toLowerCase(),value)},
    status(code){this.statusCode=code;return this},
    json(value){this.payload=value;return this}
  };
}

test('session cookies are host-only secure cookies and only the CSRF cookie is script-readable',()=>{
  const res=responseRecorder();
  issueBrowserSessionCookies(res,'v2.1.7.session.signature',{csrfToken:'a'.repeat(43)});
  assert.equal(res.cookies.length,2);
  const session=res.cookies.find(value=>value.startsWith(SESSION_COOKIE_NAME+'='));
  const csrf=res.cookies.find(value=>value.startsWith(CSRF_COOKIE_NAME+'='));
  for(const value of [session,csrf]){
    assert.match(value,/Path=\//);
    assert.match(value,/Secure/);
    assert.match(value,/SameSite=Lax/);
    assert.doesNotMatch(value,/Domain=/i);
  }
  assert.match(session,/HttpOnly/);
  assert.doesNotMatch(csrf,/HttpOnly/);
  assert.equal(res.headers.get('cache-control'),'private, no-store, max-age=0');
});

test('cookie transport is converted to the existing internal bearer boundary',()=>{
  const req={headers:{cookie:`theme=dark; ${SESSION_COOKIE_NAME}=v2.cookie.value`}};
  let advanced=false;
  attachSessionCredential(req,responseRecorder(),()=>{advanced=true});
  assert.equal(advanced,true);
  assert.equal(req.ablAuthTransport,'cookie');
  assert.equal(req.ablSessionToken,'v2.cookie.value');
  assert.equal(req.headers.authorization,'Bearer v2.cookie.value');
  assert.deepEqual(sessionCredentialFromHeaders(req.headers),{token:'v2.cookie.value',transport:'bearer'});
  assert.deepEqual(sessionCredentialFromHeaders({Authorization:'Bearer internal-boundary'}),{token:'internal-boundary',transport:'bearer'});
  assert.equal(parseCookieHeader(req.headers.cookie)[SESSION_COOKIE_NAME],'v2.cookie.value');
});

test('unsafe cookie-authenticated API requests fail closed without matching CSRF evidence',()=>{
  const csrf='b'.repeat(43);
  const deniedReq={method:'POST',path:'/api/orders',headers:{cookie:`${CSRF_COOKIE_NAME}=${csrf}`},ablAuthTransport:'cookie'};
  const deniedRes=responseRecorder();
  let deniedNext=false;
  enforceCookieCsrf(deniedReq,deniedRes,()=>{deniedNext=true});
  assert.equal(deniedNext,false);
  assert.equal(deniedRes.statusCode,403);
  assert.equal(deniedRes.payload.code,'CSRF_VALIDATION_FAILED');

  const allowedReq={method:'PATCH',path:'/api/settings',headers:{cookie:`${CSRF_COOKIE_NAME}=${csrf}`,'x-csrf-token':csrf},ablAuthTransport:'cookie'};
  let allowedNext=false;
  enforceCookieCsrf(allowedReq,responseRecorder(),()=>{allowedNext=true});
  assert.equal(allowedNext,true);

  const qaReq={method:'POST',path:'/api/orders',headers:{authorization:'Bearer controlled-qa'},ablAuthTransport:'bearer'};
  let qaNext=false;
  enforceCookieCsrf(qaReq,responseRecorder(),()=>{qaNext=true});
  assert.equal(qaNext,true);

  const staleLogoutReq={method:'POST',path:'/api/auth/logout',headers:{cookie:`${SESSION_COOKIE_NAME}=stale-session`},ablAuthTransport:'cookie'};
  let staleLogoutNext=false;
  enforceCookieCsrf(staleLogoutReq,responseRecorder(),()=>{staleLogoutNext=true});
  assert.equal(staleLogoutNext,true);
});

test('browser code has no persistent session bearer outside the one-time migration boundary',()=>{
  const publicRoot=new URL('../public/',import.meta.url);
  const files=readdirSync(publicRoot,{recursive:true})
    .filter(name=>['.js','.html'].includes(extname(String(name))))
    .filter(name=>String(name)!=='session-security.js');
  const browserSource=files.map(name=>readFileSync(new URL(String(name),publicRoot),'utf8')).join('\n');
  assert.doesNotMatch(browserSource,/localStorage\.(?:getItem|setItem|removeItem)\(['"]abl_token['"]\)/);
  assert.doesNotMatch(browserSource,/Authorization\s*[:=]\s*[`'"]Bearer/i);

  const migration=readFileSync(new URL('../public/session-security.js',import.meta.url),'utf8');
  assert.match(migration,/localStorage\.removeItem\(LEGACY_STORAGE_KEY\)/);
  assert.match(migration,/\/api\/auth\/session\/migrate/);
  assert.match(migration,/headers\.delete\('Authorization'\)/);
  assert.match(migration,/X-CSRF-Token/);
});

test('server routes establish cookie sessions and rotate the legacy browser session',()=>{
  const auth=readFileSync(new URL('../server-auth.js',import.meta.url),'utf8');
  const hardening=readFileSync(new URL('../server-auth-hardening.js',import.meta.url),'utf8');
  const gateway=readFileSync(new URL('../server-paymongo.js',import.meta.url),'utf8');
  assert.match(auth,/app\.post\('\/api\/auth\/session\/migrate'/);
  assert.match(auth,/RAILWAY_SERVICE_NAME==='accounting-preview'.*APP_ENV.*==='qa'/);
  assert.match(auth,/QA_BEARER_ENABLED&&requested/);
  assert.match(auth,/stepUpVerified:false/);
  assert.match(auth,/revoked_at IS NULL RETURNING session_id/);
  assert.match(auth,/retired\.rowCount!==1/);
  assert.match(auth,/issueBrowserSessionCookies\(res,rotated\.token\)/);
  assert.match(auth,/clearBrowserSessionCookies\(res\)/);
  assert.match(hardening,/issueBrowserSessionCookies\(res,session\.token\)/);
  assert.match(gateway,/app\.use\(sessionSecurityMiddleware\)/);
});
