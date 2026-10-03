import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  INVENTORY_CLASSIFICATION_VERSION,
  INVENTORY_DOMAINS,
  INVENTORY_STOCK_ROLES,
  legacyInventoryClassification,
  normalizeInventoryClassification,
  compatibilityInventoryType,
  inventoryClassificationInputProvided,
  ensureUniversalInventorySchema
} from '../universal-inventory-core.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('universal Inventory exposes one domain taxonomy for Food Retail and Operations',()=>{
  assert.deepEqual([...INVENTORY_DOMAINS],['food','non_food','operations']);
  assert.ok(INVENTORY_STOCK_ROLES.includes('ingredient'));
  assert.ok(INVENTORY_STOCK_ROLES.includes('direct_resale'));
  assert.ok(INVENTORY_STOCK_ROLES.includes('production_material'));
  assert.ok(INVENTORY_STOCK_ROLES.includes('packaging'));
});

test('legacy Food inventory types migrate deterministically without separate stock engines',()=>{
  assert.deepEqual(legacyInventoryClassification('ingredient'),{inventory_domain:'food',stock_role:'ingredient'});
  assert.deepEqual(legacyInventoryClassification('packaging'),{inventory_domain:'operations',stock_role:'packaging'});
  assert.deepEqual(legacyInventoryClassification('kitchen_consumable'),{inventory_domain:'operations',stock_role:'operational_consumable'});
  assert.deepEqual(legacyInventoryClassification('cleaning_sanitation'),{inventory_domain:'operations',stock_role:'operational_supply'});
  assert.deepEqual(legacyInventoryClassification('resale_item'),{inventory_domain:'non_food',stock_role:'direct_resale'});
});

test('explicit classification validates domain and stock-role compatibility',()=>{
  const retail=normalizeInventoryClassification({
    inventory_domain:'non_food',stock_role:'direct_resale'
  },{inventoryType:'ingredient'});
  assert.equal(retail.inventory_domain,'non_food');
  assert.equal(retail.stock_role,'direct_resale');
  assert.equal(retail.classification_version,INVENTORY_CLASSIFICATION_VERSION);

  assert.throws(
    ()=>normalizeInventoryClassification({inventory_domain:'non_food',stock_role:'ingredient'}),
    /not valid/
  );
  assert.throws(
    ()=>normalizeInventoryClassification({inventory_domain:'operations',stock_role:'direct_resale'}),
    /not valid/
  );
  assert.throws(
    ()=>normalizeInventoryClassification({inventory_domain:'unknown',stock_role:'ingredient'}),
    /valid Inventory domain/
  );
});

test('compatibility inventory_type preserves existing Food consumers while new taxonomy becomes canonical',()=>{
  assert.equal(compatibilityInventoryType({inventory_domain:'food',stock_role:'ingredient'}),'ingredient');
  assert.equal(compatibilityInventoryType({inventory_domain:'food',stock_role:'direct_resale'}),'resale_item');
  assert.equal(compatibilityInventoryType({inventory_domain:'non_food',stock_role:'direct_resale'}),'resale_item');
  assert.equal(compatibilityInventoryType({inventory_domain:'non_food',stock_role:'production_material'}),'production_material');
  assert.equal(
    compatibilityInventoryType({inventory_domain:'operations',stock_role:'operational_consumable'},'hygiene'),
    'hygiene'
  );
});

test('classification input detection distinguishes legacy writes from explicit universal writes',()=>{
  assert.equal(inventoryClassificationInputProvided({inventory_type:'ingredient'}),false);
  assert.equal(inventoryClassificationInputProvided({inventory_domain:'non_food'}),true);
  assert.equal(inventoryClassificationInputProvided({stock_role:'direct_resale'}),true);
});

test('schema bootstrap is additive and remaps catalog-linked resale stock when Marketplace exists',async()=>{
  const calls=[];
  const db={
    query:async(sql,args=[])=>{
      const text=String(sql);
      calls.push({sql:text,args});
      if(text.includes("to_regclass('public.marketplace_products')"))return{rows:[{rel:'marketplace_products'}],rowCount:1};
      return{rows:[],rowCount:0};
    }
  };
  const result=await ensureUniversalInventorySchema(db);
  assert.equal(result.version,INVENTORY_CLASSIFICATION_VERSION);
  assert.equal(result.marketplace_available,true);
  assert.match(calls[0].sql,/ADD COLUMN IF NOT EXISTS inventory_domain/);
  assert.match(calls[0].sql,/ADD COLUMN IF NOT EXISTS stock_role/);
  assert.match(calls[0].sql,/inventory_domain_role_check/);
  const linked=calls.find(x=>/FROM marketplace_products/.test(x.sql)&&/stock_role='direct_resale'/.test(x.sql));
  assert.ok(linked);
  assert.doesNotMatch(linked.sql,/inventory_type\s*=/);
});

test('when Marketplace is not initialized, ambiguous legacy ingredients stay pending instead of being misclassified',async()=>{
  const calls=[];
  const db={
    query:async(sql,args=[])=>{
      const text=String(sql);calls.push({sql:text,args});
      if(text.includes("to_regclass('public.marketplace_products')"))return{rows:[{rel:null}],rowCount:1};
      return{rows:[],rowCount:0};
    }
  };
  const result=await ensureUniversalInventorySchema(db);
  assert.equal(result.marketplace_available,false);
  assert.ok(!calls.some(x=>/FROM marketplace_products/.test(x.sql)));
  const migration=calls.find(x=>/inventory_type<>'ingredient'/.test(x.sql));
  assert.ok(migration);
  assert.ok(!calls.some(x=>/inventory_type='ingredient'/.test(x.sql)&&/classification_version=\$1/.test(x.sql)));
});

test('Accounting runtime initializes Universal Inventory and supports explicit classification writes',()=>{
  const server=read('server-business-accounting.js');
  assert.match(server,/ensureUniversalInventorySchema/);
  assert.match(server,/normalizeInventoryClassification/);
  assert.match(server,/compatibilityInventoryType/);
  assert.match(server,/inventory_domain/);
  assert.match(server,/stock_role/);
  assert.match(server,/classification_version/);
});

test('package syntax contract includes Universal Inventory V2A core and tests',()=>{
  const pkg=read('package.json');
  assert.match(pkg,/node --check universal-inventory-core\.js/);
  assert.match(pkg,/node --check tests\/universal-inventory-v2a\.test\.js/);
});
