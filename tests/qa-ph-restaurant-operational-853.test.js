import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

import {computeRecipeBatch} from '../merchant-catalog-core.js';
import {merchantTodayViewModel} from '../merchant-today-core.js';
import {planInventoryReservationAllocation} from '../order-stock-reservation.js';
import {ordersReceivableTotal} from '../public/orders-receivable-view.js';
import {storefrontPresentationMode} from '../adaptive-storefront-core.js';

const fixture=JSON.parse(readFileSync(new URL('../qa/fixtures/ph-restaurant-bacoor-v1.json',import.meta.url),'utf8'));
const inventory=new Map(fixture.inventory.map((row,index)=>[
  row.code,{id:index+1,item:row.name,base_unit:row.baseUnit,unit:row.baseUnit,
    measurement_family:row.measurementFamily,unit_cost:row.unitCostPHP,
    quantity:row.onHandBase,reorder_level:row.reorderAtBase}
]));
const ingredients=(recipe)=>recipe.ingredients.map(({ingredientCode,quantity,unit})=>({
  ingredientCode,quantity,unit,stock:inventory.get(ingredientCode)
}));
const batch=recipe=>computeRecipeBatch({
  yield_quantity:recipe.yieldServings,yield_unit:'unit',
  selling_quantity:1,selling_unit:'unit',
  inventory:[...inventory.values()],
  components:ingredients(recipe).map(x=>({
    inventory_id:x.stock.id,quantity:x.quantity,unit:x.unit
  }))
});
const round=(n)=>Math.round((Number(n)+Number.EPSILON)*1e6)/1e6;

test('restaurant Merchant Today uses Food tools, draft state, Orders and inventory attention',()=>{
  const name=fixture.business.name;
  const snapshot=merchantTodayViewModel({
    business:{id:853,name,currency_code:'PHP'},
    presentation:{merchant_domain:'food',storefront_status:'draft',legacy_recipe_ui_allowed:true},
    orderRow:{accepted:1,preparing:1,ready:0,waiting_customer:1},
    inventoryRow:{low_stock:2,out_of_stock:0},
    catalogRow:{total:fixture.recipes.length,unpublished:fixture.recipes.length,recipe_attention:3},
    finance:{business:{currency_code:'PHP'}}
  });
  assert.equal(snapshot.business.name,name);
  assert.equal(snapshot.presentation.food_modules_enabled,true);
  assert.equal(snapshot.presentation.non_food_modules_enabled,false);
  assert.equal(snapshot.presentation.storefront_status,'draft');
  assert.equal(snapshot.catalog.total,10);
  assert.equal(snapshot.catalog.unpublished,10);
  assert.equal(snapshot.catalog.recipe_attention,3);
  assert.equal(snapshot.orders.attention_total,3);
  assert.equal(snapshot.inventory.low_stock,2);
  assert.equal(snapshot.money.confirmed_received,0);
  assert.equal(snapshot.money.currency_code,'PHP');
  assert.equal(storefrontPresentationMode({merchant_domain:'food'},[]),'food');
});

test('ten prepared recipes produce valid ingredient demand per serving',()=>{
  assert.equal(fixture.recipes.length,10);
  for(const recipe of fixture.recipes){
    const result=batch(recipe);
    assert.equal(result.sale_units_per_batch,4,recipe.code);
    assert.equal(result.components.length,recipe.ingredients.length,recipe.code);
    for(const component of result.components){
      assert.ok(component.per_sale_quantity>0,recipe.code);
      const corresponding=recipe.ingredients.find(x=>inventory.get(x.ingredientCode).id===component.inventory_id);
      assert.equal(round(component.per_sale_quantity),round(corresponding.quantity/4),recipe.code);
    }
  }
});

test('all ten menus fit one synthetic order each without consuming or altering stock',()=>{
  const before=structuredClone(fixture.inventory);
  const demand=new Map();
  for(const recipe of fixture.recipes){
    for(const c of batch(recipe).components){
      const old=demand.get(c.inventory_id)||0;
      demand.set(c.inventory_id,old+c.per_sale_quantity);
    }
  }
  for(const [id,quantityNeeded] of demand){
    const stock=[...inventory.values()].find(row=>row.id===id);
    const allocation=planInventoryReservationAllocation({
      quantityNeeded,physicalQuantity:stock.quantity,lots:[],untrackedReserved:0
    });
    assert.equal(allocation.ok,true,stock.item);
    assert.equal(round(allocation.untrackedUsed),round(quantityNeeded),stock.item);
  }
  assert.deepEqual(fixture.inventory,before,'simulation must not mutate stored stock');
});

test('canonical reservation rejects shortage and respects unavailable stock',()=>{
  const chicken=inventory.get('chicken');
  const available=planInventoryReservationAllocation({
    quantityNeeded:100,physicalQuantity:chicken.quantity,unavailableQuantity:50
  });
  assert.equal(available.ok,true);
  const blocked=planInventoryReservationAllocation({
    quantityNeeded:chicken.quantity,physicalQuantity:chicken.quantity,unavailableQuantity:50
  });
  assert.equal(blocked.ok,false);
  assert.equal(blocked.reason,'reserved_or_unusable_stock');
  const doubleBooking=planInventoryReservationAllocation({
    quantityNeeded:chicken.quantity,physicalQuantity:chicken.quantity,untrackedReserved:100
  });
  assert.equal(doubleBooking.ok,false);
});

test('synthetic cancellation restores reserved ingredient availability exactly once',()=>{
  const recipe=fixture.recipes.find(x=>x.code==='chicken-adobo');
  const chicken=ingredients(recipe).find(x=>x.ingredientCode==='chicken');
  const perSale=chicken.quantity/recipe.yieldServings;
  const physical=chicken.stock.quantity;
  const reserved=planInventoryReservationAllocation({
    quantityNeeded:perSale,physicalQuantity:physical,lots:[]
  });
  assert.equal(reserved.ok,true);
  assert.equal(reserved.untrackedUsed,perSale);
  // Reservation does NOT change physical stock; cancel releases the hold.
  const held=planInventoryReservationAllocation({
    quantityNeeded:physical,physicalQuantity:physical,untrackedReserved:perSale
  });
  assert.equal(held.ok,false);
  const afterCancellation=planInventoryReservationAllocation({
    quantityNeeded:physical,physicalQuantity:physical,untrackedReserved:0
  });
  assert.equal(afterCancellation.ok,true);
  assert.equal(chicken.stock.quantity,physical);
  // Money uses the canonical order helper, not a new cancellation fee.
  assert.equal(ordersReceivableTotal([
    {order_status:'cancelled',outstanding_amount:145},
    {order_status:'accepted',outstanding_amount:0}
  ]),0);
});

test('two Merchant business view models remain independently scoped',()=>{
  const restaurant=merchantTodayViewModel({
    business:{id:853,name:fixture.business.name,currency_code:'PHP'},
    presentation:{merchant_domain:'food'},
    orderRow:{preparing:2},
    catalogRow:{total:10,unpublished:10}
  });
  const other=merchantTodayViewModel({
    business:{id:854,name:'QA Other Merchant',currency_code:'PHP'},
    presentation:{merchant_domain:'non_food'},
    orderRow:{},
    catalogRow:{total:0,unpublished:0,recipe_attention:0}
  });
  assert.equal(restaurant.orders.preparing,2);
  assert.equal(other.orders.attention_total,0);
  assert.equal(restaurant.catalog.total,10);
  assert.equal(other.catalog.total,0);
  assert.equal(other.presentation.food_modules_enabled,false);
  assert.notEqual(restaurant.business.id,other.business.id);
  // Request-race tests are already separately owned by Orders #820.
});

test('QA restaurant cannot be mistaken for a live shop or a real payment',()=>{
  assert.equal(fixture.business.testOnly,true);
  assert.equal(fixture.business.storefront.publicationStatus,'draft');
  assert.equal(fixture.business.storefront.onlineEnabled,false);
  assert.equal(fixture.business.storefront.cashEnabled,false);
  assert.equal(fixture.business.storefront.deliveryEnabled,false);
  assert.equal(fixture.business.storefront.publicLocationEnabled,false);
  assert.equal(fixture.business.countryCode,'PH');
  assert.equal(fixture.business.locale,'en-PH');
  assert.equal(fixture.business.cityPsgcCode,'0402103000');
});
