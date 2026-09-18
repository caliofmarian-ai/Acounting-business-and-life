import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname=dirname(fileURLToPath(import.meta.url));

export const CONTROLLED_DOC_ROOTS=Object.freeze([
  'docs/governance',
  'docs/masterplan',
  'docs/roles',
  'docs/compliance/ph',
  'docs/forms',
  'docs/sop',
  'docs/pitch',
  'docs/agreements',
  'docs/training'
]);

const CATEGORY_LABELS=Object.freeze({
  governance:'Governance',
  masterplan:'Management',
  roles:'Roles & playbooks',
  compliance:'Compliance',
  forms:'Forms & authority packs',
  sop:'SOPs',
  pitch:'Pitch & partnerships',
  agreements:'Agreements',
  training:'Training'
});

const clean=(value,max=400)=>String(value??'').trim().slice(0,max);

function walkMarkdown(root){
  const out=[];
  for(const entry of readdirSync(root,{withFileTypes:true})){
    const full=join(root,entry.name);
    if(entry.isDirectory())out.push(...walkMarkdown(full));
    else if(entry.isFile()&&entry.name.toLowerCase().endsWith('.md')&&entry.name.toLowerCase()!=='readme.md')out.push(full);
  }
  return out;
}

function stripQuotes(value){
  const s=String(value??'').trim();
  if((s.startsWith('"')&&s.endsWith('"'))||(s.startsWith("'")&&s.endsWith("'")))return s.slice(1,-1);
  return s;
}

function parseInlineList(value){
  const s=String(value??'').trim();
  if(!s.startsWith('[')||!s.endsWith(']'))return [];
  const inner=s.slice(1,-1).trim();
  if(!inner)return [];
  return inner.split(',').map(x=>stripQuotes(x)).map(x=>x.trim()).filter(Boolean);
}

function scalar(value){
  const s=stripQuotes(value);
  if(s==='null'||s==='~')return null;
  if(s==='true')return true;
  if(s==='false')return false;
  if(/^\d+(?:\.\d+)?$/.test(s))return s;
  return s;
}

export function parseControlledMarkdown(text){
  const raw=String(text??'');
  if(!raw.startsWith('---\n'))return{meta:{},markdown:raw};
  const end=raw.indexOf('\n---\n',4);
  if(end<0)return{meta:{},markdown:raw};
  const front=raw.slice(4,end);
  const meta={};
  for(const line of front.split('\n')){
    const m=line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if(!m)continue;
    const key=m[1],value=m[2];
    meta[key]=value.trim().startsWith('[')?parseInlineList(value):scalar(value);
  }
  return{meta,markdown:raw.slice(end+5)};
}

function firstHeading(markdown){
  const m=String(markdown).match(/^#\s+(.+)$/m);
  return clean(m?.[1]||'Untitled',240);
}

function summaryFrom(markdown){
  const lines=String(markdown).split('\n');
  let inCode=false;
  const chunks=[];
  for(const raw of lines){
    const line=raw.trim();
    if(line.startsWith('```')){inCode=!inCode;continue}
    if(inCode||!line||line.startsWith('#')||line.startsWith('---')||line.startsWith('|')||line.startsWith('- ')||/^\d+\.\s/.test(line)||line.startsWith('>'))continue;
    chunks.push(line.replace(/[*_`]/g,''));
    if(chunks.join(' ').length>240)break;
  }
  return clean(chunks.join(' '),260);
}

function categoryFrom(relativePath){
  const parts=relativePath.split('/');
  const key=parts[1]||'other';
  return{key,label:CATEGORY_LABELS[key]||key};
}

export function loadControlledDocuments(baseDir=__dirname){
  const docs=[];
  for(const rootRel of CONTROLLED_DOC_ROOTS){
    const root=join(baseDir,...rootRel.split('/'));
    let files=[];
    try{files=walkMarkdown(root)}catch{continue}
    for(const absolutePath of files){
      const raw=readFileSync(absolutePath,'utf8');
      const parsed=parseControlledMarkdown(raw);
      const id=clean(parsed.meta.document_id||parsed.meta.template_id,140);
      if(!id)continue;
      const relativePath=relative(baseDir,absolutePath).split(sep).join('/');
      const category=categoryFrom(relativePath);
      docs.push({
        id,
        title:clean(parsed.meta.title||firstHeading(parsed.markdown),240),
        document_type:clean(parsed.meta.document_type||'controlled_document',80),
        status:clean(parsed.meta.status||'DRAFT',40).toUpperCase(),
        access_class:clean(parsed.meta.access_class||'OPERATIONS_PRIVATE',60).toUpperCase(),
        applicable_profiles:Array.isArray(parsed.meta.applicable_profiles)?parsed.meta.applicable_profiles.map(x=>clean(x,80).toLowerCase()):[],
        applicable_functions:Array.isArray(parsed.meta.applicable_functions)?parsed.meta.applicable_functions.map(x=>clean(x,120)):[],
        country_code:clean(parsed.meta.country_code||'GLB',12).toUpperCase(),
        territory_scope:clean(parsed.meta.territory_scope||'global',60),
        version:clean(parsed.meta.version||'1.0',30),
        legal_classification:clean(parsed.meta.legal_classification||'',80),
        legal_review:clean(parsed.meta.legal_review||'',80),
        category:category.key,
        category_label:category.label,
        summary:summaryFrom(parsed.markdown),
        relative_path:relativePath,
        markdown:parsed.markdown,
        absolutePath
      });
    }
  }
  docs.sort((a,b)=>a.category_label.localeCompare(b.category_label)||a.title.localeCompare(b.title));
  return docs;
}

export function publicDocumentMetadata(doc){
  return{
    id:doc.id,title:doc.title,document_type:doc.document_type,status:doc.status,
    access_class:doc.access_class,applicable_profiles:doc.applicable_profiles,
    applicable_functions:doc.applicable_functions,country_code:doc.country_code,
    territory_scope:doc.territory_scope,version:doc.version,
    legal_classification:doc.legal_classification,legal_review:doc.legal_review,
    category:doc.category,category_label:doc.category_label,summary:doc.summary
  };
}
