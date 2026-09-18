const token=()=>localStorage.getItem('abl_token')||'';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,options={}){const headers={'Content-Type':'application/json',...(options.headers||{})};if(token())headers.Authorization='Bearer '+token();const r=await fetch(path,{...options,headers});const data=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(data.error||('Request failed ('+r.status+')')),{status:r.status,data});return data}
let pctx={me:null,admin:null,config:null,paymongo:null};
function money(v,c='PHP'){try{return new Intl.NumberFormat('en-PH',{style:'currency',currency:c}).format(Number(v||0))}catch{return '₱'+Number(v||0).toFixed(2)}}
function toast(msg){let n=document.getElementById('paymentToast');if(!n){n=document.createElement('div');n.id='paymentToast';n.className='paymentToast';document.body.appendChild(n)}n.textContent=msg;n.classList.add('show');setTimeout(()=>n.classList.remove('show'),2800)}
const blockerCopy={
  PAYMONGO_SECRET_KEY_NOT_READY:'PayMongo secret key is missing.',
  PAYMONGO_WEBHOOK_NOT_READY:'Signed PayMongo webhook is not ready.',
  PAYMONGO_NO_ONLINE_METHOD_ENABLED:'No PayMongo online payment method is enabled.',
  PAYMONGO_LIVE_MODE_REQUIRED_FOR_REAL_CUSTOMER_PILOT:'Runtime is still in PayMongo test mode.',
  PAYMONGO_LIVE_NOT_EXPLICITLY_ENABLED:'PAYMONGO_LIVE_ENABLED is not enabled.',
  PAYMONGO_LIVE_SECRET_KEY_REQUIRED:'A PayMongo live secret key is required.',
  PAYMONGO_LIVE_PAYMENT_EVIDENCE_MISSING:'No verified LIVE PayMongo payment has completed yet.',
  PAYMONGO_LIVE_RECONCILIATION_EVIDENCE_MISSING:'The LIVE validation payment has not been matched against PayMongo API evidence yet.'
};
function gateState(stage){return pctx.paymongo?.pilot_readiness?.[stage]||null}
function gateBlockers(gate){return(gate?.blockers||[]).map(x=>blockerCopy[x]||String(x).replaceAll('_',' '))}
function methodLabel(x){return({gcash:'GCash',paymaya:'Maya',qrph:'QR Ph',card:'Card',grab_pay:'GrabPay',shopeepay:'ShopeePay'})[x]||x}
function ensureUi(){if(!document.getElementById('paymentBackdrop')){const w=document.createElement('div');w.id='paymentBackdrop';w.className='paymentBackdrop hidden';w.innerHTML='<section class="paymentSheet"><header><div><small>Business & Life</small><h2>Payments</h2></div><button class="paymentClose" type="button">×</button></header><div id="paymentBody"></div></section>';document.body.appendChild(w);w.querySelector('.paymentClose').onclick=closePayments;w.addEventListener('click',e=>{if(e.target===w)closePayments()})}addButton()}
function addButton(){const top=document.querySelector('.topActions');if(!top||!token()||document.getElementById('paymentCenterBtn'))return;const b=document.createElement('button');b.id='paymentCenterBtn';b.className='paymentCenterBtn';b.type='button';b.textContent='Payments';b.onclick=openPayments;top.prepend(b)}
function openSheet(){ensureUi();document.getElementById('paymentBackdrop').classList.remove('hidden');document.body.style.overflow='hidden'}
function closePayments(){document.getElementById('paymentBackdrop')?.classList.add('hidden');document.body.style.overflow=''}
async function loadCtx(){
  const mePromise=pctx.me?Promise.resolve(pctx.me):api('/api/me').then(x=>(pctx.me=x));
  const adminPromise=pctx.admin?Promise.resolve(pctx.admin):api('/api/admin/me').then(x=>(pctx.admin=x)).catch(()=>(pctx.admin={is_admin:false,permissions:[],assignments:[]}));
  const configPromise=api('/api/payments/config');
  const paymongoPromise=api('/api/payments/paymongo/status').catch(()=>null);
  const [, , config, paymongo]=await Promise.all([mePromise,adminPromise,configPromise,paymongoPromise]);
  pctx.config=config;
  pctx.paymongo=paymongo;
}
async function openPayments(){
  openSheet();const body=document.getElementById('paymentBody');body.innerHTML='<div class="paymentLoading">Loading payment state…</div>';
  try{
    await loadCtx();const isSuper=(pctx.admin.assignments||[]).some(x=>x.admin_role==='super_admin');const adminAllowed=(pctx.admin.permissions||[]).includes('payment.view')||isSuper;const canManagePayments=(pctx.admin.permissions||[]).includes('payment.manage')||isSuper;
    const [orders,intents]=await Promise.all([api('/api/payments/open-orders'),api('/api/payments/mine')]);
    const liveGate=gateState('controlled_pilot'),qaGate=gateState('internal_qa');
    const payReady=liveGate?.state==='READY',qaReady=qaGate?.state==='READY';
    const bannerTitle=payReady?'PayMongo LIVE ready for first pilot':(qaReady?'PayMongo ready for internal QA · live pilot HOLD':'PayMongo setup incomplete');
    const bannerCopy=payReady
      ?'Live Hosted Checkout and signed webhook are ready. A payment becomes authoritative only after verified provider confirmation.'
      :(qaReady?'Sandbox checkout is available only for internal QA. Real-customer checkout stays blocked until PayMongo LIVE is ready.':'Online checkout remains safely unavailable until the required PayMongo configuration and webhook are ready.');
    body.innerHTML='<div class="paymentProviderBanner '+(payReady?'ready':'notReady')+'"><div><strong>'+esc(bannerTitle)+'</strong><p>'+esc(bannerCopy)+'</p></div><span>'+(pctx.paymongo?('PAYMONGO '+String(pctx.paymongo.mode||'test').toUpperCase()):'NO PSP')+'</span></div><div class="paymentTabs"><button class="active" data-ptab="pay">Pay online</button><button data-ptab="history">My payments</button>'+(adminAllowed?'<button data-ptab="admin">Finance Admin</button>':'')+'</div><section id="paymentPay"></section><section id="paymentHistory" class="hidden"></section><section id="paymentAdmin" class="hidden"></section>';
    document.querySelectorAll('[data-ptab]').forEach(b=>b.onclick=()=>switchTab(b.dataset.ptab,b));
    renderOpenOrders(orders,canManagePayments);renderHistory(intents);if(adminAllowed){await renderAdmin();renderPayMongoSetup(document.getElementById('paymentAdmin'))}
  }catch(e){body.innerHTML='<div class="paymentEmpty">'+esc(e.message)+'</div>'}
}
function switchTab(tab,btn){document.querySelectorAll('[data-ptab]').forEach(x=>x.classList.toggle('active',x===btn));for(const name of ['Pay','History','Admin'])document.getElementById('payment'+name)?.classList.toggle('hidden',tab!==name.toLowerCase())}
function renderOpenOrders(rows,canManagePayments=false){
  const box=document.getElementById('paymentPay');
  if(!rows.length){box.innerHTML='<div class="paymentEmpty">No unpaid online orders.</div>';return}
  const checkout=pctx.paymongo?.checkout_policy||{},enabled=Boolean(checkout.checkout_enabled),methods=(checkout.enabled_methods||[]).map(methodLabel);
  const validation=gateState('live_validation');
  const validationOverride=!enabled&&Boolean(canManagePayments)&&Boolean(checkout.production_surface)&&validation?.state==='READY';
  const actionEnabled=enabled||validationOverride;
  box.innerHTML='<div class="paymentNotice"><strong>Provider-authoritative payments</strong><p>Creating an intent never marks the order paid. Only a verified server-side provider confirmation may do that.</p>'
    +(methods.length?'<p><strong>Available online methods:</strong> '+esc(methods.join(' · '))+'</p>':'')
    +(validationOverride?'<div class="paymentHold"><strong>Admin LIVE validation only.</strong> External-customer checkout remains HOLD until one LIVE payment is confirmed and reconciled.</div>':'')
    +(!enabled&&!validationOverride?'<div class="paymentHold">Online checkout is HOLD on this environment. '+esc(gateBlockers(gateState(checkout.required_stage==='controlled_pilot'?'controlled_pilot':'internal_qa')).join(' '))+'</div>':'')
    +'</div>'
    +rows.map(o=>'<article class="paymentOrder"><div><small>'+esc(o.business_name)+'</small><h3>'+esc(o.order_number||('#'+o.id))+'</h3><p>'+money(o.outstanding_amount,o.currency_code||'PHP')+' outstanding • '+esc(o.payment_status)+'</p></div><button data-pay-order="'+o.id+'" type="button" '+(actionEnabled?'':'disabled')+'>'+(validationOverride?'Run LIVE validation':(enabled?'Pay securely':'Online HOLD'))+'</button></article>').join('');
  box.querySelectorAll('[data-pay-order]:not([disabled])').forEach(b=>b.onclick=()=>createIntent(Number(b.dataset.payOrder)))
}
async function createIntent(orderId){try{const key='android-'+orderId+'-'+Date.now()+'-'+Math.random().toString(16).slice(2);const provider=(pctx.paymongo?'paymongo':(pctx.config.default_provider||''));const intent=await api('/api/payments/intents/order/'+orderId,{method:'POST',headers:{'Idempotency-Key':key},body:JSON.stringify({logical_method:'ewallet',provider_code:provider})});if(provider==='paymongo'&&pctx.paymongo?.secret_ready){const checkout=await api('/api/payments/paymongo/checkout/'+encodeURIComponent(intent.public_id),{method:'POST',body:'{}'});if(checkout.checkout_url){toast('Opening secure PayMongo checkout…');window.location.assign(checkout.checkout_url);return}}if(intent.status==='requires_provider')toast('Payment intent created safely. PayMongo credentials are still required before checkout can open.');else toast('Payment intent prepared. Provider action is required.');await openPayments()}catch(e){toast(e.message)}}
function renderHistory(rows){const box=document.getElementById('paymentHistory');if(!rows.length){box.innerHTML='<div class="paymentEmpty">No payment intents yet.</div>';return}box.innerHTML=rows.map(x=>'<article class="paymentIntent"><div><strong>'+esc(x.public_id)+'</strong><small>'+esc(x.logical_method)+' • '+esc(x.provider_code||'provider pending')+'</small></div><b>'+money(x.amount,x.currency_code)+'</b><span class="paymentState '+esc(x.status)+'">'+esc(x.status)+'</span></article>').join('')}
async function renderAdmin(){const box=document.getElementById('paymentAdmin');box.innerHTML='<div class="paymentLoading">Loading finance controls…</div>';try{const [overview,policies]=await Promise.all([api('/api/payments/admin/overview'),api('/api/payments/admin/fee-policies')]);const providerReady=overview.providers.some(x=>x.status==='active'||x.status==='sandbox');box.innerHTML='<div class="paymentAdminHero"><small>PAYMENT CONTROL PLANE</small><h3>Philippines finance</h3><p>Payment records are separate from provider authority, settlements and fee policy.</p></div><div class="paymentAdminGrid"><div><strong>'+sumCount(overview.intents)+'</strong><span>Payment intents</span></div><div><strong>'+sumCount(overview.refunds)+'</strong><span>Refund records</span></div><div><strong>'+sumCount(overview.settlements)+'</strong><span>Settlements</span></div><div><strong>'+overview.reconciliation_runs.length+'</strong><span>Reconciliation runs</span></div></div><div class="paymentControlCard"><h4>Provider adapters</h4>'+(overview.providers.length?overview.providers.map(p=>'<div class="providerRow"><span><strong>'+esc(p.display_name)+'</strong><small>'+esc(p.provider_code)+' • '+esc(p.adapter_version)+'</small></span><b>'+esc(p.status)+'</b></div>').join(''):'<div class="paymentWarning">No real PSP adapter is registered. Online checkout remains safely non-authoritative.</div>')+'</div><div class="paymentControlCard"><h4>Fee policies</h4><p class="paymentFine">No platform/operator fee is invented by this release. Policies stay draft until owner/commercial/legal decisions are made.</p>'+(policies.length?policies.map(p=>'<div class="providerRow"><span><strong>'+esc(p.policy_code)+' v'+p.version+'</strong><small>'+esc(p.service_scope)+' • '+((p.rules||[]).length)+' rules</small></span><b>'+esc(p.status)+'</b></div>').join(''):'<div class="paymentEmpty small">No fee policy created.</div>')+'</div><div class="paymentControlCard"><h4>Reconciliation</h4><p class="paymentFine">A provider statement parser is intentionally not faked. Until a PSP adapter is selected, reconciliation runs remain manual review.</p><button id="paymentReconBtn" type="button" '+(providerReady?'':'disabled')+'>Start provider reconciliation</button></div>'}catch(e){box.innerHTML='<div class="paymentEmpty">'+esc(e.message)+'</div>'}}
function renderPayMongoSetup(box){
  if(!box||!pctx.paymongo)return;
  const p=pctx.paymongo,w=p.webhook||{},qa=gateState('internal_qa'),validation=gateState('live_validation'),live=gateState('controlled_pilot'),policy=p.checkout_policy||{};
  const qaReady=qa?.state==='READY',validationReady=validation?.state==='READY',liveReady=live?.state==='READY',evidence=live?.evidence||{};
  const card=document.createElement('div');card.className='paymentControlCard pilotReadinessCard';
  const methods=(live?.enabled_methods||validation?.enabled_methods||qa?.enabled_methods||p.methods||[]).map(methodLabel);
  card.innerHTML='<h4>PayMongo first-pilot readiness</h4>'
    +'<p class="paymentFine">Cash remains available, but external customer testing requires LIVE PayMongo plus a verified pre-pilot payment and provider reconciliation.</p>'
    +'<div class="pilotGate '+(qaReady?'ready':'hold')+'"><span><strong>Internal QA</strong><small>'+esc(String(qa?.mode||p.mode||'test').toUpperCase())+' · '+esc(methods.join(' · ')||'No methods')+'</small></span><b>'+esc(qa?.state||'HOLD')+'</b></div>'
    +(!qaReady?'<ul class="pilotBlockers">'+gateBlockers(qa).map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'')
    +'<div class="pilotGate '+(validationReady?'ready':'hold')+'"><span><strong>Admin LIVE validation</strong><small>Live key + live mode + signed webhook; external customers still blocked</small></span><b>'+esc(validation?.state||'HOLD')+'</b></div>'
    +(!validationReady?'<ul class="pilotBlockers">'+gateBlockers(validation).map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'')
    +'<div class="pilotGate '+(liveReady?'ready':'hold')+'"><span><strong>First real-customer pilot</strong><small>Requires LIVE payment evidence + matched provider reconciliation</small></span><b>'+esc(live?.state||'HOLD')+'</b></div>'
    +(!liveReady?'<ul class="pilotBlockers">'+gateBlockers(live).map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'')
    +'<div class="providerRow"><span><strong>LIVE payment proof</strong><small>'+esc(evidence.latest_live_provider_payment_id||'No provider payment confirmed yet')+'</small></span><b>'+(evidence.live_payment_confirmed?'MATCHED WEBHOOK':'MISSING')+'</b></div>'
    +'<div class="providerRow"><span><strong>Provider reconciliation</strong><small>'+esc(evidence.reconciliation_run_public_id||'No matched reconciliation run yet')+'</small></span><b>'+(evidence.live_reconciliation_matched?'MATCHED':'MISSING')+'</b></div>'
    +'<div class="providerRow"><span><strong>Runtime mode</strong><small>Public production checkout policy: '+esc(policy.required_stage||'controlled_pilot')+'</small></span><b>'+esc(String(p.mode||'test').toUpperCase())+'</b></div>'
    +'<div class="providerRow"><span><strong>Secret key</strong><small>Stored only in Railway/provider secret storage</small></span><b>'+(p.secret_ready?'READY':'MISSING')+'</b></div>'
    +'<div class="providerRow"><span><strong>Signed webhook</strong><small>'+esc(w.url||'Created/discovered after the correct secret key is configured')+'</small></span><b>'+esc(w.status||'waiting')+'</b></div>'
    +'<div class="providerRow"><span><strong>External-customer checkout</strong><small>'+(policy.production_surface?'Production surface':'QA/preview surface')+'</small></span><b>'+(policy.checkout_enabled?'ENABLED':'HOLD')+'</b></div>'
    +(p.secret_ready&&!p.webhook_ready?'<button id="paymongoBootstrapRetry" type="button">Retry PayMongo webhook setup</button>':'')
    +(evidence.live_payment_confirmed&&!evidence.live_reconciliation_matched&&evidence.latest_live_intent_public_id?'<button id="paymongoLiveReconcile" type="button">Reconcile LIVE validation payment</button>':'')
    +(validationReady&&!evidence.live_payment_confirmed?'<p class="paymentFine"><strong>Next:</strong> open Pay online and use “Run LIVE validation” on a small unpaid order owned by the Admin test account.</p>':'');
  box.appendChild(card);
  const retry=document.getElementById('paymongoBootstrapRetry');
  if(retry)retry.onclick=async()=>{retry.disabled=true;try{const x=await api('/api/payments/admin/paymongo/webhook/bootstrap',{method:'POST',body:'{}'});toast(x.ready?'PayMongo webhook is ready.':'PayMongo webhook is not ready yet.');pctx.paymongo=await api('/api/payments/paymongo/status');await openPayments()}catch(e){toast(e.message)}finally{retry.disabled=false}};
  const reconcile=document.getElementById('paymongoLiveReconcile');
  if(reconcile)reconcile.onclick=async()=>{reconcile.disabled=true;try{const x=await api('/api/payments/admin/paymongo/reconcile-live/'+encodeURIComponent(evidence.latest_live_intent_public_id),{method:'POST',body:'{}'});toast(x.matched?'LIVE payment reconciled. Pilot readiness will refresh.':'Reconciliation found a mismatch. Pilot remains HOLD.');pctx.paymongo=await api('/api/payments/paymongo/status');await openPayments()}catch(e){toast(e.message)}finally{reconcile.disabled=false}}
}
function sumCount(rows){return(rows||[]).reduce((s,x)=>s+Number(x.count||0),0)}
function boot(){ensureUi();addButton();document.addEventListener('abl:profile-state',addButton);const q=new URLSearchParams(location.search);if(q.get('payment_result')==='paymongo'){setTimeout(async()=>{if(q.get('status')==='cancel')toast('PayMongo checkout was cancelled. No payment was recorded.');else toast('Returned from PayMongo. Waiting for verified webhook confirmation before marking the order paid.');history.replaceState({},document.title,location.pathname);await openPayments()},500)}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
