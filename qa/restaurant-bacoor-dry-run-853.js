/**
 * #853 — read-only, non-executable QA restaurant provisioning contract.
 * This file NEVER connects to a server/database and NEVER issues HTTP requests.
 * Future seeding requires a separate, reviewed, business-scoped executor.
 */
import {computeRecipeBatch} from '../merchant-catalog-core.js';
import {createHash} from 'node:crypto';

const UNITS=new Set(['g','ml','unit']);
const cents=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
const CODE=/^[a-z][a-z0-9-]*$/;
const isCount=n=>Number.isSafeInteger(n)&&n>=0;
const isMoney=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
function requireQa(condition,message){
  if(!condition)throw new TypeError('QA restaurant dry-run refused: '+message);
}
function unique(map,key,label){
  requireQa(!map.has(key),'duplicate '+label+': '+key);
  map.set(key,true);
}
export function buildRestaurantBacoorDryRunPlan(fixture){
  requireQa(fixture&&typeof fixture==='object'&&!Array.isArray(fixture),'manifest object required');
  const b=fixture.business||{};
  requireQa(fixture.schemaVersion==='ph-restaurant-qa-v1'&&
    fixture.fixtureKey==='qa-ph-restaurant-bacoor','unknown version or fixture');
  requireQa(b.name==='QA PH Restaurant — Bacoor'&&b.role==='merchant'&&
    b.testOnly===true&&b.merchantDomain==='food','dedicated company-test Merchant required');
  requireQa(b.countryCode==='PH'&&b.currency==='PHP'&&b.locale==='en-PH'&&
    b.cityPsgcCode==='0402103000'&&b.barangayPsgcCode==='0402103028',
    'official Bacoor/en-PH scope required');
  const storefront=b.storefront||{};
  requireQa(storefront.publicationStatus==='draft','storefront must remain draft');
  for(const key of ['pickupEnabled','deliveryEnabled','cashEnabled','onlineEnabled',
    'publicLocationEnabled','publicReputationEnabled','priceComparisonEnabled']){
    requireQa(storefront[key]===false,'non-commercial storefront flag '+key+' must be false');
  }
  requireQa(/synthetic/i.test(fixture.costing?.basis||''),'costs must be marked synthetic');
  requireQa(Array.isArray(fixture.inventory)&&fixture.inventory.length===37,'37 ingredients required');
  requireQa(Array.isArray(fixture.recipes)&&fixture.recipes.length===10,'10 dishes required');
  const ingredientKeys=new Map(),ingredientNames=new Map(),productKeys=new Map(),productNames=new Map();
  const stock=new Map(),demand=new Map();
  // Temporary arithmetic IDs only: NEVER use these as database identities.
  const costingInventory=fixture.inventory.map((row,index)=>({
    id:index+1,item:row.name,unit:row.baseUnit,base_unit:row.baseUnit,
    measurement_family:row.measurementFamily,unit_cost:row.unitCostPHP
  }));
  const costingIds=new Map(fixture.inventory.map((row,index)=>[row.code,index+1]));
  const inventory=fixture.inventory.map(row=>{
    requireQa(row&&CODE.test(row.code),'invalid ingredient key');
    unique(ingredientKeys,row.code,'ingredient key');
    requireQa(typeof row.name==='string'&&row.name.length>0&&row.name.length<=100,'ingredient name');
    unique(ingredientNames,row.name.toLocaleLowerCase('en-PH'),'ingredient name');
    requireQa(UNITS.has(row.baseUnit)&&
      row.measurementFamily===({g:'mass',ml:'volume',unit:'count'})[row.baseUnit],
      'ingredient unit/family mismatch: '+row.code);
    requireQa(isCount(row.onHandBase)&&row.onHandBase>0&&isCount(row.reorderAtBase)&&
      row.reorderAtBase<row.onHandBase&&isMoney(row.unitCostPHP),
      'invalid synthetic inventory amount: '+row.code);
    stock.set(row.code,row);
    return {logicalKey:'ingredient/'+row.code,routeContract:'inventory',
      existingIdentity:{business:'EXACT_AUTHORIZED_QA_BUSINESS',item:row.name},
      bodyTemplate:{item:row.name,unit:row.baseUnit,quantity:row.onHandBase,
        reorder_level:row.reorderAtBase,target_level:row.reorderAtBase,
        unit_cost:row.unitCostPHP,inventory_type:'ingredient'}};
  });
  const recipeProducts=[],privateCatalog=[],recipeBatches=[];
  for(const recipe of fixture.recipes){
    requireQa(recipe&&CODE.test(recipe.code),'invalid dish key');
    unique(productKeys,recipe.code,'dish key');
    requireQa(typeof recipe.name==='string'&&recipe.name.length>0&&recipe.name.length<=120,
      'dish name');
    unique(productNames,recipe.name.toLocaleLowerCase('en-PH'),'dish name');
    requireQa(typeof recipe.description==='string'&&recipe.description.length>0&&
      recipe.description.length<=800&&typeof recipe.category==='string'&&
      recipe.category.length>0&&recipe.category.length<=80,
      'dish copy/category: '+recipe.code);
    requireQa(isMoney(recipe.sellingPricePHP)&&recipe.sellingPricePHP>0&&
      isCount(recipe.yieldServings)&&recipe.yieldServings===4&&
      recipe.allergenReviewRequired===true,
      'unsafe dish price/yield/review flag: '+recipe.code);
    requireQa(Array.isArray(recipe.ingredients)&&recipe.ingredients.length>=7,
      'incomplete ingredients: '+recipe.code);
    const recipeIngredientKeys=new Map();
    const components=recipe.ingredients.map(part=>{
      requireQa(part&&CODE.test(part.ingredientCode)&&stock.has(part.ingredientCode),
        'unknown ingredient in '+recipe.code);
      unique(recipeIngredientKeys,part.ingredientCode,'recipe ingredient');
      const row=stock.get(part.ingredientCode);
      requireQa(part.unit===row.baseUnit&&typeof part.quantity==='number'&&
        Number.isFinite(part.quantity)&&part.quantity>0&&
        (part.unit!=='unit'||Number.isSafeInteger(part.quantity)),
        'invalid recipe quantity/unit: '+recipe.code);
      demand.set(part.ingredientCode,(demand.get(part.ingredientCode)||0)+part.quantity);
      return {inventoryLogicalKey:'ingredient/'+part.ingredientCode,
        inventory_id:null,quantity:part.quantity,unit:part.unit};
    });
    // The published QA cost table must never drift from actual canonical recipe maths.
    // This computation is pure; costing IDs above are local, not seedable database IDs.
    const calculated=computeRecipeBatch({
      yield_quantity:recipe.yieldServings,yield_unit:'unit',
      selling_quantity:1,selling_unit:'unit',inventory:costingInventory,
      components:recipe.ingredients.map(part=>({
        inventory_id:costingIds.get(part.ingredientCode),
        quantity:part.quantity,unit:part.unit
      }))
    });
    requireQa(recipe.simulatedCost&&
      ['batchPHP','perPortionPHP','grossContributionPerPortionPHP']
        .every(key=>isMoney(recipe.simulatedCost[key])),
      'missing synthetic cost evidence: '+recipe.code);
    requireQa(cents(calculated.batch_cost)===recipe.simulatedCost.batchPHP&&
      cents(calculated.cost_per_sale_unit)===recipe.simulatedCost.perPortionPHP&&
      cents(recipe.sellingPricePHP-cents(calculated.cost_per_sale_unit))===
        recipe.simulatedCost.grossContributionPerPortionPHP,
      'synthetic cost drift: '+recipe.code);
    recipeProducts.push({logicalKey:'recipe-product/'+recipe.code,routeContract:'recipeProduct',
      existingIdentity:{business:'EXACT_AUTHORIZED_QA_BUSINESS',name:recipe.name},
      bodyTemplate:{name:recipe.name,category:recipe.category,
        selling_price:recipe.sellingPricePHP,product_kind:'prepared_recipe',active:false}});
    privateCatalog.push({logicalKey:'private-catalog/'+recipe.code,routeContract:'privateCatalog',
      existingIdentity:{business:'EXACT_AUTHORIZED_QA_BUSINESS',name:recipe.name},
      bodyTemplate:{business_id:null,name:recipe.name,description:recipe.description,
        category:recipe.category,product_kind:'prepared_food',unit_code:'portion',
        quantity_per_unit:1,selling_price:recipe.sellingPricePHP,
        published:false,price_comparison_override:false}});
    recipeBatches.push({logicalKey:'recipe-batch/'+recipe.code,routeContract:'recipeBatch',
      recipeProductId:null,bodyTemplate:{yield_quantity:recipe.yieldServings,
        yield_unit:'unit',selling_quantity:1,selling_unit:'unit',components}});
  }
  for(const [code,amount] of demand){
    requireQa(amount<=stock.get(code).onHandBase,'full-batch shortage: '+code);
  }
  // Content identity for a future *separately approved* QA seeder to pin; this
  // digest is neither an authorization token nor proof of database provenance.
  const manifestSha256=createHash('sha256').update(JSON.stringify(fixture),'utf8').digest('hex');
  return {
    mode:'DRY_RUN_ONLY',executable:false,sourceOnly:true,fixtureKey:fixture.fixtureKey,
    manifestSha256,
    target:{businessId:null,accountId:null,merchantRole:'merchant',name:b.name,
      cityPsgcCode:b.cityPsgcCode,barangayPsgcCode:b.barangayPsgcCode,
      locale:b.locale,currency:b.currency,publicationStatus:'draft'},
    gate:'BLOCKED: authorized isolated-QA identity, exact business binding, and separately reviewed seeder required',
    idempotency:'LOOKUP_EXACT_BUSINESS_AND_KEYS; VERIFY_EXISTING; FAIL_ON_DRIFT; NEVER_RESET_EXISTING_STOCK',
    routeContracts:{
      inventory:{path:'/api/inventory',source:'server-business-accounting.js'},
      recipeProduct:{path:'/api/products',source:'server-business-accounting.js'},
      recipeBatch:{path:'/api/products/:id/recipe-batch',source:'server-business-accounting.js'},
      privateCatalog:{path:'/api/merchant/storefront/products',source:'server-marketplace.js'}
    },
    prerequisites:[
      'Never infer an account or business from global session defaults; verify an authorized QA Merchant and one exact company-test business.',
      'All inventory and recipe endpoints bind to the verified business context; catalog business_id and product/inventory IDs must be resolved privately.',
      'Read existing scoped rows first: inventory POST is an UPSERT that can reset quantity/cost on repeat; never blindly replay writes.',
      'Create/verify legacy recipe products and private Marketplace catalog products separately; these are distinct application stores.',
      'Only run a separately reviewed, idempotent executor against an isolated QA database with explicit shared Preview handoff.',
      'No storefront publication, orders, real payment, courier dispatch, user notifications, legal approval bypass or production writes.'
    ],
    inventory,recipeProducts,privateCatalog,recipeBatches
  };
}
