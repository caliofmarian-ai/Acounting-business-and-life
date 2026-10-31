/**
 * Merchant Voice #863: intentionally narrow WebAuthn ES256 verifier.
 * Registration accepts ONLY 'none' attestation with a P-256/ES256 COSE key.
 * Assertions require both user presence and on-device user verification.
 * No passkey is used as an account sign-in credential; it approves an already
 * password-step-upped Merchant action scoped to an immutable server quote.
 */
import crypto from 'node:crypto';

export const passkeyError=(message,code='VOICE_PASSKEY_INVALID',status=403)=>
  Object.assign(new Error(message),{status,code});
const bad=()=>{throw passkeyError('Device confirmation failed. Try again or use manual Orders.')};
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest();
const enc=bytes=>Buffer.from(bytes).toString('base64url');
const safeEqual=(a,b)=>a.length===b.length&&crypto.timingSafeEqual(a,b);

export function strictBase64Url(value,{maxBytes=8192,minBytes=1}={}){
  if(typeof value!=='string'||value.length<2||value.length>Math.ceil(maxBytes*4/3)+4||
    !/^[A-Za-z0-9_-]+$/.test(value))bad();
  let bytes;
  try{bytes=Buffer.from(value,'base64url')}catch{bad()}
  if(bytes.length<minBytes||bytes.length>maxBytes||enc(bytes)!==value)bad();
  return bytes;
}

/** Bounded CBOR reader: definite-length ints, strings, byte strings, arrays and maps. */
export function decodeWebauthnCbor(bytes,{start=0,maxDepth=10}={}){
  const input=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes||[]);
  if(input.length>8192||!Number.isSafeInteger(start)||start<0||start>=input.length)bad();
  let cursor=start,entries=0;
  const need=n=>{if(cursor+n>input.length)bad()};
  const uint=n=>{need(n);let value=0;for(let j=0;j<n;j++)value=value*256+input[cursor++];if(!Number.isSafeInteger(value))bad();return value};
  function value(depth){
    if(depth>maxDepth||++entries>600)bad();
    need(1);const initial=input[cursor++],major=initial>>5,info=initial&31;
    let count;
    if(info<24)count=info;
    else if(info===24)count=uint(1);
    else if(info===25)count=uint(2);
    else if(info===26)count=uint(4);
    else if(info===27)count=uint(8);
    else bad(); // no indefinite values, tagged values, floating or simple values
    if(major===0)return count;
    if(major===1)return -1-count;
    if(count>8192)bad();
    if(major===2){need(count);const b=input.subarray(cursor,cursor+count);cursor+=count;return b}
    if(major===3){need(count);const b=input.subarray(cursor,cursor+count);cursor+=count;
      const decoder=new TextDecoder('utf-8',{fatal:true});try{return decoder.decode(b)}catch{bad()}}
    if(major===4){if(count>200)bad();return Array.from({length:count},()=>value(depth+1))}
    if(major===5){if(count>200)bad();const m=new Map();for(let k=0;k<count;k++){
      const key=value(depth+1);if(typeof key!=='string'&&typeof key!=='number')bad();
      if(m.has(key))bad();m.set(key,value(depth+1));}return m;}
    bad();
  }
  const result=value(0);
  return {value:result,end:cursor};
}

function clientJSON(encoded,{type,origin,challengeHash}){
  const raw=strictBase64Url(encoded,{maxBytes:4096,minBytes:25});
  let parsed;
  try{parsed=JSON.parse(raw.toString('utf8'))}catch{bad()}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||parsed.type!==type||
     parsed.origin!==origin||parsed.crossOrigin===true||typeof parsed.challenge!=='string')bad();
  const challenge=strictBase64Url(parsed.challenge,{minBytes:32,maxBytes:64});
  const stored=strictBase64Url(challengeHash,{minBytes:32,maxBytes:32});
  if(!safeEqual(sha256(challenge),stored))bad();
  return raw;
}

export function parseAuthenticatorData(data,{rpId,attested=false}={}){
  if(!/^[a-z0-9.-]{1,253}$/i.test(String(rpId||'')))bad();
  const raw=Buffer.isBuffer(data)?data:strictBase64Url(data,{minBytes:37,maxBytes:4096});
  if(raw.length<37||!safeEqual(raw.subarray(0,32),sha256(Buffer.from(rpId))))bad();
  const flags=raw[32];
  // UP, UV, RFU bits, backup-state/eligibility invariants.
  if(!(flags&0x01)||!(flags&0x04)||(flags&0x22)||((flags&0x10)&&!(flags&0x08)))bad();
  const signCount=raw.readUInt32BE(33);
  let key=null,credentialId=null,offset=37;
  if(attested){
    if(!(flags&0x40)||raw.length<55)bad();
    offset+=16; // AAGUID
    const len=raw.readUInt16BE(offset);offset+=2;
    if(len<16||len>1024||raw.length-offset<len)bad();
    credentialId=raw.subarray(offset,offset+len);offset+=len;
    const cbor=decodeWebauthnCbor(raw,{start:offset});offset=cbor.end;
    const cose=cbor.value;
    if(!(cose instanceof Map)||cose.size!==5||cose.get(1)!==2||cose.get(3)!==-7||cose.get(-1)!==1||
       !Buffer.isBuffer(cose.get(-2))||cose.get(-2).length!==32||
       !Buffer.isBuffer(cose.get(-3))||cose.get(-3).length!==32)bad();
    try{
      key=crypto.createPublicKey({format:'jwk',key:{kty:'EC',crv:'P-256',x:enc(cose.get(-2)),y:enc(cose.get(-3))}});
      if(key.asymmetricKeyType!=='ec'||key.asymmetricKeyDetails?.namedCurve!=='prime256v1')bad();
    }catch{bad()}
  }else if(flags&0x40){bad()} // Assertions never contain attested key material.
  if(flags&0x80){const ext=decodeWebauthnCbor(raw,{start:offset});if(!(ext.value instanceof Map))bad();offset=ext.end}
  if(offset!==raw.length)bad();
  return {flags,signCount,credentialId,key,backupEligible:Boolean(flags&0x08),backupState:Boolean(flags&0x10)};
}

export function verifyPasskeyRegistration({credential,challengeHash,origin,rpId}={}){
  if(!credential||credential.type!=='public-key')bad();
  const rawId=strictBase64Url(credential.rawId,{minBytes:16,maxBytes:1024});
  const clientData=clientJSON(credential.response?.clientDataJSON,{type:'webauthn.create',origin,challengeHash});
  if(clientData.length<30)bad();
  const attestation=strictBase64Url(credential.response?.attestationObject,{minBytes:80,maxBytes:8192});
  const obj=decodeWebauthnCbor(attestation);
  if(obj.end!==attestation.length||!(obj.value instanceof Map)||obj.value.size!==3||
     obj.value.get('fmt')!=='none'||!(obj.value.get('attStmt') instanceof Map)||obj.value.get('attStmt').size!==0||
     !Buffer.isBuffer(obj.value.get('authData')))bad();
  const parsed=parseAuthenticatorData(obj.value.get('authData'),{rpId,attested:true});
  if(!safeEqual(rawId,parsed.credentialId))bad();
  return {credentialId:enc(rawId),publicKeyPem:parsed.key.export({format:'pem',type:'spki'}),
    signCount:parsed.signCount,backupEligible:parsed.backupEligible};
}

export function verifyPasskeyAssertion({credential,credentialRecord,challengeHash,origin,rpId}={}){
  if(!credential||credential.type!=='public-key'||!credentialRecord||
     credential.id!==credentialRecord.credential_id)bad();
  const id=enc(strictBase64Url(credential.rawId,{minBytes:16,maxBytes:1024}));
  if(id!==credentialRecord.credential_id)bad();
  const clientData=clientJSON(credential.response?.clientDataJSON,{type:'webauthn.get',origin,challengeHash});
  const rawData=strictBase64Url(credential.response?.authenticatorData,{minBytes:37,maxBytes:4096});
  const parsed=parseAuthenticatorData(rawData,{rpId,attested:false});
  const signature=strictBase64Url(credential.response?.signature,{minBytes:48,maxBytes:160});
  let key;
  try{key=crypto.createPublicKey(credentialRecord.public_key_pem);
    if(key.asymmetricKeyType!=='ec'||key.asymmetricKeyDetails?.namedCurve!=='prime256v1')bad();
  }catch{bad()}
  if(!crypto.verify('sha256',Buffer.concat([rawData,sha256(clientData)]),key,signature))bad();
  if(Boolean(credentialRecord.backup_eligible)!==parsed.backupEligible)bad();
  const prior=Number(credentialRecord.sign_count||0);
  if(!Number.isSafeInteger(prior)||prior<0)bad();
  if((prior>0||parsed.signCount>0)&&parsed.signCount<=prior)bad();
  return {credentialId:id,signCount:parsed.signCount,backupEligible:parsed.backupEligible};
}

export function passkeyConfig(env=process.env){
  const rpId=String(env.ORDER_VOICE_WEBAUTHN_RP_ID||'').trim().toLowerCase();
  const origin=String(env.ORDER_VOICE_WEBAUTHN_ORIGIN||'').trim();
  let ok=false;
  try{
    const url=new URL(origin);
    ok=rpId.length>0&&url.origin===origin&&url.protocol==='https:'&&
      (url.hostname===rpId||url.hostname.endsWith('.'+rpId))&&rpId.includes('.')&&
      !/\s/.test(rpId)&&url.port===''&&url.username===''&&url.password==='';
  }catch{}
  return {ready:env.ORDER_VOICE_WEBAUTHN_ENABLED==='1'&&ok,rpId,origin};
}

export const passkeyBase64Url=enc;
export const passkeySha256=sha256;