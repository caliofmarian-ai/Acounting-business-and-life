import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PRODUCT_IMAGE_STANDARD,
  catalogAiImageConfig,
  buildPreparedFoodImagePrompt
} from '../catalog-media-core.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('product image standard is square white-background and bounded',()=>{
  assert.equal(PRODUCT_IMAGE_STANDARD.aspect_ratio,'1:1');
  assert.equal(PRODUCT_IMAGE_STANDARD.generation_size,'1024x1024');
  assert.equal(PRODUCT_IMAGE_STANDARD.background,'#FFFFFF');
  assert.equal(PRODUCT_IMAGE_STANDARD.max_ai_generations_per_product_24h,3);
  assert.equal(PRODUCT_IMAGE_STANDARD.max_gallery_images,8);
});

test('catalog AI image generation is explicitly gated and environment-only',()=>{
  assert.equal(catalogAiImageConfig({}).ready,false);
  const cfg=catalogAiImageConfig({
    CATALOG_AI_IMAGE_ENABLED:'true',
    CATALOG_AI_PROVIDER:'openai',
    CATALOG_AI_IMAGE_MODEL:'gpt-image-2',
    CATALOG_AI_IMAGE_QUALITY:'medium',
    OPENAI_API_KEY:'runtime-only-test-value'
  });
  assert.equal(cfg.ready,true);
  assert.equal(cfg.provider,'openai');
  assert.equal(cfg.quality,'medium');
});

test('prepared-food prompt uses only confirmed recipe facts and canonical catalog rules',()=>{
  const prompt=buildPreparedFoodImagePrompt({
    name:'Fish soup',
    description:'House fish soup',
    category:'Soup',
    recipe:[
      {item:'Water',quantity:800,unit:'ml'},
      {item:'Fish',quantity:250,unit:'g'},
      {item:'Carrot',quantity:100,unit:'g'},
      {item:'Parsley',quantity:10,unit:'g'}
    ]
  });
  assert.match(prompt,/pure white \(#FFFFFF\)/i);
  assert.match(prompt,/Fish: 250 g/);
  assert.match(prompt,/Carrot: 100 g/);
  assert.match(prompt,/Do not add any visible ingredient or garnish/i);
  assert.match(prompt,/Do not include text, price, labels, watermarks/i);
  assert.match(prompt,/Square composition/i);
  assert.doesNotMatch(prompt,/lemon|cream|wine/i);
});

test('prepared-food image generation refuses a recipe with no confirmed ingredients',()=>{
  assert.throws(()=>buildPreparedFoodImagePrompt({name:'Fish soup',recipe:[]}),/confirmed recipe/i);
});

test('catalog media implementation keeps AI draft separate from explicit approval and publication',()=>{
  const core=read('catalog-media-core.js');
  const server=read('server-marketplace.js');
  const ui=read('public/marketplace-ui.js');
  const guest=read('public/guest-explore.js');

  assert.match(core,/approval_status='approved'/);
  assert.match(core,/'ai_generated'/);
  assert.match(core,/status IN \('requested','succeeded'\)/);
  assert.match(core,/https:\/\/api\.openai\.com\/v1\/images\/generations/);
  assert.match(core,/output_format:'webp'/);
  assert.match(core,/output_compression:PRODUCT_IMAGE_STANDARD\.default_compression/);
  assert.match(core,/process\.env|env=process\.env/);
  assert.doesNotMatch(core,/sk-[A-Za-z0-9_-]{12,}/);

  assert.match(server,/images\/generate/);
  assert.match(server,/images\/:mediaId\/approve/);
  assert.match(server,/product_kind!=='prepared_food'/);
  assert.match(server,/Confirm this product recipe before generating/);
  assert.match(ui,/Generate AI image/);
  assert.match(ui,/Use as primary/);
  assert.match(ui,/AI-generated reference image/);
  assert.match(guest,/AI-generated reference image/);
});

test('canonical product image documentation exists and forbids misleading branded reconstruction',()=>{
  const doc=read('docs/marketplace/PRODUCT_IMAGE_STANDARD.md');
  assert.match(doc,/pure white background/i);
  assert.match(doc,/AI-generated reference image/);
  assert.match(doc,/must not invent/i);
  assert.match(doc,/branded packaging/i);
  assert.match(doc,/multiple images/i);
});
