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
let sessionId=null,productId=null,foreignBusinessId=null,foreignProductId=null;
let originalEmailVerifiedAt=null,emailVerifiedTouched=false;
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
  // The CI bootstrap owner has no verified email. Authenticate a disposable
  // *synthetic* fixture without weakening any app verification guard.
  const syntheticAccount=await pool.query('SELECT email_verified_at FROM accounts WHERE id=1');
  same(syntheticAccount.rowCount,1,'isolated seeded account must exist');
  originalEmailVerifiedAt=syntheticAccount.rows[0].email_verified_at;
  await pool.query('UPDATE accounts SET email_verified_at=NOW() WHERE id=1');
  emailVerifiedTouched=true;

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

  // Emulate an old Storefront save already in flight while the Merchant revokes
  // comparison consent. Both HTTP requests read the old TRUE row before their
  // UPSERTs can acquire the lock; the later unrelated save must not opt back in.
  stored=await storeWrite(token,{price_comparison_enabled:true});
  same(stored.price_comparison_enabled,true,'concurrent revocation starts from opt-in');
  const lock=await pool.connect();
  let revocationPending,staleSavePending;
  const waitForBlockedUpserts=async minimum=>{
    const deadline=Date.now()+10000;
    while(Date.now()<deadline){
      const waiting=await pool.query(`
        SELECT COUNT(*)::int AS blocked FROM pg_stat_activity
        WHERE datname=current_database() AND pid<>pg_backend_pid()
          AND state='active' AND wait_event_type='Lock'
          AND query LIKE '%INSERT INTO merchant_storefronts%'
      `);
      if(Number(waiting.rows[0].blocked)>=minimum)return;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw new Error('Expected '+minimum+' HTTP storefront UPSERTs waiting on the real row lock.');
  };
  try{
    await lock.query('BEGIN');
    await lock.query('SELECT business_id FROM merchant_storefronts WHERE business_id=1 FOR UPDATE');
    revocationPending=storeWrite(token,{price_comparison_enabled:false});
    await waitForBlockedUpserts(1);
    staleSavePending=storeWrite(token,{description:'Stale save begun before consent revocation commits'});
    await waitForBlockedUpserts(2);
  }finally{
    await lock.query('ROLLBACK').catch(()=>{});
    lock.release();
  }
  const [revokeResult,staleSaveResult]=await Promise.all([revocationPending,staleSavePending]);
  same(revokeResult.price_comparison_enabled,false,'first queued HTTP request revokes consent');
  same(staleSaveResult.price_comparison_enabled,false,'later stale form update must preserve revocation');
  row=await pool.query('SELECT price_comparison_enabled FROM merchant_storefronts WHERE business_id=1');
  same(row.rows[0].price_comparison_enabled,false,'real PostgreSQL consent stays OFF after concurrent stale save');
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
  // A stale, unrelated product edit must not re-enable comparison after
  // an explicit listing revocation. Verify with two real HTTP PATCH requests
  // observed blocked behind the same PostgreSQL row lock (not a fake DB).
  const productLock=await pool.connect();
  let productRevocationPending,staleProductSavePending;
  const waitForBlockedProductLocks=async minimum=>{
    const deadline=Date.now()+10000;
    while(Date.now()<deadline){
      const waiting=await pool.query(
        "SELECT COUNT(*)::int AS blocked FROM pg_stat_activity " +
        "WHERE datname=current_database() AND pid<>pg_backend_pid() " +
        "AND state='active' AND wait_event_type='Lock' " +
        "AND query LIKE '%SELECT * FROM marketplace_products WHERE id=%FOR UPDATE%'"
      );
      if(Number(waiting.rows[0].blocked)>=minimum)return;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw new Error('Expected '+minimum+' HTTP product row-lock waiters.');
  };
  try{
    await productLock.query('BEGIN');
    await productLock.query('SELECT id FROM marketplace_products WHERE id=$1 FOR UPDATE',[productId]);
    productRevocationPending=expect('/api/merchant/storefront/products/'+productId,{
      method:'PATCH',token,body:{price_comparison_override:false}},200);
    await waitForBlockedProductLocks(1);
    staleProductSavePending=expect('/api/merchant/storefront/products/'+productId,{
      method:'PATCH',token,body:{description:'Unrelated stale listing edit after revocation'}},200);
    await waitForBlockedProductLocks(2);
  }finally{
    await productLock.query('ROLLBACK').catch(()=>{});
    productLock.release();
  }
  const [revokedListing,staleListing]=await Promise.all([productRevocationPending,staleProductSavePending]);
  same(revokedListing.price_comparison_override,false,'queued listing revocation committed');
  same(staleListing.price_comparison_override,false,'later stale listing edit preserved revocation');
  row=await pool.query('SELECT price_comparison_override FROM marketplace_products WHERE id=$1',[productId]);
  same(row.rows[0].price_comparison_override,false,'PostgreSQL listing consent stays OFF after concurrent stale PATCH');
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
  await expect('/api/merchant/storefront/products/'+productId,{
    method:'PATCH',body:{price_comparison_override:true}},401);
  row=await pool.query('SELECT price_comparison_override FROM marketplace_products WHERE id=$1',[productId]);
  same(row.rows[0].price_comparison_override,null,'unauthenticated PATCH cannot alter listing consent');

  foreignBusinessId=Number((await pool.query(
    "INSERT INTO businesses(name,country_code,currency_code) VALUES($1,'PH','PHP') RETURNING id",
    ['CI Unbound Comparison '+marker])).rows[0].id);
  // The foreign listing is intentionally private. Its consent and publication
  // must remain untouched even when another authenticated Merchant knows its ID.
  foreignProductId=Number((await pool.query(
    "INSERT INTO marketplace_products(business_id,name,product_domain,product_kind,selling_price,published,price_comparison_override) VALUES($1,$2,'food','prepared_food',19.75,FALSE,FALSE) RETURNING id",
    [foreignBusinessId,marker+'-foreign'])).rows[0].id);
  same(Number.isSafeInteger(foreignProductId)&&foreignProductId>0,true,'synthetic foreign listing exists');
  await expect('/api/merchant/storefront/products/'+foreignProductId,{
    method:'PATCH',token,body:{price_comparison_override:true}},403);
  await expect('/api/merchant/storefront/products/'+foreignProductId,{
    method:'PATCH',body:{price_comparison_override:true}},401);
  await expect('/api/merchant/storefront/products',{
    method:'POST',token,body:{business_id:foreignBusinessId,name:marker+'-forged',
      product_kind:'prepared_food',selling_price:11,price_comparison_override:true}},403);
  row=await pool.query('SELECT price_comparison_override,published FROM marketplace_products WHERE id=$1',[foreignProductId]);
  same(row.rows[0].price_comparison_override,false,'foreign listing consent unchanged');
  same(row.rows[0].published,false,'foreign listing remains private');
  row=await pool.query('SELECT COUNT(*)::int AS count FROM marketplace_products WHERE business_id=$1',[foreignBusinessId]);
  same(row.rows[0].count,1,'forged product create cannot add a foreign listing');
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
  try{if(foreignProductId)await pool.query('DELETE FROM marketplace_products WHERE id=$1',[foreignProductId]);}catch{}
  try{if(foreignBusinessId)await pool.query('DELETE FROM businesses WHERE id=$1',[foreignBusinessId]);}catch{}
  try{if(sessionId)await pool.query('DELETE FROM account_sessions WHERE session_id=$1',[sessionId]);}catch{}
  try{if(emailVerifiedTouched)await pool.query('UPDATE accounts SET email_verified_at=$1 WHERE id=1',[originalEmailVerifiedAt]);}catch{}
  await pool.end();
}
