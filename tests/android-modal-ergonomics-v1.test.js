import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const support=read('public/admin-operations.css');
const notifications=read('public/notifications.css');
const legal=read('public/legal.css');

test('Android modal sheets use dynamic viewport height with vh fallback',()=>{
  assert.match(support,/max-height:94vh;max-height:94dvh/);
  assert.match(support,/max-height:88vh;max-height:88dvh/);
  assert.match(notifications,/max-height:94vh;max-height:94dvh/);
  assert.match(notifications,/max-height:88vh;max-height:88dvh/);
  assert.match(legal,/max-height:95vh;max-height:95dvh/);
  assert.match(legal,/max-height:90vh;max-height:90dvh/);
});

test('Android modal sheets protect bottom content with safe-area padding',()=>{
  for(const css of [support,notifications,legal])assert.match(css,/env\(safe-area-inset-bottom\)/);
});

test('Android modal close controls meet the 44px touch target contract',()=>{
  assert.match(support,/\.opsClose\{[^}]*width:44px;height:44px/);
  assert.match(notifications,/\.notificationClose\{[^}]*width:44px;height:44px/);
  assert.match(legal,/\.legalClose\{[^}]*width:44px;height:44px/);
});
