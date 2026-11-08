// #16 opt-in-only price comparison: actual authenticated Preview HTTP+PG.
// All changes are restricted to disposable businesses owned by a pre-existing
// company_test Merchant. No product publication, payment or real-user data.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
export const PRICE_COMPARISON_16_WAVE='price_comparison_16';
export async function runPriceComparison16Acceptance({pool,base,secret,aliases,helpers}){
  const {requestJson,qaAccountSession,ensureActiveRole}=helpers;
  const marker='QA 16 '+crypto.randomUUID(), ids=[];
  const merchant=await qaAccountSession({pool,base,secret,email:aliases.merchant,role:'merchant',label:'Price 16 Merchant QA'});
  const customer=await qaAccountSession({pool,base,secret,email:aliases.customer,role:'customer',label:'Price 16 foreign-account QA'});
  let original,problem=null,checks=0,removed=false;
  const eq=(a,b,m)=>{assert.equal(a,b,'Price 16: '+m);checks++};
  const ok=(p,m)=>{assert.ok(p,'Price 16: '+m);checks++};
  const call=(token,path,options={})=>requestJson(base,path,{...(token?{token}:{}),...options});
  const select=id=>pool.query("INSERT INTO account_business_preferences(account_id,role,business_id) VALUES($1,'merchant',$2) ON CONFLICT(account_id,role) DO UPDATE SET business_id=EXCLUDED.business_id",[merchant.accountId,id]);
  const get=id=>call(merchant.token,'/api/merchant/storefront?business_id='+id+'&include_products=false');
  const put=(id,extra={})=>call(merchant.token,'/api/merchant/storefront',{method:'PUT',body:{
    business_id:id,store_name:marker+' store',merchant_domain:'non_food',publication_status:'draft',...extra
  }});
  try{
    for(const session of [[merchant,'merchant'],[customer,'customer']]){
      const me=await call(session[0].token,'/api/me');
      eq(me.status,200,'classified login '+session[1]);
      eq(me.json?.account?.account_mode,'company_test','company_test only '+session[1]);
      eq(me.json?.account?.test_role,session[1],'role '+session[1]);
    }
    await ensureActiveRole({base,token:merchant.token,role:'merchant',label:'Price 16 Merchant QA'});
    await ensureActiveRole({base,token:customer.token,role:'customer',label:'Price 16 Customer QA'});
    original=await pool.query("SELECT business_id FROM account_business_preferences WHERE account_id=$1 AND role='merchant'",[merchant.accountId]);
    for(const suffix of ['A','B']){
      const r=await pool.query("INSERT INTO businesses(name,country_code,currency_code) VALUES($1,'PH','PHP') RETURNING id",[marker+' '+suffix]);
      const id=Number(r.rows[0].id);ids.push(id);
      await pool.query("INSERT INTO business_memberships(business_id,account_id,membership_role,active) VALUES($1,$2,'owner',TRUE)",[id,merchant.accountId]);
      await pool.query("INSERT INTO profile_business_bindings(account_id,role,business_id,status,is_primary) VALUES($1,'merchant',$2,'active',FALSE)",[merchant.accountId,id]);
    }
    const [a,b]=ids;
    await select(a);
    const first=await get(a);
    eq(first.status,200,'private A initialized');
    eq(first.json?.price_comparison_enabled,false,'new A defaults OFF');
    ok(/^\d+$/.test(String(first.json?.comparison_version||'')),'authorized revision returned');
    eq((await call(null,'/api/merchant/storefront?business_id='+a)).status,401,'guest private GET denied');
    const foreign=await call(customer.token,'/api/merchant/storefront?business_id='+a);
    ok([401,403,404].includes(foreign.status),'foreign customer denied');
    const missingRevision=await put(a,{price_comparison_enabled:true});
    eq(missingRevision.status,409,'enabling without observed revision denied');
    const initialVersion=String(first.json.comparison_version);
    const on=await put(a,{price_comparison_enabled:true,price_comparison_expected_version:initialVersion});
    eq(on.status,200,'explicit A opt-in');
    eq(on.json?.price_comparison_enabled,true,'A opt-in persisted');
    const onGet=await get(a);
    eq(onGet.status,200,'re-read opted-in A');
    eq(onGet.json?.price_comparison_enabled,true,'A opt-in retained in private GET');
    eq((await put(a,{description:'Unrelated form save must not retoggle'})).status,200,'unrelated A form save');
    eq((await get(a)).json?.price_comparison_enabled,true,'unrelated save preserves opt-in');
    const off=await put(a,{price_comparison_enabled:false});
    eq(off.status,200,'explicit A withdrawal');
    eq(off.json?.price_comparison_enabled,false,'withdrawal persisted');
    const stale=await put(a,{price_comparison_enabled:true,price_comparison_expected_version:initialVersion});
    eq(stale.status,409,'old-tab stale reenrollment rejected');
    eq((await get(a)).json?.price_comparison_enabled,false,'stale tab cannot re-enable');
    await select(b);
    const second=await get(b);
    eq(second.status,200,'private B initialized after business switch');
    eq(second.json?.price_comparison_enabled,false,'B remains opt-out by default');
    eq(Number(second.json?.business_id),b,'B response origin bound');
    await select(a);
    eq((await get(a)).json?.price_comparison_enabled,false,'A remains withdrawn after switching');
    const deniedWrite=await call(customer.token,'/api/merchant/storefront',{method:'PUT',body:{
      business_id:a,store_name:'foreign',price_comparison_enabled:true,
      price_comparison_expected_version:initialVersion}});
    ok([401,403,404].includes(deniedWrite.status),'foreign write fails closed');
    const publicDraft=await call(null,'/api/public/marketplace/storefronts/'+a);
    eq(publicDraft.status,404,'draft A not exposed as public listing');
    const db=await pool.query('SELECT business_id,price_comparison_enabled FROM merchant_storefronts WHERE business_id=ANY($1::bigint[]) ORDER BY business_id',[ids]);
    eq(db.rowCount,2,'two synthetic stores only');
    ok(db.rows.every(x=>x.price_comparison_enabled===false),'both database opt-outs persisted');
    const ui=await fetch(base+'/marketplace-ui.js',{signal:AbortSignal.timeout(15000)});
    eq(ui.status,200,'actual served Merchant price comparison UI');
    const asset=await ui.text();
    ok(asset.includes('comparisonConsentChanged')&&asset.includes('price_comparison_expected_version'),'served UI keeps explicit consent/revision guard');
  }catch(error){problem=error}
  finally{
    try{
      if(original?.rowCount)await select(original.rows[0].business_id);
      else await pool.query("DELETE FROM account_business_preferences WHERE account_id=$1 AND role='merchant'",[merchant.accountId]);
      for(const id of ids){
        const owned=await pool.query('SELECT name FROM businesses WHERE id=$1',[id]);
        if(!owned.rows[0]?.name?.startsWith(marker+' '))throw new Error('QA 16 cleanup origin mismatch');
        await pool.query('DELETE FROM merchant_storefronts WHERE business_id=$1',[id]);
        await pool.query('DELETE FROM profile_business_bindings WHERE account_id=$1 AND role=\'merchant\' AND business_id=$2',[merchant.accountId,id]);
        await pool.query('DELETE FROM business_memberships WHERE business_id=$1 AND account_id=$2',[id,merchant.accountId]);
        await pool.query('DELETE FROM businesses WHERE id=$1',[id]);
      }
      removed=true;
    }catch(e){problem=new Error('QA 16 cleanup failed'+(problem?' after test failure':''),{cause:e})}
    for(const session of [merchant,customer]){
      try{await call(session.token,'/api/auth/logout',{method:'POST',body:{}})}
      catch(e){if(!problem)problem=e}
    }
  }
  if(problem)throw problem;
  return{status:'PASS',wave:PRICE_COMPARISON_16_WAVE,checks,authenticated_http:true,
    company_test_only:true,consent_default_off:true,stale_reenable_denied:true,
    foreign_write_denied:true,public_draft_hidden:true,fixtures_removed:removed};
}
