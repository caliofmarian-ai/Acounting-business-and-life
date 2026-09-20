import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUPPLIER_ACTIVITY_CODES,
  PRODUCT_HANDLING_MODES,
  normalizeSupplierActivities,
  normalizeHandlingMode,
  normalizePackageDefinition,
  breakPackUnits,
  normalizePriceTiers,
  priceForQuantity,
  computeRepackPlan,
  inheritedExpiry,
  supplierRelationshipKind
} from '../supplier-domain-core.js';

test('Supplier V2 separates business activities from Supplier relationship role',()=>{
  assert.ok(SUPPLIER_ACTIVITY_CODES.includes('wholesaler'));
  assert.ok(SUPPLIER_ACTIVITY_CODES.includes('retailer'));
  assert.ok(SUPPLIER_ACTIVITY_CODES.includes('repacker'));
  assert.deepEqual(
    normalizeSupplierActivities(['Wholesaler','retailer','wholesaler']),
    ['wholesaler','retailer']
  );
  assert.throws(()=>normalizeSupplierActivities(['supplier']),/Unsupported supplier activity/);
});

test('handling modes distinguish sealed resale, break-pack and actual repacking',()=>{
  assert.deepEqual(PRODUCT_HANDLING_MODES,[
    'sealed_resale','break_pack','bulk','repacked','produced'
  ]);
  assert.equal(normalizeHandlingMode('break-pack'),'break_pack');
  assert.equal(normalizeHandlingMode(''),'sealed_resale');
  assert.throws(()=>normalizeHandlingMode('open_case_is_repacked'),/Unsupported product handling mode/);
});

test('package hierarchy supports case-to-unit and sack-to-base conversions',()=>{
  assert.deepEqual(
    normalizePackageDefinition({outerUnit:'case',innerUnit:'bottle',innerQuantity:24}),
    {outer_unit:'case',inner_unit:'bottle',inner_quantity:24}
  );
  assert.equal(breakPackUnits({outerPacks:5,innerUnitsPerPack:24}),120);
  assert.equal(breakPackUnits({outerPacks:2,innerUnitsPerPack:50}),100);
});

test('tiered B2B pricing selects the highest qualifying threshold deterministically',()=>{
  const tiers=normalizePriceTiers([
    {minimum_quantity:100,price_per_pack:24,label:'100+'},
    {minimum_quantity:6,price_per_pack:28,label:'6+'},
    {minimum_quantity:25,price_per_pack:26,label:'25+'}
  ]);
  assert.deepEqual(tiers.map(x=>x.minimum_quantity),[6,25,100]);
  assert.equal(priceForQuantity({basePrice:30,quantity:1,tiers}).price_per_pack,30);
  assert.equal(priceForQuantity({basePrice:30,quantity:24,tiers}).price_per_pack,28);
  assert.equal(priceForQuantity({basePrice:30,quantity:25,tiers}).price_per_pack,26);
  assert.equal(priceForQuantity({basePrice:30,quantity:120,tiers}).price_per_pack,24);
});

test('repack plan conserves quantity and allocates product plus packaging cost to outputs',()=>{
  const result=computeRepackPlan({
    inputQuantity:50,
    packageSize:1,
    outputPackages:49,
    wasteQuantity:1,
    inputUnitCost:46,
    packagingCostPerOutput:2
  });
  assert.equal(result.packed_quantity,49);
  assert.equal(result.input_cost,2300);
  assert.equal(result.packaging_cost,98);
  assert.equal(result.total_output_cost,2398);
  assert.equal(result.cost_per_output_package,2398/49);
  assert.ok(Math.abs(result.conservation_delta)<1e-9);
  assert.throws(()=>computeRepackPlan({
    inputQuantity:50,packageSize:1,outputPackages:48,wasteQuantity:1
  }),/conserve input quantity/);
});

test('child lot cannot inherit an expiry later than its earliest source lot',()=>{
  assert.equal(
    inheritedExpiry(['2026-12-31T00:00:00Z','2026-11-30T00:00:00Z']),
    '2026-11-30T00:00:00.000Z'
  );
  assert.equal(inheritedExpiry([]),null);
});

test('external and connected suppliers remain distinct relationship sources',()=>{
  assert.equal(supplierRelationshipKind({connectedAccountId:7}),'connected');
  assert.equal(supplierRelationshipKind({externalSupplierId:9}),'external');
  assert.throws(()=>supplierRelationshipKind({}),/Exactly one/);
  assert.throws(()=>supplierRelationshipKind({connectedAccountId:7,externalSupplierId:9}),/Exactly one/);
});
