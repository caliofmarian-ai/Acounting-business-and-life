import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOwnerControlTower} from '../owner-control-tower-core.js';
import {assertOwnerDecisionEvidenceForQa} from '../qa-owner-decision-evidence.js';

const unavailable=()=>buildOwnerControlTower({});
const available=()=>buildOwnerControlTower({owner_decisions:[{
  decision_code:'QA_REVIEW',source_domain:'release',source_type:'qa_gate',source_id:'synthetic',
  required_authority:'project_owner',state:'open',title:'Synthetic review fixture'
}]});

test('QA accepts actual core unknown/null evidence only when no decision source was supplied',()=>{
  const model=unavailable();
  assert.equal(model.decision_status.open_count,null);
  assert.doesNotThrow(()=>assertOwnerDecisionEvidenceForQa(model,{owner_decisions:'unavailable'}));
});
test('QA accepts the actual core canonical empty queue as available zero',()=>{
  const model=buildOwnerControlTower({owner_decisions:[]});
  assert.equal(model.decision_status.state,'available');
  assert.doesNotThrow(()=>assertOwnerDecisionEvidenceForQa(model,{owner_decisions:'available'}));
});
test('QA accepts an actual normalized canonical decision queue with its matching count',()=>{
  const model=available();
  assert.equal(model.owner_decisions.length,1);
  assert.equal(model.decision_status.open_count,1);
  assert.doesNotThrow(()=>assertOwnerDecisionEvidenceForQa(model,{owner_decisions:'available'}));
});
test('QA rejects a fabricated available count that disagrees with the returned queue',()=>{
  const model=available();model.decision_status.open_count=0;
  assert.throws(()=>assertOwnerDecisionEvidenceForQa(model,{owner_decisions:'available'}),/canonical queue count/);
});
test('QA rejects coerced, fractional, negative or unknown available counts',()=>{
  for(const count of ['1',true,0.5,-1,null,NaN]){
    const model=available();model.decision_status.open_count=count;
    assert.throws(()=>assertOwnerDecisionEvidenceForQa(model,{owner_decisions:'available'}),/canonical queue count/);
  }
});
test('QA rejects availability claims that contradict the evidence status',()=>{
  assert.throws(()=>assertOwnerDecisionEvidenceForQa(available(),{owner_decisions:'unavailable'}),/canonical queue count/);
  assert.throws(()=>assertOwnerDecisionEvidenceForQa(unavailable(),{owner_decisions:'available'}),/Unknown/);
});
test('QA rejects counts or queued records hidden behind an unknown state',()=>{
  const counted=unavailable();counted.decision_status.open_count=0;
  assert.throws(()=>assertOwnerDecisionEvidenceForQa(counted,{owner_decisions:'unavailable'}),/Unknown/);
  const queued=unavailable();queued.owner_decisions=available().owner_decisions;
  assert.throws(()=>assertOwnerDecisionEvidenceForQa(queued,{owner_decisions:'unavailable'}),/Unknown/);
});
test('QA rejects absent queue shape, absent evidence and unsupported decision states',()=>{
  assert.throws(()=>assertOwnerDecisionEvidenceForQa(),/missing/);
  const malformed=available();malformed.owner_decisions=null;
  assert.throws(()=>assertOwnerDecisionEvidenceForQa(malformed,{owner_decisions:'available'}),/missing/);
  assert.throws(()=>assertOwnerDecisionEvidenceForQa(available(),{}),/canonical queue count/);
  const invalid=available();invalid.decision_status.state='healthy';
  assert.throws(()=>assertOwnerDecisionEvidenceForQa(invalid,{owner_decisions:'available'}),/canonical queue count/);
});
