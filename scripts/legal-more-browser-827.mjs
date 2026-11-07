// Real Chrome, shipped More/Legal modules and synthetic read-only identity fixtures.
// NOT an authenticated Android, shared Preview, or Production acceptance.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const out=process.env.LEGAL_BROWSER_OUT||('artifacts/legal-more-827/'+(process.env.LEGAL_BROWSER_LEGACY_CONTROL==='1'?'legacy-control':'current'));
mkdirSync(out,{recursive:true});
const legacy=process.env.LEGAL_BROWSER_LEGACY_CONTROL==='1';
const ordinary={customer:['order.create','location.share','marketing.opt_in'],merchant:['profile.submit','platform_fee.accept','marketing.opt_in'],supplier:['profile.submit','platform_fee.accept','marketing.opt_in'],courier:['profile.submit','location.share','marketing.opt_in'],service_provider:['profile.submit','marketing.opt_in']};
let scenarios=[...Object.keys(ordinary).map(role=>({name:role,role,surface:'profile',actions:ordinary[role],width:390})),
  {name:'account-home',role:'merchant',surface:'account',actions:['marketing.opt_in'],width:390},
  {name:'legal-admin',role:'',surface:'account',actions:['marketing.opt_in','admin.access'],admin:{is_admin:true,permissions:['legal.view'],assignments:[]},adminAllowed:true,width:1280},
  {name:'super-admin',role:'',surface:'account',actions:['marketing.opt_in','admin.access'],admin:{is_admin:true,permissions:[],assignments:[{admin_role:'super_admin'}]},adminAllowed:true,width:1280},
  {name:'delegated-admin',role:'',surface:'account',actions:['marketing.opt_in','admin.access'],admin:{is_admin:true,permissions:[],assignments:[{admin_role:'territory_admin'}]},adminAllowed:false,width:1280},
  {name:'history-retry',role:'merchant',surface:'profile',actions:ordinary.merchant,historyFailure:true,width:390}];
if(legacy)scenarios=scenarios.filter(s=>s.name==='merchant');
const assetPaths=['/mobile-feature-loader.js','/mobile-feature-loader.css','/legal-ui.js','/legal.css'];
const assets=new Map(assetPaths.map(path=>[path,readFileSync('public'+path,'utf8')]));
if(legacy){
  const fixed=`bg.querySelector('[data-lazy-action="legal"]').onclick=openLegalCenter;`;
  assert.ok(assets.get('/mobile-feature-loader.js').includes(fixed),'legacy control must change exactly the reviewed launcher');
  assets.set('/mobile-feature-loader.js',assets.get('/mobile-feature-loader.js').replace(fixed,`bg.querySelector('[data-lazy-action="legal"]').onclick=()=>openButtonFeature('legal','legalCenterBtn');`));
}
const fixture=scenario=>`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/mobile-feature-loader.css"><style>body{font:14px system-ui;margin:0;background:#f4f8f6}.topActions{display:flex;padding:12px;gap:8px}.hidden{display:none!important}</style></head><body><div class="topActions"></div><p>Synthetic read-only test identity</p><script>
window.__scenario=${JSON.stringify(scenario)};window.__requests=[];window.__historyFailures=${scenario.historyFailure?1:0};
window.ABLSession={authenticated:()=>true};window.BusinessLifeProfileState={surface:'account',activeRole:''};
const originalFetch=window.fetch.bind(window);
window.fetch=async(path,options={})=>{
  const url=new URL(path,location.href);if(!url.pathname.startsWith('/api/'))return originalFetch(path,options);
  const method=options.method||'GET';window.__requests.push({path:url.pathname+url.search,method});
  const answer=(status,data)=>Promise.resolve(new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}}));
  if(method!=='GET')return answer(500,{error:'No mutation is allowed in this fixture'});
  const s=window.__scenario;
  if(url.pathname==='/api/me')return answer(200,{id:17,roles:s.role?[s.role]:[]});
  if(url.pathname==='/api/admin/me')return s.admin?answer(200,s.admin):answer(403,{error:'Admin access denied'});
  if(url.pathname==='/api/legal/status')return answer(200,{action_code:url.searchParams.get('action'),role:url.searchParams.get('role'),requirements:[],review_pending:[{document_code:'TEST-DRAFT',title:'Draft <not active>'}]});
  if(url.pathname==='/api/legal/history'){if(window.__historyFailures-->0)return answer(503,{error:'History temporarily unavailable'});return answer(200,[]);}
  if(url.pathname==='/api/legal/admin/overview'&&s.adminAllowed)return answer(200,{documents:[]});
  return answer(500,{error:'Unexpected fixture API request: '+url.pathname});
};
</script><script type="module" src="/mobile-feature-loader.js"></script></body></html>`;
const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://fixture.invalid');
  if(assets.has(url.pathname)){res.setHeader('content-type',url.pathname.endsWith('.css')?'text/css':'application/javascript');res.end(assets.get(url.pathname));return;}
  if(url.pathname==='/fixture'){
    const scenario=scenarios.find(s=>s.name===url.searchParams.get('case'));
    if(scenario){res.setHeader('content-type','text/html; charset=utf-8');res.end(fixture(scenario));return;}
  }
  res.statusCode=404;res.end('not found');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const chrome=process.env.CHROME_BIN||execFileSync('sh',['-c','command -v chromium || command -v google-chrome']).toString().trim();
const profile=mkdtempSync(join(tmpdir(),'legal-827-'));
let child,ws;
const results=[],errors=[];
try{
  child=spawn(chrome,['--headless=new','--no-sandbox','--disable-dev-shm-usage',
    '--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],
    {stdio:['ignore','ignore','pipe']});
  const endpoint=await new Promise((resolve,reject)=>{
    let log='';const timer=setTimeout(()=>reject(new Error('Chrome launch timeout')),45000);
    child.stderr.on('data',d=>{log+=d;const m=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if(m){clearTimeout(timer);resolve(m[1]);}});
    child.once('exit',code=>{clearTimeout(timer);reject(new Error('Chrome exited '+code));});
  });
  ws=new WebSocket(endpoint);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  let id=0;const pending=new Map();
  ws.onmessage=event=>{
    const msg=JSON.parse(event.data);
    if(msg.id){const p=pending.get(msg.id);if(!p)return;clearTimeout(p.timer);pending.delete(msg.id);
      msg.error?p.reject(new Error(JSON.stringify(msg.error))):p.resolve(msg.result);}
    else if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails);
  };
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
    const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(new Error(method+' timeout'));},12000);
    pending.set(n,{resolve,reject,timer});
    ws.send(JSON.stringify({id:n,method,params,...(sessionId?{sessionId}:{})}));
  });
  const browser=(await send('Browser.getVersion')).product;
  for(const scenario of scenarios){
    const {name,width}=scenario;
    const {targetId}=await send('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
    await send('Page.enable',{},sessionId);await send('Runtime.enable',{},sessionId);
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600},sessionId);
    const evaluate=async expression=>{
      const value=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);
      if(value.exceptionDetails)throw new Error(value.exceptionDetails.text);
      return value.result.value;
    };
    const waitFor=async expression=>{
      for(let i=0;i<120;i++){
        const value=await evaluate(expression);if(value)return value;
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      throw new Error(name+' browser condition timed out: '+expression);
    };
    await send('Page.navigate',{url:origin+'/fixture?case='+encodeURIComponent(name)},sessionId);
    await waitFor('document.readyState==="complete"&&Boolean(document.getElementById("lazyMoreBtn"))');
    await evaluate('window.BusinessLifeProfileState={surface:window.__scenario.surface,activeRole:window.__scenario.role};document.getElementById("lazyMoreBtn").click();document.querySelector("[data-lazy-action=legal]").click();true');
    if(legacy){
      await waitFor('document.getElementById("lazyFeatureToast")?.textContent.includes("This feature could not finish loading.")');
      assert.equal(await evaluate('document.getElementById("legalBackdrop").classList.contains("hidden")'),true,'old handler leaves mounted Legal hidden');
      assert.equal(await evaluate('Boolean(document.getElementById("legalCenterBtn"))'),false,'legacy button is intentionally absent');
      results.push({name,width,legacyRegressionReproduced:true,synthetic:true});
    }else{
      if(scenario.historyFailure){
        await waitFor('document.getElementById("legalBody")?.textContent.includes("History temporarily unavailable")');
        await evaluate('window.BusinessLifeLegal.close();document.getElementById("lazyMoreBtn").click();document.querySelector("[data-lazy-action=legal]").click();true');
      }
      await waitFor('Boolean(document.getElementById("legalRequired"))&&Boolean(document.getElementById("legalHistory"))');
      const state=await evaluate(`(() => ({title:document.getElementById('legalTitle').textContent,
        visible:!document.getElementById('legalBackdrop').classList.contains('hidden'),moreHidden:document.getElementById('lazyMoreBackdrop').classList.contains('hidden'),
        legacyButton:Boolean(document.getElementById('legalCenterBtn')),toast:document.getElementById('lazyFeatureToast')?.textContent||'',
        adminTab:Boolean(document.querySelector('[data-ltab="admin"]')),pending:document.getElementById('legalRequired').textContent.includes('not active legal terms'),
        requests:window.__requests.map(x=>({...x})),backdrops:document.querySelectorAll('#legalBackdrop').length,
        styles:document.querySelectorAll('link[data-lazy-css="/legal.css"]').length}))()`);
      assert.equal(state.title,'Legal & Privacy Center',name);assert.equal(state.visible,true,name);assert.equal(state.moreHidden,true,name);
      assert.equal(state.legacyButton,false,name);assert.equal(state.toast,'',name);assert.equal(state.pending,true,name);
      assert.equal(state.adminTab,Boolean(scenario.adminAllowed),name+' Admin UI authority');
      const statuses=state.requests.filter(r=>r.path.startsWith('/api/legal/status?')).slice(-scenario.actions.length).map(r=>new URL(r.path,'https://fixture.invalid'));
      assert.deepEqual(statuses.map(u=>u.searchParams.get('action')),scenario.actions,name+' legal action context');
      if(scenario.surface==='profile')assert.ok(statuses.every(u=>u.searchParams.get('role')===scenario.role),name+' role context');
      if(name==='account-home')assert.equal(statuses[0].searchParams.get('role'),'*','Account Home must not borrow Merchant');
      if(!scenario.adminAllowed)assert.ok(!state.requests.some(r=>r.path.startsWith('/api/legal/admin/')),name+' must not read Admin data');
      assert.ok(state.requests.every(r=>r.method==='GET'),name+' navigation must never accept/review/activate');
      assert.equal(state.backdrops,1);assert.equal(state.styles,1);
      await evaluate('document.querySelector("[data-ltab=history]").click();true');
      assert.equal(await evaluate('!document.getElementById("legalHistory").classList.contains("hidden")&&document.getElementById("legalRequired").classList.contains("hidden")'),true,name+' History tab');
      await evaluate('document.querySelector("[data-ltab=required]").click();true');
      results.push({name,width,...state,synthetic:true});
    }
    const screenshot=await send('Page.captureScreenshot',{format:'png'},sessionId);
    writeFileSync(join(out,'legal-'+name+'.png'),Buffer.from(screenshot.data,'base64'));
    await send('Target.closeTarget',{targetId});
  }
  assert.equal(errors.length,0,'browser exceptions');
  writeFileSync(join(out,'results.json'),JSON.stringify({
    browser,source:['public/mobile-feature-loader.js','public/legal-ui.js'],legacyControl:legacy,syntheticFixture:true,
    authenticated:false,preview:false,production:false,results,errors
  },null,2));
  console.log(JSON.stringify({browser,scenarios:results.length,legacyControl:legacy,passed:true}));
}catch(e){
  writeFileSync(join(out,'failure.json'),JSON.stringify({error:String(e.stack||e),results,errors},null,2));
  throw e;
}finally{
  ws?.close();child?.kill('SIGTERM');server.close();
  await new Promise(resolve=>setTimeout(resolve,100));
  rmSync(profile,{recursive:true,force:true});
}
