import crypto from 'node:crypto';

const ENTITY_TYPES=new Set(['marketplace_product','supplier_catalog_item']);
const SOURCE_TYPES=new Set(['ai_generated','merchant_upload','supplier_upload','authorized_external']);
const APPROVAL_STATES=new Set(['draft','approved','archived']);

const clean=(value,max=1200)=>String(value??'').trim().slice(0,max);
const truthy=value=>['1','true','yes','on'].includes(clean(value,12).toLowerCase());

export const PRODUCT_IMAGE_STANDARD=Object.freeze({
  aspect_ratio:'1:1',
  generation_size:'1024x1024',
  background:'#FFFFFF',
  breathing_room_percent:'8-12',
  default_format:'webp',
  default_compression:82,
  max_gallery_images:8,
  max_ai_generations_per_product_24h:3
});

export function catalogAiImageConfig(env=process.env){
  const provider=clean(env.CATALOG_AI_PROVIDER||env.SUPPORT_AI_PROVIDER||'',40).toLowerCase();
  const model=clean(env.CATALOG_AI_IMAGE_MODEL||'gpt-image-2',120);
  const quality=['low','medium','high'].includes(clean(env.CATALOG_AI_IMAGE_QUALITY||'medium',20).toLowerCase())
    ? clean(env.CATALOG_AI_IMAGE_QUALITY||'medium',20).toLowerCase()
    : 'medium';
  const apiKey=String(env.OPENAI_API_KEY||'');
  const enabled=truthy(env.CATALOG_AI_IMAGE_ENABLED);
  return{
    enabled,
    provider,
    model,
    quality,
    ready:enabled&&provider==='openai'&&Boolean(apiKey),
    apiKey
  };
}

export async function ensureCatalogMediaSchema(pool){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS catalog_product_media (
      id BIGSERIAL PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id BIGINT NOT NULL,
      source_type TEXT NOT NULL,
      data_url TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'image/webp',
      alt_text TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      approval_status TEXT NOT NULL DEFAULT 'draft',
      public_visible BOOLEAN NOT NULL DEFAULT FALSE,
      ai_provider TEXT NOT NULL DEFAULT '',
      ai_model TEXT NOT NULL DEFAULT '',
      prompt_sha256 TEXT NOT NULL DEFAULT '',
      created_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      approved_by_account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      approved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(entity_type IN ('marketplace_product','supplier_catalog_item')),
      CHECK(source_type IN ('ai_generated','merchant_upload','supplier_upload','authorized_external')),
      CHECK(approval_status IN ('draft','approved','archived'))
    );
    CREATE INDEX IF NOT EXISTS catalog_product_media_entity_idx
      ON catalog_product_media(entity_type,entity_id,approval_status,sort_order,id);
    CREATE UNIQUE INDEX IF NOT EXISTS catalog_product_media_one_primary
      ON catalog_product_media(entity_type,entity_id)
      WHERE is_primary=TRUE AND approval_status='approved' AND public_visible=TRUE;

    CREATE TABLE IF NOT EXISTS catalog_ai_generation_events (
      id BIGSERIAL PRIMARY KEY,
      account_id BIGINT REFERENCES accounts(id) ON DELETE SET NULL,
      entity_type TEXT NOT NULL,
      entity_id BIGINT NOT NULL,
      provider TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'requested',
      error_code TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(entity_type IN ('marketplace_product','supplier_catalog_item')),
      CHECK(status IN ('requested','succeeded','failed'))
    );
    CREATE INDEX IF NOT EXISTS catalog_ai_generation_events_guard_idx
      ON catalog_ai_generation_events(account_id,entity_type,entity_id,created_at DESC);
  `);
}

function validEntity(entityType,entityId){
  return ENTITY_TYPES.has(entityType)&&Number.isInteger(Number(entityId))&&Number(entityId)>0;
}

function decodeCatalogImageDataUrl(dataUrl){
  const raw=String(dataUrl||'');
  const match=raw.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/i);
  if(!match)throw Object.assign(new Error('Use a PNG, JPEG or WebP product image.'),{status:400,code:'CATALOG_IMAGE_FORMAT'});
  let bytes;
  try{bytes=Buffer.from(match[2],'base64')}catch{bytes=null}
  if(!bytes?.length)throw Object.assign(new Error('Product image could not be decoded.'),{status:400,code:'CATALOG_IMAGE_DECODE'});
  if(bytes.length>2_000_000)throw Object.assign(new Error('Product image must be 2 MB or smaller after compression.'),{status:413,code:'CATALOG_IMAGE_TOO_LARGE'});
  return{mimeType:'image/'+match[1].toLowerCase().replace('jpg','jpeg'),bytes,dataUrl:raw};
}

async function assertGalleryCapacity(pool,{entityType,entityId}){
  const existing=await pool.query(
    `SELECT COUNT(*)::int count FROM catalog_product_media
      WHERE entity_type=$1 AND entity_id=$2 AND approval_status<>'archived'`,
    [entityType,Number(entityId)]
  );
  if(Number(existing.rows[0]?.count||0)>=PRODUCT_IMAGE_STANDARD.max_gallery_images){
    throw Object.assign(new Error('This product gallery is full. Archive an image before adding another.'),{status:409,code:'CATALOG_GALLERY_LIMIT'});
  }
}

export async function createCatalogUpload(pool,{
  accountId,entityType,entityId,sourceType,dataUrl,altText=''
}){
  if(!validEntity(entityType,entityId))throw Object.assign(new Error('Invalid catalog media target.'),{status:400});
  if(!['merchant_upload','supplier_upload'].includes(sourceType))throw Object.assign(new Error('Invalid catalog upload source.'),{status:400});
  const decoded=decodeCatalogImageDataUrl(dataUrl);
  await assertGalleryCapacity(pool,{entityType,entityId});
  const {rows}=await pool.query(
    `INSERT INTO catalog_product_media(
       entity_type,entity_id,source_type,data_url,mime_type,alt_text,sort_order,is_primary,
       approval_status,public_visible,created_by_account_id
     )
     VALUES($1,$2,$3,$4,$5,$6,
       COALESCE((SELECT MAX(sort_order)+1 FROM catalog_product_media WHERE entity_type=$1 AND entity_id=$2),0),
       FALSE,'draft',FALSE,$7)
     RETURNING id,entity_type,entity_id,source_type,data_url,mime_type,alt_text,sort_order,is_primary,
               approval_status,public_visible,ai_provider,ai_model,created_at,approved_at`,
    [entityType,Number(entityId),sourceType,decoded.dataUrl,decoded.mimeType,clean(altText,300),Number(accountId)]
  );
  return rows[0];
}

export async function reorderCatalogMedia(pool,{entityType,entityId,mediaIds=[]}){
  if(!validEntity(entityType,entityId))throw Object.assign(new Error('Invalid catalog media target.'),{status:400});
  const ids=[...new Set((Array.isArray(mediaIds)?mediaIds:[]).map(Number).filter(Number.isInteger))];
  const current=await pool.query(
    `SELECT id FROM catalog_product_media
      WHERE entity_type=$1 AND entity_id=$2 AND approval_status<>'archived'
      ORDER BY sort_order,id`,
    [entityType,Number(entityId)]
  );
  const currentIds=current.rows.map(x=>Number(x.id));
  if(ids.length!==currentIds.length||ids.some(id=>!currentIds.includes(id))){
    throw Object.assign(new Error('Gallery order must include every current product image exactly once.'),{status:409,code:'CATALOG_GALLERY_ORDER'});
  }
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    for(let index=0;index<ids.length;index++){
      await client.query(
        `UPDATE catalog_product_media SET sort_order=$1,updated_at=NOW()
          WHERE id=$2 AND entity_type=$3 AND entity_id=$4 AND approval_status<>'archived'`,
        [index,ids[index],entityType,Number(entityId)]
      );
    }
    await client.query('COMMIT');
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{client.release()}
  return listCatalogMedia(pool,{entityType,entityId});
}

export async function listCatalogMedia(pool,{entityType,entityId,publicOnly=false}){
  if(!validEntity(entityType,entityId))return[];
  const {rows}=await pool.query(
    `SELECT id,entity_type,entity_id,source_type,data_url,mime_type,alt_text,sort_order,is_primary,
            approval_status,public_visible,ai_provider,ai_model,created_at,approved_at
       FROM catalog_product_media
      WHERE entity_type=$1 AND entity_id=$2
        ${publicOnly?"AND approval_status='approved' AND public_visible=TRUE":''}
      ORDER BY is_primary DESC,sort_order,id`,
    [entityType,Number(entityId)]
  );
  return rows;
}

export async function mediaForEntities(pool,{entityType,entityIds,publicOnly=false}){
  const ids=[...new Set((entityIds||[]).map(Number).filter(x=>Number.isInteger(x)&&x>0))];
  if(!ENTITY_TYPES.has(entityType)||!ids.length)return new Map();
  const {rows}=await pool.query(
    `SELECT id,entity_type,entity_id,source_type,data_url,mime_type,alt_text,sort_order,is_primary,
            approval_status,public_visible,ai_provider,ai_model,created_at,approved_at
       FROM catalog_product_media
      WHERE entity_type=$1 AND entity_id=ANY($2::bigint[])
        ${publicOnly?"AND approval_status='approved' AND public_visible=TRUE":''}
      ORDER BY entity_id,is_primary DESC,sort_order,id`,
    [entityType,ids]
  );
  const map=new Map(ids.map(id=>[id,[]]));
  for(const row of rows){
    const id=Number(row.entity_id);
    if(!map.has(id))map.set(id,[]);
    map.get(id).push(row);
  }
  return map;
}

export function buildPreparedFoodImagePrompt({name,description='',category='',recipe=[]}){
  const safeName=clean(name,120);
  if(!safeName)throw new Error('Product name is required for image generation.');
  const confirmed=(Array.isArray(recipe)?recipe:[])
    .map(x=>({
      item:clean(x?.item,100),
      quantity:Number(x?.quantity),
      unit:clean(x?.unit,24)
    }))
    .filter(x=>x.item&&Number.isFinite(x.quantity)&&x.quantity>0&&x.unit);
  if(!confirmed.length)throw new Error('A confirmed recipe is required before generating a prepared-food image.');

  const ingredientLine=confirmed.map(x=>`${x.item}: ${x.quantity} ${x.unit}`).join('; ');
  const descriptionLine=clean(description,500);
  const categoryLine=clean(category,80);

  return [
    'Create one photorealistic professional ecommerce catalog photograph.',
    `Product: ${safeName}.`,
    categoryLine?`Category: ${categoryLine}.`:'',
    descriptionLine?`Merchant-confirmed description: ${descriptionLine}.`:'',
    `Merchant-confirmed recipe ingredients and amounts: ${ingredientLine}.`,
    'Show the finished prepared dish clearly in a neutral white or very light serving vessel.',
    'Use a clean 30–45 degree product-photography angle unless a top-down angle is clearly better for this dish.',
    'Use a pure white (#FFFFFF) seamless background with a soft natural contact shadow.',
    'Center the product and keep about 8–12 percent breathing room around it.',
    'The image must look realistic, appetizing, restrained and suitable for a professional online catalog.',
    'Do not show people, hands, cutlery scenes, tables, restaurant backgrounds, packaging, decorative props or lifestyle context.',
    'Do not add any visible ingredient or garnish that is not present in the confirmed recipe list.',
    'Do not exaggerate serving size or imply a portion size that was not supplied.',
    'Do not include text, price, labels, watermarks, logos, badges, borders or pseudo-writing anywhere in the image.',
    'Do not create branded packaging.',
    'Square composition, product only, truthful reference representation.'
  ].filter(Boolean).join(' ');
}

async function generationAllowance(pool,{accountId,entityType,entityId}){
  const {rows}=await pool.query(
    `SELECT COUNT(*)::int count
       FROM catalog_ai_generation_events
      WHERE account_id=$1 AND entity_type=$2 AND entity_id=$3
        AND created_at>NOW()-INTERVAL '24 hours'
        AND status IN ('requested','succeeded')`,
    [Number(accountId),entityType,Number(entityId)]
  );
  const count=Number(rows[0]?.count||0);
  return{allowed:count<PRODUCT_IMAGE_STANDARD.max_ai_generations_per_product_24h,count};
}

export async function generateCatalogImage(pool,{
  accountId,entityType,entityId,prompt,altText='',env=process.env
}){
  if(!validEntity(entityType,entityId))throw Object.assign(new Error('Invalid catalog media target.'),{status:400});
  const config=catalogAiImageConfig(env);
  if(!config.enabled)throw Object.assign(new Error('AI product-image generation is currently disabled.'),{status:503,code:'CATALOG_AI_IMAGE_DISABLED'});
  if(config.provider!=='openai'||!config.apiKey)throw Object.assign(new Error('AI product-image generation is not configured.'),{status:503,code:'CATALOG_AI_IMAGE_NOT_CONFIGURED'});

  const allowance=await generationAllowance(pool,{accountId,entityType,entityId});
  if(!allowance.allowed)throw Object.assign(new Error('This product reached the AI image generation limit for the last 24 hours.'),{status:429,code:'CATALOG_AI_IMAGE_LIMIT'});

  const promptHash=crypto.createHash('sha256').update(String(prompt)).digest('hex');
  const event=await pool.query(
    `INSERT INTO catalog_ai_generation_events(account_id,entity_type,entity_id,provider,model,status)
     VALUES($1,$2,$3,$4,$5,'requested') RETURNING id`,
    [Number(accountId),entityType,Number(entityId),config.provider,config.model]
  );
  const eventId=Number(event.rows[0].id);

  try{
    const response=await fetch('https://api.openai.com/v1/images/generations',{
      method:'POST',
      headers:{
        Authorization:`Bearer ${config.apiKey}`,
        'Content-Type':'application/json'
      },
      body:JSON.stringify({
        model:config.model,
        prompt:String(prompt),
        n:1,
        size:PRODUCT_IMAGE_STANDARD.generation_size,
        quality:config.quality,
        output_format:'webp',
        output_compression:PRODUCT_IMAGE_STANDARD.default_compression,
        background:'opaque',
        user:`business-life-account-${Number(accountId)}`
      })
    });
    const body=await response.json().catch(()=>({}));
    if(!response.ok||!body?.data?.[0]?.b64_json){
      const code=clean(body?.error?.code||body?.error?.type||`provider_${response.status}`,120);
      await pool.query(`UPDATE catalog_ai_generation_events SET status='failed',error_code=$1,updated_at=NOW() WHERE id=$2`,[code,eventId]).catch(()=>{});
      throw Object.assign(new Error('AI could not generate the product image right now.'),{status:502,code:'CATALOG_AI_IMAGE_PROVIDER_ERROR'});
    }
    const base64=String(body.data[0].b64_json);
    const bytes=Buffer.from(base64,'base64').length;
    if(!bytes||bytes>2_000_000){
      await pool.query(`UPDATE catalog_ai_generation_events SET status='failed',error_code='generated_asset_too_large',updated_at=NOW() WHERE id=$1`,[eventId]).catch(()=>{});
      throw Object.assign(new Error('Generated product image exceeded the pilot storage limit.'),{status:502,code:'CATALOG_AI_IMAGE_TOO_LARGE'});
    }

    try{
      await assertGalleryCapacity(pool,{entityType,entityId});
    }catch(error){
      if(error?.code==='CATALOG_GALLERY_LIMIT')await pool.query(`UPDATE catalog_ai_generation_events SET status='failed',error_code='gallery_limit',updated_at=NOW() WHERE id=$1`,[eventId]).catch(()=>{});
      throw error;
    }

    const media=await pool.query(
      `INSERT INTO catalog_product_media(
         entity_type,entity_id,source_type,data_url,mime_type,alt_text,sort_order,is_primary,
         approval_status,public_visible,ai_provider,ai_model,prompt_sha256,created_by_account_id
       )
       VALUES($1,$2,'ai_generated',$3,'image/webp',$4,
         COALESCE((SELECT MAX(sort_order)+1 FROM catalog_product_media WHERE entity_type=$1 AND entity_id=$2),0),
         FALSE,'draft',FALSE,$5,$6,$7,$8)
       RETURNING id,entity_type,entity_id,source_type,data_url,mime_type,alt_text,sort_order,is_primary,
                 approval_status,public_visible,ai_provider,ai_model,created_at,approved_at`,
      [entityType,Number(entityId),`data:image/webp;base64,${base64}`,clean(altText,300),config.provider,config.model,promptHash,Number(accountId)]
    );
    await pool.query(`UPDATE catalog_ai_generation_events SET status='succeeded',updated_at=NOW() WHERE id=$1`,[eventId]);
    return media.rows[0];
  }catch(error){
    if(error?.code!=='CATALOG_AI_IMAGE_PROVIDER_ERROR'&&error?.code!=='CATALOG_AI_IMAGE_TOO_LARGE'&&error?.code!=='CATALOG_GALLERY_LIMIT'){
      await pool.query(`UPDATE catalog_ai_generation_events SET status='failed',error_code=$1,updated_at=NOW() WHERE id=$2`,[clean(error?.code||'unexpected_generation_error',120),eventId]).catch(()=>{});
    }
    throw error;
  }
}

export async function approveCatalogMedia(pool,{
  accountId,entityType,entityId,mediaId,makePrimary=true
}){
  if(!validEntity(entityType,entityId)||!Number.isInteger(Number(mediaId)))throw Object.assign(new Error('Invalid catalog media request.'),{status:400});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const found=await client.query(
      `SELECT * FROM catalog_product_media WHERE id=$1 AND entity_type=$2 AND entity_id=$3 FOR UPDATE`,
      [Number(mediaId),entityType,Number(entityId)]
    );
    if(!found.rowCount)throw Object.assign(new Error('Product image not found.'),{status:404});
    if(found.rows[0].approval_status==='archived')throw Object.assign(new Error('Archived product images cannot be approved.'),{status:409});
    if(makePrimary){
      if(found.rows[0].source_type!=='ai_generated'){
        await client.query(
          `UPDATE catalog_product_media
              SET approval_status='archived',public_visible=FALSE,is_primary=FALSE,updated_at=NOW()
            WHERE entity_type=$1 AND entity_id=$2 AND id<>$3
              AND source_type='ai_generated' AND is_primary=TRUE
              AND approval_status='approved' AND public_visible=TRUE`,
          [entityType,Number(entityId),Number(mediaId)]
        );
      }
      await client.query(
        `UPDATE catalog_product_media
            SET is_primary=FALSE,updated_at=NOW()
          WHERE entity_type=$1 AND entity_id=$2 AND id<>$3`,
        [entityType,Number(entityId),Number(mediaId)]
      );
    }
    const {rows}=await client.query(
      `UPDATE catalog_product_media
          SET approval_status='approved',public_visible=TRUE,is_primary=$1,
              approved_by_account_id=$2,approved_at=COALESCE(approved_at,NOW()),updated_at=NOW()
        WHERE id=$3
        RETURNING id,entity_type,entity_id,source_type,data_url,mime_type,alt_text,sort_order,is_primary,
                  approval_status,public_visible,ai_provider,ai_model,created_at,approved_at`,
      [Boolean(makePrimary),Number(accountId),Number(mediaId)]
    );
    await client.query('COMMIT');
    return rows[0];
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{client.release()}
}

export async function archiveCatalogMedia(pool,{entityType,entityId,mediaId}){
  if(!validEntity(entityType,entityId)||!Number.isInteger(Number(mediaId)))throw Object.assign(new Error('Invalid catalog media request.'),{status:400});
  const {rows}=await pool.query(
    `UPDATE catalog_product_media
        SET approval_status='archived',public_visible=FALSE,is_primary=FALSE,updated_at=NOW()
      WHERE id=$1 AND entity_type=$2 AND entity_id=$3
      RETURNING id`,
    [Number(mediaId),entityType,Number(entityId)]
  );
  if(!rows.length)throw Object.assign(new Error('Product image not found.'),{status:404});
  return{ok:true,id:Number(rows[0].id)};
}

export { ENTITY_TYPES, SOURCE_TYPES, APPROVAL_STATES, decodeCatalogImageDataUrl };
