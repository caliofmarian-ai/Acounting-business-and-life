import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {inventoryMutationOrigin,boundInventoryOrigin} from '../inventory-origin-core.js';

const server=readFileSync(new URL('../server-business-accounting.js',import.meta.url),'utf8');
const from=server.indexOf('async function accountingContext(req){'),to=server.indexOf('\nasync function specificBusiness(',from);
assert.ok(from>=0&&to>from);
const source=server.slice(from,to);
const NO_ORIGIN=Symbol('no-origin');
const request=(method='POST',path='/api/inventory/purchase',id='11')=>({method,path,headers:id===NO_ORIGIN?{}:{'x-abl-inventory-origin-business':id}});
const bindings=[{id:11},{id:22}];
function harness({role='merchant',enabled=true,assigned=bindings,delay=false}={}){
  let preference=11,updates=0,provisions=0,budgets=[];
  let resume=()=>{};
  const gate=delay?new Promise(resolve=>{resume=resolve}):Promise.resolve();
  const scope={
    identity:async()=>{await gate;return{account:{id:71,active_role:role},profiles:[{role,enabled}]}},
    clean:v=>String(v??'').trim(),
    roleEnabled:(me,r)=>me.profiles.some(p=>p.role===r&&p.enabled),
    profileBindings:async()=>assigned,
    ensureProfileBusinessBinding:async()=>{provisions++},
    inventoryMutationOrigin,boundInventoryOrigin,
    ensureBudgetRow:async id=>{budgets.push(id)},
    pool:{query:async(sql,args)=>{
      if(sql.includes('SELECT business_id FROM account_business_preferences'))return{rows:[{business_id:preference}]};
      if(sql.includes('INSERT INTO account_business_preferences')){updates++;preference=args[2];return{rows:[]}};
      throw Error('Unexpected SQL: '+sql);
    }}
  };
  const accountingContext=vm.runInNewContext(source+'\naccountingContext',scope);
  return{accountingContext,resume,switchTo:id=>{preference=id},state:()=>({preference,updates,provisions,budgets})};
}
test('Inventory mutations require business origin; read-only GET routes stay compatible',()=>{
  for(const path of ['/api/inventory/purchase','/api/inventory/locations','/api/inventory/count-sessions/1','/api/inventory/1/identifiers']){
    for(const method of ['POST','PUT','PATCH','DELETE']){
      assert.equal(inventoryMutationOrigin(request(method,path,'11')),11);
      for(const invalid of [NO_ORIGIN,null,'','0','-1','01','1.2','abc','9007199254740993',['11','22']])
        assert.throws(()=>inventoryMutationOrigin(request(method,path,invalid)),e=>e.status===409&&e.code==='INVENTORY_ORIGIN_REQUIRED');
    }
    if(path==='/api/inventory/locations'){
      assert.throws(()=>inventoryMutationOrigin(request('GET',path,NO_ORIGIN)),e=>e.status===409);
      assert.equal(inventoryMutationOrigin(request('GET',path,'11')),11);
    }else assert.equal(inventoryMutationOrigin(request('GET',path,NO_ORIGIN)),null);
  }
  assert.equal(inventoryMutationOrigin(request('POST','/api/product-sales',NO_ORIGIN)),null);
});
test('reconciling GET locations and location-balances require verified origin, not a mutable preference',async()=>{
  for(const path of ['/api/inventory/locations','/api/inventory/location-balances']){
    assert.equal(inventoryMutationOrigin(request('GET',path,'11')),11);
    assert.equal(inventoryMutationOrigin(request('GET',path+'/', '11')),11);
    for(const bad of [NO_ORIGIN,'',null,'0','abc','22,11']){
      assert.throws(()=>inventoryMutationOrigin(request('GET',path,bad)),e=>e.status===409&&e.code==='INVENTORY_ORIGIN_REQUIRED');
    }
    const h=harness({delay:true});
    const begun=h.accountingContext(request('GET',path,'11'));
    h.switchTo(22);h.resume();
    const ctx=await begun;
    assert.equal(ctx.business.id,11,path);
    assert.deepEqual(h.state(),{preference:22,updates:0,provisions:0,budgets:[11]});
  }
  for(const path of ['/api/inventory','/api/inventory/lots','/api/inventory/transfers','/api/inventory/count-sessions/active','/api/inventory/lookup']){
    assert.equal(inventoryMutationOrigin(request('GET',path,NO_ORIGIN)),null,path);
  }
});

test('route guard covers both reconciliation-writing GET handlers without trusting arbitrary business IDs',async()=>{
  const routes=readFileSync(new URL('../inventory-locations.js',import.meta.url),'utf8');
  assert.match(routes,/app\.get\('\/api\/inventory\/locations',[\s\S]*?await reconcileBusinessInventoryLocations/);
  assert.match(routes,/app\.get\('\/api\/inventory\/location-balances',[\s\S]*?inventoryLocationBalanceRows\(pool/);
  assert.match(routes,/export async function inventoryLocationBalanceRows[\s\S]*?await reconcileBusinessInventoryLocations/);
  const h=harness();
  await assert.rejects(h.accountingContext(request('GET','/api/inventory/locations','33')),e=>e.status===403&&e.code==='INVENTORY_ORIGIN_FORBIDDEN');
  assert.deepEqual(h.state(),{preference:11,updates:0,provisions:0,budgets:[]});
});

test('delayed A purchase never targets B after preference switches, or resets B preference',async()=>{
  const h=harness({delay:true});
  const old=h.accountingContext(request('POST','/api/inventory/purchase','11'));
  h.switchTo(22);h.resume();
  const result=await old;assert.equal(result.business.id,11);
  assert.deepEqual(h.state(),{preference:22,updates:0,provisions:0,budgets:[11]});
  const current=await h.accountingContext(request('POST','/api/inventory/purchase','22'));
  assert.equal(current.business.id,22);
});
test('forged but valid ID lacks a binding; missing header never invokes DB preference',async()=>{
  const h=harness();
  await assert.rejects(h.accountingContext(request('POST','/api/inventory/purchase','33')),e=>e.status===403);
  await assert.rejects(h.accountingContext(request('POST','/api/inventory/purchase',NO_ORIGIN)),e=>e.status===409);
  assert.deepEqual(h.state(),{preference:11,updates:0,provisions:0,budgets:[]});
});
test('no automatic binding for unbound Inventory mutation; disabled Merchant forbidden',async()=>{
  const h=harness({assigned:[]});
  await assert.rejects(h.accountingContext(request()),e=>e.status===403);
  assert.equal(h.state().provisions,0);
  for(const config of [{role:'customer'},{enabled:false}]){
    const x=harness(config);
    await assert.rejects(x.accountingContext(request()),e=>e.status===403);
  }
});
test('normal workspace read still uses preference; valid authorized origin bypasses preference update',async()=>{
  const h=harness();
  h.switchTo(22);
  const read=await h.accountingContext(request('GET','/api/inventory',NO_ORIGIN));
  assert.equal(read.business.id,22);
  assert.equal(h.state().updates,1);
  const write=await h.accountingContext(request('PATCH','/api/inventory/1/identifiers','11'));
  assert.equal(write.business.id,11);assert.equal(h.state().preference,22);
});
test('all registered Inventory route groups use central accountingContext',()=>{
  assert.match(source,/const originBusinessId=inventoryMutationOrigin\(req\)/);
  assert.match(source,/selected=boundInventoryOrigin\(bindings,originBusinessId\)/);
  assert.match(server,/app.post\('\/api\/inventory\/purchase',jsonBody,async\(req,res,next\)=>\{\s*try\{\s*const ctx=await accountingContext\(req\)/);
  for(const file of ['inventory-count-sessions.js','inventory-locations.js','inventory-identifiers.js']){
    const source=readFileSync(new URL('../'+file,import.meta.url),'utf8');
    assert.match(source,/const ctx=await accountingContext\(req\)/);
  }
});
