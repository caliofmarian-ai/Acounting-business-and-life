const BL_PUBLIC_PRICING_ENDPOINT='/api/public/pricing';
let blPricingPromise=null;
const blEsc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const blPct=v=>Number(v||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})+'%';
function blPricingGet(){
  if(!blPricingPromise)blPricingPromise=fetch(BL_PUBLIC_PRICING_ENDPOINT,{headers:{Accept:'application/json'}}).then(async r=>{const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error||'Pricing unavailable');return b});
  return blPricingPromise;
}
function blRailList(data){
  const rails=data?.payment_processor?.rails||[];
  if(!rails.length)return'';
  return '<details class="blFeeDetails"><summary>PayMongo published processing benchmarks</summary><div class="blFeeRailList">'+rails.map(r=>'<div><span>'+blEsc(r.label)+'</span><strong>'+blPct(r.variable_rate_pct)+(Number(r.fixed_fee_php||0)>0?' + ₱'+Number(r.fixed_fee_php).toFixed(2):'')+'</strong></div>').join('')+'</div><small>As of '+blEsc(data.payment_processor.benchmark_as_of)+'. Published rates exclude VAT. Actual provider evidence overrides this benchmark.</small></details>';
}
function blRoleCard(scope,data){
  const p=data?.profiles?.[scope];
  if(!p)return'<div class="blFeeCard compact">Pricing information unavailable.</div>';
  if(scope==='customer')return'<section class="blFeeCard compact"><div class="blFeeEyebrow">TRANSPARENT PRICING</div><div class="blFeeHeadline"><strong>Customer platform fee: 0%</strong><span>Business & Life Customer stays free.</span></div>'+blRailList(data)+'</section>';
  if(scope==='courier')return'<section class="blFeeCard compact"><div class="blFeeEyebrow">DELIVERY PRICING</div><div class="blFeeHeadline"><strong>'+p.promo_days+' days at 0% Business & Life production fee</strong><span>Then '+blPct(p.post_promo_delivery_production_rate_pct)+' of verified delivery price. No monthly subscription.</span></div>'+blRailList(data)+'</section>';
  return'<section class="blFeeCard compact"><div class="blFeeEyebrow">LOW, TRANSPARENT PLATFORM FEE</div><div class="blFeeHeadline"><strong>'+blPct(p.post_promo_transaction_rate_pct)+' after the '+p.promo_days+'-day Business & Life promotion</strong><span>During the promotion: 0% Business & Life transaction fee. Payment-processor charges are separate.</span></div><div class="blFeeNote">Monthly subscription: ₱'+Number(p.monthly_subscription_amount||0).toFixed(0)+'/month after the promotion. Live billing remains gated. No hidden combined “service fee”.</div>'+blRailList(data)+'</section>';
}
function blCheckoutCard(data){
  const m=data?.profiles?.merchant;
  return'<section class="blFeeCard checkout"><div class="blFeeEyebrow">FEE TRANSPARENCY</div><div class="blFeeHeadline"><strong>Business & Life Customer platform fee: 0%</strong><span>Participating Merchant platform fee after its promotion: '+blPct(m?.post_promo_transaction_rate_pct)+'. This is a Merchant-side platform policy, not a hidden Customer surcharge.</span></div><div class="blFeeNote">Digital payment processing is a separate PayMongo/provider cost and must be disclosed separately when applicable.</div>'+blRailList(data)+'</section>';
}
function blPublicCard(data){
  const r=data?.profiles?.merchant?.post_promo_transaction_rate_pct;
  return'<section class="blFeeCard public"><div class="blFeeEyebrow">PRICING PRINCIPLE</div><div class="blFeeHeadline"><strong>Low, transparent platform fee — '+blPct(r)+'</strong><span>Business & Life is designed to be sustainable, not extractive.</span></div><div class="blFeeNote">The '+data.profiles.merchant.promo_days+'-day promotion means 0% Business & Life transaction fee. Third-party payment processing remains separate.</div></section>';
}
function blPricingSkeleton(node){
  if(!node||node.dataset.blPricingReady)return;
  node.dataset.blPricingReady='loading';
  node.setAttribute('aria-busy','true');
  node.innerHTML='<section class="blFeeCard compact blFeeLoading" role="status" aria-live="polite"><div class="blFeeLoadingEyebrow"></div><div class="blFeeLoadingLine wide"></div><div class="blFeeLoadingLine"></div><span class="blFeeLoadingCopy">Loading pricing details…</span></section>';
}
async function blFillPricing(root=document){
  const nodes=[...root.querySelectorAll?.('[data-bl-pricing]')||[]].filter(n=>!n.dataset.blPricingReady);
  if(!nodes.length)return;
  nodes.forEach(blPricingSkeleton);
  let data;try{data=await blPricingGet()}catch(e){nodes.forEach(n=>{n.innerHTML='<div class="blFeeCard compact blFeeLoadError"><span>Pricing details could not be loaded.</span></div>';n.dataset.blPricingReady='error';n.removeAttribute('aria-busy')});return}
  for(const n of nodes){
    const scope=n.dataset.blPricing||'public';
    n.innerHTML=scope==='customer_checkout'?blCheckoutCard(data):scope==='public'?blPublicCard(data):blRoleCard(scope,data);
    n.dataset.blPricingReady='1';
    n.removeAttribute('aria-busy');
  }
}
const blPricingObserver=new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)if(n.nodeType===1)blFillPricing(n).catch(()=>{})});
function blPricingBoot(){blFillPricing(document).catch(()=>{});blPricingObserver.observe(document.body,{childList:true,subtree:true})}
window.BusinessLifePricing=Object.freeze({get:blPricingGet,fill:blFillPricing});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',blPricingBoot,{once:true});else blPricingBoot();
