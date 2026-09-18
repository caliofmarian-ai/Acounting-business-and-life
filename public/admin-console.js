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
  return hero()+'<p class="moduleIntro">'+(isSupport?'Support tickets assigned or visible in your scope.':'Incident queue visible under your delegated Trust & Safety authority.')+'</p>'+rows(list,x=>'<div class="row"><div class="rowHeader"><strong>'+esc(x.subject||x.category||('Case #'+x.id))+'</strong><span class="status">'+esc(x.status||'open')+'</span></div><span class="muted">'+esc((isSupport?(x.category+' • '):'')+(x.requester_name||x.reporter_name||x.priority||''))+'</span></div>');
}
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
  const k=await api('/api/payments/admin/unit-economics'+financeScopeQuery());
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
  return hero()+operatingHtml+'<details class="adminFinanceAdvanced adminEconomicsAdvanced"><summary>Advanced unit economics & monetization</summary><div class="adminFinanceAdvancedBody">'
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
    +'<div class="sectionTitle"><h3>90-day promotional cohorts</h3></div>'
    +'<div class="financeSummary financePromoSummary">'
      +'<div class="metric"><strong>'+esc(promo.active_promotional_subjects||0)+'</strong><span>Active 90-day trials</span></div>'
      +'<div class="metric"><strong>'+esc(promo.trials_started||0)+'</strong><span>Trials started this period</span></div>'
      +'<div class="metric"><strong>'+esc(promo.trials_ending||0)+'</strong><span>Trials ended this period</span></div>'
      +'<div class="metric"><strong>'+esc(promo.expired_subjects||0)+'</strong><span>Expired trial subjects</span></div>'
      +'<div class="metric"><strong>'+esc(promoTotals.completed_events||0)+'</strong><span>Promo completions this period</span></div>'
      +'<div class="metric"><strong>'+financeMoney(promoTotals.gross_value||0)+'</strong><span>Promo gross service value</span></div>'
      +'<div class="metric"><strong>'+esc(postPromoTotals.completed_events||0)+'</strong><span>Post-promo completions</span></div>'
      +'<div class="metric"><strong>'+financePct(promo.post_promo_activity_conversion_pct)+'</strong><span>Post-promo activity conversion</span></div>'
    +'</div>'
    +'<div class="financeTruth"><strong>Monetization status</strong><span>Promotional duration: '+esc(promo.promotional_days||90)+' days · Paid conversion: '+(promo.paid_conversion_status==='NOT_AVAILABLE_UNTIL_ACTIVE_FEE_POLICY'?'not available until an active fee policy collects a platform fee':'available from configured fee evidence')+'. Activity conversion means an expired trial subject completed at least one later service; it is not the same as paid conversion.</span></div>'
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
