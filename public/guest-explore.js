const gh = (v='') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const gmoney = (v, currency='PHP') => new Intl.NumberFormat('en-PH',{style:'currency',currency,maximumFractionDigits:2}).format(Number(v||0));
let guestRoot = null;
let guestBody = null;

async function guestFetch(path){
  const response = await fetch(path,{headers:{Accept:'application/json'}});
  const body = await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(body.error || 'Public information is unavailable right now.');
  return body;
}

function authToken(){ return localStorage.getItem('abl_token') || ''; }

function ensureGuestEntry(){
  if(authToken() || document.getElementById('guestExploreBtn')) return;
  const login=document.getElementById('login');
  const modern=document.getElementById('modernAuthRoot');
  const legacyForm=document.getElementById('loginForm');
  if(!login || (!modern&&!legacyForm)) return setTimeout(ensureGuestEntry,80);
  const slot=document.createElement('section');
  slot.id='guestExploreEntrySlot';
  slot.className='guestExploreEntrySlot';
  slot.innerHTML='<button id="guestExploreBtn" class="guestExploreEntry" type="button"><span>Explore as Guest</span><small>No account needed · public information only</small></button>';
  if(modern) modern.insertAdjacentElement('beforebegin',slot);
  else legacyForm.insertAdjacentElement('beforebegin',slot);
  slot.querySelector('#guestExploreBtn').addEventListener('click',openGuest);
}

function ensureGuestRoot(){
  if(guestRoot) return guestRoot;
  guestRoot = document.createElement('section');
  guestRoot.id = 'guestExploreRoot';
  guestRoot.className = 'guestExplore hidden';
  guestRoot.setAttribute('aria-label','Guest exploration');
  guestRoot.innerHTML =
    '<header class="guestTopbar">'+
      '<button id="guestClose" class="guestIconBtn" type="button" aria-label="Close guest mode">←</button>'+
      '<div class="guestBrand"><strong>Business & Life</strong><span>Guest mode · public information only</span></div>'+
      '<button id="guestCreateAccount" class="guestAccountBtn" type="button">Create account</button>'+
    '</header>'+
    '<nav class="guestTabs" aria-label="Guest navigation">'+
      '<button class="active" data-guest-tab="discover" type="button">Discover</button>'+
      '<button data-guest-tab="guide" type="button">How it works</button>'+
      '<button data-guest-tab="pricing" type="button">Pricing & benefits</button>'+
      '<button data-guest-tab="privacy" type="button">Privacy</button>'+
    '</nav>'+
    '<main id="guestBody" class="guestBody"></main>';
  document.body.appendChild(guestRoot);
  guestBody = guestRoot.querySelector('#guestBody');
  guestRoot.querySelector('#guestClose').addEventListener('click',closeGuest);
  guestRoot.querySelector('#guestCreateAccount').addEventListener('click',openRegistration);
  guestRoot.querySelectorAll('[data-guest-tab]').forEach(button=>{
    button.addEventListener('click',()=>{
      guestRoot.querySelectorAll('[data-guest-tab]').forEach(x=>x.classList.toggle('active',x===button));
      const tab=button.dataset.guestTab;
      if(tab==='discover') renderDiscover();
      if(tab==='guide') renderGuide();
      if(tab==='pricing') renderPricing();
      if(tab==='privacy') renderPrivacy();
    });
  });
  return guestRoot;
}

function openGuest(){
  ensureGuestRoot();
  guestRoot.classList.remove('hidden');
  document.body.classList.add('guestModeOpen');
  renderDiscover();
}

function closeGuest(){
  guestRoot?.classList.add('hidden');
  document.body.classList.remove('guestModeOpen');
}

function openRegistration(){
  closeGuest();
  const modernRegister=document.querySelector('[data-auth-mode="register"]');
  if(modernRegister){modernRegister.click();modernRegister.scrollIntoView({behavior:'smooth',block:'center'});return}
  const button=document.getElementById('createAccountBtn');
  if(button) button.click();
  else setTimeout(()=>document.getElementById('createAccountBtn')?.click(),120);
}

function renderGuestError(message){
  guestBody.innerHTML='<section class="guestState"><strong>We could not load the public directory.</strong><p>'+gh(message)+'</p><button id="guestRetry" type="button">Try again</button></section>';
  guestBody.querySelector('#guestRetry')?.addEventListener('click',()=>renderDiscover());
}

async function renderDiscover(domain=''){
  guestBody.innerHTML =
    '<section class="guestHero">'+
      '<span class="guestEyebrow">Explore before you register</span>'+
      '<h1>See the public side of the ecosystem.</h1>'+
      '<p>Browse only information that businesses chose to publish. Private profiles, finances and internal activity stay private.</p>'+
    '</section>'+
    '<div data-bl-pricing="public"></div>'+
    '<div class="guestFilters">'+
      '<button class="'+(!domain?'active':'')+'" data-domain="" type="button">All</button>'+
      '<button class="'+(domain==='food'?'active':'')+'" data-domain="food" type="button">Food</button>'+
      '<button class="'+(domain==='non_food'?'active':'')+'" data-domain="non_food" type="button">Non-food</button>'+
    '</div>'+
    '<section id="guestStoreList" class="guestStoreGrid"><div class="guestLoading">Loading public storefronts…</div></section>'+
    '<section class="guestProtectedNote"><strong>Want to order or use a service?</strong><span>Create an account when you are ready. Guest mode never creates a profile, wallet or business record.</span><button id="guestJoinFromDiscover" type="button">Create free account</button></section>';
  guestBody.querySelectorAll('[data-domain]').forEach(button=>button.addEventListener('click',()=>renderDiscover(button.dataset.domain)));
  guestBody.querySelector('#guestJoinFromDiscover')?.addEventListener('click',openRegistration);
  try{
    const query=domain?'?domain='+encodeURIComponent(domain):'';
    const stores=await guestFetch('/api/public/marketplace/storefronts'+query);
    const list=guestBody.querySelector('#guestStoreList');
    if(!stores.length){
      list.innerHTML='<div class="guestState"><strong>No public storefronts yet.</strong><p>Only storefronts explicitly published by their owners appear here.</p></div>';
      return;
    }
    list.innerHTML=stores.map(store=>
      '<button class="guestStoreCard" type="button" data-store="'+Number(store.business_id)+'">'+
        '<span class="guestStoreLogo">'+(store.logo_data_url?'<img src="'+gh(store.logo_data_url)+'" alt="">':'🏪')+'</span>'+
        '<span class="guestStoreCopy"><small>'+gh(String(store.merchant_domain||'').replace('_',' '))+' · '+gh(store.opening_status||'')+'</small><strong>'+gh(store.store_name)+'</strong><span>'+gh(store.description||'')+'</span><em>'+Number(store.product_count||0)+' public product'+(Number(store.product_count||0)===1?'':'s')+(store.min_price!=null?' · from '+gh(gmoney(store.min_price)):'')+'</em></span>'+
        '<span class="guestChevron">›</span>'+
      '</button>'
    ).join('');
    list.querySelectorAll('[data-store]').forEach(button=>button.addEventListener('click',()=>renderStore(Number(button.dataset.store))));
  }catch(error){ renderGuestError(error.message); }
}

async function renderStore(businessId){
  guestBody.innerHTML='<div class="guestLoading">Loading public storefront…</div>';
  try{
    const store=await guestFetch('/api/public/marketplace/storefronts/'+businessId);
    const currency=store.currency_code||'PHP';
    guestBody.innerHTML=
      '<button id="guestBackToStores" class="guestBack" type="button">← Public marketplace</button>'+
      '<section class="guestStoreHero">'+
        '<span class="guestStoreLogo large">'+(store.logo_data_url?'<img src="'+gh(store.logo_data_url)+'" alt="">':'🏪')+'</span>'+
        '<div><small>'+gh(String(store.merchant_domain||'').replace('_',' '))+' · '+gh(store.opening_status||'')+'</small><h1>'+gh(store.store_name)+'</h1><p>'+gh(store.description||'')+'</p><div class="guestChips">'+(store.pickup_enabled?'<span>Pickup</span>':'')+(store.delivery_enabled?'<span>Delivery</span>':'')+(store.cash_enabled?'<span>Cash</span>':'')+(store.online_enabled?'<span>Online payment</span>':'')+'</div></div>'+
      '</section>'+
      '<div data-bl-pricing="public"></div>'+
      '<section class="guestSectionHead"><div><small>Published catalog</small><h2>Products</h2></div><span>Public information only</span></section>'+
      '<div class="guestProductGrid">'+
        (store.products?.length?store.products.map(product=>
          '<article class="guestProductCard">'+
            '<div class="guestProductImage">'+(product.image_data_url?'<img src="'+gh(product.image_data_url)+'" alt="">':(product.product_domain==='food'?'🍽️':'📦'))+'</div>'+
            '<small>'+gh(product.category||'General')+'</small>'+
            '<strong>'+gh(product.name)+'</strong>'+
            '<p>'+gh(product.description||'')+'</p>'+
            '<div><b>'+gh(gmoney(product.selling_price,currency))+'</b><button type="button" data-guest-order>Sign in to order</button></div>'+
          '</article>'
        ).join(''):'<div class="guestState"><strong>No published products.</strong><p>This business has not made any products public yet.</p></div>')+
      '</div>';
    guestBody.querySelector('#guestBackToStores')?.addEventListener('click',()=>renderDiscover());
    guestBody.querySelectorAll('[data-guest-order]').forEach(button=>button.addEventListener('click',openRegistration));
  }catch(error){ renderGuestError(error.message); }
}

function renderGuide(){
  guestBody.innerHTML =
    '<section class="guestHero"><span class="guestEyebrow">Guided introduction</span><h1>Explore first. Activate only what you need.</h1><p>The onboarding layer explains the ecosystem; it does not grant permissions or change business data.</p></section>'+
    '<div class="guestJourney">'+
      '<article><span>1</span><div><strong>Guest</strong><p>Browse public businesses, products, public services and Help without creating an account.</p></div></article>'+
      '<article><span>2</span><div><strong>Registered user</strong><p>Create one human account when you want to order, save private information or activate a profile.</p></div></article>'+
      '<article><span>3</span><div><strong>Email verified</strong><p>Verify identity/contact information where required for protected actions.</p></div></article>'+
      '<article><span>4</span><div><strong>Activated profile</strong><p>Use Customer, Merchant, Supplier, Delivery or Local Services according to each profile’s authorization rules.</p></div></article>'+
    '</div>'+
    '<div data-bl-pricing="public"></div>'+
    '<section class="guestRoleGrid">'+
      '<article><b>Customer</b><span>Orders, payments and private purchase history after sign-in.</span></article>'+
      '<article><b>Merchant</b><span>Storefront plus private business workspace. Publishing a shop never publishes its accounting.</span></article>'+
      '<article><b>Supplier</b><span>Relationship-scoped B2B work after activation.</span></article>'+
      '<article><b>Delivery</b><span>Operational access only after the required authorization.</span></article>'+
      '<article><b>Local Services</b><span>Public service profile only to the extent the provider chooses and is eligible to publish.</span></article>'+
    '</section>'+
    '<div class="guestGuideActions"><button id="guestGuideJoin" type="button">Create account</button><a href="/help/">Open Help Center</a></div>';
  guestBody.querySelector('#guestGuideJoin')?.addEventListener('click',openRegistration);
}

async function renderPricing(){
  guestBody.innerHTML='<div class="guestLoading">Loading transparent pricing…</div>';
  try{
    const data=await guestFetch('/api/public/pricing');
    const pct=v=>Number(v||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})+'%';
    const roleCard=(title,key,copy)=>{
      const p=data.profiles[key];
      const rate=key==='courier'?pct(p.post_promo_delivery_production_rate_pct):pct(p.post_promo_transaction_rate_pct);
      const promo=Number(p.promo_days||0);
      return '<article class="guestPricingCard"><small>'+gh(title)+'</small><strong>'+gh(key==='courier'?'0% for '+promo+' days → '+rate+' after promo':promo+' days at 0% Business & Life fee → '+rate+' after promo')+'</strong><p>'+gh(copy)+'</p></article>';
    };
    const rails=(data.payment_processor?.rails||[]).map(r=>'<div class="guestFeeRow"><span>'+gh(r.label)+'</span><strong>'+gh(pct(r.variable_rate_pct)+(Number(r.fixed_fee_php||0)>0?' + ₱'+Number(r.fixed_fee_php).toFixed(2):''))+'</strong></div>').join('');
    guestBody.innerHTML=
      '<section class="guestHero"><span class="guestEyebrow">Transparent pricing</span><h1>'+gh(data.principle.headline)+'</h1><p>'+gh(data.principle.message)+' Every fee has an owner, a reason and a separate line.</p></section>'+
      '<section class="guestPricingPromise"><strong>What the promotion really means</strong><p>'+gh(data.promotion_disclosure)+'</p></section>'+
      '<div class="guestPricingGrid">'+
        '<article class="guestPricingCard"><small>CUSTOMER</small><strong>Free Business & Life profile</strong><p>0% Business & Life Customer platform fee.</p></article>'+
        roleCard('MERCHANT','merchant','Marketplace, business tools and accounting. Monthly subscription after promo: ₱'+Number(p.monthly_subscription_amount||0).toFixed(0)+'/month.')+
        roleCard('SUPPLIER','supplier','B2B procurement and Supplier financial workspace. Monthly subscription after promo: ₱'+Number(p.monthly_subscription_amount||0).toFixed(0)+'/month. Processor charges remain separate from the Business & Life fee.')+
        roleCard('LOCAL SERVICES','local_services','Professional profile, quotes, jobs and financial tools. Monthly subscription after promo: ₱'+Number(p.monthly_subscription_amount||0).toFixed(0)+'/month. The 0.50% policy applies only after the promotional entitlement.')+
        roleCard('DELIVERY','courier','No monthly subscription. The post-promo production fee is based only on verified delivery price.')+
      '</div>'+
      '<section class="guestFeeBreakdown"><div class="guestSectionHead"><div><small>THIRD-PARTY PROCESSING</small><h2>PayMongo benchmark rates</h2></div><span>as of '+gh(data.payment_processor.benchmark_as_of)+'</span></div>'+rails+
        '<p>Published PayMongo rates shown here exclude VAT. Actual provider transaction evidence overrides the benchmark. Business & Life does not relabel PayMongo fees as its own fee.</p></section>'+
      '<section class="guestBenefits"><h2>What you get around the fee</h2><div class="guestBenefitGrid">'+
        '<article><strong>Understand your money</strong><span>Cash, Bank, GCash, expenses, income, receivables and budgets stay understandable.</span></article>'+
        '<article><strong>Separate business and personal activity</strong><span>Profiles and business workspaces keep money and permissions from mixing.</span></article>'+
        '<article><strong>Operate, not just advertise</strong><span>Orders, stock, Suppliers, Delivery and Local Services connect to financial evidence.</span></article>'+
        '<article><strong>Private by default</strong><span>Your sales, balances and internal business performance are not public marketplace content.</span></article>'+
      '</div></section>'+
      '<div class="guestGuideActions"><button id="guestPricingJoin" type="button">Create account</button><a href="/help/article/pricing-fees-and-promotions">Read pricing guide</a></div>';
    guestBody.querySelector('#guestPricingJoin')?.addEventListener('click',openRegistration);
  }catch(error){renderGuestError(error.message)}
}

function renderPrivacy(){
  guestBody.innerHTML =
    '<section class="guestHero"><span class="guestEyebrow">Privacy boundary</span><h1>Public means chosen for public display.</h1><p>Guest mode does not unlock another person’s account or business workspace.</p></section>'+
    '<section class="guestPrivacyCard"><h2>Guest can see</h2><ul><li>Storefronts explicitly published by their owners</li><li>Products explicitly published in those storefronts</li><li>Public descriptions and availability settings</li><li>Public Help and ecosystem explanations</li></ul></section>'+
    '<section class="guestPrivacyCard protected"><h2>Guest cannot see</h2><ul><li>Sales, revenue, profit or transaction history</li><li>Budgets, balances, withdrawals or accounting reports</li><li>Internal stock quantities, supplier terms or internal margins</li><li>Private profiles, private addresses/contact details or documents</li><li>Admin, authorization, incident or evidence data</li></ul></section>'+
    '<p class="guestPrivacyRule"><strong>Rule:</strong> private by default, public by explicit choice.</p>';
}

function bootGuest(){
  if(authToken()) return;
  ensureGuestEntry();
  ensureGuestRoot();
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bootGuest);
else bootGuest();
