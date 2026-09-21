import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDiscoverySettings,normalizeRfq,quoteEconomics,compareQuotes,validatePreferenceRanks,reorderPackSuggestion
} from '../supplier-sourcing-core.js';

test('Supplier sourcing is private by default and categories are explicit',()=>{
  assert.deepEqual(normalizeDiscoverySettings(),{visibility:'private',accepts_rfqs:false,categories:[]});
  assert.deepEqual(normalizeDiscoverySettings({
    visibility:'directory',acceptsRfqs:true,categories:['Rice Grains','packaging','rice_grains']
  }),{visibility:'directory',accepts_rfqs:true,categories:['rice_grains','packaging']});
});

test('RFQ captures quantity and fulfilment without creating purchasing authority',()=>{
  const r=normalizeRfq({itemSpecification:'Rice',quantity:50,unit:'kg',fulfilmentMode:'delivery',targetBudget:2500});
  assert.equal(r.requested_quantity,50);
  assert.equal(r.requested_unit,'kg');
  assert.equal(r.fulfilment_mode,'delivery');
  assert.equal(r.target_budget,2500);
});

test('quote economics normalizes landed cost across compatible units',()=>{
  const x=quoteEconomics({
    quotedPacks:1,pricePerPack:2300,deliveryFee:100,baseUnitsPerPack:50,baseUnit:'kg',
    requestedQuantity:50000,requestedUnit:'g'
  });
  assert.equal(x.landed_total,2400);
  assert.equal(x.comparable,true);
  assert.equal(x.normalized_base_unit,'g');
  assert.equal(x.normalized_landed_cost,0.048);
  assert.equal(x.coverage_ratio,1);
});

test('incompatible quote units fail closed instead of inventing conversion',()=>{
  const x=quoteEconomics({
    quotedPacks:10,pricePerPack:100,baseUnitsPerPack:1,baseUnit:'piece',
    requestedQuantity:10,requestedUnit:'kg'
  });
  assert.equal(x.comparison_status,'NOT_COMPARABLE');
  assert.equal(x.normalized_landed_cost,null);
});

test('quote comparison only highlights factual minima and never auto-selects a supplier',()=>{
  const result=compareQuotes({
    rfq:{requested_quantity:10,requested_unit:'kg'},
    quotes:[
      {id:1,status:'active',quoted_packs:1,price_per_pack:550,delivery_fee:0,base_units_per_pack:10,base_unit:'kg',earliest_fulfilment_date:'2026-09-25'},
      {id:2,status:'active',quoted_packs:1,price_per_pack:500,delivery_fee:20,base_units_per_pack:10,base_unit:'kg',earliest_fulfilment_date:'2026-09-23'}
    ]
  });
  assert.equal(result.factual_highlights.lowest_normalized_landed_cost_quote_id,2);
  assert.equal(result.factual_highlights.earliest_fulfilment_quote_id,2);
  assert.equal(result.auto_selected_quote_id,null);
});

test('preferred sources require unique explicit ranks',()=>{
  assert.deepEqual(validatePreferenceRanks([
    {catalog_item_id:8,preference_rank:2},
    {catalog_item_id:7,preference_rank:1}
  ]).map(x=>x.catalog_item_id),[7,8]);
  assert.throws(()=>validatePreferenceRanks([
    {catalog_item_id:7,preference_rank:1},{catalog_item_id:8,preference_rank:1}
  ]),/Duplicate preference rank/);
});


test('reorder suggestion converts Inventory and Supplier pack units before calculating packs',()=>{
  assert.deepEqual(reorderPackSuggestion({
    quantity:10000,reorderLevel:50000,inventoryUnit:'g',
    baseUnitsPerPack:10,supplierBaseUnit:'kg',minimumPacks:1
  }),{status:'COMPARABLE',suggested_packs:4});
  assert.deepEqual(reorderPackSuggestion({
    quantity:0,reorderLevel:10,inventoryUnit:'kg',
    baseUnitsPerPack:1,supplierBaseUnit:'piece',minimumPacks:1
  }),{status:'NOT_COMPARABLE',suggested_packs:null});
});
