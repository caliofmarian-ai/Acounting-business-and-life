import test from 'node:test';
import assert from 'node:assert/strict';
import { profilePublicId, withPublicProfileIds } from '../person-profile-identity.js';

test('profile IDs visibly derive from the immutable country-aware Personal ID',()=>{
  const personal='BL-PH-P-8F4K2M9Q';
  assert.equal(profilePublicId(personal,'customer'),personal+'-CU');
  assert.equal(profilePublicId(personal,'merchant'),personal+'-ME');
  assert.equal(profilePublicId(personal,'supplier'),personal+'-SU');
  assert.equal(profilePublicId(personal,'courier'),personal+'-DE');
  assert.equal(profilePublicId(personal,'service_provider'),personal+'-LS');
  assert.equal(profilePublicId(personal,'admin'),personal+'-AD');
});

test('identity response exposes issuing country and derived IDs without an IP address',()=>{
  const result=withPublicProfileIds({account:{personal_public_id:'BL-RO-P-A1B2C3D4',identity_country_code:'RO'},profiles:[{role:'merchant',enabled:true}]});
  assert.equal(result.account.country_code,'RO');
  assert.equal(result.account.personal_id,'BL-RO-P-A1B2C3D4');
  assert.equal(result.account.admin_profile_id,'BL-RO-P-A1B2C3D4-AD');
  assert.equal(result.profiles[0].profile_id,'BL-RO-P-A1B2C3D4-ME');
  assert.equal('ip' in result.account,false);
});
