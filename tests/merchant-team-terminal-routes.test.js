import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {installMerchantTeamTerminalRoutes,staffOrderCatalog} from '../merchant-team-terminal-routes.js';
import {TERMINAL_COOKIE,terminalCsrf} from '../merchant-team-terminal-core.js';
const secret='test-terminal-session-secret-very-long-for-HMAC';
const token=crypto.randomBytes(36).toString('base64url');
const workerId='12ada236-d4ae-4d4f-8410-c2f2b7cbacfa';
const current=new Date('2026-10-31T10:00:00Z');
function rig({terminal=true,ai=true,role='order_operator'}={}){
 const handlers=new Map(),routes=[];
 const method=verb=>(path,...args)=>{handlers.set(`${verb} ${path}`,args.at(-1));routes.push(`${verb} ${path}`)};
 const app={get:method('GET'),post:method('POST')};
 const calls=[];
 const db={async connect(){return{async query(){return{rows:[],rowCount:0}},release(){}}},async query(sql,args=[]){
   calls.push({sql,args});
   const text=String(sql);
   if(text.includes('FROM merchant_team_terminal_sessions s'))return{rows:[{
     session_id:'b46c7223-4d08-4dfa-8aa4-f8667e5a1c21',business_id:7,owner_account_id:31,
     operator_id:workerId,display_name:'Mother',role,is_active:true,operator_revoked:null,
     session_revoked:null,session_expires_at:new Date('2026-10-31T18:00:00Z'),operator_expires_at:null
   }],rowCount:1};
   return{rows:[],rowCount:0};
 }};
 const config={MERCHANT_TEAM_ENABLED:'1',MERCHANT_TEAM_TERMINAL_ENABLED:terminal?'1':'0',
   ORDER_VOICE_AI_ENABLED:ai?'1':'0'};
 installMerchantTeamTerminalRoutes(app,{db,env:config,requireMerchant:async()=>{throw Object.assign(new Error('Forbidden'),{status:403})},
   secret,pepper:'pin-pepper-for-testing-must-be-long',tokenSecret:'owner-secret-for-testing-must-be-long',now:()=>current,
   catalogForBusiness:async id=>{calls.push({catalog:id});return[{id:10,name:'Adobo',source_kind:'marketplace_product',selling_price:129,unit_cost:83,inventory_id:981,active:true,available:true}]},
   listOrdersForBusiness:async id=>{calls.push({orders:id});return[{id:1,order_number:'BL-1',order_status:'preparing',payment_status:'unpaid',total:'129',customer_contact:'private-email'}]},
   interpretTurn:async()=>({operations:[{action:'readback'}]}),
   applyTurn:({businessId,sessionId,previousDraft})=>({draft:previousDraft||{business_id:businessId,session_id:sessionId,lines:[]}}),
   chargeAiQuota:async()=>{},quoteForDraft:async()=>({status:'quote_only',quote:{total_centavos:12900}})
 });
 const request=async(verb,path,{body={},cookie=`${TERMINAL_COOKIE}=${token}`,headers={}}={})=>{
   let status=200,data=null,html=null,ended=false,headersOut={};
   const res={headersSent:false,set(k,v){headersOut[k]=v;return this},status(x){status=x;return this},
     json(x){data=x;this.headersSent=true;return this},type(){return this},send(x){html=x;this.headersSent=true;return this},end(){ended=true;this.headersSent=true;return this}};
   const fn=handlers.get(`${verb} ${path}`);if(!fn)throw Error('No handler '+verb+' '+path);
   const req={method:verb,path,headers:{cookie,...headers},body,query:{},params:{}};
   await fn(req,res);return{status,data,headers:headersOut,html,ended};
 };
 return{request,routes,calls};
}

test('independent staff portal exposes only scoped catalog/orders/voice, no Money or account impersonation',()=>{
 const {routes}=rig();
 for(const path of ['GET /operator','POST /api/orders/operator/pair/start',
 'GET /api/orders/operator/session','GET /api/orders/operator/catalog',
 'GET /api/orders/operator/orders','POST /api/orders/operator/voice/turn','POST /api/orders/operator/voice/quote'])assert.ok(routes.includes(path));
 assert.equal(routes.some(x=>/money|payment|refund|admin|account\/session/.test(x)),false);
 assert.equal(routes.some(x=>x.endsWith('/create')),false);
});
test('worker does not need a main Merchant owner session to inspect only the Catalog',async()=>{
 const {request,calls}=rig();const r=await request('GET','/api/orders/operator/catalog');
 assert.equal(r.status,200);assert.equal(r.data.business_id,7);
 assert.equal(r.data.products[0].name,'Adobo');
 assert.equal(JSON.stringify(r.data).includes('unit_cost'),false);
 assert.equal(JSON.stringify(r.data).includes('inventory_id'),false);
 assert.ok(calls.some(x=>x.catalog===7));
});
test('owner cookie present on the staff terminal blocks all restricted worker reads',async()=>{
 const {request}=rig();const r=await request('GET','/api/orders/operator/catalog',{
  cookie:`${TERMINAL_COOKIE}=${token}; __Host-abl_session=owner-auth-cookie`});
 assert.equal(r.status,409);assert.equal(r.data.code,'OPERATOR_OWNER_SESSION');
});
test('a worker without staff cookie is denied, even without an account cookie',async()=>{
 const {request}=rig();const r=await request('GET','/api/orders/operator/session',{cookie:''});
 assert.equal(r.status,401);assert.equal(r.data.code,'OPERATOR_SESSION_REQUIRED');
});
test('staff session returns a CSRF secret but no account token or Money permissions',async()=>{
 const {request}=rig();const r=await request('GET','/api/orders/operator/session');
 assert.equal(r.status,200);assert.equal(r.data.active,true);
 assert.equal(r.data.operator.name,'Mother');assert.equal(r.data.capabilities.money,false);
 assert.equal(r.data.capabilities.order_create,false);
 assert.match(r.data.csrf_token,/^[a-f0-9]{64}$/);
 assert.equal(JSON.stringify(r.data).includes('test-terminal-session-secret'),false);
});
test('every staff AI write requires same-session CSRF and separate affirmative consent',async()=>{
 const {request}=rig();const fail=await request('POST','/api/orders/operator/voice/turn',{
  body:{transcript:'three adobo',consent:true}});
 assert.equal(fail.status,403);assert.equal(fail.data.code,'OPERATOR_CSRF_REQUIRED');
 const denied=await request('POST','/api/orders/operator/voice/turn',{
  headers:{'x-team-csrf-token':terminalCsrf(secret,token)},body:{transcript:'three adobo',consent:false}});
 assert.equal(denied.status,400);assert.equal(denied.data.code,'ORDER_VOICE_BAD_REQUEST');
 const ok=await request('POST','/api/orders/operator/voice/turn',{
  headers:{'x-team-csrf-token':terminalCsrf(secret,token)},body:{transcript:'three adobo',consent:true}});
 assert.equal(ok.status,200);assert.equal(ok.data.creates_orders,false);
 assert.equal(ok.data.operator_id,workerId);
});
test('stock helper cannot use voice assistant despite belonging to same business',async()=>{
 const {request}=rig({role:'stock_helper'});const r=await request('GET','/api/orders/operator/catalog');
 assert.equal(r.status,403);assert.equal(r.data.code,'OPERATOR_PERMISSION_DENIED');
});
test('employee Orders projection excludes contacts, payment methods and internal accounting',async()=>{
 const {request}=rig();const r=await request('GET','/api/orders/operator/orders');
 assert.equal(r.status,200);assert.equal(r.data.orders[0].total,129);
 assert.equal(JSON.stringify(r.data).includes('private-email'),false);
 assert.equal(r.data.orders[0].payment_status,'unpaid');
});
test('staff portal stays hidden when the operator terminal release flag is off',async()=>{
 const {request}=rig({terminal:false});const r=await request('GET','/operator',{cookie:''});
 assert.equal(r.status,404);
});

test('staff Catalog exposes sellable options but never supplier costs or private stock identifiers',()=>{
 const [product]=staffOrderCatalog([{id:10,source_kind:'marketplace_product',name:'Tea',selling_price:25,available:true,
  unit_cost:17,inventory_id:9,business_id:7,variants:[{id:2,variant_key:'large',price_override:30,in_stock:true,unit_cost:12}],
  modifier_groups:[{id:4,name:'Milk',min_select:0,max_select:1,options:[{id:5,name:'Oat milk',price_delta:3,private_cost:9}]}]}]);
 assert.equal(product.variants[0].price_override,30);
 assert.equal(product.modifier_groups[0].options[0].name,'Oat milk');
 assert.doesNotMatch(JSON.stringify(product),/unit_cost|inventory_id|private_cost|business_id/);
});