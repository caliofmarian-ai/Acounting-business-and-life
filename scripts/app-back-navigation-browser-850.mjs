// Actual History API + production controller/surface adapter and extracted shell exit UI.
// Synthetic account/markup only: NOT authenticated Preview, production, or physical Android.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const out=process.env.BACK_BROWSER_OUT||'artifacts/back-navigation-850';mkdirSync(out,{recursive:true});
const shellPath=process.env.BACK_SHELL_SOURCE||'public/shell.js';
const shell=readFileSync(shellPath,'utf8');
const start=shell.indexOf('function openAppExitPrompt('),end=shell.indexOf('async function profileApi(',start);
assert.ok(start>=0&&end>start,'actual shell exit dialog function exists');
const exitSource=shell.slice(start,end);
const html=`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
*{box-sizing:border-box}body{font:16px system-ui;margin:16px}button{min-height:44px;min-width:60px;margin:4px}input{padding:10px;max-width:100%}.hidden,[hidden]{display:none!important}.layer,.appExitPrompt{position:fixed;inset:0;z-index:100;background:#ddd;padding:18px;display:grid;place-items:center}.layer section,.appExitPrompt section{background:white;padding:20px;width:100%;max-width:360px}.appExitPrompt{z-index:1000}dialog{max-width:90%}
</style><main id="main"><h1>Back navigation test</h1><button id="appNavigationBack" hidden>← Back</button><button id="focusHome">Account</button><p id="screen">account-home</p></main>
<div id="lazyMoreBackdrop" class="layer hidden"><section>More<button id="lazyMoreClose">Close More</button></section></div>
<div id="profileDrawerBackdrop" class="layer hidden" style="z-index:200"><section>Profile<button id="drawerClose">Close Profile</button></section></div>
<dialog id="editDialog"><form><label>Correction note<input id="draft" value="initial"></label><button id="editCancel" type="button">Close</button></form></dialog>
<script type="module">
import {createAppBackController} from '/public/app-back-navigation.js';
${exitSource}
const context={authenticated:true,accountId:10,activeRole:'merchant'},closed={more:0,drawer:0};
const screen=document.getElementById('screen');
const nav=createAppBackController({history,subscribePop:f=>addEventListener('popstate',f),getContext:()=>context,
 restore:r=>{screen.textContent=r.view||r.kind;return true},onExit:openAppExitPrompt,
 onChange:s=>{document.getElementById('appNavigationBack').hidden=!s.canGoBack;if(!s.exitPending)document.getElementById('appExitPrompt')?.remove()}});
const root={kind:'account-home'},merchant={kind:'profile-home',role:'merchant'},stock={kind:'merchant-view',role:'merchant',view:'Stock'},money={kind:'merchant-view',role:'merchant',view:'Money'};
function route(r){screen.textContent=r.view||r.kind;nav.record(r)}
document.getElementById('appNavigationBack').onclick=()=>nav.back();
document.getElementById('lazyMoreClose').onclick=()=>{closed.more++;document.getElementById('lazyMoreBackdrop').classList.add('hidden');document.body.classList.remove('lazyModalOpen')};
document.getElementById('drawerClose').onclick=()=>{closed.drawer++;document.getElementById('profileDrawerBackdrop').classList.add('hidden');document.body.style.overflow=''};
document.getElementById('editCancel').onclick=()=>document.getElementById('editDialog').close();
nav.begin(root);window.h={nav,context,route,root,merchant,stock,money,closed};
</script></html>`;
const server=createServer((req,res)=>{
  res.setHeader('cache-control','no-store');
  if(req.url==='/prior'){res.setHeader('content-type','text/html');res.end('<h1>Previous browser page</h1><a href="/fixture">Open fixture</a>');return;}
  if(req.url?.startsWith('/fixture')){res.setHeader('content-type','text/html');res.end(html);return;}
  if(['/public/app-back-navigation.js','/public/app-back-surfaces.js'].includes(req.url)){
    res.setHeader('content-type','text/javascript');res.end(readFileSync('.'+req.url));return;}
  res.statusCode=404;res.end('not found');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const chrome=process.env.CHROME_BIN||execFileSync('sh',['-c','command -v chromium || command -v google-chrome']).toString().trim();
const profile=mkdtempSync(join(tmpdir(),'back-850-'));let child,ws;const errors=[],checks=[];
try{
  child=spawn(chrome,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--no-first-run','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
  const endpoint=await new Promise((resolve,reject)=>{
    let log='';const timer=setTimeout(()=>reject(new Error('Chrome start timed out after 45 seconds')),45000);
    child.stderr.on('data',d=>{log+=d;const m=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});
    child.once('exit',code=>{clearTimeout(timer);reject(new Error('Chrome exited '+code));});
  });
  ws=new WebSocket(endpoint);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let id=0;const pending=new Map();
  ws.onmessage=event=>{
    const msg=JSON.parse(event.data);
    if(msg.id){const p=pending.get(msg.id);if(!p)return;clearTimeout(p.timer);pending.delete(msg.id);msg.error?p.reject(new Error(JSON.stringify(msg.error))):p.resolve(msg.result);}
    else if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails);
  };
  function send(method,params={},sessionId){return new Promise((resolve,reject)=>{
    const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(new Error(method+' timeout'));},12000);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params,...(sessionId?{sessionId}:{})}));
  });}
  const version=await send('Browser.getVersion');
  for(const width of [320,390,1280]){
    const {targetId}=await send('Target.createTarget',{url:'about:blank'});const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
    await send('Page.enable',{},sessionId);await send('Runtime.enable',{},sessionId);
    await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<600},sessionId);
    async function ev(expression){const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true},sessionId);if(result.exceptionDetails)throw new Error(result.exceptionDetails.text+' '+result.exceptionDetails.exception?.description);return result.result.value;}
    async function wait(expression){for(let i=0;i<100;i++){try{if(await ev(expression))return;}catch{}await new Promise(r=>setTimeout(r,30));}throw new Error('Not reached: '+expression);}
    function check(name,value){assert.ok(value,`${width}px: ${name}`);checks.push({width,name,pass:true});}
    async function fresh(){const navigation=await send('Page.navigate',{url:origin+'/prior'},sessionId);assert.ok(!navigation.errorText,navigation.errorText||'navigation');await wait("location.pathname==='/prior'");await ev("location.href='/fixture'");await wait('Boolean(window.h)');}
    await fresh();await ev('h.route(h.merchant);h.route(h.stock);h.route(h.money);history.back()');await wait("document.getElementById('screen').textContent==='Stock'");check('native Back returns Money to Stock',true);
    await ev('history.forward()');await wait("document.getElementById('screen').textContent==='Money'");check('browser Forward restores Money',true);
    await ev("document.getElementById('lazyMoreBackdrop').classList.remove('hidden');document.body.classList.add('lazyModalOpen');history.back()");
    await wait("h.closed.more===1&&!document.body.classList.contains('lazyModalOpen')&&history.state.__abl_back_v1.seq===4");check('More closes via original handler; underlying page/history unchanged',await ev("document.getElementById('screen').textContent==='Money'"));
    await ev("document.getElementById('profileDrawerBackdrop').classList.remove('hidden');document.body.style.overflow='hidden';h.nav.back()");check('visible Back closes drawer and releases scroll lock',await ev("h.closed.drawer===1&&document.body.style.overflow===''&&history.state.__abl_back_v1.seq===4"));
    await ev("document.getElementById('editDialog').showModal();document.getElementById('draft').value='keep this draft';document.getElementById('draft').dispatchEvent(new Event('input',{bubbles:true}));window.confirmCalls=0;window.confirm=()=>{window.confirmCalls++;return false};history.back()");
    await wait("window.confirmCalls===1&&history.state.__abl_back_v1.seq===4&&!h.nav.getState().bouncing");check('unsaved correction stays open with typed text',await ev("document.getElementById('editDialog').open&&document.getElementById('draft').value==='keep this draft'"));
    await ev("window.confirm=()=>true;h.nav.back()");check('approved correction close does not navigate away',await ev("!document.getElementById('editDialog').open&&history.state.__abl_back_v1.seq===4"));
    await ev("h.context.activeRole='supplier';h.nav.syncContext();history.back()");await wait("document.getElementById('screen').textContent==='account-home'");check('old Merchant history cannot restore after Supplier switch',true);
    await fresh();const rootLength=await ev('history.length');await ev("document.getElementById('focusHome').focus();history.back()");await wait('h.nav.getState().exitPending');
    check('root prompt returns browser to guarded root position',await ev('history.state.__abl_back_v1.seq===1'));
    check('root background inert and focus inside dialog',await ev("document.getElementById('main').inert&&document.activeElement.closest('#appExitPrompt')!==null"));
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9},sessionId);await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9},sessionId);
    check('Tab remains inside exit prompt',await ev("document.activeElement.closest('#appExitPrompt')!==null"));
    const shot=await send('Page.captureScreenshot',{format:'png'},sessionId);writeFileSync(join(out,`root-prompt-${width}.png`),Buffer.from(shot.data,'base64'));
    await ev('history.back()');await wait("!h.nav.getState().exitPending&&history.state.__abl_back_v1.seq===1");check('second native Back cancels root prompt, not app',await ev("location.pathname==='/fixture'&&!document.getElementById('main').inert&&!document.getElementById('appExitPrompt')"));
    for(let i=0;i<3;i++){await ev('history.back()');await wait('h.nav.getState().exitPending');await ev("document.querySelector('[data-app-exit=stay]').click()");}
    check('repeated Stay keeps history bounded and root Back hidden',await ev(`history.length===${rootLength}&&document.getElementById('appNavigationBack').hidden`));
    await ev('history.back()');await wait('h.nav.getState().exitPending');await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},sessionId);await wait('!h.nav.getState().exitPending');check('Escape cancels prompt',true);
    await ev('history.back()');await wait('h.nav.getState().exitPending');await ev("document.querySelector('[data-app-exit=leave]').click()");await wait("location.pathname==='/prior'");check('Leave returns to real preceding page',true);
    await send('Target.closeTarget',{targetId});
  }
  assert.equal(errors.length,0,'no uncaught browser exceptions');
  const result={browser:version.product,source:shellPath,authenticated:false,physicalAndroid:false,checks,errors};writeFileSync(join(out,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({browser:version.product,checks:checks.length,passed:true,source:shellPath}));
}catch(error){writeFileSync(join(out,'failure.json'),JSON.stringify({error:String(error.stack),checks,errors},null,2));throw error;}
finally{ws?.close();child?.kill('SIGTERM');server.close();await new Promise(r=>setTimeout(r,100));rmSync(profile,{recursive:true,force:true});}
