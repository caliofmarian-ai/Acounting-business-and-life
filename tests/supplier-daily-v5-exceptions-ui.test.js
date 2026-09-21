import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const url=new URL('../public/suppliers-ui.js',import.meta.url);
const source=readFileSync(url,'utf8');

test('V5 exception UI is valid JavaScript syntax',()=>{
  const r=spawnSync(process.execPath,['--check',fileURLToPath(url)],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr||r.stdout);
});

test('Merchant explicitly accepts or declines backorders and substitutions',()=>{
  assert.match(source,/Supplier changes need your decision/);
  assert.match(source,/data-backorder-accept/);
  assert.match(source,/data-backorder-decline/);
  assert.match(source,/data-substitution-accept/);
  assert.match(source,/data-substitution-decline/);
  assert.match(source,/Approval does not change Inventory or money/);
});

test('Supplier shortage options are only shown on partial acceptance and preserve original PO',()=>{
  assert.match(source,/p\.status==='partially_accepted'/);
  assert.match(source,/Shortage options/);
  assert.match(source,/Backorder/);
  assert.match(source,/Substitute/);
  assert.match(source,/PO quantities are unchanged/);
  assert.match(source,/Waiting for Merchant approval/);
});

test('Today distinguishes accepted backorder fulfilment from accepted substitution evidence',()=>{
  assert.match(source,/Accepted backorders/);
  assert.match(source,/data-v5-backorder-fulfil/);
  assert.match(source,/Approved substitutions/);
  assert.match(source,/Merchant approved — physical fulfilment not recorded yet/);
});
