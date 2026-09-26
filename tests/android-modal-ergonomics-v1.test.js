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

test('Android modal actions meet the 44px touch target contract',()=>{
  assert.match(support,/\.opsTabs button\{[^}]*min-height:44px/);
  assert.match(support,/\.voiceActions button\{[^}]*min-height:44px/);
  assert.match(support,/\.supportComposerTools button\{[^}]*min-height:44px/);
  assert.match(notifications,/\.notificationTabs button,\.notificationToolbar button\{[^}]*min-height:44px/);
  assert.match(notifications,/\.notificationDismiss\{[^}]*min-width:44px;min-height:44px/);
  assert.match(notifications,/\.soundPreviewButton\{[^}]*min-height:44px/);
  assert.match(notifications,/\.webPushCompact button\{[^}]*min-height:44px/);
  assert.match(notifications,/\.notificationModeChoices button\{min-height:44px/);
  assert.match(legal,/\.legalTabs button\{[^}]*min-height:44px/);
  assert.match(legal,/\.legalCard button\{[^}]*min-height:44px/);
  assert.match(legal,/\.legalPrimary,\.legalSecondary,\.legalDanger\{[^}]*min-height:44px/);
  assert.match(legal,/\.legalAdminDoc>button\{[^}]*min-height:44px/);
});
