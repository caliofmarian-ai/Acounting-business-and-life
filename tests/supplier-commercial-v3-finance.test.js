import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../business-finance-view-core.js',import.meta.url),'utf8');

test('Merchant Supplier payables use invoice evidence or receiving and subtract credits and payments',()=>{
  assert.match(source,/purchase_invoice_evidence/);
  assert.match(source,/purchase_returns/);
  assert.match(source,/confirmed_credits/);
  assert.match(source,/invoice evidence when present, otherwise received value; minus confirmed credits and recorded payments/);
});

test('Supplier receivables use the same commercial basis as Merchant payables',()=>{
  assert.match(source,/receivables use invoice evidence when present, otherwise received value, minus confirmed credits and payments/);
  assert.match(source,/resolution_type IN \('credit','refund_expected'\)/);
});
