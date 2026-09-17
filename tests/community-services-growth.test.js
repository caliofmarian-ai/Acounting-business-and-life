import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const campaign=JSON.parse(readFileSync(new URL('../growth/community-services.en-PH.json',import.meta.url),'utf8'));
const html=readFileSync(new URL('../public/referral/local-services.html',import.meta.url),'utf8');

test('Local Services campaign has customer and provider entry paths',()=>{
  assert.equal(campaign.dualEntry.customer.intent,'find_local_tradesperson');
  assert.equal(campaign.dualEntry.provider.intent,'promote_my_services');
  assert.match(html,/Find a local tradesperson/);
  assert.match(html,/Promote my services/);
});

test('beginner path is supported only for unrestricted eligible tasks',()=>{
  assert.match(campaign.experienceFirst.body,/unrestricted tasks/i);
  assert.match(campaign.experienceFirst.restriction,/Credential-gated or regulated categories remain unavailable/i);
  assert.equal(campaign.claims.automaticRestrictedCategoryAccess,false);
  assert.match(html,/You can start before you have a long work history/);
});

test('campaign forbids guaranteed work income and fake verification',()=>{
  const forbidden=campaign.experienceFirst.prohibitedPhrases.join(' ');
  assert.match(forbidden,/Guaranteed work/);
  assert.match(forbidden,/Guaranteed income/);
  assert.match(forbidden,/Verified professional without verification/);
  assert.equal(campaign.claims.guaranteedJobs,false);
  assert.equal(campaign.claims.guaranteedIncome,false);
});

test('public preview exposes current service workflow concepts',()=>{
  for(const phrase of ['Send a request','quote','schedule','Confirm completion','verified feedback']){
    assert.match(html,new RegExp(phrase,'i'));
  }
});

test('Local Services referral keeps operational approval separate',()=>{
  assert.match(html,/Referral attribution never grants Service Provider approval or category authorization/i);
});
