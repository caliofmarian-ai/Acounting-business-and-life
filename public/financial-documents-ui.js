let fdWorkspace=null,fdMode='scope',fdPeriod='month',fdAnchor=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Manila'}),fdContext=null;
const fdToken=()=>localStorage.getItem('abl_token')||'';
const fdEsc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fdNice=v=>String(v??'').replaceAll('_',' ').replace(/\b\w/g,m=>m.toUpperCase());
const fdMoney=v=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(v)||0);
async function fdApi(path,options={}){const headers={'Content-Type':'application/json',...(options.headers||{})};if(fdToken())headers.Authorization='Bearer '+fdToken();const r=await fetch(path,{...options,headers});const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error||('Request failed ('+r.status+')'));return b}
function ensureFd(){const shell=document.getElementById('shell');if(!shell)return false;if(!document.getElementById('financialDocumentsWorkspace')){fdWorkspace=document.createElement('section');fdWorkspace.id='financialDocumentsWorkspace';fdWorkspace.className='financialDocumentsWorkspace hidden';shell.querySelector('.topbar')?.insertAdjacentElement('afterend',fdWorkspace)}else fdWorkspace=document.getElementById('financialDocumentsWorkspace');return true}
function hideFdBase(){document.querySelectorAll('#shell > .view').forEach(v=>v.classList.add('hidden'));document.querySelector('.bottomNav')?.classList.add('hidden');for(const id of ['roleHub','ordersWorkspace','marketWorkspace','servicesWorkspace','supWorkspace','deliveryWorkspace','profileSettingsWorkspace','profileMoneyWorkspace'])document.getElementById(id)?.classList.add('hidden');for(const id of ['basketBar','orderModalBackdrop','checkoutBackdrop','serviceModalBackdrop','supModalBg','deliveryModalBg'])document.getElementById(id)?.classList.add('hidden')}
function closeFd(){fdWorkspace?.classList.add('hidden');window.BusinessLifeShell?.showActiveWorkspace?.()}
function injectFdEntry(){const panel=document.getElementById('profileDrawerPanel');if(!panel||panel.querySelector('#financialDocumentsButton'))return;const settings=panel.querySelector('#profileSettingsButton')?.closest('.drawerSection');const section=document.createElement('section');section.className='drawerSection';section.innerHTML='<h3>Financial records</h3><button id="financialDocumentsButton" class="fdDrawerButton" type="button"><span class="fdDrawerIcon">▤</span><span><strong>Statements & Documents</strong><small>Day, week, month, year and consolidated view</small></span></button>';if(settings)settings.insertAdjacentElement('afterend',section);else panel.appendChild(section);section.querySelector('#financialDocumentsButton').onclick=()=>openFd()}
function activeState(){return window.BusinessLifeProfileState||{}}
async function resolveContext(){
  const state=activeState(),role=state.activeRole||state.snapshot?.account?.active_role;
  if(!role)throw new Error('Choose a profile first.');
  const accountId=Number(state.accountId||state.snapshot?.account?.id||0);
  if(['merchant','supplier'].includes(role)){
    const w=await fdApi('/api/accounting/workspaces');
    const businessId=Number(w.active_business_id);
    const business=(w.businesses||[]).find(b=>Number(b.id)===businessId);
    return{role,accountId,businessId,label:(business?.name||('Business #'+businessId))+' · '+fdNice(role)};
  }
  return{role,accountId,businessId:null,label:role==='service_provider'?'Local Services':fdNice(role)};
}
function scopeQuery(){
  const q=new URLSearchParams({profile_role:fdContext.role});
  if(fdContext.businessId)q.set('business_id',fdContext.businessId);
  return q;
}
function periodTabs(){return '<div class="fdPeriodTabs">'+['day','week','month','year'].map(p=>'<button type="button" data-fd-period="'+p+'" class="'+(fdPeriod===p?'active':'')+'">'+fdNice(p)+'</button>').join('')+'</div>'}
function modeTabs(){return '<div class="fdModeTabs"><button type="button" data-fd-mode="scope" class="'+(fdMode==='scope'?'active':'')+'">This profile</button><button type="button" data-fd-mode="consolidated" class="'+(fdMode==='consolidated'?'active':'')+'">My consolidated view</button></div>'}
function metric(label,value,note=''){return '<article class="fdMetric"><span>'+fdEsc(label)+'</span><strong>'+fdMoney(value)+'</strong>'+(note?'<small>'+fdEsc(note)+'</small>':'')+'</article>'}
function impactRows(totals={}){
  const order=[
    ['revenue','Revenue'],['expense','Expenses'],['fee_expense','Fees charged to this profile'],['tax_expense','Tax / withholding charged'],
    ['purchase','Purchases'],['cash_in','Other cash in'],['cash_out','Other cash out'],['refund_in','Refunds received'],
    ['transfer_in','Transfers in'],['transfer_out','Transfers out'],['neutral','Context-only amounts']
  ];
  return order.filter(([k])=>Number(totals?.[k]?.amount||0)!==0||Number(totals?.[k]?.line_count||0)>0).map(([k,label])=>
    '<div class="fdBreakdownRow"><span>'+fdEsc(label)+'<small>'+Number(totals[k]?.line_count||0)+' line'+(Number(totals[k]?.line_count||0)===1?'':'s')+'</small></span><strong>'+fdMoney(totals[k]?.amount||0)+'</strong></div>'
  ).join('')||'<div class="fdEmpty">No documented financial activity in this period.</div>';
}
function fiscalBadge(status){const label=status==='fiscal_validated'?'Fiscal validated':status==='fiscal_candidate'?'Fiscal candidate':status==='not_applicable'?'Not fiscal':'Internal evidence';return '<span class="fdFiscal '+fdEsc(status||'internal_evidence')+'">'+fdEsc(label)+'</span>'}
function documentCard(d){
  const lines=Array.isArray(d.lines)?d.lines:[];
  return '<article class="fdDocumentCard"><div class="fdDocumentTop"><div><small>'+new Date(d.occurred_at).toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'})+'</small><strong>'+fdEsc(d.title||fdNice(d.document_type))+'</strong></div><div class="fdDocumentAmount">'+fdMoney(d.gross_amount)+'</div></div><div class="fdDocMeta">'+fiscalBadge(d.fiscal_status)+'<span>'+fdEsc(fdNice(d.document_type))+'</span><span>'+fdEsc(d.public_id)+'</span></div>'+(lines.length?'<div class="fdLineList">'+lines.map(l=>'<div><span>'+fdEsc(fdNice(l.line_kind))+(l.economic_owner?' · '+fdEsc(fdNice(l.economic_owner)):'')+'</span><strong>'+fdMoney(l.amount)+'</strong></div>').join('')+'</div>':'')+'<div class="fdSource">Source: '+fdEsc(d.source_type)+' #'+fdEsc(d.source_id)+'</div></article>';
}
async function loadScopeStatement(){
  const q=scopeQuery();q.set('anchor',fdAnchor);
  const statement=await fdApi('/api/financial-statements/'+encodeURIComponent(fdPeriod)+'?'+q.toString());
  const docsQ=scopeQuery();docsQ.set('from',statement.period.start_date);docsQ.set('to',statement.period.end_date_exclusive);docsQ.set('limit','80');
  const docs=await fdApi('/api/financial-documents?'+docsQ.toString());
  return{statement,documents:docs.documents||[]};
}
function renderScope(data){
  const s=data.statement,t=s.totals||{},d=s.derived||{};
  return '<section class="fdSummary">'+
    '<div class="fdMetrics">'+metric('Revenue',t.revenue?.amount,'Recognized documented revenue')+metric('Expenses',Number(t.expense?.amount||0)+Number(t.fee_expense?.amount||0)+Number(t.tax_expense?.amount||0),'Includes participant-charged fees/tax')+metric('Operating result',d.operating_result,'Derived, not a replacement ledger')+metric('Purchases',d.documented_purchases,'Customer/personal purchase evidence')+'</div>'+
    '<section class="fdCard"><div class="fdSectionHead"><div><small>PERIOD BREAKDOWN</small><h2>'+fdEsc(fdNice(fdPeriod))+' statement</h2></div><span>'+Number(s.document_count||0)+' documents</span></div>'+impactRows(t)+'</section>'+
    '<section class="fdCard fdBoundary"><strong>Evidence boundary</strong><p>These statements are derived from authoritative source ledgers. “Internal evidence” does not automatically mean a BIR-valid tax invoice.</p></section>'+
    '<section class="fdCard"><div class="fdSectionHead"><div><small>DRILL DOWN</small><h2>Financial documents</h2></div><span>'+data.documents.length+' shown</span></div><div class="fdDocuments">'+(data.documents.length?data.documents.map(documentCard).join(''):'<div class="fdEmpty">No financial documents in this period.</div>')+'</div></section>';
}
function scopeCard(x){
  const s=x.statement,t=s.totals||{},d=s.derived||{};
  return '<article class="fdScopeCard"><div class="fdScopeHead"><div><small>'+fdEsc((x.profile_roles||[]).map(fdNice).join(' · '))+'</small><strong>'+fdEsc(x.label)+'</strong></div><span>'+Number(s.document_count||0)+' docs</span></div><div class="fdScopeMetrics"><div><span>Revenue</span><strong>'+fdMoney(t.revenue?.amount)+'</strong></div><div><span>Expenses</span><strong>'+fdMoney(Number(t.expense?.amount||0)+Number(t.fee_expense?.amount||0)+Number(t.tax_expense?.amount||0))+'</strong></div><div><span>Result</span><strong>'+fdMoney(d.operating_result)+'</strong></div></div>'+(x.shared_business_scope?'<small class="fdSharedNote">Shared Merchant/Supplier business ledger counted once in consolidation.</small>':'')+'</article>';
}
function renderConsolidated(data){
  const c=data.consolidated||{},t=c.totals||{},d=c.derived||{};
  return '<section class="fdSummary"><div class="fdMetrics">'+metric('Revenue',t.revenue?.amount)+metric('Expenses',Number(t.expense?.amount||0)+Number(t.fee_expense?.amount||0)+Number(t.tax_expense?.amount||0))+metric('Operating result',d.operating_result)+metric('Purchases',d.documented_purchases)+'</div>'+
    '<section class="fdCard"><div class="fdSectionHead"><div><small>MY OWN SCOPES</small><h2>Consolidated overview</h2></div><span>'+Number(c.document_count||0)+' docs</span></div><div class="fdScopeList">'+(data.scopes||[]).map(scopeCard).join('')+'</div></section>'+
    '<section class="fdCard fdBoundary"><strong>Consolidation rule</strong><p>'+fdEsc(data.consolidation_rule||'')+' No other person or business is included.</p></section></section>';
}
function bindFdControls(){
  document.getElementById('fdBack').onclick=closeFd;
  document.querySelectorAll('[data-fd-period]').forEach(b=>b.onclick=async()=>{fdPeriod=b.dataset.fdPeriod;await renderFd()});
  document.querySelectorAll('[data-fd-mode]').forEach(b=>b.onclick=async()=>{fdMode=b.dataset.fdMode;await renderFd()});
  const a=document.getElementById('fdAnchor');if(a)a.onchange=async()=>{fdAnchor=a.value||fdAnchor;await renderFd()};
}
async function renderFd(){
  if(!fdContext)return;
  fdWorkspace.innerHTML='<div class="fdHeader"><button id="fdBack" class="fdBack" type="button">‹</button><div><h1>Statements & Documents</h1><p>'+fdEsc(fdMode==='scope'?fdContext.label:'All my active financial scopes')+'</p></div></div>'+
    '<section class="fdHero"><small>FINANCIAL EVIDENCE</small><h2>Every amount should be traceable.</h2><p>Review each profile separately or see your own consolidated financial picture. Source ledgers remain authoritative.</p></section>'+
    '<section class="fdControls">'+modeTabs()+periodTabs()+'<label>Anchor date<input id="fdAnchor" type="date" value="'+fdEsc(fdAnchor)+'"></label></section>'+
    '<div id="fdContent"><div class="fdEmpty">Loading statement…</div></div>';
  bindFdControls();
  try{
    const content=document.getElementById('fdContent');
    if(fdMode==='scope')content.innerHTML=renderScope(await loadScopeStatement());
    else content.innerHTML=renderConsolidated(await fdApi('/api/financial-statements/consolidated/'+encodeURIComponent(fdPeriod)+'?anchor='+encodeURIComponent(fdAnchor)));
  }catch(e){document.getElementById('fdContent').innerHTML='<div class="fdError">'+fdEsc(e.message)+'</div>'}
}
async function openFd(){if(!fdToken())return;ensureFd();hideFdBase();fdWorkspace.classList.remove('hidden');fdWorkspace.innerHTML='<div class="fdEmpty">Loading financial context…</div>';try{fdContext=await resolveContext();await renderFd()}catch(e){fdWorkspace.innerHTML='<div class="fdHeader"><button id="fdBack" class="fdBack" type="button">‹</button><div><h1>Statements & Documents</h1></div></div><div class="fdError">'+fdEsc(e.message)+'</div>';document.getElementById('fdBack').onclick=closeFd}}
function bootFd(){ensureFd();injectFdEntry();document.addEventListener('abl:drawer-rendered',injectFdEntry,{passive:true});document.addEventListener('abl:profile-state',()=>{fdContext=null},{passive:true})}
window.BusinessLifeFinancialDocuments=Object.freeze({open:openFd});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bootFd,{once:true});else bootFd();
