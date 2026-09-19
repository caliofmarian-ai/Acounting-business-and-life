const token=()=>localStorage.getItem('abl_token')||'';
const lazyFeatureMode=Boolean(window.__ABL_LAZY_FEATURES__);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,options={}){const headers={'Content-Type':'application/json',...(options.headers||{})};if(token())headers.Authorization=`Bearer ${token()}`;const ctl=options.signal?null:new AbortController();const timer=ctl?setTimeout(()=>ctl.abort(),12000):null;try{const r=await fetch(path,{...options,headers,signal:options.signal||ctl?.signal});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||`Request failed (${r.status})`);return data}catch(e){if(e?.name==='AbortError')throw new Error('The server is taking too long to respond. Close this panel and try again.');throw e}finally{if(timer)clearTimeout(timer)}}
const fileDataUrl=file=>new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=()=>reject(new Error('Could not read '+file.name));r.onload=()=>resolve(String(r.result));r.readAsDataURL(file)});
let pendingAudio=null,voiceRecorder=null,voiceStream=null,voiceRecognition=null,voiceTimer=null,liveTranscript='',voiceBaseText='',voiceProcessing=false,supportAssistStatus=null,adminState=null,adminAccess=null;
const PRIVACY_SUPPORT_CATEGORIES=new Set(['privacy_objection','privacy_access','privacy_correction','privacy_erasure_blocking','privacy_other_request']);

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
}
function openOps(title,html){ensureUi();document.getElementById('opsTitle').textContent=title;document.getElementById('opsBody').innerHTML=html;document.getElementById('supportOpsBackdrop').classList.remove('hidden');document.body.style.overflow='hidden'}
function closeOps(){stopVoice(true);document.getElementById('supportOpsBackdrop')?.classList.add('hidden');document.body.style.overflow=''}
function supportFormHtml(){return `
  <div class="opsTabs"><button class="active" data-tab="new">New issue</button><button data-tab="mine">My tickets</button></div>
  <div id="supportNew">
    <div class="opsNotice"><strong>Send a problem without searching for an email address.</strong><span>Routing is handled privately by the platform according to territory and Admin permissions.</span></div>
    <form id="supportForm" class="opsForm">
      <label>Send to<select id="supportDestination"><option value="support">Support team</option><option value="territory_admin">Local / Territory Admin</option><option value="country_admin">Country administration</option><option value="platform_admin">Platform administration</option></select></label>
      <label>Category<select id="supportCategory"><option value="technical_bug">Technical problem</option><option value="auth">Login / account</option><option value="marketplace_order">Marketplace / order</option><option value="payment">Payment</option><option value="merchant_onboarding">Merchant onboarding</option><option value="supplier_onboarding">Supplier onboarding</option><option value="delivery">Delivery</option><option value="service_provider">Local Services</option><option value="accounting">Accounting</option><option value="tax_documents">Tax / documents guidance</option><optgroup label="Privacy & data rights"><option value="privacy_objection">Object to data processing / referral analytics</option><option value="privacy_access">Request access to my personal data</option><option value="privacy_correction">Request correction of personal data</option><option value="privacy_erasure_blocking">Request erasure / blocking review</option><option value="privacy_other_request">Other privacy request</option></optgroup><option value="other">Other</option></select></label>
      <div id="supportPrivacyNotice" class="opsNotice hidden"><strong>Privacy-rights request</strong><span>This request is routed to country-level privacy review, not a local Territory Admin. Signing in supplies your initial account identity; do not upload identity documents unless the reviewing team specifically asks for necessary verification. A request is reviewed under applicable rights and lawful exceptions — submission does not automatically guarantee deletion.</span></div>
      <label>Subject<input id="supportSubject" maxlength="180" required placeholder="Short description of the problem"></label>
      <label>Spoken / written language<select id="supportLanguage"><option value="">Auto detect</option><option value="fil-PH">Filipino / Tagalog</option><option value="ceb-PH">Cebuano</option><option value="en-PH">English</option><option value="ro-RO">Romanian</option></select></label>
      <div class="supportComposer">
        <div class="supportComposerHead"><div><strong>Your message</strong><small>Type normally or tap the microphone and speak. The text stays editable.</small></div><span>Original</span></div>
        <textarea id="supportDescription" rows="8" required minlength="10" placeholder="Describe the problem here — or tap 🎙 Speak and dictate it."></textarea>
        <div class="supportComposerTools">
          <button id="voiceStart" type="button">🎙 Speak</button>
          <button id="voiceStop" type="button" disabled>■ Stop</button>
          <button id="translateEnglish" type="button">Translate → English</button>
        </div>
        <small id="voiceStatus">Voice is part of this message. Browser dictation is used when available; server transcription is used when configured.</small><small class="supportAiPrivacy">When server speech/translation is enabled, the recording or message is sent to the configured AI processing provider only to create the transcript/English translation.</small>
      </div>
      <div class="supportTranslationPanel">
        <div class="supportComposerHead"><div><strong>English for Support/Admin</strong><small>The original message is preserved. You can edit this translation before sending.</small></div><span>English</span></div>
        <textarea id="englishTranslation" rows="5" placeholder="English translation appears here."></textarea>
      </div>
      <label>Additional evidence<input id="supportFiles" type="file" multiple accept="image/png,image/jpeg,image/webp,.pdf,.doc,.docx,.md,.txt,audio/*"></label>
      <small class="opsHint">Up to 5 images, 3 documents and 1 audio recording. A voice recording remains attached as evidence, but it is not treated as a substitute for transcription.</small>
      <div id="attachmentPreview" class="attachmentPreview"></div>
      <button class="opsPrimary" type="submit">Send issue</button>
    </form>
  </div>
  <div id="supportMine" class="hidden"><div id="myTickets" class="opsList"><div class="opsLoading">Loading…</div></div></div>`}
async function openSupport(){
  if(!token())return toast('Sign in first to contact Support.');
  pendingAudio=null;liveTranscript='';voiceBaseText='';voiceProcessing=false;supportAssistStatus=null;openOps('Help & Support',supportFormHtml());
  document.querySelectorAll('.opsTabs button').forEach(b=>b.onclick=()=>switchSupportTab(b.dataset.tab,b));
  document.getElementById('supportForm').onsubmit=submitSupport;
  document.getElementById('supportCategory').onchange=syncPrivacySupportRouting;
  syncPrivacySupportRouting();
  document.getElementById('voiceStart').onclick=startVoice;
  document.getElementById('voiceStop').onclick=()=>stopVoice(false);
  document.getElementById('translateEnglish').onclick=()=>translateEnglish(false);
  document.getElementById('supportFiles').onchange=renderAttachmentPreview;
  api('/api/support/assist/status').then(x=>{
    supportAssistStatus=x;
    const v=document.getElementById('voiceStatus');
    if(v)v.textContent=x.server_assist_ready
      ?'Voice transcription and English translation are available. You can still edit both before sending.'
      :'Server speech/translation is not configured in this environment. Browser dictation/translation will be used when the device supports it.';
  }).catch(()=>{});
}
async function switchSupportTab(tab,btn){document.querySelectorAll('.opsTabs button').forEach(x=>x.classList.toggle('active',x===btn));document.getElementById('supportNew').classList.toggle('hidden',tab!=='new');document.getElementById('supportMine').classList.toggle('hidden',tab!=='mine');if(tab==='mine')await loadMyTickets()}
function syncPrivacySupportRouting(){
  const category=document.getElementById('supportCategory');
  const destination=document.getElementById('supportDestination');
  const notice=document.getElementById('supportPrivacyNotice');
  if(!category||!destination)return;
  const privacy=PRIVACY_SUPPORT_CATEGORIES.has(category.value);
  if(privacy){
    destination.value='country_admin';
    destination.disabled=true;
  }else{
    destination.disabled=false;
  }
  notice?.classList.toggle('hidden',!privacy);
}
async function renderAttachmentPreview(){const files=[...(document.getElementById('supportFiles').files||[])];const out=[];for(const f of files)out.push(`<span>${esc(f.name)} <small>${Math.round(f.size/1024)} KB</small></span>`);if(pendingAudio)out.push(`<span>🎙 voice-recording.webm <small>${Math.round(pendingAudio.blob.size/1024)} KB</small></span>`);document.getElementById('attachmentPreview').innerHTML=out.join('')}
async function finalizeVoiceRecording(blob){
  voiceProcessing=true;
  const statusNode=document.getElementById('voiceStatus');
  const sourceLanguage=document.getElementById('supportLanguage')?.value||'';
  const messageNode=document.getElementById('supportDescription');
  const translationNode=document.getElementById('englishTranslation');
  pendingAudio={blob,transcript:liveTranscript,language:sourceLanguage,english:translationNode?.value||''};
  await renderAttachmentPreview();
  if(statusNode)statusNode.textContent='Processing voice…';
  try{
    const dataUrl=await blobToDataUrl(blob);
    const result=await api('/api/support/assist/transcribe',{method:'POST',body:JSON.stringify({data_url:dataUrl,file_name:'voice-recording.webm',source_language:sourceLanguage})});
    const transcript=String(result.transcript||'').trim();
    if(transcript){
      liveTranscript=transcript;
      messageNode.value=[voiceBaseText,transcript].filter(Boolean).join(voiceBaseText?'\n':'');
      pendingAudio.transcript=transcript;
    }
    if(result.english_translation){
      translationNode.value=result.english_translation;
      pendingAudio.english=result.english_translation;
    }
    if(statusNode)statusNode.textContent='Voice transcribed'+(result.english_translation?' and translated to English':'')+'. Review or edit before sending.';
  }catch(err){
    const browserText=String(messageNode?.value||'').trim();
    pendingAudio.transcript=liveTranscript||browserText;
    if(liveTranscript||browserText!==voiceBaseText){
      if(statusNode)statusNode.textContent='Browser transcript is available. Server transcription is unavailable here; review the text before sending.';
      await translateEnglish(true).catch(()=>{});
    }else{
      if(statusNode)statusNode.textContent='Audio was recorded, but automatic transcription is unavailable in this environment. Type the message or enable the server speech provider before sending.';
    }
  }finally{
    pendingAudio.english=translationNode?.value||pendingAudio.english||'';
    voiceProcessing=false;
    await renderAttachmentPreview();
  }
}
async function startVoice(){
  if(voiceRecorder||voiceProcessing)return;
  const statusNode=document.getElementById('voiceStatus');
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){
    if(statusNode)statusNode.textContent='Microphone access is not available in this browser. You can type the message or attach an audio file.';
    return;
  }
  try{
    voiceBaseText=document.getElementById('supportDescription')?.value.trim()||'';
    liveTranscript='';
    voiceStream=await navigator.mediaDevices.getUserMedia({audio:true});
    const chunks=[];
    voiceRecorder=new MediaRecorder(voiceStream);
    voiceRecorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data)};
    voiceRecorder.onstop=async()=>{
      const mime=voiceRecorder?.mimeType||'audio/webm';
      const blob=new Blob(chunks,{type:mime});
      voiceRecorder=null;
      await finalizeVoiceRecording(blob);
    };
    voiceRecorder.start();
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(SR){
      voiceRecognition=new SR();
      voiceRecognition.continuous=true;
      voiceRecognition.interimResults=true;
      voiceRecognition.lang=document.getElementById('supportLanguage').value||navigator.language||'en-PH';
      voiceRecognition.onresult=e=>{
        let final='',interim='';
        for(let i=e.resultIndex;i<e.results.length;i++){
          const t=e.results[i][0]?.transcript||'';
          if(e.results[i].isFinal)final+=t+' ';else interim+=t;
        }
        if(final)liveTranscript=(liveTranscript+' '+final).trim();
        const dictated=(liveTranscript+(interim?' '+interim:'')).trim();
        document.getElementById('supportDescription').value=[voiceBaseText,dictated].filter(Boolean).join(voiceBaseText&&dictated?'\n':'');
        document.getElementById('voiceStatus').textContent='Listening… '+dictated.slice(-100);
      };
      voiceRecognition.onerror=e=>{document.getElementById('voiceStatus').textContent='Live browser transcription: '+e.error+'. Audio is still recording and server transcription will be attempted after Stop.'};
      try{voiceRecognition.start()}catch{}
    }else if(statusNode)statusNode.textContent='Recording… Live browser transcription is unavailable. Server transcription will be attempted after Stop.';
    document.getElementById('voiceStart').disabled=true;
    document.getElementById('voiceStop').disabled=false;
    voiceTimer=setTimeout(()=>stopVoice(false),90000);
  }catch(e){
    const overlayHint=/Android/i.test(navigator.userAgent||'')&&e?.name==='NotAllowedError';
    const message=overlayHint
      ?'Android blocked microphone access. Close screen-recording/floating overlays and try again. You can still type the message or attach audio.'
      :(e?.name==='NotAllowedError'?'Microphone permission was not granted. You can still type the message or attach audio.':(e.message||'Microphone is unavailable. You can still type the message or attach audio.'));
    if(statusNode)statusNode.textContent=message;
    toast(message);
  }
}
function stopVoice(cancel){
  clearTimeout(voiceTimer);voiceTimer=null;
  if(voiceRecognition){try{voiceRecognition.stop()}catch{}voiceRecognition=null}
  if(voiceRecorder&&voiceRecorder.state!=='inactive'){
    if(cancel){voiceRecorder.onstop=()=>{voiceRecorder=null;voiceProcessing=false}}
    else voiceProcessing=true;
    try{voiceRecorder.stop()}catch{voiceProcessing=false}
  }
  if(voiceStream){voiceStream.getTracks().forEach(t=>t.stop());voiceStream=null}
  const s=document.getElementById('voiceStart'),p=document.getElementById('voiceStop');
  if(s)s.disabled=false;if(p)p.disabled=true;
  const v=document.getElementById('voiceStatus');
  if(v&&!cancel&&voiceRecorder)v.textContent='Recording stopped. Processing speech…';
}
function languageForTranslator(){
  const raw=document.getElementById('supportLanguage').value;
  if(raw.startsWith('fil'))return['fil','tl'];if(raw.startsWith('ceb'))return['ceb'];if(raw.startsWith('ro'))return['ro'];if(raw.startsWith('en'))return['en'];return[];
}
async function detectLanguage(text){
  if(!('LanguageDetector' in self)||text.length<20)return null;
  try{const detector=await LanguageDetector.create();const r=await detector.detect(text);detector.destroy?.();return r?.[0]?.detectedLanguage||null}catch{return null}
}
async function translateEnglish(silent=false){
  const text=document.getElementById('supportDescription').value.trim();
  const target=document.getElementById('englishTranslation');
  if(!text){if(!silent)toast('Add or dictate a message first.');return false}
  const sourceLanguage=document.getElementById('supportLanguage').value;
  if(/^en(?:-|$)/i.test(sourceLanguage)){target.value=text;if(pendingAudio)pendingAudio.english=text;return true}
  try{
    const result=await api('/api/support/assist/translate',{method:'POST',body:JSON.stringify({text,source_language:sourceLanguage})});
    if(result.english_translation){
      target.value=result.english_translation;
      if(pendingAudio)pendingAudio.english=result.english_translation;
      if(!silent)toast('English translation ready. Review it before sending.');
      return true;
    }
  }catch{}
  if('Translator' in self){
    const candidates=languageForTranslator();const detected=candidates.length?null:await detectLanguage(text);if(detected)candidates.push(detected);if(!candidates.length)candidates.push('fil','tl','ro');
    for(const sourceLanguageCandidate of candidates){
      try{
        const availability=await Translator.availability({sourceLanguage:sourceLanguageCandidate,targetLanguage:'en'});
        if(availability==='unavailable')continue;
        const tr=await Translator.create({sourceLanguage:sourceLanguageCandidate,targetLanguage:'en'});
        const result=await tr.translate(text);tr.destroy?.();target.value=result;if(pendingAudio)pendingAudio.english=result;
        if(!silent)toast('English translation ready. Review it before sending.');
        return true;
      }catch{}
    }
  }
  if(!silent)toast('Automatic English translation is not configured on the server and is not available on this device.');
  return false;
}
async function waitForVoiceProcessing(){
  for(let i=0;i<100&&voiceProcessing;i++)await new Promise(r=>setTimeout(r,100));
}

async function submitSupport(e){
  e.preventDefault();const button=e.submitter;button.disabled=true;button.textContent='Sending…';
  try{
    stopVoice(false);await waitForVoiceProcessing();
    const attachments=[];for(const f of [...(document.getElementById('supportFiles').files||[])])attachments.push({file_name:f.name,data_url:await fileDataUrl(f)});
    if(pendingAudio){attachments.push({file_name:'voice-recording.webm',data_url:await blobToDataUrl(pendingAudio.blob),transcript_text:pendingAudio.transcript||document.getElementById('supportDescription').value,transcript_language:pendingAudio.language||document.getElementById('supportLanguage').value,english_translation:document.getElementById('englishTranslation').value||pendingAudio.english||''})}
    const selectedCategory=document.getElementById('supportCategory').value;const selectedDestination=PRIVACY_SUPPORT_CATEGORIES.has(selectedCategory)?'country_admin':document.getElementById('supportDestination').value;
    const t=await api('/api/support/tickets',{method:'POST',body:JSON.stringify({requested_destination:selectedDestination,category:selectedCategory,subject:document.getElementById('supportSubject').value,description:document.getElementById('supportDescription').value,source_language:document.getElementById('supportLanguage').value,english_translation:document.getElementById('englishTranslation').value,attachments})});
    toast((PRIVACY_SUPPORT_CATEGORIES.has(t.category)?'Privacy request':'Support ticket')+' #'+t.id+' sent.');pendingAudio=null;e.target.reset();document.getElementById('attachmentPreview').innerHTML='';syncPrivacySupportRouting();
  }catch(err){toast(err.message)}finally{button.disabled=false;button.textContent='Send issue'}
}
const blobToDataUrl=blob=>new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=reject;r.onload=()=>resolve(String(r.result));r.readAsDataURL(blob)});
async function loadMyTickets(){try{const rows=await api('/api/support/tickets/mine');document.getElementById('myTickets').innerHTML=rows.length?rows.map(t=>`<button class="ticketCard" data-ticket="${t.id}"><span><strong>#${t.id} • ${esc(t.subject)}</strong><small>${esc(t.category)} • ${esc(t.requested_destination)} • ${esc(t.status)}</small></span><b>${t.attachment_count||0}</b></button>`).join(''):'<div class="opsEmpty">No support tickets yet.</div>';document.querySelectorAll('[data-ticket]').forEach(b=>b.onclick=()=>openTicket(Number(b.dataset.ticket)))}catch(e){document.getElementById('myTickets').innerHTML=`<div class="opsEmpty">${esc(e.message)}</div>`}}
async function openTicket(id){try{const t=await api('/api/support/tickets/'+id);openOps('Support ticket #'+id,`<div class="ticketDetail"><span class="opsBadge">${esc(t.status)}</span><h3>${esc(t.subject)}</h3><p>${esc(t.description)}</p>${t.english_translation?`<div class="translationBox"><strong>English translation</strong><p>${esc(t.english_translation)}</p></div>`:''}<h4>Attachments</h4><div class="opsList">${(t.attachments||[]).map(a=>`<button data-attachment="${a.id}" class="attachmentRow">${esc(a.file_name)} <small>${esc(a.kind)}</small></button>`).join('')||'<small>None</small>'}</div><h4>Conversation</h4>${(t.messages||[]).map(m=>`<div class="supportMessage"><strong>${esc(m.actor_name)}</strong><p>${esc(m.message)}</p></div>`).join('')}<form id="supportReplyForm" class="opsForm"><label>Add follow-up<textarea id="supportReplyMessage" rows="4" maxlength="3000" required placeholder="Add information or reply to the reviewing team."></textarea></label><button class="opsPrimary" type="submit">Send follow-up</button></form></div>`);document.querySelectorAll('[data-attachment]').forEach(b=>b.onclick=()=>downloadAttachment(id,Number(b.dataset.attachment)));document.getElementById('supportReplyForm').onsubmit=e=>submitSupportReply(id,e)}catch(e){toast(e.message)}}
async function submitSupportReply(id,e){
  e.preventDefault();const button=e.submitter;const message=document.getElementById('supportReplyMessage').value.trim();if(!message)return;
  button.disabled=true;button.textContent='Sending…';
  try{await api('/api/support/tickets/'+id+'/reply',{method:'POST',body:JSON.stringify({message})});toast('Follow-up sent.');await openTicket(id)}catch(err){toast(err.message)}finally{button.disabled=false;button.textContent='Send follow-up'}
}
async function downloadAttachment(ticketId,id){try{const a=await api(`/api/support/tickets/${ticketId}/attachments/${id}`);const link=document.createElement('a');link.href=a.data_url;link.download=a.file_name||'attachment';link.click()}catch(e){toast(e.message)}}

async function openAdmin(){
  if(!token())return;
  window.location.assign('/admin');
}

async function renderAdminTab(tab,btn){document.querySelectorAll('[data-admin-tab]').forEach(x=>x.classList.toggle('active',x===btn));const p=document.getElementById('adminPanel');if(tab==='applications'){p.innerHTML=(adminState.applications||[]).slice(0,80).map(a=>`<div class="adminRow"><span><strong>${esc(a.display_name)} • ${esc(a.role)}</strong><small>${esc(a.territory_name)} • ${esc(a.status)}</small></span><b>#${a.id}</b></div>`).join('')||'<div class="opsEmpty">No applications.</div>';return}
  if(tab==='support'){const rows=await api('/api/admin/support');p.innerHTML=rows.map(t=>`<div class="adminRow"><span><strong>#${t.id} • ${esc(t.subject)}</strong><small>${esc(t.category)} • ${esc(t.requested_destination)} • ${esc(t.priority)} • ${esc(t.status)} • ${t.attachment_count||0} files</small></span></div>`).join('')||'<div class="opsEmpty">Support queue is empty.</div>';return}
  if(tab==='incidents'){const rows=await api('/api/admin/incidents');p.innerHTML=rows.map(t=>`<div class="adminRow"><span><strong>#${t.id} • ${esc(t.category)}</strong><small>${esc(t.status)} • ${esc(t.reporter_name)}</small></span></div>`).join('')||'<div class="opsEmpty">Incident queue is empty.</div>';return}
  if(tab==='admins'){const rows=await api('/api/admin/assignments');const territoryRows=adminState.territories||[];const territories=territoryRows.map(t=>`<option value="${t.id}">${esc(t.name)} • ${esc(t.territory_type)}</option>`).join('');const delegated=(adminAccess.permissions||[]).filter(x=>!['admin.console'].includes(x));const noTerritory=!territoryRows.length;p.innerHTML=`
    <form id="adminAssignForm" class="opsForm adminAssignForm">
      <h4>Delegate administration</h4>
      ${noTerritory?'<div class="opsNotice"><strong>Create a territory first for Territory Admin.</strong><span>Use Account & Profiles → Governance & approvals → Territories. Country Admin delegation remains separate.</span></div>':''}
      <label>Existing account email<input id="adminTargetEmail" type="email" required placeholder="person@example.com"></label>
      <label>Role<select id="adminTargetRole"><option value="territory_admin" ${noTerritory?'disabled':''}>Territory Admin${noTerritory?' — create territory first':''}</option><option value="country_admin" ${noTerritory?'selected':''}>Country Admin (Super Admin only)</option></select></label>
      <label>Territory<select id="adminTargetTerritory" ${noTerritory?'disabled':''}><option value="">${noTerritory?'No territories created':'Choose territory'}</option>${territories}</select></label>
      <div class="permissionGrid">${delegated.map(x=>`<label><input type="checkbox" name="adminPermission" value="${esc(x)}"> ${esc(x)}</label>`).join('')}</div>
      <label>Reason<input id="adminAssignReason" maxlength="500" placeholder="Why this authority is being delegated"></label>
      <button class="opsPrimary" type="submit">Create / update assignment</button>
    </form>
    <h4>Admin assignments</h4>
    <div class="opsList">${rows.map(a=>`<div class="adminRow"><span><strong>${esc(a.display_name)} • ${esc(a.admin_role)}</strong><small>${esc(a.territory_name||a.country_code)} • ${esc(a.status)}</small><small>${esc((a.permissions||[]).join(', ')||'Protected Super Admin authority')}</small></span><b>#${a.id}</b></div>`).join('')||'<div class="opsEmpty">No delegated Admins.</div>'}</div>`;document.getElementById('adminAssignForm').onsubmit=createAdminAssignment;return}
  if(tab==='audit'){const rows=await api('/api/admin/audit');p.innerHTML=rows.map(x=>`<div class="adminRow"><span><strong>${esc(x.event_code)}</strong><small>${esc(x.actor_name||'System')} • ${new Date(x.created_at).toLocaleString()}</small></span></div>`).join('')||'<div class="opsEmpty">No Admin audit events.</div>'}
}
async function createAdminAssignment(e){
  e.preventDefault();const role=document.getElementById('adminTargetRole').value,territory=document.getElementById('adminTargetTerritory').value,permissions=[...document.querySelectorAll('input[name="adminPermission"]:checked')].map(x=>x.value);if(role==='territory_admin'&&!territory)return toast('Create and choose an operating territory before delegating Territory Admin.');try{await api('/api/admin/assignments',{method:'POST',body:JSON.stringify({target_email:document.getElementById('adminTargetEmail').value,admin_role:role,territory_id:role==='territory_admin'?Number(territory)||null:null,permissions,reason:document.getElementById('adminAssignReason').value})});toast('Admin assignment saved.');const b=document.querySelector('[data-admin-tab="admins"]');await renderAdminTab('admins',b)}catch(err){toast(err.message)}
}

window.BusinessLifeAdminOps=Object.freeze({openSupport,openAdmin,closeOps});
function boot(){ensureUi();if(lazyFeatureMode)return;addButtons();document.addEventListener('abl:profile-state',()=>addButtons())}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
