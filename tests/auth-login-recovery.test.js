import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const read=path=>readFileSync(new URL('../public/'+path,import.meta.url),'utf8');
const security=read('session-security.js'),auth=read('auth-ui.js'),modern=read('auth-hardening-ui.js');
const jsonResponse=(status=401)=>new Response(JSON.stringify({error:'Incorrect email or password'}),{status,headers:{'Content-Type':'application/json'}});

function harness({csrf='',modernRoot=true,fetchResponse=()=>jsonResponse()}={}){
  const calls=[],events=[],cookies=new Map(),nodes=new Map(),listeners=new Map();
  const counts={legacy:0,modern:0,panels:0};
  if(csrf)cookies.set('__Host-abl_csrf',csrf);
  function addNode(id,hidden=false){
    const classes=new Set(hidden?['hidden']:[]);
    const node={id,classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)},querySelector:selector=>nodes.get(selector.slice(1))};
    nodes.set(id,node);return node;
  }
  addNode('shell');addNode('login',true);addNode('authModalBackdrop');
  if(modernRoot)addNode('modernAuthRoot');
  const document={
    body:{style:{overflow:'hidden'}},getElementById:id=>nodes.get(id),
    get cookie(){return [...cookies].map(([key,value])=>key+'='+value).join('; ')},
    set cookie(raw){const [pair]=raw.split(';'),index=pair.indexOf('='),key=pair.slice(0,index),value=pair.slice(index+1);if(/Max-Age=0/i.test(raw))cookies.delete(key);else cookies.set(key,value)},
    addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn)},
    dispatchEvent(event){events.push(event);for(const fn of listeners.get(event.type)||[])fn(event)}
  };
  const window={fetch:async(input,init)=>{
    const raw=typeof input==='string'?input:input.url;
    const path=new URL(raw,'https://example.invalid/').pathname;
    calls.push({path,init});
    return fetchResponse(path,init);
  }};
  const context={window,document,URL,Request,Headers,console,Promise,
    location:{origin:'https://example.invalid',href:'https://example.invalid/'},
    localStorage:{getItem:()=>'',removeItem(){}},
    CustomEvent:class{constructor(type){this.type=type}},currentProfile:{},
    ensureAuthChoices(){},ensureModal(){},
    openAuth(){counts.legacy+=1;nodes.get('authModalBackdrop').classList.remove('hidden')},
    closeAuth(){nodes.get('authModalBackdrop').classList.add('hidden');document.body.style.overflow=''},
    panel(){counts.panels+=1;addNode('modernLogin')}
  };
  vm.createContext(context);
  vm.runInContext(security,context);
  const helperStart=modern.indexOf('function openSignIn(');
  if(helperStart>=0){
    vm.runInContext(modern.slice(helperStart,modern.indexOf('function openPasswordRecovery',helperStart)),context);
    window.BusinessLifeAuthHardening={openSignIn(){counts.modern+=1;return context.openSignIn()}};
  }
  vm.runInContext(auth.slice(auth.indexOf('function showExpiredSessionLogin(){'),auth.indexOf('async function loadProfile(){'))+"\ndocument.addEventListener('abl:auth-expired',showExpiredSessionLogin);",context);
  return{window,document,cookies,calls,events,counts,nodes,addNode,context,
    fetch:(input,init)=>window.fetch(input,init),recover:()=>context.showExpiredSessionLogin()};
}

test('incorrect public login keeps its original 401 without logout, expiry event or duplicate modal',async()=>{
  const h=harness();await h.window.ABLSession.ready;
  const response=await h.fetch('/api/auth/login',{method:'POST',body:'{}'});
  assert.equal(response.status,401);
  assert.equal((await response.json()).error,'Incorrect email or password');
  assert.deepEqual(h.calls.map(x=>x.path),['/api/auth/login']);
  assert.equal(h.events.length,0);
  assert.equal(h.counts.legacy,0);
});

test('public credential bootstrap and recovery failures do not revoke an existing cookie session',async()=>{
  for(const path of ['/api/auth/register','/api/auth/email/preflight','/api/auth/registration/verify','/api/auth/forgot-password','/api/auth/reset-password','/api/auth/owner-migrate','/api/auth/oauth/handoff','/api/auth/email-verification/verify','/api/auth/logout']){
    const h=harness({csrf:'session-a'});await h.window.ABLSession.ready;
    const response=await h.fetch(new Request('https://example.invalid'+path+'?attempt=1',{method:'POST',body:'{}'}));
    assert.equal(response.status,401,path);
    assert.equal(h.calls.length,1,path);
    assert.equal(h.cookies.get('__Host-abl_csrf'),'session-a',path);
    assert.equal(h.events.length,0,path);
  }
});

test('protected 401 revokes and clears the session and selects only the modern sign-in surface',async()=>{
  const h=harness({csrf:'session-a'});await h.window.ABLSession.ready;
  const response=await h.fetch('/api/me');
  assert.equal(response.status,401);
  assert.deepEqual(h.calls.map(x=>x.path),['/api/me','/api/auth/logout']);
  assert.equal(h.cookies.has('__Host-abl_csrf'),false);
  assert.equal(h.events.filter(x=>x.type==='abl:auth-expired').length,1);
  assert.equal(h.counts.legacy,0);
  assert.equal(h.counts.modern,1);
  assert.equal(h.nodes.get('shell').classList.contains('hidden'),true);
  assert.equal(h.nodes.get('login').classList.contains('hidden'),false);
  assert.equal(h.nodes.get('authModalBackdrop').classList.contains('hidden'),true);
  assert.equal(h.document.body.style.overflow,'');
});

test('concurrent protected failures share one completed logout and expiry recovery',async()=>{
  const finishLogout=[];
  const h=harness({csrf:'session-a',fetchResponse:path=>path==='/api/auth/logout'?new Promise(resolve=>{finishLogout.push(()=>resolve(jsonResponse(200)))}):jsonResponse()});
  await h.window.ABLSession.ready;
  const first=h.fetch('/api/me'),second=h.fetch('/api/auth/sessions');
  await new Promise(resolve=>setImmediate(resolve));
  const logoutCount=h.calls.filter(x=>x.path==='/api/auth/logout').length;
  assert.equal(h.events.length,0,'recovery waits until revocation completes');
  finishLogout.forEach(finish=>finish());await Promise.all([first,second]);
  assert.equal(logoutCount,1);
  assert.equal(h.events.filter(x=>x.type==='abl:auth-expired').length,1);
  assert.equal(h.counts.panels,1);
});

test('another new cookie session can independently expire after prior recovery',async()=>{
  const h=harness({csrf:'session-a'});await h.window.ABLSession.ready;
  await h.fetch('/api/me');
  h.cookies.set('__Host-abl_csrf','session-b');
  await h.fetch('/api/me');
  assert.equal(h.calls.filter(x=>x.path==='/api/auth/logout').length,2);
  assert.equal(h.events.filter(x=>x.type==='abl:auth-expired').length,2);
  assert.equal(h.cookies.has('__Host-abl_csrf'),false);
});

test('a late 401 from the previous cookie session cannot revoke a newer session',async()=>{
  let failOldRequest;
  const h=harness({csrf:'session-a',fetchResponse:path=>path==='/api/me'?new Promise(resolve=>{failOldRequest=()=>resolve(jsonResponse())}):jsonResponse(200)});
  await h.window.ABLSession.ready;
  const old=h.fetch('/api/me');
  await new Promise(resolve=>setImmediate(resolve));
  h.cookies.set('__Host-abl_csrf','session-b');
  failOldRequest();await old;
  assert.equal(h.calls.length,1);
  assert.equal(h.cookies.get('__Host-abl_csrf'),'session-b');
  assert.equal(h.events.length,0);
});

test('repeated recovery preserves an already displayed modern login form',async()=>{
  const h=harness();await h.window.ABLSession.ready;
  const form=h.addNode('modernLogin');
  form.enteredEmail='preserved@example.invalid';
  h.recover();h.recover();
  assert.equal(h.counts.legacy,0);
  assert.equal(h.counts.panels,0);
  assert.equal(h.nodes.get('modernLogin'),form);
  assert.equal(form.enteredEmail,'preserved@example.invalid');
});

test('an entry page without a modern root retains the legacy sign-in fallback',async()=>{
  const h=harness({modernRoot:false});await h.window.ABLSession.ready;
  h.recover();
  assert.equal(h.counts.legacy,1);
  assert.equal(h.nodes.get('authModalBackdrop').classList.contains('hidden'),false);
  assert.equal(h.nodes.get('login').classList.contains('hidden'),false);
});

test('session transport still strips browser bearer headers and attaches CSRF to unsafe requests',async()=>{
  const h=harness({csrf:'session-a',fetchResponse:()=>jsonResponse(200)});await h.window.ABLSession.ready;
  await h.fetch('/api/orders',{method:'POST',headers:{Authorization:'Bearer must-not-leave-browser'},body:'{}'});
  const headers=h.calls[0].init.headers;
  assert.equal(headers.has('Authorization'),false);
  assert.equal(headers.get('X-CSRF-Token'),'session-a');
  assert.equal(h.calls[0].init.credentials,'same-origin');
});

test('third-party 401 and protected 403 do not revoke the current session',async()=>{
  const h=harness({csrf:'session-a',fetchResponse:path=>jsonResponse(path==='/api/me'?403:401)});await h.window.ABLSession.ready;
  await h.fetch('https://external.invalid/resource');
  await h.fetch('/api/me');
  assert.equal(h.calls.length,2);
  assert.equal(h.cookies.get('__Host-abl_csrf'),'session-a');
  assert.equal(h.events.length,0);
});
