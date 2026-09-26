import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const shell=read('public/shell.js');
const orders=read('public/orders-ui.js');
const marketplace=read('public/marketplace-ui.js');
const suppliers=read('public/suppliers-ui.js');
const delivery=read('public/delivery-ui.js');
const services=read('public/services-ui.js');
const money=read('public/profile-money-ui.js');
const loader=read('public/mobile-feature-loader.js');
const accounting=read('public/business-accounting-ui.js');
const pricing=read('public/pricing-transparency.js');
const notifications=read('public/notifications-ui.js');

function between(source,start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a+1);
  assert.ok(a>=0&&b>a,'expected block '+start+' → '+end);
  return source.slice(a,b);
}
const geometryMutation=/createElement\(|appendChild\(|\.prepend\(|insertAdjacent(?:Element|HTML)\(|\.remove\(\)/;

test('shell exposes actions but never a mutable Merchant navigation host',()=>{
  assert.match(shell,/window\.BusinessLifeShell=Object\.freeze/);
  assert.match(shell,/openFeatureWorkspace/);
  assert.match(shell,/openAccountHome/);
  assert.doesNotMatch(shell,/merchantWorkspaceHost/);
});

test('profile-state feature decorators only wire existing UI and never own primary geometry',()=>{
  const decorators={
    orders:between(orders,'async function decorate(','function ordersVisible'),
    marketplace:between(marketplace,'async function decorateMarket(','function observeMarket'),
    suppliers:between(suppliers,'async function decorateSupplier(','function observeSupplier'),
    delivery:between(delivery,'async function decorateDelivery(','function observeDelivery'),
    services:between(services,'async function decorateSvc(','function observeSvc'),
    money:between(money,'function decorateMoney(','window.BusinessLifeProfileMoney')
  };
  for(const [name,block] of Object.entries(decorators)){
    assert.doesNotMatch(block,geometryMutation,name+' decorator must hydrate existing structure only');
  }
});

test('Merchant mobile lazy loader no longer owns primary navigation geometry',()=>{
  const profileHandler=between(loader,"document.addEventListener('abl:profile-state'","document.addEventListener('visibilitychange'");
  assert.doesNotMatch(profileHandler,geometryMutation);
  assert.doesNotMatch(loader,/merchantMobileTools|MERCHANT_MOBILE_ACTIONS|merchantWorkspaceHost/);
});

test('Supplier accounting hydrates reserved first-paint structure rather than creating its primary Finance card',()=>{
  const wire=between(accounting,'function wireSupplierAccountingTile','async function openSupplierAccounting');
  assert.doesNotMatch(wire,geometryMutation);
  assert.match(wire,/data-business-accounting-tile/);
  assert.doesNotMatch(accounting,/grid\.prepend\(tile\)|mountSupplierAccountingTile/);
});

test('pricing and notification async work hydrate reserved slots instead of primary navigation',()=>{
  assert.match(pricing,/nodes\.forEach\(blPricingSkeleton\)/);
  assert.match(pricing,/await blPricingGet\(\)/);
  assert.match(notifications,/document\.getElementById\('notificationBell'\)/);
  assert.match(notifications,/document\.getElementById\('notificationBadge'\)/);
});
