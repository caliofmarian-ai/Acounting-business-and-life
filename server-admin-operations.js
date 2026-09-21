import express from 'express';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADMIN_PERMISSIONS, ensureAdminSchema, getAdminAssignments, hasAdminPermission,
  requireAdminPermission, visibleTerritoryIds, signAdminAssertion, appendAdminAudit
} from './admin-authorization.js';
import {startEmbeddedBusinessAccounting,stopEmbeddedBusinessAccounting} from './server-business-accounting.js';
import {publicAdminCatalog,canDelegateRank,expandAdminFunctions,isFunctionAssignableToRole,rankLevel} from './admin-functions.js';
import {ensureAdminFinanceSchema,adminFinanceSummary,listAdminBudgets,createAdminBudget,createAdminFinanceEntry,ADMIN_FINANCE_ENTRY_TYPES,ADMIN_FINANCE_CATEGORIES,ADMIN_BUDGET_CATEGORIES} from './admin-finance-core.js';
import {buildSessionBootstrap} from './session-bootstrap-core.js';

const { Pool }=pg;
const __dirname=dirname(fileURLToPath(import.meta.url));
const app=express();
const port=Number(process.env.PORT||3000);
const upstreamPort=Number(process.env.INTERNAL_PROFILE_GOVERNANCE_PORT||4107);
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL?{rejectUnauthorized:false}:undefined});
const TOKEN_SECRET=process.env.TOKEN_SECRET||'';
const body=express.json({limit:'28mb'});
const SUPPORT_STATUSES=new Set(['new','triaged','assigned','waiting_user','waiting_internal','resolved','closed','reopened']);
const SUPPORT_PRIORITIES=new Set(['low','normal','high','urgent']);
const PRIVACY_SUPPORT_CATEGORIES=new Set(['privacy_objection','privacy_access','privacy_correction','privacy_erasure_blocking','privacy_other_request']);
const SUPPORT_CATEGORIES=new Set(['auth','marketplace_order','payment','merchant_onboarding','supplier_onboarding','delivery','service_provider','accounting','tax_documents','technical_bug','other',...PRIVACY_SUPPORT_CATEGORIES]);
const SUPPORT_DESTINATIONS=new Set(['support','territory_admin','country_admin','platform_admin']);
const SUPPORT_IMAGE_MIMES=new Set(['image/jpeg','image/png','image/webp']);
const SUPPORT_DOC_MIMES=new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/markdown','text/plain'
]);
const SUPPORT_AUDIO_MIMES=new Set([
  'audio/webm','audio/ogg','audio/mpeg','audio/mp4','audio/wav','audio/x-wav','audio/aac','audio/3gpp'
]);
const MAX_SUPPORT_IMAGE_BYTES=1_500_000;
const MAX_SUPPORT_DOC_BYTES=5_000_000;
const MAX_SUPPORT_AUDIO_BYTES=10_000_000;
const MAX_SUPPORT_TOTAL_BYTES=22_000_000;
const SUPPORT_AI_PROVIDER=String(process.env.SUPPORT_AI_PROVIDER||'').toLowerCase();
const OPENAI_API_KEY=process.env.OPENAI_API_KEY||'';
const SUPPORT_AI_TRANSCRIPTION_MODEL=String(process.env.SUPPORT_AI_TRANSCRIPTION_MODEL||'gpt-4o-mini-transcribe').trim().slice(0,120);
const SUPPORT_AI_TRANSLATION_MODEL=String(process.env.SUPPORT_AI_TRANSLATION_MODEL||'gpt-5.6-luna').trim().slice(0,120);
const SUPPORT_AI_DRAFT_MODEL=String(process.env.SUPPORT_AI_DRAFT_MODEL||SUPPORT_AI_TRANSLATION_MODEL).trim().slice(0,120);
function decodeSupportDataUrl(dataUrl){
  const raw=String(dataUrl||'');
  if(!raw.startsWith('data:'))throw Object.assign(new Error('Attachment must be a valid base64 data URL'),{status:400});
  const comma=raw.indexOf(',');
  if(comma<6)throw Object.assign(new Error('Attachment must be a valid base64 data URL'),{status:400});
  const meta=raw.slice(5,comma),parts=meta.split(';').filter(Boolean);
  const mime=String(parts.shift()||'').toLowerCase();
  if(!mime||!parts.some(x=>x.toLowerCase()==='base64'))throw Object.assign(new Error('Attachment must be base64 encoded'),{status:400});
  const payload=raw.slice(comma+1);
  if(!/^[A-Za-z0-9+/=]+$/.test(payload))throw Object.assign(new Error('Attachment could not be decoded'),{status:400});
  let bytes;try{bytes=Buffer.from(payload,'base64')}catch{throw Object.assign(new Error('Attachment could not be decoded'),{status:400})}
  return{mime,bytes};
}

function validateSupportAttachments(raw){
  const files=Array.isArray(raw)?raw:[];
  if(files.length>9)throw Object.assign(new Error('Support allows up to 5 images, 3 documents and 1 audio recording'),{status:400});
  let images=0,docs=0,audio=0,total=0;
  const out=files.map((f,index)=>{
    const{mime,bytes}=decodeSupportDataUrl(f?.data_url);let kind='';
    if(SUPPORT_IMAGE_MIMES.has(mime)){kind='image';images++;if(bytes.length>MAX_SUPPORT_IMAGE_BYTES)throw Object.assign(new Error(`Image ${index+1} exceeds 1.5 MB`),{status:413})}
    else if(SUPPORT_DOC_MIMES.has(mime)){kind=mime==='application/pdf'?'pdf':mime==='text/markdown'||mime==='text/plain'?'markdown':'word';docs++;if(bytes.length>MAX_SUPPORT_DOC_BYTES)throw Object.assign(new Error(`Document ${index+1} exceeds 5 MB`),{status:413})}
    else if(SUPPORT_AUDIO_MIMES.has(mime)){kind='audio';audio++;if(bytes.length>MAX_SUPPORT_AUDIO_BYTES)throw Object.assign(new Error('Voice recording exceeds 10 MB'),{status:413})}
    else throw Object.assign(new Error('Support accepts JPEG/PNG/WebP, PDF, Word DOC/DOCX, Markdown/text and common audio formats'),{status:400});
    total+=bytes.length;
    return{kind,mime,file_name:clean(f?.file_name||`${kind}-${index+1}`,180),byte_size:bytes.length,data_url:String(f.data_url),transcript_text:clean(f?.transcript_text,12000),transcript_language:clean(f?.transcript_language,32),english_translation:clean(f?.english_translation,12000)};
  });
  if(images>5||docs>3||audio>1||total>MAX_SUPPORT_TOTAL_BYTES)throw Object.assign(new Error('Support attachment limits exceeded'),{status:413});
  return out;
}
function supportAiReady(){
  return SUPPORT_AI_PROVIDER==='openai'&&Boolean(OPENAI_API_KEY);
}
function responseTextFromOpenAI(payload){
  for(const item of Array.isArray(payload?.output)?payload.output:[]){
    if(item?.type!=='message'||!Array.isArray(item.content))continue;
    for(const part of item.content)if(part?.type==='output_text'&&part.text)return clean(part.text,12000);
  }
  return'';
}
async function translateSupportText(text,sourceLanguage=''){
  if(!supportAiReady())throw Object.assign(new Error('Server translation is not configured yet'),{status:503,code:'SUPPORT_AI_NOT_CONFIGURED'});
  const input=clean(text,12000);
  if(!input)throw Object.assign(new Error('Text is required for translation'),{status:400});
  const instruction='Translate the user support message faithfully into clear English. Preserve names, numbers, order IDs, URLs, amounts and technical terms. Do not add advice, commentary or explanations. Return only the English translation.';
  const r=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{Authorization:`Bearer ${OPENAI_API_KEY}`,'Content-Type':'application/json'},
    body:JSON.stringify({
      model:SUPPORT_AI_TRANSLATION_MODEL,
      store:false,
      input:[
        {role:'developer',content:[{type:'input_text',text:instruction}]},
        {role:'user',content:[{type:'input_text',text:`Source language: ${clean(sourceLanguage||'auto',32)}\n\n${input}`}]}
      ]
    })
  });
  const payload=await r.json().catch(()=>({}));
  if(!r.ok)throw Object.assign(new Error('Server translation provider failed'),{status:502,code:'SUPPORT_TRANSLATION_PROVIDER_FAILED'});
  const translated=responseTextFromOpenAI(payload);
  if(!translated)throw Object.assign(new Error('Translation provider returned no text'),{status:502,code:'SUPPORT_TRANSLATION_EMPTY'});
  return translated;
}
async function translateAdminSupportReply(text,targetLanguage='English',instruction=''){
  if(!supportAiReady())throw Object.assign(new Error('Support AI is not configured yet'),{status:503,code:'SUPPORT_AI_NOT_CONFIGURED'});
  const input=clean(text,3000),target=clean(targetLanguage,60),request=clean(instruction,300);
  if(!input)throw Object.assign(new Error('Write or dictate a reply before translating it'),{status:400});
  if(!target)throw Object.assign(new Error('Target language is required'),{status:400});
  const guardrail=`Translate the supplied administrator support reply faithfully into ${target}. Preserve names, numbers, order IDs, URLs, amounts and technical terms. Keep the original meaning and tone. Do not answer the message, add facts, advice, commentary, explanations or claim that anything was sent. Return only the translated editable reply text.`;
  const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:SUPPORT_AI_TRANSLATION_MODEL,store:false,input:[{role:'developer',content:[{type:'input_text',text:guardrail}]},{role:'user',content:[{type:'input_text',text:`Optional style instruction: ${request||'None'}\n\nReply to translate:\n${input}`}]}]})});
  const payload=await r.json().catch(()=>({}));
  if(!r.ok)throw Object.assign(new Error('Support translation provider failed'),{status:502,code:'SUPPORT_TRANSLATION_PROVIDER_FAILED'});
  const translation=responseTextFromOpenAI(payload);
  if(!translation)throw Object.assign(new Error('Support AI returned no translation'),{status:502,code:'SUPPORT_TRANSLATION_EMPTY'});
  return translation;
}
async function draftAdminSupportReply(ticket,messages=[],draft=''){
  if(!supportAiReady())throw Object.assign(new Error('Support AI is not configured yet'),{status:503,code:'SUPPORT_AI_NOT_CONFIGURED'});
  const context=(messages||[]).slice(-12).map(m=>`${m.actor_context==='admin'?'Support':'User'}: ${clean(m.message,3000)}`).join('\n');
  const instruction='Draft a concise, respectful customer-support reply in clear English. Use only the supplied ticket facts. Do not invent actions, refunds, deadlines, legal conclusions or technical results. Ask a focused question when evidence is missing. Return only the editable reply text; never claim it has been sent.';
  const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:SUPPORT_AI_DRAFT_MODEL,store:false,input:[{role:'developer',content:[{type:'input_text',text:instruction}]},{role:'user',content:[{type:'input_text',text:`Ticket subject: ${clean(ticket?.subject,180)}\nCategory: ${clean(ticket?.category,80)}\nDescription: ${clean(ticket?.description,5000)}\n\nConversation:\n${context||'No messages yet.'}\n\nAdmin notes for the draft:\n${clean(draft,3000)||'None'}`}]}]})});
  const payload=await r.json().catch(()=>({}));
  if(!r.ok)throw Object.assign(new Error('Support AI drafting provider failed'),{status:502,code:'SUPPORT_DRAFT_PROVIDER_FAILED'});
  const reply=responseTextFromOpenAI(payload);
  if(!reply)throw Object.assign(new Error('Support AI returned no draft'),{status:502,code:'SUPPORT_DRAFT_EMPTY'});
  return reply;
}
async function transcribeSupportAudio(dataUrl,fileName='voice-recording.webm',sourceLanguage=''){
  if(!supportAiReady())throw Object.assign(new Error('Server voice transcription is not configured yet'),{status:503,code:'SUPPORT_AI_NOT_CONFIGURED'});
  const {mime,bytes}=decodeSupportDataUrl(dataUrl);
  if(!SUPPORT_AUDIO_MIMES.has(mime))throw Object.assign(new Error('Unsupported voice recording format'),{status:400});
  if(bytes.length>MAX_SUPPORT_AUDIO_BYTES)throw Object.assign(new Error('Voice recording exceeds 10 MB'),{status:413});
  const form=new FormData();
  form.append('file',new Blob([bytes],{type:mime}),clean(fileName,180)||'voice-recording.webm');
  form.append('model',SUPPORT_AI_TRANSCRIPTION_MODEL);
  const r=await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:`Bearer ${OPENAI_API_KEY}`},body:form});
  const payload=await r.json().catch(()=>({}));
  if(!r.ok)throw Object.assign(new Error('Server voice transcription provider failed'),{status:502,code:'SUPPORT_TRANSCRIPTION_PROVIDER_FAILED'});
  const transcript=clean(payload?.text,12000);
  if(!transcript)throw Object.assign(new Error('Voice transcription returned no text'),{status:502,code:'SUPPORT_TRANSCRIPTION_EMPTY'});
  const english=/^en(?:-|$)/i.test(clean(sourceLanguage,32))?transcript:await translateSupportText(transcript,sourceLanguage||'auto');
  return{transcript,english_translation:english};
}

const INCIDENT_STATUSES=new Set(['submitted','triaged','investigating','awaiting_information','resolved','dismissed','escalated']);
let businessAccountingApp=null;let businessAccountingReady=false;let shuttingDown=false;

const clean=(v,max=1600)=>String(v??'').trim().slice(0,max);
const authHeader=req=>req.headers.authorization||'';
const correlation=req=>clean(req.headers['x-request-id']||req.headers['x-correlation-id']||'',120);
async function upstream(path,options={}){return fetch(`http://127.0.0.1:${upstreamPort}${path}`,options)}
async function identity(req){const r=await upstream('/api/me',{headers:{Authorization:authHeader(req)}});const b=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(b.error||'Unauthorized'),{status:r.status});return b}
function rolePermission(role){return role==='merchant'?'merchant.approve':role==='supplier'?'supplier.approve':role==='courier'?'courier.verify':'profiles.review_service_provider'}
const assignmentRank=a=>clean(a?.effective_rank||a?.authority_rank||a?.admin_role,40);
async function adminFor(req,permission,territoryId=null){const me=await identity(req);const assignment=await requireAdminPermission(pool,Number(me.account.id),permission,territoryId);return{me,assignment}}
async function isCountryWide(accountId,permission){const as=await getAdminAssignments(pool,accountId);for(const a of as){if(a.admin_role==='super_admin')return true;if(a.admin_role==='country_admin'){const p=new Set(Array.isArray(a.permissions)?a.permissions:[]);if(p.has(permission))return true}}return false}

async function initDb(){
  await ensureAdminSchema(pool);
  await ensureAdminFinanceSchema(pool);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id BIGSERIAL PRIMARY KEY,
      requester_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      country_code TEXT NOT NULL DEFAULT 'PH',
      territory_id BIGINT REFERENCES territories(id) ON DELETE SET NULL,
      category TEXT NOT NULL,
      subject TEXT NOT NULL,
      description TEXT NOT NULL,
      requested_destination TEXT NOT NULL DEFAULT 'support',
      source_language TEXT NOT NULL DEFAULT '',
      english_translation TEXT NOT NULL DEFAULT '',
      related_type TEXT NOT NULL DEFAULT '',
      related_id BIGINT,
      priority TEXT NOT NULL DEFAULT 'normal',
      status TEXT NOT NULL DEFAULT 'new',
      assigned_admin_account_id BIGINT REFERENCES accounts(id),
      resolution_reason TEXT NOT NULL DEFAULT '',
      linked_incident_id BIGINT REFERENCES incident_reports(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ,
      CHECK(priority IN ('low','normal','high','urgent')),
      CHECK(status IN ('new','triaged','assigned','waiting_user','waiting_internal','resolved','closed','reopened')),
      CHECK(requested_destination IN ('support','territory_admin','country_admin','platform_admin'))
    );
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS requested_destination TEXT NOT NULL DEFAULT 'support';
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS source_language TEXT NOT NULL DEFAULT '';
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS english_translation TEXT NOT NULL DEFAULT '';

    CREATE TABLE IF NOT EXISTS support_attachments (
      id BIGSERIAL PRIMARY KEY,
      ticket_id BIGINT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      byte_size INTEGER NOT NULL CHECK(byte_size>=0),
      data_url TEXT NOT NULL,
      transcript_text TEXT NOT NULL DEFAULT '',
      transcript_language TEXT NOT NULL DEFAULT '',
      english_translation TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(kind IN ('image','pdf','word','markdown','audio'))
    );
    CREATE INDEX IF NOT EXISTS support_attachments_ticket_idx ON support_attachments(ticket_id,id);
    CREATE INDEX IF NOT EXISTS support_tickets_scope_idx ON support_tickets(country_code,territory_id,status,updated_at DESC);
    CREATE INDEX IF NOT EXISTS support_tickets_requester_idx ON support_tickets(requester_account_id,created_at DESC);

    CREATE TABLE IF NOT EXISTS support_messages (
      id BIGSERIAL PRIMARY KEY,
      ticket_id BIGINT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
      actor_account_id BIGINT NOT NULL REFERENCES accounts(id),
      visibility TEXT NOT NULL DEFAULT 'user',
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(visibility IN ('user','internal'))
    );
    ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS actor_context TEXT NOT NULL DEFAULT 'user';
    UPDATE support_messages m SET actor_context='admin'
    WHERE m.actor_context='user' AND EXISTS (
      SELECT 1 FROM admin_audit_events e
      WHERE e.target_type='support_ticket' AND e.target_id=m.ticket_id::text
        AND e.actor_account_id=m.actor_account_id
        AND e.event_code IN ('support_user_reply','support_internal_note')
        AND ABS(EXTRACT(EPOCH FROM (e.created_at-m.created_at)))<=15
    );
    CREATE INDEX IF NOT EXISTS support_messages_ticket_idx ON support_messages(ticket_id,created_at,id);

    CREATE TABLE IF NOT EXISTS support_ticket_tags (
      ticket_id BIGINT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      created_by_account_id BIGINT REFERENCES accounts(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(ticket_id,tag)
    );

    CREATE TABLE IF NOT EXISTS admin_metric_snapshots (
      id BIGSERIAL PRIMARY KEY,
      country_code TEXT NOT NULL DEFAULT 'PH',
      territory_id BIGINT REFERENCES territories(id),
      metric_version TEXT NOT NULL DEFAULT 'v1',
      metrics_json JSONB NOT NULL,
      created_by_account_id BIGINT REFERENCES accounts(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS territory_id BIGINT REFERENCES territories(id);
    ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS support_ticket_id BIGINT REFERENCES support_tickets(id);
    CREATE INDEX IF NOT EXISTS incident_reports_territory_idx ON incident_reports(territory_id,status,updated_at DESC);

    UPDATE incident_reports i SET territory_id=b.territory_id
      FROM orders o JOIN businesses b ON b.id=o.business_id
      WHERE i.territory_id IS NULL AND i.related_type='order' AND i.related_id=o.id;
    UPDATE incident_reports i SET territory_id=b.territory_id
      FROM deliveries d JOIN orders o ON o.id=d.order_id JOIN businesses b ON b.id=o.business_id
      WHERE i.territory_id IS NULL AND i.related_type='delivery' AND i.related_id=d.id;
    UPDATE incident_reports i SET territory_id=b.territory_id
      FROM order_payments p JOIN orders o ON o.id=p.order_id JOIN businesses b ON b.id=o.business_id
      WHERE i.territory_id IS NULL AND i.related_type='payment' AND i.related_id=p.id;
  `);
}
async function inferTerritory(relatedType,relatedId,requested=null){
  if(requested){
    const t=await pool.query(`SELECT id FROM territories WHERE id=$1 AND country_code='PH' AND status NOT IN ('closed')`,[Number(requested)]);
    if(t.rowCount)return Number(t.rows[0].id);
  }
  if(!relatedId)return null;
  if(relatedType==='order'){const q=await pool.query(`SELECT b.territory_id FROM orders o JOIN businesses b ON b.id=o.business_id WHERE o.id=$1`,[relatedId]);return q.rows[0]?.territory_id?Number(q.rows[0].territory_id):null}
  if(relatedType==='delivery'){const q=await pool.query(`SELECT b.territory_id FROM deliveries d JOIN orders o ON o.id=d.order_id JOIN businesses b ON b.id=o.business_id WHERE d.id=$1`,[relatedId]);return q.rows[0]?.territory_id?Number(q.rows[0].territory_id):null}
  if(relatedType==='payment'){const q=await pool.query(`SELECT b.territory_id FROM order_payments p JOIN orders o ON o.id=p.order_id JOIN businesses b ON b.id=o.business_id WHERE p.id=$1`,[relatedId]);return q.rows[0]?.territory_id?Number(q.rows[0].territory_id):null}
  return null;
}
async function scopeClause(accountId,permission,column='territory_id'){
  const ids=await visibleTerritoryIds(pool,accountId,permission);
  const countryWide=await isCountryWide(accountId,permission);
  return{ids,countryWide,column};
}
function scopedWhere(scope,offset=1){
  if(scope.countryWide)return{sql:`(country_code='PH')`,args:[]};
  if(!scope.ids.length)return{sql:'FALSE',args:[]};
  return{sql:`${scope.column}=ANY($${offset}::bigint[])`,args:[scope.ids]};
}
async function unionPermissionScope(accountId,permissions){
  const ids=new Set();let countryWide=false;
  for(const permission of permissions){
    if(await isCountryWide(accountId,permission))countryWide=true;
    for(const id of await visibleTerritoryIds(pool,accountId,permission))ids.add(Number(id));
  }
  return{ids:[...ids],countryWide};
}

async function buildAdminScopeContext(accountId,seedAssignments=null){
  const assignments=seedAssignments||await getAdminAssignments(pool,accountId);
  const permissions=new Set();
  const superAdmin=assignments.some(a=>assignmentRank(a)==='super_admin');
  if(superAdmin)ADMIN_PERMISSIONS.forEach(p=>permissions.add(p));
  else for(const a of assignments)(Array.isArray(a.permissions)?a.permissions:[]).forEach(p=>permissions.add(p));
  const {rows:territories}=await pool.query(
    `SELECT id,country_code,parent_id,territory_type,name,code,status,created_at FROM territories ORDER BY id`
  );
  const byId=new Map(territories.map(t=>[Number(t.id),t]));
  const children=new Map();
  for(const t of territories){
    const parent=t.parent_id==null?null:Number(t.parent_id);
    if(!children.has(parent))children.set(parent,[]);
    children.get(parent).push(Number(t.id));
  }
  const descendantCache=new Map();
  function descendants(rootId){
    const root=Number(rootId);
    if(!Number.isFinite(root))return[];
    if(descendantCache.has(root))return descendantCache.get(root);
    const out=[],seen=new Set(),stack=[root];
    while(stack.length){
      const id=stack.pop();
      if(seen.has(id)||!byId.has(id))continue;
      seen.add(id);out.push(id);
      for(const child of children.get(id)||[])stack.push(child);
    }
    descendantCache.set(root,out);
    return out;
  }
  return{accountId:Number(accountId),assignments,permissions,superAdmin,territories,byId,descendants};
}
function scopeFromContext(ctx,permission,column='territory_id'){
  if(ctx.assignments.some(a=>a.admin_role==='super_admin')){
    return{ids:ctx.territories.filter(t=>t.country_code==='PH').map(t=>Number(t.id)),countryWide:true,column};
  }
  const ids=new Set();let countryWide=false;
  for(const a of ctx.assignments){
    const perms=new Set(Array.isArray(a.permissions)?a.permissions:[]);
    if(!perms.has(permission))continue;
    if(a.admin_role==='country_admin'){
      if(a.country_code==='PH')countryWide=true;
      for(const t of ctx.territories)if(t.country_code===a.country_code)ids.add(Number(t.id));
    }else if(a.admin_role==='territory_admin'&&a.territory_id){
      for(const id of ctx.descendants(a.territory_id))ids.add(Number(id));
    }
  }
  return{ids:[...ids],countryWide,column};
}
function adminFinanceScope(ctx,permission='admin.console'){
  const base=scopeFromContext(ctx,permission,'territory_id');
  const specialistFunctions=new Set();
  let hasNonSpecialist=false;
  for(const a of ctx.assignments){
    const perms=new Set(Array.isArray(a.permissions)?a.permissions:[]);
    if(a.admin_role!=='super_admin'&&!perms.has(permission))continue;
    const rank=assignmentRank(a);
    if(rank==='specialist'){
      for(const fn of Array.isArray(a.functions)?a.functions:[])specialistFunctions.add(String(fn));
    }else hasNonSpecialist=true;
  }
  return{
    countryWide:base.countryWide,
    territoryIds:base.ids,
    functionCodes:hasNonSpecialist||ctx.superAdmin?[]:[...specialistFunctions]
  };
}
function financeActorRank(ctx){
  return [...ctx.assignments].sort((a,b)=>rankLevel(assignmentRank(b))-rankLevel(assignmentRank(a)))[0]
    ?assignmentRank([...ctx.assignments].sort((a,b)=>rankLevel(assignmentRank(b))-rankLevel(assignmentRank(a)))[0])
    :'';
}
function unionScopeFromContext(ctx,permissions,column='territory_id'){
  const ids=new Set();let countryWide=false;
  for(const permission of permissions){
    const scope=scopeFromContext(ctx,permission,column);
    if(scope.countryWide)countryWide=true;
    for(const id of scope.ids)ids.add(Number(id));
  }
  return{ids:[...ids],countryWide,column};
}
function permissionFromContext(ctx,permission,territoryId=null){
  for(const a of ctx.assignments){
    const rank=assignmentRank(a);
    if(rank==='super_admin'||a.admin_role==='super_admin')return{allowed:true,assignment:a};
    const perms=new Set(Array.isArray(a.permissions)?a.permissions:[]);
    if(!perms.has(permission))continue;
    if(a.territory_id!=null){
      if(territoryId==null||ctx.descendants(a.territory_id).includes(Number(territoryId))){
        return{allowed:true,assignment:a};
      }
      continue;
    }
    if(a.country_code==='PH')return{allowed:true,assignment:a};
  }
  return{allowed:false,assignment:null};
}
function requirePermissionFromContext(ctx,permission,territoryId=null){
  const result=permissionFromContext(ctx,permission,territoryId);
  if(!result.allowed)throw Object.assign(new Error('Admin permission or territory scope is not available'),{status:403});
  return result.assignment;
}
function adminIdentityPayload(assignments,account=null){
  const permissions=new Set(),superAdmin=assignments.some(a=>assignmentRank(a)==='super_admin');
  if(superAdmin)ADMIN_PERMISSIONS.forEach(p=>permissions.add(p));
  else for(const a of assignments)(Array.isArray(a.permissions)?a.permissions:[]).forEach(p=>permissions.add(p));
  return{is_admin:assignments.length>0,assignments,permissions:[...permissions].sort(),account:account?{personal_id:account.personal_id,country_code:account.country_code,admin_profile_id:account.admin_profile_id,display_name:account.display_name}:undefined};
}
function adminMePayload(ctx,account=null){
  return adminIdentityPayload(ctx.assignments,account);
}
function adminCatalogPayload(ctx){
  if(!ctx.assignments.length)throw Object.assign(new Error('Admin assignment required'),{status:403});
  const highest=[...ctx.assignments].sort((a,b)=>rankLevel(assignmentRank(b))-rankLevel(assignmentRank(a)))[0];
  const catalog=publicAdminCatalog(),actorRank=assignmentRank(highest);
  const functions=catalog.functions.map(fn=>({...fn,can_delegate:ctx.superAdmin||fn.permissions.every(p=>ctx.permissions.has(p))}));
  const delegable_roles=catalog.ranks.filter(r=>canDelegateRank(actorRank,r.code)).map(r=>r.code);
  return{...catalog,functions,delegable_roles,actor_rank:actorRank};
}
async function adminSummaryFromContext(ctx){
  const supportPromise=ctx.permissions.has('support.manage')?(async()=>{
    const scope=scopeFromContext(ctx,'support.manage','territory_id'),ids=scope.ids.length?scope.ids:[-1];
    const q=await pool.query(
      `SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE status NOT IN ('resolved','closed'))::int open
       FROM support_tickets WHERE ${scope.countryWide?"country_code='PH'":"territory_id=ANY($1::bigint[])"}`,
      scope.countryWide?[]:[ids]
    );
    return q.rows[0];
  })():Promise.resolve(null);

  const incidentPromise=ctx.permissions.has('incident.triage')?(async()=>{
    const scope=scopeFromContext(ctx,'incident.triage','territory_id'),ids=scope.ids.length?scope.ids:[-1];
    const q=await pool.query(
      `SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE status NOT IN ('resolved','dismissed'))::int open
       FROM incident_reports WHERE ${scope.countryWide?"(territory_id IS NULL OR territory_id IN (SELECT id FROM territories WHERE country_code='PH'))":"territory_id=ANY($1::bigint[])"}`,
      scope.countryWide?[]:[ids]
    );
    return q.rows[0];
  })():Promise.resolve(null);

  const metricPermissions=['metrics.view','finance.summary.view'].filter(p=>ctx.permissions.has(p));
  const metricsPromise=metricPermissions.length?(async()=>{
    const scope=unionScopeFromContext(ctx,metricPermissions),ids=scope.ids.length?scope.ids:[-1];
    const [oq,dq,sq]=await Promise.all([
      pool.query(`SELECT COUNT(*)::int n FROM orders o JOIN businesses b ON b.id=o.business_id WHERE ${scope.countryWide?"b.country_code='PH'":"b.territory_id=ANY($1::bigint[])"}`,scope.countryWide?[]:[ids]),
      pool.query(`SELECT COUNT(*)::int n FROM deliveries d JOIN orders o ON o.id=d.order_id JOIN businesses b ON b.id=o.business_id WHERE ${scope.countryWide?"b.country_code='PH'":"b.territory_id=ANY($1::bigint[])"}`,scope.countryWide?[]:[ids]),
      pool.query(`SELECT COUNT(*)::int n FROM service_jobs j JOIN service_provider_profiles sp ON sp.account_id=j.provider_account_id LEFT JOIN profile_authorizations pa ON pa.account_id=sp.account_id AND pa.role='service_provider' AND pa.status='active' WHERE ${scope.countryWide?"TRUE":"pa.territory_id=ANY($1::bigint[])"}`,scope.countryWide?[]:[ids]).catch(()=>({rows:[{n:0}]}))
    ]);
    return{orders:Number(oq.rows[0]?.n||0),deliveries:Number(dq.rows[0]?.n||0),service_jobs:Number(sq.rows[0]?.n||0)};
  })():Promise.resolve({orders:null,deliveries:null,service_jobs:null});

  const [support,incidents,metrics]=await Promise.all([supportPromise,incidentPromise,metricsPromise]);
  return{support,incidents,...metrics};
}
async function adminOverview(accountId,seedContext=null){
  const ctx=seedContext||await buildAdminScopeContext(accountId);
  const {assignments,permissions}=ctx;
  const consoleScope=scopeFromContext(ctx,'admin.console','territory_id');
  const consoleIds=new Set(consoleScope.ids);
  const territories=(consoleScope.countryWide
    ?ctx.territories.filter(t=>t.country_code==='PH')
    :ctx.territories.filter(t=>consoleIds.has(Number(t.id))))
    .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));

  const profilePermissionByRole=new Map([
    ['merchant','merchant.approve'],
    ['supplier','supplier.approve'],
    ['courier','courier.verify'],
    ['service_provider','profiles.review_service_provider']
  ]);
  const invitationPermissionByRole=new Map([
    ['merchant','profiles.invite_merchant'],
    ['supplier','profiles.invite_supplier'],
    ['courier','profiles.invite_courier']
  ]);

  const summaryPromise=adminSummaryFromContext(ctx);
  const applicationTasks=[...profilePermissionByRole].filter(([,permission])=>permissions.has(permission)).map(async([role,permission])=>{
    const scope=scopeFromContext(ctx,permission,'pa.territory_id'),ids=scope.ids.length?scope.ids:[-1];
    const q=await pool.query(
      `SELECT pa.id,pa.account_id,pa.role,pa.territory_id,pa.status,pa.proposed_business_name,pa.submitted_at,pa.updated_at,
              a.display_name,a.email,t.name territory_name,
              (SELECT COUNT(*)::int FROM profile_application_documents d WHERE d.application_id=pa.id) document_count
       FROM profile_applications pa
       JOIN accounts a ON a.id=pa.account_id
       JOIN territories t ON t.id=pa.territory_id
       WHERE pa.role=$1 AND ${scope.countryWide?"t.country_code='PH'":"pa.territory_id=ANY($2::bigint[])"}
       ORDER BY pa.updated_at DESC LIMIT 150`,
      scope.countryWide?[role]:[role,ids]
    );
    return q.rows;
  });
  const invitationTasks=[...invitationPermissionByRole].filter(([,permission])=>permissions.has(permission)).map(async([role,permission])=>{
    const scope=scopeFromContext(ctx,permission,'i.territory_id'),ids=scope.ids.length?scope.ids:[-1];
    const q=await pool.query(
      `SELECT i.id,i.target_email,i.role,i.territory_id,i.status,i.expires_at,i.created_at,t.name territory_name
       FROM profile_invitations i JOIN territories t ON t.id=i.territory_id
       WHERE i.role=$1 AND ${scope.countryWide?"t.country_code='PH'":"i.territory_id=ANY($2::bigint[])"}
       ORDER BY i.created_at DESC LIMIT 100`,
      scope.countryWide?[role]:[role,ids]
    );
    return q.rows;
  });

  const authorizationPermissions=[];
  if(permissions.has('profile.suspend'))authorizationPermissions.push(['*','profile.suspend']);
  for(const [role,permission] of profilePermissionByRole)if(permissions.has(permission))authorizationPermissions.push([role,permission]);
  const authorizationTasks=authorizationPermissions.map(async([role,permission])=>{
    const scope=scopeFromContext(ctx,permission,'a.territory_id'),ids=scope.ids.length?scope.ids:[-1];
    const roleClause=role==='*'?'TRUE':'a.role=$1';
    const scopeClauseSql=scope.countryWide?"(t.country_code='PH' OR a.territory_id IS NULL)":`a.territory_id=ANY($${role==='*'?1:2}::bigint[])`;
    const args=role==='*'?(scope.countryWide?[]:[ids]):(scope.countryWide?[role]:[role,ids]);
    const q=await pool.query(
      `SELECT a.id,a.account_id,a.role,a.territory_id,a.status,a.approved_at,a.reason,
              ac.display_name,ac.email,t.name territory_name
       FROM profile_authorizations a
       JOIN accounts ac ON ac.id=a.account_id
       LEFT JOIN territories t ON t.id=a.territory_id
       WHERE ${roleClause} AND ${scopeClauseSql}
       ORDER BY a.updated_at DESC LIMIT 150`,
      args
    );
    return q.rows;
  });

  const [applicationGroups,invitationGroups,authorizationGroups,summary]=await Promise.all([
    Promise.all(applicationTasks),Promise.all(invitationTasks),Promise.all(authorizationTasks),summaryPromise
  ]);
  const applications=applicationGroups.flat();
  const invitations=invitationGroups.flat();
  const authorizationById=new Map();
  for(const rows of authorizationGroups)for(const row of rows)authorizationById.set(String(row.id),row);

  applications.sort((a,b)=>String(b.updated_at||'').localeCompare(String(a.updated_at||'')));
  invitations.sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
  const authorizations=[...authorizationById.values()].sort((a,b)=>String(b.approved_at||'').localeCompare(String(a.approved_at||'')));
  return{
    assignments,territories,
    applications:applications.slice(0,150),invitations:invitations.slice(0,100),authorizations:authorizations.slice(0,150),
    summary
  };
}

function dispatchBusinessAccounting(req,res,{headers={},afterSuccess=null}={}){
  if(!businessAccountingApp)return Promise.reject(Object.assign(new Error('Multi-business Accounting runtime is not ready'),{status:503}));
  const previousHeaders=new Map();
  for(const[key,value]of Object.entries(headers)){
    const normalized=key.toLowerCase();
    previousHeaders.set(normalized,req.headers[normalized]);
    if(value===undefined||value===null)delete req.headers[normalized];else req.headers[normalized]=String(value);
  }
  const chunks=[];let ended=false;
  const originalWrite=res.write.bind(res),originalEnd=res.end.bind(res);
  const restore=()=>{
    res.write=originalWrite;res.end=originalEnd;
    for(const[key,value]of previousHeaders.entries()){
      if(value===undefined)delete req.headers[key];else req.headers[key]=value;
    }
  };
  const capture=(chunk,encoding)=>{
    if(chunk==null)return;
    chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(String(chunk),typeof encoding==='string'?encoding:undefined));
  };
  return new Promise((resolve,reject)=>{
    res.write=function(chunk,encoding,cb){capture(chunk,encoding);if(typeof cb==='function')queueMicrotask(cb);return true};
    res.end=function(chunk,encoding,cb){
      if(ended)return res;ended=true;capture(chunk,encoding);
      const status=res.statusCode,payload=Buffer.concat(chunks);
      restore();
      Promise.resolve(status>=200&&status<400&&afterSuccess?afterSuccess(status):undefined).then(()=>{
        originalEnd(payload,typeof encoding==='string'?encoding:undefined,typeof cb==='function'?cb:undefined);
        resolve();
      }).catch(reject);
      return res;
    };
    businessAccountingApp.handle(req,res,err=>{
      if(ended)return;
      restore();
      if(err)return reject(err);
      reject(Object.assign(new Error('Multi-business Accounting runtime did not handle request'),{status:502}));
    });
  });
}

async function forwardAdmin(req,res,permission,territoryId,targetType='',targetId=''){
  const{me,assignment}=await adminFor(req,permission,territoryId);
  const scopedTerritoryId=territoryId??assignment.territory_id??null;
  const assertion=signAdminAssertion(TOKEN_SECRET,{accountId:me.account.id,permission,territoryId:scopedTerritoryId,assignmentId:assignment.id});
  return dispatchBusinessAccounting(req,res,{
    headers:{Authorization:authHeader(req),'Content-Type':'application/json','x-bl-admin-assertion':assertion},
    afterSuccess:!['GET','HEAD'].includes(req.method)?()=>appendAdminAudit(pool,{actorAccountId:me.account.id,assignmentId:assignment.id,permission,territoryId:scopedTerritoryId,targetType,targetId,eventCode:'admin_forwarded_action',after:{path:req.path,method:req.method},reason:clean(req.body?.reason||req.body?.note,800),correlationId:correlation(req)}):null
  });
}

app.get('/health',async(_req,res)=>{try{await pool.query('SELECT 1');const r=await upstream('/health');const ok=businessAccountingReady&&r.ok;res.status(ok?200:503).json({ok,db:true,upstream:ok,business_accounting:businessAccountingReady,profile_governance:r.ok,version:'0.10-admin-rbac-support'})}catch{res.status(503).json({ok:false,db:false,upstream:false,business_accounting:false,profile_governance:false,version:'0.10-admin-rbac-support'})}});
app.get('/admin-operations.css',(_q,res)=>res.type('text/css').send(readFileSync(join(__dirname,'public','admin-operations.css'),'utf8')));
app.get('/admin-operations-ui.js',(_q,res)=>res.type('application/javascript').send(readFileSync(join(__dirname,'public','admin-operations-ui.js'),'utf8')));
app.get('/admin-console.css',(_q,res)=>res.type('text/css').send(readFileSync(join(__dirname,'public','admin-console.css'),'utf8')));
app.get('/admin-console.js',(_q,res)=>res.type('application/javascript').send(readFileSync(join(__dirname,'public','admin-console.js'),'utf8')));
app.get('/admin',(_q,res)=>res.type('html').send(readFileSync(join(__dirname,'public','admin-console.html'),'utf8')));
app.get('/admin/',(_q,res)=>res.type('html').send(readFileSync(join(__dirname,'public','admin-console.html'),'utf8')));
async function root(req,res){const r=await upstream(req.path,{headers:{...req.headers,host:`127.0.0.1:${upstreamPort}`}});let html=await r.text();html=html.replace('</head>','  <link rel="stylesheet" href="/help-linking.css" />\n</head>').replace('</body>','  <script src="/help-linking.js"></script>\n</body>');res.status(r.status).type('html').send(html)}
app.get('/',root);app.get('/index.html',root);

app.get('/api/admin/me',async(req,res,next)=>{try{
  const me=await identity(req),assignments=await getAdminAssignments(pool,me.account.id);
  res.json(adminIdentityPayload(assignments,me.account));
}catch(e){next(e)}});
app.get('/api/session/bootstrap',async(req,res,next)=>{try{
  const me=await identity(req),assignments=await getAdminAssignments(pool,me.account.id);
  res.json(buildSessionBootstrap(me,adminIdentityPayload(assignments,me.account)));
}catch(e){next(e)}});
app.get('/api/admin/catalog',async(req,res,next)=>{try{
  const me=await identity(req),ctx=await buildAdminScopeContext(me.account.id);
  res.json(adminCatalogPayload(ctx));
}catch(e){next(e)}});
app.get('/api/admin/bootstrap',async(req,res,next)=>{try{
  const me=await identity(req),ctx=await buildAdminScopeContext(me.account.id);
  requirePermissionFromContext(ctx,'admin.console');
  const overview=await adminOverview(me.account.id,ctx);
  res.json({me:adminMePayload(ctx,me.account),catalog:adminCatalogPayload(ctx),overview});
}catch(e){next(e)}});
app.get('/api/admin/overview',async(req,res,next)=>{try{
  const me=await identity(req),ctx=await buildAdminScopeContext(me.account.id);
  requirePermissionFromContext(ctx,'admin.console');
  res.json(await adminOverview(me.account.id,ctx));
}catch(e){next(e)}});
app.get('/api/governance/admin/overview',async(req,res,next)=>{try{
  const me=await identity(req),ctx=await buildAdminScopeContext(me.account.id);
  requirePermissionFromContext(ctx,'admin.console');
  res.json(await adminOverview(me.account.id,ctx));
}catch(e){next(e)}});

app.get('/api/admin/delivery/pricing',(req,res,next)=>forwardAdmin(req,res,'delivery.pricing.manage',null,'delivery_pricing').catch(next));
app.put('/api/admin/delivery/pricing',body,(req,res,next)=>forwardAdmin(req,res,'delivery.pricing.manage',null,'delivery_pricing').catch(next));
app.get('/api/admin/couriers',(req,res,next)=>forwardAdmin(req,res,'courier.verify',null,'courier').catch(next));
app.get('/api/admin/couriers/:accountId',(req,res,next)=>forwardAdmin(req,res,'courier.verify',null,'courier',req.params.accountId).catch(next));
app.get('/api/admin/couriers/:accountId/documents/:documentId',(req,res,next)=>forwardAdmin(req,res,'courier.verify',null,'courier_document',req.params.documentId).catch(next));
app.patch('/api/admin/couriers/:accountId',body,(req,res,next)=>forwardAdmin(req,res,'courier.verify',null,'courier',req.params.accountId).catch(next));
app.get('/api/admin/deliveries',(req,res,next)=>forwardAdmin(req,res,'delivery.dispatch.manage',null,'delivery').catch(next));
app.get('/api/admin/delivery/eligible-couriers',(req,res,next)=>forwardAdmin(req,res,'delivery.dispatch.manage',null,'courier').catch(next));
app.post('/api/admin/deliveries/:id/assign',body,(req,res,next)=>forwardAdmin(req,res,'delivery.dispatch.manage',null,'delivery',req.params.id).catch(next));

app.get('/api/admin/assignments',async(req,res,next)=>{try{
  const me=await identity(req),mine=await getAdminAssignments(pool,me.account.id);
  const superAdmin=mine.some(a=>assignmentRank(a)==='super_admin');
  const canAssign=(await hasAdminPermission(pool,me.account.id,'admin.assign_limited')).allowed||(await hasAdminPermission(pool,me.account.id,'admin.delegate')).allowed;
  if(!canAssign&&!superAdmin)throw Object.assign(new Error('Admin assignment visibility requires delegation permission'),{status:403});
  const select="SELECT a.*,COALESCE(NULLIF(a.authority_rank,''),a.admin_role) effective_rank,ac.display_name,ac.email,t.name territory_name,COALESCE((SELECT jsonb_agg(g.permission_code ORDER BY g.permission_code) FROM admin_permission_grants g WHERE g.assignment_id=a.id AND g.status='active'),'[]'::jsonb) permissions,COALESCE((SELECT jsonb_agg(f.function_code ORDER BY f.function_code) FROM admin_function_assignments f WHERE f.assignment_id=a.id AND f.status='active'),'[]'::jsonb) functions FROM platform_admin_assignments a JOIN accounts ac ON ac.id=a.account_id LEFT JOIN territories t ON t.id=a.territory_id";
  let rows;
  if(superAdmin){
    ({rows}=await pool.query(select+" WHERE a.country_code='PH' ORDER BY CASE COALESCE(NULLIF(a.authority_rank,''),a.admin_role) WHEN 'super_admin' THEN 0 WHEN 'country_admin' THEN 1 WHEN 'territory_admin' THEN 2 ELSE 3 END,a.created_at DESC"));
  }else{
    const countryManager=mine.some(a=>assignmentRank(a)==='country_admin'&&((a.permissions||[]).includes('admin.delegate')||(a.permissions||[]).includes('admin.assign_limited')));
    if(countryManager){
      ({rows}=await pool.query(select+" WHERE a.country_code='PH' AND COALESCE(NULLIF(a.authority_rank,''),a.admin_role) IN ('territory_admin','specialist') ORDER BY a.created_at DESC"));
    }else{
      const ids=[...new Set([...(await visibleTerritoryIds(pool,me.account.id,'admin.delegate')),...(await visibleTerritoryIds(pool,me.account.id,'admin.assign_limited'))])];
      ({rows}=await pool.query(select+" WHERE COALESCE(NULLIF(a.authority_rank,''),a.admin_role)='specialist' AND a.territory_id=ANY($1::bigint[]) ORDER BY a.created_at DESC",[ids.length?ids:[-1]]));
    }
  }
  res.json(rows);
}catch(e){next(e)}});

app.post('/api/admin/assignments',body,async(req,res,next)=>{try{
  const me=await identity(req),targetEmail=clean(req.body?.target_email,180).toLowerCase(),role=clean(req.body?.admin_role,40),territoryId=req.body?.territory_id?Number(req.body.territory_id):null;
  const functionCodes=[...new Set((Array.isArray(req.body?.function_codes)?req.body.function_codes:[]).map(x=>clean(x,100)).filter(Boolean))];
  if(!['country_admin','territory_admin','specialist'].includes(role)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail))return res.status(400).json({error:'Valid target email and delegated Admin rank required'});
  if(role==='territory_admin'&&!territoryId)return res.status(400).json({error:'Territory Admin requires a territory'});
  if(role==='country_admin'&&territoryId)return res.status(400).json({error:'Country Admin is country-scoped and must not use a territory id'});
  for(const code of functionCodes)if(!isFunctionAssignableToRole(code,role))return res.status(400).json({error:'Function is not assignable to this Admin rank: '+code});
  const explicit=(Array.isArray(req.body?.permissions)?req.body.permissions:[]).map(x=>clean(x,100)).filter(x=>ADMIN_PERMISSIONS.includes(x));
  const requested=[...new Set([...explicit,...expandAdminFunctions(functionCodes,role)])];
  if(role==='specialist'&&requested.some(p=>p==='admin.assign_limited'||p==='admin.delegate'))return res.status(400).json({error:'Specialist cannot receive Admin delegation authority'});
  if(role!=='super_admin'&&requested.includes('finance.owner_distribution.manage'))return res.status(400).json({error:'Owner distribution authority is reserved for Super Admin'});
  if(role==='specialist'&&!requested.length)return res.status(400).json({error:'Specialist requires at least one delegated function or permission'});
  let authority=await hasAdminPermission(pool,me.account.id,'admin.assign_limited',territoryId);
  if(!authority.allowed)authority=await hasAdminPermission(pool,me.account.id,'admin.delegate',territoryId);
  if(!authority.allowed)throw Object.assign(new Error('Admin delegation permission required'),{status:403});
  const actorRank=assignmentRank(authority.assignment);
  if(role==='country_admin'&&actorRank!=='super_admin')throw Object.assign(new Error('Only Super Admin can appoint a Country Admin'),{status:403});
  if(!canDelegateRank(actorRank,role))throw Object.assign(new Error('You cannot create or modify an Admin rank equal to or above your own delegated authority'),{status:403});
  if(territoryId){const t=await pool.query("SELECT id FROM territories WHERE id=$1 AND country_code='PH'",[territoryId]);if(!t.rowCount)return res.status(404).json({error:'Territory not found'})}
  const account=await pool.query('SELECT id,display_name,email FROM accounts WHERE LOWER(email)=$1',[targetEmail]);if(!account.rowCount)return res.status(404).json({error:'The target must create a Business & Life account first'});
  for(const p of requested){if(actorRank!=='super_admin'){const x=await hasAdminPermission(pool,me.account.id,p,territoryId);if(!x.allowed)return res.status(403).json({error:'You cannot delegate permission: '+p})}}
  const technicalRole=role==='specialist'?(territoryId?'territory_admin':'country_admin'):role;
  const existing=await pool.query(
    "SELECT id,COALESCE(NULLIF(authority_rank,''),admin_role) effective_rank FROM platform_admin_assignments WHERE account_id=$1 AND admin_role=$2 AND country_code='PH' AND COALESCE(territory_id,0)=COALESCE($3::bigint,0) LIMIT 1",
    [account.rows[0].id,technicalRole,territoryId]
  );
  if(existing.rowCount&&rankLevel(existing.rows[0].effective_rank)>rankLevel(role)){
    return res.status(409).json({error:'This account already holds a higher Admin rank in the same scope. Update the existing assignment instead of downgrading it.'});
  }
  const client=await pool.connect();try{
    await client.query('BEGIN');
    const q=await client.query("INSERT INTO platform_admin_assignments(account_id,admin_role,authority_rank,country_code,territory_id,status,assigned_by_account_id,reason) VALUES($1,$2,$3,'PH',$4,'active',$5,$6) ON CONFLICT(account_id,admin_role,country_code,COALESCE(territory_id,0)) DO UPDATE SET authority_rank=EXCLUDED.authority_rank,status='active',assigned_by_account_id=EXCLUDED.assigned_by_account_id,reason=EXCLUDED.reason,effective_until=NULL,updated_at=NOW() RETURNING *",[account.rows[0].id,technicalRole,role,territoryId,me.account.id,clean(req.body?.reason,1000)]);
    const a=q.rows[0];
    await client.query("UPDATE admin_permission_grants SET status='revoked',updated_at=NOW() WHERE assignment_id=$1",[a.id]);
    for(const p of requested)await client.query("INSERT INTO admin_permission_grants(assignment_id,permission_code,status,granted_by_account_id,reason) VALUES($1,$2,'active',$3,$4) ON CONFLICT(assignment_id,permission_code) DO UPDATE SET status='active',granted_by_account_id=EXCLUDED.granted_by_account_id,reason=EXCLUDED.reason,effective_until=NULL,updated_at=NOW()",[a.id,p,me.account.id,clean(req.body?.reason,500)]);
    await client.query("UPDATE admin_function_assignments SET status='revoked',updated_at=NOW() WHERE assignment_id=$1",[a.id]);
    for(const code of functionCodes)await client.query("INSERT INTO admin_function_assignments(assignment_id,function_code,status,granted_by_account_id,reason) VALUES($1,$2,'active',$3,$4) ON CONFLICT(assignment_id,function_code) DO UPDATE SET status='active',granted_by_account_id=EXCLUDED.granted_by_account_id,reason=EXCLUDED.reason,effective_until=NULL,updated_at=NOW()",[a.id,code,me.account.id,clean(req.body?.reason,500)]);
    await client.query('COMMIT');
    await appendAdminAudit(pool,{actorAccountId:me.account.id,assignmentId:authority.assignment.id,permission:'admin.assign_limited',territoryId,targetType:'admin_assignment',targetId:String(a.id),eventCode:'admin_assignment_created',after:{target_account_id:account.rows[0].id,role,technical_role:technicalRole,functions:functionCodes,permissions:requested},reason:req.body?.reason,correlationId:correlation(req)});
    res.status(201).json({...a,effective_rank:role,functions:functionCodes,permissions:requested,target:account.rows[0]});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
}catch(e){next(e)}});

app.put('/api/admin/assignments/:id/permissions',body,async(req,res,next)=>{try{
  const me=await identity(req),id=Number(req.params.id),q=await pool.query('SELECT * FROM platform_admin_assignments WHERE id=$1',[id]);
  if(!q.rowCount)return res.status(404).json({error:'Admin assignment not found'});
  const target=q.rows[0],targetRank=clean(target.authority_rank||target.admin_role,40);
  if(targetRank==='super_admin')return res.status(409).json({error:'Bootstrap Super Admin permissions are protected'});
  let authority=await hasAdminPermission(pool,me.account.id,'admin.assign_limited',target.territory_id);if(!authority.allowed)authority=await hasAdminPermission(pool,me.account.id,'admin.delegate',target.territory_id);
  if(!authority.allowed)throw Object.assign(new Error('Admin delegation permission required'),{status:403});
  const actorRank=assignmentRank(authority.assignment);
  if(!canDelegateRank(actorRank,targetRank))throw Object.assign(new Error('You cannot modify an Admin rank equal to or above your own delegated authority'),{status:403});
  const hasFunctions=Array.isArray(req.body?.function_codes);
  const functionCodes=[...new Set((hasFunctions?req.body.function_codes:[]).map(x=>clean(x,100)).filter(Boolean))];
  for(const code of functionCodes)if(!isFunctionAssignableToRole(code,targetRank))return res.status(400).json({error:'Function is not assignable to this Admin rank: '+code});
  const explicit=(Array.isArray(req.body?.permissions)?req.body.permissions:[]).map(x=>clean(x,100)).filter(x=>ADMIN_PERMISSIONS.includes(x));
  const requested=[...new Set([...explicit,...(hasFunctions?expandAdminFunctions(functionCodes,targetRank):[])])];
  if(targetRank==='specialist'&&requested.some(p=>p==='admin.assign_limited'||p==='admin.delegate'))return res.status(400).json({error:'Specialist cannot receive Admin delegation authority'});
  if(targetRank!=='super_admin'&&requested.includes('finance.owner_distribution.manage'))return res.status(400).json({error:'Owner distribution authority is reserved for Super Admin'});
  for(const p of requested){if(actorRank!=='super_admin'){const x=await hasAdminPermission(pool,me.account.id,p,target.territory_id);if(!x.allowed)return res.status(403).json({error:'You cannot delegate permission: '+p})}}
  const client=await pool.connect();try{
    await client.query('BEGIN');
    await client.query("UPDATE admin_permission_grants SET status='revoked',updated_at=NOW() WHERE assignment_id=$1",[id]);
    for(const p of requested)await client.query("INSERT INTO admin_permission_grants(assignment_id,permission_code,status,granted_by_account_id,reason) VALUES($1,$2,'active',$3,$4) ON CONFLICT(assignment_id,permission_code) DO UPDATE SET status='active',granted_by_account_id=EXCLUDED.granted_by_account_id,reason=EXCLUDED.reason,updated_at=NOW()",[id,p,me.account.id,clean(req.body?.reason,500)]);
    if(hasFunctions){
      await client.query("UPDATE admin_function_assignments SET status='revoked',updated_at=NOW() WHERE assignment_id=$1",[id]);
      for(const code of functionCodes)await client.query("INSERT INTO admin_function_assignments(assignment_id,function_code,status,granted_by_account_id,reason) VALUES($1,$2,'active',$3,$4) ON CONFLICT(assignment_id,function_code) DO UPDATE SET status='active',granted_by_account_id=EXCLUDED.granted_by_account_id,reason=EXCLUDED.reason,updated_at=NOW()",[id,code,me.account.id,clean(req.body?.reason,500)]);
    }
    await client.query('COMMIT');
    await appendAdminAudit(pool,{actorAccountId:me.account.id,assignmentId:authority.assignment.id,permission:'admin.assign_limited',territoryId:target.territory_id,targetType:'admin_assignment',targetId:String(id),eventCode:'admin_permissions_replaced',after:{functions:hasFunctions?functionCodes:undefined,permissions:requested},reason:req.body?.reason,correlationId:correlation(req)});
    res.json({ok:true,functions:hasFunctions?functionCodes:undefined,permissions:requested});
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
}catch(e){next(e)}});

app.post('/api/admin/assignments/:id/status',body,async(req,res,next)=>{try{
  const me=await identity(req),id=Number(req.params.id),status=clean(req.body?.status,30),q=await pool.query('SELECT * FROM platform_admin_assignments WHERE id=$1',[id]);
  if(!q.rowCount)return res.status(404).json({error:'Admin assignment not found'});
  const target=q.rows[0],targetRank=clean(target.authority_rank||target.admin_role,40);
  if(targetRank==='super_admin')return res.status(409).json({error:'Platform Owner Super Admin cannot be changed here'});
  if(!['active','suspended','revoked'].includes(status))return res.status(400).json({error:'Choose active, suspended or revoked'});
  let authority=await hasAdminPermission(pool,me.account.id,'admin.assign_limited',target.territory_id);if(!authority.allowed)authority=await hasAdminPermission(pool,me.account.id,'admin.delegate',target.territory_id);
  if(!authority.allowed)throw Object.assign(new Error('Admin delegation permission required'),{status:403});
  if(!canDelegateRank(assignmentRank(authority.assignment),targetRank))throw Object.assign(new Error('You cannot change the status of an Admin rank equal to or above your own delegated authority'),{status:403});
  await pool.query('UPDATE platform_admin_assignments SET status=$1,reason=$2,updated_at=NOW() WHERE id=$3',[status,clean(req.body?.reason,1000),id]);
  await appendAdminAudit(pool,{actorAccountId:me.account.id,assignmentId:authority.assignment.id,permission:'admin.assign_limited',territoryId:target.territory_id,targetType:'admin_assignment',targetId:String(id),eventCode:'admin_assignment_'+status,reason:req.body?.reason,correlationId:correlation(req)});
  res.json({ok:true,status});
}catch(e){next(e)}});

app.get('/api/admin/finance/operating',async(req,res,next)=>{try{
  const me=await identity(req),ctx=await buildAdminScopeContext(me.account.id);
  requirePermissionFromContext(ctx,'admin.console');
  const scope=adminFinanceScope(ctx,'admin.console');
  const [summary,budgets]=await Promise.all([
    adminFinanceSummary(pool,scope),
    listAdminBudgets(pool,scope)
  ]);
  res.json({
    actor_rank:financeActorRank(ctx),
    scope:{country_code:'PH',country_wide:scope.countryWide,territory_ids:scope.territoryIds,function_codes:scope.functionCodes},
    summary:summary.summary,authority:summary.authority,recent_entries:summary.recent_entries,budgets,
    catalog:{entry_types:ADMIN_FINANCE_ENTRY_TYPES,categories:ADMIN_FINANCE_CATEGORIES,budget_categories:ADMIN_BUDGET_CATEGORIES}
  });
}catch(e){next(e)}});

app.post('/api/admin/finance/budgets',body,async(req,res,next)=>{try{
  const me=await identity(req),ctx=await buildAdminScopeContext(me.account.id);
  const territoryId=req.body?.territory_id==null||req.body?.territory_id===''?null:Number(req.body.territory_id);
  const permission=permissionFromContext(ctx,'finance.budget.manage',territoryId);
  if(!permission.allowed)throw Object.assign(new Error('Budget management is outside your Admin finance authority'),{status:403});
  const rank=assignmentRank(permission.assignment),functions=Array.isArray(permission.assignment.functions)?permission.assignment.functions:[];
  const functionCode=clean(req.body?.function_code,100);
  if(rank==='specialist'&&!functionCode)throw Object.assign(new Error('Specialist budget requires its delegated function'),{status:400});
  if(rank==='specialist'&&!functions.includes(functionCode))throw Object.assign(new Error('Specialist cannot manage another function budget'),{status:403});
  const row=await createAdminBudget(pool,{
    budgetCategory:req.body?.budget_category,label:req.body?.label,allocatedAmount:req.body?.allocated_amount,
    territoryId,functionCode,periodStart:req.body?.period_start||null,periodEnd:req.body?.period_end||null,
    createdByAccountId:me.account.id
  });
  await appendAdminAudit(pool,{actorAccountId:me.account.id,assignmentId:permission.assignment.id,permission:'finance.budget.manage',territoryId,targetType:'admin_finance_budget',targetId:String(row.id),eventCode:'admin_finance_budget_created',after:{public_id:row.public_id,budget_category:row.budget_category,allocated_amount:row.allocated_amount,function_code:row.function_code},reason:req.body?.reason,correlationId:correlation(req)});
  res.status(201).json(row);
}catch(e){next(e)}});

app.post('/api/admin/finance/entries',body,async(req,res,next)=>{try{
  const me=await identity(req),ctx=await buildAdminScopeContext(me.account.id);
  const territoryId=req.body?.territory_id==null||req.body?.territory_id===''?null:Number(req.body.territory_id);
  const entryType=clean(req.body?.entry_type,40);
  const required=entryType==='owner_distribution'?'finance.owner_distribution.manage':'finance.ledger.manage';
  const permission=permissionFromContext(ctx,required,territoryId);
  if(!permission.allowed)throw Object.assign(new Error(entryType==='owner_distribution'?'Owner distribution requires Super Admin authority':'Finance ledger management is outside your Admin scope'),{status:403});
  const rank=assignmentRank(permission.assignment);
  if(entryType==='owner_distribution'&&rank!=='super_admin')throw Object.assign(new Error('Owner distribution is reserved for Super Admin'),{status:403});
  const functions=Array.isArray(permission.assignment.functions)?permission.assignment.functions:[];
  const functionCode=clean(req.body?.function_code,100);
  if(rank==='specialist'&&!functionCode)throw Object.assign(new Error('Specialist finance entry requires its delegated function'),{status:400});
  if(rank==='specialist'&&!functions.includes(functionCode))throw Object.assign(new Error('Specialist cannot record another function finance entry'),{status:403});
  const key=clean(req.headers['idempotency-key']||req.body?.entry_key,220);
  const row=await createAdminFinanceEntry(pool,{
    entryType,category:req.body?.category,amount:req.body?.amount,entryKey:key,territoryId,functionCode,
    occurredAt:req.body?.occurred_at||null,counterparty:req.body?.counterparty,evidenceReference:req.body?.evidence_reference,
    description:req.body?.description,providerCode:req.body?.provider_code,providerReference:req.body?.provider_reference,
    createdByAccountId:me.account.id
  });
  await appendAdminAudit(pool,{actorAccountId:me.account.id,assignmentId:permission.assignment.id,permission:required,territoryId,targetType:'admin_finance_entry',targetId:String(row.id),eventCode:'admin_finance_entry_created',after:{public_id:row.public_id,entry_type:row.entry_type,category:row.category,amount:row.amount,function_code:row.function_code},reason:req.body?.reason||req.body?.description,correlationId:correlation(req)});
  res.status(201).json(row);
}catch(e){next(e)}});

app.get('/api/admin/audit',async(req,res,next)=>{try{const{me}=await adminFor(req,'audit.view');const ids=await visibleTerritoryIds(pool,me.account.id,'audit.view'),countryWide=await isCountryWide(me.account.id,'audit.view'),limit=Math.max(1,Math.min(300,Number(req.query.limit)||100));const{rows}=await pool.query(`SELECT e.*,a.display_name actor_name FROM admin_audit_events e LEFT JOIN accounts a ON a.id=e.actor_account_id WHERE ${countryWide?"e.country_code='PH'":"e.territory_id=ANY($1::bigint[])"} ORDER BY e.created_at DESC LIMIT ${limit}`,countryWide?[]:[ids.length?ids:[-1]]);res.json(rows)}catch(e){next(e)}});

app.get('/api/support/assist/status',async(req,res,next)=>{try{
  await identity(req);
  res.json({
    server_assist_ready:supportAiReady(),
    provider:supportAiReady()?SUPPORT_AI_PROVIDER:'none',
    transcription:supportAiReady()?'ready':'not_configured',
    translation:supportAiReady()?'ready':'not_configured',
    browser_fallback:true
  });
}catch(e){next(e)}});

app.post('/api/support/assist/transcribe',body,async(req,res,next)=>{try{
  await identity(req);
  const result=await transcribeSupportAudio(req.body?.data_url,req.body?.file_name||'voice-recording.webm',req.body?.source_language||'');
  res.json({...result,provider:SUPPORT_AI_PROVIDER});
}catch(e){next(e)}});

app.post('/api/support/assist/translate',body,async(req,res,next)=>{try{
  await identity(req);
  const translated=await translateSupportText(req.body?.text,req.body?.source_language||'');
  res.json({english_translation:translated,provider:SUPPORT_AI_PROVIDER});
}catch(e){next(e)}});

app.post('/api/support/tickets',body,async(req,res,next)=>{const client=await pool.connect();try{
  const me=await identity(req),category=clean(req.body?.category,80),subject=clean(req.body?.subject,180),description=clean(req.body?.description,5000),requestedRelatedType=clean(req.body?.related_type,50),requestedRelatedId=req.body?.related_id?Number(req.body.related_id):null,requestedDestination=SUPPORT_DESTINATIONS.has(req.body?.requested_destination)?req.body.requested_destination:'support',sourceLanguage=clean(req.body?.source_language,32),englishTranslation=clean(req.body?.english_translation,12000);
  if(!SUPPORT_CATEGORIES.has(category)||subject.length<3||description.length<10)return res.status(400).json({error:'Valid category, subject and clear description required'});
  const isPrivacyRequest=PRIVACY_SUPPORT_CATEGORIES.has(category);
  const destination=isPrivacyRequest?'country_admin':requestedDestination;
  const relatedType=isPrivacyRequest?'privacy_rights':requestedRelatedType;
  const relatedId=isPrivacyRequest?null:requestedRelatedId;
  const attachments=validateSupportAttachments(req.body?.attachments),territoryId=isPrivacyRequest?null:await inferTerritory(relatedType,relatedId,req.body?.territory_id);
  await client.query('BEGIN');
  const q=await client.query(`INSERT INTO support_tickets(requester_account_id,territory_id,category,subject,description,requested_destination,source_language,english_translation,related_type,related_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[me.account.id,territoryId,category,subject,description,destination,sourceLanguage,englishTranslation,relatedType,relatedId]);
  const ticket=q.rows[0];
  await client.query(`INSERT INTO support_messages(ticket_id,actor_account_id,visibility,message) VALUES($1,$2,'user',$3)`,[ticket.id,me.account.id,description]);
  if(isPrivacyRequest){
    await client.query(`INSERT INTO support_ticket_tags(ticket_id,tag,created_by_account_id) VALUES($1,'privacy_rights',$2) ON CONFLICT DO NOTHING`,[ticket.id,me.account.id]);
    await client.query(`INSERT INTO support_ticket_tags(ticket_id,tag,created_by_account_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[ticket.id,category,me.account.id]);
  }
  for(const a of attachments)await client.query(`INSERT INTO support_attachments(ticket_id,kind,mime_type,file_name,byte_size,data_url,transcript_text,transcript_language,english_translation) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[ticket.id,a.kind,a.mime,a.file_name,a.byte_size,a.data_url,a.transcript_text,a.transcript_language,a.english_translation]);
  await client.query('COMMIT');
  res.status(201).json({...ticket,attachment_count:attachments.length});
}catch(e){await client.query('ROLLBACK').catch(()=>{});next(e)}finally{client.release()}});
app.get('/api/support/tickets/mine',async(req,res,next)=>{try{const me=await identity(req);const{rows}=await pool.query(`SELECT t.*,(SELECT jsonb_agg(x.tag ORDER BY x.tag) FROM support_ticket_tags x WHERE x.ticket_id=t.id) tags,(SELECT COUNT(*)::int FROM support_attachments a WHERE a.ticket_id=t.id) attachment_count FROM support_tickets t WHERE requester_account_id=$1 ORDER BY updated_at DESC LIMIT 150`,[me.account.id]);res.json(rows)}catch(e){next(e)}});
app.get('/api/support/tickets/:id',async(req,res,next)=>{try{const me=await identity(req),id=Number(req.params.id),q=await pool.query(`SELECT * FROM support_tickets WHERE id=$1`,[id]);if(!q.rowCount)return res.status(404).json({error:'Support ticket not found'});const t=q.rows[0];if(Number(t.requester_account_id)!==Number(me.account.id)){await requireAdminPermission(pool,me.account.id,'support.manage',t.territory_id)}const messages=await pool.query(`SELECT m.id,m.actor_account_id,a.display_name actor_name,m.actor_context,m.visibility,m.message,m.created_at FROM support_messages m JOIN accounts a ON a.id=m.actor_account_id WHERE m.ticket_id=$1 AND (m.visibility='user' OR $2::boolean) ORDER BY m.created_at,m.id`,[id,Number(t.requester_account_id)!==Number(me.account.id)]);const tags=await pool.query(`SELECT tag FROM support_ticket_tags WHERE ticket_id=$1 ORDER BY tag`,[id]);const attachments=await pool.query(`SELECT id,kind,mime_type,file_name,byte_size,transcript_text,transcript_language,english_translation,created_at FROM support_attachments WHERE ticket_id=$1 ORDER BY id`,[id]);res.json({...t,messages:messages.rows,tags:tags.rows.map(x=>x.tag),attachments:attachments.rows})}catch(e){next(e)}});
app.get('/api/support/tickets/:id/attachments/:attachmentId',async(req,res,next)=>{try{
  const me=await identity(req),id=Number(req.params.id),q=await pool.query(`SELECT requester_account_id,territory_id FROM support_tickets WHERE id=$1`,[id]);if(!q.rowCount)return res.status(404).json({error:'Support ticket not found'});const t=q.rows[0];if(Number(t.requester_account_id)!==Number(me.account.id))await requireAdminPermission(pool,me.account.id,'support.manage',t.territory_id);
  const a=await pool.query(`SELECT * FROM support_attachments WHERE id=$1 AND ticket_id=$2`,[Number(req.params.attachmentId),id]);if(!a.rowCount)return res.status(404).json({error:'Attachment not found'});const x=a.rows[0];res.json({id:x.id,kind:x.kind,mime_type:x.mime_type,file_name:x.file_name,byte_size:x.byte_size,data_url:x.data_url,transcript_text:x.transcript_text,transcript_language:x.transcript_language,english_translation:x.english_translation});
}catch(e){next(e)}});
app.post('/api/support/tickets/:id/reply',body,async(req,res,next)=>{try{const me=await identity(req),id=Number(req.params.id),message=clean(req.body?.message,3000);if(!message)return res.status(400).json({error:'Message is required'});const t=await pool.query(`SELECT * FROM support_tickets WHERE id=$1 AND requester_account_id=$2`,[id,me.account.id]);if(!t.rowCount)return res.status(404).json({error:'Support ticket not found'});await pool.query(`INSERT INTO support_messages(ticket_id,actor_account_id,visibility,message) VALUES($1,$2,'user',$3)`,[id,me.account.id,message]);await pool.query(`UPDATE support_tickets SET status=CASE WHEN status IN ('waiting_user','resolved','closed') THEN 'reopened' ELSE status END,updated_at=NOW() WHERE id=$1`,[id]);res.json({ok:true})}catch(e){next(e)}});

app.get('/api/admin/support',async(req,res,next)=>{try{const me=await identity(req);await requireAdminPermission(pool,me.account.id,'support.manage');const ids=await visibleTerritoryIds(pool,me.account.id,'support.manage'),countryWide=await isCountryWide(me.account.id,'support.manage'),status=clean(req.query.status,40);if(status&&!SUPPORT_STATUSES.has(status))return res.status(400).json({error:'Unknown support status'});const args=[];let where=countryWide?"t.country_code='PH'":`t.territory_id=ANY($1::bigint[])`;if(!countryWide)args.push(ids.length?ids:[-1]);if(status){args.push(status);where+=` AND t.status=$${args.length}`}const{rows}=await pool.query(`SELECT t.*,a.display_name requester_name,a.email requester_email,(SELECT jsonb_agg(x.tag ORDER BY x.tag) FROM support_ticket_tags x WHERE x.ticket_id=t.id) tags,(SELECT COUNT(*)::int FROM support_attachments sa WHERE sa.ticket_id=t.id) attachment_count FROM support_tickets t JOIN accounts a ON a.id=t.requester_account_id WHERE ${where} ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,t.updated_at DESC LIMIT 250`,args);res.json(rows)}catch(e){next(e)}});
app.patch('/api/admin/support/:id',body,async(req,res,next)=>{try{const me=await identity(req),id=Number(req.params.id),q=await pool.query(`SELECT * FROM support_tickets WHERE id=$1`,[id]);if(!q.rowCount)return res.status(404).json({error:'Support ticket not found'});const t=q.rows[0],assignment=await requireAdminPermission(pool,me.account.id,'support.manage',t.territory_id),status=clean(req.body?.status||t.status,40),priority=clean(req.body?.priority||t.priority,30);if(!SUPPORT_STATUSES.has(status)||!SUPPORT_PRIORITIES.has(priority))return res.status(400).json({error:'Invalid status or priority'});const tags=[...new Set((Array.isArray(req.body?.tags)?req.body.tags:[]).map(x=>clean(x,60)).filter(Boolean))].slice(0,12);const client=await pool.connect();try{await client.query('BEGIN');await client.query(`UPDATE support_tickets SET status=$1,priority=$2,assigned_admin_account_id=CASE WHEN $3 THEN $4 ELSE assigned_admin_account_id END,resolution_reason=CASE WHEN $5<>'' THEN $5 ELSE resolution_reason END,resolved_at=CASE WHEN $1 IN ('resolved','closed') THEN COALESCE(resolved_at,NOW()) ELSE NULL END,updated_at=NOW() WHERE id=$6`,[status,priority,Boolean(req.body?.assign_to_self),me.account.id,clean(req.body?.resolution_reason,1500),id]);if(Array.isArray(req.body?.tags)){await client.query(`DELETE FROM support_ticket_tags WHERE ticket_id=$1`,[id]);for(const tag of tags)await client.query(`INSERT INTO support_ticket_tags(ticket_id,tag,created_by_account_id) VALUES($1,$2,$3)`,[id,tag,me.account.id])}await client.query('COMMIT');await appendAdminAudit(pool,{actorAccountId:me.account.id,assignmentId:assignment.id,permission:'support.manage',territoryId:t.territory_id,targetType:'support_ticket',targetId:String(id),eventCode:'support_ticket_updated',before:{status:t.status,priority:t.priority},after:{status,priority,tags},reason:req.body?.resolution_reason,correlationId:correlation(req)});res.json({ok:true})}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}}catch(e){next(e)}});
app.post('/api/admin/support/:id/messages',body,async(req,res,next)=>{try{const me=await identity(req),id=Number(req.params.id),q=await pool.query(`SELECT * FROM support_tickets WHERE id=$1`,[id]);if(!q.rowCount)return res.status(404).json({error:'Support ticket not found'});const t=q.rows[0],assignment=await requireAdminPermission(pool,me.account.id,'support.manage',t.territory_id),message=clean(req.body?.message,3000),visibility=req.body?.visibility==='internal'?'internal':'user';if(!message)return res.status(400).json({error:'Message is required'});await pool.query(`INSERT INTO support_messages(ticket_id,actor_account_id,actor_context,visibility,message) VALUES($1,$2,'admin',$3,$4)`,[id,me.account.id,visibility,message]);await pool.query(`UPDATE support_tickets SET status=CASE WHEN $1='user' AND status NOT IN ('resolved','closed') THEN 'waiting_user' ELSE status END,updated_at=NOW() WHERE id=$2`,[visibility,id]);await appendAdminAudit(pool,{actorAccountId:me.account.id,assignmentId:assignment.id,permission:'support.manage',territoryId:t.territory_id,targetType:'support_ticket',targetId:String(id),eventCode:visibility==='internal'?'support_internal_note':'support_user_reply',correlationId:correlation(req)});res.json({ok:true})}catch(e){next(e)}});
app.post('/api/admin/support/:id/assist/draft',body,async(req,res,next)=>{try{const me=await identity(req),id=Number(req.params.id),q=await pool.query(`SELECT * FROM support_tickets WHERE id=$1`,[id]);if(!q.rowCount)return res.status(404).json({error:'Support ticket not found'});await requireAdminPermission(pool,me.account.id,'support.manage',q.rows[0].territory_id);const messages=await pool.query(`SELECT actor_context,message FROM support_messages WHERE ticket_id=$1 AND visibility='user' ORDER BY created_at,id`,[id]);const draft=await draftAdminSupportReply(q.rows[0],messages.rows,req.body?.draft);res.json({draft,provider:SUPPORT_AI_PROVIDER,model:SUPPORT_AI_DRAFT_MODEL,automatic_send:false})}catch(e){next(e)}});
app.post('/api/admin/support/:id/assist/translate',body,async(req,res,next)=>{try{const me=await identity(req),id=Number(req.params.id),q=await pool.query(`SELECT territory_id FROM support_tickets WHERE id=$1`,[id]);if(!q.rowCount)return res.status(404).json({error:'Support ticket not found'});await requireAdminPermission(pool,me.account.id,'support.manage',q.rows[0].territory_id);const translation=await translateAdminSupportReply(req.body?.text,req.body?.target_language,req.body?.instruction);res.json({translation,target_language:clean(req.body?.target_language,60),provider:SUPPORT_AI_PROVIDER,model:SUPPORT_AI_TRANSLATION_MODEL,automatic_send:false})}catch(e){next(e)}});
app.post('/api/admin/support/:id/escalate',body,async(req,res,next)=>{try{const me=await identity(req),id=Number(req.params.id),q=await pool.query(`SELECT * FROM support_tickets WHERE id=$1`,[id]);if(!q.rowCount)return res.status(404).json({error:'Support ticket not found'});const t=q.rows[0],supportAssignment=await requireAdminPermission(pool,me.account.id,'support.manage',t.territory_id);await requireAdminPermission(pool,me.account.id,'incident.triage',t.territory_id);if(t.linked_incident_id)return res.json({ok:true,incident_id:t.linked_incident_id});const inc=await pool.query(`INSERT INTO incident_reports(reporter_account_id,related_type,related_id,category,description,status,territory_id,support_ticket_id) VALUES($1,'other',NULL,'Support escalation',$2,'escalated',$3,$4) RETURNING id`,[t.requester_account_id,`Escalated from support ticket #${id}: ${t.subject}\n${t.description}`,t.territory_id,id]);await pool.query(`INSERT INTO incident_actions(incident_id,actor_account_id,action_type,to_status,note) VALUES($1,$2,'support_escalation','escalated',$3)`,[inc.rows[0].id,me.account.id,clean(req.body?.reason,1500)||'Escalated from Support']);await pool.query(`UPDATE support_tickets SET linked_incident_id=$1,status='waiting_internal',updated_at=NOW() WHERE id=$2`,[inc.rows[0].id,id]);await appendAdminAudit(pool,{actorAccountId:me.account.id,assignmentId:supportAssignment.id,permission:'incident.triage',territoryId:t.territory_id,targetType:'support_ticket',targetId:String(id),eventCode:'support_escalated_to_incident',after:{incident_id:inc.rows[0].id},reason:req.body?.reason,correlationId:correlation(req)});res.status(201).json({ok:true,incident_id:inc.rows[0].id})}catch(e){next(e)}});

app.get('/api/admin/incidents',async(req,res,next)=>{try{const me=await identity(req);await requireAdminPermission(pool,me.account.id,'incident.triage');const ids=await visibleTerritoryIds(pool,me.account.id,'incident.triage'),countryWide=await isCountryWide(me.account.id,'incident.triage'),status=clean(req.query.status,40);if(status&&!INCIDENT_STATUSES.has(status))return res.status(400).json({error:'Unknown status'});const args=[];let where=countryWide?"(i.territory_id IS NULL OR i.territory_id IN (SELECT id FROM territories WHERE country_code='PH'))":`i.territory_id=ANY($1::bigint[])`;if(!countryWide)args.push(ids.length?ids:[-1]);if(status){args.push(status);where+=` AND i.status=$${args.length}`}const{rows}=await pool.query(`SELECT i.id,i.related_type,i.related_id,i.category,i.description,i.status,i.territory_id,i.assigned_admin_account_id,i.resolution_summary,i.submitted_at,i.updated_at,a.display_name reporter_name,a.email reporter_email,(SELECT COUNT(*)::int FROM incident_attachments x WHERE x.incident_id=i.id) attachment_count FROM incident_reports i JOIN accounts a ON a.id=i.reporter_account_id WHERE ${where} ORDER BY i.updated_at DESC LIMIT 250`,args);res.json(rows)}catch(e){next(e)}});
app.get('/api/admin/incidents/:id',async(req,res,next)=>{try{const me=await identity(req),id=Number(req.params.id),q=await pool.query(`SELECT i.*,a.display_name reporter_name,a.email reporter_email FROM incident_reports i JOIN accounts a ON a.id=i.reporter_account_id WHERE i.id=$1`,[id]);if(!q.rowCount)return res.status(404).json({error:'Incident not found'});await requireAdminPermission(pool,me.account.id,'incident.triage',q.rows[0].territory_id);const[att,actions]=await Promise.all([pool.query(`SELECT id,kind,mime_type,file_name,byte_size,created_at FROM incident_attachments WHERE incident_id=$1 ORDER BY id`,[id]),pool.query(`SELECT x.*,a.display_name actor_name FROM incident_actions x JOIN accounts a ON a.id=x.actor_account_id WHERE x.incident_id=$1 ORDER BY x.created_at,x.id`,[id])]);res.json({...q.rows[0],attachments:att.rows,actions:actions.rows})}catch(e){next(e)}});
app.get('/api/admin/incidents/:id/attachments/:attachmentId',async(req,res,next)=>{try{const me=await identity(req),id=Number(req.params.id),q=await pool.query(`SELECT territory_id FROM incident_reports WHERE id=$1`,[id]);if(!q.rowCount)return res.status(404).json({error:'Incident not found'});await requireAdminPermission(pool,me.account.id,'incident.triage',q.rows[0].territory_id);const a=await pool.query(`SELECT id,kind,mime_type,file_name,byte_size,evidence_data_url FROM incident_attachments WHERE incident_id=$1 AND id=$2`,[id,Number(req.params.attachmentId)]);if(!a.rowCount)return res.status(404).json({error:'Attachment not found'});const x=a.rows[0];res.json({id:x.id,kind:x.kind,mime_type:x.mime_type,file_name:x.file_name,byte_size:x.byte_size,data_url:x.evidence_data_url})}catch(e){next(e)}});
app.patch('/api/admin/incidents/:id',body,async(req,res,next)=>{const client=await pool.connect();try{const me=await identity(req),id=Number(req.params.id);await client.query('BEGIN');const q=await client.query(`SELECT * FROM incident_reports WHERE id=$1 FOR UPDATE`,[id]);if(!q.rowCount)throw Object.assign(new Error('Incident not found'),{status:404});const before=q.rows[0],assignment=await requireAdminPermission(pool,me.account.id,'incident.triage',before.territory_id),status=clean(req.body?.status,40),note=clean(req.body?.note,3000),resolution=clean(req.body?.resolution_summary,4000);if(!INCIDENT_STATUSES.has(status))throw Object.assign(new Error('Unknown incident status'),{status:400});await client.query(`UPDATE incident_reports SET status=$1,assigned_admin_account_id=COALESCE(assigned_admin_account_id,$2),resolution_summary=CASE WHEN $3<>'' THEN $3 ELSE resolution_summary END,resolved_at=CASE WHEN $1 IN ('resolved','dismissed') THEN COALESCE(resolved_at,NOW()) ELSE NULL END,updated_at=NOW() WHERE id=$4`,[status,me.account.id,resolution,id]);await client.query(`INSERT INTO incident_actions(incident_id,actor_account_id,action_type,from_status,to_status,note) VALUES($1,$2,'admin_status',$3,$4,$5)`,[id,me.account.id,before.status,status,note]);await client.query('COMMIT');await appendAdminAudit(pool,{actorAccountId:me.account.id,assignmentId:assignment.id,permission:'incident.triage',territoryId:before.territory_id,targetType:'incident',targetId:String(id),eventCode:'incident_status_changed',before:{status:before.status},after:{status},reason:note,correlationId:correlation(req)});res.json({ok:true,status})}catch(e){await client.query('ROLLBACK').catch(()=>{});next(e)}finally{client.release()}});

app.post('/api/incidents',body,async(req,res,next)=>{try{const r=await upstream('/api/incidents',{method:'POST',headers:{Authorization:authHeader(req),'Content-Type':'application/json'},body:JSON.stringify(req.body||{})});const data=await r.json().catch(()=>({}));if(r.ok&&data.id){const territoryId=await inferTerritory(clean(req.body?.related_type,50),req.body?.related_id?Number(req.body.related_id):null,req.body?.territory_id);if(territoryId)await pool.query(`UPDATE incident_reports SET territory_id=$1 WHERE id=$2`,[territoryId,data.id])}res.status(r.status).json(data)}catch(e){next(e)}});

app.post('/api/governance/admin/territories',body,async(req,res,next)=>{try{const parent=req.body?.parent_id?Number(req.body.parent_id):null;return forwardAdmin(req,res,'territory.manage',parent,'territory','new')}catch(e){next(e)}});
app.post('/api/governance/admin/invitations',body,async(req,res,next)=>{try{const role=clean(req.body?.role,40),perm=role==='merchant'?'profiles.invite_merchant':role==='supplier'?'profiles.invite_supplier':'profiles.invite_courier';return forwardAdmin(req,res,perm,Number(req.body?.territory_id)||null,'profile_invitation',role)}catch(e){next(e)}});
app.get('/api/governance/admin/applications/:id',async(req,res,next)=>{try{const q=await pool.query(`SELECT role,territory_id FROM profile_applications WHERE id=$1`,[Number(req.params.id)]);if(!q.rowCount)return res.status(404).json({error:'Application not found'});return forwardAdmin(req,res,rolePermission(q.rows[0].role),q.rows[0].territory_id,'profile_application',req.params.id)}catch(e){next(e)}});
app.get('/api/governance/admin/application-documents/:id',async(req,res,next)=>{try{const q=await pool.query(`SELECT pa.role,pa.territory_id FROM profile_application_documents d JOIN profile_applications pa ON pa.id=d.application_id WHERE d.id=$1`,[Number(req.params.id)]);if(!q.rowCount)return res.status(404).json({error:'Document not found'});return forwardAdmin(req,res,rolePermission(q.rows[0].role),q.rows[0].territory_id,'application_document',req.params.id)}catch(e){next(e)}});
app.post('/api/governance/admin/applications/:id/review',body,async(req,res,next)=>{try{const q=await pool.query(`SELECT role,territory_id FROM profile_applications WHERE id=$1`,[Number(req.params.id)]);if(!q.rowCount)return res.status(404).json({error:'Application not found'});return forwardAdmin(req,res,rolePermission(q.rows[0].role),q.rows[0].territory_id,'profile_application',req.params.id)}catch(e){next(e)}});
app.post('/api/governance/admin/authorizations/:id/status',body,async(req,res,next)=>{try{const q=await pool.query(`SELECT territory_id FROM profile_authorizations WHERE id=$1`,[Number(req.params.id)]);if(!q.rowCount)return res.status(404).json({error:'Authorization not found'});return forwardAdmin(req,res,'profile.suspend',q.rows[0].territory_id,'profile_authorization',req.params.id)}catch(e){next(e)}});

app.get('/api/admin/metrics',async(req,res,next)=>{try{
  const me=await identity(req),ctx=await buildAdminScopeContext(me.account.id);
  requirePermissionFromContext(ctx,'metrics.view');
  const summary=await adminSummaryFromContext(ctx);
  res.json({version:'v1',generated_at:new Date().toISOString(),metrics:summary});
}catch(e){next(e)}});
app.post('/api/admin/metrics/snapshot',body,async(req,res,next)=>{try{
  const territoryId=req.body?.territory_id?Number(req.body.territory_id):null;
  const{me,assignment}=await adminFor(req,'metrics.view',territoryId);
  const ctx=await buildAdminScopeContext(me.account.id),summary=await adminSummaryFromContext(ctx);
  const{rows}=await pool.query(`INSERT INTO admin_metric_snapshots(territory_id,metrics_json,created_by_account_id) VALUES($1,$2::jsonb,$3) RETURNING *`,[territoryId,JSON.stringify(summary),me.account.id]);
  await appendAdminAudit(pool,{actorAccountId:me.account.id,assignmentId:assignment.id,permission:'metrics.view',territoryId,targetType:'metric_snapshot',targetId:String(rows[0].id),eventCode:'metrics_snapshot_created',correlationId:correlation(req)});
  res.status(201).json(rows[0]);
}catch(e){next(e)}});

app.use((req,res,next)=>{
  if(!businessAccountingApp)return res.status(503).json({error:'Multi-business Accounting runtime is not ready'});
  return businessAccountingApp(req,res,next);
});
app.use((err,_req,res,_next)=>{console.error(err);if(res.headersSent)return;res.status(err.status||500).json({error:err.status?err.message:'Unexpected admin operations error'})});

let embeddedStartPromise=null;
export async function startEmbeddedAdminOperations(){
  if(!embeddedStartPromise){
    embeddedStartPromise=(async()=>{
      businessAccountingApp=await startEmbeddedBusinessAccounting();
      businessAccountingReady=true;
      await initDb();
      console.log('Business & Life scoped Admin + Support mounted in-process');
      return app;
    })();
  }
  return embeddedStartPromise;
}

async function stopAdminOperations(){
  if(shuttingDown)return;
  shuttingDown=true;
  businessAccountingReady=false;
  await stopEmbeddedBusinessAccounting().catch(()=>{});
  await pool.end().catch(()=>{});
}
export async function stopEmbeddedAdminOperations(){await stopAdminOperations()}

async function shutdown(sig){console.log(`Received ${sig}`);await stopAdminOperations();process.exit(0)}
const directExecution=Boolean(process.argv[1])&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(directExecution){
  process.on('SIGTERM',()=>shutdown('SIGTERM'));
  process.on('SIGINT',()=>shutdown('SIGINT'));
  startEmbeddedAdminOperations().then(()=>app.listen(port,'0.0.0.0',()=>console.log(`Business & Life scoped Admin + Support gateway listening on ${port}`))).catch(e=>{console.error(e);process.exit(1)});
}
