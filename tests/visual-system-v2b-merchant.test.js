import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css=readFileSync(new URL('../public/v03.css',import.meta.url),'utf8');

test('Visual System V2B gives Merchant Today a premium role-specific hierarchy',()=>{
  assert.match(css,/Visual System V2B — Merchant Today polish/);
  assert.match(css,/\.merchantTodayView\{[^}]*--merchant-ui-accent:#5c52b8/);
  assert.match(css,/\.merchantTodayView \.todayHeader\{/);
  assert.match(css,/background:linear-gradient\(135deg,#17233c 0%,#35366c 52%,#5c52b8 100%\)/);
  assert.match(css,/\.merchantTodayView \.todayCard\{/);
  assert.match(css,/\.merchantTodayView \.todayMoneyGrid>div\{/);
  assert.match(css,/\.merchantTodayView \.todayPrimaryAction:focus-visible\{/);
});

test('Merchant visual polish preserves small-screen and reduced-motion contracts',()=>{
  assert.match(css,/@media\(max-width:420px\)\{/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)\{/);
  assert.match(css,/\.merchantTodayView \.todayCard\{padding:14px;border-radius:18px\}/);
});
