import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const root=new URL('../',import.meta.url);
const source=fs.readFileSync(new URL('public/help/help.js',root),'utf8');
const catalog=JSON.parse(fs.readFileSync(new URL('public/help/content.json',root),'utf8'));
const intents=JSON.parse(fs.readFileSync(new URL('tests/fixtures/help-search-intents-v3.json',root),'utf8'));
function client(data=structuredClone(catalog)){
 const requests=[];
 const context=vm.createContext({catalog:data,fetch:(...args)=>{requests.push(args);return new Promise(()=>{})}});
 vm.runInContext(source,context);vm.runInContext('state.data=catalog',context);
 return {context,requests,call:(expression)=>vm.runInContext(expression,context)};
}
test('reviewed cross-profile corpus returns relevant top-three guides, not merely shared words',()=>{
 assert.ok(intents.length>=50);
 const {call}=client();const failures=[];
 for(const intent of intents){
  const slugs=Array.from(call(`searchArticles(${JSON.stringify(intent.q)}).slice(0,3).map(a=>a.slug)`));
  if(!intent.slugs.some(slug=>slugs.includes(slug)))failures.push({query:intent.q,slugs,expected:intent.slugs});
  if(intent.guided)assert.equal(call(`guidedForQuery(${JSON.stringify(intent.q)})`),intent.guided);
 }
 assert.ok((intents.length-failures.length)/intents.length>=.9,JSON.stringify(failures,null,2));
 for(const q of ['reset password','I cannot sign in','profile approved not published','Paano mag reset ng password?'])assert.ok(call(`searchArticles(${JSON.stringify(q)}).length`)>0,q);
});
test('exact codes are deterministic and unknown codes do not fuzzy-match another diagnosis',()=>{
 const {call}=client();
 for(const [code,slug] of Object.entries(catalog.helpCodes))assert.deepEqual(Array.from(call(`searchArticles(${JSON.stringify(code.toLowerCase())}).map(a=>a.slug)`)),[slug]);
 for(const q of ['ERR-AUTH-999','ERR-DEL-999','   ','zorb qixflap nebula'])assert.equal(call(`searchArticles(${JSON.stringify(q)}).length`),0,q);
 assert.match(call("errorPage('ERR-AUTH-999')"),/Unknown help code/);
});
test('search includes long-form content and excludes unapproved/private entries',()=>{
 const data=structuredClone(catalog);
 data.articles.push({...data.articles[0],slug:'body-probe',title:'Guide without the phrase',summary:'A test',shortAnswer:'A test',sections:[{title:'Details',paragraphs:['uniquezephyr sentence in the detailed body']}],searchTerms:[],profiles:[]});
 data.articles.push({...data.articles[0],slug:'private-probe',title:'uniqueconfidential private material',publication:{classification:'SUPER_ADMIN',state:'EFFECTIVE'}});
 data.articles.push({...data.articles[0],slug:'draft-probe',title:'uniquedraft material',publication:{classification:'PUBLIC',state:'DRAFT'}});
 const {call}=client(data);
 assert.equal(call("searchArticles('uniquezephyr')[0].slug"),'body-probe');
 assert.equal(call("searchArticles('uniqueconfidential').length"),0);
 assert.equal(call("searchArticles('uniquedraft').length"),0);
 assert.equal(call("articleBySlug('private-probe')"),undefined);
 assert.doesNotMatch(call('home()'),/uniqueconfidential|uniquedraft/);
});
test('translation drift falls back to labelled English and cannot inherit English paragraphs under Filipino language',()=>{
 const {call}=client();
 assert.equal(call("localizedArticle(articleBySlug('sign-in-recovery'),'fil-PH').readingLocale"),'fil-PH');
 call("state.locale='fil-PH'");
 assert.match(call("articlePage('sign-in-recovery')"),/Mag-sign in o mag-reset/);
 assert.equal(call("localizedArticle(articleBySlug('sign-in-recovery'),'fil-PH').sections.length"),0);
 call("articleBySlug('sign-in-recovery').translations['fil-PH'].sourceVersion='0.0.0'");
 assert.equal(call("localizedArticle(articleBySlug('sign-in-recovery')).readingLocale"),'en-PH');
 assert.match(call("articlePage('sign-in-recovery')"),/Wala pang nasuring salin/);
});
test('public content has traceable source review and valid links, translations and guided branches',()=>{
 const slugs=new Set(catalog.articles.map(a=>a.slug));
 for(const article of catalog.articles){
  assert.equal(article.publication.classification,'PUBLIC');assert.equal(article.publication.state,'EFFECTIVE');
  assert.match(article.version,/^\d+\.\d+\.\d+$/);assert.match(article.verification.sourceCommit,/^[a-f0-9]{40}$/);
  assert.match(article.verification.reviewedAt,/^\d{4}-\d{2}-\d{2}$/);assert(article.verification.owner&&article.verification.reviewer);
  for(const path of article.verification.sourcePaths)assert(fs.existsSync(new URL(path,root)),path);
  for(const slug of article.related||[])assert(slugs.has(slug),`${article.slug} -> ${slug}`);
  for(const translation of Object.values(article.translations||{})){assert.equal(translation.sourceVersion,article.version);assert(translation.title&&translation.summary&&translation.shortAnswer&&translation.steps.length)}
 }
 for(const guided of catalog.troubleshooters)for(const option of guided.options)assert(slugs.has(option.article));
 assert.equal(catalog.publicAccountAccessContact.available,true);
 assert.equal(catalog.publicAccountAccessContact.path,'/help/account-access');
 assert.equal(catalog.publicAccountAccessContact.scope,'account-access-only');
 assert.match(catalog.publicAccountAccessContact.reason,/not an inbound Support email mailbox/);
});
test('topic/language change only public reading preferences; rendered text and URLs stay safe',()=>{
 const {call,requests,context}=client();
 call("state.locale='fil-PH';state.topic='merchant';state.query='<img src=x onerror=alert(1)>'");
 assert.equal(call("articleUrl('sign-in-recovery')"),'/help/article/sign-in-recovery?lang=fil-PH&topic=merchant');
 assert.match(call('searchMarkup()'),/value="&lt;img/);
 assert.equal(call("safeHelpImage('https://example.invalid/pixel')"),'');
 context.location={pathname:'/help/article/%E0%A4%A'};
 assert.equal(call('route().type'),'not-found');
 assert.equal(requests.length,1);assert.equal(requests[0][0],'/help/content.json');assert.equal(requests[0][1].credentials,'omit');
 assert.doesNotMatch(source,/\/api\/|BusinessLifeProfileState|ABLSession|\.cookie\b/);
});

test('English and Filipino guest account-access paths are visible without private ticket authority or fictitious inbox',()=>{
 const {call}=client();
 const html=fs.readFileSync(new URL('public/help/index.html',root),'utf8');
 const router=fs.readFileSync(new URL('server-account-access.js',root),'utf8');
 assert.match(html,/data-help-href="\/help\/account-access"/);
 assert.match(router,/app\.get\('\/help\/account-access'/);
 assert.match(call('home()'),/href="\/help\/account-access"/);
 for(const slug of ['support-and-tickets','sign-in-recovery']){
  assert.match(call(`articlePage('${slug}')`),/href="\/help\/account-access"/);
 }
 assert.match(call("articlePage('support-and-tickets')"),/not a monitored inbound email mailbox/);
 call("state.locale='fil-PH'");
 assert.match(call('home()'),/href="\/help\/account-access\?lang=fil-PH"/);
 assert.match(call("articlePage('sign-in-recovery')"),/href="\/help\/account-access\?lang=fil-PH"/);
 assert.match(call("articlePage('support-and-tickets')"),/Humingi ng tulong sa account nang hindi nag-si-sign in/);
 assert.doesNotMatch(call("articlePage('support-and-tickets')"),/wala pang napatunayang pampublikong account-access inbox/);
 assert.doesNotMatch(source,/\/api\/support\/tickets/);
});
