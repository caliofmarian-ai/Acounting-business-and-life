import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const uiUrl=new URL('../public/suppliers-ui.js',import.meta.url);
const cssUrl=new URL('../public/suppliers.css',import.meta.url);
const ui=readFileSync(uiUrl,'utf8');
const css=readFileSync(cssUrl,'utf8');

test('Supplier V2 browser UI is valid JavaScript syntax',()=>{
  const result=spawnSync(process.execPath,['--check',fileURLToPath(uiUrl)],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout);
});

test('Merchant mobile procurement supports external suppliers lots and repacking progressively',()=>{
  assert.match(ui,/Local suppliers, lots(?:, returns)? & repacking/);
  assert.match(ui,/Add local supplier/);
  assert.match(ui,/Receive stock from supplier/);
  assert.match(ui,/repackSupplyLot/);
  assert.match(ui,/Opening a case and selling the original sealed units is/);
  assert.match(ui,/class="supDetails supCard"/);
});

test('Supplier catalog keeps advanced business and packaging controls behind details',()=>{
  assert.match(ui,/What does this business do/);
  assert.match(ui,/Packaging & B2B pricing/);
  assert.match(ui,/Volume pricing/);
  assert.match(ui,/Package hierarchy/);
  assert.match(ui,/data-cat-v2/);
  assert.match(ui,/supplierPriceLine/);
});

test('Supplier V2 UI collapses to one column on narrow Android-sized screens',()=>{
  assert.match(css,/@media\(max-width:420px\)/);
  assert.match(css,/\.supTwo\{grid-template-columns:1fr\}/);
  assert.match(css,/\.supCheckGrid\{grid-template-columns:1fr\}/);
  assert.match(css,/\.supDetails>summary/);
});
