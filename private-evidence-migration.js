import pg from 'pg';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {
  bindPrivateEvidenceSource,deletePrivateEvidence,ensurePrivateEvidenceSchema,
  recordPrivateEvidenceAudit,storePrivateEvidence
} from './private-evidence-core.js';

const {Pool}=pg;
const clean=(v,max=180)=>String(v??'').trim().slice(0,max);
const MIME_EXT=Object.freeze({
  'application/pdf':'pdf',
  'image/jpeg':'jpg',
  'image/png':'png',
  'image/webp':'webp',
  'text/plain':'txt',
  'text/markdown':'md',
  'application/msword':'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx',
  'audio/webm':'webm',
  'audio/wav':'wav',
  'audio/x-wav':'wav',
  'audio/mpeg':'mp3',
  'audio/mp4':'m4a',
  'audio/x-m4a':'m4a',
  'audio/ogg':'ogg',
  'audio/aac':'aac',
  'audio/3gpp':'3gp'
});
const IMAGE_MIMES=['image/jpeg','image/png','image/webp'];
const APP_MIMES=['application/pdf',...IMAGE_MIMES];
const SUPPORT_DOC_MIMES=[
  'application/pdf','application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/markdown','text/plain'
];
const SUPPORT_AUDIO_MIMES=[
  'audio/webm','audio/ogg','audio/mpeg','audio/mp4','audio/wav','audio/x-wav','audio/aac','audio/3gpp'
];
const SUPPORT_MIMES=[...IMAGE_MIMES,...SUPPORT_DOC_MIMES,...SUPPORT_AUDIO_MIMES];

function dataMime(dataUrl){
  const m=String(dataUrl||'').match(/^data:([^;,]+);base64,/i);
  return String(m?.[1]||'').toLowerCase();
}
function safeStem(value,fallback){
  const stem=clean(value,120).replace(/[^a-z0-9._-]+/gi,'-').replace(/^-+|-+$/g,'');
  return stem||fallback;
}
export function legacyFileName(preferred,dataUrl,fallback='private-evidence'){
  const mime=dataMime(dataUrl),ext=MIME_EXT[mime];
  if(!ext)return clean(preferred,220)||fallback;
  const name=clean(preferred,220);
  if(!name)return `${safeStem(fallback,'private-evidence')}.${ext}`;
  if(!/\.[a-z0-9]{1,8}$/i.test(name))return `${name}.${ext}`;
  return name;
}
function maxForSupport(kind){
  return kind==='image'?1_500_000:kind==='audio'?10_000_000:5_000_000;
}

export async function ensureLegacyPrivateEvidenceColumns(db){
  await ensurePrivateEvidenceSchema(db);
  await db.query(`
    ALTER TABLE incident_attachments ALTER COLUMN evidence_data_url DROP NOT NULL;
    ALTER TABLE incident_attachments ADD COLUMN IF NOT EXISTS private_evidence_object_id BIGINT REFERENCES private_evidence_objects(id);

    ALTER TABLE support_attachments ALTER COLUMN data_url DROP NOT NULL;
    ALTER TABLE support_attachments ADD COLUMN IF NOT EXISTS private_evidence_object_id BIGINT REFERENCES private_evidence_objects(id);

    ALTER TABLE courier_documents ALTER COLUMN evidence_data_url DROP NOT NULL;
    ALTER TABLE courier_documents ADD COLUMN IF NOT EXISTS private_evidence_object_id BIGINT REFERENCES private_evidence_objects(id);

    ALTER TABLE profile_application_documents ALTER COLUMN evidence_data_url DROP NOT NULL;
    ALTER TABLE profile_application_documents ADD COLUMN IF NOT EXISTS private_evidence_object_id BIGINT REFERENCES private_evidence_objects(id);

    ALTER TABLE profile_credentials ALTER COLUMN evidence_data_url DROP NOT NULL;
    ALTER TABLE profile_credentials ADD COLUMN IF NOT EXISTS private_evidence_object_id BIGINT REFERENCES private_evidence_objects(id);

    ALTER TABLE service_provider_profiles ALTER COLUMN cv_private_data_url DROP NOT NULL;
    ALTER TABLE service_provider_profiles ADD COLUMN IF NOT EXISTS cv_private_evidence_object_id BIGINT REFERENCES private_evidence_objects(id);
  `);
}

async function migrateOne(db,{
  row,dataUrl,fileName,allowedMimes,maxBytes,ownerAccountId,sourceType,sourceId,
  classification,updateSql,updateArgs=[],env
}){
  let stored=null;
  try{
    stored=await storePrivateEvidence(db,{
      dataUrl,fileName,allowedMimes,maxBytes,ownerAccountId,actorAccountId:null,
      sourceType,sourceId:`pending:${sourceId}`,purpose:'legacy_private_evidence_migration',
      classification,correlationId:'private-evidence-v1-migration',env
    });
    await bindPrivateEvidenceSource(db,{
      objectId:stored.id,sourceType,sourceId:String(sourceId),
      actorAccountId:null,purpose:'legacy_private_evidence_migration_bind',
      correlationId:'private-evidence-v1-migration'
    });
    const updated=await db.query(updateSql,[stored.id,...updateArgs]);
    if(!updated.rowCount){
      await deletePrivateEvidence(db,{
        objectId:stored.id,purpose:'legacy_private_evidence_migration_race_cleanup',
        correlationId:'private-evidence-v1-migration',env
      }).catch(()=>{});
      return{status:'skipped_race'};
    }
    await recordPrivateEvidenceAudit(db,{
      objectId:stored.id,action:'migration',purpose:'legacy_private_evidence_migration',
      sourceType,sourceId:String(sourceId),outcome:'allowed',
      correlationId:'private-evidence-v1-migration',detail:'legacy_data_url_cleared_after_object_storage'
    });
    return{status:'migrated',object_id:Number(stored.id)};
  }catch(error){
    if(stored?.id)await deletePrivateEvidence(db,{
      objectId:stored.id,purpose:'legacy_private_evidence_migration_rollback',
      correlationId:'private-evidence-v1-migration',env
    }).catch(()=>{});
    await recordPrivateEvidenceAudit(db,{
      objectId:stored?.id||null,action:'migration',purpose:'legacy_private_evidence_migration',
      sourceType,sourceId:String(sourceId),outcome:'failed',
      correlationId:'private-evidence-v1-migration',detail:clean(error?.code||error?.message||'migration_failed',180)
    }).catch(()=>{});
    if(Number(error?.status)===503)throw error;
    return{status:error?.code==='PRIVATE_EVIDENCE_MALWARE_DETECTED'?'quarantined':'failed',code:error?.code||'MIGRATION_FAILED'};
  }
}

async function migrateRows(rows,fn,summary,key){
  for(const row of rows){
    const result=await fn(row);
    summary[key].attempted++;
    summary[key][result.status]=(summary[key][result.status]||0)+1;
  }
}

export async function legacyPrivateEvidenceCounts(db){
  const queries={
    incident:`SELECT COUNT(*)::int n FROM incident_attachments WHERE private_evidence_object_id IS NULL AND NULLIF(evidence_data_url,'') IS NOT NULL`,
    support:`SELECT COUNT(*)::int n FROM support_attachments WHERE private_evidence_object_id IS NULL AND NULLIF(data_url,'') IS NOT NULL`,
    courier:`SELECT COUNT(*)::int n FROM courier_documents WHERE private_evidence_object_id IS NULL AND NULLIF(evidence_data_url,'') IS NOT NULL`,
    application:`SELECT COUNT(*)::int n FROM profile_application_documents WHERE private_evidence_object_id IS NULL AND NULLIF(evidence_data_url,'') IS NOT NULL`,
    credential:`SELECT COUNT(*)::int n FROM profile_credentials WHERE private_evidence_object_id IS NULL AND NULLIF(evidence_data_url,'') IS NOT NULL`,
    cv:`SELECT COUNT(*)::int n FROM service_provider_profiles WHERE cv_private_evidence_object_id IS NULL AND NULLIF(cv_private_data_url,'') IS NOT NULL`
  };
  const out={};
  for(const [key,sql] of Object.entries(queries))out[key]=Number((await db.query(sql)).rows[0]?.n||0);
  out.total=Object.values(out).reduce((a,b)=>a+Number(b||0),0);
  return out;
}

export async function migratePrivateEvidenceV1(db,{env=process.env,limit=500}={}){
  await ensureLegacyPrivateEvidenceColumns(db);
  const summary={
    incident:{attempted:0},support:{attempted:0},courier:{attempted:0},
    application:{attempted:0},credential:{attempted:0},cv:{attempted:0}
  };
  const cap=Math.max(1,Math.min(5000,Number(limit)||500));

  const incident=(await db.query(`
    SELECT id,incident_id,kind,mime_type,file_name,byte_size,evidence_data_url
      FROM incident_attachments
     WHERE private_evidence_object_id IS NULL AND NULLIF(evidence_data_url,'') IS NOT NULL
     ORDER BY id LIMIT $1
  `,[cap])).rows;
  await migrateRows(incident,row=>migrateOne(db,{
    row,dataUrl:row.evidence_data_url,
    fileName:legacyFileName(row.file_name,row.evidence_data_url,`incident-${row.id}`),
    allowedMimes:APP_MIMES,maxBytes:row.kind==='image'?1_500_000:3_000_000,
    ownerAccountId:null,sourceType:'incident_attachment',sourceId:row.id,classification:'incident_evidence',
    updateSql:`UPDATE incident_attachments SET private_evidence_object_id=$1,evidence_data_url=NULL WHERE id=$2 AND private_evidence_object_id IS NULL AND NULLIF(evidence_data_url,'') IS NOT NULL RETURNING id`,
    updateArgs:[row.id],env
  }),summary,'incident');

  const support=(await db.query(`
    SELECT a.id,a.ticket_id,a.kind,a.mime_type,a.file_name,a.byte_size,a.data_url,t.requester_account_id
      FROM support_attachments a JOIN support_tickets t ON t.id=a.ticket_id
     WHERE a.private_evidence_object_id IS NULL AND NULLIF(a.data_url,'') IS NOT NULL
     ORDER BY a.id LIMIT $1
  `,[cap])).rows;
  await migrateRows(support,row=>migrateOne(db,{
    row,dataUrl:row.data_url,fileName:legacyFileName(row.file_name,row.data_url,`support-${row.id}`),
    allowedMimes:SUPPORT_MIMES,maxBytes:maxForSupport(row.kind),ownerAccountId:row.requester_account_id,
    sourceType:'support_attachment',sourceId:row.id,classification:row.kind==='audio'?'support_voice_evidence':'support_attachment',
    updateSql:`UPDATE support_attachments SET private_evidence_object_id=$1,data_url=NULL WHERE id=$2 AND private_evidence_object_id IS NULL AND NULLIF(data_url,'') IS NOT NULL RETURNING id`,
    updateArgs:[row.id],env
  }),summary,'support');

  const courier=(await db.query(`
    SELECT id,account_id,document_type,evidence_data_url
      FROM courier_documents
     WHERE private_evidence_object_id IS NULL AND NULLIF(evidence_data_url,'') IS NOT NULL
     ORDER BY id LIMIT $1
  `,[cap])).rows;
  await migrateRows(courier,row=>migrateOne(db,{
    row,dataUrl:row.evidence_data_url,
    fileName:legacyFileName('',row.evidence_data_url,`courier-${safeStem(row.document_type,'document')}-${row.id}`),
    allowedMimes:APP_MIMES,maxBytes:1_425_000,ownerAccountId:row.account_id,
    sourceType:'courier_document',sourceId:row.id,classification:'courier_document',
    updateSql:`UPDATE courier_documents SET private_evidence_object_id=$1,evidence_data_url=NULL WHERE id=$2 AND private_evidence_object_id IS NULL AND NULLIF(evidence_data_url,'') IS NOT NULL RETURNING id`,
    updateArgs:[row.id],env
  }),summary,'courier');

  const application=(await db.query(`
    SELECT d.id,d.application_id,d.document_type,d.label,d.evidence_data_url,a.account_id
      FROM profile_application_documents d JOIN profile_applications a ON a.id=d.application_id
     WHERE d.private_evidence_object_id IS NULL AND NULLIF(d.evidence_data_url,'') IS NOT NULL
     ORDER BY d.id LIMIT $1
  `,[cap])).rows;
  await migrateRows(application,row=>migrateOne(db,{
    row,dataUrl:row.evidence_data_url,
    fileName:legacyFileName('',row.evidence_data_url,`application-${safeStem(row.label||row.document_type,'document')}-${row.id}`),
    allowedMimes:APP_MIMES,maxBytes:2_100_000,ownerAccountId:row.account_id,
    sourceType:'profile_application_document',sourceId:row.id,classification:'profile_application_document',
    updateSql:`UPDATE profile_application_documents SET private_evidence_object_id=$1,evidence_data_url=NULL WHERE id=$2 AND private_evidence_object_id IS NULL AND NULLIF(evidence_data_url,'') IS NOT NULL RETURNING id`,
    updateArgs:[row.id],env
  }),summary,'application');

  const credential=(await db.query(`
    SELECT id,account_id,title,evidence_data_url
      FROM profile_credentials
     WHERE private_evidence_object_id IS NULL AND NULLIF(evidence_data_url,'') IS NOT NULL
     ORDER BY id LIMIT $1
  `,[cap])).rows;
  await migrateRows(credential,row=>migrateOne(db,{
    row,dataUrl:row.evidence_data_url,
    fileName:legacyFileName('',row.evidence_data_url,`credential-${safeStem(row.title,'evidence')}-${row.id}`),
    allowedMimes:APP_MIMES,maxBytes:1_425_000,ownerAccountId:row.account_id,
    sourceType:'service_credential',sourceId:row.id,classification:'service_credential',
    updateSql:`UPDATE profile_credentials SET private_evidence_object_id=$1,evidence_data_url=NULL WHERE id=$2 AND private_evidence_object_id IS NULL AND NULLIF(evidence_data_url,'') IS NOT NULL RETURNING id`,
    updateArgs:[row.id],env
  }),summary,'credential');

  const cv=(await db.query(`
    SELECT account_id,cv_private_data_url
      FROM service_provider_profiles
     WHERE cv_private_evidence_object_id IS NULL AND NULLIF(cv_private_data_url,'') IS NOT NULL
     ORDER BY account_id LIMIT $1
  `,[cap])).rows;
  await migrateRows(cv,row=>migrateOne(db,{
    row,dataUrl:row.cv_private_data_url,
    fileName:legacyFileName('',row.cv_private_data_url,`service-provider-cv-${row.account_id}`),
    allowedMimes:APP_MIMES,maxBytes:1_425_000,ownerAccountId:row.account_id,
    sourceType:'service_provider_cv',sourceId:row.account_id,classification:'service_provider_cv',
    updateSql:`UPDATE service_provider_profiles SET cv_private_evidence_object_id=$1,cv_private_data_url=NULL,updated_at=NOW() WHERE account_id=$2 AND cv_private_evidence_object_id IS NULL AND NULLIF(cv_private_data_url,'') IS NOT NULL RETURNING account_id`,
    updateArgs:[row.account_id],env
  }),summary,'cv');

  summary.remaining=await legacyPrivateEvidenceCounts(db);
  summary.migrated=Object.values(summary).filter(x=>x&&typeof x==='object'&&'attempted'in x).reduce((n,x)=>n+Number(x.migrated||0),0);
  summary.failed=Object.values(summary).filter(x=>x&&typeof x==='object'&&'attempted'in x).reduce((n,x)=>n+Number(x.failed||0)+Number(x.quarantined||0),0);
  return summary;
}

async function runCli(){
  const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL?{rejectUnauthorized:false}:undefined});
  try{
    if(!['1','true','yes','on'].includes(String(process.env.PRIVATE_EVIDENCE_MIGRATE_LEGACY||'').toLowerCase())){
      throw new Error('Set PRIVATE_EVIDENCE_MIGRATE_LEGACY=true to run the legacy private-evidence migration.');
    }
    const summary=await migratePrivateEvidenceV1(pool,{env:process.env,limit:process.env.PRIVATE_EVIDENCE_MIGRATION_LIMIT||500});
    console.log('PRIVATE_EVIDENCE_MIGRATION_RESULT '+JSON.stringify(summary));
    if(summary.failed||summary.remaining.total)process.exitCode=2;
  }finally{await pool.end().catch(()=>{})}
}
const direct=Boolean(process.argv[1])&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(direct)runCli().catch(error=>{console.error('PRIVATE_EVIDENCE_MIGRATION_FAILED',error?.code||error?.message||error);process.exitCode=1});
