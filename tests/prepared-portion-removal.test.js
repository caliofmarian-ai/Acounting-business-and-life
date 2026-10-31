import test from 'node:test';
import assert from 'node:assert/strict';
import {PREPARED_REMOVAL_REASONS,parsePreparedRemoval,preparedRemovalTreatment,estimatedPreparedRemovalCost} from '../prepared-portion-removal-core.js';
const example={business_id:12,product_id:81,quantity:2,reason:'owner_consumption',idempotency_key:'retry-unique-001'};
test('owner consumption uses noncash owner draw, never waste classification',()=>{
  const parsed=parsePreparedRemoval(example,12);
  assert.equal(parsed.treatment,'noncash_owner_draw');
  assert.equal(estimatedPreparedRemovalCost([{recipe_quantity:1,unit_cost:68.42}],2),136.84);
  assert.equal(preparedRemovalTreatment('owner_consumption'),'noncash_owner_draw');
});
test('spoiled, damaged and quality-rejected prepared portions are separate noncash loss reasons',()=>{
  for(const reason of ['spoilage','damaged','quality_rejected']){
    const parsed=parsePreparedRemoval({...example,reason},12);
    assert.equal(parsed.treatment,'noncash_product_loss');
    assert.ok(PREPARED_REMOVAL_REASONS[reason]);
  }
});
test('rejects wrong business, unknown reason, invalid quantity and bad idempotency keys',()=>{
  assert.throws(()=>parsePreparedRemoval(example,13),e=>e.status===409);
  for(const change of [{reason:'sale'},{quantity:0},{quantity:-1},{quantity:1.00001},{idempotency_key:'bad'}]){
    assert.throws(()=>parsePreparedRemoval({...example,...change},12),e=>e.status===400);
  }
});
test('costs use recipe ingredient snapshot quantities and reject corrupt values',()=>{
  assert.equal(estimatedPreparedRemovalCost([
    {recipe_quantity:1.25,unit_cost:40},
    {recipe_quantity:0.5,unit_cost:36.84}
  ],2),136.84);
  assert.throws(()=>estimatedPreparedRemovalCost([{recipe_quantity:0,unit_cost:1}],2),RangeError);
});
