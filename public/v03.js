import {createInventoryCountUi} from './inventory-count-ui.js';
import {createInventoryScanUi} from './inventory-scan-ui.js';
const $ = (id) => document.getElementById(id);
let token = false;
let transactions = [];
let inventory = [];
let stockAdjustmentLots = [];
let restockSuggestions = [];
let wasteAnalyticsDays = 7;
let products = [];
let recipeDraft = [];
let allergenCatalog = [];
let currentProductAllergenSummary = null;
const money = (v) => new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP',maximumFractionDigits:2}).format(Number(v||0));
const num = (v,d=3) => Number(v||0).toLocaleString('en-PH',{maximumFractionDigits:d});
const UNIT_META={
  g:{family:'mass',base:'g',factor:1},kg:{family:'mass',base:'g',factor:1000},
  ml:{family:'volume',base:'ml',factor:1},L:{family:'volume',base:'ml',factor:1000},
  unit:{family:'count',base:'unit',factor:1}
};
const STOCK_PICKER_CATALOG=[
  {category:'Meat & poultry',type:'ingredient',storage:{condition:'chilled',area:'fridge',label:'',segregated:false},items:[
    ['Chicken thighs / drumsticks','kg'],['Chicken leg quarters','kg'],['Chicken breast','kg'],['Whole chicken','kg'],
    ['Pork belly','kg'],['Pork shoulder','kg'],['Ground pork','kg'],['Pork ribs','kg'],['Beef brisket','kg'],['Beef sirloin','kg'],
    ['Ground beef','kg'],['Chicken liver','kg']
  ]},
  {category:'Fish & seafood',type:'ingredient',storage:{condition:'chilled',area:'fridge',label:'',segregated:false},items:[
    ['Bangus (milkfish)','kg'],['Tilapia','kg'],['Galunggong','kg'],['Tuna','kg'],['Squid','kg'],['Shrimp','kg'],['Mussels','kg']
  ]},
  {category:'Vegetables & herbs',type:'ingredient',storage:{condition:'chilled',area:'fridge',label:'',segregated:false},items:[
    ['Onion','kg'],['Garlic','kg'],['Ginger','kg'],['Tomato','kg'],['Carrot','kg'],['Cabbage','kg'],['Eggplant','kg'],
    ['Green papaya','kg'],['Radish','kg'],['String beans','kg'],['Pechay','kg'],['Kangkong','kg'],['Malunggay leaves','kg'],
    ['Green chili','kg'],['Bell pepper','kg'],['Potato','kg'],['Sweet potato','kg'],['Lemongrass','kg'],['Spring onion','kg']
  ]},
  {category:'Fruit & citrus',type:'ingredient',storage:{condition:'chilled',area:'fridge',label:'',segregated:false},items:[
    ['Calamansi','kg'],['Banana','kg'],['Mango','kg'],['Pineapple','kg'],['Coconut','unit'],['Lime','kg']
  ]},
  {category:'Rice, noodles & dry goods',type:'ingredient',storage:{condition:'dry',area:'pantry',label:'',segregated:false},items:[
    ['Rice','kg'],['Canton noodles','kg'],['Rice noodles','kg'],['Flour','kg'],['Cornstarch','kg'],['Breadcrumbs','kg'],
    ['Ground toasted rice','kg'],['White sugar','kg'],['Brown sugar','kg'],['Salt','kg'],['Black pepper','kg'],['Bay leaves','unit']
  ]},
  {category:'Sauces, condiments & seasonings',type:'ingredient',storage:{condition:'ambient',area:'pantry',label:'',segregated:false},items:[
    ['Soy sauce','L'],['Cane vinegar','L'],['Fish sauce','L'],['Oyster sauce','L'],['Sweet chili sauce','L'],
    ['Banana ketchup','L'],['Mayonnaise','kg'],['Peanut butter','kg'],['Shrimp paste (bagoong)','kg'],['Annatto oil','L'],
    ['Annatto powder','kg'],['Sinigang mix','unit'],['Vanilla extract','L']
  ]},
  {category:'Eggs, dairy & canned milk',type:'ingredient',storage:{condition:'chilled',area:'fridge',label:'',segregated:false},items:[
    ['Eggs','unit'],['Condensed milk','unit'],['Evaporated milk','unit'],['Fresh milk','L'],['Butter','kg'],['Cheese','kg']
  ]},
  {category:'Cooking oils & fats',type:'ingredient',storage:{condition:'ambient',area:'pantry',label:'',segregated:false},items:[
    ['Cooking oil','L'],['Coconut oil','L'],['Margarine','kg']
  ]},
  {category:'Wrappers, canned & packaged ingredients',type:'ingredient',storage:{condition:'dry',area:'pantry',label:'',segregated:false},items:[
    ['Lumpia wrappers','unit'],['Coconut milk','L'],['Canned sardines','unit'],['Canned tuna','unit'],['Tomato sauce','L'],
    ['Tomato paste','kg']
  ]},
  {category:'Drinks & beverage supplies',type:'ingredient',storage:{condition:'ambient',area:'service_storage',label:'',segregated:false},items:[
    ['Bottled water','unit'],['Soft drinks','unit'],['Coffee','kg'],['Tea','unit'],['Ice','kg']
  ]},
  {category:'Takeout & delivery packaging',type:'packaging',storage:{condition:'dry',area:'service_storage',label:'',segregated:false},items:[
    ['Meal boxes / takeout boxes','unit'],['Microwavable food containers','unit'],['Container lids','unit'],
    ['Paper bowls','unit'],['Soup cups / tubs','unit'],['Sauce cups','unit'],['Sauce cup lids','unit'],
    ['Paper bags','unit'],['Takeout carrier bags','unit'],['Pizza boxes','unit'],['Aluminum trays','unit'],
    ['Clamshell containers','unit'],['Ziplock bags','unit'],['Sealing film','unit'],['Packaging tape','unit']
  ]},
  {category:'Disposable service items',type:'packaging',storage:{condition:'dry',area:'service_storage',label:'',segregated:false},items:[
    ['Napkins / tissue','unit'],['Disposable spoons','unit'],['Disposable forks','unit'],['Disposable knives','unit'],
    ['Chopsticks','unit'],['Straws','unit'],['Wooden stirrers','unit'],['Paper plates','unit'],
    ['Plastic cups','unit'],['Paper cups','unit'],['Cup lids','unit']
  ]},
  {category:'Kitchen prep consumables',type:'kitchen_consumable',storage:{condition:'dry',area:'service_storage',label:'',segregated:false},items:[
    ['Cling wrap','unit'],['Aluminum foil','unit'],['Wax paper','unit'],['Greaseproof paper','unit'],
    ['Parchment / baking paper','unit'],['Food storage bags','unit'],['Food labels','unit'],
    ['Date labels / stickers','unit'],['Permanent markers','unit'],['Disposable piping bags','unit']
  ]},
  {category:'Cleaning & sanitation',type:'cleaning_sanitation',storage:{condition:'ambient',area:'chemical_storage',label:'Chemical storage',segregated:true},items:[
    ['Dishwashing liquid','L'],['Food-safe sanitizer','L'],['Bleach / disinfectant','L'],['Hand soap','L'],
    ['Degreaser','L'],['Glass cleaner','L'],['Floor cleaner','L'],['Sponges','unit'],['Scouring pads','unit'],
    ['Dishcloths','unit'],['Cleaning towels','unit'],['Paper towels','unit'],['Mop heads','unit'],
    ['Trash bags - black','unit'],['Trash bags - green','unit'],['Trash bags - yellow','unit']
  ]},
  {category:'Food handling & hygiene',type:'hygiene',storage:{condition:'dry',area:'service_storage',label:'',segregated:false},items:[
    ['Disposable food gloves','unit'],['Hairnets','unit'],['Face masks','unit'],['Aprons','unit'],
    ['Sleeve covers','unit'],['Disposable caps','unit']
  ]},
  {category:'Storage & organization supplies',type:'operational_supply',storage:{condition:'dry',area:'service_storage',label:'',segregated:false},items:[
    ['Food storage containers','unit'],['Ingredient bins','unit'],['Cambro-style containers','unit'],
    ['Storage container lids','unit'],['Shelf labels','unit'],['FIFO labels','unit']
  ]},
  {category:'Front counter & operations',type:'operational_supply',storage:{condition:'dry',area:'service_storage',label:'',segregated:false},items:[
    ['Receipt paper rolls','unit'],['Order paper / kitchen tickets','unit'],['Pens','unit'],
    ['Thermal labels','unit'],['Delivery stickers / tamper seals','unit']
  ]}
];

const STORAGE_CONDITION_LABELS={ambient:'Ambient',dry:'Dry',chilled:'Chilled',frozen:'Frozen',other:'Not set / other'};
const STORAGE_AREA_LABELS={pantry:'Pantry / dry food storage',fridge:'Fridge / chiller',freezer:'Freezer',prep_station:'Prep station',chemical_storage:'Chemical storage',service_storage:'Service / supplies storage',other:'Other / not set'};
function storageSuggestionFor(group,itemName=''){
  const base={...(group?.storage||{condition:'other',area:'other',label:'',segregated:false})};
  if(itemName==='Ice')return{condition:'frozen',area:'freezer',label:'',segregated:false};
  if(['Condensed milk','Evaporated milk'].includes(itemName))return{condition:'ambient',area:'pantry',label:'',segregated:false};
  return base;
}
function storageSuggestionForType(type='ingredient'){
  if(type==='cleaning_sanitation')return{condition:'ambient',area:'chemical_storage',label:'Chemical storage',segregated:true};
  if(['packaging','kitchen_consumable','hygiene','operational_supply'].includes(type))return{condition:'dry',area:'service_storage',label:'',segregated:false};
  return{condition:'other',area:'other',label:'',segregated:false};
}
function applyStockStorageSuggestion(suggestion={}){
  if($('stockStorageCondition'))$('stockStorageCondition').value=suggestion.condition||'other';
  if($('stockStorageArea'))$('stockStorageArea').value=suggestion.area||'other';
  if($('stockStorageLocation'))$('stockStorageLocation').value=suggestion.label||'';
  if($('stockStorageSegregated'))$('stockStorageSegregated').checked=Boolean(suggestion.segregated);
  updateStockStorageHint();
}
function storageSafetyMessage({type,condition,area,label,segregated}){
  if(type==='cleaning_sanitation'){
    if(['pantry','fridge','freezer','prep_station'].includes(area))return{ok:false,text:'Cleaning & sanitation stock must be stored separately from food.'};
    if(area==='chemical_storage'&&!segregated)return{ok:false,text:'Chemical storage must be marked as segregated from food.'};
    if(['service_storage','other'].includes(area)&&(!segregated||!String(label||'').trim()))return{ok:false,text:'Choose a named segregated storage location for cleaning & sanitation stock.'};
  }
  if(['ingredient','packaging','kitchen_consumable','hygiene'].includes(type)&&area==='chemical_storage')return{ok:false,text:'Food, packaging and food-handling stock cannot be stored in chemical storage.'};
  if(area==='fridge'&&condition!=='chilled')return{ok:false,text:'Fridge storage should use the Chilled condition.'};
  if(area==='freezer'&&condition!=='frozen')return{ok:false,text:'Freezer storage should use the Frozen condition.'};
  if(condition==='chilled'&&!['fridge','other'].includes(area))return{ok:false,text:'Chilled stock needs a fridge or a labelled custom cold-storage area.'};
  if(condition==='frozen'&&!['freezer','other'].includes(area))return{ok:false,text:'Frozen stock needs a freezer or a labelled custom frozen-storage area.'};
  if(['chilled','frozen'].includes(condition)&&area==='other'&&!String(label||'').trim())return{ok:false,text:'Custom chilled/frozen storage needs a location label.'};
  return{ok:true,text:'Storage context looks consistent. Lots received for this item keep a storage snapshot for traceability.'};
}
function updateStockStorageHint(){
  const out=$('stockStorageHint');if(!out)return;
  const result=storageSafetyMessage({
    type:$('stockInventoryType')?.value||'ingredient',
    condition:$('stockStorageCondition')?.value||'other',
    area:$('stockStorageArea')?.value||'other',
    label:$('stockStorageLocation')?.value||'',
    segregated:Boolean($('stockStorageSegregated')?.checked)
  });
  out.innerHTML=`<strong class="${result.ok?'positive':'negative'}">${result.ok?'Storage check':'Storage warning'}</strong><br><span class="muted">${esc(result.text)}</span>`;
}
function initStockPicker(){
  const category=$('stockCategoryPicker'),item=$('stockItemPicker');
  if(!category||!item)return;
  category.replaceChildren(new Option('Choose a category',''),...STOCK_PICKER_CATALOG.map(group=>new Option(group.category,group.category)));
  const renderItems=()=>{
    const group=STOCK_PICKER_CATALOG.find(x=>x.category===category.value);
    item.replaceChildren();
    if(group&&$('stockInventoryType'))$('stockInventoryType').value=group.type||'ingredient';
    if(group)applyStockStorageSuggestion(storageSuggestionFor(group,''));
    if(!group){
      item.append(new Option('Choose a category first',''));
      item.disabled=true;
      return;
    }
    item.disabled=false;
    item.append(new Option('Choose an item',''));
    for(const [name,unit] of group.items){
      const option=new Option(name,name);
      option.dataset.unit=unit;
      item.append(option);
    }
  };
  category.addEventListener('change',renderItems);
  item.addEventListener('change',()=>{
    const option=item.selectedOptions?.[0];
    if(!option?.value)return;
    if($('stockInventoryId'))$('stockInventoryId').value='';
    $('stockItem').value=option.value;
    const unit=option.dataset.unit||'unit';
    const group=STOCK_PICKER_CATALOG.find(x=>x.category===category.value);
    if($('stockInventoryType'))$('stockInventoryType').value=group?.type||'ingredient';
    applyStockStorageSuggestion(storageSuggestionFor(group,option.value));
    syncUnitSelect('stockPurchaseUnit',unit);
    syncUnitSelect('stockReorderUnit',unit);
    stockPurchasePreview();
  });
  $('stockInventoryType')?.addEventListener('change',()=>{
    if(!category.value)applyStockStorageSuggestion(storageSuggestionForType($('stockInventoryType').value));
    else updateStockStorageHint();
  });
  for(const id of ['stockStorageCondition','stockStorageArea','stockStorageLocation'])$(id)?.addEventListener('change',updateStockStorageHint);
  $('stockStorageLocation')?.addEventListener('input',updateStockStorageHint);
  $('stockStorageSegregated')?.addEventListener('change',updateStockStorageHint);
  $('stockItem')?.addEventListener('input',()=>{if($('stockInventoryId'))$('stockInventoryId').value='';});
  renderItems();
  updateStockStorageHint();
}
function unitMeta(unit){return UNIT_META[unit]||UNIT_META[String(unit||'').toLowerCase()]||null}
function toBase(qty,unit){const m=unitMeta(unit),q=Number(qty);return m&&Number.isFinite(q)&&q>0?{family:m.family,base:m.base,qty:q*m.factor}:null}
function syncUnitSelect(selectId,unit){const el=$(selectId);if(!el)return;const candidate=String(unit||'');if([...el.options].some(o=>o.value===candidate))el.value=candidate}
function stockPurchasePreview(){
  const out=$('stockPurchasePreview');if(!out)return;
  const x=toBase($('stockPurchaseQty')?.value,$('stockPurchaseUnit')?.value),cost=Number($('stockTotalCost')?.value||0);
  if(!x||!Number.isFinite(cost)||cost<0){out.textContent='Enter a purchase quantity and total cost.';return}
  const unitCost=x.qty>0?cost/x.qty:0,alert=Math.max(0,Number($('stockReorderQty')?.value||0)),targetInput=Math.max(0,Number($('stockTargetQty')?.value||0)),target=targetInput>0?targetInput:alert,levelUnit=$('stockReorderUnit')?.value||x.base;
  if(targetInput>0&&targetInput<alert){out.innerHTML='<strong class="negative">Restock target must be equal to or higher than the low-stock alert.</strong>';return}
  out.innerHTML=`Stored as <strong>${num(x.qty,4)} ${esc(x.base)}</strong> • calculated cost <strong>${money(unitCost)} / ${esc(x.base)}</strong> • notify below <strong>${num(alert,4)} ${esc(levelUnit)}</strong> • target <strong>${num(target,4)} ${esc(levelUnit)}</strong>`;
}
const esc = (v='') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cacheKey = (key) => `abl_cache_${key}`;

function setOnline(ok){const el=$('onlineState');if(!el)return;el.textContent=ok?'Online':'Offline';el.classList.toggle('offline',!ok)}
async function api(path,options={}){
  const headers={'Content-Type':'application/json',...(options.headers||{})};
  try{
    const r=await fetch(path,{...options,headers});
    if(r.status===401){logout();const e=new Error('Please log in again.');e.status=401;throw e}
    if(!r.ok){const body=await r.json().catch(()=>({error:'Request failed'}));const e=new Error(body.error||'Request failed');e.status=r.status;e.data=body;throw e}
    setOnline(true);return r.headers.get('content-type')?.includes('application/json')?r.json():r.text();
  }catch(e){if(!e.status)setOnline(false);throw e}
}
async function cachedJson(path,key){try{const data=await api(path);localStorage.setItem(cacheKey(key),JSON.stringify(data));return data}catch(e){if(e.status===401)throw e;const cached=localStorage.getItem(cacheKey(key));if(cached)return JSON.parse(cached);throw e}}
let baseActiveRole=window.BusinessLifeProfileState?.activeRole||null;
function isMerchantBaseActive(){return baseActiveRole==='merchant'}
function logout(){token=false;baseActiveRole=null;window.ABLSession?.clearReadableSession();$('shell').classList.add('hidden');$('login').classList.remove('hidden')}
function showShell(){$('login').classList.add('hidden');$('shell').classList.remove('hidden')}
function typeLabel(t){return({sale:'Sale',business_expense:'Business expense',money_received:'Money received',personal_withdrawal:'Personal withdrawal',adjustment:'Adjustment'})[t]||t}
function accountLabel(a){return({cash:'Cash',gcash:'GCash',bank:'Bank',other:'Other'})[a]||a}
function signedAmount(t,a){return['business_expense','personal_withdrawal'].includes(t)?`−${money(a)}`:`+${money(a)}`}
function emptyRow(text){const d=document.createElement('div');d.className='emptyState';d.textContent=text;return d}
function txRow(tx,editable=false){
  const d=document.createElement('div');d.className='listRow';const negative=['business_expense','personal_withdrawal'].includes(tx.type);const canCorrect=editable&&!['remittance','product_sale'].includes(tx.source);
  const manual=!tx.source;
  d.innerHTML=`<div class="rowMain"><strong>${esc(typeLabel(tx.type))}${manual?' · Manual ledger entry':''}</strong><small>${esc(tx.category||'Other')} • ${esc(accountLabel(tx.account||tx.payment_method||'cash'))}${tx.note?` • ${esc(tx.note)}`:''}${tx.source==='remittance'?' • remittance':''}${tx.source==='product_sale'?' • menu sale':''}${manual?' • not confirmed payment evidence':''}</small></div><div class="rowRight"><span class="${negative?'negative':'positive'}">${esc(signedAmount(tx.type,tx.amount))}</span>${canCorrect?'<div class="ledgerRowActions"><button class="miniBtn editLedgerEntry" type="button">Correct</button>'+(Number(tx.amount)!==0?'<button class="miniBtn voidLedgerEntry" type="button">Void test entry</button>':'')+'</div>':''}</div>`;
  if(canCorrect){d.querySelector('.editLedgerEntry').onclick=()=>openEdit(tx);d.querySelector('.voidLedgerEntry')?.addEventListener('click',()=>voidManualEntry(tx))}return d;
}
function remitRow(r){const d=document.createElement('div');d.className='listRow';const diff=Number(r.difference_php||0);d.innerHTML=`<div class="rowMain"><strong>${esc(r.provider||'Remittance')} • ${esc(r.sent_currency)} ${Number(r.sent_amount).toFixed(2)}</strong><small>Received ${esc(money(r.received_php))} into ${esc(accountLabel(r.account))}${r.reference?` • ${esc(r.reference)}`:''}</small></div><div class="rowRight"><span class="${diff<0?'negative':diff>0?'positive':''}">${r.expected_php!=null?`Δ ${esc(money(diff))}`:''}</span></div>`;return d}
function analysisRows(data){if(!data.categories?.length)return[emptyRow('No spending recorded in this period.')];return data.categories.map(x=>{const d=document.createElement('div');d.className='listRow';d.innerHTML=`<div class="rowMain"><strong>${esc(x.category)}</strong><small>${x.kind==='business'?'Business':'Personal'}</small></div><span>${esc(money(x.total))}</span>`;return d})}

$('loginForm').addEventListener('submit',async e=>{e.preventDefault();$('loginError').textContent='';try{await api('/api/login',{method:'POST',body:JSON.stringify({pin:$('pin').value})});token=Boolean(window.ABLSession?.authenticated());showShell()}catch(err){$('loginError').textContent=err.message}});

let merchantTodayCache=null;
let merchantTodayPromise=null;
let merchantTodayBusinessId=null;

function currentMerchantBusinessId(){
  const id=Number(window.BusinessLifeAccounting?.getState?.()?.activeBusinessId);
  return Number.isInteger(id)&&id>0?id:null;
}
function invalidateMerchantToday(){
  merchantTodayCache=null;
  merchantTodayPromise=null;
  merchantTodayBusinessId=null;
}
function todayChip(label,value,{muted=false}={}){
  const n=Number(value||0);
  return '<span class="todayChip '+(n>0&&!muted?'attention':'')+'"><strong>'+n+'</strong>'+esc(label)+'</span>';
}
function renderMerchantToday(data){
  if(!data)return;
  merchantTodayCache=data;
  merchantTodayBusinessId=Number(data.business?.id)||currentMerchantBusinessId();
  $('todayBusinessName').textContent=data.business?.name||'Current business';
  $('todayOrdersTotal').textContent=String(Number(data.orders?.attention_total||0));
  $('todayOrdersHeadline').textContent=Number(data.orders?.attention_total||0)>0?'Orders need attention':'No active order work';
  $('todayOrderChips').innerHTML=[
    todayChip('Waiting',data.orders?.waiting_customer),
    todayChip('Payment',data.orders?.awaiting_payment),
    todayChip('Accepted',data.orders?.accepted),
    todayChip('Preparing',data.orders?.preparing),
    todayChip('Ready',Number(data.orders?.ready||0)+Number(data.orders?.delivery_handoff||0))
  ].join('');
  $('todayOrdersCopy').textContent=Number(data.orders?.attention_total||0)>0
    ?'Open Orders to handle the next customer action.'
    :'New customer work will appear here.';

  $('todayInventoryTotal').textContent=String(Number(data.inventory?.attention_total||0));
  $('todayInventoryHeadline').textContent=Number(data.inventory?.expired_lots||0)>0
    ?'Expired stock needs action'
    :Number(data.inventory?.held_lots||0)>0?'Held stock needs review'
    :Number(data.inventory?.out_of_stock||0)>0?'Out-of-stock items need action'
    :Number(data.inventory?.expiring_soon||0)>0?'Stock is expiring soon'
    :Number(data.inventory?.low_stock||0)>0?'Low stock needs attention':'Stock looks clear';
  const inv=Array.isArray(data.inventory?.items)?data.inventory.items:[];
  const exp=Array.isArray(data.inventory?.expiry_items)?data.inventory.expiry_items:[];
  const lowRows=inv.map(x=>{const blocked=Number(x.blocked_quantity||0),stock=blocked>0?'usable '+num(x.usable_quantity??x.quantity,4)+' / physical '+num(x.physical_quantity??x.quantity,4):num(x.usable_quantity??x.quantity,4);return '<div><strong>'+esc(x.item)+'</strong><span>'+stock+' '+esc(x.unit)+' · reorder '+num(x.reorder_level,4)+'</span></div>'});
  const expiryRows=exp.map(x=>{
    const date=x.expires_at?new Date(x.expires_at).toLocaleDateString('en-PH',{timeZone:'Asia/Manila'}):'';
    const status=x.expiry_status==='expired'?'EXPIRED':x.expiry_status==='held'?'HELD':'EXPIRING SOON';
    return '<div><strong>'+esc(x.item)+(x.lot_code?' · '+esc(x.lot_code):'')+'</strong><span>'+esc(status)+(date?' · '+esc(date):'')+' · '+num(x.quantity,4)+' '+esc(x.unit)+'</span></div>';
  });
  const inventoryRows=[...expiryRows,...lowRows].slice(0,8);
  $('todayInventoryItems').innerHTML=inventoryRows.length
    ?inventoryRows.join('')
    :'<div class="todayEmpty">No low-stock or expiry attention.</div>';
  const expiryAttention=Number(data.inventory?.expired_lots||0)+Number(data.inventory?.expiring_soon||0)+Number(data.inventory?.held_lots||0);
  $('todayInventoryCopy').textContent=expiryAttention>0
    ?String(expiryAttention)+' lot attention signal(s) · '+String(Number(data.inventory?.low_stock||0))+' low-stock item(s).'
    :Number(data.inventory?.source_attention||0)>0
      ?String(Number(data.inventory.source_attention))+' low-stock item(s) already have supplier-source evidence.'
      :'Only recorded Inventory is shown; catalog items never create fake stock.';

  $('todaySupplierTotal').textContent=String(Number(data.supplier?.attention_total||0));
  $('todaySupplierHeadline').textContent=Number(data.supplier?.decisions_required||0)>0
    ?'Supplier changes need a decision'
    :Number(data.supplier?.rfqs_to_compare||0)>0?'Quotes are ready to compare'
    :Number(data.supplier?.received_unpaid||0)>0?'Received stock is still unpaid':'No supplier decisions';
  $('todaySupplierChips').innerHTML=[
    todayChip('Decisions',data.supplier?.decisions_required),
    todayChip('Quotes',data.supplier?.rfqs_to_compare),
    todayChip('Waiting RFQ',data.supplier?.rfqs_waiting_supplier,{muted:true}),
    todayChip('Received unpaid',data.supplier?.received_unpaid)
  ].join('');

  $('todayCatalogTotal').textContent=String(Number(data.catalog?.attention_total||0));
  $('todayCatalogHeadline').textContent=Number(data.catalog?.attention_total||0)>0?'Catalog needs review':'Catalog is ready';
  const catalogChips=[
    todayChip('Unpublished',data.catalog?.unpublished),
    todayChip('Unavailable',data.catalog?.unavailable),
    todayChip('Missing media',data.catalog?.missing_media),
    todayChip('AI review',data.catalog?.ai_drafts_to_review)
  ];
  if(data.presentation?.food_modules_enabled)catalogChips.push(todayChip('Recipe',data.catalog?.recipe_attention));
  $('todayCatalogChips').innerHTML=catalogChips.join('');
  $('todayCatalogCopy').textContent=data.presentation?.merchant_domain==='non_food'
    ?'Non-food catalog checks use stock, publication and media evidence — never recipe requirements.'
    :'Publishing, media, availability and food-recipe evidence for this business.';

  $('todayMoneyReceived').textContent=money(data.money?.confirmed_received);
  $('todayCompletedSales').textContent=money(data.money?.completed_sales);
  $('todayAwaitingPayment').textContent=money(data.money?.awaiting_payment);
  $('todayBusinessExpenses').textContent=money(data.money?.business_expenses);
  $('todayFoodActions').classList.toggle('hidden',!data.presentation?.food_modules_enabled);
  const stamp=data.generated_at?new Date(data.generated_at):new Date();
  $('todayUpdatedAt').textContent='Updated '+stamp.toLocaleTimeString('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'});
  $('todayLoading').classList.add('hidden');
  $('todayError').classList.add('hidden');
  $('todayContent').classList.remove('hidden');
  document.dispatchEvent(new CustomEvent('abl:merchant-today-data',{detail:{business:data.business,presentation:data.presentation,workspace:data.workspace||null}}));
}
function merchantTodayLoading(){
  $('todayError')?.classList.add('hidden');
  $('todayContent')?.classList.add('hidden');
  $('todayLoading')?.classList.remove('hidden');
}
function merchantTodayError(error){
  $('todayLoading')?.classList.add('hidden');
  $('todayContent')?.classList.add('hidden');
  $('todayError')?.classList.remove('hidden');
  if($('todayErrorMessage'))$('todayErrorMessage').textContent=error?.message||'Check your connection and try again.';
}
async function loadMerchantToday({force=false}={}){
  if(!isMerchantBaseActive()||!$('viewDashboard'))return null;
  const activeId=currentMerchantBusinessId();
  if(!force&&merchantTodayCache&&(!activeId||Number(merchantTodayBusinessId)===activeId)){
    renderMerchantToday(merchantTodayCache);
    return merchantTodayCache;
  }
  if(!force&&merchantTodayPromise)return merchantTodayPromise;
  merchantTodayLoading();
  merchantTodayPromise=api('/api/merchant/today')
    .then(data=>{renderMerchantToday(data);return data})
    .catch(error=>{merchantTodayError(error);throw error})
    .finally(()=>{merchantTodayPromise=null});
  return merchantTodayPromise;
}
window.BusinessLifeMerchantToday=Object.freeze({
  getState:()=>({data:merchantTodayCache,workspace:merchantTodayCache?.workspace||null,businessId:merchantTodayBusinessId}),
  load:options=>loadMerchantToday(options)
});
async function openMerchantAction(action){
  document.querySelectorAll('.bottomNav button').forEach(b=>b.classList.toggle('active',b.dataset.merchantAction===action));
  if(action==='orders'){
    if(window.BusinessLifeOrders?.openMerchantOrders)return window.BusinessLifeOrders.openMerchantOrders();
    return document.getElementById('ordersQuickButton')?.click();
  }
  if(action==='catalog'){
    if(window.BusinessLifeMarketplace?.openMerchantStore)return window.BusinessLifeMarketplace.openMerchantStore();
    return document.getElementById('marketQuickButton')?.click();
  }
  if(action==='suppliers'){
    if(window.BusinessLifeSuppliers?.openMerchantProcurement)return window.BusinessLifeSuppliers.openMerchantProcurement();
    return document.getElementById('supQuickButton')?.click();
  }
  if(action==='inventory')return setView('Stock');
  if(action==='money')return setView('Money');
  if(action==='quick-sale')return setView('Sell');
  if(action==='recipes')return setView('Menu');
}
async function loadMerchantView(name){
  if(!isMerchantBaseActive())return;
  if(name==='Dashboard')return loadMerchantToday();
  if(name==='Money'){
    document.dispatchEvent(new CustomEvent('abl:merchant-money-opened'));
    return Promise.all([loadDay(),loadRemittances(),loadAnalysis(7),loadAnalysis(30)]);
  }
  if(name==='Stock')return loadStock();
  if(name==='Sell')return Promise.all([loadStock(),loadProducts()]);
  if(name==='Menu')return Promise.all([loadStock(),loadProducts(),loadProductSales(),loadProfitability(7),loadProfitability(30)]);
  if(name==='History')return loadTransactions();
}

async function loadSummary(){
  const s=await cachedJson('/api/summary','summary');$('availableTotal').textContent=money(s.available_total);$('todaySales').textContent=money(s.today_sales);$('todayProfit').textContent=money(s.today_profit);$('bizExpenses').textContent=money(s.business_expenses);$('personalWithdrawals').textContent=money(s.personal_withdrawals);$('moneyReceived').textContent=money(s.money_received);$('remittanceReceived').textContent=`Remittances: ${money(s.remittance_received)}`;$('acctCash').textContent=money(s.accounts?.cash);$('acctGcash').textContent=money(s.accounts?.gcash);$('acctBank').textContent=money(s.accounts?.bank);$('acctOther').textContent=money(s.accounts?.other);$('lowStock').textContent=s.low_stock;
  $('menuRevenueToday').textContent=money(s.product_today_revenue);$('menuCogsToday').textContent=money(s.product_today_cogs);$('menuGrossToday').textContent=money(s.product_today_gross_profit);$('menuMarginToday').textContent=`${Number(s.product_today_margin_pct||0).toFixed(1)}% • ${num(s.product_today_portions)} portions`;
  const box=$('warningBox'),warnings=s.warnings||[];box.classList.toggle('hidden',!warnings.length);box.innerHTML=warnings.map(w=>`<div>⚠ ${esc(w)}</div>`).join('');
}
async function loadTransactions(){const tx=await cachedJson('/api/transactions','transactions');transactions=tx;$('recentList').replaceChildren(...(tx.length?tx.slice(0,8).map(t=>txRow(t,false)):[emptyRow('No transactions yet.')]));$('historyList').replaceChildren(...(tx.length?tx.map(t=>txRow(t,true)):[emptyRow('No transactions yet.')]))}
function restockNeedLabel(x){
  const current=Number(x.usable_quantity??x.quantity??0),threshold=Number(x.reorder_level||0),target=Number(x.effective_target_level??x.target_level??threshold),unit=x.inventory_base_unit||x.unit||'unit';
  const gap=Math.max(0,threshold-current),targetGap=Math.max(0,target-current);
  return gap>0
    ?`${num(gap,4)} ${esc(unit)} below alert • replenish ${num(targetGap,4)} ${esc(unit)} toward target ${num(target,4)}`
    :`At the ${num(threshold,4)} ${esc(unit)} alert level • target ${num(target,4)} ${esc(unit)}`;
}
function restockSupplierGroup(items,supplierBusinessId){
  const group=document.createElement('div');group.className='restockSupplierGroup card stack';group.dataset.supplierBusinessId=String(supplierBusinessId);
  const supplierName=items[0]?.supplier_name||'Preferred Supplier';
  const estimated=items.reduce((sum,x)=>sum+(Number.isFinite(Number(x.price_per_pack))?Number(x.suggested_packs||0)*Number(x.price_per_pack):0),0);
  const head=document.createElement('div');head.className='sectionHead';
  head.innerHTML=`<div><strong>${esc(supplierName)}</strong><small class="muted">${items.length} item${items.length===1?'':'s'} • grouped restock request${estimated>0?' • approx. '+money(estimated):''}</small></div><span class="positive">Preferred Supplier</span>`;
  group.appendChild(head);
  for(const x of items){
    const row=document.createElement('div');row.className='listRow restockReviewRow';
    const usable=Number(x.usable_quantity??x.quantity??0),physical=Number(x.physical_quantity??x.quantity??0),blocked=Number(x.blocked_quantity||0),target=Number(x.effective_target_level??x.target_level??x.reorder_level??0);
    const stockCopy=blocked>0?`usable ${num(usable,4)} ${esc(x.unit||'')} • physical ${num(physical,4)} • blocked ${num(blocked,4)}`:`usable ${num(usable,4)} ${esc(x.unit||'')}`;
    const min=Math.max(1,Number(x.minimum_packs||1)),suggested=Math.max(min,Number(x.suggested_packs||min));
    row.innerHTML=`<div class="rowMain"><strong>${esc(x.item)}</strong><small>${restockNeedLabel(x)}<br>${stockCopy} • target ${num(target,4)} ${esc(x.unit||'')}${Number.isFinite(Number(x.price_per_pack))?' • '+money(x.price_per_pack)+' / '+esc(x.unit_name||'pack'):''}</small></div><label class="restockPackEditor"><span>Packs</span><input type="number" min="${min}" step="1" value="${suggested}" data-restock-inventory="${Number(x.inventory_id)}" /></label>`;
    group.appendChild(row);
  }
  const actions=document.createElement('div');actions.className='stack';
  actions.innerHTML='<div class="salePreview">Review the quantities above. Sending this request does not create a purchase order, payment or received stock.</div><button type="button" class="secondary restockGroupSend">Prepare Supplier request</button><div class="restockGroupMessage"></div>';
  group.appendChild(actions);
  actions.querySelector('.restockGroupSend').onclick=()=>sendSupplierRestockRequest(group,items);
  return group;
}
function renderRestockList(rows=[]){
  const list=$('restockList'),summary=$('restockSummary');if(!list||!summary)return;
  restockSuggestions=Array.isArray(rows)?rows:[];
  summary.textContent=restockSuggestions.length?`${restockSuggestions.length} item${restockSuggestions.length===1?'':'s'} need restocking toward their Target / Par level.`:'No items currently need restocking.';
  const groups=new Map(),unsourced=[];
  for(const x of restockSuggestions){
    const preferred=x.source_status==='PREFERRED_SOURCE'&&Number(x.supplier_business_id)>0&&Number(x.suggested_packs)>0;
    if(!preferred){unsourced.push(x);continue}
    const key=Number(x.supplier_business_id);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(x);
  }
  const nodes=[];
  for(const [supplierBusinessId,items] of groups)nodes.push(restockSupplierGroup(items,supplierBusinessId));
  if(unsourced.length){
    const box=document.createElement('div');box.className='restockSupplierGroup card stack';
    box.innerHTML='<div class="sectionHead"><div><strong>Supplier needed</strong><small class="muted">These items have no comparable preferred Supplier source yet.</small></div><span class="negative">'+unsourced.length+' item(s)</span></div>';
    for(const x of unsourced){
      const row=document.createElement('div');row.className='listRow';
      const target=Number(x.effective_target_level??x.target_level??x.reorder_level??0);
      row.innerHTML=`<div class="rowMain"><strong>${esc(x.item)}</strong><small>${restockNeedLabel(x)} • target ${num(target,4)} ${esc(x.unit||'')}</small></div><span class="negative">${esc(x.source_status==='NOT_COMPARABLE'?'Unit mismatch':'Supplier needed')}</span>`;
      box.appendChild(row);
    }
    nodes.push(box);
  }
  list.replaceChildren(...(nodes.length?nodes:[emptyRow('Nothing is below its low-stock alert level.')]));
}
async function loadRestockSuggestions(){
  try{
    const rows=await api('/api/procurement/reorder-suggestions');
    renderRestockList(rows);
    return rows;
  }catch(error){
    const list=$('restockList'),summary=$('restockSummary');restockSuggestions=[];
    if(summary)summary.textContent='Restock list could not be loaded.';
    if(list)list.replaceChildren(emptyRow(error.message||'Supplier restock information is unavailable.'));
    return [];
  }
}
async function sendSupplierRestockRequest(group,items){
  const button=group?.querySelector('.restockGroupSend'),message=group?.querySelector('.restockGroupMessage');
  if(button){button.disabled=true;button.textContent='Sending…'}if(message)message.textContent='';
  try{
    const payloadItems=[...group.querySelectorAll('[data-restock-inventory]')].map(input=>({
      inventory_id:Number(input.dataset.restockInventory),
      requested_packs:Number(input.value)
    }));
    if(payloadItems.some(x=>!Number.isInteger(x.inventory_id)||!Number.isFinite(x.requested_packs)||x.requested_packs<=0))throw new Error('Review every requested pack quantity.');
    const supplierBusinessId=Number(group.dataset.supplierBusinessId);
    const result=await api('/api/procurement/restock-requests',{method:'POST',body:JSON.stringify({
      supplier_business_id:supplierBusinessId,
      currency_code:'PHP',
      items:payloadItems,
      note:'Grouped low-stock replenishment request prepared from Merchant Inventory.'
    })});
    if(button){button.textContent='Request sent';button.disabled=true}
    if(message)message.innerHTML=`<strong>Restock request #${esc(result.id)} sent.</strong> ${result.items?.length||payloadItems.length} item(s) shared with ${esc(result.supplier_name||items[0]?.supplier_name||'Supplier')}.`;
  }catch(error){
    if(button){button.disabled=false;button.textContent='Prepare Supplier request'}
    if(message)message.textContent=error.message||'Could not send the grouped Supplier request.';
  }
}
function baseQuantityForDisplay(value,unit){
  const meta=unitMeta(unit);if(!meta)return Number(value||0);
  return Number(value||0)/Number(meta.factor||1);
}
function fillRestockSettingsEditor(){
  const select=$('restockSettingsInventory');if(!select)return;
  const previous=select.value;
  select.innerHTML=inventory.length?'<option value="">Choose an item</option>'+inventory.map(i=>`<option value="${i.id}">${esc(i.item)}</option>`).join(''):'<option value="">Add stock first</option>';
  if(previous&&inventory.some(i=>String(i.id)===String(previous)))select.value=previous;
  loadRestockSettingsItem();
}
function loadRestockSettingsItem(){
  const item=inventory.find(i=>Number(i.id)===Number($('restockSettingsInventory')?.value)),out=$('restockSettingsPreview');
  if(!item){if(out)out.textContent='Choose an item to review its replenishment levels.';return}
  const preferredUnit=item.last_purchase_unit&&unitMeta(item.last_purchase_unit)?.family===unitMeta(item.base_unit||item.unit)?.family?item.last_purchase_unit:(item.base_unit||item.unit||'unit');
  syncUnitSelect('restockSettingsUnit',preferredUnit);
  $('restockSettingsAlert').value=baseQuantityForDisplay(item.reorder_level,preferredUnit);
  $('restockSettingsTarget').value=Number(item.target_level)>0?baseQuantityForDisplay(item.target_level,preferredUnit):0;
  updateRestockSettingsPreview();
}
function updateRestockSettingsPreview(){
  const item=inventory.find(i=>Number(i.id)===Number($('restockSettingsInventory')?.value)),out=$('restockSettingsPreview');if(!out)return;
  if(!item){out.textContent='Choose an item to review its replenishment levels.';return}
  const alert=Math.max(0,Number($('restockSettingsAlert').value||0)),targetInput=Math.max(0,Number($('restockSettingsTarget').value||0)),target=targetInput>0?targetInput:alert,unit=$('restockSettingsUnit').value;
  const invalid=targetInput>0&&targetInput<alert;
  out.innerHTML=invalid
    ?'<strong class="negative">Target must be equal to or higher than the low-stock alert.</strong>'
    :`Notify when usable stock reaches <strong>${num(alert,4)} ${esc(unit)}</strong>. Replenishment suggestions aim for <strong>${num(target,4)} ${esc(unit)}</strong>.`;
}
const inventoryCountUi=createInventoryCountUi({
  api,
  getInventory:()=>inventory,
  refreshInventory:()=>loadStock(),
  escapeHtml:esc,
  formatNumber:num,
  storageAreaLabels:STORAGE_AREA_LABELS
});
inventoryCountUi.wire();

function useInventoryForReceiving(item){
  if(!item)return;
  if($('stockInventoryId'))$('stockInventoryId').value=String(item.id||'');
  if($('stockItem'))$('stockItem').value=item.item||'';
  if($('stockInventoryType'))$('stockInventoryType').value=item.inventory_type||'ingredient';
  if($('stockStorageCondition'))$('stockStorageCondition').value=item.storage_condition||'other';
  if($('stockStorageArea'))$('stockStorageArea').value=item.storage_area_type||'other';
  if($('stockStorageLocation'))$('stockStorageLocation').value=item.storage_location_label||'';
  if($('stockStorageSegregated'))$('stockStorageSegregated').checked=Boolean(item.storage_segregated);
  syncUnitSelect('stockPurchaseUnit',item.last_purchase_unit||item.base_unit||item.unit||'unit');
  syncUnitSelect('stockReorderUnit',item.base_unit||item.unit||'unit');
  if($('stockReorderQty'))$('stockReorderQty').value=Number(item.reorder_level||0);
  if($('stockTargetQty'))$('stockTargetQty').value=Number(item.target_level||0);
  if($('stockLotCode'))$('stockLotCode').value='';
  if($('stockExpiry'))$('stockExpiry').value='';
  updateStockStorageHint();
  stockPurchasePreview();
  $('stockForm')?.scrollIntoView({behavior:'smooth',block:'start'});
  $('stockPurchaseQty')?.focus();
}

const inventoryScanUi=createInventoryScanUi({
  api,
  getInventory:()=>inventory,
  refreshInventory:()=>loadStock(),
  escapeHtml:esc,
  formatNumber:num,
  onReceiveItem:useInventoryForReceiving,
  onCountItem:item=>inventoryCountUi.selectItem(item?.id)
});
inventoryScanUi.wire();

async function loadStock(){
  const results=await Promise.all([cachedJson('/api/inventory','inventory'),loadRestockSuggestions()]);
  inventory=results[0];
  const typeLabelMap={ingredient:'Ingredient',packaging:'Packaging',kitchen_consumable:'Kitchen consumable',cleaning_sanitation:'Cleaning & sanitation',hygiene:'Hygiene',operational_supply:'Operational supply'};const nodes=inventory.map(i=>{const d=document.createElement('div');d.className='listRow';d.dataset.inventoryId=String(i.id);const usable=Number(i.usable_quantity??i.quantity??0),physical=Number(i.physical_quantity??i.quantity??0),blocked=Number(i.blocked_quantity||0),reserved=Number(i.reserved_quantity||0),available=Number(i.available_quantity??Math.max(0,usable-reserved)),low=usable<=Number(i.reorder_level);const purchase=i.last_purchase_quantity? ` • last bought ${num(i.last_purchase_quantity,4)} ${esc(i.last_purchase_unit||'')}${i.last_purchase_total_cost!=null?' for '+money(i.last_purchase_total_cost):''}` : '';const kind=i.inventory_type||'ingredient';const stockCopy=reserved>0?`available ${num(available,4)} ${esc(i.unit)} • reserved ${num(reserved,4)} • usable ${num(usable,4)} • physical ${num(physical,4)}`:blocked>0?`usable ${num(usable,4)} ${esc(i.unit)} • physical ${num(physical,4)} • blocked ${num(blocked,4)}`:`${num(usable,4)} ${esc(i.unit)} usable`;const condition=STORAGE_CONDITION_LABELS[i.storage_condition]||'Not set / other',area=STORAGE_AREA_LABELS[i.storage_area_type]||'Other / not set',location=i.storage_location_label?` · ${esc(i.storage_location_label)}`:'';const storageCopy=`storage ${esc(condition)} · ${esc(area)}${location}${i.storage_segregated?' · segregated':''}`,target=Number(i.target_level)>0?Number(i.target_level):Number(i.reorder_level);d.innerHTML=`<div class="rowMain"><strong>${esc(i.item)}</strong><small>${esc(typeLabelMap[kind]||kind)} • ${stockCopy} • ${storageCopy} • cost ${money(i.unit_cost)} / ${esc(i.unit)} • notify below ${num(i.reorder_level,4)} ${esc(i.unit)} • target ${num(target,4)} ${esc(i.unit)}${purchase}</small></div><span class="${low?'negative':''}">${low?'LOW':'OK'}</span>`;return d});
  $('stockList').replaceChildren(...(nodes.length?nodes:[emptyRow('No inventory items yet.')]));
  if($('lowStock'))$('lowStock').textContent=String(inventory.filter(i=>Number(i.usable_quantity??i.quantity)<=Number(i.reorder_level)).length);
  fillIngredientSelect();
  await fillIngredientAllergenEditor();
  fillConsumableRuleInventory();
  fillStockAdjustmentInventory();
  fillStorageEditor();
  fillRestockSettingsEditor();
  inventoryScanUi.syncInventory();
  await Promise.all([loadConsumableRules(),loadStockAdjustments(),loadInventoryLots(),loadWasteAnalytics(wasteAnalyticsDays),inventoryCountUi.load()]);
}
function lotExpiryCopy(row){
  if(row.lot_state&&row.lot_state!=='available'&&row.lot_state!=='depleted')return 'Held: '+String(row.lot_state).replaceAll('_',' ');
  if(row.expiry_status==='expired')return 'Expired';
  if(row.expiry_status==='expiring_soon')return row.days_to_expiry===0?'Expires today':`Expires in ${Math.max(0,Number(row.days_to_expiry))} day(s)`;
  if(row.expires_at)return 'Expires '+new Date(row.expires_at).toLocaleDateString('en-PH',{timeZone:'Asia/Manila'});
  return 'No expiry date';
}
async function loadInventoryLots(){
  const list=$('lotList'),summary=$('lotSummary');if(!list||!summary)return[];
  try{
    const rows=await api('/api/inventory/lots');
    const active=rows.filter(r=>Number(r.quantity_remaining_base)>0);
    const expired=active.filter(r=>r.expiry_status==='expired').length;
    const soon=active.filter(r=>r.expiry_status==='expiring_soon').length;
    const held=active.filter(r=>!['available','depleted'].includes(String(r.lot_state||'available'))).length;
    const usable=active.filter(r=>r.usable).length;
    summary.innerHTML=active.length
      ?`<strong>${active.length} open lot(s)</strong> • ${usable} usable • ${soon} expiring soon • ${expired} expired • ${held} held`
      :'No open tracked lots yet.';
    const nodes=rows.slice(0,120).map(r=>{
      const d=document.createElement('div');d.className='listRow';d.dataset.lotId=String(r.id);d.dataset.inventoryId=String(r.inventory_id||'');
      const status=lotExpiryCopy(r),bad=r.expiry_status==='expired'||!['available','depleted'].includes(String(r.lot_state||'available'));
      const code=r.supplier_lot_code||r.internal_lot_code||('Lot '+r.id);
      const storageCondition=STORAGE_CONDITION_LABELS[r.storage_condition_snapshot]||STORAGE_CONDITION_LABELS[r.current_storage_condition]||'Not set / other';
      const storageArea=STORAGE_AREA_LABELS[r.storage_area_type_snapshot]||STORAGE_AREA_LABELS[r.current_storage_area_type]||'Other / not set';
      const storageLocation=r.storage_location_label_snapshot||r.current_storage_location_label||'';
      const storageCopy=`${storageCondition} · ${storageArea}${storageLocation?' · '+storageLocation:''}${r.storage_segregated_snapshot?' · segregated':''}`;
      d.innerHTML=`<div class="rowMain"><strong>${esc(r.item_name)} · ${esc(code)}</strong><small>${num(r.quantity_remaining_base,4)} ${esc(r.base_unit)} remaining • ${esc(status)} • storage ${esc(storageCopy)}${r.supplier_lot_code&&r.internal_lot_code?' • internal '+esc(r.internal_lot_code):''}</small></div><span class="${bad?'negative':r.expiry_status==='expiring_soon'?'negative':''}">${r.usable?'FEFO':'HOLD'}</span>`;
      return d;
    });
    list.replaceChildren(...(nodes.length?nodes:[emptyRow('No lot or expiry records yet.')]));
    return rows;
  }catch(error){
    summary.textContent='Lot information could not be loaded.';
    list.replaceChildren(emptyRow(error.message||'Lot information is unavailable.'));
    return[];
  }
}
function fillStorageEditor(){
  const select=$('storageInventoryId');if(!select)return;
  const previous=select.value;
  select.innerHTML=inventory.length
    ?'<option value="">Choose an item</option>'+inventory.map(i=>`<option value="${i.id}">${esc(i.item)} · ${esc(STORAGE_CONDITION_LABELS[i.storage_condition]||'Not set / other')}</option>`).join('')
    :'<option value="">Add stock first</option>';
  if(previous&&inventory.some(i=>String(i.id)===String(previous)))select.value=previous;
  loadStorageEditorItem();
}
function loadStorageEditorItem(){
  const id=Number($('storageInventoryId')?.value),item=inventory.find(x=>Number(x.id)===id);
  if(!item){
    if($('storageSafetyMessage'))$('storageSafetyMessage').textContent='Choose an Inventory item to review its storage settings.';
    return;
  }
  $('storageCondition').value=item.storage_condition||'other';
  $('storageAreaType').value=item.storage_area_type||'other';
  $('storageLocationLabel').value=item.storage_location_label||'';
  $('storageSegregated').checked=Boolean(item.storage_segregated);
  updateStorageEditorSafety();
}
function updateStorageEditorSafety(){
  const id=Number($('storageInventoryId')?.value),item=inventory.find(x=>Number(x.id)===id),out=$('storageSafetyMessage');
  if(!out)return;
  if(!item){out.textContent='Choose an Inventory item to review its storage settings.';return}
  const result=storageSafetyMessage({
    type:item.inventory_type||'ingredient',
    condition:$('storageCondition').value,
    area:$('storageAreaType').value,
    label:$('storageLocationLabel').value,
    segregated:$('storageSegregated').checked
  });
  out.innerHTML=`<strong class="${result.ok?'positive':'negative'}">${result.ok?'Storage check':'Storage warning'}</strong><br><span class="muted">${esc(result.text)}</span>`;
}
function fillStockAdjustmentInventory(){
  const select=$('stockAdjustmentInventory');if(!select)return;
  const previous=select.value;
  select.innerHTML=inventory.length
    ?'<option value="">Choose an inventory item</option>'+inventory.map(i=>`<option value="${i.id}">${esc(i.item)} — ${num(i.quantity,4)} ${esc(i.unit)}</option>`).join('')
    :'<option value="">Add stock first</option>';
  if(previous&&inventory.some(i=>String(i.id)===String(previous)))select.value=previous;
}
function stockAdjustmentKindLabel(kind){
  return({waste:'Waste',spoilage:'Spoilage',expired:'Expired',damaged:'Damaged / broken',count_correction:'Physical stock count',other_loss:'Other loss'})[kind]||kind;
}
function stockAdjustmentLotCode(lot){
  return lot?.supplier_lot_code||lot?.internal_lot_code||('Lot '+lot?.id);
}
async function loadStockAdjustmentLots(){
  const select=$('stockAdjustmentLot'),help=$('stockAdjustmentLotHelp');
  if(!select)return[];
  const inventoryId=Number($('stockAdjustmentInventory')?.value);
  const kind=$('stockAdjustmentKind')?.value||'waste';
  if(kind==='count_correction'){
    stockAdjustmentLots=[];
    select.replaceChildren(new Option('Whole-item reconciliation — no single lot',''));
    select.disabled=true;
    if(help)help.textContent='Physical stock count corrects the whole Inventory item. Legacy/untracked stock is reconciled before exact tracked lots.';
    return[];
  }
  if(!Number.isInteger(inventoryId)){
    stockAdjustmentLots=[];
    select.replaceChildren(new Option('Choose an Inventory item first',''));
    select.disabled=true;
    if(help)help.textContent='Optional when the exact lot is known. Otherwise Business & Life reconciles tracked stock automatically.';
    return[];
  }
  try{
    const rows=await api(`/api/inventory/lots?inventory_id=${inventoryId}`);
    stockAdjustmentLots=(Array.isArray(rows)?rows:[]).filter(x=>Number(x.quantity_remaining_base)>0);
    const ordered=kind==='expired'
      ?[...stockAdjustmentLots].sort((a,b)=>{
          const ae=a.expiry_status==='expired'?0:1,be=b.expiry_status==='expired'?0:1;
          if(ae!==be)return ae-be;
          return new Date(a.expires_at||8640000000000000)-new Date(b.expires_at||8640000000000000);
        })
      :stockAdjustmentLots;
    const defaultText=kind==='expired'?'Auto — expired lot(s) first':'Auto — earliest-expiry lot first';
    select.replaceChildren(new Option(defaultText,''));
    for(const lot of ordered){
      const code=stockAdjustmentLotCode(lot);
      const expiry=lot.expires_at?new Date(lot.expires_at).toLocaleDateString('en-PH',{timeZone:'Asia/Manila'}):'no expiry';
      const status=lot.expiry_status==='expired'?'EXPIRED':String(lot.lot_state||'available').toUpperCase();
      select.append(new Option(`${code} — ${num(lot.quantity_remaining_base,4)} ${lot.base_unit} — ${status} — ${expiry}`,String(lot.id)));
    }
    select.disabled=false;
    if(help)help.textContent=kind==='expired'
      ?'Choose the exact expired lot when you know it. Auto mode removes expired tracked lots first, then legacy/untracked stock.'
      :'Choose the exact lot when known. Auto mode uses earliest-expiry tracked stock first.';
    return stockAdjustmentLots;
  }catch(error){
    stockAdjustmentLots=[];
    select.replaceChildren(new Option('Lot information unavailable',''));
    select.disabled=true;
    if(help)help.textContent=error.message||'Lot information is unavailable.';
    return[];
  }
}
function updateStockAdjustmentPreview(){
  const out=$('stockAdjustmentPreview');if(!out)return;
  const item=inventory.find(i=>Number(i.id)===Number($('stockAdjustmentInventory')?.value));
  const kind=$('stockAdjustmentKind')?.value||'waste';
  const entered=Number($('stockAdjustmentQty')?.value);
  if($('stockAdjustmentQtyLabel'))$('stockAdjustmentQtyLabel').textContent=kind==='count_correction'?'Counted stock quantity':'Quantity to remove';
  if(!item||!Number.isFinite(entered)||entered<0){out.textContent='Choose an item and enter the quantity.';return}
  const before=Number(item.quantity),after=kind==='count_correction'?entered:before-entered;
  if(after<0){out.innerHTML='<strong class="negative">This would remove more than the available stock.</strong>';return}
  const delta=after-before,impact=delta*Number(item.unit_cost||0);
  const selectedLot=stockAdjustmentLots.find(x=>Number(x.id)===Number($('stockAdjustmentLot')?.value));
  const lotCopy=selectedLot?` • exact lot <strong>${esc(stockAdjustmentLotCode(selectedLot))}</strong>`:(kind==='count_correction'?' • whole-item reconciliation':' • automatic lot reconciliation');
  out.innerHTML=`Current <strong>${num(before,4)} ${esc(item.unit)}</strong> → after adjustment <strong>${num(after,4)} ${esc(item.unit)}</strong> • estimated stock-value change <strong class="${impact<0?'negative':impact>0?'positive':''}">${money(impact)}</strong>${lotCopy}`;
}
async function loadStockAdjustments(){
  const list=$('stockAdjustmentList');if(!list)return[];
  try{
    const rows=await api('/api/inventory/adjustments');
    const nodes=rows.map(r=>{
      const d=document.createElement('div');d.className='listRow';
      const delta=Number(r.quantity_delta);
      const when=r.created_at?new Date(r.created_at).toLocaleString('en-PH',{timeZone:'Asia/Manila'}):'';
      const lots=Array.isArray(r.lot_allocations)?r.lot_allocations:[];
      const lotCopy=lots.length
        ?' • lots '+lots.map(x=>`${esc(x.lot_code||('Lot '+x.lot_id))} × ${num(x.quantity_removed,4)}`).join(', ')
        :Number(r.untracked_quantity_delta||0)!==0?' • legacy/untracked '+(Number(r.untracked_quantity_delta)>0?'+':'')+num(r.untracked_quantity_delta,4):'';
      d.innerHTML=`<div class="rowMain"><strong>${esc(r.item)} · ${esc(stockAdjustmentKindLabel(r.adjustment_kind))}</strong><small>${num(r.before_quantity,4)} → ${num(r.after_quantity,4)} ${esc(r.unit)}${lotCopy}${r.note?' • '+esc(r.note):''}${when?' • '+esc(when):''}</small></div><div class="rowRight"><span class="${delta<0?'negative':delta>0?'positive':''}">${delta>0?'+':''}${num(delta,4)} ${esc(r.unit)}</span><small>${money(r.estimated_value_delta)}</small></div>`;
      return d;
    });
    list.replaceChildren(...(nodes.length?nodes:[emptyRow('No stock adjustments recorded yet.')]));
    return rows;
  }catch(error){
    list.replaceChildren(emptyRow(error.message||'Stock adjustment history could not be loaded.'));
    return[];
  }
}
function wasteReasonLabel(kind){
  return({waste:'Waste',spoilage:'Spoilage',expired:'Expired',damaged:'Damaged / broken',other_loss:'Other loss'})[kind]||kind;
}
function wasteQuantitySummary(rows=[]){
  return (rows||[]).map(x=>`${num(x.quantity,4)} ${esc(x.unit)}`).join(' • ')||'No recorded loss quantity';
}
function renderWasteAnalytics(report={}){
  const summary=$('wasteAnalyticsSummary'),reasons=$('wasteReasonList'),top=$('wasteTopItems'),details=$('wasteDetailList'),policy=$('wasteEvidencePolicy');
  if(!summary||!reasons||!top||!details||!policy)return;
  const s=report.summary||{};
  summary.innerHTML=`<strong>${money(s.value_loss||0)} recorded loss value</strong> • ${num(s.events||0,0)} event(s) • ${num(s.items_affected||0,0)} item(s)<br><span class="muted">${wasteQuantitySummary(s.quantities_by_unit||[])}</span>`;
  const reasonNodes=(report.by_reason||[]).map(row=>{
    const d=document.createElement('div');d.className='listRow';
    d.innerHTML=`<div class="rowMain"><strong>${esc(row.label||wasteReasonLabel(row.adjustment_kind))}</strong><small>${num(row.events||0,0)} event(s)</small></div><div class="rowRight"><span class="negative">${money(row.value_loss||0)}</span><small>${Number(row.share_of_loss_value_pct||0).toFixed(1)}% of recorded loss value</small></div>`;
    return d;
  });
  reasons.replaceChildren(...(reasonNodes.length?reasonNodes:[emptyRow('No loss reasons in this period.')]));
  const topNodes=(report.top_items||[]).slice(0,8).map(row=>{
    const d=document.createElement('div');d.className='listRow';
    const p=row.comparison?.purchase_evidence,u=row.comparison?.usage_evidence;
    const evidence=[];
    if(p?.status==='RECORDED_PURCHASES_PRESENT')evidence.push(`recorded purchases ${money(p.value)}`);
    if(u?.status==='RECORDED_USAGE_PRESENT')evidence.push(`recorded usage ${num(u.quantity,4)} ${esc(row.unit)}`);
    d.innerHTML=`<div class="rowMain"><strong>${esc(row.item)}</strong><small>${num(row.quantity_loss,4)} ${esc(row.unit)} lost • ${num(row.events||0,0)} event(s)${evidence.length?' • '+evidence.join(' • '):''}</small></div><span class="negative">${money(row.value_loss||0)}</span>`;
    return d;
  });
  top.replaceChildren(...(topNodes.length?topNodes:[emptyRow('No wasted items in this period.')]));
  const detailNodes=(report.details||[]).slice(0,20).map(row=>{
    const d=document.createElement('div');d.className='listRow';
    const lots=Array.isArray(row.lot_allocations)?row.lot_allocations:[];
    const lotCopy=lots.length?' • '+lots.map(x=>esc(x.lot_code||('Lot '+x.lot_id))).join(', '):'';
    const when=row.created_at?new Date(row.created_at).toLocaleString('en-PH',{timeZone:'Asia/Manila'}):'';
    d.innerHTML=`<div class="rowMain"><strong>${esc(row.item)} · ${esc(row.label||wasteReasonLabel(row.adjustment_kind))}</strong><small>${num(row.quantity_loss,4)} ${esc(row.unit)}${lotCopy}${row.note?' • '+esc(row.note):''}${when?' • '+esc(when):''}</small></div><span class="negative">${money(row.value_loss||0)}</span>`;
    return d;
  });
  details.replaceChildren(...(detailNodes.length?detailNodes:[emptyRow('No recent loss evidence in this period.')]));
  const dp=report.denominator_policy||{};
  policy.innerHTML=`<strong>Comparison evidence</strong><br><span class="muted">${esc(dp.note||'Purchase and usage evidence is shown when available, but no waste rate is invented without a complete denominator.')}</span>`;
  if($('wastePeriod7'))$('wastePeriod7').classList.toggle('active',Number(report.days||wasteAnalyticsDays)===7);
  if($('wastePeriod30'))$('wastePeriod30').classList.toggle('active',Number(report.days||wasteAnalyticsDays)===30);
}
async function loadWasteAnalytics(days=wasteAnalyticsDays){
  wasteAnalyticsDays=Number(days)===30?30:7;
  try{
    const report=await api(`/api/inventory/waste-analytics?days=${wasteAnalyticsDays}`);
    renderWasteAnalytics(report);
    return report;
  }catch(error){
    const summary=$('wasteAnalyticsSummary');
    if(summary)summary.textContent=error.message||'Waste analytics could not be loaded.';
    return null;
  }
}
function fillConsumableRuleInventory(){
  const select=$('consumableInventoryId');if(!select)return;
  const items=inventory.filter(i=>(i.inventory_type||'ingredient')!=='ingredient');
  select.innerHTML=items.length
    ?'<option value="">Choose a consumable</option>'+items.map(i=>`<option value="${i.id}">${esc(i.item)} — ${num(i.quantity,4)} ${esc(i.unit)}</option>`).join('')
    :'<option value="">Add non-ingredient stock first</option>';
}
function consumableRuleLabel(r){
  const scope={all:'Pickup & delivery',pickup:'Pickup only',delivery:'Delivery only'}[r.fulfilment_scope]||r.fulfilment_scope;
  const basis=r.usage_basis==='per_item'?'per ordered item':'per order';
  return `${num(r.quantity_used,4)} ${esc(r.unit)} ${basis} • ${esc(scope)}`;
}
async function loadConsumableRules(){
  const list=$('consumableRuleList');if(!list)return[];
  try{
    const rows=await api('/api/inventory/consumable-rules');
    const nodes=rows.map(r=>{
      const d=document.createElement('div');d.className='listRow';
      d.innerHTML=`<div class="rowMain"><strong>${esc(r.item)}</strong><small>${consumableRuleLabel(r)} • stock ${num(r.stock_quantity,4)} ${esc(r.unit)}</small></div><button type="button" class="miniBtn">Remove</button>`;
      d.querySelector('button').onclick=async()=>{
        try{await api(`/api/inventory/consumable-rules/${r.id}`,{method:'DELETE'});await loadConsumableRules()}catch(error){alert(error.message)}
      };
      return d;
    });
    list.replaceChildren(...(nodes.length?nodes:[emptyRow('No automatic consumable rules yet.')]));
    return rows;
  }catch(error){
    list.replaceChildren(emptyRow(error.message||'Consumable rules could not be loaded.'));
    return[];
  }
}
async function loadRemittances(){const rows=await cachedJson('/api/remittances','remittances');$('remittanceList').replaceChildren(...(rows.length?rows.map(remitRow):[emptyRow('No remittances recorded yet.')]))}
async function loadDay(){const d=await cachedJson('/api/day-status','day_status');$('dayStatusDate').textContent=d.business_date;$('openingCashShown').textContent=money(d.opening_cash);$('expectedCashShown').textContent=money(d.expected_cash);$('openResult').textContent=d.has_opening?'Opening cash is recorded for today.':'Set opening cash before closing the day.';if(d.closing)$('closeResult').innerHTML=`Closed: actual ${money(d.closing.actual_cash)} • <strong class="${Number(d.closing.variance)<0?'negative':Number(d.closing.variance)>0?'positive':''}">difference ${money(d.closing.variance)}</strong>`}
async function loadBudget(){const b=await cachedJson('/api/budget','budget');$('budgetPersonalDaily').value=Number(b.personal_daily_limit||0);$('budgetPersonalWeekly').value=Number(b.personal_weekly_limit||0);$('budgetBusinessDaily').value=Number(b.business_daily_limit||0);$('budgetMinimum').value=Number(b.min_available_warning||0)}
async function loadAnalysis(days){const a=await cachedJson(`/api/analysis?days=${days}`,`analysis_${days}`);$(`analysis${days}Totals`).textContent=`Business ${money(a.totals.business)} • Personal ${money(a.totals.personal)} • Sales ${money(a.totals.sales)} • Support ${money(a.totals.received)}`;$(`analysis${days}`).replaceChildren(...analysisRows(a))}

function productCard(p){
  const d=document.createElement('div');d.className='productCard';const recipe=p.recipe||[];const shortage=recipe.filter(r=>Number(r.stock_quantity)<Number(r.quantity));const batch=p.recipe_batch;const raw=p.recipe_batch_components||[];
  const batchCopy=batch?`${num(batch.yield_quantity,4)} ${esc(batch.yield_unit)} batch → ${num(batch.sale_units_per_batch,2)} × ${num(batch.selling_quantity,4)} ${esc(batch.selling_unit)} sale units`:'Legacy per-portion recipe';
  const recipeCopy=raw.length?raw.map(r=>`${esc(r.item)} ${num(r.batch_quantity,4)} ${esc(r.batch_unit)}${r.percentage!=null?' · '+num(r.percentage,1)+'%':''}`).join(' • '):(recipe.length?recipe.map(r=>`${esc(r.item)} ${num(r.quantity,4)} ${esc(r.unit)} / sale unit`).join(' • '):'No recipe / ingredient cost set');
  const dc=p.direct_food_cost_estimate||{},pickup=dc.pickup||{},delivery=dc.delivery||{};
  const pickupCost=Number(p.estimated_direct_food_cost_pickup??p.estimated_unit_cost??0),deliveryCost=Number(p.estimated_direct_food_cost_delivery??p.estimated_unit_cost??0);
  d.innerHTML=`<div class="productTop"><div><strong>${esc(p.name)}</strong><small>${esc(p.category)} • Prepared recipe • ${p.active?'Active':'Inactive'}</small></div><strong>${money(p.selling_price)}</strong></div><div class="batchSummary">${batchCopy}</div><div class="productNumbers"><span>Ingredient cost <b>${money(p.estimated_unit_cost)}</b></span><span>Pickup direct cost <b>${money(pickupCost)}</b></span><span>Delivery direct cost <b>${money(deliveryCost)}</b></span></div><div class="recipeMini">${recipeCopy}</div><div class="recipeMini">Configured direct consumables / sold item: pickup ${money(pickup.direct_consumable_per_item||0)} • delivery ${money(delivery.direct_consumable_per_item||0)}${Number(pickup.direct_consumable_per_order||0)>0||Number(delivery.direct_consumable_per_order||0)>0?` • per-order consumables: pickup ${money(pickup.direct_consumable_per_order||0)} / delivery ${money(delivery.direct_consumable_per_order||0)}`:''}</div>${shortage.length?`<div class="shortageText">Low for one sale unit: ${shortage.map(x=>esc(x.item)).join(', ')}</div>`:''}<div class="productActions"><button class="miniBtn editProduct" type="button">Edit</button><button class="miniBtn editRecipe" type="button">Recipe</button><button class="miniBtn toggleProduct" type="button">${p.active?'Deactivate':'Activate'}</button></div>`;
  d.querySelector('.editProduct').onclick=()=>editProduct(p);d.querySelector('.editRecipe').onclick=()=>selectRecipeProduct(p.id);d.querySelector('.toggleProduct').onclick=()=>toggleProduct(p);return d;
}
function fillProductSelects(){
  const prepared=products.filter(p=>(p.product_kind||'prepared_recipe')==='prepared_recipe');
  const active=prepared.filter(p=>p.active);$('sellProduct').innerHTML=active.length?active.map(p=>`<option value="${p.id}">${esc(p.name)} — ${money(p.selling_price)}</option>`).join(''):'<option value="">No active prepared products</option>';
  $('recipeProduct').innerHTML=prepared.length?prepared.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join(''):'<option value="">Create a prepared product first</option>';
  updateSellPreview();if(prepared.length&&!$('recipeProduct').value)$('recipeProduct').value=String(prepared[0].id);
}
function fillIngredientSelect(){const ingredients=inventory.filter(i=>(i.inventory_type||'ingredient')==='ingredient');$('recipeIngredient').innerHTML=ingredients.length?ingredients.map(i=>`<option value="${i.id}">${esc(i.item)} — ${num(i.quantity)} ${esc(i.unit)}</option>`).join(''):'<option value="">Add ingredient stock first</option>'}
async function ensureAllergenCatalog(){
  if(allergenCatalog.length)return allergenCatalog;
  const data=await api('/api/food/allergens/catalog');
  allergenCatalog=Array.isArray(data?.allergens)?data.allergens:[];
  return allergenCatalog;
}
function renderAllergenChecks(hostId,name,selected=[]){
  const host=$(hostId);if(!host)return;
  const set=new Set(selected||[]);
  host.innerHTML=allergenCatalog.map(a=>`<label class="allergenCheck"><input type="checkbox" name="${esc(name)}" value="${esc(a.code)}" ${set.has(a.code)?'checked':''}><span>${esc(a.label)}</span></label>`).join('');
}
function checkedAllergens(name){
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(x=>x.value);
}
function allergenNames(codes=[]){
  const byCode=new Map(allergenCatalog.map(x=>[x.code,x.label]));
  return (codes||[]).map(code=>byCode.get(code)||code);
}
async function fillIngredientAllergenEditor(){
  const select=$('ingredientAllergenInventory');if(!select)return;
  await ensureAllergenCatalog();
  const ingredients=inventory.filter(i=>(i.inventory_type||'ingredient')==='ingredient');
  const previous=select.value;
  select.innerHTML=ingredients.length?'<option value="">Choose an ingredient</option>'+ingredients.map(i=>`<option value="${i.id}">${esc(i.item)}</option>`).join(''):'<option value="">Add Ingredient stock first</option>';
  if(previous&&ingredients.some(i=>String(i.id)===String(previous)))select.value=previous;
  renderAllergenChecks('ingredientContainsGrid','ingredientContains',[]);
  renderAllergenChecks('ingredientMayContainGrid','ingredientMayContain',[]);
  if(select.value)await loadIngredientAllergens();
}
async function loadIngredientAllergens(){
  const id=Number($('ingredientAllergenInventory')?.value);
  if(!Number.isInteger(id)){
    renderAllergenChecks('ingredientContainsGrid','ingredientContains',[]);
    renderAllergenChecks('ingredientMayContainGrid','ingredientMayContain',[]);
    if($('ingredientAllergenNote'))$('ingredientAllergenNote').value='';
    return;
  }
  const data=await api(`/api/inventory/${id}/allergens`);
  renderAllergenChecks('ingredientContainsGrid','ingredientContains',data.contains||[]);
  renderAllergenChecks('ingredientMayContainGrid','ingredientMayContain',data.may_contain||[]);
  $('ingredientAllergenNote').value=data.note||'';
}
function fillProductAllergenSelect(){
  const select=$('allergenProduct');if(!select)return;
  const prepared=products.filter(p=>(p.product_kind||'prepared_recipe')==='prepared_recipe');
  const previous=select.value;
  select.innerHTML=prepared.length?'<option value="">Choose a product</option>'+prepared.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join(''):'<option value="">Create a prepared product first</option>';
  if(previous&&prepared.some(p=>String(p.id)===String(previous)))select.value=previous;
}
function renderProductAllergenSummary(summary){
  currentProductAllergenSummary=summary||null;
  const out=$('productAllergenDerived'),state=$('productAllergenReviewState');
  if(!out||!state)return;
  if(!summary){
    out.textContent='Choose a prepared product to review its allergen information.';
    state.textContent='Allergen review status will appear here.';
    renderAllergenChecks('productCrossContactGrid','productCrossContact',[]);
    return;
  }
  const contains=allergenNames(summary.contains),may=allergenNames(summary.may_contain),cross=allergenNames(summary.cross_contact);
  out.innerHTML=`<strong>Derived from recipe evidence</strong><br>Contains: <b>${esc(contains.join(', ')||'None declared')}</b><br>May contain: <b>${esc(may.join(', ')||'None declared')}</b><br>Cross-contact risk: <b>${esc(cross.join(', ')||'None declared')}</b><br><span class="muted">No allergen is inferred from an ingredient or product name.</span>`;
  state.innerHTML=summary.review_current
    ?`<strong class="positive">Reviewed for revision ${Number(summary.revision)}</strong><br><span class="muted">This allergen evidence is current. A later recipe/evidence change requires another review.</span>`
    :`<strong class="negative">Review required · revision ${Number(summary.revision)}</strong><br><span class="muted">Review this evidence before publishing prepared food to the Storefront.</span>`;
  renderAllergenChecks('productCrossContactGrid','productCrossContact',summary.cross_contact||[]);
  if($('productCrossContactNote'))$('productCrossContactNote').value=summary.cross_contact_note||'';
}
async function loadProductAllergens(){
  const id=Number($('allergenProduct')?.value);
  await ensureAllergenCatalog();
  if(!Number.isInteger(id)){renderProductAllergenSummary(null);return}
  const summary=await api(`/api/products/${id}/allergens`);
  renderProductAllergenSummary(summary);
}

async function loadProducts(){products=await cachedJson('/api/products','products');const prepared=products.filter(p=>(p.product_kind||'prepared_recipe')==='prepared_recipe');$('productList').replaceChildren(...(prepared.length?prepared.map(productCard):[emptyRow('Create the first prepared product.') ]));fillProductSelects();fillProductAllergenSelect();syncRecipeDraftFromSelected();if($('allergenProduct')?.value)await loadProductAllergens()}
function updateSellPreview(){const p=products.find(x=>x.id===Number($('sellProduct').value));const q=Math.max(0,Number($('sellQty').value||1));if(!p){$('sellPreview').textContent='Create a menu product first.';return}const rev=p.selling_price*q,cost=p.estimated_unit_cost*q,gross=rev-cost;$('sellPreview').innerHTML=`Revenue <strong>${money(rev)}</strong> • ingredient cost <strong>${money(cost)}</strong> • estimated gross <strong class="${gross>=0?'positive':'negative'}">${money(gross)}</strong>`}
function recipeState(){
  const yieldBase=toBase($('recipeYieldQty')?.value,$('recipeYieldUnit')?.value);
  const sellBase=toBase($('recipeSellQty')?.value,$('recipeSellUnit')?.value);
  if(!yieldBase||!sellBase||yieldBase.family!==sellBase.family||sellBase.qty>yieldBase.qty)return null;
  return{yieldBase,sellBase,saleUnits:yieldBase.qty/sellBase.qty};
}
function renderRecipeDraft(){
  if(!recipeDraft.length){$('recipeDraftList').replaceChildren(emptyRow('Add the ingredients used in one finished batch.'));return}
  const state=recipeState();
  const nodes=recipeDraft.map((c,idx)=>{const inv=inventory.find(i=>Number(i.id)===Number(c.inventory_id)),base=toBase(c.quantity,c.unit),cost=base?base.qty*Number(inv?.unit_cost||0):0,pct=state&&base?.family===state.yieldBase.family?base.qty/state.yieldBase.qty*100:null;const d=document.createElement('div');d.className='listRow';d.innerHTML=`<div class="rowMain"><strong>${esc(inv?.item||'Ingredient')}</strong><small>${num(c.quantity,4)} ${esc(c.unit)}${pct!=null?' · '+num(pct,1)+'% of compatible batch measure':''} • batch cost ${money(cost)}</small></div><button class="miniBtn" type="button">Remove</button>`;d.querySelector('button').onclick=()=>{recipeDraft.splice(idx,1);renderRecipeDraft();updateRecipeCost()};return d});$('recipeDraftList').replaceChildren(...nodes)
}
function updateRecipeCost(){
  const state=recipeState();
  if(!state){$('recipeCostPreview').textContent='Finished batch and selling quantity must use compatible units, and the selling quantity cannot exceed the batch.';renderRecipeDraft();return}
  const batchCost=recipeDraft.reduce((sum,c)=>{const inv=inventory.find(i=>Number(i.id)===Number(c.inventory_id)),base=toBase(c.quantity,c.unit);return sum+(base?base.qty*Number(inv?.unit_cost||0):0)},0);
  const perSale=state.saleUnits>0?batchCost/state.saleUnits:0;
  $('recipeCostPreview').innerHTML=`Batch makes <strong>${num(state.saleUnits,2)}</strong> sale unit(s) • batch ingredient cost <strong>${money(batchCost)}</strong> • cost per sale unit <strong>${money(perSale)}</strong>`;renderRecipeDraft()
}
function syncRecipeDraftFromSelected(){
  const p=products.find(x=>x.id===Number($('recipeProduct').value));if(!p){recipeDraft=[];renderRecipeDraft();updateRecipeCost();return}
  if(p.recipe_batch){
    $('recipeYieldQty').value=Number(p.recipe_batch.yield_quantity);syncUnitSelect('recipeYieldUnit',p.recipe_batch.yield_unit);
    $('recipeSellQty').value=Number(p.recipe_batch.selling_quantity);syncUnitSelect('recipeSellUnit',p.recipe_batch.selling_unit);
    recipeDraft=(p.recipe_batch_components||[]).map(r=>({inventory_id:Number(r.inventory_id),quantity:Number(r.batch_quantity),unit:r.batch_unit}));
  }else{
    $('recipeYieldQty').value=1;$('recipeYieldUnit').value='unit';$('recipeSellQty').value=1;$('recipeSellUnit').value='unit';
    recipeDraft=(p.recipe||[]).map(r=>({inventory_id:Number(r.inventory_id),quantity:Number(r.quantity),unit:r.unit||'unit'}));
  }
  renderRecipeDraft();updateRecipeCost()
}
function selectRecipeProduct(id){setView('Menu');$('recipeProduct').value=String(id);syncRecipeDraftFromSelected();$('recipeEditor').scrollIntoView({behavior:'smooth',block:'start'})}
function editProduct(p){setView('Menu');$('productId').value=p.id;$('productKind').value=p.product_kind||'prepared_recipe';$('productName').value=p.name;$('productCategory').value=p.category;$('productPrice').value=Number(p.selling_price);$('productActive').checked=Boolean(p.active);$('productFormTitle').textContent='Edit prepared product';$('productSave').textContent='Save changes';$('productCancel').classList.remove('hidden');$('productForm').scrollIntoView({behavior:'smooth',block:'start'})}
function resetProductForm(){$('productForm').reset();$('productId').value='';$('productKind').value='prepared_recipe';$('productCategory').value='Food';$('productActive').checked=true;$('productFormTitle').textContent='Create prepared product';$('productSave').textContent='Create prepared product';$('productCancel').classList.add('hidden');$('productMessage').textContent=''}
async function toggleProduct(p){try{await api(`/api/products/${p.id}`,{method:'PATCH',body:JSON.stringify({active:!p.active})});await loadProducts()}catch(e){alert(e.message)}}
async function loadProductSales(){const rows=await cachedJson('/api/product-sales','product_sales');const nodes=rows.slice(0,20).map(s=>{const d=document.createElement('div');d.className='listRow';const margin=Number(s.revenue)>0?Number(s.gross_profit)/Number(s.revenue)*100:0;d.innerHTML=`<div class="rowMain"><strong>${num(s.quantity)} × ${esc(s.product_name_snapshot)}</strong><small>${esc(accountLabel(s.account))} • cost ${money(s.estimated_cogs)} • margin ${margin.toFixed(1)}%</small></div><div class="rowRight"><span>${money(s.revenue)}</span><small class="positive">gross ${money(s.gross_profit)}</small></div>`;return d});$('productSaleList').replaceChildren(...(nodes.length?nodes:[emptyRow('No menu sales yet.')]))}
function profitRows(report){const nodes=[];for(const p of report.products||[]){const d=document.createElement('div');d.className='listRow';d.innerHTML=`<div class="rowMain"><strong>${esc(p.name)}</strong><small>Quick sale history · ${num(p.quantity)} portions • revenue ${money(p.revenue)} • ingredient cost ${money(p.cogs)}</small></div><div class="rowRight"><span class="${Number(p.gross_profit)>=0?'positive':'negative'}">${money(p.gross_profit)}</span><small>${Number(p.margin_pct).toFixed(1)}%</small></div>`;nodes.push(d)}
  const orders=report.completed_order_direct_cost?.orders||[];
  for(const o of orders.slice(0,8)){const d=document.createElement('div');d.className='listRow';d.innerHTML=`<div class="rowMain"><strong>${esc(o.order_number||('Order #'+o.order_id))} · ${esc(o.fulfilment_method||'order')}</strong><small>Ingredient ${money(o.ingredient_cost)} • packaging/direct consumables ${money(o.direct_consumable_cost)} • direct food cost ${money(o.direct_food_cost)}</small></div><div class="rowRight"><span class="${Number(o.direct_gross_profit)>=0?'positive':'negative'}">${money(o.direct_gross_profit)}</span><small>${Number(o.direct_margin_pct).toFixed(1)}%</small></div>`;nodes.push(d)}
  return nodes.length?nodes:[emptyRow('No quick sales or completed-order cost evidence in this period.')]}
async function loadProfitability(days){const r=await cachedJson(`/api/product-profitability?days=${days}`,`profit_${days}`),o=r.completed_order_direct_cost?.totals||{};const quick=`${num(r.totals.portions)} quick-sale portion(s) • revenue ${money(r.totals.revenue)} • historical ingredient cost ${money(r.totals.cogs)}`;const order=`${num(o.orders||0)} completed order(s) • merchandise revenue ${money(o.revenue)} • ingredients ${money(o.ingredient_cost)} • packaging/direct consumables ${money(o.direct_consumable_cost)} • direct food cost ${money(o.direct_food_cost)} • direct gross ${money(o.direct_gross_profit)} • margin ${Number(o.direct_margin_pct||0).toFixed(1)}%`;$(`profit${days}Totals`).textContent=quick+' | '+order;$(`profit${days}List`).replaceChildren(...profitRows(r))}

async function refreshCurrentMerchantView(){
  if(!isMerchantBaseActive())return;
  const visible=[...document.querySelectorAll('.view')].find(v=>!v.classList.contains('hidden'));
  const name=visible?.id?.replace(/^view/,'')||'Dashboard';
  try{
    if(name==='Dashboard'){invalidateMerchantToday();await loadMerchantToday({force:true});return}
    await loadMerchantView(name);
  }catch(error){console.error(error)}
}
if($('refreshBtn'))$('refreshBtn').onclick=refreshCurrentMerchantView;
if($('restockRefresh'))$('restockRefresh').onclick=()=>loadStock();
if($('wastePeriod7'))$('wastePeriod7').onclick=()=>loadWasteAnalytics(7);
if($('wastePeriod30'))$('wastePeriod30').onclick=()=>loadWasteAnalytics(30);
if($('lotRefresh'))$('lotRefresh').onclick=()=>loadInventoryLots();

$('txForm').addEventListener('submit',async e=>{e.preventDefault();$('txMessage').textContent='Saving…';try{await api('/api/transactions',{method:'POST',body:JSON.stringify({type:$('type').value,amount:Number($('amount').value),category:$('category').value||'Other',account:$('account').value,note:$('note').value})});e.target.reset();$('account').value='cash';$('txMessage').textContent='Saved.';invalidateMerchantToday();setView('Dashboard')}catch(err){$('txMessage').textContent=err.message}});
$('stockAdjustmentInventory')?.addEventListener('change',async()=>{await loadStockAdjustmentLots();updateStockAdjustmentPreview()});
$('stockAdjustmentKind')?.addEventListener('change',async()=>{await loadStockAdjustmentLots();updateStockAdjustmentPreview()});
$('stockAdjustmentLot')?.addEventListener('change',updateStockAdjustmentPreview);
$('stockAdjustmentQty')?.addEventListener('input',updateStockAdjustmentPreview);
$('stockAdjustmentForm')?.addEventListener('submit',async e=>{
  e.preventDefault();const out=$('stockAdjustmentMessage');if(out)out.textContent='Saving…';
  try{
    const result=await api('/api/inventory/adjustments',{method:'POST',body:JSON.stringify({
      inventory_id:Number($('stockAdjustmentInventory').value),
      adjustment_kind:$('stockAdjustmentKind').value,
      quantity:Number($('stockAdjustmentQty').value),
      lot_id:$('stockAdjustmentLot').value?Number($('stockAdjustmentLot').value):null,
      note:$('stockAdjustmentNote').value
    })});
    if(out)out.textContent=`Saved. New stock: ${num(result.inventory.quantity,4)} ${result.inventory.unit}.`;
    $('stockAdjustmentQty').value='';
    $('stockAdjustmentNote').value='';
    await loadStock();
    await loadStockAdjustmentLots();
    invalidateMerchantToday();
    updateStockAdjustmentPreview();
  }catch(error){if(out)out.textContent=error.message}
});
$('consumableRuleForm')?.addEventListener('submit',async e=>{
  e.preventDefault();const out=$('consumableRuleMessage');if(out)out.textContent='Saving…';
  try{
    await api('/api/inventory/consumable-rules',{method:'POST',body:JSON.stringify({
      inventory_id:Number($('consumableInventoryId').value),
      fulfilment_scope:$('consumableScope').value,
      usage_basis:$('consumableBasis').value,
      quantity_used:Number($('consumableQty').value)
    })});
    if(out)out.textContent='Consumable rule saved.';
    $('consumableQty').value=1;
    await loadConsumableRules();
  }catch(error){if(out)out.textContent=error.message}
});
$('storageInventoryId')?.addEventListener('change',loadStorageEditorItem);
for(const id of ['storageCondition','storageAreaType','storageLocationLabel'])$(id)?.addEventListener('change',updateStorageEditorSafety);
$('storageLocationLabel')?.addEventListener('input',updateStorageEditorSafety);
$('storageSegregated')?.addEventListener('change',updateStorageEditorSafety);
$('storageForm')?.addEventListener('submit',async e=>{
  e.preventDefault();const out=$('storageMessage');if(out)out.textContent='Saving…';
  try{
    const id=Number($('storageInventoryId').value);
    if(!Number.isInteger(id))throw new Error('Choose an Inventory item.');
    const updated=await api(`/api/inventory/${id}/storage`,{method:'PUT',body:JSON.stringify({
      storage_condition:$('storageCondition').value,
      storage_area_type:$('storageAreaType').value,
      storage_location_label:$('storageLocationLabel').value,
      storage_segregated:$('storageSegregated').checked
    })});
    if(out)out.textContent=`Storage saved for ${updated.item}.`;
    await loadStock();
    invalidateMerchantToday();
  }catch(error){if(out)out.textContent=error.message}
});
$('restockSettingsInventory')?.addEventListener('change',loadRestockSettingsItem);
for(const id of ['restockSettingsAlert','restockSettingsTarget'])$(id)?.addEventListener('input',updateRestockSettingsPreview);
$('restockSettingsUnit')?.addEventListener('change',updateRestockSettingsPreview);
$('restockSettingsForm')?.addEventListener('submit',async e=>{
  e.preventDefault();const out=$('restockSettingsMessage');if(out)out.textContent='Saving…';
  try{
    const id=Number($('restockSettingsInventory').value);if(!Number.isInteger(id))throw new Error('Choose an Inventory item.');
    const alert=Number($('restockSettingsAlert').value||0),target=Number($('restockSettingsTarget').value||0),unit=$('restockSettingsUnit').value;
    if(target>0&&target<alert)throw new Error('Restock target must be equal to or higher than the low-stock alert.');
    await api(`/api/inventory/${id}/reorder-settings`,{method:'PUT',body:JSON.stringify({reorder_quantity:alert,target_quantity:target,unit})});
    if(out)out.textContent='Restock settings saved.';
    await loadStock();invalidateMerchantToday();
  }catch(error){if(out)out.textContent=error.message}
});
$('stockForm').addEventListener('submit',async e=>{e.preventDefault();$('stockMessage').textContent='Saving purchase…';try{const result=await api('/api/inventory/purchase',{method:'POST',body:JSON.stringify({inventory_id:$('stockInventoryId').value?Number($('stockInventoryId').value):null,item:$('stockItem').value,inventory_type:$('stockInventoryType').value,storage_condition:$('stockStorageCondition').value,storage_area_type:$('stockStorageArea').value,storage_location_label:$('stockStorageLocation').value,storage_segregated:$('stockStorageSegregated').checked,purchase_quantity:Number($('stockPurchaseQty').value),purchase_unit:$('stockPurchaseUnit').value,total_cost:Number($('stockTotalCost').value),reorder_quantity:Number($('stockReorderQty').value||0),reorder_unit:$('stockReorderUnit').value,target_quantity:Number($('stockTargetQty').value||0),target_unit:$('stockReorderUnit').value,lot_code:$('stockLotCode').value,expires_at:$('stockExpiry').value,account:$('stockAccount').value,note:$('stockNote').value,record_expense:true})});const lotCopy=result.lot?(result.lot.supplier_lot_code||result.lot.internal_lot_code):'';$('stockMessage').textContent=`Added ${result.conversion.stored}. New calculated stock cost: ${money(result.inventory.unit_cost)} / ${result.inventory.unit}.${lotCopy?' Lot '+lotCopy+' recorded.':''}`;e.target.reset();$('stockInventoryId').value='';$('stockPurchaseQty').value=1;$('stockPurchaseUnit').value='kg';$('stockTotalCost').value=0;$('stockAccount').value='cash';$('stockReorderQty').value=0;$('stockTargetQty').value=0;$('stockReorderUnit').value='g';$('stockLotCode').value='';$('stockExpiry').value='';$('stockInventoryType').value='ingredient';$('stockStorageCondition').value='other';$('stockStorageArea').value='other';$('stockStorageLocation').value='';$('stockStorageSegregated').checked=false;$('stockCategoryPicker').value='';$('stockItemPicker').replaceChildren(new Option('Choose a category first',''));$('stockItemPicker').disabled=true;updateStockStorageHint();stockPurchasePreview();await Promise.all([loadStock(),loadProducts()]);invalidateMerchantToday()}catch(err){$('stockMessage').textContent=err.message}});
$('remittanceForm').addEventListener('submit',async e=>{e.preventDefault();$('remitMessage').textContent='Saving…';const optional=id=>$(id).value===''?null:Number($(id).value);try{await api('/api/remittances',{method:'POST',body:JSON.stringify({sent_amount:Number($('remitSent').value),sent_currency:$('remitCurrency').value,fee_amount:Number($('remitFee').value||0),exchange_rate:optional('remitRate'),expected_php:optional('remitExpected'),received_php:Number($('remitReceived').value),account:$('remitAccount').value,provider:$('remitProvider').value,reference:$('remitReference').value,note:$('remitNote').value})});e.target.reset();$('remitCurrency').value='EUR';$('remitFee').value=0;$('remitAccount').value='gcash';$('remitMessage').textContent='Remittance saved and received money added automatically.';await Promise.all([loadRemittances(),loadDay()]);invalidateMerchantToday()}catch(err){$('remitMessage').textContent=err.message}});
$('openForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/open-day',{method:'POST',body:JSON.stringify({opening_cash:Number($('openingCash').value)})});$('openResult').textContent='Opening cash saved.';await loadDay()}catch(err){$('openResult').textContent=err.message}});
$('closeForm').addEventListener('submit',async e=>{e.preventDefault();try{const r=await api('/api/close-day',{method:'POST',body:JSON.stringify({actual_cash:Number($('actualCash').value)})});$('closeResult').innerHTML=`Expected ${money(r.expected_cash)} • Actual ${money(r.actual_cash)} • <strong class="${Number(r.variance)<0?'negative':Number(r.variance)>0?'positive':''}">Difference ${money(r.variance)}</strong>`;await loadDay()}catch(err){$('closeResult').textContent=err.message}});
$('budgetForm').addEventListener('submit',async e=>{e.preventDefault();$('budgetMessage').textContent='Saving…';try{await api('/api/budget',{method:'POST',body:JSON.stringify({personal_daily_limit:Number($('budgetPersonalDaily').value||0),personal_weekly_limit:Number($('budgetPersonalWeekly').value||0),business_daily_limit:Number($('budgetBusinessDaily').value||0),min_available_warning:Number($('budgetMinimum').value||0)})});$('budgetMessage').textContent='Limits saved.'}catch(err){$('budgetMessage').textContent=err.message}});

$('productForm').addEventListener('submit',async e=>{e.preventDefault();$('productMessage').textContent='Saving…';const id=$('productId').value;const body={name:$('productName').value,category:$('productCategory').value||'Food',selling_price:Number($('productPrice').value),active:$('productActive').checked,product_kind:'prepared_recipe'};try{if(id)await api(`/api/products/${id}`,{method:'PATCH',body:JSON.stringify(body)});else await api('/api/products',{method:'POST',body:JSON.stringify(body)});resetProductForm();await loadProducts();$('productMessage').textContent='Saved. Add or update the batch recipe below.'}catch(err){$('productMessage').textContent=err.message}});
$('productCancel').onclick=resetProductForm;
$('ingredientAllergenInventory')?.addEventListener('change',()=>loadIngredientAllergens().catch(error=>{$('ingredientAllergenMessage').textContent=error.message}));
$('ingredientAllergenForm')?.addEventListener('submit',async e=>{
  e.preventDefault();const out=$('ingredientAllergenMessage');if(out)out.textContent='Saving…';
  try{
    const id=Number($('ingredientAllergenInventory').value);
    if(!Number.isInteger(id))throw new Error('Choose an ingredient.');
    const contains=checkedAllergens('ingredientContains');
    const may=checkedAllergens('ingredientMayContain').filter(code=>!contains.includes(code));
    await api(`/api/inventory/${id}/allergens`,{method:'PUT',body:JSON.stringify({contains,may_contain:may,note:$('ingredientAllergenNote').value})});
    if(out)out.textContent='Ingredient allergen evidence saved. Affected prepared products now require review.';
    await loadProducts();
  }catch(error){if(out)out.textContent=error.message}
});
$('allergenProduct')?.addEventListener('change',()=>loadProductAllergens().catch(error=>{$('productAllergenMessage').textContent=error.message}));
$('saveProductCrossContact')?.addEventListener('click',async()=>{
  const out=$('productAllergenMessage');if(out)out.textContent='Saving…';
  try{
    const id=Number($('allergenProduct').value);if(!Number.isInteger(id))throw new Error('Choose a prepared product.');
    const summary=await api(`/api/products/${id}/allergens/cross-contact`,{method:'PUT',body:JSON.stringify({cross_contact:checkedAllergens('productCrossContact'),note:$('productCrossContactNote').value})});
    renderProductAllergenSummary(summary);if(out)out.textContent='Cross-contact risk saved. Review is required again.';
  }catch(error){if(out)out.textContent=error.message}
});
$('reviewProductAllergens')?.addEventListener('click',async()=>{
  const out=$('productAllergenMessage');if(out)out.textContent='Reviewing…';
  try{
    const id=Number($('allergenProduct').value);if(!Number.isInteger(id))throw new Error('Choose a prepared product.');
    const summary=await api(`/api/products/${id}/allergens/review`,{method:'POST',body:JSON.stringify({note:$('productAllergenReviewNote').value})});
    renderProductAllergenSummary(summary);if(out)out.textContent='Allergen information reviewed and confirmed for the current recipe revision.';
  }catch(error){if(out)out.textContent=error.message}
});
$('recipeProduct').onchange=syncRecipeDraftFromSelected;
$('recipeIngredient').onchange=()=>{const inv=inventory.find(i=>Number(i.id)===Number($('recipeIngredient').value));syncUnitSelect('recipeUnit',inv?.unit||inv?.base_unit||'g')};
for(const id of ['recipeYieldQty','recipeYieldUnit','recipeSellQty','recipeSellUnit'])$(id).addEventListener('input',updateRecipeCost);
$('recipeAdd').onclick=()=>{const inventoryId=Number($('recipeIngredient').value),quantity=Number($('recipeQty').value),unit=$('recipeUnit').value;if(!inventoryId||!Number.isFinite(quantity)||quantity<=0)return alert('Choose an ingredient and an amount greater than zero.');if(recipeDraft.some(x=>x.inventory_id===inventoryId))return alert('That ingredient is already in the recipe.');recipeDraft.push({inventory_id:inventoryId,quantity,unit});$('recipeQty').value='';renderRecipeDraft();updateRecipeCost()};
$('recipeSave').onclick=async()=>{const productId=Number($('recipeProduct').value);if(!productId)return alert('Create a prepared product first.');if(!recipeDraft.length)return alert('Add at least one ingredient.');$('recipeMessage').textContent='Saving batch recipe…';try{const saved=await api(`/api/products/${productId}/recipe-batch`,{method:'PUT',body:JSON.stringify({yield_quantity:Number($('recipeYieldQty').value),yield_unit:$('recipeYieldUnit').value,selling_quantity:Number($('recipeSellQty').value),selling_unit:$('recipeSellUnit').value,components:recipeDraft})});$('recipeMessage').textContent=`Recipe saved. Estimated ingredient cost per sale unit: ${money(saved.recipe_cost_per_sale_unit??saved.estimated_unit_cost)}.`;await loadProducts()}catch(err){$('recipeMessage').textContent=err.message}};
for(const id of ['stockPurchaseQty','stockPurchaseUnit','stockTotalCost','stockReorderQty','stockTargetQty'])$(id).addEventListener('input',stockPurchasePreview);
$('stockPurchaseUnit').addEventListener('change',()=>{const u=$('stockPurchaseUnit').value,m=unitMeta(u);if(m)syncUnitSelect('stockReorderUnit',m.base);stockPurchasePreview()});
stockPurchasePreview();
$('sellProduct').onchange=updateSellPreview;$('sellQty').oninput=updateSellPreview;
$('sellForm').addEventListener('submit',async e=>{e.preventDefault();$('sellMessage').textContent='Saving sale…';try{const r=await api('/api/product-sales',{method:'POST',body:JSON.stringify({product_id:Number($('sellProduct').value),quantity:Number($('sellQty').value),account:$('sellAccount').value,note:$('sellNote').value})});$('sellMessage').innerHTML=`Saved ${num(r.quantity)} portion(s). Revenue <strong>${money(r.revenue)}</strong>, estimated gross <strong>${money(r.gross_profit)}</strong>.`;e.target.reset();$('sellQty').value=1;$('sellAccount').value='cash';await Promise.all([loadTransactions(),loadStock(),loadProducts(),loadProductSales(),loadProfitability(7),loadProfitability(30)]);invalidateMerchantToday();updateSellPreview()}catch(err){if(err.data?.shortages?.length){$('sellMessage').innerHTML=`<span class="negative">Not enough stock:</span> ${err.data.shortages.map(s=>`${esc(s.item)} needs ${num(s.required)} ${esc(s.unit)}, available ${num(s.available)}`).join(' • ')}`}else $('sellMessage').textContent=err.message}});

function openEdit(tx){$('editId').value=tx.id;$('editType').value=tx.type;$('editAmount').value=Number(tx.amount);$('editAccount').value=tx.account||'cash';$('editCategory').value=tx.category||'';$('editNote').value=tx.note||'';$('editReason').value='';$('editMessage').textContent='';$('editDialog').showModal()}
async function voidManualEntry(tx){
  if(!confirm(`Void this manual/test entry of ${money(tx.amount)}? Its audit history will be preserved.`))return;
  try{await api(`/api/transactions/${tx.id}`,{method:'PATCH',body:JSON.stringify({amount:0,note:[tx.note,'VOIDED TEST/MANUAL ENTRY'].filter(Boolean).join(' • '),reason:'Voided test or manual entry; original value preserved in audit history'})});await loadTransactions();invalidateMerchantToday()}catch(err){alert(err.message)}
}
$('editCancel').onclick=()=>$('editDialog').close();$('editForm').addEventListener('submit',async e=>{e.preventDefault();$('editMessage').textContent='Saving correction…';try{await api(`/api/transactions/${$('editId').value}`,{method:'PATCH',body:JSON.stringify({type:$('editType').value,amount:Number($('editAmount').value),account:$('editAccount').value,category:$('editCategory').value,note:$('editNote').value,reason:$('editReason').value})});$('editDialog').close();await loadTransactions();invalidateMerchantToday()}catch(err){$('editMessage').textContent=err.message}});

function setView(name){
  const view=$(`view${name}`);if(!view)return;
  document.querySelectorAll('.view').forEach(v=>v.classList.add('hidden'));
  view.classList.remove('hidden');
  document.querySelectorAll('.bottomNav button').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  window.scrollTo({top:0,behavior:'smooth'});
  if(name==='Sell')updateSellPreview();
  loadMerchantView(name).catch(error=>console.error(error));
}
async function openInventoryNotificationContext({inventoryId=null,lotId=null}={}){
  if(!isMerchantBaseActive())throw new Error('Open the Merchant profile to view this Inventory alert.');
  setView('Stock');
  await loadStock();
  const selector=lotId?`[data-lot-id="${Number(lotId)}"]`:inventoryId?`[data-inventory-id="${Number(inventoryId)}"]`:null;
  const node=selector?document.querySelector(selector):$('viewStock');
  if(node){
    node.scrollIntoView({behavior:'smooth',block:'center'});
    node.classList.add('inventoryNotificationTarget');
    setTimeout(()=>node.classList.remove('inventoryNotificationTarget'),2400);
  }
}
window.BusinessLifeInventory={...(window.BusinessLifeInventory||{}),openNotificationContext:openInventoryNotificationContext};
document.querySelectorAll('.bottomNav [data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view));
document.querySelectorAll('.bottomNav [data-merchant-action]').forEach(b=>b.onclick=()=>openMerchantAction(b.dataset.merchantAction));
document.querySelectorAll('[data-view-link]').forEach(b=>b.onclick=()=>setView(b.dataset.viewLink));
document.querySelectorAll('[data-today-action]').forEach(b=>b.onclick=()=>openMerchantAction(b.dataset.todayAction));
if($('todayRefresh'))$('todayRefresh').onclick=()=>{invalidateMerchantToday();loadMerchantToday({force:true}).catch(()=>{})};
if($('todayRetry'))$('todayRetry').onclick=()=>{invalidateMerchantToday();loadMerchantToday({force:true}).catch(()=>{})};
$('exportLink').onclick=async e=>{e.preventDefault();try{const r=await fetch('/api/export.csv');if(!r.ok)throw new Error('Export failed');const blob=await r.blob();const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='transactions.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}catch(err){alert(err.message)}};
function pendingInventoryNotificationContext(){
  const q=new URLSearchParams(window.location.search);
  const inventoryId=Number(q.get('inventory_item')||q.get('inventory_id')||0)||null;
  const lotId=Number(q.get('inventory_lot')||0)||null;
  return inventoryId||lotId?{inventoryId,lotId}:null;
}
async function openPendingInventoryNotification(){
  const pending=pendingInventoryNotificationContext();
  if(!pending||!isMerchantBaseActive())return false;
  try{
    await openInventoryNotificationContext(pending);
    const url=new URL(window.location.href);
    url.searchParams.delete('inventory_item');url.searchParams.delete('inventory_id');url.searchParams.delete('inventory_lot');
    history.replaceState({},'',url.pathname+(url.search?'?'+url.searchParams.toString():'')+url.hash);
    return true;
  }catch{return false}
}
document.addEventListener('abl:profile-state',event=>{
  baseActiveRole=event.detail?.activeRole||null;
  if(isMerchantBaseActive())loadMerchantToday().catch(()=>{});
  if(isMerchantBaseActive())openPendingInventoryNotification().catch(()=>{});
});
document.addEventListener('abl:business-workspace-changed',()=>{
  invalidateMerchantToday();
  if(isMerchantBaseActive()&&!$('viewDashboard')?.classList.contains('hidden'))loadMerchantToday({force:true}).catch(()=>{});
});
window.addEventListener('online',()=>{
  setOnline(true);
  if(isMerchantBaseActive()&&!$('viewDashboard')?.classList.contains('hidden')){
    invalidateMerchantToday();loadMerchantToday({force:true}).catch(()=>{});
  }
});
window.addEventListener('offline',()=>setOnline(false));
setOnline(navigator.onLine);
if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
initStockPicker();
(window.ABLSession?.ready||Promise.resolve()).then(()=>{
  token=Boolean(window.ABLSession?.authenticated());
  if(token){
    showShell();
    if(window.BusinessLifeProfileState){
      baseActiveRole=window.BusinessLifeProfileState.activeRole||null;
      if(isMerchantBaseActive())loadMerchantToday().catch(()=>{});
      if(isMerchantBaseActive())openPendingInventoryNotification().catch(()=>{});
    }
  }
});
