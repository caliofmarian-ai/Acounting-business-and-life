(() => {
  'use strict';
  const byId=id=>document.getElementById(id),queue=byId('queue'),detail=byId('detail'),feedback=byId('feedback'),more=byId('more'),filter=byId('filter'),save=byId('save');
  let cursor=null,current=null,sequence=0,detailSequence=0,busy=false;
  const reasonNames={sign_in:'Sign-in problem',password_reset:'Password reset',email_verification:'Email verification',lost_email:'Previous email unavailable',other_access:'Other access problem'};
  const show=(message,error=false)=>{feedback.textContent=message;feedback.dataset.kind=error?'error':'success';};
  function clearPrivate(){current=null;cursor=null;detailSequence++;queue.replaceChildren();detail.hidden=true;more.hidden=true;for(const id of ['case-email','case-name','case-reason','case-created','case-message'])byId(id).textContent='';byId('case-note').value='';}
  function csrf(){try{return decodeURIComponent(document.cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith('__Host-abl_csrf='))?.slice('__Host-abl_csrf='.length)||'');}catch{return'';}}
  async function api(path,body){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',headers:body?{'Content-Type':'application/json','X-CSRF-Token':csrf()}:{},...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal});
      const data=await response.json().catch(()=>null);
      if(response.status===401||response.status===403){sequence++;clearPrivate();const message='Your session or staff permission is unavailable. Return to the app and sign in with an authorized account.';show(message,true);throw new Error(message);}
      if(response.status===409)throw new Error('Another staff member changed this request. Reopen it from the queue before saving.');
      if(!response.ok||!data)throw new Error('The request could not be completed. No successful change has been confirmed. Retry or refresh the queue.');
      return data;
    }finally{clearTimeout(timer);}
  }
  async function loadCase(id){
    const token=++detailSequence;current=null;detail.hidden=true;
    try{
      const item=await api('/api/admin/account-access/'+encodeURIComponent(id));
      if(token!==detailSequence)return;
      current=item;byId('case-title').textContent='Request #'+item.id;
      byId('case-email').textContent=item.contact_email;byId('case-name').textContent=item.display_name||'Not provided';
      byId('case-reason').textContent=reasonNames[item.reason]||item.reason;
      byId('case-created').textContent=new Date(item.created_at).toLocaleString();byId('case-message').textContent=item.message;
      byId('case-status').value=item.status;byId('case-note').value=item.staff_note||'';detail.hidden=false;
      detail.scrollIntoView({block:'start',behavior:'auto'});show('Request loaded privately. Contact details are not proof of ownership.');
    }catch(error){if(token===detailSequence)show(error.message||'Could not load this request.',true);}
  }
  async function loadQueue(append=false){
    const token=++sequence;
    if(!append){clearPrivate();}
    more.disabled=true;byId('refresh').disabled=true;
    try{
      const params=new URLSearchParams({status:filter.value});if(append&&cursor)params.set('before',cursor);
      const data=await api('/api/admin/account-access?'+params);
      if(token!==sequence)return;
      if(!append)queue.replaceChildren();
      for(const item of data.items||[]){
        const li=document.createElement('li'),button=document.createElement('button');button.type='button';
        button.textContent=`#${item.id} · ${reasonNames[item.reason]||item.reason} · ${item.status}`;
        button.addEventListener('click',()=>{if(!busy)loadCase(item.id);});li.append(button);queue.append(li);
      }
      cursor=data.next_cursor||null;more.hidden=!cursor;show(queue.children.length?'Select a request to review its private details.':'No requests match this status.');
    }catch(error){if(token===sequence)show(error.message||'Could not load the queue.',true);}
    finally{if(token===sequence){more.disabled=false;byId('refresh').disabled=false;}}
  }
  byId('triage').addEventListener('submit',async event=>{
    event.preventDefault();if(!current||busy)return;
    busy=true;save.disabled=true;filter.disabled=true;byId('refresh').disabled=true;more.disabled=true;
    const id=current.id,revision=Number(current.revision);
    try{
      const result=await api('/api/admin/account-access/'+encodeURIComponent(id)+'/triage',{status:byId('case-status').value,note:byId('case-note').value,revision});
      if(current?.id===id){current.revision=result.revision;current.status=result.status;}
      show('Triage saved. No email was sent and no account access was changed.');
      for(const button of queue.querySelectorAll('button'))if(button.textContent.startsWith('#'+id+' · '))button.textContent=`#${id} · ${reasonNames[current?.reason]||'Account access'} · ${result.status}`;
    }catch(error){show(error.message||'Could not confirm that the update was saved.',true);}
    finally{busy=false;save.disabled=false;filter.disabled=false;byId('refresh').disabled=false;more.disabled=false;}
  });
  byId('refresh').addEventListener('click',()=>{if(!busy)loadQueue();});filter.addEventListener('change',()=>loadQueue());more.addEventListener('click',()=>{if(!busy)loadQueue(true);});
  window.addEventListener('pagehide',clearPrivate);
  loadQueue();
})();
