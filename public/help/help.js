const state={data:null,locale:'en-PH',topic:'all',query:''};
const COPY={
  'en-PH':{home:'Help Center',hero:'How can we help?',intro:'Find a clear answer, follow the steps, or learn what to do next.',search:'Search Help Center',placeholder:'Ask a question or enter a help code',find:'Find an answer',language:'Help language',topic:'Help for',all:'Everyone',guest:'Guest visitors',account:'My account',topicHint:'This changes help suggestions only.',profiles:'Profile guides',popular:'Common tasks',troubleshooting:'Solve a problem',openApp:'Open app',start:'Start here',first:'First steps',journey:'How it works',guides:'guides',short:'Short answer',before:'Before you start',steps:'What to do',next:'What happens next',notes:'Important notes',problems:'Common problems',related:'Related guides',allProfiles:'All profiles',reviewed:'Content reviewed',availability:'Availability depends on your profile, area and the options enabled in the app.',english:'This guide is available in English. A reviewed Filipino translation is not available for this version yet.',stuck:'Still need help?',support:'Help & Support and account access',supportCopy:'Find the right path for a technical question, private incident or account-access problem.',terms:'Understand a term',glossary:'Open glossary',back:'Back to Help Center',notFound:'Guide not found',missing:'Choose a guide below or search for the task you need.',unknown:'Unknown help code',unknownCopy:'This code has no public guide yet. Search using the message or choose Help & Support.',empty:'No matching guide yet',emptyCopy:'Try the task name, choose a profile, or use Help & Support.',count:'guides found',result:'Search results',close:'Close results',searchHint:'Search by question, task or error code. Use Tab to explore results; Escape closes them.',guideNote:'Public product guidance. Private account and business details stay inside the app.',guestLink:'What can I do as a guest?',loginLink:'I cannot sign in',approvalLink:'My profile is not ready',moneyLink:'Where is my money?',supportLink:'Contact and support options',choose:'Choose the situation that fits',profileIntro:'Explore tasks, requirements and the next step for this profile.',profileEnglish:'Profile names and screen labels follow the application. The detailed profile overview below is in English.',code:'Help reference',codeCopy:'Include this reference if you contact Support.',retry:'Try loading again',unavailable:'Help Center could not load',loadCopy:'Check your connection, then try again. You can still return to the app.',map:'How Business & Life fits together',mapAlt:'One account with separate Customer, Merchant, Supplier, Delivery and Local Services profiles.',section:'Browse all guides',clear:'Clear search',source:'Read the guide',menu:'Menu'},
  'fil-PH':{home:'Help Center',hero:'Paano kami makakatulong?',intro:'Hanapin ang sagot, sundin ang mga hakbang, at alamin ang susunod na gagawin.',search:'Maghanap sa Help Center',placeholder:'Magtanong o ilagay ang help code',find:'Hanapin ang sagot',language:'Wika ng tulong',topic:'Tulong para sa',all:'Lahat',guest:'Mga bisita / Guest',account:'Aking account',topicHint:'Mga mungkahing gabay lang ang mababago.',profiles:'Mga gabay sa profile',popular:'Karaniwang gawain',troubleshooting:'Ayusin ang problema',openApp:'Buksan ang app',start:'Magsimula rito',first:'Mga unang hakbang',journey:'Paano ito gumagana',guides:'gabay',short:'Maikling sagot',before:'Bago magsimula',steps:'Mga dapat gawin',next:'Ano ang susunod',notes:'Mahahalagang paalala',problems:'Karaniwang problema',related:'Kaugnay na gabay',allProfiles:'Lahat ng profile',reviewed:'Sinuri ang nilalaman',availability:'Depende sa iyong profile, lugar, at mga opsyong bukas sa app ang magagamit mo.',english:'Nasa English ang gabay na ito. Wala pang nasuring salin sa Filipino para sa bersyong ito.',stuck:'Kailangan pa ng tulong?',support:'Help & Support at pag-access sa account',supportCopy:'Alamin kung saan magtatanong, mag-uulat ng pribadong insidente, o hihingi ng tulong sa account.',terms:'Unawain ang isang termino',glossary:'Buksan ang talahulugan',back:'Bumalik sa Help Center',notFound:'Hindi nahanap ang gabay',missing:'Pumili ng gabay o hanapin ang gawaing kailangan mo.',unknown:'Hindi kilalang help code',unknownCopy:'Wala pang pampublikong gabay para sa code na ito. Hanapin ang mensahe o piliin ang Help & Support.',empty:'Wala pang katugmang gabay',emptyCopy:'Subukan ang pangalan ng gawain, pumili ng profile, o buksan ang Help & Support.',count:'gabay ang nahanap',result:'Mga resulta',close:'Isara ang mga resulta',searchHint:'Magtanong o ilagay ang gawain o error code. Gamitin ang Tab para sa mga resulta; Escape para isara.',guideNote:'Pampublikong gabay sa produkto. Nananatili sa app ang pribadong detalye ng account at negosyo.',guestLink:'Ano ang puwedeng gawin bilang guest?',loginLink:'Hindi ako makapag-sign in',approvalLink:'Hindi pa handa ang aking profile',moneyLink:'Nasaan ang aking pera?',supportLink:'Mga paraan ng paghingi ng tulong',choose:'Piliin ang sitwasyong naaangkop',profileIntro:'Alamin ang mga gawain, kailangan, at susunod na hakbang para sa profile.',profileEnglish:'Sinusunod ng mga pangalan ng profile at screen ang app. Nasa English ang detalyadong pangkalahatang gabay sa ibaba.',code:'Sanggunian ng tulong',codeCopy:'Isama ang sangguniang ito kapag kumontak sa Support.',retry:'Subukang muli',unavailable:'Hindi ma-load ang Help Center',loadCopy:'Suriin ang koneksiyon, at subukang muli. Maaari ka ring bumalik sa app.',map:'Paano magkakaugnay ang Business & Life',mapAlt:'Isang account na may magkakahiwalay na Customer, Merchant, Supplier, Delivery at Local Services profile.',section:'Lahat ng gabay',clear:'Burahin ang hinahanap',source:'Basahin ang gabay',menu:'Menu'}
};
const HELP_TOPICS=new Set(['all','guest','account','customer','merchant','supplier','courier','service_provider']);
const STOP_WORDS=new Set('a an the i me my we our you your is are was were be been to for of and or on at in it this that these those how what why where when do does did can cannot cant could please help with about there not want need would have has had ako ko aking iyong kong mong namin natin ninyo mag ang mga ng sa ay ba paano bakit saan nasaan po gusto kailangan hindi na may'.split(' '));
const SYNONYMS={login:'signin',logon:'signin',signing:'signin',passwords:'password',resetting:'reset',payments:'payment',paid:'payment',payouts:'payout',withdrawal:'payout',withdrawals:'payout',earnings:'money',pera:'money',bayad:'payment',pagbabayad:'payment',imbentaryo:'inventory',imbak:'stock',stoks:'stock',packaging:'packaging',balot:'packaging',abiso:'notification',tunog:'sound',sounds:'sound',notifications:'notification',emails:'email',documents:'document',dokumento:'document',rejected:'rejection',approval:'approval',approved:'approval',aprubado:'approval',pagapruba:'approval',recipes:'recipe',reseta:'recipe',orders:'order',deliveries:'delivery',paghatid:'delivery',supplier:'supplier',paninda:'product',products:'product',accounting:'finance',accounts:'account',guests:'guest',bisita:'guest',tanggalin:'delete',burahin:'delete',forgotten:'forgot'};
function text(key){return (COPY[state.locale]||COPY['en-PH'])[key]||COPY['en-PH'][key]||key}
function esc(value){return String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function normalize(value){return String(value??'').slice(0,30000).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b(sign[ -]?in|log[ -]?in|makapag[ -]?sign[ -]?in)\b/g,' signin ').replace(/[’']/g,'').replace(/[^a-z0-9]+/g,' ').trim()}
function tokens(value){return [...new Set(normalize(value).split(' ').filter(w=>w.length>1&&!STOP_WORDS.has(w)).map(w=>SYNONYMS[w]||w))]}
function profileLetter(id){return ({customer:'C',merchant:'M',supplier:'S',courier:'D',service_provider:'L'})[id]||'?'}
function profileLabel(id){return state.data?.profiles.find(p=>p.id===id)?.label||id}
function helpUrl(path='/help'){
  const [base,hash]=path.split('#');
  const params=[];
  if(state.locale==='fil-PH')params.push('lang=fil-PH');
  if(state.topic!=='all')params.push('topic='+encodeURIComponent(state.topic));
  return base+(params.length?'?'+params.join('&'):'')+(hash?'#'+hash:'');
}
function articleUrl(slug){return helpUrl('/help/article/'+encodeURIComponent(slug))}
function profileUrl(id){return helpUrl('/help/profile/'+encodeURIComponent(id))}
function publicArticles(){return (state.data?.articles||[]).filter(a=>a.publication?.classification==='PUBLIC'&&a.publication?.state==='EFFECTIVE')}
function articleBySlug(slug){return publicArticles().find(a=>a.slug===slug)}
function localizedArticle(article,locale=state.locale){
  const translation=article.translations?.[locale];
  return translation?.sourceVersion===article.version&&/^\d{4}-\d{2}-\d{2}$/.test(translation.reviewedAt||'')
    ?{...article,steps:[],beforeYouStart:[],notes:[],commonProblems:[],sections:[],whatHappensNext:'',visual:null,...translation,slug:article.slug,readingLocale:locale,translated:true}
    :{...article,readingLocale:'en-PH',translated:false};
}
function articlesForProfile(id){return publicArticles().filter(a=>a.profiles?.includes(id))}
function editDistance(a,b,limit){
  if(Math.abs(a.length-b.length)>limit)return limit+1;
  let previous=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    const next=[i];let min=i;
    for(let j=1;j<=b.length;j++){next[j]=Math.min(next[j-1]+1,previous[j]+1,previous[j-1]+(a[i-1]===b[j-1]?0:1));min=Math.min(min,next[j])}
    if(min>limit)return limit+1;
    previous=next;
  }
  return previous[b.length];
}
let indexedCatalog=null,searchIndex=[],searchVocabulary=new Set();
function buildSearchIndex(){
  if(indexedCatalog===state.data)return searchIndex;
  indexedCatalog=state.data;
  searchVocabulary=new Set();
  searchIndex=publicArticles().map(a=>{
    const variants=[a,...Object.values(a.translations||{}).filter(x=>x.sourceVersion===a.version&&x.reviewedAt)];
    const fields=[];
    for(const v of variants){
      fields.push([v.title,9],[v.summary,5],[v.shortAnswer,4],[(v.searchTerms||[]).join(' '),7],[(v.commonProblems||[]).join(' '),3],[[...(v.steps||[]),...(v.beforeYouStart||[]),...(v.notes||[]),v.whatHappensNext||''].join(' '),2],[(v.sections||[]).flatMap(s=>[s.title,...(s.paragraphs||[]),...(s.bullets||[])]).join(' '),1]);
    }
    fields.push([a.section+' '+(a.profiles||[]).join(' '),1]);
    const weights=new Map();
    for(const [value,weight] of fields)for(const word of tokens(value)){weights.set(word,Math.max(weight,weights.get(word)||0));searchVocabulary.add(word)}
    return {a,aliases:(a.searchTerms||[]).map(normalize),weights};
  });
  return searchIndex;
}
function searchArticles(query){
  const raw=String(query||'').trim().slice(0,200),phrase=normalize(raw);
  if(!phrase)return[];
  if(/^err[-\s]/i.test(raw)){
    const code=raw.toUpperCase().replace(/\s+/g,'-'),slug=state.data.helpCodes[code];
    return slug&&buildSearchIndex().some(x=>x.a.slug===slug)?[articleBySlug(slug)]:[];
  }
  const wanted=tokens(raw).slice(0,12);if(!wanted.length)return[];
  const index=buildSearchIndex();
  const matches=wanted.map(word=>{
    if(searchVocabulary.has(word))return[[word,1]];
    if(word.length<4)return[];
    const limit=word.length>=8?2:1;
    return [...searchVocabulary].filter(candidate=>candidate.length>=4&&editDistance(word,candidate,limit)<=limit).map(candidate=>[candidate,.45]);
  });
  return index.map(({a,weights,aliases})=>{
    let matched=0,score=0;
    for(const alternatives of matches){
      let best=0;
      for(const [word,factor] of alternatives)best=Math.max(best,(weights.get(word)||0)*factor);
      if(best){matched++;score+=best}
    }
    const coverage=matched/wanted.length;
    if(coverage<(wanted.length>=3?.6:1))return{a,score:0};
    score*=coverage;
    if(normalize(a.title).includes(phrase))score+=15;
    if(aliases.some(alias=>alias===phrase))score+=28;
    if(a.profiles?.includes(state.topic)||a.audiences?.includes(state.topic))score+=2;
    return{a,score};
  }).filter(x=>x.score>=1).sort((a,b)=>b.score-a.score||a.a.slug.localeCompare(b.a.slug)).slice(0,8).map(x=>x.a);
}
function guidedForQuery(query){
  const q=normalize(query);
  if(/where.*money|nasaan.*pera|money.*missing|missing.*money/.test(q))return'money';
  if(/cannot.*signin|cant.*signin|hindi.*signin/.test(q))return'sign-in';
  if(/approv.*(starting|ready|publish)|aprubado.*(handa|bukas)|under review|pending.*review/.test(q))return'profile';
  return'';
}
function guidedMarkup(id){
  const source=state.data.troubleshooters?.find(t=>t.id===id);if(!source)return'';
  const translated=source.translations?.[state.locale],g=translated?{...source,...translated}:source;
  return`<section class="guided-help" aria-label="${esc(g.title)}"><h2>${esc(g.title)}</h2><p>${esc(g.question)}</p><div class="guided-options">${g.options.map(o=>`<a href="${articleUrl(o.article)}"><strong>${esc(o.label)}</strong><span>${esc(o.description||text('source'))} →</span></a>`).join('')}</div></section>`;
}
function searchMarkup(){
  const options=[['all',text('all')],['guest',text('guest')],['account',text('account')],...state.data.profiles.map(p=>[p.id,p.label])];
  return`<section class="help-tools" aria-label="${esc(text('search'))}"><form id="helpSearchForm" role="search"><label class="search-label" for="helpSearch">${esc(text('search'))}</label><div class="search-controls"><input id="helpSearch" class="search-box" type="search" maxlength="200" autocomplete="off" value="${esc(state.query)}" placeholder="${esc(text('placeholder'))}" aria-describedby="helpSearchHint helpSearchStatus" aria-controls="searchResults"><button type="submit">${esc(text('find'))}</button></div><p id="helpSearchHint" class="search-hint">${esc(text('searchHint'))}</p></form><div class="help-preferences"><label>${esc(text('topic'))}<select id="helpTopic">${options.map(([id,label])=>`<option value="${id}"${state.topic===id?' selected':''}>${esc(label)}</option>`).join('')}</select></label><label>${esc(text('language'))}<select id="helpLocale"><option value="en-PH"${state.locale==='en-PH'?' selected':''}>English</option><option value="fil-PH"${state.locale==='fil-PH'?' selected':''}>Filipino / Tagalog</option></select></label></div><p class="search-hint">${esc(text('topicHint'))}</p><p id="helpSearchStatus" role="status" aria-live="polite" aria-atomic="true"></p><section id="searchResults" class="help-search-results" aria-label="${esc(text('result'))}" hidden></section></section>`;
}
async function load(){
  const response=await fetch('/help/content.json',{headers:{Accept:'application/json'},credentials:'omit',cache:'no-cache'});
  if(!response.ok)throw new Error('Help content unavailable');
  state.data=await response.json();
  const params=new URLSearchParams(location.search);
  let saved='';try{saved=localStorage.getItem('abl_help_locale')||''}catch{}
  state.locale=['en-PH','fil-PH'].includes(params.get('lang'))?params.get('lang'):['en-PH','fil-PH'].includes(saved)?saved:'en-PH';
  state.topic=HELP_TOPICS.has(params.get('topic'))?params.get('topic'):'all';
  renderRoute();bindGlobal();
}
function route(){
  try{
    const parts=location.pathname.split('/').filter(Boolean);
    if(parts[0]!=='help')return{type:'not-found'};
    if(parts.length===1)return{type:'home'};
    if(parts.length===3&&['profile','article','error'].includes(parts[1]))return{type:parts[1],key:decodeURIComponent(parts[2])};
  }catch{}
  return{type:'not-found'};
}

function home(){
  const profiles=state.data.profiles.map(p=>`<a class="profile-card" data-accent="${esc(p.accent)}" href="${profileUrl(p.id)}"><span class="profile-icon" aria-hidden="true">${profileLetter(p.id)}</span><h3>${esc(p.label)}</h3><p>${esc(p.tagline)}</p><span class="view-link">${esc(text('guides'))} →</span></a>`).join('');
  const popular=['guest-browsing','create-account','profile-application-review','inventory-consumables','supplier-eta-and-exceptions','recorded-money-and-payouts'].map(articleBySlug).filter(Boolean).map(guideCard).join('');
  const trouble=Object.entries(state.data.helpCodes).map(([code,slug])=>{const a=articleBySlug(slug);if(!a)return'';const view=localizedArticle(a);return`<a class="trouble-card" href="${helpUrl('/help/error/'+encodeURIComponent(code))}"><span class="help-code">${esc(code)}</span><h3>${esc(view.title)}</h3><p>${esc(view.summary)}</p></a>`}).join('');
  return`<section class="hero"><div class="hero-inner"><div class="eyebrow">Business & Life · Philippines</div><h1>${esc(text('hero'))}</h1><p>${esc(text('intro'))}</p>${searchMarkup()}<div class="quick-links"><a class="chip" href="${articleUrl('guest-browsing')}">${esc(text('guestLink'))}</a><a class="chip" href="${articleUrl('sign-in-recovery')}">${esc(text('loginLink'))}</a><a class="chip" href="#profile-help">${esc(text('approvalLink'))}</a><a class="chip" href="#money-help">${esc(text('moneyLink'))}</a></div></div></section>
  <section class="section" id="troubleshooting"><div class="section-heading"><h2>${esc(text('troubleshooting'))}</h2></div><div id="profile-help">${guidedMarkup('profile')}</div><div id="money-help">${guidedMarkup('money')}</div></section>
  <section class="section" id="popular"><div class="section-heading"><h2>${esc(text('popular'))}</h2></div><div class="guide-grid">${popular}</div></section>
  <section class="section" id="profiles"><div class="section-heading"><h2>${esc(text('profiles'))}</h2></div>${state.locale==='fil-PH'?`<p class="language-notice">${esc(text('profileEnglish'))}</p>`:''}<div class="profile-grid" lang="en-PH">${profiles}</div></section>
  <section class="section"><details><summary>${esc(text('map'))}</summary><div class="architecture-card"><img src="/help/product-map.svg" alt="${esc(text('mapAlt'))}"></div></details></section>
  <section class="section"><details><summary>${esc(text('section'))} · ${publicArticles().length}</summary><div class="guide-grid">${publicArticles().map(guideCard).join('')}</div></details><details class="code-directory"><summary>${esc(text('code'))} · ${Object.keys(state.data.helpCodes).length}</summary><div class="trouble-grid">${trouble}</div></details></section>`;
}
function guideCard(article){const a=localizedArticle(article);return`<a class="guide-card" lang="${a.readingLocale}" href="${articleUrl(a.slug)}"><span class="kicker">${esc(a.section)}</span><h3>${esc(a.title)}</h3><p>${esc(a.summary)}</p></a>`}
function profilePage(id){
  const p=state.data.profiles.find(x=>x.id===id);if(!p)return notFound();
  const articles=articlesForProfile(id);
  return`<section class="profile-hero"><div class="profile-hero-inner"><div class="breadcrumbs"><a href="${helpUrl()}">${esc(text('home'))}</a> / ${esc(p.label)}</div><h1>${esc(p.label)}</h1><p>${esc(text('profileIntro'))}</p>${state.locale==='fil-PH'?`<p class="language-notice">${esc(text('profileEnglish'))}</p>`:''}<div lang="en-PH"><p>${esc(p.tagline)}</p><div class="module-pills">${p.modules.map(m=>`<span>${esc(m)}</span>`).join('')}</div></div></div></section><section class="section profile-start"><div class="profile-two-col"><section class="start-card"><h2>${esc(text('first'))}</h2><ol lang="en-PH">${(p.startHere||[]).map((x,i)=>`<li><span aria-hidden="true">${i+1}</span><div>${esc(x)}</div></li>`).join('')}</ol></section><section class="start-card"><h2>${esc(text('journey'))}</h2><div class="journey-mini" lang="en-PH">${(p.journey||[]).map((x,i)=>`<span><b aria-hidden="true">${i+1}</b>${esc(x)}</span>`).join('')}</div></section></div><details class="flow-card"><summary>${esc(text('journey'))} · ${esc(p.label)}</summary><img src="${safeHelpImage(p.flowImage)}" alt="${esc(p.label)} workflow"></details></section><section class="section"><div class="section-heading"><h2>${esc(p.label)} · ${articles.length} ${esc(text('guides'))}</h2></div><div class="guide-grid">${articles.map(guideCard).join('')}</div></section>`;
}
function safeHelpImage(src){return /^\/help\/(?:product-map\.svg|flows\/[a-z-]+\.svg)$/.test(src||'')?src:''}
function listBlock(title,items,className='note-list'){
  return items?.length?`<h2>${esc(title)}</h2><ul class="${className}">${items.map(item=>`<li>${esc(item)}</li>`).join('')}</ul>`:'';
}
function articlePage(slug,requestedCode=''){
  const original=articleBySlug(slug);if(!original||original.publication?.classification!=='PUBLIC'||original.publication?.state!=='EFFECTIVE')return notFound();
  const a=localizedArticle(original),articleText=key=>COPY[a.readingLocale][key];
  const side=publicArticles().filter(x=>x.section===original.section).slice(0,14).map(x=>`<a${x.slug===slug?' aria-current="page"':''} href="${articleUrl(x.slug)}">${esc(localizedArticle(x).title)}</a>`).join('');
  const profiles=(a.profiles||[]).map(id=>`<a href="${profileUrl(id)}">${esc(profileLabel(id))}</a>`).join('')||`<span>${esc(articleText('allProfiles'))}</span>`;
  const sections=(a.sections||[]).map((s,i)=>`<section class="content-section" id="section-${i+1}"><h2>${esc(s.title)}</h2>${(s.paragraphs||[]).map(p=>`<p>${esc(p)}</p>`).join('')}${s.bullets?.length?`<ul>${s.bullets.map(b=>`<li>${esc(b)}</li>`).join('')}</ul>`:''}</section>`).join('');
  const related=(a.related||[]).map(articleBySlug).filter(Boolean);
  const codes=[...new Set([...(a.helpCodes||[]),requestedCode].filter(Boolean))];
  const reviewed=original.verification?.reviewedAt;
  const stamp=/^\d{4}-\d{2}-\d{2}$/.test(reviewed||'')?`<p class="review-stamp">${esc(articleText('reviewed'))}: <time datetime="${reviewed}">${esc(new Intl.DateTimeFormat(state.locale,{dateStyle:'long',timeZone:'UTC'}).format(new Date(reviewed+'T12:00:00Z')))}</time></p>`:'';
  return`<div class="article-layout"><aside class="article-side" aria-label="${esc(text('related'))}">${side}</aside><div class="article-reading">${state.locale==='fil-PH'&&!a.translated?`<p class="language-notice" role="status">${esc(text('english'))}</p>`:''}<article class="article-main" lang="${a.readingLocale}"><div class="breadcrumbs"><a href="${helpUrl()}">${esc(text('home'))}</a> / ${esc(a.section)}</div><div class="article-kicker">${profiles}</div><h1>${esc(a.title)}</h1>${stamp}<p class="article-lede">${esc(a.summary)}</p><div class="short-answer"><strong>${esc(articleText('short'))}</strong><p>${esc(a.shortAnswer)}</p></div>${listBlock(articleText('before'),a.beforeYouStart,'check-list')}${a.steps?.length?`<h2>${esc(articleText('steps'))}</h2><ol class="steps">${a.steps.map(s=>`<li><div>${esc(s)}</div></li>`).join('')}</ol>`:''}${a.whatHappensNext?`<section class="next-panel"><h2>${esc(articleText('next'))}</h2><p>${esc(a.whatHappensNext)}</p></section>`:''}${a.visual&&safeHelpImage(a.visual.src)?`<figure class="article-visual"><img src="${safeHelpImage(a.visual.src)}" alt="${esc(a.visual.alt||'')}"><figcaption>${esc(a.visual.caption||'')}</figcaption></figure>`:''}${sections}${listBlock(articleText('notes'),a.notes)}${listBlock(articleText('problems'),a.commonProblems,'problem-list')}${codes.length?`<section class="error-panel"><strong>${esc(articleText('code'))}</strong> <span class="help-code">${esc(codes.join(' · '))}</span><p>${esc(articleText('codeCopy'))}</p></section>`:''}</article>${related.length?`<h2>${esc(text('related'))}</h2><div class="related-grid">${related.map(guideCard).join('')}</div>`:''}<p class="availability-note">${esc(text('availability'))}</p></div><aside class="article-rail"><section class="rail-card"><h2>${esc(text('stuck'))}</h2><p>${esc(text('supportCopy'))}</p><a href="${articleUrl('support-and-tickets')}">${esc(text('support'))}</a></section><section class="rail-card"><h2>${esc(text('terms'))}</h2><a href="${articleUrl('glossary')}">${esc(text('glossary'))}</a></section><section class="rail-card"><h2>${esc(text('openApp'))}</h2><a href="/">Business & Life →</a></section></aside></div>`;
}
function errorPage(code){
  const normalized=String(code||'').toUpperCase(),slug=state.data.helpCodes[normalized];
  return slug?articlePage(slug,normalized):notFound(text('unknown'),text('unknownCopy'));
}
function notFound(title=text('notFound'),copy=text('missing')){return`<section class="not-found"><h1>${esc(title)}</h1><p>${esc(copy)}</p><a class="chip" href="${helpUrl()}">${esc(text('back'))}</a> <a class="chip" href="${articleUrl('support-and-tickets')}">${esc(text('supportLink'))}</a></section>`}
function renderRoute(focus=true){
  const r=route(),main=document.getElementById('helpMain');
  let view=r.type==='home'?home():r.type==='profile'?profilePage(r.key):r.type==='article'?articlePage(r.key):r.type==='error'?errorPage(r.key):notFound();
  main.innerHTML=(r.type==='home'?'':`<div class="section help-search-top">${searchMarkup()}</div>`)+view;
  document.documentElement.lang=state.locale;
  document.title=(main.querySelector('h1')?.textContent||text('home'))+' — Business & Life Help';
  for(const node of document.querySelectorAll('[data-help-copy]'))node.textContent=text(node.dataset.helpCopy);
  for(const node of document.querySelectorAll('[data-help-href]'))node.href=helpUrl(node.dataset.helpHref);
  bindSearch();
  if(focus)main.focus({preventScroll:true});
}
function updatePreferences(){
  state.query=document.getElementById('helpSearch').value.slice(0,200);
  state.locale=document.getElementById('helpLocale').value==='fil-PH'?'fil-PH':'en-PH';
  const topic=document.getElementById('helpTopic').value;state.topic=HELP_TOPICS.has(topic)?topic:'all';
  try{localStorage.setItem('abl_help_locale',state.locale)}catch{}
  history.replaceState(null,'',helpUrl(location.pathname));
  const focused=document.activeElement?.id;
  renderRoute(false);
  document.getElementById(focused)?.focus();
}
function paintSearch(){
  const input=document.getElementById('helpSearch'),box=document.getElementById('searchResults'),status=document.getElementById('helpSearchStatus');
  state.query=input.value.slice(0,200);
  if(!state.query.trim()){box.hidden=true;box.innerHTML='';status.textContent='';return}
  const hits=searchArticles(state.query),guided=guidedForQuery(state.query);
  box.innerHTML=`<div class="search-results-head"><strong>${esc(text('result'))}</strong><button type="button" id="closeHelpResults">${esc(text('close'))}</button></div>${guided?guidedMarkup(guided):''}${hits.length?`<ul class="help-hits">${hits.map(a=>{const v=localizedArticle(a);return`<li><a class="search-hit" lang="${v.readingLocale}" href="${articleUrl(a.slug)}"><strong>${esc(v.title)}</strong><span>${esc(v.summary)}</span></a></li>`}).join('')}</ul>`:`<p><strong>${esc(text('empty'))}</strong></p><p>${esc(text('emptyCopy'))}</p><a class="chip" href="${articleUrl('support-and-tickets')}">${esc(text('supportLink'))}</a>`}`;
  box.hidden=false;
  status.textContent=hits.length?hits.length+' '+text('count'):text('empty');
  document.getElementById('closeHelpResults').onclick=()=>{box.hidden=true;input.focus()};
}
function bindSearch(){
  const input=document.getElementById('helpSearch'),box=document.getElementById('searchResults');if(!input||!box)return;
  input.addEventListener('input',paintSearch);
  document.getElementById('helpSearchForm').onsubmit=e=>{e.preventDefault();paintSearch()};
  input.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){paintSearch();const first=box.querySelector('a');if(first){e.preventDefault();first.focus()}}if(e.key==='Escape'){box.hidden=true;document.getElementById('helpSearchStatus').textContent=''}});
  box.addEventListener('keydown',e=>{if(e.key==='Escape'){box.hidden=true;input.focus()}});
  document.getElementById('helpLocale').onchange=updatePreferences;
  document.getElementById('helpTopic').onchange=updatePreferences;
  if(state.query)paintSearch();
}
function bindGlobal(){
  const button=document.getElementById('mobileNavButton'),nav=document.querySelector('.help-nav');
  button?.addEventListener('click',()=>{const open=nav.classList.toggle('mobile-open');button.setAttribute('aria-expanded',String(open))});
  window.addEventListener('popstate',()=>{const params=new URLSearchParams(location.search);state.locale=params.get('lang')==='fil-PH'?'fil-PH':'en-PH';state.topic=HELP_TOPICS.has(params.get('topic'))?params.get('topic'):'all';renderRoute()});
}
load().catch(()=>{
  const main=document.getElementById('helpMain');
  main.innerHTML=`<section class="not-found"><h1>${esc(text('unavailable'))}</h1><p>${esc(text('loadCopy'))}</p><button type="button" id="helpRetry">${esc(text('retry'))}</button> <a class="chip" href="/">${esc(text('openApp'))}</a></section>`;
  document.getElementById('helpRetry').onclick=()=>location.reload();
});
