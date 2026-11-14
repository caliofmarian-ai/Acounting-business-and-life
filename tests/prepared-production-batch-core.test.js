import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePreparedProductionBatch,parsePreparedProductionBatchId,normalizePreparedBatchComponents,
  preparedBatchUnitCost,preparedBatchRemaining
} from '../prepared-production-batch-core.js';

test('production batch requires exact active Merchant business, product, quantity and retry key',()=>{
  assert.deepEqual(parsePreparedProductionBatch({business_id:11,product_id:22,produced_quantity:'11',idempotency_key:'batch_877_12345678'},11),
    {businessId:11,productId:22,producedQuantity:11,idempotencyKey:'batch_877_12345678'});
  assert.throws(()=>parsePreparedProductionBatch({business_id:'011',product_id:22,produced_quantity:11,idempotency_key:'batch_877_12345678'},11),/business changed/);
  assert.throws(()=>parsePreparedProductionBatch({business_id:11,product_id:22,produced_quantity:'1e1',idempotency_key:'batch_877_12345678'},11),/valid produced/);
  assert.throws(()=>parsePreparedProductionBatch({business_id:11,product_id:22,produced_quantity:11,idempotency_key:'short'},11),/confirmation key/);
});

test('batch IDs are canonical and never coerce zero-padded aliases',()=>{
  assert.equal(parsePreparedProductionBatchId('19'),19);
  assert.equal(parsePreparedProductionBatchId(null),null);
  assert.throws(()=>parsePreparedProductionBatchId('019'),/valid prepared production batch/);
  assert.throws(()=>parsePreparedProductionBatchId('1.0'),/valid prepared production batch/);
});

test('recipe snapshot preserves exact ingredient quantities and unit-cost precision',()=>{
  const components=normalizePreparedBatchComponents([
    {inventory_id:'7',item:'Giniling',unit:'g',recipe_quantity:'100.0000',unit_cost:'0.004200'},
    {inventory_id:8,item:'Potato',unit:'g',recipe_quantity:'25',unit_cost:'0.002000'}
  ]);
  assert.deepEqual(components.map(x=>x.inventory_id),[7,8]);
  assert.equal(preparedBatchUnitCost(components),0.47);
  assert.throws(()=>normalizePreparedBatchComponents([
    {inventory_id:7,item:'A',unit:'g',recipe_quantity:'1',unit_cost:'1'},
    {inventory_id:7,item:'B',unit:'g',recipe_quantity:'1',unit_cost:'1'}
  ]),/duplicate/);
  assert.throws(()=>normalizePreparedBatchComponents([{inventory_id:7,item:'A',unit:'g',recipe_quantity:'1.00001',unit_cost:'1'}]),/precision/);
});

test('produced 11, sold 9 and non-sale 2 reconciles to zero without a second stock balance',()=>{
  assert.equal(preparedBatchRemaining('11.0000','9.0000','2.0000'),0);
  assert.equal(preparedBatchRemaining('11','9','1.5'),0.5);
  assert.throws(()=>preparedBatchRemaining(11,9,2.0001),/exceed/);
  assert.throws(()=>preparedBatchRemaining(11,-1,0),/exceed/);
});
