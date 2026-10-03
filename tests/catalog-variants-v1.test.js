import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  VARIANT_SCHEMA_VERSION,
  MAX_OPTIONS,
  normalizeVariantConfiguration,
  ensureCatalogVariantSchema
} from '../catalog-variants-core.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('retail variants support up to three explicit option axes',()=>{
  const normalized=normalizeVariantConfiguration({
    options:[
      {label:'Colour',values:['Black','White']},
      {label:'Size',values:['S','M','L']}
    ],
    variants:[
      {inventory_id:11,option_values:{colour:'Black',size:'S'}},
      {inventory_id:12,option_values:{colour:'White',size:'M'},price_override:849}
    ]
  });
  assert.equal(normalized.version,VARIANT_SCHEMA_VERSION);
  assert.equal(normalized.options.length,2);
  assert.equal(normalized.variants[0].variant_key,'colour=black|size=s');
  assert.equal(normalized.variants[1].price_override,849);
  assert.equal(MAX_OPTIONS,3);
});

test('retail variants reject duplicate combinations and duplicate Inventory bindings',()=>{
  assert.throws(()=>normalizeVariantConfiguration({
    options:[{label:'Size',values:['S','M']}],
    variants:[
      {inventory_id:11,option_values:{size:'S'}},
      {inventory_id:12,option_values:{size:'S'}}
    ]
  }),/same variant combination/);
  assert.throws(()=>normalizeVariantConfiguration({
    options:[{label:'Size',values:['S','M']}],
    variants:[
      {inventory_id:11,option_values:{size:'S'}},
      {inventory_id:11,option_values:{size:'M'}}
    ]
  }),/same Inventory item/);
});

test('retail variants require a valid value for every configured option',()=>{
  assert.throws(()=>normalizeVariantConfiguration({
    options:[
      {label:'Colour',values:['Black']},
      {label:'Size',values:['M']}
    ],
    variants:[{inventory_id:9,option_values:{colour:'Black'}}]
  }),/valid Size/);
  assert.throws(()=>normalizeVariantConfiguration({
    options:[{label:'Size',values:['M']}],
    variants:[{inventory_id:9,option_values:{size:'XL'}}]
  }),/valid Size/);
});

test('variant price override is optional and cannot be negative',()=>{
  const normalized=normalizeVariantConfiguration({
    options:[{label:'Storage',values:['128 GB']}],
    variants:[{inventory_id:44,option_values:{storage:'128 GB'},price_override:''}]
  });
  assert.equal(normalized.variants[0].price_override,null);
  assert.throws(()=>normalizeVariantConfiguration({
    options:[{label:'Storage',values:['128 GB']}],
    variants:[{inventory_id:44,option_values:{storage:'128 GB'},price_override:-1}]
  }),/zero or greater/);
});

test('variant schema is additive and reuses Inventory as SKU/barcode/stock authority',async()=>{
  const calls=[];
  const db={query:async(sql,args=[])=>{calls.push({sql:String(sql),args});return{rows:[],rowCount:0}}};
  await ensureCatalogVariantSchema(db);
  assert.equal(calls.length,1);
  assert.match(calls[0].sql,/ADD COLUMN IF NOT EXISTS variant_mode BOOLEAN/);
  assert.match(calls[0].sql,/CREATE TABLE IF NOT EXISTS catalog_product_variants/);
  assert.match(calls[0].sql,/inventory_id BIGINT REFERENCES inventory/);
  assert.doesNotMatch(calls[0].sql,/internal_sku TEXT/);
  assert.doesNotMatch(calls[0].sql,/barcode TEXT/);
  assert.match(calls[0].sql,/ADD COLUMN IF NOT EXISTS catalog_variant_id/);
  assert.match(calls[0].sql,/variant_snapshot_json/);
});

test('Marketplace integration exposes Merchant variant routes and keeps Inventory identifiers canonical',()=>{
  const server=read('server-marketplace.js');
  const stock=read('order-stock-reservation.js');
  const identifiers=read('inventory-identifiers.js');
  assert.match(server,/ensureCatalogVariantSchema/);
  assert.match(server,/\/api\/merchant\/storefront\/products\/:id\/variants/);
  assert.match(server,/catalog_variant_id/);
  assert.match(stock,/catalog_variant_id/);
  assert.match(identifiers,/ALTER TABLE inventory ADD COLUMN IF NOT EXISTS internal_sku/);
  assert.match(identifiers,/ALTER TABLE inventory ADD COLUMN IF NOT EXISTS barcode/);
});

test('package syntax contract includes retail variant core and tests',()=>{
  const pkg=read('package.json');
  assert.match(pkg,/node --check catalog-variants-core\.js/);
  assert.match(pkg,/node --check tests\/catalog-variants-v1\.test\.js/);
});
