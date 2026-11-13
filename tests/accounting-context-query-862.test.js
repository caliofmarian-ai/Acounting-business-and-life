import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveAccountingContext} from '../accounting-context-query-core.js';
import {readFileSync} from 'node:fs';

test('ordinary accounting context resolves all active bindings and selected business with one parameterized query',async()=>{
  const calls=[];
  const rows=[
    {id:101,name:'Primary',is_primary:true,binding_status:'active',membership_role:'owner',context_selected:false},
    {id:102,name:'Selected',is_primary:false,binding_status:'active',membership_role:'manager',context_selected:true}
  ];
  const pool={query:async(sql,values)=>{calls.push({sql,values});return{rows};}};
  const result=await resolveAccountingContext(pool,71,'merchant');
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].values,[71,'merchant']);
  assert.equal(result.business.id,102);
  assert.deepEqual(result.businesses.map(b=>b.id),[101,102]);
  assert.ok(result.businesses.every(b=>!Object.hasOwn(b,'context_selected')));
  assert.match(calls[0].sql,/JOIN business_memberships/);
  assert.match(calls[0].sql,/ON CONFLICT\(account_id,role\) DO UPDATE/);
  assert.match(calls[0].sql,/IS DISTINCT FROM EXCLUDED\.business_id/);
  assert.match(calls[0].sql,/ON CONFLICT\(business_id,id\) DO NOTHING/);
});

test('missing binding returns an empty result so the existing lazy-binding path can run',async()=>{
  let calls=0;
  const pool={query:async()=>{calls++;return{rows:[]};}};
  const result=await resolveAccountingContext(pool,72,'supplier');
  assert.equal(calls,1);
  assert.equal(result.business,null);
  assert.deepEqual(result.businesses,[]);
});

test('invalid account or role fails before any database call',async()=>{
  let calls=0;
  const pool={query:async()=>{calls++;return{rows:[]};}};
  await assert.rejects(()=>resolveAccountingContext(pool,0,'merchant'),TypeError);
  await assert.rejects(()=>resolveAccountingContext(pool,71,'customer'),TypeError);
  assert.equal(calls,0);
});

test('server uses the one-query resolver only for non-origin context and preserves origin-bound mutation path',()=>{
  const server=readFileSync(new URL('../server-business-accounting.js',import.meta.url),'utf8');
  const start=server.indexOf('async function accountingContext(req){');
  const end=server.indexOf('async function specificBusiness(req,businessId){',start);
  assert.ok(start>=0&&end>start);
  const body=server.slice(start,end);
  assert.match(body,/resolveAccountingContext\(pool,accountId,role\)/);
  assert.match(body,/if\(originBusinessId==null\)/);
  assert.match(body,/boundInventoryOrigin\(bindings,originBusinessId\)/);
  assert.match(body,/await ensureBudgetRow\(Number\(selected\.id\)\)/);
  assert.equal((body.match(/await profileBindings\(accountId,role\)/g)||[]).length,1);
});
