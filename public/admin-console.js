const token=()=>localStorage.getItem('abl_token')||'';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,options={}){
  const headers={'Content-Type':'application/json',...(options.headers||{})};
  if(token())headers.Authorization='Bearer '+token();
  const r=await fetch(path,{...options,headers});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(data.error||('Request failed ('+r.status+')'));
  return data;
}
const root=document.getElementById('adminRoot');
let state={me:null,catalog:null,overview:null,active:'overview',assignments:null};

const modules=[
  {id:'overview',label:'Overview',any:['admin.console']},
  {id:'profiles',label:'Profiles',any:['merchant.approve','supplier.approve','courier.verify','profiles.review_service_provider','profile.suspend']},
  {id:'support',label:'Support',any:['support.manage']},
  {id:'safety',label:'Trust & Safety',any:['incident.triage']},
  {id:'territories',label:'Territories',any:['territory.manage']},
  {id:'finance',label:'Finance',any:['admin.console']},
  {id:'audit',label:'Audit & Metrics',any:['audit.view','metrics.view']},
  {id:'team',label:'Team & Delegation',any:['admin.assign_limited','admin.delegate']}
];
function hasAny(list){const p=new Set(state.me?.permissions||[]);return list.some(x=>p.has(x))}
function rankLabel(code){return state.catalog?.ranks?.find(x=>x.code===code)?.label||code}
function highestAssignment(){
  const ranks=new Map((state.catalog?.ranks||[]).map(x=>[x.code,Number(x.level||0)]));
  return [...(state.me?.assignments||[])].sort((a,b)=>(ranks.get(b.effective_rank||b.authority_rank||b.admin_role)||0)-(ranks.get(a.effective_rank||a.authority_rank||a.admin_role)||0))[0]||null;
}
function shell(){
  const visible=modules.filter(m=>hasAny(m.any));
  if(!visible.some(x=>x.id===state.active))state.active=visible[0]?.id||'overview';
  root.className='workspace';
  root.innerHTML='<nav class="adminNav">'+visible.map(m=>'<button type="button" data-module="'+m.id+'" class="'+(m.id===state.active?'active':'')+'">'+esc(m.label)+'</button>').join('')+'</nav><section class="adminMain"><div id="adminPanel"></div></section>';
  root.querySelectorAll('[data-module]').forEach(b=>b.onclick=()=>{state.active=b.dataset.module;shell();renderActive().catch(showError)});
}
function showError(e){const p=document.getElementById('adminPanel')||root;p.innerHTML='<div class="error">'+esc(e.message||e)+'</div>'}
function financeMoney(v,currency='PHP'){
  try{return new Intl.NumberFormat('en-PH',{style:'currency',currency}).format(Number(v||0))}
  catch{return '₱'+Number(v||0).toFixed(2)}
}
function financePct(v){return v==null?'—':Number(v).toFixed(2)+'%'}
function financeTerritoryId(){
  const scoped=(state.me?.assignments||[]).find(a=>a.admin_role==='territory_admin'&&a.territory_id);
  return scoped?Number(scoped.territory_id):null;
}
function financeScopeQuery(){
  const id=financeTerritoryId();
  return id?'?territory_id='+encodeURIComponent(id):'';
}
function financeTone(v){const n=Number(v||0);return n<0?'moneyNeg':(n>0?'moneyPos':'')}
function hero(){
  const a=highestAssignment();
  const scopes=(state.me.assignments||[]).map(x=>rankLabel(x.effective_rank||x.authority_rank||x.admin_role)+(x.territory_name?' · '+x.territory_name:' · '+(x.country_code||'PH')));
  return '<div class="hero"><div><h2>'+esc(a?rankLabel(a.effective_rank||a.authority_rank||a.admin_role):'Admin')+'</h2><p>Privileged workspace. Only functions explicitly delegated to this account are shown.</p></div><div class="badgeRow">'+scopes.map(x=>'<span class="badge">'+esc(x)+'</span>').join('')+'</div></div>';
}
function metrics(){
  const s=state.overview?.summary||{},items=[];
  if(s.orders!=null)items.push(['Orders',s.orders]);
  if(s.deliveries!=null)items.push(['Deliveries',s.deliveries]);
  if(s.service_jobs!=null)items.push(['Service jobs',s.service_jobs]);
  if(s.support!=null)items.push(['Open support',s.support.open||0]);
  if(s.incidents!=null)items.push(['Open incidents',s.incidents.open||0]);
  if(hasAny(['merchant.approve','supplier.approve','courier.verify','profiles.review_service_provider','profile.suspend']))items.push(['Applications',(state.overview?.applications||[]).filter(x=>!['active','approved','rejected'].includes(x.status)).length]);
  if(!items.length)return '<div class="empty">No operational metrics are delegated to this account.</div>';
  return '<div class="grid">'+items.map(x=>'<div class="metric"><strong>'+esc(x[1])+'</strong><span>'+esc(x[0])+'</span></div>').join('')+'</div>';
}

function rows(items,formatter){
  if(!items?.length)return '<div class="empty">Nothing in this scoped view.</div>';
  return '<div class="list">'+items.map(formatter).join('')+'</div>';
}
function overviewPanel(){
  return hero()+metrics()+'<div class="sectionTitle"><h3>My delegated functions</h3></div><div class="permissionPills">'+(state.me.permissions||[]).map(p=>'<span>'+esc(p)+'</span>').join('')+'</div>';
}
function profilesPanel(){
  const apps=state.overview?.applications||[];
  const auths=state.overview?.authorizations||[];
  return hero()+'<p class="moduleIntro">Profile onboarding and authorization queues inside your permitted scope.</p><div class="sectionTitle"><h3>Applications</h3></div>'+rows(apps,x=>'<div class="row"><div class="rowHeader"><strong>'+esc(x.display_name||x.email||('Account '+x.account_id))+'</strong><span class="status">'+esc(x.status)+'</span></div><span class="muted">'+esc(x.role)+' · '+esc(x.territory_name||'Scoped territory')+'</span></div>')+'<div class="sectionTitle"><h3>Authorizations</h3></div>'+rows(auths,x=>'<div class="row"><div class="rowHeader"><strong>'+esc(x.display_name||x.email||('Account '+x.account_id))+'</strong><span class="status">'+esc(x.status)+'</span></div><span class="muted">'+esc(x.role)+' · '+esc(x.territory_name||'Country scope')+'</span></div>');
}
async function queuePanel(kind){
  const isSupport=kind==='support';
  const data=await api(isSupport?'/api/admin/support':'/api/admin/incidents');
  const list=Array.isArray(data)?data:(data.items||data.tickets||data.incidents||[]);
  return hero()+'<p class="moduleIntro">'+(isSupport?'Support tickets assigned or visible in your scope. Tap a ticket to read it and reply.':'Incident queue visible under your delegated Trust & Safety authority.')+'</p>'+rows(list,x=>isSupport
    ?'<button type="button" class="row queueRow" data-support-ticket="'+Number(x.id)+'"><div class="rowHeader"><strong>'+esc(x.subject||('Ticket #'+x.id))+'</strong><span class="status">'+esc(x.status||'open')+'</span></div><span class="muted">'+esc(x.category+' • '+(x.requester_name||x.requester_email||x.priority||''))+'</span></button>'
    :'<div class="row"><div class="rowHeader"><strong>'+esc(x.subject||x.category||('Case #'+x.id))+'</strong><span class="status">'+esc(x.status||'open')+'</span></div><span class="muted">'+esc(x.reporter_name||x.priority||'')+'</span></div>');
}
function supportMessage(m){
  const context=m.actor_context==='admin'?'admin':'user',label=context==='admin'?'Business & Life Support':(m.actor_name||'User');
  return '<div class="supportMessage '+context+' '+(m.visibility==='internal'?'internal':'')+'"><div class="rowHeader"><strong>'+esc(label)+'</strong><span class="muted">'+esc(m.visibility==='internal'?'Internal note':context==='admin'?'Support reply':'User message')+'</span></div><p>'+esc(m.message)+'</p></div>';
}
let adminVoiceRecorder=null,adminVoiceStream=null;
const adminBlobDataUrl=blob=>new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=reject;r.onload=()=>resolve(String(r.result));r.readAsDataURL(blob)});
async function startAdminVoice(){
  const status=document.getElementById('adminVoiceStatus'),textarea=document.querySelector('#adminSupportReply textarea[name="message"]');
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){if(status)status.textContent='Microphone recording is not available in this browser.';return}
  try{const chunks=[];adminVoiceStream=await navigator.mediaDevices.getUserMedia({audio:true});adminVoiceRecorder=new MediaRecorder(adminVoiceStream);adminVoiceRecorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data)};adminVoiceRecorder.onstop=async()=>{const blob=new Blob(chunks,{type:adminVoiceRecorder?.mimeType||'audio/webm'});adminVoiceStream?.getTracks().forEach(t=>t.stop());adminVoiceStream=null;adminVoiceRecorder=null;if(status)status.textContent='Transcribing voice…';try{const x=await api('/api/support/assist/transcribe',{method:'POST',body:JSON.stringify({data_url:await adminBlobDataUrl(blob),file_name:'admin-support-reply.webm',source_language:'auto'})});textarea.value=[textarea.value.trim(),String(x.transcript||'').trim()].filter(Boolean).join(textarea.value.trim()?'\n':'');if(status)status.textContent='Voice transcribed. Review the text before sending.'}catch(e){if(status)status.textContent=e.message}};adminVoiceRecorder.start();document.getElementById('adminVoiceStart').disabled=true;document.getElementById('adminVoiceStop').disabled=false;if(status)status.textContent='Recording…'}catch(e){if(status)status.textContent='Microphone permission was not available.'}
}
function stopAdminVoice(){if(adminVoiceRecorder?.state==='recording')adminVoiceRecorder.stop();const start=document.getElementById('adminVoiceStart'),stop=document.getElementById('adminVoiceStop');if(start)start.disabled=false;if(stop)stop.disabled=true}
async function draftAdminReply(id){const textarea=document.querySelector('#adminSupportReply textarea[name="message"]'),status=document.getElementById('adminVoiceStatus'),button=document.getElementById('adminAiDraft');button.disabled=true;if(status)status.textContent='AI is preparing an editable draft…';try{const x=await api('/api/admin/support/'+id+'/assist/draft',{method:'POST',body:JSON.stringify({draft:textarea.value})});textarea.value=x.draft||textarea.value;if(status)status.textContent='AI draft ready. Review and edit it before sending.'}catch(e){if(status)status.textContent=e.message}finally{button.disabled=false}}
async function openAdminSupportTicket(id){
  const p=document.getElementById('adminPanel');
  p.innerHTML='<div class="adminLoading">Loading ticket…</div>';
  try{
    const t=await api('/api/support/tickets/'+id);
    p.innerHTML='<button type="button" class="secondary supportBack" id="supportBack">← Back to Support</button>'
      +'<section class="supportTicketDetail"><div class="sectionTitle"><div><small class="muted">TICKET #'+Number(t.id)+'</small><h2>'+esc(t.subject)+'</h2></div><span class="status">'+esc(t.status)+'</span></div>'
      +'<div class="supportMeta"><span>'+esc(t.category)+'</span><span>'+esc(t.priority)+'</span><span>'+esc(t.requested_destination)+'</span></div>'
      +'<div class="card"><h3>Issue</h3><p>'+esc(t.description)+'</p>'+(t.english_translation?'<div class="translationBox"><strong>English translation</strong><p>'+esc(t.english_translation)+'</p></div>':'')+'</div>'
      +'<div class="sectionTitle"><h3>Conversation</h3></div><div class="supportConversation">'+(t.messages||[]).map(supportMessage).join('')+'</div>'
      +'<form id="adminSupportReply" class="adminForm"><label>Reply<textarea name="message" maxlength="3000" required placeholder="Write a reply to the user"></textarea></label><div class="supportAssistTools"><button id="adminVoiceStart" class="secondary" type="button">🎙 Speak</button><button id="adminVoiceStop" class="secondary" type="button" disabled>■ Stop</button><button id="adminAiDraft" class="secondary" type="button">✨ Draft with AI</button></div><small id="adminVoiceStatus" class="muted">Voice and AI create editable text only. Nothing is sent automatically.</small><label class="inlineChoice"><input name="internal" type="checkbox"> Save as internal note (not visible to user)</label><button class="primary" type="submit">Send reply</button><div id="supportReplyResult"></div></form>'
      +'<form id="adminSupportUpdate" class="adminForm"><div class="supportControls"><label>Status<select name="status">'+['new','triaged','in_progress','waiting_user','waiting_internal','resolved','closed','reopened'].map(x=>'<option value="'+x+'" '+(x===t.status?'selected':'')+'>'+x.replaceAll('_',' ')+'</option>').join('')+'</select></label><label>Priority<select name="priority">'+['low','normal','high','urgent'].map(x=>'<option value="'+x+'" '+(x===t.priority?'selected':'')+'>'+x+'</option>').join('')+'</select></label></div><label class="inlineChoice"><input name="assign_to_self" type="checkbox"> Assign this ticket to me</label><button class="secondary" type="submit">Save ticket</button><div id="supportUpdateResult"></div></form></section>';
    document.getElementById('supportBack').onclick=async()=>{state.active='support';shell();await renderActive()};
    document.getElementById('adminVoiceStart').onclick=startAdminVoice;
    document.getElementById('adminVoiceStop').onclick=stopAdminVoice;
    document.getElementById('adminAiDraft').onclick=()=>draftAdminReply(id);
    document.getElementById('adminSupportReply').onsubmit=async e=>{
      e.preventDefault();const form=e.currentTarget,button=form.querySelector('button'),out=document.getElementById('supportReplyResult');button.disabled=true;
      try{await api('/api/admin/support/'+id+'/messages',{method:'POST',body:JSON.stringify({message:form.message.value,visibility:form.internal.checked?'internal':'user'})});await openAdminSupportTicket(id)}catch(err){out.innerHTML='<div class="error">'+esc(err.message)+'</div>';button.disabled=false}
    };
    document.getElementById('adminSupportUpdate').onsubmit=async e=>{
      e.preventDefault();const form=e.currentTarget,button=form.querySelector('button'),out=document.getElementById('supportUpdateResult');button.disabled=true;
      try{await api('/api/admin/support/'+id,{method:'PATCH',body:JSON.stringify({status:form.status.value,priority:form.priority.value,assign_to_self:form.assign_to_self.checked})});await openAdminSupportTicket(id)}catch(err){out.innerHTML='<div class="error">'+esc(err.message)+'</div>';button.disabled=false}
    };
  }catch(e){showError(e)}
}
function bindSupportQueue(){document.querySelectorAll('[data-support-ticket]').forEach(button=>button.onclick=()=>openAdminSupportTicket(Number(button.dataset.supportTicket)))}
function territoriesPanel(){
  return hero()+'<p class="moduleIntro">Operating cells visible to your assignment.</p>'+rows(state.overview?.territories||[],x=>'<div class="row"><div class="rowHeader"><strong>'+esc(x.name)+'</strong><span class="status">'+esc(x.status)+'</span></div><span class="muted">'+esc(x.territory_type)+' · '+esc(x.code||'')+'</span></div>');
}
function renderPricingScenario(s){
  const p=s?.portfolio||{},services=s?.services||[],g=s?.guardrails||{};
  return '<div class="pricingScenarioResults">'
    +'<div class="notice"><strong>SIMULATION ONLY</strong><br>This scenario does not activate a fee policy, change prices or charge any Customer, Merchant, Supplier, Courier or Service Provider.</div>'
    +'<div class="financeSummary">'
      +'<div class="metric"><strong>'+financeMoney(p.total_completed_gross_value||0)+'</strong><span>Total completed service value</span></div>'
      +'<div class="metric"><strong>'+financeMoney(p.actual_post_promo_gross_value||0)+'</strong><span>Actual post-promo gross value</span></div>'
      +'<div class="metric"><strong>'+financeMoney(p.projected_revenue_post_promo_actual||0)+'</strong><span>Projected revenue · post-promo actual</span></div>'
      +'<div class="metric"><strong>'+financeMoney(p.projected_revenue_mature_volume||0)+'</strong><span>Projected revenue · mature simulation</span></div>'
      +'<div class="metric"><strong>'+financeMoney(p.total_recorded_cost||0)+'</strong><span>Recorded cost</span></div>'
      +'<div class="metric"><strong class="'+financeTone(p.projected_operating_pl_post_promo_actual)+'">'+financeMoney(p.projected_operating_pl_post_promo_actual||0)+'</strong><span>Projected P/L · post-promo actual</span></div>'
      +'<div class="metric"><strong class="'+financeTone(p.projected_operating_pl_mature_volume)+'">'+financeMoney(p.projected_operating_pl_mature_volume||0)+'</strong><span>Projected P/L · mature simulation</span></div>'
      +'<div class="metric"><strong>'+financePct(p.break_even_rate_total_volume_pct)+'</strong><span>Break-even rate · total volume</span></div>'
    +'</div>'
    +'<div class="financeTruth"><strong>Scenario bases</strong><span><b>Post-promo actual:</b> '+esc(s?.bases?.post_promo_actual||'')+'<br><b>Mature-volume simulation:</b> '+esc(s?.bases?.all_activity_mature_simulation||'')+'</span></div>'
    +'<div class="sectionTitle"><h3>Scenario by service</h3></div>'
    +rows(services,x=>'<div class="row"><div class="rowHeader"><strong>'+esc(x.service_scope)+'</strong><span class="status">'+financePct(x.proposed_rate_pct)+'</span></div>'
      +'<div class="financeLine"><span>Promo gross '+financeMoney(x.promotional_gross_value)+'</span><span>Post-promo gross '+financeMoney(x.post_promo_gross_value)+'</span><span>Total gross '+financeMoney(x.total_completed_gross_value)+'</span></div>'
      +'<div class="financeLine"><span>Projected mature revenue '+financeMoney(x.projected_revenue_mature_volume)+'</span><span>Recorded cost '+financeMoney(x.recorded_service_cost)+'</span><strong class="'+financeTone(x.projected_operating_pl_mature_volume)+'">Mature P/L '+financeMoney(x.projected_operating_pl_mature_volume)+'</strong></div>'
      +'<span class="muted">Break-even on total volume: '+financePct(x.break_even_rate_total_volume_pct)+' · Post-promo actual break-even: '+financePct(x.break_even_rate_post_promo_volume_pct)+' · '+esc(x.data_status)+'</span></div>')
    +'<div class="financeTruth"><strong>Cost coverage</strong><span>Shared / unallocated recorded cost: '+financeMoney(p.unallocated_shared_cost||0)+'. '+esc(g.shared_cost_warning||'All recorded costs in this period are allocated to service scopes.')+'</span></div>'
    +'<div class="notice"><strong>Evidence boundary</strong><br>'+esc(g.missing_cost_warning||'Only canonical recorded costs are used.')+'</div>'
    +'<div class="notice"><strong>Live fee state</strong><br>'+esc(g.fee_activation||'NOT_PERFORMED')+' · Promotional live charge remains zero until a future explicit fee-resolution implementation.</div>'
    +'</div>';
}

function renderSharedCostResult(s){
  return '<div class="sharedCostResults">'
    +'<div class="financeSummary"><div class="metric"><strong>'+financeMoney(s.equal_pool||0)+'</strong><span>50% equal pool</span></div><div class="metric"><strong>'+financeMoney(s.activity_pool||0)+'</strong><span>50% activity pool</span></div><div class="metric"><strong>'+financeMoney(s.allocated_total||0)+'</strong><span>Allocated total</span></div><div class="metric"><strong>'+financeMoney(s.residual||0)+'</strong><span>Residual</span></div></div>'
    +(s.zero_activity_fallback==='EQUAL_SPLIT_ACTIVITY_HALF'?'<div class="notice"><strong>Zero-activity fallback used.</strong><br>The activity half was also divided equally because every scope had zero activity.</div>':'')
    +rows(s.rows||[],x=>'<div class="row"><div class="rowHeader"><strong>'+esc(x.scope_name||x.scope_id)+'</strong><span class="status">'+financeMoney(x.allocated_amount)+'</span></div><div class="financeLine"><span>Equal '+financeMoney(x.equal_component)+'</span><span>Activity '+financeMoney(x.activity_component)+'</span><span>Driver '+esc(x.driver_value)+'</span></div></div>')
    +'</div>';
}
function sharedCostScopeRow(index){
  return '<div class="sharedCostScopeRow" data-shared-cost-row><label>Scope ID<input data-sc="id" value="scope-'+index+'" required></label><label>Country / zone name<input data-sc="name" placeholder="Philippines / Metro Manila" required></label><label>Activity / traffic units<input data-sc="driver" type="number" min="0" step="0.01" value="0" required></label><button type="button" class="secondary" data-remove-shared-cost>Remove</button></div>';
}
function monetizationV2Card(model){
  const p=model?.profile_models||{},d=model?.digital_payment_incentive||{},shared=model?.shared_cost_policy||{};
  const item=(role,label)=>{const x=p?.[role]||{};let value='';if(x.customer_free)value='FREE';else if(x.delivery_production_fee)value=financePct(x.owner_approved_delivery_production_rate_pct||10)+' of verified delivery price';else if(x.monthly_subscription&&x.transaction_fee)value=financeMoney(x.owner_approved_monthly_subscription_php||99)+'/month + '+financePct(x.owner_approved_transaction_rate_pct||0.5);const meta=x.delivery_production_fee?'No monthly subscription · '+esc(x.promotional_days||30)+'-day promo first':(x.promotional_entitlement?esc(x.promotional_days||90)+'-day promo before monetization':'No paid profile subscription');return '<div class="monetizationRoleRow"><div><strong>'+esc(label)+'</strong><small>'+esc(meta)+'</small></div><b>'+esc(value||'Policy not configured')+'</b></div>'};
  return '<section class="monetizationV2Card">'
    +'<div class="commissionPlannerHead"><div><small>MONETIZATION V2</small><h3>Profile model & shared company costs</h3><p>No live amount or percentage is activated here.</p></div><span class="badge">OWNER POLICY</span></div>'
    +'<div class="profileMonetizationGrid">'+item('customer','Customer')+item('merchant','Merchant')+item('supplier','Supplier')+item('local_services','Artisan / Local Services')+item('courier','Delivery')+'</div>'
    +'<div class="financeTruth"><strong>Digital-payment incentive</strong><span>Verified '+esc((d.eligible_payment_methods||[]).join(' / '))+' payments may earn subscription or future platform-fee credits. Credits stay disabled until a versioned policy and Growth/Finance budget are approved.</span></div>'
    +'<details class="commissionAssumptions"><summary>Shared company cost simulator · 50% equal + 50% activity</summary><form id="sharedCostScenarioForm" class="adminForm"><div class="financeFormGrid"><label>Total shared company cost (PHP)<input name="total_amount" type="number" min="0" step="0.01" required></label><label>Activity driver<select name="driver_code">'+(shared.supported_driver_examples||[]).map(x=>'<option value="'+esc(x)+'">'+esc(x.replaceAll('_',' '))+'</option>').join('')+'</select></label></div><div id="sharedCostScopeRows">'+sharedCostScopeRow(1)+sharedCostScopeRow(2)+'</div><button type="button" class="secondary" id="addSharedCostScope">Add country / zone</button><button class="primary" type="submit">Calculate 50/50 allocation</button><div id="sharedCostScenarioResult"></div></form></details>'
    +'</section>';
}
function subscriptionBillingCard(data){
  const scopes=data?.scopes||{},policies=data?.policies||[],canDraft=hasAny(['fee_policy.manage_limited']);
  const scopeOrder=['marketplace','supplier','local_services'];
  const scopeRow=scope=>{
    const x=scopes?.[scope]||{},states=x.states||{};
    const latest=policies.find(p=>p.service_scope===scope)||null;
    const plan=latest
      ?((latest.monthly_amount==null?'Amount not set':financeMoney(latest.monthly_amount,latest.currency_code||'PHP'))+' · '+String(latest.status||'draft').toUpperCase()+' · v'+esc(latest.version))
      :'No plan draft';
    return '<div class="subscriptionBillingRow"><div><strong>'+esc(x.label||data?.scope_labels?.[scope]||scope)+'</strong><small>'+esc(plan)+'</small></div>'
      +'<div class="subscriptionStateGrid">'
        +'<span><b>'+esc(x.promotional||0)+'</b> Promo</span>'
        +'<span><b>'+esc(x.hold_no_active_policy||0)+'</b> HOLD</span>'
        +'<span><b>'+esc(x.ready_to_invoice||0)+'</b> Ready</span>'
      +'</div></div>';
  };
  const draftForm=canDraft
    ?'<details class="commissionAssumptions"><summary>Create subscription plan draft</summary><form id="subscriptionPolicyDraftForm" class="adminForm"><div class="financeFormGrid">'
      +'<label>Profile type<select name="service_scope"><option value="marketplace">Merchant</option><option value="supplier">Supplier</option><option value="local_services">Artisan / Local Services</option></select></label>'
      +'<label>Policy code<input name="policy_code" placeholder="Optional · auto by profile"></label>'
      +'<label>Monthly amount (PHP)<input name="monthly_amount" type="number" min="0" step="0.01" value="99"></label>'
      +'<label>Description<input name="description" placeholder="Owner pricing scenario / rationale"></label>'
      +'</div><div class="notice"><strong>Draft only.</strong><br>Creating this record does not activate billing and does not generate an invoice.</div><button class="primary" type="submit">Create plan draft</button><div id="subscriptionPolicyDraftResult"></div></form></details>'
    :'';
  return '<section class="subscriptionBillingCard">'
    +'<div class="commissionPlannerHead"><div><small>SUBSCRIPTION BILLING</small><h3>90-day promo → billing readiness</h3><p>Owner-approved price is ₱99/month after the 90-day promo. Billing stays blocked until promo has ended and an active versioned plan exists.</p></div><span class="badge">FAIL-CLOSED</span></div>'
    +'<div class="subscriptionBillingRows">'+scopeOrder.map(scopeRow).join('')+'</div>'
    +'<div class="financeTruth"><strong>Non-billable profiles</strong><span>Customer = FREE. Delivery = no monthly subscription; Delivery uses production fee only.</span></div>'
    +'<div class="financeTruth"><strong>Current activation boundary</strong><span>'+esc(data?.guardrails?.invoice_generation||'NOT_PERFORMED')+' · live policy activation '+esc(data?.guardrails?.live_policy_activation||'NOT_AVAILABLE')+'.</span></div>'
    +draftForm
    +'</section>';
}
function renderDigitalIncentiveResult(x){
  const s=x?.selected||{},p=s?.provider_cost||{},cash=s?.cash_cost_model||{},i=s?.incentive||{};
  const comparison=x?.comparison||[];
  const stateCopy={
    SUPPORTED:'Credit is economically supportable under these assumptions.',
    NO_ECONOMIC_SAVINGS:'Digital processing costs at least as much as the modeled Cash handling cost. Supported credit is zero.',
    SAVINGS_EXIST_BUT_NO_CREDIT_CONFIGURED:'Digital payment saves money, but the configured return-to-user share/cap produces no credit.',
    BUDGET_EXHAUSTED:'Savings exist, but the Growth/Finance credit budget is exhausted.'
  };
  return '<div class="digitalIncentiveResults">'
    +'<div class="'+(s.state==='SUPPORTED'?'notice':(s.state==='NO_ECONOMIC_SAVINGS'?'error':'notice'))+'"><strong>'+esc(s.state||'SIMULATION')+'</strong><br>'+esc(stateCopy[s.state]||'Read-only scenario.')+'</div>'
    +'<div class="financeSummary">'
      +'<div class="metric"><strong>'+financeMoney(p.modeled_total_processor_cost||0)+'</strong><span>Digital processor cost</span></div>'
      +'<div class="metric"><strong>'+financeMoney(cash.modeled_cash_total_cost||0)+'</strong><span>Modeled Cash handling cost</span></div>'
      +'<div class="metric"><strong>'+financeMoney(i.gross_operational_savings||0)+'</strong><span>Gross operational savings</span></div>'
      +'<div class="metric"><strong>'+financeMoney(i.supported_credit||0)+'</strong><span>Max configured credit</span></div>'
      +'<div class="metric"><strong>'+financeMoney(i.retained_business_life_savings||0)+'</strong><span>Retained Business & Life savings</span></div>'
      +'<div class="metric"><strong>'+financeMoney(i.net_business_life_impact_after_credit||0)+'</strong><span>Net company impact</span></div>'
    +'</div>'
    +'<div class="financeTruth"><strong>'+esc(p.rail_label||'Payment rail')+'</strong><span>Published benchmark '+financePct(p.published_variable_rate_pct)+(Number(p.published_fixed_fee_php||0)>0?' + '+financeMoney(p.published_fixed_fee_php):'')+' · fee benchmark excludes VAT · as of '+esc(p.benchmark_as_of||'')+'. Actual provider evidence overrides this estimate.</span></div>'
    +'<div class="sectionTitle"><h3>Rail comparison for this ticket</h3></div>'
    +rows(comparison,r=>'<div class="row"><div class="rowHeader"><strong>'+esc(r.provider_cost?.rail_label||r.provider_cost?.rail_code)+'</strong><span class="status">'+financeMoney(r.provider_cost?.modeled_total_processor_cost||0)+'</span></div><div class="financeLine"><span>Supported credit '+financeMoney(r.incentive?.supported_credit||0)+'</span><span>Net impact '+financeMoney(r.incentive?.net_business_life_impact_after_credit||0)+'</span><span>'+esc(r.state||'')+'</span></div></div>')
    +'</div>';
}
function digitalPaymentIncentiveCard(bench){
  const rails=bench?.rails||{};
  const options=Object.values(rails).map(r=>'<option value="'+esc(r.code)+'">'+esc(r.label)+'</option>').join('');
  const benchmarkRows=Object.values(rails).map(r=>'<div class="paymentRailRow"><div><strong>'+esc(r.label)+'</strong><small>'+esc(r.note||'')+'</small></div><b>'+financePct(r.variable_rate_pct)+(Number(r.fixed_fee_php||0)>0?' + '+financeMoney(r.fixed_fee_php):'')+'</b></div>').join('');
  return '<section class="digitalPaymentIncentiveCard">'
    +'<div class="commissionPlannerHead"><div><small>DIGITAL PAYMENT INCENTIVE</small><h3>How much credit can a digital payment safely earn?</h3><p>Compare the measured cost of Cash with PayMongo rails. No reward is activated here.</p></div><span class="badge">SIMULATION</span></div>'
    +'<div class="paymentRailBenchmarks">'+benchmarkRows+'</div>'
    +'<div class="financeTruth"><strong>Benchmark boundary</strong><span>PayMongo public pricing snapshot '+esc(bench?.benchmark_as_of||'')+' · published fees are exclusive of VAT. Actual provider statements always take priority.</span></div>'
    +'<form id="digitalPaymentIncentiveForm" class="adminForm">'
      +'<div class="financeFormGrid">'
        +'<label>Average ticket / commercial amount (PHP)<input name="commercial_amount" type="number" min="0" step="0.01" required placeholder="e.g. 500"></label>'
        +'<label>Payment rail<select name="rail_code">'+options+'</select></label>'
        +'<label>Measured Cash handling cost %<input name="cash_handling_cost_pct" type="number" min="0" max="100" step="0.01" value="0"></label>'
        +'<label>Cash handling fixed cost / transaction<input name="cash_handling_fixed_cost" type="number" min="0" step="0.01" value="0"></label>'
        +'<label>Provider fee VAT/tax %<input name="provider_fee_tax_pct" type="number" min="0" max="100" step="0.01" value="0"></label>'
        +'<label>Return to profile as credit % of savings<input name="return_savings_pct" type="number" min="0" max="100" step="0.01" value="50"></label>'
        +'<label>Credit cap / transaction<input name="credit_cap" type="number" min="0" step="0.01" placeholder="Optional"></label>'
        +'<label>Growth/Finance budget remaining<input name="growth_budget_remaining" type="number" min="0" step="0.01" placeholder="Optional"></label>'
      +'</div>'
      +'<div class="notice"><strong>No Cash surcharge.</strong><br>If digital processing does not save money under the entered Cash-cost evidence, supported credit becomes ₱0. Credits require verified provider payment and a future versioned policy.</div>'
      +'<button class="primary" type="submit">Calculate digital-payment credit ceiling</button>'
      +'<div id="digitalPaymentIncentiveResult"></div>'
    +'</form></section>';
}
function renderCommissionPlannerResult(s){
  const current=s?.rates?.current_rollout||{},mature=s?.rates?.mature_100pct_fee_eligible||{},cost=s?.cost_model||{},vol=s?.volume||{},staff=s?.staffing||{},ops=s?.operating_costs||{},mix=s?.revenue_mix||{};
  const pct=v=>v==null?'—':Number(v).toFixed(2)+'%';
  const status=current.status==='PROMOTIONAL_VOLUME_REQUIRES_EXTERNAL_FUNDING'
    ?'<div class="notice"><strong>Promo-funded period</strong><br>Fee-eligible volume is 0%. Commission revenue cannot fund this modeled operation yet; Owner/company capital or another legitimate funding source is required.</div>'
    :current.status==='NOT_VIABLE_AT_MODELED_VOLUME'
      ?'<div class="error"><strong>Modeled volume is not viable.</strong><br>The sustainable rate exceeds 100% of the current eligible fee base. Increase volume/fee base or reduce costs.</div>'
      :'';
  return '<div class="commissionPlannerResults">'
    +status
    +'<div class="financeSummary">'
      +'<div class="metric"><strong>'+pct(mature.break_even_pct)+'</strong><span>Mature break-even</span></div>'
      +'<div class="metric"><strong>'+pct(mature.sustainable_pct)+'</strong><span>Mature sustainable</span></div>'
      +'<div class="metric"><strong>'+pct(current.break_even_pct)+'</strong><span>Current rollout break-even</span></div>'
      +'<div class="metric"><strong>'+pct(current.sustainable_pct)+'</strong><span>Current rollout sustainable</span></div>'
      +'<div class="metric"><strong>'+financeMoney(cost.base_operating_cost||0)+'</strong><span>Base monthly operating cost</span></div>'
      +'<div class="metric"><strong>'+financeMoney(cost.safety_reserve_amount||0)+'</strong><span>Safety reserve</span></div>'
      +'<div class="metric"><strong>'+financeMoney(cost.growth_reinvestment_surplus_amount||0)+'</strong><span>Growth / reinvestment surplus</span></div>'
      +'<div class="metric"><strong>'+financeMoney(cost.sustainable_revenue_need||0)+'</strong><span>Revenue needed for sustainability</span></div>'
    +'</div>'
    +'<div class="financeTruth"><strong>What drives the rate</strong><span>'
      +'Staffing '+financeMoney(staff.total_monthly_staffing_cost||0)
      +' · Operating overhead '+financeMoney(ops.total_monthly_operating_overhead||0)
      +' · Processor '+financeMoney(cost.processor_total_cost||0)
      +' · Risk allowance '+financeMoney(cost.refund_chargeback_bad_debt_allowance||0)
      +'<br>Subscriptions '+financeMoney(mix.subscription_revenue||0)
      +' · Delivery production fee '+financeMoney(mix.delivery_production_fee_revenue||0)
      +' · Remaining sustainable transaction-fee revenue need '+financeMoney(mix.sustainable_transaction_revenue_need||0)
      +'<br>Mature transaction fee base '+financeMoney(vol.mature_monthly_fee_base||0)
      +' · Current fee-eligible base '+financeMoney(vol.current_fee_eligible_monthly_base||0)
    +'</span></div>'
    +'<div class="financeTruth"><strong>Boundary</strong><span>'+esc(s?.guardrails?.owner_distribution_note||'Owner distribution is excluded.')+'<br>'+esc(s?.guardrails?.fee_base_rule||'')+'</span></div>'
    +'</div>';
}
function commissionPlannerForm(k,promo){
  const promotional=(promo?.totals||[]).find(x=>x.phase==='promotional')||{},post=(promo?.totals||[]).find(x=>x.phase==='post_promo')||{};
  const totalGross=Number(promotional.gross_value||0)+Number(post.gross_value||0);
  const actualEligiblePct=totalGross>0?Math.round((Number(post.gross_value||0)/totalGross)*10000)/100:null;
  return '<section class="commissionPlannerCard">'
    +'<div class="commissionPlannerHead"><div><small>COMMISSION PLANNER</small><h3>What is the lowest sustainable platform fee?</h3><p>Enter a monthly operating scenario. Business & Life calculates the rate; nothing here activates a live fee.</p></div><span class="badge">SIMULATION</span></div>'
    +(actualEligiblePct!=null?'<div class="financeTruth"><strong>Current evidence context</strong><span>'+esc(k.completed_transactions||0)+' completed transactions in the Finance period · post-promo gross share '+financePct(actualEligiblePct)+'. This is context only, not an automatic assumption.</span></div>':'')
    +'<form id="commissionPlannerForm" class="adminForm commissionPlannerForm">'
      +'<div class="sectionTitle"><h3>1. Volume</h3></div><div class="financeFormGrid">'
        +'<label>Completed orders / services per month<input name="completed_events_per_month" type="number" min="0" step="1" required placeholder="e.g. 10000"></label>'
        +'<label>Average fee-base value (PHP)<input name="average_fee_base_value" type="number" min="0" step="0.01" required placeholder="e.g. 500"></label>'
        +'<label>Fee-eligible / post-promo share %<input name="fee_eligible_share_pct" type="number" min="0" max="100" step="0.01" required placeholder="0–100"></label>'
        +'<label>Online-payment share %<input name="online_payment_share_pct" type="number" min="0" max="100" step="0.01" required placeholder="0–100"></label>'
      +'</div>'
      +'<details class="commissionAssumptions"><summary>2. Admins, staff & remuneration</summary><div class="financeFormGrid">'
        +staffingInputs()
      +'</div><div class="notice"><strong>Owner distribution is not included here.</strong><br>If the Owner receives salary/contractor remuneration for actual work, use Super Admin remuneration. Profit distribution/withdrawal remains outside operating cost.</div></details>'
      +'<details class="commissionAssumptions"><summary>3. Monthly operating costs</summary><div class="financeFormGrid">'
        +costInput('infrastructure','Servers / infrastructure')
        +costInput('database_storage_monitoring','Database, storage & monitoring')
        +costInput('ai_api_maps_notifications','AI, APIs, maps & notifications')
        +costInput('support_operations','Support operations')
        +costInput('marketing_growth','Marketing & growth')
        +costInput('legal_accounting_compliance','Legal, accounting & compliance')
        +costInput('insurance_licences','Insurance & licences')
        +costInput('other_overhead','Other operating overhead')
      +'</div></details>'
      +'<details class="commissionAssumptions"><summary>4. Profile subscriptions & Delivery revenue</summary><div class="financeFormGrid">'
        +'<label>Paid Merchant profiles<input name="merchant_paid_profiles" type="number" min="0" step="1" value="0"></label>'
        +'<label>Merchant monthly subscription (PHP)<input name="merchant_subscription_amount" type="number" min="0" step="0.01" value="99"></label>'
        +'<label>Paid Supplier profiles<input name="supplier_paid_profiles" type="number" min="0" step="1" value="0"></label>'
        +'<label>Supplier monthly subscription (PHP)<input name="supplier_subscription_amount" type="number" min="0" step="0.01" value="99"></label>'
        +'<label>Paid Artisan / Local Services profiles<input name="local_services_paid_profiles" type="number" min="0" step="1" value="0"></label>'
        +'<label>Artisan / Local Services monthly subscription (PHP)<input name="local_services_subscription_amount" type="number" min="0" step="0.01" value="99"></label>'
        +'<label>Monthly eligible Delivery price charged to customers (PHP)<input name="delivery_eligible_price" type="number" min="0" step="0.01" value="0"></label>'
        +'<label>Delivery production fee % · Owner-approved<input name="delivery_production_rate_pct" type="number" min="0" max="100" step="0.01" value="10"></label>'
      +'</div><div class="notice"><strong>These revenues reduce the transaction fee still required.</strong><br>Customer remains free. Delivery has no monthly subscription.</div></details>'
      +'<details class="commissionAssumptions"><summary>5. Payments, risk & sustainability</summary><div class="financeFormGrid">'
        +'<label>Blended processor rate %<input name="processor_rate_pct" type="number" min="0" max="100" step="0.0001" value="0"></label>'
        +'<label>Fixed processor cost / online event<input name="processor_fixed_per_online_event" type="number" min="0" step="0.01" value="0"></label>'
        +'<label>Refund / chargeback / bad-debt allowance %<input name="risk_allowance_pct" type="number" min="0" max="100" step="0.01" value="0"></label>'
        +'<label>Safety reserve % of operating cost<input name="safety_reserve_pct" type="number" min="0" max="100" step="0.01" value="0"></label>'
        +'<label>Growth / reinvestment surplus % of operating cost<input name="growth_surplus_pct" type="number" min="0" max="100" step="0.01" value="0"></label>'
        +'<label>Processor cost treatment<select name="platform_absorbs_processor_fees"><option value="true">Business & Life absorbs it</option><option value="false">Passed through / funded separately</option></select></label>'
        +'<label>Risk allowance treatment<select name="platform_absorbs_risk_allowance"><option value="true">Business & Life bears it</option><option value="false">Funded separately</option></select></label>'
      +'</div></details>'
      +'<button class="primary" type="submit">Calculate minimum sustainable fee</button>'
      +'<div id="commissionPlannerResult"></div>'
    +'</form></section>';
}
function staffingInputs(){
  const labels={
    super_admin_remuneration:'Super Admin remuneration',
    country_admin:'Country Admins',
    territory_admin:'Territory Admins',
    specialist_admin:'Specialist Admins',
    support_staff:'Support staff',
    other_employee_contractor:'Other employees / contractors'
  };
  return Object.entries(labels).map(([key,label])=>'<div class="staffingPair"><label>'+esc(label)+' · count<input name="'+key+'_count" type="number" min="0" step="1" value="0"></label><label>Monthly cost / person<input name="'+key+'_cost" type="number" min="0" step="0.01" value="0"></label></div>').join('');
}
function costInput(name,label){return '<label>'+esc(label)+' (PHP/month)<input name="'+name+'" type="number" min="0" step="0.01" value="0"></label>'}
function adminFinanceScopeFields(op){
  const territories=state.overview?.territories||[],scope=op?.scope||{},ids=scope.territory_ids||[],fn=scope.function_codes||[];
  const territory=scope.country_wide
    ?'<label>Scope / territory<select name="territory_id"><option value="">Platform / country-wide</option>'+territories.map(t=>'<option value="'+esc(t.id)+'">'+esc(t.name)+'</option>').join('')+'</select></label>'
    :ids.length===1?'<input type="hidden" name="territory_id" value="'+esc(ids[0])+'"><div class="financeScopeNote">Territory scope #'+esc(ids[0])+'</div>'
    :'<label>Territory<select name="territory_id">'+ids.map(id=>{const t=territories.find(x=>Number(x.id)===Number(id));return '<option value="'+esc(id)+'">'+esc(t?.name||('Territory '+id))+'</option>'}).join('')+'</select></label>';
  const func=fn.length===1?'<input type="hidden" name="function_code" value="'+esc(fn[0])+'"><div class="financeScopeNote">Function: '+esc(fn[0])+'</div>'
    :fn.length>1?'<label>Function<select name="function_code">'+fn.map(x=>'<option value="'+esc(x)+'">'+esc(x.replaceAll('_',' '))+'</option>').join('')+'</select></label>'
    :'<input type="hidden" name="function_code" value="">';
  return territory+func;
}
function renderOperatingFinance(op){
  const s=op?.summary||{},a=op?.authority||{},budgets=op?.budgets||[],entries=op?.recent_entries||[];
  const canLedger=hasAny(['finance.ledger.manage']),canBudget=hasAny(['finance.budget.manage']);
  const isSuper=op?.actor_rank==='super_admin',canOwner=isSuper&&hasAny(['finance.owner_distribution.manage']);
  const scopeFields=adminFinanceScopeFields(op);
  const budgetForm=canBudget?'<details class="adminFinanceAdvanced"><summary>Create operating budget</summary><form id="adminBudgetForm" class="adminForm"><div class="financeFormGrid">'+scopeFields+'<label>Budget purpose<select name="budget_category">'+(op.catalog?.budget_categories||[]).map(x=>'<option value="'+esc(x)+'">'+esc(x.replaceAll('_',' '))+'</option>').join('')+'</select></label><label>Label<input name="label" required placeholder="September AI & API budget"></label><label>Allocated amount (PHP)<input name="allocated_amount" type="number" min="0.01" step="0.01" required></label><label>Period start<input name="period_start" type="date"></label><label>Period end<input name="period_end" type="date"></label></div><button class="primary" type="submit">Create budget</button><div id="adminBudgetResult"></div></form></details>':'';
  const entryTypes=(op.catalog?.entry_types||[]).filter(x=>x!=='owner_distribution');
  const ledgerForm=canLedger?'<details class="adminFinanceAdvanced"><summary>Record company income or payment</summary><form id="adminFinanceEntryForm" class="adminForm"><div class="financeFormGrid">'+scopeFields+'<label>Type<select name="entry_type">'+entryTypes.map(x=>'<option value="'+esc(x)+'">'+esc(x.replaceAll('_',' '))+'</option>').join('')+'</select></label><label>Category<select name="category">'+(op.catalog?.categories||[]).filter(x=>x!=='owner_distribution').map(x=>'<option value="'+esc(x)+'">'+esc(x.replaceAll('_',' '))+'</option>').join('')+'</select></label><label>Amount (PHP)<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Counterparty<input name="counterparty" placeholder="Railway / OpenAI / employee / client"></label><label>Evidence reference<input name="evidence_reference" placeholder="Invoice, receipt, payroll ref, provider statement"></label></div><label>Description<textarea name="description" placeholder="What this money movement is for"></textarea></label><button class="primary" type="submit">Record entry</button><div id="adminFinanceEntryResult"></div></form></details>':'';
  const owner=canOwner?'<section class="adminOwnerDistribution"><div><small>SUPER ADMIN ONLY</small><h3>Owner withdrawal / distribution</h3><p>This is not a business expense and not payroll. It reduces recorded company funds without distorting operating P/L.</p></div><form id="adminOwnerDistributionForm" class="adminForm"><div class="financeFormGrid"><label>Amount (PHP)<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Evidence / transfer reference<input name="evidence_reference" required placeholder="Bank transfer / board record / withdrawal ref"></label></div><label>Note<textarea name="description" required placeholder="Owner distribution reason / period"></textarea></label><button class="primary" type="submit">Record owner distribution</button><div id="adminOwnerDistributionResult"></div></form></section>':'';
  return '<section class="adminOperatingFinance">'
    +'<div class="adminFinanceHero"><div><small>'+esc(String(op.actor_rank||'admin').replaceAll('_',' ').toUpperCase())+' · COMPANY FINANCE</small><h2>Company money</h2><p>Income, operating budgets, bills, payroll and company payments in your delegated scope.</p></div><span class="badge">'+(op.scope?.country_wide?'Country / platform scope':(op.scope?.function_codes?.length?'Function scope':'Territory scope'))+'</span></div>'
    +'<div class="companyBalance"><span>Recorded company balance</span><strong>'+financeMoney(s.recorded_company_balance)+'</strong><small>'+esc(a.recorded_company_balance||'Internal recorded balance')+' · Provider/bank balance: '+esc(a.provider_balance_status||'UNKNOWN')+'</small></div>'
    +'<div class="financeSummary adminPrimaryFinance">'
      +'<div class="metric"><strong>'+financeMoney(s.income)+'</strong><span>Income</span></div>'
      +'<div class="metric"><strong>'+financeMoney(s.money_out)+'</strong><span>Money out</span></div>'
      +'<div class="metric"><strong>'+financeMoney(s.allocated_budget)+'</strong><span>Allocated budgets</span></div>'
      +'<div class="metric"><strong>'+financeMoney(s.payroll)+'</strong><span>Payroll / contractors</span></div>'
      +'<div class="metric"><strong>'+financeMoney(s.infrastructure)+'</strong><span>Infrastructure</span></div>'
      +'<div class="metric"><strong>'+financeMoney(s.api_ai)+'</strong><span>API & AI</span></div>'
      +(isSuper?'<div class="metric"><strong>'+financeMoney(s.owner_distributions)+'</strong><span>Owner distributions</span></div>':'')
      +'<div class="metric"><strong>'+financeMoney(s.recorded_unallocated)+'</strong><span>Recorded funds after budgets</span></div>'
    +'</div>'
    +'<div class="sectionTitle"><h3>Operating budgets</h3><span class="muted">'+esc(s.budget_count||0)+' active / recorded</span></div>'
    +(budgets.length?'<div class="list">'+budgets.slice(0,20).map(b=>'<div class="row"><div class="rowHeader"><strong>'+esc(b.label)+'</strong><span class="status">'+financeMoney(b.allocated_amount,b.currency_code||'PHP')+'</span></div><span class="muted">'+esc(String(b.budget_category).replaceAll('_',' '))+(b.territory_name?' · '+esc(b.territory_name):'')+(b.function_code?' · '+esc(b.function_code.replaceAll('_',' ')):'')+'</span></div>').join('')+'</div>':'<div class="empty">No operating budgets recorded in this Admin scope yet.</div>')
    +budgetForm
    +'<div class="sectionTitle"><h3>Recent company money</h3></div>'
    +(entries.length?'<div class="list">'+entries.slice(0,30).map(e=>'<div class="row"><div class="rowHeader"><strong>'+esc(String(e.entry_type).replaceAll('_',' '))+' · '+esc(String(e.category).replaceAll('_',' '))+'</strong><span class="'+(e.direction==='in'?'moneyPos':'moneyNeg')+'">'+(e.direction==='in'?'+':'−')+financeMoney(e.amount,e.currency_code||'PHP')+'</span></div><span class="muted">'+esc(e.counterparty||e.description||'')+(e.evidence_reference?' · '+esc(e.evidence_reference):'')+'</span></div>').join('')+'</div>':'<div class="empty">No company finance entries recorded in this scope yet.</div>')
    +ledgerForm+owner
    +'<div class="financeTruth"><strong>Accounting boundary</strong><span>Owner distribution is separate from expenses and payroll. Budgets are planning allocations. Provider/bank balance remains unavailable until verified provider evidence exists.</span></div>'
    +'</section>';
}
async function financePanel(){
  const operating=await api('/api/admin/finance/operating');
  const operatingHtml=renderOperatingFinance(operating);
  if(!hasAny(['finance.summary.view'])){
    return hero()+operatingHtml+'<details class="adminFinanceAdvanced"><summary>Advanced platform economics</summary><div class="notice">Unit economics and payment-specific controls are not delegated to this Admin account.</div></details>';
  }
  const [k,monetizationV2,digitalBenchmarks,subscriptionBilling]=await Promise.all([
    api('/api/payments/admin/unit-economics'+financeScopeQuery()),
    api('/api/payments/admin/monetization-v2/model'),
    api('/api/payments/admin/digital-payment-incentive/benchmarks'),
    api('/api/payments/admin/subscriptions/readiness')
  ]);
  const p=k.period||{};
  const serviceRows=k.services||[];
  const evidence=k.evidence_breakdown||[];
  const costs=k.recent_cost_entries||[];
  const promo=k.promotion_economics||{};
  const promoTotals=(promo.totals||[]).find(x=>x.phase==='promotional')||{};
  const postPromoTotals=(promo.totals||[]).find(x=>x.phase==='post_promo')||{};
  const promoServices=promo.services||[];
  const promoDirect=promo.direct_cost||{};
  const promoDirectNow=promoDirect.promotional||{};
  const postPromoDirect=promoDirect.post_promo||{};
  const promoDirectServices=promoDirect.services||[];
  const canManage=hasAny(['finance.cost.manage']);
  const fixedTerritory=financeTerritoryId();
  const territoryField=fixedTerritory
    ?'<input type="hidden" name="territory_id" value="'+esc(fixedTerritory)+'"><div class="financeScopeNote">Cost scope: delegated territory #'+esc(fixedTerritory)+'</div>'
    :'<label>Territory / allocation scope<select name="territory_id"><option value="">Shared / country-wide</option>'+((state.overview?.territories||[]).map(t=>'<option value="'+esc(t.id)+'">'+esc(t.name)+'</option>').join(''))+'</select></label>';
  const pricingTerritoryField=fixedTerritory
    ?'<input type="hidden" name="territory_id" value="'+esc(fixedTerritory)+'"><div class="financeScopeNote">Simulation scope: delegated territory #'+esc(fixedTerritory)+'</div>'
    :'<label>Scenario territory<select name="territory_id"><option value="">Country-wide / shared view</option>'+((state.overview?.territories||[]).map(t=>'<option value="'+esc(t.id)+'">'+esc(t.name)+'</option>').join(''))+'</select></label>';
  const pricingForm='<div class="sectionTitle"><h3>Pricing Lab — simulation only</h3></div>'
    +'<form id="pricingScenarioForm" class="adminForm pricingLabForm">'
      +'<div class="notice"><strong>No live fee is changed here.</strong><br>Enter hypothetical commission percentages to compare projected revenue with the costs already recorded in Finance.</div>'
      +'<div class="financeFormGrid">'
        +'<label>Marketplace %<input name="marketplace" type="number" min="0" max="100" step="0.01" required placeholder="Hypothetical %"></label>'
        +'<label>Delivery %<input name="delivery" type="number" min="0" max="100" step="0.01" required placeholder="Hypothetical %"></label>'
        +'<label>Supplier B2B %<input name="supplier" type="number" min="0" max="100" step="0.01" required placeholder="Hypothetical %"></label>'
        +'<label>Local Services %<input name="local_services" type="number" min="0" max="100" step="0.01" required placeholder="Hypothetical %"></label>'
        +pricingTerritoryField
      +'</div>'
      +'<button class="primary" type="submit">Run non-charging simulation</button>'
      +'<div id="pricingScenarioResult"></div>'
    +'</form>';
  const costForm=canManage?'<div class="sectionTitle"><h3>Record platform cost</h3></div><form id="financeCostForm" class="adminForm"><div class="financeFormGrid"><label>Cost code<input name="cost_code" required placeholder="railway-2026-09"></label><label>Amount (PHP)<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Category<select name="cost_category"><option value="infrastructure">Infrastructure</option><option value="database">Database</option><option value="storage">Storage</option><option value="bandwidth">Bandwidth</option><option value="monitoring_security">Monitoring / security</option><option value="support">Support</option><option value="maps_api">Maps / routing API</option><option value="ai_api">AI / API</option><option value="notification">Notifications</option><option value="marketing">Marketing</option><option value="referral_reward">Referral reward</option><option value="promo_subsidy">Promo subsidy</option><option value="delivery_subsidy">Delivery subsidy</option><option value="refund_loss">Refund loss</option><option value="chargeback_dispute">Chargeback / dispute</option><option value="fraud_bad_debt">Fraud / bad debt</option><option value="operator_share">Operator share</option><option value="legal_compliance">Legal / compliance</option><option value="accounting">Accounting</option><option value="payroll_contractor">Payroll / contractor</option><option value="insurance_licence">Insurance / licence</option><option value="payment_provider_other">Payment provider other</option><option value="other">Other</option></select></label><label>Nature<select name="cost_nature"><option value="fixed">Fixed</option><option value="semi_fixed">Semi-fixed</option><option value="variable">Variable</option></select></label><label>Evidence class<select name="evidence_class"><option value="actual">Actual</option><option value="accrued">Accrued</option><option value="estimated">Estimated</option><option value="budget">Budget</option></select></label><label>Service<select name="service_scope"><option value="shared">Shared platform</option><option value="marketplace">Marketplace</option><option value="delivery">Delivery</option><option value="supplier">Supplier B2B</option><option value="local_services">Local Services</option><option value="accounting_pro">Accounting Pro</option><option value="enterprise">Enterprise / operator</option></select></label>'+territoryField+'<label>Evidence / source reference<input name="evidence_reference" required placeholder="Invoice ID, provider statement, estimate method or budget source"></label></div><label>Description<textarea name="description" placeholder="What this cost covers and why it belongs to this scope"></textarea></label><button class="primary" type="submit">Record cost</button><div id="financeCostResult"></div></form>':'';
  return hero()+operatingHtml+monetizationV2Card(monetizationV2)+subscriptionBillingCard(subscriptionBilling)+digitalPaymentIncentiveCard(digitalBenchmarks)+commissionPlannerForm(k,promo)+'<details class="adminFinanceAdvanced adminEconomicsAdvanced"><summary>Advanced unit economics & monetization</summary><div class="adminFinanceAdvancedBody">'
    +'<p class="moduleIntro">Unit economics for '+esc(p.from?new Date(p.from).toLocaleDateString():'current period')+' → '+esc(p.to?new Date(p.to).toLocaleDateString():'now')+'. Actual + accrued costs drive operating result; estimates and budgets stay visible separately.</p>'
    +'<div class="financeSummary">'
      +'<div class="metric"><strong>'+financeMoney(k.gross_payment_volume)+'</strong><span>Gross payment volume · context, not revenue</span></div>'
      +'<div class="metric"><strong>'+financeMoney(k.platform_revenue)+'</strong><span>Platform revenue</span></div>'
      +'<div class="metric"><strong>'+financeMoney(k.variable_costs)+'</strong><span>Variable costs</span></div>'
      +'<div class="metric"><strong class="'+financeTone(k.contribution)+'">'+financeMoney(k.contribution)+'</strong><span>Contribution</span></div>'
      +'<div class="metric"><strong>'+financeMoney(k.allocated_fixed_cost)+'</strong><span>Fixed / semi-fixed costs</span></div>'
      +'<div class="metric"><strong class="'+financeTone(k.operating_profit)+'">'+financeMoney(k.operating_profit)+'</strong><span>Operating profit / loss</span></div>'
      +'<div class="metric"><strong>'+financePct(k.net_margin_pct)+'</strong><span>Net margin</span></div>'
      +'<div class="metric"><strong>'+(k.break_even_transactions==null?'—':esc(k.break_even_transactions))+'</strong><span>Break-even transactions</span></div>'
    +'</div>'
    +'<div class="financeTruth"><strong>Per completed transaction</strong><span>Revenue '+financeMoney(k.revenue_per_completed_transaction)+' · Variable cost '+financeMoney(k.variable_cost_per_completed_transaction)+' · Contribution '+financeMoney(k.contribution_per_completed_transaction)+' · Operating result '+financeMoney(k.operating_profit_per_completed_transaction)+'</span></div>'
    +'<div class="sectionTitle"><h3>Profitability by service</h3></div>'
    +rows(serviceRows,x=>'<div class="row"><div class="rowHeader"><strong>'+esc(x.service_scope)+'</strong><span class="status">'+esc(x.completed_transactions)+' tx</span></div><div class="financeLine"><span>Gross '+financeMoney(x.gross_value)+'</span><span>Revenue '+financeMoney(x.revenue)+'</span><span>Variable '+financeMoney(x.variable_cost)+'</span><span>Fixed '+financeMoney(x.allocated_fixed_cost)+'</span><strong class="'+financeTone(x.operating_profit)+'">P/L '+financeMoney(x.operating_profit)+'</strong></div><span class="muted">Contribution margin '+financePct(x.contribution_margin_pct)+' · Net margin '+financePct(x.net_margin_pct)+'</span></div>')
    +'<div class="sectionTitle"><h3>Cost evidence quality</h3></div>'
    +(evidence.length?'<div class="financeEvidence">'+evidence.map(x=>'<div class="card"><strong>'+financeMoney(x.amount)+'</strong><span>'+esc(x.evidence_class)+' · '+esc(x.entries)+' records</span></div>').join('')+'</div>':'<div class="empty">No platform cost evidence recorded in this period.</div>')
    +'<div class="sectionTitle"><h3>Promotional cohorts</h3></div>'
    +'<div class="financeSummary financePromoSummary">'
      +'<div class="metric"><strong>'+esc(promo.active_promotional_subjects||0)+'</strong><span>Active promotional cohorts</span></div>'
      +'<div class="metric"><strong>'+esc(promo.trials_started||0)+'</strong><span>Trials started this period</span></div>'
      +'<div class="metric"><strong>'+esc(promo.trials_ending||0)+'</strong><span>Trials ended this period</span></div>'
      +'<div class="metric"><strong>'+esc(promo.expired_subjects||0)+'</strong><span>Expired trial subjects</span></div>'
      +'<div class="metric"><strong>'+esc(promoTotals.completed_events||0)+'</strong><span>Promo completions this period</span></div>'
      +'<div class="metric"><strong>'+financeMoney(promoTotals.gross_value||0)+'</strong><span>Promo gross service value</span></div>'
      +'<div class="metric"><strong>'+esc(postPromoTotals.completed_events||0)+'</strong><span>Post-promo completions</span></div>'
      +'<div class="metric"><strong>'+financePct(promo.post_promo_activity_conversion_pct)+'</strong><span>Post-promo activity conversion</span></div>'
    +'</div>'
    +'<div class="financeTruth"><strong>Monetization status</strong><span>Promotional duration: Marketplace '+esc(promo.promotional_days_by_service?.marketplace||90)+' days · Delivery '+esc(promo.promotional_days_by_service?.delivery||30)+' days · Supplier '+esc(promo.promotional_days_by_service?.supplier||90)+' days · Local Services '+esc(promo.promotional_days_by_service?.local_services||90)+' days · Paid conversion: '+(promo.paid_conversion_status==='NOT_AVAILABLE_UNTIL_ACTIVE_FEE_POLICY'?'not available until an active fee policy collects a platform fee':'available from configured fee evidence')+'. Activity conversion means an expired trial subject completed at least one later service; it is not the same as paid conversion.</span></div>'
    +'<div class="sectionTitle"><h3>Promotion activity by service</h3></div>'
    +(promoServices.length?rows(promoServices,x=>'<div class="row"><div class="rowHeader"><strong>'+esc(x.service_scope)+'</strong><span class="status">'+esc(x.phase)+'</span></div><div class="financeLine"><span>'+esc(x.completed_events)+' completions</span><span>'+esc(x.active_subjects)+' subjects</span><span>Gross '+financeMoney(x.gross_value)+'</span></div></div>'):'<div class="empty">No promotional or post-promo completion events in this reporting period.</div>')
    +'<div class="sectionTitle"><h3>Direct promotional cost</h3></div>'
    +'<div class="financeSummary">'
      +'<div class="metric"><strong>'+financeMoney(promoDirectNow.total_direct_cost||0)+'</strong><span>Direct promo cost</span></div>'
      +'<div class="metric"><strong>'+financeMoney(promoDirectNow.direct_processor_cost||0)+'</strong><span>Promo processor cost</span></div>'
      +'<div class="metric"><strong>'+financeMoney(promoDirectNow.direct_ledger_cost||0)+'</strong><span>Explicit Finance-ledger cost</span></div>'
      +'<div class="metric"><strong>'+financeMoney(promoDirectNow.direct_cost_per_completion||0)+'</strong><span>Direct cost / promo completion</span></div>'
      +'<div class="metric"><strong>'+financeMoney(promoDirectNow.direct_cost_per_active_subject||0)+'</strong><span>Direct cost / active promo subject</span></div>'
      +'<div class="metric"><strong>'+financeMoney(postPromoDirect.total_direct_cost||0)+'</strong><span>Post-promo direct cost</span></div>'
    +'</div>'
    +'<div class="financeTruth"><strong>Evidence boundary</strong><span>'+esc(promoDirect.warning||'Direct costs only.')+'<br>Coverage: '+esc(promoDirect.coverage_status||'DIRECT_ONLY_EXCLUDES_SHARED_FIXED')+' · '+esc(promoDirect.terminology||'DIRECT_PROMOTIONAL_SUBSIDY_FLOOR')+'. This is a minimum evidenced subsidy/cost floor, not the full economic cost of the promotion.</span></div>'
    +'<div class="sectionTitle"><h3>Direct promo cost by service</h3></div>'
    +(promoDirectServices.length?rows(promoDirectServices,x=>'<div class="row"><div class="rowHeader"><strong>'+esc(x.service_scope)+'</strong><span class="status">'+esc(x.phase)+'</span></div><div class="financeLine"><span>Processor '+financeMoney(x.direct_processor_cost)+'</span><span>Ledger '+financeMoney(x.direct_ledger_cost)+'</span><strong>Total '+financeMoney(x.total_direct_cost)+'</strong></div><span class="muted">Cost/completion '+financeMoney(x.direct_cost_per_completion||0)+' · Cost/active subject '+financeMoney(x.direct_cost_per_active_subject||0)+'</span></div>'):'<div class="empty">No directly attributable payment/provider cost for completed promo events in this period.</div>')
    +pricingForm
    +costForm
    +'<div class="sectionTitle"><h3>Recent cost entries</h3></div>'
    +rows(costs,x=>'<div class="row"><div class="rowHeader"><strong>'+esc(x.cost_code)+'</strong><span class="status">'+esc(x.evidence_class)+'</span></div><div class="financeLine"><span>'+financeMoney(x.amount,x.currency_code||'PHP')+'</span><span>'+esc(x.cost_category)+'</span><span>'+esc(x.cost_nature)+'</span><span>'+esc(x.service_scope)+'</span></div><span class="muted">'+esc(x.description||x.evidence_reference||'')+'</span></div>')
    +'</div></details>';
}
async function wireSubscriptionBilling(){
  const form=document.getElementById('subscriptionPolicyDraftForm');if(!form)return;
  form.onsubmit=async e=>{
    e.preventDefault();const fd=new FormData(form),out=document.getElementById('subscriptionPolicyDraftResult');
    const amount=fd.get('monthly_amount');
    const payload={
      service_scope:fd.get('service_scope'),
      policy_code:fd.get('policy_code')||null,
      monthly_amount:amount===''?null:Number(amount),
      description:fd.get('description')||'',
      reason:'Owner subscription pricing draft'
    };
    out.innerHTML='<div class="notice">Creating draft…</div>';
    try{
      const x=await api('/api/payments/admin/subscriptions/policies/drafts',{method:'POST',body:JSON.stringify(payload)});
      out.innerHTML='<div class="notice">Draft '+esc(x.policy_code)+' v'+esc(x.version)+' created. Billing is still inactive.</div>';
      const panel=document.getElementById('adminPanel');if(panel){panel.innerHTML=await financePanel();await wireFinance()}
    }catch(err){out.innerHTML='<div class="error">'+esc(err.message)+'</div>'}
  };
}
async function wireDigitalPaymentIncentive(){
  const form=document.getElementById('digitalPaymentIncentiveForm');if(!form)return;
  form.onsubmit=async e=>{
    e.preventDefault();const fd=new FormData(form),out=document.getElementById('digitalPaymentIncentiveResult');
    const payload={
      territory_id:financeTerritoryId()||null,
      commercial_amount:Number(fd.get('commercial_amount')),
      rail_code:fd.get('rail_code'),
      cash_handling_cost_pct:Number(fd.get('cash_handling_cost_pct')||0),
      cash_handling_fixed_cost:Number(fd.get('cash_handling_fixed_cost')||0),
      provider_fee_tax_pct:Number(fd.get('provider_fee_tax_pct')||0),
      return_savings_pct:Number(fd.get('return_savings_pct')||0),
      credit_cap:fd.get('credit_cap')===''?null:Number(fd.get('credit_cap')),
      growth_budget_remaining:fd.get('growth_budget_remaining')===''?null:Number(fd.get('growth_budget_remaining'))
    };
    out.innerHTML='<div class="notice">Calculating payment-rail economics…</div>';
    try{const x=await api('/api/payments/admin/digital-payment-incentive/scenario',{method:'POST',body:JSON.stringify(payload)});out.innerHTML=renderDigitalIncentiveResult(x)}
    catch(err){out.innerHTML='<div class="error">'+esc(err.message)+'</div>'}
  };
}
async function wireMonetizationV2(){
  const rowsBox=document.getElementById('sharedCostScopeRows'),add=document.getElementById('addSharedCostScope'),form=document.getElementById('sharedCostScenarioForm');
  if(add&&rowsBox)add.onclick=()=>{const count=rowsBox.querySelectorAll('[data-shared-cost-row]').length+1;rowsBox.insertAdjacentHTML('beforeend',sharedCostScopeRow(count));};
  if(rowsBox)rowsBox.onclick=e=>{const b=e.target.closest('[data-remove-shared-cost]');if(!b)return;const all=rowsBox.querySelectorAll('[data-shared-cost-row]');if(all.length<=1)return;b.closest('[data-shared-cost-row]')?.remove();};
  if(form)form.onsubmit=async e=>{e.preventDefault();const fd=new FormData(form),out=document.getElementById('sharedCostScenarioResult');const scopes=[...form.querySelectorAll('[data-shared-cost-row]')].map(r=>({scope_id:r.querySelector('[data-sc="id"]').value,scope_name:r.querySelector('[data-sc="name"]').value,driver_value:Number(r.querySelector('[data-sc="driver"]').value||0)}));out.innerHTML='<div class="notice">Calculating shared cost allocation…</div>';try{const x=await api('/api/payments/admin/shared-cost-allocation-scenario',{method:'POST',body:JSON.stringify({total_amount:Number(fd.get('total_amount')),driver_code:fd.get('driver_code'),scopes})});out.innerHTML=renderSharedCostResult(x)}catch(err){out.innerHTML='<div class="error">'+esc(err.message)+'</div>'}};
}
async function wireCommissionPlanner(){
  const form=document.getElementById('commissionPlannerForm');if(!form)return;
  form.onsubmit=async e=>{
    e.preventDefault();const fd=new FormData(form),out=document.getElementById('commissionPlannerResult');
    const staffing={};
    for(const key of ['super_admin_remuneration','country_admin','territory_admin','specialist_admin','support_staff','other_employee_contractor']){
      staffing[key]={count:Number(fd.get(key+'_count')||0),monthly_cost_per_person:Number(fd.get(key+'_cost')||0)};
    }
    const monthlyCosts={};
    for(const key of ['infrastructure','database_storage_monitoring','ai_api_maps_notifications','support_operations','marketing_growth','legal_accounting_compliance','insurance_licences','other_overhead'])monthlyCosts[key]=Number(fd.get(key)||0);
    const payload={
      territory_id:financeTerritoryId()||null,
      completed_events_per_month:Number(fd.get('completed_events_per_month')),
      average_fee_base_value:Number(fd.get('average_fee_base_value')),
      fee_eligible_share_pct:Number(fd.get('fee_eligible_share_pct')),
      online_payment_share_pct:Number(fd.get('online_payment_share_pct')),
      processor_rate_pct:Number(fd.get('processor_rate_pct')||0),
      processor_fixed_per_online_event:Number(fd.get('processor_fixed_per_online_event')||0),
      risk_allowance_pct:Number(fd.get('risk_allowance_pct')||0),
      safety_reserve_pct:Number(fd.get('safety_reserve_pct')||0),
      growth_surplus_pct:Number(fd.get('growth_surplus_pct')||0),
      paid_profiles:{
        merchant:Number(fd.get('merchant_paid_profiles')||0),
        supplier:Number(fd.get('supplier_paid_profiles')||0),
        local_services:Number(fd.get('local_services_paid_profiles')||0)
      },
      subscription_amounts:{
        merchant:Number(fd.get('merchant_subscription_amount')||0),
        supplier:Number(fd.get('supplier_subscription_amount')||0),
        local_services:Number(fd.get('local_services_subscription_amount')||0)
      },
      delivery_eligible_price:Number(fd.get('delivery_eligible_price')||0),
      delivery_production_rate_pct:Number(fd.get('delivery_production_rate_pct')||0),
      platform_absorbs_processor_fees:fd.get('platform_absorbs_processor_fees')!=='false',
      platform_absorbs_risk_allowance:fd.get('platform_absorbs_risk_allowance')!=='false',
      staffing,monthly_costs:monthlyCosts
    };
    out.innerHTML='<div class="notice">Calculating scenario…</div>';
    try{const s=await api('/api/payments/admin/commission-planner',{method:'POST',body:JSON.stringify(payload)});out.innerHTML=renderCommissionPlannerResult(s)}
    catch(err){out.innerHTML='<div class="error">'+esc(err.message)+'</div>'}
  };
}
async function wireOperatingFinance(){
  const refresh=async()=>{const panel=document.getElementById('adminPanel');if(panel){panel.innerHTML=await financePanel();await wireFinance()}};
  const budget=document.getElementById('adminBudgetForm');
  if(budget)budget.onsubmit=async e=>{e.preventDefault();const fd=new FormData(budget),out=document.getElementById('adminBudgetResult');try{await api('/api/admin/finance/budgets',{method:'POST',body:JSON.stringify({territory_id:fd.get('territory_id')||null,function_code:fd.get('function_code')||'',budget_category:fd.get('budget_category'),label:fd.get('label'),allocated_amount:Number(fd.get('allocated_amount')),period_start:fd.get('period_start')||null,period_end:fd.get('period_end')||null,reason:'Admin operating budget'})});out.innerHTML='<div class="notice">Budget recorded.</div>';await refresh()}catch(err){out.innerHTML='<div class="error">'+esc(err.message)+'</div>'}};
  const entry=document.getElementById('adminFinanceEntryForm');
  if(entry)entry.onsubmit=async e=>{e.preventDefault();const fd=new FormData(entry),out=document.getElementById('adminFinanceEntryResult'),key='admin-fin-'+Date.now()+'-'+Math.random().toString(16).slice(2);try{await api('/api/admin/finance/entries',{method:'POST',headers:{'Idempotency-Key':key},body:JSON.stringify({territory_id:fd.get('territory_id')||null,function_code:fd.get('function_code')||'',entry_type:fd.get('entry_type'),category:fd.get('category'),amount:Number(fd.get('amount')),counterparty:fd.get('counterparty')||'',evidence_reference:fd.get('evidence_reference')||'',description:fd.get('description')||''})});out.innerHTML='<div class="notice">Company finance entry recorded.</div>';await refresh()}catch(err){out.innerHTML='<div class="error">'+esc(err.message)+'</div>'}};
  const owner=document.getElementById('adminOwnerDistributionForm');
  if(owner)owner.onsubmit=async e=>{e.preventDefault();const fd=new FormData(owner),out=document.getElementById('adminOwnerDistributionResult'),key='owner-dist-'+Date.now()+'-'+Math.random().toString(16).slice(2);try{await api('/api/admin/finance/entries',{method:'POST',headers:{'Idempotency-Key':key},body:JSON.stringify({entry_type:'owner_distribution',category:'owner_distribution',amount:Number(fd.get('amount')),evidence_reference:fd.get('evidence_reference'),description:fd.get('description'),function_code:'',territory_id:null})});out.innerHTML='<div class="notice">Owner distribution recorded separately from company expenses.</div>';await refresh()}catch(err){out.innerHTML='<div class="error">'+esc(err.message)+'</div>'}};
}
async function wireFinance(){
  await wireOperatingFinance();
  await wireMonetizationV2();
  await wireSubscriptionBilling();
  await wireDigitalPaymentIncentive();
  await wireCommissionPlanner();
  const pricing=document.getElementById('pricingScenarioForm');
  if(pricing)pricing.onsubmit=async e=>{
    e.preventDefault();
    const fd=new FormData(pricing),out=document.getElementById('pricingScenarioResult');
    const payload={
      territory_id:fd.get('territory_id')||null,
      rates:{
        marketplace:Number(fd.get('marketplace')),
        delivery:Number(fd.get('delivery')),
        supplier:Number(fd.get('supplier')),
        local_services:Number(fd.get('local_services'))
      }
    };
    out.innerHTML='<div class="notice">Running scenario against canonical Finance data…</div>';
    try{
      const scenario=await api('/api/payments/admin/pricing-scenario',{method:'POST',body:JSON.stringify(payload)});
      out.innerHTML=renderPricingScenario(scenario);
    }catch(err){out.innerHTML='<div class="error">'+esc(err.message)+'</div>'}
  };
  const form=document.getElementById('financeCostForm');
  if(form)form.onsubmit=async e=>{
    e.preventDefault();
    const fd=new FormData(form),out=document.getElementById('financeCostResult');
    const payload={
      cost_code:fd.get('cost_code'),amount:Number(fd.get('amount')),
      cost_category:fd.get('cost_category'),cost_nature:fd.get('cost_nature'),
      evidence_class:fd.get('evidence_class'),service_scope:fd.get('service_scope'),
      territory_id:fd.get('territory_id')||null,evidence_reference:fd.get('evidence_reference'),
      description:fd.get('description')||'',currency_code:'PHP',incurred_at:new Date().toISOString(),
      reason:'Finance cost ledger entry'
    };
    const key='finance-cost-'+Date.now()+'-'+Math.random().toString(16).slice(2);
    try{
      await api('/api/payments/admin/costs',{method:'POST',headers:{'Idempotency-Key':key},body:JSON.stringify(payload)});
      out.innerHTML='<div class="notice">Cost recorded in the canonical ledger and included according to its evidence class.</div>';
      const panel=document.getElementById('adminPanel');if(panel){panel.innerHTML=await financePanel();await wireFinance()}
    }catch(err){out.innerHTML='<div class="error">'+esc(err.message)+'</div>'}
  };
}
async function auditPanel(){
  const [audit,metric]=await Promise.all([
    hasAny(['audit.view'])?api('/api/admin/audit').catch(e=>({error:e.message})):Promise.resolve([]),
    hasAny(['metrics.view'])?api('/api/admin/metrics').catch(e=>({error:e.message})):Promise.resolve({})
  ]);
  const events=Array.isArray(audit)?audit:(audit.events||[]);
  return hero()+'<p class="moduleIntro">Immutable privileged activity and scoped operational metrics.</p>'+(audit.error?'<div class="notice">'+esc(audit.error)+'</div>':rows(events,x=>'<div class="row"><div class="rowHeader"><strong>'+esc(x.event_code||'Admin event')+'</strong><span class="status">'+esc(x.created_at||'')+'</span></div><span class="muted">'+esc(x.permission_code||'')+' '+esc(x.reason||'')+'</span></div>'))+(metric.error?'<div class="notice">'+esc(metric.error)+'</div>':'');
}
function delegationForm(){
  const allowedRanks=(state.catalog?.ranks||[]).filter(r=>(state.catalog?.delegable_roles||[]).includes(r.code));
  const defaultRank=allowedRanks.some(r=>r.code==='specialist')?'specialist':(allowedRanks.at(-1)?.code||'');
  const functions=(state.catalog?.functions||[]).filter(f=>f.can_delegate);
  const territories=state.overview?.territories||[];
  return '<form id="delegateForm" class="adminForm"><h3>Delegate responsibility</h3><label>Account email<input name="target_email" type="email" required autocomplete="off"></label><label>Rank<select name="admin_role" id="delegateRole">'+allowedRanks.map(r=>'<option value="'+esc(r.code)+'" '+(r.code===defaultRank?'selected':'')+'>'+esc(r.label)+'</option>').join('')+'</select></label><label>Territory / scope<select name="territory_id" id="delegateTerritory"><option value="">Country scope / not applicable</option>'+territories.map(t=>'<option value="'+esc(t.id)+'">'+esc(t.name)+'</option>').join('')+'</select></label><div><strong>Functions</strong><div id="functionGrid" class="functionGrid"></div></div><label>Reason<textarea name="reason" required placeholder="Why this responsibility is being delegated"></textarea></label><button class="primary" type="submit">Delegate functions</button><div id="delegateResult"></div></form>';
}
function drawFunctionChoices(){
  const role=document.getElementById('delegateRole')?.value||'specialist';
  const grid=document.getElementById('functionGrid');if(!grid)return;
  const f=(state.catalog?.functions||[]).filter(x=>x.can_delegate&&x.assignable_to.includes(role));
  grid.innerHTML=f.map(x=>'<label class="functionChoice"><input type="checkbox" name="function_codes" value="'+esc(x.code)+'"><span><strong>'+esc(x.label)+'</strong><small>'+esc(x.description)+'</small></span></label>').join('')||'<div class="empty">No function bundle can be delegated to this rank from your current authority.</div>';
  const territory=document.getElementById('delegateTerritory');
  if(territory){
    if(role==='territory_admin'){territory.required=true}
    else{territory.required=false}
  }
}
async function teamPanel(){
  state.assignments=await api('/api/admin/assignments');
  return hero()+'<p class="moduleIntro">Ranks define scope and hierarchy. Functions define the actual work delegated to each person.</p>'+delegationForm()+'<div class="sectionTitle"><h3>Delegated team</h3></div>'+rows(state.assignments,x=>'<div class="row"><div class="rowHeader"><strong>'+esc(x.display_name||x.email)+'</strong><span class="status">'+esc(rankLabel(x.effective_rank||x.authority_rank||x.admin_role))+'</span></div><span class="muted">'+esc(x.territory_name||x.country_code||'PH')+'</span><div class="permissionPills">'+(x.functions||[]).map(f=>'<span>'+esc(f)+'</span>').join('')+'</div></div>');
}
async function wireTeam(){
  drawFunctionChoices();
  const role=document.getElementById('delegateRole');if(role)role.onchange=drawFunctionChoices;
  const form=document.getElementById('delegateForm');if(!form)return;
  form.onsubmit=async e=>{
    e.preventDefault();const fd=new FormData(form);
    const payload={target_email:fd.get('target_email'),admin_role:fd.get('admin_role'),territory_id:fd.get('territory_id')||null,function_codes:fd.getAll('function_codes'),reason:fd.get('reason')};
    const out=document.getElementById('delegateResult');
    try{await api('/api/admin/assignments',{method:'POST',body:JSON.stringify(payload)});out.innerHTML='<div class="notice">Delegation saved and audited.</div>';await loadBase();state.active='team';shell();await renderActive()}catch(err){out.innerHTML='<div class="error">'+esc(err.message)+'</div>'}
  };
}
async function renderActive(){
  const p=document.getElementById('adminPanel');if(!p)return;
  p.innerHTML='<div class="adminLoading">Loading scoped Admin data…</div>';
  if(state.active==='overview')p.innerHTML=overviewPanel();
  else if(state.active==='profiles')p.innerHTML=profilesPanel();
  else if(state.active==='support'){p.innerHTML=await queuePanel('support');bindSupportQueue()}
  else if(state.active==='safety')p.innerHTML=await queuePanel('safety');
  else if(state.active==='territories')p.innerHTML=territoriesPanel();
  else if(state.active==='finance'){p.innerHTML=await financePanel();await wireFinance()}
  else if(state.active==='audit')p.innerHTML=await auditPanel();
  else if(state.active==='team'){p.innerHTML=await teamPanel();await wireTeam()}
}
async function loadBase(){
  const bootstrap=await api('/api/admin/bootstrap');
  const me=bootstrap.me||{};
  if(!me.is_admin)throw Object.assign(new Error('No delegated Admin workspace is available for this account.'),{code:'NOT_ADMIN'});
  state.me=me;state.catalog=bootstrap.catalog||{};state.overview=bootstrap.overview||{};
}
async function boot(){
  if(!token()){root.className='adminDenied';root.innerHTML='<h2>Admin sign-in required</h2><p>Open the main app and sign in with the account that received delegated Admin authority.</p><a class="adminButton" href="/">Return to app</a>';return}
  try{await loadBase();shell();await renderActive()}catch(e){root.className='adminDenied';root.innerHTML='<h2>Admin workspace unavailable</h2><p>'+esc(e.message)+'</p><a class="adminButton" href="/">Return to app</a>'}
}
boot();
