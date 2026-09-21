import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const shell=read('public/shell.js');
const shellCss=read('public/shell.css');
const delivery=read('public/delivery-ui.js');
const money=read('public/profile-money-ui.js');
const server=read('server-delivery.js');
const moneyCore=read('profile-money-core.js');

function courierBlock(){
  const start=shell.indexOf('function openCourierHubFeature');
  const end=shell.indexOf('function renderRoleHub',start);
  assert.ok(start>=0&&end>start);
  return shell.slice(start,end);
}

test('Courier has dedicated Home Deliveries Money navigation',()=>{
  const block=courierBlock();
  assert.match(shell,/if\(role==='courier'\)return renderCourierHub\(\)/);
  const start=block.indexOf('<nav class="courierPrimaryNav"');
  const end=block.indexOf('</nav>',start);
  assert.ok(start>=0&&end>start);
  const nav=block.slice(start,end);
  for(const label of ['Home','Deliveries','Money'])assert.match(nav,new RegExp('<strong>'+label+'<\\/strong>'));
  assert.doesNotMatch(nav,/Eligibility/);
  assert.doesNotMatch(nav,/Availability/);
  assert.doesNotMatch(nav,/Route/);
});

test('Courier Home keeps eligibility availability route and assigned work as contextual actions',()=>{
  const block=courierBlock();
  assert.match(block,/data-courier-home-open="Eligibility"/);
  assert.match(block,/courierHomeAvailabilityAction/);
  assert.match(block,/destination:'Tracking'/);
  assert.match(block,/destination:'Deliveries'/);
  assert.match(block,/Admin approval is required before availability can be enabled/);
});

test('Courier shell reuses the canonical Delivery workspace launcher',()=>{
  const block=courierBlock();
  assert.match(delivery,/window\.BusinessLifeDelivery=Object\.freeze\(\{openCustomerDelivery,openCourierWorkspace\}\)/);
  assert.match(block,/BusinessLifeDelivery\?\.openCourierWorkspace/);
  assert.match(block,/openCourierWorkspace\(feature\)/);
  assert.doesNotMatch(block,/\/api\/courier\//);
  assert.doesNotMatch(block,/fetch\(/);
});

test('Courier Home fallback cannot recursively click its own feature button',()=>{
  const block=courierBlock();
  assert.doesNotMatch(block,/target\.click\(\)/);
  assert.match(block,/is still loading\. Try again in a moment/);
});

test('Courier Settings remains non-primary and opens the Courier profile settings',()=>{
  const block=courierBlock();
  assert.match(block,/Delivery settings/);
  assert.match(block,/BusinessLifeProfileSettings\?\.open\?\.\('courier'\)/);
  const start=block.indexOf('<nav class="courierPrimaryNav"');
  const end=block.indexOf('</nav>',start);
  assert.doesNotMatch(block.slice(start,end),/Settings/);
});

test('Courier Money remains canonical and delivery fee is not treated as earnings',()=>{
  assert.match(blockText(money),/Customer charges — not earnings/);
  assert.match(blockText(money),/No courier_net allocation yet/);
  assert.match(moneyCore,/courier_net/);
  function blockText(v){return v}
});

test('Courier eligibility remains Admin-authorized and availability remains locked until approval',()=>{
  assert.match(delivery,/eligibility_status==='approved'/);
  assert.match(delivery,/Availability stays locked until Admin explicitly approves eligibility/);
  assert.match(delivery,/\$\{approved\?'':'disabled'\}/);
  assert.match(server,/eligibility_status/);
});

test('Courier completion-code and live-route boundaries remain intact',()=>{
  assert.match(delivery,/Customer handoff code/);
  assert.match(delivery,/completion_code/);
  assert.match(delivery,/COURIER_ACTIVE_STATES/);
  assert.match(delivery,/No active route right now/);
  assert.match(delivery,/setInterval/);
  assert.match(delivery,/clearInterval\(delPoll\)/);
});

test('Courier navigation adds no polling or network calls',()=>{
  const block=courierBlock();
  assert.doesNotMatch(block,/setInterval\s*\(/);
  assert.doesNotMatch(block,/setTimeout\s*\(/);
  assert.doesNotMatch(block,/fetch\s*\(/);
  assert.doesNotMatch(block,/MutationObserver/);
});

test('Courier navigation is mobile safe with three primary destinations',()=>{
  assert.match(shellCss,/\.courierPrimaryNav\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(shellCss,/\.courierPrimaryNav button\{[^}]*min-height:52px/);
  assert.match(shellCss,/\.courierStatusMain button,[^}]*\.courierAvailabilityRow button\{[^}]*min-height:44px/);
  assert.match(shellCss,/\.courierCurrentWork button,[^}]*\.courierHomeEmpty button\{[^}]*min-height:44px/);
  assert.match(shellCss,/@media\(max-width:420px\)/);
  assert.match(shellCss,/@media\(max-width:350px\)/);
});
