/** #853: read-only QA snapshot audit. This neither authenticates nor writes. */
import {buildRestaurantBacoorDryRunPlan} from './restaurant-bacoor-dry-run-853.js';
const FAMILY={g:'mass',ml:'volume',unit:'count'};
function fail(why){throw new TypeError('QA inventory audit refused: '+why);}
function identity(v,label){
 if(typeof v==='number'&&Number.isSafeInteger(v)&&v>0)return String(v);
 if(typeof v==='string'&&/^[1-9][0-9]{0,18}$/.test(v))return v;
 fail('invalid '+label);
}
function decimal(v,label){
 if(typeof v==='number'&&Number.isFinite(v)&&v>=0)return v;
 if(typeof v==='string'&&/^(0|[1-9][0-9]*)([.][0-9]{1,6})?$/.test(v)){
  const n=Number(v);
  if(Number.isFinite(n)&&n>=0&&Number.isSafeInteger(Math.trunc(n)))return n;
 }
 fail('invalid '+label);
}
function check(value,expected,label){
 if(decimal(value,label)!==expected)fail('stock/definition drift: '+label);
}
/** Caller must independently verify actual Merchant authority and QA DB provenance.
 * Output is diagnostic only, NEVER permission to seed, replay or skip transactional locks.
 */
export function auditRestaurantBacoorInventorySnapshot(fixture,{targetBusinessId,rows}={}){
 const plan=buildRestaurantBacoorDryRunPlan(fixture),business=identity(targetBusinessId,'business ID');
 if(!Array.isArray(rows))fail('business-scoped rows required');
 if(rows.length===0)return {status:'EMPTY_UNAPPROVED',executable:false,count:0,expected:37,
  gate:'NO WRITES: separately authorize and lock isolated QA'};
 if(rows.length!==plan.inventory.length)fail('partial/extra rows');
 const expected=new Map(plan.inventory.map(x=>[x.bodyTemplate.item,x.bodyTemplate]));
 const names=new Set(),ids=new Set();
 for(const row of rows){
  if(!row||typeof row!=='object'||Array.isArray(row))fail('invalid row');
  if(identity(row.business_id,'row business ID')!==business)fail('foreign business row');
  const rowId=identity(row.id,'row ID');
  if(ids.has(rowId))fail('duplicate row ID');ids.add(rowId);
  if(typeof row.item!=='string'||!expected.has(row.item))fail('unknown item');
  if(names.has(row.item))fail('duplicate item');names.add(row.item);
  const t=expected.get(row.item);
  if(row.unit!==t.unit||row.base_unit!==t.unit||
   row.measurement_family!==FAMILY[t.unit]||row.inventory_type!=='ingredient')
   fail('unit/type drift: '+row.item);
  check(row.quantity,t.quantity,row.item+' quantity');
  check(row.reorder_level,t.reorder_level,row.item+' reorder');
  check(row.target_level,t.target_level,row.item+' target');
  check(row.unit_cost,t.unit_cost,row.item+' cost');
 }
 if(names.size!==expected.size)fail('missing item');
 return {status:'EXACT_INITIAL_SNAPSHOT_ONLY',executable:false,count:names.size,expected:expected.size,
  gate:'NO WRITES: repeat with reviewed, locked isolated-QA transaction'};
}
