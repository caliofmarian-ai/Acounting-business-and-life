// Browser/PWA Back history for the shared Account/Profile shell. No URL or server-side state.
const KEY = '__abl_back_v1';
const routeEqual = (a,b) => JSON.stringify(a)===JSON.stringify(b);
const identity = context => context?.accountId ? String(context.accountId)+':'+String(context.activeRole||'none') : null;

export function createAppBackController({history, subscribePop, getContext, restore, onChange=()=>{}, onExit=()=>{}}) {
  let started=false, scope=null, sequence=0, restoring=false, exitPending=false, activeRoute=null, generation=0, restoreVersion=0;
  // Old same-tab entries from a prior page load are deliberately not restorable.
  const sessionTag=Math.random().toString(36).slice(2);
  const activeIdentity=()=>identity(getContext())?identity(getContext())+':'+sessionTag:null;
  const entry=state=>state&&typeof state==='object'?state[KEY]:null;
  const current=()=>entry(history.state);
  const withEntry=value=>({...((history.state&&typeof history.state==='object')?history.state:{}),[KEY]:value});
  const routeEntry=(route,seq)=>({version:1,route,seq,scope,generation});
  const emit=()=>onChange({started,canGoBack:Boolean(started&&current()?.seq>1),atRoot:current()?.seq===1,exitPending,route:activeRoute});
  function validContext(){return Boolean(activeIdentity()&&getContext()?.authenticated)}
  function begin(route={kind:'account-home'}) {
    if(started||!validContext())return started;
    started=true;scope=activeIdentity();activeRoute=route;
    // Two same-document entries give Android a chance to ask before leaving the PWA.
    history.replaceState(withEntry(routeEntry(route,0)),'');
    history.pushState(withEntry(routeEntry(route,1)),'');
    sequence=1;emit();return true;
  }
  function record(route) {
    if(!route||!validContext()||restoring)return false;
    if(!started)begin({kind:'account-home'});
    if(!started)return false;
    if(activeIdentity()!==scope)invalidate();
    if(routeEqual(activeRoute,route))return false;
    activeRoute=route;
    history.pushState(withEntry(routeEntry(route,++sequence)),'');
    emit();return true;
  }
  async function restoreSafe(route) {
    if(!validContext())return;
    restoring=true;
    const version=++restoreVersion;
    try {
      const result=await restore(route);
      if(version===restoreVersion&&result===false&&route.kind!=='account-home'){
        activeRoute={kind:'account-home'};
        history.replaceState(withEntry(routeEntry(activeRoute,current()?.seq||1)),'');
        await restore(activeRoute);
        emit();
      }
    } finally { if(version===restoreVersion)restoring=false; }
  }
  function invalidate() {
    if(!started)return;
    generation+=1;scope=activeIdentity();activeRoute={kind:'account-home'};
    history.replaceState(withEntry(routeEntry(activeRoute,current()?.seq||1)),'');
    emit();
  }
  function syncContext() {
    if(!validContext()){exitPending=false;started=false;scope=null;restoreVersion++;restoring=false;emit();return}
    if(!started){begin();return}
    if(scope!==activeIdentity())invalidate();
  }
  function pop(event) {
    if(!started)return;
    const next=entry(event.state);
    if(!next||next.version!==1)return;
    if(next.seq===0) {
      exitPending=true;
      onExit({stay,leave});
      emit();return;
    }
    exitPending=false;
    const currentContext=getContext();
    const safe=Boolean(currentContext?.authenticated&&next.scope===scope&&next.generation===generation&&
      (next.route?.kind==='account-home'||next.route?.kind==='account-settings'||
       (next.route?.role&&next.route.role===currentContext.activeRole)));
    activeRoute=safe?next.route:{kind:'account-home'};
    if(!safe)history.replaceState(withEntry(routeEntry(activeRoute,next.seq)),'');
    emit();
    void restoreSafe(activeRoute);
  }
  function back(){if(started&&!exitPending)history.back()}
  function stay() {
    if(!exitPending||!validContext())return false;
    exitPending=false;
    // The user explicitly chose to stay; restore a single guard entry.
    activeRoute={kind:'account-home'};
    history.pushState(withEntry(routeEntry(activeRoute,++sequence)),'');
    emit();return true;
  }
  function leave(){if(!exitPending)return false;exitPending=false;emit();history.back();return true}
  subscribePop(pop);
  return Object.freeze({begin,record,back,stay,leave,syncContext,invalidate,getState:()=>({started,scope,sequence,generation,exitPending,activeRoute})});
}
