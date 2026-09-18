const FEATURE_SPECS={
  admin:{js:'/admin-operations-ui.js',css:'/admin-operations.css'},
  legal:{js:'/legal-ui.js',css:'/legal.css'},
  payments:{js:'/payments-ui.js',css:'/payments.css'},
  incidents:{js:'/incidents-ui.js',css:'/incidents.css'},
  governance:{js:'/profile-governance-ui.js',css:'/profile-governance.css'},
  accounting:{js:'/business-accounting-ui.js',css:'/business-accounting.css'}
};

const featurePromises=new Map();
let adminAccess=null;

const token=()=>localStorage.getItem('abl_token')||'';

function toast(message){
  const existing=document.getElementById('roleToast');
  if(existing){
    existing.textContent=message;
    existing.classList.add('show');
    setTimeout(()=>existing.classList.remove('show'),2800);
    return;
  }
  let t=document.getElementById('lazyFeatureToast');
  if(!t){
    t=document.createElement('div');
    t.id='lazyFeatureToast';
    t.className='lazyFeatureToast';
    document.body.appendChild(t);
  }
  t.textContent=message;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2800);
}

function loadCss(href){
  if(document.querySelector('link[data-lazy-css="'+href+'"]'))return;
  const link=document.createElement('link');
  link.rel='stylesheet';
  link.href=href;
  link.dataset.lazyCss=href;
  document.head.appendChild(link);
}

async function loadFeature(name){
  if(featurePromises.has(name))return featurePromises.get(name);
  const spec=FEATURE_SPECS[name];
  if(!spec)throw new Error('Unknown feature: '+name);
  loadCss(spec.css);
  window.__ABL_LAZY_FEATURES__=true;
  const promise=import(spec.js).catch(error=>{
    featurePromises.delete(name);
    throw error;
  });
  featurePromises.set(name,promise);
  return promise;
}

function waitFor(id,timeout=3000){
  return new Promise(resolve=>{
    const now=document.getElementById(id);
    if(now)return resolve(now);
    const started=Date.now();
    const tick=()=>{
      const node=document.getElementById(id);
      if(node||Date.now()-started>=timeout)return resolve(node||null);
      setTimeout(tick,50);
    };
    tick();
  });
}

function hideNativeButton(id){
  const node=document.getElementById(id);
  if(node){
    node.hidden=true;
    node.style.display='none';
    node.setAttribute('aria-hidden','true');
  }
  return node;
}

async function loadAdminOps(){
  await loadFeature('admin');
  const api=window.BusinessLifeAdminOps;
  if(!api)throw new Error('Admin tools could not finish loading.');
  return api;
}

async function openSupport(){
  try{
    closeMore();
    const api=await loadAdminOps();
    api.openSupport();
  }catch(error){toast(error.message||'Could not open Support.')}
}

async function openAdmin(){
  try{
    closeMore();
    if(!(await fetchAdminAccess()))throw new Error('Admin access is unavailable for this account.');
    const api=await loadAdminOps();
    api.openAdmin();
  }catch(error){toast(error.message||'Could not open Admin.')}
}

async function openButtonFeature(name,id){
  try{
    closeMore();
    await loadFeature(name);
    const b=await waitFor(id,1600);
    if(!b)throw new Error('This feature could not finish loading.');
    hideNativeButton(id);
    b.click();
  }catch(error){toast(error.message||'Could not load this feature.')}
}

function ensureMore(){
  if(document.getElementById('lazyMoreBackdrop'))return;
  const bg=document.createElement('div');
  bg.id='lazyMoreBackdrop';
  bg.className='lazyMoreBackdrop hidden';
  bg.innerHTML='<section class="lazyMoreSheet" role="dialog" aria-modal="true" aria-label="More tools"><header><div><small>Business & Life</small><h2>More tools</h2></div><button id="lazyMoreClose" type="button" aria-label="Close">×</button></header><div class="lazyMoreGrid"><button data-lazy-action="payments" type="button"><strong>Payments</strong><small>Pay online and review payments</small></button><button data-lazy-action="legal" type="button"><strong>Legal</strong><small>Terms, privacy and consent center</small></button><button data-lazy-action="report" type="button"><strong>Report a problem</strong><small>Private incident reporting</small></button><a href="/help"><strong>Help Center</strong><small>Public product guides</small></a></div></section>';
  document.body.appendChild(bg);
  bg.addEventListener('click',event=>{if(event.target===bg)closeMore()});
  bg.querySelector('#lazyMoreClose').onclick=closeMore;
  bg.querySelector('[data-lazy-action="payments"]').onclick=()=>openButtonFeature('payments','paymentCenterBtn');
  bg.querySelector('[data-lazy-action="legal"]').onclick=()=>openButtonFeature('legal','legalCenterBtn');
  bg.querySelector('[data-lazy-action="report"]').onclick=()=>openButtonFeature('incidents','incidentQuickButton');
}

function openMore(){
  ensureMore();
  document.getElementById('lazyMoreBackdrop').classList.remove('hidden');
  document.body.classList.add('lazyModalOpen');
}
function closeMore(){
  document.getElementById('lazyMoreBackdrop')?.classList.add('hidden');
  document.body.classList.remove('lazyModalOpen');
}

async function fetchAdminAccess(){
  if(adminAccess!==null)return adminAccess;
  if(!token())return false;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),6000);
  try{
    const r=await fetch('/api/admin/me',{headers:{Authorization:'Bearer '+token()},signal:controller.signal});
    if(!r.ok)return adminAccess=false;
    const data=await r.json().catch(()=>({}));
    return adminAccess=Boolean(data.is_admin);
  }catch{return adminAccess=false}
  finally{clearTimeout(timer)}
}

async function mountLaunchers(){
  if(!token())return;
  const top=document.querySelector('.topActions');
  if(!top)return;

  if(!document.getElementById('lazySupportBtn')){
    const help=document.createElement('button');
    help.id='lazySupportBtn';
    help.className='lazyFeatureButton';
    help.type='button';
    help.textContent='Help';
    help.onclick=openSupport;
    top.prepend(help);
  }

  if(!document.getElementById('lazyMoreBtn')){
    const more=document.createElement('button');
    more.id='lazyMoreBtn';
    more.className='lazyFeatureButton';
    more.type='button';
    more.textContent='More';
    more.onclick=openMore;
    top.appendChild(more);
  }

  if(await fetchAdminAccess()){
    if(!document.getElementById('lazyAdminBtn')){
      const admin=document.createElement('button');
      admin.id='lazyAdminBtn';
      admin.className='lazyFeatureButton lazyAdminButton';
      admin.type='button';
      admin.textContent='Admin';
      admin.onclick=openAdmin;
      top.prepend(admin);
    }
  }
}

async function loadDrawerFeatures(){
  try{
    await Promise.all([loadFeature('governance')]);
  }catch(error){console.warn('Governance lazy-load:',error.message)}
}

async function loadAccountingForRole(role){
  if(!['merchant','supplier'].includes(String(role||'')))return;
  try{await loadFeature('accounting')}catch(error){console.warn('Accounting lazy-load:',error.message)}
}

function boot(){
  ensureMore();
  mountLaunchers();
  document.addEventListener('abl:profile-state',event=>{
    mountLaunchers();
    loadAccountingForRole(event.detail?.activeRole);
  });
  document.addEventListener('abl:drawer-rendered',()=>loadDrawerFeatures(),{passive:true});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)mountLaunchers()});
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
else boot();
