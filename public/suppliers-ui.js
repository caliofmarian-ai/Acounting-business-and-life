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
  const [rels,pos,suggestions,parties,lots,returns,recalls,rfqs,backorders,substitutions]=await Promise.all([
    papi('/api/procurement/relationships'),
    papi('/api/procurement/orders'),
    papi('/api/procurement/reorder-suggestions').catch(()=>[]),
    papi('/api/procurement/supply-parties').catch(()=>[]),
    papi('/api/procurement/supply-lots').catch(()=>[]),
    papi('/api/procurement/returns').catch(()=>[]),
    papi('/api/procurement/recalls').catch(()=>({matches:[]})),
    papi('/api/procurement/sourcing/rfqs').catch(()=>[]),
    papi('/api/procurement/backorders').catch(()=>[]),
    papi('/api/procurement/substitutions').catch(()=>[])
  ]);
  supWorkspace.innerHTML=supHeader('Suppliers & Restock','Relationships, sourcing, purchase orders and receiving')
    +`<section class="supHero"><h2>Find, compare, then choose.</h2><p>Request quotes from eligible Suppliers, compare factual cost and lead time, and create a purchase order only when you decide.</p><p>A purchase order is a commitment, receiving is physical stock, an invoice is supplier evidence, and payment is real money movement.</p></section>`
    +supplierSourcingCard(rfqs)
    +supplierExceptionDecisionCard(backorders,substitutions)
    +suggestionsCard(suggestions,rels)
    +supplyNetworkCard(parties,lots,returns,recalls)
    +`<section class="supCard"><h2>Connect a Supplier</h2><p>Invite a Supplier already using Business & Life. If your local supplier is not registered, add them above instead.</p><form id="supplierInvite" class="supForm"><label>Supplier email<input id="supplierEmail" type="email" required></label><label>Note<input id="supplierInviteNote" placeholder="Optional relationship note"></label><button>Send invitation</button><div id="supplierInviteMsg" class="fileNote"></div></form></section><div class="supGrid"><section class="supCard"><h2>Supplier relationships</h2><p>Only accepted Business & Life Suppliers can receive purchase orders in-app.</p><div class="supList">${rels.length?rels.map(relCard).join(''):'<div class="supEmpty">No Supplier relationships yet.</div>'}</div></section><section class="supCard"><h2>Purchase orders</h2><p>Accepted, preparing, delivery and receiving status.</p><div class="supList">${pos.length?pos.map(poCardMerchant).join(''):'<div class="supEmpty">No purchase orders yet.</div>'}</div></section></div>`;
  bindSupBack();
  bindMerchantProcurement(parties,lots,returns,rfqs,rels,backorders,substitutions);
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
  <p class="supCodeHelp">A PO is not an invoice. A confirmed Supplier credit is not cash received. Opening a case and selling the original sealed units is break-pack, not repacking.</p></div></details>`;
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

function supplierSourcingCard(rfqs=[]){
  return `<details class="supDetails supCard" open><summary><span><strong>Find suppliers & request quotes</strong><small>Controlled sourcing — Suppliers opt in; nothing is ordered automatically.</small></span><span class="supChevron">⌄</span></summary><div class="supDetailsBody"><div class="supInlineActions"><button type="button" class="supBtn" id="supFindSuppliers">Find suppliers</button></div>${rfqs.length?`<h3>Recent requests for quote</h3><div class="supList">${rfqs.slice(0,6).map(r=>`<div class="supRow"><div><strong>RFQ #${r.id} • ${ph(r.item_specification)}</strong><small>${Number(r.requested_quantity)} ${ph(r.requested_unit)} • ${Number(r.quote_count||0)} quote${Number(r.quote_count||0)===1?'':'s'} • ${ph(pnice(r.status))}</small></div><div class="supActions"><button type="button" class="supBtn secondary" data-rfq-compare="${r.id}">Compare</button></div></div>`).join('')}</div>`:'<div class="supEmpty" style="margin-top:10px">No sourcing request yet. Find eligible Suppliers and ask for quotes.</div>'}<p class="supCodeHelp">Business & Life does not rank a “best Supplier” or place an order for you. Comparison only shows factual quote differences.</p></div></details>`;
}
function suggestionsCard(rows,rels=[]){
  if(!rows.length)return `<section class="supCard"><h2>Reorder suggestions</h2><p>No current inventory item is below its reorder level.</p></section>`;
  return `<section class="supCard"><h2>Reorder suggestions</h2><p>Based on current stock. Preferred sources are chosen by you; nothing is sent automatically.</p><div class="supList">${rows.map(x=>`<div class="supRow"><div><strong>${ph(x.item)}</strong><small>${Number(x.quantity)} ${ph(x.unit)} on hand • reorder at ${Number(x.reorder_level)}</small>${x.catalog_item_id?`<div class="supMeta"><span class="ok">Preferred #${Number(x.preference_rank||1)} • ${ph(x.supplier_name)}</span><span>${ph(x.product_name)}</span><span>${x.suggested_packs} ${ph(x.unit_name)}</span><span>${pphp(Number(x.price_per_pack)*Number(x.suggested_packs||0))}</span></div>`:'<div class="supMeta"><span class="pending">No preferred Supplier source configured</span></div>'}</div><div class="supActions"><button type="button" class="supBtn secondary" data-source-config="${x.inventory_id}">Sources</button></div></div>`).join('')}</div></section>`;
}
async function openSupplierDirectory(){
  const data=await papi('/api/procurement/sourcing/directory');
  openSupModal(`<h2>Find eligible Suppliers</h2><p class="supModalIntro">Only approved Suppliers who opted into controlled discovery appear here. Private contact information is not exposed.</p><form id="supplierDirectoryForm" class="supForm"><div class="supList">${data.length?data.map(s=>`<label class="supPick"><div><strong>${ph(s.supplier_name)}</strong><small>${ph(s.service_area||'Service area not published')} • ~${Number(s.normal_lead_days||1)}d lead${s.minimum_order_value!=null?` • MOQ value ${pphp(s.minimum_order_value)}`:''}</small><div class="supMeta">${(s.categories||[]).map(x=>`<span>${ph(pnice(x))}</span>`).join('')}${s.relationship_accepted?'<span class="ok">Connected</span>':''}</div>${(s.published_catalog||[]).length?`<small>${s.published_catalog.slice(0,3).map(i=>ph(i.product_name)+' '+pphp(i.price_per_pack)+'/'+ph(i.unit_name)).join(' • ')}</small>`:''}</div><input type="checkbox" data-supplier-target="${s.supplier_business_id}" style="width:auto"></label>`).join(''):'<div class="supEmpty">No Supplier has opted into this sourcing directory yet.</div>'}</div><div id="supplierDirectoryMsg" class="fileNote"></div><div class="supTwo"><button type="button" class="supBtn secondary" id="supplierDirectoryClose">Close</button><button ${data.length?'':'disabled'}>Request quotes</button></div></form>`);
  document.getElementById('supplierDirectoryClose').onclick=closeSupModal;
  document.getElementById('supplierDirectoryForm').onsubmit=e=>{
    e.preventDefault();
    const ids=[...e.currentTarget.querySelectorAll('[data-supplier-target]:checked')].map(x=>Number(x.dataset.supplierTarget));
    if(!ids.length){document.getElementById('supplierDirectoryMsg').textContent='Choose at least one Supplier.';return}
    if(ids.length>5){document.getElementById('supplierDirectoryMsg').textContent='Choose up to 5 Suppliers per request.';return}
    createSupplierRfq(ids);
  };
}
function createSupplierRfq(targetIds){
  openSupModal(`<h2>Request quotes</h2><p class="supModalIntro">Tell Suppliers what you need. This request does not reserve stock or create a purchase order.</p><form id="supplierRfqForm" class="supForm"><label>Item / specification<input id="rfqItem" required placeholder="e.g. Jasmine rice, food grade, 50 kg"></label><div class="supTwo"><label>Quantity<input id="rfqQty" type="number" min="0.000001" step="0.000001" required></label><label>Unit<input id="rfqUnit" required placeholder="kg, g, L, unit..."></label></div><div class="supTwo"><label>Needed by<input id="rfqNeeded" type="date"></label><label>Fulfilment<select id="rfqMode"><option value="either">Pickup or delivery</option><option value="delivery">Delivery</option><option value="pickup">Pickup</option></select></label></div><label>Service area / delivery note<input id="rfqArea"></label><label>Quality / brand requirements<input id="rfqQuality"></label><div class="supTwo"><label>Substitution<select id="rfqSubstitution"><option value="approval_required">Ask before substitution</option><option value="allowed">Allowed</option><option value="no_substitution">No substitution</option></select></label><label>Target budget ₱ (optional)<input id="rfqBudget" type="number" min="0" step="0.01"></label></div><label>Note<textarea id="rfqNote" rows="2"></textarea></label><div id="rfqMsg" class="fileNote"></div><div class="supTwo"><button type="button" class="supBtn secondary" id="rfqCancel">Cancel</button><button>Send RFQ to ${targetIds.length} Supplier${targetIds.length===1?'':'s'}</button></div></form>`);
  document.getElementById('rfqCancel').onclick=closeSupModal;
  document.getElementById('supplierRfqForm').onsubmit=async e=>{
    e.preventDefault();
    try{
      await papi('/api/procurement/sourcing/rfqs',{method:'POST',body:JSON.stringify({
        supplier_business_ids:targetIds,item_specification:document.getElementById('rfqItem').value,
        requested_quantity:Number(document.getElementById('rfqQty').value),requested_unit:document.getElementById('rfqUnit').value,
        needed_by:document.getElementById('rfqNeeded').value||null,fulfilment_mode:document.getElementById('rfqMode').value,
        service_area:document.getElementById('rfqArea').value,quality_requirements:document.getElementById('rfqQuality').value,
        substitution_policy:document.getElementById('rfqSubstitution').value,
        target_budget:document.getElementById('rfqBudget').value===''?null:Number(document.getElementById('rfqBudget').value),
        note:document.getElementById('rfqNote').value
      })});
      closeSupModal();ptoast('RFQ sent. No order was created.');await renderMerchantProcurement();
    }catch(err){document.getElementById('rfqMsg').textContent=err.message}
  };
}
async function openRfqComparison(id,parties=[]){
  const r=await papi(`/api/procurement/sourcing/rfqs/${id}`);
  const low=Number(r.factual_highlights?.lowest_normalized_landed_cost_quote_id||0);
  const fast=Number(r.factual_highlights?.earliest_fulfilment_quote_id||0);
  openSupModal(`<h2>Compare RFQ #${r.id}</h2><p class="supModalIntro">${ph(r.item_specification)} • ${Number(r.requested_quantity)} ${ph(r.requested_unit)}. Factual highlights are not recommendations.</p><div class="supList">${r.quotes.length?r.quotes.map(q=>`<div class="supRow"><div><strong>${ph(q.supplier_name)} • ${ph(q.offered_name)}</strong><small>${Number(q.quoted_packs)} ${ph(q.package_unit)} × ${pphp(q.price_per_pack)} • landed ${pphp(q.landed_total)}</small><div class="supMeta">${q.comparable?`<span>${Number(q.normalized_landed_cost)} / ${ph(q.normalized_base_unit)}</span>`:'<span class="pending">NOT_COMPARABLE</span>'}<span>MOQ ${Number(q.minimum_packs)}</span><span>${Number(q.lead_days)}d lead</span>${Number(q.id)===low?'<span class="ok">Lowest normalized landed cost</span>':''}${Number(q.id)===fast?'<span class="ok">Earliest quoted fulfilment</span>':''}</div></div><div class="supActions">${q.source_type==='connected_supplier'&&q.status==='active'?`<button type="button" class="supBtn" data-quote-po="${q.id}">Create PO</button>`:''}</div></div>`).join(''):'<div class="supEmpty">No quotes yet.</div>'}</div><div class="supInlineActions" style="margin-top:12px">${parties.filter(x=>x.status==='active'&&x.source_type==='external').length?'<button type="button" class="supBtn secondary" id="recordExternalQuote">Record local quote</button>':''}<button type="button" class="supBtn secondary" id="rfqCompareClose">Close</button></div><p class="supCodeHelp">Business & Life never auto-selects a quote and never creates a PO until you press Create PO.</p>`);
  document.getElementById('rfqCompareClose').onclick=closeSupModal;
  document.getElementById('recordExternalQuote')?.addEventListener('click',()=>recordExternalSupplierQuote(id,parties));
  document.querySelectorAll('[data-quote-po]').forEach(b=>b.onclick=()=>createPoFromQuote(Number(b.dataset.quotePo)));
}
async function createPoFromQuote(quoteId){
  try{
    const po=await papi(`/api/procurement/sourcing/quotes/${quoteId}/create-po`,{method:'POST',body:JSON.stringify({})});
    closeSupModal();ptoast(`Purchase order ${po.po_number} created from your selected quote.`);await renderMerchantProcurement();
  }catch(e){ptoast(e.message)}
}
function recordExternalSupplierQuote(rfqId,parties){
  const external=parties.filter(x=>x.status==='active'&&x.source_type==='external');
  openSupModal(`<h2>Record local Supplier quote</h2><p class="supModalIntro">Use this for a market vendor or local Supplier outside Business & Life. It is quote evidence only.</p><form id="externalQuoteForm" class="supForm"><label>Supplier<select id="extQuoteParty">${external.map(x=>`<option value="${x.id}">${ph(x.display_name)}</option>`).join('')}</select></label><label>Offered item<input id="extQuoteName" required></label><div class="supTwo"><label>Quoted packs<input id="extQuotePacks" type="number" min="0.000001" step="0.000001" required></label><label>MOQ packs<input id="extQuoteMin" type="number" min="0.000001" step="0.000001" value="1"></label></div><div class="supTwo"><label>Pack name<input id="extQuotePack" required placeholder="sack, case, pack"></label><label>Price / pack ₱<input id="extQuotePrice" type="number" min="0" step="0.01" required></label></div><div class="supTwo"><label>Base unit<input id="extQuoteBase" required placeholder="kg, g, unit"></label><label>Base units / pack<input id="extQuoteBaseQty" type="number" min="0.000001" step="0.000001" required></label></div><div class="supTwo"><label>Delivery fee ₱<input id="extQuoteDelivery" type="number" min="0" step="0.01" value="0"></label><label>Lead days<input id="extQuoteLead" type="number" min="0" max="365" value="0"></label></div><label>Valid until<input id="extQuoteValid" type="date" required></label><div id="extQuoteMsg" class="fileNote"></div><div class="supTwo"><button type="button" class="supBtn secondary" id="extQuoteCancel">Cancel</button><button>Save quote evidence</button></div></form>`);
  document.getElementById('extQuoteCancel').onclick=closeSupModal;
  document.getElementById('externalQuoteForm').onsubmit=async e=>{
    e.preventDefault();try{
      await papi(`/api/procurement/sourcing/rfqs/${rfqId}/external-quotes`,{method:'POST',body:JSON.stringify({
        supply_party_id:Number(document.getElementById('extQuoteParty').value),offered_name:document.getElementById('extQuoteName').value,
        quoted_packs:Number(document.getElementById('extQuotePacks').value),minimum_packs:Number(document.getElementById('extQuoteMin').value),
        package_unit:document.getElementById('extQuotePack').value,price_per_pack:Number(document.getElementById('extQuotePrice').value),
        base_unit:document.getElementById('extQuoteBase').value,base_units_per_pack:Number(document.getElementById('extQuoteBaseQty').value),
        delivery_fee:Number(document.getElementById('extQuoteDelivery').value||0),lead_days:Number(document.getElementById('extQuoteLead').value||0),
        valid_until:document.getElementById('extQuoteValid').value
      })});
      await openRfqComparison(rfqId,parties);
    }catch(err){document.getElementById('extQuoteMsg').textContent=err.message}
  };
}
async function configurePreferredSources(inventoryId,rels=[]){
  const accepted=rels.filter(r=>r.state==='accepted');
  const catalogs=(await Promise.all(accepted.map(async r=>{
    const d=await papi(`/api/procurement/suppliers/${r.supplier_account_id}/catalog`).catch(()=>({items:[]}));
    return (d.items||[]).filter(i=>Number(i.link?.legacy_inventory_id)===Number(inventoryId)).map(i=>({
      ...i,supplier_name:r.supplier_name||r.display_name
    }));
  }))).flat();
  const current=await papi(`/api/procurement/inventory/${inventoryId}/supplier-sources`).catch(()=>[]);
  const rank=new Map(current.map(x=>[Number(x.catalog_item_id),Number(x.preference_rank)]));
  openSupModal(`<h2>Preferred Supplier sources</h2><p class="supModalIntro">Rank only catalog items already linked to this Inventory item. Rank 1 is used first when available; fallback ranks are explicit.</p><form id="sourcePrefForm" class="supForm"><div class="supList">${catalogs.length?catalogs.map(i=>`<div class="supRow"><div><strong>${ph(i.supplier_name)} • ${ph(i.product_name)}</strong><small>${pphp(i.price_per_pack)} / ${ph(i.unit_name)} • ${ph(pnice(i.availability_status))}</small></div><label style="max-width:90px">Rank<input data-source-rank="${i.id}" type="number" min="1" step="1" value="${rank.get(Number(i.id))||''}"></label></div>`).join(''):'<div class="supEmpty">No Supplier catalog item is linked to this Inventory item yet. Open a connected Supplier catalog and map an item first.</div>'}</div><div id="sourcePrefMsg" class="fileNote"></div><div class="supTwo"><button type="button" class="supBtn secondary" id="sourcePrefCancel">Cancel</button><button ${catalogs.length?'':'disabled'}>Save source order</button></div></form>`);
  document.getElementById('sourcePrefCancel').onclick=closeSupModal;
  document.getElementById('sourcePrefForm').onsubmit=async e=>{
    e.preventDefault();const sources=[...e.currentTarget.querySelectorAll('[data-source-rank]')].filter(x=>x.value!=='').map(x=>({catalog_item_id:Number(x.dataset.sourceRank),preference_rank:Number(x.value)}));
    try{await papi(`/api/procurement/inventory/${inventoryId}/supplier-sources`,{method:'PUT',body:JSON.stringify({sources})});closeSupModal();ptoast('Preferred Supplier sources saved.');await renderMerchantProcurement()}catch(err){document.getElementById('sourcePrefMsg').textContent=err.message}
  };
}

function supplierExceptionDecisionCard(backorders=[],substitutions=[]){
  const pendingBackorders=backorders.filter(x=>x.state==='proposed');
  const pendingSubstitutions=substitutions.filter(x=>x.state==='proposed');
  if(!pendingBackorders.length&&!pendingSubstitutions.length)return '';
  return `<details class="supDetails supCard" open><summary><span><strong>Supplier changes need your decision</strong><small>${pendingBackorders.length} backorder • ${pendingSubstitutions.length} substitution</small></span><span class="supChevron">⌄</span></summary><div class="supDetailsBody">
    ${pendingBackorders.length?`<h3>Backorders</h3><div class="supList">${pendingBackorders.map(b=>`<div class="supRow"><div><strong>${ph(b.po_number)} • ${ph(b.original_item_name)}</strong><small>${Number(b.proposed_packs)} pack${Number(b.proposed_packs)===1?'':'s'} later • expected ${new Date(b.expected_available_date).toLocaleDateString()}</small><div class="supMeta"><span>Original ordered quantity stays unchanged</span></div></div><div class="supActions"><button class="supBtn" data-backorder-accept="${b.id}">Accept</button><button class="supBtn secondary" data-backorder-decline="${b.id}">Decline</button></div></div>`).join('')}</div>`:''}
    ${pendingSubstitutions.length?`<h3>Substitutions</h3><div class="supList">${pendingSubstitutions.map(s=>`<div class="supRow"><div><strong>${ph(s.po_number)} • ${ph(s.original_item_name)}</strong><small>Replace with ${ph(s.substitute_name_snapshot)} • ${Number(s.proposed_packs)} pack${Number(s.proposed_packs)===1?'':'s'} • ${pphp(s.substitute_price_per_pack)}/pack</small><div class="supMeta"><span>${ph(pnice(s.reason_code))}</span><span>Approval does not change Inventory or money</span></div></div><div class="supActions"><button class="supBtn" data-substitution-accept="${s.id}">Accept</button><button class="supBtn secondary" data-substitution-decline="${s.id}">Decline</button></div></div>`).join('')}</div>`:''}
  </div></details>`;
}
async function respondMerchantBackorder(id,accept){
  try{
    await papi(`/api/procurement/backorders/${id}/respond`,{method:'POST',body:JSON.stringify({accept})});
    ptoast(accept?'Backorder accepted.':'Backorder declined.');await renderMerchantProcurement();
  }catch(e){ptoast(e.message)}
}
async function respondMerchantSubstitution(id,accept){
  try{
    const r=await papi(`/api/procurement/substitutions/${id}/respond`,{method:'POST',body:JSON.stringify({accept})});
    ptoast(accept?'Substitution approved; it is not yet physically fulfilled.':'Substitution declined.');
    await renderMerchantProcurement();
  }catch(e){ptoast(e.message)}
}

function relCard(r){return `<div class="supRow"><div><strong>${ph(r.supplier_name||r.display_name)}</strong><small>${ph(r.description||'Local Supplier')}</small><div class="supMeta"><span class="${r.state==='accepted'?'ok':'pending'}">${ph(pnice(r.state))}</span>${r.normal_lead_days!=null?`<span>~${r.normal_lead_days}d lead</span>`:''}${r.delivery_available?'<span>Delivery</span>':'<span>Pickup</span>'}</div></div><div class="supActions">${r.state==='accepted'?`<button class="supBtn secondary" data-connected-terms="${r.supplier_account_id}">Terms</button><button class="supBtn" data-open-catalog="${r.supplier_account_id}">Catalog</button>`:''}</div></div>`}
function poCardMerchant(p){const open=!['received','cancelled','rejected'].includes(p.status);return `<div class="supRow"><div><strong>${ph(p.po_number||`PO ${p.id}`)} • ${ph(p.supplier_name)}</strong><small>${ph(pnice(p.status))} • ${pphp(p.expected_total)}</small><div class="supMeta"><span>${ph(pnice(p.fulfilment_mode))}</span><span class="${p.payment_status==='paid'?'ok':'pending'}">${ph(pnice(p.payment_status))}</span>${p.supplier_ready_at?`<span>Ready ${new Date(p.supplier_ready_at).toLocaleString()}</span>`:''}</div></div><div class="supActions">${open?`<button class="supBtn secondary" data-po-view="${p.id}">View</button>`:''}${['delivered','partially_received','accepted','ready_for_pickup'].includes(p.status)?`<button class="supBtn" data-po-receive="${p.id}">Receive</button>`:''}${Number(p.paid_amount)<Number(p.expected_total)&&!['cancelled','rejected'].includes(p.status)?`<button class="supBtn warm" data-po-pay="${p.id}">Pay</button>`:''}</div></div>`}
function bindMerchantProcurement(parties=[],lots=[],returns=[],rfqs=[],rels=[],backorders=[],substitutions=[]){
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
  supWorkspace.querySelectorAll('[data-backorder-accept]').forEach(b=>b.onclick=()=>respondMerchantBackorder(Number(b.dataset.backorderAccept),true));
  supWorkspace.querySelectorAll('[data-backorder-decline]').forEach(b=>b.onclick=()=>respondMerchantBackorder(Number(b.dataset.backorderDecline),false));
  supWorkspace.querySelectorAll('[data-substitution-accept]').forEach(b=>b.onclick=()=>respondMerchantSubstitution(Number(b.dataset.substitutionAccept),true));
  supWorkspace.querySelectorAll('[data-substitution-decline]').forEach(b=>b.onclick=()=>respondMerchantSubstitution(Number(b.dataset.substitutionDecline),false));
  document.getElementById('supFindSuppliers')?.addEventListener('click',()=>openSupplierDirectory());
  supWorkspace.querySelectorAll('[data-rfq-compare]').forEach(b=>b.onclick=()=>openRfqComparison(Number(b.dataset.rfqCompare),parties));
  supWorkspace.querySelectorAll('[data-source-config]').forEach(b=>b.onclick=()=>configurePreferredSources(Number(b.dataset.sourceConfig),rels));
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

const SUPPLIER_TERM_OPTIONS=[
  ['prepaid','Prepaid'],['cod','Cash / COD'],['due_on_receipt','Due on receipt'],
  ['net_7','Net 7'],['net_15','Net 15'],['net_30','Net 30'],['net_45','Net 45'],['net_60','Net 60'],['custom','Custom']
];
function termOptions(selected='cod'){return SUPPLIER_TERM_OPTIONS.map(([v,l])=>`<option value="${v}" ${v===selected?'selected':''}>${l}</option>`).join('')}
async function editExternalTerms(partyId){
  const current=await papi(`/api/procurement/supply-parties/${partyId}/terms`).catch(()=>null);
  openSupModal(`<h2>Supplier payment terms</h2><p class="supModalIntro">These are your recorded commercial terms for this external/local supplier. They are not a government or bank approval.</p><form id="partyTermsForm" class="supForm"><label>Terms<select id="partyTermCode">${termOptions(current?.payment_term_code||'cod')}</select></label><div class="supTwo"><label>Custom days<input id="partyCustomDays" type="number" min="0" max="365" value="${current?.custom_days??''}"></label><label>Credit limit ₱<input id="partyCreditLimit" type="number" min="0" step="0.01" value="${current?.credit_limit??''}"></label></div><label>Note<input id="partyTermNote" value="${ph(current?.note||'')}"></label><div id="partyTermsMsg" class="fileNote"></div><div class="supTwo"><button type="button" class="supBtn secondary" id="partyTermsCancel">Cancel</button><button>Save terms</button></div></form>`);
  document.getElementById('partyTermsCancel').onclick=closeSupModal;
  document.getElementById('partyTermsForm').onsubmit=async e=>{
    e.preventDefault();
    try{
      await papi(`/api/procurement/supply-parties/${partyId}/terms`,{method:'PUT',body:JSON.stringify({
        paymentTermCode:document.getElementById('partyTermCode').value,
        customDays:document.getElementById('partyCustomDays').value===''?null:Number(document.getElementById('partyCustomDays').value),
        creditLimit:document.getElementById('partyCreditLimit').value===''?null:Number(document.getElementById('partyCreditLimit').value),
        note:document.getElementById('partyTermNote').value
      })});
      closeSupModal();ptoast('Supplier terms saved.');await renderMerchantProcurement();
    }catch(err){document.getElementById('partyTermsMsg').textContent=err.message}
  };
}
async function viewConnectedTerms(supplierId){
  const t=await papi(`/api/procurement/relationships/${supplierId}/terms`).catch(()=>null);
  openSupModal(`<h2>Supplier terms</h2>${t?`<div class="supList"><div class="supRow"><div><strong>${ph(pnice(t.payment_term_code))}</strong><small>${t.credit_limit!=null?`Credit limit ${pphp(t.credit_limit)} • `:''}${ph(pnice(t.status))}</small><div class="supMeta"><span>${ph(t.currency_code)}</span>${t.custom_days!=null?`<span>${Number(t.custom_days)} days</span>`:''}</div></div></div></div>`:'<div class="supEmpty">This connected Supplier has not confirmed payment terms yet.</div>'}<button class="supBtn secondary" id="connectedTermsClose">Close</button>`);
  document.getElementById('connectedTermsClose').onclick=closeSupModal;
}
async function requestReturnLot(lotId){
  const lots=await papi('/api/procurement/supply-lots');
  const lot=lots.find(x=>Number(x.id)===Number(lotId));
  if(!lot){ptoast('Lot is unavailable.');return}
  openSupModal(`<h2>Return stock to Supplier</h2><p class="supModalIntro">${ph(lot.item_name)} • ${Number(lot.quantity_remaining_base)} ${ph(lot.base_unit)} available. Creating a return request does not change stock yet.</p><form id="returnLotForm" class="supForm"><label>Quantity to return<input id="returnQty" type="number" min="0.000001" max="${Number(lot.quantity_remaining_base)}" step="0.000001" required></label><label>Reason<select id="returnReason"><option value="damaged">Damaged</option><option value="expired">Expired</option><option value="wrong_item">Wrong item</option><option value="quality">Quality issue</option><option value="recall">Recall</option><option value="over_delivery">Over-delivery</option><option value="other">Other</option></select></label><label>Expected credit ₱ (optional)<input id="returnCredit" type="number" min="0" step="0.01"></label><label>Note<textarea id="returnNote" rows="2"></textarea></label><div id="returnLotMsg" class="fileNote"></div><div class="supTwo"><button type="button" class="supBtn secondary" id="returnLotCancel">Cancel</button><button>Create return request</button></div></form>`);
  document.getElementById('returnLotCancel').onclick=closeSupModal;
  document.getElementById('returnLotForm').onsubmit=async e=>{
    e.preventDefault();
    try{
      const credit=document.getElementById('returnCredit').value;
      await papi('/api/procurement/returns',{method:'POST',body:JSON.stringify({
        supply_lot_id:lotId,
        quantity_base:Number(document.getElementById('returnQty').value),
        reason_code:document.getElementById('returnReason').value,
        expected_credit:credit===''?null:Number(credit),
        note:document.getElementById('returnNote').value
      })});
      closeSupModal();ptoast('Return request created. Stock is unchanged until physical return.');await renderMerchantProcurement();
    }catch(err){document.getElementById('returnLotMsg').textContent=err.message}
  };
}
async function dispatchReturn(id){
  try{await papi(`/api/procurement/returns/${id}/dispatch`,{method:'POST',body:'{}'});ptoast('Physical return recorded; lot and Inventory were reduced once.');await renderMerchantProcurement()}catch(e){ptoast(e.message)}
}
async function resolveExternalReturn(id){
  openSupModal(`<h2>Record external Supplier resolution</h2><p class="supModalIntro">Record only what the supplier actually agreed. A credit is not cash received.</p><form id="externalReturnResolve" class="supForm"><label>Resolution<select id="externalResolutionType"><option value="credit">Credit</option><option value="refund_expected">Refund expected</option><option value="replacement">Replacement</option><option value="no_credit">No credit</option></select></label><label>Confirmed credit ₱<input id="externalConfirmedCredit" type="number" min="0" step="0.01" value="0"></label><label>Evidence note<textarea id="externalResolutionNote" rows="2"></textarea></label><div id="externalResolutionMsg" class="fileNote"></div><div class="supTwo"><button type="button" class="supBtn secondary" id="externalResolutionCancel">Cancel</button><button>Save resolution</button></div></form>`);
  document.getElementById('externalResolutionCancel').onclick=closeSupModal;
  document.getElementById('externalReturnResolve').onsubmit=async e=>{
    e.preventDefault();
    try{
      await papi(`/api/procurement/returns/${id}/external-resolution`,{method:'POST',body:JSON.stringify({
        resolution_type:document.getElementById('externalResolutionType').value,
        confirmed_credit:Number(document.getElementById('externalConfirmedCredit').value||0),
        external_evidence_note:document.getElementById('externalResolutionNote').value
      })});
      closeSupModal();ptoast('External Supplier resolution recorded.');await renderMerchantProcurement();
    }catch(err){document.getElementById('externalResolutionMsg').textContent=err.message}
  };
}
async function recordExternalRecall(partyId){
  openSupModal(`<h2>Record Supplier recall notice</h2><p class="supModalIntro">Use the exact lot/batch from the supplier or authority notice. Matching lots are quarantined in traceability; aggregate Inventory is not yet fully lot-allocated for every sale.</p><form id="externalRecallForm" class="supForm"><label>Supplier lot / batch<input id="externalRecallLot" required></label><label>Product (optional)<input id="externalRecallProduct"></label><div class="supTwo"><label>Notice<select id="externalRecallLevel"><option value="recall">Recall</option><option value="withdrawal">Withdrawal</option><option value="advisory">Advisory</option></select></label><label>Action<select id="externalRecallAction"><option value="isolate">Isolate</option><option value="return">Return</option><option value="review">Review</option><option value="destroy">Destroy</option></select></label></div><label>Reason<textarea id="externalRecallReason" required rows="2"></textarea></label><label>Source/reference<input id="externalRecallRef"></label><div id="externalRecallMsg" class="fileNote"></div><div class="supTwo"><button type="button" class="supBtn secondary" id="externalRecallCancel">Cancel</button><button>Record notice</button></div></form>`);
  document.getElementById('externalRecallCancel').onclick=closeSupModal;
  document.getElementById('externalRecallForm').onsubmit=async e=>{
    e.preventDefault();
    try{
      const r=await papi('/api/procurement/recalls/external',{method:'POST',body:JSON.stringify({
        supply_party_id:partyId,
        supplier_lot_code:document.getElementById('externalRecallLot').value,
        product_name:document.getElementById('externalRecallProduct').value,
        notice_level:document.getElementById('externalRecallLevel').value,
        requested_action:document.getElementById('externalRecallAction').value,
        reason:document.getElementById('externalRecallReason').value,
        source_reference:document.getElementById('externalRecallRef').value
      })});
      closeSupModal();ptoast(`Recall notice recorded; ${Number(r.matched_lots||0)} lot match(es).`);await renderMerchantProcurement();
    }catch(err){document.getElementById('externalRecallMsg').textContent=err.message}
  };
}
async function recordPoInvoice(id,side){
  openSupModal(`<h2>Record Supplier invoice evidence</h2><p class="supModalIntro">This records the supplier document. It does not record payment and does not automatically make the document BIR-validated.</p><form id="poInvoiceForm" class="supForm"><label>Document number<input id="poInvoiceNumber"></label><label>Document type<select id="poInvoiceKind"><option value="invoice">Invoice</option><option value="sales_invoice">Sales Invoice</option><option value="charge_invoice">Charge Invoice</option><option value="billing_invoice">Billing Invoice</option><option value="other_supplier_document">Other supplier document</option></select></label><div class="supTwo"><label>Issue date<input id="poInvoiceIssue" type="date" required></label><label>Due date (optional)<input id="poInvoiceDue" type="date"></label></div><label>Gross amount ₱<input id="poInvoiceGross" type="number" min="0.01" step="0.01" required></label><label>Reference / file note<input id="poInvoiceRef"></label><div id="poInvoiceMsg" class="fileNote"></div><div class="supTwo"><button type="button" class="supBtn secondary" id="poInvoiceCancel">Cancel</button><button>Save invoice evidence</button></div></form>`);
  document.getElementById('poInvoiceIssue').value=new Date().toISOString().slice(0,10);
  document.getElementById('poInvoiceCancel').onclick=closeSupModal;
  document.getElementById('poInvoiceForm').onsubmit=async e=>{
    e.preventDefault();
    try{
      const path=side==='supplier'? `/api/supplier/orders/${id}/invoices`:`/api/procurement/orders/${id}/invoices`;
      await papi(path,{method:'POST',body:JSON.stringify({
        document_number:document.getElementById('poInvoiceNumber').value,
        document_kind:document.getElementById('poInvoiceKind').value,
        issue_date:document.getElementById('poInvoiceIssue').value,
        due_date:document.getElementById('poInvoiceDue').value||null,
        gross_amount:Number(document.getElementById('poInvoiceGross').value),
        evidence_reference:document.getElementById('poInvoiceRef').value
      })});
      closeSupModal();ptoast('Supplier invoice evidence recorded.');
      if(side==='merchant')await renderMerchantProcurement();else await renderSupplierWorkspace(supSupplierSection);
    }catch(err){document.getElementById('poInvoiceMsg').textContent=err.message}
  };
}
function supplierPriceLine(item){
  const tiers=(item.price_tiers||[]).map(x=>`${Number(x.minimum_quantity)}+ @ ${pphp(x.price_per_pack)}`).join(' • ');
  return `${pphp(item.price_per_pack)} / ${ph(item.unit_name)} • ${Number(item.base_units_per_pack)} ${ph(item.base_unit)}${tiers?` • Volume: ${ph(tiers)}`:''}`;
}
async function openSupplierCatalog(id){const [data]=await Promise.all([papi(`/api/procurement/suppliers/${id}/catalog`),loadInventory()]);const opts=x=>`<option value="">No inventory link</option>${supInventory.map(i=>`<option value="${i.id}" ${Number(x?.link?.legacy_inventory_id)===Number(i.id)?'selected':''}>${ph(i.item)} (${Number(i.quantity)} ${ph(i.unit)})</option>`).join('')}`;openSupModal(`<h2>${ph(data.supplier.supplier_name||data.supplier.display_name)} catalog</h2><form id="poCreate" class="supForm"><div class="supProductPicker">${data.items.map(i=>`<div class="supPick"><div><strong>${ph(i.product_name)}</strong><small>${supplierPriceLine(i)}</small><label style="margin-top:5px">Inventory mapping<select data-map-item="${i.id}">${opts(i)}</select></label></div><input type="number" min="0" step="1" value="0" data-po-item="${i.id}" aria-label="Packs"></div>`).join('')}</div><div class="supTwo"><label>Fulfilment<select id="poMode"><option value="delivery">Supplier delivery</option><option value="pickup">Pickup</option></select></label><label>Delivery fee ₱<input id="poDeliveryFee" type="number" min="0" step="0.01" value="0"></label></div><label>Requested date<input id="poRequested" type="date"></label><label>Note<textarea id="poNote" rows="2"></textarea></label><div id="poMsg" class="fileNote"></div><div class="supTwo"><button type="button" class="supBtn secondary" id="poCancel">Cancel</button><button>Create PO</button></div></form>`);document.getElementById('poCancel').onclick=closeSupModal;document.getElementById('poCreate').onsubmit=async e=>{e.preventDefault();const items=[...e.currentTarget.querySelectorAll('[data-po-item]')].map(x=>({catalog_item_id:Number(x.dataset.poItem),packs:Number(x.value)})).filter(x=>x.packs>0);if(!items.length){document.getElementById('poMsg').textContent='Choose at least one item.';return}try{for(const s of e.currentTarget.querySelectorAll('[data-map-item]')){if(s.value)await papi(`/api/procurement/catalog/${s.dataset.mapItem}/link`,{method:'PUT',body:JSON.stringify({legacy_inventory_id:Number(s.value)})})}await papi('/api/procurement/orders',{method:'POST',body:JSON.stringify({supplier_account_id:id,items,fulfilment_mode:document.getElementById('poMode').value,delivery_fee:Number(document.getElementById('poDeliveryFee').value),requested_date:document.getElementById('poRequested').value||null,merchant_note:document.getElementById('poNote').value})});closeSupModal();ptoast('Purchase order sent.');await renderMerchantProcurement()}catch(err){document.getElementById('poMsg').textContent=err.message}}}
async function viewPo(id,side){
  const [p,commercial]=await Promise.all([
    papi(`/api/procurement/orders/${id}`),
    papi(`/api/procurement/orders/${id}/commercial`).catch(()=>null)
  ]);
  const s=commercial?.summary;
  openSupModal(`<h2>${ph(p.po_number)} • ${ph(pnice(p.status))}</h2><div class="supList">${p.items.map(i=>`<div class="supRow"><div><strong>${ph(i.name_snapshot)}</strong><small>${Number(i.ordered_packs)} ${ph(i.unit_name_snapshot)} ordered • ${pphp(i.price_per_pack_snapshot)} each</small><div class="supMeta"><span>Confirmed ${Number(i.confirmed_packs??i.ordered_packs)}</span><span>Received ${Number(i.received_packs)}</span><span>${ph(pnice(i.handling_mode_snapshot||'sealed_resale'))}</span>${i.legacy_inventory_name?`<span class="ok">→ ${ph(i.legacy_inventory_name)}</span>`:''}</div></div></div>`).join('')}</div>
  ${s?`<details class="supNestedDetails" open><summary>Commercial position</summary><div class="supMeta" style="margin-top:10px"><span>PO ${pphp(s.expected_total)}</span><span>Received ${pphp(s.received_total)}</span><span>Invoiced ${pphp(s.invoice_total)}</span><span>Paid ${pphp(s.paid_amount)}</span><span>Credits ${pphp(s.confirmed_credits)}</span><span class="${s.outstanding>0?'pending':'ok'}">Outstanding ${pphp(s.outstanding)}</span>${s.overdue?'<span class="pending">Overdue</span>':''}</div>${s.invoice_vs_received_variance!=null&&Math.abs(Number(s.invoice_vs_received_variance))>0.009?`<p class="supCodeHelp">Invoice vs received variance: ${pphp(s.invoice_vs_received_variance)}. Review before paying.</p>`:''}</details>`:''}
  <div class="supInlineActions" style="margin-top:12px"><button class="supBtn" id="poRecordInvoice">Record invoice</button><button class="supBtn secondary" id="poClose">Close</button></div>`);
  document.getElementById('poRecordInvoice').onclick=()=>recordPoInvoice(id,side);
  document.getElementById('poClose').onclick=closeSupModal;
}
async function receivePo(id){
  const p=await papi(`/api/procurement/orders/${id}`);
  openSupModal(`<h2>Receive ${ph(p.po_number)}</h2><form id="receiveForm" class="supForm"><p class="supModalIntro">Record what physically arrived. Add lot/batch and expiry when available so recall traceability works later.</p><div class="supProductPicker">${p.items.map(i=>{const remain=Number(i.confirmed_packs??i.ordered_packs)-Number(i.received_packs);return `<div class="supPick"><div style="width:100%"><strong>${ph(i.name_snapshot)}</strong><small>Remaining ${remain} ${ph(i.unit_name_snapshot)}${i.legacy_inventory_name?` → ${ph(i.legacy_inventory_name)}`:' • no inventory mapping'}</small><details class="supNestedDetails" style="margin-top:7px"><summary>Lot / expiry</summary><div class="supTwo" style="margin-top:8px"><label>Supplier lot<input data-lot-code="${i.id}"></label><label>Expiry<input data-lot-expiry="${i.id}" type="date"></label></div></details></div><input data-receive-item="${i.id}" type="number" min="0" max="${remain}" step="0.01" value="${remain}"></div>`}).join('')}</div><label>Receiving note<input id="receiveNote"></label><div id="receiveMsg" class="fileNote"></div><div class="supTwo"><button type="button" class="supBtn secondary" id="receiveCancel">Cancel</button><button>Confirm receipt</button></div></form>`);
  document.getElementById('receiveCancel').onclick=closeSupModal;
  document.getElementById('receiveForm').onsubmit=async e=>{
    e.preventDefault();
    const items=[...e.currentTarget.querySelectorAll('[data-receive-item]')].map(x=>{
      const itemId=Number(x.dataset.receiveItem);
      const expiry=e.currentTarget.querySelector(`[data-lot-expiry="${itemId}"]`)?.value||'';
      return{
        item_id:itemId,
        received_packs:Number(x.value),
        supplier_lot_code:e.currentTarget.querySelector(`[data-lot-code="${itemId}"]`)?.value||'',
        expires_at:expiry?expiry+'T23:59:59+08:00':null
      };
    }).filter(x=>x.received_packs>0);
    try{
      await papi(`/api/procurement/orders/${id}/receive`,{method:'POST',body:JSON.stringify({items,note:document.getElementById('receiveNote').value})});
      closeSupModal();ptoast('Goods received; Inventory and traceable lots updated once.');await renderMerchantProcurement();
    }catch(err){document.getElementById('receiveMsg').textContent=err.message}
  };
}
async function payPo(id){
  const [p,commercial]=await Promise.all([
    papi(`/api/procurement/orders/${id}`),
    papi(`/api/procurement/orders/${id}/commercial`)
  ]);
  const due=Math.max(0,Number(commercial?.summary?.outstanding||0));
  openSupModal(`<h2>Record Supplier payment</h2><p class="supModalIntro">Current commercial outstanding: ${pphp(due)}. This uses invoice evidence when recorded, otherwise received value, otherwise the PO commitment.</p><form id="payPoForm" class="supForm"><label>Amount ₱<input id="payPoAmount" type="number" min="0.01" max="${due}" step="0.01" value="${due.toFixed(2)}" required ${due<=0?'disabled':''}></label><label>Paid from<select id="payPoAccount"><option value="cash">Cash</option><option value="gcash">GCash</option><option value="bank">Bank</option><option value="other">Other</option></select></label><div id="payPoMsg" class="fileNote">${due<=0?'Nothing is currently payable on this PO.':''}</div><div class="supTwo"><button type="button" class="supBtn secondary" id="payPoCancel">Cancel</button><button ${due<=0?'disabled':''}>Confirm real payment</button></div></form>`);
  document.getElementById('payPoCancel').onclick=closeSupModal;
  document.getElementById('payPoForm').onsubmit=async e=>{
    e.preventDefault();if(due<=0)return;
    try{
      await papi(`/api/procurement/orders/${id}/payment`,{method:'POST',body:JSON.stringify({
        amount:Number(document.getElementById('payPoAmount').value),
        account:document.getElementById('payPoAccount').value
      })});
      closeSupModal();ptoast('Supplier payment recorded.');await renderMerchantProcurement();
    }catch(err){document.getElementById('payPoMsg').textContent=err.message}
  };
}

const SUPPLIER_SECTION_META={
  Today:['Today','What needs your attention now'],
  Catalog:['My Catalog','Products, pricing, pack sizes and Supplier profile'],
  Orders:['Orders','All active purchase orders in one place'],
  Money:['Money','Receivables and recorded payments'],
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

const SUPPLIER_SOURCING_CATEGORY_LABELS={
  fresh_produce:'Fresh produce',meat_poultry:'Meat & poultry',fish_seafood:'Fish & seafood',
  rice_grains:'Rice & grains',beverages:'Beverages',packaged_foods:'Packaged foods',
  frozen_foods:'Frozen foods',bakery:'Bakery',household_fmcg:'Household / FMCG',
  personal_care:'Personal care',packaging:'Packaging',cleaning_supplies:'Cleaning supplies',
  lpg_fuel:'LPG / fuel',equipment:'Equipment',services:'Services',other:'Other'
};
function supplierSourcingPanel(state,rfqs=[],catalog=[]){
  const visibility=state?.visibility||'private';
  return `<details class="supDetails supCard" ${rfqs.length?'open':''}><summary><span><strong>Sourcing visibility & quote requests</strong><small>${visibility==='private'?'Private — existing relationships only':visibility==='directory'?'Discoverable to approved Merchants':'Discoverable for RFQs only'} • ${state?.accepts_rfqs?'RFQs on':'RFQs off'}</small></span><span class="supChevron">⌄</span></summary><div class="supDetailsBody"><div class="supInlineActions"><button type="button" class="supBtn secondary" id="supEditSourcing">Sourcing settings</button></div>${rfqs.length?`<h3>Incoming requests for quote</h3><div class="supList">${rfqs.slice(0,10).map(r=>`<div class="supRow"><div><strong>RFQ #${r.id} • ${ph(r.item_specification)}</strong><small>${ph(r.merchant_business_name)} • ${Number(r.requested_quantity)} ${ph(r.requested_unit)} • ${ph(pnice(r.target_state))}</small><div class="supMeta"><span>${ph(pnice(r.fulfilment_mode))}</span>${r.needed_by?`<span>Needed ${new Date(r.needed_by).toLocaleDateString()}</span>`:''}${r.target_budget!=null?`<span>Target ${pphp(r.target_budget)}</span>`:''}</div></div><div class="supActions">${['invited','viewed','quoted'].includes(r.target_state)&&['open','quoted'].includes(r.status)?`<button class="supBtn" data-rfq-quote="${r.id}">Quote</button><button class="supBtn secondary" data-rfq-decline="${r.id}">Decline</button>`:''}</div></div>`).join('')}</div>`:'<div class="supEmpty" style="margin-top:10px">No RFQ needs attention.</div>'}<p class="supCodeHelp">Discovery is optional. Business & Life does not expose your private email, phone, documents or financial data in the sourcing directory.</p></div></details>`;
}
async function editSupplierSourcingSettings(state,catalog=[]){
  const selectedCats=new Set(state?.categories||[]);
  const published=new Set((state?.published_catalog_item_ids||[]).map(Number));
  openSupModal(`<h2>Sourcing visibility</h2><p class="supModalIntro">Private is the default. Directory and RFQ-only visibility are shown only to authenticated approved Merchants.</p><form id="supplierSourcingSettingsForm" class="supForm"><label>Visibility<select id="sourceVisibility"><option value="private" ${state?.visibility==='private'?'selected':''}>Private</option><option value="directory" ${state?.visibility==='directory'?'selected':''}>Directory — show business summary</option><option value="rfq_only" ${state?.visibility==='rfq_only'?'selected':''}>RFQ only — no public catalog summary</option></select></label><label class="toggleBox"><input id="sourceAcceptRfqs" type="checkbox" ${state?.accepts_rfqs?'checked':''}> Accept sourcing RFQs</label><details class="supNestedDetails"><summary>What do you supply?</summary><div class="supCheckGrid" style="margin-top:8px">${Object.entries(SUPPLIER_SOURCING_CATEGORY_LABELS).map(([code,label])=>`<label class="supCheck"><input type="checkbox" data-source-category="${code}" ${selectedCats.has(code)?'checked':''}><span>${ph(label)}</span></label>`).join('')}</div></details><details class="supNestedDetails"><summary>Published catalog summary</summary><p class="supCodeHelp">Only checked items may appear in Directory mode. RFQ-only mode keeps this catalog private.</p><div class="supCheckGrid">${catalog.length?catalog.map(i=>`<label class="supCheck"><input type="checkbox" data-source-published="${i.id}" ${published.has(Number(i.id))?'checked':''}><span>${ph(i.product_name)} • ${pphp(i.price_per_pack)}/${ph(i.unit_name)}</span></label>`).join(''):'<span class="supEmpty">Add catalog items first.</span>'}</div></details><div id="supplierSourcingSettingsMsg" class="fileNote"></div><div class="supTwo"><button type="button" class="supBtn secondary" id="sourceSettingsCancel">Cancel</button><button>Save sourcing settings</button></div></form>`);
  document.getElementById('sourceSettingsCancel').onclick=closeSupModal;
  document.getElementById('supplierSourcingSettingsForm').onsubmit=async e=>{
    e.preventDefault();
    try{
      const categories=[...e.currentTarget.querySelectorAll('[data-source-category]:checked')].map(x=>x.dataset.sourceCategory);
      const published_catalog_item_ids=[...e.currentTarget.querySelectorAll('[data-source-published]:checked')].map(x=>Number(x.dataset.sourcePublished));
      await papi('/api/supplier/v4/sourcing-settings',{method:'PUT',body:JSON.stringify({
        visibility:document.getElementById('sourceVisibility').value,
        accepts_rfqs:document.getElementById('sourceAcceptRfqs').checked,
        categories,published_catalog_item_ids
      })});
      closeSupModal();ptoast('Supplier sourcing settings saved.');await renderSupplierWorkspace('Procurement');
    }catch(err){document.getElementById('supplierSourcingSettingsMsg').textContent=err.message}
  };
}
async function quoteSupplierRfq(id,catalog=[]){
  const defaultValid=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
  openSupModal(`<h2>Quote RFQ #${id}</h2><p class="supModalIntro">A quote is an offer, not an invoice or purchase order. The Merchant decides whether to create a PO.</p><form id="supplierRfqQuoteForm" class="supForm"><label>Catalog item (optional)<select id="rfqQuoteCatalog"><option value="">Manual offer</option>${catalog.map(i=>`<option value="${i.id}">${ph(i.product_name)} • ${pphp(i.price_per_pack)}/${ph(i.unit_name)}</option>`).join('')}</select></label><label>Offered item<input id="rfqQuoteName" required></label><div class="supTwo"><label>Quoted packs<input id="rfqQuotePacks" type="number" min="0.000001" step="0.000001" required></label><label>MOQ packs<input id="rfqQuoteMin" type="number" min="0.000001" step="0.000001" value="1"></label></div><div class="supTwo"><label>Pack name<input id="rfqQuotePack" required placeholder="case, sack, pack"></label><label>Price / pack ₱<input id="rfqQuotePrice" type="number" min="0" step="0.01" required></label></div><div class="supTwo"><label>Base unit<input id="rfqQuoteBase" required placeholder="kg, g, L, unit"></label><label>Base units / pack<input id="rfqQuoteBaseQty" type="number" min="0.000001" step="0.000001" required></label></div><div class="supTwo"><label>Delivery fee ₱<input id="rfqQuoteDelivery" type="number" min="0" step="0.01" value="0"></label><label>Lead days<input id="rfqQuoteLead" type="number" min="0" max="365" value="1"></label></div><div class="supTwo"><label>Earliest fulfilment<input id="rfqQuoteEarliest" type="date"></label><label>Valid until<input id="rfqQuoteValid" type="date" value="${defaultValid}" required></label></div><label>Availability<select id="rfqQuoteAvailability"><option value="available">Available</option><option value="limited">Limited</option><option value="unavailable">Unavailable</option></select></label><label>Substitution / brand note<input id="rfqQuoteSubstitution"></label><label>Payment terms note<input id="rfqQuoteTerms"></label><label>Supplier note<textarea id="rfqQuoteNote" rows="2"></textarea></label><div id="rfqQuoteMsg" class="fileNote"></div><div class="supTwo"><button type="button" class="supBtn secondary" id="rfqQuoteCancel">Cancel</button><button>Send quote</button></div></form>`);
  const select=document.getElementById('rfqQuoteCatalog');
  select.onchange=()=>{
    const item=catalog.find(x=>Number(x.id)===Number(select.value));
    if(!item)return;
    document.getElementById('rfqQuoteName').value=item.product_name||'';
    document.getElementById('rfqQuotePack').value=item.unit_name||'pack';
    document.getElementById('rfqQuotePrice').value=Number(item.price_per_pack||0);
    document.getElementById('rfqQuoteBase').value=item.base_unit||'unit';
    document.getElementById('rfqQuoteBaseQty').value=Number(item.base_units_per_pack||1);
    document.getElementById('rfqQuoteMin').value=Number(item.minimum_packs||1);
    document.getElementById('rfqQuoteLead').value=Number(item.lead_time_days||1);
    document.getElementById('rfqQuoteAvailability').value=item.availability_status||'available';
  };
  document.getElementById('rfqQuoteCancel').onclick=closeSupModal;
  document.getElementById('supplierRfqQuoteForm').onsubmit=async e=>{
    e.preventDefault();
    try{
      await papi(`/api/supplier/v4/rfqs/${id}/quote`,{method:'PUT',body:JSON.stringify({
        catalog_item_id:select.value?Number(select.value):null,offered_name:document.getElementById('rfqQuoteName').value,
        quoted_packs:Number(document.getElementById('rfqQuotePacks').value),minimum_packs:Number(document.getElementById('rfqQuoteMin').value),
        package_unit:document.getElementById('rfqQuotePack').value,price_per_pack:Number(document.getElementById('rfqQuotePrice').value),
        base_unit:document.getElementById('rfqQuoteBase').value,base_units_per_pack:Number(document.getElementById('rfqQuoteBaseQty').value),
        delivery_fee:Number(document.getElementById('rfqQuoteDelivery').value||0),lead_days:Number(document.getElementById('rfqQuoteLead').value||0),
        earliest_fulfilment_date:document.getElementById('rfqQuoteEarliest').value||null,valid_until:document.getElementById('rfqQuoteValid').value,
        availability_status:document.getElementById('rfqQuoteAvailability').value,
        substitution_note:document.getElementById('rfqQuoteSubstitution').value,payment_term_note:document.getElementById('rfqQuoteTerms').value,
        supplier_note:document.getElementById('rfqQuoteNote').value
      })});
      closeSupModal();ptoast('Quote sent. No PO was created.');await renderSupplierWorkspace('Procurement');
    }catch(err){document.getElementById('rfqQuoteMsg').textContent=err.message}
  };
}
async function declineSupplierRfq(id){
  try{await papi(`/api/supplier/v4/rfqs/${id}/decline`,{method:'POST',body:JSON.stringify({})});ptoast('RFQ declined.');await renderSupplierWorkspace('Procurement')}catch(e){ptoast(e.message)}
}

function supplierCatalogPanel(me,activityState){
  const p=me.profile||{};
  return `<section class="supCard"><h2>Supplier profile</h2><form id="supplierProfile" class="supForm"><label>Supplier/business name<input id="spName" value="${ph(p.supplier_name||supMe.account.display_name)}"></label><label>Description<textarea id="spDesc" rows="3">${ph(p.description||'')}</textarea></label><div class="supTwo"><label>Service area<input id="spArea" value="${ph(p.service_area||'')}"></label><label>Normal lead days<input id="spLead" type="number" min="0" value="${p.normal_lead_days??1}"></label></div><label class="toggleBox"><input id="spDelivery" type="checkbox" ${p.delivery_available?'checked':''}> I deliver to Merchant</label><button>Save profile</button></form></section>`
    +supplierActivitiesPanel(activityState)
    +`<section class="supCard"><h2>My catalog</h2><p>Start with product, pack and price. Packaging rules and volume prices stay under Details.</p><form id="catalogAdd" class="supForm"><label>Product<input id="catName" required></label><div class="supTwo"><label>Pack name<input id="catPack" value="pack"></label><label>Price / pack ₱<input id="catPrice" type="number" min="0" step="0.01" required></label></div><div class="supTwo"><label>Base unit<input id="catBase" value="unit"></label><label>Units / pack<input id="catUnits" type="number" min="0.0001" step="0.0001" value="1"></label></div><button>Add catalog item</button></form><div class="supList" style="margin-top:10px">${me.catalog.length?me.catalog.map(item=>`<div class="supRow"><div><strong>${ph(item.product_name)}</strong><small>${pphp(item.price_per_pack)} / ${ph(item.unit_name)} • ${Number(item.base_units_per_pack)} ${ph(item.base_unit)}</small><div class="supMeta"><span class="${item.availability_status==='available'?'ok':'pending'}">${ph(pnice(item.availability_status))}</span><span>${ph(pnice(item.handling_mode||'sealed_resale'))}</span>${(item.price_tiers||[]).length?`<span>${item.price_tiers.length} volume price${item.price_tiers.length===1?'':'s'}</span>`:''}</div></div><div class="supActions"><button type="button" class="supBtn secondary" data-v5-availability="${item.id}">Availability</button><button type="button" class="supBtn secondary" data-cat-v2="${item.id}">Details</button></div></div>`).join(''):'<div class="supEmpty">Catalog is empty.</div>'}</div></section>`;
}
function supplierRelationshipsPanel(rels){
  return `<section class="supCard"><h2>Merchant relationships</h2><p>Only accepted Merchant relationships can exchange procurement orders. Payment terms stay attached to each relationship.</p><div class="supList">${rels.length?rels.map(r=>`<div class="supRow"><div><strong>${ph(r.business_name)}</strong><small>${ph(pnice(r.state))}</small></div><div class="supActions">${['invited','pending'].includes(r.state)?`<button class="supBtn" data-rel-accept="${r.business_id}">Accept</button><button class="supBtn secondary" data-rel-decline="${r.business_id}">Decline</button>`:r.state==='accepted'?`<button class="supBtn secondary" data-sup-terms="${r.business_id}">Terms</button>`:''}</div></div>`).join(''):'<div class="supEmpty">No Merchant invitations yet.</div>'}</div></section>`;
}
function supplierCommercialPanel(returns=[]){
  return `<details class="supDetails supCard"><summary><span><strong>Commercial terms, returns & recall</strong><small>Advanced controls for credit sales, return resolutions and lot/batch recall.</small></span><span class="supChevron">⌄</span></summary><div class="supDetailsBody"><div class="supInlineActions"><button type="button" class="supBtn secondary" id="supIssueRecall">Issue lot recall</button></div>${returns.length?`<h3>Merchant returns</h3><div class="supList">${returns.slice(0,10).map(r=>`<div class="supRow"><div><strong>Return #${r.id} • ${ph(r.business_name)}</strong><small>${ph(pnice(r.status))} • expected credit ${pphp(r.expected_credit)}</small><div class="supMeta">${r.resolution_type&&r.resolution_type!=='pending'?`<span>${ph(pnice(r.resolution_type))}</span>`:''}${Number(r.confirmed_credit)>0?`<span>Credit ${pphp(r.confirmed_credit)}</span>`:''}</div></div><div class="supActions">${r.status==='requested'?`<button class="supBtn" data-return-auth="${r.id}">Authorize</button><button class="supBtn secondary" data-return-reject="${r.id}">Reject</button>`:''}${r.status==='returned'?`<button class="supBtn" data-return-resolve="${r.id}">Resolve</button>`:''}</div></div>`).join('')}</div>`:'<div class="supEmpty" style="margin-top:10px">No Merchant returns need attention.</div>'}<p class="supCodeHelp">A confirmed credit changes the commercial balance. It is not cash paid back unless a separate refund-money event is recorded.</p></div></details>`;
}
function supplierTodayOrders(today){
  return [
    ...(today?.sections?.new_orders||[]),
    ...(today?.sections?.prepare||[]),
    ...(today?.sections?.ready||[]),
    ...(today?.sections?.completed||[])
  ];
}
function supplierTodayPanel(today){
  const c=today?.counts||{},m=today?.money||{};
  const attention=(Number(c.overdue_timing)||0)+(Number(c.rfqs)||0)+(Number(c.returns)||0)+(Number(c.catalog_attention)||0);
  return `<section class="supCard"><div class="supKpiGrid">
    <button type="button" class="supKpi" data-v5-open="Procurement"><strong>${Number(c.new_orders||0)}</strong><span>New orders</span></button>
    <button type="button" class="supKpi" data-v5-open="ETA"><strong>${Number(c.prepare||0)}</strong><span>Prepare</span></button>
    <button type="button" class="supKpi" data-v5-open="Fulfilment"><strong>${Number(c.ready||0)}</strong><span>Ready / delivery</span></button>
    <button type="button" class="supKpi" data-v5-open="Money"><strong>${pphp(m.receivable_total||0)}</strong><span>Money due</span></button>
  </div>${attention?`<div class="supAlert"><strong>${attention} item${attention===1?'':'s'} need attention</strong><small>${Number(c.overdue_timing||0)} timing overdue • ${Number(c.rfqs||0)} RFQ • ${Number(c.returns||0)} return • ${Number(c.catalog_attention||0)} availability</small></div>`:''}</section>`
  +supplierTodayActionPanel('New orders',today?.sections?.new_orders||[],'No new purchase order needs a response.')
  +supplierTodayActionPanel('Prepare next',today?.sections?.prepare||[],'Nothing is waiting for preparation or ETA.')
  +supplierTodayActionPanel('Ready / delivery',today?.sections?.ready||[],'Nothing is waiting for pickup, delivery or Merchant receipt.')
  +supplierTodaySecondary(today);
}
function supplierTodayActionPanel(title,rows,empty){
  return `<section class="supCard"><h2>${ph(title)}</h2><div class="supList">${rows.length?rows.slice(0,6).map(poCardSupplier).join(''):`<div class="supEmpty">${ph(empty)}</div>`}</div></section>`;
}
function supplierTodaySecondary(today){
  const rfqs=today?.rfqs||[],returns=today?.returns||[],catalog=today?.catalog_attention||[];
  if(!rfqs.length&&!returns.length&&!catalog.length)return '';
  return `<details class="supDetails supCard"><summary><span><strong>Other attention</strong><small>RFQs, returns and catalog availability.</small></span><span class="supChevron">⌄</span></summary><div class="supDetailsBody">
    ${rfqs.length?`<h3>RFQs</h3><div class="supList">${rfqs.slice(0,6).map(r=>`<div class="supRow"><div><strong>RFQ #${r.id} • ${ph(r.item_specification)}</strong><small>${ph(r.merchant_business_name)} • ${Number(r.requested_quantity)} ${ph(r.requested_unit)}</small></div><div class="supActions"><button class="supBtn" data-rfq-quote="${r.id}">Quote</button><button class="supBtn secondary" data-rfq-decline="${r.id}">Decline</button></div></div>`).join('')}</div>`:''}
    ${returns.length?`<h3>Returns</h3><div class="supList">${returns.slice(0,6).map(r=>`<div class="supRow"><div><strong>Return #${r.id} • ${ph(r.business_name)}</strong><small>${ph(pnice(r.status))} • expected credit ${pphp(r.expected_credit)}</small></div><div class="supActions">${r.status==='requested'?`<button class="supBtn" data-return-auth="${r.id}">Authorize</button><button class="supBtn secondary" data-return-reject="${r.id}">Reject</button>`:''}${r.status==='returned'?`<button class="supBtn" data-return-resolve="${r.id}">Resolve</button>`:''}</div></div>`).join('')}</div>`:''}
    ${catalog.length?`<h3>Catalog availability</h3><div class="supList">${catalog.slice(0,8).map(i=>`<div class="supRow"><div><strong>${ph(i.product_name)}</strong><small>${ph(pnice(i.availability_status))}${i.expected_restock_date?` • restock ${new Date(i.expected_restock_date).toLocaleDateString()}`:''}</small><div class="supMeta">${(i.attention_signals||[]).map(x=>`<span class="pending">${ph(pnice(x))}</span>`).join('')}</div></div><div class="supActions"><button class="supBtn secondary" data-v5-availability="${i.id}">Availability</button></div></div>`).join('')}</div>`:''}
  </div></details>`;
}
function supplierAllOrdersPanel(pos){
  return supplierOrdersPanel(pos,'Procurement')+supplierOrdersPanel(pos,'ETA')+supplierOrdersPanel(pos,'Fulfilment');
}
function supplierMoneyPanel(today){
  const m=today?.money||{},c=today?.counts||{};
  const due=supplierTodayOrders(today).filter(x=>Number(x.commercial_outstanding||0)>0);
  return `<section class="supCard"><div class="supKpiGrid">
    <div class="supKpi static"><strong>${pphp(m.receivable_total||0)}</strong><span>Total receivable</span></div>
    <div class="supKpi static"><strong>${pphp(m.overdue_receivable_total||0)}</strong><span>Overdue</span></div>
    <div class="supKpi static"><strong>${Number(c.merchant_balances||0)}</strong><span>Merchant balances</span></div>
    <div class="supKpi static"><strong>${pphp(m.money_received_recorded||0)}</strong><span>Recorded received</span></div>
  </div><p class="supCodeHelp">Receivables use invoice evidence when present, otherwise received value; confirmed credits and recorded payments are subtracted. An unreceived PO is not money due.</p></section>
  <section class="supCard"><h2>Money due by order</h2><div class="supList">${due.length?due.map(p=>`<div class="supRow"><div><strong>${ph(p.po_number)} • ${ph(p.business_name)}</strong><small>${pphp(p.commercial_outstanding)} outstanding${p.earliest_due_date?` • due ${new Date(p.earliest_due_date).toLocaleDateString()}`:''}</small><div class="supMeta">${(p.attention_signals||[]).includes('RECEIVABLE_OVERDUE')?'<span class="pending">Overdue</span>':''}</div></div><div class="supActions"><button class="supBtn secondary" data-sup-view="${p.id}">View</button></div></div>`).join(''):'<div class="supEmpty">No Supplier receivable is currently outstanding.</div>'}</div></section>`;
}
async function editSupplierAvailability(id){
  const me=await papi('/api/supplier/me');
  const item=(me.catalog||[]).find(x=>Number(x.id)===Number(id));
  if(!item){ptoast('Catalog item is unavailable.');return}
  openSupModal(`<h2>Availability • ${ph(item.product_name)}</h2><p class="supModalIntro">This is availability evidence, not an exact warehouse stock count.</p><form id="v5AvailabilityForm" class="supForm"><label>Status<select id="v5AvailabilityStatus"><option value="available" ${item.availability_status==='available'?'selected':''}>Available</option><option value="limited" ${item.availability_status==='limited'?'selected':''}>Limited</option><option value="unavailable" ${item.availability_status==='unavailable'?'selected':''}>Unavailable</option></select></label><div class="supTwo"><label>Lead days<input id="v5AvailabilityLead" type="number" min="0" max="365" value="${Number(item.lead_time_days||0)}"></label><label>Expected restock<input id="v5RestockDate" type="date" value="${item.expected_restock_date?String(item.expected_restock_date).slice(0,10):''}"></label></div><label>Availability note<textarea id="v5AvailabilityNote" rows="2">${ph(item.availability_note||'')}</textarea></label><div id="v5AvailabilityMsg" class="fileNote"></div><div class="supTwo"><button type="button" class="supBtn secondary" id="v5AvailabilityCancel">Cancel</button><button>Save availability</button></div></form>`);
  document.getElementById('v5AvailabilityCancel').onclick=closeSupModal;
  document.getElementById('v5AvailabilityForm').onsubmit=async e=>{
    e.preventDefault();try{
      await papi(`/api/supplier/v5/catalog/${id}/availability`,{method:'PATCH',body:JSON.stringify({
        availability_status:document.getElementById('v5AvailabilityStatus').value,
        lead_time_days:Number(document.getElementById('v5AvailabilityLead').value||0),
        expected_restock_date:document.getElementById('v5RestockDate').value||null,
        availability_note:document.getElementById('v5AvailabilityNote').value
      })});
      closeSupModal();ptoast('Availability updated.');await renderSupplierWorkspace(supSupplierSection);
    }catch(err){document.getElementById('v5AvailabilityMsg').textContent=err.message}
  };
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
async function openSupplierWorkspace(section='Today'){
  supSupplierSection=SUPPLIER_SECTION_META[section]?section:'Today';
  ensureSup();hideSupBase();supWorkspace.classList.remove('hidden');
  await renderSupplierWorkspace(supSupplierSection);
}
async function renderSupplierWorkspace(section=supSupplierSection){
  const normalized=SUPPLIER_SECTION_META[section]?section:'Today';
  supSupplierSection=normalized;
  const [me,rels,pos,activityState,supplierReturns,sourcingState,incomingRfqs,todayState]=await Promise.all([
    papi('/api/supplier/me'),
    papi('/api/procurement/relationships'),
    papi('/api/procurement/orders'),
    normalized==='Catalog'?papi('/api/supplier/v2/activities').catch(()=>({activities:[]})):Promise.resolve({activities:[]}),
    normalized==='Procurement'?papi('/api/supplier/returns').catch(()=>[]):Promise.resolve([]),
    normalized==='Procurement'?papi('/api/supplier/v4/sourcing-settings').catch(()=>({visibility:'private',accepts_rfqs:false,categories:[],published_catalog_item_ids:[]})):Promise.resolve({visibility:'private',accepts_rfqs:false,categories:[],published_catalog_item_ids:[]}),
    normalized==='Procurement'?papi('/api/supplier/v4/rfqs').catch(()=>[]):Promise.resolve([]),
    ['Today','Money'].includes(normalized)?papi('/api/supplier/v5/today').catch(()=>({sections:{},counts:{},money:{},rfqs:[],returns:[],catalog_attention:[]})):Promise.resolve(null)
  ]);
  const meta=SUPPLIER_SECTION_META[normalized];
  let body='';
  if(normalized==='Today')body=supplierTodayPanel(todayState);
  else if(normalized==='Catalog')body=supplierCatalogPanel(me,activityState);
  else if(normalized==='Orders')body=supplierAllOrdersPanel(pos);
  else if(normalized==='Money')body=supplierMoneyPanel(todayState);
  else if(normalized==='Procurement')body=supplierRelationshipsPanel(rels)+supplierSourcingPanel(sourcingState,incomingRfqs,me.catalog)+supplierCommercialPanel(supplierReturns)+supplierOrdersPanel(pos,'Procurement');
  else body=supplierOrdersPanel(pos,normalized);
  supWorkspace.innerHTML=supHeader(meta[0],meta[1])+`<section class="supHero"><h2>Supply local businesses from one account.</h2><p>Catalog, order response, ETA and fulfilment stay separate so Merchants can rely on the right status.</p></section><div data-bl-pricing="supplier"></div>`+body;
  bindSupBack();bindSupplierWorkspace();
}
function poCardSupplier(p){
  let acts='';
  if(['sent','supplier_received'].includes(p.status))acts+=`<button class="supBtn" data-sup-respond="${p.id}">Respond</button>`;
  if(['accepted','partially_accepted'].includes(p.status))acts+=`<button class="supBtn" data-sup-respond="${p.id}">Update ETA</button><button class="supBtn secondary" data-sup-status="${p.id}" data-status="preparing">Preparing</button>`;
  if(p.status==='partially_accepted')acts+=`<button class="supBtn secondary" data-sup-shortage="${p.id}">Shortage options</button>`;
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
  supWorkspace.querySelectorAll('[data-v5-open]').forEach(b=>b.onclick=()=>renderSupplierWorkspace(b.dataset.v5Open));
  supWorkspace.querySelectorAll('[data-v5-availability]').forEach(b=>b.onclick=()=>editSupplierAvailability(Number(b.dataset.v5Availability)));
  supWorkspace.querySelectorAll('[data-cat-v2]').forEach(b=>b.onclick=()=>openCatalogV2(Number(b.dataset.catV2)));
  document.getElementById('supEditSourcing')?.addEventListener('click',async()=>{
    const [state,me]=await Promise.all([papi('/api/supplier/v4/sourcing-settings'),papi('/api/supplier/me')]);
    editSupplierSourcingSettings(state,me.catalog||[]);
  });
  supWorkspace.querySelectorAll('[data-rfq-quote]').forEach(b=>b.onclick=async()=>{const me=await papi('/api/supplier/me');quoteSupplierRfq(Number(b.dataset.rfqQuote),me.catalog||[])});
  supWorkspace.querySelectorAll('[data-rfq-decline]').forEach(b=>b.onclick=()=>declineSupplierRfq(Number(b.dataset.rfqDecline)));
  supWorkspace.querySelectorAll('[data-sup-terms]').forEach(b=>b.onclick=()=>editConnectedSupplierTerms(Number(b.dataset.supTerms)));
  document.getElementById('supIssueRecall')?.addEventListener('click',()=>issueSupplierRecall());
  supWorkspace.querySelectorAll('[data-return-auth]').forEach(b=>b.onclick=()=>respondSupplierReturn(Number(b.dataset.returnAuth),true));
  supWorkspace.querySelectorAll('[data-return-reject]').forEach(b=>b.onclick=()=>respondSupplierReturn(Number(b.dataset.returnReject),false));
  supWorkspace.querySelectorAll('[data-return-resolve]').forEach(b=>b.onclick=()=>resolveSupplierReturn(Number(b.dataset.returnResolve)));
  supWorkspace.querySelectorAll('[data-rel-accept]').forEach(b=>b.onclick=()=>respondRel(Number(b.dataset.relAccept),true));
  supWorkspace.querySelectorAll('[data-rel-decline]').forEach(b=>b.onclick=()=>respondRel(Number(b.dataset.relDecline),false));
  supWorkspace.querySelectorAll('[data-v5-backorder-fulfil]').forEach(b=>b.onclick=()=>fulfilSupplierBackorder(Number(b.dataset.v5BackorderFulfil)));
  supWorkspace.querySelectorAll('[data-sup-shortage]').forEach(b=>b.onclick=()=>openSupplierShortageOptions(Number(b.dataset.supShortage)));
  supWorkspace.querySelectorAll('[data-sup-view]').forEach(b=>b.onclick=()=>viewPo(Number(b.dataset.supView),'supplier'));
  supWorkspace.querySelectorAll('[data-sup-respond]').forEach(b=>b.onclick=()=>supplierRespondPo(Number(b.dataset.supRespond)));
  supWorkspace.querySelectorAll('[data-sup-status]').forEach(b=>b.onclick=()=>setSupplierStatus(Number(b.dataset.supStatus),b.dataset.status));
}
async function openSupplierShortageOptions(poId){
  const [po,me]=await Promise.all([papi(`/api/procurement/orders/${poId}`),papi('/api/supplier/me')]);
  const missing=(po.items||[]).map(i=>({
    ...i,missing:Math.max(0,Number(i.ordered_packs)-Number(i.confirmed_packs||0))
  })).filter(i=>i.missing>0);
  if(!missing.length){ptoast('This order has no unconfirmed remainder.');return}
  openSupModal(`<h2>Shortage options • ${ph(po.po_number)}</h2><p class="supModalIntro">Backorder or substitute only the unconfirmed remainder. Nothing changes until the Merchant decides.</p><div class="supList">${missing.map(i=>`<div class="supRow"><div><strong>${ph(i.name_snapshot)}</strong><small>${i.missing} ${ph(i.unit_name_snapshot)} unconfirmed</small></div><div class="supActions"><button class="supBtn secondary" data-propose-backorder="${i.id}">Backorder</button><button class="supBtn secondary" data-propose-substitution="${i.id}">Substitute</button></div></div>`).join('')}</div><button class="supBtn secondary" id="shortageClose">Close</button>`);
  document.getElementById('shortageClose').onclick=closeSupModal;
  document.querySelectorAll('[data-propose-backorder]').forEach(b=>{
    const item=missing.find(x=>Number(x.id)===Number(b.dataset.proposeBackorder));
    b.onclick=()=>proposeSupplierBackorder(poId,item);
  });
  document.querySelectorAll('[data-propose-substitution]').forEach(b=>{
    const item=missing.find(x=>Number(x.id)===Number(b.dataset.proposeSubstitution));
    b.onclick=()=>proposeSupplierSubstitution(poId,item,me.catalog||[]);
  });
}
function proposeSupplierBackorder(poId,item){
  const tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10);
  openSupModal(`<h2>Propose backorder</h2><p class="supModalIntro">${ph(item.name_snapshot)} • up to ${item.missing} ${ph(item.unit_name_snapshot)}. Proposal does not change the PO quantity.</p><form id="v5BackorderForm" class="supForm"><label>Packs later<input id="v5BackorderPacks" type="number" min="0.000001" max="${item.missing}" step="0.000001" value="${item.missing}" required></label><label>Expected available date<input id="v5BackorderDate" type="date" value="${tomorrow}" required></label><label>Supplier note<textarea id="v5BackorderNote" rows="2"></textarea></label><div id="v5BackorderMsg" class="fileNote"></div><div class="supTwo"><button type="button" class="supBtn secondary" id="v5BackorderCancel">Cancel</button><button>Send proposal</button></div></form>`);
  document.getElementById('v5BackorderCancel').onclick=closeSupModal;
  document.getElementById('v5BackorderForm').onsubmit=async e=>{
    e.preventDefault();try{
      await papi(`/api/supplier/orders/${poId}/backorders`,{method:'POST',body:JSON.stringify({
        purchase_order_item_id:Number(item.id),
        proposed_packs:Number(document.getElementById('v5BackorderPacks').value),
        expected_available_date:document.getElementById('v5BackorderDate').value,
        supplier_note:document.getElementById('v5BackorderNote').value
      })});
      closeSupModal();ptoast('Backorder proposed. PO quantities are unchanged.');await renderSupplierWorkspace(supSupplierSection);
    }catch(err){document.getElementById('v5BackorderMsg').textContent=err.message}
  };
}
function proposeSupplierSubstitution(poId,item,catalog){
  const options=catalog.filter(x=>Number(x.id)!==Number(item.catalog_item_id)&&x.active!==false&&x.availability_status!=='unavailable');
  if(!options.length){ptoast('No alternative catalog item is currently available.');return}
  openSupModal(`<h2>Propose substitution</h2><p class="supModalIntro">Original: ${ph(item.name_snapshot)} • ${item.missing} unconfirmed. Merchant approval changes no stock or money.</p><form id="v5SubstitutionForm" class="supForm"><label>Substitute<select id="v5SubstituteItem">${options.map(x=>`<option value="${x.id}" data-price="${Number(x.price_per_pack)}">${ph(x.product_name)} • ${pphp(x.price_per_pack)}/${ph(x.unit_name)}</option>`).join('')}</select></label><div class="supTwo"><label>Packs<input id="v5SubstitutePacks" type="number" min="0.000001" max="${item.missing}" step="0.000001" value="${item.missing}" required></label><label>Price / pack ₱<input id="v5SubstitutePrice" type="number" min="0" step="0.01" value="${Number(options[0].price_per_pack)}" required></label></div><label>Reason<select id="v5SubstituteReason"><option value="unavailable">Original unavailable</option><option value="quality">Quality</option><option value="pack_size">Pack size</option><option value="brand_request">Brand request</option><option value="other">Other</option></select></label><label>Expected available (optional)<input id="v5SubstituteDate" type="date"></label><label>Supplier note<textarea id="v5SubstituteNote" rows="2"></textarea></label><div id="v5SubstituteMsg" class="fileNote"></div><div class="supTwo"><button type="button" class="supBtn secondary" id="v5SubstituteCancel">Cancel</button><button>Send proposal</button></div></form>`);
  const select=document.getElementById('v5SubstituteItem');
  select.onchange=()=>{document.getElementById('v5SubstitutePrice').value=Number(select.selectedOptions[0]?.dataset.price||0)};
  document.getElementById('v5SubstituteCancel').onclick=closeSupModal;
  document.getElementById('v5SubstitutionForm').onsubmit=async e=>{
    e.preventDefault();try{
      await papi(`/api/supplier/orders/${poId}/substitutions`,{method:'POST',body:JSON.stringify({
        purchase_order_item_id:Number(item.id),
        substitute_catalog_item_id:Number(select.value),
        proposed_packs:Number(document.getElementById('v5SubstitutePacks').value),
        price_per_pack:Number(document.getElementById('v5SubstitutePrice').value),
        reason_code:document.getElementById('v5SubstituteReason').value,
        expected_available_date:document.getElementById('v5SubstituteDate').value||null,
        supplier_note:document.getElementById('v5SubstituteNote').value
      })});
      closeSupModal();ptoast('Substitution proposed. Waiting for Merchant approval.');await renderSupplierWorkspace(supSupplierSection);
    }catch(err){document.getElementById('v5SubstituteMsg').textContent=err.message}
  };
}
async function fulfilSupplierBackorder(id){
  try{
    await papi(`/api/supplier/backorders/${id}/fulfil`,{method:'POST',body:JSON.stringify({})});
    ptoast('Backorder is now available; confirmed quantity was updated explicitly.');await renderSupplierWorkspace('Today');
  }catch(e){ptoast(e.message)}
}

async function respondRel(id,accept){try{await papi(`/api/supplier/relationships/${id}/respond`,{method:'POST',body:JSON.stringify({accept})});ptoast(accept?'Merchant relationship accepted.':'Invitation declined.');await renderSupplierWorkspace('Procurement')}catch(e){ptoast(e.message)}}
async function editConnectedSupplierTerms(businessId){
  const current=await papi(`/api/supplier/relationships/${businessId}/terms`).catch(()=>null);
  openSupModal(`<h2>Merchant payment terms</h2><p class="supModalIntro">These are commercial terms for this connected Merchant. Saving them records Supplier-confirmed terms only.</p><form id="supplierTermsForm" class="supForm"><label>Terms<select id="supplierTermCode">${termOptions(current?.payment_term_code||'cod')}</select></label><div class="supTwo"><label>Custom days<input id="supplierCustomDays" type="number" min="0" max="365" value="${current?.custom_days??''}"></label><label>Credit limit ₱<input id="supplierCreditLimit" type="number" min="0" step="0.01" value="${current?.credit_limit??''}"></label></div><label>Note<input id="supplierTermNote" value="${ph(current?.note||'')}"></label><div id="supplierTermsMsg" class="fileNote"></div><div class="supTwo"><button type="button" class="supBtn secondary" id="supplierTermsCancel">Cancel</button><button>Save terms</button></div></form>`);
  document.getElementById('supplierTermsCancel').onclick=closeSupModal;
  document.getElementById('supplierTermsForm').onsubmit=async e=>{
    e.preventDefault();
    try{
      await papi(`/api/supplier/relationships/${businessId}/terms`,{method:'PUT',body:JSON.stringify({
        paymentTermCode:document.getElementById('supplierTermCode').value,
        customDays:document.getElementById('supplierCustomDays').value===''?null:Number(document.getElementById('supplierCustomDays').value),
        creditLimit:document.getElementById('supplierCreditLimit').value===''?null:Number(document.getElementById('supplierCreditLimit').value),
        note:document.getElementById('supplierTermNote').value
      })});
      closeSupModal();ptoast('Merchant payment terms confirmed.');await renderSupplierWorkspace('Procurement');
    }catch(err){document.getElementById('supplierTermsMsg').textContent=err.message}
  };
}
async function respondSupplierReturn(id,authorize){
  try{
    await papi(`/api/supplier/returns/${id}/respond`,{method:'POST',body:JSON.stringify({
      decision:authorize?'authorize':'reject',
      supplier_note:authorize?'Authorized by Supplier':'Rejected by Supplier'
    })});
    ptoast(authorize?'Return authorized.':'Return rejected.');await renderSupplierWorkspace('Procurement');
  }catch(e){ptoast(e.message)}
}
async function resolveSupplierReturn(id){
  openSupModal(`<h2>Resolve Merchant return</h2><p class="supModalIntro">Choose what was actually agreed after the physical return.</p><form id="supplierReturnResolve" class="supForm"><label>Resolution<select id="supplierResolutionType"><option value="credit">Credit</option><option value="refund_expected">Refund expected</option><option value="replacement">Replacement</option><option value="no_credit">No credit</option></select></label><label>Confirmed credit ₱<input id="supplierConfirmedCredit" type="number" min="0" step="0.01" value="0"></label><label>Supplier note<textarea id="supplierResolutionNote" rows="2"></textarea></label><div id="supplierResolutionMsg" class="fileNote"></div><div class="supTwo"><button type="button" class="supBtn secondary" id="supplierResolutionCancel">Cancel</button><button>Save resolution</button></div></form>`);
  document.getElementById('supplierResolutionCancel').onclick=closeSupModal;
  document.getElementById('supplierReturnResolve').onsubmit=async e=>{
    e.preventDefault();
    try{
      await papi(`/api/supplier/returns/${id}/resolve`,{method:'POST',body:JSON.stringify({
        resolution_type:document.getElementById('supplierResolutionType').value,
        confirmed_credit:Number(document.getElementById('supplierConfirmedCredit').value||0),
        supplier_note:document.getElementById('supplierResolutionNote').value
      })});
      closeSupModal();ptoast('Return resolution recorded.');await renderSupplierWorkspace('Procurement');
    }catch(err){document.getElementById('supplierResolutionMsg').textContent=err.message}
  };
}
async function issueSupplierRecall(){
  openSupModal(`<h2>Issue lot/batch recall</h2><p class="supModalIntro">Use the exact supplier lot/batch. Matching Merchant lots are quarantined in traceability. This does not itself prove or perform an FDA filing.</p><form id="supplierRecallForm" class="supForm"><label>Supplier lot / batch<input id="supplierRecallLot" required></label><label>Product name<input id="supplierRecallProduct"></label><div class="supTwo"><label>Notice<select id="supplierRecallLevel"><option value="recall">Recall</option><option value="withdrawal">Withdrawal</option><option value="advisory">Advisory</option></select></label><label>Requested action<select id="supplierRecallAction"><option value="isolate">Isolate</option><option value="return">Return</option><option value="review">Review</option><option value="destroy">Destroy</option></select></label></div><label>Reason<textarea id="supplierRecallReason" required rows="2"></textarea></label><label>Source/reference<input id="supplierRecallRef"></label><div id="supplierRecallMsg" class="fileNote"></div><div class="supTwo"><button type="button" class="supBtn secondary" id="supplierRecallCancel">Cancel</button><button>Issue notice</button></div></form>`);
  document.getElementById('supplierRecallCancel').onclick=closeSupModal;
  document.getElementById('supplierRecallForm').onsubmit=async e=>{
    e.preventDefault();
    try{
      const r=await papi('/api/supplier/recalls',{method:'POST',body:JSON.stringify({
        supplier_lot_code:document.getElementById('supplierRecallLot').value,
        product_name:document.getElementById('supplierRecallProduct').value,
        notice_level:document.getElementById('supplierRecallLevel').value,
        requested_action:document.getElementById('supplierRecallAction').value,
        reason:document.getElementById('supplierRecallReason').value,
        source_reference:document.getElementById('supplierRecallRef').value
      })});
      closeSupModal();ptoast(`Recall issued; ${Number(r.matched_lots||0)} lot match(es) quarantined.`);await renderSupplierWorkspace('Procurement');
    }catch(err){document.getElementById('supplierRecallMsg').textContent=err.message}
  };
}
async function supplierRespondPo(id){const p=await papi(`/api/procurement/orders/${id}`);openSupModal(`<h2>Respond to ${ph(p.po_number)}</h2><form id="supRespondPo" class="supForm"><div class="supProductPicker">${p.items.map(i=>`<div class="supPick"><div><strong>${ph(i.name_snapshot)}</strong><small>Ordered ${Number(i.ordered_packs)} ${ph(i.unit_name_snapshot)}</small></div><div><input data-confirm-item="${i.id}" type="number" min="0" max="${i.ordered_packs}" step="0.01" value="${i.confirmed_packs??i.ordered_packs}"><input data-price-item="${i.id}" type="number" min="0" step="0.01" value="${i.confirmed_price_per_pack??i.price_per_pack_snapshot}"></div></div>`).join('')}</div><div class="supTwo"><label>Ready date/time<input id="supReady" type="datetime-local" value="${ph(pmanilaInput(p.supplier_ready_at))}"></label><label>Delivery ETA<input id="supDeliveryEta" type="datetime-local" value="${ph(pmanilaInput(p.supplier_delivery_eta))}"></label></div><label>Supplier note<textarea id="supPoNote" rows="2">${ph(p.supplier_note||'')}</textarea></label><div id="supPoMsg" class="fileNote"></div><div class="supTwo"><button type="button" class="supBtn secondary" id="supPoReject">Reject</button><button>Accept / confirm</button></div></form>`);document.getElementById('supPoReject').onclick=async()=>{try{await papi(`/api/supplier/orders/${id}/respond`,{method:'POST',body:JSON.stringify({reject:true,supplier_note:document.getElementById('supPoNote').value})});closeSupModal();await renderSupplierWorkspace('Procurement')}catch(e){document.getElementById('supPoMsg').textContent=e.message}};document.getElementById('supRespondPo').onsubmit=async e=>{e.preventDefault();const items=p.items.map(i=>({item_id:i.id,confirmed_packs:Number(e.currentTarget.querySelector(`[data-confirm-item="${i.id}"]`).value),confirmed_price_per_pack:Number(e.currentTarget.querySelector(`[data-price-item="${i.id}"]`).value)}));try{await papi(`/api/supplier/orders/${id}/respond`,{method:'POST',body:JSON.stringify({items,supplier_ready_at:pmanilaIso(document.getElementById('supReady').value),supplier_delivery_eta:pmanilaIso(document.getElementById('supDeliveryEta').value),supplier_note:document.getElementById('supPoNote').value})});closeSupModal();ptoast('Purchase order confirmed.');await renderSupplierWorkspace('ETA')}catch(err){document.getElementById('supPoMsg').textContent=err.message}}}
async function setSupplierStatus(id,status){try{await papi(`/api/supplier/orders/${id}/status`,{method:'POST',body:JSON.stringify({status})});ptoast(`PO marked ${pnice(status)}.`);await renderSupplierWorkspace(['ready_for_pickup','out_for_delivery','delivered'].includes(status)?'Fulfilment':'ETA')}catch(e){ptoast(e.message)}}

function applySupplierState(detail){const state=detail?.snapshot?detail:window.BusinessLifeProfileState;if(state?.snapshot)supMe=state.snapshot}
async function decorateSupplier(detail){if(!ensureSup()||!ptok())return;const state=detail?.snapshot?detail:window.BusinessLifeProfileState;applySupplierState(state);if(!supMe)return;const role=state?.surface==='profile'?state.activeRole:null,hub=document.getElementById('roleHub');if(role==='merchant'){const top=document.querySelector('.shellProfileControls');if(top&&!document.getElementById('supQuickButton')){const b=document.createElement('button');b.id='supQuickButton';b.className='ordersQuickButton';b.type='button';b.textContent='Suppliers';b.onclick=openMerchantProcurement;top.insertAdjacentElement('beforebegin',b)}}else document.getElementById('supQuickButton')?.remove();if(hub&&role==='supplier')hub.querySelectorAll('[data-hub-feature]').forEach(b=>{if(SUPPLIER_SECTION_META[b.dataset.hubFeature])b.onclick=()=>openSupplierWorkspace(b.dataset.hubFeature)})}
function observeSupplier(){document.addEventListener('abl:profile-state',e=>decorateSupplier(e.detail).catch(()=>{}),{passive:true})}
async function boot(){ensureSup();observeSupplier();await decorateSupplier(window.BusinessLifeProfileState)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
