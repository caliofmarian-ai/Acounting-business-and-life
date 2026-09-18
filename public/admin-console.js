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
  {id:'finance',label:'Finance',any:['finance.summary.view','accounting.export.view','payment.view','payment.manage','payment.reconcile','settlement.manage']},
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
  return hero()+'<p class="moduleIntro">'+(isSupport?'Support tickets assigned or visible in your scope.':'Incident queue visible under your delegated Trust & Safety authority.')+'</p>'+rows(list,x=>'<div class="row"><div class="rowHeader"><strong>'+esc(x.subject||x.category||('Case #'+x.id))+'</strong><span class="status">'+esc(x.status||'open')+'</span></div><span class="muted">'+esc(x.requester_name||x.reporter_name||x.priority||'')+'</span></div>');
}
function territoriesPanel(){
  return hero()+'<p class="moduleIntro">Operating cells visible to your assignment.</p>'+rows(state.overview?.territories||[],x=>'<div class="row"><div class="rowHeader"><strong>'+esc(x.name)+'</strong><span class="status">'+esc(x.status)+'</span></div><span class="muted">'+esc(x.territory_type)+' · '+esc(x.code||'')+'</span></div>');
}
async function financePanel(){
  let m={};try{m=await api('/api/admin/metrics')}catch(e){m={error:e.message}}
  return hero()+'<p class="moduleIntro">Finance, payment and settlement visibility follows your exact delegated permissions.</p>'+metrics()+(m.error?'<div class="notice">'+esc(m.error)+'</div>':'<div class="row"><strong>Operational metrics endpoint connected</strong><span class="muted">Detailed finance actions stay permission-gated by the backend.</span></div>');
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
  const functions=(state.catalog?.functions||[]).filter(f=>f.can_delegate);
  const territories=state.overview?.territories||[];
  return '<form id="delegateForm" class="adminForm"><h3>Delegate responsibility</h3><label>Account email<input name="target_email" type="email" required autocomplete="off"></label><label>Rank<select name="admin_role" id="delegateRole">'+allowedRanks.map(r=>'<option value="'+esc(r.code)+'">'+esc(r.label)+'</option>').join('')+'</select></label><label>Territory / scope<select name="territory_id" id="delegateTerritory"><option value="">Country scope / not applicable</option>'+territories.map(t=>'<option value="'+esc(t.id)+'">'+esc(t.name)+'</option>').join('')+'</select></label><div><strong>Functions</strong><div id="functionGrid" class="functionGrid"></div></div><label>Reason<textarea name="reason" required placeholder="Why this responsibility is being delegated"></textarea></label><button class="primary" type="submit">Delegate functions</button><div id="delegateResult"></div></form>';
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
  else if(state.active==='support')p.innerHTML=await queuePanel('support');
  else if(state.active==='safety')p.innerHTML=await queuePanel('safety');
  else if(state.active==='territories')p.innerHTML=territoriesPanel();
  else if(state.active==='finance')p.innerHTML=await financePanel();
  else if(state.active==='audit')p.innerHTML=await auditPanel();
  else if(state.active==='team'){p.innerHTML=await teamPanel();await wireTeam()}
}
async function loadBase(){
  const [me,catalog,overview]=await Promise.all([api('/api/admin/me'),api('/api/admin/catalog'),api('/api/admin/overview')]);
  if(!me.is_admin)throw Object.assign(new Error('No delegated Admin workspace is available for this account.'),{code:'NOT_ADMIN'});
  state.me=me;state.catalog=catalog;state.overview=overview;
}
async function boot(){
  if(!token()){root.className='adminDenied';root.innerHTML='<h2>Admin sign-in required</h2><p>Open the main app and sign in with the account that received delegated Admin authority.</p><a class="adminButton" href="/">Return to app</a>';return}
  try{await loadBase();shell();await renderActive()}catch(e){root.className='adminDenied';root.innerHTML='<h2>Admin workspace unavailable</h2><p>'+esc(e.message)+'</p><a class="adminButton" href="/">Return to app</a>'}
}
boot();
