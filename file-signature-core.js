const SIGNATURES=Object.freeze({
  'application/pdf':bytes=>bytes.length>=5&&bytes.subarray(0,5).toString('ascii')==='%PDF-',
  'image/jpeg':bytes=>bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff,
  'image/png':bytes=>{
    const sig=[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a];
    return bytes.length>=sig.length&&sig.every((value,index)=>bytes[index]===value);
  },
  'image/webp':bytes=>bytes.length>=12
    &&bytes.subarray(0,4).toString('ascii')==='RIFF'
    &&bytes.subarray(8,12).toString('ascii')==='WEBP'
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
  const match=String(value||'').match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/);
  if(!match)fail(`${label} must be a valid base64 data URL`,'INVALID_DATA_URL');
  const mime=String(match[1]||'').toLowerCase();
  const allow=allowedMimes==null?null:new Set(Array.from(allowedMimes,String).map(x=>x.toLowerCase()));
  if(allow&&!allow.has(mime))fail(`${label} type is not allowed`,'FILE_TYPE_NOT_ALLOWED');
  let bytes;
  try{bytes=Buffer.from(match[2],'base64')}catch{fail(`${label} could not be decoded`,'INVALID_BASE64')}
  if(!bytes.length)fail(`${label} is empty`,'EMPTY_FILE');
  if(!fileSignatureMatches(mime,bytes))fail(`${label} content does not match its declared file type`,'FILE_SIGNATURE_MISMATCH');
  return{mime,bytes};
}
