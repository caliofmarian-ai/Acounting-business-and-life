const token=()=>localStorage.getItem('abl_token')||'';
const lazyFeatureMode=Boolean(window.__ABL_LAZY_FEATURES__);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,options={}){const headers={'Content-Type':'application/json',...(options.headers||{})};if(token())headers.Authorization=`Bearer ${token()}`;const ctl=options.signal?null:new AbortController();const timer=ctl?setTimeout(()=>ctl.abort(),12000):null;try{const r=await fetch(path,{...options,headers,signal:options.signal||ctl?.signal});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||`Request failed (${r.status})`);return data}catch(e){if(e?.name==='AbortError')throw new Error('The server is taking too long to respond. Close this panel and try again.');throw e}finally{if(timer)clearTimeout(timer)}}
const fileDataUrl=file=>new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=()=>reject(new Error('Could not read '+file.name));r.onload=()=>resolve(String(r.result));r.readAsDataURL(file)});
let pendingAudio=null,voiceRecorder=null,voiceStream=null,voiceRecognition=null,voiceTimer=null,liveTranscript='',adminState=null,adminAccess=null;

function toast(msg){let n=document.getElementById('opsToast');if(!n){n=document.createElement('div');n.id='opsToast';n.className='opsToast';document.body.appendChild(n)}n.textContent=msg;n.classList.add('show');setTimeout(()=>n.classList.remove('show'),3000)}

function ensureUi(){
  if(document.getElementById('supportOpsBackdrop'))return;
  const wrap=document.createElement('div');wrap.id='supportOpsBackdrop';wrap.className='opsBackdrop hidden';
  wrap.innerHTML=`<section class="opsSheet" role="dialog" aria-modal="true"><header><div><small>Business & Life</small><h2 id="opsTitle">Support</h2></div><button class="opsClose" type="button">×</button></header><div id="opsBody"></div></section>`;
  document.body.appendChild(wrap);wrap.addEventListener('click',e=>{if(e.target===wrap)closeOps()});wrap.querySelector('.opsClose').onclick=closeOps;
  addButtons();
}
function addButtons(){
  if(lazyFeatureMode||!token())return;
  const top=document.querySelector('.topActions');
  if(top&&!document.getElementById('supportOpsBtn')){const b=document.createElement('button');b.id='supportOpsBtn';b.className='supportOpsBtn';b.type='button';b.textContent='Help';b.onclick=openSupport;top.prepend(b)}
  if(!document.getElementById('supportFloating')){const b=document.createElement('button');b.id='supportFloating';b.className='supportFloating';b.type='button';b.textContent='?';b.setAttribute('aria-label','Help and Support');b.onclick=openSupport;document.body.appendChild(b)}
  refreshAdminButton().catch(()=>{});
}
async function refreshAdminButton(){
  if(!token())return;const me=await api('/api/admin/me');const top=document.querySelector('.topActions');
  let b=document.getElementById('adminOpsBtn');
  if(me.is_admin&&top&&!b){b=document.createElement('button');b.id='adminOpsBtn';b.className='adminOpsBtn';b.type='button';b.textContent='Admin';b.onclick=openAdmin;top.prepend(b)}
  if(!me.is_admin&&b)b.remove();
}
function openOps(title,html){ensureUi();document.getElementById('opsTitle').textContent=title;document.getElementById('opsBody').innerHTML=html;document.getElementById('supportOpsBackdrop').classList.remove('hidden');document.body.style.overflow='hidden'}
function closeOps(){stopVoice(true);document.getElementById('supportOpsBackdrop')?.classList.add('hidden');document.body.style.overflow=''}
function supportFormHtml(){return `
  <div class="opsTabs"><button class="active" data-tab="new">New issue</button><button data-tab="mine">My tickets</button></div>
  <div id="supportNew">
    <div class="opsNotice"><strong>Send a problem without searching for an email address.</strong><span>Routing is handled privately by the platform according to territory and Admin permissions.</span></div>
    <form id="supportForm" class="opsForm">
      <label>Send to<select id="supportDestination"><option value="support">Support team</option><option value="territory_admin">Local / Territory Admin</option><option value="country_admin">Country administration</option><option value="platform_admin">Platform administration</option></select></label>
      <label>Category<select id="supportCategory"><option value="technical_bug">Technical problem</option><option value="auth">Login / account</option><option value="marketplace_order">Marketplace / order</option><option value="payment">Payment</option><option value="merchant_onboarding">Merchant onboarding</option><option value="supplier_onboarding">Supplier onboarding</option><option value="delivery">Delivery</option><option value="service_provider">Local Services</option><option value="accounting">Accounting</option><option value="tax_documents">Tax / documents guidance</option><option value="other">Other</option></select></label>
      <label>Subject<input id="supportSubject" maxlength="180" required placeholder="Short description of the problem"></label>
      <label>Spoken / written language<select id="supportLanguage"><option value="">Auto / not specified</option><option value="fil-PH">Filipino / Tagalog</option><option value="ceb-PH">Cebuano</option><option value="en-PH">English</option><option value="ro-RO">Romanian</option></select></label>
      <label>Your message<textarea id="supportDescription" rows="7" required minlength="10" placeholder="Describe the problem, or use Voice to text below."></textarea></label>
      <div class="voicePanel">
        <div><strong>Voice to text</strong><small id="voiceStatus">Record up to 90 seconds. The transcript stays editable before sending.</small></div>
        <div class="voiceActions"><button id="voiceStart" type="button">🎙 Start voice</button><button id="voiceStop" type="button" disabled>■ Stop</button><button id="translateEnglish" type="button">Translate to English</button></div>
        <textarea id="englishTranslation" rows="4" placeholder="English translation appears here and remains editable."></textarea>
      </div>
      <label>Evidence<input id="supportFiles" type="file" multiple accept="image/png,image/jpeg,image/webp,.pdf,.doc,.docx,.md,.txt,audio/*"></label>
      <small class="opsHint">Up to 5 images, 3 documents (PDF/Word/Markdown/text) and 1 audio recording. Audio recorded here is attached with its transcript.</small>
      <div id="attachmentPreview" class="attachmentPreview"></div>
      <button class="opsPrimary" type="submit">Send issue</button>
    </form>
  </div>
  <div id="supportMine" class="hidden"><div id="myTickets" class="opsList"><div class="opsLoading">Loading…</div></div></div>`}
async function openSupport(){
  if(!token())return toast('Sign in first to contact Support.');
  pendingAudio=null;liveTranscript='';openOps('Help & Support',supportFormHtml());
  document.querySelectorAll('.opsTabs button').forEach(b=>b.onclick=()=>switchSupportTab(b.dataset.tab,b));
  document.getElementById('supportForm').onsubmit=submitSupport;
  document.getElementById('voiceStart').onclick=startVoice;
  document.getElementById('voiceStop').onclick=()=>stopVoice(false);
  document.getElementById('translateEnglish').onclick=translateEnglish;
  document.getElementById('supportFiles').onchange=renderAttachmentPreview;
}
async function switchSupportTab(tab,btn){document.querySelectorAll('.opsTabs button').forEach(x=>x.classList.toggle('active',x===btn));document.getElementById('supportNew').classList.toggle('hidden',tab!=='new');document.getElementById('supportMine').classList.toggle('hidden',tab!=='mine');if(tab==='mine')await loadMyTickets()}
async function renderAttachmentPreview(){const files=[...(document.getElementById('supportFiles').files||[])];const out=[];for(const f of files)out.push(`<span>${esc(f.name)} <small>${Math.round(f.size/1024)} KB</small></span>`);if(pendingAudio)out.push(`<span>🎙 voice-recording.webm <small>${Math.round(pendingAudio.blob.size/1024)} KB</small></span>`);document.getElementById('attachmentPreview').innerHTML=out.join('')}
async function startVoice(){
  if(voiceRecorder)return;
  try{
    voiceStream=await navigator.mediaDevices.getUserMedia({audio:true});
    const chunks=[];voiceRecorder=new MediaRecorder(voiceStream);voiceRecorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data)};
    voiceRecorder.onstop=()=>{const blob=new Blob(chunks,{type:voiceRecorder?.mimeType||'audio/webm'});pendingAudio={blob,transcript:liveTranscript,language:document.getElementById('supportLanguage').value,english:document.getElementById('englishTranslation').value};renderAttachmentPreview();voiceRecorder=null};
    liveTranscript='';voiceRecorder.start();
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(SR){voiceRecognition=new SR();voiceRecognition.continuous=true;voiceRecognition.interimResults=true;voiceRecognition.lang=document.getElementById('supportLanguage').value||'fil-PH';voiceRecognition.onresult=e=>{let final='',interim='';for(let i=e.resultIndex;i<e.results.length;i++){const t=e.results[i][0]?.transcript||'';if(e.results[i].isFinal)final+=t+' ';else interim+=t}if(final)liveTranscript=(liveTranscript+' '+final).trim();const base=liveTranscript+(interim?' '+interim:'');document.getElementById('supportDescription').value=base;document.getElementById('voiceStatus').textContent='Listening… '+base.slice(-90)};voiceRecognition.onerror=e=>{document.getElementById('voiceStatus').textContent='Speech recognition: '+e.error+'. Audio is still being recorded.'};try{voiceRecognition.start()}catch{}}
    else document.getElementById('voiceStatus').textContent='Live transcription is not supported by this browser. Audio will still be attached.';
    document.getElementById('voiceStart').disabled=true;document.getElementById('voiceStop').disabled=false;
    voiceTimer=setTimeout(()=>stopVoice(false),90000);
  }catch(e){toast(e.message||'Microphone permission is required')}
}
function stopVoice(cancel){
  clearTimeout(voiceTimer);voiceTimer=null;
  if(voiceRecognition){try{voiceRecognition.stop()}catch{}voiceRecognition=null}
  if(voiceRecorder&&voiceRecorder.state!=='inactive'){if(cancel){voiceRecorder.onstop=()=>{voiceRecorder=null}}try{voiceRecorder.stop()}catch{}}
  if(voiceStream){voiceStream.getTracks().forEach(t=>t.stop());voiceStream=null}
  const s=document.getElementById('voiceStart'),p=document.getElementById('voiceStop');if(s)s.disabled=false;if(p)p.disabled=true;
  const v=document.getElementById('voiceStatus');if(v&&!cancel)v.textContent='Voice recording stopped. Review the transcript before sending.';
}
function languageForTranslator(){
  const raw=document.getElementById('supportLanguage').value;
  if(raw.startsWith('fil'))return['fil','tl'];if(raw.startsWith('ceb'))return['ceb'];if(raw.startsWith('ro'))return['ro'];if(raw.startsWith('en'))return['en'];return[];
}
async function detectLanguage(text){
  if(!('LanguageDetector' in self)||text.length<20)return null;
  try{const detector=await LanguageDetector.create();const r=await detector.detect(text);detector.destroy?.();return r?.[0]?.detectedLanguage||null}catch{return null}
}
async function translateEnglish(){
  const text=document.getElementById('supportDescription').value.trim();if(!text)return toast('Add or dictate a message first.');
  if(!('Translator' in self)){toast('Built-in translation is not available in this browser. You can still edit and send the original transcript.');return}
  const candidates=languageForTranslator();const detected=candidates.length?null:await detectLanguage(text);if(detected)candidates.push(detected);if(!candidates.length)candidates.push('fil','tl');
  if(candidates[0]==='en'){document.getElementById('englishTranslation').value=text;return}
  for(const sourceLanguage of candidates){try{const availability=await Translator.availability({sourceLanguage,targetLanguage:'en'});if(availability==='unavailable')continue;const tr=await Translator.create({sourceLanguage,targetLanguage:'en'});const result=await tr.translate(text);tr.destroy?.();document.getElementById('englishTranslation').value=result;toast('English translation ready. Review it before sending.');return}catch{}}
  toast('Automatic English translation is not available for this language on this device yet.');
}
async function submitSupport(e){
  e.preventDefault();const button=e.submitter;button.disabled=true;button.textContent='Sending…';
  try{
    stopVoice(false);await new Promise(r=>setTimeout(r,120));
    const attachments=[];for(const f of [...(document.getElementById('supportFiles').files||[])])attachments.push({file_name:f.name,data_url:await fileDataUrl(f)});
    if(pendingAudio){attachments.push({file_name:'voice-recording.webm',data_url:await blobToDataUrl(pendingAudio.blob),transcript_text:document.getElementById('supportDescription').value,transcript_language:document.getElementById('supportLanguage').value,english_translation:document.getElementById('englishTranslation').value})}
    const t=await api('/api/support/tickets',{method:'POST',body:JSON.stringify({requested_destination:document.getElementById('supportDestination').value,category:document.getElementById('supportCategory').value,subject:document.getElementById('supportSubject').value,description:document.getElementById('supportDescription').value,source_language:document.getElementById('supportLanguage').value,english_translation:document.getElementById('englishTranslation').value,attachments})});
    toast('Support ticket #'+t.id+' sent.');pendingAudio=null;e.target.reset();document.getElementById('attachmentPreview').innerHTML='';
  }catch(err){toast(err.message)}finally{button.disabled=false;button.textContent='Send issue'}
}
const blobToDataUrl=blob=>new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=reject;r.onload=()=>resolve(String(r.result));r.readAsDataURL(blob)});
async function loadMyTickets(){try{const rows=await api('/api/support/tickets/mine');document.getElementById('myTickets').innerHTML=rows.length?rows.map(t=>`<button class="ticketCard" data-ticket="${t.id}"><span><strong>#${t.id} • ${esc(t.subject)}</strong><small>${esc(t.category)} • ${esc(t.requested_destination)} • ${esc(t.status)}</small></span><b>${t.attachment_count||0}</b></button>`).join(''):'<div class="opsEmpty">No support tickets yet.</div>';document.querySelectorAll('[data-ticket]').forEach(b=>b.onclick=()=>openTicket(Number(b.dataset.ticket)))}catch(e){document.getElementById('myTickets').innerHTML=`<div class="opsEmpty">${esc(e.message)}</div>`}}
async function openTicket(id){try{const t=await api('/api/support/tickets/'+id);openOps('Support ticket #'+id,`<div class="ticketDetail"><span class="opsBadge">${esc(t.status)}</span><h3>${esc(t.subject)}</h3><p>${esc(t.description)}</p>${t.english_translation?`<div class="translationBox"><strong>English translation</strong><p>${esc(t.english_translation)}</p></div>`:''}<h4>Attachments</h4><div class="opsList">${(t.attachments||[]).map(a=>`<button data-attachment="${a.id}" class="attachmentRow">${esc(a.file_name)} <small>${esc(a.kind)}</small></button>`).join('')||'<small>None</small>'}</div><h4>Conversation</h4>${(t.messages||[]).map(m=>`<div class="supportMessage"><strong>${esc(m.actor_name)}</strong><p>${esc(m.message)}</p></div>`).join('')}</div>`);document.querySelectorAll('[data-attachment]').forEach(b=>b.onclick=()=>downloadAttachment(id,Number(b.dataset.attachment)))}catch(e){toast(e.message)}}
async function downloadAttachment(ticketId,id){try{const a=await api(`/api/support/tickets/${ticketId}/attachments/${id}`);const link=document.createElement('a');link.href=a.data_url;link.download=a.file_name||'attachment';link.click()}catch(e){toast(e.message)}}

async function openAdmin(){
  if(!token())return;openOps('Admin Operations','<div class="opsLoading">Loading Admin dashboard…</div>');
  try{adminAccess=await api('/api/admin/me');adminState=await api('/api/admin/overview');const auditAllowed=adminAccess.permissions.includes('audit.view'),adminManage=adminAccess.permissions.includes('admin.assign_limited')||adminAccess.permissions.includes('admin.delegate')||adminAccess.assignments?.some(a=>a.admin_role==='super_admin');document.getElementById('opsBody').innerHTML=`
    <div class="adminHero"><small>Scoped administration</small><h3>Philippines operations</h3><p>Only data inside your current country/territory permissions is shown.</p></div>
    <div class="adminMetrics"><div><strong>${adminState.summary.orders}</strong><span>Orders</span></div><div><strong>${adminState.summary.deliveries}</strong><span>Deliveries</span></div><div><strong>${adminState.summary.support.open}</strong><span>Support open</span></div><div><strong>${adminState.summary.incidents.open}</strong><span>Incidents open</span></div></div>
    <div class="opsTabs"><button class="active" data-admin-tab="applications">Applications</button><button data-admin-tab="support">Support</button><button data-admin-tab="incidents">Incidents</button>${adminManage?'<button data-admin-tab="admins">Admins</button>':''}${auditAllowed?'<button data-admin-tab="audit">Audit</button>':''}</div>
    <div id="adminPanel"></div>`;document.querySelectorAll('[data-admin-tab]').forEach(b=>b.onclick=()=>renderAdminTab(b.dataset.adminTab,b));renderAdminTab('applications',document.querySelector('[data-admin-tab="applications"]'));
  }catch(e){document.getElementById('opsBody').innerHTML=`<div class="opsEmpty">${esc(e.message)}</div>`}
}
async function renderAdminTab(tab,btn){document.querySelectorAll('[data-admin-tab]').forEach(x=>x.classList.toggle('active',x===btn));const p=document.getElementById('adminPanel');if(tab==='applications'){p.innerHTML=(adminState.applications||[]).slice(0,80).map(a=>`<div class="adminRow"><span><strong>${esc(a.display_name)} • ${esc(a.role)}</strong><small>${esc(a.territory_name)} • ${esc(a.status)}</small></span><b>#${a.id}</b></div>`).join('')||'<div class="opsEmpty">No applications.</div>';return}
  if(tab==='support'){const rows=await api('/api/admin/support');p.innerHTML=rows.map(t=>`<div class="adminRow"><span><strong>#${t.id} • ${esc(t.subject)}</strong><small>${esc(t.requested_destination)} • ${esc(t.priority)} • ${esc(t.status)} • ${t.attachment_count||0} files</small></span></div>`).join('')||'<div class="opsEmpty">Support queue is empty.</div>';return}
  if(tab==='incidents'){const rows=await api('/api/admin/incidents');p.innerHTML=rows.map(t=>`<div class="adminRow"><span><strong>#${t.id} • ${esc(t.category)}</strong><small>${esc(t.status)} • ${esc(t.reporter_name)}</small></span></div>`).join('')||'<div class="opsEmpty">Incident queue is empty.</div>';return}
  if(tab==='admins'){const rows=await api('/api/admin/assignments');const territories=(adminState.territories||[]).map(t=>`<option value="${t.id}">${esc(t.name)} • ${esc(t.territory_type)}</option>`).join('');const delegated=(adminAccess.permissions||[]).filter(x=>!['admin.console'].includes(x));p.innerHTML=`
    <form id="adminAssignForm" class="opsForm adminAssignForm">
      <h4>Delegate administration</h4>
      <label>Existing account email<input id="adminTargetEmail" type="email" required placeholder="person@example.com"></label>
      <label>Role<select id="adminTargetRole"><option value="territory_admin">Territory Admin</option><option value="country_admin">Country Admin (Super Admin only)</option></select></label>
      <label>Territory<select id="adminTargetTerritory"><option value="">Choose territory</option>${territories}</select></label>
      <div class="permissionGrid">${delegated.map(x=>`<label><input type="checkbox" name="adminPermission" value="${esc(x)}"> ${esc(x)}</label>`).join('')}</div>
      <label>Reason<input id="adminAssignReason" maxlength="500" placeholder="Why this authority is being delegated"></label>
      <button class="opsPrimary" type="submit">Create / update assignment</button>
    </form>
    <h4>Admin assignments</h4>
    <div class="opsList">${rows.map(a=>`<div class="adminRow"><span><strong>${esc(a.display_name)} • ${esc(a.admin_role)}</strong><small>${esc(a.territory_name||a.country_code)} • ${esc(a.status)}</small><small>${esc((a.permissions||[]).join(', ')||'Protected Super Admin authority')}</small></span><b>#${a.id}</b></div>`).join('')||'<div class="opsEmpty">No delegated Admins.</div>'}</div>`;document.getElementById('adminAssignForm').onsubmit=createAdminAssignment;return}
  if(tab==='audit'){const rows=await api('/api/admin/audit');p.innerHTML=rows.map(x=>`<div class="adminRow"><span><strong>${esc(x.event_code)}</strong><small>${esc(x.actor_name||'System')} • ${new Date(x.created_at).toLocaleString()}</small></span></div>`).join('')||'<div class="opsEmpty">No Admin audit events.</div>'}
}
async function createAdminAssignment(e){
  e.preventDefault();const role=document.getElementById('adminTargetRole').value,territory=document.getElementById('adminTargetTerritory').value,permissions=[...document.querySelectorAll('input[name="adminPermission"]:checked')].map(x=>x.value);try{await api('/api/admin/assignments',{method:'POST',body:JSON.stringify({target_email:document.getElementById('adminTargetEmail').value,admin_role:role,territory_id:role==='territory_admin'?Number(territory)||null:null,permissions,reason:document.getElementById('adminAssignReason').value})});toast('Admin assignment saved.');const b=document.querySelector('[data-admin-tab="admins"]');await renderAdminTab('admins',b)}catch(err){toast(err.message)}
}

window.BusinessLifeAdminOps=Object.freeze({openSupport,openAdmin,closeOps});
function boot(){ensureUi();if(lazyFeatureMode)return;addButtons();document.addEventListener('abl:profile-state',()=>addButtons());window.addEventListener('focus',()=>refreshAdminButton().catch(()=>{}),{passive:true})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
