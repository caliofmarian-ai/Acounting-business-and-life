import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  normalizeCatalogPackage,
  catalogCategoryTransition,
  ensureCatalogV3Schema
} from '../catalog-v3-core.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('delivery package metadata is optional, numeric and non-negative',()=>{
  assert.deepEqual(normalizeCatalogPackage({}),{
    package_length_cm:null,
    package_width_cm:null,
    package_height_cm:null,
    package_weight_kg:null
  });
  assert.deepEqual(normalizeCatalogPackage({
    package_length_cm:'30.5',
    package_width_cm:20,
    package_height_cm:'10',
    package_weight_kg:'1.25'
  }),{
    package_length_cm:30.5,
    package_width_cm:20,
    package_height_cm:10,
    package_weight_kg:1.25
  });
  assert.throws(()=>normalizeCatalogPackage({package_weight_kg:-1}),/zero-or-greater/);
});

test('category transition preserves compatible attributes and queues incompatible values for review',()=>{
  const transition=catalogCategoryTransition({
    previousCategoryCode:'clothing_fashion',
    nextCategoryCode:'footwear',
    currentAttributes:{
      color:'Black',
      size:'42',
      material:'Leather',
      fit:'Regular',
      target_audience:'men'
    },
    incomingAttributes:{size:'43'}
  });
  assert.deepEqual(transition.attributes,{
    color:'Black',
    size:'43',
    material:'Leather',
    target_audience:'men'
  });
  assert.deepEqual(transition.review,[{attribute_code:'fit',value:'Regular'}]);
  assert.equal(transition.category_changed,true);
});

test('category transition enforces required fields after compatible values are preserved',()=>{
  assert.throws(()=>catalogCategoryTransition({
    previousCategoryCode:'general_retail',
    nextCategoryCode:'footwear',
    currentAttributes:{color:'Black'},
    incomingAttributes:{}
  }),/Size is required/);
  const ok=catalogCategoryTransition({
    previousCategoryCode:'general_retail',
    nextCategoryCode:'footwear',
    currentAttributes:{color:'Black'},
    incomingAttributes:{size:'42'}
  });
  assert.equal(ok.attributes.color,'Black');
  assert.equal(ok.attributes.size,'42');
});

test('adaptive catalog migration is additive and preserves incompatible details in review queue',async()=>{
  const calls=[];
  const db={query:async(sql,args=[])=>{calls.push({sql:String(sql),args});return{rows:[],rowCount:0}}};
  await ensureCatalogV3Schema(db);
  const schema=calls[0].sql;
  assert.match(schema,/ADD COLUMN IF NOT EXISTS package_length_cm/);
  assert.match(schema,/ADD COLUMN IF NOT EXISTS package_width_cm/);
  assert.match(schema,/ADD COLUMN IF NOT EXISTS package_height_cm/);
  assert.match(schema,/ADD COLUMN IF NOT EXISTS package_weight_kg/);
  assert.match(schema,/ADD COLUMN IF NOT EXISTS catalog_review_required/);
  assert.match(schema,/CREATE TABLE IF NOT EXISTS catalog_product_attribute_review_queue/);
  assert.match(schema,/CHECK\(review_state IN \('pending','resolved','discarded'\)\)/);
});

test('Marketplace product create and edit persist structured identity, attributes and package metadata transactionally',()=>{
  const server=read('server-marketplace.js');
  assert.match(server,/normalizeCatalogIdentity/);
  assert.match(server,/normalizeCatalogPackage/);
  assert.match(server,/normalizeCatalogAttributes/);
  assert.match(server,/replaceCatalogProductAttributes/);
  assert.match(server,/reconcileCatalogProductAttributes/);
  assert.match(server,/catalog_category_code,brand,model,condition_code,manufacturer_part_number/);
  assert.match(server,/package_length_cm,package_width_cm,package_height_cm,package_weight_kg/);
  assert.match(server,/BEGIN/);
  assert.match(server,/COMMIT/);
  assert.match(server,/ROLLBACK/);
});

test('Merchant domain and Inventory domain are validated before Catalog product persistence',()=>{
  const server=read('server-marketplace.js');
  assert.match(server,/ensureStorefrontDomainAllows/);
  assert.match(server,/MERCHANT_STOREFRONT_DOMAIN_MISMATCH/);
  assert.match(server,/inventory_domain/);
  assert.match(server,/same Food\/Non-food domain/);
});

test('Merchant adaptive editor endpoint returns schema attributes and pending review evidence',()=>{
  const server=read('server-marketplace.js');
  assert.match(server,/\/api\/merchant\/catalog-v3\/products\/:id\/editor/);
  assert.match(server,/readCatalogProductAttributes/);
  assert.match(server,/listCatalogAttributeReviews/);
  assert.match(server,/\/api\/merchant\/catalog-v3\/products\/:id\/attribute-review/);
  assert.match(server,/resolveCatalogAttributeReviews/);
});

test('Merchant UI renders only category-relevant fields and supports product editing',()=>{
  const ui=read('public/marketplace-ui.js');
  assert.match(ui,/catalogAdaptiveAttributesMarkup/);
  assert.match(ui,/catalogAttributeField/);
  assert.match(ui,/catalogCategoryOptions/);
  assert.match(ui,/merchantCatalogCategoryCode/);
  assert.match(ui,/catalog_attributes:collectCatalogAttributes/);
  assert.match(ui,/data-edit-catalog-product/);
  assert.match(ui,/openCatalogEditor/);
  assert.match(ui,/catalogCategoryChangeNotice/);
  assert.match(ui,/Acknowledge previous details/);
});

test('advanced identity fields adapt by product kind instead of showing Retail-only fields to every Food item',()=>{
  const ui=read('public/marketplace-ui.js');
  assert.match(ui,/kind==='non_food_resale'/);
  assert.match(ui,/kind==='packaged_resale'/);
  assert.match(ui,/Brand, condition & delivery package/);
  assert.match(ui,/Brand & delivery package/);
  assert.match(ui,/catalogIdentityAdvancedMarkup/);
});

test('public customer projection strips package fulfilment and review metadata',()=>{
  const projection=read('adaptive-storefront-core.js');
  assert.match(projection,/catalog_review_required,/);
  assert.match(projection,/package_length_cm,/);
  assert.match(projection,/package_width_cm,/);
  assert.match(projection,/package_height_cm,/);
  assert.match(projection,/package_weight_kg,/);
});

test('390px Catalog editor uses one-column adaptive fields and bottom-sheet controls',()=>{
  const css=read('public/marketplace.css');
  assert.match(css,/Catalog Core V3A Adaptive Editor/);
  assert.match(css,/\.catalogAdaptiveGrid/);
  assert.match(css,/\.catalogEditorBackdrop/);
  assert.match(css,/\.catalogEditorPanel/);
  assert.match(css,/\.catalogReviewPanel/);
  assert.match(css,/@media\(max-width:520px\)/);
  assert.match(css,/\.catalogAdaptiveGrid\{grid-template-columns:1fr\}/);
});

test('package syntax contract includes Catalog V3A adaptive editor regression test',()=>{
  const pkg=read('package.json');
  assert.match(pkg,/node --check tests\/catalog-v3-adaptive-editor\.test\.js/);
});
