import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FOOD_ALLERGENS,
  normalizeAllergenCodes,
  deriveAllergenEvidence,
  allergenPublicProjection
} from '../food-allergen-core.js';

test('canonical food allergen catalog uses stable codes without duplicates',()=>{
  const codes=FOOD_ALLERGENS.map(x=>x.code);
  assert.ok(codes.length>=9);
  assert.equal(new Set(codes).size,codes.length);
  for(const code of ['wheat','crustaceans','egg','fish','peanut','soy','milk','sulphites']){
    assert.ok(codes.includes(code),code);
  }
});

test('unsupported allergen codes are never accepted by normalizer',()=>{
  assert.deepEqual(normalizeAllergenCodes(['soy','made_up','soy','milk']),['milk','soy']);
});

test('Contains evidence takes precedence over May contain for the same allergen',()=>{
  const result=deriveAllergenEvidence({
    ingredientEvidence:[
      {allergen_code:'soy',evidence_kind:'may_contain'},
      {allergen_code:'soy',evidence_kind:'contains'},
      {allergen_code:'milk',evidence_kind:'may_contain'}
    ]
  });
  assert.deepEqual(result.contains,['soy']);
  assert.deepEqual(result.may_contain,['milk']);
});

test('cross-contact is a separate manual risk and does not duplicate Contains',()=>{
  const result=deriveAllergenEvidence({
    ingredientEvidence:[{allergen_code:'egg',evidence_kind:'contains'}],
    crossContact:['egg','crustaceans']
  });
  assert.deepEqual(result.contains,['egg']);
  assert.deepEqual(result.cross_contact,['crustaceans']);
});

test('allergens are never inferred from product or ingredient names',()=>{
  const result=deriveAllergenEvidence({
    ingredientEvidence:[],
    crossContact:[],
    productName:'Peanut butter with milk and egg',
    ingredientName:'Soy sauce'
  });
  assert.deepEqual(result,{contains:[],may_contain:[],cross_contact:[]});
});

test('public projection uses evidence labels and keeps a cautious Merchant-evidence notice',()=>{
  const projection=allergenPublicProjection({
    contains:['soy','wheat'],
    may_contain:['milk'],
    cross_contact:['crustaceans']
  });
  assert.deepEqual(projection.contains.map(x=>x.code),['soy','wheat']);
  assert.deepEqual(projection.may_contain.map(x=>x.code),['milk']);
  assert.deepEqual(projection.cross_contact.map(x=>x.code),['crustaceans']);
  assert.equal(projection.declaration_basis,'merchant_declared_ingredient_and_kitchen_evidence');
  assert.match(projection.notice,/Merchant-declared ingredient and kitchen evidence/);
  assert.match(projection.notice,/contact the Merchant before ordering/i);
});
