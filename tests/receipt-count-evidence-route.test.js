import test from 'node:test';
import assert from 'node:assert/strict';
import {registerReceiptIntelligenceRoutes} from '../receipt-intelligence-routes.js';

function fixture({sessionStatus='review',allowedBusiness=5,vaultReady=true}={}){
  const registered=new Map(),queries=[];
  const app={
    get:(route,handler)=>registered.set('GET '+route,handler),
    post:(route,_body,handler)=>registered.set('POST '+route,handler)
  };
  const pool={query:async(sql,args=[])=>{
    const statement=String(sql);
    queries.push({sql:statement,args});
    if(statement.includes('FROM profile_business_bindings pb')){
      return {rows:Number(args[2])===allowedBusiness?[{id:allowedBusiness}]:[],rowCount:Number(args[2])===allowedBusiness?1:0};
    }
    if(statement.includes("to_regclass('public.merchant_purchase_documents')")){
      return {rows:[{vault:vaultReady?'merchant_purchase_documents':null}],rowCount:1};
    }
    if(statement.includes('SELECT status FROM inventory_count_sessions')){
      if(Number(args[1])!==allowedBusiness)return{rows:[],rowCount:0};
      return{rows:[{status:sessionStatus}],rowCount:1};
    }
    if(statement.includes('FROM inventory_count_session_items si')){
      return{rows:[{
        inventory_id:9,item:'Oil',unit:'ml',expected_quantity:'1000',
        counted_quantity:'800',purchase_id:41,total_cost:'130.00',
        purchase_quantity:'1',purchase_unit:'L',purchase_at:'2026-10-29T10:00:00Z',
        receipt_id:81,issuer_name:'Private Supplier',document_number:'PDF-818',
        issue_date:'2026-10-29'
      }],rowCount:1};
    }
    throw Error('Unexpected SQL: '+statement.slice(0,150));
  }};
  const identity=async()=>({account:{id:17},profiles:[{role:'merchant',enabled:true}]});
  registerReceiptIntelligenceRoutes({app,pool,body:(_req,_res,next)=>next(),identity});
  const route=registered.get('GET /api/procurement/receipt-intelligence/count-sessions/:id/variance-evidence');
  assert.ok(route);
  async function call(businessId=5,countId=123){
    return new Promise(resolve=>{
      let code=200;
      const res={status(next){code=next;return this},json(value){resolve({status:code,body:value})}};
      Promise.resolve(route({params:{id:String(countId)},query:{business_id:String(businessId)}},res,
        error=>resolve({status:error?.status||500,error:error?.message||'unknown'})))
        .catch(error=>resolve({status:error?.status||500,error:error.message}));
    });
  }
  return{call,queries};
}

test('blind count refuses financial evidence before reading expected quantities',async()=>{
  const f=fixture({sessionStatus:'in_progress'});
  const result=await f.call();
  assert.equal(result.status,409);
  assert.match(result.error,/Finish blind counting/);
  assert.equal(f.queries.filter(q=>q.sql.includes('FROM inventory_count_session_items si')).length,0);
});

test('reviewed count can access one business-scoped, read-only receipt link',async()=>{
  const f=fixture();
  const result=await f.call();
  assert.equal(result.status,200);
  assert.equal(result.body.count_session_id,123);
  assert.equal(result.body.session_status,'review');
  assert.equal(result.body.findings.length,1);
  assert.equal(result.body.findings[0].variance,-200);
  assert.equal(result.body.findings[0].receipt.id,81);
  assert.equal(result.body.findings[0].last_purchase.id,41);
  assert.equal(result.body.stock_posted,false);
  assert.ok(f.queries.some(q=>q.sql.includes('WHERE si.session_id=$1')&&Number(q.args[1])===5));
  assert.ok(f.queries.every(q=>!/^\s*(INSERT|UPDATE|DELETE)\b/i.test(q.sql)));
});

test('requesting another business is denied before fetching its private count evidence',async()=>{
  const f=fixture({allowedBusiness:5});
  const result=await f.call(6);
  assert.equal(result.status,403);
  assert.equal(f.queries.filter(q=>q.sql.includes('FROM inventory_count_session_items si')).length,0);
});

test('missing receipt archive fails closed without exposing count totals',async()=>{
  const f=fixture({vaultReady:false});
  const result=await f.call();
  assert.equal(result.status,503);
  assert.equal(f.queries.filter(q=>q.sql.includes('FROM inventory_count_session_items si')).length,0);
});

test('posted counts remain accessible to historical evidence reviewers',async()=>{
  const f=fixture({sessionStatus:'posted'});
  const result=await f.call();
  assert.equal(result.status,200);
  assert.equal(result.body.session_status,'posted');
});
