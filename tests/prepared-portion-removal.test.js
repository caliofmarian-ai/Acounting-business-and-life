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


test('removal cost rounds exact half-cent boundaries without binary-float understatement',()=>{
  assert.equal(estimatedPreparedRemovalCost([{recipe_quantity:1,unit_cost:2.135}],1),2.14);
  assert.equal(estimatedPreparedRemovalCost([{recipe_quantity:1,unit_cost:4.015}],1),4.02);
  assert.equal(estimatedPreparedRemovalCost([{recipe_quantity:1,unit_cost:0.005},{recipe_quantity:1,unit_cost:0.005}],1),0.01);
  assert.equal(estimatedPreparedRemovalCost([{recipe_quantity:'0.3330',unit_cost:'1.000000'}],3),1);
});
test('prepared removal cost refuses corrupt precision, non-decimal inputs and DB amount overflow',()=>{
  for(const [parts,amount] of [
    [[],1],
    [[{recipe_quantity:1,unit_cost:1.0000001}],1],
    [[{recipe_quantity:1,unit_cost:'1e3'}],1],
    [[{recipe_quantity:1,unit_cost:Infinity}],1],
    [[{recipe_quantity:1,unit_cost:true}],1],
    [[{recipe_quantity:1,unit_cost:-1}],1],
    [[{recipe_quantity:1,unit_cost:999999999999.99}],2],
    [[{recipe_quantity:1,unit_cost:2}],0]
  ])assert.throws(()=>estimatedPreparedRemovalCost(parts,amount),RangeError);
});

test('non-sale stock write rejects coerced identity, reasons and fractional amounts',()=>{
  for(const business_id of [true,[12],{valueOf:()=>12},'1.2e1',' 12 ','12.0',false]){
    assert.throws(()=>parsePreparedRemoval({...example,business_id},12),e=>e.status===409);
  }
  for(const product_id of [true,[81],{valueOf:()=>81},'8.1e1',' 81 ','81.0',false]){
    assert.throws(()=>parsePreparedRemoval({...example,product_id},12),e=>e.status===400);
  }
  for(const quantity of [true,[2],{valueOf:()=>2},'2e0','2.00001',2.000000000001,
     '0.00001','2.00junk',' 2 ',false]){
    assert.throws(()=>parsePreparedRemoval({...example,quantity},12),e=>e.status===400);
  }
  for(const reason of [['owner_consumption'],{toString:()=> 'owner_consumption'}]){
    assert.throws(()=>parsePreparedRemoval({...example,reason},12),e=>e.status===400);
  }
  for(const idempotency_key of [['retry-unique-001'],{toString:()=> 'retry-unique-001'}]){
    assert.throws(()=>parsePreparedRemoval({...example,idempotency_key},12),e=>e.status===400);
  }
  const valid=parsePreparedRemoval({...example,business_id:'12',product_id:'81',quantity:'0.0001'},12);
  assert.equal(valid.productId,81);
  assert.equal(valid.quantity,0.0001);
  assert.equal(parsePreparedRemoval({...example,quantity:'2.0000'},12).quantity,2);
  assert.equal(parsePreparedRemoval(example,12).quantity,2);
});

test('ingredient consumption matches the canonical three-decimal physical stock scale',()=>{
  for(const [recipeQuantity,portions] of [
    ['0.0001',1], // A positive historic write rounded inventory stock back to zero.
    ['0.3333',3], // Unrepresentable eight-decimal recipe product.
    ['1.0000','0.0001'],
    ['0.0005',1]
  ])assert.throws(
    ()=>estimatedPreparedRemovalCost([{recipe_quantity:recipeQuantity,unit_cost:'1.000000'}],portions),
    error=>error?.status===409&&error?.code==='PREPARED_REMOVAL_STOCK_PRECISION'
  );
  assert.equal(estimatedPreparedRemovalCost([{recipe_quantity:'0.0005',unit_cost:'1.000000'}],2),0);
  assert.equal(estimatedPreparedRemovalCost([{recipe_quantity:'0.3330',unit_cost:'1.000000'}],3),1);
  assert.equal(estimatedPreparedRemovalCost([{recipe_quantity:1,unit_cost:68.42}],2),136.84);
  assert.throws(()=>estimatedPreparedRemovalCost([
    {recipe_quantity:'0.2500',unit_cost:'1.000000'},
    {recipe_quantity:'0.0001',unit_cost:'2.000000'}
  ],1),error=>error?.status===409);
});

test('noncanonical IDs and malformed trusted business authority never authorize prepared stock writes',()=>{
  for(const bad of ['012',' 12 ','12 ','12.0','1.2e1','+12',[12],{valueOf:()=>12},true,12.1,0,Number.MAX_SAFE_INTEGER+1]){
    assert.throws(()=>parsePreparedRemoval({...example,business_id:bad},12),e=>e.status===409,
      'request business ID '+String(bad));
    assert.throws(()=>parsePreparedRemoval(example,bad),e=>e.status===409,
      'trusted business ID '+String(bad));
  }
  for(const product_id of ['081',' 81 ','81.0','8.1e1',+Infinity]){
    assert.throws(()=>parsePreparedRemoval({...example,product_id},12),e=>e.status===400);
  }
  assert.equal(parsePreparedRemoval({...example,business_id:'12',product_id:'81'},'12').businessId,12);
  assert.equal(parsePreparedRemoval(example,12).productId,81);
});
