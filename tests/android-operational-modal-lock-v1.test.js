import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const marketplace=read('public/marketplace-ui.js');
const services=read('public/services-ui.js');
const delivery=read('public/delivery-ui.js');
const shell=read('public/shell.js');

function between(source,start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a+1);
  assert.ok(a>=0&&b>a,'missing block '+start);
  return source.slice(a,b);
}

test('Marketplace Checkout owns background scroll lock until close',()=>{
  const open=between(marketplace,'function openCheckout','async function submitCheckout');
  const close=between(marketplace,'function closeCheckout','function openCheckout');
  assert.match(open,/document\.body\.style\.overflow='hidden'/);
  assert.match(close,/document\.body\.style\.overflow=''/);
  assert.match(marketplace,/function closeMarket\(\)[^{]*\{[^}]*closeCheckout\(\)/);
});

test('Local Services uses one modal lock helper for every operational modal',()=>{
  assert.match(services,/function openServiceModal\(\)\{[^}]*classList\.remove\('hidden'\);document\.body\.style\.overflow='hidden'/);
  assert.match(services,/function closeServiceModal\(\)\{[^}]*classList\.add\('hidden'\);document\.body\.style\.overflow=''/);
  for(const fn of ['openRequestModal','openCredentialModal','openQuoteModal','openReviewModal']){
    const i=services.indexOf('function '+fn);
    assert.ok(i>=0,fn+' missing');
    assert.ok(services.slice(i,i+7000).includes('openServiceModal()'),fn+' must use central modal opener');
  }
  assert.doesNotMatch(services,/b\.classList\.remove\('hidden'\)/);
  assert.match(services,/function closeSvc\(\)\{closeServiceModal\(\)/);
});

test('Delivery modal owns background scroll and workspace close releases it',()=>{
  assert.match(delivery,/function openDeliveryModal\(html\)\{[^}]*document\.body\.style\.overflow='hidden'/);
  assert.match(delivery,/function closeDeliveryModal\(\)\{[^}]*document\.body\.style\.overflow=''/);
  assert.match(delivery,/function closeDeliveryWorkspace\(\)[^{]*\{[^}]*closeDeliveryModal\(\)/);
  assert.match(delivery,/function hideDeliveryBase\(\)[^{]*\{[^}]*closeDeliveryModal\(\)/);
});

test('canonical shell remains the global workspace escape hatch for body scroll',()=>{
  const block=between(shell,'function hideFeatureWorkspaces','function openFeatureWorkspace');
  assert.match(block,/document\.body\.style\.overflow\s*=\s*''/);
});
