import crypto from 'node:crypto';
import net from 'node:net';
import {decodeVerifiedDataUrl} from './file-signature-core.js';

const CLEAN_SCAN='clean';
const QUARANTINED_SCAN='quarantined';
const MAX_AUDIT_TEXT=240;
const EXTENSIONS=Object.freeze({
  'application/pdf':['pdf'],
  'image/jpeg':['jpg','jpeg'],
  'image/png':['png'],
  'image/webp':['webp'],
  'text/plain':['txt'],
  'text/markdown':['md','markdown'],
  'application/msword':['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':['docx'],
  'audio/webm':['webm'],
  'audio/wav':['wav'],
  'audio/x-wav':['wav'],
  'audio/mpeg':['mp3'],
  'audio/mp4':['m4a','mp4'],
  'audio/x-m4a':['m4a'],
  'audio/ogg':['ogg'],
  'audio/aac':['aac'],
  'audio/3gpp':['3gp','3gpp']
});

const clean=(value,max=MAX_AUDIT_TEXT)=>String(value??'').trim().slice(0,max);
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const hmac=(key,value,encoding)=>crypto.createHmac('sha256',key).update(value).digest(encoding);
const bool=value=>['1','true','yes','on'].includes(String(value??'').trim().toLowerCase());

function serviceUnavailable(message,code='PRIVATE_EVIDENCE_UNAVAILABLE'){
  return Object.assign(new Error(message),{status:503,code});
}
function rejected(message,code,status=400){
  return Object.assign(new Error(message),{status,code});
}

export function privateEvidenceConfig(env=process.env){
  const required=bool(env.PRIVATE_EVIDENCE_REQUIRED);
  const config={
    required,
    clamavHost:clean(env.PRIVATE_EVIDENCE_CLAMAV_HOST,240),
    clamavPort:Number(env.PRIVATE_EVIDENCE_CLAMAV_PORT||3310),
    storageTimeoutMs:Math.max(1000,Math.min(60000,Number(env.PRIVATE_EVIDENCE_STORAGE_TIMEOUT_MS)||15000)),
    endpoint:clean(env.PRIVATE_EVIDENCE_S3_ENDPOINT,500),
    bucket:clean(env.PRIVATE_EVIDENCE_S3_BUCKET,240),
    accessKeyId:clean(env.PRIVATE_EVIDENCE_S3_ACCESS_KEY_ID,500),
    secretAccessKey:String(env.PRIVATE_EVIDENCE_S3_SECRET_ACCESS_KEY||''),
    region:clean(env.PRIVATE_EVIDENCE_S3_REGION||'auto',80)||'auto',
    urlStyle:clean(env.PRIVATE_EVIDENCE_S3_URL_STYLE||'virtual',20).toLowerCase(),
    prefix:clean(env.PRIVATE_EVIDENCE_S3_PREFIX||'private-evidence',120).replace(/^\/+|\/+$/g,''),
    environment:clean(env.APP_ENV||env.RAILWAY_ENVIRONMENT_NAME||'unknown',40).toLowerCase()
  };
  const missing=[];
  if(!config.clamavHost)missing.push('PRIVATE_EVIDENCE_CLAMAV_HOST');
  if(!Number.isInteger(config.clamavPort)||config.clamavPort<1||config.clamavPort>65535)missing.push('PRIVATE_EVIDENCE_CLAMAV_PORT');
  for(const [key,name] of [
    ['endpoint','PRIVATE_EVIDENCE_S3_ENDPOINT'],
    ['bucket','PRIVATE_EVIDENCE_S3_BUCKET'],
    ['accessKeyId','PRIVATE_EVIDENCE_S3_ACCESS_KEY_ID'],
    ['secretAccessKey','PRIVATE_EVIDENCE_S3_SECRET_ACCESS_KEY']
  ])if(!config[key])missing.push(name);
  if(!['virtual','path'].includes(config.urlStyle))missing.push('PRIVATE_EVIDENCE_S3_URL_STYLE');
  if(config.endpoint){
    let parsed;
    try{parsed=new URL(config.endpoint)}catch{}
    const allowHttp=config.environment==='test'||config.environment==='qa-test';
    if(!parsed||(!allowHttp&&parsed.protocol!=='https:'))missing.push('PRIVATE_EVIDENCE_S3_ENDPOINT_HTTPS');
  }
  if(required&&missing.length)throw serviceUnavailable('Private evidence storage is not fully configured.','PRIVATE_EVIDENCE_CONFIG_MISSING');
  return{...config,ready:missing.length===0,missing};
}

export async function ensurePrivateEvidenceSchema(db){
  await db.query(`
    CREATE TABLE IF NOT EXISTS private_evidence_objects(
      id BIGSERIAL PRIMARY KEY,
      object_key TEXT NOT NULL UNIQUE,
      owner_account_id BIGINT,
      created_by_account_id BIGINT,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT '',
      classification TEXT NOT NULL DEFAULT 'private_evidence',
      original_file_name TEXT NOT NULL DEFAULT '',
      detected_mime TEXT NOT NULL,
      byte_size BIGINT NOT NULL CHECK(byte_size>=0),
      sha256 TEXT NOT NULL,
      scan_status TEXT NOT NULL,
      scan_engine TEXT NOT NULL DEFAULT 'clamav',
      scan_result TEXT NOT NULL DEFAULT '',
      retention_state TEXT NOT NULL DEFAULT 'active',
      quarantined_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(scan_status IN ('clean','quarantined','scan_failed','deleted')),
      CHECK(retention_state IN ('active','hold','delete_requested','deleted'))
    );
    CREATE INDEX IF NOT EXISTS private_evidence_source_idx
      ON private_evidence_objects(source_type,source_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS private_evidence_owner_idx
      ON private_evidence_objects(owner_account_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS private_evidence_access_audit(
      id BIGSERIAL PRIMARY KEY,
      object_id BIGINT REFERENCES private_evidence_objects(id) ON DELETE SET NULL,
      actor_account_id BIGINT,
      action TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT '',
      source_type TEXT NOT NULL DEFAULT '',
      source_id TEXT NOT NULL DEFAULT '',
      outcome TEXT NOT NULL,
      correlation_id TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(action IN ('upload','scan','read','bind','delete','migration')),
      CHECK(outcome IN ('allowed','denied','clean','quarantined','failed','deleted'))
    );
    CREATE INDEX IF NOT EXISTS private_evidence_audit_object_idx
      ON private_evidence_access_audit(object_id,created_at DESC);
  `);
}

async function audit(db,{objectId=null,actorAccountId=null,action,purpose='',sourceType='',sourceId='',outcome,correlationId='',detail=''}){
  await db.query(`
    INSERT INTO private_evidence_access_audit(
      object_id,actor_account_id,action,purpose,source_type,source_id,outcome,correlation_id,detail
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
  `,[
    objectId?Number(objectId):null,
    actorAccountId?Number(actorAccountId):null,
    clean(action,32),clean(purpose,160),clean(sourceType,80),clean(sourceId,160),
    clean(outcome,24),clean(correlationId,160),clean(detail,MAX_AUDIT_TEXT)
  ]);
}

export async function recordPrivateEvidenceAudit(db,input){
  return audit(db,input);
}

export function validateFileExtension(fileName,mime){
  const name=clean(fileName,220);
  if(!name)return true;
  const match=name.toLowerCase().match(/\.([a-z0-9]+)$/);
  if(!match)throw rejected('Private evidence file needs a recognized filename extension.','FILE_EXTENSION_REQUIRED');
  const allowed=EXTENSIONS[String(mime||'').toLowerCase()]||[];
  if(!allowed.includes(match[1]))throw rejected('File extension does not match the declared file type.','FILE_EXTENSION_MISMATCH');
  return true;
}

function stripJpegMetadata(bytes){
  if(bytes.length<4||bytes[0]!==0xff||bytes[1]!==0xd8)return bytes;
  const out=[bytes.subarray(0,2)];
  let offset=2;
  while(offset+1<bytes.length){
    if(bytes[offset]!==0xff){out.push(bytes.subarray(offset));break}
    const marker=bytes[offset+1];
    if(marker===0xda){out.push(bytes.subarray(offset));break}
    if(marker===0xd9){out.push(bytes.subarray(offset,offset+2));break}
    if(marker===0x01||(marker>=0xd0&&marker<=0xd7)){out.push(bytes.subarray(offset,offset+2));offset+=2;continue}
    if(offset+4>bytes.length){out.push(bytes.subarray(offset));break}
    const length=bytes.readUInt16BE(offset+2);
    if(length<2||offset+2+length>bytes.length){out.push(bytes.subarray(offset));break}
    const end=offset+2+length;
    if(marker!==0xe1&&marker!==0xed)out.push(bytes.subarray(offset,end));
    offset=end;
  }
  return Buffer.concat(out);
}
function stripPngMetadata(bytes){
  const signature=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  if(bytes.length<8||!bytes.subarray(0,8).equals(signature))return bytes;
  const out=[bytes.subarray(0,8)];
  let offset=8;
  const removable=new Set(['eXIf','tEXt','zTXt','iTXt']);
  while(offset+12<=bytes.length){
    const length=bytes.readUInt32BE(offset);
    const end=offset+12+length;
    if(end>bytes.length)break;
    const type=bytes.subarray(offset+4,offset+8).toString('ascii');
    if(!removable.has(type))out.push(bytes.subarray(offset,end));
    offset=end;
    if(type==='IEND')break;
  }
  if(offset<bytes.length)out.push(bytes.subarray(offset));
  return Buffer.concat(out);
}
function stripWebpMetadata(bytes){
  if(bytes.length<12||bytes.subarray(0,4).toString('ascii')!=='RIFF'||bytes.subarray(8,12).toString('ascii')!=='WEBP')return bytes;
  const chunks=[];
  let offset=12;
  while(offset+8<=bytes.length){
    const type=bytes.subarray(offset,offset+4).toString('ascii');
    const size=bytes.readUInt32LE(offset+4);
    const padded=size+(size%2);
    const end=offset+8+padded;
    if(end>bytes.length)break;
    if(type!=='EXIF'&&type!=='XMP ')chunks.push(bytes.subarray(offset,end));
    offset=end;
  }
  const payload=Buffer.concat([Buffer.from('WEBP','ascii'),...chunks]);
  const header=Buffer.alloc(8);
  header.write('RIFF',0,'ascii');
  header.writeUInt32LE(payload.length,4);
  return Buffer.concat([header,payload]);
}

export function sanitizePrivateImage(bytes,mime){
  const normalized=String(mime||'').toLowerCase();
  if(normalized==='image/jpeg')return stripJpegMetadata(bytes);
  if(normalized==='image/png')return stripPngMetadata(bytes);
  if(normalized==='image/webp')return stripWebpMetadata(bytes);
  return bytes;
}

export async function scanWithClamAv(bytes,{host,port=3310,timeoutMs=20000}={}){
  if(!host)throw serviceUnavailable('Private evidence malware scanner is unavailable.','PRIVATE_EVIDENCE_SCANNER_UNAVAILABLE');
  return await new Promise((resolve,reject)=>{
    let settled=false,response='';
    const socket=net.createConnection({host,port:Number(port)});
    const done=(error,value)=>{
      if(settled)return;
      settled=true;
      socket.destroy();
      if(error)reject(error);else resolve(value);
    };
    socket.setTimeout(timeoutMs,()=>done(serviceUnavailable('Private evidence malware scan timed out.','PRIVATE_EVIDENCE_SCANNER_TIMEOUT')));
    socket.on('error',()=>done(serviceUnavailable('Private evidence malware scanner is unavailable.','PRIVATE_EVIDENCE_SCANNER_UNAVAILABLE')));
    socket.on('connect',()=>{
      socket.write(Buffer.from('zINSTREAM\0'));
      const chunkSize=64*1024;
      for(let offset=0;offset<bytes.length;offset+=chunkSize){
        const chunk=bytes.subarray(offset,Math.min(bytes.length,offset+chunkSize));
        const size=Buffer.alloc(4);size.writeUInt32BE(chunk.length);
        socket.write(size);socket.write(chunk);
      }
      const end=Buffer.alloc(4);end.writeUInt32BE(0);socket.write(end);
    });
    socket.on('data',chunk=>{
      response+=chunk.toString('utf8');
      if(!response.includes('\0')&&!response.includes('\n'))return;
      const result=response.replace(/\0/g,'').trim();
      if(/\bFOUND\b/i.test(result))return done(null,{status:'infected',result:clean(result,MAX_AUDIT_TEXT)});
      if(/\bOK\b/i.test(result))return done(null,{status:'clean',result:clean(result,MAX_AUDIT_TEXT)});
      if(/\bERROR\b/i.test(result))return done(serviceUnavailable('Private evidence malware scan failed.','PRIVATE_EVIDENCE_SCAN_FAILED'));
    });
    socket.on('close',()=>{
      if(settled)return;
      const result=response.replace(/\0/g,'').trim();
      if(/\bFOUND\b/i.test(result))return done(null,{status:'infected',result:clean(result,MAX_AUDIT_TEXT)});
      if(/\bOK\b/i.test(result))return done(null,{status:'clean',result:clean(result,MAX_AUDIT_TEXT)});
      done(serviceUnavailable('Private evidence malware scanner returned no usable result.','PRIVATE_EVIDENCE_SCAN_FAILED'));
    });
  });
}

function amzTimestamp(date=new Date()){
  return date.toISOString().replace(/[:-]|\.\d{3}/g,'');
}
function encodeKey(key){
  return '/'+String(key).split('/').map(part=>encodeURIComponent(part)).join('/');
}
function s3Target(config,key){
  const base=new URL(config.endpoint);
  const encoded=encodeKey(key);
  if(config.urlStyle==='path'){
    base.pathname=encodeKey(config.bucket)+encoded;
  }else{
    base.hostname=`${config.bucket}.${base.hostname}`;
    base.pathname=encoded;
  }
  base.search='';
  base.hash='';
  return base;
}
function signingKey(secret,dateStamp,region){
  const date=hmac(Buffer.from('AWS4'+secret,'utf8'),dateStamp);
  const reg=hmac(date,region);
  const svc=hmac(reg,'s3');
  return hmac(svc,'aws4_request');
}
function signedHeaders(config,{method,key,body=Buffer.alloc(0),now=new Date()}){
  const url=s3Target(config,key);
  const payloadHash=sha256(body);
  const amzDate=amzTimestamp(now);
  const dateStamp=amzDate.slice(0,8);
  const canonicalHeaders=`host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signed='host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest=[method,url.pathname,'',canonicalHeaders,signed,payloadHash].join('\n');
  const scope=`${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign=['AWS4-HMAC-SHA256',amzDate,scope,sha256(Buffer.from(canonicalRequest))].join('\n');
  const signature=hmac(signingKey(config.secretAccessKey,dateStamp,config.region),stringToSign,'hex');
  return{
    url,
    headers:{
      'x-amz-content-sha256':payloadHash,
      'x-amz-date':amzDate,
      Authorization:`AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`
    }
  };
}
async function s3Request(config,{method,key,body=Buffer.alloc(0),contentType=''}) {
  const signed=signedHeaders(config,{method,key,body});
  const headers={...signed.headers};
  if(contentType)headers['Content-Type']=contentType;
  let response;
  try{
    response=await fetch(signed.url,{method,headers,body:['GET','HEAD'].includes(method)?undefined:body,signal:AbortSignal.timeout(config.storageTimeoutMs)});
  }catch{
    throw serviceUnavailable('Private evidence object storage is unavailable.','PRIVATE_EVIDENCE_STORAGE_UNAVAILABLE');
  }
  if(!response.ok){
    throw serviceUnavailable(`Private evidence object storage returned HTTP ${response.status}.`,'PRIVATE_EVIDENCE_STORAGE_UNAVAILABLE');
  }
  return response;
}
async function putObject(config,key,bytes,mime){await s3Request(config,{method:'PUT',key,body:bytes,contentType:mime})}
async function getObject(config,key){return Buffer.from(await (await s3Request(config,{method:'GET',key})).arrayBuffer())}
async function deleteObject(config,key){await s3Request(config,{method:'DELETE',key})}

function opaqueKey(config,{classification='private_evidence',quarantine=false}={}){
  const root=[config.prefix,config.environment,quarantine?'quarantine':'objects',clean(classification,50).replace(/[^a-z0-9_-]/gi,'_')].filter(Boolean).join('/');
  return `${root}/${crypto.randomUUID()}`;
}

async function insertMetadata(db,input){
  const{rows}=await db.query(`
    INSERT INTO private_evidence_objects(
      object_key,owner_account_id,created_by_account_id,source_type,source_id,purpose,classification,
      original_file_name,detected_mime,byte_size,sha256,scan_status,scan_result,quarantined_at
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,CASE WHEN $12='quarantined' THEN NOW() END)
    RETURNING *
  `,[
    input.objectKey,input.ownerAccountId?Number(input.ownerAccountId):null,input.actorAccountId?Number(input.actorAccountId):null,
    clean(input.sourceType,80),clean(input.sourceId||'pending',160),clean(input.purpose,160),clean(input.classification,80)||'private_evidence',
    clean(input.fileName,220),input.mime,Number(input.byteSize),input.hash,input.scanStatus,clean(input.scanResult,MAX_AUDIT_TEXT)
  ]);
  return rows[0];
}

export async function storePrivateEvidence(db,{
  dataUrl,fileName='',allowedMimes,maxBytes,ownerAccountId=null,actorAccountId=null,
  sourceType,sourceId='pending',purpose='upload',classification='private_evidence',correlationId='',env=process.env
}={}){
  await ensurePrivateEvidenceSchema(db);
  const config=privateEvidenceConfig(env);
  if(!config.ready)throw serviceUnavailable('Private evidence storage is not ready.','PRIVATE_EVIDENCE_CONFIG_MISSING');
  const decoded=decodeVerifiedDataUrl(dataUrl,{allowedMimes,label:'Private evidence'});
  validateFileExtension(fileName,decoded.mime);
  if(Number.isFinite(Number(maxBytes))&&decoded.bytes.length>Number(maxBytes))throw rejected('Private evidence file exceeds the allowed size.','PRIVATE_EVIDENCE_TOO_LARGE',413);
  const sanitized=sanitizePrivateImage(decoded.bytes,decoded.mime);
  const hash=sha256(sanitized);
  let scan;
  try{scan=await scanWithClamAv(sanitized,{host:config.clamavHost,port:config.clamavPort})}
  catch(error){
    await audit(db,{actorAccountId,action:'scan',purpose,sourceType,sourceId,outcome:'failed',correlationId,detail:error.code||'scan_failed'}).catch(()=>{});
    throw error;
  }
  if(scan.status!=='clean'){
    const key=opaqueKey(config,{classification,quarantine:true});
    await putObject(config,key,sanitized,decoded.mime);
    const metadata=await insertMetadata(db,{
      objectKey:key,ownerAccountId,actorAccountId,sourceType,sourceId,purpose,classification,fileName,
      mime:decoded.mime,byteSize:sanitized.length,hash,scanStatus:QUARANTINED_SCAN,scanResult:scan.result
    });
    await audit(db,{objectId:metadata.id,actorAccountId,action:'scan',purpose,sourceType,sourceId,outcome:'quarantined',correlationId,detail:scan.result});
    throw rejected('Private evidence was rejected by malware scanning.','PRIVATE_EVIDENCE_MALWARE_DETECTED',422);
  }
  const key=opaqueKey(config,{classification});
  try{await putObject(config,key,sanitized,decoded.mime)}
  catch(error){
    await audit(db,{actorAccountId,action:'upload',purpose,sourceType,sourceId,outcome:'failed',correlationId,detail:error.code||'storage_failed'}).catch(()=>{});
    throw error;
  }
  let metadata;
  try{
    metadata=await insertMetadata(db,{
      objectKey:key,ownerAccountId,actorAccountId,sourceType,sourceId,purpose,classification,fileName,
      mime:decoded.mime,byteSize:sanitized.length,hash,scanStatus:CLEAN_SCAN,scanResult:scan.result
    });
  }catch(error){
    await deleteObject(config,key).catch(()=>{});
    throw error;
  }
  await audit(db,{objectId:metadata.id,actorAccountId,action:'scan',purpose,sourceType,sourceId,outcome:'clean',correlationId,detail:scan.result});
  await audit(db,{objectId:metadata.id,actorAccountId,action:'upload',purpose,sourceType,sourceId,outcome:'allowed',correlationId,detail:'stored'});
  return metadata;
}

export async function bindPrivateEvidenceSource(db,{objectId,sourceType,sourceId,actorAccountId=null,purpose='bind',correlationId=''}){
  const{rows}=await db.query(`
    UPDATE private_evidence_objects
       SET source_type=$1,source_id=$2,updated_at=NOW()
     WHERE id=$3 AND scan_status='clean' AND retention_state='active'
     RETURNING *
  `,[clean(sourceType,80),clean(sourceId,160),Number(objectId)]);
  if(!rows.length)throw rejected('Private evidence object cannot be bound.','PRIVATE_EVIDENCE_BIND_FAILED',409);
  await audit(db,{objectId,actorAccountId,action:'bind',purpose,sourceType,sourceId,outcome:'allowed',correlationId});
  return rows[0];
}

export async function readPrivateEvidence(db,{objectId,actorAccountId=null,purpose='download',correlationId='',env=process.env}={}){
  await ensurePrivateEvidenceSchema(db);
  const q=await db.query(`
    SELECT * FROM private_evidence_objects
     WHERE id=$1 AND retention_state='active'
  `,[Number(objectId)]);
  if(!q.rowCount){
    await audit(db,{objectId,actorAccountId,action:'read',purpose,outcome:'denied',correlationId,detail:'not_found'}).catch(()=>{});
    throw rejected('Private evidence is unavailable.','PRIVATE_EVIDENCE_NOT_FOUND',404);
  }
  const metadata=q.rows[0];
  if(metadata.scan_status!=='clean'){
    await audit(db,{objectId,actorAccountId,action:'read',purpose,sourceType:metadata.source_type,sourceId:metadata.source_id,outcome:'denied',correlationId,detail:metadata.scan_status});
    throw rejected('Private evidence is quarantined or unavailable.','PRIVATE_EVIDENCE_NOT_READABLE',423);
  }
  const config=privateEvidenceConfig(env);
  if(!config.ready)throw serviceUnavailable('Private evidence storage is not ready.','PRIVATE_EVIDENCE_CONFIG_MISSING');
  let bytes;
  try{bytes=await getObject(config,metadata.object_key)}
  catch(error){
    await audit(db,{objectId,actorAccountId,action:'read',purpose,sourceType:metadata.source_type,sourceId:metadata.source_id,outcome:'failed',correlationId,detail:error.code||'storage_failed'}).catch(()=>{});
    throw error;
  }
  if(sha256(bytes)!==metadata.sha256){
    await audit(db,{objectId,actorAccountId,action:'read',purpose,sourceType:metadata.source_type,sourceId:metadata.source_id,outcome:'failed',correlationId,detail:'sha256_mismatch'}).catch(()=>{});
    throw serviceUnavailable('Private evidence integrity verification failed.','PRIVATE_EVIDENCE_INTEGRITY_FAILED');
  }
  await audit(db,{objectId,actorAccountId,action:'read',purpose,sourceType:metadata.source_type,sourceId:metadata.source_id,outcome:'allowed',correlationId,detail:'proxied'});
  return{metadata,bytes};
}

export async function deletePrivateEvidence(db,{objectId,actorAccountId=null,purpose='delete',correlationId='',env=process.env}={}){
  const q=await db.query('SELECT * FROM private_evidence_objects WHERE id=$1',[Number(objectId)]);
  if(!q.rowCount)return false;
  const metadata=q.rows[0],config=privateEvidenceConfig(env);
  if(config.ready)await deleteObject(config,metadata.object_key).catch(()=>{});
  await db.query(`
    UPDATE private_evidence_objects
       SET retention_state='deleted',scan_status='deleted',deleted_at=NOW(),updated_at=NOW()
     WHERE id=$1
  `,[Number(objectId)]);
  await audit(db,{objectId,actorAccountId,action:'delete',purpose,sourceType:metadata.source_type,sourceId:metadata.source_id,outcome:'deleted',correlationId});
  return true;
}

export function sendPrivateEvidence(res,{metadata,bytes}){
  const safeName=clean(metadata?.original_file_name,220)||'private-evidence';
  res.set({
    'Content-Type':metadata.detected_mime||'application/octet-stream',
    'Content-Length':String(bytes.length),
    'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`,
    'X-Content-Type-Options':'nosniff',
    'Cache-Control':'private, no-store, max-age=0',
    'Pragma':'no-cache',
    'Content-Security-Policy':"default-src 'none'; sandbox",
    'Cross-Origin-Resource-Policy':'same-origin'
  });
  return res.status(200).send(bytes);
}

export const __privateEvidenceTest={
  s3Target,signedHeaders,sha256,stripJpegMetadata,stripPngMetadata,stripWebpMetadata
};
