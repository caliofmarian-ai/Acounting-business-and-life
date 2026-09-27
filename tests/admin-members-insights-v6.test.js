import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const server=read('server-admin-operations.js');
const ui=read('public/admin-console.js');
const css=read('public/admin-console.css');

function between(source,start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a);
  assert.ok(a>=0,'Missing start marker: '+start);
  assert.ok(b>a,'Missing end marker: '+end);
  return source.slice(a,b);
}

test('Members V6 summary is scoped by the same members.view directory scope',()=>{
  const block=between(server,'async function adminMembersSummary','async function optionalMemberRows');
  assert.match(block,/requirePermissionFromContext\(ctx,'members\.view'\)/);
  assert.match(block,/const scope=await memberDirectoryScope\(ctx\)/);
  assert.match(block,/scope\.platformWide/);
  assert.match(block,/scope\.countryWide/);
  assert.match(block,/scope\.accountIds/);
  assert.match(server,/app\.get\('\/api\/admin\/members\/summary'/);
  const routeIndex=server.indexOf("app.get('/api/admin/members/summary'");
  const detailIndex=server.indexOf("app.get('/api/admin/members/:accountId'");
  assert.ok(routeIndex>=0&&detailIndex>routeIndex,'Summary route must precede parameterized member detail route');
});

test('Members V6 aggregate payload contains operational counts only and no PII',()=>{
  const block=between(server,'async function adminMembersSummary','async function optionalMemberRows');
  for(const key of ['new_7d','new_30d','verified_email','unverified_email','suspended','company_test','personal','no_active_profile','active_profiles']){
    assert.match(block,new RegExp(key));
  }
  assert.match(block,/pf\.enabled=TRUE AND pf\.status='active'/);
  assert.doesNotMatch(block,/display_name/);
  assert.doesNotMatch(block,/a\.email[,)]/);
  assert.doesNotMatch(block,/a\.phone/);
  assert.doesNotMatch(block,/a\.address/);
  assert.doesNotMatch(block,/password_hash|password_salt|session_id|ip_hash/);
});

test('Members V6 UI fetches summary only for Directory and caches it across search/filter/page renders',()=>{
  const panel=between(ui,'async function membersPanel','async function wireMembers');
  const governanceIndex=panel.indexOf("if(hub.active!=='directory')");
  const summaryIndex=panel.indexOf("api('/api/admin/members/summary')");
  assert.ok(governanceIndex>=0&&summaryIndex>governanceIndex,'Governance branch must exit before summary request');
  assert.match(panel,/state\.memberSummary\?Promise\.resolve\(state\.memberSummary\):api\('\/api\/admin\/members\/summary'\)/);
  assert.match(ui,/memberSummary:null/);
  assert.match(ui,/state\.memberSummary=null;await renderActive\(\)/);
});

test('Members V6 visual hierarchy stays compact and responsive',()=>{
  assert.match(ui,/function memberInsightsMarkup/);
  assert.match(ui,/New · 30 days/);
  assert.match(ui,/Company test/);
  assert.match(ui,/Active profile distribution/);
  assert.match(ui,/Enabled \+ active profiles only/);
  assert.match(css,/ADMIN MEMBERS INSIGHTS V6/);
  assert.match(css,/\.memberInsightMetrics\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css,/@media\(max-width:760px\)/);
  assert.match(css,/@media\(max-width:520px\)/);
  assert.match(css,/\.memberProfileDistributionBody\{grid-template-columns:1fr\}/);
});
