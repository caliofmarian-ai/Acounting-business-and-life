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
  const choices = document.getElementById('accountAuthChoices');
  if(!choices) return setTimeout(ensureGuestEntry,80);
  const button = document.createElement('button');
  button.id = 'guestExploreBtn';
  button.className = 'accountAuthBtn guestExploreEntry';
  button.type = 'button';
  button.textContent = 'Explore as Guest';
  button.addEventListener('click', openGuest);
  choices.insertBefore(button, choices.querySelector('.accountAuthHint'));
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
