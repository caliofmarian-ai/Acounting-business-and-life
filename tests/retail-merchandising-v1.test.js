import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  RETAIL_MERCHANDISING_VERSION,
  MAX_CATALOG_PAGE_SIZE,
  MAX_BULK_PRODUCTS,
  normalizeCollectionConfiguration,
  normalizeBulkProductIds,
  ensureRetailMerchandisingSchema,
  retailCatalogPage,
  scanRetailCatalogBarcode
} from '../retail-merchandising-core.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Retail collection normalization keeps merchandising separate from product taxonomy',()=>{
  assert.deepEqual(normalizeCollectionConfiguration({
    name:' New arrivals ',
    description:'Freshly listed products',
    sort_order:2
  }),{
    name:'New arrivals',
    code:'new_arrivals',
    description:'Freshly listed products',
    active:true,
    sort_order:2
  });
  assert.throws(()=>normalizeCollectionConfiguration({name:''}),/Collection name is required/);
});

test('bulk selection is deduplicated, bounded and explicit',()=>{
  assert.deepEqual(normalizeBulkProductIds([4,4,3]),[4,3]);
  assert.equal(MAX_BULK_PRODUCTS,200);
  assert.throws(()=>normalizeBulkProductIds([]),/Choose at least one/);
  assert.throws(()=>normalizeBulkProductIds(Array.from({length:201},(_,i)=>i+1)),/up to 200/);
});

test('Retail merchandising schema references Catalog products instead of copying them',async()=>{
  const calls=[];
  const db={query:async(sql,args=[])=>{calls.push({sql:String(sql),args});return{rows:[],rowCount:0}}};
  await ensureRetailMerchandisingSchema(db);
  assert.equal(calls.length,1);
  assert.match(calls[0].sql,/CREATE TABLE IF NOT EXISTS merchant_catalog_collections/);
  assert.match(calls[0].sql,/CREATE TABLE IF NOT EXISTS merchant_catalog_collection_items/);
  assert.match(calls[0].sql,/product_id BIGINT NOT NULL REFERENCES marketplace_products/);
  assert.doesNotMatch(calls[0].sql,/product_name_snapshot/);
  assert.doesNotMatch(calls[0].sql,/selling_price_snapshot/);
});

test('Retail Catalog page is paged and searches customer identity plus Inventory identifiers',async()=>{
  const queries=[];
  const db={query:async(sql,args=[])=>{
    queries.push({sql:String(sql),args});
    return{rows:[{
      id:7,business_id:2,name:'Cotton shirt',description:'',category:'Shirts',
      product_domain:'non_food',product_kind:'non_food_resale',selling_price:'799',
      quantity_per_unit:'1',variant_mode:false,active:true,published:false,
      brand:'Local Brand',model:'',inventory_id:55,inventory_item_name:'Cotton shirt Black M',
      internal_sku:'TS-BLK-M',barcode:'4801234567890',direct_inventory_quantity:'6',
      inventory_unit:'unit',in_stock:true,has_public_media:false,variant_count:0,
      active_variant_count:0,variant_on_hand:'0',collection_ids:[3],total_count:501
    }],rowCount:1};
  }};
  const page=await retailCatalogPage(db,{businessId:2,filters:{
    q:'shirt',status:'private',stock:'in_stock',media:'missing',limit:999,offset:100
  }});
  assert.equal(page.version,RETAIL_MERCHANDISING_VERSION);
  assert.equal(page.limit,MAX_CATALOG_PAGE_SIZE);
  assert.equal(page.offset,100);
  assert.equal(page.total,501);
  assert.equal(page.items[0].internal_sku,'TS-BLK-M');
  assert.deepEqual(page.items[0].collection_ids,[3]);
  const sql=queries[0].sql;
  assert.match(sql,/p\.name ILIKE/);
  assert.match(sql,/p\.brand ILIKE/);
  assert.match(sql,/internal_sku/);
  assert.match(sql,/barcode/);
  assert.match(sql,/COUNT\(\*\) OVER\(\)/);
  assert.match(sql,/LIMIT/);
  assert.match(sql,/OFFSET/);
});

test('scan-first returns a safe draft when barcode is unknown instead of inventing product data',async()=>{
  const db={query:async()=>({rows:[],rowCount:0})};
  const result=await scanRetailCatalogBarcode(db,{businessId:2,barcode:' 4800000000001 '});
  assert.equal(result.status,'new_barcode');
  assert.equal(result.barcode,'4800000000001');
  assert.equal(result.draft.requires_inventory,true);
  assert.equal(result.draft.product_kind,'non_food_resale');
  assert.equal(Object.prototype.hasOwnProperty.call(result.draft,'brand'),false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.draft,'selling_price'),false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.draft,'stock'),false);
});

test('scan-first reuses an exact Inventory barcode and starts a Catalog draft when no product is linked',async()=>{
  let call=0;
  const db={query:async(sql)=>{
    call++;
    if(call===1)return{rows:[{
      id:55,business_id:2,item:'Cordless drill',internal_sku:'DRILL-18V',
      barcode:'4800000000002',quantity:'3',unit:'unit',unit_cost:'2200',
      inventory_domain:'non_food',stock_role:'direct_resale'
    }],rowCount:1};
    return{rows:[],rowCount:0};
  }};
  const result=await scanRetailCatalogBarcode(db,{businessId:2,barcode:'4800000000002'});
  assert.equal(result.status,'inventory_only');
  assert.equal(result.draft.inventory_id,55);
  assert.equal(result.draft.name,'Cordless drill');
  assert.equal(result.draft.requires_inventory,false);
});

test('Marketplace runtime wires Retail Catalog APIs and public collection references',()=>{
  const server=read('server-marketplace.js');
  assert.match(server,/ensureRetailMerchandisingSchema/);
  assert.match(server,/\/api\/merchant\/catalog-v3\/items/);
  assert.match(server,/\/api\/merchant\/catalog-v3\/collections/);
  assert.match(server,/\/api\/merchant\/catalog-v3\/bulk/);
  assert.match(server,/\/api\/merchant\/catalog-v3\/scan/);
  assert.match(server,/publicRetailCollections/);
  assert.match(server,/collections:await publicRetailCollections/);
});

test('Merchant Retail UI provides search, filters, collections, pagination and explicit bulk confirmation',()=>{
  const ui=read('public/marketplace-ui.js');
  assert.match(ui,/retailMerchandisingSection/);
  assert.match(ui,/retailCatalogSearch/);
  assert.match(ui,/retailCatalogStatus/);
  assert.match(ui,/retailCatalogStock/);
  assert.match(ui,/retailCatalogMedia/);
  assert.match(ui,/retailCatalogCollectionFilter/);
  assert.match(ui,/retailPrevPage/);
  assert.match(ui,/retailNextPage/);
  assert.match(ui,/retailCollectionCreateForm/);
  assert.match(ui,/confirm\(/);
  assert.match(ui,/confirm:true/);
});

test('Android scan flow uses BarcodeDetector only when available and preserves manual fallback',()=>{
  const ui=read('public/marketplace-ui.js');
  assert.match(ui,/window\.BarcodeDetector/);
  assert.match(ui,/navigator\.mediaDevices\?\.getUserMedia/);
  assert.match(ui,/Camera barcode scanning is not supported here\. Enter the barcode manually/);
  assert.match(ui,/No Inventory item owns this barcode yet/);
  assert.match(ui,/will not guess brand, price, specifications or stock/);
});

test('Retail Catalog styles collapse to mobile without horizontal form overflow',()=>{
  const css=read('public/marketplace.css');
  assert.match(css,/Retail Merchandising V1/);
  assert.match(css,/\.retailCatalogFilters/);
  assert.match(css,/@media\(max-width:520px\)/);
  assert.match(css,/\.retailCatalogRow\{grid-template-columns:auto 56px minmax\(0,1fr\)/);
});

test('package syntax contract includes Retail Merchandising V1',()=>{
  const pkg=read('package.json');
  assert.match(pkg,/node --check retail-merchandising-core\.js/);
  assert.match(pkg,/node --check tests\/retail-merchandising-v1\.test\.js/);
});
