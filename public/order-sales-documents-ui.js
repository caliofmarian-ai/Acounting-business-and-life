// Sales-document UI mounts beside Orders without changing the Orders agent's code.
(()=>{
  const API='/api/notifications/order-sales-documents';
  let modal=null,mode='',activeBusiness=null;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date=value=>{try{return new Date(value).toLocaleDateString('en-PH')}catch{return String(value||'')}};
  const peso=value=>'₱'+new Intl.NumberFormat('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value)||0);
  async function api(path,init={}){
    const response=await fetch(path,{credentials:'same-origin',...init});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'Cannot load purchase documents ('+response.status+')');
    return data;
  }
  function setMessage(text,isError=false){
    if(!modal)return;
    const target=modal.querySelector('#osdMessage');
    if(target){target.textContent=text;target.classList.toggle('error',isError)}
  }
  function style(){
    if(document.getElementById('osdStyles'))return;
    const node=document.createElement('style');node.id='osdStyles';
    node.textContent=`
      .osdEntry{min-height:44px;margin:8px 0;padding:11px 15px;font:750 14px system-ui;background:#e8f7f3;color:#086a59;border:1px solid #50a594;border-radius:12px;cursor:pointer}
      .osdModal{position:fixed;inset:0;background:rgba(10,25,38,.75);z-index:9700;display:flex;align-items:center;justify-content:center;padding:0}
      .osdPanel{background:#fff;color:#102731;width:min(740px,100%);height:min(93dvh,940px);overflow:auto;border-radius:18px;box-shadow:0 12px 30px rgba(0,0,0,.25)}
      .osdHeader{position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px;background:#fff;border-bottom:1px solid #e3e9ed}
      .osdHeader h2{font:800 21px system-ui;margin:0}.osdHeader p{font:13px/1.4 system-ui;color:#58707d;margin:4px 0 0}
      .osdClose{flex-shrink:0;width:44px;height:44px;border:1px solid #bbc9d1;border-radius:11px;background:#fff;font-size:24px;cursor:pointer}
      .osdBody{padding:16px;display:grid;gap:18px}.osdBox{border:1px solid #e0e7ec;border-radius:12px;padding:14px}
      .osdBox h3{font:800 16px system-ui;margin:0 0 12px}.osdRow{border-top:1px solid #e0e7ec;padding:12px 0;display:grid;gap:5px;font:14px/1.45 system-ui}
      .osdRow:first-of-type{border-top:0}.osdRow small{color:#506977}.osdRow strong{font:750 15px system-ui}
      .osdRow a{color:#0c668c;text-decoration:underline;min-height:34px;display:inline-flex;align-items:center;width:max-content}
      .osdSend{min-height:43px;padding:10px 14px;border-radius:10px;background:#096b61;color:#fff;border:0;font:750 14px system-ui;cursor:pointer;width:max-content}
      .osdSend:disabled{background:#b5c3c5;cursor:not-allowed}.osdMessage{font:14px/1.4 system-ui;color:#097866;min-height:18px}.osdMessage.error{color:#b3261e}
      .osdDisclaimer{font:13px/1.55 system-ui;background:#f3f7fa;border-radius:10px;padding:11px;color:#465f6b}
      @media(max-width:600px){.osdPanel{height:100dvh;border-radius:0}.osdBody{padding:12px}.osdHeader{padding:12px}}
    `;
    document.head.appendChild(node);
  }
  function close(){if(modal){modal.remove();modal=null;activeBusiness=null}}
  function shell(view){
    style();modal=document.createElement('div');modal.className='osdModal';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby','osdHeading');
    modal.innerHTML='<div class="osdPanel"><div class="osdHeader"><div><h2 id="osdHeading">'+
      (view==='merchant'?'Email customer order documents':'My purchase documents')+
      '</h2><p>Business & Life accounting records</p></div><button class="osdClose" type="button" aria-label="Close">×</button></div>'+
      '<div class="osdBody"><div class="osdDisclaimer">These are commercial order/payment records, not automatically valid BIR tax invoices. An email request is queued, not instantly marked delivered.</div>'+
      '<div id="osdMessage" class="osdMessage" role="status"></div><div id="osdContent">Loading…</div></div></div>';
    modal.querySelector('.osdClose').onclick=close;
    document.body.appendChild(modal);
  }
  const documentLink=id=>API+'/'+Number(id)+'/print';
  function documentItem(d){
    return '<div class="osdRow"><strong>'+esc(d.order_number||'Order')+' · '+esc(d.document_class.replaceAll('_',' '))+'</strong>'+
      '<small>'+esc(d.company_name||'Merchant')+' · '+esc(date(d.created_at))+' · '+esc(peso(d.total))+'</small>'+
      '<small>Recorded paid: '+esc(peso(d.paid))+' · Still due: '+esc(peso(d.amount_due))+'</small>'+
      '<a href="'+documentLink(d.id)+'" target="_blank" rel="noopener">View / Print / Save as PDF</a></div>';
  }
  async function customer(){
    const box=modal?.querySelector('#osdContent');if(!box)return;
    const old=modal;
    const result=await api(API+'/my');
    if(old!==modal)return;
    box.innerHTML='<section class="osdBox"><h3>Documents available in your account</h3>'+
      (result.documents?.length?result.documents.map(documentItem).join(''):'<p>No documents have been issued for your orders yet.</p>')+'</section>';
  }
  async function merchant(){
    const old=modal,box=modal?.querySelector('#osdContent');if(!box)return;
    const ctx=await api('/api/accounting/workspaces');
    if(old!==modal)return;
    if(ctx.role!=='merchant'||!Number(ctx.active_business_id))throw new Error('Open the Merchant business workspace first.');
    const businessId=Number(ctx.active_business_id);activeBusiness=businessId;
    const [orders,docs]=await Promise.all([
      api(API+'/merchant-orders?business_id='+businessId),
      api(API+'/business?business_id='+businessId)
    ]);
    if(old!==modal||activeBusiness!==businessId)return;
    const list=(orders.orders||[]).map(o=>{
      const canSend=Boolean(o.customer_email_verified);
      return '<div class="osdRow"><strong>'+esc(o.order_number||o.id)+' · '+esc(o.order_status)+'</strong>'+
        '<small>'+esc(date(o.created_at))+' · Total '+esc(peso(o.total))+' · Paid '+esc(peso(o.paid_amount))+'</small>'+
        '<small>'+ (canSend?'Registered Customer: email verified':'Registered Customer: email not verified — cannot send')+'</small>'+
        '<button type="button" class="osdSend" data-osd-send="'+Number(o.id)+'" '+(canSend?'':'disabled')+'>'+
          (o.has_document?'Email / Send again':'Email purchase document')+'</button></div>';
    }).join('');
    box.innerHTML='<section class="osdBox"><h3>Eligible completed or paid orders</h3>'+
      (list||'<p>No eligible registered-Customer orders for this business.</p>')+'</section>'+
      '<section class="osdBox"><h3>Sent / archived purchase records</h3>'+
      (docs.documents?.length?docs.documents.map(documentItem).join(''):'<p>No order documents saved yet.</p>')+'</section>';
    box.querySelectorAll('[data-osd-send]').forEach(button=>button.onclick=()=>send(Number(button.dataset.osdSend),button));
  }
  const newKey=()=>('sales-doc-'+Date.now()+'-'+Math.random().toString(36).slice(2,15));
  async function send(orderId,button){
    if(!modal||!activeBusiness)return;
    const panel=modal,biz=activeBusiness;button.disabled=true;
    try{
      const context=await api('/api/accounting/workspaces');
      if(modal!==panel||context.role!=='merchant'||Number(context.active_business_id)!==biz)throw new Error('Merchant business changed. Reopen documents.');
      const result=await api(API+'/orders/'+orderId+'/send',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({business_id:biz,client_request_key:newKey()})
      });
      if(modal!==panel)return;
      setMessage(result.already_queued?'Already queued.':'Email queued for the verified Customer. Delivery will be tracked.');
      await merchant();
    }catch(e){if(modal===panel)setMessage(e.message,true)}
    finally{button.disabled=false}
  }
  async function open(view){
    if(modal)return;
    mode=view;shell(view);
    try{if(view==='merchant')await merchant();else await customer()}
    catch(e){setMessage(e.message,true);const x=modal?.querySelector('#osdContent');if(x)x.textContent='Unable to load purchase documents.'}
  }
  function mount(){
    const workspace=document.getElementById('ordersWorkspace');
    if(!workspace||workspace.classList.contains('hidden'))return;
    const heading=workspace.querySelector('.ordersHeader h1');
    if(!heading)return;
    const view=heading.textContent.trim()==='My Orders'?'customer':heading.textContent.trim()==='Orders'?'merchant':null;
    const existing=workspace.querySelector('.osdEntry');
    if(!view){existing?.remove();return}
    if(existing&&existing.dataset.mode===view)return;
    existing?.remove();
    const button=document.createElement('button');
    button.className='osdEntry';button.type='button';button.dataset.mode=view;
    button.textContent=view==='merchant'?'Email receipts / Order documents':'My receipts / Order documents';
    button.addEventListener('click',()=>open(view));
    heading.closest('.ordersHeader')?.insertAdjacentElement('afterend',button);
  }
  document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
  document.addEventListener('abl:profile-state',()=>{close();queueMicrotask(mount)});
  function boot(){
    mount();
    let pending=false;
    new MutationObserver(()=>{
      if(pending)return;
      pending=true;
      queueMicrotask(()=>{pending=false;mount()})
    }).observe(document.body,{childList:true,subtree:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
