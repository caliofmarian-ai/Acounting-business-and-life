// Narrow adapters for existing close controls. No global DOM observer or route inference.
// Other feature modals must opt in after their own close/draft contracts are reviewed.
export function createBackSurfaces(win){
  const doc=win.document;
  const registry=[['lazyMoreBackdrop','lazyMoreClose'],['profileDrawerBackdrop','drawerClose'],['editDialog','editCancel']];
  const dirty=new Set();
  let previousFocus=null,exitNode=null,restoreInert=[];
  const visible=node=>Boolean(node?.isConnected&&!node.closest('[hidden],.hidden,[aria-hidden="true"]')&&node.getClientRects().length);
  const filipino=()=>/^(fil|tl)(-|$)/i.test(doc.documentElement.lang||'');
  function edited(event){
    const target=event.target;
    if(!target?.matches?.('input:not([type="search"]),textarea,select')||target.disabled||target.readOnly)return;
    const form=target.closest('form');if(form)dirty.add(form);
  }
  doc.addEventListener('input',edited,true);doc.addEventListener('change',edited,true);
  function allowNavigation(container=doc){
    const forms=[];
    for(const form of dirty){
      if(!form.isConnected){dirty.delete(form);continue;}
      if(visible(form)&&(container===doc||container.contains(form)))forms.push(form);
    }
    if(!forms.length)return true;
    const yes=win.confirm(filipino()?'May mga pagbabagong hindi pa nai-save. Umalis nang hindi sine-save?':'You have unsaved changes. Leave without saving?');
    if(yes)for(const form of forms)dirty.delete(form);
    return yes;
  }
  function top(){
    const candidates=registry.map(([id,closeId],order)=>({node:doc.getElementById(id),closeId,order})).filter(x=>visible(x.node));
    candidates.sort((a,b)=>{
      const priority=x=>x.node.tagName==='DIALOG'&&x.node.open?1e9:(Number.parseInt(win.getComputedStyle(x.node).zIndex,10)||0);
      return priority(b)-priority(a)||b.order-a.order;
    });
    return candidates[0]||null;
  }
  function consumeBack(){
    const layer=top();if(!layer)return false;
    if(!allowNavigation(layer.node))return true;
    if(layer.node.tagName==='DIALOG'){
      if(typeof layer.node.requestClose==='function')layer.node.requestClose();
      else if(layer.node.dispatchEvent(new win.Event('cancel',{cancelable:true})))layer.node.close();
    }else{
      const close=doc.getElementById(layer.closeId);
      if(close&&!close.disabled)close.click(); // Original cleanup/body-lock handlers stay authoritative.
    }
    return true;
  }
  doc.addEventListener('cancel',event=>{
    if(event.target?.id==='editDialog'&&!allowNavigation(event.target))event.preventDefault();
  },true);
  doc.addEventListener('click',event=>{
    const close=event.target?.closest?.('#editCancel,#lazyMoreClose,#drawerClose');
    if(!close)return;
    const item=registry.find(([,id])=>id===close.id),node=doc.getElementById(item[0]);
    if(node&&!allowNavigation(node)){event.preventDefault();event.stopImmediatePropagation();}
  },true);
  function endExit(){
    if(!exitNode)return;
    for(const [node,wasInert]of restoreInert)if(node.isConnected)node.inert=wasInert;
    restoreInert=[];exitNode=null;
    if(visible(previousFocus))previousFocus.focus({preventScroll:true});
    previousFocus=null;
  }
  function prepareExit(){previousFocus=doc.activeElement;}
  function beginExit({canLeaveToPage}){
    exitNode=doc.getElementById('appExitPrompt');if(!exitNode)return;
    if(!canLeaveToPage){
      const copy=exitNode.querySelector('#appExitDescription');
      if(copy)copy.textContent=filipino()?'Unang screen na ito. Piliin ang Lumabas, pagkatapos ay gamitin muli ang Back ng telepono para lumabas.':'This is the first screen. Choose Leave, then use your phone’s Back control once more to leave.';
    }
    restoreInert=Array.from(doc.body.children).filter(n=>n!==exitNode).map(n=>[n,n.inert]);
    for(const [node]of restoreInert)node.inert=true;
    exitNode.addEventListener('keydown',event=>{
      if(event.key!=='Tab')return;
      const buttons=Array.from(exitNode.querySelectorAll('button:not([disabled])'));
      if(!buttons.length)return;
      const index=buttons.indexOf(doc.activeElement),next=(index+(event.shiftKey?-1:1)+buttons.length)%buttons.length;
      event.preventDefault();buttons[next].focus();
    });
  }
  return{consumeBack,allowNavigation,prepareExit,beginExit,endExit};
}
