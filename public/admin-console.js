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
  {id:'finance',label:'Finance',any:['finance.summary.view','finance.cost.manage','accounting.export.view','payment.view','payment.manage','payment.reconcile','settlement.manage']},
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
  return hero()+'<p class="moduleIntro">'+(isSupport?'Support tickets assigned or visible in your scope.':'Incident queue visible under your delegated Trust & Safety authority.')+'</p>'+rows(list,x=>'<div class="row"><div class="rowHeader"><strong>'+esc(x.subject||x.category||('Case #'+x.id))+'</strong><span class="status">'+esc(x.status||'open')+'</span></div><span class="muted">'+esc(x.requester_name||x.reporter_name||x.priority||'')+'</span></div>');
}
function territoriesPanel(){
  return hero()+'<p class="moduleIntro">Operating cells visible to your assignment.</p>'+rows(state.overview?.territories||[],x=>'<div class="row"><div class="rowHeader"><strong>'+esc(x.name)+'</strong><span class="status">'+esc(x.status)+'</span></div><span class="muted">'+esc(x.territory_type)+' · '+esc(x.code||'')+'</span></div>');
}
async function financePanel(){
  if(!hasAny(['finance.summary.view'])){
    let m={};try{m=await api('/api/admin/metrics')}catch(e){m={error:e.message}}
    return hero()+'<p class="moduleIntro">Finance visibility follows your exact delegated permissions.</p>'+metrics()+(m.error?'<div class="notice">'+esc(m.error)+'</div>':'<div class="notice">Unit economics are not delegated to this account. Payment-specific controls remain available only under their own permissions.</div>');
  }
  const k=await api('/api/payments/admin/unit-economics'+financeScopeQuery());
  const p=k.period||{};
  const serviceRows=k.services||[];
  const evidence=k.evidence_breakdown||[];
  const costs=k.recent_cost_entries||[];
  const canManage=hasAny(['finance.cost.manage']);
  const fixedTerritory=financeTerritoryId();
  const territoryField=fixedTerritory
    ?'<input type="hidden" name="territory_id" value="'+esc(fixedTerritory)+'"><div class="financeScopeNote">Cost scope: delegated territory #'+esc(fixedTerritory)+'</div>'
    :'<label>Territory / allocation scope<select name="territory_id"><option value="">Shared / country-wide</option>'+((state.overview?.territories||[]).map(t=>'<option value="'+esc(t.id)+'">'+esc(t.name)+'</option>').join(''))+'</select></label>';
  const costForm=canManage?'<div class="sectionTitle"><h3>Record platform cost</h3></div><form id="financeCostForm" class="adminForm"><div class="financeFormGrid"><label>Cost code<input name="cost_code" required placeholder="railway-2026-09"></label><label>Amount (PHP)<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Category<select name="cost_category"><option value="infrastructure">Infrastructure</option><option value="database">Database</option><option value="storage">Storage</option><option value="bandwidth">Bandwidth</option><option value="monitoring_security">Monitoring / security</option><option value="support">Support</option><option value="maps_api">Maps / routing API</option><option value="ai_api">AI / API</option><option value="notification">Notifications</option><option value="marketing">Marketing</option><option value="referral_reward">Referral reward</option><option value="promo_subsidy">Promo subsidy</option><option value="delivery_subsidy">Delivery subsidy</option><option value="refund_loss">Refund loss</option><option value="chargeback_dispute">Chargeback / dispute</option><option value="fraud_bad_debt">Fraud / bad debt</option><option value="operator_share">Operator share</option><option value="legal_compliance">Legal / compliance</option><option value="accounting">Accounting</option><option value="payroll_contractor">Payroll / contractor</option><option value="insurance_licence">Insurance / licence</option><option value="payment_provider_other">Payment provider other</option><option value="other">Other</option></select></label><label>Nature<select name="cost_nature"><option value="fixed">Fixed</option><option value="semi_fixed">Semi-fixed</option><option value="variable">Variable</option></select></label><label>Evidence class<select name="evidence_class"><option value="actual">Actual</option><option value="accrued">Accrued</option><option value="estimated">Estimated</option><option value="budget">Budget</option></select></label><label>Service<select name="service_scope"><option value="shared">Shared platform</option><option value="marketplace">Marketplace</option><option value="delivery">Delivery</option><option value="supplier">Supplier B2B</option><option value="local_services">Local Services</option><option value="accounting_pro">Accounting Pro</option><option value="enterprise">Enterprise / operator</option></select></label>'+territoryField+'<label>Evidence / source reference<input name="evidence_reference" required placeholder="Invoice ID, provider statement, estimate method or budget source"></label></div><label>Description<textarea name="description" placeholder="What this cost covers and why it belongs to this scope"></textarea></label><button class="primary" type="submit">Record cost</button><div id="financeCostResult"></div></form>':'';
  return hero()
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
    +'<div class="notice"><strong>90-day promotion</strong><br>'+esc(k.promotion_economics?.note||'Promo cohort linkage is not available yet.')+'</div>'
    +costForm
    +'<div class="sectionTitle"><h3>Recent cost entries</h3></div>'
    +rows(costs,x=>'<div class="row"><div class="rowHeader"><strong>'+esc(x.cost_code)+'</strong><span class="status">'+esc(x.evidence_class)+'</span></div><div class="financeLine"><span>'+financeMoney(x.amount,x.currency_code||'PHP')+'</span><span>'+esc(x.cost_category)+'</span><span>'+esc(x.cost_nature)+'</span><span>'+esc(x.service_scope)+'</span></div><span class="muted">'+esc(x.description||x.evidence_reference||'')+'</span></div>');
}
async function wireFinance(){
  const form=document.getElementById('financeCostForm');if(!form)return;
  form.onsubmit=async e=>{
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
  else if(state.active==='support')p.innerHTML=await queuePanel('support');
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
