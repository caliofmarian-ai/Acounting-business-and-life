import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('canonical gateway mounts only guest intake before session checks and staff afterwards',()=>{
  const source=read('server-paymongo.js');
  const guest=source.indexOf('registerPublicAccountAccessRoutes(app,'),session=source.indexOf('app.use(sessionSecurityMiddleware);'),staff=source.indexOf('registerStaffAccountAccessRoutes(app,'),body=source.indexOf('app.use(body);');
  assert.ok(guest>0&&guest<session&&session<staff&&staff<body);
  assert.match(source,/await ensureAccountAccessSchema\(accountAccessPool\)/u);
  assert.match(source,/const accountAccessPool=new Pool\([^\n]+max:4,connectionTimeoutMillis:5000/u);
});
test('guest form never sends cookies or reads browser session storage',()=>{
  const js=read('public/account-access/public.js');assert.match(js,/credentials:'omit'/u);assert.doesNotMatch(js,/localStorage|sessionStorage|document\.cookie|Authorization/u);
  assert.match(js,/response\.status===202&&payload\?\.ok===true/u);
  assert.doesNotMatch(js,/innerHTML/u);
});
test('private queue preserves session-bound CSRF and renders evidence as text, without persistence',()=>{
  const js=read('public/account-access/staff.js');
  assert.match(js,/const pageSession=csrf\(\)/u);assert.match(js,/'X-CSRF-Token':pageSession/u);assert.match(js,/credentials:'same-origin'/u);
  assert.doesNotMatch(js,/innerHTML|localStorage|sessionStorage/u);
  assert.match(js,/csrf\(\)!==pageSession/u);assert.match(js,/addEventListener\('pagehide',\(\)=>retire\(/u);
});
test('public form has explicit limits, labels, disabled no-script submit, English and Filipino',()=>{
  const html=read('public/account-access/index.html'),js=read('public/account-access/public.js');
  assert.match(html,/maxlength="2000"/u);assert.match(html,/maxlength="254"/u);assert.match(html,/type="submit" disabled/u);assert.match(html,/aria-live="polite"/u);assert.match(html,/<noscript>/u);
  assert.match(js,/'fil-PH'/u);assert.match(js,/'en-PH'/u);assert.doesNotMatch(html,/<input[^>]*type="file"/u);
});

// Execute the actual UI source with deterministic DOM/transport doubles. These
// race regressions complement, not replace, the real gateway browser workflow.
function staffHarness(){
  class Element{
    constructor(tag='div'){this.tag=tag;this.textContent='';this.value='';this.hidden=false;this.disabled=false;this.children=[];this.dataset={};this.events=new Map();}
    addEventListener(name,fn){this.events.set(name,fn);}
    replaceChildren(...items){this.children=items;}
    append(...items){this.children.push(...items);}
    querySelectorAll(tag){return this.children.flatMap(child=>[...(child.tag===tag?[child]:[]),...child.querySelectorAll(tag)]);}
    scrollIntoView(){}
  }
  const elements=new Map(),events=new Map(),requests=[];
  const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  get('filter').value='new';get('case-status').value='new';get('detail').hidden=true;
  let cookie='__Host-abl_csrf=fixture-generation-one';
  const document={getElementById:get,createElement:tag=>new Element(tag),hidden:false,
    addEventListener:(name,fn)=>events.set('document:'+name,fn)};
  Object.defineProperty(document,'cookie',{get:()=>cookie});
  const window={addEventListener:(name,fn)=>events.set('window:'+name,fn)};
  const fetch=(path,init)=>new Promise(resolve=>requests.push({path,init,resolve}));
  vm.runInNewContext(read('public/account-access/staff.js'),{document,window,fetch,URLSearchParams,AbortController,setTimeout,clearTimeout,Date},{timeout:1000});
  const flush=async()=>{for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));};
  const reply=async(index,data,status=200)=>{assert.ok(requests[index],'Expected request '+index);requests[index].resolve({ok:status>=200&&status<300,status,json:async()=>data});await flush();};
  return{get,requests,flush,reply,setCookie:value=>{cookie=value;},
    emit:(name,event={})=>events.get(name)?.(event),
    close:async()=>{events.get('window:pagehide')?.({});for(const request of requests)request.resolve({ok:true,status:200,json:async()=>({})});await flush();}};
}
const list={items:[{id:'1',reason:'sign_in',status:'new'}],next_cursor:null};
const detailFixture={id:'1',reason:'sign_in',status:'new',revision:1,contact_email:'private-fixture@example.test',display_name:'Synthetic visitor',created_at:'2026-01-01T00:00:00Z',message:'Synthetic private request content.',staff_note:'Synthetic private note.'};
async function loadFixture(h){await h.reply(0,list);h.get('queue').querySelectorAll('button')[0].events.get('click')();await h.reply(1,detailFixture);assert.equal(h.get('case-message').textContent,detailFixture.message);}
function assertCleared(h){assert.equal(h.get('case-message').textContent,'');assert.equal(h.get('case-email').textContent,'');assert.equal(h.get('case-note').value,'');assert.equal(h.get('queue').children.length,0);assert.equal(h.get('detail').hidden,true);assert.equal(h.get('refresh').disabled,true);assert.equal(h.get('save').disabled,true);}

test('staff session: late private detail is discarded after cookie generation changes',async()=>{
  const h=staffHarness();try{
    await h.reply(0,list);h.get('queue').querySelectorAll('button')[0].events.get('click')();
    h.setCookie('__Host-abl_csrf=fixture-generation-two');await h.reply(1,detailFixture);assertCleared(h);
  }finally{await h.close();}
});
test('staff session: late queue cannot resurrect after navigation',async()=>{
  const h=staffHarness();try{h.emit('window:pagehide');await h.reply(0,list);assertCleared(h);}finally{await h.close();}
});
test('staff session: late successful triage cannot restore details or feedback after expiry',async()=>{
  const h=staffHarness();try{
    await loadFixture(h);h.get('case-status').value='reviewing';h.get('case-note').value='Unsaved synthetic note';
    const completion=h.get('triage').events.get('submit')({preventDefault(){}});
    assert.equal(h.requests[2].init.headers['X-CSRF-Token'],'fixture-generation-one');
    assert.deepEqual(JSON.parse(h.requests[2].init.body),{status:'reviewing',note:'Unsaved synthetic note',revision:1});
    h.emit('document:abl:auth-expired');await h.reply(2,{status:'reviewing',revision:2});await completion;
    assertCleared(h);assert.doesNotMatch(h.get('feedback').textContent,/Triage saved/u);
  }finally{await h.close();}
});
test('staff session: changed credentials are rejected before another mutation starts',async()=>{
  const h=staffHarness();try{
    await loadFixture(h);h.setCookie('__Host-abl_csrf=fixture-generation-two');
    await h.get('triage').events.get('submit')({preventDefault(){}});assert.equal(h.requests.length,2);assertCleared(h);
  }finally{await h.close();}
});
