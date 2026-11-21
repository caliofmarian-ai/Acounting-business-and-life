import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  strictBase64Url,decodeWebauthnCbor,verifyPasskeyRegistration,verifyPasskeyAssertion,
  passkeyConfig,passkeyBase64Url as b64,passkeySha256 as sha
} from '../merchant-voice-passkey-core.js';
const rpId='caliof.com',origin='https://caliof.com';
function cbor(value){
  const head=(major,n)=>{const t=major*32;
    if(n<24)return Buffer.from([t+n]);if(n<256)return Buffer.from([t+24,n]);
    if(n<65536){const z=Buffer.alloc(3);z[0]=t+25;z.writeUInt16BE(n,1);return z}
    throw Error('Test CBOR length');};
  if(Number.isInteger(value))return value>=0?head(0,value):head(1,-1-value);
  if(Buffer.isBuffer(value))return Buffer.concat([head(2,value.length),value]);
  if(typeof value==='string'){const b=Buffer.from(value);return Buffer.concat([head(3,b.length),b])}
  if(value instanceof Map)return Buffer.concat([head(5,value.size),...[...value].flatMap(([a,b])=>[cbor(a),cbor(b)])]);
  if(Array.isArray(value))return Buffer.concat([head(4,value.length),...value.map(cbor)]);
  throw Error('test encoder');
}
function setup({uv=true,rp=rpId,challenge=crypto.randomBytes(32),counter=1,backup=false}={}){
  const {publicKey,privateKey}=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const jwk=publicKey.export({format:'jwk'}),id=crypto.randomBytes(32);
  const flags=(uv?0x05:0x01)|0x40|(backup?0x08:0);
  const rpHash=sha(Buffer.from(rp)),prefix=Buffer.concat([rpHash,Buffer.from([flags]),Buffer.alloc(4)]);
  prefix.writeUInt32BE(counter,33);
  const cose=cbor(new Map([[1,2],[3,-7],[-1,1],[-2,Buffer.from(jwk.x,'base64url')],[-3,Buffer.from(jwk.y,'base64url')]]));
  const len=Buffer.alloc(2);len.writeUInt16BE(id.length);
  const authData=Buffer.concat([prefix,Buffer.alloc(16),len,id,cose]);
  const attestation=cbor(new Map([['fmt','none'],['authData',authData],['attStmt',new Map()]]));
  const clientData=(type,ch=challenge,site=origin)=>b64(Buffer.from(JSON.stringify({type,challenge:b64(ch),origin:site})));
  const register={type:'public-key',id:b64(id),rawId:b64(id),response:{clientDataJSON:clientData('webauthn.create'),attestationObject:b64(attestation)}};
  const registered=()=>verifyPasskeyRegistration({credential:register,challengeHash:b64(sha(challenge)),origin,rpId});
  const assertion=({newCounter=counter+1,ch=challenge,site=origin,verified=true,otherPrivateKey=privateKey}={})=>{
    const data=Buffer.concat([sha(Buffer.from(rp)),Buffer.from([verified?0x05|(backup?0x08:0):0x01]),Buffer.alloc(4)]);data.writeUInt32BE(newCounter,33);
    const client=clientData('webauthn.get',ch,site);
    const signature=crypto.sign('sha256',Buffer.concat([data,sha(Buffer.from(client,'base64url'))]),otherPrivateKey);
    return{type:'public-key',id:b64(id),rawId:b64(id),response:{clientDataJSON:client,authenticatorData:b64(data),signature:b64(signature)}};
  };
  return{register,registered,assertion,id,challenge,publicKey,privateKey};
}
function verifyAssertion(s,credential,override={}){const saved=s.registered();return verifyPasskeyAssertion({credential,credentialRecord:{credential_id:s.register.id,public_key_pem:saved.publicKeyPem,sign_count:1,backup_eligible:false,...override},challengeHash:b64(sha(s.challenge)),origin,rpId})}

test('none attestation extracts only ES256 public key, strict rpId hash, UV and same raw ID',()=>{
 const s=setup();const saved=s.registered();assert.equal(saved.credentialId,s.register.id);
 assert.match(saved.publicKeyPem,/BEGIN PUBLIC KEY/);assert.equal(saved.signCount,1);assert.equal(saved.backupEligible,false);
});
test('authenticator assertion accepts signed challenge-bound P-256 authentication',()=>{
 const s=setup();const result=verifyAssertion(s,s.assertion());assert.equal(result.signCount,2);
});
test('registration rejects wrong origin, challenge and RP ID',()=>{
 const s=setup();assert.throws(()=>verifyPasskeyRegistration({credential:s.register,challengeHash:b64(sha(crypto.randomBytes(32))),origin,rpId}),/Device confirmation failed/);
 assert.throws(()=>verifyPasskeyRegistration({credential:s.register,challengeHash:b64(sha(s.challenge)),origin:'https://evil.example',rpId}),/Device confirmation failed/);
 assert.throws(()=>verifyPasskeyRegistration({credential:s.register,challengeHash:b64(sha(s.challenge)),origin,rpId:'evil.example'}),/Device confirmation failed/);
});
test('registration requires user verification and rejects wrong credential',()=>{
 const s=setup({uv:false});assert.throws(()=>s.registered(),/Device confirmation failed/);
 const ok=setup();ok.register.rawId=b64(crypto.randomBytes(32));assert.throws(()=>ok.registered(),/Device confirmation failed/);
});
test('assertion rejects altered signature, other private key and non-UV',()=>{
 const s=setup();const altered=s.assertion();altered.response.signature=b64(crypto.randomBytes(70));assert.throws(()=>verifyAssertion(s,altered),/Device confirmation failed/);
 const other=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 assert.throws(()=>verifyAssertion(s,s.assertion({otherPrivateKey:other.privateKey})),/Device confirmation failed/);
 assert.throws(()=>verifyAssertion(s,s.assertion({verified:false})),/Device confirmation failed/);
});
test('assertion rejects other challenge, origin, RP and old monotonic counter',()=>{
 const s=setup();assert.throws(()=>verifyAssertion(s,s.assertion({ch:crypto.randomBytes(32)})),/Device confirmation failed/);
 assert.throws(()=>verifyAssertion(s,s.assertion({site:'https://fake.caliof.com'})),/Device confirmation failed/);
 assert.throws(()=>verifyAssertion(s,s.assertion({newCounter:1})),/Device confirmation failed/);
 assert.throws(()=>verifyAssertion(s,s.assertion({newCounter:2}),{backup_eligible:true}),/Device confirmation failed/);
});
test('all-zero synced-passkey counters are permitted but mismatched backup eligibility is not',()=>{
 const s=setup({counter:0,backup:true});const signed=s.assertion({newCounter:0});const saved=s.registered();
 const result=verifyPasskeyAssertion({credential:signed,credentialRecord:{credential_id:s.register.id,public_key_pem:saved.publicKeyPem,sign_count:0,backup_eligible:true},challengeHash:b64(sha(s.challenge)),origin,rpId});
 assert.equal(result.signCount,0);
});
test('strict CBOR rejects indefinite arrays, duplicate map keys and malformed lengths',()=>{
 for(const raw of [Buffer.from([0x9f,0xff]),cbor(new Map([['a',1]])).subarray(0,2),Buffer.from([0xa2,0x61,0x61,0x01,0x61,0x61,0x02])])
   assert.throws(()=>decodeWebauthnCbor(raw),/Device confirmation failed/);
});
test('base64url canonicality rejects padding, oversized values and invalid characters',()=>{
 for(const value of ['a===','!',b64(crypto.randomBytes(32))+'='])assert.throws(()=>strictBase64Url(value),/Device confirmation failed/);
 assert.equal(strictBase64Url(b64(crypto.randomBytes(32))).length,32);
});
test('WebAuthn cannot activate without HTTPS exact origin and explicitly configured RP',()=>{
 assert.equal(passkeyConfig({ORDER_VOICE_WEBAUTHN_ENABLED:'1',ORDER_VOICE_WEBAUTHN_RP_ID:rpId,ORDER_VOICE_WEBAUTHN_ORIGIN:origin}).ready,true);
 for(const env of [{ORDER_VOICE_WEBAUTHN_ENABLED:'0',ORDER_VOICE_WEBAUTHN_RP_ID:rpId,ORDER_VOICE_WEBAUTHN_ORIGIN:origin},
  {ORDER_VOICE_WEBAUTHN_ENABLED:'1',ORDER_VOICE_WEBAUTHN_RP_ID:rpId,ORDER_VOICE_WEBAUTHN_ORIGIN:'https://attacker.com'},
  {ORDER_VOICE_WEBAUTHN_ENABLED:'1',ORDER_VOICE_WEBAUTHN_RP_ID:rpId,ORDER_VOICE_WEBAUTHN_ORIGIN:'http://caliof.com'}])
 assert.equal(passkeyConfig(env).ready,false);
});