import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css=readFileSync(new URL('../public/orders.css',import.meta.url),'utf8');

// These assertions guard the exact CSS breakpoints and card text controls;
// actual viewport/browser evidence must be recorded separately at Preview QA.
test('Orders board defaults to one lane and two lanes from tablet width',()=>{
  assert.match(css,/\.ordersBoard\{display:grid;gap:12px\}/);
  assert.match(css,/@media\(min-width:650px\)\{[\s\S]*?\.ordersBoard\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});
test('four-lane Orders board requires enough real CSS width for readable cards',()=>{
  assert.doesNotMatch(css,/@media\(min-width:960px\)/);
  assert.match(css,/@media\(min-width:1200px\)\{\.ordersWorkspace\{max-width:1360px\}\.ordersBoard\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
});
test('long status chips wrap beside order identifiers rather than crushing them',()=>{
  assert.match(css,/\.orderCardTop\{[^}]*flex-wrap:wrap/);
  assert.match(css,/\.orderCardTop \.orderCardMain\{[^}]*flex:1 1 11rem;min-width:min\(100%,11rem\)/);
  assert.match(css,/\.orderStatus\{[^}]*white-space:normal;overflow-wrap:break-word;max-width:100%/);
});
test('money can wrap, controls remain finger-sized and overflow is constrained',()=>{
  assert.match(css,/\.orderMoney\{[^}]*flex-wrap:wrap;gap:8px/);
  assert.match(css,/\.orderActions button\{[^}]*min-height:44px/);
  assert.match(css,/\.ordersWorkspace\{[^}]*overflow-x:hidden/);
});

test('portrait touch devices keep one lane even with forced desktop-width CSS viewport',()=>{
  assert.match(css,/@media\(min-width:650px\) and \(max-width:1199px\) and \(pointer:coarse\) and \(orientation:portrait\)\{\.ordersBoard\{grid-template-columns:minmax\(0,1fr\)\}\}/);
});
