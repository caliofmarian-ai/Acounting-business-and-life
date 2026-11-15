import test from 'node:test';
import assert from 'node:assert/strict';
import {
  privateEvidenceConfig,validateFileExtension,sanitizePrivateImage,sendPrivateEvidence,deletePrivateEvidence,__privateEvidenceTest
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


function makePrivateEvidenceDeleteHarness(initial){
  const row={...initial};
  const audits=[];
  const releases=[];
  const execute=async(sql,params=[])=>{
    const query=String(sql).replace(/\s+/g,' ').trim();
    if(query==='BEGIN'||query==='COMMIT'||query==='ROLLBACK')return{rowCount:0,rows:[]};
    if(query.startsWith('SELECT * FROM private_evidence_objects WHERE id=$1 FOR UPDATE')){
      return row&&Number(row.id)===Number(params[0])?{rowCount:1,rows:[{...row}]}:{rowCount:0,rows:[]};
    }
    if(query.startsWith('SELECT purpose FROM private_evidence_access_audit')){
      const prior=audits.filter(item=>item.object_id===Number(params[0])&&item.action==='delete'&&item.outcome==='allowed').slice(-1);
      return{rowCount:prior.length,rows:prior.map(item=>({purpose:item.purpose}))};
    }
    if(query.startsWith("UPDATE private_evidence_objects SET retention_state='delete_requested'")){
      if(!row||Number(row.id)!==Number(params[0])||row.retention_state!=='active')return{rowCount:0,rows:[]};
      row.retention_state='delete_requested';
      return{rowCount:1,rows:[{id:row.id}]};
    }
    if(query.startsWith("UPDATE private_evidence_objects SET retention_state='deleted'")){
      if(!row||Number(row.id)!==Number(params[0])||row.retention_state!=='delete_requested')return{rowCount:0,rows:[]};
      row.retention_state='deleted';row.scan_status='deleted';
      return{rowCount:1,rows:[{id:row.id}]};
    }
    if(query.startsWith('INSERT INTO private_evidence_access_audit')){
      audits.push({
        object_id:Number(params[0]),actor_account_id:params[1]==null?null:Number(params[1]),
        action:params[2],purpose:params[3],source_type:params[4],source_id:params[5],
        outcome:params[6],detail:params[8]
      });
      return{rowCount:1,rows:[]};
    }
    throw new Error('Unexpected private-evidence deletion SQL: '+query);
  };
  const pool={
    connect:async()=>({query:execute,release:error=>releases.push(error?.message||null)}),
    query:execute
  };
  return{pool,row,audits,releases};
}
const pendingEvidence=overrides=>({
  id:23,object_key:'private-evidence/qa/objects/purchase_accounting/opaque-test-key',
  owner_account_id:9,created_by_account_id:9,source_type:'merchant_purchase_document',
  source_id:'pending',original_file_name:'receipt.pdf',retention_state:'active',scan_status:'clean',
  ...overrides
});

test('private evidence deletion respects retention holds and refuses bound real purchase evidence',async()=>{
  let storageDeletes=0;
  const held=makePrivateEvidenceDeleteHarness(pendingEvidence({retention_state:'hold'}));
  await assert.rejects(
    ()=>deletePrivateEvidence(held.pool,{objectId:23,actorAccountId:9,purpose:'failed_purchase_receipt_cleanup',env:configured,deleteObjectFn:async()=>{storageDeletes++}}),
    error=>error?.status===409&&error?.code==='PRIVATE_EVIDENCE_RETENTION_HOLD'
  );
  assert.equal(storageDeletes,0,'a held object never reaches object storage deletion');
  assert.equal(held.row.retention_state,'hold','hold state is preserved');
  assert.equal(held.audits.at(-1)?.outcome,'denied','hold denial is audited');

  const bound=makePrivateEvidenceDeleteHarness(pendingEvidence({
    source_id:'57',original_file_name:'real-purchase-receipt.pdf'
  }));
  await assert.rejects(
    ()=>deletePrivateEvidence(bound.pool,{objectId:23,actorAccountId:9,purpose:'failed_purchase_receipt_cleanup',env:configured,deleteObjectFn:async()=>{storageDeletes++}}),
    error=>error?.status===409&&error?.code==='PRIVATE_EVIDENCE_DELETE_NOT_ALLOWED'
  );
  assert.equal(storageDeletes,0,'a bound real purchase receipt cannot be deleted by cleanup');
  assert.equal(bound.row.retention_state,'active','bound receipt remains active');
  assert.equal(bound.audits.at(-1)?.outcome,'denied','bound-evidence denial is audited');
});

test('private evidence cleanup marks delete_requested before storage and finalizes only after success',async()=>{
  const harness=makePrivateEvidenceDeleteHarness(pendingEvidence());
  let calls=0;
  const result=await deletePrivateEvidence(harness.pool,{
    objectId:23,actorAccountId:9,purpose:'failed_purchase_receipt_cleanup',env:configured,
    deleteObjectFn:async(config,key)=>{calls++;assert.equal(config.ready,true);assert.equal(key,harness.row.object_key)}
  });
  assert.equal(result,true);
  assert.equal(calls,1);
  assert.equal(harness.row.retention_state,'deleted');
  assert.equal(harness.row.scan_status,'deleted');
  assert.deepEqual(harness.audits.map(item=>item.outcome),['allowed','deleted']);
});

test('failed object-store deletion stays delete_requested and can be retried without a false deleted audit',async()=>{
  const harness=makePrivateEvidenceDeleteHarness(pendingEvidence());
  let calls=0;
  await assert.rejects(
    ()=>deletePrivateEvidence(harness.pool,{
      objectId:23,actorAccountId:9,purpose:'failed_purchase_receipt_cleanup',env:configured,
      deleteObjectFn:async()=>{calls++;throw Object.assign(new Error('storage unavailable'),{code:'PRIVATE_EVIDENCE_STORAGE_UNAVAILABLE'})}
    }),
    error=>error?.code==='PRIVATE_EVIDENCE_STORAGE_UNAVAILABLE'
  );
  assert.equal(harness.row.retention_state,'delete_requested','failed storage deletion remains explicitly pending');
  assert.equal(harness.row.scan_status,'clean','failure is not mislabeled as deleted');
  assert.equal(harness.audits.some(item=>item.outcome==='failed'),true,'storage failure is audited');
  assert.equal(harness.audits.some(item=>item.outcome==='deleted'),false,'storage failure never claims deletion');

  const retried=await deletePrivateEvidence(harness.pool,{
    objectId:23,actorAccountId:9,purpose:'failed_purchase_receipt_cleanup',env:configured,
    deleteObjectFn:async()=>{calls++}
  });
  assert.equal(retried,true);
  assert.equal(calls,2);
  assert.equal(harness.row.retention_state,'deleted');
  assert.equal(harness.audits.filter(item=>item.outcome==='deleted').length,1);
});

test('only exact QA fixture cleanup may remove a bound synthetic receipt object',async()=>{
  const harness=makePrivateEvidenceDeleteHarness(pendingEvidence({
    source_type:'merchant_purchase_document_attachment',source_id:'41',
    original_file_name:'qa856-support-20261115.png'
  }));
  const result=await deletePrivateEvidence(harness.pool,{
    objectId:23,actorAccountId:9,purpose:'qa_856_fixture_cleanup',env:configured,
    deleteObjectFn:async()=>{}
  });
  assert.equal(result,true);
  assert.equal(harness.row.retention_state,'deleted');
  assert.equal(harness.audits.at(-1)?.outcome,'deleted');
});

test('private evidence cleanup fails closed when storage configuration is missing',async()=>{
  const harness=makePrivateEvidenceDeleteHarness(pendingEvidence());
  await assert.rejects(
    ()=>deletePrivateEvidence(harness.pool,{
      objectId:23,actorAccountId:9,purpose:'failed_purchase_receipt_cleanup',
      env:{APP_ENV:'qa-test',PRIVATE_EVIDENCE_REQUIRED:'true'}
    }),
    error=>error?.status===503&&error?.code==='PRIVATE_EVIDENCE_CONFIG_MISSING'
  );
  assert.equal(harness.row.retention_state,'active');
  assert.equal(harness.audits.length,0);
});
