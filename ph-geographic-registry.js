import crypto from 'node:crypto';
import ExcelJS from 'exceljs';

export const PH_PSGC_SOURCE=Object.freeze({
  country_code:'PH',
  authority:'Philippine Statistics Authority (PSA)',
  registry:'Philippine Standard Geographic Code (PSGC)',
  version:'2026-06-30',
  landing_url:'https://psa.gov.ph/classification/psgc',
  publication_url:'https://psa.gov.ph/system/files/scd/PSGC-2Q-2026-Publication-Datafile.xlsx'
});

export const PH_PSGC_EXPECTED_COUNTS=Object.freeze({
  region:18,
  province:82,
  city:149,
  municipality:1493,
  barangay:42010
});

const clean=(value,max=1000)=>String(value??'').trim().replace(/\s+/g,' ').slice(0,max);
const headerKey=value=>clean(value,240).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'');

const HEADER_ALIASES=Object.freeze({
  psgc_code:['10digitpsgccode','10digitcode','psgccode','psgc'],
  name:['name','areaname','geographicname','locationname'],
  correspondence_code:['correspondencecode','9digitpsgccode','oldpsgccode'],
  geographic_level:['geographiclevel','geolevel','level'],
  old_name:['oldname','oldnames','previousname','previousnames'],
  city_class:['cityclass','cityclassification'],
  income_classification:['incomeclassification','incomeclass'],
  urban_rural:['urbanruralclassification','urbanrural','urbanruralclassificationbasedon2020cph'],
  population:['population2020cph','population','2020cphpopulation']
});

function cellText(cell){
  if(!cell)return'';
  const text=clean(cell.text,1000);
  if(text)return text;
  const value=cell.value;
  if(value==null)return'';
  if(typeof value==='object'){
    if(Array.isArray(value.richText))return clean(value.richText.map(x=>x?.text||'').join(''),1000);
    if(value.result!=null)return clean(value.result,1000);
    if(value.text!=null)return clean(value.text,1000);
  }
  return clean(value,1000);
}

export function normalizePsgcCode(value,digits=10){
  let out=clean(value,40).replace(/\D/g,'');
  if(!out)return'';
  if(out.length<digits)out=out.padStart(digits,'0');
  if(out.length!==digits)return'';
  return out;
}

export function normalizePsgcLevel(value){
  const k=headerKey(value);
  if(['reg','region'].includes(k))return'region';
  if(['prov','province'].includes(k))return'province';
  if(['city'].includes(k))return'city';
  if(['mun','municipality','municipal'].includes(k))return'municipality';
  if(['bgy','brgy','barangay'].includes(k))return'barangay';
  if(['dist','district'].includes(k))return'district';
  if(['submun','submunicipality','submunicipal'].includes(k))return'submunicipality';
  return'other';
}

export function territoryTypeForPsgcLevel(level){
  const value=normalizePsgcLevel(level);
  if(['region','province','city','municipality','barangay','district'].includes(value))return value;
  if(value==='submunicipality')return'district';
  return null;
}

function findHeader(worksheet){
  const max=Math.min(Math.max(worksheet.rowCount||0,1),40);
  for(let rowNo=1;rowNo<=max;rowNo++){
    const row=worksheet.getRow(rowNo);
    const found={};
    for(let col=1;col<=Math.max(row.cellCount||0,20);col++){
      const key=headerKey(cellText(row.getCell(col)));
      if(!key)continue;
      for(const [canonical,aliases] of Object.entries(HEADER_ALIASES)){
        if(!found[canonical]&&aliases.includes(key))found[canonical]=col;
      }
    }
    if(found.psgc_code&&found.name&&found.geographic_level)return{rowNo,columns:found};
  }
  return null;
}

function prefix(code,length){return String(code||'').slice(0,length)}

function deriveParents(rows){
  const regionBy2=new Map();
  const provinceBy5=new Map();
  const localBy7=new Map();
  for(const row of rows){
    if(row.geographic_level==='region')regionBy2.set(prefix(row.psgc_code,2),row.psgc_code);
    else if(row.geographic_level==='province')provinceBy5.set(prefix(row.psgc_code,5),row.psgc_code);
    else if(['city','municipality','submunicipality'].includes(row.geographic_level))localBy7.set(prefix(row.psgc_code,7),row.psgc_code);
  }
  for(const row of rows){
    let parent='';
    if(row.geographic_level==='province')parent=regionBy2.get(prefix(row.psgc_code,2))||'';
    else if(['city','municipality','submunicipality'].includes(row.geographic_level)){
      parent=provinceBy5.get(prefix(row.psgc_code,5))||regionBy2.get(prefix(row.psgc_code,2))||'';
    }else if(row.geographic_level==='district'){
      parent=regionBy2.get(prefix(row.psgc_code,2))||'';
    }else if(row.geographic_level==='barangay'){
      parent=localBy7.get(prefix(row.psgc_code,7))
        ||provinceBy5.get(prefix(row.psgc_code,5))
        ||regionBy2.get(prefix(row.psgc_code,2))
        ||'';
    }
    row.parent_psgc_code=parent&&parent!==row.psgc_code?parent:'';
  }
  const byCode=new Map(rows.map(row=>[row.psgc_code,row]));
  const pathMemo=new Map();
  const pathFor=(row,seen=new Set())=>{
    if(pathMemo.has(row.psgc_code))return pathMemo.get(row.psgc_code);
    if(seen.has(row.psgc_code))return row.name;
    seen.add(row.psgc_code);
    const parent=row.parent_psgc_code?byCode.get(row.parent_psgc_code):null;
    const path=parent?pathFor(parent,seen)+' › '+row.name:row.name;
    pathMemo.set(row.psgc_code,path);
    return path;
  };
  for(const row of rows)row.path_text=pathFor(row);
  return rows;
}

export async function parsePhPsgcWorkbook(buffer){
  const workbook=new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.isBuffer(buffer)?buffer:Buffer.from(buffer));
  let worksheet=null,header=null;
  for(const sheet of workbook.worksheets){
    const candidate=findHeader(sheet);
    if(candidate){worksheet=sheet;header=candidate;break}
  }
  if(!worksheet||!header)throw new Error('PSGC workbook header was not recognized');
  const rows=[];
  const c=header.columns;
  for(let rowNo=header.rowNo+1;rowNo<=worksheet.rowCount;rowNo++){
    const excelRow=worksheet.getRow(rowNo);
    const psgcCode=normalizePsgcCode(cellText(excelRow.getCell(c.psgc_code)),10);
    const name=clean(cellText(excelRow.getCell(c.name)),240);
    const rawLevel=clean(cellText(excelRow.getCell(c.geographic_level)),80);
    if(!psgcCode||!name||!rawLevel)continue;
    const row={
      psgc_code:psgcCode,
      correspondence_code:c.correspondence_code?normalizePsgcCode(cellText(excelRow.getCell(c.correspondence_code)),9):'',
      name,
      raw_geographic_level:rawLevel,
      geographic_level:normalizePsgcLevel(rawLevel),
      parent_psgc_code:'',
      path_text:'',
      old_name:c.old_name?clean(cellText(excelRow.getCell(c.old_name)),300):'',
      city_class:c.city_class?clean(cellText(excelRow.getCell(c.city_class)),120):'',
      income_classification:c.income_classification?clean(cellText(excelRow.getCell(c.income_classification)),160):'',
      urban_rural:c.urban_rural?clean(cellText(excelRow.getCell(c.urban_rural)),160):'',
      population:c.population?clean(cellText(excelRow.getCell(c.population)),80):'',
      source_sheet:worksheet.name,
      source_row:rowNo
    };
    rows.push(row);
  }
  if(!rows.length)throw new Error('PSGC workbook contains no recognizable geography rows');
  const unique=new Map();
  for(const row of rows)unique.set(row.psgc_code,row);
  return deriveParents([...unique.values()]);
}

export function summarizePhPsgcRows(rows){
  const counts={total:0,region:0,province:0,city:0,municipality:0,barangay:0,district:0,submunicipality:0,other:0};
  for(const row of Array.isArray(rows)?rows:[]){
    counts.total++;
    const key=Object.hasOwn(counts,row.geographic_level)?row.geographic_level:'other';
    counts[key]++;
  }
  return counts;
}

export function validatePhPsgcRows(rows,{strictVersion=true}={}){
  const counts=summarizePhPsgcRows(rows);
  const problems=[];
  if(strictVersion){
    for(const [level,expected] of Object.entries(PH_PSGC_EXPECTED_COUNTS)){
      if(Number(counts[level])!==Number(expected))problems.push(level+' expected '+expected+' but parsed '+Number(counts[level]||0));
    }
  }else{
    if(counts.region<18)problems.push('fewer than 18 regions');
    if(counts.province<80)problems.push('fewer than 80 provinces');
    if(counts.barangay<40000)problems.push('fewer than 40,000 barangays');
  }
  const duplicateCodes=(Array.isArray(rows)?rows:[]).length-new Set((rows||[]).map(x=>x.psgc_code)).size;
  if(duplicateCodes)problems.push(duplicateCodes+' duplicate PSGC codes');
  if(problems.length)throw new Error('PSGC import validation failed: '+problems.join('; '));
  return counts;
}

export async function ensurePhGeographicRegistrySchema(pool){
  await pool.query([
    "CREATE TABLE IF NOT EXISTS ph_geographic_registry_imports (id BIGSERIAL PRIMARY KEY,country_code TEXT NOT NULL DEFAULT 'PH',source_authority TEXT NOT NULL,source_version TEXT NOT NULL,source_url TEXT NOT NULL,source_sha256 TEXT NOT NULL DEFAULT '',status TEXT NOT NULL,row_count INTEGER NOT NULL DEFAULT 0,level_counts JSONB NOT NULL DEFAULT '{}'::jsonb,imported_by_account_id BIGINT REFERENCES accounts(id),started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),completed_at TIMESTAMPTZ,error_message TEXT NOT NULL DEFAULT '',CHECK(status IN ('running','success','failed')))",
    "CREATE INDEX IF NOT EXISTS ph_geo_imports_status_idx ON ph_geographic_registry_imports(country_code,status,completed_at DESC,id DESC)",
    "CREATE TABLE IF NOT EXISTS ph_geographic_registry (country_code TEXT NOT NULL DEFAULT 'PH',psgc_code TEXT NOT NULL,source_version TEXT NOT NULL,name TEXT NOT NULL,correspondence_code TEXT NOT NULL DEFAULT '',raw_geographic_level TEXT NOT NULL,geographic_level TEXT NOT NULL,parent_psgc_code TEXT NOT NULL DEFAULT '',path_text TEXT NOT NULL DEFAULT '',old_name TEXT NOT NULL DEFAULT '',city_class TEXT NOT NULL DEFAULT '',income_classification TEXT NOT NULL DEFAULT '',urban_rural TEXT NOT NULL DEFAULT '',population TEXT NOT NULL DEFAULT '',source_url TEXT NOT NULL,raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(country_code,psgc_code,source_version),CHECK(geographic_level IN ('region','province','city','municipality','district','submunicipality','barangay','other')))",
    "CREATE INDEX IF NOT EXISTS ph_geo_registry_search_idx ON ph_geographic_registry(country_code,source_version,geographic_level,name)",
    "CREATE INDEX IF NOT EXISTS ph_geo_registry_parent_idx ON ph_geographic_registry(country_code,source_version,parent_psgc_code,name)",
    "ALTER TABLE territories ADD COLUMN IF NOT EXISTS psgc_code TEXT",
    "ALTER TABLE territories ADD COLUMN IF NOT EXISTS geographic_source TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE territories ADD COLUMN IF NOT EXISTS geographic_source_version TEXT NOT NULL DEFAULT ''",
    "CREATE UNIQUE INDEX IF NOT EXISTS territories_ph_psgc_unique ON territories(country_code,psgc_code) WHERE psgc_code IS NOT NULL"
  ].join(';'));
}

async function latestSuccessfulImport(pool){
  const q=await pool.query("SELECT * FROM ph_geographic_registry_imports WHERE country_code='PH' AND status='success' ORDER BY completed_at DESC NULLS LAST,id DESC LIMIT 1");
  return q.rows[0]||null;
}

export async function phGeographicRegistryStatus(pool){
  const latest=await latestSuccessfulImport(pool);
  const recent=await pool.query("SELECT id,source_version,status,row_count,level_counts,started_at,completed_at,error_message FROM ph_geographic_registry_imports WHERE country_code='PH' ORDER BY id DESC LIMIT 5");
  return{
    country_code:'PH',
    source:PH_PSGC_SOURCE,
    ready:Boolean(latest),
    latest:latest?{
      id:latest.id,
      source_version:latest.source_version,
      row_count:Number(latest.row_count||0),
      level_counts:latest.level_counts||{},
      source_sha256:latest.source_sha256,
      completed_at:latest.completed_at
    }:null,
    recent_imports:recent.rows
  };
}

async function insertRegistryRows(client,rows,sourceSha){
  const fields=['country_code','psgc_code','source_version','name','correspondence_code','raw_geographic_level','geographic_level','parent_psgc_code','path_text','old_name','city_class','income_classification','urban_rural','population','source_url','raw_json'];
  const chunkSize=300;
  for(let start=0;start<rows.length;start+=chunkSize){
    const chunk=rows.slice(start,start+chunkSize);
    const params=[];
    const values=chunk.map((row,rowIndex)=>{
      const base=rowIndex*fields.length;
      params.push(
        'PH',row.psgc_code,PH_PSGC_SOURCE.version,row.name,row.correspondence_code||'',
        row.raw_geographic_level,row.geographic_level,row.parent_psgc_code||'',row.path_text||'',
        row.old_name||'',row.city_class||'',row.income_classification||'',row.urban_rural||'',row.population||'',
        PH_PSGC_SOURCE.landing_url,
        JSON.stringify({source_sheet:row.source_sheet,source_row:row.source_row,source_sha256:sourceSha})
      );
      return '('+fields.map((_,i)=>'$'+(base+i+1)).join(',')+')';
    }).join(',');
    const updates=fields.filter(x=>!['country_code','psgc_code','source_version'].includes(x)).map(x=>x+'=EXCLUDED.'+x).join(',');
    await client.query(
      'INSERT INTO ph_geographic_registry('+fields.join(',')+') VALUES '+values+
      ' ON CONFLICT(country_code,psgc_code,source_version) DO UPDATE SET '+updates+',imported_at=NOW()',
      params
    );
  }
}

export async function syncPhGeographicRegistry(pool,{importedByAccountId=null,fetchImpl=fetch}={}){
  await ensurePhGeographicRegistrySchema(pool);
  const attempt=await pool.query(
    "INSERT INTO ph_geographic_registry_imports(country_code,source_authority,source_version,source_url,status,imported_by_account_id) VALUES('PH',$1,$2,$3,'running',$4) RETURNING id",
    [PH_PSGC_SOURCE.authority,PH_PSGC_SOURCE.version,PH_PSGC_SOURCE.publication_url,importedByAccountId||null]
  );
  const attemptId=Number(attempt.rows[0].id);
  try{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),30000);
    let response;
    try{response=await fetchImpl(PH_PSGC_SOURCE.publication_url,{signal:controller.signal,headers:{'User-Agent':'Business-Life-PSGC-Sync/1.0'}})}
    finally{clearTimeout(timer)}
    if(!response?.ok)throw new Error('PSA PSGC publication download failed with HTTP '+Number(response?.status||0));
    const advertised=Number(response.headers?.get?.('content-length')||0);
    if(advertised>15_000_000)throw new Error('PSA PSGC workbook exceeds the 15 MB safety limit');
    const buffer=Buffer.from(await response.arrayBuffer());
    if(buffer.length<1000||buffer.length>15_000_000)throw new Error('PSA PSGC workbook size is outside the accepted safety range');
    if(buffer[0]!==0x50||buffer[1]!==0x4b)throw new Error('PSA PSGC publication is not a valid XLSX/ZIP payload');
    const sourceSha=crypto.createHash('sha256').update(buffer).digest('hex');
    const rows=await parsePhPsgcWorkbook(buffer);
    const counts=validatePhPsgcRows(rows,{strictVersion:true});
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await insertRegistryRows(client,rows,sourceSha);
      await client.query(
        "UPDATE ph_geographic_registry_imports SET status='success',source_sha256=$1,row_count=$2,level_counts=$3::jsonb,completed_at=NOW(),error_message='' WHERE id=$4",
        [sourceSha,rows.length,JSON.stringify(counts),attemptId]
      );
      await client.query('COMMIT');
    }catch(error){
      await client.query('ROLLBACK').catch(()=>{});
      throw error;
    }finally{client.release()}
    return await phGeographicRegistryStatus(pool);
  }catch(error){
    await pool.query(
      "UPDATE ph_geographic_registry_imports SET status='failed',completed_at=NOW(),error_message=$1 WHERE id=$2",
      [clean(error?.message||error,1000),attemptId]
    ).catch(()=>{});
    throw error;
  }
}

export async function searchPhGeographicRegistry(pool,{query='',level='',parentPsgcCode='',limit=40}={}){
  await ensurePhGeographicRegistrySchema(pool);
  const latest=await latestSuccessfulImport(pool);
  if(!latest)return{source_version:null,items:[]};
  const q=clean(query,120),normalizedLevel=level?normalizePsgcLevel(level):'',parent=normalizePsgcCode(parentPsgcCode,10);
  const params=[latest.source_version];
  const where=["g.country_code='PH'","g.source_version=$1"];
  if(q){
    params.push('%'+q.toLowerCase()+'%');
    where.push("(LOWER(g.name) LIKE $"+params.length+" OR LOWER(g.path_text) LIKE $"+params.length+" OR g.psgc_code LIKE REPLACE($"+params.length+",'%','')||'%')");
  }
  if(normalizedLevel&&normalizedLevel!=='other'){
    params.push(normalizedLevel);where.push('g.geographic_level=$'+params.length);
  }
  if(parent){
    params.push(parent);where.push('g.parent_psgc_code=$'+params.length);
  }else if(!q&&!normalizedLevel){
    where.push("g.geographic_level='region'");
  }
  const bounded=Math.max(1,Math.min(100,Number(limit)||40));
  params.push(bounded);
  const sql=
    "SELECT g.psgc_code,g.name,g.correspondence_code,g.raw_geographic_level,g.geographic_level,g.parent_psgc_code,g.path_text,g.old_name,g.city_class,g.income_classification,g.urban_rural,g.population,g.source_version,"+
    "t.id opened_territory_id,t.status opened_status "+
    "FROM ph_geographic_registry g LEFT JOIN territories t ON t.country_code='PH' AND t.psgc_code=g.psgc_code "+
    'WHERE '+where.join(' AND ')+' ORDER BY g.geographic_level,g.name LIMIT $'+params.length;
  const result=await pool.query(sql,params);
  return{source_version:latest.source_version,items:result.rows};
}

export async function resolvePhGeographicUnit(pool,psgcCode){
  await ensurePhGeographicRegistrySchema(pool);
  const latest=await latestSuccessfulImport(pool);
  if(!latest)return null;
  const code=normalizePsgcCode(psgcCode,10);
  if(!code)return null;
  const q=await pool.query(
    "SELECT * FROM ph_geographic_registry WHERE country_code='PH' AND source_version=$1 AND psgc_code=$2 LIMIT 1",
    [latest.source_version,code]
  );
  return q.rows[0]||null;
}

export async function findNearestOpenedPhAncestor(pool,unit){
  let parent=clean(unit?.parent_psgc_code,20);
  const version=clean(unit?.source_version,30);
  for(let i=0;i<8&&parent;i++){
    const territory=await pool.query("SELECT id FROM territories WHERE country_code='PH' AND psgc_code=$1 LIMIT 1",[parent]);
    if(territory.rowCount)return Number(territory.rows[0].id);
    const next=await pool.query(
      "SELECT parent_psgc_code FROM ph_geographic_registry WHERE country_code='PH' AND source_version=$1 AND psgc_code=$2 LIMIT 1",
      [version,parent]
    );
    parent=clean(next.rows[0]?.parent_psgc_code,20);
  }
  return null;
}
