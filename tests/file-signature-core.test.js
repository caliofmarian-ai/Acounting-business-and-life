import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeVerifiedDataUrl,fileSignatureMatches} from '../file-signature-core.js';

const url=(mime,bytes)=>`data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;

test('accepts PDF magic bytes when MIME matches',()=>{
  const {mime,bytes}=decodeVerifiedDataUrl(url('application/pdf',Buffer.from('%PDF-1.7\n')),{allowedMimes:['application/pdf']});
  assert.equal(mime,'application/pdf');
  assert.equal(bytes.subarray(0,5).toString('ascii'),'%PDF-');
});

test('accepts JPEG, PNG and WebP signatures',()=>{
  const jpeg=Buffer.from([0xff,0xd8,0xff,0xe0,0x00]);
  const png=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00]);
  const webp=Buffer.concat([Buffer.from('RIFF'),Buffer.from([0,0,0,0]),Buffer.from('WEBP'),Buffer.from([0])]);
  assert.equal(fileSignatureMatches('image/jpeg',jpeg),true);
  assert.equal(fileSignatureMatches('image/png',png),true);
  assert.equal(fileSignatureMatches('image/webp',webp),true);
});

test('rejects text pretending to be a PDF',()=>{
  assert.throws(
    ()=>decodeVerifiedDataUrl(url('application/pdf',Buffer.from('not a pdf')),{allowedMimes:['application/pdf'],label:'Evidence'}),
    error=>error?.code==='FILE_SIGNATURE_MISMATCH'&&error?.status===400
  );
});

test('rejects JPEG bytes declared as PNG',()=>{
  const jpeg=Buffer.from([0xff,0xd8,0xff,0xe0,0x00]);
  assert.throws(
    ()=>decodeVerifiedDataUrl(url('image/png',jpeg),{allowedMimes:['image/png']}),
    error=>error?.code==='FILE_SIGNATURE_MISMATCH'
  );
});

test('rejects disallowed or empty payloads',()=>{
  const png=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  assert.throws(()=>decodeVerifiedDataUrl(url('image/png',png),{allowedMimes:['application/pdf']}),/not allowed/);
  assert.throws(()=>decodeVerifiedDataUrl('data:image/png;base64,',{allowedMimes:['image/png']}),/valid base64 data URL/);
});
