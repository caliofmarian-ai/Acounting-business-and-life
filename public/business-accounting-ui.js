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

function mountWorkspaceBar() {
  const topbar=document.querySelector('.topbar');
  if(!topbar || !accountingState.activeBusinessId) return;
  let bar=document.getElementById('businessWorkspaceBar');
  if(!bar){bar=document.createElement('div');bar.id='businessWorkspaceBar';bar.className='businessWorkspaceBar';topbar.insertAdjacentElement('afterend',bar);}
  const options=accountingState.businesses.map(b=>`<option value="${b.id}" ${Number(b.id)===Number(accountingState.activeBusinessId)?'selected':''}>${escapeHtml(b.name)}</option>`).join('');
  bar.innerHTML=`<div><span class="workspaceEyebrow">${accountingState.role==='supplier'?'Supplier accounting':'Business workspace'}</span><strong>${escapeHtml(accountingState.businesses.find(b=>Number(b.id)===Number(accountingState.activeBusinessId))?.name||'Business')}</strong></div>${accountingState.businesses.length>1?`<label>Workspace<select id="businessWorkspaceSelect">${options}</select></label>`:'<span class="workspaceIsolated">Isolated ledger</span>'}`;
  const select=bar.querySelector('#businessWorkspaceSelect');
  if(select) select.onchange=async()=>{select.disabled=true;try{await api('/api/accounting/active-workspace',{method:'PATCH',body:JSON.stringify({business_id:Number(select.value)})});location.reload()}catch(err){select.disabled=false;alert(err.message)}};
}

function mountSupplierAccountingTile() {
  if(accountingState.role!=='supplier') return;
  const grid=document.querySelector('#roleHub .hubGrid');
  if(!grid || grid.querySelector('[data-business-accounting-tile]')) return;
  const tile=document.createElement('button');
  tile.type='button';tile.className='hubTile businessAccountingTile';tile.dataset.businessAccountingTile='true';
  tile.innerHTML='<span class="hubTileIcon">💼</span><strong>Accounting</strong><small>Cash, sales, costs, receivables and reports for this Supplier business</small><span class="miniBadge">Business-scoped</span>';
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
    const summary=await api('/api/summary');
    let panel=document.getElementById('economicWorkspaceSummary');
    const dashboard=document.getElementById('viewDashboard');
    if(!dashboard) return;
    if(!panel){panel=document.createElement('section');panel.id='economicWorkspaceSummary';panel.className='economicWorkspaceSummary';dashboard.prepend(panel)}
    const supplier=accountingState.role==='supplier';
    panel.innerHTML=`<div><span>Workspace</span><strong>${escapeHtml(summary.business?.name||'Business')}</strong></div>${supplier?`<div><span>Fulfilled Supplier revenue</span><strong>₱${Number(summary.supplier_fulfilled_revenue||0).toLocaleString()}</strong></div><div><span>Supplier receivables</span><strong>₱${Number(summary.supplier_receivables||0).toLocaleString()}</strong></div>`:`<div><span>Customer receivables</span><strong>₱${Number(summary.customer_receivables||0).toLocaleString()}</strong></div><div><span>Supplier payables</span><strong>₱${Number(summary.supplier_payables||0).toLocaleString()}</strong></div>`}`;
  }catch{}
}

async function bootAccountingWorkspace() {
  if(!ablToken()) return;
  try{
    const me=await api('/api/me');
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
