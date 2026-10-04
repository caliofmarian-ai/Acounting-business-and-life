import crypto from 'node:crypto';

const BASE32_ALPHABET='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_PERIOD_SECONDS=30;
const TOTP_DIGITS=6;

function clean(value,max=500){return String(value??'').trim().slice(0,max)}
function base64url(buffer){return Buffer.from(buffer).toString('base64url')}
function fromBase64url(value){return Buffer.from(String(value||''),'base64url')}
function normalizeBase32(value){return clean(value,256).replace(/[\s-]+/g,'').toUpperCase()}

export function base32Encode(input){
  const bytes=Buffer.from(input);
  let bits=0,value=0,out='';
  for(const byte of bytes){
    value=(value<<8)|byte;
    bits+=8;
    while(bits>=5){
      out+=BASE32_ALPHABET[(value>>>(bits-5))&31];
      bits-=5;
    }
  }
  if(bits>0)out+=BASE32_ALPHABET[(value<<(5-bits))&31];
  return out;
}

export function base32Decode(input){
  const value=normalizeBase32(input);
  if(!value||!/^[A-Z2-7]+$/.test(value))throw new Error('Invalid base32 value');
  let bits=0,acc=0;
  const bytes=[];
  for(const char of value){
    const index=BASE32_ALPHABET.indexOf(char);
    if(index<0)throw new Error('Invalid base32 value');
    acc=(acc<<5)|index;
    bits+=5;
    if(bits>=8){
      bytes.push((acc>>>(bits-8))&255);
      bits-=8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(bytes=20){
  const count=Math.max(20,Math.min(64,Number(bytes)||20));
  return base32Encode(crypto.randomBytes(count));
}

function hotp(secret,counter,digits=TOTP_DIGITS){
  const key=base32Decode(secret);
  const message=Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest=crypto.createHmac('sha1',key).update(message).digest();
  const offset=digest[digest.length-1]&0x0f;
  const binary=((digest[offset]&0x7f)<<24)|(digest[offset+1]<<16)|(digest[offset+2]<<8)|digest[offset+3];
  return String(binary%(10**digits)).padStart(digits,'0');
}

function safeTextEqual(a,b){
  const aa=Buffer.from(String(a)),bb=Buffer.from(String(b));
  return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb);
}

export function verifyTotpCode(secret,token,{
  now=Date.now(),window=1,period=TOTP_PERIOD_SECONDS,digits=TOTP_DIGITS,minCounter=-1
}={}){
  const code=clean(token,12);
  if(!new RegExp('^\\d{'+digits+'}$').test(code))return{ok:false,counter:null};
  const center=Math.floor(Number(now)/1000/period);
  for(let drift=-Math.abs(Number(window)||0);drift<=Math.abs(Number(window)||0);drift++){
    const counter=center+drift;
    if(counter<=Number(minCounter??-1)||counter<0)continue;
    if(safeTextEqual(hotp(secret,counter,digits),code))return{ok:true,counter};
  }
  return{ok:false,counter:null};
}

export function buildTotpUri({secret,accountLabel,issuer='Business & Life'}){
  const label=clean(accountLabel,180)||'Super Admin';
  const iss=clean(issuer,80)||'Business & Life';
  return 'otpauth://totp/'+encodeURIComponent(iss+':'+label)
    +'?secret='+encodeURIComponent(normalizeBase32(secret))
    +'&issuer='+encodeURIComponent(iss)
    +'&algorithm=SHA1&digits='+TOTP_DIGITS+'&period='+TOTP_PERIOD_SECONDS;
}

export function deriveMfaEncryptionKey(keyMaterial){
  const material=clean(keyMaterial,4096);
  if(material.length<16)throw new Error('MFA encryption key material is not configured');
  return crypto.createHash('sha256').update('business-life:super-admin-mfa:aes-gcm:v1\0').update(material).digest();
}

export function encryptMfaSecret(secret,keyMaterial){
  const key=deriveMfaEncryptionKey(keyMaterial);
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from('business-life:super-admin-mfa:v1'));
  const encrypted=Buffer.concat([cipher.update(normalizeBase32(secret),'utf8'),cipher.final()]);
  const tag=cipher.getAuthTag();
  return ['v1',base64url(iv),base64url(tag),base64url(encrypted)].join('.');
}

export function decryptMfaSecret(payload,keyMaterial){
  const [version,ivRaw,tagRaw,cipherRaw]=String(payload||'').split('.');
  if(version!=='v1'||!ivRaw||!tagRaw||!cipherRaw)throw new Error('Unsupported MFA secret envelope');
  const decipher=crypto.createDecipheriv('aes-256-gcm',deriveMfaEncryptionKey(keyMaterial),fromBase64url(ivRaw));
  decipher.setAAD(Buffer.from('business-life:super-admin-mfa:v1'));
  decipher.setAuthTag(fromBase64url(tagRaw));
  return normalizeBase32(Buffer.concat([decipher.update(fromBase64url(cipherRaw)),decipher.final()]).toString('utf8'));
}

export function normalizeRecoveryCode(value){
  return clean(value,80).replace(/[^A-Za-z0-9]/g,'').toUpperCase();
}

export function hashRecoveryCode(code,keyMaterial){
  const normalized=normalizeRecoveryCode(code);
  if(normalized.length<12)throw new Error('Invalid recovery code');
  const key=crypto.createHash('sha256').update('business-life:super-admin-mfa:recovery:v1\0').update(clean(keyMaterial,4096)).digest();
  return crypto.createHmac('sha256',key).update(normalized).digest('hex');
}

export function generateRecoveryCodes(count=10){
  const total=Math.max(6,Math.min(20,Number(count)||10));
  const codes=[];
  for(let i=0;i<total;i++){
    const raw=base32Encode(crypto.randomBytes(10)).slice(0,16);
    codes.push(raw.match(/.{1,4}/g).join('-'));
  }
  return codes;
}
