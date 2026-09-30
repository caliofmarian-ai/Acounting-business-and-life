const JOURNEY='first_account_first_profile_v1';
const STEP_ORDER=['language','welcome','complete_account','area_status','account_settings','manage_profiles','choose_profile'];
const PROFILE_STEP_ORDER=['profile_welcome','profile_settings'];
const STEP_LABEL_KEYS={
  language:'step.language',
  welcome:'step.welcome',
  complete_account:'step.complete_account',
  area_status:'step.area_status',
  account_settings:'step.account_settings',
  manage_profiles:'step.manage_profiles',
  choose_profile:'step.choose_profile'
};
const PROFILE_STEP_LABEL_KEYS={
  profile_welcome:'profile_tour.step_welcome',
  customer_address_privacy:'customer_tour.step_address_privacy',
  customer_price_payment:'customer_tour.step_price_payment',
  customer_order_commitment:'customer_tour.step_order_commitment',
  customer_tracking:'customer_tour.step_tracking',
  customer_support_safety:'customer_tour.step_support_safety',
  customer_money:'customer_tour.step_money',
  customer_discovery:'customer_tour.step_discovery',
  customer_services:'customer_tour.step_services',
  merchant_storefront_visibility:'merchant_tour.step_storefront_visibility',
  merchant_catalog_ai:'merchant_tour.step_catalog_ai',
  merchant_orders_fulfilment:'merchant_tour.step_orders_fulfilment',
  merchant_delivery_pricing:'merchant_tour.step_delivery_pricing',
  merchant_refunds:'merchant_tour.step_refunds',
  merchant_finance_settlement:'merchant_tour.step_finance_settlement',
  merchant_supplier_sourcing:'merchant_tour.step_supplier_sourcing',
  merchant_reputation_safety:'merchant_tour.step_reputation_safety',
  merchant_promotion:'merchant_tour.step_promotion',
  supplier_workspace_identity:'supplier_tour.step_workspace_identity',
  supplier_catalog_availability:'supplier_tour.step_catalog_availability',
  supplier_relationships_quotes:'supplier_tour.step_relationships_quotes',
  supplier_orders_eta:'supplier_tour.step_orders_eta',
  supplier_exceptions:'supplier_tour.step_exceptions',
  supplier_money_receivables:'supplier_tour.step_money_receivables',
  supplier_settlement_payout:'supplier_tour.step_settlement_payout',
  supplier_support_safety:'supplier_tour.step_support_safety',
  profile_settings:'profile_tour.step_settings'
};
const ROLE_LABEL_KEYS={customer:'role.customer',merchant:'role.merchant',supplier:'role.supplier',courier:'role.courier',service_provider:'role.service_provider'};
const ROLE_FALLBACK={customer:'Customer',merchant:'Merchant',supplier:'Supplier',courier:'Delivery',service_provider:'Local Services'};
const SUPPORTED_LOCALES=new Set(['en-PH','fil-PH']);
const COACH_TARGET_GAP=14,COACH_EDGE_GAP=12,COMPACT_BREAKPOINT=420;
let guide=null,overlay=null,launcher=null,refreshTimer=null,renderTimer=null,lastAutoStep='',missionCenterOpen=false,currentSpotlightTarget=null,placementFrame=0,placementRun=0,copy={},copyLocale='en-PH',selectedProfileJourneyRole='',languagePickerReturnMode='';
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
const languageSwitchLabel=()=>activeLocale()==='fil-PH'?'English / Filipino':'English / Filipino';
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
function progressPct(){return Math.round((completedCount()/Math.max(1,STEP_ORDER.length))*100)}
function roleLabel(){return roleLabelFor(guide?.selected_profile_role)}
function profileJourneys(){return Array.isArray(guide?.profile_journeys)?guide.profile_journeys:[]}
function profileJourney(role){return profileJourneys().find(j=>j.profile_role===role)||null}
function profileJourneyCompleted(journey){return Boolean(journey?.status==='completed')}
function profileJourneyActive(journey){return Boolean(journey&&journey.status!=='completed')}
function activeProfileJourney(){return profileJourneys().find(j=>j.is_active_profile&&profileJourneyActive(j))||null}
function incompleteJourneyCount(){return (guide?.status==='completed'?0:1)+profileJourneys().filter(profileJourneyActive).length}
function guideActive(){return Boolean(guide?.eligible&&(guide.status!=='completed'||profileJourneys().some(profileJourneyActive)))}
function profileStepLabel(step){return tr(PROFILE_STEP_LABEL_KEYS[step],{},step)}
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
  const button=ensureLauncher(),remaining=incompleteJourneyCount();
  if(!guide?.eligible||remaining===0){button.classList.add('hidden');return}
  button.classList.remove('hidden');
  button.querySelector('strong').textContent=tr('launcher.title',{},'Getting started');
  button.querySelector('small').textContent=tr('mission.remaining',{count:remaining},remaining+' journey'+(remaining===1?'':'s')+' left');
  const activeProfile=activeProfileJourney();
  button.classList.toggle('paused',guide.status==='paused'||Boolean(activeProfile?.status==='paused'));
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
function coachMarkup(step,title,body,{primary=tr('action.continue',{},'Continue'),secondary=tr('action.skip',{},'Skip for now'),back=false,waiting=false,progressIndex=null,progressTotal=null,eyebrow=''}={}){
  const total=Math.max(1,Number(progressTotal)||STEP_ORDER.length),index=Math.max(1,Number(progressIndex)||STEP_ORDER.indexOf(step)+1),pct=Math.round(index/total*100);
  return '<div class="guidedCoachHead"><div><small>'+esc(eyebrow||tr('common.getting_started',{},'GETTING STARTED'))+' · '+index+' / '+total+'</small><h2>'+esc(title)+'</h2></div><div class="guidedCoachHeadActions"><button type="button" class="guidedLanguageSwitch" data-guide-language-switch aria-label="Change tutorial language">🌐 '+esc(languageSwitchLabel())+'</button><span class="guidedProgressChip">'+pct+'%</span></div></div>'+
    '<p class="guidedCoachBody">'+esc(body)+'</p><button type="button" data-guide-more class="guidedMore" hidden>'+esc(tr('action.more',{},'More'))+'</button><div class="guidedProgress"><i style="width:'+pct+'%"></i></div>'+
    '<div class="guidedCoachActions">'+
      (back?'<button type="button" data-guide-back class="guidedSecondary">'+esc(tr('action.back',{},'Back'))+'</button>':'')+
      '<button type="button" data-guide-pause class="guidedSecondary">'+esc(secondary)+'</button>'+
      (waiting?'':'<button type="button" data-guide-next class="guidedPrimary">'+esc(primary)+'</button>')+
    '</div>';
}
function bindCoachActions(step,actions={}){
  const coach=overlay?.querySelector('.guidedCoach');if(!coach)return;
  coach.querySelector('[data-guide-pause]')?.addEventListener('click',async()=>{
    removeOverlay();missionCenterOpen=false;
    if(actions.pause)return actions.pause();
    await updateGuide({action:'pause'},{render:false});syncLauncher();
  });
  coach.querySelector('[data-guide-next]')?.addEventListener('click',async()=>{
    if(actions.next)return actions.next();
    await updateGuide({action:'complete_step',step_id:step});
  });
  coach.querySelector('[data-guide-back]')?.addEventListener('click',()=>{selectedProfileJourneyRole='';missionCenterOpen=true;renderMissionCenter()});
}
function renderCoach({step,title,body,target=null,primary,secondary,back=false,waiting=false,next,pause,progressIndex=null,progressTotal=null,eyebrow=''}){
  const root=overlayShell(),coach=root.querySelector('.guidedCoach');
  coach.innerHTML=coachMarkup(step,title,body,{primary,secondary,back,waiting,progressIndex,progressTotal,eyebrow});coach.dataset.bodyLong=String(String(body||'').length>118);
  bindCoachActions(step,{next,pause});
  coach.querySelector('[data-guide-language-switch]')?.addEventListener('click',()=>{languagePickerReturnMode=selectedProfileJourneyRole?'profile':'current';renderLanguageCoach({returnToCurrent:true})});
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

function renderLanguageCoach({returnToCurrent=false}={}){
  const root=overlayShell(),coach=root.querySelector('.guidedCoach'),suggested=suggestedLocale(),current=activeLocale();
  root.querySelector('.guidedSpotlight')?.classList.add('hidden');
  coach.classList.add('guidedLanguageCoach');
  coach.innerHTML='<div class="guidedCoachHead"><div><small>GETTING STARTED · PAGSISIMULA</small><h2>Choose your language / Piliin ang iyong wika</h2></div><span class="guidedProgressChip">🌐</span></div>'+
    '<p class="guidedCoachBody">Choose the language for this tutorial. You can change it again at any time. / Piliin ang wikang gagamitin para sa gabay na ito. Maaari mo itong palitan anumang oras.</p>'+
    '<div class="guidedLanguageChoices">'+
      '<button type="button" data-guide-locale="en-PH" class="'+(current==='en-PH'?'selected ':'')+'"><span><strong>English</strong><small>English (Philippines)</small></span>'+(suggested==='en-PH'?'<b>Suggested</b>':'')+'</button>'+
      '<button type="button" data-guide-locale="fil-PH" class="'+(current==='fil-PH'?'selected ':'')+'"><span><strong>Filipino / Tagalog</strong><small>Filipino / Tagalog para sa Pilipinas</small></span>'+(suggested==='fil-PH'?'<b>Iminumungkahi</b>':'')+'</button>'+
    '</div><small class="guidedLanguageBoundary">Language changes only this guided tutorial. Country, profile, money and payment settings stay unchanged. / Ang wika ay para lamang sa guided tutorial.</small>'+
    '<div class="guidedCoachActions">'+
      (returnToCurrent?'<button type="button" data-guide-language-back class="guidedSecondary">Back / Bumalik</button>':'<button type="button" data-guide-pause class="guidedSecondary">Later / Mamaya</button>')+
    '</div>';
  coach.querySelector('[data-guide-pause]')?.addEventListener('click',async()=>{languagePickerReturnMode='';removeOverlay();missionCenterOpen=false;await updateGuide({action:'pause'},{render:false});syncLauncher()});
  coach.querySelector('[data-guide-language-back]')?.addEventListener('click',()=>{const mode=languagePickerReturnMode;languagePickerReturnMode='';if(mode==='mission'){missionCenterOpen=true;return renderMissionCenter()}missionCenterOpen=false;renderGuide()});
  coach.querySelectorAll('[data-guide-locale]').forEach(button=>button.onclick=async()=>{
    coach.querySelectorAll('button').forEach(x=>x.disabled=true);
    try{
      const mode=languagePickerReturnMode;
      await updateGuide({action:'set_locale',locale:button.dataset.guideLocale},{render:false});
      await loadCopy(button.dataset.guideLocale);
      languagePickerReturnMode='';
      if(mode==='mission'){missionCenterOpen=true;renderMissionCenter();return}
      missionCenterOpen=false;
      renderGuide();
    }catch(error){
      coach.querySelectorAll('button').forEach(x=>x.disabled=false);
    }
  });
  coach.focus?.({preventScroll:true});
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
async function customerJourneyTarget(...selectors){return firstVisible(...selectors,'.customerHomeHero','#roleHub')}
function completeProfileTourStep(role,step){
  return updateGuide({action:'profile_complete_step',profile_role:role,step_id:step},{render:false})
    .then(()=>{selectedProfileJourneyRole=role;renderProfileJourney(role)});
}
function customerProfileJourneyDefinition(journey,label){
  const role='customer',step=journey?.current_step_id||journey?.steps?.find(x=>!(journey?.completed_steps||[]).includes(x))||'profile_welcome';
  const next=()=>completeProfileTourStep(role,step);
  if(step==='profile_welcome')return{
    step,
    title:tr('profile_tour.welcome_title',{role:label},'{role} tutorial'),
    body:tr('customer_tour.welcome_body',{},'This Customer tutorial focuses first on privacy, price, payment, order commitment, tracking and safety before optional discovery features.'),
    target:customerJourneyTarget('.customerHomeHero'),
    primary:tr('action.continue',{},'Continue'),
    secondary:tr('action.pause',{},'Pause tutorial'),
    next
  };
  if(step==='customer_address_privacy')return{
    step,
    title:tr('customer_tour.address_title',{},'Addresses and privacy'),
    body:tr('customer_tour.address_body',{},'Your home address stays private. A delivery or service address is used only for that transaction. Location access is never required just to browse.'),
    target:customerJourneyTarget('#checkoutAddressLabel','#checkoutAddress','.customerSettingsLink','[data-customer-nav="services"]'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='customer_price_payment')return{
    step,
    title:tr('customer_tour.price_title',{},'Check price and payment before committing'),
    body:tr('customer_tour.price_body',{},'At checkout, review product or service price, any delivery charge and the payment method before you continue. Refunds are shown as completed only when the underlying payment/refund evidence confirms them.'),
    target:customerJourneyTarget('[data-bl-pricing="customer_checkout"]','#checkoutPayment','#basketCheckout','[data-customer-nav-target="shop"]'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='customer_order_commitment')return{
    step,
    title:tr('customer_tour.commit_title',{},'Know when you commit'),
    body:tr('customer_tour.commit_body',{},'Adding items to a basket does not place an order. Before Place order, review fulfilment, delivery address, price and payment. Place order is the commitment point.'),
    target:customerJourneyTarget('.placeOrder','#marketCheckoutForm','#basketCheckout','[data-customer-nav-target="shop"]'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='customer_tracking')return{
    step,
    title:tr('customer_tour.tracking_title',{},'Track real order status'),
    body:tr('customer_tour.tracking_body',{},'My orders shows the real order state. Delivery tracking appears only when a delivery exists, so preparation, pickup and delivery are not presented as the same thing.'),
    target:customerJourneyTarget('[data-track]','#customerDeliveriesBtn','[data-hub-feature="Orders"]','[data-customer-nav="orders"]'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='customer_support_safety')return{
    step,
    title:tr('customer_tour.support_title',{},'Support and safety'),
    body:tr('customer_tour.support_body',{},'Use Help & Support when something needs review. Use the report or safety action attached to the relevant store, order or service when the issue is about that transaction. Do not post private addresses in public notes.'),
    target:customerJourneyTarget('#lazySupportBtn','.marketSafetyAction','.serviceSafetyAction','[data-hub-feature="Orders"]'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='customer_money')return{
    step,
    title:tr('customer_tour.money_title',{},'My money'),
    body:tr('customer_tour.money_body',{},'Customer Money shows confirmed purchases, payments, outstanding amounts and refunds. It is personal activity, not business accounting or a bank/provider balance.'),
    target:customerJourneyTarget('.moneyHeroCustomer','[data-customer-home-open="money"]','[data-hub-feature="Money"]','[data-customer-nav="money"]'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='customer_discovery')return{
    step,
    title:tr('customer_tour.discovery_title',{},'Discover stores'),
    body:tr('customer_tour.discovery_body',{},'Food and non-food merchants show only their published storefront information. The Platform Store is separate; products, prices and baskets are not mixed automatically.'),
    target:customerJourneyTarget('.customerShopBoundary','[data-customer-nav-target="shop"]','[data-customer-nav="shop"]'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='customer_services')return{
    step,
    title:tr('customer_tour.services_title',{},'Request local services'),
    body:tr('customer_tour.services_body',{},'Local Services uses its own request, quote and job flow. Review the service scope and quote before accepting changes; the job address stays transaction-scoped.'),
    target:customerJourneyTarget('#requestService','[data-hub-feature="Local Services"]','[data-customer-nav="services"]'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  return null;
}
function merchantJourneyTarget(...selectors){
  return firstVisible(...selectors,'#merchantWorkspaceNav','#merchantMobileTools','.hubHero','#roleHub');
}
function merchantProfileJourneyDefinition(journey,label){
  const role='merchant',step=journey?.current_step_id||journey?.steps?.find(x=>!(journey?.completed_steps||[]).includes(x))||'profile_welcome';
  const next=()=>completeProfileTourStep(role,step);
  if(step==='profile_welcome')return{
    step,
    title:tr('profile_tour.welcome_title',{role:label},'{role} tutorial'),
    body:tr('merchant_tour.welcome_body',{},'This Merchant tutorial explains the controls that can affect public visibility, customer commitments and money before optional promotion tools.'),
    target:merchantJourneyTarget('.hubHero','#merchantWorkspaceNav'),
    primary:tr('action.continue',{},'Continue'),
    secondary:tr('action.pause',{},'Pause tutorial'),
    next
  };
  if(step==='merchant_storefront_visibility')return{
    step,
    title:tr('merchant_tour.storefront_title',{},'Storefront, address and public visibility'),
    body:tr('merchant_tour.storefront_body',{},'Your Storefront can be Food, Non-food or Mixed. Business presence, pickup address, map pin, logo, cover and gallery are separate controls. Exact location stays private unless you explicitly turn on public location sharing.'),
    target:merchantJourneyTarget('#storeLocationPanel','#storefrontV2Media','#storePresence','#marketQuickButton','[data-merchant-mobile-action="marketQuickButton"]'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='merchant_catalog_ai')return{
    step,
    title:tr('merchant_tour.catalog_title',{},'Catalog and AI drafts'),
    body:tr('merchant_tour.catalog_body',{},'Food, packaged resale, fresh/direct and non-food products use different stock rules. AI-generated media is always a draft: review it before choosing it as primary, and publishing remains a separate Merchant action.'),
    target:merchantJourneyTarget('.merchantCatalogList','#directProductForm','#directKind','#marketQuickButton','[data-merchant-mobile-action="marketQuickButton"]'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='merchant_orders_fulfilment')return{
    step,
    title:tr('merchant_tour.orders_title',{},'Orders and fulfilment'),
    body:tr('merchant_tour.orders_body',{},'Orders move through waiting, accepted, preparing and ready states. Record payment only when you actually received it. Ready, pickup completion and delivery handoff are customer commitments, so update the real state rather than using them as notes.'),
    target:merchantJourneyTarget('.ordersBoard','.orderSummaryStrip','#ordersQuickButton','[data-merchant-mobile-action="ordersQuickButton"]'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='merchant_delivery_pricing')return{
    step,
    title:tr('merchant_tour.delivery_title',{},'Delivery price and handoff'),
    body:tr('merchant_tour.delivery_body',{},'Delivery is a separate charge from merchandise sales. A valid pickup location and active Admin pricing rule are required for quotes. Confirm who pays the delivery charge before handoff; delivery fees are not merchandise revenue.'),
    target:merchantJourneyTarget('#pickupLocationForm','[data-bl-pricing="merchant"]','#deliveryQuickButton','[data-merchant-mobile-action="deliveryQuickButton"]'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='merchant_refunds')return{
    step,
    title:tr('merchant_tour.refunds_title',{},'Cancellations and refunds'),
    body:tr('merchant_tour.refunds_body',{},'Cancelling an order and refunding money are different facts. Do not tell a customer a refund succeeded until payment/refund evidence confirms it. Order cancellation may reverse stock, while payment reversal follows the payment record.'),
    target:merchantJourneyTarget('.orderActions','#ordersQuickButton','[data-merchant-mobile-action="ordersQuickButton"]','.businessFinanceDetails'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='merchant_finance_settlement')return{
    step,
    title:tr('merchant_tour.finance_title',{},'Finance, fees and settlement'),
    body:tr('merchant_tour.finance_body',{},'Merchant Finance keeps completed sales, confirmed customer payments, receivables, expenses and Supplier payables separate. Platform fees and payment-processor charges are separate. A payout or settlement is real only when provider evidence confirms it; manual records are not bank balance.'),
    target:merchantJourneyTarget('.businessFinancePrimary','.businessFinanceDetails','#businessWorkspaceBar','[data-bl-pricing="merchant"]','#merchantHomeButton'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='merchant_supplier_sourcing')return{
    step,
    title:tr('merchant_tour.suppliers_title',{},'Supplier sourcing'),
    body:tr('merchant_tour.suppliers_body',{},'Use Suppliers for procurement relationships, catalog offers and purchase orders. Supplier purchases and amounts owed belong to the selected Merchant business workspace and must not be mixed with another business or personal money.'),
    target:merchantJourneyTarget('#supQuickButton','[data-merchant-mobile-action="supQuickButton"]','#supWorkspace'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='merchant_reputation_safety')return{
    step,
    title:tr('merchant_tour.reputation_title',{},'Reputation, safety and Support'),
    body:tr('merchant_tour.reputation_body',{},'Public Merchant reputation and price comparison are opt-in controls. Publish only information you intend customers to see. Use Help & Support or the relevant safety/report flow for incidents; keep private addresses and internal financial details out of public notes.'),
    target:merchantJourneyTarget('#storeReputation','#storeCompare','#lazySupportBtn','#marketQuickButton','[data-merchant-mobile-action="marketQuickButton"]'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='merchant_promotion')return{
    step,
    title:tr('merchant_tour.promotion_title',{},'Promotion is optional'),
    body:tr('merchant_tour.promotion_body',{},'Promotion Center is optional and comes after the operational basics. Promotion never changes your storefront publication, prices, stock, order status or payment state automatically.'),
    target:merchantJourneyTarget('#profilePromotionCenter','[data-merchant-mobile-action="profileSettings"]','.profileSettingsTile'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  return null;
}

function supplierJourneyTarget(...selectors){
  return firstVisible(...selectors,'#supWorkspace','[data-hub-feature="Today"]','.hubHero','#roleHub');
}
function supplierProfileJourneyDefinition(journey,label){
  const role='supplier',step=journey?.current_step_id||journey?.steps?.find(x=>!(journey?.completed_steps||[]).includes(x))||'profile_welcome';
  const next=()=>completeProfileTourStep(role,step);
  if(step==='profile_welcome')return{
    step,
    title:tr('profile_tour.welcome_title',{role:label},'{role} tutorial'),
    body:tr('supplier_tour.welcome_body',{},'This Supplier tutorial explains your business workspace, catalog visibility, Merchant relationships, commitments, ETA, exceptions, fees and money evidence before secondary tools. Your Personal Account stays separate from this Supplier business.'),
    target:supplierJourneyTarget('.hubHero','#businessWorkspaceBar'),
    primary:tr('action.continue',{},'Continue'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='supplier_workspace_identity')return{
    step,
    title:tr('supplier_tour.workspace_title',{},'Supplier business and economic workspace'),
    body:tr('supplier_tour.workspace_body',{},'Supplier activity belongs to the selected Supplier business workspace, not your Personal Account. Purchase orders, receivables, expenses, fees, financial documents and settlement records must remain attributed to that business; switching businesses must never mix their accounting.'),
    target:supplierJourneyTarget('#businessWorkspaceBar','[data-hub-feature="Finance & Accounting"]','.businessFinanceHead'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='supplier_catalog_availability')return{
    step,
    title:tr('supplier_tour.catalog_title',{},'Catalog and availability'),
    body:tr('supplier_tour.catalog_body',{},'Keep products, pack sizes, pricing and availability factual. Your sourcing visibility is private by default; only items you explicitly publish may appear to approved Merchants in Directory mode. The selected Supplier business may also have an optional warehouse, dispatch or pickup override: it stays private unless you explicitly share that exact work address with accepted Merchant relationships. Your personal address is never published as the Supplier location. RFQ acceptance is also explicit, and business activities do not claim a government licence.'),
    target:supplierJourneyTarget('#supplierProfile','#supplierOperatingLocationForm','#catalogAdd','#supplierActivities','#supplierSourcingSettingsForm','[data-hub-feature="Catalog"]'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='supplier_relationships_quotes')return{
    step,
    title:tr('supplier_tour.relationships_title',{},'Merchant relationships and quotes'),
    body:tr('supplier_tour.relationships_body',{},'Only accepted Merchant relationships can exchange in-app procurement orders. RFQs and quotes are separate from purchase orders. You can update your quote while the RFQ remains open; quote factual price, pack, availability, lead time and terms. A quote becomes a purchase order only when the Merchant explicitly decides to create one.'),
    target:supplierJourneyTarget('#supEditSourcing','[data-rfq-quote]','#supplierRfqQuoteForm','[data-v5-open="Procurement"]','[data-hub-feature="Orders"]'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='supplier_orders_eta')return{
    step,
    title:tr('supplier_tour.eta_title',{},'Purchase orders, lead time and ETA'),
    body:tr('supplier_tour.eta_body',{},'Responding to a purchase order is where you confirm or reject the requested quantities and may confirm prices, ready time and delivery ETA. Once accepted, the PO is a commercial commitment. ETA supports Merchant planning; it is not a delivery guarantee and never proves that goods were delivered or paid.'),
    target:supplierJourneyTarget('[data-sup-respond]','#supReady','#supDeliveryEta','[data-sup-status]','[data-hub-feature="Orders"]'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='supplier_exceptions')return{
    step,
    title:tr('supplier_tour.exceptions_title',{},'Backorders, substitutions and exceptions'),
    body:tr('supplier_tour.exceptions_body',{},'Shortages, backorders, substitutions, returns and recalls need explicit records and decisions. Never silently replace an item or promise unavailable stock. A proposed backorder or substitution does not change the original order until the Merchant approves it. A confirmed credit changes the commercial balance but is not cash refunded.'),
    target:supplierJourneyTarget('[data-sup-shortage]','[data-propose-backorder]','[data-propose-substitution]','[data-v5-backorder-fulfil]','[data-return-auth]','[data-return-resolve]','#supIssueRecall'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='supplier_money_receivables')return{
    step,
    title:tr('supplier_tour.money_title',{},'Receivables and recorded payments'),
    body:tr('supplier_tour.money_body',{},'Fulfilled PO value, Merchant receivables, recorded receipts, platform or processor fees, expenses and inventory value are different facts. An unreceived PO is not money due. Record a payment only from real evidence, and keep statements and financial documents attributed to the same Supplier business.'),
    target:supplierJourneyTarget('.businessFinancePrimary','[data-hub-feature="Money"]','[data-hub-feature="Finance & Accounting"]','#profileFinancialDocuments'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='supplier_settlement_payout')return{
    step,
    title:tr('supplier_tour.settlement_title',{},'Settlement, payout and financial accounts'),
    body:tr('supplier_tour.settlement_body',{},'A recorded receipt or accounting entry is not the same as provider-confirmed settlement. Do not show a payout or withdrawal as succeeded until provider evidence confirms it. External payment methods and payout destinations live in Account Money & Banking; Supplier books, financial accounts and payout preferences stay scoped to the selected Supplier business.'),
    target:supplierJourneyTarget('.businessFinanceDetails','#openBusinessFinanceSettings','[data-profile-settings-view="finance"]','#openAccountMoneyFromProfile'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='supplier_support_safety')return{
    step,
    title:tr('supplier_tour.support_title',{},'Safety, returns and Support'),
    body:tr('supplier_tour.support_body',{},'Use the real return, recall and exception records when goods have a problem. Use Help & Support for disputes, incidents or account help. Keep private contact details, addresses and financial evidence out of public notes; compliance requirements depend on the activity and should be checked through the current Compliance & Training guidance.'),
    target:supplierJourneyTarget('#supIssueRecall','[data-return-resolve]','#supplierReturnResolve','#lazySupportBtn','#supWorkspace'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  return null;
}


function courierJourneyTarget(...selectors){
  return firstVisible(...selectors,'#courierHomeStatus','#courierHomeWork','#courierHomeMoney','.hubHero','#roleHub');
}
function courierProfileJourneyDefinition(journey,label){
  const role='courier',step=journey?.current_step_id||journey?.steps?.find(x=>!(journey?.completed_steps||[]).includes(x))||'profile_welcome';
  const next=()=>completeProfileTourStep(role,step);
  if(step==='profile_welcome')return{
    step,
    title:tr('profile_tour.welcome_title',{role:label},'{role} tutorial'),
    body:tr('courier_tour.welcome_body',{},'This Delivery tutorial explains authorization, availability, assigned work, customer privacy, live location, secure handoff, money evidence and safety before secondary features.'),
    target:courierJourneyTarget('.hubHero','#courierHomeStatus'),
    primary:tr('action.continue',{},'Continue'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='courier_eligibility_vehicle')return{
    step,
    title:tr('courier_tour.eligibility_title',{},'Eligibility, vehicle and authorization'),
    body:tr('courier_tour.eligibility_body',{},'Your Delivery profile may be enabled without being authorized to work. Vehicle details and submitted documents are evidence for review; only explicit Admin approval makes the eligibility gate approved. Expired or suspended approval blocks availability.'),
    target:courierJourneyTarget('#courierHomeStatus','[data-courier-home-open="Eligibility"]','#courierProfileForm','#courierDocumentForm'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='courier_availability_area')return{
    step,
    title:tr('courier_tour.availability_title',{},'Availability and operating area'),
    body:tr('courier_tour.availability_body',{},'After approval, you decide when you are available for delivery offers. Your operating or start area is coarse work geography, not a public home address. A current job location belongs only to a delivery you accepted and must not turn your private home address into a public Courier location.'),
    target:courierJourneyTarget('#courierHomeAvailabilityAction','[data-courier-home-open="Availability"]','#courierAvailable','[data-hub-feature="Profile Settings"]'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='courier_assignments_workflow')return{
    step,
    title:tr('courier_tour.assignments_title',{},'Delivery offers, acceptance and pickup workflow'),
    body:tr('courier_tour.assignments_body',{},'When you are Available, eligible delivery offers can arrive. Review each offer and choose Accept or Refuse. Only a successful Accept makes the delivery your assigned job; only then use Start route and the recorded pickup/transit sequence. Never advance a status just to move the screen forward.'),
    target:courierJourneyTarget('#courierHomeWork','[data-courier-nav="deliveries"]','[data-courier-status]','#deliveryWorkspace'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='courier_customer_privacy')return{
    step,
    title:tr('courier_tour.privacy_title',{},'Customer contact and location privacy'),
    body:tr('courier_tour.privacy_body',{},'Customer address, contact details and handoff information are for the assigned delivery only. Use them only to complete that job, do not copy them into public notes, and do not retain or reuse them for unrelated contact after the delivery.'),
    target:courierJourneyTarget('#courierHomeWork','[data-del-live]','#deliveryWorkspace'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='courier_navigation_location')return{
    step,
    title:tr('courier_tour.navigation_title',{},'Navigation, ETA and live location'),
    body:tr('courier_tour.navigation_body',{},'ETA and the active route help the Customer and Merchant follow the current delivery. Share live location only for an active assigned delivery and only for that purpose. Off-duty or completed-delivery tracking is not part of the Courier workflow; location sharing must stop when the delivery ends.'),
    target:courierJourneyTarget('[data-courier-home-open="Tracking"]','[data-share-location]','#liveDeliveryMap','[data-del-live]'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='courier_handoff_evidence')return{
    step,
    title:tr('courier_tour.handoff_title',{},'Secure handoff and proof'),
    body:tr('courier_tour.handoff_body',{},'Complete a delivery only after the real handoff. The Customer handoff code is protected completion evidence: do not ask for it early, post it publicly or invent a successful handoff. Eligibility documents and delivery evidence also stay private and must reflect the real vehicle, document and event.'),
    target:courierJourneyTarget('[data-complete-delivery]','#deliveryCodeInput','#courierDocumentForm','.deliveryDoc'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='courier_money_earnings')return{
    step,
    title:tr('courier_tour.money_title',{},'Delivery price, earnings and fees'),
    body:tr('courier_tour.money_body',{},'The Customer delivery charge is not automatically your earnings. Courier Money uses recorded courier_net and settlement evidence when configured, while platform fees and processor/provider charges remain separate. Never infer earnings from the merchandise value or from a delivery fee alone.'),
    target:courierJourneyTarget('#courierHomeMoney','[data-courier-nav="money"]','[data-courier-home-open="Money"]','#profileMoneyWorkspace'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='courier_settlement_payout')return{
    step,
    title:tr('courier_tour.settlement_title',{},'Wallet, settlement and payout'),
    body:tr('courier_tour.settlement_body',{},'A recorded earning is not the same as money settled to an external account. Pending, eligible, held and processing amounts must remain distinguishable from paid amounts. Do not show a payout or withdrawal as succeeded until provider evidence confirms it; payout destinations belong in Account Money & Banking and profile finance settings.'),
    target:courierJourneyTarget('#profileMoneyWorkspace','[data-profile-settings-view="finance"]','#openAccountMoneyFromProfile','[data-courier-nav="money"]'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='courier_safety_support')return{
    step,
    title:tr('courier_tour.support_title',{},'Incidents, safety and Help & Support'),
    body:tr('courier_tour.support_body',{},'For an accident, unsafe situation, damaged order, serious handoff problem or privacy concern, protect people first and use the appropriate private incident or Help & Support flow. Keep incident evidence private, report facts promptly, and do not expose Customer addresses, contact details or handoff codes in public notes.'),
    target:courierJourneyTarget('#lazySupportBtn','[data-help-support]','#courierHomeWork','#deliveryWorkspace'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  return null;
}


function serviceProviderJourneyTarget(...selectors){
  return firstVisible(...selectors,'#serviceProviderHomeStatus','#serviceProviderHomeWork','#serviceProviderHomeMoney','.hubHero','#roleHub');
}
function serviceProviderProfileJourneyDefinition(journey,label){
  const role='service_provider',step=journey?.current_step_id||journey?.steps?.find(x=>!(journey?.completed_steps||[]).includes(x))||'profile_welcome';
  const next=()=>completeProfileTourStep(role,step);
  if(step==='profile_welcome')return{
    step,
    title:tr('profile_tour.welcome_title',{role:label},'{role} tutorial'),
    body:tr('service_tour.welcome_body',{},'This Local Services tutorial explains readiness, visibility, service area, pricing, quotes, jobs, Customer privacy, work evidence, money and safety before secondary promotion features.'),
    target:serviceProviderJourneyTarget('.hubHero','#serviceProviderHomeStatus'),
    primary:tr('action.continue',{},'Continue'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='service_readiness_credentials')return{
    step,
    title:tr('service_tour.readiness_title',{},'Readiness, categories and credentials'),
    body:tr('service_tour.readiness_body',{},'Choose only services you actually offer and keep credentials truthful with their real verification status. Business & Life platform eligibility is not a government or professional licence, and the app must not invent a licence requirement. Requirements depend on the actual service and should be checked through current Compliance & Training guidance.'),
    target:serviceProviderJourneyTarget('#serviceReadinessForm','#serviceOperatingContext','[data-service-provider-section="Qualifications"]','#addCredential'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='service_visibility_area')return{
    step,
    title:tr('service_tour.visibility_title',{},'Profile visibility and service area'),
    body:tr('service_tour.visibility_body',{},'Your public service area and optional radius describe where you work. Your exact service base is a separate override: it stays private by default and becomes public only if you explicitly choose Public. If no override is set, your personal/home address stays private and is not copied into the Local Services profile. A Customer job address is a third, separate location that is released only for active fulfilment and remains job-scoped.'),
    target:serviceProviderJourneyTarget('#providerProfileForm','#serviceBaseLocationForm','#providerArea','#providerRadius','#providerVisibility','#serviceOperatingContext'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='service_offers_pricing')return{
    step,
    title:tr('service_tour.offers_title',{},'Services, guide prices and scope'),
    body:tr('service_tour.offers_body',{},'Publish only the categories and tasks you really provide. Guide prices, hourly rates, ranges and call-out fees explain how you usually charge; they are not the final job bill. The payable commercial amount comes from the exact itemised quote the Customer accepts.'),
    target:serviceProviderJourneyTarget('[data-service-provider-section="Services"]','#providerServicesForm','[data-service-category]','[data-service-field="pricing_method"]'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='service_quotes_changes')return{
    step,
    title:tr('service_tour.quotes_title',{},'Quotes and approved changes'),
    body:tr('service_tour.quotes_body',{},'Send an itemised quote that matches the requested work. A quote becomes the agreed price only when the Customer accepts that exact version. If scope or price changes later, use a change order and wait for explicit Customer acceptance; silence or continuing the work is not approval.'),
    target:serviceProviderJourneyTarget('[data-service-provider-section="Quotes"]','#providerJobs','[data-job-action="quote"]','[data-job-action="change_order"]'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='service_jobs_privacy')return{
    step,
    title:tr('service_tour.jobs_title',{},'Job lifecycle and Customer address privacy'),
    body:tr('service_tour.jobs_body',{},'Keep job status aligned with what actually happened: accepted, scheduled, in progress and completed. Before quote acceptance you should have only the coarse area. The exact Customer service address is released only for active fulfilment, each access is logged, and it must not be copied into public notes or reused after the job.'),
    target:serviceProviderJourneyTarget('[data-service-provider-section="Jobs"]','#providerJobs','[data-job-action="view_location"]','[data-job-action="in_progress"]'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='service_work_evidence_consent')return{
    step,
    title:tr('service_tour.evidence_title',{},'Work evidence and publication consent'),
    body:tr('service_tour.evidence_body',{},'Before/after photos, job notes, credentials and other work evidence must describe the real work and stay private when they contain Customer or location information. A portfolio example linked to a Customer job may become public only with the Customer publication consent recorded for that job; never treat job completion as media or promotion consent.'),
    target:serviceProviderJourneyTarget('[data-service-provider-section="Qualifications"]','#addCredential','#editProviderCv','[data-service-provider-section="Jobs"]'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='service_money_payments')return{
    step,
    title:tr('service_tour.money_title',{},'Job value, payments, fees and settlement'),
    body:tr('service_tour.money_body',{},'A Customer-confirmed completed job value is commercial value, not proof that money was received. Customer payment evidence comes from verified payment records; Provider income and settlement require the separate service_provider_net evidence when configured. Keep outstanding, paid, refunded and settlement states distinct.'),
    target:serviceProviderJourneyTarget('[data-service-provider-nav="money"]','[data-service-provider-home-money]','#serviceProviderHomeMoney','#profileMoneyWorkspace'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  if(step==='service_safety_compliance')return{
    step,
    title:tr('service_tour.safety_title',{},'Safety, incidents, compliance and Support'),
    body:tr('service_tour.safety_body',{},'For unsafe work, injury, harassment, serious damage, fraud concerns or privacy problems, protect people first and use the appropriate private incident or Help & Support flow. Do not invent legal or licence requirements from the tutorial; use the current versioned Compliance & Training guidance for the specific service and keep Customer data and private evidence out of public notes.'),
    target:serviceProviderJourneyTarget('#lazySupportBtn','[data-help-support]','[data-service-provider-section="Qualifications"]','#serviceProviderHomeWork'),
    primary:tr('action.got_it',{},'Got it'),secondary:tr('action.pause',{},'Pause tutorial'),next
  };
  return null;
}

function profileJourneyDefinition(journey){
  const role=journey?.profile_role||'',label=roleLabelFor(role),steps=Array.isArray(journey?.steps)&&journey.steps.length?journey.steps:PROFILE_STEP_ORDER,step=journey?.current_step_id||steps.find(x=>!(journey?.completed_steps||[]).includes(x))||steps[0]||'profile_welcome';
  if(!journey?.is_active_profile)return{
    step,
    title:tr('profile_tour.open_profile_title',{role:label},'Open {role} to continue'),
    body:tr('profile_tour.open_profile_body',{role:label},'This tutorial belongs only to your {role} profile. Open that profile when you are ready to continue.'),
    target:firstVisible('[data-account-role="'+role+'"]','[data-role-action="'+role+'"]','.profileRoleList'),
    waiting:true,
    secondary:tr('action.pause',{},'Pause tutorial')
  };
  if(role==='customer'){
    const customer=customerProfileJourneyDefinition(journey,label);
    if(customer)return customer;
  }
  if(role==='merchant'){
    const merchant=merchantProfileJourneyDefinition(journey,label);
    if(merchant)return merchant;
  }
  if(role==='supplier'){
    const supplier=supplierProfileJourneyDefinition(journey,label);
    if(supplier)return supplier;
  }
  if(role==='courier'){
    const courier=courierProfileJourneyDefinition(journey,label);
    if(courier)return courier;
  }
  if(role==='service_provider'){
    const provider=serviceProviderProfileJourneyDefinition(journey,label);
    if(provider)return provider;
  }
  if(step==='profile_welcome')return{
    step,
    title:tr('profile_tour.welcome_title',{role:label},'{role} tutorial'),
    body:tr('profile_tour.welcome_body',{role:label},'This tutorial is separate from your account setup and from every other profile. It will explain the important controls for your {role} profile.'),
    target:firstVisible('.hubHero','#roleHub'),
    primary:tr('action.continue',{},'Continue'),
    secondary:tr('action.pause',{},'Pause tutorial'),
    next:()=>completeProfileTourStep(role,'profile_welcome')
  };
  const settingsVisible=visible(document.getElementById('profileSettingsWorkspace'));
  return{
    step,
    title:tr('profile_tour.settings_title',{},'Profile Settings'),
    body:tr('profile_tour.settings_body',{role:label},'Profile-specific preferences stay inside {role} Profile Settings. Account identity and shared banking remain separate.'),
    target:firstVisible('[data-hub-feature="Profile Settings"]','.profileSettingsTile','[data-merchant-mobile-action="profileSettings"]','#profileSettingsWorkspace'),
    primary:settingsVisible?tr('action.got_it',{},'Got it'):tr('profile_tour.open_settings',{},'Open Profile Settings'),
    secondary:tr('action.pause',{},'Pause tutorial'),
    next:async()=>{
      if(!settingsVisible){window.BusinessLifeProfileSettings?.open?.(role);scheduleRender(300);return}
      await updateGuide({action:'profile_complete_step',profile_role:role,step_id:'profile_settings'},{render:false});
      selectedProfileJourneyRole='';missionCenterOpen=true;renderMissionCenter();
    }
  };
}
function renderProfileJourney(role){
  const journey=profileJourney(role);
  if(!journey){missionCenterOpen=true;selectedProfileJourneyRole='';return renderMissionCenter()}
  missionCenterOpen=false;selectedProfileJourneyRole=role;
  if(journey.status==='paused'){
    missionCenterOpen=true;return renderMissionCenter();
  }
  if(journey.status==='completed'){
    missionCenterOpen=true;return renderMissionCenter();
  }
  const steps=Array.isArray(journey.steps)&&journey.steps.length?journey.steps:PROFILE_STEP_ORDER,def=profileJourneyDefinition(journey),index=Math.max(1,steps.indexOf(def.step)+1);
  renderCoach({
    ...def,
    back:true,
    progressIndex:index,
    progressTotal:steps.length,
    eyebrow:tr('profile_tour.eyebrow',{role:roleLabelFor(role)},roleLabelFor(role)+' TUTORIAL'),
    pause:()=>updateGuide({action:'profile_pause',profile_role:role},{render:false}).then(()=>{selectedProfileJourneyRole='';syncLauncher()})
  });
}
function renderGuide(){
  if(missionCenterOpen)return renderMissionCenter();
  if(!guide?.eligible){removeOverlay();return}
  if(selectedProfileJourneyRole&&profileJourney(selectedProfileJourneyRole))return renderProfileJourney(selectedProfileJourneyRole);
  if(guide.status!=='completed'&&guide.status!=='paused'){
    const step=guide.current_step_id||STEP_ORDER.find(x=>!completedSet().has(x));
    if(!step){removeOverlay();return}
    if(step==='language')return renderLanguageCoach();
    const def=stepDefinition(step);
    return renderCoach({step,...def});
  }
  const activeProfile=activeProfileJourney();
  if(activeProfile&&activeProfile.status==='active'&&activeProfile.auto_start_enabled)return renderProfileJourney(activeProfile.profile_role);
  removeOverlay();
}
function missionRow(step,index){
  const done=completedSet().has(step),current=guide?.current_step_id===step;
  return '<button type="button" class="guidedMissionRow '+(done?'done ':current?'current ':'')+'" data-guide-mission="'+esc(step)+'">'+
    '<span class="guidedMissionIcon">'+(done?'✓':index+1)+'</span>'+
    '<span><strong>'+esc(stepLabel(step))+'</strong><small>'+(done?tr('mission.done',{},'Done'):current?tr('mission.next',{},'Next mission'):tr('mission.upcoming',{},'Upcoming'))+'</small></span>'+
    '<b>'+((done||current)?'›':'')+'</b></button>';
}
function profileJourneyRow(journey){
  const role=journey.profile_role,label=roleLabelFor(role),done=profileJourneyCompleted(journey),active=journey.is_active_profile;
  const status=done?tr('mission.done_restart',{},'Done · tap to restart'):journey.status==='paused'?tr('mission.paused',{},'Paused'):active?tr('mission.in_progress',{},'In progress'):tr('mission.ready',{},'Ready');
  return '<button type="button" class="guidedMissionRow guidedJourneyRow '+(done?'done ':'')+(active?'current ':'')+'" data-guide-profile-journey="'+esc(role)+'">'+
    '<span class="guidedMissionIcon">'+(done?'✓':'↳')+'</span>'+
    '<span><strong>'+esc(tr('profile_tour.row_title',{role:label},label+' tutorial'))+'</strong><small>'+esc(status)+' · '+Number(journey.progress_completed||0)+'/'+Number(journey.progress_total||journey.steps?.length||PROFILE_STEP_ORDER.length)+'</small></span>'+
    '<b>›</b></button>';
}
function renderMissionCenter(){
  missionCenterOpen=true;
  const root=overlayShell(),coach=root.querySelector('.guidedCoach'),profiles=profileJourneys();
  coach.classList.add('guidedMissionCenter');
  const accountRows=STEP_ORDER.map(missionRow).join('');
  const profileRows=profiles.length?profiles.map(profileJourneyRow).join(''):'<div class="guidedJourneyEmpty">'+esc(tr('profile_tour.none',{},'Profile tutorials will appear here after you activate a profile.'))+'</div>';
  coach.innerHTML='<div class="guidedMissionCenterHead"><div class="guidedMissionCenterTop"><div><small>'+esc(tr('common.getting_started',{},'GETTING STARTED'))+'</small><h2>'+esc(tr('mission.title',{},'Business & Life tutorials'))+'</h2></div><button type="button" class="guidedLanguageSwitch" data-guide-language-switch aria-label="Change tutorial language">🌐 '+esc(languageSwitchLabel())+'</button></div><p>'+esc(tr('mission.body',{},'Account setup and profile tutorials are saved separately. You can pause and continue later.'))+'</p></div>'+
    '<section class="guidedJourneySection"><div class="guidedJourneySectionHead"><strong>'+esc(tr('mission.account_journey',{},'Account setup'))+'</strong><small>'+esc(guide.status==='completed'?tr('mission.done',{},'Done'):tr('mission.in_progress',{},'In progress'))+'</small></div><div class="guidedMissionList">'+accountRows+'</div></section>'+
    '<section class="guidedJourneySection"><div class="guidedJourneySectionHead"><strong>'+esc(tr('mission.profile_tours',{},'Profile tutorials'))+'</strong><small>'+profiles.length+'</small></div><div class="guidedMissionList">'+profileRows+'</div></section>'+
    '<div class="guidedCoachActions"><button type="button" data-guide-close class="guidedSecondary">'+esc(tr('action.close',{},'Close'))+'</button>'+
    (guide?.status==='paused'?'<button type="button" data-guide-resume class="guidedPrimary">'+esc(tr('action.resume',{},'Resume account tutorial'))+'</button>':guide?.status!=='completed'?'<button type="button" data-guide-pause class="guidedSecondary">'+esc(tr('action.pause',{},'Pause account tutorial'))+'</button>':'')+'</div>';
  root.querySelector('.guidedSpotlight')?.classList.add('hidden');
  coach.querySelector('[data-guide-language-switch]')?.addEventListener('click',()=>{languagePickerReturnMode='mission';missionCenterOpen=false;renderLanguageCoach({returnToCurrent:true})});
  coach.querySelector('[data-guide-close]')?.addEventListener('click',()=>{selectedProfileJourneyRole='';languagePickerReturnMode='';missionCenterOpen=false;removeOverlay()});
  coach.querySelector('[data-guide-pause]')?.addEventListener('click',async()=>{await updateGuide({action:'pause'},{render:false});syncLauncher();renderMissionCenter()});
  coach.querySelector('[data-guide-resume]')?.addEventListener('click',async()=>{await updateGuide({action:'resume'},{render:false});missionCenterOpen=false;renderGuide()});
  coach.querySelectorAll('[data-guide-mission]').forEach(button=>button.onclick=async()=>{
    const step=button.dataset.guideMission;
    if(completedSet().has(step))return;
    if(guide.status==='completed')return;
    if(step!==guide.current_step_id)return;
    missionCenterOpen=false;
    if(step==='language')return renderLanguageCoach();
    if(guide.status==='paused')await updateGuide({action:'resume'},{render:false});
    guide.current_step_id=step;renderGuide();
  });
  coach.querySelectorAll('[data-guide-profile-journey]').forEach(button=>button.onclick=async()=>{
    const role=button.dataset.guideProfileJourney,journey=profileJourney(role);
    if(!journey)return;
    if(journey.status==='completed'){
      await updateGuide({action:'profile_reset',profile_role:role},{render:false});
    }else if(journey.status==='paused'){
      await updateGuide({action:'profile_resume',profile_role:role},{render:false});
    }
    selectedProfileJourneyRole=role;missionCenterOpen=false;renderProfileJourney(role);
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
  if(!ROLE_LABEL_KEYS[role]||!guide?.eligible)return;
  if(guide.status!=='completed')await updateGuide({action:'select_profile',selected_profile_role:role},{render:false}).catch(()=>{});
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
  document.addEventListener('abl:marketplace-checkout-rendered',()=>scheduleRender(100));
  document.addEventListener('abl:guided-onboarding-open-profile',async event=>{
    const role=event.detail?.role;if(!ROLE_LABEL_KEYS[role])return;
    if(!guide)await refreshGuide({render:false}).catch(()=>null);
    const journey=profileJourney(role);if(!journey)return;
    if(journey.status==='completed')await updateGuide({action:'profile_reset',profile_role:role},{render:false});
    else if(journey.status==='paused')await updateGuide({action:'profile_resume',profile_role:role},{render:false});
    selectedProfileJourneyRole=role;missionCenterOpen=false;renderProfileJourney(role);
  });
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
    const profile=activeProfileJourney();
    if((guide.status==='active'&&guide.auto_start_enabled)||(guide.status==='completed'&&profile?.status==='active'&&profile?.auto_start_enabled))setTimeout(()=>renderGuide(),650);
  }catch(error){console.warn('Guided onboarding unavailable:',error.message)}
}
window.BusinessLifeGuidedOnboarding=Object.freeze({
  open:async()=>{if(!guide)await refreshGuide({render:false});missionCenterOpen=true;renderMissionCenter()},
  openProfile:async role=>{
    if(!guide)await refreshGuide({render:false});
    document.dispatchEvent(new CustomEvent('abl:guided-onboarding-open-profile',{detail:{role}}));
  },
  language:async()=>{if(!guide)await refreshGuide({render:false});languagePickerReturnMode='current';missionCenterOpen=false;renderLanguageCoach({returnToCurrent:true})},
  resume:async()=>{await updateGuide({action:'resume'},{render:false});missionCenterOpen=false;renderGuide()},
  reset:async()=>{await updateGuide({action:'reset'},{render:false});missionCenterOpen=true;renderMissionCenter()},
  refresh:()=>refreshGuide()
});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
