import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const uiUrl=new URL('../public/suppliers-ui.js',import.meta.url);
const ui=readFileSync(uiUrl,'utf8');

test('Supplier Sourcing V4 browser UI is valid JavaScript syntax',()=>{
  const r=spawnSync(process.execPath,['--check',fileURLToPath(uiUrl)],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr||r.stdout);
});

test('Merchant sourcing is controlled and never claims automatic selection or ordering',()=>{
  assert.match(ui,/Find suppliers & request quotes/);
  assert.match(ui,/Only approved Suppliers who opted into controlled discovery appear here/);
  assert.match(ui,/Business & Life does not rank a “best Supplier” or place an order for you/);
  assert.match(ui,/No order was created/);
  assert.match(ui,/never auto-selects a quote and never creates a PO until you press Create PO/);
});

test('Merchant quote comparison exposes factual cost lead time and non-comparability',()=>{
  assert.match(ui,/Lowest normalized landed cost/);
  assert.match(ui,/Earliest quoted fulfilment/);
  assert.match(ui,/NOT_COMPARABLE/);
  assert.match(ui,/MOQ/);
  assert.match(ui,/data-quote-po/);
});

test('Merchant preferred Supplier sources are explicit and ranked',()=>{
  assert.match(ui,/Preferred Supplier sources/);
  assert.match(ui,/Rank 1 is used first when available/);
  assert.match(ui,/data-source-rank/);
  assert.match(ui,/preferred Supplier source configured/i);
});

test('Supplier sourcing visibility is private by default and exposes opt-in controls',()=>{
  assert.match(ui,/Sourcing visibility & quote requests/);
  assert.match(ui,/Private — existing relationships only/);
  assert.match(ui,/Directory — show business summary/);
  assert.match(ui,/RFQ only — no public catalog summary/);
  assert.match(ui,/Accept sourcing RFQs/);
});

test('Supplier can quote or decline RFQs and quote copy preserves commercial boundaries',()=>{
  assert.match(ui,/Incoming requests for quote/);
  assert.match(ui,/data-rfq-quote/);
  assert.match(ui,/data-rfq-decline/);
  assert.match(ui,/A quote is an offer, not an invoice or purchase order/);
  assert.match(ui,/Quote sent\. No PO was created/);
});
