const JOURNEY='first_account_first_profile_v1';
const STEP_ORDER=['language','welcome','complete_account','area_status','account_settings','manage_profiles','choose_profile','profile_onboarding'];
const STEP_LABEL_KEYS={
  language:'step.language',
  welcome:'step.welcome',
  complete_account:'step.complete_account',
  area_status:'step.area_status',
  account_settings:'step.account_settings',
  manage_profiles:'step.manage_profiles',
  choose_profile:'step.choose_profile',
  profile_onboarding:'step.profile_onboarding'
};
const ROLE_LABEL_KEYS={customer:'role.customer',merchant:'role.merchant',supplier:'role.supplier',courier:'role.courier',service_provider:'role.service_provider'};
const ROLE_FALLBACK={customer:'Customer',merchant:'Merchant',supplier:'Supplier',courier:'Delivery',service_provider:'Local Services'};
const SUPPORTED_LOCALES=new Set(['en-PH','fil-PH']);
const COACH_TARGET_GAP=14,COACH_EDGE_GAP=12,COMPACT_BREAKPOINT=420;
let guide=null,overlay=null,launcher=null,refreshTimer=null,renderTimer=null,lastAutoStep='',missionCenterOpen=false,currentSpotlightTarget=null,placementFrame=0,placementRun=0,copy={},copyLocale='en-PH';
const copyCache=new Map();
const profileDraftSavedForRole=new Set();
const token=()=>window.ABLSession?.authenticated()?'cookie-session':'';
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const normalizeLocale=value=>SUPPORTED_LOCALES.has(String(value||''))?String(value):'en-PH';
const activeLocale=()=>normalizeLocale(guide?.preferred_locale||guide?.facts?.preferred_locale||copyLocale);
const formatCopy=(value,vars={})=>Object.entries(vars).reduce((out,[key,val])=>out.replaceAll('{'+key+'}',String(val??'')),String(value??''));
const tr=(key,vars={},fallback='')=>formatCopy(copy[key]??(fallback||key),vars);
const stepLabel=step=>tr(STEP_LABEL_KEYS[step],{},step);
const roleLabelFor=role=>tr(ROLE_LABEL_KEYS[role],{},ROLE_FALLBACK[role]||'profile');
const suggestedLocale=()=>{
  const langs=[...(navigator.languages||[]),navigator.language||''].map(x=>String(x).toLowerCase());
  return langs.some(x=>x.startsWith('fil')||x.startsWith('tl'))?'fil-PH':'en-PH';
};
async function loadCopy(locale=activeLocale()){
  const normalized=normalizeLocale(locale);
  if(copyCache.has(normalized)){copy=copyCache.get(normalized);copyLocale=normalized;document.documentElement.lang=normalized;return copy}
  try{
    const response=await fetch('/locales/guided-onboarding.'+normalized+'.json',{cache:'no-store'});
    if(!response.ok)throw new Error('Locale pack unavailable');
    const pack=await response.json();
    copyCache.set(normalized,pack);copy=pack;copyLocale=normalized;document.documentElement.lang=normalized;return pack;
  }catch(error){
    if(normalized!=='en-PH')return loadCopy('en-PH');
    copy={};copyLocale='en-PH';document.documentElement.lang='en-PH';return copy;
  }
}


async function api(path,options={}){
  const headers={'Content-Type':'application/json',...(options.headers||{})};

  const response=await fetch(path,{...options,headers});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body.error||'Onboarding request failed');
  return body;
}
function shellState(){return window.BusinessLifeProfileState||{}}
function completedSet(){return new Set(guide?.completed_steps||[])}
function completedCount(){return STEP_ORDER.filter(step=>completedSet().has(step)).length}
function progressPct(){return Math.round((completedCount()/STEP_ORDER.length)*100)}
function roleLabel(){return roleLabelFor(guide?.selected_profile_role)}
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
  await loadCopy(guide.preferred_locale);
  syncLauncher();
  decorateAccountSettings();
  if(render)scheduleRender(20);
  return guide;
}
async function updateGuide(input,{render=true}={}){
  guide=await api('/api/onboarding/guide',{method:'PUT',body:JSON.stringify(input)});
  await loadCopy(guide.preferred_locale);
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
    launcher.innerHTML='<span aria-hidden="true">✓</span><strong></strong><small></small>';
    launcher.addEventListener('click',()=>{missionCenterOpen=true;renderMissionCenter()});
    document.body.appendChild(launcher);
  }
  return launcher;
}
function syncLauncher(){
  const button=ensureLauncher();
  if(!guide?.eligible||guide.status==='completed'){button.classList.add('hidden');return}
  button.classList.remove('hidden');
  button.querySelector('strong').textContent=tr('launcher.title',{},'Getting started');
  button.querySelector('small').textContent=completedCount()+'/'+STEP_ORDER.length;
  button.classList.toggle('paused',guide.status==='paused');
}
function overlayShell(){
  removeOverlay();
  const root=document.createElement('div');
  root.id='guidedOnboardingOverlay';
  root.className='guidedOnboardingOverlay';
  root.innerHTML='<div class="guidedSafeAreaProbe" aria-hidden="true"></div><div class="guidedSpotlight"></div><section class="guidedCoach" role="dialog" aria-modal="false" aria-live="polite" tabindex="-1"></section>';
  document.body.appendChild(root);overlay=root;document.documentElement.classList.add('guidedOnboardingOpen');
  return root;
}
const nextAnimationFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
function reducedMotion(){return matchMedia('(prefers-reduced-motion: reduce)').matches}
function viewportMetrics(){
  const vv=window.visualViewport,width=Math.max(1,Number(vv?.width||document.documentElement.clientWidth||innerWidth)),height=Math.max(1,Number(vv?.height||document.documentElement.clientHeight||innerHeight));
  const left=Number(vv?.offsetLeft||0),top=Number(vv?.offsetTop||0),probe=overlay?.querySelector('.guidedSafeAreaProbe'),probeStyle=probe?getComputedStyle(probe):null;
  const safeTop=parseFloat(probeStyle?.paddingTop||'0')||0,safeBottom=parseFloat(probeStyle?.paddingBottom||'0')||0;
  return{left,top,width,height,right:left+width,bottom:top+height,safeTop,safeBottom,keyboardOpen:Boolean(vv&&innerHeight-height>120)};
}
function targetSufficientlyVisible(rect,metrics){
  if(!rect||rect.width<=0||rect.height<=0)return false;
  const left=Math.max(rect.left,metrics.left+COACH_EDGE_GAP),right=Math.min(rect.right,metrics.right-COACH_EDGE_GAP),top=Math.max(rect.top,metrics.top+metrics.safeTop+COACH_EDGE_GAP),bottom=Math.min(rect.bottom,metrics.bottom-metrics.safeBottom-COACH_EDGE_GAP);
  const visibleArea=Math.max(0,right-left)*Math.max(0,bottom-top),targetArea=Math.max(1,rect.width*rect.height);
  return visibleArea/targetArea>=.72;
}
function targetNeedsReadingRoom(target){
  if(!target)return false;
  if(target.matches?.('input,textarea,select,[contenteditable="true"]'))return true;
  const control=target.querySelector?.('input,textarea,select,[contenteditable="true"]');
  return Boolean(control&&target.matches?.('label'));
}
function guidanceContextTarget(target){
  if(!target)return target;
  if(target.matches?.('input,textarea,select,[contenteditable="true"]')){
    const labelled=target.closest?.('label');
    if(labelled&&visible(labelled))return labelled;
  }
  return target;
}
function maxCoachRoom(rect,metrics){
  const safeTop=metrics.top+metrics.safeTop+COACH_EDGE_GAP,safeBottom=metrics.bottom-metrics.safeBottom-COACH_EDGE_GAP;
  return Math.max(0,rect.top-COACH_TARGET_GAP-safeTop, safeBottom-rect.bottom-COACH_TARGET_GAP);
}
function rectsOverlapWithGap(a,b,gap=COACH_TARGET_GAP){
  return !(a.right<=b.left-gap||a.left>=b.right+gap||a.bottom<=b.top-gap||a.top>=b.bottom+gap);
}
function placeSpotlight(target,metrics){
  const spot=overlay?.querySelector('.guidedSpotlight');if(!spot)return;
  if(!target){spot.classList.add('hidden');return}
  const rect=target.getBoundingClientRect(),pad=7,left=Math.max(metrics.left+6,rect.left-pad),top=Math.max(metrics.top+metrics.safeTop+6,rect.top-pad),right=Math.min(metrics.right-6,rect.right+pad),bottom=Math.min(metrics.bottom-metrics.safeBottom-6,rect.bottom+pad);
  spot.classList.remove('hidden');spot.style.left=left+'px';spot.style.top=top+'px';spot.style.width=Math.max(0,right-left)+'px';spot.style.height=Math.max(0,bottom-top)+'px';spot.style.borderRadius=Math.min(22,Math.max(12,parseFloat(getComputedStyle(target).borderRadius)||14))+'px';
  target.dataset.guidedElevated='true';
}
function syncCompactMore(coach){
  const more=coach.querySelector('[data-guide-more]');if(!more)return;
  more.hidden=!(coach.classList.contains('compact')&&coach.dataset.bodyLong==='true');
}
function placeCoach(target,metrics){
  const coach=overlay?.querySelector('.guidedCoach');if(!coach||!target)return;
  const targetRect=target.getBoundingClientRect(),safeTop=metrics.top+metrics.safeTop+COACH_EDGE_GAP,safeBottom=metrics.bottom-metrics.safeBottom-COACH_EDGE_GAP;
  const narrow=metrics.width<COMPACT_BREAKPOINT||metrics.keyboardOpen,readingRoom=targetNeedsReadingRoom(target);
  coach.classList.toggle('compact',narrow);coach.classList.remove('guidedCoachScroll');coach.style.maxHeight='';coach.style.right='auto';coach.style.bottom='auto';
  const width=Math.max(220,Math.min(metrics.width-COACH_EDGE_GAP*2,metrics.width>=820?390:520));coach.style.width=width+'px';
  let rect=coach.getBoundingClientRect();
  const roomAbove=()=>Math.max(0,targetRect.top-COACH_TARGET_GAP-safeTop),roomBelow=()=>Math.max(0,safeBottom-targetRect.bottom-COACH_TARGET_GAP);
  const preferred=readingRoom?'bottom':targetRect.top+targetRect.height/2>metrics.top+metrics.height/2?'top':'bottom';
  let order=preferred==='top'?['top','bottom']:['bottom','top'];
  const fits=side=>(side==='top'?roomAbove():roomBelow())>=rect.height;
  let placement=order.find(fits)||'';
  if(!placement&&!coach.classList.contains('compact')){
    coach.classList.add('compact');rect=coach.getBoundingClientRect();placement=order.find(fits)||'';
  }
  if(!placement){
    placement=roomBelow()>=roomAbove()?'bottom':'top';
    coach.classList.add('compact','guidedCoachScroll');
    coach.style.maxHeight=Math.max(1,placement==='bottom'?roomBelow():roomAbove())+'px';
    rect=coach.getBoundingClientRect();
  }
  syncCompactMore(coach);
  rect=coach.getBoundingClientRect();
  const minLeft=metrics.left+COACH_EDGE_GAP,maxLeft=Math.max(minLeft,metrics.right-COACH_EDGE_GAP-rect.width),centered=targetRect.left+targetRect.width/2-rect.width/2;
  let left=Math.max(minLeft,Math.min(maxLeft,centered));
  let top=placement==='bottom'?targetRect.bottom+COACH_TARGET_GAP:targetRect.top-COACH_TARGET_GAP-rect.height;
  if(placement==='bottom')top=Math.min(top,safeBottom-rect.height);else top=Math.max(top,safeTop);
  coach.style.left=left+'px';coach.style.top=top+'px';coach.dataset.placement=placement;
  let finalRect=coach.getBoundingClientRect();
  if(rectsOverlapWithGap(finalRect,targetRect)){
    const alternative=placement==='bottom'?'top':'bottom',room=alternative==='top'?roomAbove():roomBelow();
    if(room>0){
      coach.classList.add('compact','guidedCoachScroll');coach.style.maxHeight=Math.max(1,room)+'px';rect=coach.getBoundingClientRect();
      top=alternative==='bottom'?targetRect.bottom+COACH_TARGET_GAP:targetRect.top-COACH_TARGET_GAP-rect.height;
      coach.style.top=top+'px';coach.dataset.placement=alternative;placement=alternative;finalRect=coach.getBoundingClientRect();
    }
  }
  coach.dataset.noOverlap=String(!rectsOverlapWithGap(finalRect,targetRect));
}
function repositionGuidanceNow(){
  if(!overlay||missionCenterOpen||!currentSpotlightTarget)return;
  const metrics=viewportMetrics();placeSpotlight(currentSpotlightTarget,metrics);placeCoach(currentSpotlightTarget,metrics);
}
function scheduleCoachReposition(){
  if(placementFrame)return;placementFrame=requestAnimationFrame(()=>{placementFrame=0;repositionGuidanceNow()});
}
async function positionGuidance(target,{scroll=true}={}){
  const spot=overlay?.querySelector('.guidedSpotlight');currentSpotlightTarget=target||null;
  if(!target){spot?.classList.add('hidden');return}
  const run=++placementRun,metrics=viewportMetrics(),rect=target.getBoundingClientRect(),readingRoom=targetNeedsReadingRoom(target);
  if(scroll&&(readingRoom||!targetSufficientlyVisible(rect,metrics)||maxCoachRoom(rect,metrics)<150)){
    target.scrollIntoView({block:'center',inline:'nearest',behavior:reducedMotion()?'auto':'smooth'});
    await nextAnimationFrame();await nextAnimationFrame();if(run!==placementRun||!overlay)return;
  }
  repositionGuidanceNow();
}
function coachMarkup(step,title,body,{primary=tr('action.continue',{},'Continue'),secondary=tr('action.skip',{},'Skip for now'),back=false,waiting=false}={}){
  const index=Math.max(1,STEP_ORDER.indexOf(step)+1),pct=Math.round(index/STEP_ORDER.length*100);
  return '<div class="guidedCoachHead"><div><small>'+esc(tr('common.getting_started',{},'GETTING STARTED'))+' · '+index+' / '+STEP_ORDER.length+'</small><h2>'+esc(title)+'</h2></div><span class="guidedProgressChip">'+pct+'%</span></div>'+
    '<p class="guidedCoachBody">'+esc(body)+'</p><button type="button" data-guide-more class="guidedMore" hidden>'+esc(tr('action.more',{},'More'))+'</button><div class="guidedProgress"><i style="width:'+pct+'%"></i></div>'+
    '<div class="guidedCoachActions">'+
      (back?'<button type="button" data-guide-back class="guidedSecondary">'+esc(tr('action.back',{},'Back'))+'</button>':'')+
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
  coach.innerHTML=coachMarkup(step,title,body,{primary,secondary,back,waiting});coach.dataset.bodyLong=String(String(body||'').length>118);
  bindCoachActions(step,{next});
  coach.querySelector('[data-guide-more]')?.addEventListener('click',event=>{coach.classList.toggle('expanded');event.currentTarget.textContent=coach.classList.contains('expanded')?tr('action.less',{},'Less'):tr('action.more',{},'More');scheduleCoachReposition()});
  positionGuidance(guidanceContextTarget(target),{scroll:true}).catch(()=>{});
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
    return firstVisible('#shellAddress','#accountAddressArea','#accountGeographyForm','[data-account-settings-view="personal"]','#accountHomeSettings','#openFirstAccountSettings');
  }
  return firstVisible('#accountHomeSettings','#openFirstAccountSettings');
}

function renderLanguageCoach(){
  const root=overlayShell(),coach=root.querySelector('.guidedCoach'),suggested=suggestedLocale(),current=activeLocale();
  root.querySelector('.guidedSpotlight')?.classList.add('hidden');
  coach.classList.add('guidedLanguageCoach');
  coach.innerHTML='<div class="guidedCoachHead"><div><small>GETTING STARTED · PAGSISIMULA · 1 / '+STEP_ORDER.length+'</small><h2>Choose your language / Piliin ang iyong wika</h2></div><span class="guidedProgressChip">'+Math.round(100/STEP_ORDER.length)+'%</span></div>'+
    '<p class="guidedCoachBody">Choose the language for this tutorial. / Piliin ang wikang gagamitin para sa gabay na ito.</p>'+
    '<div class="guidedLanguageChoices">'+
      '<button type="button" data-guide-locale="en-PH" class="'+(current==='en-PH'?'selected ':'')+'"><span><strong>English</strong><small>English (Philippines)</small></span>'+(suggested==='en-PH'?'<b>Suggested</b>':'')+'</button>'+
      '<button type="button" data-guide-locale="fil-PH" class="'+(current==='fil-PH'?'selected ':'')+'"><span><strong>Filipino / Tagalog</strong><small>Filipino / Tagalog para sa Pilipinas</small></span>'+(suggested==='fil-PH'?'<b>Iminumungkahi</b>':'')+'</button>'+
    '</div><small class="guidedLanguageBoundary">Language does not change your country, barangay, profile, currency or payment settings. / Hindi binabago ng wika ang iyong bansa, barangay, profile, currency o payment settings.</small>'+
    '<div class="guidedCoachActions"><button type="button" data-guide-pause class="guidedSecondary">Later / Mamaya</button></div>';
  coach.querySelector('[data-guide-pause]')?.addEventListener('click',async()=>{removeOverlay();missionCenterOpen=false;await updateGuide({action:'pause'},{render:false});syncLauncher()});
  coach.querySelectorAll('[data-guide-locale]').forEach(button=>button.onclick=async()=>{
    coach.querySelectorAll('button').forEach(x=>x.disabled=true);
    try{
      await updateGuide({action:'set_locale',locale:button.dataset.guideLocale},{render:false});
      missionCenterOpen=false;
      await loadCopy(button.dataset.guideLocale);
      renderGuide();
    }catch(error){
      coach.querySelectorAll('button').forEach(x=>x.disabled=false);
    }
  });
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
    if(visible(business)&&!String(business.value||'').trim())return{
      title:tr('profile.business_title',{},'Add your business name'),
      body:tr('profile.business_body',{},'Enter the business or store name used for this profile, then continue through the real application.'),
      target:business,waiting:true
    };
  }
  if(role==='service_provider'){
    const headline=document.getElementById('appHeadline');
    if(visible(headline)&&!String(headline.value||'').trim())return{
      title:tr('profile.headline_title',{},'Add your professional headline'),
      body:tr('profile.headline_body',{},'Describe the service identity people should understand first, for example your trade or main skill.'),
      target:headline,waiting:true
    };
    const about=document.getElementById('appAbout');
    if(visible(about)&&!String(about.value||'').trim())return{
      title:tr('profile.about_title',{},'Describe your experience'),
      body:tr('profile.about_body',{},'Add the relevant experience customers and reviewers need to understand your Local Services profile.'),
      target:about,waiting:true
    };
    const cats=[...document.querySelectorAll('[data-req-cat]')];
    if(cats.length&&!cats.some(x=>x.checked))return{
      title:tr('profile.categories_title',{},'Choose the services you want to offer'),
      body:tr('profile.categories_body',{},'Select the service categories that actually match your work. Admin approval remains category-specific.'),
      target:firstVisible('.govCategoryGrid','[data-req-cat]'),waiting:true
    };
  }
  if(role==='courier'){
    const vehicle=document.getElementById('courierVehicleType');
    if(visible(vehicle)&&!profileDraftSavedForRole.has(role))return{
      title:tr('profile.vehicle_title',{},'Confirm your delivery vehicle'),
      body:tr('profile.vehicle_body',{},'Choose the vehicle you will use. The evidence guide changes to match that vehicle type.'),
      target:vehicle,waiting:true
    };
  }
  const ack=document.getElementById('appAck');
  if(visible(ack)&&!ack.checked)return{
    title:tr('profile.ack_title',{},'Review the responsibility declaration'),
    body:tr('profile.ack_body',{},'Read the declaration and confirm it only when you understand that platform approval does not replace licences, permits, insurance or other legal duties.'),
    target:ack.closest('label')||ack,waiting:true
  };
  const save=document.querySelector('#govApplicationForm button[type="submit"]');
  if(visible(save)&&!profileDraftSavedForRole.has(role))return{
    title:tr('profile.save_title',{},'Save your application'),
    body:tr('profile.save_body',{},'Save the information you entered before submitting it for review.'),
    target:save,waiting:true
  };
  const submit=document.getElementById('submitGovApp');
  if(visible(submit))return{
    title:tr('profile.submit_title',{},'Submit for review'),
    body:tr('profile.submit_body',{},'When the application is accurate, submit it. The tutorial will then wait for the real review or activation state.'),
    target:submit,waiting:true
  };
  const status=firstVisible('.govStatusLine','.govCard'),roleName=roleLabelFor(role);
  if(status)return{
    title:tr('profile.progress_title',{},'Application in progress'),
    body:tr('profile.progress_body',{role:roleName},'Your {role} onboarding is now in its real workflow. The guide will complete this mission when the application reaches review/submitted status or the profile becomes active.'),
    target:status,waiting:true
  };
  return{
    title:tr('profile.follow_title',{role:roleName},'Follow {role} onboarding'),
    body:tr('profile.follow_body',{},'Continue through the real onboarding shown here.'),
    target:modal,waiting:true
  };
}
function stepDefinition(step){
  const facts=guide?.facts||{},geo=facts.geography||{};
  if(step==='welcome'){
    return{
      title:tr('welcome.title',{},'Welcome to Business & Life'),
      body:tr('welcome.body',{},'Your account is separate from every profile. This guide will show you how to finish setup and start the first profile you actually need.'),
      target:firstVisible('.accountHomeHero','#roleHub'),
      primary:tr('action.start',{},'Start tutorial'),
      next:()=>updateGuide({action:'complete_step',step_id:'welcome'})
    };
  }
  if(step==='complete_account'){
    const missing=!facts.email_verified
      ?tr('account.missing_email',{},'verify your email')
      :!facts.personal_details_ready
        ?tr('account.missing_details',{},'complete your private account details')
        :!facts.area_assigned
          ?tr('account.missing_area',{},'add your home address')
          :tr('account.missing_finish',{},'finish account setup');
    return{
      title:tr('step.complete_account',{},'Complete your account'),
      body:tr('account.complete_body',{action:missing},'Next, {action}. We will check whether Business & Life is available in your area.'),
      target:missingAccountTarget(),
      primary:tr('action.show_me',{},'Show me'),
      next:async()=>{
        if(!facts.email_verified){
          window.BusinessLifeShell?.openAccountSettings?.('security');scheduleRender(300);return;
        }
        window.BusinessLifeShell?.openAccountSettings?.('personal');scheduleRender(300);
      }
    };
  }
  if(step==='area_status'){
    const status=geo?.exact_territory?.status||'not_opened';
    const message=geo.operational_onboarding_available
      ?tr('area.available',{},'Business & Life is available in your area.')
      :status==='paused'
        ?tr('area.paused',{},'Onboarding is temporarily unavailable in your area. We will notify you when it reopens.')
        :['suspended','closed'].includes(status)
          ?tr('area.closed',{},'Business & Life is not currently available in your area. We will notify you if availability changes.')
          :tr('area.not_open',{},'Business & Life is not available in your area yet. We will notify you when onboarding opens.');
    const target=firstVisible('.accountGeographyNotice','.accountAddressArea','#accountHomeSettings','#openFirstAccountSettings');
    return{
      title:tr('area.title',{},'Availability in your area'),
      body:message,
      target,
      primary:tr('action.got_it',{},'Got it'),
      next:async()=>updateGuide({action:'complete_step',step_id:'area_status'})
    };
  }
  if(step==='account_settings'){
    const target=firstVisible('#accountHomeSettings','#openFirstAccountSettings','.accountSettingsHeader');
    return{
      title:tr('settings.title',{},'Account Settings'),
      body:tr('settings.body',{},'Account Settings holds your identity, security, area, notifications and profile management. Profile-specific settings stay inside each profile.'),
      target,
      primary:visible(document.querySelector('.accountSettingsHeader'))?tr('action.continue',{},'Continue'):tr('action.open_settings',{},'Open settings'),
      next:async()=>{
        if(visible(document.querySelector('.accountSettingsHeader'))){await updateGuide({action:'complete_step',step_id:'account_settings'});return}
        window.BusinessLifeShell?.openAccountSettings?.('home');scheduleRender(250);
      }
    };
  }
  if(step==='manage_profiles'){
    const target=firstVisible('[data-account-settings-view="profiles"]','.profileRoleList','#accountHomeSettings');
    return{
      title:tr('profiles.manage_title',{},'Open Manage profiles'),
      body:tr('profiles.manage_body',{},'This is where you start, continue, deactivate or reactivate the profiles that belong to your Personal ID.'),
      target,
      primary:visible(document.querySelector('.profileRoleList'))?tr('action.continue',{},'Continue'):tr('action.open_profiles',{},'Open profiles'),
      next:async()=>{
        if(visible(document.querySelector('.profileRoleList'))){await updateGuide({action:'complete_step',step_id:'manage_profiles'});return}
        window.BusinessLifeShell?.openAccountSettings?.('profiles');scheduleRender(350);
      }
    };
  }
  if(step==='choose_profile'){
    const areaReady=Boolean(geo.operational_onboarding_available||facts.company_test);
    const body=areaReady
      ?tr('profiles.choose_body',{},'Choose the profile that matches what you want to do. Business & Life does not choose a role for you; the next steps adapt to your selection.')
      :tr('profiles.area_closed',{},'Business & Life is not available in your area yet. You can review profiles now, and we will notify you when onboarding opens.');
    return{
      title:tr('profiles.choose_title',{},'Choose your first profile'),
      body,
      target:firstVisible('.profileRoleList','.profileActivationGate','[data-account-settings-view="profiles"]'),
      secondary:tr('action.pause',{},'Pause tutorial'),
      waiting:true
    };
  }
  const selected=roleLabel(),role=guide?.selected_profile_role||facts.started_profile_role||'',areaReady=Boolean(geo.operational_onboarding_available||facts.company_test);
  if(!areaReady)return{
    title:tr('profiles.area_closed_title',{},'Business & Life is not available in your area yet'),
    body:tr('profiles.area_closed_body',{},'We will notify you when onboarding opens. The guide will resume from here when availability changes.'),
    target:firstVisible('.accountGeographyNotice','.profileActivationGate','.profileRoleList'),
    secondary:tr('action.pause',{},'Pause tutorial'),
    waiting:true
  };
  const sub=profileOnboardingSubstep(role);
  if(sub)return{...sub,secondary:tr('action.pause',{},'Pause tutorial')};
  let body=tr('profile.general_body',{role:selected},'Follow the real {role} onboarding shown on screen. The tutorial finishes when the profile reaches a meaningful submitted, review or active state.');
  if(role&&['merchant','supplier','courier'].includes(role)&&!facts.started_profile_role){
    body=tr('profile.governed_body',{role:selected},'{role} is governed during the controlled launch. If an invitation is required, the guide will remain here until one is available.');
  }
  return{
    title:tr('profile.follow_title',{role:selected},'Follow {role} onboarding'),
    body,
    target:firstVisible('.profileRoleList','.profileActivationGate'),
    secondary:tr('action.pause',{},'Pause tutorial'),
    waiting:true
  };
}
async function renderGuide(){
  if(missionCenterOpen)return renderMissionCenter();
  if(!guide?.eligible||guide.status==='completed'||guide.status==='paused'){removeOverlay();return}
  const step=guide.current_step_id||STEP_ORDER.find(x=>!completedSet().has(x));
  if(!step){removeOverlay();return}
  if(step==='language')return renderLanguageCoach();
  const def=stepDefinition(step);
  renderCoach({step,...def});
}
function missionRow(step,index){
  const done=completedSet().has(step),current=guide?.current_step_id===step;
  const waiting=step==='profile_onboarding'&&!done&&guide?.selected_profile_role;
  return '<button type="button" class="guidedMissionRow '+(done?'done ':current?'current ':'')+'" data-guide-mission="'+esc(step)+'">'+
    '<span class="guidedMissionIcon">'+(done?'✓':index+1)+'</span>'+
    '<span><strong>'+esc(stepLabel(step))+'</strong><small>'+(done?tr('mission.done',{},'Done'):waiting?tr('mission.in_progress',{},'In progress'):current?tr('mission.next',{},'Next mission'):tr('mission.upcoming',{},'Upcoming'))+'</small></span>'+
    '<b>'+((done||current)?'›':'')+'</b></button>';
}
function renderMissionCenter(){
  missionCenterOpen=true;
  const root=overlayShell(),coach=root.querySelector('.guidedCoach');
  coach.classList.add('guidedMissionCenter');
  coach.innerHTML='<div class="guidedMissionCenterHead"><small>'+esc(tr('common.getting_started',{},'GETTING STARTED'))+'</small><h2>'+esc(tr('mission.title',{},'Your first Business & Life journey'))+'</h2><p>'+esc(tr('mission.body',{},'Complete what you need now. You can pause and resume later.'))+'</p><div class="guidedProgress"><i style="width:'+progressPct()+'%"></i></div></div>'+
    '<div class="guidedMissionList">'+STEP_ORDER.map(missionRow).join('')+'</div>'+
    '<div class="guidedCoachActions"><button type="button" data-guide-close class="guidedSecondary">'+esc(tr('action.close',{},'Close'))+'</button>'+
    (guide?.status==='paused'?'<button type="button" data-guide-resume class="guidedPrimary">'+esc(tr('action.resume',{},'Resume tutorial'))+'</button>':'<button type="button" data-guide-pause class="guidedSecondary">'+esc(tr('action.pause',{},'Pause tutorial'))+'</button>')+'</div>';
  root.querySelector('.guidedSpotlight')?.classList.add('hidden');
  coach.querySelector('[data-guide-close]')?.addEventListener('click',()=>{missionCenterOpen=false;removeOverlay()});
  coach.querySelector('[data-guide-pause]')?.addEventListener('click',async()=>{missionCenterOpen=false;removeOverlay();await updateGuide({action:'pause'},{render:false})});
  coach.querySelector('[data-guide-resume]')?.addEventListener('click',async()=>{missionCenterOpen=false;await updateGuide({action:'resume'})});
  coach.querySelectorAll('[data-guide-mission]').forEach(button=>button.onclick=async()=>{
    const step=button.dataset.guideMission;
    if(step!==guide.current_step_id&&!completedSet().has(step))return;
    missionCenterOpen=false;
    if(step==='language'){renderLanguageCoach();return}
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
  const detail=done
    ?tr('settings_tutorial.completed',{},'Completed. Restart it whenever you want a refresher.')
    :paused
      ?tr('settings_tutorial.paused',{step:stepLabel(guide.current_step_id)},'Paused at {step}.')
      :tr('settings_tutorial.progress',{done:completedCount(),total:STEP_ORDER.length},'Progress {done}/{total}.');
  const actionLabel=done
    ?tr('action.restart',{},'Restart tutorial')
    :paused
      ?tr('action.resume',{},'Resume tutorial')
      :tr('action.open_missions',{},'Open missions');
  card.innerHTML='<div><span aria-hidden="true">🧭</span><div><strong>'+esc(tr('settings_tutorial.title',{},'Getting started tutorial'))+'</strong><p>'+esc(detail)+'</p></div></div>'+
    '<button type="button" data-guide-settings-action="'+(done?'reset':paused?'resume':'open')+'">'+esc(actionLabel)+'</button>';
  card.querySelector('[data-guide-settings-action]').onclick=async()=>{
    const action=card.querySelector('[data-guide-settings-action]').dataset.guideSettingsAction;
    if(action==='reset'){await updateGuide({action:'reset'},{render:false});missionCenterOpen=true;renderMissionCenter();return}
    if(action==='resume'){await updateGuide({action:'resume'},{render:false});missionCenterOpen=true;renderMissionCenter();return}
    missionCenterOpen=true;renderMissionCenter();
  };
}
async function handleProfileChoice(target){
  const role=target?.dataset?.roleAction||target?.dataset?.profileReactivate||'';
  if(!ROLE_LABEL_KEYS[role]||!guideActive())return;
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
  document.addEventListener('abl:guided-onboarding-refresh',event=>{if(event.detail?.reason==='application_saved'&&event.detail?.role)profileDraftSavedForRole.add(event.detail.role);scheduleRefresh(220)});
  document.addEventListener('click',event=>{
    const roleTarget=event.target.closest?.('[data-role-action]');
    if(roleTarget)handleProfileChoice(roleTarget);
    if(event.target.closest?.('#notificationBell,#lazySupportBtn'))scheduleRender(100);
  },true);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&token())scheduleRefresh(150)});
  const reposition=()=>{if(overlay&&!missionCenterOpen&&currentSpotlightTarget)scheduleCoachReposition()};
  window.addEventListener('resize',reposition,{passive:true});window.addEventListener('scroll',reposition,{passive:true});
  window.visualViewport?.addEventListener('resize',reposition,{passive:true});window.visualViewport?.addEventListener('scroll',reposition,{passive:true});
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
