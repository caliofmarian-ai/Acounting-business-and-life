const token=()=>localStorage.getItem('abl_token')||'';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,options={}){const headers={'Content-Type':'application/json',...(options.headers||{})};if(token())headers.Authorization=`Bearer ${token()}`;const r=await fetch(path,{...options,headers});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||`Request failed (${r.status})`);return data}
let notificationPanel=null,pollTimer=null;

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
  box.querySelectorAll('[data-notification]').forEach(card=>card.onclick=async e=>{if(e.target.closest('[data-dismiss]'))return;const id=Number(card.dataset.notification);if(card.classList.contains('unread')){await api(`/api/notifications/${id}/read`,{method:'PATCH',body:'{}'}).catch(()=>{});card.classList.remove('unread');card.classList.add('read');await refreshUnread()}});
  box.querySelectorAll('[data-dismiss]').forEach(b=>b.onclick=async e=>{e.stopPropagation();await api(`/api/notifications/${b.dataset.dismiss}`,{method:'DELETE'});b.closest('.notificationCard')?.remove();await refreshUnread()});
}
function switchNotificationTab(tab,btn){document.querySelectorAll('[data-ntab]').forEach(x=>x.classList.toggle('active',x===btn));document.getElementById('notificationInbox').classList.toggle('hidden',tab!=='inbox');document.getElementById('notificationSettings').classList.toggle('hidden',tab!=='settings')}
function prefFor(category){return notificationPanel?.prefs?.preferences?.find(x=>x.category===category&&x.profile_role==='')||null}
function renderSettings(p){
  const box=document.getElementById('notificationSettings');if(!box)return;
  const labels={operational:'Orders, delivery & business',security:'Security & account',legal:'Legal notices',support:'Support & incidents',compliance:'Compliance',marketing:'Offers & marketing'};
  box.innerHTML=`
    <div class="notificationSettingCard"><label>Notification language<select id="notificationLocale"><option value="en-PH" ${p.preferred_locale==='en-PH'?'selected':''}>English (Philippines)</option><option value="fil-PH" ${p.preferred_locale==='fil-PH'?'selected':''}>Filipino / Tagalog</option></select></label></div>
    <div class="notificationSettingCard"><div class="pushHeader"><span><strong>Web Push</strong><small>Receive important updates even when the app is not open.</small></span><button id="enablePush" type="button">${p.push_configured?'Enable push':'Push not configured'}</button></div></div>
    <div class="preferenceGrid">${(p.categories||[]).map(cat=>{const x=prefFor(cat),marketing=cat==='marketing',security=cat==='security';const inapp=x?x.in_app_enabled:!marketing,email=x?x.email_enabled:false,push=x?x.push_enabled:!marketing;return`<div class="preferenceRow" data-category="${cat}"><div><strong>${labels[cat]||cat}</strong><small>${security?'Required security notices cannot be fully disabled.':''}</small></div><label><input type="checkbox" data-channel="in_app" ${inapp?'checked':''} ${security?'disabled':''}> In-app</label><label><input type="checkbox" data-channel="email" ${email?'checked':''}> Email</label><label><input type="checkbox" data-channel="push" ${push?'checked':''}> Push</label></div>`}).join('')}</div>`;
  document.getElementById('notificationLocale').onchange=async e=>{await api('/api/notifications/locale',{method:'PUT',body:JSON.stringify({locale:e.target.value})});toast('Notification language updated.')};
  document.getElementById('enablePush').onclick=enablePush;
  box.querySelectorAll('.preferenceRow input').forEach(input=>input.onchange=savePreferenceRow);
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
function boot(){ensureNotificationUi();refreshUnread();pollTimer=setInterval(refreshUnread,30000);const shell=document.getElementById('shell');if(shell)new MutationObserver(()=>{addBell()}).observe(shell,{childList:true,subtree:true,attributes:true})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
