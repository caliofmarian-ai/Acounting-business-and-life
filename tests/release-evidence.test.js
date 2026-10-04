import test from 'node:test';
import assert from 'node:assert/strict';
import {currentReleaseEvidence} from '../release-evidence.js';

test('release evidence is explicit, Production-only and source-linked',()=>{
  const evidence=currentReleaseEvidence();
  assert.equal(evidence.source_issue,758);
  assert.equal(evidence.country_code,'PH');
  assert.equal(evidence.status,'hold');
  assert.equal(evidence.product_quality.open_p0,2);
  assert.equal(evidence.product_quality.open_p1,0);
  assert.equal(evidence.product_quality.parity_issues,null);
  assert.equal(evidence.product_quality.parity_policy,'production_only');
  assert.match(evidence.unavailable_reasons.parity_issues,/Production-only/i);
  assert.match(evidence.summary,/controlled non-settling Production lifecycle is accepted/i);
  assert.equal(evidence.owner_decisions.length,2);
  assert.deepEqual(new Set(evidence.owner_decisions.map(x=>x.decision_code)),new Set(['LEGAL-001','SEC-001']));
});

test('callers receive an isolated release evidence snapshot',()=>{
  const one=currentReleaseEvidence(),two=currentReleaseEvidence();
  one.product_quality.open_p0=99;
  one.owner_decisions[0].title='changed';
  assert.equal(two.product_quality.open_p0,2);
  assert.notEqual(two.owner_decisions[0].title,'changed');
});
