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
  assert.throws(()=>decodeVerifiedDataUrl('data:image/png;base64,',{allowedMimes:['image/png']}),error=>error?.code==='INVALID_BASE64');
});


test('accepts UTF-8 text, Office and audio signatures used by private Support evidence',()=>{
  assert.equal(fileSignatureMatches('text/plain',Buffer.from('plain support note\n','utf8')),true);
  assert.equal(fileSignatureMatches('text/markdown',Buffer.from('# Support evidence\n','utf8')),true);

  const doc=Buffer.concat([
    Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]),
    Buffer.alloc(32),
    Buffer.from('WordDocument','utf16le')
  ]);
  assert.equal(fileSignatureMatches('application/msword',doc),true);

  const docx=Buffer.concat([
    Buffer.from([0x50,0x4b,0x03,0x04]),
    Buffer.from('fixture-[Content_Types].xml-word/document.xml-word/')
  ]);
  assert.equal(fileSignatureMatches('application/vnd.openxmlformats-officedocument.wordprocessingml.document',docx),true);

  assert.equal(fileSignatureMatches('audio/webm',Buffer.from([0x1a,0x45,0xdf,0xa3,0x00])),true);
  assert.equal(fileSignatureMatches('audio/wav',Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WAVE')])),true);
  assert.equal(fileSignatureMatches('audio/mpeg',Buffer.from('ID3fixture')),true);
  assert.equal(fileSignatureMatches('audio/mp4',Buffer.concat([Buffer.alloc(4),Buffer.from('ftyp'),Buffer.from('M4A ')])),true);
  assert.equal(fileSignatureMatches('audio/ogg',Buffer.from('OggSfixture')),true);
});

test('rejects renamed ZIP and binary payloads masquerading as private documents',()=>{
  const genericZip=Buffer.concat([Buffer.from([0x50,0x4b,0x03,0x04]),Buffer.from('random/archive.txt')]);
  assert.equal(fileSignatureMatches('application/vnd.openxmlformats-officedocument.wordprocessingml.document',genericZip),false);
  assert.equal(fileSignatureMatches('text/plain',Buffer.from([0xff,0x00,0xfe])),false);
});


test('accepts safe MIME parameters used by MediaRecorder while preserving signature checks',()=>{
  const webm=Buffer.from([0x1a,0x45,0xdf,0xa3,0x00,0x00]);
  const url='data:audio/webm;codecs=opus;base64,'+webm.toString('base64');
  const decoded=decodeVerifiedDataUrl(url,{allowedMimes:['audio/webm'],label:'Voice recording'});
  assert.equal(decoded.mime,'audio/webm');
  assert.equal(decoded.bytes.equals(webm),true);
  assert.throws(
    ()=>decodeVerifiedDataUrl('data:audio/webm;bad parameter;base64,'+webm.toString('base64'),{allowedMimes:['audio/webm']}),
    /invalid data URL parameters/i
  );
});
