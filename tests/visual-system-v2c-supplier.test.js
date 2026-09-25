import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css=readFileSync(new URL('../public/suppliers.css',import.meta.url),'utf8');

test('Visual System V2C gives Supplier a warm premium role identity',()=>{
  assert.match(css,/Visual System V2C — Supplier polish/);
  assert.match(css,/\.supWorkspace\{[^}]*--supplier-ui-accent:#a86727/);
  assert.match(css,/\.supWorkspace \.supHero\{/);
  assert.match(css,/background:linear-gradient\(135deg,#17233c 0%,#584638 55%,#a86727 100%\)/);
  assert.match(css,/\.supWorkspace \.supCard\{/);
  assert.match(css,/\.supWorkspace \.supRow\{/);
  assert.match(css,/\.supWorkspace \.supBtn:focus-visible/);
});

test('Supplier visual polish preserves forms and narrow Android treatment',()=>{
  assert.match(css,/\.supWorkspace \.supForm input:focus/);
  assert.match(css,/@media\(max-width:420px\)\{/);
  assert.match(css,/\.supWorkspace \.supCard\{border-radius:18px;padding:13px\}/);
});
