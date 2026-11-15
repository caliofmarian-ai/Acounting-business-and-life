import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildRestaurantBacoorDryRunPlan} from '../qa/restaurant-bacoor-dry-run-853.js';
import {auditRestaurantBacoorInventorySnapshot as audit} from '../qa/restaurant-bacoor-inventory-audit-853.js';
const f=JSON.parse(readFileSync(new URL('../qa/fixtures/ph-restaurant-bacoor-v1.json',import.meta.url),'utf8'));
const plan=buildRestaurantBacoorDryRunPlan(f),B='987654321',family={g:'mass',ml:'volume',unit:'count'};
const rows=()=>plan.inventory.map((p,i)=>{
 const t=p.bodyTemplate;
 return {id:String(1001+i),business_id:B,item:t.item,unit:t.unit,
  base_unit:t.unit,measurement_family:family[t.unit],inventory_type:'ingredient',
  quantity:String(t.quantity)+'.0000',reorder_level:String(t.reorder_level),
  target_level:String(t.target_level),unit_cost:String(t.unit_cost)};
});
const run=r=>audit(structuredClone(f),{targetBusinessId:B,rows:r});
test('no rows means blocked/unapproved, not seed authorization',()=>{
 const x=run([]);assert.equal(x.status,'EMPTY_UNAPPROVED');
 assert.equal(x.executable,false);assert.equal(x.expected,37);
 assert.match(x.gate,/NO WRITES/);
});
test('exact 37 DB numeric rows are read-only and order independent',()=>{
 const r=rows(),before=structuredClone(r),x=run(r);
 assert.equal(x.status,'EXACT_INITIAL_SNAPSHOT_ONLY');
 assert.equal(x.executable,false);assert.equal(x.count,37);
 assert.deepEqual(r,before);assert.deepEqual(run([...r].reverse()),x);
});
test('consumed stock and altered prices/thresholds must not be blindly restored',()=>{
 const mutations=[
  x=>{x[0].quantity=String(Number(x[0].quantity)-1);},
  x=>{x[0].quantity=String(Number(x[0].quantity)+1);},
  x=>{x[0].unit_cost=String(Number(x[0].unit_cost)+.001);},
  x=>{x[0].reorder_level='0';},x=>{x[0].target_level='0';}
 ];
 for(const mutate of mutations){
  const x=rows();mutate(x);assert.throws(()=>run(x),/stock\/definition drift/);
 }
});
test('business boundary, duplicates, missing/extraneous or unknown IDs fail closed',()=>{
 const mutations=[
  x=>{x[0].business_id='2';},x=>{x[0].id='0';},
  x=>{x[0].id=x[1].id;},x=>{x[0].item=x[1].item;},
  x=>{x[0].item='stranger';},x=>{x.pop();},
  x=>{x.push({...x[0],id:'99999'});},x=>{x[0]=null;}
 ];
 for(const mutate of mutations){const x=rows();mutate(x);assert.throws(()=>run(x),/QA inventory audit refused/);}
 assert.throws(()=>audit(f,{targetBusinessId:0,rows:rows()}),/invalid business ID/);
 assert.throws(()=>audit(f,{targetBusinessId:B,rows:null}),/rows required/);
});
test('malformed numeric values or units cannot pass as expected stock',()=>{
 const mutations=[
  x=>{x[0].unit='kg';},x=>{x[0].base_unit='kg';},
  x=>{x[0].measurement_family='volume';},x=>{x[0].inventory_type='resale_item';},
  x=>{x[0].quantity='NaN';},x=>{x[0].quantity='-1';},
  x=>{x[0].quantity='14,000';},x=>{x[0].unit_cost=null;},
  x=>{delete x[0].reorder_level;},x=>{x[0].unit_cost=Infinity;}
 ];
 for(const mutate of mutations){const x=rows();mutate(x);assert.throws(()=>run(x),/QA inventory audit refused/);}
});
