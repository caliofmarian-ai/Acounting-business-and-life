import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  INVENTORY_LOCATION_READ_862_WAVE,INVENTORY_862_PATHS,INVENTORY_862_ACCOUNTING_PATHS,INVENTORY_862_ACCOUNTING_E2E_PATHS,INVENTORY_862_LEGACY_PATHS,inventory862Percentile,inventory862AssertLatency,inventory862OtherBusiness,
  inventory862AssertScopedRows,inventory862AssertPayload,inventory862AssertWorkspace,inventory862ValidateRuntime,
  runInventoryLocationRead862Acceptance
} from '../qa-inventory-location-read-862.js';

const qaEnv={
  RAILWAY_SERVICE_NAME:'accounting-preview',APP_ENV:'qa',
  DATABASE_URL:'postgres://qa_test:placeholder@127.0.0.1:5432/accounting_qa',
  PAYMONGO_MODE:'test',PAYMONGO_LIVE_ENABLED:'false'
};
const code=readFileSync(new URL('../qa-inventory-location-read-862.js',import.meta.url),'utf8');
const harness=readFileSync(new URL('../qa-acceptance.js',import.meta.url),'utf8');
const locationUi=readFileSync(new URL('../public/inventory-location-ui.js',import.meta.url),'utf8');

test('862: percentile uses observed nearest-rank latency; missing samples are an error',()=>{
  assert.equal(inventory862Percentile([800,450,100,1000,250,300,150,200,350,600]),1000);
  assert.equal(inventory862Percentile([8,4,2,6],0.5),4);
  assert.throws(()=>inventory862Percentile([]),/actual latency samples/);
  assert.throws(()=>inventory862Percentile([1],1.5),/Invalid percentile/);
});
test('862: p95 contract rejects either measured path at or above two seconds',()=>{
  assert.equal(inventory862AssertLatency([900,1900],'ordinary accounting'),1900);
  assert.throws(()=>inventory862AssertLatency([900,2000],'ordinary accounting'),/p95 >= 2000 ms/);
});
test('862: authenticated A/B acceptance requires a second existing Merchant business',()=>{
  assert.equal(inventory862OtherBusiness([{id:11},{id:22}],11),22);
  assert.throws(()=>inventory862OtherBusiness([{id:11}],11),/second authorized Merchant business/);
});

test('862: every returned location and balance must belong to the authenticated business',()=>{
  assert.equal(inventory862AssertScopedRows([{business_id:9},{business_id:'9'}],9,'locations'),2);
  assert.throws(()=>inventory862AssertScopedRows([{business_id:8}],9,'balances'),/cross-business/);
  assert.throws(()=>inventory862AssertScopedRows({error:'Unauthorized'},9,'locations'),/non-array/);
  assert.equal(inventory862AssertPayload({
    locations:[{business_id:9}],balances:[{business_id:9}],transfers:[]
  },9,'/api/inventory/location-summary'),2);
  assert.throws(()=>inventory862AssertPayload({
    locations:[{business_id:9}],balances:[{business_id:8}],transfers:[]
  },9,'/api/inventory/location-summary'),/cross-business/);
  assert.throws(()=>inventory862AssertPayload({
    locations:[],balances:[]
  },9,'/api/inventory/location-summary'),/malformed/);
});
test('862: ordinary workspace response is tied to the authenticated selected Merchant business',()=>{
  assert.equal(inventory862AssertWorkspace({workspace:{role:'merchant',active_business_id:11,
    businesses:[{id:11},{id:22}]}},11),2);
  assert.equal(inventory862AssertWorkspace({role:'merchant',active_business_id:11,
    businesses:[{id:11},{id:22}]},11),2);
  assert.throws(()=>inventory862AssertWorkspace({workspace:{role:'merchant',active_business_id:22,
    businesses:[{id:11},{id:22}]}},11),/cross-business/);
  assert.throws(()=>inventory862AssertWorkspace({workspace:{role:'customer',active_business_id:11,
    businesses:[{id:11}]}},11),/cross-business/);
});
test('862: QA benchmark fails closed for production, wrong service and non-isolated databases',()=>{
  assert.equal(inventory862ValidateRuntime(qaEnv).databaseName,'accounting_qa');
  assert.throws(()=>inventory862ValidateRuntime({...qaEnv,RAILWAY_SERVICE_NAME:'accounting-business-life',
    APP_ENV:'production',DATABASE_URL:'postgres://x@host/accounting'}),/isolated Preview QA/);
  assert.throws(()=>inventory862ValidateRuntime({...qaEnv,DATABASE_URL:'postgres://x@host/accounting'}),/isolated/);
});
test('862: the authorized QA wave uses existing credential-restoration and runs no stock write',()=>{
  assert.equal(INVENTORY_LOCATION_READ_862_WAVE,'inventory_location_read_862');
  assert.deepEqual(INVENTORY_862_PATHS,['/api/inventory/location-summary']);
  assert.deepEqual(INVENTORY_862_ACCOUNTING_PATHS,['/api/accounting/workspaces']);
  assert.deepEqual(INVENTORY_862_ACCOUNTING_E2E_PATHS,['/api/merchant/today']);
  assert.deepEqual(INVENTORY_862_LEGACY_PATHS,[
    '/api/inventory/locations','/api/inventory/location-balances','/api/inventory/transfers'
  ]);
  const from=locationUi.indexOf('async function load(');
  const to=locationUi.indexOf('async function createLocation(',from);
  assert.ok(from>0&&to>from);
  const loading=locationUi.slice(from,to);
  assert.match(loading,/api\('\/api\/inventory\/location-summary'\)/);
  assert.doesNotMatch(loading,/api\('\/api\/inventory\/(locations|location-balances|transfers)'\)/);
  assert.match(harness,/ACCEPTANCE_WAVES\.add\(INVENTORY_LOCATION_READ_862_WAVE\)/);
  assert.match(harness,/runInventoryLocationRead862Acceptance\(/);
  assert.match(harness,/await restoreAutomationCredentials\(pool\)/);
  assert.doesNotMatch(code,/POST \/api\/inventory|\/api\/inventory\/purchase|INSERT INTO inventory|DELETE FROM inventory/);
  assert.match(code,/AbortSignal\.timeout\(12000\)/);
  assert.match(code,/Math\.ceil\(samples\.length\*percentage\)/);
  assert.match(code,/originalBusinessId/);
  const ordinaryStart=code.indexOf('async function measureOrdinaryAccounting(');
  const ordinaryEnd=code.indexOf('function assertHttp',ordinaryStart);
  assert.ok(ordinaryStart>=0&&ordinaryEnd>ordinaryStart);
  assert.doesNotMatch(code.slice(ordinaryStart,ordinaryEnd),/x-abl-inventory-origin-business/);
});

test('862: controlled Merchant + Customer sessions exercise origin-bound Inventory and ordinary accounting GETs with A/B scope',async()=>{
  const originalFetch=globalThis.fetch;
  let business=111,activeSummary=0,maxSummaryConcurrency=0;
  const queries=[],calls=[],originHeaders=[];
  const pool={
    async query(sql,args=[]){
      queries.push({sql,args});
      if(sql==='SELECT current_database() AS name')return{rows:[{name:'accounting_qa'}]};
      if(sql.startsWith('SELECT id FROM inventory WHERE business_id=$1'))return{rows:[{id:2021}]};
      if(sql.startsWith('SELECT (SELECT md5('))return{rows:[{
        inventory:'same-inventory',lots:'same-lots',location_balances:'same-balances',
        lot_location_balances:'same-lot-balances',transactions:'same-money',purchases:'same-purchases'
      }]};
      throw new Error('Unexpected QA SQL '+sql);
    }
  };
  const helpers={
    async qaAccountSession({role}){return{token:role,password:'never_logged'}},
    async requestJson(base,path,{token,method}={}){
      if(path==='/api/me')return{status:200,json:{account:{account_mode:'company_test',
        test_role:token,active_role:token}}};
      if(path==='/api/accounting/workspaces')return{status:200,
        json:{role:'merchant',active_business_id:business,businesses:[{id:111},{id:222}]}};
      if(path==='/api/auth/logout'){calls.push('logout-'+token);return{status:200,json:{ok:true}}}
      throw new Error('Unexpected QA helper path '+path);
    },
    expectStatus(r,code,label){assert.equal(r.status,code,label)}
  };
  globalThis.fetch=async (url,opts={})=>{
    const pathname=new URL(url).pathname,params=new URL(url).searchParams;
    if(pathname==='/api/inventory/location-summary'){
      activeSummary++;
      maxSummaryConcurrency=Math.max(maxSummaryConcurrency,activeSummary);
      await Promise.resolve();
      activeSummary--;
    }
    originHeaders.push({pathname,value:opts.headers?.['x-abl-inventory-origin-business']});
    if(pathname==='/api/accounting/active-workspace'){
      business=Number(JSON.parse(opts.body).business_id);
      calls.push('switch-'+business);
      return new Response(JSON.stringify({business:{id:business}}),{status:200,
        headers:{'Content-Type':'application/json'}});
    }
    const auth=String(opts.headers?.Authorization||'');
    const status=!auth?401:auth==='Bearer customer'?403:200;
    let body=status===200?[]:{error:'Unauthorized'};
    if(status===200&&pathname==='/api/accounting/workspaces')
      body={role:'merchant',active_business_id:business,businesses:[{id:111},{id:222}]};
    if(status===200&&pathname==='/api/merchant/today')
      body={workspace:{role:'merchant',active_business_id:business,businesses:[{id:111},{id:222}]}};
    if(status===200&&pathname==='/api/inventory/location-summary')
      body={
        locations:[{business_id:business,id:business*10}],
        balances:[{business_id:business,inventory_id:business*10+1}],
        transfers:[]
      };
    if(status===200&&pathname==='/api/inventory/locations')
      body=[{business_id:business,id:business*10}];
    if(status===200&&pathname==='/api/inventory/location-balances'){
      const foreign=params.get('inventory_id')==='2021'&&business===111;
      body=foreign?[]:[{business_id:business,inventory_id:business*10+1}];
    }
    calls.push('get-'+pathname+'-'+status);
    return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  };
  try{
    const result=await runInventoryLocationRead862Acceptance({
      pool,base:'http://127.0.0.1:8080',secret:'qa-fixture-only',
      env:qaEnv,aliases:{merchant:'testmerchant@example.test',customer:'testcustomer@example.test'},
      helpers,rounds:12
    });
    assert.equal(result.status,'PASS');
    assert.equal(result.authenticated_qa_merchant,true);
    assert.equal(result.ordinary_workspace_context,true);
    assert.equal(result.ordinary_workspace_origin_header_sent,false);
    assert.equal(result.accounting_context_path,'/api/accounting/workspaces');
    assert.ok(Number.isFinite(result.accounting_context_p95_ms));
    assert.equal(result.merchant_today_path,'/api/merchant/today');
    assert.ok(Number.isFinite(result.merchant_today_p95_ms));
    assert.ok(originHeaders.filter(x=>x.pathname==='/api/accounting/workspaces'||x.pathname==='/api/merchant/today').every(x=>x.value===undefined),
      'ordinary accounting reads must not force the Inventory origin path');
    assert.ok(originHeaders.filter(x=>x.pathname.startsWith('/api/inventory/')).some(x=>x.value==='111'),
      'Inventory reads retain explicit origin authority');
    assert.equal(result.business_a_b_verified,true);
    assert.equal(result.guest_401,true);
    assert.equal(result.customer_403,true);
    assert.equal(result.storage_summary_requests,24);
    assert.equal(result.storage_summary_concurrent_pairs,12);
    assert.ok(maxSummaryConcurrency>=2,'two Storage summary GETs must overlap in each measurement pair');
    assert.ok(Number.isFinite(result.storage_summary_p95_ms));
    assert.equal(result.legacy_endpoints_authorized_and_tenant_scoped,true);
    assert.equal(result.no_stock_or_money_write,true);
    assert.equal(business,111,'original business must be restored');
    assert.ok(calls.includes('switch-222'));
    assert.ok(calls.includes('switch-111'));
    assert.ok(calls.includes('logout-merchant'));
    assert.ok(calls.includes('logout-customer'));
    assert.ok(queries.every(q=>/^(SELECT|select)/.test(q.sql)),
      'QA acceptance must only read business table state');
  }finally{globalThis.fetch=originalFetch}
});
