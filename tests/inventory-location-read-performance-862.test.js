import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileBusinessInventoryLocationsForRead} from '../inventory-locations.js';

const item=(id,quantity=5)=>({id,quantity:String(quantity),storage_area_type:'pantry',storage_location_label:''});
function fixture({items=[item(1)],locations=['Pantry'],balances=[{inventory_id:1,quantity:'5'}],lots=[],lotBalances=[],hasLots=false,inventoryGate=null}={}){
  const calls=[];
  return {calls,async query(sql,params=[]){
    calls.push({sql,params});
    if(sql.startsWith('SELECT i.id,i.quantity,i.storage_location_label')){
      if(inventoryGate)await inventoryGate();
      const assigned=new Map(balances.map(row=>[String(row.inventory_id),row.quantity]));
      return {rows:items.map(row=>({...row,allocated:assigned.get(String(row.id))||'0'}))};
    }
    if(sql.startsWith('SELECT name FROM inventory_storage_locations'))return {rows:locations.map(name=>({name}))};
    if(sql.startsWith("SELECT to_regclass('public.supply_lots')"))return {rows:[{rel:hasLots?'supply_lots':null}]};
    if(sql.startsWith('SELECT l.id,l.quantity_remaining_base')){
      const assigned=new Map(lotBalances.map(row=>[String(row.lot_id),row.quantity]));
      return {rows:lots.map(row=>({...row,allocated:assigned.get(String(row.id))||'0'}))};
    }
    if(sql.startsWith('SELECT id FROM inventory WHERE business_id=$1 ORDER BY id'))throw new Error('full_reconciliation_requested');
    throw new Error('Unexpected query: '+sql);
  }};
}

test('862: one thousand settled items require bounded bulk reads without row locks',async()=>{
  const items=Array.from({length:1000},(_,n)=>item(n+1,3));
  const pool=fixture({items,balances:items.map(row=>({inventory_id:row.id,quantity:'3'}))});
  await reconcileBusinessInventoryLocationsForRead(pool,{businessId:1});
  assert.equal(pool.calls.length,3);
  assert.match(pool.calls[0].sql,/FROM inventory_location_balances/);
  assert.ok(pool.calls.every(({sql,params})=>!sql.includes('FOR UPDATE')&&(params[0]===1||sql.includes('to_regclass'))));
});

test('862: two simultaneous reads of one business share an in-flight check',async()=>{
  let entered;const started=new Promise(resolve=>{entered=resolve});
  let release;const pending=new Promise(resolve=>{release=resolve});
  let reads=0;
  const pool=fixture({inventoryGate:async()=>{reads++;entered();await pending}});
  const first=reconcileBusinessInventoryLocationsForRead(pool,{businessId:1});
  await started;
  const second=reconcileBusinessInventoryLocationsForRead(pool,{businessId:1});
  release();
  await Promise.all([first,second]);
  assert.equal(reads,1);
  assert.equal(pool.calls.length,3);
});

test('862: finished reads are checked again rather than caching stale state',async()=>{
  const pool=fixture();
  await reconcileBusinessInventoryLocationsForRead(pool,{businessId:1});
  await reconcileBusinessInventoryLocationsForRead(pool,{businessId:1});
  assert.equal(pool.calls.length,6);
});

test('862: canonical stock drift triggers existing locked reconciler',async()=>{
  const pool=fixture({balances:[{inventory_id:1,quantity:'4'}]});
  await assert.rejects(reconcileBusinessInventoryLocationsForRead(pool,{businessId:1}),/full_reconciliation_requested/);
  assert.equal(pool.calls.filter(x=>x.sql.startsWith('SELECT id FROM inventory WHERE')).length,1);
});

test('862: missing default location triggers repair for zero stock',async()=>{
  const pool=fixture({items:[item(1,0)],locations:[],balances:[]});
  await assert.rejects(reconcileBusinessInventoryLocationsForRead(pool,{businessId:1}),/full_reconciliation_requested/);
});

test('862: matching lots skip repair, lot drift invokes it',async()=>{
  const lot={id:15,quantity_remaining_base:'2'};
  const matching=fixture({hasLots:true,lots:[lot],lotBalances:[{lot_id:15,quantity:'2'}]});
  await reconcileBusinessInventoryLocationsForRead(matching,{businessId:1});
  assert.equal(matching.calls.length,4);
  const drift=fixture({hasLots:true,lots:[lot],lotBalances:[{lot_id:15,quantity:'1'}]});
  await assert.rejects(reconcileBusinessInventoryLocationsForRead(drift,{businessId:1}),/full_reconciliation_requested/);
});

test('862: failure is not cached and next request retries',async()=>{
  const pool=fixture({balances:[{inventory_id:1,quantity:'4'}]});
  await assert.rejects(reconcileBusinessInventoryLocationsForRead(pool,{businessId:1}),/full_reconciliation_requested/);
  await assert.rejects(reconcileBusinessInventoryLocationsForRead(pool,{businessId:1}),/full_reconciliation_requested/);
  assert.equal(pool.calls.filter(x=>x.sql.startsWith('SELECT id FROM inventory WHERE')).length,2);
});

test('862: different businesses never coalesce or reuse one business query',async()=>{
  const pool=fixture();
  await Promise.all([
    reconcileBusinessInventoryLocationsForRead(pool,{businessId:1}),
    reconcileBusinessInventoryLocationsForRead(pool,{businessId:2})
  ]);
  const reads=pool.calls.filter(x=>x.sql.startsWith('SELECT i.id,i.quantity,i.storage_location_label'));
  assert.deepEqual(reads.map(x=>x.params[0]).sort(),[1,2]);
});
