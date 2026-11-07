// QA-only assertion: availability must agree with the canonical queue and count.
// This validates returned evidence; it never creates or approves a decision.
export function assertOwnerDecisionEvidenceForQa(model={},evidence={}){
  const status=model.decision_status,queue=model.owner_decisions;
  if(!status||!Array.isArray(queue))throw new Error('Owner decision QA evidence is missing.');
  if(status.state==='unknown'){
    if(status.open_count!==null||queue.length!==0||evidence.owner_decisions!=='unavailable'){
      throw new Error('Unknown Owner decision evidence must not claim a queue or count.');
    }
    return;
  }
  if(status.state!=='available'||evidence.owner_decisions!=='available'||
    !Number.isSafeInteger(status.open_count)||status.open_count<0||status.open_count!==queue.length){
    throw new Error('Available Owner decision evidence must match its canonical queue count.');
  }
}
