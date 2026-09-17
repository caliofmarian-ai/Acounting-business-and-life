const state={data:null};

function esc(value){return String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function profileLetter(id){return ({customer:'C',merchant:'M',supplier:'S',courier:'D',service_provider:'L'})[id]||'?'}
function profileLabel(id){return state.data?.profiles.find(p=>p.id===id)?.label||id}
function articleUrl(slug){return '/help/article/'+encodeURIComponent(slug)}
function profileUrl(id){return '/help/profile/'+encodeURIComponent(id)}

async function load(){
  const r=await fetch('/help/content.json',{headers:{Accept:'application/json'}});
  if(!r.ok) throw new Error('Help content could not be loaded.');
  state.data=await r.json();
  renderRoute();
  bindGlobal();
}

function route(){
  const parts=location.pathname.split('/').filter(Boolean);
  if(parts[0]!=='help'||parts.length===1)return{type:'home'};
  if(parts[1]==='profile'&&parts[2])return{type:'profile',key:decodeURIComponent(parts[2])};
  if(parts[1]==='article'&&parts[2])return{type:'article',key:decodeURIComponent(parts[2])};
  if(parts[1]==='error'&&parts[2])return{type:'error',key:decodeURIComponent(parts[2])};
  return{type:'not-found'};
}

function articleBySlug(slug){return state.data.articles.find(a=>a.slug===slug)}
function articlesForProfile(id){return state.data.articles.filter(a=>a.profiles?.includes(id))}
function searchArticles(q){
  const s=q.trim().toLowerCase();if(!s)return[];
  return state.data.articles.map(a=>{
    const hay=[
      a.title,a.summary,a.shortAnswer,a.section,
      ...(a.profiles||[]),...(a.helpCodes||[]),...(a.steps||[]),...(a.notes||[]),
      ...(a.beforeYouStart||[]),...(a.commonProblems||[]),a.whatHappensNext||''
    ].join(' ').toLowerCase();
    let score=0;
    if(a.title.toLowerCase().includes(s))score+=6;
    if(a.summary.toLowerCase().includes(s))score+=3;
    if((a.helpCodes||[]).some(x=>x.toLowerCase()===s))score+=8;
    if(hay.includes(s))score+=1;
    return{a,score};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.a.title.localeCompare(b.a.title)).slice(0,10).map(x=>x.a);
}

function searchMarkup(){
  return `<div class="search-wrap">
    <span class="search-icon" aria-hidden="true">⌕</span>
    <input id="helpSearch" class="search-box" type="search" autocomplete="off" placeholder="Search: “cash payment”, “delivery code”, “forgot password”…" aria-label="Search Help Center">
    <div id="searchResults" class="search-results" role="listbox"></div>
  </div>`;
}

function home(){
  const profiles=state.data.profiles.map(p=>`<a class="profile-card" data-accent="${esc(p.accent)}" href="${profileUrl(p.id)}">
    <span class="profile-icon">${profileLetter(p.id)}</span><h3>${esc(p.label)}</h3><p>${esc(p.tagline)}</p><span class="view-link">View guides →</span>
  </a>`).join('');
  const popular=['create-account','place-order','merchant-accounting','supplier-purchase-orders','courier-active-delivery','service-requests-quotes-jobs'].map(articleBySlug).filter(Boolean).map(guideCard).join('');
  const trouble=Object.entries(state.data.helpCodes).slice(0,9).map(([code,slug])=>{
    const a=articleBySlug(slug);if(!a)return'';return`<a class="trouble-card" href="/help/error/${encodeURIComponent(code)}"><span class="help-code">${esc(code)}</span><h3>${esc(a.title)}</h3><p>${esc(a.summary)}</p></a>`;
  }).join('');
  return `<section class="hero"><div class="hero-inner">
    <div class="eyebrow">Official public documentation</div>
    <h1>Find the answer before the problem becomes frustrating.</h1>
    <p>${state.data.articles.length} current guides organized around the way Customers, Merchants, Suppliers, Delivery Providers and Local Service Providers actually use the product.</p>
    ${searchMarkup()}
    <div class="quick-links">
      <a class="chip" href="${articleUrl('sign-in-recovery')}">I can’t sign in</a>
      <a class="chip" href="${articleUrl('order-statuses-explained')}">What does this status mean?</a>
      <a class="chip" href="${articleUrl('glossary')}">Product glossary</a>
      <a class="chip" href="${articleUrl('report-problem')}">I need to report a problem</a>
    </div>
  </div></section>
  <section class="section" id="profiles"><div class="section-heading"><div><div class="eyebrow">Start with your role</div><h2>Choose your profile</h2></div><p>One account can have several profiles, but each profile has a dedicated workspace, journey and access rules.</p></div><div class="profile-grid">${profiles}</div></section>
  <section class="section"><div class="section-heading"><div><div class="eyebrow">How the product fits together</div><h2>One identity, separate workspaces</h2></div><p>The Help Center mirrors the product architecture instead of exposing internal server names.</p></div><div class="architecture-card"><img src="/help/product-map.svg" alt="Diagram showing one Business & Life account connected to Customer, Merchant, Supplier, Delivery and Local Services profiles."></div></section>
  <section class="section" id="popular"><div class="section-heading"><div><div class="eyebrow">Common tasks</div><h2>Popular guides</h2></div></div><div class="guide-grid">${popular}</div></section>
  <section class="section" id="troubleshooting"><div class="section-heading"><div><div class="eyebrow">When something goes wrong</div><h2>Troubleshooting by help code</h2></div><p>Stable help codes can send you from an app message directly to the correct explanation.</p></div><div class="trouble-grid">${trouble}</div></section>`;
}

function guideCard(a){return`<a class="guide-card" href="${articleUrl(a.slug)}"><span class="kicker">${esc(a.section)}</span><h3>${esc(a.title)}</h3><p>${esc(a.summary)}</p></a>`}

function profilePage(id){
  const p=state.data.profiles.find(x=>x.id===id);if(!p)return notFound();
  const articles=articlesForProfile(id);
  const list=articles.map(a=>`<a href="${articleUrl(a.slug)}"><strong>${esc(a.title)}</strong><small>${esc(a.summary)}</small></a>`).join('');
  const start=(p.startHere||[]).map((x,i)=>`<li><span>${i+1}</span><div>${esc(x)}</div></li>`).join('');
  const journey=(p.journey||[]).map((x,i)=>`<span><b>${i+1}</b>${esc(x)}</span>`).join('');
  return `<section class="profile-hero"><div class="profile-hero-inner">
    <div class="breadcrumbs"><a href="/help">Help Center</a> / ${esc(p.label)}</div>
    <div class="eyebrow">${esc(p.label)} profile</div>
    <h1>${esc(p.tagline)}</h1>
    <p>Use this catalog to understand the workspace, normal task flow, money/state boundaries and the situations that require approval or troubleshooting.</p>
    <div class="module-pills">${p.modules.map(x=>`<span>${esc(x)}</span>`).join('')}</div>
  </div></section>
  <section class="section profile-start">
    <div class="profile-two-col">
      <div class="start-card"><div class="eyebrow">Start here</div><h2>First steps</h2><ol>${start}</ol></div>
      <div class="start-card"><div class="eyebrow">End-to-end journey</div><h2>How this profile works</h2><div class="journey-mini">${journey}</div></div>
    </div>
    <div class="flow-card"><img src="${esc(p.flowImage)}" alt="${esc(p.label)} end-to-end workflow diagram"></div>
  </section>
  <section class="section"><div class="section-heading"><div><div class="eyebrow">${articles.length} current guides</div><h2>${esc(p.label)} catalog</h2></div><p>Each guide explains what to do, prerequisites, what happens next and common problems where applicable.</p></div><div class="article-list">${list||'<p>No public guides yet.</p>'}</div></section>`;
}

function listBlock(title,items,className='note-list'){
  if(!items?.length)return'';
  return`<h2>${esc(title)}</h2><ul class="${className}">${items.map(n=>`<li>${esc(n)}</li>`).join('')}</ul>`;
}

function articlePage(slug,requestedCode=''){
  const a=articleBySlug(slug);if(!a)return notFound();
  const profileLinks=(a.profiles||[]).map(id=>`<span>${esc(profileLabel(id))}</span>`).join('')||'<span>All profiles</span>';
  const sectionArticles=state.data.articles.filter(x=>x.section===a.section).slice(0,12);
  const side=sectionArticles.map(x=>`<a class="${x.slug===a.slug?'active':''}" href="${articleUrl(x.slug)}">${esc(x.title)}</a>`).join('');
  const steps=(a.steps||[]).map(x=>`<li><div>${esc(x)}</div></li>`).join('');
  const before=listBlock('Before you start',a.beforeYouStart,'check-list');
  const notes=listBlock('Important notes',a.notes);
  const problems=listBlock('Common problems',a.commonProblems,'problem-list');
  const next=a.whatHappensNext?`<div class="next-panel"><strong>What happens next</strong><p>${esc(a.whatHappensNext)}</p></div>`:'';
  const visual=a.visual?`<figure class="article-visual"><img src="${esc(a.visual.src)}" alt="${esc(a.visual.alt||'')}"><figcaption>${esc(a.visual.caption||'')}</figcaption></figure>`:'';
  const sections=(a.sections||[]).map(section=>{
    const paragraphs=(section.paragraphs||[]).map(p=>`<p>${esc(p)}</p>`).join('');
    const bullets=(section.bullets||[]).length?`<ul class="content-bullets">${section.bullets.map(b=>`<li>${esc(b)}</li>`).join('')}</ul>`:'';
    return `<section class="content-section"><h2>${esc(section.title)}</h2>${paragraphs}${bullets}</section>`;
  }).join('');
  const related=(a.related||[]).map(articleBySlug).filter(Boolean);
  const relatedMarkup=related.length?`<h2>Related guides</h2><div class="related-grid">${related.map(guideCard).join('')}</div>`:'';
  const codes=[...new Set([...(a.helpCodes||[]),requestedCode].filter(Boolean))];
  const error=codes.length?`<div class="error-panel"><span class="help-code">${esc(codes.join(' • '))}</span><p>This stable help code can be used by the application’s “Learn more” action without depending on translated error text.</p></div>`:'';
  return`<div class="article-layout">
    <aside class="article-side"><strong>${esc(a.section)}</strong>${side}</aside>
    <article class="article-main">
      <div class="breadcrumbs"><a href="/help">Help Center</a> / <span>${esc(a.section)}</span></div>
      <div class="article-kicker">${profileLinks}<span>${esc(a.status)}</span></div>
      <h1>${esc(a.title)}</h1>
      <p class="article-lede">${esc(a.summary)}</p>
      <div class="short-answer"><strong>Short answer</strong><div>${esc(a.shortAnswer)}</div></div>
      ${visual}
      ${sections}
      ${before}
      ${steps?'<h2>What to do</h2><ol class="steps">'+steps+'</ol>':''}
      ${next}${notes}${problems}${error}${relatedMarkup}
    </article>
    <aside class="article-rail">
      <div class="rail-card"><h3>Was this helpful?</h3><p>Your feedback helps us improve the public guides.</p><div class="rail-actions"><button type="button">Yes</button><button type="button">No</button></div></div>
      <div class="rail-card"><h3>Still stuck?</h3><p>For an operational problem involving an order, delivery, payment, Supplier, service job or account safety, use the private incident/support path available in the app.</p><a href="${articleUrl('report-problem')}">How to report a problem</a></div>
      <div class="rail-card"><h3>Product terms</h3><p>Not sure what a workspace, receivable, eligibility or fulfilment state means?</p><a href="${articleUrl('glossary')}">Open glossary</a></div>
      <div class="rail-card"><h3>Back to the app</h3><p>Return without changing your account or active profile.</p><a href="/">Open Business & Life</a></div>
    </aside>
  </div>`;
}

function errorPage(code){
  const slug=state.data.helpCodes[code];if(!slug)return notFound('Unknown help code','This help code is not mapped to a public article yet.');
  return articlePage(slug,code);
}

function notFound(title='Guide not found',copy='The public Help Center does not have this route yet.'){
  return`<section class="not-found"><div class="eyebrow">Help Center</div><h1>${esc(title)}</h1><p>${esc(copy)}</p><p><a class="chip" href="/help">Return to Help Center</a></p></section>`;
}

function renderRoute(){
  const r=route(),main=document.getElementById('helpMain');
  if(r.type==='home')main.innerHTML=home();
  else if(r.type==='profile')main.innerHTML=profilePage(r.key);
  else if(r.type==='article')main.innerHTML=articlePage(r.key);
  else if(r.type==='error')main.innerHTML=errorPage(r.key);
  else main.innerHTML=notFound();
  document.title=(r.type==='home'?'Business & Life Help Center':(main.querySelector('h1')?.textContent||'Help')+' — Business & Life Help');
  bindSearch();
  main.focus({preventScroll:true});
}

function bindSearch(){
  const input=document.getElementById('helpSearch'),box=document.getElementById('searchResults');if(!input||!box)return;
  const paint=()=>{
    const hits=searchArticles(input.value);
    if(!input.value.trim()){box.classList.remove('open');box.innerHTML='';return}
    box.innerHTML=hits.length?hits.map(a=>`<a class="search-hit" href="${articleUrl(a.slug)}"><strong>${esc(a.title)}</strong><small>${esc(a.section)} • ${esc(a.summary)}</small></a>`).join(''):'<div class="search-hit"><strong>No matching guide</strong><small>Try a shorter phrase or one of the words from the app message.</small></div>';
    box.classList.add('open');
  };
  input.addEventListener('input',paint);input.addEventListener('focus',paint);
  document.addEventListener('click',e=>{if(!e.target.closest('.search-wrap'))box.classList.remove('open')});
}

function bindGlobal(){
  const btn=document.getElementById('mobileNavButton'),nav=document.querySelector('.help-nav');
  btn?.addEventListener('click',()=>{const open=nav.classList.toggle('mobile-open');btn.setAttribute('aria-expanded',String(open))});
  window.addEventListener('popstate',renderRoute);
}

load().catch(err=>{document.getElementById('helpMain').innerHTML=notFound('Help Center unavailable',err.message)});
