import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  CATALOG_V3_SCHEMA_VERSION,
  catalogCategoryAttributes,
  catalogEditorSchema,
  normalizeCatalogIdentity,
  normalizeCatalogAttributes,
  ensureCatalogV3Schema
} from '../catalog-v3-core.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('catalog editor schema separates Food and Non-food categories',()=>{
  const food=catalogEditorSchema('food');
  const retail=catalogEditorSchema('non_food');
  assert.equal(food.version,CATALOG_V3_SCHEMA_VERSION);
  assert.ok(food.categories.some(x=>x.code==='prepared_food'));
  assert.ok(food.categories.some(x=>x.code==='packaged_food_drink'));
  assert.ok(food.categories.every(x=>x.domain_hint==='food'));
  assert.ok(retail.categories.some(x=>x.code==='clothing_fashion'));
  assert.ok(retail.categories.some(x=>x.code==='mobile_phone'));
  assert.ok(retail.categories.some(x=>x.code==='hardware_tools'));
  assert.ok(retail.categories.every(x=>x.domain_hint==='non_food'));
});

test('category metadata exposes only relevant adaptive attributes',()=>{
  const clothing=catalogCategoryAttributes('clothing_fashion').map(x=>x.attribute_code);
  const phone=catalogCategoryAttributes('mobile_phone').map(x=>x.attribute_code);
  assert.ok(clothing.includes('size'));
  assert.ok(clothing.includes('material'));
  assert.ok(!clothing.includes('ram'));
  assert.ok(phone.includes('storage_capacity'));
  assert.ok(phone.includes('ram'));
  assert.ok(!phone.includes('fit'));
});

test('catalog identity validates category/domain and condition without forcing legacy products',()=>{
  const identity=normalizeCatalogIdentity({
    catalog_category_code:'mobile_phone',
    brand:'  Example Brand  ',
    model:' Model X ',
    condition_code:'Refurbished',
    manufacturer_part_number:' MP-1 '
  },{domain:'non_food'});
  assert.equal(identity.brand,'Example Brand');
  assert.equal(identity.model,'Model X');
  assert.equal(identity.condition_code,'refurbished');
  assert.equal(identity.catalog_schema_version,CATALOG_V3_SCHEMA_VERSION);
  assert.throws(
    ()=>normalizeCatalogIdentity({catalog_category_code:'prepared_food'},{domain:'non_food'}),
    /does not match/
  );
  assert.throws(
    ()=>normalizeCatalogIdentity({catalog_category_code:'not-real'},{domain:'non_food'}),
    /supported product category/
  );
  assert.equal(normalizeCatalogIdentity({},{domain:'food'}).catalog_category_code,null);
});

test('adaptive attribute validation rejects unrelated fields and validates typed values',()=>{
  const attrs=normalizeCatalogAttributes('mobile_phone',{
    color:'Black',
    storage_capacity:'256 GB',
    ram:'12 GB',
    screen_size_in:'6.7',
    warranty_months:12
  });
  assert.equal(attrs.screen_size_in,6.7);
  assert.equal(attrs.warranty_months,12);
  assert.throws(
    ()=>normalizeCatalogAttributes('mobile_phone',{material:'steel'}),
    /not a supported attribute/
  );
  assert.throws(
    ()=>normalizeCatalogAttributes('mobile_phone',{warranty_months:'abc'}),
    /valid zero-or-greater number/
  );
});

test('required category attributes remain explicit',()=>{
  assert.throws(
    ()=>normalizeCatalogAttributes('footwear',{color:'Black'}),
    /Size is required/
  );
  assert.deepEqual(
    normalizeCatalogAttributes('footwear',{size:'42',color:'Black'}),
    {size:'42',color:'Black'}
  );
});

test('schema bootstrap is additive and seeds canonical metadata',async()=>{
  const calls=[];
  const db={query:async(sql,args=[])=>{calls.push({sql:String(sql),args});return{rows:[],rowCount:0}}};
  await ensureCatalogV3Schema(db);
  assert.equal(calls.length,4);
  assert.match(calls[0].sql,/CREATE TABLE IF NOT EXISTS catalog_categories/);
  assert.match(calls[0].sql,/ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS catalog_category_code/);
  assert.match(calls[0].sql,/CREATE TABLE IF NOT EXISTS catalog_product_attribute_values/);
  assert.match(calls[1].sql,/INSERT INTO catalog_categories/);
  assert.match(calls[2].sql,/INSERT INTO catalog_attribute_definitions/);
  assert.match(calls[3].sql,/INSERT INTO catalog_category_attributes/);
  assert.ok(String(calls[1].args[0]).includes('mobile_phone'));
  assert.ok(String(calls[2].args[0]).includes('storage_capacity'));
});

test('Marketplace integration contract initializes Catalog V3 and exposes Merchant metadata only',()=>{
  const server=read('server-marketplace.js');
  assert.match(server,/ensureCatalogV3Schema/);
  assert.match(server,/catalogEditorSchema/);
  assert.match(server,/\/api\/merchant\/catalog-v3\/schema/);
  assert.doesNotMatch(server,/\/api\/public\/marketplace\/catalog-v3\/schema/);
});

test('package syntax contract includes Catalog V3 core and tests',()=>{
  const pkg=read('package.json');
  assert.match(pkg,/node --check catalog-v3-core\.js/);
  assert.match(pkg,/node --check tests\/catalog-v3-core\.test\.js/);
});
