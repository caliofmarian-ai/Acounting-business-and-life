// #16: authenticated Merchant consent persistence against disposable CI PostgreSQL only.
// This test deliberately exercises existing HTTP routes, their real SQL writes and
// negative authorization. Never run it against Preview or Production.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import {readFileSync} from 'node:fs';

if(process.env.ABL_CONSENT_CI!=='1'||process.env.NODE_ENV!=='test'||
   process.env.PGDATABASE!=='abl_admin_ci'||process.env.PGHOST!=='127.0.0.1'||
   process.env.PAYMONGO_MODE!=='sandbox'){
  throw new Error('Merchant consent runtime requires the disposable Admin CI PostgreSQL environment.');
}
const pool=new pg.Pool();
let sessionId=null,productId=null,foreignBusinessId=null,foreignProductId=null,raceBusinessId=null;
let originalEmailVerifiedAt=null,emailVerifiedTouched=false;
let assertions=0;
const same=(actual,expected,message)=>{assert.equal(actual,expected,message);assertions++};
const request=async(path,{method='GET',body,token,ifNoneMatch}={})=>{
  const res=await fetch('http://127.0.0.1:3000'+path,{
    method,
    headers:{...(token?{Authorization:'Bearer '+token}:{}),
      ...(ifNoneMatch?{'If-None-Match':ifNoneMatch}:{}),
      ...(body===undefined?{}:{'Content-Type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  const payload=await res.json().catch(()=>({}));
  return {status:res.status,payload,
    cacheControl:res.headers.get('cache-control'),vary:res.headers.get('vary'),
    etag:res.headers.get('etag')};
};
const expect=async(path,options,status)=>{
  const result=await request(path,options);
  same(result.status,status,path+' status; response='+JSON.stringify(result.payload).slice(0,350));
  return result.payload;
};
const storeWrite=async(token,extra={})=>{
  let consentFields=extra;
  if(extra.price_comparison_enabled===true||extra.price_comparison_enabled==='true'){
    // Simulate the authorized Merchant form's current PostgreSQL row revision.
    const rev=await pool.query('SELECT xmin::text AS revision FROM merchant_storefronts WHERE business_id=1');
    consentFields={...extra,price_comparison_expected_version:rev.rows[0]?.revision||''};
  }
  return expect('/api/merchant/storefront',{
    method:'PUT',token,body:{
      business_id:1,store_name:'CI Price Consent Store',merchant_domain:'mixed',
      publication_status:'draft',...consentFields
    }},200);
};

async function verifyLegacyComparisonColumns(){
  // Execute the exact startup ALTER statements, not rewritten test-only SQL.
  // TEMP tables shadow public names on this dedicated CI connection. No
  // existing business, Inventory or merchant tables are touched by this drill.
  const startupSource=readFileSync(new URL('../server-marketplace.js',import.meta.url),'utf8');
  const upgrades=[
    'ALTER TABLE merchant_storefronts ADD COLUMN IF NOT EXISTS price_comparison_enabled BOOLEAN NOT NULL DEFAULT FALSE;',
    'ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS price_comparison_override BOOLEAN;'
  ];
  for(const statement of upgrades){
    same(startupSource.includes(statement),true,'startup contains tested legacy migration');
  }
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('SET LOCAL search_path = pg_temp');
    await client.query('CREATE TEMP TABLE merchant_storefronts(business_id BIGINT PRIMARY KEY,store_name TEXT NOT NULL) ON COMMIT DROP');
    await client.query('CREATE TEMP TABLE marketplace_products(id BIGINT PRIMARY KEY,business_id BIGINT NOT NULL) ON COMMIT DROP');
    await client.query("INSERT INTO merchant_storefronts(business_id,store_name) VALUES(998,'legacy')");
    await client.query('INSERT INTO marketplace_products(id,business_id) VALUES(898,998)');
    for(const statement of upgrades)await client.query(statement);
    let store=await client.query('SELECT price_comparison_enabled FROM merchant_storefronts WHERE business_id=998');
    let listing=await client.query('SELECT price_comparison_override FROM marketplace_products WHERE id=898');
    same(store.rows[0].price_comparison_enabled,false,'legacy Storefront remains comparison OFF');
    same(listing.rows[0].price_comparison_override,null,'legacy listing inherits default-OFF storefront');
    await client.query('UPDATE merchant_storefronts SET price_comparison_enabled=TRUE WHERE business_id=998');
    await client.query('UPDATE marketplace_products SET price_comparison_override=FALSE WHERE id=898');
    for(const statement of upgrades)await client.query(statement);
    store=await client.query('SELECT price_comparison_enabled FROM merchant_storefronts WHERE business_id=998');
    listing=await client.query('SELECT price_comparison_override FROM marketplace_products WHERE id=898');
    same(store.rows[0].price_comparison_enabled,true,'repeat startup preserves explicit storefront opt-in');
    same(listing.rows[0].price_comparison_override,false,'repeat startup preserves explicit listing opt-out');
    await client.query("INSERT INTO merchant_storefronts(business_id,store_name) VALUES(999,'new')");
    await client.query('INSERT INTO marketplace_products(id,business_id) VALUES(899,999)');
    store=await client.query('SELECT price_comparison_enabled FROM merchant_storefronts WHERE business_id=999');
    listing=await client.query('SELECT price_comparison_override FROM marketplace_products WHERE id=899');
    same(store.rows[0].price_comparison_enabled,false,'new Storefront remains comparison OFF');
    same(listing.rows[0].price_comparison_override,null,'new listing inherits default-OFF storefront');
  }finally{
    await client.query('ROLLBACK').catch(()=>{});
    client.release();
  }
}

try{
  const current=await pool.query('SELECT current_database() AS name');
  same(current.rows[0].name,'abl_admin_ci','isolated database only');
  await verifyLegacyComparisonColumns();
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

  const privateStorePath='/api/merchant/storefront?business_id=1&include_products=false';
  const unauthenticated=await request(privateStorePath);
  same(unauthenticated.status,401,'unauthenticated Merchant storefront remains denied');
  same(unauthenticated.cacheControl,'private, no-store, max-age=0',
    'even denied private storefront responses cannot be cached');
  const privateStore=await request(privateStorePath,{token});
  same(privateStore.status,200,'authorized private Merchant storefront GET');
  same(privateStore.cacheControl,'private, no-store, max-age=0',
    'private Merchant storefront consent and revision cannot be cached');
  const varyTokens=String(privateStore.vary||'').toLowerCase().split(',').map(value=>value.trim());
  same(varyTokens.includes('cookie'),true,'private storefront varies by browser session cookie');
  same(varyTokens.includes('authorization'),true,'private storefront varies by bearer authorization');
  same(typeof privateStore.payload.comparison_version,'string','private consent revision is returned');
  if(privateStore.etag){
    const conditional=await request(privateStorePath,{token,ifNoneMatch:privateStore.etag});
    same(conditional.status,200,'private storefront never reuses an ETag 304 response');
    same(conditional.cacheControl,'private, no-store, max-age=0','conditional private GET stays no-store');
  }

  // Two or more concurrent authorized first-open reads of a NEW disposable
  // Merchant workspace must all converge on one default-OFF storefront. Before
  // the fix, both can SELECT an absent row and one plain INSERT gets 23505.
  raceBusinessId=Number((await pool.query(
    "INSERT INTO businesses(name,country_code,currency_code) VALUES($1,'PH','PHP') RETURNING id",
    ['CI Concurrent Store '+crypto.randomBytes(6).toString('hex')])).rows[0].id);
  await pool.query(
    "INSERT INTO business_memberships(business_id,account_id,membership_role,active) VALUES($1,1,'owner',TRUE)",
    [raceBusinessId]);
  await pool.query(
    "INSERT INTO profile_business_bindings(account_id,role,business_id,status,is_primary) VALUES(1,'merchant',$1,'active',FALSE)",
    [raceBusinessId]);
  const racePath='/api/merchant/storefront?business_id='+raceBusinessId+'&include_products=false';
  const freshReads=await Promise.all(Array.from({length:6},()=>request(racePath,{token})));
  for(const reply of freshReads){
    same(reply.status,200,'concurrent first-open private storefront GET must succeed');
    same(Number(reply.payload.business_id),raceBusinessId,'first-open result stays in authorized workspace');
    same(reply.payload.price_comparison_enabled,false,'new Merchant never automatically opts into comparison');
  }
  const bootstrap=await pool.query(
    'SELECT COUNT(*)::int AS count,BOOL_AND(price_comparison_enabled=FALSE) AS disabled FROM merchant_storefronts WHERE business_id=$1',
    [raceBusinessId]);
  same(bootstrap.rows[0].count,1,'only one storefront row is created under concurrent first-open reads');
  same(bootstrap.rows[0].disabled,true,'concurrent bootstrap retains consent OFF');

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

  const staleStoreRevision=(await pool.query(
    'SELECT xmin::text AS revision FROM merchant_storefronts WHERE business_id=1')).rows[0].revision;
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
  // A stale explicit opt-in is different from an omitted unrelated edit.
  await expect('/api/merchant/storefront',{method:'PUT',token,body:{
    business_id:1,store_name:'CI Price Consent Store',merchant_domain:'mixed',
    publication_status:'draft',price_comparison_enabled:true,
    price_comparison_expected_version:staleStoreRevision
  }},409);
  row=await pool.query('SELECT price_comparison_enabled FROM merchant_storefronts WHERE business_id=1');
  same(row.rows[0].price_comparison_enabled,false,'stale explicit storefront ON cannot reverse revoked OFF');
  await expect('/api/merchant/storefront',{method:'PUT',token,body:{
    business_id:1,store_name:'CI Price Consent Store',merchant_domain:'mixed',
    publication_status:'draft',price_comparison_enabled:true
  }},409);
  row=await pool.query('SELECT price_comparison_enabled FROM merchant_storefronts WHERE business_id=1');
  same(row.rows[0].price_comparison_enabled,false,'missing revision cannot opt in a storefront');
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

  const staleProductRevision=(await pool.query(
    'SELECT xmin::text AS revision FROM marketplace_products WHERE id=$1',[productId])).rows[0].revision;
  product=await expect('/api/merchant/storefront/products/'+productId,{
    method:'PATCH',token,body:{price_comparison_override:true,
      price_comparison_expected_version:staleProductRevision}},200);
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
        "AND query LIKE '%FROM marketplace_products WHERE id=%FOR UPDATE%'"
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
  await expect('/api/merchant/storefront/products/'+productId,{
    method:'PATCH',token,body:{price_comparison_override:true,
      price_comparison_expected_version:staleProductRevision}},409);
  row=await pool.query('SELECT price_comparison_override FROM marketplace_products WHERE id=$1',[productId]);
  same(row.rows[0].price_comparison_override,false,'stale explicit listing ON cannot re-enable revoked listing');
  await expect('/api/merchant/storefront/products/'+productId,{
    method:'PATCH',token,body:{price_comparison_override:true}},409);
  row=await pool.query('SELECT price_comparison_override FROM marketplace_products WHERE id=$1',[productId]);
  same(row.rows[0].price_comparison_override,false,'missing revision cannot opt in a listing');
  product=await expect('/api/merchant/storefront/products/'+productId,{
    method:'PATCH',token,body:{price_comparison_override:'false'}},200);
  same(product.price_comparison_override,false,'listing revocation persisted');
  const freshProductRevision=(await pool.query(
    'SELECT xmin::text AS revision FROM marketplace_products WHERE id=$1',[productId])).rows[0].revision;
  product=await expect('/api/merchant/storefront/products/'+productId,{
    method:'PATCH',token,body:{price_comparison_override:null,
      price_comparison_expected_version:freshProductRevision}},200);
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
  // Hold a real PostgreSQL row lock on a foreign Merchant's private listing.
  // A denied authenticated PATCH must return 403 while that lock is STILL held;
  // locking first would block this HTTP response until the transaction ends.
  const foreignLock=await pool.connect();
  try{
    await foreignLock.query('BEGIN');
    await foreignLock.query('SELECT id FROM marketplace_products WHERE id=$1 FOR UPDATE',[foreignProductId]);
    let deadline;
    try{
      const denial=await Promise.race([
        request('/api/merchant/storefront/products/'+foreignProductId,{
          method:'PATCH',token,body:{price_comparison_override:true}
        }),
        new Promise((_,reject)=>{
          deadline=setTimeout(()=>reject(new Error('Unauthorized PATCH waited on a foreign product row lock')),8000);
        })
      ]);
      same(denial.status,403,'unauthorized Merchant PATCH must be rejected before the foreign row lock');
    }finally{clearTimeout(deadline)}
  }finally{
    await foreignLock.query('ROLLBACK').catch(()=>{});
    foreignLock.release();
  }
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
  try{if(raceBusinessId)await pool.query('DELETE FROM businesses WHERE id=$1',[raceBusinessId]);}catch{}
  try{if(sessionId)await pool.query('DELETE FROM account_sessions WHERE session_id=$1',[sessionId]);}catch{}
  try{if(emailVerifiedTouched)await pool.query('UPDATE accounts SET email_verified_at=$1 WHERE id=1',[originalEmailVerifiedAt]);}catch{}
  await pool.end();
}
