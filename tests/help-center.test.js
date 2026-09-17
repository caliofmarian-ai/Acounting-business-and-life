import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const content=JSON.parse(readFileSync(new URL('../public/help/content.json',import.meta.url),'utf8'));
const server=readFileSync(new URL('../server-business-accounting.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/help/index.html',import.meta.url),'utf8');

test('public Help Center covers all five public profiles',()=>{
  const ids=new Set(content.profiles.map(p=>p.id));
  assert.deepEqual(ids,new Set(['customer','merchant','supplier','courier','service_provider']));
  for(const profile of content.profiles){
    assert.ok(content.articles.some(a=>a.profiles?.includes(profile.id)),`missing articles for ${profile.id}`);
  }
});

test('Help Center article identities and help-code mappings are valid',()=>{
  const slugs=content.articles.map(a=>a.slug);
  assert.equal(new Set(slugs).size,slugs.length,'article slugs must be unique');
  for(const a of content.articles){
    assert.ok(a.title&&a.summary&&a.shortAnswer,`incomplete article: ${a.slug}`);
  }
  for(const [code,slug] of Object.entries(content.helpCodes)){
    assert.match(code,/^ERR-[A-Z]+-\d{3}$/);
    assert.ok(content.articles.some(a=>a.slug===slug),`help code ${code} points to missing article ${slug}`);
  }
});

test('public Help Center routes are served before the upstream proxy',()=>{
  for(const route of [
    "app.get('/help',helpPage)",
    "app.get('/help/profile/:role',helpPage)",
    "app.get('/help/article/:slug',helpPage)",
    "app.get('/help/error/:code',helpPage)",
    "app.get('/help/content.json'",
    "app.get('/help/product-map.svg'"
  ]) assert.ok(server.includes(route),`missing public route: ${route}`);
  assert.ok(server.indexOf("app.get('/help',helpPage)")<server.indexOf('app.use(proxy)'),'Help Center must not depend on authentication/upstream proxy');
});

test('Help Center shell loads local assets only',()=>{
  assert.ok(html.includes('/help/help.css'));
  assert.ok(html.includes('/help/help.js'));
  assert.ok(!/https?:\/\//.test(html),'Help Center shell should not require external asset hosts');
});


test('contextual help client is injected into the public app shell',()=>{
  const linking=readFileSync(new URL('../public/help-linking.js',import.meta.url),'utf8');
  assert.ok(server.includes("app.get('/help-linking.js'"));
  assert.ok(server.includes('/help-linking.css'));
  assert.ok(server.includes('<script src="/help-linking.js"></script>'));
  for(const code of Object.keys(content.helpCodes)){
    assert.ok(linking.includes(code),`contextual help client does not reference ${code}`);
  }
  assert.ok(linking.includes("response.clone()"),'fetch inspection must not consume the response used by product UI');
  assert.ok(linking.includes("url.origin!==location.origin"),'contextual help should only inspect same-origin API failures');
});


test('profile journeys and related-guide graph are complete',()=>{
  const slugs=new Set(content.articles.map(a=>a.slug));
  for(const profile of content.profiles){
    assert.ok(Array.isArray(profile.startHere)&&profile.startHere.length>=3,`missing start-here steps for ${profile.id}`);
    assert.ok(Array.isArray(profile.journey)&&profile.journey.length>=5,`missing journey for ${profile.id}`);
    assert.match(profile.flowImage,/^\/help\/flows\/[a-z-]+\.svg$/);
    const file=profile.flowImage.replace('/help/','../public/help/');
    const svg=readFileSync(new URL(file,import.meta.url),'utf8');
    assert.ok(svg.includes('<svg'),`missing flow SVG for ${profile.id}`);
  }
  for(const article of content.articles){
    for(const related of article.related||[]) assert.ok(slugs.has(related),`${article.slug} links to missing article ${related}`);
  }
});

test('V2 catalog has granular instructions for current modules',()=>{
  assert.ok(content.articles.length>=60,'expected expanded public guide catalog');
  const required=[
    'delivery-fee-and-quote','remote-cash-trust','financial-corrections-audit',
    'supplier-payment-accounting','courier-location-privacy','credentials-verification',
    'service-job-statuses','incident-privacy','glossary'
  ];
  const slugs=new Set(content.articles.map(a=>a.slug));
  for(const slug of required) assert.ok(slugs.has(slug),`missing V2 guide ${slug}`);
});
