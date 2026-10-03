import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  ADAPTIVE_STOREFRONT_VERSION,
  publicCatalogAttributeMap,
  publicProductProjection,
  retailFacetSummary,
  storefrontPresentationMode
} from '../adaptive-storefront-core.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('public Catalog attributes include only public definition-backed values',async()=>{
  const db={query:async(sql,args)=>({
    rows:[
      {product_id:7,attribute_code:'color',value_json:'Black',label:'Colour',value_type:'text',unit_family:''},
      {product_id:7,attribute_code:'storage_capacity',value_json:'256 GB',label:'Storage capacity',value_type:'text',unit_family:''}
    ],
    rowCount:2
  })};
  const map=await publicCatalogAttributeMap(db,[7]);
  assert.equal(map.get(7).color.value,'Black');
  assert.equal(map.get(7).storage_capacity.label,'Storage capacity');
});

test('customer projection strips Inventory/accounting identifiers and preserves public merchandising',()=>{
  const projected=publicProductProjection({
    id:7,business_id:2,name:'Phone',product_domain:'non_food',selling_price:24990,
    inventory_id:91,legacy_product_id:33,stock_tracked:true,stock_quantity:9,
    inventory_unit_cost:18000,internal_sku:'SECRET-SKU',barcode:'4800000000000',
    price_comparison_override:true,catalog_schema_version:'internal',
    brand:'Example',model:'X',condition_code:'new',variants:[]
  },{
    attributes:{color:{label:'Colour',value:'Black',value_type:'text',unit_family:''}},
    retailAvailability:{orderable:true,state:'available',reason:'in_stock'}
  });
  assert.equal(projected.name,'Phone');
  assert.equal(projected.brand,'Example');
  assert.equal(projected.catalog_attributes.color.value,'Black');
  assert.equal(projected.orderability.orderable,true);
  for(const key of ['inventory_id','legacy_product_id','stock_tracked','stock_quantity','inventory_unit_cost','internal_sku','barcode','price_comparison_override','catalog_schema_version']){
    assert.equal(Object.prototype.hasOwnProperty.call(projected,key),false,key);
  }
});

test('Retail storefront facets merge structured attributes and live variant axes',()=>{
  const facets=retailFacetSummary([
    {
      product_domain:'non_food',category:'Phones',brand:'Acme',
      catalog_attributes:{storage_capacity:{label:'Storage capacity',value:'256 GB',unit_family:''}},
      variants:[
        {option_values:[{option_code:'color',option_label:'Colour',value_label:'Black'}]},
        {option_values:[{option_code:'color',option_label:'Colour',value_label:'White'}]}
      ]
    },
    {
      product_domain:'non_food',category:'Phones',brand:'Acme',
      catalog_attributes:{storage_capacity:{label:'Storage capacity',value:'128 GB',unit_family:''}},
      variants:[{option_values:[{option_code:'color',option_label:'Colour',value_label:'Black'}]}]
    }
  ]);
  assert.deepEqual(facets.categories,[{value:'Phones',count:2}]);
  assert.deepEqual(facets.brands,['Acme']);
  const storage=facets.attributes.find(x=>x.code==='storage_capacity');
  const color=facets.attributes.find(x=>x.code==='color');
  assert.deepEqual(storage.values,['128 GB','256 GB']);
  assert.deepEqual(color.values,['Black','White']);
});

test('storefront mode preserves one Merchant storefront for Food Retail and Mixed',()=>{
  assert.equal(storefrontPresentationMode({merchant_domain:'food'},[]),'food');
  assert.equal(storefrontPresentationMode({merchant_domain:'non_food'},[]),'non_food');
  assert.equal(storefrontPresentationMode({merchant_domain:'mixed'},[]),'mixed');
  assert.equal(storefrontPresentationMode({},[{product_domain:'food'},{product_domain:'non_food'}]),'mixed');
  assert.equal(ADAPTIVE_STOREFRONT_VERSION,'adaptive-storefront-v2-2026-10-03');
});

test('Marketplace returns adaptive safe projections to Customer and guest/public storefronts',()=>{
  const server=read('server-marketplace.js');
  assert.match(server,/adaptivePublicProducts/);
  assert.match(server,/publicCatalogAttributeMap/);
  assert.match(server,/publicRetailAvailabilityMap/);
  assert.match(server,/publicProductProjection/);
  assert.match(server,/adaptive_storefront_version:ADAPTIVE_STOREFRONT_VERSION/);
  assert.match(server,/presentation_mode:storefrontPresentationMode/);
  assert.match(server,/retail_facets:retailFacetSummary/);
  assert.match(server,/\/api\/public\/marketplace\/storefronts\/:businessId/);
  assert.match(server,/\/api\/marketplace\/storefronts\/:businessId/);
});

test('public Retail variant stock uses canonical Available rather than raw Inventory quantity',()=>{
  const variants=read('catalog-variants-core.js');
  assert.match(variants,/order_stock_reservations/);
  assert.match(variants,/inventory_unavailable_allocations/);
  assert.match(variants,/supply_lots/);
  assert.match(variants,/inventory_available_quantity/);
  assert.match(variants,/in_stock:Boolean\(row\.inventory_id\)&&Number\(row\.inventory_available_quantity/);
});

test('adaptive customer UI has separate Food Retail and Mixed discovery patterns',()=>{
  const ui=read('public/marketplace-ui.js');
  assert.match(ui,/adaptiveStoreTabs/);
  assert.match(ui,/storefrontFoodMenuBar/);
  assert.match(ui,/storefrontRetailDiscovery/);
  assert.match(ui,/foodSectionEntries/);
  assert.match(ui,/retail_facets/);
  assert.match(ui,/currentStoreDomain/);
  assert.match(ui,/adaptiveDomainGroup/);
});

test('product detail selects variants and Food modifiers before basket insertion',()=>{
  const ui=read('public/marketplace-ui.js');
  assert.match(ui,/function openProductDetail/);
  assert.match(ui,/productVariantAxes/);
  assert.match(ui,/selectedDetailVariant/);
  assert.match(ui,/selectedDetailModifierIds/);
  assert.match(ui,/validateModifierSelection/);
  assert.match(ui,/price_override/);
  assert.match(ui,/price_delta/);
  assert.match(ui,/productDetailGallery/);
  assert.match(ui,/catalog_attributes/);
});

test('basket and checkout preserve variant and modifier selection snapshots',()=>{
  const ui=read('public/marketplace-ui.js');
  assert.match(ui,/basketSelectionKey/);
  assert.match(ui,/variant_id:variantId/);
  assert.match(ui,/modifier_option_ids:mods/);
  assert.match(ui,/checkoutItemsPayload/);
  assert.match(ui,/variant_id:line\.variant_id/);
  assert.match(ui,/modifier_option_ids:\[\.\.\.\(line\.modifier_option_ids/);
  assert.match(ui,/selection_label/);
  assert.match(ui,/unit_price/);
});

test('Food and Retail availability are visible and unavailable items cannot be added',()=>{
  const ui=read('public/marketplace-ui.js');
  assert.match(ui,/productAvailabilityCopy/);
  assert.match(ui,/outside_menu_schedule/);
  assert.match(ui,/sold_out_today/);
  assert.match(ui,/out_of_stock/);
  assert.match(ui,/data-add-product/);
  assert.match(ui,/orderable\?'':'disabled'/);
});

test('390px storefront CSS includes sticky Food categories, Retail discovery and bottom-sheet detail',()=>{
  const css=read('public/marketplace.css');
  assert.match(css,/Adaptive Storefront V2/);
  assert.match(css,/\.adaptiveStoreTabs/);
  assert.match(css,/\.foodMenuBar/);
  assert.match(css,/position:sticky/);
  assert.match(css,/\.retailDiscovery/);
  assert.match(css,/\.productDetailBackdrop/);
  assert.match(css,/\.productDetailPanel/);
  assert.match(css,/@media\(max-width:520px\)/);
  assert.match(css,/\.retailGrid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

test('package syntax contract includes Adaptive Storefront V2 core and regression tests',()=>{
  const pkg=read('package.json');
  assert.match(pkg,/node --check adaptive-storefront-core\.js/);
  assert.match(pkg,/node --check tests\/adaptive-storefront-v2\.test\.js/);
});
