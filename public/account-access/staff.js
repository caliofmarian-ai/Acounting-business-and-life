(() => {
  'use strict';
  const byId=id=>document.getElementById(id),queue=byId('queue'),detail=byId('detail'),feedback=byId('feedback'),more=byId('more'),filter=byId('filter'),save=byId('save');
  let cursor=null,current=null,sequence=0,detailSequence=0,busy=false,epoch=0,retired=false;
  const pending=new Set();
  const reasonNames={sign_in:'Sign-in problem',password_reset:'Password reset',email_verification:'Email verification',lost_email:'Previous email unavailable',other_access:'Other access problem'};
  const show=(message,error=false)=>{feedback.textContent=message;feedback.dataset.kind=error?'error':'success';};
  function csrf(){try{return decodeURIComponent(document.cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith('__Host-abl_csrf='))?.slice('__Host-abl_csrf='.length)||'');}catch{return'';}}
  // Bind this page to its initial readable CSRF generation, never to a bearer
  // token. Changing browser credentials requires a fresh authorized page load.
  const pageSession=csrf();
  function clearDetail(){
    current=null;detail.hidden=true;
    for(const id of ['case-title','case-email','case-name','case-reason','case-created','case-message'])byId(id).textContent='';
    byId('case-note').value='';byId('case-status').value='new';
  }
  function clearPrivate(){clearDetail();cursor=null;detailSequence++;queue.replaceChildren();more.hidden=true;}
  function retire(message='Your session changed or expired. Return to the app, then reopen this private workspace.'){
    if(!retired){retired=true;epoch++;sequence++;clearPrivate();for(const controller of pending)controller.abort();pending.clear();}
    for(const control of [filter,save,more,byId('refresh')])control.disabled=true;
    show(message,true);
  }
  function currentSession(expected=epoch){
    if(retired||expected!==epoch)return false;
    if(!pageSession||csrf()!==pageSession){retire();return false;}
    return true;
  }
  function stale(){return Object.assign(new Error('The previous session request was discarded.'),{stale:true});}
  async function api(path,body){
    const started=epoch;
    if(!currentSession(started))throw stale();
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);pending.add(controller);
    try{
      const response=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',headers:body?{'Content-Type':'application/json','X-CSRF-Token':pageSession}:{},...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal});
      if(!currentSession(started))throw stale();
      const data=await response.json().catch(()=>null);
      if(!currentSession(started))throw stale();
      if(response.status===401||response.status===403){retire('Your session or staff permission is unavailable. Return to the app and sign in with an authorized account.');throw stale();}
      if(response.status===409)throw new Error('Another staff member changed this request. Reopen it from the queue before saving.');
      if(!response.ok||!data)throw new Error('The request could not be completed. No successful change has been confirmed. Retry or refresh the queue.');
      return data;
    }catch(error){
      if(!currentSession(started))throw stale();
      if(error?.name==='AbortError')throw new Error('The request timed out. No successful change has been confirmed. Refresh before retrying.');
      throw error;
    }finally{clearTimeout(timer);pending.delete(controller);}
  }
  async function loadCase(id){
    if(!currentSession())return;
    const token=++detailSequence;clearDetail();
    try{
      const item=await api('/api/admin/account-access/'+encodeURIComponent(id));
      if(token!==detailSequence||!currentSession())return;
      current=item;byId('case-title').textContent='Request #'+item.id;
      byId('case-email').textContent=item.contact_email;byId('case-name').textContent=item.display_name||'Not provided';
      byId('case-reason').textContent=reasonNames[item.reason]||item.reason;
      byId('case-created').textContent=new Date(item.created_at).toLocaleString();byId('case-message').textContent=item.message;
      byId('case-status').value=item.status;byId('case-note').value=item.staff_note||'';detail.hidden=false;
      detail.scrollIntoView({block:'start',behavior:'auto'});show('Request loaded privately. Contact details are not proof of ownership.');
    }catch(error){if(!error?.stale&&token===detailSequence&&currentSession())show(error.message||'Could not load this request.',true);}
  }
  async function loadQueue(append=false){
    if(!currentSession())return;
    const token=++sequence;
    if(!append)clearPrivate();
    more.disabled=true;byId('refresh').disabled=true;
    try{
      const params=new URLSearchParams({status:filter.value});if(append&&cursor)params.set('before',cursor);
      const data=await api('/api/admin/account-access?'+params);
      if(token!==sequence||!currentSession())return;
      if(!append)queue.replaceChildren();
      for(const item of data.items||[]){
        const li=document.createElement('li'),button=document.createElement('button');button.type='button';
        button.textContent=`#${item.id} · ${reasonNames[item.reason]||item.reason} · ${item.status}`;
        button.addEventListener('click',()=>{if(!busy)loadCase(item.id);});li.append(button);queue.append(li);
      }
      cursor=data.next_cursor||null;more.hidden=!cursor;show(queue.children.length?'Select a request to review its private details.':'No requests match this status.');
    }catch(error){if(!error?.stale&&token===sequence&&currentSession())show(error.message||'Could not load the queue.',true);}
    finally{if(token===sequence&&currentSession()){more.disabled=false;byId('refresh').disabled=false;}}
  }
  byId('triage').addEventListener('submit',async event=>{
    event.preventDefault();if(!current||busy||!currentSession())return;
    busy=true;save.disabled=true;filter.disabled=true;byId('refresh').disabled=true;more.disabled=true;
    const id=current.id,revision=Number(current.revision),started=epoch,selected=detailSequence;
    try{
      const result=await api('/api/admin/account-access/'+encodeURIComponent(id)+'/triage',{status:byId('case-status').value,note:byId('case-note').value,revision});
      if(!currentSession(started)||selected!==detailSequence||current?.id!==id)return;
      current.revision=result.revision;current.status=result.status;
      show('Triage saved. No email was sent and no account access was changed.');
      for(const button of queue.querySelectorAll('button'))if(button.textContent.startsWith('#'+id+' · '))button.textContent=`#${id} · ${reasonNames[current.reason]||'Account access'} · ${result.status}`;
    }catch(error){if(!error?.stale&&currentSession(started)&&selected===detailSequence)show(error.message||'Could not confirm that the update was saved.',true);}
    finally{busy=false;if(currentSession(started)){save.disabled=false;filter.disabled=false;byId('refresh').disabled=false;more.disabled=false;}}
  });
  byId('refresh').addEventListener('click',()=>{if(!busy)loadQueue();});filter.addEventListener('change',()=>{if(!busy)loadQueue();});more.addEventListener('click',()=>{if(!busy)loadQueue(true);});
  document.addEventListener('abl:auth-expired',()=>retire());
  window.addEventListener('pagehide',()=>retire('This private workspace was left. Reopen it from the app to load current authorized data.'));
  window.addEventListener('pageshow',event=>{if(event.persisted)retire('Reopen this private workspace from the app after returning to this page.');});
  window.addEventListener('focus',()=>currentSession());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)currentSession();});
  loadQueue();
})();
