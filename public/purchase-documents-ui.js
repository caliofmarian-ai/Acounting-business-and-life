// Merchant purchase receipt vault: never persists raw files in the browser.
(()=>{
  const ROOT='/api/procurement/purchase-documents';
  const MAX_FILE=6*1024*1024;
  let overlay=null,businessId=null,saveInProgress=false,pendingKey=null,pendingPayload=null,pendingSubmitted=false,chosenFile=null,previousOverflow='';
  let openAttempt=0,opening=false,saveAttempt=0;
  let archiveRequest=0,linkableRequest=0,metadataEditRequest=0,metadataSaveAttempt=0,metadataSaveInProgress=false;
  let supplementarySaveAttempt=0,supplementarySaveInProgress=false;
  const pendingSupplementaryUploads=new Map();
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
    if(!response.ok){
      const failure=new Error(result.error||'Purchase documents request failed ('+response.status+')');
      failure.status=response.status;throw failure;
    }
    return result;
  }
  function message(text,error=false){
    if(!overlay)return;
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
    .mpdEdit{margin-top:8px;padding:10px;background:#f7fafb;border:1px solid #e1e8ee;border-radius:10px}.mpdHistory{font:12px/1.5 system-ui;color:#53616e}.mpdHistory ol{padding-left:20px}
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
    $('#mpdSaved',overlay).addEventListener('click',event=>{
      const button=event.target?.closest?.('[data-mpd-edit]');
      if(button)editDocument(Number(button.dataset.mpdEdit));
    });
  }
  function selectFile(file){
    // Clearing either native picker revokes the previous attachment. An empty
    // files/change event must never submit a stale private receipt instead.
    chosenFile=null;
    $('#mpdChosenFile',overlay).textContent='No file selected.';
    if(!file){message('');return;}
    if(file.size>MAX_FILE){message('File exceeds 6 MB. Use a smaller scan or photo.',true);return}
    if(!['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type)){message('Only JPEG, PNG, WEBP and PDF are accepted.',true);return}
    chosenFile=file;
    $('#mpdChosenFile',overlay).textContent=file.name+' · '+Math.round(file.size/1024)+' KB';
    message('');
  }
  // A private read belongs to the currently selected Merchant when it paints,
  // even if no profile-state event/new loader fired during its pending GET.
  async function verifiedMerchantRead(panel,biz,isCurrent){
    const revoke=()=>{
      // The companion list can contain previously rendered private A data.
      for(const selector of ['#mpdSaved','#mpdLinkable']){
        const box=$(selector,panel);
        if(box)box.innerHTML='<p class="mpdHelp">Merchant workspace changed or could not be verified. Close and reopen Purchase receipts.</p>';
      }
      archiveRequest++;
      linkableRequest++;
    };
    let context;
    try{context=await api('/api/accounting/workspaces')}
    catch(error){
      if(panel!==overlay||biz!==businessId||!isCurrent())return false;
      revoke();
      throw new Error('Merchant workspace verification failed. Close and reopen Purchase receipts.');
    }
    if(panel!==overlay||biz!==businessId||!isCurrent())return false;
    const active=context?.active_business_id;
    const valid=(typeof active==='number'&&Number.isSafeInteger(active)&&active>0)||
      (typeof active==='string'&&/^[1-9][0-9]*$/.test(active)&&Number.isSafeInteger(Number(active)));
    if(context?.role!=='merchant'||!valid||Number(active)!==biz){
      revoke();
      throw new Error('Merchant workspace changed. Close and reopen Purchase receipts.');
    }
    return true;
  }
  async function linkable(){
    const panel=overlay,biz=businessId;
    if(!panel||!biz)return;
    const request=++linkableRequest;
    const box=$('#mpdLinkable',panel);
    // Do not replace active checkbox selections with an older GET response.
    // A Merchant can start the next draft during the preceding receipt refresh.
    const hasUnsavedSelection=()=>Boolean(box?.querySelectorAll?.('input[name="mpdLink"]:checked')?.length);
    const data=await api(ROOT+'/linkable-purchases?business_id='+encodeURIComponent(biz)).catch(error=>{
      // A superseded fetch cannot replace newer content or surface an old error.
      if(panel!==overlay||biz!==businessId||request!==linkableRequest)return null;
      throw error;
    });
    if(!data||panel!==overlay||biz!==businessId||request!==linkableRequest||!box)return;
    if(!await verifiedMerchantRead(panel,biz,()=>request===linkableRequest))return;
    if(panel!==overlay||biz!==businessId||request!==linkableRequest||hasUnsavedSelection())return;
    // Server rows carry p.business_id. Never render a private purchase based
    // only on the query parameter; validate every row before any rendering.
    if(!Array.isArray(data.purchases)||data.purchases.some(p=>
      !p||typeof p!=='object'||Array.isArray(p)||
      !Number.isSafeInteger(p.id)||p.id<=0||
      !Number.isSafeInteger(p.business_id)||p.business_id!==biz)){
      box.innerHTML='<p class="mpdHelp">Could not verify the Merchant purchase list. Reopen after checking your business.</p>';
      throw new Error('Linked purchases business or row identity could not be verified.');
    }
    if(!data.purchases.length){box.innerHTML='<p class="mpdHelp">No recorded Inventory purchases yet. Save this receipt now and link it later.</p>';return}
    box.innerHTML=data.purchases.map(p=>'<label><input type="checkbox" name="mpdLink" value="'+Number(p.id)+'">'+
      '<span><strong>'+escape(p.inventory_name)+'</strong> · '+escape(currency(p.total_cost))+
      '<br><small>'+escape(String(p.created_at).slice(0,10))+' · '+escape(p.purchase_quantity)+' '+escape(p.purchase_unit)+'</small></span></label>').join('');
  }
  async function archive(){
    const panel=overlay,biz=businessId;
    if(!panel||!biz)return;
    const request=++archiveRequest;
    const box=$('#mpdSaved',panel);
    const data=await api(ROOT+'?business_id='+encodeURIComponent(biz)).catch(error=>{
      // An older read may finish after a confirmed save refresh in this SAME dialog.
      if(panel!==overlay||biz!==businessId||request!==archiveRequest)return null;
      throw error;
    });
    if(!data||panel!==overlay||biz!==businessId||request!==archiveRequest||!box)return;
    if(!await verifiedMerchantRead(panel,biz,()=>request===archiveRequest))return;
    if(panel!==overlay||biz!==businessId||request!==archiveRequest)return;
    // A request URL with a Merchant business parameter does not establish
    // provenance for each returned private record. Reject an entire mixed
    // or malformed archive before rendering a row or a file download link.
    const allowedKinds=['purchase_receipt','invoice','order_slip','other'];
    if(!Array.isArray(data.documents)||data.documents.some(d=>
      !d||typeof d!=='object'||Array.isArray(d)||
      !Number.isSafeInteger(d.id)||d.id<=0||
      !Number.isSafeInteger(d.business_id)||d.business_id!==biz||
      !allowedKinds.includes(d.document_kind)||
      typeof d.has_attachment!=='boolean'||
      typeof d.updated_at!=='string'||!Number.isFinite(Date.parse(d.updated_at)))){
      box.innerHTML='<p class="mpdHelp">Could not verify the Merchant purchase archive. Reopen after checking your business.</p>';
      throw new Error('Purchase archive business or document identity could not be verified.');
    }
    if(!data.documents.length){box.innerHTML='<p class="mpdHelp">No purchase documents saved yet.</p>';return}
    box.innerHTML=data.documents.map(d=>
      '<div class="mpdDoc"><strong>'+escape(d.issuer_name||'Purchase document')+' · '+escape(d.document_kind.replaceAll('_',' '))+'</strong>'+
      '<span>'+escape(String(d.issue_date).slice(0,10))+' · '+escape(currency(d.gross_amount,d.currency_code))+'</span>'+
      '<small>'+escape(d.document_number?'Document #'+d.document_number:'No reference number')+'</small>'+
      (d.has_attachment?'<a href="'+ROOT+'/'+Number(d.id)+'/file?business_id='+encodeURIComponent(businessId)+'">Download saved original</a>':
        '<small>Record saved without a file</small>')+
      '<button class="mpdBtn mpdSecondary" type="button" data-mpd-edit="'+Number(d.id)+'">Edit details</button>'+
      '<div class="mpdEdit" data-mpd-edit-panel="'+Number(d.id)+'" hidden></div></div>').join('');
  }

  async function editDocument(id){
    const panel=overlay,biz=businessId;
    if(!panel||!biz||!Number.isSafeInteger(id)||id<1)return;
    const request=++metadataEditRequest;
    const target=$('[data-mpd-edit-panel="'+id+'"]',panel);
    if(!target)return;
    target.hidden=false;
    target.innerHTML='<p class="mpdHelp">Loading document details…</p>';
    try{
      const result=await api(ROOT+'/'+id+'?business_id='+encodeURIComponent(biz));
      if(panel!==overlay||biz!==businessId||request!==metadataEditRequest)return;
      if(!await verifiedMerchantRead(panel,biz,()=>request===metadataEditRequest))return;
      const doc=result?.document;
      if(!doc||typeof doc!=='object'||Array.isArray(doc)||doc.id!==id||doc.business_id!==biz||
         typeof doc.has_attachment!=='boolean'||typeof doc.updated_at!=='string'||
         !Number.isFinite(Date.parse(doc.updated_at))||!Array.isArray(result.links)||!Array.isArray(result.metadata_history)||
          !Array.isArray(result.supplementary_evidence)||result.supplementary_evidence.some(item=>
            !item||typeof item!=='object'||!Number.isSafeInteger(item.id)||item.id<1||
            item.document_id!==id||item.business_id!==biz||typeof item.file_name!=='string'||
            typeof item.mime_type!=='string'||!Number.isSafeInteger(item.byte_size)||item.byte_size<1||
            typeof item.created_at!=='string'||!Number.isFinite(Date.parse(item.created_at)))){
        throw new Error('Purchase document details could not be verified. Reopen the archive.');
      }
      target.dataset.hasAttachment=String(doc.has_attachment);
      const kinds=[['purchase_receipt','Purchase receipt'],['invoice','Supplier invoice'],
        ['order_slip','Order slip'],['other','Other purchase proof']];
      const options=kinds.map(([value,label])=>'<option value="'+value+'"'+(doc.document_kind===value?' selected':'')+'>'+label+'</option>').join('');
      const history=result.metadata_history.map(item=>{
        const fields=Array.isArray(item.changed_fields)?item.changed_fields:[];
        const details=fields.map(field=>field+': '+String(item.before_metadata?.[field]??'—')+' → '+String(item.after_metadata?.[field]??'—')).join('; ');
        return '<li>'+escape(details||'Metadata updated')+' · '+escape(new Date(item.created_at).toLocaleString())+'</li>';
      }).join('')||'<li>No metadata changes recorded.</li>';
      target.innerHTML=
        '<form class="mpdForm" data-mpd-metadata-form>'+
        '<input type="hidden" name="expected_updated_at" value="'+escape(doc.updated_at)+'">'+
        '<label>Document type<select name="document_kind">'+options+'</select></label>'+
        '<label>Date on document<input type="date" name="issue_date" required value="'+escape(String(doc.issue_date).slice(0,10))+'"></label>'+
        '<label>Shop / Supplier<input name="issuer_name" maxlength="180" value="'+escape(doc.issuer_name||'')+'"></label>'+
        '<div class="mpdGrid"><label>Document number<input name="document_number" maxlength="120" value="'+escape(doc.document_number||'')+'"></label>'+
        '<label>Total amount<input type="number" step=".01" min="0" name="gross_amount" value="'+escape(doc.gross_amount==null?'':String(doc.gross_amount))+'"></label></div>'+
        '<label>Currency code<input name="currency_code" maxlength="3" value="'+escape(doc.currency_code||'PHP')+'"></label>'+
        '<label>Private note<textarea name="note" maxlength="1000">'+escape(doc.note||'')+'</textarea></label>'+
        '<p class="mpdHelp">Editing changes receipt metadata only. The scanned original, linked purchases and financial records remain unchanged.</p>'+
        '<button class="mpdBtn" type="submit">Save details</button></form>'+
        '<details class="mpdHistory"><summary>Change history ('+result.metadata_history.length+')</summary><ol>'+history+'</ol></details>';
      const form=$('[data-mpd-metadata-form]',target);
      form.addEventListener('submit',event=>saveMetadata(event,id,target));
      const evidenceSection=document.createElement('section');
      evidenceSection.className='mpdEdit';
      const supplementary=result.supplementary_evidence.map(item=>
        '<li><a href="'+ROOT+'/'+id+'/evidence/'+Number(item.id)+'/file?business_id='+encodeURIComponent(biz)+'">'+
        escape(item.file_name)+'</a> · '+escape(item.mime_type)+' · '+escape(item.byte_size)+' bytes · '+
        escape(new Date(item.created_at).toLocaleString())+'</li>'
      ).join('')||'<li>No supporting files added.</li>';
      evidenceSection.innerHTML=
        '<strong>Supporting evidence</strong><ol class="mpdHistory">'+supplementary+'</ol>'+
        '<form class="mpdForm" data-mpd-evidence-form>'+
        '<label>Add a supporting photo or PDF<input type="file" name="supplementary_file" accept="image/jpeg,image/png,image/webp,application/pdf" required></label>'+
        '<p class="mpdHelp">Adds a separate private file. It never replaces the original scan or changes Inventory, expenses or payments.</p>'+
        '<button class="mpdBtn" type="submit">Attach supporting file</button></form>';
      target.appendChild(evidenceSection);
      const evidenceForm=$('[data-mpd-evidence-form]',evidenceSection);
      evidenceForm.addEventListener('submit',event=>saveSupplementaryEvidence(event,id,evidenceSection));
      const pending=pendingSupplementaryUploads.get(biz+':'+id);
      if(pending){
        const fileInput=evidenceForm.querySelector('input[type="file"]');
        const button=evidenceForm.querySelector('button[type="submit"]');
        if(fileInput)fileInput.disabled=true;
        if(button)button.textContent='Retry same supporting file';
      }
    }catch(error){
      if(panel===overlay&&biz===businessId&&request===metadataEditRequest){
        // A failed detail read cannot prove that the cached archive still belongs
        // to the selected Merchant. Hide all private rows and require a fresh open.
        close(true);
      }
    }
  }

  async function saveMetadata(event,id,target){
    event.preventDefault();
    if(metadataSaveInProgress)return;
    const panel=overlay,biz=businessId,form=event.currentTarget;
    if(!panel||!biz||!form)return;
    metadataSaveInProgress=true;
    const owner=++metadataSaveAttempt;
    const button=form.querySelector('button[type="submit"]');
    if(button)button.disabled=true;
    const matches=current=>{
      const active=current?.active_business_id;
      const valid=(typeof active==='number'&&Number.isSafeInteger(active)&&active>0)||
        (typeof active==='string'&&/^[1-9][0-9]*$/.test(active)&&Number.isSafeInteger(Number(active)));
      return current?.role==='merchant'&&valid&&Number(active)===biz;
    };
    try{
      let before;
      try{before=await api('/api/accounting/workspaces')}
      catch{close(true);return;}
      if(panel!==overlay||biz!==businessId)return;
      if(!matches(before)){close(true);return;}
      const data=new FormData(form);
      const payload={
        business_id:biz,
        expected_updated_at:String(data.get('expected_updated_at')||''),
        document_kind:String(data.get('document_kind')||''),
        issue_date:String(data.get('issue_date')||''),
        issuer_name:String(data.get('issuer_name')||''),
        document_number:String(data.get('document_number')||''),
        gross_amount:String(data.get('gross_amount')||''),
        currency_code:String(data.get('currency_code')||''),
        note:String(data.get('note')||'')
      };
      const result=await api(ROOT+'/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      if(panel!==overlay||biz!==businessId)return;
      const doc=result?.document;
      const cents=value=>{
        if(value==null)return null;
        const text=String(value);
        if(!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(text))return false;
        const [whole,fraction='']=text.split('.');
        return BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')||'0');
      };
      const expected=payload.gross_amount===''?null:cents(payload.gross_amount);
      const saved=cents(doc?.gross_amount);
      const sameAmount=expected!==false&&saved!==false&&expected===saved;
      if(!doc||typeof doc!=='object'||Array.isArray(doc)||doc.id!==id||doc.business_id!==biz||
         doc.document_kind!==payload.document_kind||String(doc.issue_date).slice(0,10)!==payload.issue_date||
         doc.issuer_name!==payload.issuer_name.trim()||doc.document_number!==payload.document_number.trim()||
         doc.currency_code!==payload.currency_code.trim().toUpperCase()||doc.note!==payload.note.trim()||
         !sameAmount||doc.has_attachment!==(target.dataset.hasAttachment==='true')||
         typeof doc.updated_at!=='string'||!Number.isFinite(Date.parse(doc.updated_at))||
         typeof result.already_applied!=='boolean'){
        throw new Error('Metadata acknowledgement did not match this document. Refresh before retrying.');
      }
      let after;
      try{after=await api('/api/accounting/workspaces')}
      catch{close(true);return;}
      if(panel!==overlay||biz!==businessId)return;
      if(!matches(after)){close(true);return;}
      const notice=result.already_applied?'These document details were already saved.':'Purchase document details updated.';
      message(notice+' The scanned original, purchase links and financial records are unchanged.');
      try{await archive()}
      catch{message(notice+' The archive could not refresh; close and reopen Purchase receipts to reload it.',true);return;}
      if(panel===overlay&&biz===businessId)await editDocument(id);
    }catch(error){
      if(panel===overlay){
        if(error.status===401||error.status===403)close(true);
        else message(error.message,true);
      }
    }
    finally{
      if(owner===metadataSaveAttempt){metadataSaveInProgress=false;if(button)button.disabled=false;}
    }
  }

  async function saveSupplementaryEvidence(event,id,target){
    event.preventDefault();
    if(supplementarySaveInProgress)return;
    const panel=overlay,biz=businessId,form=event.currentTarget;
    if(!panel||!biz||!form)return;
    supplementarySaveInProgress=true;
    const owner=++supplementarySaveAttempt;
    const button=form.querySelector('button[type="submit"]');
    const input=form.querySelector('input[type="file"]');
    if(button)button.disabled=true;
    const intent=biz+':'+id;
    const matches=current=>{
      const active=current?.active_business_id;
      const valid=(typeof active==='number'&&Number.isSafeInteger(active)&&active>0)||
        (typeof active==='string'&&/^[1-9][0-9]*$/.test(active)&&Number.isSafeInteger(Number(active)));
      return current?.role==='merchant'&&valid&&Number(active)===biz;
    };
    try{
      const before=await api('/api/accounting/workspaces');
      if(panel!==overlay||biz!==businessId)return;
      if(!matches(before)){close(true);return;}
      let pending=pendingSupplementaryUploads.get(intent);
      if(!pending){
        const file=input?.files?.[0];
        if(!file||typeof file.name!=='string'||!file.name||!Number.isFinite(file.size)||file.size<1){
          throw new Error('Choose a supporting photo or PDF first.');
        }
        if(file.size>MAX_FILE)throw new Error('Supporting evidence must be 6 MB or smaller.');
        if(!['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type)){
          throw new Error('Only JPEG, PNG, WEBP or PDF files are accepted.');
        }
        const dataUrl=await readFile(file);
        if(panel!==overlay||biz!==businessId)return;
        const afterRead=await api('/api/accounting/workspaces');
        if(panel!==overlay||biz!==businessId)return;
        if(!matches(afterRead)){close(true);return;}
        pending={client_request_key:requestKey(),file_name:file.name,data_url:dataUrl};
        pendingSupplementaryUploads.set(intent,pending);
        if(input)input.disabled=true;
        if(button)button.textContent='Retry same supporting file';
      }
      const result=await api(ROOT+'/'+id+'/evidence',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({business_id:biz,...pending})
      });
      if(panel!==overlay||biz!==businessId)return;
      const item=result?.evidence;
      if(!item||typeof item!=='object'||Array.isArray(item)||
         !Number.isSafeInteger(item.id)||item.id<1||item.document_id!==id||item.business_id!==biz||
         item.file_name!==pending.file_name||typeof item.mime_type!=='string'||
         !Number.isSafeInteger(item.byte_size)||item.byte_size<1||
         typeof item.created_at!=='string'||!Number.isFinite(Date.parse(item.created_at))||
         typeof result.already_saved!=='boolean'){
        throw new Error('Supporting evidence acknowledgement did not match this receipt. Retry the same file.');
      }
      const after=await api('/api/accounting/workspaces');
      if(panel!==overlay||biz!==businessId)return;
      if(!matches(after)){close(true);return;}
      pendingSupplementaryUploads.delete(intent);
      form.reset();
      if(input)input.disabled=false;
      if(button){button.textContent='Attach supporting file';button.disabled=false;}
      const notice=result.already_saved?'Supporting file was already saved.':'Supporting file saved securely.';
      message(notice+' The original scan and financial records are unchanged.');
      try{await archive();if(panel===overlay&&biz===businessId)await editDocument(id)}
      catch{message(notice+' The receipt archive could not refresh; close and reopen it.',true);}
    }catch(error){
      if(panel===overlay){
        if(error.status===401||error.status===403)close(true);
        else message(error.message+' Retry with the same selected file; its request key is preserved.',true);
      }
    }finally{
      if(owner===supplementarySaveAttempt){
        supplementarySaveInProgress=false;
        if(button)button.disabled=false;
      }
    }
  }
  function readFile(file){
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(String(reader.result||''));
      reader.onerror=()=>reject(new Error('Could not read the selected document'));
      reader.readAsDataURL(file);
    });
  }
  // The route supplies this literal document shape on 201 and same-key 200.
  // An unverified 2xx cannot release the only stable retry key.
  function acknowledgedDocumentMatches(result,payload){
    const doc=result?.document;
    if(!doc||typeof doc!=='object'||Array.isArray(doc)||
       (result.already_saved!==true&&result.already_saved!==false))return false;
    const cents=value=>{
      if(value==null)return null;
      if((typeof value!=='string'&&typeof value!=='number')||
        !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(String(value)))return false;
      const [whole,part='']=String(value).split('.');
      return BigInt(whole)*100n+BigInt(part.padEnd(2,'0')||'0');
    };
    const expected=payload.gross_amount===''?null:cents(payload.gross_amount),saved=cents(doc.gross_amount);
    const same=name=>typeof doc[name]==='string'&&doc[name]===String(payload[name]??'').trim();
    const date=typeof doc.issue_date==='string'&&
      (doc.issue_date===payload.issue_date||doc.issue_date===payload.issue_date+'T00:00:00.000Z');
    return typeof doc.id==='number'&&Number.isSafeInteger(doc.id)&&doc.id>0&&
      typeof doc.business_id==='number'&&doc.business_id===payload.business_id&&
      doc.document_kind===payload.document_kind&&doc.currency_code===payload.currency_code&&date&&
      same('issuer_name')&&same('document_number')&&same('note')&&
      expected!==false&&saved!==false&&expected===saved&&
      typeof doc.has_attachment==='boolean'&&doc.has_attachment===Boolean(payload.data_url);
  }
  async function save(event){
    event.preventDefault();
    // A disabled submit button does not cancel a second submit event already
    // dispatched while workspace/file checks or POST acknowledgement await.
    // Only one receipt save operation may own the dialog at a time.
    if(saveInProgress)return;
    const panel=overlay,biz=businessId;
    if(!panel||!biz)return;
    saveInProgress=true;
    // Each save owns its loading state only for the dialog identity that started it.
    const saveOwner=++saveAttempt;
    const btn=$('#mpdSave',panel);btn.disabled=true;
    // Never use Number coercion as Merchant authorization for private receipts.
    const matchesMerchantWorkspace=current=>{
      const active=current?.active_business_id;
      const valid=(typeof active==='number'&&Number.isSafeInteger(active)&&active>0)||
        (typeof active==='string'&&/^[1-9][0-9]*$/.test(active)&&Number.isSafeInteger(Number(active)));
      return current?.role==='merchant'&&valid&&Number(active)===biz;
    };
    try{
      const workspace=await api('/api/accounting/workspaces');
      if(panel!==overlay||!matchesMerchantWorkspace(workspace))throw new Error('Merchant workspace changed. Close and reopen Purchase receipts.');
      const form=$('#mpdForm',panel),data=new FormData(form);
      const payload={
        business_id:biz,
        document_kind:String(data.get('document_kind')||'purchase_receipt'),
        issuer_name:String(data.get('issuer_name')||''),
        issue_date:String(data.get('issue_date')||today()),
        document_number:String(data.get('document_number')||''),
        gross_amount:String(data.get('gross_amount')||''),
        currency_code:'PHP',note:String(data.get('note')||''),
        links:[...panel.querySelectorAll('input[name="mpdLink"]:checked')].map(n=>({kind:'inventory_purchase',id:Number(n.value)}))
      };
      const fileAtStart=chosenFile;
      if(fileAtStart){payload.file_name=fileAtStart.name;payload.data_url=await readFile(fileAtStart)}
      if(panel!==overlay||biz!==businessId)return;
      const confirmed=await api('/api/accounting/workspaces');
      if(panel!==overlay||!matchesMerchantWorkspace(confirmed))throw new Error('Merchant workspace changed. Close and reopen Purchase receipts.');
      // Reading a camera file or rechecking the workspace is asynchronous. Other
      // form controls remain editable during those awaits: never send an older
      // document/file/link snapshot after the operator changed the visible draft.
      const latest=new FormData(form);
      const currentDraft={
        document_kind:String(latest.get('document_kind')||'purchase_receipt'),
        issuer_name:String(latest.get('issuer_name')||''),
        issue_date:String(latest.get('issue_date')||today()),
        document_number:String(latest.get('document_number')||''),
        gross_amount:String(latest.get('gross_amount')||''),
        note:String(latest.get('note')||''),
        links:[...panel.querySelectorAll('input[name="mpdLink"]:checked')].map(n=>({kind:'inventory_purchase',id:Number(n.value)}))
      };
      if(fileAtStart!==chosenFile||Object.entries(currentDraft).some(([name,value])=>
        JSON.stringify(value)!==JSON.stringify(payload[name]))){
        throw new Error('Receipt details changed while preparing. Review the current draft and submit again.');
      }
      // A failed/lost POST acknowledgement is not proof of rollback. Keep the
      // same key for the exact same receipt, and never reuse it for edited data.
      // No key is reserved before workspace and file validation finish.
      const intent=JSON.stringify(payload);
      if(pendingSubmitted&&pendingPayload!==intent){
        throw new Error('The earlier receipt submission may already be saved. Check Saved documents before changing it; close and reopen for a different receipt.');
      }
      if(!pendingKey||pendingPayload!==intent)pendingKey=requestKey();
      pendingPayload=intent;
      payload.client_request_key=pendingKey;
      pendingSubmitted=true;
      const result=await api(ROOT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      if(panel!==overlay||biz!==businessId)return;
      if(!acknowledgedDocumentMatches(result,payload)){
        throw new Error('Purchase document acknowledgement did not match this receipt. Original retry key is retained; check Saved documents before resubmitting or changing the draft.');
      }
      // An old Merchant A POST may commit while the operator silently switches
      // to Merchant B without a profile-state event. Cached panel/business IDs
      // are not authority to clear B's draft or show A's private save result.
      let postWorkspace;
      try{postWorkspace=await api('/api/accounting/workspaces')}
      catch{
        if(panel===overlay)close(true);
        return;
      }
      if(panel!==overlay||biz!==businessId)return;
      if(!matchesMerchantWorkspace(postWorkspace)){
        close(true);
        return;
      }
      // A confirmed old receipt must never erase details/file for a newer
      // receipt the operator entered while its POST was still in flight.
      const afterPost=new FormData(form);
      const newerDraft={
        document_kind:String(afterPost.get('document_kind')||'purchase_receipt'),
        issuer_name:String(afterPost.get('issuer_name')||''),
        issue_date:String(afterPost.get('issue_date')||today()),
        document_number:String(afterPost.get('document_number')||''),
        gross_amount:String(afterPost.get('gross_amount')||''),
        note:String(afterPost.get('note')||''),
        links:[...panel.querySelectorAll('input[name="mpdLink"]:checked')].map(n=>({kind:'inventory_purchase',id:Number(n.value)}))
      };
      const newerEdits=fileAtStart!==chosenFile||Object.entries(currentDraft).some(([name,value])=>
        JSON.stringify(value)!==JSON.stringify(newerDraft[name]));
      pendingKey=null;pendingPayload=null;pendingSubmitted=false;
      if(!newerEdits){
        chosenFile=null;
        form.reset();form.elements.issue_date.value=today();
        $('#mpdChosenFile',overlay).textContent='No file selected.';
      }
      // The POST result is definitive before the two auxiliary GET refreshes.
      // A failed archive/list refresh must never be presented as a failed save:
      // that would encourage creating a second receipt with a new intent key.
      const savedNotice=(result.already_saved?'This document was already saved.':'Purchase document saved securely.')+
        (newerEdits?' Your newer unsaved edits are preserved; review them before submitting a different receipt.':'');
      message(savedNotice);
      // Replacing the linked-purchase checkboxes would erase a next receipt's
      // unsaved selection. Refresh the confirmed archive, not the live draft.
      const refreshes=await Promise.allSettled(newerEdits?[archive()]:[archive(),linkable()]);
      if(panel===overlay&&biz===businessId&&refreshes.some(item=>item.status==='rejected')){
        message(savedNotice+' Archive or purchase links could not refresh. The save is confirmed; close and reopen to reload the list.',true);
      }
    }catch(error){if(panel===overlay)message(error.message,true)}
    finally{
      // An obsolete preflight/POST/archive response must not unlock another
      // Merchant's newly opened receipt dialog after a forced profile switch.
      if(saveOwner===saveAttempt){saveInProgress=false;if(btn)btn.disabled=false}
    }
  }
  function close(force=false){
    // A POST can commit even when its acknowledgement is lost. Ordinary X/Escape
    // dismissal during an in-flight POST must not discard the only stable retry key.
    // Completed POSTs may dismiss while unrelated archive GET refreshes finish.
    // A real profile switch must still close immediately to hide private data.
    if(force!==true&&saveInProgress&&pendingSubmitted){
      message('Receipt save is processing. Keep this dialog open until the request finishes.',true);
      return false;
    }
    if(force!==true&&pendingSubmitted){
      const acknowledged=window.confirm('This receipt may already be saved. Closing loses its original retry key. Check Saved documents before making another receipt. Close anyway?');
      if(!acknowledged)return false;
    }
    if(!overlay)return;
    // A closed panel must not be revived by an older async workspace/list call.
    openAttempt++;
    opening=false;
    // Forced identity revocation also releases the old dialog's busy state;
    // a late finally from that dialog cannot clear a replacement save.
    saveAttempt++;
    saveInProgress=false;
    metadataEditRequest++;metadataSaveAttempt++;metadataSaveInProgress=false;
    overlay.remove();overlay=null;businessId=null;chosenFile=null;pendingKey=null;pendingPayload=null;pendingSubmitted=false;
    document.body.style.overflow=previousOverflow;
    return true;
  }
  async function open(){
    // The workspace GET can resolve after a profile switch; coalesce fast clicks
    // until the first response has been checked against the current identity epoch.
    if(overlay||opening)return;
    opening=true;
    const attempt=++openAttempt;
    try{
      const current=await api('/api/accounting/workspaces');
      if(attempt!==openAttempt)return;
      const active=current?.active_business_id;
      const validActive=(typeof active==='number'&&Number.isSafeInteger(active)&&active>0)||
        (typeof active==='string'&&/^[1-9][0-9]*$/.test(active)&&Number.isSafeInteger(Number(active)));
      if(current?.role!=='merchant'||!validActive)throw new Error('Switch to your Merchant business to save purchase receipts.');
      businessId=Number(active);
      injectCss();render();previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';
      opening=false;
      await Promise.all([linkable(),archive()]);
    }catch(error){
      if(attempt!==openAttempt)return;
      if(overlay)message(error.message,true);
      else window.alert(error.message);
    }finally{
      if(attempt===openAttempt)opening=false;
    }
  }
  function ensureButton(){
    const role=document.body?.dataset?.businessFinanceRole;
    const heading=$('#viewStock h1');
    if(!heading)return;
    const old=$('#merchantPurchaseDocumentsButton');
    if(role!=='merchant'){
      if(old)old.remove();
      // A role change can arrive while initial workspace discovery is pending.
      if(opening){openAttempt++;opening=false}
      if(overlay)close(true);
      return;
    }
    if(old)return;
    const btn=document.createElement('button');
    btn.id='merchantPurchaseDocumentsButton';btn.type='button';
    btn.textContent='Purchase receipts · Save / View';
    btn.addEventListener('click',open);
    heading.insertAdjacentElement('afterend',btn);
  }
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&overlay)close()});
  function invalidatePurchaseDocumentContext(){
    // Invalidate even without a visible overlay: open() might still be awaiting
    // an older account's response. Never show its private document panel.
    openAttempt++;
    opening=false;
    if(overlay)close(true);
    queueMicrotask(ensureButton);
  }
  document.addEventListener('abl:profile-state',invalidatePurchaseDocumentContext);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ensureButton,{once:true});
  else ensureButton();
  new MutationObserver(ensureButton).observe(document.body,{attributes:true,attributeFilter:['data-business-finance-role']});
  window.BusinessLifePurchaseDocuments={open};
})();
