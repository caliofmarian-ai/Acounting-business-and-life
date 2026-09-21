import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const uiUrl=new URL('../public/suppliers-ui.js',import.meta.url);
const cssUrl=new URL('../public/suppliers.css',import.meta.url);
const ui=readFileSync(uiUrl,'utf8');
const css=readFileSync(cssUrl,'utf8');

test('Supplier UX V5.1 browser code remains valid JavaScript',()=>{
  const r=spawnSync(process.execPath,['--check',fileURLToPath(uiUrl)],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr||r.stdout);
});

test('Supplier opens with a visible loading state before required data arrives',()=>{
  assert.match(ui,/supSupplierSection='Today'/);
  assert.match(ui,/function supplierWorkspaceLoading/);
  assert.match(ui,/role="status"/);
  assert.match(ui,/aria-live="polite"/);
  assert.match(ui,/Getting the latest Supplier information/);
  const renderStart=ui.indexOf('async function renderSupplierWorkspace');
  const loadingAt=ui.indexOf('supplierWorkspaceLoading(normalized)',renderStart);
  const requiredFetchAt=ui.indexOf("papi('/api/supplier/me')",renderStart);
  assert.ok(renderStart>=0&&loadingAt>renderStart&&requiredFetchAt>loadingAt);
});

test('Required Supplier load failures render a retryable full-workspace error',()=>{
  assert.match(ui,/function supplierWorkspaceError/);
  assert.match(ui,/role="alert"/);
  assert.match(ui,/supWorkspaceRetry/);
  assert.match(ui,/Try again/);
  assert.match(ui,/renderSupplierWorkspace\(section\)/);
  assert.match(ui,/supWorkspaceBack/);
});

test('Supplier mobile controls have readable type and comfortable touch targets',()=>{
  assert.match(css,/\.supBack\{[^}]*width:44px;[^}]*height:44px/);
  assert.match(css,/\.supForm button,\.supBtn\{[^}]*min-height:44px;[^}]*font-size:13px/);
  assert.match(css,/\.supForm input,\.supForm select,\.supForm textarea\{[^}]*font-size:16px;[^}]*min-height:44px/);
  assert.match(css,/\.supRow strong\{font-size:14px/);
  assert.match(css,/\.supRow small\{display:block;font-size:12px/);
  assert.match(css,/\.supMeta span\{font-size:11px/);
});

test('Supplier layout protects narrow mobile screens from accidental horizontal overflow',()=>{
  assert.match(css,/\.supWorkspace\{[^}]*overflow-x:hidden/);
  assert.match(css,/\.supHeader>div,\.supRow>div\{min-width:0\}/);
  assert.match(css,/overflow-wrap:anywhere/);
});
