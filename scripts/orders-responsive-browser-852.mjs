// Real Chrome + actual public/orders.css, with synthetic orders only.
// NOT an authenticated Android, shared Preview, or Production acceptance.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const out=process.env.ORDERS_BROWSER_OUT||'artifacts/orders-responsive-852';
mkdirSync(out,{recursive:true});
const css=readFileSync('public/orders.css','utf8');
const card='<article class="orderCard"><div class="orderCardTop">'+
  '<div class="orderCardMain"><strong>Order PH-12345</strong><p>Sample customer · Delivery</p></div>'+
  '<span class="orderStatus">Awaiting Customer Presence</span></div>'+
  '<div class="orderMoney"><div><small>Awaiting payment</small><br><strong>₱1,250.00</strong></div>'+
  '<small>Due ₱1,250.00</small></div><div class="orderActions">'+
  '<button type="button">Presence verified</button><button type="button">Cancel</button></div></article>';
const html='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<link rel="stylesheet" href="/orders.css"></head><body style="margin:0;background:#f7faf9;font:14px system-ui">'+
  '<main class="ordersWorkspace"><div class="ordersBoard">'+
  ['Waiting','Accepted','Preparing','Ready'].map(name=>
    '<section class="orderLane"><div class="orderLaneHeader"><h2>'+name+
    '</h2></div><div class="orderCards">'+card+'</div></section>').join('')+
  '</div></main></body></html>';
const server=createServer((req,res)=>{
  if(req.url==='/orders.css'){res.setHeader('content-type','text/css');res.end(css);}
  else if(req.url==='/fixture'){res.setHeader('content-type','text/html; charset=utf-8');res.end(html);}
  else{res.statusCode=404;res.end('not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const chrome=process.env.CHROME_BIN||execFileSync('sh',['-c','command -v chromium || command -v google-chrome']).toString().trim();
const profile=mkdtempSync(join(tmpdir(),'orders-852-'));
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
    'const r=e=>e.getBoundingClientRect(),lanes=[...document.querySelectorAll(".orderLane")],'+
    'card=lanes[0].querySelector(".orderCard"),main=card.querySelector(".orderCardMain"),'+
    'label=main.querySelector("strong"),button=card.querySelector("button");'+
    'return {viewport:innerWidth,lanesPerRow:lanes.filter(e=>Math.abs(r(e).top-r(lanes[0]).top)<2).length,'+
    'laneWidth:Math.round(r(lanes[0]).width),labelWidth:Math.round(r(main).width),'+
    'labelHeight:Math.round(r(label).height),buttonHeight:Math.round(r(button).height),'+
    'pageWidth:document.documentElement.scrollWidth,'+
    'pointerCoarse:matchMedia("(pointer:coarse)").matches,'+
    'portrait:matchMedia("(orientation:portrait)").matches,'+
    'css:document.styleSheets[0].href};})()';
  // The touch/portrait 980px case models an Android browser with Desktop site ON:
  // virtual CSS viewport is wide, while the physical device is portrait/coarse.
  // Synthetic emulation is not a real physical-device acceptance result.
  const scenarios=[
    ...[320,360,390,412].map(width=>({name:String(width),width,height:900,mobile:true,touch:false,expectedLanes:1})),
    {name:'980',width:980,height:900,mobile:false,touch:false,expectedLanes:2},
    {name:'980-touch-portrait',width:980,height:1800,mobile:true,touch:true,expectedLanes:1},
    {name:'1280',width:1280,height:900,mobile:false,touch:false,expectedLanes:4}
  ];
  for(const scenario of scenarios){
    const {name,width,height,mobile,touch,expectedLanes}=scenario;
    const {targetId}=await send('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
    await send('Page.enable',{},sessionId);await send('Runtime.enable',{},sessionId);
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:touch?3:1,mobile},sessionId);
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
    assert.equal(m.lanesPerRow,expectedLanes,name+' lane count');
    if(touch){
      assert.equal(m.pointerCoarse,true,name+' must exercise actual CSS coarse-pointer override');
      assert.equal(m.portrait,true,name+' must exercise portrait override');
    }
    assert.ok(m.labelWidth>=160,width+'px order label narrow: '+m.labelWidth);
    assert.ok(m.labelHeight<=60,width+'px vertical letter wrap');
    assert.ok(m.buttonHeight>=44,width+'px button touch target');
    assert.ok(m.pageWidth<=width,width+'px horizontal page overflow');
    assert.ok(m.css?.endsWith('/orders.css'),'must use real CSS');
    const screenshot=await send('Page.captureScreenshot',{format:'png'},sessionId);
    writeFileSync(join(out,'orders-'+name+'.png'),Buffer.from(screenshot.data,'base64'));
    results.push({name,width,height,mobile,touch,...m});
    await send('Target.closeTarget',{targetId});
  }
  assert.equal(errors.length,0,'browser exceptions');
  writeFileSync(join(out,'results.json'),JSON.stringify({
    browser,source:'public/orders.css',syntheticFixture:true,
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
