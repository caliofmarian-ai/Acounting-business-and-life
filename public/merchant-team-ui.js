/** Merchant #863: business-scoped operator shifts on the existing Orders page.
 * This is NOT an account login. Token lives only in this tab's JS memory.
 * Owner signs into the main account on an authorized device; employees never
 * see/enter that password to start their own limited assistant shift.
 */
(()=>{
  'use strict';
  const state={businessId:null,shift:null,operators:[],message:'',busy:false,epoch:0,open:false,terminalEnabled:false,legacyShiftAllowed:false,pairUrl:'',manageOpen:false};
  const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const roleName={manager:'Manager',order_operator:'Order operator',stock_helper:'Stock helper',temporary:'Temporary replacement'};
  const today=()=>new Date().toISOString();
  const workspace=()=>document.getElementById('ordersWorkspace');
  const visible=()=>Boolean(workspace()&&!workspace().classList.contains('hidden')&&workspace().querySelector('#counterOrderForm'));
  function contextBusiness(){
    const ctx=window.BusinessLifeAccounting?.getState?.();
    return Number(ctx?.role==='merchant'?ctx.activeBusinessId:0)||0;
  }
  function announce(){document.dispatchEvent(new CustomEvent('abl:merchant-team-operator-changed',{
    detail:state.shift?{businessId:state.businessId,operatorId:state.shift.operator_id,shiftId:state.shift.shift_id}:null
  }))}
  function clear(message=''){
    state.epoch++;state.shift=null;state.businessId=null;state.operators=[];state.terminalEnabled=false;state.legacyShiftAllowed=false;state.pairUrl='';state.manageOpen=false;
    state.busy=false;state.message=message;state.open=false;announce();render();
  }
  const api=async(path,options={})=>{
    const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options,
      headers:{'Content-Type':'application/json',...(state.shift?.token?{'x-merchant-team-shift':state.shift.token}:{}),...(options.headers||{})}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){const e=new Error(data.error||'Operator request unavailable.');e.code=data.code;e.status=response.status;throw e}
    return data;
  };
  function render(){
    const panel=document.getElementById('merchantTeamPanel');if(!panel)return;
    const active=state.shift;
    const options=state.operators.filter(o=>o.active).map(o=>`<option value="${h(o.id)}">${h(o.name)} — ${h(roleName[o.role]||o.role)}</option>`).join('');
    panel.innerHTML=`<details class="merchantTeamDetails" ${state.open||active||state.message?'open':''}>
      <summary><span aria-hidden="true">👥</span><span><strong>Team · Operators</strong><small>${state.terminalEnabled?'Staff enter through their restricted terminal':active?`${h(active.name)} is on shift`:'Choose who is working this shift'}</small></span><span class="merchantTeamBadge">${state.terminalEnabled?'STAFF LINK':state.legacyShiftAllowed?(active?'ON SHIFT':'CHOOSE'):'OWNER ONLY'}</span></summary>
      <div class="merchantTeamBody">
       <p class="merchantTeamHint">One Merchant, one shared Catalog and Orders. Each person uses their own shift PIN. Staff do not need a new Business & Life account.</p>
       ${state.terminalEnabled?`<p class="merchantTeamHint">For safety, give employees a private staff link and their own PIN. They must use a separate device or sign out of the owner account first. The owner stays in this Merchant workspace.</p>`:!state.legacyShiftAllowed?`<p class="merchantTeamHint">Staff login is unavailable until the restricted terminal is configured. You may manage the roster here, but cannot log a worker into the owner account.</p>`:active?`<div class="merchantTeamActive"><strong>${h(active.name)}</strong><span>${h(roleName[active.role]||active.role)}</span><small>Shift ends ${h(new Date(active.expires_at).toLocaleString('en-PH'))}</small></div>
         <button id="merchantTeamEnd" type="button">End / change operator</button>`:
         `<form id="merchantTeamStart" class="merchantTeamGrid"><label>Operator<select name="operator" required>${options||'<option value="">No operators yet</option>'}</select></label>
           <label>Personal PIN<input name="pin" type="password" inputmode="numeric" autocomplete="off" minlength="6" maxlength="10" required></label>
           <button type="submit" ${state.busy||!options?'disabled':''}>Start shift</button></form>`}
       <details class="merchantTeamManage" ${state.manageOpen?'open':''}><summary>Manage operators (owner only)</summary>
         <p>To add or disable someone, verify the main account password. Employees never need it to start a shift.</p>
         <form id="merchantTeamVerify" class="merchantTeamGrid"><label>Owner password<input name="password" type="password" autocomplete="current-password" required></label><button type="submit">Verify owner</button></form>
         <form id="merchantTeamAdd" class="merchantTeamGrid"><label>Name<input name="name" maxlength="80" required placeholder="Staff name"></label>
         <label>Role<select name="role"><option value="order_operator">Order operator</option><option value="temporary">Temporary replacement</option><option value="stock_helper">Stock helper</option><option value="manager">Manager</option></select></label>
         <label>Individual PIN<input name="pin" type="password" inputmode="numeric" autocomplete="new-password" minlength="6" maxlength="10" required></label>
         <label>Expires (optional)<input name="expires_at" type="datetime-local"></label><button type="submit">Add operator</button></form>
         ${state.terminalEnabled?`<div class="merchantTeamPair"><button type="button" id="merchantTeamPair">Create temporary staff access link</button>${state.pairUrl?`<label>Private access link (10 minutes)<input id="merchantTeamPairLink" readonly value="${h(state.pairUrl)}"></label><button type="button" id="merchantTeamPairCopy">Copy link</button>`:''}<p>Share with the worker only. Do not share the owner account password.</p></div>`:''}
         <div class="merchantTeamRoster">${state.operators.map(o=>`<div><span><strong>${h(o.name)}</strong><small>${h(roleName[o.role]||o.role)} · ${o.active?'Active':'Disabled'}</small></span>${o.active?`<button type="button" data-team-disable="${h(o.id)}">Disable</button>`:''}</div>`).join('')}</div>
       </details>
       <div class="merchantTeamNotice" role="status">${h(state.message)}</div>
      </div>
    </details>`;
    panel.querySelector('details.merchantTeamDetails').ontoggle=e=>{state.open=e.target.open};
    panel.querySelector('details.merchantTeamManage').ontoggle=e=>{state.manageOpen=e.target.open};
    panel.querySelector('#merchantTeamStart')?.addEventListener('submit',async e=>{
      e.preventDefault();if(state.busy)return;state.busy=true;
      const input=new FormData(e.currentTarget),bid=state.businessId,epoch=state.epoch;
      try{const result=await api('/api/orders/team/shift/start',{method:'POST',body:JSON.stringify({business_id:bid,operator_id:input.get('operator'),pin:input.get('pin')})});
        if(epoch!==state.epoch)return;state.shift=result.shift;state.message='Shift started. Voice drafts are now linked to this operator.';announce();
      }catch(ex){if(epoch===state.epoch)state.message=ex.message}
      finally{state.busy=false;render()}
    });
    panel.querySelector('#merchantTeamEnd')?.addEventListener('click',async()=>{
      if(!state.shift)return;const bid=state.businessId;
      try{await api('/api/orders/team/shift/end',{method:'POST',body:JSON.stringify({business_id:bid})})}catch{}
      state.shift=null;state.message='Shift ended. Next operator must use their own PIN.';announce();render();
    });
    panel.querySelector('#merchantTeamVerify')?.addEventListener('submit',async e=>{
      e.preventDefault();const form=e.currentTarget,password=new FormData(form).get('password');
      try{await api('/api/auth/step-up/password',{method:'POST',body:JSON.stringify({password})});state.message='Owner verified. You can manage the team for the next 10 minutes.';}
      catch(ex){state.message=ex.message}
      finally{form.reset();render()}
    });
    panel.querySelector('#merchantTeamAdd')?.addEventListener('submit',async e=>{
      e.preventDefault();const data=new FormData(e.currentTarget),bid=state.businessId;
      const payload={business_id:bid,name:data.get('name'),role:data.get('role'),pin:data.get('pin')};
      const expiry=data.get('expires_at');if(expiry)payload.expires_at=new Date(String(expiry)).toISOString();
      try{await api('/api/orders/team/operators',{method:'POST',body:JSON.stringify(payload)});state.message='Operator added.';await loadRoster(bid)}
      catch(ex){state.message=ex.message}finally{render()}
    });
    panel.querySelector('#merchantTeamPair')?.addEventListener('click',async()=>{
      if(state.busy)return;state.busy=true;
      try{const res=await api('/api/orders/team/terminal/pair',{method:'POST',
        body:JSON.stringify({business_id:state.businessId})});
        state.pairUrl=location.origin+'/operator'+res.url_fragment;
        state.message='Private link created. Open it on the worker phone, or sign out before using it in this browser.';
      }catch(ex){state.message=ex.message}finally{state.busy=false;render()}
    });
    panel.querySelector('#merchantTeamPairCopy')?.addEventListener('click',async()=>{
      try{await navigator.clipboard.writeText(state.pairUrl);state.message='Access link copied.'}
      catch{window.prompt('Copy the private staff link:',state.pairUrl)}render()
    });
    panel.querySelectorAll('[data-team-disable]').forEach(btn=>btn.onclick=async()=>{
      const operatorId=btn.dataset.teamDisable;if(!operatorId||!window.confirm('Disable this operator and end their shifts?'))return;
      try{await api(`/api/orders/team/operators/${encodeURIComponent(operatorId)}/disable`,{method:'PATCH',body:JSON.stringify({business_id:state.businessId})});
        state.message='Operator access disabled.';if(state.shift?.operator_id===operatorId){state.shift=null;announce()}
        await loadRoster(state.businessId);
      }catch(ex){state.message=ex.message}render();
    });
  }
  async function loadRoster(bid){
    const result=await api(`/api/orders/team/operators?business_id=${encodeURIComponent(bid)}`);
    if(state.businessId===bid){state.operators=Array.isArray(result.operators)?result.operators:[];state.terminalEnabled=result.terminal_enabled===true;state.legacyShiftAllowed=result.legacy_shift_allowed===true;}
  }
  let pending=false;
  async function attach(){
    if(!visible()){if(state.shift)clear('Merchant Orders closed; shift ended on this device.');return}
    const bid=contextBusiness();if(!Number.isInteger(bid)||bid<1)return;
    if(state.businessId!==bid){clear();state.businessId=bid;try{await loadRoster(bid)}catch(ex){state.message=ex.message}}
    if(!visible()||state.businessId!==bid)return;
    const target=workspace().querySelector('#counterOrderForm');if(!target)return;
    if(!document.getElementById('merchantTeamPanel')){
      const el=document.createElement('section');el.id='merchantTeamPanel';el.className='merchantTeamPanel';
      target.closest('.orderCreateCard')?.insertAdjacentElement('beforebegin',el);
    }
    render();
  }
  function schedule(){if(pending)return;pending=true;queueMicrotask(()=>{pending=false;void attach()})}
  function observe(){
    const w=workspace();if(w){new MutationObserver(schedule).observe(w,{childList:true,attributes:true,attributeFilter:['class']});schedule();return}
    const shell=document.getElementById('shell');if(!shell)return;
    const mo=new MutationObserver(()=>{if(workspace()){mo.disconnect();observe()}});mo.observe(shell,{childList:true,subtree:true});
  }
  document.addEventListener('abl:business-workspace-changed',()=>clear('Business changed; operator session cleared.'),{passive:true});
  document.addEventListener('abl:profile-state',()=>{if(!visible())clear()},{passive:true});
  document.addEventListener('abl:auth-expired',()=>clear(),{passive:true});
  window.BusinessLifeMerchantTeam=Object.freeze({
    current:()=>state.shift?{operator_id:state.shift.operator_id,shift_id:state.shift.shift_id,
      business_id:state.businessId,name:state.shift.name,role:state.shift.role,permissions:[...state.shift.permissions]}:null,
    headers:()=>state.shift?.token?{'x-merchant-team-shift':state.shift.token}:{},
    active:()=>Boolean(state.shift),
    clear
  });
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',observe,{once:true});else observe();
})();