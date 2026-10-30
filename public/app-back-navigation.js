// Same-document history only. Authorization remains with the shell/server.
import {createBackSurfaces} from './app-back-surfaces.js';
const KEY='__abl_back_v1';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const identity=c=>c?.accountId?`${c.accountId}:${c.activeRole||'none'}`:null;
let instance=0;

export function createAppBackController({history,subscribePop,getContext,restore,onChange=()=>{},onExit=()=>{},surfaces=null}){
  const session=`${Date.now().toString(36)}-${++instance}-${Math.random().toString(36).slice(2)}`;
  let started=false,scope=null,sequence=1,generation=0,activeRoute=null,exitPending=false;
  let restoring=false,restoreVersion=0,bounce=null,hasPreviousPage=false,leaving=false;
  let restoreAbort=null;
  const root=()=>({kind:'account-home'});
  const currentIdentity=()=>identity(getContext());
  const validContext=()=>Boolean(currentIdentity()&&getContext()?.authenticated);
  const entry=state=>state&&typeof state==='object'?state[KEY]:null;
  const owned=e=>e?.version===2&&e.session===session&&Number.isInteger(e.seq)&&e.seq>=0;
  const stateFor=(route,seq)=>({version:2,session,generation,seq,route});
  const write=(method,route,seq)=>history[method]({...((history.state&&typeof history.state==='object')?history.state:{}),[KEY]:stateFor(route,seq)},'');
  const ui=surfaces||(typeof window!=='undefined'&&window.history===history?createBackSurfaces(window):null);
  function emit(){
    onChange({started,canGoBack:Boolean(started&&sequence>1),atRoot:sequence===1,exitPending,route:activeRoute});
    if(!exitPending)ui?.endExit?.();
  }
  function cancelRestore(){restoreVersion++;restoreAbort?.abort();restoreAbort=null;restoring=false;}
  function begin(route=root()){
    if(started||!validContext())return started;
    started=true;leaving=false;scope=currentIdentity();activeRoute=route;sequence=1;
    write('replaceState',route,0);write('pushState',route,1);
    // pushState truncates forward history: length now describes entries BEFORE this root.
    hasPreviousPage=history.length>2;emit();return true;
  }
  function invalidate(){
    if(!started)return;
    cancelRestore();generation++;scope=currentIdentity();exitPending=false;
    activeRoute=root();write('replaceState',activeRoute,sequence);emit();
  }
  function syncContext(){
    if(!validContext()){
      cancelRestore();if(started||scope)generation++;started=false;scope=null;exitPending=false;bounce=null;emit();return;
    }
    if(!started){begin();return;}
    if(scope!==currentIdentity())invalidate();
  }
  function record(route){
    if(!route||!validContext()||restoring||bounce||leaving)return false;
    if(!started)begin();
    if(scope!==currentIdentity())invalidate();
    if(same(activeRoute,route))return false;
    exitPending=false;activeRoute=route;
    // Position is relative to the current entry, not the largest sequence ever used.
    sequence++;write('pushState',route,sequence);emit();return true;
  }
  async function restoreSafe(route){
    if(!validContext())return;
    cancelRestore();restoring=true;
    const version=restoreVersion,context=scope,epoch=generation;
    const controller=new AbortController();restoreAbort=controller;
    const isCurrent=()=>version===restoreVersion&&context===scope&&epoch===generation&&validContext();
    try{
      let okay=false;
      try{okay=await restore(route,{signal:controller.signal,isCurrent});}catch{okay=false;}
      if(!isCurrent()||okay!==false||route.kind==='account-home')return;
      activeRoute=root();write('replaceState',activeRoute,sequence);emit();
      try{await restore(activeRoute,{signal:controller.signal,isCurrent});}catch{/* Leave auth/error UI authoritative. */}
    }finally{if(isCurrent()){restoring=false;restoreAbort=null;}}
  }
  function returnToCurrent(next,after){
    const delta=sequence-next.seq;
    if(!delta){after();return;}
    bounce={seq:sequence,after,generation};history.go(delta);
  }
  function promptExit(){
    exitPending=true;emit();ui?.prepareExit?.();
    onExit({stay,leave,canLeaveToPage:hasPreviousPage});
    ui?.beginExit?.({stay,leave,canLeaveToPage:hasPreviousPage});
  }
  function pop(event){
    if(!started||leaving)return;
    if(!validContext()){syncContext();return;}
    if(scope!==currentIdentity())invalidate();
    const next=entry(event.state);
    if(!owned(next)){
      cancelRestore();bounce=null;exitPending=false;activeRoute=root();emit();
      void restoreSafe(activeRoute);return; // Never replay another page load's protected view.
    }
    if(bounce){
      const pending=bounce;bounce=null;
      if(next.seq===pending.seq){if(pending.generation===generation)pending.after();else emit();return;}
      // A second native traversal raced the bounce. Do not replay stale callbacks.
    }
    if(exitPending){
      // A second Back dismisses the question instead of silently leaving the app.
      returnToCurrent(next,()=>{exitPending=false;emit();});return;
    }
    if(ui?.consumeBack?.()||ui?.allowNavigation?.()===false){
      returnToCurrent(next,()=>emit());return;
    }
    if(next.seq===0){returnToCurrent(next,promptExit);return;}
    sequence=next.seq;exitPending=false;
    const c=getContext();
    const safe=next.generation===generation&&
      (next.route?.kind==='account-home'||next.route?.kind==='account-settings'||
       (next.route?.role&&next.route.role===c.activeRole));
    activeRoute=safe?next.route:root();
    if(!safe)write('replaceState',activeRoute,sequence);
    emit();void restoreSafe(activeRoute);
  }
  function back(){
    if(!started||bounce||leaving)return false;
    if(exitPending)return stay();
    if(ui?.consumeBack?.()||ui?.allowNavigation?.()===false)return true;
    history.back();return true;
  }
  function stay(){
    if(!exitPending||!validContext())return false;
    exitPending=false;emit();return true; // No extra history entry after Stay.
  }
  function leave(){
    if(!exitPending||!validContext())return false;
    exitPending=false;leaving=true;started=false;cancelRestore();emit();
    // Browsers cannot programmatically close a newly launched standalone PWA.
    // With no preceding page, release the guard; the next native Back belongs to the OS.
    history.go(hasPreviousPage?-2:-1);return true;
  }
  subscribePop(pop);
  return Object.freeze({begin,record,back,stay,leave,syncContext,invalidate,
    getState:()=>({started,scope,sequence,generation,exitPending,activeRoute,restoring,bouncing:Boolean(bounce)})});
}
