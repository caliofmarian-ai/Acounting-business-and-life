import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInventoryLocationUi} from '../public/inventory-location-ui.js';

const payload=()=>({
  locations:[{id:11,business_id:1,name:'Dry store',active:true}],
  balances:[{business_id:1,inventory_id:10,location_id:11,quantity:4}],
  transfers:[]
});

function withInventoryCard(run){
  const prior=globalThis.document;
  globalThis.document={getElementById:id=>id==='inventoryLocationsCard'?{}:null};
  return Promise.resolve().then(run).finally(()=>{globalThis.document=prior});
}
function controller(api,changes=[]){
  return createInventoryLocationUi({
    api,
    getInventory:()=>[{id:10,item:'Rice'}],
    refreshInventory:async()=>{},
    escapeHtml:String,
    formatNumber:String,
    onLocationsChanged:rows=>changes.push(rows),
    getReadGuard:()=>()=>true
  });
}

test('Storage prefetch starts independently and does not render or fetch twice',()=>withInventoryCard(async()=>{
  const requests=[],changes=[];
  let respond;
  const instance=controller(path=>{
    requests.push(path);
    return new Promise(resolve=>{respond=resolve});
  },changes);
  const prepared=instance.prefetch();
  await Promise.resolve();
  assert.deepEqual(requests,['/api/inventory/location-summary']);
  assert.equal(changes.length,0,'prefetch must not mutate the UI');
  respond(payload());
  await prepared;
  assert.equal(changes.length,0);
  assert.deepEqual(instance.getLocations(),[]);
  const loaded=await instance.load({prefetched:prepared,isCurrent:()=>true});
  assert.equal(requests.length,1,'one snapshot GET per Stock page load');
  assert.equal(loaded.locations[0].name,'Dry store');
  assert.equal(instance.getLocations()[0].name,'Dry store');
  assert.equal(changes.length,1);
}));

test('prefetched old-business Storage cannot overwrite a newer Merchant context',()=>withInventoryCard(async()=>{
  let respond;
  const changes=[],instance=controller(()=>new Promise(resolve=>{respond=resolve}),changes);
  let current=true;
  const prepared=instance.prefetch();
  await Promise.resolve();
  respond(payload());
  current=false;
  const read=await instance.load({prefetched:prepared,isCurrent:()=>current});
  assert.equal(read,null);
  assert.equal(changes.length,0);
  assert.deepEqual(instance.getLocations(),[]);
}));

test('an early failed snapshot does not create an unhandled rejection or ready state',()=>withInventoryCard(async()=>{
  const instance=controller(async()=>{throw new Error('Snapshot unavailable')});
  const prepared=instance.prefetch();
  await prepared; // rejection was consumed by prefetch itself
  const result=await instance.load({prefetched:prepared,isCurrent:()=>true});
  assert.equal(result.readError,true);
  assert.deepEqual(instance.getLocations(),[]);
}));

test('normal standalone Storage refresh still calls the canonical single summary',()=>withInventoryCard(async()=>{
  const paths=[],instance=controller(async path=>{paths.push(path);return payload()});
  const result=await instance.load({isCurrent:()=>true});
  assert.equal(result.locations.length,1);
  assert.deepEqual(paths,['/api/inventory/location-summary']);
}));

test('opened Stock tools fetch only their required details; full refresh preserves prefetch before ready',()=>{
  const source=readFileSync(new URL('../public/v03.js',import.meta.url),'utf8');
  const start=source.indexOf('async function loadStock({tool=null}={}){');
  const stop=source.indexOf('\n// One expanded instrument at a time.',start);
  const block=source.slice(start,stop);
  assert.ok(start>0&&stop>start);
  assert.match(block,/const usesLocations=!tool\|\|tool==='locations'\|\|tool==='count'\|\|tool==='purchase'/);
  assert.match(block,/usesLocations&&typeof inventoryLocationUi\.prefetch==='function'/);
  assert.ok(block.indexOf('inventoryLocationUi.prefetch()')<block.indexOf("await cachedJson('/api/inventory'"));
  assert.match(block,/inventoryLocationUi\.load\(\{isCurrent,prefetched:prefetchedStorage\}\)/);
  assert.match(block,/if\(!tool\|\|tool==='lots'\)jobs\.push\(loadInventoryLots\(isCurrent\)\)/);
  assert.match(block,/if\(!tool\|\|tool==='consumables'\)jobs\.push\(loadConsumableRules\(isCurrent\)\)/);
  assert.ok(block.indexOf("inventoryReadState('ready')")>block.indexOf('await Promise.all'));
});
