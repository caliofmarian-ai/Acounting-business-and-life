const $ = (id) => document.getElementById(id);
let token = localStorage.getItem('abl_token') || '';
let transactions = [];
const money = (v) => new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP',maximumFractionDigits:2}).format(Number(v||0));
const esc = (v='') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cacheKey = (key) => `abl_cache_${key}`;

function setOnline(ok){
  const el=$('onlineState'); if(!el) return;
  el.textContent=ok?'Online':'Offline copy'; el.classList.toggle('offline',!ok);
}
async function api(path, options={}) {
  const headers = {'Content-Type':'application/json', ...(options.headers||{})};
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const r = await fetch(path, {...options, headers});
    if (r.status === 401) { logout(); const e=new Error('Please log in again.'); e.status=401; throw e; }
    if (!r.ok) { const body = await r.json().catch(()=>({error:'Request failed'})); const e=new Error(body.error || 'Request failed'); e.status=r.status; throw e; }
    setOnline(true);
    return r.headers.get('content-type')?.includes('application/json') ? r.json() : r.text();
  } catch (e) { if(!e.status) setOnline(false); throw e; }
}
async function cachedJson(path,key){
  try { const data=await api(path); localStorage.setItem(cacheKey(key),JSON.stringify(data)); return data; }
  catch(e){ if(e.status===401) throw e; const cached=localStorage.getItem(cacheKey(key)); if(cached) return JSON.parse(cached); throw e; }
}
function logout(){ token=''; localStorage.removeItem('abl_token'); $('shell').classList.add('hidden'); $('login').classList.remove('hidden'); }
function showShell(){ $('login').classList.add('hidden'); $('shell').classList.remove('hidden'); refreshAll(); }
function typeLabel(t){return ({sale:'Sale',business_expense:'Business expense',money_received:'Money received',personal_withdrawal:'Personal withdrawal',adjustment:'Adjustment'})[t]||t;}
function accountLabel(a){return ({cash:'Cash',gcash:'GCash',bank:'Bank',other:'Other'})[a]||a;}
function signedAmount(t,a){ return ['business_expense','personal_withdrawal'].includes(t) ? `−${money(a)}` : `+${money(a)}`; }
function emptyRow(text){const d=document.createElement('div');d.className='emptyState';d.textContent=text;return d;}
function txRow(tx, editable=false){
  const d=document.createElement('div'); d.className='listRow';
  const negative=['business_expense','personal_withdrawal'].includes(tx.type);
  const canCorrect=editable&&tx.source!=='remittance';
  d.innerHTML=`<div class="rowMain"><strong>${esc(typeLabel(tx.type))}</strong><small>${esc(tx.category||'Other')} • ${esc(accountLabel(tx.account||tx.payment_method||'cash'))}${tx.note?` • ${esc(tx.note)}`:''}${tx.source==='remittance'?' • remittance':''}</small></div><div class="rowRight"><span class="${negative?'negative':'positive'}">${esc(signedAmount(tx.type,tx.amount))}</span>${canCorrect?'<button class="miniBtn" type="button">Correct</button>':''}</div>`;
  if(canCorrect) d.querySelector('.miniBtn').onclick=()=>openEdit(tx);
  return d;
}
function remitRow(r){
  const d=document.createElement('div'); d.className='listRow';
  const diff=Number(r.difference_php||0);
  d.innerHTML=`<div class="rowMain"><strong>${esc(r.provider||'Remittance')} • ${esc(r.sent_currency)} ${Number(r.sent_amount).toFixed(2)}</strong><small>Received ${esc(money(r.received_php))} into ${esc(accountLabel(r.account))}${r.reference?` • ${esc(r.reference)}`:''}</small></div><div class="rowRight"><span class="${diff<0?'negative':diff>0?'positive':''}">${r.expected_php!=null?`Δ ${esc(money(diff))}`:''}</span></div>`;
  return d;
}
function analysisRows(data){
  if(!data.categories?.length) return [emptyRow('No spending recorded in this period.')];
  return data.categories.map(x=>{const d=document.createElement('div');d.className='listRow';d.innerHTML=`<div class="rowMain"><strong>${esc(x.category)}</strong><small>${x.kind==='business'?'Business':'Personal'}</small></div><span>${esc(money(x.total))}</span>`;return d;});
}

$('loginForm').addEventListener('submit', async e=>{
  e.preventDefault(); $('loginError').textContent='';
  try{const r=await api('/api/login',{method:'POST',body:JSON.stringify({pin:$('pin').value})}); token=r.token; localStorage.setItem('abl_token',token); showShell();}
  catch(err){$('loginError').textContent=err.message;}
});

async function loadSummary(){
  const s=await cachedJson('/api/summary','summary');
  $('availableTotal').textContent=money(s.available_total);
  $('todaySales').textContent=money(s.today_sales);
  $('todayProfit').textContent=money(s.today_profit);
  $('bizExpenses').textContent=money(s.business_expenses);
  $('personalWithdrawals').textContent=money(s.personal_withdrawals);
  $('moneyReceived').textContent=money(s.money_received);
  $('remittanceReceived').textContent=`Remittances: ${money(s.remittance_received)}`;
  $('acctCash').textContent=money(s.accounts?.cash);
  $('acctGcash').textContent=money(s.accounts?.gcash);
  $('acctBank').textContent=money(s.accounts?.bank);
  $('acctOther').textContent=money(s.accounts?.other);
  $('lowStock').textContent=s.low_stock;
  const box=$('warningBox'); const warnings=s.warnings||[];
  box.classList.toggle('hidden',!warnings.length); box.innerHTML=warnings.map(w=>`<div>⚠ ${esc(w)}</div>`).join('');
}
async function loadTransactions(){
  const tx=await cachedJson('/api/transactions','transactions'); transactions=tx;
  $('recentList').replaceChildren(...(tx.length?tx.slice(0,8).map(t=>txRow(t,false)):[emptyRow('No transactions yet.') ]));
  $('historyList').replaceChildren(...(tx.length?tx.map(t=>txRow(t,true)):[emptyRow('No transactions yet.') ]));
}
async function loadStock(){
  const items=await cachedJson('/api/inventory','inventory');
  const nodes=items.map(i=>{const d=document.createElement('div');d.className='listRow';const low=Number(i.quantity)<=Number(i.reorder_level);d.innerHTML=`<div class="rowMain"><strong>${esc(i.item)}</strong><small>${Number(i.quantity)} ${esc(i.unit)} • reorder at ${Number(i.reorder_level)}</small></div><span class="${low?'negative':''}">${low?'LOW':'OK'}</span>`;return d;});
  $('stockList').replaceChildren(...(nodes.length?nodes:[emptyRow('No inventory items yet.') ]));
}
async function loadRemittances(){
  const rows=await cachedJson('/api/remittances','remittances');
  $('remittanceList').replaceChildren(...(rows.length?rows.map(remitRow):[emptyRow('No remittances recorded yet.') ]));
}
async function loadDay(){
  const d=await cachedJson('/api/day-status','day_status');
  $('dayStatusDate').textContent=d.business_date;
  $('openingCashShown').textContent=money(d.opening_cash);
  $('expectedCashShown').textContent=money(d.expected_cash);
  $('openResult').textContent=d.has_opening?'Opening cash is recorded for today.':'Set opening cash before closing the day.';
  if(d.closing) $('closeResult').innerHTML=`Closed: actual ${money(d.closing.actual_cash)} • <strong class="${Number(d.closing.variance)<0?'negative':Number(d.closing.variance)>0?'positive':''}">difference ${money(d.closing.variance)}</strong>`;
}
async function loadBudget(){
  const b=await cachedJson('/api/budget','budget');
  $('budgetPersonalDaily').value=Number(b.personal_daily_limit||0);
  $('budgetPersonalWeekly').value=Number(b.personal_weekly_limit||0);
  $('budgetBusinessDaily').value=Number(b.business_daily_limit||0);
  $('budgetMinimum').value=Number(b.min_available_warning||0);
}
async function loadAnalysis(days){
  const a=await cachedJson(`/api/analysis?days=${days}`,`analysis_${days}`);
  $(`analysis${days}Totals`).textContent=`Business ${money(a.totals.business)} • Personal ${money(a.totals.personal)} • Sales ${money(a.totals.sales)} • Support ${money(a.totals.received)}`;
  $(`analysis${days}`).replaceChildren(...analysisRows(a));
}
async function refreshAll(){
  try{await Promise.all([loadSummary(),loadTransactions(),loadStock(),loadRemittances(),loadDay(),loadBudget(),loadAnalysis(7),loadAnalysis(30)]);}catch(e){console.error(e);}
}
$('refreshBtn').onclick=refreshAll;

$('txForm').addEventListener('submit', async e=>{
  e.preventDefault(); $('txMessage').textContent='Saving…';
  try{await api('/api/transactions',{method:'POST',body:JSON.stringify({type:$('type').value,amount:Number($('amount').value),category:$('category').value||'Other',account:$('account').value,note:$('note').value})}); e.target.reset(); $('account').value='cash'; $('txMessage').textContent='Saved.'; await refreshAll(); setView('Dashboard');}
  catch(err){$('txMessage').textContent=err.message;}
});

$('stockForm').addEventListener('submit', async e=>{
  e.preventDefault();
  try{await api('/api/inventory',{method:'POST',body:JSON.stringify({item:$('stockItem').value,quantity:Number($('stockQty').value),reorder_level:Number($('stockReorder').value),unit:$('stockUnit').value||'pcs',unit_cost:Number($('stockCost').value)})}); e.target.reset(); $('stockUnit').value='pcs'; $('stockQty').value=0; $('stockReorder').value=0; $('stockCost').value=0; await refreshAll();}
  catch(err){alert(err.message);}
});

$('remittanceForm').addEventListener('submit', async e=>{
  e.preventDefault(); $('remitMessage').textContent='Saving…';
  const optional=(id)=>$(id).value===''?null:Number($(id).value);
  try{
    await api('/api/remittances',{method:'POST',body:JSON.stringify({sent_amount:Number($('remitSent').value),sent_currency:$('remitCurrency').value,fee_amount:Number($('remitFee').value||0),exchange_rate:optional('remitRate'),expected_php:optional('remitExpected'),received_php:Number($('remitReceived').value),account:$('remitAccount').value,provider:$('remitProvider').value,reference:$('remitReference').value,note:$('remitNote').value})});
    e.target.reset(); $('remitCurrency').value='EUR'; $('remitFee').value=0; $('remitAccount').value='gcash'; $('remitMessage').textContent='Remittance saved and received money added automatically.'; await refreshAll();
  } catch(err){$('remitMessage').textContent=err.message;}
});

$('openForm').addEventListener('submit', async e=>{
  e.preventDefault();
  try{await api('/api/open-day',{method:'POST',body:JSON.stringify({opening_cash:Number($('openingCash').value)})}); $('openResult').textContent='Opening cash saved.'; await Promise.all([loadDay(),loadSummary()]);}
  catch(err){$('openResult').textContent=err.message;}
});
$('closeForm').addEventListener('submit', async e=>{
  e.preventDefault();
  try{const r=await api('/api/close-day',{method:'POST',body:JSON.stringify({actual_cash:Number($('actualCash').value)})}); $('closeResult').innerHTML=`Expected ${money(r.expected_cash)} • Actual ${money(r.actual_cash)} • <strong class="${Number(r.variance)<0?'negative':Number(r.variance)>0?'positive':''}">Difference ${money(r.variance)}</strong>`; await loadDay();}
  catch(err){$('closeResult').textContent=err.message;}
});

$('budgetForm').addEventListener('submit', async e=>{
  e.preventDefault(); $('budgetMessage').textContent='Saving…';
  try{await api('/api/budget',{method:'POST',body:JSON.stringify({personal_daily_limit:Number($('budgetPersonalDaily').value||0),personal_weekly_limit:Number($('budgetPersonalWeekly').value||0),business_daily_limit:Number($('budgetBusinessDaily').value||0),min_available_warning:Number($('budgetMinimum').value||0)})}); $('budgetMessage').textContent='Limits saved.'; await loadSummary();}
  catch(err){$('budgetMessage').textContent=err.message;}
});

function openEdit(tx){
  $('editId').value=tx.id; $('editType').value=tx.type; $('editAmount').value=Number(tx.amount); $('editAccount').value=tx.account||'cash'; $('editCategory').value=tx.category||''; $('editNote').value=tx.note||''; $('editReason').value=''; $('editMessage').textContent=''; $('editDialog').showModal();
}
$('editCancel').onclick=()=>$('editDialog').close();
$('editForm').addEventListener('submit', async e=>{
  e.preventDefault(); $('editMessage').textContent='Saving correction…';
  try{await api(`/api/transactions/${$('editId').value}`,{method:'PATCH',body:JSON.stringify({type:$('editType').value,amount:Number($('editAmount').value),account:$('editAccount').value,category:$('editCategory').value,note:$('editNote').value,reason:$('editReason').value})}); $('editDialog').close(); await refreshAll();}
  catch(err){$('editMessage').textContent=err.message;}
});

function setView(name){
  document.querySelectorAll('.view').forEach(v=>v.classList.add('hidden'));
  $(`view${name}`).classList.remove('hidden');
  document.querySelectorAll('.bottomNav button').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  window.scrollTo({top:0,behavior:'smooth'});
}
document.querySelectorAll('.bottomNav button').forEach(b=>b.onclick=()=>setView(b.dataset.view));
document.querySelectorAll('[data-go="add"]').forEach(b=>b.onclick=()=>setView('Add'));
$('exportLink').onclick=async e=>{e.preventDefault();try{const r=await fetch('/api/export.csv',{headers:{Authorization:`Bearer ${token}`}});if(!r.ok)throw new Error('Export failed');const blob=await r.blob();const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='transactions.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}catch(err){alert(err.message);}};

window.addEventListener('online',()=>{setOnline(true);refreshAll();});
window.addEventListener('offline',()=>setOnline(false));
setOnline(navigator.onLine);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).then(reg=>reg.update().catch(()=>{})).catch(()=>{});
if (token) showShell();
