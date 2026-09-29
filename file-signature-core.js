const utf8Text=bytes=>{
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.includes(0))return false;
  try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);return true}catch{return false}
};

const hasAscii=(bytes,text)=>bytes.includes(Buffer.from(text,'ascii'));
const hasUtf16Le=(bytes,text)=>bytes.includes(Buffer.from(text,'utf16le'));

const SIGNATURES=Object.freeze({
  'application/pdf':bytes=>bytes.length>=5&&bytes.subarray(0,5).toString('ascii')==='%PDF-',
  'image/jpeg':bytes=>bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff,
  'image/png':bytes=>{
    const sig=[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a];
    return bytes.length>=sig.length&&sig.every((value,index)=>bytes[index]===value);
  },
  'image/webp':bytes=>bytes.length>=12
    &&bytes.subarray(0,4).toString('ascii')==='RIFF'
    &&bytes.subarray(8,12).toString('ascii')==='WEBP',
  'text/plain':utf8Text,
  'text/markdown':utf8Text,
  'application/msword':bytes=>bytes.length>=8
    &&bytes.subarray(0,8).equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]))
    &&hasUtf16Le(bytes,'WordDocument'),
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':bytes=>bytes.length>=4
    &&bytes[0]===0x50&&bytes[1]===0x4b&&bytes[2]===0x03&&bytes[3]===0x04
    &&hasAscii(bytes,'[Content_Types].xml')
    &&hasAscii(bytes,'word/'),
  'audio/webm':bytes=>bytes.length>=4
    &&bytes[0]===0x1a&&bytes[1]===0x45&&bytes[2]===0xdf&&bytes[3]===0xa3,
  'audio/wav':bytes=>bytes.length>=12
    &&bytes.subarray(0,4).toString('ascii')==='RIFF'
    &&bytes.subarray(8,12).toString('ascii')==='WAVE',
  'audio/x-wav':bytes=>bytes.length>=12
    &&bytes.subarray(0,4).toString('ascii')==='RIFF'
    &&bytes.subarray(8,12).toString('ascii')==='WAVE',
  'audio/mpeg':bytes=>bytes.length>=3&&(
    bytes.subarray(0,3).toString('ascii')==='ID3'
    ||(bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0)
  ),
  'audio/mp4':bytes=>bytes.length>=12&&bytes.subarray(4,8).toString('ascii')==='ftyp',
  'audio/x-m4a':bytes=>bytes.length>=12&&bytes.subarray(4,8).toString('ascii')==='ftyp',
  'audio/ogg':bytes=>bytes.length>=4&&bytes.subarray(0,4).toString('ascii')==='OggS',
  'audio/aac':bytes=>bytes.length>=2&&bytes[0]===0xff&&(bytes[1]&0xf0)===0xf0,
  'audio/3gpp':bytes=>bytes.length>=12
    &&bytes.subarray(4,8).toString('ascii')==='ftyp'
    &&bytes.subarray(8,32).toString('ascii').toLowerCase().includes('3gp')
});

function fail(message,code){
  throw Object.assign(new Error(message),{status:400,code});
}

export function fileSignatureMatches(mime,bytes){
  const normalized=String(mime||'').toLowerCase();
  const validator=SIGNATURES[normalized];
  return Boolean(validator&&Buffer.isBuffer(bytes)&&validator(bytes));
}

export function decodeVerifiedDataUrl(value,{allowedMimes=null,label='File'}={}){
  const raw=String(value||''),comma=raw.indexOf(',');
  if(!raw.startsWith('data:')||comma<6)fail(`${label} must be a valid base64 data URL`,'INVALID_DATA_URL');
  const meta=raw.slice(5,comma).split(';').filter(Boolean),mime=String(meta.shift()||'').toLowerCase();
  if(!mime||!meta.some(part=>part.toLowerCase()==='base64'))fail(`${label} must be a valid base64 data URL`,'INVALID_DATA_URL');
  for(const part of meta){
    if(part.toLowerCase()==='base64')continue;
    if(!/^[a-z0-9._-]+=[a-z0-9._+:/ -]+$/i.test(part))fail(`${label} has invalid data URL parameters`,'INVALID_DATA_URL');
  }
  const payload=raw.slice(comma+1);
  if(!/^[A-Za-z0-9+/=]+$/.test(payload))fail(`${label} could not be decoded`,'INVALID_BASE64');
  const allow=allowedMimes==null?null:new Set(Array.from(allowedMimes,String).map(x=>x.toLowerCase()));
  if(allow&&!allow.has(mime))fail(`${label} type is not allowed`,'FILE_TYPE_NOT_ALLOWED');
  let bytes;
  try{bytes=Buffer.from(payload,'base64')}catch{fail(`${label} could not be decoded`,'INVALID_BASE64')}
  if(!bytes.length)fail(`${label} is empty`,'EMPTY_FILE');
  if(!fileSignatureMatches(mime,bytes))fail(`${label} content does not match its declared file type`,'FILE_SIGNATURE_MISMATCH');
  return{mime,bytes};
}
