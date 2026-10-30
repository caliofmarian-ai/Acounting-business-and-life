import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileBusinessInventoryLocationsForRead,ensureInventoryLocationSchema} from '../inventory-locations.js';

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


test('862: settled boot schema initialization skips legacy O(items+lots) row locking',async()=>{
  const items=Array.from({length:1000},(_,n)=>item(n+1,2));
  const base=fixture({items,balances:items.map(row=>({inventory_id:row.id,quantity:'2'}))});
  const pool={
    async query(sql,args=[]){
      if(sql.includes('CREATE TABLE IF NOT EXISTS inventory_storage_locations')){
        base.calls.push({sql:'schema-setup',params:[]});
        return{rows:[]};
      }
      if(sql.startsWith('SELECT DISTINCT business_id FROM inventory WHERE business_id IS NOT NULL')){
        base.calls.push({sql:'list-businesses',params:[]});
        return{rows:[{business_id:1}]};
      }
      return base.query(sql,args);
    }
  };
  await ensureInventoryLocationSchema(pool);
  assert.equal(base.calls.length,5);
  assert.equal(base.calls.filter(x=>x.sql.startsWith('SELECT i.id,i.quantity,i.storage_location_label')).length,1);
  assert.ok(base.calls.every(({sql})=>!sql.includes('FOR UPDATE')),
    'no legacy row locks on settled 1000-item startup');
});

test('862: boot schema initialization retains locked repair when existing stock drifts',async()=>{
  const base=fixture({items:[item(1,5)],balances:[{inventory_id:1,quantity:'4'}]});
  const pool={
    async query(sql,args=[]){
      if(sql.includes('CREATE TABLE IF NOT EXISTS inventory_storage_locations'))return{rows:[]};
      if(sql.startsWith('SELECT DISTINCT business_id FROM inventory WHERE business_id IS NOT NULL'))
        return{rows:[{business_id:1}]};
      return base.query(sql,args);
    }
  };
  await assert.rejects(ensureInventoryLocationSchema(pool),/full_reconciliation_requested/);
  assert.equal(base.calls.filter(x=>x.sql.startsWith('SELECT id FROM inventory WHERE business_id=$1 ORDER BY id')).length,1);
});

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

test('862: authenticated HTTP location GETs reject guests and wrong profiles, and stay tenant-bound',async()=>{
  // Runs the registered Express handlers over HTTP with an isolated synthetic
  // accountingContext. It does not substitute for real Preview auth acceptance.
  const express=(await import('express')).default;
  const {registerInventoryLocationRoutes}=await import('../inventory-locations.js');
  const app=express();
  const queries=[];
  const pool={
    async query(sql,args=[]){
      queries.push({sql,args});
      if(sql.startsWith('SELECT i.id,i.quantity,i.storage_location_label'))return {rows:[]};
      if(sql.startsWith('SELECT name FROM inventory_storage_locations'))return {rows:[{name:'Pantry'}]};
      if(sql.startsWith("SELECT to_regclass('public.supply_lots')"))return {rows:[{rel:null}]};
      if(sql.includes('SELECT * FROM inventory_storage_locations')){
        return {rows:[{id:Number(args[0])*10,business_id:Number(args[0]),name:'Pantry',active:true}]};
      }
      if(sql.includes('SELECT b.business_id,b.inventory_id,b.location_id')){
        const businessId=Number(args[0]),inventoryId=businessId*10+1;
        if(args.length===2&&Number(args[1])!==inventoryId)return {rows:[]};
        return {rows:[{business_id:businessId,inventory_id:inventoryId,
          location_id:businessId*10,quantity:'3',item:'Synthetic item',unit:'pcs'}]};
      }
      throw new Error('Unexpected Inventory SQL: '+sql);
    }
  };
  const accountingContext=async req=>{
    const identity=req.headers['x-qa-identity'];
    if(identity==='merchant-a'||identity==='merchant-b'){
      const id=identity==='merchant-a'?101:202;
      return {role:'merchant',business:{id},me:{account:{id:id+1000}}};
    }
    if(identity==='customer')return {role:'customer',business:{id:303},me:{account:{id:1303}}};
    throw Object.assign(new Error('Authentication required'),{status:401});
  };
  registerInventoryLocationRoutes(app,{pool,jsonBody:express.json(),accountingContext});
  app.use((err,req,res,next)=>res.status(err.status||500).json({error:err.message}));
  const server=await new Promise((resolve,reject)=>{
    const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));
    listener.once('error',reject);
  });
  try{
    const base='http://127.0.0.1:'+server.address().port;
    const get=async(path,identity)=>{
      const response=await fetch(base+path,{
        headers:identity?{'x-qa-identity':identity}:{}
      });
      return {status:response.status,body:await response.json()};
    };
    for(const path of ['/api/inventory/locations','/api/inventory/location-balances']){
      assert.equal((await get(path)).status,401,'guest read must fail');
      assert.equal((await get(path,'customer')).status,403,'non-Merchant read must fail');
    }
    assert.equal(queries.length,0,'rejected requests must never query Inventory');

    const aLocations=await get('/api/inventory/locations?business_id=202','merchant-a');
    const bLocations=await get('/api/inventory/locations?business_id=101','merchant-b');
    assert.equal(aLocations.status,200);
    assert.equal(bLocations.status,200);
    assert.deepEqual(aLocations.body.map(row=>row.business_id),[101]);
    assert.deepEqual(bLocations.body.map(row=>row.business_id),[202]);

    const aBalances=await get('/api/inventory/location-balances?business_id=202&inventory_id=1011','merchant-a');
    const bBalances=await get('/api/inventory/location-balances?business_id=101&inventory_id=2021','merchant-b');
    assert.equal(aBalances.status,200);
    assert.equal(bBalances.status,200);
    assert.deepEqual(aBalances.body.map(row=>row.business_id),[101]);
    assert.deepEqual(bBalances.body.map(row=>row.business_id),[202]);

    const foreignInventory=await get('/api/inventory/location-balances?business_id=202&inventory_id=2021','merchant-a');
    assert.equal(foreignInventory.status,200);
    assert.deepEqual(foreignInventory.body,[],'a Merchant cannot read another business inventory item');

    assert.ok(queries.filter(row=>row.args.length).every(row=>
      Number(row.args[0])===101||Number(row.args[0])===202
    ),'all Inventory SQL must bind the authenticated Merchant business, never the query override');
    assert.ok(queries.some(row=>row.args[0]===101&&row.args[1]===2021),
      'cross-business item filter is checked with the authenticated business ID');
  }finally{
    await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }
});
