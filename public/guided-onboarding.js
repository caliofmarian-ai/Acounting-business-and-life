const TOKEN_KEY='abl_token';
const JOURNEY='first_account_first_profile_v1';
const STEP_ORDER=['welcome','complete_account','area_status','account_settings','manage_profiles','choose_profile','profile_onboarding'];
const STEP_LABELS={
  welcome:'Welcome',
  complete_account:'Complete your account',
  area_status:'Understand your area',
  account_settings:'Open Account Settings',
  manage_profiles:'Manage profiles',
  choose_profile:'Choose your first profile',
  profile_onboarding:'Follow profile onboarding'
};
const ROLE_LABELS={customer:'Customer',merchant:'Merchant',supplier:'Supplier',courier:'Delivery',service_provider:'Local Services'};
let guide=null,overlay=null,launcher=null,refreshTimer=null,renderTimer=null,lastAutoStep='',missionCenterOpen=false;
const profileDraftSavedForRole=new Set();
const token=()=>localStorage.getItem(TOKEN_KEY)||'';
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

async function api(path,options={}){
  const headers={'Content-Type':'application/json',...(options.headers||{})};
  if(token())headers.Authorization='Bearer '+token();
  const response=await fetch(path,{...options,headers});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body.error||'Onboarding request failed');
  return body;
}
function shellState(){return window.BusinessLifeProfileState||{}}
function completedSet(){return new Set(guide?.completed_steps||[])}
function completedCount(){return STEP_ORDER.filter(step=>completedSet().has(step)).length}
function progressPct(){return Math.round((completedCount()/STEP_ORDER.length)*100)}
function roleLabel(){return ROLE_LABELS[guide?.selected_profile_role]||'your selected profile'}
function guideActive(){return Boolean(guide?.eligible&&guide.status!=='completed')}
function visible(el){return Boolean(el&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden')}
function firstVisible(...selectors){
  for(const selector of selectors){
    const el=document.querySelector(selector);
    if(visible(el))return el;
  }
  return null;
}
function scheduleRender(delay=80){clearTimeout(renderTimer);renderTimer=setTimeout(()=>renderGuide().catch(()=>{}),delay)}
function scheduleRefresh(delay=250){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>refreshGuide().catch(()=>{}),delay)}

async function refreshGuide({render=true}={}){
  if(!token())return null;
  guide=await api('/api/onboarding/guide');
  syncLauncher();
  decorateAccountSettings();
  if(render)scheduleRender(20);
  return guide;
}
async function updateGuide(input,{render=true}={}){
  guide=await api('/api/onboarding/guide',{method:'PUT',body:JSON.stringify(input)});
  syncLauncher();
  decorateAccountSettings();
  if(render)scheduleRender(20);
  return guide;
}
function removeOverlay(){
  overlay?.remove();overlay=null;
  document.documentElement.classList.remove('guidedOnboardingOpen');
  document.querySelectorAll('[data-guided-elevated]').forEach(el=>{delete el.dataset.guidedElevated});
}
function ensureLauncher(){
  if(launcher&&document.body.contains(launcher))return launcher;
  launcher=document.getElementById('guidedOnboardingLauncher');
  if(!launcher){
    launcher=document.createElement('button');
    launcher.id='guidedOnboardingLauncher';
    launcher.className='guidedOnboardingLauncher hidden';
    launcher.type='button';
    launcher.innerHTML='<span aria-hidden="true">✓</span><strong>Getting started</strong><small></small>';
    launcher.addEventListener('click',()=>{missionCenterOpen=true;renderMissionCenter()});
    document.body.appendChild(launcher);
  }
  return launcher;
}
function syncLauncher(){
  const button=ensureLauncher();
  if(!guide?.eligible||guide.status==='completed'){button.classList.add('hidden');return}
  button.classList.remove('hidden');
  button.querySelector('small').textContent=completedCount()+'/'+STEP_ORDER.length;
  button.classList.toggle('paused',guide.status==='paused');
}
function overlayShell(){
  removeOverlay();
  const root=document.createElement('div');
  root.id='guidedOnboardingOverlay';
  root.className='guidedOnboardingOverlay';
  root.innerHTML='<div class="guidedSpotlight"></div><section class="guidedCoach" role="dialog" aria-modal="false" aria-live="polite"></section>';
  document.body.appendChild(root);overlay=root;document.documentElement.classList.add('guidedOnboardingOpen');
  return root;
}
function positionSpotlight(target){
  const spot=overlay?.querySelector('.guidedSpotlight');
  if(!spot)return;
  if(!target){
    spot.classList.add('hidden');return;
  }
  target.scrollIntoView({block:'center',inline:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  requestAnimationFrame(()=>{
    const rect=target.getBoundingClientRect(),pad=7;
    spot.classList.remove('hidden');
    spot.style.left=Math.max(6,rect.left-pad)+'px';
    spot.style.top=Math.max(6,rect.top-pad)+'px';
    spot.style.width=Math.min(innerWidth-12,rect.width+pad*2)+'px';
    spot.style.height=Math.min(innerHeight-12,rect.height+pad*2)+'px';
    spot.style.borderRadius=Math.min(22,Math.max(12,parseFloat(getComputedStyle(target).borderRadius)||14))+'px';
    target.dataset.guidedElevated='true';
  });
}
function coachMarkup(step,title,body,{primary='Continue',secondary='Skip for now',back=false,waiting=false}={}){
  const index=Math.max(1,STEP_ORDER.indexOf(step)+1),pct=Math.round(index/STEP_ORDER.length*100);
  return '<div class="guidedCoachHead"><div><small>GETTING STARTED · '+index+' OF '+STEP_ORDER.length+'</small><h2>'+esc(title)+'</h2></div><span class="guidedProgressChip">'+pct+'%</span></div>'+
    '<p>'+esc(body)+'</p><div class="guidedProgress"><i style="width:'+pct+'%"></i></div>'+
    '<div class="guidedCoachActions">'+
      (back?'<button type="button" data-guide-back class="guidedSecondary">Back</button>':'')+
      '<button type="button" data-guide-pause class="guidedSecondary">'+esc(secondary)+'</button>'+
      (waiting?'':'<button type="button" data-guide-next class="guidedPrimary">'+esc(primary)+'</button>')+
    '</div>';
}
function bindCoachActions(step,actions={}){
  const coach=overlay?.querySelector('.guidedCoach');if(!coach)return;
  coach.querySelector('[data-guide-pause]')?.addEventListener('click',async()=>{removeOverlay();missionCenterOpen=false;await updateGuide({action:'pause'},{render:false});syncLauncher()});
  coach.querySelector('[data-guide-next]')?.addEventListener('click',async()=>{
    if(actions.next)return actions.next();
    await updateGuide({action:'complete_step',step_id:step});
  });
  coach.querySelector('[data-guide-back]')?.addEventListener('click',()=>{missionCenterOpen=true;renderMissionCenter()});
}
function renderCoach({step,title,body,target=null,primary,secondary,back=false,waiting=false,next}){
  const root=overlayShell(),coach=root.querySelector('.guidedCoach');
  coach.innerHTML=coachMarkup(step,title,body,{primary,secondary,back,waiting});
  bindCoachActions(step,{next});
  positionSpotlight(target);
  coach.focus?.({preventScroll:true});
}
function missingAccountTarget(){
  const facts=guide?.facts||{},state=shellState(),snapshot=state.snapshot||{};
  if(!facts.email_verified){
    return firstVisible('#sendVerify','[data-account-settings-view="security"]','#accountHomeSettings','#openFirstAccountSettings');
  }
  if(!facts.personal_details_ready){
    return firstVisible('#shellAddress','#accountIdentityForm','[data-account-settings-view="personal"]','#accountHomeSettings','#openFirstAccountSettings');
  }
  if(!facts.area_assigned){
    return firstVisible('#accountGeographyForm','[data-account-settings-view="personal"]','#accountHomeSettings','#openFirstAccountSettings');
  }
  return firstVisible('#accountHomeSettings','#openFirstAccountSettings');
}

function profileOnboardingSubstep(role){
  const modal=firstVisible('#govModal','.govModal');
  if(!modal)return null;
  if(['merchant','supplier'].includes(role)){
    const business=document.getElementById('appBusiness');
    if(visible(business)&&!String(business.value||'').trim())return{title:'Add your business name',body:'Enter the business or store name used for this profile, then continue through the real application.',target:business,waiting:true};
  }
  if(role==='service_provider'){
    const headline=document.getElementById('appHeadline');
    if(visible(headline)&&!String(headline.value||'').trim())return{title:'Add your professional headline',body:'Describe the service identity people should understand first, for example your trade or main skill.',target:headline,waiting:true};
    const about=document.getElementById('appAbout');
    if(visible(about)&&!String(about.value||'').trim())return{title:'Describe your experience',body:'Add the relevant experience customers and reviewers need to understand your Local Services profile.',target:about,waiting:true};
    const cats=[...document.querySelectorAll('[data-req-cat]')];
    if(cats.length&&!cats.some(x=>x.checked))return{title:'Choose the services you want to offer',body:'Select the service categories that actually match your work. Admin approval remains category-specific.',target:firstVisible('.govCategoryGrid','[data-req-cat]'),waiting:true};
  }
  if(role==='courier'){
    const vehicle=document.getElementById('courierVehicleType');
    if(visible(vehicle)&&!profileDraftSavedForRole.has(role))return{title:'Confirm your delivery vehicle',body:'Choose the vehicle you will use. The evidence guide changes to match that vehicle type.',target:vehicle,waiting:true};
  }
  const ack=document.getElementById('appAck');
  if(visible(ack)&&!ack.checked)return{title:'Review the responsibility declaration',body:'Read the declaration and confirm it only when you understand that platform approval does not replace licences, permits, insurance or other legal duties.',target:ack.closest('label')||ack,waiting:true};
  const save=document.querySelector('#govApplicationForm button[type="submit"]');
  if(visible(save)&&!profileDraftSavedForRole.has(role))return{title:'Save your application',body:'Save the information you entered before submitting it for review.',target:save,waiting:true};
  const submit=document.getElementById('submitGovApp');
  if(visible(submit))return{title:'Submit for review',body:'When the application is accurate, submit it. The tutorial will then wait for the real review or activation state.',target:submit,waiting:true};
  const status=firstVisible('.govStatusLine','.govCard');
  if(status)return{title:'Application in progress',body:'Your '+(ROLE_LABELS[role]||'profile')+' onboarding is now in its real workflow. The guide will complete this mission when the application reaches review/submitted status or the profile becomes active.',target:status,waiting:true};
  return{title:'Follow '+(ROLE_LABELS[role]||'profile')+' onboarding',body:'Continue through the real onboarding shown here.',target:modal,waiting:true};
}

function stepDefinition(step){
  const facts=guide?.facts||{},geo=facts.geography||{},state=shellState();
  if(step==='welcome'){
    return{
      title:'Welcome to Business & Life',
      body:'Your account is separate from every profile. This short guide will show you how to finish setup and start the first profile you actually need.',
      target:firstVisible('.accountHomeHero','#roleHub'),
      primary:'Start tutorial',
      next:()=>updateGuide({action:'complete_step',step_id:'welcome'})
    };
  }
  if(step==='complete_account'){
    const missing=!facts.email_verified?'verify your email':!facts.personal_details_ready?'complete your private account details':!facts.area_assigned?'choose your official barangay':'finish account setup';
    return{
      title:'Complete your account',
      body:'Next, '+missing+'. Business & Life keeps your private street address separate from your operating barangay.',
      target:missingAccountTarget(),
      primary:'Show me',
      next:async()=>{
        if(!facts.email_verified){
          window.BusinessLifeShell?.openAccountSettings?.('security');scheduleRender(300);return;
        }
        window.BusinessLifeShell?.openAccountSettings?.('personal');scheduleRender(300);
      }
    };
  }
  if(step==='area_status'){
    const message=geo.message||'Your official barangay determines which Business & Life territory can onboard you.';
    const target=firstVisible('.accountGeographyNotice','.accountGeographyCurrent','#accountHomeSettings','#openFirstAccountSettings');
    return{
      title:'Understand your area',
      body:message,
      target,
      primary:'Got it',
      next:async()=>updateGuide({action:'complete_step',step_id:'area_status'})
    };
  }
  if(step==='account_settings'){
    const target=firstVisible('#accountHomeSettings','#openFirstAccountSettings','.accountSettingsHeader');
    return{
      title:'Account Settings',
      body:'Account Settings holds your identity, security, area, notifications and profile management. Profile-specific settings stay inside each profile.',
      target,
      primary:visible(document.querySelector('.accountSettingsHeader'))?'Continue':'Open settings',
      next:async()=>{
        if(visible(document.querySelector('.accountSettingsHeader'))){await updateGuide({action:'complete_step',step_id:'account_settings'});return}
        window.BusinessLifeShell?.openAccountSettings?.('home');scheduleRender(250);
      }
    };
  }
  if(step==='manage_profiles'){
    const target=firstVisible('[data-account-settings-view="profiles"]','.profileRoleList','#accountHomeSettings');
    return{
      title:'Open Manage profiles',
      body:'This is where you start, continue, deactivate or reactivate the profiles that belong to your Personal ID.',
      target,
      primary:visible(document.querySelector('.profileRoleList'))?'Continue':'Open profiles',
      next:async()=>{
        if(visible(document.querySelector('.profileRoleList'))){await updateGuide({action:'complete_step',step_id:'manage_profiles'});return}
        window.BusinessLifeShell?.openAccountSettings?.('profiles');scheduleRender(350);
      }
    };
  }
  if(step==='choose_profile'){
    const areaReady=Boolean(geo.operational_onboarding_available||facts.company_test);
    const body=areaReady
      ?'Choose the profile that matches what you want to do. Business & Life does not choose a role for you; the next steps adapt to your selection.'
      :(geo.message||'Your barangay is not open for onboarding yet. You can review profiles now and resume when the area becomes available.');
    return{
      title:'Choose your first profile',
      body,
      target:firstVisible('.profileRoleList','.profileActivationGate','[data-account-settings-view="profiles"]'),
      secondary:'Pause tutorial',
      waiting:true
    };
  }
  const selected=roleLabel(),role=guide?.selected_profile_role||facts.started_profile_role||'',areaReady=Boolean(geo.operational_onboarding_available||facts.company_test);
  if(!areaReady)return{
    title:'Your area is not open yet',
    body:geo.message||'Your barangay is not open for operational onboarding yet. The guide will resume from here when availability changes.',
    target:firstVisible('.accountGeographyNotice','.profileActivationGate','.profileRoleList'),
    secondary:'Pause tutorial',
    waiting:true
  };
  const sub=profileOnboardingSubstep(role);
  if(sub)return{...sub,secondary:'Pause tutorial'};
  let body='Follow the real '+selected+' onboarding shown on screen. The tutorial finishes when the profile reaches a meaningful submitted, review or active state.';
  if(role&&['merchant','supplier','courier'].includes(role)&&!facts.started_profile_role){
    body=selected+' is governed during the controlled launch. If an invitation is required, the guide will remain here until one is available.';
  }
  return{
    title:'Follow '+selected+' onboarding',
    body,
    target:firstVisible('.profileRoleList','.profileActivationGate'),
    secondary:'Pause tutorial',
    waiting:true
  };
}
async function renderGuide(){
  if(missionCenterOpen)return renderMissionCenter();
  if(!guide?.eligible||guide.status==='completed'||guide.status==='paused'){removeOverlay();return}
  const step=guide.current_step_id||STEP_ORDER.find(x=>!completedSet().has(x));
  if(!step){removeOverlay();return}
  const def=stepDefinition(step);
  renderCoach({step,...def});
}
function missionRow(step,index){
  const done=completedSet().has(step),current=guide?.current_step_id===step;
  const waiting=step==='profile_onboarding'&&!done&&guide?.selected_profile_role;
  return '<button type="button" class="guidedMissionRow '+(done?'done ':current?'current ':'')+'" data-guide-mission="'+esc(step)+'">'+
    '<span class="guidedMissionIcon">'+(done?'✓':index+1)+'</span>'+
    '<span><strong>'+esc(STEP_LABELS[step])+'</strong><small>'+(done?'Done':waiting?'In progress':current?'Next mission':'Upcoming')+'</small></span>'+
    '<b>'+((done||current)?'›':'')+'</b></button>';
}
function renderMissionCenter(){
  missionCenterOpen=true;
  const root=overlayShell(),coach=root.querySelector('.guidedCoach');
  coach.classList.add('guidedMissionCenter');
  coach.innerHTML='<div class="guidedMissionCenterHead"><small>GETTING STARTED</small><h2>Your first Business & Life journey</h2><p>Complete what you need now. You can pause and resume later.</p><div class="guidedProgress"><i style="width:'+progressPct()+'%"></i></div></div>'+
    '<div class="guidedMissionList">'+STEP_ORDER.map(missionRow).join('')+'</div>'+
    '<div class="guidedCoachActions"><button type="button" data-guide-close class="guidedSecondary">Close</button>'+
    (guide?.status==='paused'?'<button type="button" data-guide-resume class="guidedPrimary">Resume tutorial</button>':'<button type="button" data-guide-pause class="guidedSecondary">Pause tutorial</button>')+'</div>';
  root.querySelector('.guidedSpotlight')?.classList.add('hidden');
  coach.querySelector('[data-guide-close]')?.addEventListener('click',()=>{missionCenterOpen=false;removeOverlay()});
  coach.querySelector('[data-guide-pause]')?.addEventListener('click',async()=>{missionCenterOpen=false;removeOverlay();await updateGuide({action:'pause'},{render:false})});
  coach.querySelector('[data-guide-resume]')?.addEventListener('click',async()=>{missionCenterOpen=false;await updateGuide({action:'resume'})});
  coach.querySelectorAll('[data-guide-mission]').forEach(button=>button.onclick=async()=>{
    const step=button.dataset.guideMission;
    if(step!==guide.current_step_id&&!completedSet().has(step))return;
    missionCenterOpen=false;
    if(completedSet().has(step)){removeOverlay();return}
    if(guide.status==='paused')await updateGuide({action:'resume'},{render:false});
    guide.current_step_id=step;renderGuide();
  });
}
function decorateAccountSettings(){
  const workspace=document.getElementById('accountSettingsWorkspace');
  if(!workspace||workspace.classList.contains('hidden')||!guide?.eligible)return;
  const home=workspace.querySelector('.accountSettingsGrid');
  if(!home)return;
  let card=workspace.querySelector('#guidedOnboardingSettingsCard');
  if(!card){
    card=document.createElement('section');card.id='guidedOnboardingSettingsCard';card.className='accountSettingsCard guidedOnboardingSettingsCard';
    home.insertAdjacentElement('afterend',card);
  }
  const done=guide.status==='completed',paused=guide.status==='paused';
  card.innerHTML='<div><span aria-hidden="true">🧭</span><div><strong>Getting started tutorial</strong><p>'+(done?'Completed. Restart it whenever you want a refresher.':paused?'Paused at '+esc(STEP_LABELS[guide.current_step_id]||'your next mission')+'.':'Progress '+completedCount()+'/'+STEP_ORDER.length+'.')+'</p></div></div>'+
    '<button type="button" data-guide-settings-action="'+(done?'reset':paused?'resume':'open')+'">'+(done?'Restart tutorial':paused?'Resume tutorial':'Open missions')+'</button>';
  card.querySelector('[data-guide-settings-action]').onclick=async()=>{
    const action=card.querySelector('[data-guide-settings-action]').dataset.guideSettingsAction;
    if(action==='reset'){await updateGuide({action:'reset'},{render:false});missionCenterOpen=true;renderMissionCenter();return}
    if(action==='resume'){await updateGuide({action:'resume'},{render:false});missionCenterOpen=true;renderMissionCenter();return}
    missionCenterOpen=true;renderMissionCenter();
  };
}
async function handleProfileChoice(target){
  const role=target?.dataset?.roleAction||target?.dataset?.profileReactivate||'';
  if(!ROLE_LABELS[role]||!guideActive())return;
  await updateGuide({action:'select_profile',selected_profile_role:role},{render:false}).catch(()=>{});
  scheduleRefresh(450);
}
function bindLifecycle(){
  document.addEventListener('abl:profile-state',()=>scheduleRefresh(120));
  document.addEventListener('abl:account-settings-rendered',event=>{
    const view=event.detail?.view;
    if(view==='home')decorateAccountSettings();
    if(guideActive()&&view==='home'&&guide.current_step_id==='account_settings')updateGuide({action:'complete_step',step_id:'account_settings'},{render:false}).then(()=>scheduleRefresh(80)).catch(()=>{});
    if(guideActive()&&view==='profiles'&&guide.current_step_id==='manage_profiles')updateGuide({action:'complete_step',step_id:'manage_profiles'},{render:false}).then(()=>scheduleRefresh(80)).catch(()=>{});
    scheduleRender(100);
  });
  document.addEventListener('abl:guided-onboarding-refresh',()=>scheduleRefresh(220));
  document.addEventListener('submit',event=>{
    if(event.target?.id==='govApplicationForm'&&guide?.selected_profile_role){
      profileDraftSavedForRole.add(guide.selected_profile_role);
      setTimeout(()=>scheduleRender(80),350);
    }
  },true);
  document.addEventListener('click',event=>{
    const roleTarget=event.target.closest?.('[data-role-action]');
    if(roleTarget)handleProfileChoice(roleTarget);
    if(event.target.closest?.('#notificationBell,#lazySupportBtn'))scheduleRender(100);
  },true);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&token())scheduleRefresh(150)});
  window.addEventListener('resize',()=>scheduleRender(80),{passive:true});
  window.addEventListener('scroll',()=>{if(overlay&&!missionCenterOpen)scheduleRender(40)},{passive:true});
}
async function boot(){
  ensureLauncher();bindLifecycle();
  if(!token())return;
  try{
    await refreshGuide({render:false});
    if(!guide?.eligible)return;
    if(guide.status==='active'&&guide.auto_start_enabled)setTimeout(()=>renderGuide(),650);
  }catch(error){console.warn('Guided onboarding unavailable:',error.message)}
}
window.BusinessLifeGuidedOnboarding=Object.freeze({
  open:async()=>{if(!guide)await refreshGuide({render:false});missionCenterOpen=true;renderMissionCenter()},
  resume:async()=>{await updateGuide({action:'resume'},{render:false});missionCenterOpen=false;renderGuide()},
  reset:async()=>{await updateGuide({action:'reset'},{render:false});missionCenterOpen=true;renderMissionCenter()},
  refresh:()=>refreshGuide()
});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
