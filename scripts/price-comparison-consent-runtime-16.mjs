// #16: authenticated Merchant consent persistence against disposable CI PostgreSQL only.
// This test deliberately exercises existing HTTP routes, their real SQL writes and
// negative authorization. Never run it against Preview or Production.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';

if(process.env.ABL_CONSENT_CI!=='1'||process.env.NODE_ENV!=='test'||
   process.env.PGDATABASE!=='abl_admin_ci'||process.env.PGHOST!=='127.0.0.1'||
   process.env.PAYMONGO_MODE!=='sandbox'){
  throw new Error('Merchant consent runtime requires the disposable Admin CI PostgreSQL environment.');
}
const pool=new pg.Pool();
let sessionId=null,productId=null,foreignBusinessId=null;
let assertions=0;
const same=(actual,expected,message)=>{assert.equal(actual,expected,message);assertions++};
const request=async(path,{method='GET',body,token}={})=>{
  const res=await fetch('http://127.0.0.1:3000'+path,{
    method,
    headers:{...(token?{Authorization:'Bearer '+token}:{}),
      ...(body===undefined?{}:{'Content-Type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  const payload=await res.json().catch(()=>({}));
  return {status:res.status,payload};
};
const expect=async(path,options,status)=>{
  const result=await request(path,options);
  same(result.status,status,path+' status; response='+JSON.stringify(result.payload).slice(0,350));
  return result.payload;
};
const storeWrite=(token,extra={})=>expect('/api/merchant/storefront',{
  method:'PUT',token,body:{
    business_id:1,store_name:'CI Price Consent Store',merchant_domain:'mixed',
    publication_status:'draft',...extra
  }},200);
try{
  const current=await pool.query('SELECT current_database() AS name');
  same(current.rows[0].name,'abl_admin_ci','isolated database only');
  const merchant=await pool.query(
    "SELECT 1 FROM profile_business_bindings WHERE account_id=1 AND role='merchant' AND business_id=1 AND status='active'");
  same(merchant.rowCount,1,'preexisting isolated Merchant fixture must be bound');

  sessionId='ci-price-consent-'+crypto.randomBytes(12).toString('hex');
  await pool.query(
    "INSERT INTO account_sessions(session_id,account_id,expires_at,user_agent,ip_hash) VALUES($1,1,NOW()+INTERVAL '30 minutes','ci-price-consent','synthetic')",
    [sessionId]);
  const raw=['v2',Date.now(),'1',sessionId].join('.');
  const token=raw+'.'+crypto.createHmac('sha256',process.env.TOKEN_SECRET).update(raw).digest('hex');

  await expect('/api/merchant/storefront?business_id=1&include_products=false',{},401);
  await expect('/api/merchant/storefront?business_id=1&include_products=false',{token},200);

  let stored=await storeWrite(token,{price_comparison_enabled:true});
  same(stored.price_comparison_enabled,true,'explicit storefront opt-in persisted');
  stored=await storeWrite(token,{description:'Unrelated update; no comparison field'});
  same(stored.price_comparison_enabled,true,'unrelated update must preserve opt-in');
  let row=await pool.query('SELECT price_comparison_enabled FROM merchant_storefronts WHERE business_id=1');
  same(row.rows[0].price_comparison_enabled,true,'real PostgreSQL consent after omitted field');

  stored=await storeWrite(token,{price_comparison_enabled:'false'});
  same(stored.price_comparison_enabled,false,'string false must revoke, not opt in');
  row=await pool.query('SELECT price_comparison_enabled FROM merchant_storefronts WHERE business_id=1');
  same(row.rows[0].price_comparison_enabled,false,'revocation committed to PostgreSQL');
  await expect('/api/merchant/storefront',{
    method:'PUT',token,body:{business_id:1,store_name:'CI Price Consent Store',
      merchant_domain:'mixed',publication_status:'draft',price_comparison_enabled:'off'}},400);
  row=await pool.query('SELECT price_comparison_enabled FROM merchant_storefronts WHERE business_id=1');
  same(row.rows[0].price_comparison_enabled,false,'invalid choice must not mutate consent');

  const marker='ci-price-consent-'+crypto.randomBytes(8).toString('hex');
  let product=await expect('/api/merchant/storefront/products',{
    method:'POST',token,body:{business_id:1,name:marker,product_kind:'prepared_food',
      category:'CI private fixture',selling_price:12.50,published:false,
      price_comparison_override:'false'}},201);
  productId=Number(product.id);
  assert.ok(Number.isSafeInteger(productId)&&productId>0,'created synthetic product id');
  same(product.price_comparison_override,false,'private product explicitly excluded');
  same(product.published,false,'comparison setting cannot publish product');

  product=await expect('/api/merchant/storefront/products/'+productId,{
    method:'PATCH',token,body:{price_comparison_override:true}},200);
  same(product.price_comparison_override,true,'listing explicitly opted in');
  product=await expect('/api/merchant/storefront/products/'+productId,{
    method:'PATCH',token,body:{name:marker+'-edited'}},200);
  same(product.price_comparison_override,true,'unrelated product edit preserves opt-in');
  product=await expect('/api/merchant/storefront/products/'+productId,{
    method:'PATCH',token,body:{price_comparison_override:'false'}},200);
  same(product.price_comparison_override,false,'listing revocation persisted');
  product=await expect('/api/merchant/storefront/products/'+productId,{
    method:'PATCH',token,body:{price_comparison_override:null}},200);
  same(product.price_comparison_override,null,'listing returns to inherited consent');
  await expect('/api/merchant/storefront/products/'+productId,{
    method:'PATCH',token,body:{price_comparison_override:'off'}},400);
  row=await pool.query('SELECT published,price_comparison_override FROM marketplace_products WHERE id=$1',[productId]);
  same(row.rows[0].price_comparison_override,null,'invalid listing input cannot re-enable consent');
  same(row.rows[0].published,false,'listing remains private throughout tests');

  foreignBusinessId=Number((await pool.query(
    "INSERT INTO businesses(name,country_code,currency_code) VALUES($1,'PH','PHP') RETURNING id",
    ['CI Unbound Comparison '+marker])).rows[0].id);
  await expect('/api/merchant/storefront?business_id='+foreignBusinessId+'&include_products=false',
    {token},403);
  await expect('/api/merchant/storefront',{method:'PUT',token,body:{
    business_id:foreignBusinessId,store_name:'Attempted foreign store',publication_status:'draft',
    price_comparison_enabled:true}},403);
  row=await pool.query('SELECT COUNT(*)::int AS count FROM merchant_storefronts WHERE business_id=$1',[foreignBusinessId]);
  same(row.rows[0].count,0,'foreign business storefront cannot be written');
  console.log('Price Comparison #16: authenticated HTTP + actual isolated PostgreSQL PASS; assertions='+assertions);
}finally{
  try{if(productId)await pool.query('DELETE FROM marketplace_products WHERE id=$1 AND business_id=1',[productId]);}catch{}
  try{if(foreignBusinessId)await pool.query('DELETE FROM businesses WHERE id=$1',[foreignBusinessId]);}catch{}
  try{if(sessionId)await pool.query('DELETE FROM account_sessions WHERE session_id=$1',[sessionId]);}catch{}
  await pool.end();
}
