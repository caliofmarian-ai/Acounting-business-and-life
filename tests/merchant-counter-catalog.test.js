import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {merchantCounterCatalog,merchantCounterSnapshots} from '../merchant-counter-catalog-core.js';
import {orderReservationNeeds,reserveOrderStock,consumeOrderReservations,releaseOrderReservations} from '../order-stock-reservation.js';

const result=rows=>({rows,rowCount:rows.length});
const canonical=(overrides={})=>({id:7,business_id:1,name:'Private packaged food',category:'Food',selling_price:12,active:true,published:false,product_domain:'food',product_kind:'packaged_resale',inventory_id:4,quantity_per_unit:2,variant_mode:false,availability_state:'available',...overrides});
function fixture({catalog=[canonical()],legacy=[],inventory=[{id:4,business_id:1,item:'Pack',unit_cost:3,quantity:20,unit:'unit'}],variants=[],groups=[],menus=[]}={}){
  const db={catalog,legacy,inventory,variants,groups,calls:[],async query(text,args=[]){
    const sql=String(text).replace(/\s+/g,' ').trim();this.calls.push({sql,args});
    const linkedLegacy=(id,bid)=>catalog.some(p=>p.business_id===bid&&p.legacy_product_id===id);
    if(sql.includes('FROM marketplace_products p LEFT JOIN inventory'))return result(catalog.filter(p=>p.business_id===args[0]&&p.active).map(p=>({...p,unit_cost:(inventory.find(i=>i.id===p.inventory_id&&i.business_id===p.business_id)?.unit_cost||0)*p.quantity_per_unit})));
    if(sql.includes('FROM products p')){
      return result(legacy.filter(p=>p.business_id===args[0]&&p.active&&!linkedLegacy(p.id,p.business_id)&&(args.length<2||p.id===args[1])));
    }
    if(sql.startsWith('SELECT id,active FROM marketplace_products'))return result(catalog.filter(p=>p.business_id===args[0]&&p.legacy_product_id===args[1]));
    if(sql.includes('FROM marketplace_products WHERE business_id=$1 AND id=$2 AND active=TRUE FOR UPDATE'))return result(catalog.filter(p=>p.business_id===args[0]&&p.id===args[1]&&p.active));
    if(sql.includes('FROM merchant_menu_items mi'))return result(menus.flatMap(menu=>menu.product_ids.filter(id=>sql.includes('ANY($2')?args[1].includes(id):id===args[0]).map(id=>({id:menu.id,product_id:id}))));
    if(sql.includes('FROM merchant_menu_schedules'))return result(menus.find(menu=>menu.id===args[0])?.schedules||[]);
    if(sql.includes('FROM merchant_product_modifier_groups x'))return result(groups.filter(g=>g.active&&g.business_id===args[0]&&g.product_ids.some(id=>args[1].includes(id))).map(g=>({product_id:g.product_ids.find(id=>args[1].includes(id)),group_id:g.id})));
    if(sql.includes('FROM merchant_modifier_groups'))return result(groups.filter(g=>g.id===args[0]&&g.business_id===args[1]&&g.active));
    if(sql.includes('FROM merchant_modifier_options'))return result(groups.find(g=>g.id===args[0])?.options.filter(o=>o.active)||[]);
    if(sql.includes('FROM merchant_product_modifier_groups')&&sql.includes('group_id=$1'))return result((groups.find(g=>g.id===args[0])?.product_ids||[]).map(id=>({product_id:id})));
    if(sql.startsWith('SELECT v.id,v.variant_key,v.price_override'))return result(variants.filter(v=>v.id===args[0]&&v.product_id===args[1]&&v.active).flatMap(v=>inventory.filter(i=>i.id===v.inventory_id&&i.business_id===args[2]).map(i=>({...v,unit_cost:i.unit_cost}))));
    if(sql.includes('FROM catalog_variant_option_values x'))return result([{option_code:'size',option_label:'Size',value_code:'large',value_label:'Large'}]);
    if(sql.startsWith('SELECT unit_cost FROM inventory'))return result(inventory.filter(i=>i.id===args[0]&&i.business_id===args[1]).map(i=>({unit_cost:i.unit_cost})));
    if(sql.includes('SUM(r.quantity*i.unit_cost)'))return result([{unit_cost:5}]);
    throw new Error('Unexpected query: '+sql);
  }};
  return db;
}
const line=(overrides={})=>({product_id:7,source_kind:'marketplace_product',quantity:2,...overrides});

test('counter catalog includes private Food/Retail but excludes archive/foreign and duplicate legacy imports',async()=>{
  const db=fixture({catalog:[canonical(),canonical({id:8,product_domain:'non_food',product_kind:'non_food_resale'}),canonical({id:9,active:false,legacy_product_id:90}),canonical({id:10,business_id:2})],legacy:[{id:90,business_id:1,active:true,name:'Archived import'},{id:11,business_id:1,active:true,name:'Legacy recipe',category:'Food',selling_price:8}]});
  const items=await merchantCounterCatalog(db,{businessId:1});
  assert.deepEqual(items.map(p=>[p.source_kind,p.id]).sort(),[['marketplace_product',7],['marketplace_product',8],['product',11]]);
  assert.equal(items.find(p=>p.id===7).published,false);
});

test('private Food counter snapshots use canonical price, inventory cost and immutable values',async()=>{
  const db=fixture();const [snapshot]=await merchantCounterSnapshots(db,{businessId:1,items:[line({selling_price:0,unit_cost:0})]});
  assert.deepEqual([snapshot.source_kind,snapshot.source_id,snapshot.unit_price_snapshot,snapshot.unit_cost_snapshot,snapshot.line_total,snapshot.estimated_cogs],['marketplace_product',7,12,6,24,12]);
  db.catalog[0].name='Changed';db.catalog[0].selling_price=99;db.inventory[0].unit_cost=99;
  assert.equal(snapshot.name_snapshot,'Private packaged food');assert.equal(snapshot.unit_price_snapshot,12);assert.equal(snapshot.unit_cost_snapshot,6);
});

test('Retail direct resale is eligible privately and no Food configuration is required',async()=>{
  const db=fixture({catalog:[canonical({product_domain:'non_food',product_kind:'non_food_resale'})]});
  const [snapshot]=await merchantCounterSnapshots(db,{businessId:1,items:[line()]});
  assert.equal(snapshot.line_total,24);assert.equal(db.calls.some(c=>c.sql.includes('merchant_menu')),false);
});

test('archive and other-business canonical IDs are rejected on server',async()=>{
  for(const product of [canonical({active:false}),canonical({business_id:2})])await assert.rejects(merchantCounterSnapshots(fixture({catalog:[product]}),{businessId:1,items:[line()]}),error=>error.status===409);
});

test('explicit source identity keeps colliding legacy and canonical numeric IDs separate',async()=>{
  const db=fixture({legacy:[{id:7,business_id:1,active:true,name:'Legacy recipe',category:'Prepared',selling_price:9}]});
  const rows=await merchantCounterSnapshots(db,{businessId:1,items:[line(),line({source_kind:'product'})]});
  assert.deepEqual(rows.map(p=>[p.source_kind,p.name_snapshot,p.unit_price_snapshot]),[['marketplace_product','Private packaged food',12],['product','Legacy recipe',9]]);
  const [oldClient]=await merchantCounterSnapshots(db,{businessId:1,items:[{product_id:7,quantity:1}]});
  assert.equal(oldClient.source_kind,'product');assert.equal(oldClient.name_snapshot,'Legacy recipe');
});


test('old imported legacy IDs resolve through their exact canonical link and current price',async()=>{
  const db=fixture({catalog:[canonical({id:70,legacy_product_id:7,inventory_id:null,product_kind:'prepared_food',selling_price:14})],legacy:[{id:7,business_id:1,active:true,name:'Legacy recipe',selling_price:9}]});
  const [snapshot]=await merchantCounterSnapshots(db,{businessId:1,items:[{product_id:7,quantity:1},line({product_id:70,quantity:2})]});
  assert.equal(snapshot.source_kind,'marketplace_product');assert.equal(snapshot.source_id,70);assert.equal(snapshot.quantity,3);assert.equal(snapshot.unit_price_snapshot,14);assert.equal(snapshot.unit_cost_snapshot,5);
});

test('archived canonical import cannot be resurrected through legacy counter API',async()=>{
  const db=fixture({catalog:[canonical({active:false,legacy_product_id:7})],legacy:[{id:7,business_id:1,active:true,name:'Legacy recipe'}]});
  await assert.rejects(merchantCounterSnapshots(db,{businessId:1,items:[line({source_kind:'product'})]}),/unavailable for this business/);
});

test('unavailable Food fails closed and duplicate lines aggregate before stock reservation',async()=>{
  await assert.rejects(merchantCounterSnapshots(fixture({catalog:[canonical({availability_state:'sold_out_today'})]}),{businessId:1,items:[line()]}),/currently unavailable/);
  const rows=await merchantCounterSnapshots(fixture(),{businessId:1,items:[line(),line({quantity:3})]});
  assert.equal(rows.length,1);assert.equal(rows[0].quantity,5);assert.equal(rows[0].line_total,60);
});

test('required Food modifiers validate selection and snapshot their exact price/name',async()=>{
  const group={id:20,business_id:1,active:true,code:'sauce',name:'Sauce',min_select:1,max_select:1,product_ids:[7],options:[{id:21,code:'extra',name:'Extra sauce',price_delta:2,active:true}]};
  const db=fixture({groups:[group]});
  await assert.rejects(merchantCounterSnapshots(db,{businessId:1,items:[line()]}),/Sauce requires 1 selection/);
  const [snapshot]=await merchantCounterSnapshots(db,{businessId:1,items:[line({modifier_option_ids:[21]})]});
  assert.equal(snapshot.unit_price_snapshot,14);assert.equal(snapshot.modifier_snapshot_json.groups[0].options[0].option_name,'Extra sauce');
  await assert.rejects(merchantCounterSnapshots(db,{businessId:1,items:[line({modifier_option_ids:[999]})]}),/not available for this product/);
});

test('Retail variants require owned active stock and preserve variant snapshots/price overrides',async()=>{
  const db=fixture({catalog:[canonical({product_domain:'non_food',product_kind:'non_food_resale',variant_mode:true,inventory_id:null})],variants:[{id:30,product_id:7,variant_key:'size:large',inventory_id:4,price_override:15,active:true}]});
  await assert.rejects(merchantCounterSnapshots(db,{businessId:1,items:[line()]}),/Choose a variant/);
  const [snapshot]=await merchantCounterSnapshots(db,{businessId:1,items:[line({variant_id:30})]});
  assert.equal(snapshot.catalog_variant_id,30);assert.equal(snapshot.unit_price_snapshot,15);assert.equal(snapshot.name_snapshot,'Private packaged food · Large');assert.equal(snapshot.variant_snapshot_json.option_values[0].value_label,'Large');
  db.inventory.push({id:5,business_id:1,unit_cost:4,quantity:10});
  db.variants.push({id:31,product_id:7,variant_key:'size:small',inventory_id:5,price_override:18,active:true});
  const multiple=await merchantCounterSnapshots(db,{businessId:1,items:[line({variant_id:30,quantity:1}),line({variant_id:31,quantity:2})]});
  assert.deepEqual(multiple.map(row=>[row.catalog_variant_id,row.quantity,row.unit_price_snapshot,row.unit_cost_snapshot]),[[30,1,15,6],[31,2,18,8]]);
  db.inventory[0].business_id=2;
  await assert.rejects(merchantCounterSnapshots(db,{businessId:1,items:[line({variant_id:30})]}),/variant is unavailable/);
});

test('invalid source/option/quantity never falls back to another product source',async()=>{
  for(const item of [line({source_kind:'anything'}),line({quantity:0}),line({variant_id:0}),line({modifier_option_ids:[1,1]})])await assert.rejects(merchantCounterSnapshots(fixture(),{businessId:1,items:[item]}),error=>error.status===400);
});

test('canonical snapshots feed existing inventory reservations and consumption exactly once',async()=>{
  const db=fixture();const [snapshot]=await merchantCounterSnapshots(db,{businessId:1,items:[line()]});
  const order={id:40,business_id:1,order_status:'accepted',fulfilment_method:'pickup',stock_consumed_at:null};
  let quantity=20,consumptions=0,state='reserved';
  const reservation={id:41,order_id:40,business_id:1,stock_kind:'inventory',stock_ref_id:4,quantity_reserved:4,state:'reserved'};
  const stockDb={async query(text,args=[]){
    const sql=String(text).replace(/\s+/g,' ').trim();
    if(sql.includes('FROM order_items'))return result([{id:1,...snapshot}]);
    if(sql.includes('FROM marketplace_products'))return result([db.catalog[0]]);
    if(sql.startsWith('SELECT id,item,unit_cost FROM inventory'))return result([db.inventory[0]]);
    if(sql.includes('FROM merchant_order_consumable_rules'))return result([]);
    if(sql.startsWith('UPDATE order_stock_reservations')&&sql.includes("release_reason='expired'"))return result([]);
    if(sql.includes('SELECT * FROM order_stock_reservations'))return result(state==='reserved'?[reservation]:[]);
    if(sql.startsWith('UPDATE order_stock_reservations SET expires_at'))return result([]);
    if(sql.startsWith('SELECT id,item,quantity,unit_cost,inventory_type'))return result([{...db.inventory[0],quantity}]);
    if(sql.startsWith('UPDATE inventory SET quantity=quantity-')){quantity-=args[0];return result([])}
    if(sql.startsWith('INSERT INTO order_stock_consumptions')){consumptions++;return result([])}
    if(sql.includes('FROM order_stock_reservation_lots'))return result([]);
    if(sql.startsWith('UPDATE order_stock_reservations')&&sql.includes("state='consumed'")){state='consumed';return result([])}
    if(sql.startsWith('UPDATE orders SET stock_consumed_at')){order.stock_consumed_at=new Date().toISOString();return result([])}
    throw new Error('Unexpected stock query: '+sql);
  }};
  const needs=await orderReservationNeeds(stockDb,order);assert.equal(needs.inventoryNeeds[0].quantity,4);
  await consumeOrderReservations(stockDb,order);await consumeOrderReservations(stockDb,order);
  assert.equal(quantity,16);assert.equal(consumptions,1);assert.equal(state,'consumed');
});

test('duplicate variant lines aggregate stock demand, fail atomically and preserve release semantics',async()=>{
  const source=fixture({catalog:[canonical({product_domain:'non_food',variant_mode:true,inventory_id:null,quantity_per_unit:1})],variants:[{id:30,product_id:7,variant_key:'size:large',inventory_id:4,price_override:15,active:true}]});
  const snapshots=await merchantCounterSnapshots(source,{businessId:1,items:[line({variant_id:30,quantity:1}),line({variant_id:30,quantity:1})]});
  assert.equal(snapshots.length,1);assert.equal(snapshots[0].quantity,2);
  const order={id:40,business_id:1,order_status:'accepted',fulfilment_method:'pickup'};
  const db={async query(text,args=[]){
    const sql=String(text).replace(/\s+/g,' ').trim();
    if(sql.startsWith('UPDATE order_stock_reservations'))return result(sql.includes('RETURNING *')?[{state:'released',release_reason:args[1]}]:[]);
    if(sql.includes('SELECT * FROM order_stock_reservations'))return result([]);
    if(sql.includes('FROM order_items'))return result(snapshots.map((row,index)=>({id:index+1,...row})));
    if(sql.includes('SELECT id,name,stock_tracked'))return result(source.catalog);
    if(sql.includes('FROM catalog_product_variants v'))return result([{id:30,inventory_id:4}]);
    if(sql.startsWith('SELECT id,item,unit_cost FROM inventory'))return result([{id:4,item:'Stock',unit_cost:3}]);
    if(sql.includes('FROM merchant_order_consumable_rules'))return result([]);
    if(sql.startsWith('SELECT id,item,quantity,unit,unit_cost'))return result([{id:4,item:'Stock',quantity:1,unit:'unit',unit_cost:3}]);
    if(sql.includes('to_regclass'))return result([{rel:null}]);
    if(sql.includes('FROM inventory_unavailable_allocations'))return result([]);
    if(sql.includes('FROM order_stock_reservations')&&sql.includes('SUM('))return result([{reserved:0,untracked_reserved:0}]);
    throw new Error('Unexpected shortage query: '+sql);
  }};
  await assert.rejects(reserveOrderStock(db,order),error=>error.status===409&&error.shortages[0].short===1);
  const released=await releaseOrderReservations(db,{orderId:40,reason:'cancelled'});assert.equal(released[0].state,'released');
});


test('Food picker and server share schedule eligibility with a clear blocked reason',async()=>{
  const db=fixture({menus:[{id:1,product_ids:[7],schedules:[{day_of_week:2,start_time:'08:00',end_time:'09:00',active:true}]}]});
  const now=new Date('2026-10-26T08:00:00Z');
  const [item]=await merchantCounterCatalog(db,{businessId:1,now});
  assert.equal(item.available,false);assert.equal(item.blocked_reason,'outside_menu_schedule');
  await assert.rejects(merchantCounterSnapshots(db,{businessId:1,items:[line()],now}),/current menu schedule/);
  db.calls.length=0;
  const [open]=await merchantCounterCatalog(db,{businessId:1,now:new Date('2026-10-27T00:30:00Z')});
  assert.equal(open.available,true);assert.equal(open.blocked_reason,'');
});

test('counter UI adds independent variant/modifier lines and submits each chosen configuration',()=>{
  const source=readFileSync(new URL('../public/orders-ui.js',import.meta.url),'utf8');
  const rowCode=source.slice(source.indexOf('function counterProductRow('),source.indexOf('function counterForm('));
  const formCode=source.slice(source.indexOf('function counterOrderItems('),source.indexOf('function lane('));
  let inserted='';
  const product={id:7,source_kind:'marketplace_product',name:'Shirt',category:'Retail',selling_price:10,variant_mode:true,
    variants:[{id:30,variant_key:'large',in_stock:true,option_values:[]}],modifier_groups:[]};
  const inputs=[30,31].map((variant,index)=>({dataset:{counterProduct:'7',counterSource:'marketplace_product'},value:String(index+1),
    closest:()=>({querySelector:()=>({value:String(variant)}),querySelectorAll:()=>[{dataset:{counterModifier:String(40+index)}}]})}));
  const form={querySelectorAll:()=>inputs};
  const context=vm.createContext({productsCache:[product],orderOperation:()=>({}),orderOperationCurrent:()=>true,document:{getElementById:()=>form},h:String,php:value=>String(value),nice:String});
  vm.runInContext(rowCode+formCode,context);
  const html=context.counterProductRow(product,{additional:true});
  assert.match(html,/Add another choice/);assert.match(html,/Remove this line/);
  context.bindCounterForm();
  const button={dataset:{counterAddLine:'marketplace_product:7'},closest:()=>({insertAdjacentHTML:(_position,value)=>{inserted=value}})};
  form.onclick({target:{closest:selector=>selector==='[data-counter-add-line]'?button:null}});
  assert.match(inserted,/data-counter-product="7"/);assert.match(inserted,/Remove this line/);
  const items=JSON.parse(JSON.stringify(context.counterOrderItems(form)));
  assert.deepEqual(items.map(row=>[row.product_id,row.variant_id,row.quantity,row.modifier_option_ids]),[[7,30,1,[40]],[7,31,2,[41]]]);
});

test('public checkout retains published-only selection and Merchant path persists canonical stock identity',()=>{
  const marketplace=readFileSync(new URL('../server-marketplace.js',import.meta.url),'utf8');
  const orders=readFileSync(new URL('../server-orders.js',import.meta.url),'utf8');
  assert.match(marketplace,/AND published=TRUE AND active=TRUE FOR SHARE/);
  assert.match(marketplace,/if\(!\(await marketplaceOrderKind\(id\)\)\)return proxy/);
  assert.match(orders,/merchantCounter:true/);assert.match(orders,/i\.source_kind==='marketplace_product'/);
  assert.match(orders,/JSON\.stringify\(i\.variant_snapshot_json/);assert.match(orders,/reserveOrderStock\(client/);
});
