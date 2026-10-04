import test from 'node:test';
import assert from 'node:assert/strict';
import {
  base32Decode,base32Encode,buildTotpUri,decryptMfaSecret,encryptMfaSecret,
  generateRecoveryCodes,generateTotpSecret,hashRecoveryCode,verifyTotpCode
} from '../super-admin-mfa-core.js';

test('base32 round-trip is stable',()=>{
  const input=Buffer.from('Business & Life MFA');
  assert.deepEqual(base32Decode(base32Encode(input)),input);
});

test('AES-GCM envelope decrypts only with the configured key material',()=>{
  const secret=generateTotpSecret();
  const key='qa-mfa-encryption-key-material-1234567890';
  const envelope=encryptMfaSecret(secret,key);
  assert.equal(decryptMfaSecret(envelope,key),secret);
  assert.throws(()=>decryptMfaSecret(envelope,key+'-wrong'));
  assert.doesNotMatch(envelope,new RegExp(secret));
});

test('RFC 6238 SHA1 vector verifies and anti-replay counter is enforced',()=>{
  const secret=base32Encode(Buffer.from('12345678901234567890'));
  const at=59_000;
  const verified=verifyTotpCode(secret,'287082',{now:at,window:0,digits:6});
  assert.equal(verified.ok,true);
  assert.equal(verified.counter,1);
  assert.equal(verifyTotpCode(secret,'287082',{now:at,window:0,digits:6,minCounter:1}).ok,false);
});

test('recovery material is random and stored only as keyed hashes',()=>{
  const codes=generateRecoveryCodes(10);
  assert.equal(codes.length,10);
  assert.equal(new Set(codes).size,10);
  for(const code of codes)assert.match(code,/^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){3}$/);
  const key='qa-recovery-key-material-1234567890';
  const hash=hashRecoveryCode(codes[0],key);
  assert.match(hash,/^[a-f0-9]{64}$/);
  assert.doesNotMatch(hash,new RegExp(codes[0].replaceAll('-','')));
});

test('otpauth URI is standards-compatible without changing the secret',()=>{
  const secret=generateTotpSecret();
  const uri=buildTotpUri({secret,accountLabel:'owner@example.com'});
  assert.match(uri,/^otpauth:\/\/totp\//);
  assert.match(uri,/algorithm=SHA1/);
  assert.match(uri,/digits=6/);
  assert.match(uri,/period=30/);
  assert.equal(new URL(uri).searchParams.get('secret'),secret);
});
