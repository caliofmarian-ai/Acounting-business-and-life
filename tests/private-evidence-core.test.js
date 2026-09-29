import test from 'node:test';
import assert from 'node:assert/strict';
import {
  privateEvidenceConfig,validateFileExtension,sanitizePrivateImage,sendPrivateEvidence,__privateEvidenceTest
} from '../private-evidence-core.js';

const configured={
  APP_ENV:'qa-test',
  PRIVATE_EVIDENCE_REQUIRED:'true',
  PRIVATE_EVIDENCE_CLAMAV_HOST:'clamav.internal',
  PRIVATE_EVIDENCE_CLAMAV_PORT:'3310',
  PRIVATE_EVIDENCE_S3_ENDPOINT:'https://storage.example.test',
  PRIVATE_EVIDENCE_S3_BUCKET:'private-evidence-test',
  PRIVATE_EVIDENCE_S3_ACCESS_KEY_ID:'AKIATEST',
  PRIVATE_EVIDENCE_S3_SECRET_ACCESS_KEY:'secret-test-only',
  PRIVATE_EVIDENCE_S3_REGION:'auto',
  PRIVATE_EVIDENCE_S3_URL_STYLE:'virtual'
};

test('private evidence config fails closed when scanner or storage is missing',()=>{
  assert.throws(
    ()=>privateEvidenceConfig({APP_ENV:'qa',PRIVATE_EVIDENCE_REQUIRED:'true'}),
    error=>error?.status===503&&error?.code==='PRIVATE_EVIDENCE_CONFIG_MISSING'
  );
  const config=privateEvidenceConfig(configured);
  assert.equal(config.ready,true);
  assert.equal(config.required,true);
});

test('private evidence may explicitly reuse existing platform S3 credentials without mixing partial private config',()=>{
  const fallback=privateEvidenceConfig({
    APP_ENV:'production',
    PRIVATE_EVIDENCE_REQUIRED:'true',
    PRIVATE_EVIDENCE_CLAMAV_HOST:'clamav.internal',
    PRIVATE_EVIDENCE_REUSE_NOTIFICATION_AUDIO_STORAGE:'true',
    NOTIFICATION_AUDIO_ENDPOINT:'https://storage.example.test',
    NOTIFICATION_AUDIO_BUCKET:'platform-storage-test',
    NOTIFICATION_AUDIO_ACCESS_KEY_ID:'PLATFORMTEST',
    NOTIFICATION_AUDIO_SECRET_ACCESS_KEY:'platform-secret-test-only',
    NOTIFICATION_AUDIO_REGION:'auto'
  });
  assert.equal(fallback.ready,true);
  assert.equal(fallback.storageSource,'notification_audio_private_prefix');
  assert.equal(fallback.bucket,'platform-storage-test');

  assert.throws(
    ()=>privateEvidenceConfig({
      APP_ENV:'production',
      PRIVATE_EVIDENCE_REQUIRED:'true',
      PRIVATE_EVIDENCE_CLAMAV_HOST:'clamav.internal',
      PRIVATE_EVIDENCE_REUSE_NOTIFICATION_AUDIO_STORAGE:'true',
      PRIVATE_EVIDENCE_S3_BUCKET:'partial-private-config',
      NOTIFICATION_AUDIO_ENDPOINT:'https://storage.example.test',
      NOTIFICATION_AUDIO_BUCKET:'platform-storage-test',
      NOTIFICATION_AUDIO_ACCESS_KEY_ID:'PLATFORMTEST',
      NOTIFICATION_AUDIO_SECRET_ACCESS_KEY:'platform-secret-test-only'
    }),
    error=>error?.status===503&&error?.code==='PRIVATE_EVIDENCE_CONFIG_MISSING'
  );
});

test('private evidence filename extension must agree with declared MIME',()=>{
  assert.equal(validateFileExtension('evidence.pdf','application/pdf'),true);
  assert.equal(validateFileExtension('voice.webm','audio/webm'),true);
  assert.throws(
    ()=>validateFileExtension('evidence.jpg','application/pdf'),
    error=>error?.code==='FILE_EXTENSION_MISMATCH'
  );
});

test('JPEG private evidence strips EXIF APP1 metadata before storage',()=>{
  const soi=Buffer.from([0xff,0xd8]);
  const app1Payload=Buffer.from('Exif\0\0GPS fixture');
  const app1Length=Buffer.alloc(2);app1Length.writeUInt16BE(app1Payload.length+2);
  const app1=Buffer.concat([Buffer.from([0xff,0xe1]),app1Length,app1Payload]);
  const sos=Buffer.from([0xff,0xda,0x00,0x02,0x11,0x22,0xff,0xd9]);
  const source=Buffer.concat([soi,app1,sos]);
  const clean=sanitizePrivateImage(source,'image/jpeg');
  assert.equal(clean.includes(Buffer.from('GPS fixture')),false);
  assert.equal(clean.subarray(0,2).equals(soi),true);
});

test('S3 signing uses opaque bucket host and never exposes the secret in Authorization',()=>{
  const config=privateEvidenceConfig(configured);
  const signed=__privateEvidenceTest.signedHeaders(config,{
    method:'PUT',
    key:'private-evidence/qa/objects/test/opaque-id',
    body:Buffer.from('fixture'),
    now:new Date('2026-09-29T12:00:00Z')
  });
  assert.equal(signed.url.hostname,'private-evidence-test.storage.example.test');
  assert.match(signed.headers.Authorization,/AWS4-HMAC-SHA256 Credential=AKIATEST\//);
  assert.equal(signed.headers.Authorization.includes('secret-test-only'),false);
  assert.equal(signed.url.pathname.includes('opaque-id'),true);
});

test('private evidence download headers are attachment-only and no-store',()=>{
  const headers={};
  let body=null,status=null;
  const res={
    set(values){Object.assign(headers,values);return this},
    status(value){status=value;return this},
    send(value){body=value;return this}
  };
  sendPrivateEvidence(res,{
    metadata:{detected_mime:'application/pdf',original_file_name:'evidence.pdf'},
    bytes:Buffer.from('%PDF-fixture')
  });
  assert.equal(status,200);
  assert.equal(body.toString(),'%PDF-fixture');
  assert.match(headers['Content-Disposition'],/^attachment;/);
  assert.equal(headers['X-Content-Type-Options'],'nosniff');
  assert.match(headers['Cache-Control'],/no-store/);
  assert.match(headers['Content-Security-Policy'],/default-src 'none'/);
});
