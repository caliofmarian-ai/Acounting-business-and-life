const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

async function lifecycleApi(path,options={}){
  const response=await fetch(path,{
    ...options,
    headers:{'Content-Type':'application/json',...(options.headers||{})}
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok){
    const error=new Error(payload.error||('Request failed ('+response.status+')'));
    error.status=response.status;
    error.code=payload.code||'';
    error.assessment=payload.assessment||null;
    throw error;
  }
  return payload;
}

function currentMemberId(){
  const hero=document.querySelector('.memberDetailHeroV4');
  if(!hero)return null;
  const text=hero.textContent||'';
  const match=text.match(/Account\s+#(\d+)/i);
  const id=Number(match?.[1]||0);
  return Number.isInteger(id)&&id>0?id:null;
}

function blockerMarkup(blockers=[]){
  if(!blockers.length)return'';
  return '<div class="memberDetailList">'+blockers.map(item=>
    '<article class="memberDetailItem"><div class="rowHeader"><strong>'+esc(item.message||item.code||'Account closure blocker')+'</strong><span class="status">'+esc(item.category||'review')+'</span></div>'
    +'<span class="muted">'+esc(item.next_action||'Resolve this item before account closure.')+'</span></article>'
  ).join('')+'</div>';
}

function confirmationMarkup(assessment){
  if(assessment?.already_closed)return '<div class="notice">This account is already closed.</div>';
  if(Number(assessment?.blocker_count||0)>0){
    return '<div class="notice"><strong>Account deletion is blocked.</strong><p>Resolve every outstanding financial, operational, Support, security or legal item first.</p></div>'+blockerMarkup(assessment.blockers||[])+'<button type="button" class="danger" disabled>Delete account</button>';
  }
  const purge=Boolean(assessment?.purge_eligible),word=purge?'DELETE':'CLOSE',action=purge?'purge_empty_unverified':'close';
  const title='Delete account';
  return '<form id="memberLifecycleClosureForm" class="adminForm memberControlForm" data-action="'+action+'" data-confirmation="'+word+'">'
    +'<label>Reason<textarea name="reason" minlength="8" maxlength="1200" required placeholder="Why is this governed account action necessary?"></textarea></label>'
    +'<label>Type '+word+' to confirm<input name="confirmation" autocomplete="off" maxlength="20" required></label>'
    +'<label class="inlineChoice"><input type="checkbox" name="confirm" required><span>I confirm that the blocker check is clear. Required accounting, security, dispute and legal records will be retained when necessary.</span></label>'
    +'<button type="submit" class="danger">'+title+'</button>'
    +'<div data-member-lifecycle-result></div>'
    +'</form>';
}

function stepUpMarkup(step){
  if(step?.verified)return '<div class="notice">Recent identity confirmation is active for this Admin session.</div>';
  return '<form id="memberLifecycleStepUpForm" class="adminForm memberControlForm">'
    +'<label>Current password<input name="password" type="password" autocomplete="current-password" maxlength="160" required></label>'
    +'<button type="submit" class="secondary">Confirm identity</button>'
    +'<div data-member-lifecycle-stepup-result class="muted">This password is used only for the server-side identity check and is never stored by this screen.</div>'
    +'</form>';
}

async function decorateMemberLifecycle(){
  const memberId=currentMemberId();
  if(!memberId)return;
  const rail=document.querySelector('.memberDetailRail');
  if(!rail)return;
  const existing=document.getElementById('memberAccountLifecycleControl');
  if(existing?.dataset.memberId===String(memberId))return;
  existing?.remove();

  let assessment;
  try{
    assessment=await lifecycleApi('/api/admin/members/'+memberId+'/account-closure/preflight');
  }catch(error){
    if([401,403,404].includes(Number(error.status)))return;
    const section=document.createElement('section');
    section.id='memberAccountLifecycleControl';
    section.dataset.memberId=String(memberId);
    section.className='memberDangerZone memberReadOnlyControls';
    section.innerHTML='<span class="memberEyebrow">ACCOUNT LIFECYCLE</span><strong>Closure check unavailable</strong><p class="muted">'+esc(error.message)+'</p>';
    rail.appendChild(section);
    return;
  }
  if(currentMemberId()!==memberId)return;

  const step=await lifecycleApi('/api/auth/step-up/status').catch(()=>({verified:false}));
  const details=document.createElement('details');
  details.open=true;
  details.id='memberAccountLifecycleControl';
  details.dataset.memberId=String(memberId);
  details.className='memberDangerZone memberControlDisclosure';
  details.innerHTML='<summary><div><span class="memberEyebrow">ACCOUNT DELETION</span><strong>Delete account</strong><span>Visible Super Admin control for this member. Safety blockers are checked before execution.</span></div></summary>'
    +'<div class="memberControlBody"><p class="muted memberControlBoundary">Empty never-verified registrations with no retained history are permanently removed. Other eligible accounts are closed, personal access is removed and only records that must be retained for accounting, completed transactions, disputes, fraud/security or legal obligations remain with minimal identifiers.</p>'
    +'<div id="memberLifecycleStepUp">'+stepUpMarkup(step)+'</div>'
    +'<div id="memberLifecycleAssessment">'+confirmationMarkup(assessment)+'</div></div>';
  rail.appendChild(details);
  bindMemberLifecycle(details,memberId);
}

function bindMemberLifecycle(root,memberId){
  const stepForm=root.querySelector('#memberLifecycleStepUpForm');
  if(stepForm)stepForm.onsubmit=async event=>{
    event.preventDefault();
    const form=event.currentTarget,out=form.querySelector('[data-member-lifecycle-stepup-result]');
    const password=String(new FormData(form).get('password')||'');
    const input=form.querySelector('[name="password"]');if(input)input.value='';
    if(out)out.textContent='Confirming identity…';
    try{
      await lifecycleApi('/api/auth/step-up/password',{method:'POST',body:JSON.stringify({password})});
      const host=root.querySelector('#memberLifecycleStepUp');
      if(host)host.innerHTML='<div class="notice">Identity confirmed for sensitive Admin actions.</div>';
    }catch(error){
      if(out)out.textContent=error.message;
    }
  };

  const closeForm=root.querySelector('#memberLifecycleClosureForm');
  if(closeForm)closeForm.onsubmit=async event=>{
    event.preventDefault();
    const form=event.currentTarget,fd=new FormData(form),out=form.querySelector('[data-member-lifecycle-result]');
    const expected=String(form.dataset.confirmation||'CLOSE'),confirmation=String(fd.get('confirmation')||'').trim().toUpperCase();
    if(confirmation!==expected){
      if(out)out.innerHTML='<div class="error">Type '+esc(expected)+' exactly to continue.</div>';
      return;
    }
    const button=form.querySelector('button[type="submit"]');if(button)button.disabled=true;
    if(out)out.innerHTML='<div class="notice">Rechecking blockers and identity confirmation…</div>';
    try{
      const fresh=await lifecycleApi('/api/admin/members/'+memberId+'/account-closure/preflight');
      if(Number(fresh.blocker_count||0)>0){
        const area=root.querySelector('#memberLifecycleAssessment');
        if(area)area.innerHTML=confirmationMarkup(fresh);
        bindMemberLifecycle(root,memberId);
        return;
      }
      const result=await lifecycleApi('/api/admin/members/'+memberId+'/account-closure',{
        method:'POST',
        body:JSON.stringify({
          action:String(form.dataset.action||'close'),
          reason:String(fd.get('reason')||'').trim(),
          confirmation,
          confirm:fd.get('confirm')==='on'
        })
      });
      if(out)out.innerHTML='<div class="notice">'+(result.purged?'Empty unverified registration deleted and audited.':'Account closed safely and audited.')+'</div>';
      setTimeout(()=>location.reload(),600);
    }catch(error){
      if(error.status===428||error.code==='STEP_UP_REQUIRED'){
        if(out)out.innerHTML='<div class="error">Confirm your identity above, then submit this action again.</div>';
      }else if(error.assessment){
        const area=root.querySelector('#memberLifecycleAssessment');
        if(area)area.innerHTML=confirmationMarkup(error.assessment);
        bindMemberLifecycle(root,memberId);
      }else if(out)out.innerHTML='<div class="error">'+esc(error.message)+'</div>';
      if(button)button.disabled=false;
    }
  };
}

let lifecycleDecorateTimer=null;
const observer=new MutationObserver(()=>{
  clearTimeout(lifecycleDecorateTimer);
  lifecycleDecorateTimer=setTimeout(()=>decorateMemberLifecycle().catch(()=>{}),60);
});
observer.observe(document.documentElement,{subtree:true,childList:true});
document.addEventListener('DOMContentLoaded',()=>decorateMemberLifecycle().catch(()=>{}));
