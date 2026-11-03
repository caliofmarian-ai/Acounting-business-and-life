import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import express from 'express';
import {PRIVATE_IDENTITY_CACHE_CONTROL,markPrivateIdentity,sendPrivateIdentityJson,privateIdentityFetchJson} from '../private-identity-cache.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const check=headers=>{
  assert.equal(headers.get('cache-control'),PRIVATE_IDENTITY_CACHE_CONTROL);
  assert.equal(headers.get('pragma'),'no-cache');
  assert.equal(headers.get('surrogate-control'),'no-store');
  assert.match(headers.get('vary')||'',/\bCookie\b/i);
  assert.match(headers.get('vary')||'',/\bAuthorization\b/i);
};

test('embedded account identity success and errors all have private no-store headers',async()=>{
  for(const status of [200,401,403,503]){
    const response=privateIdentityFetchJson(status,{status});
    assert.equal(response.status,status);
    assert.match(response.headers.get('content-type')||'',/application\/json/);
    check(response.headers);
    assert.equal(response.headers.get('etag'),null);
    assert.equal((await response.json()).status,status);
  }
});

test('real Express conditional identity requests return current 200, never stale 304',async t=>{
  const app=express();
  const paths=['/api/me','/api/admin/me','/api/session/bootstrap','/api/auth/session/identity'];
  for(const path of paths){
    app.get(path,markPrivateIdentity,(req,res)=>{
      if(req.headers.authorization!=='Bearer synthetic')return res.status(401).json({error:'Unauthorized'});
      return sendPrivateIdentityJson(res,{profile:'synthetic',path});
    });
  }
  const server=app.listen(0,'127.0.0.1');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  for(const path of paths){
    const headers={authorization:'Bearer synthetic'};
    const first=await fetch(base+path,{headers});
    assert.equal(first.status,200,path);
    check(first.headers);
    assert.equal(first.headers.get('etag'),null,path);
    assert.equal((await first.json()).path,path);
    const conditional=await fetch(base+path,{headers:{
      ...headers,'if-none-match':'"old-account-validator"',
      'if-modified-since':'Wed, 21 Oct 2015 07:28:00 GMT'
    }});
    assert.equal(conditional.status,200,path+' must not be 304');
    check(conditional.headers);
    assert.equal((await conditional.json()).profile,'synthetic');
    const denied=await fetch(base+path);
    assert.equal(denied.status,401,path);
    check(denied.headers);
    assert.deepEqual(await denied.json(),{error:'Unauthorized'});
  }
});

test('canonical routes keep authorization and enforce cache middleware before auth',()=>{
  const auth=read('server-auth.js');
  const admin=read('server-admin-operations.js');
  assert.ok(auth.includes("app.get('/api/me',markPrivateIdentity, auth,"));
  // The direct Express identity route must match the embedded Fetch no-store policy.
  assert.match(auth,/app\.get\('\/api\/auth\/session\/identity',markPrivateIdentity,auth,\(req,res\)=>\{\s*sendPrivateIdentityJson\(res,\{account_id:Number\(req\.accountId\)\}\);\s*\}\);/);
  assert.doesNotMatch(auth,/app\.get\('\/api\/auth\/session\/identity',\s*auth,/);
  assert.ok(auth.includes('sendPrivateIdentityJson(res,await profileSnapshot(req.accountId))'));
  const start=auth.indexOf("if((pathname==='/api/me'||pathname==='/api/auth/session/identity')");
  const end=auth.indexOf('if(isAccountAuthOwnedPath',start);
  assert.ok(start>0&&end>start);
  const fragment=auth.slice(start,end);
  assert.equal((fragment.match(/privateIdentityFetchJson\(/g)||[]).length,3);
  assert.match(fragment,/authenticatedAccountContext/);
  assert.match(fragment,/profileSnapshot/);
  assert.ok(admin.includes("app.get('/api/admin/me',markPrivateIdentity,async"));
  assert.ok(admin.includes("app.get('/api/session/bootstrap',markPrivateIdentity,async"));
  const begin=admin.indexOf("app.get('/api/admin/me'");
  const finish=admin.indexOf("app.get('/api/admin/catalog'",begin);
  const routes=admin.slice(begin,finish);
  assert.equal((routes.match(/sendPrivateIdentityJson\(/g)||[]).length,2);
  assert.match(routes,/getAdminAssignments/);
  assert.match(routes,/buildSessionBootstrap/);
  assert.doesNotMatch(routes,/buildAdminScopeContext/);
});
