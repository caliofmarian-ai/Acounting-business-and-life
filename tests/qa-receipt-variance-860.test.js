import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {assertReceiptVarianceLoopback,RECEIPT_VARIANCE_860_WAVE} from '../qa-receipt-variance-860.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('receipt variance 860 has a dedicated, explicitly registered authenticated Preview wave',()=>{
  const qa=read('qa-acceptance.js');
  assert.equal(RECEIPT_VARIANCE_860_WAVE,'receipt_variance_860');
  assert.match(qa,/RECEIPT_VARIANCE_860_WAVE,runReceiptVariance860Acceptance/);
  assert.match(qa,/ACCEPTANCE_WAVES\.add\(RECEIPT_VARIANCE_860_WAVE\)/);
  assert.match(qa,/config\.wave===RECEIPT_VARIANCE_860_WAVE/);
  assert.match(qa,/export \{RECEIPT_VARIANCE_860_WAVE\}/);
});

test('receipt variance wave rejects every non-loopback or non-HTTP runtime URL',()=>{
  assert.equal(assertReceiptVarianceLoopback('http://127.0.0.1:8080').hostname,'127.0.0.1');
  assert.throws(()=>assertReceiptVarianceLoopback('https://caliof.com'));
  assert.throws(()=>assertReceiptVarianceLoopback('http://localhost:8080'));
  assert.throws(()=>assertReceiptVarianceLoopback('http://127.0.0.1:8080@evil.example'));
});

test('authenticated wave verifies isolated company_test identity, both lock orders and exact fixture cleanup',()=>{
  const wave=read('qa-receipt-variance-860.js');
  assert.match(wave,/validateRuntimeSafety\(env\)/);
  assert.match(wave,/runtime\.previewService/);
  assert.match(wave,/current_database\(\)/);
  assert.match(wave,/account_mode/);
  assert.match(wave,/company_test/);
  assert.match(wave,/account_business_preferences/);
  assert.match(wave,/pg_stat_activity/);
  assert.match(wave,/resume-first evidence lock/);
  assert.match(wave,/evidence-first findings lock/);
  assert.match(wave,/fixturesRemoved=true/);
  assert.match(wave,/Receipt variance QA business cleanup ownership mismatch/);
});

test('the deployed variance route and resume route serialize on the same count-session row',()=>{
  const evidence=read('receipt-intelligence-routes.js');
  const count=read('inventory-count-sessions.js');
  assert.match(evidence,/SELECT status FROM inventory_count_sessions WHERE id=\$1 AND business_id=\$2 FOR SHARE/);
  assert.match(count,/SELECT \* FROM inventory_count_sessions\s+WHERE id=\$1 AND business_id=\$2 FOR UPDATE/);
});
