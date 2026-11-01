// Receipt Intelligence is a review-only companion to the existing Merchant Receipt Vault.
// It must never call an Inventory/Accounting mutation route.
(()=>{
  const BASE='/api/procurement',ROOT=BASE+'/receipt-intelligence';
  let overlay=null,businessId=null,selected=null,draft=null,inventory=[],key=null,providerReady=false;
  const $=(s,root=overlay||document)=>root?.querySelector(s);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','"':'&#39;'}[c]));
  const peso=v=>v==null?'Unknown':'₱'+new Intl.NumberFormat('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v)||0);
  const ref=()=>('receipt-review-'+Date.now()+'-'+Math.random().toString(36).slice(2,15));
  async function api(path,options={}){
    const r=await fetch(path,{credentials:'same-origin',...options});
    const body=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(body.error||'Receipt request failed');
    return body;
  }
  function message(value,bad=false){const node=$('#riMessage');if(node){node.textContent=value||'';node.classList.toggle('error',bad)}}
  function injectCss(){
    if(document.getElementById('riStyles'))return;
    const sheet=document.createElement('style');sheet.id='riStyles';
    sheet.textContent='.riEntry{display:block;margin:10px 0 15px;min-height:44px;padding:11px 15px;background:#e5f6f2;color:#085c51;border:1px solid #198a78;border-radius:12px;font:700 14px system-ui;cursor:pointer}'+
      '.riOverlay{position:fixed;inset:0;background:rgba(12,26,38,.76);z-index:9650;display:flex;justify-content:center;align-items:center}'+
      '.riPanel{width:min(830px,100%);height:min(94dvh,950px);overflow:auto;background:white;color:#18313d;border-radius:18px;font-family:system-ui}'+
      '.riHead{padding:14px;position:sticky;top:0;background:#fff;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e0e8ed;z-index:1}'+
      '.riHead h2{margin:0;font-size:20px}.riHead small{color:#596d78}.riClose{font-size:23px;width:44px;height:44px;border:1px solid #bdc9d0;background:white;border-radius:11px}'+
      '.riBody{padding:15px;display:grid;gap:15px}.riCard{border:1px solid #e0e7eb;border-radius:12px;padding:13px}.riCard h3{margin:0 0 9px;font-size:16px}'+
      '.riNote{padding:11px;background:#f3f7fa;border-radius:10px;font-size:13px;line-height:1.5}.riRow{display:grid;gap:10px;border-top:1px solid #dde7ed;padding:12px 0}'+
      '.riForm{display:grid;gap:11px}.riGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}'+
      '.riForm label{display:grid;gap:5px;font-size:13px;font-weight:600}.riForm input,.riForm select{width:100%;box-sizing:border-box;border:1px solid #a8bac5;border-radius:9px;padding:9px;min-height:42px;color:#182a32;background:#fff}'+
      '.riBtn{min-height:43px;padding:10px 14px;border-radius:10px;background:#096a60;color:#fff;border:0;font-weight:700;font-size:14px;cursor:pointer}.riBtn:disabled{opacity:.5}'+
      '.riBtn.secondary{background:#eaf6f3;color:#075c51;border:1px solid #94beb5}.riFlags{font-size:12px;color:#a15c1a}'+
      '#riMessage{min-height:20px;color:#087d68;font-size:14px}#riMessage.error{color:#b12626}'+
      '@media(max-width:600px){.riPanel{height:100dvh;border-radius:0}.riGrid{grid-template-columns:1fr 1fr}}';
    document.head.appendChild(sheet);
  }
  function close(){overlay?.remove();overlay=null;businessId=null;selected=null;draft=null;inventory=[];key=null}
  function mount(){
    const h=$('#viewStock h1',document),existing=$('#receiptIntelligenceButton',document);
    if(document.body?.dataset?.businessFinanceRole!=='merchant'||!h){existing?.remove();if(overlay)close();return}
    if(existing)return;
    const button=document.createElement('button');button.id='receiptIntelligenceButton';button.className='riEntry';button.type='button';
    button.textContent='Read receipt → Prepare stock';button.onclick=()=>open().catch(e=>window.alert(e.message));
    h.insertAdjacentElement('afterend',button);
  }
  function shell(){
    injectCss();overlay=document.createElement('section');overlay.className='riOverlay';
    overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-labelledby','riTitle');
    overlay.innerHTML='<div class="riPanel"><header class="riHead"><div><h2 id="riTitle">Receipt → Inventory</h2><small>Scan evidence, review product lines</small></div><button class="riClose" type="button" aria-label="Close">×</button></header>'+
      '<main class="riBody"><div class="riNote">A photo is not proof that goods were physically received. AI suggestions and saved reviews never change stock, payments or tax status.</div><div id="riMessage" role="status"></div><div id="riContent">Loading saved receipts…</div></main></div>';
    $('.riClose').onclick=close;document.body.appendChild(overlay);
  }
  async function open(){
    if(overlay)return;
    const context=await api('/api/accounting/workspaces');
    if(context.role!=='merchant'||!Number(context.active_business_id))throw new Error('Choose a Merchant business first');
    businessId=Number(context.active_business_id);shell();const instance=overlay;
    try{
      const [receipts,stocks,config]=await Promise.all([
        api(BASE+'/purchase-documents?business_id='+businessId),
        api(ROOT+'/inventory?business_id='+businessId),
        api(ROOT+'/config?business_id='+businessId)
      ]);
      if(instance!==overlay)return;
      inventory=stocks.inventory||[];providerReady=Boolean(config.provider_available);
      showReceipts(receipts.documents||[]);
    }catch(e){message(e.message,true);$('#riContent').textContent='Save an original receipt in Purchase receipts before using this assistant.'}
  }
  function showReceipts(rows){
    $('#riContent').innerHTML='<section class="riCard"><h3>Select an archived purchase receipt</h3><p>Use the existing Receipt Vault to photograph or upload the original. Select it here to read or transcribe the product lines.</p>'+
      (rows.length?rows.map(r=>'<div class="riRow"><strong>'+esc(r.issuer_name||'Purchase receipt')+'</strong><small>'+esc(String(r.issue_date||'').slice(0,10))+' · '+esc(peso(r.gross_amount))+'</small><button class="riBtn secondary" data-ri-document="'+Number(r.id)+'" type="button">Review products</button></div>').join(''):
        '<p>No saved receipts yet. Select “Purchase receipts · Save / View” in Stock first.</p>')+'</section>';
    overlay.querySelectorAll('[data-ri-document]').forEach(b=>b.onclick=()=>choose(Number(b.dataset.riDocument)));
  }
  function url(path){return BASE+'/purchase-documents/'+Number(selected)+'/intelligence'+path}
  async function choose(id){
    selected=id;draft=null;key=null;const instance=overlay,bid=businessId;
    const duplicates=await api(url('/duplicates?business_id='+bid)).catch(()=>null);
    if(instance!==overlay||bid!==businessId)return;
    if(duplicates?.possible_duplicates?.length)message('Possible duplicate receipt found in this business. Verify original document before receiving any goods.',true);
    try{
      const data=await api(url('?business_id='+bid));
      if(instance!==overlay||bid!==businessId)return;
      draft=data.draft;showReview();
    }catch(e){if(instance===overlay)showStart()}
  }
  function showStart(){
    $('#riContent').innerHTML='<section class="riCard"><h3>Receipt #'+Number(selected)+'</h3>'+
      '<p><a href="'+BASE+'/purchase-documents/'+Number(selected)+'/file?business_id='+encodeURIComponent(businessId)+'" target="_blank" rel="noopener noreferrer">Open private original document</a></p>'+
      (providerReady?'<label><input id="riConsent" type="checkbox"> I consent to sending this receipt photo to the configured AI processing service.</label><p><button id="riAnalyze" class="riBtn" type="button">Analyze saved photo</button></p>':
        '<p>AI extraction is not enabled yet. Manual entry still works.</p>')+
      '</section><section class="riCard"><h3>Manual transcription</h3><form class="riForm" id="riManual">'+
      '<div class="riGrid"><label>Supplier<input name="vendor"></label><label>Date<input name="issued" type="date"></label><label>Receipt total PHP<input name="total" inputmode="decimal"></label></div>'+
      '<div id="riLines"></div><button id="riAdd" type="button" class="riBtn secondary">+ Product line</button><button class="riBtn" type="submit">Save draft for review</button></form></section>';
    $('#riAnalyze')?.addEventListener('click',analyze);
    $('#riAdd').onclick=addLine;$('#riManual').onsubmit=manual;addLine();
  }
  function addLine(){
    const lines=$('#riLines');if(lines.children.length>=80){message('Maximum 80 lines',true);return}
    const node=document.createElement('div');node.className='riRow riManualLine';node.innerHTML=
      '<div class="riGrid"><label>Printed name<input data-name required></label><label>Quantity<input data-qty type="number" step="any"></label><label>Unit<input data-unit placeholder="kg / L / pack"></label></div>'+
      '<div class="riGrid"><label>Line total PHP<input data-cost inputmode="decimal"></label><label>Units per pack<input data-pack type="number" step="any"></label><label>Pack base unit<input data-packunit placeholder="g / ml / unit"></label></div>';
    lines.append(node);
  }
  async function manual(event){
    event.preventDefault();const form=event.currentTarget,instance=overlay,bid=businessId;
    const extraction={
      vendor_name:form.elements.namedItem('vendor')?.value||'',
      issue_date:form.elements.namedItem('issued')?.value||'',
      currency_code:'PHP',document_total:form.elements.namedItem('total')?.value||null,
      lines:[...form.querySelectorAll('.riManualLine')].map(n=>({
        raw_text:$('[data-name]',n).value,description:$('[data-name]',n).value,
        quantity:$('[data-qty]',n).value||null,unit:$('[data-unit]',n).value,
        pack_quantity:$('[data-pack]',n).value||null,pack_unit:$('[data-packunit]',n).value,
        line_total:$('[data-cost]',n).value||null,confidence:null
      }))
    };
    try{
      const x=await api(url('/manual'),{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({business_id:bid,extraction})});
      if(instance!==overlay||bid!==businessId)return;
      draft=x.draft;showReview();message('Editable draft saved. Confirm what was physically received.');
    }catch(e){if(instance===overlay)message(e.message,true)}
  }
  async function analyze(){
    if(!$('#riConsent')?.checked){message('Explicit image processing consent required',true);return}
    const instance=overlay,bid=businessId,btn=$('#riAnalyze');btn.disabled=true;message('Reading receipt photo…');
    try{
      const x=await api(url('/analyze'),{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({business_id:bid,allow_external_processing:true})});
      if(instance!==overlay||bid!==businessId)return;
      if(x.draft.status==='processing'){message('Already being analyzed. Reopen the receipt to check.');return}
      draft=x.draft;showReview();message('AI draft created. Stock has not changed.');
    }catch(e){if(instance===overlay)message(e.message,true)}finally{btn.disabled=false}
  }
  function optionList(value){
    return '<option value="">Choose Inventory product</option>'+
      inventory.map(x=>'<option value="'+Number(x.id)+'"'+(Number(value)===Number(x.id)?' selected':'')+'>'+esc(x.item)+' · '+esc(x.unit)+'</option>').join('');
  }
  function showReview(){
    const extraction=draft?.extraction;
    if(!extraction?.lines){message('Draft is being processed. Reopen later.');return}
    const recon=extraction.reconciliation||{};
    $('#riContent').innerHTML='<section class="riCard"><h3>Confirm product identity and received quantities</h3>'+
      '<p><a href="'+BASE+'/purchase-documents/'+Number(selected)+'/file?business_id='+encodeURIComponent(businessId)+'" target="_blank" rel="noopener noreferrer">Open scanned original for comparison</a></p>'+
      '<div class="riNote">Printed total: '+esc(peso(extraction.document_total))+' · Calculated: '+esc(peso(recon.predicted_total))+' · '+esc(recon.status||'unverified')+'</div>'+
      '<form id="riReview" class="riForm">'+extraction.lines.map((line,i)=>{
        const candidate=extraction.matches?.[i]?.suggested_inventory_id;
        return '<div class="riRow" data-review-line="'+i+'"><strong>'+esc(line.description||'Unknown product')+'</strong>'+
          '<small>Printed: '+esc(line.raw_text)+' · Qty: '+esc(line.quantity??'?')+' '+esc(line.unit||'?')+' · '+esc(peso(line.line_total))+'</small>'+
          '<span class="riFlags">'+esc((line.flags||[]).join(' · '))+'</span>'+
          '<div class="riGrid"><label>Action<select data-action><option value="follow_up">Needs review</option><option value="receive">Physically received</option><option value="non_stock_expense">Non-stock expense</option><option value="exclude">Exclude</option></select></label>'+
          '<label>Inventory product<select data-product>'+optionList(candidate)+'</select></label><label>Received quantity<input data-physical type="number" step="any" min="0" value="'+esc(line.quantity??'')+'"></label></div>'+
          '<div class="riGrid"><label>Verified unit<select data-verified-unit>'+
          ['','unit','kg','g','L','ml'].map(u=>'<option value="'+u+'"'+(line.unit?.toLowerCase()===u.toLowerCase()?' selected':'')+'>'+esc(u||'Choose unit')+'</option>').join('')+
          '</select></label><label>Confirmed line cost PHP<input data-confirmed-cost inputmode="decimal" value="'+esc(line.line_total??'')+'"></label><label>Note<input data-note></label></div></div>';
      }).join('')+'<div class="riNote">Saving this review does NOT add Inventory, create an expense, or register payment. Separate physical receiving remains required.</div>'+
      '<button class="riBtn" type="submit">Save reviewed plan (stock unchanged)</button></form></section>'+
      '<section id="riPreflight" class="riCard" hidden></section>';
    $('#riReview').onsubmit=review;
    if(draft.status==='reviewed')loadReceivingReadiness().catch(()=>{});
  }

  async function loadReceivingReadiness(){
    const panel=overlay,bid=businessId,receiptId=selected;
    if(!panel||!bid||!receiptId)return;
    const box=$('#riPreflight');
    if(!box)return;
    box.hidden=false;
    box.innerHTML='<h3>Preparing physical receiving</h3><p>Checking saved review and duplicate receipts…</p>';
    try{
      const response=await api(BASE+'/purchase-documents/'+Number(receiptId)+
        '/intelligence/receiving-readiness?business_id='+encodeURIComponent(bid));
      if(panel!==overlay||bid!==businessId||receiptId!==selected)return;
      const p=response.preflight||{},issues=Array.isArray(p.issues)?p.issues:[],warnings=Array.isArray(p.warnings)?p.warnings:[];
      const formatFlags=arr=>arr.length?'<ul>'+arr.map(code=>'<li>'+esc(String(code).replaceAll('_',' ').toLowerCase())+'</li>').join('')+'</ul>':'<p>None identified.</p>';
      const groups=(p.grouped_inventory_candidates||[]).map(group=>
        '<li>'+esc(group.product_name||'Inventory product')+' · '+esc(group.base_quantity)+' '+
        esc(group.base_unit||'')+' · Confirmed line value '+esc(peso(group.confirmed_line_cost))+'</li>'
      ).join('');
      box.innerHTML='<h3>Physical receiving preflight</h3>'+
        '<p class="riNote">State: '+esc(String(p.status||'unknown').replaceAll('_',' '))+
        ' · Original total: '+esc(peso(p.receipt_total))+
        ' · Confirmed stock lines: '+esc(peso(p.received_line_cost))+'</p>'+
        '<p><strong>Products prepared for future receiving</strong></p><ul>'+(groups||'<li>No reviewed stock lines</li>')+'</ul>'+
        '<p><strong>Items to resolve</strong></p>'+formatFlags(issues)+
        (warnings.length?'<p><strong>Cost/quantity notes</strong></p>'+formatFlags(warnings):'')+
        '<p class="riNote">Stock posting is disabled. No Inventory quantity, transaction or payment has been changed. A separate authorized, atomic receiving operation is still required.</p>'+
        '<button id="riPreflightRefresh" class="riBtn secondary" type="button">Refresh preflight</button>';
      $('#riPreflightRefresh').onclick=loadReceivingReadiness;
    }catch(error){
      if(panel!==overlay||bid!==businessId||receiptId!==selected)return;
      box.innerHTML='<h3>Receiving preflight unavailable</h3><p>'+esc(error.message||'Please refresh the reviewed receipt.')+'</p>'+
        '<button id="riPreflightRetry" class="riBtn secondary" type="button">Retry preflight</button>';
      $('#riPreflightRetry').onclick=loadReceivingReadiness;
    }
  }

  async function review(e){
    e.preventDefault();const instance=overlay,bid=businessId,submit=$('#riReview button[type=submit]');
    const decisions=[...overlay.querySelectorAll('[data-review-line]')].map(n=>({
      line_index:Number(n.dataset.reviewLine),action:$('[data-action]',n).value,
      inventory_id:Number($('[data-product]',n).value)||null,
      received_quantity:$('[data-physical]',n).value,received_unit:$('[data-verified-unit]',n).value,
      confirmed_total_cost:$('[data-confirmed-cost]',n).value,reason:$('[data-note]',n).value
    }));
    if(!key)key=ref();submit.disabled=true;
    try{
      const saved=await api(url('/review'),{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({business_id:bid,draft_id:draft.id,expected_version:draft.version,client_request_key:key,decisions})});
      if(instance===overlay&&bid===businessId){
        draft={...draft,status:'reviewed',review:saved.review,version:Number(draft.version)+1};
        message('Review securely saved. Stock unchanged. Checking receiving readiness…');
        await loadReceivingReadiness();
      }
    }catch(e){if(instance===overlay){message(e.message,true);submit.disabled=false}}
  }

  // Read-only purchase evidence belongs to the existing blind-count Review phase.
  // This companion deliberately does not edit the Inventory counting module.
  let countEvidenceOverlay=null,evidenceReadGeneration=0;
  function closeCountEvidence(){
    evidenceReadGeneration+=1;
    countEvidenceOverlay?.remove();
    countEvidenceOverlay=null;
  }
  function mountCountEvidence(){
    const pane=document.getElementById('countSessionReviewPane');
    const previous=document.getElementById('receiptCountEvidenceButton');
    if(document.body?.dataset?.businessFinanceRole!=='merchant'||!pane){
      previous?.remove();
      closeCountEvidence();
      return;
    }
    if(previous)return;
    injectCss();
    const button=document.createElement('button');
    button.id='receiptCountEvidenceButton';
    button.type='button';
    button.className='riBtn secondary';
    button.textContent='Check scanned receipts for stock differences';
    button.setAttribute('aria-label','Open read-only purchase receipts for the completed inventory count');
    button.addEventListener('click',()=>openCountEvidence());
    const summary=document.getElementById('countSessionReviewSummary');
    if(summary?.parentElement===pane)summary.insertAdjacentElement('afterend',button);
    else pane.prepend(button);
    new MutationObserver(()=>{
      if(pane.classList.contains('hidden')||document.body?.dataset?.businessFinanceRole!=='merchant')closeCountEvidence();
    }).observe(pane,{attributes:true,attributeFilter:['class']});
  }
  async function openCountEvidence(){
    const pane=document.getElementById('countSessionReviewPane');
    if(countEvidenceOverlay||!pane||pane.classList.contains('hidden'))return;
    injectCss();
    const layer=document.createElement('section');
    layer.className='riOverlay';
    layer.style.zIndex='9710';
    layer.setAttribute('role','dialog');
    layer.setAttribute('aria-modal','true');
    layer.setAttribute('aria-labelledby','riEvidenceTitle');
    layer.innerHTML='<div class="riPanel"><header class="riHead"><div><h2 id="riEvidenceTitle">Receipt evidence for stock count</h2>'+
      '<small>Investigation only · Inventory remains unchanged</small></div>'+
      '<button id="riEvidenceClose" type="button" class="riClose" aria-label="Close receipt evidence">×</button></header>'+
      '<main class="riBody"><p class="riNote">Purchase documents may help explain a difference. They do not prove the current quantity on the shelf and they do not approve or post stock corrections.</p>'+
      '<div id="riEvidenceStatus" role="status">Checking the completed count…</div>'+
      '<div id="riEvidenceRows"></div></main></div>';
    countEvidenceOverlay=layer;
    layer.querySelector('#riEvidenceClose').addEventListener('click',closeCountEvidence);
    document.body.append(layer);
    const current=++evidenceReadGeneration;
    const setStatus=(text,bad=false)=>{
      if(current!==evidenceReadGeneration||countEvidenceOverlay!==layer)return;
      const status=layer.querySelector('#riEvidenceStatus');
      status.textContent=text;status.classList.toggle('error',bad);
    };
    try{
      const workspace=await api('/api/accounting/workspaces');
      if(current!==evidenceReadGeneration||countEvidenceOverlay!==layer)return;
      const bid=Number(workspace.active_business_id);
      if(workspace.role!=='merchant'||!Number.isSafeInteger(bid)||bid<1)throw Error('Open a Merchant business to review receipt evidence.');
      const session=await api('/api/inventory/count-sessions/active');
      if(current!==evidenceReadGeneration||countEvidenceOverlay!==layer)return;
      if(!session||session.status!=='review'||Number(session.business_id)!==bid)throw Error('Complete your blind physical count and enter Review first.');
      const evidence=await api(ROOT+'/count-sessions/'+Number(session.id)+'/variance-evidence?business_id='+encodeURIComponent(bid));
      if(current!==evidenceReadGeneration||countEvidenceOverlay!==layer)return;
      if(document.getElementById('countSessionReviewPane')?.classList.contains('hidden'))throw Error('Counting resumed. Receipt evidence is unavailable during blind counting.');
      if(evidence.session_status!=='review'||Number(evidence.count_session_id)!==Number(session.id))throw Error('Count review changed. Reopen this panel.');
      const rows=Array.isArray(evidence.findings)?evidence.findings:[];
      const printed=rows.map(row=>{
        const receipt=row.receipt;
        const purchase=row.last_purchase;
        const original=receipt&&Number.isSafeInteger(Number(receipt.id))&&Number(receipt.id)>0
          ?'<a href="'+BASE+'/purchase-documents/'+Number(receipt.id)+'/file?business_id='+encodeURIComponent(bid)+
            '" target="_blank" rel="noopener noreferrer">Open saved receipt original</a>'
          :'<small>No scanned receipt linked to the latest purchase</small>';
        return '<article class="riCard"><h3>'+esc(row.name||'Inventory product')+'</h3>'+
          '<p><strong>Count difference: '+(Number(row.variance)>0?'+':'')+esc(Number(row.variance))+' '+esc(row.unit||'')+'</strong></p>'+
          '<p class="riNote">Expected: '+esc(Number(row.expected))+' · Counted: '+esc(Number(row.counted))+'</p>'+
          (purchase?'<p>Last recorded purchase: '+esc(Number(purchase.quantity))+' '+esc(purchase.unit||'')+
            ' · '+esc(peso(purchase.total_cost))+' · '+esc(String(purchase.date||'').slice(0,10))+'</p>':
            '<p>No linked Inventory purchase history found.</p>')+
          (receipt?'<p>Saved supplier: '+esc(receipt.supplier||'Not specified')+
            ' · Document: '+esc(receipt.number||'No number')+'</p>':'')+
          '<p>'+original+'</p><small>Check purchase receiving, sales/recipe use, spoilage and location transfers before approving any adjustment.</small></article>';
      });
      layer.querySelector('#riEvidenceRows').innerHTML=printed.length?printed.join(''):'<p class="riNote">No counted stock differences currently need purchase-document investigation.</p>';
      setStatus(printed.length+' difference'+(printed.length===1?'':'s')+' with available purchase context.');
    }catch(error){setStatus(error.message||'Receipt evidence unavailable.',true)}
  }

  document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(countEvidenceOverlay)closeCountEvidence();else if(overlay)close()}});
  document.addEventListener('abl:profile-state',()=>{close();closeCountEvidence();queueMicrotask(()=>{mount();mountCountEvidence()})});
  document.addEventListener('abl:business-workspace-changed',()=>{close();closeCountEvidence();queueMicrotask(()=>{mount();mountCountEvidence()})});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{mount();mountCountEvidence()},{once:true});else{mount();mountCountEvidence()}
  if(document.body)new MutationObserver(()=>{mount();mountCountEvidence()}).observe(document.body,{attributes:true,attributeFilter:['data-business-finance-role']});
  window.BusinessLifeReceiptIntelligence={open};
})();
