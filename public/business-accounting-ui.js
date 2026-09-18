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

function financeMoney(v){return new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(v)||0)}
function financeMetric(label,value,detail=''){return '<div class="businessFinanceMetric"><span>'+escapeHtml(label)+'</span><strong>'+(typeof value==='number'?financeMoney(value):escapeHtml(value))+'</strong>'+(detail?'<small>'+escapeHtml(detail)+'</small>':'')+'</div>'}
function financeStatusMetric(label,summary){if(!summary?.tracked)return financeMetric(label,'Not configured','No payout/net allocation evidence');return financeMetric(label,financeMoney(summary.paid),'Paid · '+financeMoney(summary.eligible)+' eligible · '+financeMoney(summary.pending)+' pending')}
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
}
const BUSINESS_FINANCE_COMPATIBILITY_COPY=Object.freeze({merchant_sales:'Completed merchandise sales',supplier_orders:'Fulfilled PO value',supplier_received:'Recorded money received',supplier_budget:'Planned Supplier budget',settings:'Money Settings'});
function financeCompactMetric(label,value,detail=''){return '<div class="businessFinanceMetric primary"><span>'+escapeHtml(label)+'</span><strong>'+(typeof value==='number'?financeMoney(value):escapeHtml(value))+'</strong>'+(detail?'<small>'+escapeHtml(detail)+'</small>':'')+'</div>'}
function merchantFinanceHtml(o){
  const p=o.profitability||{},sett=o.settlement?.merchant_net,margin=p.estimated_margin_pct==null?'Not available':Number(p.estimated_margin_pct).toFixed(2)+'%';
  const primary='<div class="businessFinancePrimary">'
    +financeCompactMetric('Money received',Number(o.cash_evidence?.confirmed_merchandise_received||0),'Confirmed customer payments')
    +financeCompactMetric('Sales',Number(o.commercial?.completed_merchandise_value||0),'Completed merchandise')
    +financeCompactMetric('Still to collect',Number(o.receivables?.completed_customer_receivables||0),'Customer receivables')
    +financeCompactMetric('Expenses',Number(o.ledger?.business_expenses||0),'Business expenses')
    +'</div>';
  const details='<details class="businessFinanceDetails"><summary>More business details</summary><div class="businessFinanceMetrics">'
    +financeMetric('Supplier payables',Number(o.payables?.supplier_payables||0),'Received purchases still due')
    +financeMetric('Inventory value',Number(o.inventory?.valuation||0),o.inventory?.valuation_status||'')
    +financeMetric('Owner drawings',Number(o.ledger?.owner_drawings||0),'Personal withdrawal — not business expense')
    +financeMetric('Estimated margin',margin,p.status||'')
    +financeStatusMetric('Payout / settlement',sett)
    +'</div></details>';
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
function financeWarnings(o){const rows=o.warnings||[];return rows.length?'<div class="businessFinanceWarnings">'+rows.map(x=>'<div>⚠ '+escapeHtml(String(x).replaceAll('_',' '))+'</div>').join('')+'</div>':''}
function financeAccounts(o){const a=o.profile_finance?.financial_accounts||[];return '<div class="businessFinanceAccounts"><div><strong>Banking & payouts</strong><span>'+(a.length?escapeHtml(String(a.length))+' linked reference'+(a.length===1?'':'s'):'No linked payout reference')+'</span></div><button id="openBusinessFinanceSettings" type="button">Banking settings</button></div>'}
function roleFinanceHtml(o){
  const domain=o.role==='merchant'?' · '+escapeHtml(String(o.presentation?.merchant_domain||'unknown').replace('_',' ')):'';
  return '<div class="businessFinanceHead"><div><span class="workspaceEyebrow">'+escapeHtml(o.role==='supplier'?'Supplier Finance':'Merchant Finance')+domain+'</span><h2>'+escapeHtml(o.business?.name||'Business')+'</h2><p>'+escapeHtml(o.role==='supplier'?'Money received, fulfilled orders, receivables and expenses.':'Money received, sales, receivables and expenses. The rest stays under More details.')+'</p></div><span class="workspaceIsolated">'+escapeHtml(o.role==='supplier'?'Supplier books':'Business books')+'</span></div>'+(o.role==='supplier'?supplierFinanceHtml(o):merchantFinanceHtml(o))+financeWarnings(o)+financeAccounts(o);
}
function mountWorkspaceBar() {
  const topbar=document.querySelector('.topbar');
  if(!topbar || !accountingState.activeBusinessId) return;
  let bar=document.getElementById('businessWorkspaceBar');
  if(!bar){bar=document.createElement('div');bar.id='businessWorkspaceBar';bar.className='businessWorkspaceBar';topbar.insertAdjacentElement('afterend',bar);}
  const options=accountingState.businesses.map(b=>`<option value="${b.id}" ${Number(b.id)===Number(accountingState.activeBusinessId)?'selected':''}>${escapeHtml(b.name)}</option>`).join('');
  bar.innerHTML=`<div><span class="workspaceEyebrow">${accountingState.role==='supplier'?'Supplier accounting':'Business workspace'}</span><strong>${escapeHtml(accountingState.businesses.find(b=>Number(b.id)===Number(accountingState.activeBusinessId))?.name||'Business')}</strong></div>${accountingState.businesses.length>1?`<label>Workspace<select id="businessWorkspaceSelect">${options}</select></label>`:'<span class="workspaceIsolated">Isolated ledger</span>'}`;
  const select=bar.querySelector('#businessWorkspaceSelect');
  if(select) select.onchange=async()=>{
    const previous=accountingState.activeBusinessId;
    select.disabled=true;
    try{
      await api('/api/accounting/active-workspace',{method:'PATCH',body:JSON.stringify({business_id:Number(select.value)})});
      const state=await api('/api/accounting/workspaces');
      accountingState={role:state.role,activeBusinessId:Number(state.active_business_id),businesses:state.businesses||[]};
      mountWorkspaceBar();
      mountSupplierAccountingTile();
      await mountEconomicSummary();
      document.dispatchEvent(new CustomEvent('abl:business-workspace-changed',{detail:{role:accountingState.role,activeBusinessId:accountingState.activeBusinessId}}));
    }catch(err){
      accountingState.activeBusinessId=previous;
      mountWorkspaceBar();
      alert(err.message);
    }
  };
}

function mountSupplierAccountingTile() {
  if(accountingState.role!=='supplier') return;
  const grid=document.querySelector('#roleHub .hubGrid');
  if(!grid || grid.querySelector('[data-business-accounting-tile]')) return;
  const tile=document.createElement('button');
  tile.type='button';tile.className='hubTile businessAccountingTile';tile.dataset.businessAccountingTile='true';
  tile.innerHTML='<span class="hubTileIcon">💼</span><strong>Finance & Accounting</strong><small>PO income, actual receipts, receivables, costs, budgets and payout status</small><span class="miniBadge">Business-scoped</span>';
  tile.onclick=openSupplierAccounting;
  grid.prepend(tile);
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

async function mountEconomicSummary() {
  try{
    const overview=await api('/api/accounting/finance-overview');
    let panel=document.getElementById('economicWorkspaceSummary');
    const dashboard=document.getElementById('viewDashboard');
    if(!dashboard)return;
    if(!panel){panel=document.createElement('section');panel.id='economicWorkspaceSummary';dashboard.prepend(panel)}
    panel.className='economicWorkspaceSummary businessFinanceOverview';
    panel.innerHTML=roleFinanceHtml(overview);
    applyFinancePresentation(overview);
    const settings=panel.querySelector('#openBusinessFinanceSettings');
    if(settings)settings.onclick=()=>window.BusinessLifeProfileSettings?.open?.(overview.role);
  }catch(err){console.warn('Business Finance overview:',err.message)}
}
async function bootAccountingWorkspace() {
  if(!ablToken()) return;
  try{
    const me=window.BusinessLifeProfileState?.snapshot||await api('/api/me');
    const role=me.account?.active_role;
    if(!['merchant','supplier'].includes(role)) return;
    const profile=me.profiles?.find(p=>p.role===role);
    if(!profile?.enabled) return;
    const state=await api('/api/accounting/workspaces');
    accountingState={role:state.role,activeBusinessId:Number(state.active_business_id),businesses:state.businesses||[]};
    mountWorkspaceBar();
    mountSupplierAccountingTile();
    if(role==='merchant') mountEconomicSummary();
    document.addEventListener('abl:profile-state',()=>{mountWorkspaceBar();mountSupplierAccountingTile()});
  }catch(err){console.warn('Accounting workspace:',err.message)}
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(bootAccountingWorkspace,120));
else setTimeout(bootAccountingWorkspace,120);
