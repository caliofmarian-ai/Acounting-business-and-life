import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  FOOD_MENU_SCHEMA_VERSION,
  MANILA_TIME_ZONE,
  manilaDayEnd,
  normalizeFoodAvailability,
  effectiveFoodAvailability,
  normalizeMenuConfiguration,
  normalizeModifierGroupConfiguration,
  scheduleWindowActive,
  menuScheduleActive,
  ensureFoodMenuSchema
} from '../food-menu-core.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Food availability supports fast operational states',()=>{
  const now=new Date('2026-10-03T10:00:00.000Z');
  const soldOut=normalizeFoodAvailability({state:'sold_out_today'},now);
  assert.equal(soldOut.state,'sold_out_today');
  assert.equal(soldOut.until,manilaDayEnd(now).toISOString());
  const until=normalizeFoodAvailability({state:'unavailable_until',until:'2026-10-04T10:00:00.000Z'},now);
  assert.equal(until.state,'unavailable_until');
  assert.throws(()=>normalizeFoodAvailability({state:'unavailable_until',until:'2026-10-03T09:59:00.000Z'},now),/future time/);
  assert.equal(effectiveFoodAvailability({availability_state:'hidden'},now).hidden,true);
});

test('Expired temporary availability becomes orderable without destructive cleanup',()=>{
  const now=new Date('2026-10-03T10:00:00.000Z');
  const state=effectiveFoodAvailability({
    availability_state:'sold_out_today',
    availability_until:'2026-10-03T09:00:00.000Z',
    availability_note:'sold out'
  },now);
  assert.equal(state.state,'available');
  assert.equal(state.orderable,true);
});

test('Menu configuration keeps presentation separate from products',()=>{
  const menu=normalizeMenuConfiguration({
    name:'Lunch Menu',
    schedules:[
      {day_of_week:1,start_time:'11:00',end_time:'16:00'},
      {day_of_week:2,start_time:'11:00',end_time:'16:00'}
    ],
    sections:[
      {name:'Main dishes',product_ids:[11,12,12]},
      {name:'Drinks',product_ids:[21]}
    ]
  });
  assert.equal(menu.code,'lunch_menu');
  assert.equal(menu.timezone,MANILA_TIME_ZONE);
  assert.deepEqual(menu.sections[0].product_ids,[11,12]);
  assert.throws(()=>normalizeMenuConfiguration({
    name:'Bad menu',
    sections:[{name:'Mains'},{name:'Mains'}]
  }),/duplicated/);
});

test('Menu schedule evaluator handles ordinary and overnight windows',()=>{
  assert.equal(scheduleWindowActive({day_of_week:1,start_time:'11:00',end_time:'16:00'},{dayOfWeek:1,minute:12*60}),true);
  assert.equal(scheduleWindowActive({day_of_week:1,start_time:'11:00',end_time:'16:00'},{dayOfWeek:1,minute:17*60}),false);
  assert.equal(scheduleWindowActive({day_of_week:5,start_time:'22:00',end_time:'02:00'},{dayOfWeek:6,minute:60}),true);
  assert.equal(menuScheduleActive([],new Date()),true);
});

test('Reusable modifier groups validate required and multi-select bounds',()=>{
  const group=normalizeModifierGroupConfiguration({
    name:'Add-ons',
    min_select:0,
    max_select:3,
    options:[
      {name:'Extra rice',price_delta:25},
      {name:'Egg',price_delta:20},
      {name:'Extra chicken',price_delta:60}
    ],
    product_ids:[11,12,12]
  });
  assert.equal(group.code,'add_ons');
  assert.equal(group.options[0].price_delta,25);
  assert.deepEqual(group.product_ids,[11,12]);
  const size=normalizeModifierGroupConfiguration({
    name:'Size',required:true,max_select:1,
    options:[{name:'Regular'},{name:'Large',price_delta:40}]
  });
  assert.equal(size.min_select,1);
  assert.equal(size.max_select,1);
  assert.throws(()=>normalizeModifierGroupConfiguration({
    name:'Broken',min_select:2,max_select:1,options:[{name:'A'}]
  }),/limits are invalid/);
});

test('Food Menu schema is additive and snapshots modifiers on order items',async()=>{
  const calls=[];
  const db={query:async(sql,args=[])=>{calls.push({sql:String(sql),args});return{rows:[],rowCount:0}}};
  await ensureFoodMenuSchema(db);
  assert.equal(calls.length,1);
  assert.match(calls[0].sql,/ADD COLUMN IF NOT EXISTS availability_state/);
  assert.match(calls[0].sql,/CREATE TABLE IF NOT EXISTS merchant_menus/);
  assert.match(calls[0].sql,/CREATE TABLE IF NOT EXISTS merchant_menu_sections/);
  assert.match(calls[0].sql,/CREATE TABLE IF NOT EXISTS merchant_modifier_groups/);
  assert.match(calls[0].sql,/CREATE TABLE IF NOT EXISTS merchant_product_modifier_groups/);
  assert.match(calls[0].sql,/ADD COLUMN IF NOT EXISTS modifier_snapshot_json/);
});

test('Marketplace integration exposes Food Menu V3 APIs and checkout snapshots modifiers',()=>{
  const server=read('server-marketplace.js');
  assert.match(server,/ensureFoodMenuSchema/);
  assert.match(server,/\/api\/merchant\/catalog-v3\/food/);
  assert.match(server,/\/api\/merchant\/catalog-v3\/menus/);
  assert.match(server,/\/api\/merchant\/catalog-v3\/modifier-groups/);
  assert.match(server,/\/availability/);
  assert.match(server,/modifier_snapshot_json/);
  assert.match(server,/validateProductModifierSelections/);
  assert.match(server,/foodProductOrderability/);
});

test('package syntax contract includes Food Menu V3 core and tests',()=>{
  const pkg=read('package.json');
  assert.match(pkg,/node --check food-menu-core\.js/);
  assert.match(pkg,/node --check tests\/food-menu-v3\.test\.js/);
});
