import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertReceiptIntelligenceLoopback,RECEIPT_INTELLIGENCE_860_WAVE} from '../qa-receipt-intelligence-860.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Receipt Intelligence QA accepts only the internal Preview loopback',()=>{
  assert.equal(RECEIPT_INTELLIGENCE_860_WAVE,'receipt_intelligence_860');
  assert.equal(assertReceiptIntelligenceLoopback('http://127.0.0.1:8080').hostname,'127.0.0.1');
  for(const url of ['https://127.0.0.1:8080','http://localhost:8080','http://127.0.0.1.evil:8080','http://user:pass@127.0.0.1:8080']){
    assert.throws(()=>assertReceiptIntelligenceLoopback(url));
  }
});

test('the authenticated manual acceptance wave is registered in the canonical dispatcher',()=>{
  const runner=read('qa-acceptance.js');
  assert.match(runner,/RECEIPT_INTELLIGENCE_860_WAVE,runReceiptIntelligence860Acceptance/);
  assert.match(runner,/ACCEPTANCE_WAVES\.add\(RECEIPT_INTELLIGENCE_860_WAVE\)/);
  assert.match(runner,/config\.wave===RECEIPT_INTELLIGENCE_860_WAVE/);
  assert.match(runner,/export \{RECEIPT_INTELLIGENCE_860_WAVE\}/);
});

test('the wave proves authenticated private original and review-only boundaries without provider or stock writes',()=>{
  const wave=read('qa-receipt-intelligence-860.js');
  assert.match(wave,/account_mode,'company_test'/);
  assert.match(wave,/\/api\/procurement\/purchase-documents/);
  assert.match(wave,/\/intelligence\/manual/);
  assert.match(wave,/\/intelligence\/review/);
  assert.match(wave,/receiving-readiness/);
  assert.match(wave,/allow_external_processing:false/);
  assert.match(wave,/deletePrivateEvidence/);
  assert.match(wave,/qa_856_fixture_cleanup/);
  assert.match(wave,/fixturesRemoved/);
  assert.match(wave,/inventory_purchases/);
  assert.match(wave,/supply_lots/);
  assert.match(wave,/transactions/);
  assert.doesNotMatch(wave,/allow_external_processing:true/);
  assert.doesNotMatch(wave,/RECEIPT_AI_ENABLED/);
});

test('Receipt Intelligence UI ignores late responses after receipt or business context changes',()=>{
  const ui=read('public/receipt-intelligence-ui.js');
  assert.match(ui,/panel!==overlay\|\|bid!==businessId\|\|receiptId!==selected/);
  assert.match(ui,/bid!==businessId/);
  assert.match(ui,/receiptId!==selected/);
});
