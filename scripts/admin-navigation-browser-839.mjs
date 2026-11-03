// Real Chrome + actual Admin CSS, with a synthetic navigation fixture only.
// NOT an authenticated Android, shared Preview, or Production acceptance.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const out=process.env.ADMIN_NAV_BROWSER_OUT||'artifacts/admin-navigation-839';
mkdirSync(out,{recursive:true});
const css=readFileSync('public/admin-console.css','utf8');
const html='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<link rel="stylesheet" href="/admin-console.css"></head><body><div class="adminShell">'+
  '<header class="adminTopbar"><h1>Admin Workspace</h1></header><div class="workspace">'+
  '<nav class="adminNav"><div class="adminNavChooser"><label for="adminModuleSelect">All sections (2)</label>'+
  '<select id="adminModuleSelect" aria-label="Go to Admin section"><option>Dashboard</option><option>Members</option></select></div>'+
  '<button type="button" class="active">Dashboard</button><button type="button">Members</button></nav>'+
  '<main class="adminMain"><section class="card"><h2>Controlled CSS fixture</h2><p>No account or permissions are simulated.</p></section></main></div></div></body></html>';
const server=createServer((req,res)=>{
  if(req.url==='/admin-console.css'){res.setHeader('content-type','text/css');res.end(css);}
  else if(req.url==='/fixture'){res.setHeader('content-type','text/html; charset=utf-8');res.end(html);}
  else{res.statusCode=404;res.end('not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const chrome=process.env.CHROME_BIN||execFileSync('sh',['-c','command -v chromium || command -v google-chrome']).toString().trim();
const profile=mkdtempSync(join(tmpdir(),'admin-839-'));
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
  const measure='(() => {if(document.readyState!=="complete"||!document.styleSheets.length)return null;'+
    'const chooser=document.querySelector(".adminNavChooser"),select=chooser.querySelector("select"),button=document.querySelector(".adminNav button");'+
    'return {viewport:innerWidth,chooserVisible:getComputedStyle(chooser).display!=="none"&&chooser.getBoundingClientRect().width>0,'+
    'selectHeight:Math.round(select.getBoundingClientRect().height),buttonMinHeight:parseFloat(getComputedStyle(button).minHeight),'+
    'pageWidth:document.documentElement.scrollWidth,physicalScreenWidth:screen.width,physicalScreenHeight:screen.height,'+
    'smallPhysicalTouch:matchMedia("(pointer:coarse) and (max-device-width:600px)").matches,'+
    'pointerCoarse:matchMedia("(pointer:coarse)").matches,css:document.styleSheets[0].href};})()';
  // A real Chrome CSS viewport emulation; not authenticated or physical Android acceptance.
  const scenarios=[
    {name:'320-phone',width:320,height:844,mobile:true,touch:true,expectedChooser:true},
    {name:'390-phone',width:390,height:844,mobile:true,touch:true,expectedChooser:true},
    {name:'412-phone',width:412,height:900,mobile:true,touch:true,expectedChooser:true},
    {name:'980-phone-desktop-site',width:980,height:600,screenWidth:390,screenHeight:844,mobile:true,touch:true,expectedChooser:true},
    {name:'1280-phone-desktop-site',width:1280,height:650,screenWidth:390,screenHeight:844,mobile:true,touch:true,expectedChooser:true},
    {name:'980-touch-tablet',width:980,height:650,screenWidth:1024,screenHeight:768,mobile:true,touch:true,expectedChooser:false},
    {name:'980-desktop',width:980,height:900,mobile:false,touch:false,expectedChooser:false},
    {name:'1280-desktop',width:1280,height:900,mobile:false,touch:false,expectedChooser:false}
  ];
  for(const scenario of scenarios){
    const {name,width,height,mobile,touch,expectedChooser,screenWidth,screenHeight}=scenario;
    const {targetId}=await send('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
    await send('Page.enable',{},sessionId);await send('Runtime.enable',{},sessionId);
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:touch?3:1,mobile,...(screenWidth?{screenWidth,screenHeight}:{})},sessionId);
    await send('Emulation.setTouchEmulationEnabled',{enabled:touch,maxTouchPoints:touch?5:1},sessionId);
    await send('Page.navigate',{url:origin+'/fixture'},sessionId);
    let m=null;
    for(let i=0;i<100;i++){
      const v=await send('Runtime.evaluate',{expression:measure,returnByValue:true},sessionId);
      if(v.exceptionDetails)throw new Error(v.exceptionDetails.text);
      m=v.result.value;if(m)break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.ok(m,'fixture failed to load '+width);
    assert.equal(m.viewport,width,'unexpected CSS viewport '+width);
    assert.equal(m.chooserVisible,expectedChooser,name+' All sections visibility');
    if(expectedChooser){
      assert.ok(m.selectHeight>=44,name+' select touch target');
      assert.ok(m.buttonMinHeight>=44,name+' navigation touch target');
    }else{
      assert.equal(m.buttonMinHeight,38,name+' desktop/tablet navigation remains unchanged');
    }
    assert.equal(m.pointerCoarse,touch,name+' pointer mode');
    if(screenWidth)assert.equal(m.physicalScreenWidth,screenWidth,name+' physical screen width');
    assert.ok(m.pageWidth<=width,name+' horizontal page overflow');
    assert.ok(m.css?.endsWith('/admin-console.css'),'must use the actual Admin stylesheet');
    const screenshot=await send('Page.captureScreenshot',{format:'png'},sessionId);
    writeFileSync(join(out,'admin-'+name+'.png'),Buffer.from(screenshot.data,'base64'));
    results.push({name,width,height,mobile,touch,screenWidth:screenWidth??null,screenHeight:screenHeight??null,...m});
    await send('Target.closeTarget',{targetId});
  }
  assert.equal(errors.length,0,'browser exceptions');
  writeFileSync(join(out,'results.json'),JSON.stringify({
    browser,source:'public/admin-console.css',syntheticFixture:true,
    authenticated:false,preview:false,production:false,results,errors
  },null,2));
  console.log(JSON.stringify({browser,viewports:results.length,passed:true}));
}catch(e){
  writeFileSync(join(out,'failure.json'),JSON.stringify({error:String(e.stack||e),results,errors},null,2));
  throw e;
}finally{
  ws?.close();child?.kill('SIGTERM');server.close();
  await new Promise(resolve=>setTimeout(resolve,100));
  rmSync(profile,{recursive:true,force:true});
}
