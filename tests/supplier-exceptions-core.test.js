import test from 'node:test';
import assert from 'node:assert/strict';
import {
  unconfirmedPacks,validateBackorderProposal,validateSubstitutionProposal,
  exceptionStateAfterMerchantDecision,backorderFulfilmentDelta
} from '../supplier-exceptions-core.js';

test('unconfirmed packs never become negative',()=>{
  assert.equal(unconfirmedPacks({orderedPacks:10,confirmedPacks:6}),4);
  assert.equal(unconfirmedPacks({orderedPacks:10,confirmedPacks:10}),0);
  assert.equal(unconfirmedPacks({orderedPacks:10,confirmedPacks:12}),0);
});

test('backorder may cover only the unconfirmed remainder',()=>{
  assert.deepEqual(validateBackorderProposal({
    orderedPacks:10,confirmedPacks:6,proposedPacks:4
  }),{proposed_packs:4,unconfirmed_remainder:4});
  assert.throws(()=>validateBackorderProposal({
    orderedPacks:10,confirmedPacks:6,proposedPacks:5
  }),/exceeds unconfirmed remainder/);
});

test('substitution may cover only the unconfirmed remainder and keeps explicit price',()=>{
  assert.deepEqual(validateSubstitutionProposal({
    orderedPacks:10,confirmedPacks:7,proposedPacks:3,pricePerPack:125.555
  }),{proposed_packs:3,price_per_pack:125.56,unconfirmed_remainder:3});
});

test('Merchant decision is explicit and only applies to proposed exceptions',()=>{
  assert.equal(exceptionStateAfterMerchantDecision({currentState:'proposed',accept:true}),'merchant_accepted');
  assert.equal(exceptionStateAfterMerchantDecision({currentState:'proposed',accept:false}),'merchant_declined');
  assert.throws(()=>exceptionStateAfterMerchantDecision({currentState:'merchant_accepted',accept:false}),/Only a proposed/);
});

test('backorder fulfilment can change confirmed packs only after Merchant acceptance',()=>{
  assert.deepEqual(backorderFulfilmentDelta({
    state:'merchant_accepted',orderedPacks:10,confirmedPacks:6,proposedPacks:4
  }),{add_confirmed_packs:4,new_confirmed_packs:10,ordered_packs:10});
  assert.throws(()=>backorderFulfilmentDelta({
    state:'proposed',orderedPacks:10,confirmedPacks:6,proposedPacks:4
  }),/Merchant-accepted/);
});
