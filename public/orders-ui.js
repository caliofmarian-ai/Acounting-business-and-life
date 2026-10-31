import {orderReceivableAmount,ordersReceivableTotal} from './orders-receivable-view.js';
const ORDER_PROGRESS=['accepted','preparing','ready','completed'];
let orderMe=null,orderWorkspace=null,productsCache=[],productsLoadError='',directSaleInventory=[],directSaleInventoryError='',merchantBusinessId=null,ordersMode=null;
// Request authority is kept in memory. In particular, the opaque session marker
// must never be copied into browser storage, markup, URLs or diagnostic output.
let ordersViewEpoch=0,ordersRenderEpoch=0,ordersRequest=null,ordersOwner=null,orderModalEpoch=0,orderModalPreviousOverflow=null,ordersMutation=null;
function orderIdentity(){
  const state=window.BusinessLifeProfileState,accountId=Number(state?.accountId??state?.snapshot?.account?.id);
  return {accountId,session:window.ABLSession?.csrfToken?.(),surface:state?.surface,role:state?.activeRole,navigationEpoch:state?.navigationEpoch};
}
function sameOrderIdentity(a,b){return Boolean(a&&b&&a.accountId===b.accountId&&a.session===b.session&&a.surface===b.surface&&a.role===b.role&&a.navigationEpoch===b.navigationEpoch)}
function validOrderIdentity(identity,mode){return Boolean(orderToken()&&identity.accountId>0&&identity.surface==='profile'&&identity.role===mode)}
function clearOrderPickers(){productsCache=[];productsLoadError='';directSaleInventory=[];directSaleInventoryError=''}
function invalidateOrders({leave=false}={}){
  ordersViewEpoch++;ordersRequest=null;ordersMutation=null;clearOrderPickers();closeOrderModal();
  if(leave){ordersMode=null;ordersOwner=null;merchantBusinessId=null;if(orderWorkspace){orderWorkspace.classList.add('hidden');orderWorkspace.innerHTML=''}}
}
function selectedMerchantBusiness(){
  const cached=window.BusinessLifeAccounting?.getState?.(),id=Number(cached?.role==='merchant'?cached.activeBusinessId:null);
  const businesses=window.BusinessLifeProfileState?.snapshot?.businesses;
  return Number.isInteger(id)&&id>0&&Array.isArray(businesses)&&businesses.some(b=>Number(b.id)===id)?id:null;
}
function orderViewCurrent(context){
  if(!context||context.viewEpoch!==ordersViewEpoch||context.mode!==ordersMode||document.hidden||!ordersVisible())return false;
  const identity=orderIdentity();
  if(!validOrderIdentity(identity,context.mode)||!sameOrderIdentity(context.owner,identity))return false;
  const selected=context.mode==='merchant'?(selectedMerchantBusiness()??merchantBusinessId):null;
  return context.businessId==null||selected===context.businessId;
}
function orderReadCurrent(request){return ordersRequest===request&&orderViewCurrent(request)}
function orderOperation(form=null){return {owner:orderIdentity(),mode:ordersMode,viewEpoch:ordersViewEpoch,businessId:merchantBusinessId,renderEpoch:ordersRenderEpoch,form}}
function beginOrderMutation(operation){if(!orderOperationCurrent(operation)||(ordersMutation&&orderViewCurrent(ordersMutation)))return false;ordersRequest=null;ordersMutation=operation;return true}
function endOrderMutation(operation){if(ordersMutation===operation)ordersMutation=null}
function orderOperationCurrent(operation){return orderViewCurrent(operation)&&operation.renderEpoch===ordersRenderEpoch&&(!operation.form||document.getElementById(operation.form.id)===operation.form)}
function readOrders(mode,showLoading,force,load){
  const owner=orderIdentity();
  if(mode!==ordersMode||document.hidden||!ordersVisible())return Promise.resolve();
  if(!validOrderIdentity(owner,mode)||!sameOrderIdentity(owner,ordersOwner)){invalidateOrders({leave:true});return Promise.resolve()}
  // A refresh during a pending write must not render a pre-write snapshot and
  // replace the originating form. The write performs the single fresh read.
  if(ordersMutation&&orderViewCurrent(ordersMutation))return Promise.resolve();
  if(!force&&ordersRequest&&orderReadCurrent(ordersRequest))return ordersRequest.promise;
  const request={owner,mode,viewEpoch:ordersViewEpoch,businessId:mode==='merchant'?(selectedMerchantBusiness()??merchantBusinessId):null};
  ordersRequest=request;
  if(showLoading){ordersRenderEpoch++;orderWorkspace.innerHTML=header(mode==='merchant'?'Orders':'My Orders',mode==='merchant'?'Customer orders for the selected business':'Preparation, payment and pickup status in one place')+'<div class="ordersEmpty" role="status">Loading orders…</div>'}
  request.promise=(async()=>{
    try{await load(request)}catch(error){if(orderReadCurrent(request))ordersLoadError(error,mode)}
    finally{if(ordersRequest===request)ordersRequest=null}
  })();
  return request.promise;
}
const orderToken=()=>window.ABLSession?.authenticated()?'cookie-session':'';
const h=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const php=v=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(v)||0);
const nice=s=>String(s||'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
async function oapi(path,options={}){const headers={'Content-Type':'application/json',...(options.headers||{})};const r=await fetch(path,{...options,headers});const b=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(b.error||`Request failed (${r.status})`);e.data=b;throw e}return b}
function toast(msg){let t=document.getElementById('roleToast');if(t){t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600)}else alert(msg)}
function ensureWorkspace(){
  const shell=document.getElementById('shell');if(!shell)return false;
  if(!document.getElementById('ordersWorkspace')){orderWorkspace=document.createElement('section');orderWorkspace.id='ordersWorkspace';orderWorkspace.className='ordersWorkspace hidden';const top=shell.querySelector('.topbar');top?.insertAdjacentElement('afterend',orderWorkspace)}else orderWorkspace=document.getElementById('ordersWorkspace');
  if(!document.getElementById('orderModalBackdrop')){const m=document.createElement('div');m.id='orderModalBackdrop';m.className='orderModalBackdrop hidden';m.innerHTML='<div id="orderModal" class="orderModal"></div>';document.body.appendChild(m);m.onclick=e=>{if(e.target===m)closeOrderModal()}}
  return true;
}
function hideBase(){document.querySelectorAll('#shell > .view').forEach(v=>v.classList.add('hidden'));document.querySelector('.bottomNav')?.classList.add('hidden');document.getElementById('roleHub')?.classList.add('hidden')}
function closeOrders(){invalidateOrders({leave:true});window.BusinessLifeShell?.showActiveWorkspace?.()}
function header(title,subtitle){return `<div class="ordersHeader"><button class="ordersBack" type="button" data-orders-back>‹</button><div class="ordersHeaderCopy"><h1>${h(title)}</h1><p>${h(subtitle)}</p></div><button class="ordersRefresh" type="button" data-orders-refresh>Refresh</button></div>`}
function bindHeader(refresh){orderWorkspace.querySelector('[data-orders-back]').onclick=closeOrders;orderWorkspace.querySelector('[data-orders-refresh]').onclick=refresh}
function statusBadge(status){return `<span class="orderStatus ${h(status)}">${h(nice(status))}</span>`}
function progress(status){let idx=ORDER_PROGRESS.indexOf(status);if(status==='awaiting_payment'||status==='awaiting_customer_presence')idx=-1;return `<div class="customerOrderProgress">${ORDER_PROGRESS.map((_,i)=>`<span class="progressDot ${i<=idx?'done':''}"></span>`).join('')}</div>`}

async function openCustomerOrders(){
  if(ordersMode==='customer'&&ordersMutation&&orderViewCurrent(ordersMutation))return;
  if(ordersMode==='customer'&&ordersRequest&&orderReadCurrent(ordersRequest))return ordersRequest.promise;
  invalidateOrders({leave:true});ordersMode='customer';ordersOwner=orderIdentity();if(!validOrderIdentity(ordersOwner,ordersMode)||!ensureWorkspace())return;
  if(!window.BusinessLifeShell?.openFeatureWorkspace?.('ordersWorkspace')){hideBase();orderWorkspace.classList.remove('hidden')}
  await renderCustomerOrders()
}
function openCustomerDeliveries(){
  const api=window.BusinessLifeDelivery;
  if(api?.openCustomerDelivery)return api.openCustomerDelivery();
  const launcher=document.getElementById('roleHub')?.querySelector('[data-hub-feature="Delivery"]');
  if(launcher)return launcher.click();
  toast('Delivery is still loading. Try again in a moment.');
}
function renderCustomerOrders(showLoading=true,force=false){return readOrders('customer',showLoading,force,async request=>{
  const orders=await oapi('/api/orders/mine');if(!orderReadCurrent(request))return;
  ordersRenderEpoch++;
  const outstanding=ordersReceivableTotal(orders),active=orders.filter(o=>!['completed','cancelled'].includes(o.order_status)).length;
  orderWorkspace.innerHTML=header('My Orders','Preparation, payment and pickup status in one place')+`<div class="orderSummaryStrip"><div class="orderSummaryMetric"><small>Active</small><strong>${active}</strong></div><div class="orderSummaryMetric"><small>Total orders</small><strong>${orders.length}</strong></div><div class="orderSummaryMetric"><small>Amount due</small><strong>${php(outstanding)}</strong></div></div><div class="customerOrderTools"><button id="customerDeliveriesBtn" type="button"><span>📍</span><span><strong>My deliveries</strong><small>Live status, ETA and secure handoff for delivery orders</small></span><b>›</b></button></div><div class="customerOrdersList">${orders.length?orders.map(customerCard).join(''):'<div class="ordersEmpty">No orders yet. Your Marketplace orders will appear here.</div>'}</div>`;
  bindHeader(()=>renderCustomerOrders(true,true));
  document.getElementById('customerDeliveriesBtn')?.addEventListener('click',openCustomerDeliveries);
  const operation=orderOperation();
  orderWorkspace.querySelectorAll('[data-checkin]').forEach(b=>b.onclick=()=>customerCheckIn(Number(b.dataset.checkin),operation));
  orderWorkspace.querySelectorAll('[data-track]').forEach(b=>b.onclick=()=>window.open(`/track.html?t=${encodeURIComponent(b.dataset.track)}`,'_blank'));
})}

function orderBalanceCopy(o){const due=orderReceivableAmount(o);if(due>0)return `<small>Due ${php(due)}</small>`;return `<small>${o.order_status==='cancelled'?'No amount due':o.payment_status==='refunded'?'Refunded':o.payment_status==='paid'?'Paid':'No amount due'}</small>`}
function customerCard(o){const waiting=o.order_status==='awaiting_customer_presence';return `<article class="customerOrderCard"><div class="orderCardTop"><div class="orderCardMain"><strong>${h(o.business_name)} • ${h(o.order_number)}</strong><p>${h(nice(o.fulfilment_method))} • ${new Date(o.created_at).toLocaleString()}</p></div>${statusBadge(o.order_status)}</div>${progress(o.order_status)}<div class="orderMoney"><div><small>${h(nice(o.payment_status))} • ${h(nice(o.payment_method))}</small><strong>${php(o.total)}</strong></div>${orderBalanceCopy(o)}</div><div class="customerOrderFooter">${waiting?`<button class="checkInButton" data-checkin="${o.id}" type="button">I'm here</button>`:''}<button class="trackButton" data-track="${h(o.public_token)}" type="button">Track order</button></div></article>`}
async function customerCheckIn(id,operation=orderOperation()){if(!beginOrderMutation(operation))return;try{await oapi(`/api/orders/${id}/check-in`,{method:'POST',body:'{}'});endOrderMutation(operation);if(!orderOperationCurrent(operation))return;toast('Check-in sent to the Merchant.');await renderCustomerOrders(false,true)}catch(e){if(orderOperationCurrent(operation))toast(e.message)}finally{endOrderMutation(operation)}}

async function resolveMerchantBusiness(request){
  if(request.businessId!=null){merchantBusinessId=request.businessId;return request.businessId}
  const state=await oapi('/api/accounting/workspaces');
  if(!orderReadCurrent(request))return null;
  const id=Number(state?.active_business_id),selected=selectedMerchantBusiness();
  if(selected!=null&&selected!==id){
    // Hydration selected a different business while the unknown workspace was
    // loading. Start one current-business read; never dispatch the old pickers.
    merchantBusinessId=selected;renderMerchantOrders(true,true);return null;
  }
  if(!Number.isInteger(id)||id<1)throw new Error('Choose a Merchant business before opening Orders.');
  request.businessId=id;merchantBusinessId=id;
  return id;
}
function ordersLoadError(error,mode='merchant'){
  ordersRenderEpoch++;
  const message=error?.message||'Orders could not be loaded.';
  orderWorkspace.innerHTML=header(mode==='merchant'?'Orders':'My Orders',mode==='merchant'?'Customer orders for the selected business':'Preparation, payment and pickup status in one place')+`<section class="ordersEmpty ordersLoadError" role="alert"><strong>We couldn’t load Orders</strong><p>${h(message)}</p><button type="button" class="primaryAction" data-orders-retry>Try again</button></section>`;
  const retry=()=>mode==='merchant'?renderMerchantOrders(true,true):renderCustomerOrders(true,true);
  bindHeader(retry);orderWorkspace.querySelector('[data-orders-retry]')?.addEventListener('click',retry);
}
async function openMerchantOrders(){
  if(ordersMode==='merchant'&&ordersMutation&&orderViewCurrent(ordersMutation))return;
  if(ordersMode==='merchant'&&ordersRequest&&orderReadCurrent(ordersRequest))return ordersRequest.promise;
  invalidateOrders({leave:true});ordersMode='merchant';ordersOwner=orderIdentity();if(!validOrderIdentity(ordersOwner,ordersMode)||!ensureWorkspace())return;
  if(!window.BusinessLifeShell?.openFeatureWorkspace?.('ordersWorkspace')){hideBase();orderWorkspace.classList.remove('hidden')}
  await renderMerchantOrders()
}
async function loadProducts(businessId){
  try{return {items:await oapi(`/api/orders/products?business_id=${encodeURIComponent(businessId)}`),error:''}}
  catch(error){return {items:[],error:error?.message||'Counter catalog could not be loaded.'}}
}
async function loadDirectSaleInventory(businessId){
  try{return {items:await oapi(`/api/orders/inventory?business_id=${encodeURIComponent(businessId)}`),error:''}}
  catch(error){return {items:[],error:error?.message||'Inventory could not be loaded.'}}
}
function renderMerchantOrders(showLoading=true,force=false){return readOrders('merchant',showLoading,force,async request=>{
    const businessId=await resolveMerchantBusiness(request);if(businessId==null||!orderReadCurrent(request))return;
    const [orders,products,inventory]=await Promise.all([
      oapi(`/api/orders/merchant/list?business_id=${encodeURIComponent(businessId)}`),
      loadProducts(businessId),loadDirectSaleInventory(businessId)
    ]);
    if(!orderReadCurrent(request))return;
    productsCache=products.items;productsLoadError=products.error;directSaleInventory=inventory.items;directSaleInventoryError=inventory.error;
    ordersRenderEpoch++;
    const active=orders.filter(o=>!['completed','cancelled'].includes(o.order_status));const due=ordersReceivableTotal(orders);
    const lanes=[['Waiting',['awaiting_customer_presence','awaiting_payment']],['Accepted',['accepted']],['Preparing',['preparing']],['Ready',['ready','handoff_to_delivery']]];
    orderWorkspace.innerHTML=header('Orders','Customer orders for the selected business')+`<div class="orderSummaryStrip"><div class="orderSummaryMetric"><small>Active</small><strong>${active.length}</strong></div><div class="orderSummaryMetric"><small>Ready</small><strong>${orders.filter(o=>o.order_status==='ready').length}</strong></div><div class="orderSummaryMetric"><small>Receivable</small><strong>${php(due)}</strong></div></div>${directSaleProductForm()}${counterForm()}<div class="ordersBoard">${lanes.map(([name,statuses])=>lane(name,orders.filter(o=>statuses.includes(o.order_status)))).join('')}</div>`;
    bindHeader(()=>renderMerchantOrders(true,true));bindDirectSaleProductForm();bindCounterForm();bindMerchantActions();
})}
function directSaleProductForm(){
  const options=directSaleInventory.map(i=>{const available=Number(i.available_quantity??i.usable_quantity??i.quantity),reserved=Number(i.reserved_quantity||0);return `<option value="${i.id}" data-unit="${h(i.unit)}">${h(i.item)} — ${available.toLocaleString('en-PH',{maximumFractionDigits:4})} ${h(i.unit)} available${reserved>0?' · '+reserved.toLocaleString('en-PH',{maximumFractionDigits:4})+' reserved':''}</option>`}).join('');
  const unavailable=!directSaleInventory.length;
  const inventoryMessage=directSaleInventoryError?`<div class="ordersInlineError" role="alert">${h(directSaleInventoryError)}</div>`:unavailable?'<div class="directSaleHint">Add stock in Inventory before creating a direct-sale product.</div>':'<div class="directSaleHint">The product is created as Private. Publish it later from My Storefront when you are ready.</div>';
  return `<details class="orderCreateCard orderDirectSaleCard"><summary class="orderDirectSaleSummary"><span><strong>+ Add a direct-sale product</strong><small>Fresh, packaged or non-food resale from existing stock</small></span><b>Add</b></summary><form id="ordersDirectProductForm" class="orderCreateGrid"><label>Product type<select id="ordersDirectKind"><option value="fresh_direct">Fresh / direct food</option><option value="packaged_resale">Packaged food resale</option><option value="non_food_resale">Non-food resale</option></select></label><label>Product name<input id="ordersDirectName" required placeholder="Carrots"></label><label>Stock source<select id="ordersDirectInventory" required ${unavailable?'disabled':''}>${options||'<option value="">Add stock first</option>'}</select></label><div class="orderCreateGrid two"><label>Stock used per sold unit<input id="ordersDirectStockQty" type="number" min="0.0001" step="0.0001" value="1" required></label><label>Stored unit<input id="ordersDirectStockUnit" value="${h(directSaleInventory[0]?.unit||'unit')}" readonly></label></div><div class="orderCreateGrid two"><label>Category<input id="ordersDirectCategory" value="General"></label><label>Selling price ₱<input id="ordersDirectPrice" type="number" min="0" step="0.01" required></label></div><label>Customer description<textarea id="ordersDirectDescription" rows="2"></textarea></label><div id="ordersDirectProductPreview" class="directSaleHint"></div>${inventoryMessage}<div class="orderCreateActions"><button class="createOrderPrimary" type="submit" ${unavailable?'disabled':''}>Add product</button></div><div id="ordersDirectProductMessage" class="directSaleHint"></div></form></details>`
}
function bindDirectSaleProductForm(){
  const form=document.getElementById('ordersDirectProductForm'),inventory=document.getElementById('ordersDirectInventory');
  if(!form||!inventory)return;
  const operation=orderOperation(form),field=id=>form.querySelector('#'+id);
  const sync=()=>{
    if(!orderOperationCurrent(operation))return;
    const option=inventory.selectedOptions?.[0],unit=option?.dataset?.unit||'unit';
    const stored=field('ordersDirectStockUnit');if(stored)stored.value=unit;
    const qty=Number(field('ordersDirectStockQty')?.value||0);
    const preview=field('ordersDirectProductPreview');
    if(preview)preview.textContent=qty>0?`Each sale consumes ${qty} ${unit} from ${option?.textContent?.split(' — ')[0]||'stock'}.`:'Enter how much stock one sold unit consumes.'
  };
  inventory.onchange=sync;
  field('ordersDirectStockQty')?.addEventListener('input',sync);
  sync();
  form.onsubmit=async e=>{
    e.preventDefault();if(!orderOperationCurrent(operation))return;
    const msg=field('ordersDirectProductMessage');
    if(msg)msg.textContent='';
    const inventoryId=Number(inventory.value),quantityPerUnit=Number(field('ordersDirectStockQty')?.value);
    if(!Number.isInteger(inventoryId)||inventoryId<1){if(msg)msg.textContent='Choose a stock item first.';return}
    if(!Number.isFinite(quantityPerUnit)||quantityPerUnit<=0){if(msg)msg.textContent='Enter a valid stock quantity per sold unit.';return}
    if(!beginOrderMutation(operation))return;
    try{
      const option=inventory.selectedOptions?.[0],unit=option?.dataset?.unit||'unit';
      await oapi('/api/merchant/storefront/products',{method:'POST',body:JSON.stringify({
        business_id:operation.businessId,
        product_kind:field('ordersDirectKind').value,
        name:field('ordersDirectName').value,
        inventory_id:inventoryId,
        quantity_per_unit:quantityPerUnit,
        unit_code:`${quantityPerUnit} ${unit}`,
        category:field('ordersDirectCategory').value,
        selling_price:Number(field('ordersDirectPrice').value),
        description:field('ordersDirectDescription').value,
        published:false
      })});
      endOrderMutation(operation);if(!orderOperationCurrent(operation))return;
      toast('Direct-sale product added as Private. Publish it from My Storefront when ready.');
      await renderMerchantOrders(false,true)
    }catch(err){if(orderOperationCurrent(operation)&&msg)msg.textContent=err.message}finally{endOrderMutation(operation)}
  }
}
function counterProductRow(p,{additional=false}={}){
  const source=p.source_kind||'product',key=`${source}:${p.id}`;
  const variants=p.variant_mode?`<label>Variant<select data-counter-variant><option value="">Choose a variant</option>${(p.variants||[]).map(v=>`<option value="${v.id}" ${v.in_stock?'':'disabled'}>${h((v.option_values||[]).map(x=>x.value_label).join(' / ')||v.variant_key)} · ${php(v.price_override??p.selling_price)}${v.in_stock?'':' · Out of stock'}</option>`).join('')}</select></label>`:'';
  const modifiers=(p.modifier_groups||[]).map(g=>`<fieldset class="counterModifierGroup"><legend>${h(g.name)} · choose ${g.min_select===g.max_select?g.min_select:`${g.min_select}–${g.max_select}`}</legend>${g.options.map(o=>`<label><input type="checkbox" data-counter-modifier="${o.id}"><span>${h(o.name)}${Number(o.price_delta)?' + '+php(o.price_delta):''}</span></label>`).join('')}</fieldset>`).join('');
  const choices=p.variant_mode||(p.modifier_groups||[]).length?`<button type="button" class="counterChoiceButton" data-counter-add-line="${h(key)}" ${p.available===false?'disabled':''}>Add another choice</button>`:'';
  const remove=additional?'<button type="button" class="counterChoiceButton" data-counter-remove-line>Remove this line</button>':'';
  return `<div class="counterProduct" data-counter-key="${h(key)}"><div><strong>${h(p.name)}</strong><small>${h(p.category)} • ${php(p.selling_price)}${p.published===false?' · Private':''}${p.available===false?' · '+h(nice(p.blocked_reason||'unavailable')):''}</small>${variants}${modifiers}${choices}${remove}</div><input type="number" min="0" step="1" value="0" data-counter-product="${p.id}" data-counter-source="${h(source)}" aria-label="Quantity for ${h(p.name)}" ${p.available===false?'disabled':''}></div>`
}
function counterForm(){return `<section class="orderCreateCard"><h2>+ New counter order</h2><p>Create a present/walk-in order without leaving the Merchant workspace. Active private Catalog items are available here.</p><form id="counterOrderForm" class="orderCreateGrid"><div class="orderCreateGrid two"><label>Customer name<input id="counterCustomer" placeholder="Walk-in customer"></label><label>Payment<select id="counterPayment"><option value="cash">Cash</option><option value="online">Online / digital</option></select></label></div><div class="counterProducts">${productsCache.length?productsCache.map(p=>counterProductRow(p)).join(''):productsLoadError?`<div class="ordersEmpty ordersInlineError" role="alert">Counter catalog could not be loaded. Use Refresh to try again.<small>${h(productsLoadError)}</small></div>`:'<div class="ordersEmpty">Create active products in Catalog first.</div>'}</div><label>Order note<textarea id="counterNote" rows="2" placeholder="No onions, extra sauce…"></textarea></label><div class="orderCreateActions"><button class="createOrderPrimary" type="submit">Create order</button></div><div id="counterMessage" class="avatarHint"></div></form></section>`}
function counterOrderItems(f){
  return [...f.querySelectorAll('[data-counter-product]')].map(i=>{
    const row=i.closest('.counterProduct'),variant=row.querySelector('[data-counter-variant]');
    return{product_id:Number(i.dataset.counterProduct),source_kind:i.dataset.counterSource||'product',quantity:Number(i.value),
      variant_id:variant?.value?Number(variant.value):null,
      modifier_option_ids:[...row.querySelectorAll('[data-counter-modifier]:checked')].map(option=>Number(option.dataset.counterModifier))}
  }).filter(i=>i.quantity>0)
}
function bindCounterForm(){
  const f=document.getElementById('counterOrderForm');if(!f)return;
  const operation=orderOperation(f),catalog=productsCache,field=id=>f.querySelector('#'+id);
  f.onclick=event=>{
    if(!orderOperationCurrent(operation))return;
    const add=event.target.closest('[data-counter-add-line]');
    if(add){
      const product=catalog.find(p=>`${p.source_kind||'product'}:${p.id}`===add.dataset.counterAddLine);
      if(product)add.closest('.counterProduct').insertAdjacentHTML('afterend',counterProductRow(product,{additional:true}));
      return;
    }
    event.target.closest('[data-counter-remove-line]')?.closest('.counterProduct')?.remove();
  };
  f.onsubmit=async e=>{
    e.preventDefault();if(!orderOperationCurrent(operation))return;const items=counterOrderItems(f),msg=field('counterMessage');msg.textContent='';
    if(!items.length){msg.textContent='Choose at least one product.';return}
    if(items.some(i=>catalog.find(p=>p.id===i.product_id&&p.source_kind===i.source_kind)?.variant_mode&&!i.variant_id)){msg.textContent='Choose a variant for each selected product.';return}
    if(!beginOrderMutation(operation))return;
    try{
      await oapi('/api/orders/merchant/create',{method:'POST',body:JSON.stringify({business_id:operation.businessId,customer_name:field('counterCustomer').value||'Walk-in customer',items,fulfilment_method:'pickup',payment_method:field('counterPayment').value,counter_presence:true,note:field('counterNote').value})});
      endOrderMutation(operation);if(!orderOperationCurrent(operation))return;
      toast('Order created.');await renderMerchantOrders(false,true)
    }catch(err){if(orderOperationCurrent(operation))msg.textContent=err.message}finally{endOrderMutation(operation)}
  }
}

function lane(name,orders){return `<section class="orderLane"><div class="orderLaneHeader"><h2>${h(name)}</h2><span>${orders.length}</span></div><div class="orderCards">${orders.length?orders.map(merchantCard).join(''):'<div class="ordersEmpty">Nothing here</div>'}</div></section>`}
function merchantCard(o){const due=orderReceivableAmount(o)>0.001;let actions='';if(o.order_status==='awaiting_customer_presence')actions+=`<button class="warmAction" data-action="presence" data-id="${o.id}">Presence verified</button>`;if(o.order_status==='awaiting_payment')actions+=`<button class="primaryAction" data-action="payment" data-id="${o.id}">Record payment</button>`;if(o.order_status==='accepted')actions+=`<button class="primaryAction" data-action="start" data-id="${o.id}">Start preparing</button>`;if(o.order_status==='preparing')actions+=`<button class="primaryAction" data-action="ready" data-id="${o.id}">Mark ready</button>`;if(o.order_status==='ready'){if(due)actions+=`<button class="warmAction" data-action="payment" data-id="${o.id}">Record payment</button>`;if(o.fulfilment_method==='pickup')actions+=`<button class="primaryAction" data-action="complete" data-id="${o.id}" data-due="${due?'1':'0'}">Complete</button>`;else actions+=`<button class="primaryAction" data-action="handoff" data-id="${o.id}">Delivery handoff</button>`}if(!['completed','cancelled'].includes(o.order_status))actions+=`<button class="dangerAction" data-action="cancel" data-id="${o.id}">Cancel</button>`;return `<article class="orderCard"><div class="orderCardTop"><div class="orderCardMain"><strong>${h(o.order_number||`Order ${o.id}`)}</strong><p>${h(o.customer_name_snapshot||o.customer_account_name||'Customer')} • ${h(nice(o.fulfilment_method))}</p></div>${statusBadge(o.order_status)}</div><div class="orderMoney"><div><small>${h(nice(o.payment_status))}</small><strong>${php(o.total)}</strong></div>${orderBalanceCopy(o)}</div>${o.customer_checked_in_at&&!o.presence_confirmed_at?'<div class="miniBadge" style="margin-top:8px">Customer checked in</div>':''}<div class="orderActions">${actions}</div></article>`}
function bindMerchantActions(){const operation=orderOperation();orderWorkspace.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>merchantAction(b.dataset.action,Number(b.dataset.id),b.dataset.due==='1',operation))}
async function merchantAction(action,id,due,operation=orderOperation()){
  if(!orderOperationCurrent(operation))return;
  if(action==='payment')return openPaymentModal(id,operation);
  if(action==='cancel')return openCancelModal(id,operation);
  if(!beginOrderMutation(operation))return;
  try{
    if(action==='presence')await oapi(`/api/orders/merchant/${id}/confirm-presence`,{method:'POST',body:JSON.stringify({manual_confirmation:true})});
    else if(action==='start')await oapi(`/api/orders/merchant/${id}/start`,{method:'POST',body:'{}'});
    else if(action==='ready')await oapi(`/api/orders/merchant/${id}/ready`,{method:'POST',body:'{}'});
    else if(action==='handoff')await oapi(`/api/orders/merchant/${id}/handoff`,{method:'POST',body:'{}'});
    else if(action==='complete'){const allowCredit=due?confirm('This order still has an amount due. Complete it as customer credit/receivable?'):false;await oapi(`/api/orders/merchant/${id}/complete`,{method:'POST',body:JSON.stringify({allow_credit:allowCredit})})}
    endOrderMutation(operation);if(!orderOperationCurrent(operation))return;
    toast('Order updated.');await renderMerchantOrders(false,true)
  }catch(e){if(orderOperationCurrent(operation))toast(e.data?.shortages?`${e.message}: ${e.data.shortages.map(s=>`${s.item} short ${Number(s.short).toFixed(2)}`).join(', ')}`:e.message)}finally{endOrderMutation(operation)}
}
function openOrderModal(){orderModalEpoch++;const backdrop=document.getElementById('orderModalBackdrop');if(backdrop?.classList.contains('hidden'))orderModalPreviousOverflow=document.body.style.overflow;backdrop?.classList.remove('hidden');document.body.style.overflow='hidden';return orderModalEpoch}
function closeOrderModal(){orderModalEpoch++;const backdrop=document.getElementById('orderModalBackdrop');if(backdrop&&!backdrop.classList.contains('hidden')&&orderModalPreviousOverflow!==null)document.body.style.overflow=orderModalPreviousOverflow;orderModalPreviousOverflow=null;backdrop?.classList.add('hidden')}
function orderModalCurrent(operation,epoch,form){return orderOperationCurrent(operation)&&epoch===orderModalEpoch&&document.getElementById(form.id)===form&&!document.getElementById('orderModalBackdrop')?.classList.contains('hidden')}
function openPaymentModal(id,operation=orderOperation()){
  if(!orderOperationCurrent(operation)||(ordersMutation&&orderViewCurrent(ordersMutation)&&!ordersMutation.modal))return;
  operation={...operation,modal:true};
  const m=document.getElementById('orderModal');
  m.innerHTML=`<h2>Record received payment</h2><form id="orderPaymentForm" class="orderModalForm"><label>Amount ₱<input id="orderPayAmount" type="number" min="0.01" step="0.01" required></label><label>Received into<select id="orderPayAccount"><option value="cash">Cash</option><option value="gcash">GCash</option><option value="bank">Bank</option><option value="other">Other</option></select></label><label>Reference (optional)<input id="orderPayRef" placeholder="GCash reference, receipt…"></label><div class="orderModalMessage" id="orderModalMessage"></div><div class="orderModalButtons"><button class="cancelModal" type="button">Cancel</button><button class="saveModal">Confirm received</button></div></form>`;
  const epoch=openOrderModal(),form=m.querySelector('#orderPaymentForm'),field=id=>form.querySelector('#'+id),current=()=>orderModalCurrent(operation,epoch,form);
  m.querySelector('.cancelModal').onclick=closeOrderModal;
  oapi(`/api/orders/${id}`).then(o=>{if(!current())return;field('orderPayAmount').value=Number(o.outstanding_amount).toFixed(2);field('orderPayAccount').value=o.payment_method==='cash'?'cash':'gcash'}).catch(error=>{if(current())field('orderModalMessage').textContent=error.message});
  form.onsubmit=async e=>{
    e.preventDefault();if(!current()||!beginOrderMutation(operation))return;
    try{
      await oapi(`/api/orders/merchant/${id}/payment`,{method:'POST',body:JSON.stringify({amount:Number(field('orderPayAmount').value),account:field('orderPayAccount').value,provider_reference:field('orderPayRef').value})});
      endOrderMutation(operation);if(!current())return;
      closeOrderModal();toast('Payment recorded.');await renderMerchantOrders(false,true)
    }catch(err){if(current())field('orderModalMessage').textContent=err.message}finally{endOrderMutation(operation)}
  }
}
function openCancelModal(id,operation=orderOperation()){
  if(!orderOperationCurrent(operation)||(ordersMutation&&orderViewCurrent(ordersMutation)&&!ordersMutation.modal))return;
  operation={...operation,modal:true};
  const m=document.getElementById('orderModal');
  m.innerHTML=`<h2>Cancel order</h2><form id="orderCancelForm" class="orderModalForm"><label>Reason<textarea id="orderCancelReason" rows="3" required placeholder="Why is this order being cancelled?"></textarea></label><div class="orderModalMessage" id="orderModalMessage"></div><div class="orderModalButtons"><button class="cancelModal" type="button">Keep order</button><button class="saveModal" style="background:#c7484a">Cancel order</button></div></form>`;
  const epoch=openOrderModal(),form=m.querySelector('#orderCancelForm'),field=id=>form.querySelector('#'+id),current=()=>orderModalCurrent(operation,epoch,form);
  m.querySelector('.cancelModal').onclick=closeOrderModal;
  form.onsubmit=async e=>{
    e.preventDefault();if(!current()||!beginOrderMutation(operation))return;
    try{
      await oapi(`/api/orders/merchant/${id}/cancel`,{method:'POST',body:JSON.stringify({reason:field('orderCancelReason').value})});
      endOrderMutation(operation);if(!current())return;
      closeOrderModal();toast('Order cancelled and stock reversed if needed.');await renderMerchantOrders(false,true)
    }catch(err){if(current())field('orderModalMessage').textContent=err.message}finally{endOrderMutation(operation)}
  }
}

function applyOrderState(detail){const state=detail?.snapshot?detail:window.BusinessLifeProfileState;if(state?.snapshot)orderMe=state.snapshot}
async function decorate(detail){if(!ensureWorkspace()||!orderToken())return;const state=detail?.snapshot?detail:window.BusinessLifeProfileState;applyOrderState(state);if(!orderMe)return;const role=state?.surface==='profile'?state.activeRole:null;const hub=document.getElementById('roleHub');if(hub&&role==='customer'){const orderTile=hub.querySelector('[data-hub-feature="Orders"]');if(orderTile)orderTile.onclick=openCustomerOrders}}
function ordersVisible(){return Boolean(orderWorkspace&&!orderWorkspace.classList.contains('hidden'))}
function refreshVisibleOrders(){
  if(document.hidden||!ordersVisible())return;
  if(ordersMode==='merchant')renderMerchantOrders(false).catch(()=>{});
  else if(ordersMode==='customer')renderCustomerOrders(false).catch(()=>{});
}
function reconcileOrderBusiness(id){
  if(ordersMode!=='merchant'||!ordersVisible()||!Number.isInteger(id)||id<1||id===merchantBusinessId||id===ordersRequest?.businessId)return;
  invalidateOrders();merchantBusinessId=id;renderMerchantOrders().catch(()=>{});
}
function observe(){
  document.addEventListener('abl:profile-state',e=>{
    if(ordersMode&&!sameOrderIdentity(ordersOwner,orderIdentity()))invalidateOrders({leave:true});
    else if(ordersMode==='merchant')reconcileOrderBusiness(selectedMerchantBusiness());
    decorate(e.detail).catch(()=>{});
  },{passive:true});
  document.addEventListener('abl:business-workspace-changed',e=>{
    if(e.detail?.role==='merchant'&&orderIdentity().role==='merchant')reconcileOrderBusiness(selectedMerchantBusiness());
  },{passive:true});
  document.addEventListener('abl:feature-workspace',e=>{if(ordersMode&&e.detail?.workspaceId!=='ordersWorkspace')invalidateOrders({leave:true})},{passive:true});
  document.addEventListener('abl:auth-expired',()=>invalidateOrders({leave:true}),{passive:true});
  document.addEventListener('visibilitychange',()=>{if(!ordersMode)return;if(document.hidden)invalidateOrders();else refreshVisibleOrders()},{passive:true});
}

async function boot(){ensureWorkspace();observe();await decorate(window.BusinessLifeProfileState)}
window.BusinessLifeOrders=Object.freeze({openMerchantOrders,openCustomerOrders,closeOrders});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
