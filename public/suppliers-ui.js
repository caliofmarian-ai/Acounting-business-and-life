let supMe=null,supWorkspace=null,supInventory=[],supSupplierSection='Catalog';
const ptok=()=>localStorage.getItem('abl_token')||'';
const ph=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const pphp=v=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(v)||0);
const pnice=v=>String(v||'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
function pmanilaInput(value){if(!value)return'';const d=new Date(value);if(Number.isNaN(d.getTime()))return'';const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d);const get=t=>parts.find(x=>x.type===t)?.value||'';return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`}
function pmanilaIso(value){const raw=String(value||'').trim();if(!raw)return null;if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw))return null;const d=new Date(raw+':00+08:00');return Number.isNaN(d.getTime())?null:d.toISOString()}
async function papi(path,options={}){const headers={'Content-Type':'application/json',...(options.headers||{})};if(ptok())headers.Authorization=`Bearer ${ptok()}`;const r=await fetch(path,{...options,headers});const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error||`Request failed (${r.status})`);return b}
function ptoast(msg){const t=document.getElementById('roleToast');if(t){t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2800)}else alert(msg)}
function ensureSup(){const shell=document.getElementById('shell');if(!shell)return false;if(!document.getElementById('supWorkspace')){supWorkspace=document.createElement('section');supWorkspace.id='supWorkspace';supWorkspace.className='supWorkspace hidden';shell.querySelector('.topbar')?.insertAdjacentElement('afterend',supWorkspace)}else supWorkspace=document.getElementById('supWorkspace');if(!document.getElementById('supModalBg')){const b=document.createElement('div');b.id='supModalBg';b.className='supModalBg hidden';b.innerHTML='<section id="supModal" class="supModal"></section>';document.body.appendChild(b);b.onclick=e=>{if(e.target===b)closeSupModal()}}return true}
function hideSupBase(){document.querySelectorAll('#shell > .view').forEach(v=>v.classList.add('hidden'));for(const id of ['roleHub','ordersWorkspace','marketWorkspace','servicesWorkspace'])document.getElementById(id)?.classList.add('hidden');document.querySelector('.bottomNav')?.classList.add('hidden');document.getElementById('basketBar')?.classList.add('hidden')}
function supHeader(title,sub){return `<div class="supHeader"><button class="supBack" type="button">‹</button><div><h1>${ph(title)}</h1><p>${ph(sub)}</p></div></div>`}
function closeSupWorkspace(){supWorkspace?.classList.add('hidden');document.getElementById('supModalBg')?.classList.add('hidden');window.BusinessLifeShell?.showActiveWorkspace?.()}
function bindSupBack(fn=closeSupWorkspace){supWorkspace.querySelector('.supBack').onclick=fn}
function closeSupModal(){document.getElementById('supModalBg')?.classList.add('hidden')}
function openSupModal(html){document.getElementById('supModal').innerHTML=html;document.getElementById('supModalBg').classList.remove('hidden')}

async function openMerchantProcurement(){ensureSup();hideSupBase();supWorkspace.classList.remove('hidden');await renderMerchantProcurement()}
async function renderMerchantProcurement(){
  const [rels,pos,suggestions,parties,lots,returns,recalls]=await Promise.all([
    papi('/api/procurement/relationships'),
    papi('/api/procurement/orders'),
    papi('/api/procurement/reorder-suggestions').catch(()=>[]),
    papi('/api/procurement/supply-parties').catch(()=>[]),
    papi('/api/procurement/supply-lots').catch(()=>[]),
    papi('/api/procurement/returns').catch(()=>[]),
    papi('/api/procurement/recalls').catch(()=>({matches:[]}))
  ]);
  supWorkspace.innerHTML=supHeader('Suppliers & Restock','Relationships, purchase orders and inventory receiving')
    +`<section class="supHero"><h2>Order what you need, when you need it.</h2><p>A purchase order is a commitment, receiving is physical stock, an invoice is supplier evidence, and payment is real money movement.</p></section>`
    +suggestionsCard(suggestions)
    +supplyNetworkCard(parties,lots,returns,recalls)
    +`<section class="supCard"><h2>Connect a Supplier</h2><p>Invite a Supplier already using Business & Life. If your local supplier is not registered, add them above instead.</p><form id="supplierInvite" class="supForm"><label>Supplier email<input id="supplierEmail" type="email" required></label><label>Note<input id="supplierInviteNote" placeholder="Optional relationship note"></label><button>Send invitation</button><div id="supplierInviteMsg" class="fileNote"></div></form></section><div class="supGrid"><section class="supCard"><h2>Supplier relationships</h2><p>Only accepted Business & Life Suppliers can receive purchase orders in-app.</p><div class="supList">${rels.length?rels.map(relCard).join(''):'<div class="supEmpty">No Supplier relationships yet.</div>'}</div></section><section class="supCard"><h2>Purchase orders</h2><p>Accepted, preparing, delivery and receiving status.</p><div class="supList">${pos.length?pos.map(poCardMerchant).join(''):'<div class="supEmpty">No purchase orders yet.</div>'}</div></section></div>`;
  bindSupBack();
  bindMerchantProcurement(parties,lots,returns);
}
function supplyNetworkCard(parties,lots,returns=[],recalls={matches:[]}){
  const active=parties.filter(x=>x.status==='active');
  const recent=lots.slice(0,8);
  const activeRecalls=(recalls?.matches||[]).filter(x=>x.status==='active');
  return `<details class="supDetails supCard"><summary><span><strong>Local suppliers, lots, returns & repacking</strong><small>Advanced stock traceability for groceries, markets and bulk goods.</small></span><span class="supChevron">⌄</span></summary><div class="supDetailsBody"><div class="supInlineActions"><button type="button" class="supBtn secondary" id="supAddExternal">Add local supplier</button><button type="button" class="supBtn" id="supReceiveLot" ${active.length?'':'disabled'}>Receive stock</button></div>
  ${activeRecalls.length?`<div class="supAlert"><strong>Recall / quarantine attention</strong><small>${activeRecalls.length} matched lot${activeRecalls.length===1?'':'s'} need review. Aggregate Inventory is not yet fully lot-allocated for every sale.</small></div>`:''}
  <div class="supGrid"><div><h3>Supplier records</h3><div class="supList">${active.length?active.map(x=>`<div class="supRow"><div><strong>${ph(x.display_name)}</strong><small>${x.source_type==='connected'?'Connected Business & Life Supplier':'External/local supplier'}</small><div class="supMeta">${x.phone?`<span>${ph(x.phone)}</span>`:''}${x.location_note?`<span>${ph(x.location_note)}</span>`:''}</div></div><div class="supActions"><button type="button" class="supBtn secondary" data-party-terms="${x.id}">Terms</button>${x.source_type==='external'?`<button type="button" class="supBtn secondary" data-party-recall="${x.id}">Recall notice</button>`:''}</div></div>`).join(''):'<div class="supEmpty">Add the person or business you already buy from. They do not need an account.</div>'}</div></div>
  <div><h3>Recent stock lots</h3><div class="supList">${recent.length?recent.map(x=>`<div class="supRow"><div><strong>${ph(x.item_name)}</strong><small>${Number(x.quantity_remaining_base)} ${ph(x.base_unit)} remaining • ${ph(x.supplier_name||'Supplier')}</small><div class="supMeta"><span>${ph(pnice(x.handling_mode))}</span>${x.lot_state&&x.lot_state!=='available'?`<span class="pending">${ph(pnice(x.lot_state))}</span>`:''}${x.supplier_lot_code?`<span>Lot ${ph(x.supplier_lot_code)}</span>`:''}${x.expires_at?`<span>Expiry ${new Date(x.expires_at).toLocaleDateString()}</span>`:''}</div></div><div class="supActions">${Number(x.quantity_remaining_base)>0?`<button type="button" class="supBtn secondary" data-return-lot="${x.id}">Return</button><button type="button" class="supBtn secondary" data-repack-lot="${x.id}">Repack</button>`:''}</div></div>`).join(''):'<div class="supEmpty">No tracked lots yet. Receive a bulk or packaged item to start traceability.</div>'}</div></div></div>
  ${returns.length?`<h3>Recent returns</h3><div class="supList">${returns.slice(0,6).map(r=>`<div class="supRow"><div><strong>Return #${r.id} • ${ph(r.supplier_name||'Supplier')}</strong><small>${ph(pnice(r.status))} • expected credit ${pphp(r.expected_credit)}</small></div><div class="supActions">${(!r.supplier_account_id&&['requested','authorized'].includes(r.status))||r.status==='authorized'?`<button type="button" class="supBtn secondary" data-dispatch-return="${r.id}">Mark returned</button>`:''}${!r.supplier_account_id&&r.status==='returned'?`<button type="button" class="supBtn secondary" data-resolve-external-return="${r.id}">Record resolution</button>`:''}</div></div>`).join('')}</div>`:''}
  <p class="supCodeHelp">A PO is not an invoice. A confirmed Supplier credit is not cash received. Opening a case and selling original sealed units is break-pack, not repacking.</p></div></details>`;
}
async function addExternalSupplier(){
  openSupModal(`<h2>Add local supplier</h2><p class="supModalIntro">Use this for a market vendor, farmer, wholesaler or any supplier who is not yet on Business & Life.</p><form id="externalSupplierForm" class="supForm"><label>Supplier name<input id="extSupName" required placeholder="e.g. Maria Vegetable Stall"></label><div class="supTwo"><label>Contact person<input id="extSupContact"></label><label>Phone<input id="extSupPhone"></label></div><label>Email (optional)<input id="extSupEmail" type="email"></label><label>Location / market stall<input id="extSupLocation" placeholder="Public market, barangay, stall..."></label><label>Notes<textarea id="extSupNotes" rows="2"></textarea></label><div id="extSupMsg" class="fileNote"></div><div class="supTwo"><button type="button" class="supBtn secondary" id="extSupCancel">Cancel</button><button>Save supplier</button></div></form>`);
  document.getElementById('extSupCancel').onclick=closeSupModal;
  document.getElementById('externalSupplierForm').onsubmit=async e=>{
    e.preventDefault();
    try{
      await papi('/api/procurement/supply-parties',{method:'POST',body:JSON.stringify({
        display_name:document.getElementById('extSupName').value,
        contact_name:document.getElementById('extSupContact').value,
        phone:document.getElementById('extSupPhone').value,
        email:document.getElementById('extSupEmail').value,
        location_note:document.getElementById('extSupLocation').value,
        notes:document.getElementById('extSupNotes').value
      })});
      closeSupModal();ptoast('Local supplier saved.');await renderMerchantProcurement();
    }catch(err){document.getElementById('extSupMsg').textContent=err.message}
  };
}
async function receiveSupplyLot(parties){
  await loadInventory();
  const active=parties.filter(x=>x.status==='active');
  if(!active.length){ptoast('Add a local supplier first.');return}
  openSupModal(`<h2>Receive stock from supplier</h2><p class="supModalIntro">Record what physically arrived. Link to Inventory only when the unit matches the Inventory base unit.</p><form id="receiveLotForm" class="supForm"><label>Supplier<select id="lotParty">${active.map(x=>`<option value="${x.id}">${ph(x.display_name)}</option>`).join('')}</select></label><label>Item<input id="lotItem" required placeholder="Rice, cooking oil, canned drink..."></label><div class="supTwo"><label>Quantity<input id="lotQty" type="number" min="0.000001" step="0.000001" required></label><label>Stock unit<input id="lotUnit" required placeholder="kg, g, L, ml, unit"></label></div><div class="supTwo"><label>Total purchase cost ₱<input id="lotCost" type="number" min="0" step="0.01" value="0"></label><label>Handling<select id="lotHandling"><option value="bulk">Bulk</option><option value="sealed_resale">Sealed resale</option><option value="break_pack">Break-pack</option></select></label></div><label>Inventory link<select id="lotInventory"><option value="">Track as lot only</option>${supInventory.map(i=>`<option value="${i.id}">${ph(i.item)} — ${Number(i.quantity)} ${ph(i.base_unit||i.unit)}</option>`).join('')}</select></label><div class="supTwo"><label>Supplier lot / batch<input id="lotSupplierCode"></label><label>Expiry / best before<input id="lotExpiry" type="date"></label></div><label>Note<input id="lotNote"></label><div id="lotMsg" class="fileNote"></div><div class="supTwo"><button type="button" class="supBtn secondary" id="lotCancel">Cancel</button><button>Receive stock</button></div></form>`);
  document.getElementById('lotCancel').onclick=closeSupModal;
  document.getElementById('receiveLotForm').onsubmit=async e=>{
    e.preventDefault();
    try{
      const expiry=document.getElementById('lotExpiry').value;
      await papi('/api/procurement/supply-lots',{method:'POST',body:JSON.stringify({
        supply_party_id:Number(document.getElementById('lotParty').value),
        item_name:document.getElementById('lotItem').value,
        quantity_base:Number(document.getElementById('lotQty').value),
        base_unit:document.getElementById('lotUnit').value,
        total_cost:Number(document.getElementById('lotCost').value||0),
        handling_mode:document.getElementById('lotHandling').value,
        inventory_id:document.getElementById('lotInventory').value?Number(document.getElementById('lotInventory').value):null,
        supplier_lot_code:document.getElementById('lotSupplierCode').value,
        expires_at:expiry?expiry+'T23:59:59+08:00':null,
        note:document.getElementById('lotNote').value
      })});
      closeSupModal();ptoast('Supplier stock received and lot recorded.');await renderMerchantProcurement();
    }catch(err){document.getElementById('lotMsg').textContent=err.message}
  };
}
async function repackSupplyLot(id){
  const [lots]=await Promise.all([papi('/api/procurement/supply-lots'),loadInventory()]);
  const lot=lots.find(x=>Number(x.id)===Number(id));
  if(!lot){ptoast('Lot is no longer available.');return}
  const outputOptions=supInventory.filter(i=>Number(i.id)!==Number(lot.inventory_id));
  openSupModal(`<h2>Repack ${ph(lot.item_name)}</h2><p class="supModalIntro">Source available: ${Number(lot.quantity_remaining_base)} ${ph(lot.base_unit)}. The output keeps the same base unit; packaging cost is added to its cost.</p><form id="repackForm" class="supForm"><label>Output item<input id="repackName" required placeholder="Rice 1 kg bag"></label><div class="supTwo"><label>Input used (${ph(lot.base_unit)})<input id="repackInput" type="number" min="0.000001" max="${Number(lot.quantity_remaining_base)}" step="0.000001" required></label><label>Waste (${ph(lot.base_unit)})<input id="repackWaste" type="number" min="0" step="0.000001" value="0"></label></div><div class="supTwo"><label>Size per pack (${ph(lot.base_unit)})<input id="repackSize" type="number" min="0.000001" step="0.000001" required></label><label>Number of packs<input id="repackCount" type="number" min="0.000001" step="0.000001" required></label></div><div class="supTwo"><label>Pack name<input id="repackUnit" value="bag"></label><label>Packaging cost / pack ₱<input id="repackPackaging" type="number" min="0" step="0.01" value="0"></label></div><label>Output Inventory<select id="repackInventory"><option value="">Lot only</option>${outputOptions.map(i=>`<option value="${i.id}">${ph(i.item)} — ${ph(i.base_unit||i.unit)}</option>`).join('')}</select></label><p class="supCodeHelp">For this first V2 version, a repacked output uses a different Inventory item from its bulk source. Ordinary case opening should use break-pack instead.</p><label>Note<input id="repackNote"></label><div id="repackMsg" class="fileNote"></div><div class="supTwo"><button type="button" class="supBtn secondary" id="repackCancel">Cancel</button><button>Create repacked lot</button></div></form>`);
  document.getElementById('repackCancel').onclick=closeSupModal;
  document.getElementById('repackForm').onsubmit=async e=>{
    e.preventDefault();
    try{
      await papi(`/api/procurement/supply-lots/${id}/repack`,{method:'POST',body:JSON.stringify({
        output_item_name:document.getElementById('repackName').value,
        input_quantity_base:Number(document.getElementById('repackInput').value),
        waste_quantity_base:Number(document.getElementById('repackWaste').value||0),
        package_size_base:Number(document.getElementById('repackSize').value),
        output_packages:Number(document.getElementById('repackCount').value),
        package_unit_name:document.getElementById('repackUnit').value,
        packaging_cost_per_output:Number(document.getElementById('repackPackaging').value||0),
        output_inventory_id:document.getElementById('repackInventory').value?Number(document.getElementById('repackInventory').value):null,
        note:document.getElementById('repackNote').value
      })});
      closeSupModal();ptoast('Repacked lot created with source traceability.');await renderMerchantProcurement();
    }catch(err){document.getElementById('repackMsg').textContent=err.message}
  };
}

function suggestionsCard(rows){if(!rows.length)return `<section class="supCard"><h2>Reorder suggestions</h2><p>No current inventory item is below its reorder level.</p></section>`;return `<section class="supCard"><h2>Reorder suggestions</h2><p>Based on current stock/reorder levels. Nothing is sent automatically.</p><div class="supList">${rows.map(x=>`<div class="supRow"><div><strong>${ph(x.item)}</strong><small>${Number(x.quantity)} ${ph(x.unit)} on hand • reorder at ${Number(x.reorder_level)}</small>${x.catalog_item_id?`<div class="supMeta"><span class="ok">${ph(x.supplier_name)}</span><span>${ph(x.product_name)}</span><span>${x.suggested_packs} ${ph(x.unit_name)}</span><span>${pphp(Number(x.price_per_pack)*Number(x.suggested_packs||0))}</span></div>`:'<div class="supMeta"><span class="pending">No Supplier item linked</span></div>'}</div></div>`).join('')}</div></section>`}
function relCard(r){return `<div class="supRow"><div><strong>${ph(r.supplier_name||r.display_name)}</strong><small>${ph(r.description||'Local Supplier')}</small><div class="supMeta"><span class="${r.state==='accepted'?'ok':'pending'}">${ph(pnice(r.state))}</span>${r.normal_lead_days!=null?`<span>~${r.normal_lead_days}d lead</span>`:''}${r.delivery_available?'<span>Delivery</span>':'<span>Pickup</span>'}</div></div><div class="supActions">${r.state==='accepted'?`<button class="supBtn secondary" data-connected-terms="${r.supplier_account_id}">Terms</button><button class="supBtn" data-open-catalog="${r.supplier_account_id}">Catalog</button>`:''}</div></div>`}
function poCardMerchant(p){const open=!['received','cancelled','rejected'].includes(p.status);return `<div class="supRow"><div><strong>${ph(p.po_number||`PO ${p.id}`)} • ${ph(p.supplier_name)}</strong><small>${ph(pnice(p.status))} • ${pphp(p.expected_total)}</small><div class="supMeta"><span>${ph(pnice(p.fulfilment_mode))}</span><span class="${p.payment_status==='paid'?'ok':'pending'}">${ph(pnice(p.payment_status))}</span>${p.supplier_ready_at?`<span>Ready ${new Date(p.supplier_ready_at).toLocaleString()}</span>`:''}</div></div><div class="supActions">${open?`<button class="supBtn secondary" data-po-view="${p.id}">View</button>`:''}${['delivered','partially_received','accepted','ready_for_pickup'].includes(p.status)?`<button class="supBtn" data-po-receive="${p.id}">Receive</button>`:''}${Number(p.paid_amount)<Number(p.expected_total)&&!['cancelled','rejected'].includes(p.status)?`<button class="supBtn warm" data-po-pay="${p.id}">Pay</button>`:''}</div></div>`}
function bindMerchantProcurement(parties=[],lots=[],returns=[]){
  document.getElementById('supplierInvite').onsubmit=async e=>{
    e.preventDefault();const msg=document.getElementById('supplierInviteMsg');
    try{
      await papi('/api/procurement/relationships/invite',{method:'POST',body:JSON.stringify({
        supplier_email:document.getElementById('supplierEmail').value,
        note:document.getElementById('supplierInviteNote').value
      })});
      ptoast('Supplier invitation sent.');await renderMerchantProcurement();
    }catch(err){msg.textContent=err.message}
  };
  document.getElementById('supAddExternal')?.addEventListener('click',()=>addExternalSupplier());
  document.getElementById('supReceiveLot')?.addEventListener('click',()=>receiveSupplyLot(parties));
  supWorkspace.querySelectorAll('[data-repack-lot]').forEach(b=>b.onclick=()=>repackSupplyLot(Number(b.dataset.repackLot)));
  supWorkspace.querySelectorAll('[data-return-lot]').forEach(b=>b.onclick=()=>requestReturnLot(Number(b.dataset.returnLot)));
  supWorkspace.querySelectorAll('[data-party-terms]').forEach(b=>b.onclick=()=>editExternalTerms(Number(b.dataset.partyTerms)));
  supWorkspace.querySelectorAll('[data-party-recall]').forEach(b=>b.onclick=()=>recordExternalRecall(Number(b.dataset.partyRecall)));
  supWorkspace.querySelectorAll('[data-connected-terms]').forEach(b=>b.onclick=()=>viewConnectedTerms(Number(b.dataset.connectedTerms)));
  supWorkspace.querySelectorAll('[data-dispatch-return]').forEach(b=>b.onclick=()=>dispatchReturn(Number(b.dataset.dispatchReturn)));
  supWorkspace.querySelectorAll('[data-resolve-external-return]').forEach(b=>b.onclick=()=>resolveExternalReturn(Number(b.dataset.resolveExternalReturn)));
  supWorkspace.querySelectorAll('[data-open-catalog]').forEach(b=>b.onclick=()=>openSupplierCatalog(Number(b.dataset.openCatalog)));
  supWorkspace.querySelectorAll('[data-po-view]').forEach(b=>b.onclick=()=>viewPo(Number(b.dataset.poView),'merchant'));
  supWorkspace.querySelectorAll('[data-po-receive]').forEach(b=>b.onclick=()=>receivePo(Number(b.dataset.poReceive)));
  supWorkspace.querySelectorAll('[data-po-pay]').forEach(b=>b.onclick=()=>payPo(Number(b.dataset.poPay)));
}
async function loadInventory(){try{const r=await papi('/api/inventory');supInventory=Array.isArray(r)?r:(r.inventory||[])}catch{supInventory=[]}}
function supplierPriceLine(item){
  const tiers=(item.price_tiers||[]).map(x=>`${Number(x.minimum_quantity)}+ @ ${pphp(x.price_per_pack)}`).join(' • ');
  return `${pphp(item.price_per_pack)} / ${ph(item.unit_name)} • ${Number(item.base_units_per_pack)} ${ph(item.base_unit)}${tiers?` • Volume: ${ph(tiers)}`:''}`;
}
async function openSupplierCatalog(id){const [data]=await Promise.all([papi(`/api/procurement/suppliers/${id}/catalog`),loadInventory()]);const opts=x=>`<option value="">No inventory link</option>${supInventory.map(i=>`<option value="${i.id}" ${Number(x?.link?.legacy_inventory_id)===Number(i.id)?'selected':''}>${ph(i.item)} (${Number(i.quantity)} ${ph(i.unit)})</option>`).join('')}`;openSupModal(`<h2>${ph(data.supplier.supplier_name||data.supplier.display_name)} catalog</h2><form id="poCreate" class="supForm"><div class="supProductPicker">${data.items.map(i=>`<div class="supPick"><div><strong>${ph(i.product_name)}</strong><small>${supplierPriceLine(i)}</small><label style="margin-top:5px">Inventory mapping<select data-map-item="${i.id}">${opts(i)}</select></label></div><input type="number" min="0" step="1" value="0" data-po-item="${i.id}" aria-label="Packs"></div>`).join('')}</div><div class="supTwo"><label>Fulfilment<select id="poMode"><option value="delivery">Supplier delivery</option><option value="pickup">Pickup</option></select></label><label>Delivery fee ₱<input id="poDeliveryFee" type="number" min="0" step="0.01" value="0"></label></div><label>Requested date<input id="poRequested" type="date"></label><label>Note<textarea id="poNote" rows="2"></textarea></label><div id="poMsg" class="fileNote"></div><div class="supTwo"><button type="button" class="supBtn secondary" id="poCancel">Cancel</button><button>Create PO</button></div></form>`);document.getElementById('poCancel').onclick=closeSupModal;document.getElementById('poCreate').onsubmit=async e=>{e.preventDefault();const items=[...e.currentTarget.querySelectorAll('[data-po-item]')].map(x=>({catalog_item_id:Number(x.dataset.poItem),packs:Number(x.value)})).filter(x=>x.packs>0);if(!items.length){document.getElementById('poMsg').textContent='Choose at least one item.';return}try{for(const s of e.currentTarget.querySelectorAll('[data-map-item]')){if(s.value)await papi(`/api/procurement/catalog/${s.dataset.mapItem}/link`,{method:'PUT',body:JSON.stringify({legacy_inventory_id:Number(s.value)})})}await papi('/api/procurement/orders',{method:'POST',body:JSON.stringify({supplier_account_id:id,items,fulfilment_mode:document.getElementById('poMode').value,delivery_fee:Number(document.getElementById('poDeliveryFee').value),requested_date:document.getElementById('poRequested').value||null,merchant_note:document.getElementById('poNote').value})});closeSupModal();ptoast('Purchase order sent.');await renderMerchantProcurement()}catch(err){document.getElementById('poMsg').textContent=err.message}}}
async function viewPo(id,side){const p=await papi(`/api/procurement/orders/${id}`);openSupModal(`<h2>${ph(p.po_number)} • ${ph(pnice(p.status))}</h2><div class="supList">${p.items.map(i=>`<div class="supRow"><div><strong>${ph(i.name_snapshot)}</strong><small>${Number(i.ordered_packs)} ${ph(i.unit_name_snapshot)} ordered • ${pphp(i.price_per_pack_snapshot)} each</small><div class="supMeta"><span>Confirmed ${Number(i.confirmed_packs??i.ordered_packs)}</span><span>Received ${Number(i.received_packs)}</span>${i.legacy_inventory_name?`<span class="ok">→ ${ph(i.legacy_inventory_name)}</span>`:''}</div></div></div>`).join('')}</div><div class="supMeta" style="margin:12px 0"><span>${pphp(p.expected_total)} total</span><span>${ph(pnice(p.payment_status))}</span></div><button class="supBtn secondary" id="poClose">Close</button>`);document.getElementById('poClose').onclick=closeSupModal}
async function receivePo(id){const p=await papi(`/api/procurement/orders/${id}`);openSupModal(`<h2>Receive ${ph(p.po_number)}</h2><form id="receiveForm" class="supForm"><div class="supProductPicker">${p.items.map(i=>{const remain=Number(i.confirmed_packs??i.ordered_packs)-Number(i.received_packs);return `<div class="supPick"><div><strong>${ph(i.name_snapshot)}</strong><small>Remaining ${remain} ${ph(i.unit_name_snapshot)}${i.legacy_inventory_name?` → ${ph(i.legacy_inventory_name)}`:' • no inventory mapping'}</small></div><input data-receive-item="${i.id}" type="number" min="0" max="${remain}" step="0.01" value="${remain}"></div>`}).join('')}</div><label>Receiving note<input id="receiveNote"></label><div id="receiveMsg" class="fileNote"></div><div class="supTwo"><button type="button" class="supBtn secondary" id="receiveCancel">Cancel</button><button>Confirm receipt</button></div></form>`);document.getElementById('receiveCancel').onclick=closeSupModal;document.getElementById('receiveForm').onsubmit=async e=>{e.preventDefault();const items=[...e.currentTarget.querySelectorAll('[data-receive-item]')].map(x=>({item_id:Number(x.dataset.receiveItem),received_packs:Number(x.value)})).filter(x=>x.received_packs>0);try{await papi(`/api/procurement/orders/${id}/receive`,{method:'POST',body:JSON.stringify({items,note:document.getElementById('receiveNote').value})});closeSupModal();ptoast('Goods received; linked inventory updated once.');await renderMerchantProcurement()}catch(err){document.getElementById('receiveMsg').textContent=err.message}}}
async function payPo(id){const p=await papi(`/api/procurement/orders/${id}`),due=Math.max(0,Number(p.expected_total)-Number(p.paid_amount));openSupModal(`<h2>Record Supplier payment</h2><form id="payPoForm" class="supForm"><label>Amount ₱<input id="payPoAmount" type="number" min="0.01" step="0.01" value="${due.toFixed(2)}" required></label><label>Paid from<select id="payPoAccount"><option value="cash">Cash</option><option value="gcash">GCash</option><option value="bank">Bank</option><option value="other">Other</option></select></label><div id="payPoMsg" class="fileNote"></div><div class="supTwo"><button type="button" class="supBtn secondary" id="payPoCancel">Cancel</button><button>Confirm real payment</button></div></form>`);document.getElementById('payPoCancel').onclick=closeSupModal;document.getElementById('payPoForm').onsubmit=async e=>{e.preventDefault();try{await papi(`/api/procurement/orders/${id}/payment`,{method:'POST',body:JSON.stringify({amount:Number(document.getElementById('payPoAmount').value),account:document.getElementById('payPoAccount').value})});closeSupModal();ptoast('Supplier payment recorded.');await renderMerchantProcurement()}catch(err){document.getElementById('payPoMsg').textContent=err.message}}}

const SUPPLIER_SECTION_META={
  Catalog:['My Catalog','Products, pricing, pack sizes and Supplier profile'],
  Procurement:['Incoming Orders','Merchant relationships and purchase orders awaiting response'],
  ETA:['ETA & Readiness','Accepted orders, preparation and promised ready times'],
  Fulfilment:['Fulfilment','Pickup and delivery status through Merchant receipt']
};
const SUPPLIER_PROCUREMENT_STATES=new Set(['sent','supplier_received']);
const SUPPLIER_ETA_STATES=new Set(['accepted','partially_accepted','preparing']);
const SUPPLIER_FULFILMENT_STATES=new Set(['ready_for_pickup','out_for_delivery','delivered','partially_received','received']);
const SUPPLIER_ACTIVITY_LABELS={
  producer:'Producer / grower',
  processor:'Processor',
  manufacturer:'Manufacturer',
  packer:'Packer',
  repacker:'Repacker',
  trader:'Trader / brand owner',
  importer:'Importer',
  exporter:'Exporter',
  distributor:'Distributor',
  wholesaler:'Wholesaler',
  retailer:'Retailer',
  service_provider:'Service supplier'
};
function supplierActivitiesPanel(state){
  const selected=new Set((state?.activities||[]).map(x=>x.activity_code||x));
  return `<details class="supDetails supCard"><summary><span><strong>What does this business do?</strong><small>Choose only the activities that apply. This does not claim a government licence.</small></span><span class="supChevron">⌄</span></summary><div class="supDetailsBody"><form id="supplierActivities" class="supForm"><div class="supCheckGrid">${Object.entries(SUPPLIER_ACTIVITY_LABELS).map(([code,label])=>`<label class="supCheck"><input type="checkbox" value="${code}" ${selected.has(code)?'checked':''}><span>${ph(label)}</span></label>`).join('')}</div><button>Save business activities</button><div id="supplierActivitiesMsg" class="fileNote"></div></form></div></details>`;
}
function parseTierText(value){
  return String(value||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map((line,index)=>{
    const [minimum,price,...label]=line.split('|').map(x=>x.trim());
    if(!minimum||price==null||!Number.isFinite(Number(minimum))||Number(minimum)<=0||!Number.isFinite(Number(price))||Number(price)<0)throw new Error(`Price tier line ${index+1} must be: minimum | price | optional label`);
    return{minimum_quantity:Number(minimum),price_per_pack:Number(price),label:label.join(' | ')};
  });
}
function parsePackageText(value){
  return String(value||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map((line,index)=>{
    const [name,base,quantity,saleable='yes']=line.split('|').map(x=>x.trim());
    if(!name||!base||!Number.isFinite(Number(quantity))||Number(quantity)<=0)throw new Error(`Package line ${index+1} must be: package | base unit | base quantity`);
    return{level_name:name,base_unit:base,base_units_per_level:Number(quantity),saleable:!['no','false','0'].includes(saleable.toLowerCase()),sort_order:index};
  });
}
async function openCatalogV2(id){
  const data=await papi(`/api/supplier/catalog/${id}/v2`);
  const tierText=(data.price_tiers||[]).map(x=>`${Number(x.minimum_quantity)} | ${Number(x.price_per_pack)} | ${x.label||''}`).join('\n');
  const packageText=(data.package_levels||[]).map(x=>`${x.level_name} | ${x.base_unit} | ${Number(x.base_units_per_level)} | ${x.saleable?'yes':'no'}`).join('\n');
  openSupModal(`<h2>Packaging & B2B pricing</h2><p class="supModalIntro">${ph(data.product_name)}. Keep the normal pack price simple; add advanced handling or volume prices only when needed.</p><form id="catalogV2Form" class="supForm"><label>How is this product handled?<select id="catHandling"><option value="sealed_resale" ${data.handling_mode==='sealed_resale'?'selected':''}>Sealed resale</option><option value="break_pack" ${data.handling_mode==='break_pack'?'selected':''}>Break-pack: open outer case, keep inner units sealed</option><option value="bulk" ${data.handling_mode==='bulk'?'selected':''}>Bulk</option><option value="repacked" ${data.handling_mode==='repacked'?'selected':''}>Repacked</option><option value="produced" ${data.handling_mode==='produced'?'selected':''}>Produced / manufactured</option></select></label><details class="supNestedDetails"><summary>Volume pricing</summary><label>One tier per line: minimum packs | ₱ price / pack | label<textarea id="catTiers" rows="5" placeholder="6 | 28 | 6+ packs\n25 | 26 | 25+ packs">${ph(tierText)}</textarea></label></details><details class="supNestedDetails"><summary>Package hierarchy</summary><label>One level per line: package | base unit | base quantity | saleable<textarea id="catPackages" rows="5" placeholder="case | bottle | 24 | yes\nbox | pack | 12 | yes">${ph(packageText)}</textarea></label><p class="supCodeHelp">Example: one case contains 24 bottles. Opening the case does not become repacking if each bottle stays in its original sealed pack.</p></details><div id="catalogV2Msg" class="fileNote"></div><div class="supTwo"><button type="button" class="supBtn secondary" id="catalogV2Cancel">Cancel</button><button>Save details</button></div></form>`);
  document.getElementById('catalogV2Cancel').onclick=closeSupModal;
  document.getElementById('catalogV2Form').onsubmit=async e=>{
    e.preventDefault();
    try{
      const price_tiers=parseTierText(document.getElementById('catTiers').value);
      const package_levels=parsePackageText(document.getElementById('catPackages').value);
      await papi(`/api/supplier/catalog/${id}/v2`,{method:'PUT',body:JSON.stringify({
        handling_mode:document.getElementById('catHandling').value,
        price_tiers,package_levels
      })});
      closeSupModal();ptoast('Packaging and B2B pricing saved.');await renderSupplierWorkspace('Catalog');
    }catch(err){document.getElementById('catalogV2Msg').textContent=err.message}
  };
}

function supplierCatalogPanel(me,activityState){
  const p=me.profile||{};
  return `<section class="supCard"><h2>Supplier profile</h2><form id="supplierProfile" class="supForm"><label>Supplier/business name<input id="spName" value="${ph(p.supplier_name||supMe.account.display_name)}"></label><label>Description<textarea id="spDesc" rows="3">${ph(p.description||'')}</textarea></label><div class="supTwo"><label>Service area<input id="spArea" value="${ph(p.service_area||'')}"></label><label>Normal lead days<input id="spLead" type="number" min="0" value="${p.normal_lead_days??1}"></label></div><label class="toggleBox"><input id="spDelivery" type="checkbox" ${p.delivery_available?'checked':''}> I deliver to Merchant</label><button>Save profile</button></form></section>`
    +supplierActivitiesPanel(activityState)
    +`<section class="supCard"><h2>My catalog</h2><p>Start with product, pack and price. Packaging rules and volume prices stay under Details.</p><form id="catalogAdd" class="supForm"><label>Product<input id="catName" required></label><div class="supTwo"><label>Pack name<input id="catPack" value="pack"></label><label>Price / pack ₱<input id="catPrice" type="number" min="0" step="0.01" required></label></div><div class="supTwo"><label>Base unit<input id="catBase" value="unit"></label><label>Units / pack<input id="catUnits" type="number" min="0.0001" step="0.0001" value="1"></label></div><button>Add catalog item</button></form><div class="supList" style="margin-top:10px">${me.catalog.length?me.catalog.map(item=>`<div class="supRow"><div><strong>${ph(item.product_name)}</strong><small>${pphp(item.price_per_pack)} / ${ph(item.unit_name)} • ${Number(item.base_units_per_pack)} ${ph(item.base_unit)}</small><div class="supMeta"><span class="${item.availability_status==='available'?'ok':'pending'}">${ph(pnice(item.availability_status))}</span><span>${ph(pnice(item.handling_mode||'sealed_resale'))}</span>${(item.price_tiers||[]).length?`<span>${item.price_tiers.length} volume price${item.price_tiers.length===1?'':'s'}</span>`:''}</div></div><div class="supActions"><button type="button" class="supBtn secondary" data-cat-v2="${item.id}">Details</button></div></div>`).join(''):'<div class="supEmpty">Catalog is empty.</div>'}</div></section>`;
}
function supplierRelationshipsPanel(rels){
  return `<section class="supCard"><h2>Merchant relationships</h2><p>Only accepted Merchant relationships can exchange procurement orders.</p><div class="supList">${rels.length?rels.map(r=>`<div class="supRow"><div><strong>${ph(r.business_name)}</strong><small>${ph(pnice(r.state))}</small></div><div class="supActions">${['invited','pending'].includes(r.state)?`<button class="supBtn" data-rel-accept="${r.business_id}">Accept</button><button class="supBtn secondary" data-rel-decline="${r.business_id}">Decline</button>`:''}</div></div>`).join(''):'<div class="supEmpty">No Merchant invitations yet.</div>'}</div></section>`;
}
function supplierOrdersPanel(pos,section){
  const source=section==='Procurement'?SUPPLIER_PROCUREMENT_STATES:section==='ETA'?SUPPLIER_ETA_STATES:SUPPLIER_FULFILMENT_STATES;
  const rows=pos.filter(p=>source.has(p.status));
  const copy=section==='Procurement'
    ?['Incoming purchase orders','Respond before the Merchant relies on availability or price.','No purchase orders are waiting for your response.']
    :section==='ETA'
      ?['ETA & readiness','Confirm preparation progress and make the promised ready time visible.','No accepted orders are waiting for preparation or ETA updates.']
      :['Fulfilment','Track ready-for-pickup, supplier delivery and Merchant receipt states.','No purchase orders are currently in fulfilment.'];
  return `<section class="supCard"><h2>${copy[0]}</h2><p>${copy[1]}</p><div class="supList">${rows.length?rows.map(poCardSupplier).join(''):`<div class="supEmpty">${copy[2]}</div>`}</div></section>`;
}
async function openSupplierWorkspace(section='Catalog'){
  supSupplierSection=SUPPLIER_SECTION_META[section]?section:'Catalog';
  ensureSup();hideSupBase();supWorkspace.classList.remove('hidden');
  await renderSupplierWorkspace(supSupplierSection);
}
async function renderSupplierWorkspace(section=supSupplierSection){
  const normalized=SUPPLIER_SECTION_META[section]?section:'Catalog';
  supSupplierSection=normalized;
  const [me,rels,pos,activityState]=await Promise.all([
    papi('/api/supplier/me'),
    papi('/api/procurement/relationships'),
    papi('/api/procurement/orders'),
    normalized==='Catalog'?papi('/api/supplier/v2/activities').catch(()=>({activities:[]})):Promise.resolve({activities:[]})
  ]);
  const meta=SUPPLIER_SECTION_META[normalized];
  let body='';
  if(normalized==='Catalog')body=supplierCatalogPanel(me,activityState);
  else if(normalized==='Procurement')body=supplierRelationshipsPanel(rels)+supplierOrdersPanel(pos,'Procurement');
  else body=supplierOrdersPanel(pos,normalized);
  supWorkspace.innerHTML=supHeader(meta[0],meta[1])+`<section class="supHero"><h2>Supply local businesses from one account.</h2><p>Catalog, order response, ETA and fulfilment stay separate so Merchants can rely on the right status.</p></section><div data-bl-pricing="supplier"></div>`+body;
  bindSupBack();bindSupplierWorkspace();
}
function poCardSupplier(p){
  let acts='';
  if(['sent','supplier_received'].includes(p.status))acts+=`<button class="supBtn" data-sup-respond="${p.id}">Respond</button>`;
  if(['accepted','partially_accepted'].includes(p.status))acts+=`<button class="supBtn" data-sup-respond="${p.id}">Update ETA</button><button class="supBtn secondary" data-sup-status="${p.id}" data-status="preparing">Preparing</button>`;
  if(p.status==='preparing')acts+=`<button class="supBtn" data-sup-status="${p.id}" data-status="${p.fulfilment_mode==='pickup'?'ready_for_pickup':'out_for_delivery'}">${p.fulfilment_mode==='pickup'?'Ready':'Dispatch'}</button>`;
  if(p.status==='out_for_delivery')acts+=`<button class="supBtn" data-sup-status="${p.id}" data-status="delivered">Delivered</button>`;
  const timing=[];
  if(p.supplier_ready_at)timing.push('Ready '+new Date(p.supplier_ready_at).toLocaleString());
  if(p.supplier_delivery_eta)timing.push('ETA '+new Date(p.supplier_delivery_eta).toLocaleString());
  return `<div class="supRow"><div><strong>${ph(p.po_number)} • ${ph(p.business_name)}</strong><small>${pphp(p.expected_total)} • ${ph(pnice(p.status))}</small><div class="supMeta"><span>${ph(pnice(p.fulfilment_mode))}</span>${timing.map(x=>`<span>${ph(x)}</span>`).join('')}</div></div><div class="supActions"><button class="supBtn secondary" data-sup-view="${p.id}">View</button>${acts}</div></div>`;
}
function bindSupplierWorkspace(){
  const profileForm=document.getElementById('supplierProfile');
  const catalogForm=document.getElementById('catalogAdd');
  if(profileForm)profileForm.onsubmit=async e=>{e.preventDefault();try{await papi('/api/supplier/me',{method:'PUT',body:JSON.stringify({supplier_name:document.getElementById('spName').value,description:document.getElementById('spDesc').value,service_area:document.getElementById('spArea').value,normal_lead_days:Number(document.getElementById('spLead').value),delivery_available:document.getElementById('spDelivery').checked})});ptoast('Supplier profile saved.');await renderSupplierWorkspace('Catalog')}catch(err){ptoast(err.message)}};
  if(catalogForm)catalogForm.onsubmit=async e=>{e.preventDefault();try{await papi('/api/supplier/catalog',{method:'POST',body:JSON.stringify({product_name:document.getElementById('catName').value,unit_name:document.getElementById('catPack').value,price_per_pack:Number(document.getElementById('catPrice').value),base_unit:document.getElementById('catBase').value,base_units_per_pack:Number(document.getElementById('catUnits').value)})});ptoast('Catalog item added.');await renderSupplierWorkspace('Catalog')}catch(err){ptoast(err.message)}};
  const activitiesForm=document.getElementById('supplierActivities');
  if(activitiesForm)activitiesForm.onsubmit=async e=>{e.preventDefault();const activities=[...e.currentTarget.querySelectorAll('input[type="checkbox"]:checked')].map(x=>x.value);try{await papi('/api/supplier/v2/activities',{method:'PUT',body:JSON.stringify({activities})});ptoast('Business activities saved.');await renderSupplierWorkspace('Catalog')}catch(err){document.getElementById('supplierActivitiesMsg').textContent=err.message}};
  supWorkspace.querySelectorAll('[data-cat-v2]').forEach(b=>b.onclick=()=>openCatalogV2(Number(b.dataset.catV2)));
  supWorkspace.querySelectorAll('[data-rel-accept]').forEach(b=>b.onclick=()=>respondRel(Number(b.dataset.relAccept),true));
  supWorkspace.querySelectorAll('[data-rel-decline]').forEach(b=>b.onclick=()=>respondRel(Number(b.dataset.relDecline),false));
  supWorkspace.querySelectorAll('[data-sup-view]').forEach(b=>b.onclick=()=>viewPo(Number(b.dataset.supView),'supplier'));
  supWorkspace.querySelectorAll('[data-sup-respond]').forEach(b=>b.onclick=()=>supplierRespondPo(Number(b.dataset.supRespond)));
  supWorkspace.querySelectorAll('[data-sup-status]').forEach(b=>b.onclick=()=>setSupplierStatus(Number(b.dataset.supStatus),b.dataset.status));
}
async function respondRel(id,accept){try{await papi(`/api/supplier/relationships/${id}/respond`,{method:'POST',body:JSON.stringify({accept})});ptoast(accept?'Merchant relationship accepted.':'Invitation declined.');await renderSupplierWorkspace('Procurement')}catch(e){ptoast(e.message)}}
async function supplierRespondPo(id){const p=await papi(`/api/procurement/orders/${id}`);openSupModal(`<h2>Respond to ${ph(p.po_number)}</h2><form id="supRespondPo" class="supForm"><div class="supProductPicker">${p.items.map(i=>`<div class="supPick"><div><strong>${ph(i.name_snapshot)}</strong><small>Ordered ${Number(i.ordered_packs)} ${ph(i.unit_name_snapshot)}</small></div><div><input data-confirm-item="${i.id}" type="number" min="0" max="${i.ordered_packs}" step="0.01" value="${i.confirmed_packs??i.ordered_packs}"><input data-price-item="${i.id}" type="number" min="0" step="0.01" value="${i.confirmed_price_per_pack??i.price_per_pack_snapshot}"></div></div>`).join('')}</div><div class="supTwo"><label>Ready date/time<input id="supReady" type="datetime-local" value="${ph(pmanilaInput(p.supplier_ready_at))}"></label><label>Delivery ETA<input id="supDeliveryEta" type="datetime-local" value="${ph(pmanilaInput(p.supplier_delivery_eta))}"></label></div><label>Supplier note<textarea id="supPoNote" rows="2">${ph(p.supplier_note||'')}</textarea></label><div id="supPoMsg" class="fileNote"></div><div class="supTwo"><button type="button" class="supBtn secondary" id="supPoReject">Reject</button><button>Accept / confirm</button></div></form>`);document.getElementById('supPoReject').onclick=async()=>{try{await papi(`/api/supplier/orders/${id}/respond`,{method:'POST',body:JSON.stringify({reject:true,supplier_note:document.getElementById('supPoNote').value})});closeSupModal();await renderSupplierWorkspace('Procurement')}catch(e){document.getElementById('supPoMsg').textContent=e.message}};document.getElementById('supRespondPo').onsubmit=async e=>{e.preventDefault();const items=p.items.map(i=>({item_id:i.id,confirmed_packs:Number(e.currentTarget.querySelector(`[data-confirm-item="${i.id}"]`).value),confirmed_price_per_pack:Number(e.currentTarget.querySelector(`[data-price-item="${i.id}"]`).value)}));try{await papi(`/api/supplier/orders/${id}/respond`,{method:'POST',body:JSON.stringify({items,supplier_ready_at:pmanilaIso(document.getElementById('supReady').value),supplier_delivery_eta:pmanilaIso(document.getElementById('supDeliveryEta').value),supplier_note:document.getElementById('supPoNote').value})});closeSupModal();ptoast('Purchase order confirmed.');await renderSupplierWorkspace('ETA')}catch(err){document.getElementById('supPoMsg').textContent=err.message}}}
async function setSupplierStatus(id,status){try{await papi(`/api/supplier/orders/${id}/status`,{method:'POST',body:JSON.stringify({status})});ptoast(`PO marked ${pnice(status)}.`);await renderSupplierWorkspace(['ready_for_pickup','out_for_delivery','delivered'].includes(status)?'Fulfilment':'ETA')}catch(e){ptoast(e.message)}}

function applySupplierState(detail){const state=detail?.snapshot?detail:window.BusinessLifeProfileState;if(state?.snapshot)supMe=state.snapshot}
async function decorateSupplier(detail){if(!ensureSup()||!ptok())return;const state=detail?.snapshot?detail:window.BusinessLifeProfileState;applySupplierState(state);if(!supMe)return;const role=state?.surface==='profile'?state.activeRole:null,hub=document.getElementById('roleHub');if(role==='merchant'){const top=document.querySelector('.shellProfileControls');if(top&&!document.getElementById('supQuickButton')){const b=document.createElement('button');b.id='supQuickButton';b.className='ordersQuickButton';b.type='button';b.textContent='Suppliers';b.onclick=openMerchantProcurement;top.insertAdjacentElement('beforebegin',b)}}else document.getElementById('supQuickButton')?.remove();if(hub&&role==='supplier')hub.querySelectorAll('[data-hub-feature]').forEach(b=>{if(SUPPLIER_SECTION_META[b.dataset.hubFeature])b.onclick=()=>openSupplierWorkspace(b.dataset.hubFeature)})}
function observeSupplier(){document.addEventListener('abl:profile-state',e=>decorateSupplier(e.detail).catch(()=>{}),{passive:true})}
async function boot(){ensureSup();observeSupplier();await decorateSupplier(window.BusinessLifeProfileState)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
