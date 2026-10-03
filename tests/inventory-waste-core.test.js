import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWasteAnalytics,normalizeWasteAdjustment} from '../inventory-waste-core.js';

test('waste analytics excludes physical count corrections and positive adjustments',()=>{
  const report=buildWasteAnalytics({adjustments:[
    {id:1,inventory_id:1,item:'Chicken',adjustment_kind:'spoilage',quantity_delta:-2,unit:'kg',estimated_value_delta:-300},
    {id:2,inventory_id:1,item:'Chicken',adjustment_kind:'count_correction',quantity_delta:-1,unit:'kg',estimated_value_delta:-150},
    {id:3,inventory_id:1,item:'Chicken',adjustment_kind:'waste',quantity_delta:1,unit:'kg',estimated_value_delta:150}
  ]});
  assert.equal(report.summary.events,1);
  assert.equal(report.summary.value_loss,300);
  assert.equal(report.top_items[0].quantity_loss,2);
});

test('value loss uses adjustment-time estimated value snapshot as an absolute loss',()=>{
  const row=normalizeWasteAdjustment({
    id:1,inventory_id:2,item:'Milk',adjustment_kind:'expired',
    quantity_delta:-3,unit:'L',unit_cost_snapshot:50,estimated_value_delta:-177.25
  });
  assert.equal(row.value_loss,177.25);
  assert.equal(row.loss_quantity,3);
});

test('reason breakdown and top items reconcile to the same recorded loss value',()=>{
  const report=buildWasteAnalytics({adjustments:[
    {id:1,inventory_id:1,item:'Chicken',adjustment_kind:'spoilage',quantity_delta:-2,unit:'kg',estimated_value_delta:-300},
    {id:2,inventory_id:1,item:'Chicken',adjustment_kind:'expired',quantity_delta:-1,unit:'kg',estimated_value_delta:-150},
    {id:3,inventory_id:2,item:'Milk',adjustment_kind:'spoilage',quantity_delta:-2,unit:'L',estimated_value_delta:-100}
  ]});
  assert.equal(report.summary.value_loss,550);
  assert.equal(report.by_reason.reduce((s,x)=>s+x.value_loss,0),550);
  assert.equal(report.top_items.reduce((s,x)=>s+x.value_loss,0),550);
  assert.equal(report.top_items[0].item,'Chicken');
  assert.equal(report.top_items[0].value_loss,450);
});

test('mixed measurement units are reported separately instead of producing a meaningless quantity total',()=>{
  const report=buildWasteAnalytics({adjustments:[
    {id:1,inventory_id:1,item:'Chicken',adjustment_kind:'waste',quantity_delta:-2,unit:'kg',estimated_value_delta:-300},
    {id:2,inventory_id:2,item:'Milk',adjustment_kind:'waste',quantity_delta:-3,unit:'L',estimated_value_delta:-150}
  ]});
  assert.deepEqual(report.summary.quantities_by_unit,[{unit:'L',quantity:3},{unit:'kg',quantity:2}]);
});

test('purchase and usage evidence is exposed without inventing a waste percentage',()=>{
  const report=buildWasteAnalytics({
    adjustments:[{id:1,inventory_id:1,item:'Chicken',adjustment_kind:'spoilage',quantity_delta:-2,unit:'kg',estimated_value_delta:-300}],
    purchases:[{inventory_id:1,base_unit:'kg',base_quantity:20,total_cost:3000,purchase_events:2}],
    usage:[{inventory_id:1,usage_quantity:10,usage_value:1500,usage_events:4}]
  });
  const item=report.top_items[0];
  assert.equal(item.comparison.purchase_evidence.status,'RECORDED_PURCHASES_PRESENT');
  assert.equal(item.comparison.purchase_evidence.value,3000);
  assert.equal(item.comparison.usage_evidence.status,'RECORDED_USAGE_PRESENT');
  assert.equal(item.comparison.usage_evidence.quantity,10);
  assert.equal(item.comparison.waste_rate_pct,null);
  assert.equal(item.comparison.waste_rate_status,'DENOMINATOR_COMPLETENESS_NOT_PROVEN');
  assert.equal(report.denominator_policy.waste_rate_pct,null);
});

test('drill-down preserves exact lot evidence',()=>{
  const report=buildWasteAnalytics({adjustments:[{
    id:9,inventory_id:1,item:'Chicken',inventory_type:'ingredient',
    adjustment_kind:'expired',quantity_delta:-1,unit:'kg',estimated_value_delta:-150,
    created_at:'2026-10-03T08:00:00Z',
    lot_allocations:[{lot_id:3,lot_code:'C-3',quantity_removed:1}]
  }]});
  assert.equal(report.details[0].id,9);
  assert.equal(report.details[0].lot_allocations[0].lot_code,'C-3');
});
