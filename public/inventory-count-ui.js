const byId=id=>document.getElementById(id);

const INVENTORY_TYPE_LABELS={
  ingredient:'Ingredients',
  packaging:'Packaging',
  kitchen_consumable:'Kitchen consumables',
  cleaning_sanitation:'Cleaning & sanitation',
  hygiene:'Food handling & hygiene',
  operational_supply:'Operational supplies'
};

export function createInventoryCountUi({
  api,
  getInventory,
  refreshInventory,
  escapeHtml,
  formatNumber,
  storageAreaLabels={}
}){
  let session=null;
  let wired=false;
  const esc=escapeHtml;
  const num=formatNumber;

  function message(text='',tone=''){
    const out=byId('countSessionMessage');
    if(!out)return;
    out.className=tone||'';
    out.textContent=text;
  }

  function scopeLabel(item){
    const type=INVENTORY_TYPE_LABELS[item.inventory_type]||item.inventory_type||'Inventory';
    const area=storageAreaLabels[item.storage_area_type]||item.storage_area_type||'Other / not set';
    return `${type} · ${area}${item.storage_location_label?' · '+item.storage_location_label:''}`;
  }

  function syncScopeOptions(){
    const type=byId('countSessionType');
    const typeWrap=byId('countSessionScopeTypeWrap');
    const valueWrap=byId('countSessionScopeValueWrap');
    const scopeType=byId('countSessionScopeType');
    const scopeValue=byId('countSessionScopeValue');
    if(!type||!scopeType||!scopeValue)return;
    const cycle=type.value==='cycle';
    typeWrap?.classList.toggle('hidden',!cycle);
    valueWrap?.classList.toggle('hidden',!cycle);
    if(!cycle)return;
    const inventory=Array.isArray(getInventory?.())?getInventory():[];
    const values=scopeType.value==='storage_area_type'
      ?[...new Set(inventory.map(x=>x.storage_area_type||'other'))].sort()
      :[...new Set(inventory.map(x=>x.inventory_type||'ingredient'))].sort();
    const prior=scopeValue.value;
    const options=[new Option('Choose a scope','')];
    for(const value of values){
      const label=scopeType.value==='storage_area_type'
        ?(storageAreaLabels[value]||value.replaceAll('_',' '))
        :(INVENTORY_TYPE_LABELS[value]||value.replaceAll('_',' '));
      options.push(new Option(label,value));
    }
    scopeValue.replaceChildren(...options);
    if(prior&&values.includes(prior))scopeValue.value=prior;
    else if(values.length===1)scopeValue.value=values[0];
  }

  function activeSelectedItem(){
    const picker=byId('countSessionItemPicker');
    const items=Array.isArray(session?.items)?session.items:[];
    return items.find(x=>String(x.inventory_id)===String(picker?.value))||null;
  }

  function renderCurrentItem(){
    if(session?.status!=='in_progress')return;
    const item=activeSelectedItem();
    const name=byId('countSessionCurrentName');
    const meta=byId('countSessionCurrentMeta');
    const unit=byId('countSessionCurrentUnit');
    const qty=byId('countSessionQuantity');
    const save=byId('countSessionSaveItem');
    if(!item){
      if(name)name.textContent='All items counted';
      if(meta)meta.textContent='Review the count to compare expected stock and variances.';
      if(unit)unit.textContent='';
      if(qty){qty.value='';qty.disabled=true}
      if(save)save.disabled=true;
      return;
    }
    if(name)name.textContent=item.item||'Inventory item';
    if(meta)meta.textContent=scopeLabel(item);
    if(unit)unit.textContent=item.unit||'';
    if(qty){
      qty.disabled=false;
      qty.value=item.counted_quantity==null?'':String(item.counted_quantity);
      qty.dataset.inventoryId=String(item.inventory_id);
    }
    if(save)save.disabled=false;
  }

  function fillItemPicker(){
    const picker=byId('countSessionItemPicker');
    if(!picker||session?.status!=='in_progress')return;
    const items=Array.isArray(session.items)?session.items:[];
    const prior=picker.value;
    picker.replaceChildren(...items.map(item=>new Option(
      `${item.counted_quantity==null?'○':'✓'} ${item.item} · ${item.unit}`,
      String(item.inventory_id)
    )));
    const firstUncounted=items.find(item=>item.counted_quantity==null);
    if(prior&&items.some(item=>String(item.inventory_id)===prior))picker.value=prior;
    else if(firstUncounted)picker.value=String(firstUncounted.inventory_id);
    else if(items[0])picker.value=String(items[0].inventory_id);
    renderCurrentItem();
  }

  function selectItem(inventoryId){
    if(session?.status!=='in_progress')return false;
    const picker=byId('countSessionItemPicker');
    const item=(session.items||[]).find(x=>Number(x.inventory_id)===Number(inventoryId));
    if(!picker||!item)return false;
    picker.value=String(item.inventory_id);
    renderCurrentItem();
    byId('guidedCountCard')?.scrollIntoView({behavior:'smooth',block:'start'});
    byId('countSessionQuantity')?.focus();
    return true;
  }

  function updatePostAvailability(){
    const post=byId('countSessionPostBtn');
    if(!post)return;
    const boxes=[...document.querySelectorAll('#countSessionReviewList input[data-count-approve]')];
    post.disabled=boxes.some(box=>!box.checked);
  }

  function renderReview(){
    const summary=byId('countSessionReviewSummary');
    const list=byId('countSessionReviewList');
    if(!summary||!list)return;
    const items=Array.isArray(session?.items)?session.items:[];
    const variances=items.filter(x=>Math.abs(Number(x.variance_quantity||0))>1e-6);
    summary.innerHTML=`<strong>${items.length} items counted · ${variances.length} variance(s)</strong><br><span class="muted">Expected quantity is visible now because the physical count is complete. Inventory is still unchanged.</span>`;
    const nodes=items.map(item=>{
      const variance=Number(item.variance_quantity||0);
      const changed=Math.abs(variance)>1e-6;
      const row=document.createElement('div');
      row.className='listRow countReviewRow';
      const copy=document.createElement('div');
      copy.className='rowMain';
      copy.innerHTML=`<strong>${esc(item.item)}</strong><small>Expected ${num(item.expected_quantity,4)} ${esc(item.unit)} · counted ${num(item.counted_quantity,4)} ${esc(item.unit)} · variance <span class="${variance<0?'negative':variance>0?'positive':''}">${variance>0?'+':''}${num(variance,4)} ${esc(item.unit)}</span></small>`;
      row.appendChild(copy);
      if(changed){
        const label=document.createElement('label');
        label.className='checkLabel countApprove';
        const input=document.createElement('input');
        input.type='checkbox';
        input.dataset.countApprove=String(item.inventory_id);
        input.addEventListener('change',updatePostAvailability);
        label.append(input,document.createTextNode(' Approve'));
        row.appendChild(label);
      }else{
        const match=document.createElement('span');
        match.className='positive';
        match.textContent='MATCH';
        row.appendChild(match);
      }
      return row;
    });
    list.replaceChildren(...nodes);
    updatePostAvailability();
  }

  function render(next){
    session=next||null;
    const startPane=byId('countSessionStartPane');
    const activePane=byId('countSessionActivePane');
    const reviewPane=byId('countSessionReviewPane');
    const badge=byId('countSessionStatusBadge');
    startPane?.classList.toggle('hidden',Boolean(session));
    activePane?.classList.toggle('hidden',session?.status!=='in_progress');
    reviewPane?.classList.toggle('hidden',session?.status!=='review');

    if(!session){
      if(badge)badge.textContent='READY';
      syncScopeOptions();
      return;
    }

    if(badge)badge.textContent=session.status==='review'?'REVIEW':session.status==='posted'?'POSTED':'IN PROGRESS';
    if(session.status==='in_progress'){
      const p=session.progress||{total:0,counted:0,remaining:0};
      const percent=p.total?Math.round((Number(p.counted)/Number(p.total))*100):0;
      const out=byId('countSessionProgress');
      if(out)out.innerHTML=`<strong>${p.counted} of ${p.total} items counted</strong><br><span class="muted">${p.remaining} remaining · progress is saved after every item.</span>`;
      const fill=byId('countSessionProgressFill');
      if(fill)fill.style.width=`${Math.max(0,Math.min(100,percent))}%`;
      const review=byId('countSessionReviewBtn');
      if(review)review.disabled=Number(p.remaining)>0;
      fillItemPicker();
    }else if(session.status==='review'){
      renderReview();
    }
  }

  async function load(){
    if(!byId('guidedCountCard'))return null;
    try{
      const active=await api('/api/inventory/count-sessions/active');
      render(active);
      return active;
    }catch(error){
      message(error.message||'Inventory count session could not be loaded.','negative');
      return null;
    }
  }

  async function start(){
    const countType=byId('countSessionType')?.value||'full';
    const scopeType=countType==='full'?'all':byId('countSessionScopeType')?.value;
    const scopeValue=countType==='full'?'':byId('countSessionScopeValue')?.value;
    if(countType==='cycle'&&!scopeValue){
      message('Choose the Inventory category or storage area to count.','negative');
      return;
    }
    message('Starting count…');
    try{
      const created=await api('/api/inventory/count-sessions',{
        method:'POST',
        body:JSON.stringify({count_type:countType,scope_type:scopeType,scope_value:scopeValue})
      });
      render(created);
      message('Count started. Expected quantities stay hidden until Review.','positive');
    }catch(error){
      message(error.message||'Count could not be started.','negative');
      if(error.data?.active_session_id)await load();
    }
  }

  async function saveItem(){
    if(!session||session.status!=='in_progress')return;
    const item=activeSelectedItem();
    const input=byId('countSessionQuantity');
    const counted=Number(input?.value);
    if(!item||!Number.isFinite(counted)||counted<0){
      message('Enter the physical quantity counted for this item.','negative');
      return;
    }
    message('Saving count…');
    try{
      const saved=await api(`/api/inventory/count-sessions/${session.id}/items/${item.inventory_id}`,{
        method:'PUT',
        body:JSON.stringify({counted_quantity:counted})
      });
      render(saved);
      const next=saved.items?.find(x=>x.counted_quantity==null);
      if(next&&byId('countSessionItemPicker')){
        byId('countSessionItemPicker').value=String(next.inventory_id);
        renderCurrentItem();
      }
      message(next?'Saved. Continue with the next item.':'All items counted. Review is ready.','positive');
    }catch(error){message(error.message||'Count could not be saved.','negative')}
  }

  async function review(){
    if(!session)return;
    message('Preparing review…');
    try{
      const reviewed=await api(`/api/inventory/count-sessions/${session.id}/review`,{
        method:'POST',body:'{}'
      });
      render(reviewed);
      message('Review every variance before posting. Inventory has not changed yet.','positive');
    }catch(error){message(error.message||'Count is not ready for review.','negative')}
  }

  async function resume(){
    if(!session)return;
    message('Returning to counting…');
    try{
      const resumed=await api(`/api/inventory/count-sessions/${session.id}/resume`,{
        method:'POST',body:'{}'
      });
      render(resumed);
      message('Counting resumed. Expected quantities are hidden again.','positive');
    }catch(error){message(error.message||'Count could not be resumed.','negative')}
  }

  async function post(){
    if(!session||session.status!=='review')return;
    const approved=[...document.querySelectorAll('#countSessionReviewList input[data-count-approve]:checked')]
      .map(input=>Number(input.dataset.countApprove))
      .filter(Number.isInteger);
    const all=[...document.querySelectorAll('#countSessionReviewList input[data-count-approve]')];
    if(all.some(box=>!box.checked)){
      message('Approve every variance or return to counting before posting.','negative');
      return;
    }
    message('Posting approved variances…');
    try{
      const posted=await api(`/api/inventory/count-sessions/${session.id}/post`,{
        method:'POST',
        body:JSON.stringify({approved_inventory_ids:approved})
      });
      const adjustments=Array.isArray(posted.posted_adjustments)?posted.posted_adjustments.length:
        (posted.items||[]).filter(x=>x.posted_adjustment_id).length;
      render(null);
      if(typeof refreshInventory==='function')await refreshInventory();
      message(`Inventory count posted once. ${adjustments} stock adjustment(s) recorded in the audit trail.`,'positive');
    }catch(error){message(error.message||'Inventory count could not be posted.','negative')}
  }

  function wire(){
    if(wired||!byId('guidedCountCard'))return;
    wired=true;
    byId('countSessionType')?.addEventListener('change',syncScopeOptions);
    byId('countSessionScopeType')?.addEventListener('change',syncScopeOptions);
    byId('countSessionItemPicker')?.addEventListener('change',renderCurrentItem);
    byId('countSessionStart')?.addEventListener('click',start);
    byId('countSessionSaveItem')?.addEventListener('click',saveItem);
    byId('countSessionReviewBtn')?.addEventListener('click',review);
    byId('countSessionResumeBtn')?.addEventListener('click',resume);
    byId('countSessionPostBtn')?.addEventListener('click',post);
    byId('countSessionSaveExit')?.addEventListener('click',()=>{
      message('Progress is already saved. You can leave Inventory and resume this count later.','positive');
    });
    syncScopeOptions();
  }

  return{wire,load,render,getSession:()=>session,syncScopeOptions,selectItem};
}
