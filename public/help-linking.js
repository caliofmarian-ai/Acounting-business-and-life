(() => {
  const originalFetch = window.fetch.bind(window);

  const rules = [
    { code:'ERR-AUTH-001', test:(p,m,s)=>p.startsWith('/api/auth/') && (s===401 || /password|sign.?in|login|email/i.test(m)) },
    { code:'ERR-GOV-001', test:(p,m,s)=>p.startsWith('/api/governance/') && (s===401 || s===403 || /approval|authoriz|invitation|profile/i.test(m)) },
    { code:'ERR-ACC-009', test:(p,m,s)=>(p.startsWith('/api/accounting/') || p.startsWith('/api/summary') || p.startsWith('/api/transactions') || p.startsWith('/api/inventory')) && (s===403 || /workspace|business unavailable|profile required/i.test(m)) },
    { code:'ERR-ORD-003', test:(p,m)=>p.startsWith('/api/orders/') && /presence|cash|check.?in|here/i.test(m) },
    { code:'ERR-DEL-004', test:(p,m)=>p.startsWith('/api/delivery/') && /quote.*(missing|expired)|missing or expired|new quote/i.test(m) },
    { code:'ERR-DEL-006', test:(p,m,s)=>(p.startsWith('/api/courier/') || p.startsWith('/api/delivery/')) && (s===403 || /approval|eligib|available/i.test(m)) },
    { code:'ERR-SUP-002', test:(p,m,s)=>(p.startsWith('/api/procurement/') || p.startsWith('/api/supplier/')) && (s===403 || /relationship|required|supplier/i.test(m)) },
    { code:'ERR-SVC-002', test:(p,m,s)=>(p.startsWith('/api/services/') || p.startsWith('/api/service-provider/')) && (s===403 || /approval|credential|service provider/i.test(m)) },
    { code:'ERR-INC-001', test:(p,m,s)=>p.startsWith('/api/incidents') && (s===400 || s===413 || /image|pdf|evidence|file|upload|limit/i.test(m)) }
  ];

  const domainFallback = [
    { prefix:'/api/auth/', href:'/help/article/sign-in-recovery', label:'Account & sign-in help' },
    { prefix:'/api/governance/', href:'/help/article/profile-approval-required', label:'Profile approval help' },
    { prefix:'/api/accounting/', href:'/help/article/business-workspace-unavailable', label:'Accounting help' },
    { prefix:'/api/orders/', href:'/help/article/track-order', label:'Order help' },
    { prefix:'/api/marketplace/', href:'/help/article/place-order', label:'Marketplace help' },
    { prefix:'/api/delivery/', href:'/help/article/delivery-tracking-handoff', label:'Delivery help' },
    { prefix:'/api/courier/', href:'/help/article/courier-overview', label:'Delivery Provider help' },
    { prefix:'/api/procurement/', href:'/help/article/supplier-purchase-orders', label:'Supplier & procurement help' },
    { prefix:'/api/supplier/', href:'/help/article/supplier-overview', label:'Supplier help' },
    { prefix:'/api/services/', href:'/help/article/service-requests-quotes-jobs', label:'Local Services help' },
    { prefix:'/api/service-provider/', href:'/help/article/service-provider-overview', label:'Local Services help' },
    { prefix:'/api/incidents', href:'/help/article/report-problem', label:'Incident help' }
  ];

  function resolve(path,message,status){
    const specific=rules.find(r=>r.test(path,message,status));
    if(specific) return {href:'/help/error/'+specific.code,label:'Learn more',code:specific.code};
    const fallback=domainFallback.find(x=>path.startsWith(x.prefix));
    return fallback || {href:'/help',label:'Open Help Center'};
  }

  function ensureDock(){
    let dock=document.getElementById('contextHelpDock');
    if(dock) return dock;
    dock=document.createElement('div');
    dock.id='contextHelpDock';
    dock.className='contextHelpDock';
    dock.setAttribute('aria-live','polite');
    dock.innerHTML='<button class="contextHelpGlobal" type="button" aria-label="Open Help Center">?</button><div class="contextHelpNotice hidden"><div><strong>Need help?</strong><span></span></div><a href="/help">Learn more</a><button class="contextHelpClose" type="button" aria-label="Dismiss help suggestion">×</button></div>';
    document.body.appendChild(dock);
    dock.querySelector('.contextHelpGlobal').onclick=()=>location.assign('/help');
    dock.querySelector('.contextHelpClose').onclick=()=>dock.querySelector('.contextHelpNotice').classList.add('hidden');
    return dock;
  }

  function suggest({path,message,status}){
    if(!message || status<400) return;
    const target=resolve(path,message,status),dock=ensureDock(),notice=dock.querySelector('.contextHelpNotice');
    notice.querySelector('span').textContent=message;
    const link=notice.querySelector('a');
    link.href=target.href;
    link.textContent=target.label+(target.code?' · '+target.code:'');
    notice.classList.remove('hidden');
  }

  window.fetch=async function(input,init){
    const response=await originalFetch(input,init);
    try{
      const raw=typeof input==='string'?input:input?.url;
      if(response.ok || !raw) return response;
      const url=new URL(raw,location.origin);
      if(url.origin!==location.origin || !url.pathname.startsWith('/api/')) return response;
      const clone=response.clone();
      const type=clone.headers.get('content-type')||'';
      let message='';
      if(type.includes('application/json')){
        const data=await clone.json().catch(()=>({}));
        message=String(data.error||data.message||'');
      } else {
        message=String(await clone.text().catch(()=>'')).slice(0,240);
      }
      suggest({path:url.pathname,message,status:response.status});
    }catch{}
    return response;
  };

  function boot(){
    ensureDock();
    document.addEventListener('abl:help',event=>{
      const detail=event.detail||{};
      suggest({path:String(detail.path||'/api/'),message:String(detail.message||'Help is available for this task.'),status:Number(detail.status||400)});
    });
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
