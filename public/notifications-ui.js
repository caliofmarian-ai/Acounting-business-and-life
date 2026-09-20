const token=()=>localStorage.getItem('abl_token')||'';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,options={}){const headers={'Content-Type':'application/json',...(options.headers||{})};if(token())headers.Authorization=`Bearer ${token()}`;const r=await fetch(path,{...options,headers});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||`Request failed (${r.status})`);return data}
let notificationPanel=null,pollTimer=null,voicePollTimer=null,currentNotificationAudio=null;
let foregroundVoiceReady=false,foregroundVoiceToken='',lastForegroundEventId=null,foregroundSoundEnabled=true,audioUserInteracted=false;

function toast(msg){let n=document.getElementById('notificationToast');if(!n){n=document.createElement('div');n.id='notificationToast';n.className='notificationToast';document.body.appendChild(n)}n.textContent=msg;n.classList.add('show');setTimeout(()=>n.classList.remove('show'),2600)}
function ensureNotificationUi(){
  if(!document.getElementById('notificationBackdrop')){const wrap=document.createElement('div');wrap.id='notificationBackdrop';wrap.className='notificationBackdrop hidden';wrap.innerHTML=`<section class="notificationSheet" role="dialog" aria-modal="true"><header><div><small>Business & Life</small><h2>Notifications</h2></div><button class="notificationClose" type="button">×</button></header><div id="notificationBody"></div></section>`;document.body.appendChild(wrap);wrap.querySelector('.notificationClose').onclick=closeNotifications;wrap.addEventListener('click',e=>{if(e.target===wrap)closeNotifications()})}
  addBell();
}
function addBell(){
  const top=document.querySelector('.topActions');if(!top||!token())return;
  let b=document.getElementById('notificationBell');
  if(!b){b=document.createElement('button');b.id='notificationBell';b.className='notificationBell';b.type='button';b.innerHTML='<span aria-hidden="true">🔔</span><b id="notificationBadge" class="hidden">0</b>';b.setAttribute('aria-label','Notifications');b.onclick=openNotifications;top.prepend(b)}
}
async function refreshUnread(){if(!token())return;try{addBell();const x=await api('/api/notifications/unread-count');const badge=document.getElementById('notificationBadge');if(!badge)return;badge.textContent=String(x.unread||0);badge.classList.toggle('hidden',!x.unread)}catch{}}
function closeNotifications(){document.getElementById('notificationBackdrop')?.classList.add('hidden');document.body.style.overflow=''}
async function openNotifications(){ensureNotificationUi();document.getElementById('notificationBackdrop').classList.remove('hidden');document.body.style.overflow='hidden';await renderNotificationCenter()}
function iconFor(code){if(code.startsWith('order.'))return'🛍️';if(code.startsWith('delivery.'))return'🛵';if(code.startsWith('procurement.')||code.startsWith('supplier.'))return'📦';if(code.startsWith('service.'))return'🧰';if(code.startsWith('support.'))return'💬';if(code.startsWith('incident.'))return'🛡️';if(code.startsWith('profile.'))return'👤';return'🔔'}
function timeAgo(value){const ms=Date.now()-new Date(value).getTime(),m=Math.floor(ms/60000);if(m<1)return'now';if(m<60)return`${m}m`;const h=Math.floor(m/60);if(h<24)return`${h}h`;return`${Math.floor(h/24)}d`}
async function renderNotificationCenter(){
  const body=document.getElementById('notificationBody');body.innerHTML='<div class="notificationLoading">Loading…</div>';
  try{
    const [rows,prefs]=await Promise.all([api('/api/notifications?limit=80'),api('/api/notifications/preferences')]);
    notificationPanel={rows,prefs};
    body.innerHTML=`
      <div class="notificationTabs"><button class="active" data-ntab="inbox">Inbox <span>${rows.filter(x=>!x.read_at).length}</span></button><button data-ntab="settings">Settings</button></div>
      <section id="notificationInbox">
        <div class="notificationToolbar"><button id="markAllRead" type="button">Mark all read</button><button id="refreshNotifications" type="button">Refresh</button></div>
        <div id="notificationList" class="notificationList"></div>
      </section>
      <section id="notificationSettings" class="hidden"></section>`;
    document.querySelectorAll('[data-ntab]').forEach(b=>b.onclick=()=>switchNotificationTab(b.dataset.ntab,b));
    document.getElementById('markAllRead').onclick=async()=>{await api('/api/notifications/read-all',{method:'POST',body:'{}'});await renderNotificationCenter();await refreshUnread()};
    document.getElementById('refreshNotifications').onclick=renderNotificationCenter;
    renderNotificationList(rows);renderSettings(prefs);
  }catch(e){body.innerHTML=`<div class="notificationEmpty">${esc(e.message)}</div>`}
}
function renderNotificationList(rows){
  const box=document.getElementById('notificationList');if(!box)return;
  if(!rows.length){box.innerHTML='<div class="notificationEmpty">No notifications yet.</div>';return}
  box.innerHTML=rows.map(n=>`<article class="notificationCard ${n.read_at?'read':'unread'}" data-notification="${n.recipient_id}">
    <div class="notificationIcon">${iconFor(n.event_code)}</div>
    <div class="notificationCopy"><div><strong>${esc(n.title)}</strong><time>${timeAgo(n.created_at)}</time></div><p>${esc(n.body)}</p><small>${esc(n.category)} • ${esc(n.priority)}</small></div>
    <button class="notificationDismiss" data-dismiss="${n.recipient_id}" type="button" aria-label="Dismiss">×</button>
  </article>`).join('');
  box.querySelectorAll('[data-notification]').forEach(card=>card.onclick=async e=>{if(e.target.closest('[data-dismiss]'))return;const id=Number(card.dataset.notification),n=rows.find(x=>Number(x.recipient_id)===id);if(card.classList.contains('unread')){await api(`/api/notifications/${id}/read`,{method:'PATCH',body:'{}'}).catch(()=>{});card.classList.remove('unread');card.classList.add('read');await refreshUnread()}if(n?.entity_type==='support_ticket'&&n.entity_id){const ticketId=Number(n.entity_id);try{if(window.BusinessLifeFeatureLoader?.openSupportTicket)await window.BusinessLifeFeatureLoader.openSupportTicket(ticketId);else if(window.BusinessLifeAdminOps?.openTicket)await window.BusinessLifeAdminOps.openTicket(ticketId);else{window.__ABL_LAZY_FEATURES__=true;await import('/admin-operations-ui.js');await window.BusinessLifeAdminOps.openTicket(ticketId)}closeNotifications()}catch(err){toast(err.message||'Could not open this support ticket.')}}});
  box.querySelectorAll('[data-dismiss]').forEach(b=>b.onclick=async e=>{e.stopPropagation();await api(`/api/notifications/${b.dataset.dismiss}`,{method:'DELETE'});b.closest('.notificationCard')?.remove();await refreshUnread()});
}
function switchNotificationTab(tab,btn){document.querySelectorAll('[data-ntab]').forEach(x=>x.classList.toggle('active',x===btn));document.getElementById('notificationInbox').classList.toggle('hidden',tab!=='inbox');document.getElementById('notificationSettings').classList.toggle('hidden',tab!=='settings')}
function prefFor(category){return notificationPanel?.prefs?.preferences?.find(x=>x.category===category&&x.profile_role==='')||null}
function renderSettings(p){
  const box=document.getElementById('notificationSettings');if(!box)return;
  const labels={operational:'Orders, delivery & business',security:'Security & account',legal:'Legal notices',support:'Support & incidents',compliance:'Compliance',marketing:'Offers & marketing'};
  const attention=p.attention_preferences||{sound_enabled:true,vibration_enabled:true,important_alerts_enabled:true};
  const soundVariants=p.sound_variants||[];
  const soundSlots=p.sound_slots||[];
  const soundPreferences=p.sound_preferences||{};
  const voiceTranscripts=p.voice_transcripts||{};
  const plannedVoiceTranscripts=p.planned_voice_transcripts||{};
  const selectedVoiceVariant=slotId=>Number(soundPreferences[slotId]||p.default_sound_variant||2);
  const voiceTranscript=(slotId,variant)=>voiceTranscripts?.[slotId]?.[variant]||'';
  const plannedVoiceTranscript=(slotId,variant)=>plannedVoiceTranscripts?.[slotId]?.[variant]||'';
  const localeFallback=p.preferred_locale==='fil-PH'&&p.voice_audio_locale!=='fil-PH';
  box.innerHTML=`
    <div class="notificationSettingCard"><label>Notification language<select id="notificationLocale"><option value="en-PH" ${p.preferred_locale==='en-PH'?'selected':''}>English (Philippines)</option><option value="fil-PH" ${p.preferred_locale==='fil-PH'?'selected':''}>Filipino / Tagalog</option></select></label></div>
    <div class="notificationSettingCard"><div class="pushHeader"><span><strong>Attention</strong><small>Control how Business & Life gets your attention. Background push sound is controlled by your phone/browser; the Sounds switch applies to branded in-app sounds.</small></span></div><div class="preferenceGrid"><div class="preferenceRow"><div><strong>Sounds</strong><small>Branded sounds while the app is open.</small></div><label><input id="notificationSounds" type="checkbox" ${attention.sound_enabled?'checked':''}> On</label></div><div class="preferenceRow"><div><strong>Vibration</strong><small>Use supported vibration patterns for push alerts.</small></div><label><input id="notificationVibration" type="checkbox" ${attention.vibration_enabled?'checked':''}> On</label></div><div class="preferenceRow"><div><strong>Important alerts</strong><small>Keep urgent alerts more prominent when the browser supports it.</small></div><label><input id="notificationImportantAlerts" type="checkbox" ${attention.important_alerts_enabled?'checked':''}> On</label></div></div></div>
    <div class="notificationSettingCard"><div class="pushHeader"><span><strong>Notification voice</strong><small>Set 2 is the Business & Life default. Choose Set 1 or Set 3 separately for any notification type.</small>${localeFallback?'<small class="voiceLocaleNotice">Filipino / Tagalog voice copy is prepared. Until that audio pack is generated, ▶ Listen and live spoken alerts use the English voice fallback.</small>':''}</span></div><div class="preferenceGrid">${soundSlots.map(slot=>{const selected=selectedVoiceVariant(slot.id);return`<div class="preferenceRow soundPreferenceRow"><div><strong>${esc(slot.label)}</strong><small>${esc(slot.description||'')}</small><small class="voiceTranscript" data-voice-transcript="${esc(slot.id)}">“${esc(voiceTranscript(slot.id,selected))}”</small>${localeFallback?`<small class="voicePlannedTranscript" data-planned-voice-transcript="${esc(slot.id)}">Filipino planned: “${esc(plannedVoiceTranscript(slot.id,selected))}”</small>`:''}</div><div class="soundChoiceControls"><select data-sound-slot="${esc(slot.id)}" aria-label="${esc(slot.label)} voice">${soundVariants.map(v=>`<option value="${v.id}" ${selected===Number(v.id)?'selected':''}>${esc(v.label)}${v.isDefault?' (default)':''}</option>`).join('')}</select><button type="button" class="soundPreviewButton" data-preview-sound="${esc(slot.id)}" ${p.audio_configured?'':'disabled'}>▶ Listen</button></div></div>`}).join('')}</div></div>
    <div class="notificationSettingCard"><div class="pushHeader"><span><strong>Web Push</strong><small>Receive important updates even when the app is not open.</small></span><button id="enablePush" type="button">${p.push_configured?'Enable push':'Push not configured'}</button></div></div>
    <div class="preferenceGrid">${(p.categories||[]).map(cat=>{const x=prefFor(cat),marketing=cat==='marketing',security=cat==='security';const inapp=x?x.in_app_enabled:!marketing,email=x?x.email_enabled:false,push=x?x.push_enabled:!marketing;return`<div class="preferenceRow" data-category="${cat}"><div><strong>${labels[cat]||cat}</strong><small>${security?'Required security notices cannot be fully disabled.':''}</small></div><label><input type="checkbox" data-channel="in_app" ${inapp?'checked':''} ${security?'disabled':''}> In-app</label><label><input type="checkbox" data-channel="email" ${email?'checked':''}> Email</label><label><input type="checkbox" data-channel="push" ${push?'checked':''}> Push</label></div>`}).join('')}</div>`;
  document.getElementById('notificationLocale').onchange=async e=>{try{await api('/api/notifications/locale',{method:'PUT',body:JSON.stringify({locale:e.target.value})});const refreshed=await api('/api/notifications/preferences');notificationPanel.prefs=refreshed;renderSettings(refreshed);toast('Notification language updated.')}catch(err){toast(err.message);}};
  document.getElementById('enablePush').onclick=enablePush;
  for(const id of ['notificationSounds','notificationVibration','notificationImportantAlerts'])document.getElementById(id).onchange=saveAttentionPreferences;
  box.querySelectorAll('[data-sound-slot]').forEach(select=>select.onchange=saveSoundPreference);
  box.querySelectorAll('[data-preview-sound]').forEach(button=>button.onclick=previewNotificationVoice);
  box.querySelectorAll('.preferenceRow[data-category] input').forEach(input=>input.onchange=savePreferenceRow);
}
async function saveAttentionPreferences(){
  try{
    const soundEnabled=Boolean(document.getElementById('notificationSounds')?.checked);
    await api('/api/notifications/attention-preferences',{method:'PUT',body:JSON.stringify({
      sound_enabled:soundEnabled,
      vibration_enabled:Boolean(document.getElementById('notificationVibration')?.checked),
      important_alerts_enabled:Boolean(document.getElementById('notificationImportantAlerts')?.checked)
    })});
    foregroundSoundEnabled=soundEnabled;
    toast('Attention settings saved.');
  }catch(err){toast(err.message);await renderNotificationCenter()}
}
async function notificationAudioUrl(soundSlot,variant){
  const params=new URLSearchParams({sound_slot:String(soundSlot||''),variant:String(Number(variant)||2)});
  return api(`/api/notifications/audio-url?${params.toString()}`);
}
async function playNotificationVoice(soundSlot,variant,{quiet=false}={}){
  if(!soundSlot)return false;
  try{
    const data=await notificationAudioUrl(soundSlot,variant);
    currentNotificationAudio?.pause?.();
    const audio=new Audio(data.url);
    audio.preload='auto';
    currentNotificationAudio=audio;
    await audio.play();
    return true;
  }catch(err){
    if(!quiet)toast(err.message||'Could not play this notification voice.');
    return false;
  }
}
async function previewNotificationVoice(e){
  audioUserInteracted=true;
  const button=e.currentTarget,soundSlot=button.dataset.previewSound;
  const select=document.querySelector(`[data-sound-slot="${soundSlot}"]`);
  if(!select)return;
  const old=button.textContent;button.disabled=true;button.textContent='Playing…';
  try{await playNotificationVoice(soundSlot,Number(select.value));}
  finally{button.disabled=false;button.textContent=old}
}
function updateVoiceTranscript(soundSlot,variant){
  const prefs=notificationPanel?.prefs||{};
  const spoken=prefs.voice_transcripts?.[soundSlot]?.[variant]||'';
  const planned=prefs.planned_voice_transcripts?.[soundSlot]?.[variant]||'';
  const spokenEl=document.querySelector(`[data-voice-transcript="${soundSlot}"]`);
  const plannedEl=document.querySelector(`[data-planned-voice-transcript="${soundSlot}"]`);
  if(spokenEl)spokenEl.textContent=`“${spoken}”`;
  if(plannedEl)plannedEl.textContent=`Filipino planned: “${planned}”`;
}
async function saveSoundPreference(e){
  const soundSlot=e.target.dataset.soundSlot,variant=Number(e.target.value);
  updateVoiceTranscript(soundSlot,variant);
  try{
    await api('/api/notifications/sound-preference',{method:'PUT',body:JSON.stringify({sound_slot:soundSlot,variant})});
    if(notificationPanel?.prefs?.sound_preferences)notificationPanel.prefs.sound_preferences[soundSlot]=variant;
    toast('Notification voice saved.');
  }catch(err){toast(err.message);await renderNotificationCenter()}
}
async function savePreferenceRow(e){
  const row=e.target.closest('.preferenceRow'),cat=row.dataset.category;
  const value=ch=>Boolean(row.querySelector(`[data-channel="${ch}"]`)?.checked);
  try{await api('/api/notifications/preferences',{method:'PUT',body:JSON.stringify({category:cat,profile_role:'',in_app_enabled:value('in_app'),email_enabled:value('email'),push_enabled:value('push')})});toast('Preference saved.')}catch(err){toast(err.message);await renderNotificationCenter()}
}
function urlBase64ToUint8Array(base64String){const padding='='.repeat((4-base64String.length%4)%4),base64=(base64String+padding).replace(/-/g,'+').replace(/_/g,'/'),raw=atob(base64);return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)))}
async function enablePush(){
  try{
    const cfg=await api('/api/notifications/push/config');if(!cfg.enabled||!cfg.public_key)throw new Error('Web Push is not configured on this environment yet.');
    if(!('serviceWorker'in navigator)||!('PushManager'in window))throw new Error('Web Push is not supported by this browser.');
    const permission=await Notification.requestPermission();if(permission!=='granted')throw new Error('Notification permission was not granted.');
    const reg=await navigator.serviceWorker.register('/notifications-sw.js',{scope:'/'});
    let sub=await reg.pushManager.getSubscription();if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(cfg.public_key)});
    await api('/api/notifications/push/subscribe',{method:'POST',body:JSON.stringify(sub.toJSON())});
    toast('Web Push enabled on this device.');
  }catch(e){toast(e.message)}
}
async function primeForegroundVoice(){
  const activeToken=token();
  if(!activeToken){foregroundVoiceReady=false;foregroundVoiceToken='';lastForegroundEventId=null;return}
  try{
    const [rows,prefs]=await Promise.all([api('/api/notifications?limit=1'),api('/api/notifications/preferences')]);
    foregroundVoiceToken=activeToken;
    lastForegroundEventId=rows[0]?.event_id??null;
    foregroundSoundEnabled=prefs.attention_preferences?.sound_enabled!==false;
    foregroundVoiceReady=true;
  }catch{}
}
async function pollForegroundVoice(){
  const activeToken=token();
  if(!activeToken||document.hidden)return;
  if(!foregroundVoiceReady||foregroundVoiceToken!==activeToken){await primeForegroundVoice();return}
  try{
    const rows=await api('/api/notifications?limit=5');
    const latest=rows[0];
    if(!latest)return;
    const previous=lastForegroundEventId==null?'':String(lastForegroundEventId);
    const latestId=String(latest.event_id??'');
    if(latestId===previous)return;
    const fresh=[];
    for(const row of rows){if(previous&&String(row.event_id??'')===previous)break;fresh.push(row)}
    lastForegroundEventId=latest.event_id;
    await refreshUnread();
    if(!foregroundSoundEnabled||!audioUserInteracted)return;
    const candidate=fresh.find(row=>!row.read_at&&row.attention?.soundSlot&&!row.attention?.silent);
    if(!candidate)return;
    await playNotificationVoice(candidate.attention.soundSlot,Number(candidate.attention.soundVariant)||2,{quiet:true});
  }catch{}
}
function noteAudioInteraction(){audioUserInteracted=true}
function boot(){
  ensureNotificationUi();addBell();refreshUnread();primeForegroundVoice();
  pollTimer=setInterval(()=>{if(!document.hidden)refreshUnread()},60000);
  voicePollTimer=setInterval(pollForegroundVoice,10000);
  document.addEventListener('pointerdown',noteAudioInteraction,{passive:true});
  document.addEventListener('keydown',noteAudioInteraction);
  document.addEventListener('abl:profile-state',()=>{addBell();if(foregroundVoiceToken!==token()){foregroundVoiceReady=false;primeForegroundVoice()}});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){refreshUnread();pollForegroundVoice()}});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
