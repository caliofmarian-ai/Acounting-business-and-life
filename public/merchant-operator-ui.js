/** Restricted operator-only browser surface, separate from Business & Life main shell. */
(()=>{'use strict';
  const byId=id=>document.getElementById(id);
  const state={csrf:'',pair:'',draft:null,voiceSession:null,busy:false,epoch:0,recognition:null};
  const h=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&quot;',"'":'&#39;'}[c]));
  const amount=x=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(x||0));
  function message(x){byId('status').textContent=String(x||'').slice(0,250)}
  function show(id,visible){byId(id).classList.toggle('hidden',!visible)}
  function resetDraft(){state.epoch++;state.draft=null;state.voiceSession=null;byId('draft').textContent='No draft yet.';byId('quote').disabled=true;byId('transcript').value='';}
  async function api(path,{method='GET',data=null,authorized=false}={}){
    const headers={'Accept':'application/json','Content-Type':'application/json'};
    if(authorized&&method!=='GET'&&state.csrf)headers['x-team-csrf-token']=state.csrf;
    const r=await fetch(path,{method,headers,credentials:'same-origin',cache:'no-store',
      body:data==null?undefined:JSON.stringify(data)});
    const result=await r.json().catch(()=>({}));
    if(!r.ok){const e=new Error(result.error||'Staff action unavailable.');e.code=result.code||'';e.status=r.status;throw e}
    return result;
  }
  async function loadOperatorSession(){
    try{const session=await api('/api/orders/operator/session');
      if(!session.active)throw Error('Shift missing');
      state.csrf=session.csrf_token;show('pairPanel',false);show('workPanel',true);
      byId('operatorName').textContent=session.operator.name;
      await Promise.all([loadCatalog(),loadOrders()]);message('Shift active. Your work is limited to this Merchant.');
    }catch(e){state.csrf='';show('workPanel',false);show('pairPanel',true);
      if(e.code==='OPERATOR_OWNER_SESSION'){show('ownerWarning',true);message(e.message)}
      else if(e.status!==401)message(e.message);
    }
  }
  async function loadCatalog(){
    const data=await api('/api/orders/operator/catalog');
    const list=(data.products||[]).slice(0,100);
    byId('catalog').innerHTML=list.length?list.map(p=>`<div class="item"><strong>${h(p.name)}</strong><span>${amount(p.selling_price)}${p.available===false?' · Unavailable':''}</span></div>`).join(''):
      '<p>No active products. Ask the Merchant owner to configure Catalog.</p>';
  }
  async function loadOrders(){
    const data=await api('/api/orders/operator/orders');
    const list=(data.orders||[]).slice(0,30);
    byId('orders').innerHTML=list.length?list.map(o=>`<div class="item"><strong>${h(o.order_number)}</strong><span>${h(o.order_status)} · ${amount(o.total)}</span></div>`).join(''):'<p>No recent orders.</p>';
  }
  function stopMic(){const rec=state.recognition;state.recognition=null;if(rec){rec.onresult=null;rec.onerror=null;rec.onend=null;try{rec.abort()}catch{}}}
  byId('pairLookup').onsubmit=async e=>{
    e.preventDefault();if(state.busy)return;state.busy=true;const code=byId('pairCode').value.trim();
    try{const found=await api('/api/orders/operator/pair/operators',{method:'POST',data:{pair_code:code}});
      const names=found.operators||[];
      if(!names.length)throw Error('No active order operators for this Merchant.');
      state.pair=code;byId('operatorChoice').innerHTML=names.map(o=>`<option value="${h(o.id)}">${h(o.name)} · ${h(o.role)}</option>`).join('');
      show('shiftLogin',true);message('Choose your name and enter only your individual PIN.');
    }catch(err){show('shiftLogin',false);message(err.message)}finally{state.busy=false}
  };
  byId('shiftLogin').onsubmit=async e=>{
    e.preventDefault();if(state.busy)return;state.busy=true;
    try{const r=await api('/api/orders/operator/pair/start',{method:'POST',data:{
      pair_code:state.pair,operator_id:byId('operatorChoice').value,pin:byId('operatorPin').value}});
      byId('operatorPin').value='';state.pair='';byId('pairCode').value='';show('shiftLogin',false);
      await loadOperatorSession();message(`Shift started for ${r.operator.name}.`);
    }catch(err){byId('operatorPin').value='';message(err.message)}finally{state.busy=false}
  };
  byId('endShift').onclick=async()=>{
    if(state.busy)return;state.busy=true;stopMic();resetDraft();
    try{await api('/api/orders/operator/logout',{method:'POST',data:{},authorized:true});
      state.csrf='';show('workPanel',false);show('pairPanel',true);message('Shift ended.');}
    catch(err){message(err.message)}finally{state.busy=false}
  };
  byId('refreshOrders').onclick=async()=>{try{await loadOrders();message('Orders refreshed.')}catch(err){message(err.message)}};
  byId('microphone').onclick=()=>{
    if(!byId('aiConsent').checked){message('Review and accept speech processing consent first.');return}
    const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!Recognition){message('Speech recognition is unavailable. Type the instruction instead.');return}
    stopMic();const epoch=state.epoch;const rec=new Recognition();rec.lang='en-PH';rec.interimResults=false;rec.maxAlternatives=1;
    rec.onresult=event=>{if(epoch!==state.epoch)return;const words=event.results?.[0]?.[0]?.transcript||'';
      byId('transcript').value=String(words).slice(0,1200);message('Check recognized words before preparing the draft.')};
    rec.onerror=()=>message('Microphone could not be used. You may type the instruction.');
    rec.onend=()=>{if(state.recognition===rec)state.recognition=null};
    state.recognition=rec;try{rec.start();message('Listening. Please speak close to your microphone.')}catch{message('Microphone unavailable.')}
  };
  byId('discard').onclick=()=>{stopMic();resetDraft();message('Your draft was discarded. No order was created.')};
  byId('prepare').onclick=async()=>{
    if(state.busy)return;if(!byId('aiConsent').checked){message('Consent is required for AI processing.');return}
    const transcript=byId('transcript').value.trim();if(!transcript){message('Enter the order instruction.');return}
    const epoch=++state.epoch;state.busy=true;
    try{const data=await api('/api/orders/operator/voice/turn',{method:'POST',authorized:true,
      data:{transcript,consent:true,previous_draft:state.draft}});
      if(epoch!==state.epoch)return;state.draft=data.draft;state.voiceSession=data.draft?.session_id||null;
      const lines=state.draft?.lines||[];
      byId('draft').innerHTML=lines.length?lines.map(p=>`<div class="item"><strong>${h(p.name)} × ${Number(p.quantity)||0}</strong><span>${amount((Number(p.line_total_centavos)||0)/100)}</span></div>`).join(''):
        '<p>The assistant needs clarification. Try a more specific product name.</p>';
      byId('quote').disabled=!lines.length;
      message(data.question||data.message||'Review the draft and current Catalog price. No order created.');
    }catch(err){if(epoch===state.epoch)message(err.message)}finally{state.busy=false}
  };
  byId('quote').onclick=async()=>{
    if(!state.draft||state.busy)return;state.busy=true;
    try{const result=await api('/api/orders/operator/voice/quote',{method:'POST',authorized:true,
      data:{draft:state.draft,consent:true}});
      message(`Current quoted total: ${amount((result.quote?.total_centavos||0)/100)}. Unpaid; no stock reserved or order posted.`);
    }catch(err){message(err.message)}finally{state.busy=false}
  };
  // The pairing code is carried only in the URL fragment, never in URL request logs.
  try{const hash=new URLSearchParams(location.hash.slice(1));const code=hash.get('pair');
    if(code)byId('pairCode').value=code;history.replaceState(null,'',location.pathname)}catch{}
  void loadOperatorSession();
})();