const $ = (id) => document.getElementById(id);
let token = localStorage.getItem('abl_token') || '';
const money = (v) => new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP',maximumFractionDigits:2}).format(Number(v||0));

async function api(path, options={}) {
  const headers = {'Content-Type':'application/json', ...(options.headers||{})};
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(path, {...options, headers});
  if (r.status === 401) { logout(); throw new Error('Please log in again.'); }
  if (!r.ok) { const e = await r.json().catch(()=>({error:'Request failed'})); throw new Error(e.error || 'Request failed'); }
  return r.headers.get('content-type')?.includes('application/json') ? r.json() : r.text();
}
function logout(){ token=''; localStorage.removeItem('abl_token'); $('shell').classList.add('hidden'); $('login').classList.remove('hidden'); }
function showShell(){ $('login').classList.add('hidden'); $('shell').classList.remove('hidden'); refreshAll(); }
function typeLabel(t){return ({sale:'Sale',business_expense:'Business expense',money_received:'Money received',personal_withdrawal:'Personal withdrawal',adjustment:'Adjustment'})[t]||t;}
function signedAmount(t,a){ return ['business_expense','personal_withdrawal'].includes(t) ? `−${money(a)}` : `+${money(a)}`; }
function row(tx){const d=document.createElement('div'); d.className='listRow'; d.innerHTML=`<div><strong>${typeLabel(tx.type)}</strong><small>${tx.category || 'Other'}${tx.note ? ' • '+tx.note : ''}</small></div><span class="${['business_expense','personal_withdrawal'].includes(tx.type)?'negative':'positive'}">${signedAmount(tx.type,tx.amount)}</span>`; return d;}

$('loginForm').addEventListener('submit', async e=>{e.preventDefault(); $('loginError').textContent=''; try{const r=await api('/api/login',{method:'POST',body:JSON.stringify({pin:$('pin').value})}); token=r.token; localStorage.setItem('abl_token',token); showShell();}catch(err){$('loginError').textContent=err.message;}});

async function loadSummary(){const s=await api('/api/summary'); $('cashExpected').textContent=money(s.cash_expected); $('todaySales').textContent=money(s.today_sales); $('todayProfit').textContent=money(s.today_profit); $('bizExpenses').textContent=money(s.business_expenses); $('personalWithdrawals').textContent=money(s.personal_withdrawals); $('lowStock').textContent=s.low_stock;}
async function loadTransactions(){const tx=await api('/api/transactions'); $('recentList').replaceChildren(...tx.slice(0,8).map(row)); $('historyList').replaceChildren(...tx.map(row));}
async function loadStock(){const items=await api('/api/inventory'); const nodes=items.map(i=>{const d=document.createElement('div'); d.className='listRow'; const low=Number(i.quantity)<=Number(i.reorder_level); d.innerHTML=`<div><strong>${i.item}</strong><small>${Number(i.quantity)} ${i.unit} • reorder at ${Number(i.reorder_level)}</small></div><span class="${low?'negative':''}">${low?'LOW':'OK'}</span>`; return d;}); $('stockList').replaceChildren(...nodes);}
async function refreshAll(){try{await Promise.all([loadSummary(),loadTransactions(),loadStock()]);}catch(e){console.error(e);}}
$('refreshBtn').onclick=refreshAll;

$('txForm').addEventListener('submit', async e=>{e.preventDefault(); $('txMessage').textContent='Saving…'; try{await api('/api/transactions',{method:'POST',body:JSON.stringify({type:$('type').value,amount:Number($('amount').value),category:$('category').value||'Other',payment_method:$('paymentMethod').value,note:$('note').value})}); e.target.reset(); $('paymentMethod').value='cash'; $('txMessage').textContent='Saved.'; await refreshAll(); setView('Dashboard');}catch(err){$('txMessage').textContent=err.message;}});

$('stockForm').addEventListener('submit', async e=>{e.preventDefault(); try{await api('/api/inventory',{method:'POST',body:JSON.stringify({item:$('stockItem').value,quantity:Number($('stockQty').value),reorder_level:Number($('stockReorder').value),unit:$('stockUnit').value||'pcs',unit_cost:Number($('stockCost').value)})}); e.target.reset(); $('stockUnit').value='pcs'; $('stockQty').value=0; $('stockReorder').value=0; $('stockCost').value=0; await refreshAll();}catch(err){alert(err.message);}});

$('closeForm').addEventListener('submit', async e=>{e.preventDefault(); try{const r=await api('/api/close-day',{method:'POST',body:JSON.stringify({actual_cash:Number($('actualCash').value)})}); $('closeResult').innerHTML=`Expected ${money(r.expected_cash)} • Actual ${money(r.actual_cash)} • <strong>Difference ${money(r.variance)}</strong>`;}catch(err){$('closeResult').textContent=err.message;}});

function setView(name){document.querySelectorAll('.view').forEach(v=>v.classList.add('hidden')); $(`view${name}`).classList.remove('hidden'); document.querySelectorAll('.bottomNav button').forEach(b=>b.classList.toggle('active',b.dataset.view===name)); window.scrollTo({top:0,behavior:'smooth'});}
document.querySelectorAll('.bottomNav button').forEach(b=>b.onclick=()=>setView(b.dataset.view));
document.querySelectorAll('[data-go="add"]').forEach(b=>b.onclick=()=>setView('Add'));
$('exportLink').onclick=async e=>{e.preventDefault(); const r=await fetch('/api/export.csv',{headers:{Authorization:`Bearer ${token}`}}); if(!r.ok)return alert('Export failed'); const blob=await r.blob(); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='transactions.csv'; a.click(); URL.revokeObjectURL(a.href);};

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
if (token) showShell();
