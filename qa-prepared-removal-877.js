import assert from 'node:assert/strict';
import crypto from 'node:crypto';

export const PREPARED_REMOVAL_877_WAVE='prepared_removal_877';

// This runner is dispatched only by the gated, isolated Preview QA boot.
// It never operates on a real Merchant, business or Production database.
export async function runPreparedRemoval877Acceptance({pool,base,secret,aliases,helpers}){
  const {qaAccountSession,requestJson,expectStatus,ensureActiveRole}=helpers;
  const merchant=await qaAccountSession({pool,base,secret,email:aliases.merchant,role:'merchant',label:'Prepared removal 877 Merchant QA'});
  const marker=crypto.randomUUID(), businesses=[];
  let original=null,checks=0,error=null;
  const check=(condition,message)=>{assert.ok(condition,'Prepared removal QA: '+message);checks++};
  const exact=(actual,wanted,message)=>{assert.equal(actual,wanted,'Prepared removal QA: '+message);checks++};
  const call=async(path,options={})=>requestJson(base,path,{token:merchant.token,...options});
  const post=async(path,body,headers={})=>call(path,{method:'POST',body,headers});
  const qty=async(inventoryId)=>{
    const r=await pool.query('SELECT quantity::text FROM inventory WHERE id=$1',[inventoryId]);
    return Number(r.rows[0]?.quantity);
  };
  const lotQty=async(inventoryId)=>{
    const r=await pool.query('SELECT COALESCE(SUM(quantity_remaining_base),0)::text n FROM supply_lots WHERE inventory_id=$1',[inventoryId]);
    return Number(r.rows[0]?.n);
  };
  const count=async(table,businessId)=>{
    const r=await pool.query('SELECT COUNT(*)::int n FROM '+table+' WHERE business_id=$1',[businessId]);
    return r.rows[0].n;
  };
  const switchTo=async id=>{
    await pool.query("INSERT INTO account_business_preferences(account_id,role,business_id) VALUES($1,'merchant',$2) ON CONFLICT(account_id,role) DO UPDATE SET business_id=EXCLUDED.business_id",[merchant.accountId,id]);
  };
  const purchase=async(businessId,label,quantity,total)=>{
    const result=await post('/api/inventory/purchase',{
      item:'QA877 '+marker+' '+label,purchase_quantity:quantity,purchase_unit:'g',
      total_cost:total,inventory_type:'ingredient',inventory_domain:'food',stock_role:'ingredient',
      storage_condition:'dry',storage_area_type:'pantry',
      account:'cash',record_expense:false,note:'Isolated QA purchase, not a real purchase'
    },{'x-abl-inventory-origin-business':String(businessId)});
    exact(result.status,201,'controlled isolated stock purchase');
    exact(Number(result.json?.inventory?.business_id),businessId,'stock business');
    return Number(result.json.inventory.id);
  };
  const product=async(name,stockId,perPortion,batch)=>{
    const created=await post('/api/products',{name:'QA877 '+marker+' '+name,category:'Controlled QA',
      product_kind:'prepared_recipe',selling_price:80,active:true});
    exact(created.status,201,'prepared product creation');
    const id=Number(created.json.id);
    const recipe=await call('/api/products/'+id+'/recipe-batch',{method:'PUT',body:{
      yield_quantity:batch,yield_unit:'g',selling_quantity:1,selling_unit:'g',
      components:[{inventory_id:stockId,quantity:batch*perPortion,unit:'g'}]
    }});
    exact(recipe.status,200,'saved recipe batch');
    exact(Number(recipe.json?.recipe_batch?.sale_units_per_batch),batch,'recipe batch yield');
    return id;
  };
  let cleared=false;
  try{
    const me=await call('/api/me');
    exact(me.status,200,'authenticated Merchant identity');
    check(me.json?.account?.account_mode==='company_test'&&me.json?.account?.test_role==='merchant',
      'only the existing classified Merchant company_test account is allowed');
    await ensureActiveRole({base,token:merchant.token,role:'merchant',label:'Prepared removal 877 Merchant'});
    original=await pool.query("SELECT business_id FROM account_business_preferences WHERE account_id=$1 AND role='merchant'",[merchant.accountId]);
    for(const suffix of ['A','B']){
      const r=await pool.query("INSERT INTO businesses(name,country_code,currency_code) VALUES($1,'PH','PHP') RETURNING id",['QA 877 '+marker+' '+suffix]);
      const id=Number(r.rows[0].id);businesses.push(id);
      await pool.query("INSERT INTO business_memberships(business_id,account_id,membership_role,active) VALUES($1,$2,'owner',TRUE)",[id,merchant.accountId]);
      await pool.query("INSERT INTO profile_business_bindings(account_id,role,business_id,status,is_primary) VALUES($1,'merchant',$2,'active',FALSE)",[merchant.accountId,id]);
    }
    const [a,b]=businesses;await switchTo(a);
    const stock=await purchase(a,'recipe',11,752.62);
    const p=await product('Eleven portions',stock,1,11);
    const sale=await post('/api/product-sales',{product_id:p,quantity:9,account:'cash',note:'Controlled QA nine portions, not a real sale'});
    exact(sale.status,201,'nine portions recorded as one controlled sales entry');
    exact(Number(sale.json.quantity),9,'sales quantity');
    exact(Number(sale.json.revenue),720,'sales revenue');
    exact(await qty(stock),2,'stock after nine sold');
    exact(await lotQty(stock),2,'lot after nine sold');
    const moneyBefore=await count('transactions',a),saleCount=await count('product_sales',a);
    const owner={business_id:a,product_id:p,quantity:2,reason:'owner_consumption',
      idempotency_key:'qa877owner_'+marker.replaceAll('-',''),note:'Controlled QA owner-use truth'};
    const first=await post('/api/prepared-product-removals',owner);
    exact(first.status,201,'owner consumption HTTP');
    exact(first.json?.removal?.accounting_treatment,'noncash_owner_draw','owner use is not waste');
    exact(Number(first.json?.removal?.estimated_cost),136.84,'two portions have PHP 136.84 cost');
    exact(await qty(stock),0,'one-time final two portions stock use');
    exact(await lotQty(stock),0,'one-time FEFO lots');
    exact(await count('transactions',a),moneyBefore,'no cash transaction created by owner use');
    exact(await count('product_sales',a),saleCount,'owner use does not fake a sale');
    const replay=await post('/api/prepared-product-removals',owner);
    exact(replay.status,200,'same-key replay HTTP');
    check(replay.json?.already_recorded===true,'same-key replay must be read only');
    exact(Number(replay.json?.removal?.id),Number(first.json?.removal?.id),'same durable removal record');
    exact(await qty(stock),0,'replay cannot deduct stock twice');
    exact((await post('/api/prepared-product-removals',{...owner,quantity:1})).status,409,'conflicting key is refused');
    exact((await post('/api/prepared-product-removals',{...owner,idempotency_key:'qa877short_'+marker.replaceAll('-','')})).status,409,'real insufficient usable stock rolls back');
    exact(await count('prepared_product_removals',a),1,'rollback and replay do not add records');
    await switchTo(b);
    exact((await post('/api/prepared-product-removals',{...owner,idempotency_key:'qa877foreign_'+marker.replaceAll('-','')})).status,409,
      'stale A authority while B selected is refused');
    const guest=await requestJson(base,'/api/prepared-product-removals',{method:'POST',body:owner});
    exact(guest.status,401,'guest cannot post noncash stock');
    const historyB=await call('/api/prepared-product-removals');
    exact(historyB.status,200,'other Merchant business read');
    exact(historyB.json?.entries?.length,0,'other business has no private removals');
    await switchTo(a);
    const stockQuality=await purchase(a,'quality',2,8.04);
    const pQuality=await product('Quality rejected',stockQuality,1,2);
    const quality={business_id:a,product_id:pQuality,quantity:1,reason:'quality_rejected',
      idempotency_key:'qa877quality_'+marker.replaceAll('-',''),note:'Controlled QA quality rejection'};
    const loss=await post('/api/prepared-product-removals',quality);
    exact(loss.status,201,'quality rejection HTTP');
    exact(loss.json?.removal?.accounting_treatment,'noncash_product_loss','quality rejection is noncash product loss');
    exact(Number(loss.json?.removal?.estimated_cost),4.02,'exact quality loss cost');
    exact(await qty(stockQuality),1,'quality loss reduces separate ingredient exactly once');
    exact(await lotQty(stockQuality),1,'quality loss lot matches stock');
    const history=await call('/api/prepared-product-removals');
    exact(history.status,200,'Merchant own history');
    check(history.json?.entries?.some(x=>Number(x.id)===Number(first.json?.removal?.id)&&x.removal_reason==='owner_consumption'),
      'owner removal history appears beside the sale history');
    check(history.json?.entries?.some(x=>Number(x.id)===Number(loss.json?.removal?.id)&&x.removal_reason==='quality_rejected'),
      'quality loss history is separate');
    check(history.json?.summary_30d?.some(x=>x.removal_reason==='owner_consumption'&&x.accounting_treatment==='noncash_owner_draw'),
      'owner use not classified as waste in analytics');
    check(history.json?.summary_30d?.some(x=>x.removal_reason==='quality_rejected'&&x.accounting_treatment==='noncash_product_loss'),
      'quality loss has its own noncash cost');
    exact(await count('transactions',a),moneyBefore,'no cash for either non-sale removal');
    exact(await count('product_sales',a),saleCount,'no phantom sales');
  }catch(e){error=e}
  finally{
    try{
      if(original?.rowCount){
        await pool.query("UPDATE account_business_preferences SET business_id=$2 WHERE account_id=$1 AND role='merchant'",[merchant.accountId,original.rows[0].business_id]);
      }else{
        await pool.query("DELETE FROM account_business_preferences WHERE account_id=$1 AND role='merchant'",[merchant.accountId]);
      }
      for(const id of businesses){
        const owns=await pool.query('SELECT name FROM businesses WHERE id=$1',[id]);
        if(!owns.rows[0]?.name?.startsWith('QA 877 '+marker+' '))throw Error('QA 877 cleanup business ownership mismatch');
        await pool.query('DELETE FROM prepared_product_removal_lots WHERE removal_id IN (SELECT id FROM prepared_product_removals WHERE business_id=$1)',[id]);
        await pool.query('DELETE FROM prepared_product_removal_ingredients WHERE removal_id IN (SELECT id FROM prepared_product_removals WHERE business_id=$1)',[id]);
        await pool.query('DELETE FROM prepared_product_removals WHERE business_id=$1',[id]);
        await pool.query('DELETE FROM product_sale_lot_allocations WHERE sale_id IN (SELECT id FROM product_sales WHERE business_id=$1)',[id]);
        await pool.query('DELETE FROM product_sale_ingredients WHERE sale_id IN (SELECT id FROM product_sales WHERE business_id=$1)',[id]);
        await pool.query('DELETE FROM product_sales WHERE business_id=$1',[id]);
        await pool.query('DELETE FROM recipe_batch_components WHERE product_id IN (SELECT id FROM products WHERE business_id=$1)',[id]);
        await pool.query('DELETE FROM product_recipe_batches WHERE product_id IN (SELECT id FROM products WHERE business_id=$1)',[id]);
        await pool.query('DELETE FROM recipes WHERE product_id IN (SELECT id FROM products WHERE business_id=$1)',[id]);
        await pool.query('DELETE FROM products WHERE business_id=$1',[id]);
        for(const t of ['inventory_count_sessions','inventory_lot_location_balances','inventory_location_balances',
          'inventory_purchases','supply_lots','transactions','inventory','inventory_storage_locations','budgets']){
          await pool.query('DELETE FROM '+t+' WHERE business_id=$1',[id]);
        }
        await pool.query('DELETE FROM businesses WHERE id=$1',[id]);
      }
      cleared=true;
    }catch(cleanupError){
      error=new Error('QA 877 fixture cleanup failed'+(error?' after acceptance failure':''),{cause:cleanupError});
    }
    try{await requestJson(base,'/api/auth/logout',{method:'POST',token:merchant.token,body:{}})}
    catch(logoutError){if(!error)error=logoutError}
  }
  if(error)throw error;
  return{status:'PASS',wave:PREPARED_REMOVAL_877_WAVE,authenticated_http:true,checks,
    owner_cost_php_136_84:true,sold_nine_owner_two:true,noncash_separation:true,
    fefo_replay_cross_business:true,fixtures_removed:cleared};
}
