// Merchant purchase receipt vault: never persists raw files in the browser.
(()=>{
  const ROOT='/api/procurement/purchase-documents';
  const MAX_FILE=6*1024*1024;
  let overlay=null,businessId=null,pendingKey=null,chosenFile=null,previousOverflow='';
  const $=(selector,root=document)=>root.querySelector(selector);
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const currency=(value,code='PHP')=>value==null?'Amount not recorded':new Intl.NumberFormat('en-PH',{style:'currency',currency:code||'PHP'}).format(Number(value));
  const today=()=>{
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const value=Object.fromEntries(parts.map(part=>[part.type,part.value]));
    return value.year+'-'+value.month+'-'+value.day;
  };
  const requestKey=()=>('purchase-'+Date.now()+'-'+Math.random().toString(36).slice(2,14)).replace(/[^a-zA-Z0-9_-]/g,'');
  async function api(path,options={}){
    const response=await fetch(path,{credentials:'same-origin',...options});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||'Purchase documents request failed ('+response.status+')');
    return result;
  }
  function message(text,error=false){
    const node=$('#mpdMessage',overlay);
    if(!node)return;
    node.textContent=text||'';
    node.classList.toggle('error',error);
    node.setAttribute('role',error?'alert':'status');
  }
  function injectCss(){
    if($('#mpdStyles'))return;
    const style=document.createElement('style');style.id='mpdStyles';
    style.textContent=`
    #merchantPurchaseDocumentsButton{margin:8px 0 14px;padding:12px 16px;border:1px solid #238676;background:#e6f7f1;color:#07594c;border-radius:12px;font:700 14px system-ui;min-height:44px;cursor:pointer}
    .mpdOverlay{position:fixed;inset:0;background:rgba(12,23,35,.72);z-index:9500;display:flex;align-items:center;justify-content:center;padding:0}
    .mpdPanel{background:#fff;color:#15232d;width:min(680px,100%);height:min(94dvh,960px);overflow:auto;overscroll-behavior:contain;border-radius:18px;position:relative;box-shadow:0 16px 38px rgba(0,0,0,.3)}
    .mpdHead{position:sticky;top:0;background:#fff;border-bottom:1px solid #e5ebf1;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:18px;z-index:1}
    .mpdHead h2{font:800 22px system-ui;margin:0}.mpdHead p{margin:6px 0 0;color:#576575;font-size:13px}
    .mpdClose{border:1px solid #d1dbe3;border-radius:12px;background:#fff;width:44px;height:44px;font-size:24px;cursor:pointer;flex-shrink:0}
    .mpdMain{padding:16px 18px 32px;display:grid;gap:20px}.mpdCard{border:1px solid #e1e8ee;border-radius:14px;padding:14px;background:#fff}
    .mpdCard h3{margin:0 0 12px;font:800 16px system-ui}.mpdHelp{font:13px/1.5 system-ui;color:#5a6472;margin:8px 0}
    .mpdForm{display:grid;gap:12px}.mpdForm label{display:grid;gap:5px;font:650 13px system-ui}.mpdForm input:not([type=checkbox]),.mpdForm select,.mpdForm textarea{font:15px system-ui;border:1px solid #a9bac5;background:#fff;color:#17232f;border-radius:10px;padding:11px;width:100%;box-sizing:border-box;min-height:43px}
    .mpdForm textarea{min-height:70px;resize:vertical}.mpdGrid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .mpdFileInput{border:1px dashed #93aca7;border-radius:12px;padding:10px;display:grid;gap:10px}.mpdFileInput input{max-width:100%}
    .mpdBtn{border:0;border-radius:11px;background:#087968;color:#fff;padding:12px 16px;min-height:46px;font:750 15px system-ui;cursor:pointer}
    .mpdBtn:disabled{opacity:.55;cursor:wait}.mpdSecondary{background:#f0f5f6;border:1px solid #bfcfd3;color:#1d3f3d}
    .mpdNote{background:#f2f7fc;padding:10px 12px;border-radius:10px;font:13px/1.5 system-ui;color:#394f66}
    .mpdMessage{min-height:18px;color:#087968;font:14px/1.4 system-ui}.mpdMessage.error{color:#b3261e}
    .mpdRecords{max-height:190px;overflow:auto;border:1px solid #e3ebee;border-radius:10px;padding:8px}
    .mpdRecords label{display:flex;align-items:center;gap:9px;padding:7px 4px;font:13px system-ui}
    .mpdRecords input{height:18px;width:18px;flex-shrink:0}
    .mpdDoc{border-top:1px solid #e6eaef;padding:12px 0;display:grid;gap:5px;font:14px system-ui}
    .mpdDoc strong{font-size:14px}.mpdDoc small{color:#677482}.mpdDoc a{color:#075fa1;text-decoration:underline;width:max-content}
    @media(max-width:600px){.mpdPanel{height:100dvh;border-radius:0}.mpdHead{padding:14px}.mpdMain{padding:12px 14px 30px}.mpdGrid{grid-template-columns:1fr}}
    `;
    document.head.append(style);
  }
  function render(){
    if(!overlay){
      overlay=document.createElement('div');overlay.className='mpdOverlay';overlay.id='mpdOverlay';
      overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-labelledby','mpdTitle');
      document.body.appendChild(overlay);
    }
    overlay.innerHTML=
      '<div class="mpdPanel"><header class="mpdHead"><div><h2 id="mpdTitle">Purchase receipts</h2><p>Merchant · Save and find Inventory purchase documents</p></div><button type="button" class="mpdClose" aria-label="Close purchase receipts">×</button></header>'+
      '<main class="mpdMain"><section class="mpdCard"><h3>Add a purchase document</h3>'+
      '<p class="mpdHelp">Photograph the paper receipt or attach an invoice/PDF. One receipt can cover several Inventory products.</p>'+
      '<form id="mpdForm" class="mpdForm">'+
      '<div class="mpdGrid"><label>Document type<select name="document_kind"><option value="purchase_receipt">Purchase receipt</option><option value="invoice">Supplier invoice</option><option value="order_slip">Order slip</option><option value="other">Other purchase proof</option></select></label>'+
      '<label>Date on document<input type="date" name="issue_date" required value="'+escape(today())+'"></label></div>'+
      '<label>Shop / Supplier<input name="issuer_name" maxlength="180" placeholder="Where did you buy it?"></label>'+
      '<div class="mpdGrid"><label>Document number (optional)<input name="document_number" maxlength="120" placeholder="Number on receipt"></label>'+
      '<label>Total in PHP (optional)<input type="number" step=".01" min="0" name="gross_amount" placeholder="0.00"></label></div>'+
      '<div class="mpdFileInput"><label>Take a photo<input id="mpdCamera" type="file" accept="image/*" capture="environment"></label>'+
      '<label>Or attach existing photo / PDF<input id="mpdFile" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"></label>'+
      '<small id="mpdChosenFile" class="mpdHelp">No file selected. JPEG, PNG, WEBP or PDF, maximum 6 MB.</small></div>'+
      '<div><strong>Link Inventory purchases (optional)</strong><div id="mpdLinkable" class="mpdRecords"><p class="mpdHelp">Loading recent purchases…</p></div></div>'+
      '<label>Private note<textarea name="note" maxlength="1000" placeholder="Optional accounting note"></textarea></label>'+
      '<div class="mpdNote">Saving this file does not charge money or create a second expense. An order slip or receipt is not automatically a BIR-valid Invoice.</div>'+
      '<button class="mpdBtn" type="submit" id="mpdSave">Save purchase document</button><div id="mpdMessage" class="mpdMessage" role="status"></div>'+
      '</form></section><section class="mpdCard"><h3>Saved documents</h3><div id="mpdSaved"><p class="mpdHelp">Loading archive…</p></div></section></main></div>';
    $('.mpdClose',overlay).onclick=close;
    $('#mpdFile',overlay).onchange=event=>selectFile(event.target.files?.[0]);
    $('#mpdCamera',overlay).onchange=event=>selectFile(event.target.files?.[0]);
    $('#mpdForm',overlay).onsubmit=save;
  }
  function selectFile(file){
    if(!file)return;
    chosenFile=null;
    $('#mpdChosenFile',overlay).textContent='No file selected.';
    if(file.size>MAX_FILE){message('File exceeds 6 MB. Use a smaller scan or photo.',true);return}
    if(!['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type)){message('Only JPEG, PNG, WEBP and PDF are accepted.',true);return}
    chosenFile=file;
    $('#mpdChosenFile',overlay).textContent=file.name+' · '+Math.round(file.size/1024)+' KB';
    message('');
  }
  async function linkable(){
    const box=$('#mpdLinkable',overlay);
    const data=await api(ROOT+'/linkable-purchases?business_id='+encodeURIComponent(businessId));
    if(!overlay||!box)return;
    if(!data.purchases?.length){box.innerHTML='<p class="mpdHelp">No recorded Inventory purchases yet. Save this receipt now and link it later.</p>';return}
    box.innerHTML=data.purchases.map(p=>'<label><input type="checkbox" name="mpdLink" value="'+Number(p.id)+'">'+
      '<span><strong>'+escape(p.inventory_name)+'</strong> · '+escape(currency(p.total_cost))+
      '<br><small>'+escape(String(p.created_at).slice(0,10))+' · '+escape(p.purchase_quantity)+' '+escape(p.purchase_unit)+'</small></span></label>').join('');
  }
  async function archive(){
    const box=$('#mpdSaved',overlay);
    const data=await api(ROOT+'?business_id='+encodeURIComponent(businessId));
    if(!overlay||!box)return;
    if(!data.documents?.length){box.innerHTML='<p class="mpdHelp">No purchase documents saved yet.</p>';return}
    box.innerHTML=data.documents.map(d=>
      '<div class="mpdDoc"><strong>'+escape(d.issuer_name||'Purchase document')+' · '+escape(d.document_kind.replaceAll('_',' '))+'</strong>'+
      '<span>'+escape(String(d.issue_date).slice(0,10))+' · '+escape(currency(d.gross_amount,d.currency_code))+'</span>'+
      '<small>'+escape(d.document_number?'Document #'+d.document_number:'No reference number')+'</small>'+
      (d.has_attachment?'<a href="'+ROOT+'/'+Number(d.id)+'/file?business_id='+encodeURIComponent(businessId)+'">Download saved original</a>':
        '<small>Record saved without a file</small>')+'</div>').join('');
  }
  function readFile(file){
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(String(reader.result||''));
      reader.onerror=()=>reject(new Error('Could not read the selected document'));
      reader.readAsDataURL(file);
    });
  }
  async function save(event){
    event.preventDefault();
    const btn=$('#mpdSave',overlay);btn.disabled=true;
    try{
      const workspace=await api('/api/accounting/workspaces');
      if(workspace.role!=='merchant'||Number(workspace.active_business_id)!==businessId)throw new Error('Merchant workspace changed. Close and reopen Purchase receipts.');
      const form=$('#mpdForm',overlay),data=new FormData(form);
      if(!pendingKey)pendingKey=requestKey();
      const payload={
        business_id:businessId,client_request_key:pendingKey,
        document_kind:String(data.get('document_kind')||'purchase_receipt'),
        issuer_name:String(data.get('issuer_name')||''),
        issue_date:String(data.get('issue_date')||today()),
        document_number:String(data.get('document_number')||''),
        gross_amount:String(data.get('gross_amount')||''),
        currency_code:'PHP',note:String(data.get('note')||''),
        links:[...overlay.querySelectorAll('input[name="mpdLink"]:checked')].map(n=>({kind:'inventory_purchase',id:Number(n.value)}))
      };
      if(chosenFile){payload.file_name=chosenFile.name;payload.data_url=await readFile(chosenFile)}
      const result=await api(ROOT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      pendingKey=null;chosenFile=null;
      form.reset();form.elements.issue_date.value=today();
      $('#mpdChosenFile',overlay).textContent='No file selected.';
      message(result.already_saved?'This document was already saved.':'Purchase document saved securely.');
      await archive();await linkable();
    }catch(error){message(error.message,true)}
    finally{if(btn)btn.disabled=false}
  }
  function close(){
    if(!overlay)return;
    overlay.remove();overlay=null;businessId=null;chosenFile=null;pendingKey=null;
    document.body.style.overflow=previousOverflow;
  }
  async function open(){
    if(overlay)return;
    try{
      const current=await api('/api/accounting/workspaces');
      if(current.role!=='merchant'||!Number(current.active_business_id))throw new Error('Switch to your Merchant business to save purchase receipts.');
      businessId=Number(current.active_business_id);
      injectCss();render();previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';
      await Promise.all([linkable(),archive()]);
    }catch(error){
      if(overlay)message(error.message,true);
      else window.alert(error.message);
    }
  }
  function ensureButton(){
    const role=document.body?.dataset?.businessFinanceRole;
    const heading=$('#viewStock h1');
    if(!heading)return;
    const old=$('#merchantPurchaseDocumentsButton');
    if(role!=='merchant'){if(old)old.remove();return}
    if(old)return;
    const btn=document.createElement('button');
    btn.id='merchantPurchaseDocumentsButton';btn.type='button';
    btn.textContent='Purchase receipts · Save / View';
    btn.addEventListener('click',open);
    heading.insertAdjacentElement('afterend',btn);
  }
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&overlay)close()});
  document.addEventListener('abl:profile-state',()=>{if(overlay)close();queueMicrotask(ensureButton)});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ensureButton,{once:true});
  else ensureButton();
  new MutationObserver(ensureButton).observe(document.body,{attributes:true,attributeFilter:['data-business-finance-role']});
  window.BusinessLifePurchaseDocuments={open};
})();
