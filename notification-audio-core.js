import crypto from 'node:crypto';
import { isNotificationSoundSlot,normalizeNotificationSoundVariant } from './notification-sound-options.js';

const AUDIO_LEAF_BY_SLOT=new Map([
  ['merchant.new_order','merchant'],
  ['courier.new_delivery','courier'],
  ['finance.payment_received','finance'],
  ['general.info','info'],
  ['general.success','success'],
  ['general.action','action'],
  ['general.urgent','urgent'],
  ['general.warning','warning'],
  ['merchant.action','action'],
  ['courier.action','action'],
  ['supplier.action','action'],
  ['service.action','action']
]);

const awsEncode=value=>encodeURIComponent(String(value)).replace(/[!'()*]/g,ch=>'%'+ch.charCodeAt(0).toString(16).toUpperCase());
const hmac=(key,value)=>crypto.createHmac('sha256',key).update(value).digest();
const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');

function audioConfig(env=process.env){
  const config={
    bucket:String(env.NOTIFICATION_AUDIO_BUCKET||'').trim(),
    endpoint:String(env.NOTIFICATION_AUDIO_ENDPOINT||'').trim(),
    accessKeyId:String(env.NOTIFICATION_AUDIO_ACCESS_KEY_ID||'').trim(),
    secretAccessKey:String(env.NOTIFICATION_AUDIO_SECRET_ACCESS_KEY||'').trim(),
    region:String(env.NOTIFICATION_AUDIO_REGION||'auto').trim()||'auto'
  };
  if(!config.bucket||!config.endpoint||!config.accessKeyId||!config.secretAccessKey){
    throw Object.assign(new Error('Notification audio storage is not configured'),{status:503});
  }
  return config;
}

export function notificationAudioDescriptor({soundSlot,variant,locale='en-PH'}={}){
  const slot=String(soundSlot||'').trim();
  if(!isNotificationSoundSlot(slot))throw Object.assign(new Error('Unknown notification sound slot'),{status:400});
  const normalizedVariant=normalizeNotificationSoundVariant(variant);
  const leaf=AUDIO_LEAF_BY_SLOT.get(slot);
  if(!leaf)throw Object.assign(new Error('Notification sound slot has no audio asset'),{status:404});
  const requestedLocale=/^fil(-|$)/i.test(String(locale||''))?'fil-PH':'en-PH';
  const audioLocale='en-PH';
  return{
    sound_slot:slot,
    variant:normalizedVariant,
    requested_locale:requestedLocale,
    audio_locale:audioLocale,
    locale_fallback:requestedLocale!==audioLocale,
    key:`notifications/${audioLocale}/set${normalizedVariant}/${leaf}.mp3`
  };
}

export function presignNotificationAudioUrl({key,expiresIn=900,now=new Date(),env=process.env}={}){
  const objectKey=String(key||'').replace(/^\/+/, '');
  if(!objectKey)throw Object.assign(new Error('Notification audio key required'),{status:400});
  const seconds=Math.max(60,Math.min(3600,Number(expiresIn)||900));
  const config=audioConfig(env);
  let endpoint;
  try{endpoint=new URL(config.endpoint)}catch{throw Object.assign(new Error('Notification audio endpoint is invalid'),{status:503})}
  if(!['https:','http:'].includes(endpoint.protocol))throw Object.assign(new Error('Notification audio endpoint is invalid'),{status:503});

  const hostname=endpoint.hostname.startsWith(`${config.bucket}.`)?endpoint.hostname:`${config.bucket}.${endpoint.hostname}`;
  const host=hostname+(endpoint.port?`:${endpoint.port}`:'');
  const endpointPath=endpoint.pathname&&endpoint.pathname!=='/'?endpoint.pathname.replace(/\/$/,''):'';
  const canonicalUri=`${endpointPath}/${objectKey.split('/').map(awsEncode).join('/')}`;
  const amzDate=now.toISOString().replace(/[:-]|\.\d{3}/g,'');
  const dateStamp=amzDate.slice(0,8);
  const service='s3';
  const scope=`${dateStamp}/${config.region}/${service}/aws4_request`;
  const query=[
    ['X-Amz-Algorithm','AWS4-HMAC-SHA256'],
    ['X-Amz-Credential',`${config.accessKeyId}/${scope}`],
    ['X-Amz-Date',amzDate],
    ['X-Amz-Expires',String(seconds)],
    ['X-Amz-SignedHeaders','host']
  ].map(([k,v])=>[awsEncode(k),awsEncode(v)]).sort((a,b)=>a[0].localeCompare(b[0])||a[1].localeCompare(b[1]));
  const canonicalQuery=query.map(([k,v])=>`${k}=${v}`).join('&');
  const canonicalHeaders=`host:${host}\n`;
  const canonicalRequest=['GET',canonicalUri,canonicalQuery,canonicalHeaders,'host','UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign=['AWS4-HMAC-SHA256',amzDate,scope,sha256(canonicalRequest)].join('\n');
  const kDate=hmac(Buffer.from(`AWS4${config.secretAccessKey}`,'utf8'),dateStamp);
  const kRegion=hmac(kDate,config.region);
  const kService=hmac(kRegion,service);
  const kSigning=hmac(kService,'aws4_request');
  const signature=crypto.createHmac('sha256',kSigning).update(stringToSign).digest('hex');
  return `${endpoint.protocol}//${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export function notificationAudioConfigured(env=process.env){
  try{audioConfig(env);return true}catch{return false}
}
