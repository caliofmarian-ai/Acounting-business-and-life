const ablToken = () => localStorage.getItem('abl_token') || '';
const originalFetch = window.fetch.bind(window);
let accountingState = { role: null, activeBusinessId: null, businesses: [] };

async function api(path, options={}) {
  const headers={ 'Content-Type':'application/json', ...(options.headers||{}) };
  const token=ablToken();
  if(token) headers.Authorization=`Bearer ${token}`;
  const response=await originalFetch(path,{...options,headers});
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.error||`Request failed (${response.status})`);
  return data;
}

function shouldCarryBusiness(path) {
  return path === '/api/merchant/storefront' ||
    path.startsWith('/api/merchant/storefront/') ||
    path === '/api/procurement/relationships' ||
    path.startsWith('/api/procurement/catalog/') ||
    path.startsWith('/api/procurement/suppliers/') ||
    path.startsWith('/api/procurement/orders') ||
    path === '/api/procurement/reorder-suggestions';
}

window.fetch = async function businessAwareFetch(input, init={}) {
  try {
    const raw = typeof input === 'string' ? input : input?.url;
    if(!raw || !accountingState.activeBusinessId || !['merchant','supplier'].includes(accountingState.role)) return originalFetch(input,init);
    const url = new URL(raw, location.origin);
    if(url.origin !== location.origin || !shouldCarryBusiness(url.pathname)) return originalFetch(input,init);
    const method=String(init.method||'GET').toUpperCase();
    if(method==='GET' || method==='HEAD') {
      if(!url.searchParams.has('business_id')) url.searchParams.set('business_id', String(accountingState.activeBusinessId));
      const next = raw.startsWith('http') ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
      return originalFetch(next,init);
    }
    if(typeof init.body === 'string' && String(init.headers?.['Content-Type']||init.headers?.get?.('Content-Type')||'').includes('application/json')) {
      try {
        const parsed=JSON.parse(init.body);
        if(parsed && typeof parsed==='object' && !Array.isArray(parsed) && parsed.business_id==null) parsed.business_id=accountingState.activeBusinessId;
        return originalFetch(input,{...init,body:JSON.stringify(parsed)});
      } catch {}
    }
  } catch {}
  return originalFetch(input,init);
};

function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

function clearWorkspaceSwitchError(){
  document.getElementById('businessWorkspaceFeedback')?.remove();
}
function showWorkspaceSwitchError(message){
  clearWorkspaceSwitchError();
  const bar=document.getElementById('businessWorkspaceBar');
  if(!bar)return;
  const feedback=document.createElement('div');
  feedback.id='businessWorkspaceFeedback';
  feedback.className='businessWorkspaceFeedback';
  feedback.setAttribute('role','alert');
  feedback.textContent='Could not switch business. '+(message||'Try again.');
  bar.insertAdjacentElement('afterend',feedback);
}

function financeMoney(v){return new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(v)||0)}
function financeMetric(label,value,detail=''){return '<div class="businessFinanceMetric"><span>'+escapeHtml(label)+'</span><strong>'+(typeof value==='number'?financeMoney(value):escapeHtml(value))+'</strong>'+(detail?'<small>'+escapeHtml(detail)+'</small>':'')+'</div>'}
function financeStatusMetric(label,summary){if(!summary?.tracked)return financeMetric(label,'Setup needed','Choose where this profile should receive its money');return financeMetric(label,financeMoney(summary.paid),'Paid · '+financeMoney(summary.eligible)+' ready · '+financeMoney(summary.pending)+' pending')}
function financeStatusCopy(status){return ({COST_EVIDENCE_COMPLETE:'Costs recorded',NON_FOOD_COST_BASIS_NOT_CONFIGURED:'Product costs are missing',NO_REVENUE:'No completed sales yet',NOT_AVAILABLE_WITHOUT_PROVIDER_EVIDENCE:'Waiting for confirmed payment information'})[status]||''}
function financeWarningCopy(code){return ({MERCHANT_STOREFRONT_DOMAIN_NOT_CONFIGURED:{title:'Choose what this business sells',body:'Set whether the storefront offers food, non-food products, or both.'},NON_FOOD_COST_BASIS_NOT_CONFIGURED:{title:'Add product costs to see estimated profit',body:'Selling prices alone are not enough to calculate profit.'},MERCHANT_PAYOUT_ALLOCATION_NOT_CONFIGURED:{title:'Choose where you want to receive payments',body:'Add a payout method before accepting live customer payments.',action:true},MULTI_BUSINESS_SUPPLIER_PO_ATTRIBUTION_PENDING:{title:'Some supplier orders need a business',body:'Choose which business owns each order before using these totals.'}})[code]||{title:'Some financial information needs attention',body:'Open profile settings to review the missing information.'}}
function applyFinancePresentation(overview){
  const role=overview?.role||accountingState.role,domain=overview?.presentation?.merchant_domain||'unknown';
  document.body.dataset.businessFinanceRole=role||'';document.body.dataset.merchantDomain=domain;
  const foodAllowed=role==='merchant'&&Boolean(overview?.presentation?.legacy_recipe_ui_allowed);
  for(const name of ['Sell','Menu']){const btn=document.querySelector('.bottomNav [data-view="'+name+'"]');if(btn){btn.classList.toggle('roleFinanceHidden',!foodAllowed);if(name==='Menu'&&foodAllowed)btn.textContent='Food menu'}const view=document.getElementById('view'+name);if(view)view.classList.toggle('roleFinanceHidden',!foodAllowed)}
  const stockBtn=document.querySelector('.bottomNav [data-view="Stock"]');if(stockBtn)stockBtn.textContent=role==='supplier'?'Inventory':domain==='non_food'?'Inventory':'Stock';
  const stockTitle=document.querySelector('#viewStock h1');if(stockTitle)stockTitle.textContent=role==='supplier'?'Inventory / raw materials':'Inventory';
  const stockFormTitle=document.querySelector('#viewStock form h2');if(stockFormTitle)stockFormTitle.textContent='Add or update inventory item';
  document.getElementById('budgetForm')?.classList.add('roleFinanceHidden');
  document.querySelectorAll('option[value="personal_withdrawal"]').forEach(o=>o.textContent='Owner drawing / withdrawal');
  document.querySelectorAll('[data-view-link="Sell"]').forEach(el=>el.classList.toggle('roleFinanceHidden',!foodAllowed));
  document.querySelectorAll('#viewDashboard .legacyFinanceSnapshot').forEach(el=>el.classList.add('roleFinanceHidden'));
}
const BUSINESS_FINANCE_COMPATIBILITY_COPY=Object.freeze({merchant_sales:'Completed merchandise sales',supplier_orders:'Fulfilled PO value',supplier_received:'Recorded money received',supplier_budget:'Planned Supplier budget',settings:'Money Settings'});
function financeCompactMetric(label,value,detail=''){return '<div class="businessFinanceMetric primary"><span>'+escapeHtml(label)+'</span><strong>'+(typeof value==='number'?financeMoney(value):escapeHtml(value))+'</strong>'+(detail?'<small>'+escapeHtml(detail)+'</small>':'')+'</div>'}
function merchantFinanceHtml(o){
  const p=o.profitability||{},sett=o.settlement?.merchant_net,reconciliation=o.ledger_reconciliation||{},margin=p.estimated_margin_pct==null?'Not available':Number(p.estimated_margin_pct).toFixed(2)+'%';
  const primary='<div class="businessFinancePrimary">'
    +financeCompactMetric('Money received',Number(o.cash_evidence?.confirmed_merchandise_received||0),'Confirmed customer payments')
    +financeCompactMetric('Sales',Number(o.commercial?.completed_merchandise_value||0),'Completed merchandise')
    +financeCompactMetric('Awaiting payment',Number(o.receivables?.completed_customer_receivables||0),'Completed sales not paid yet')
    +financeCompactMetric('Expenses',Number(o.ledger?.business_expenses||0),'Business expenses')
    +'</div>';
  const details='<details class="businessFinanceDetails"><summary>Financial details</summary><div class="businessFinanceMetrics">'
    +financeMetric('Owed to suppliers',Number(o.payables?.supplier_payables||0),'Products received but not fully paid')
    +financeMetric('Products in stock',Number(o.inventory?.valuation||0),'Estimated cost value · not available cash')
    +financeMetric('Money taken by owner',Number(o.ledger?.owner_drawings||0),'Personal withdrawals · not business expenses')
    +financeMetric('Manual records total',Number(reconciliation.recorded_available_balance||0),'Unverified entries · not bank balance or available cash')
    +financeMetric('Estimated profit margin',margin,financeStatusCopy(p.status))
    +financeStatusMetric('Payment destination',sett)
    +'</div><div class="ledgerReconciliation '+(reconciliation.status==='MATCHED'?'matched':'separate')+'"><strong>'+(reconciliation.status==='MATCHED'?'Records agree with confirmed payments':'Manual records are not confirmed payments')+'</strong><span>'+(reconciliation.status==='MATCHED'?'The current totals agree, but only provider-confirmed payments count as money received.':'Manual sales, adjustments and test entries can change this total without moving real money. Check your payment provider or bank for received funds.')+'</span></div></details>';
  return primary+details;
}
function supplierFinanceHtml(o){
  const attributed=o.commercial?.attribution_status==='SINGLE_SUPPLIER_BUSINESS_BINDING',fulfilled=attributed?Number(o.commercial?.fulfilled_po_value||0):'See details',receivable=attributed?Number(o.receivables?.merchant_receivables||0):'See details';
  const primary='<div class="businessFinancePrimary">'
    +financeCompactMetric('Money received',Number(o.cash_evidence?.business_ledger_recorded_receipts||0),'Confirmed receipts')
    +financeCompactMetric('Fulfilled orders',fulfilled,'PO commercial value')
    +financeCompactMetric('Still to collect',receivable,'Merchant receivables')
    +financeCompactMetric('Expenses',Number(o.ledger?.business_expenses||0),'Business expenses')
    +'</div>';
  const details='<details class="businessFinanceDetails"><summary>More Supplier details</summary><div class="businessFinanceMetrics">'
    +financeMetric('Upstream payables',Number(o.payables?.upstream_supplier_payables||0),'Supplier purchases still due')
    +financeMetric('Inventory value',Number(o.inventory?.valuation||0),o.inventory?.valuation_status||'')
    +financeMetric('Owner drawings',Number(o.ledger?.owner_drawings||0),'Personal withdrawal — not business expense')
    +financeStatusMetric('Payout / settlement',o.settlement?.supplier_net)
    +'</div></details>';
  return primary+details;
}
function financeWarnings(o){const rows=o.warnings||[];return rows.length?'<div class="businessFinanceWarnings">'+rows.map(x=>{const copy=financeWarningCopy(x);return '<div class="businessFinanceWarning"><span aria-hidden="true">!</span><div><strong>'+escapeHtml(copy.title)+'</strong><small>'+escapeHtml(copy.body)+'</small></div>'+(copy.action?'<button class="financeWarningAction" type="button" data-open-finance-settings>Set up</button>':'')+'</div>'}).join('')+'</div>':''}
function financeAccounts(o){const a=o.profile_finance?.financial_accounts||[];return '<div class="businessFinanceAccounts"><div><strong>Payment and banking settings</strong><span>'+(a.length?escapeHtml(String(a.length))+' payout method'+(a.length===1?'':'s')+' added for this profile.':'No payout method has been added for this profile.')+' Personal bank details stay securely under Account · Money & Banking.</span></div><button id="openBusinessFinanceSettings" type="button">Manage settings</button></div>'}
function roleFinanceHtml(o){
  const domain=o.role==='merchant'?' · '+escapeHtml(String(o.presentation?.merchant_domain||'unknown').replace('_',' ')):'';
  return '<div class="businessFinanceHead"><div><span class="workspaceEyebrow">'+escapeHtml(o.role==='supplier'?'Supplier finances':'Business finances')+domain+'</span><h2>'+escapeHtml(o.business?.name||'Business')+'</h2><p>'+escapeHtml(o.role==='supplier'?'See confirmed income, fulfilled orders, unpaid amounts and expenses.':'See confirmed payments, completed sales, unpaid amounts and expenses.')+'</p></div><span class="workspaceIsolated">'+escapeHtml(o.role==='supplier'?'This supplier only':'This business only')+'</span></div>'+(o.role==='supplier'?supplierFinanceHtml(o):merchantFinanceHtml(o))+financeWarnings(o)+financeAccounts(o);
}
function applyWorkspaceState(workspaceState){
  if(!workspaceState)return false;
  const activeBusinessId=Number(workspaceState.active_business_id);
  const businesses=Array.isArray(workspaceState.businesses)?workspaceState.businesses:[];
  if(!activeBusinessId||!businesses.some(b=>Number(b.id)===activeBusinessId))return false;
  accountingState={role:workspaceState.role,activeBusinessId,businesses};
  mountWorkspaceBar();
  wireSupplierAccountingTile();
  return true;
}

function mountWorkspaceBar() {
  const topbar=document.querySelector('.topbar');
  if(!topbar || !accountingState.activeBusinessId) return;
  let bar=document.getElementById('businessWorkspaceBar');
  if(!bar){bar=document.createElement('div');bar.id='businessWorkspaceBar';topbar.insertAdjacentElement('afterend',bar);}
  bar.className='businessWorkspaceBar';
  bar.removeAttribute('aria-busy');
  const options=accountingState.businesses.map(b=>`<option value="${b.id}" ${Number(b.id)===Number(accountingState.activeBusinessId)?'selected':''}>${escapeHtml(b.name)}</option>`).join('');
  bar.innerHTML=`<div><span class="workspaceEyebrow">${accountingState.role==='supplier'?'Supplier finances':'Current business'}</span><strong>${escapeHtml(accountingState.businesses.find(b=>Number(b.id)===Number(accountingState.activeBusinessId))?.name||'Business')}</strong></div>${accountingState.businesses.length>1?`<label>Business<select id="businessWorkspaceSelect">${options}</select></label>`:'<span class="workspaceIsolated">This business only</span>'}`;
  const select=bar.querySelector('#businessWorkspaceSelect');
  if(select) select.onchange=async()=>{
    clearWorkspaceSwitchError();
    const previous=accountingState.activeBusinessId;
    select.disabled=true;
    try{
      await api('/api/accounting/active-workspace',{method:'PATCH',body:JSON.stringify({business_id:Number(select.value)})});
      const state=await api('/api/accounting/workspaces');
      accountingState={role:state.role,activeBusinessId:Number(state.active_business_id),businesses:state.businesses||[]};
      mountWorkspaceBar();
      wireSupplierAccountingTile();
      if(accountingState.role==='supplier'&&document.body.classList.contains('supplierAccountingMode'))await mountEconomicSummary('viewDashboard');
      document.dispatchEvent(new CustomEvent('abl:business-workspace-changed',{detail:{role:accountingState.role,activeBusinessId:accountingState.activeBusinessId}}));
    }catch(err){
      accountingState.activeBusinessId=previous;
      mountWorkspaceBar();
      showWorkspaceSwitchError(err?.message);
    }
  };
}

function wireSupplierAccountingTile() {
  if(accountingState.role!=='supplier') return;
  const tile=document.querySelector('#roleHub [data-business-accounting-tile]');
  if(!tile)return;
  tile.onclick=openSupplierAccounting;
  tile.removeAttribute('aria-disabled');
}

async function openSupplierAccounting() {
  document.getElementById('roleHub')?.classList.add('hidden');
  document.querySelector('.bottomNav')?.classList.remove('hidden');
  document.body.classList.add('supplierAccountingMode');
  document.querySelector('.bottomNav [data-view="Dashboard"]')?.click();
  let back=document.getElementById('supplierAccountingBack');
  if(!back){back=document.createElement('button');back.id='supplierAccountingBack';back.className='supplierAccountingBack';back.type='button';back.textContent='← Supplier workspace';back.onclick=()=>{document.body.classList.remove('supplierAccountingMode');document.querySelectorAll('#shell > .view').forEach(v=>v.classList.add('hidden'));document.querySelector('.bottomNav')?.classList.add('hidden');document.getElementById('roleHub')?.classList.remove('hidden');back.remove()};document.body.appendChild(back)}
  await mountEconomicSummary();
}

function openFinanceProfileSettings(role){
  const shell=window.BusinessLifeShell;
  if(typeof shell?.openProfileSettings==='function')return shell.openProfileSettings(role);
  const toast=document.getElementById('roleToast');
  if(toast){toast.textContent='Profile Settings is still loading. Try again in a moment.';toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),2600);return false}
  window.alert?.('Profile Settings is still loading. Try again in a moment.');
  return false;
}
async function mountEconomicSummary(targetId=null) {
  try{
    const overview=await api('/api/accounting/finance-overview');
    const destination=document.getElementById(targetId||(overview.role==='merchant'?'viewMoney':'viewDashboard'));
    if(!destination)return;
    let panel=document.getElementById('economicWorkspaceSummary');
    if(!panel){panel=document.createElement('section');panel.id='economicWorkspaceSummary'}
    if(panel.parentElement!==destination)destination.prepend(panel);
    panel.className='economicWorkspaceSummary businessFinanceOverview';
    panel.innerHTML=roleFinanceHtml(overview);
    applyFinancePresentation(overview);
    panel.querySelectorAll('#openBusinessFinanceSettings,[data-open-finance-settings]').forEach(settings=>settings.onclick=()=>openFinanceProfileSettings(overview.role));
  }catch(err){console.warn('Business Finance overview:',err.message)}
}
async function bootAccountingWorkspace(detail=window.BusinessLifeProfileState) {
  if(!ablToken()) return;
  try{
    const state=detail?.snapshot?detail:window.BusinessLifeProfileState;
    const me=state?.snapshot,role=state?.surface==='profile'?state.activeRole:null;
    if(!me||!['merchant','supplier'].includes(role)){
      document.getElementById('businessWorkspaceBar')?.remove();
      return;
    }
    const profile=me.profiles?.find(p=>p.role===role);
    if(!profile?.enabled) return;
    if(role==='merchant'){
      const cached=window.BusinessLifeMerchantToday?.getState?.()?.workspace;
      if(cached)applyWorkspaceState(cached);
      return;
    }
    accountingState={role:'supplier',activeBusinessId:null,businesses:[]};
    wireSupplierAccountingTile();
    const workspaceState=await api('/api/accounting/workspaces');
    applyWorkspaceState(workspaceState);
  }catch(err){console.warn('Accounting workspace:',err.message)}
}

document.addEventListener('abl:profile-state',event=>bootAccountingWorkspace(event.detail),{passive:true});
document.addEventListener('abl:merchant-money-opened',()=>{
  if(accountingState.role==='merchant')mountEconomicSummary('viewMoney');
},{passive:true});
document.addEventListener('abl:merchant-today-data',event=>{
  if(event.detail?.workspace)applyWorkspaceState(event.detail.workspace);
  if(accountingState.role==='merchant')applyFinancePresentation({role:'merchant',presentation:event.detail?.presentation||{}});
},{passive:true});
window.BusinessLifeAccounting=Object.freeze({
  getState:()=>({role:accountingState.role,activeBusinessId:accountingState.activeBusinessId,businesses:[...accountingState.businesses]}),
  openSupplierAccounting
});
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>bootAccountingWorkspace(),120));
else setTimeout(()=>bootAccountingWorkspace(),120);
