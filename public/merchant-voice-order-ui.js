/**
 * Merchant #863: opt-in, push-to-talk conversational DRAFT companion for Orders.
 * No order/payment/stock write path. Never stores transcripts or recorded audio.
 * SpeechRecognition may use the device/browser speech service: explicit consent
 * is required, and speech is not an operator authentication mechanism.
 */
(() => {
  'use strict';
  const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  const state={businessId:null,capability:null,draft:null,processing:false,consent:false,
    transcript:'',message:'',clarification:false,question:'',quote:null,open:false,epoch:0,recognition:null,
    request:null,language:'en-PH',autoSpeech:false};
  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const pesos=centavos=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(centavos||0)/100);
  const enabled=()=>state.capability?.enabled===true;
  const merchantVisible=()=>{
    const target=document.getElementById('ordersWorkspace');
    return Boolean(target&&!target.classList.contains('hidden')&&target.querySelector('#counterOrderForm'));
  };
  const accountContext=()=>window.BusinessLifeAccounting?.getState?.()||{};
  async function selectedBusinessId(){
    const context=accountContext();
    const cached=Number(context?.role==='merchant'?context.activeBusinessId:null);
    if(Number.isInteger(cached)&&cached>0)return cached;
    const response=await fetch('/api/accounting/workspaces',{credentials:'same-origin',cache:'no-store'});
    if(!response.ok)throw new Error('Select a Merchant business to use voice ordering.');
    const info=await response.json();return Number(info?.active_business_id)||0;
  }
  function stopRecognition(){
    const recognition=state.recognition;state.recognition=null;
    if(recognition){recognition.onresult=null;recognition.onerror=null;recognition.onend=null;
      try{recognition.abort()}catch{}}
  }
  function stopSpeech(){try{window.speechSynthesis?.cancel()}catch{}}
  function reset(message=''){
    state.epoch++;state.request?.abort();state.request=null;
    stopRecognition();stopSpeech();state.processing=false;state.draft=null;state.quote=null;
    state.consent=false;state.transcript='';state.message=message;state.open=false;
    state.clarification=false;state.question='';state.capability=null;state.businessId=null;
    render();
  }
  function canContinue(epoch,businessId){
    const workspace=accountContext();
    const current=Number(workspace?.role==='merchant'?workspace.activeBusinessId:0);
    if(workspace?.role&&workspace.role!=='merchant')return false;
    return epoch===state.epoch&&state.businessId===businessId&&merchantVisible()&&
      (!current||current===businessId)&&window.ABLSession?.authenticated?.()!==false;
  }
  async function api(path,options={}){
    const result=await fetch(path,{credentials:'same-origin',cache:'no-store',...options,
      headers:{'Content-Type':'application/json',...(options.headers||{})}});
    const data=await result.json().catch(()=>({}));
    if(!result.ok)throw new Error(data.error||`Assistant request failed (${result.status}).`);
    return data;
  }
  function render(){
    const panel=document.getElementById('merchantVoiceOrderPanel');if(!panel)return;
    if(!enabled()){panel.remove();return}
    panel.innerHTML=`<details class="merchantVoiceDetails" ${state.open||state.draft||state.processing||state.message?'open':''}>
      <summary><span class="merchantVoiceSymbol" aria-hidden="true">🎙️</span><span class="merchantVoiceIntro"><strong>AI voice order assistant</strong><small>Speak naturally, review the draft — no order or payment is created</small></span><span class="merchantVoiceChip">DRAFT ONLY</span></summary>
      <div class="merchantVoiceBody">
        <p class="merchantVoiceNotice">Only the signed-in operator should activate the microphone. Background voices cannot be reliably identified. Browser speech services and our AI provider may process speech/text after you consent. Not a payment or identity verification.</p>
        <label class="merchantVoiceConsent"><input id="merchantVoiceConsent" type="checkbox" ${state.consent?'checked':''}><span>I agree to process this instruction for an order draft.</span></label>
        <label class="merchantVoiceLocale">Spoken language <select id="merchantVoiceLanguage"><option value="en-PH" ${state.language==='en-PH'?'selected':''}>English (Philippines)</option><option value="fil-PH" ${state.language==='fil-PH'?'selected':''}>Filipino / Tagalog</option></select></label>
        <div class="merchantVoiceActions"><button id="merchantVoiceSpeak" type="button" ${!SpeechRecognition||state.processing?'disabled':''}>${SpeechRecognition?'🎙️ Start speaking':'Microphone unavailable'}</button><button id="merchantVoiceStop" type="button" ${!state.recognition?'disabled':''}>Stop</button><button id="merchantVoiceReadback" type="button" ${!state.draft?.lines?.length?'disabled':''}>🔊 Read back</button></div>
        <label class="merchantVoiceTextLabel" for="merchantVoiceText">Spoken or typed instruction</label>
        <textarea id="merchantVoiceText" rows="3" maxlength="1200" placeholder="Order for Ana: three chicken adobo, one rice, two juices">${escapeHtml(state.transcript)}</textarea>
        <div class="merchantVoiceActions"><button id="merchantVoiceSend" type="button" class="merchantVoicePrimary" ${state.processing?'disabled':''}>${state.processing?'Checking Catalog…':'Prepare draft'}</button><button id="merchantVoiceQuote" type="button" ${state.processing||!state.draft?.lines?.length?'disabled':''}>Check current total</button><button id="merchantVoiceClear" type="button">Discard draft</button></div>
        <div id="merchantVoiceFeedback" role="status" aria-live="polite" class="merchantVoiceFeedback">${escapeHtml(state.question||state.message||'Speak one instruction, then correct the draft in another turn.')}</div>
        ${state.draft?`<div class="merchantVoiceDraft"><strong>Customer: ${escapeHtml(state.draft.customer_name||'Walk-in customer')}</strong><ul>${state.draft.lines.map(line=>`<li><span>${escapeHtml(line.quantity)} × ${escapeHtml(line.name)}${line.variant_name?` — ${escapeHtml(line.variant_name)}`:''}${line.modifier_names?.length?` (${escapeHtml(line.modifier_names.join(', '))})`:''}</span><b>${pesos(line.line_total_centavos)}</b></li>`).join('')}</ul><div class="merchantVoiceTotal"><strong>Estimated items subtotal</strong><b>${pesos(state.draft.subtotal_centavos)}</b></div><small>Delivery, final availability, taxes and payment are not confirmed. No receivable, charge or stock movement has been recorded.</small></div>`:''}
        ${state.quote?`<div class="merchantVoiceQuote" role="status"><strong>Server-checked subtotal ${pesos(state.quote.quote.total_centavos)}</strong><small>Quote expires ${escapeHtml(new Date(state.quote.quote.expires_at).toLocaleTimeString('en-PH'))}. Products and stock are checked again when an order is created. No stock is reserved and no payment has been taken.</small></div>`:''}
        <div class="merchantVoiceLocked" role="note">Secure order confirmation is not enabled in this version. Use the regular counter-order form to create an order after checking the items.</div>
      </div></details>`;
    bind(panel);
  }
  function readBack(text=state.draft?.readback){
    stopSpeech();if(!text||!window.speechSynthesis||typeof window.SpeechSynthesisUtterance!=='function'){
      state.message='Voice playback is unavailable. The draft is readable on screen.';render();return;
    }
    const utterance=new window.SpeechSynthesisUtterance(String(text).slice(0,1300));
    utterance.lang=state.language;utterance.rate=0.94;utterance.volume=0.85;
    window.speechSynthesis.speak(utterance);
  }
  async function sendTurn(text){
    const instruction=String(text||'').trim();
    if(!state.consent){state.message='Please agree to this instruction being processed first.';render();return}
    if(!instruction||instruction.length>1200){state.message='Enter an instruction of up to 1,200 characters.';render();return}
    if(state.processing||!enabled()||!state.businessId)return;
    stopRecognition();state.processing=true;state.message='';state.question='';
    const epoch=state.epoch,bid=state.businessId;
    const controller=new AbortController();state.request=controller;render();
    try{
      const result=await api('/api/orders/voice/turn',{method:'POST',signal:controller.signal,
        body:JSON.stringify({business_id:bid,consent:true,transcript:instruction,previous_draft:state.draft})});
      if(!canContinue(epoch,bid))return;
      state.draft=result.draft;state.quote=null;state.clarification=Boolean(result.needs_clarification);
      state.question=result.needs_clarification?result.question:'';
      state.message=result.needs_clarification?'':(result.draft?.lines?.length?'Draft updated. Review it before creating an order.':'No order items recognized. Try a clearer instruction.');
      state.transcript='';
    }catch(error){
      if(!canContinue(epoch,bid)||error?.name==='AbortError')return;
      state.message=String(error.message||'Voice assistant unavailable.').slice(0,220);
    }finally{
      if(canContinue(epoch,bid)){state.processing=false;state.request=null;render()}
    }
  }
  async function checkCurrentQuote(){
    if(!state.consent){state.message='Consent is required for a current order quote.';render();return}
    if(!state.draft?.lines?.length||state.processing||!enabled()||!state.businessId)return;
    const epoch=state.epoch,bid=state.businessId;
    const controller=new AbortController();state.request=controller;state.processing=true;state.message='Checking current Catalog pricing…';render();
    try{
      const result=await api('/api/orders/voice/quote',{method:'POST',signal:controller.signal,
        body:JSON.stringify({business_id:bid,consent:true,draft:state.draft})});
      if(!canContinue(epoch,bid))return;
      state.quote=result;state.message='Current Catalog quote checked. It is not a confirmed order.';
    }catch(error){if(canContinue(epoch,bid)&&error?.name!=='AbortError'){state.quote=null;state.message=String(error.message||'Unable to check the total.').slice(0,220)}}
    finally{if(canContinue(epoch,bid)){state.processing=false;state.request=null;render()}}
  }
  function startRecognition(){
    if(!state.consent){state.message='Consent is required before activating the microphone.';render();return}
    if(!SpeechRecognition||state.processing||state.recognition)return;
    const epoch=state.epoch,bid=state.businessId;
    const recognition=new SpeechRecognition();recognition.lang=state.language;
    recognition.continuous=false;recognition.interimResults=false;recognition.maxAlternatives=1;
    state.recognition=recognition;state.message='Listening for the operator. Speak now…';render();
    recognition.onresult=event=>{
      if(!canContinue(epoch,bid)||state.recognition!==recognition)return;
      const result=event.results?.[0];if(!result?.isFinal)return;
      const alt=result[0],transcript=String(alt?.transcript||'').trim().slice(0,1200);
      state.recognition=null;
      if(!transcript)return;
      state.transcript=transcript;
      if(Number.isFinite(alt?.confidence)&&alt.confidence>0&&alt.confidence<0.6){
        state.message='Low recognition confidence. Check the text, then tap Prepare draft.';render();return;
      }
      // A speaker cannot be reliably authenticated from speech. Require a
      // separate operator action after inspecting the transcribed words.
      state.message='Check the recognized words, then tap Prepare draft.';render();
    };
    recognition.onerror=()=>{
      if(state.recognition!==recognition)return;
      state.recognition=null;state.message='Microphone or speech recognition unavailable. Type the instruction instead.';render();
    };
    recognition.onend=()=>{
      if(state.recognition!==recognition)return;
      state.recognition=null;state.message='Listening ended. Try again or type the instruction.';render();
    };
    try{recognition.start()}catch{state.recognition=null;state.message='Microphone unavailable. Type the instruction instead.';render()}
  }
  function bind(panel){
    panel.querySelector('.merchantVoiceDetails')?.addEventListener('toggle',event=>{state.open=Boolean(event.target.open)});
    panel.querySelector('#merchantVoiceConsent')?.addEventListener('change',event=>{
      state.consent=Boolean(event.target.checked);if(!state.consent){stopRecognition();stopSpeech()}render();
    });
    panel.querySelector('#merchantVoiceLanguage')?.addEventListener('change',event=>{state.language=event.target.value==='fil-PH'?'fil-PH':'en-PH';render()});
    panel.querySelector('#merchantVoiceSpeak')?.addEventListener('click',startRecognition);
    panel.querySelector('#merchantVoiceStop')?.addEventListener('click',()=>{stopRecognition();state.message='Stopped listening.';render()});
    panel.querySelector('#merchantVoiceReadback')?.addEventListener('click',()=>readBack());
    panel.querySelector('#merchantVoiceText')?.addEventListener('input',event=>{state.transcript=event.target.value});
    panel.querySelector('#merchantVoiceSend')?.addEventListener('click',()=>void sendTurn(state.transcript));
    panel.querySelector('#merchantVoiceQuote')?.addEventListener('click',()=>void checkCurrentQuote());
    panel.querySelector('#merchantVoiceClear')?.addEventListener('click',()=>{stopRecognition();stopSpeech();state.epoch++;state.request?.abort();state.request=null;state.draft=null;state.quote=null;state.transcript='';state.processing=false;state.question='';state.message='Draft discarded. Nothing was posted.';render()});
  }
  async function attach(){
    if(!merchantVisible()){if(state.businessId!==null)reset();return}
    const workspace=document.getElementById('ordersWorkspace');
    const form=workspace?.querySelector('#counterOrderForm');if(!form)return;
    const businessId=await selectedBusinessId().catch(()=>0);
    if(!Number.isSafeInteger(businessId)||businessId<1)return;
    if(state.businessId!==null&&state.businessId!==businessId)reset('Merchant changed. Previous voice draft discarded.');
    if(state.businessId!==businessId){
      state.businessId=businessId;const epoch=++state.epoch;
      try{
        const capability=await api(`/api/orders/voice/capabilities?business_id=${businessId}`);
        if(!canContinue(epoch,businessId))return;
        state.capability=capability;
      }catch{if(canContinue(epoch,businessId))state.capability={enabled:false}}
    }
    if(!enabled()||!merchantVisible())return;
    if(workspace.querySelector('#merchantVoiceOrderPanel'))return;
    const panel=document.createElement('section');panel.id='merchantVoiceOrderPanel';panel.className='merchantVoiceOrderPanel';
    form.closest('.orderCreateCard')?.insertAdjacentElement('beforebegin',panel);
    render();
  }
  let scheduled=false;
  function schedule(){
    if(scheduled)return;scheduled=true;
    queueMicrotask(()=>{scheduled=false;void attach()});
  }
  function observe(){
    const workspace=document.getElementById('ordersWorkspace');
    if(workspace){new MutationObserver(schedule).observe(workspace,{childList:true,attributes:true,attributeFilter:['class']});schedule();return}
    const shell=document.getElementById('shell');if(!shell)return;
    const observer=new MutationObserver(()=>{
      if(document.getElementById('ordersWorkspace')){observer.disconnect();observe()}
    });observer.observe(shell,{childList:true});
  }
  document.addEventListener('abl:business-workspace-changed',()=>reset('Business changed. Draft discarded.'),{passive:true});
  document.addEventListener('abl:profile-state',()=>{if(!merchantVisible())reset()},{passive:true});
  document.addEventListener('abl:auth-expired',()=>reset(),{passive:true});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stopRecognition();stopSpeech()}},{passive:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',observe,{once:true});else observe();
})();