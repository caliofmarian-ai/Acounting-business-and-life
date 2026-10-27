import crypto from 'node:crypto';
import {ordersReceivableTotal} from './public/orders-receivable-view.js';

const close=(a,b)=>Math.abs(Number(a)-Number(b))<0.0001;
const requireEvidence=(condition,message)=>{if(!condition)throw new Error('Merchant counter QA: '+message)};

// Entry is dispatched only after qaAcceptanceConfig has verified the isolated
// Preview database, service name and dedicated automation secret. All stock and
// order mutations below use authenticated APIs and remain in dedicated QA workspaces.
export async function runMerchantCounterOrdersV1Acceptance({pool,base,secret,aliases,helpers}){
  const{qaAccountSession,requestJson,expectStatus,ensureQaTerritory,ensureMerchantApproved}=helpers;
  const marker=crypto.randomBytes(6).toString('hex');
  const sessions=[],createdOrders=[],createdProducts=[];
  let merchant,admin,originalBusinessId=null,businessId=null,passed=false;
  const call=async(path,options={},expected=200,label=path)=>{
    const result=await requestJson(base,path,{token:merchant?.token,...options});
    expectStatus(result,expected,'Merchant counter '+label);
    return result.json;
  };
  const counter=async(bid,items,expected=201)=>call('/api/orders/merchant/create',{
    method:'POST',body:{business_id:bid,items,customer_name:'QA COUNTER TEST — NOT A REAL SALE',
      fulfilment_method:'pickup',payment_method:'cash',counter_presence:true,
      note:'Controlled private counter acceptance '+marker}
  },expected,'order creation');
  const inventoryEvidence=async(ids)=>{
    const result=await pool.query(`SELECT id,quantity FROM inventory WHERE business_id=$1 AND id=ANY($2::bigint[])`,[businessId,ids]);
    return new Map(result.rows.map(row=>[Number(row.id),Number(row.quantity)]));
  };
  try{
    admin=await qaAccountSession({pool,base,secret,email:aliases.superAdmin,role:'super_admin',label:'Counter Orders Super Admin QA'});
    sessions.push(admin.token);
    merchant=await qaAccountSession({pool,base,secret,email:aliases.merchant,role:'merchant',label:'Counter Orders Merchant QA'});
    sessions.push(merchant.token);
    const territoryId=await ensureQaTerritory({pool,base,adminToken:admin.token});
    await ensureMerchantApproved({pool,base,merchant,adminToken:admin.token,territoryId});
    const workspaces=await call('/api/accounting/workspaces');
    originalBusinessId=Number(workspaces.active_business_id);
    const workspace=async(suffix)=>{
      const name='QA COUNTER ORDERS V1 — '+suffix+' '+marker;
      const existing=(workspaces.businesses||[]).find(row=>row.name===name);
      if(existing)return Number(existing.id);
      const created=await call('/api/accounting/admin/workspaces',{
        method:'POST',token:admin.token,body:{target_account_id:merchant.accountId,role:'merchant',territory_id:territoryId,name,is_primary:false}
      },201,'isolated workspace creation');
      requireEvidence(Number(created.id)>0,'workspace did not return an id.');
      return Number(created.id);
    };
    businessId=await workspace('A');
    const otherBusinessId=await workspace('B');
    await call('/api/accounting/active-workspace',{method:'PATCH',body:{business_id:businessId}});
    const store=await call('/api/merchant/storefront',{
      method:'PUT',body:{business_id:businessId,store_name:'QA Counter Orders — Never Public',
        description:'Isolated acceptance fixture. Not a real merchant or sale.',merchant_domain:'mixed',
        publication_status:'draft',opening_status:'open',pickup_enabled:true,delivery_enabled:false,
        cash_enabled:true,online_enabled:false,public_location_enabled:false,public_reputation_enabled:false}
    });
    requireEvidence(store.publication_status==='draft','test storefront must remain unpublished.');
    const displayAsset=await fetch(base+'/orders-receivable-view.js',{headers:{Accept:'application/javascript'}});
    const displaySource=await displayAsset.text();
    requireEvidence(displayAsset.status===200&&/(?:java|ecma)script/i.test(displayAsset.headers.get('content-type')||'')&&
      displaySource.includes('export')&&displaySource.includes('ordersReceivableTotal'),
      'the shared receivable display asset is not served as JavaScript.');
    const initialOrders=await call('/api/orders/merchant/list?business_id='+businessId);
    requireEvidence(Array.isArray(initialOrders)&&initialOrders.length===0&&close(ordersReceivableTotal(initialOrders),0),
      'fresh Merchant workspace did not start with zero receivable.');
    const initialLedger=await pool.query('SELECT COUNT(*)::int count FROM transactions WHERE business_id=$1',[businessId]);
    requireEvidence(Number(initialLedger.rows[0]?.count)===0,'fresh Merchant workspace already has money ledger records.');

    const stock=async(label,domain,role,cost)=>{
      const row=await call('/api/inventory',{method:'POST',body:{item:`QA COUNTER ${marker} ${label}`,unit:'unit',quantity:10,
        reorder_level:0,unit_cost:cost,inventory_domain:domain,stock_role:role}},201,'stock fixture');
      requireEvidence(Number(row.business_id)===businessId,'stock fixture crossed business scope.');
      return row;
    };
    const foodStock=await stock('PACKAGED','food','direct_resale',2);
    const retailStock=await stock('RETAIL','non_food','direct_resale',3);
    const ingredient=await stock('RECIPE','food','ingredient',2);
    const direct=async(label,kind,inventory,price)=>{
      const row=await call('/api/merchant/storefront/products',{method:'POST',body:{business_id:businessId,
        product_kind:kind,name:`QA COUNTER ${marker} ${label}`,category:'QA Counter',inventory_id:Number(inventory.id),
        quantity_per_unit:1,unit_code:'unit',selling_price:price,published:false}},201,'private product fixture');
      requireEvidence(row.active===true&&row.published===false,'new Catalog product must be active and private.');
      createdProducts.push(Number(row.id));
      return row;
    };
    const food=await direct('PACKAGED FOOD — NOT FOR SALE','packaged_resale',foodStock,7);
    const retail=await direct('RETAIL — NOT FOR SALE','non_food_resale',retailStock,11);
    const catalog=await call('/api/orders/products?business_id='+businessId);
    for(const row of [food,retail])requireEvidence(catalog.some(item=>Number(item.id)===Number(row.id)&&
      item.source_kind==='marketplace_product'&&item.published===false),'private canonical product is missing from the counter picker.');
    const otherCatalog=await call('/api/orders/products?business_id='+otherBusinessId);
    requireEvidence(!otherCatalog.some(item=>item.source_kind==='marketplace_product'&&createdProducts.includes(Number(item.id))),
      'another business counter picker leaked the private products.');
    await counter(otherBusinessId,[{product_id:Number(food.id),source_kind:'marketplace_product',quantity:1}],409);
    // A source-less legacy request must never guess a canonical product with the
    // same numeric id. This dedicated business has no legacy product yet.
    await counter(businessId,[{product_id:Number(food.id),quantity:1}],409);

    const legacy=await call('/api/products',{method:'POST',body:{name:`QA COUNTER ${marker} LEGACY RECIPE`,category:'QA Counter',
      selling_price:5,product_kind:'prepared_recipe',active:true}},201,'legacy prepared fixture');
    await call(`/api/products/${Number(legacy.id)}/recipe`,{method:'PUT',body:{components:[{inventory_id:Number(ingredient.id),quantity:1}]}});
    const items=[{source_kind:'marketplace_product',product_id:Number(food.id),quantity:2},
      {source_kind:'marketplace_product',product_id:Number(retail.id),quantity:1},
      {source_kind:'product',product_id:Number(legacy.id),quantity:1}];
    const order=await counter(businessId,items);
    const orderId=Number(order.id);createdOrders.push(orderId);
    requireEvidence(orderId>0&&order.order_status==='accepted','counter order must be accepted without recording a payment.');
    requireEvidence(close(order.total,30)&&close(order.paid_amount,0)&&close(order.outstanding_amount,30),
      'counter total or unpaid-money semantics changed.');
    const acceptedOrders=await call('/api/orders/merchant/list?business_id='+businessId);
    requireEvidence(acceptedOrders.some(row=>Number(row.id)===orderId&&row.order_status==='accepted')&&
      close(ordersReceivableTotal(acceptedOrders),30),'accepted counter order is missing from the displayed receivable.');
    const foodLine=(order.items||[]).find(row=>row.source_kind==='marketplace_product'&&Number(row.source_id)===Number(food.id));
    requireEvidence(foodLine&&close(foodLine.unit_price_snapshot,7)&&close(foodLine.unit_cost_snapshot,2)&&close(foodLine.line_total,14),
      'canonical price/cost snapshots are missing or incorrect.');
    requireEvidence((order.items||[]).some(row=>row.source_kind==='product'&&Number(row.source_id)===Number(legacy.id)),
      'legacy prepared compatibility was lost.');
    const stockIds=[foodStock.id,retailStock.id,ingredient.id].map(Number);
    const reserved=await pool.query(`SELECT stock_kind,stock_ref_id,quantity_reserved,state FROM order_stock_reservations WHERE order_id=$1 ORDER BY stock_ref_id`,[orderId]);
    requireEvidence(reserved.rowCount===3&&reserved.rows.every(row=>row.stock_kind==='inventory'&&row.state==='reserved'),
      'canonical and legacy stock did not reserve through the shared engine.');
    const expectedUsage=new Map([[Number(foodStock.id),2],[Number(retailStock.id),1],[Number(ingredient.id),1]]);
    for(const row of reserved.rows)requireEvidence(close(row.quantity_reserved,expectedUsage.get(Number(row.stock_ref_id))),'reservation quantity is incorrect.');
    const before=await inventoryEvidence(stockIds);
    requireEvidence(stockIds.every(id=>close(before.get(id),10)),'reservation consumed physical stock before preparation.');

    await call(`/api/merchant/storefront/products/${Number(food.id)}`,{method:'PATCH',body:{selling_price:19,published:false}});
    const repriced=await call('/api/orders/'+orderId);
    const savedLine=(repriced.items||[]).find(row=>row.source_kind==='marketplace_product'&&Number(row.source_id)===Number(food.id));
    requireEvidence(close(savedLine?.unit_price_snapshot,7)&&close(savedLine?.line_total,14)&&close(repriced.total,30),
      'changing Catalog price rewrote an existing order snapshot.');
    const started=await call(`/api/orders/merchant/${orderId}/start`,{method:'POST',body:{}});
    requireEvidence(started.order_status==='preparing','counter preparation did not start.');
    const consumed=await inventoryEvidence(stockIds);
    for(const id of stockIds)requireEvidence(close(consumed.get(id),10-expectedUsage.get(id)),'preparation stock consumption is incorrect.');
    await call(`/api/orders/merchant/${orderId}/start`,{method:'POST',body:{}},409,'repeat start denial');
    const repeated=await inventoryEvidence(stockIds);
    for(const id of stockIds)requireEvidence(close(repeated.get(id),consumed.get(id)),'repeat preparation consumed stock twice.');
    const cancelled=await call(`/api/orders/merchant/${orderId}/cancel`,{method:'POST',body:{reason:'Controlled QA cancellation — no real sale'}});
    requireEvidence(cancelled.order_status==='cancelled','counter cancellation did not complete.');
    const cancelledOrders=await call('/api/orders/merchant/list?business_id='+businessId);
    const cancelledSnapshot=cancelledOrders.find(row=>Number(row.id)===orderId);
    requireEvidence(cancelledSnapshot?.order_status==='cancelled'&&close(cancelledSnapshot.outstanding_amount,30)&&
      close(ordersReceivableTotal(cancelledOrders),0),
      'cancelled order changed its historical balance or remains in the displayed receivable.');
    const restored=await inventoryEvidence(stockIds);
    requireEvidence(stockIds.every(id=>close(restored.get(id),10)),'counter cancellation failed to restore all stock.');
    await call(`/api/orders/merchant/${orderId}/cancel`,{method:'POST',body:{reason:'Idempotency negative'}},409,'repeat cancellation denial');
    const restoredAgain=await inventoryEvidence(stockIds);
    requireEvidence(stockIds.every(id=>close(restoredAgain.get(id),10)),'repeat cancellation restored stock twice.');

    await call(`/api/merchant/storefront/products/${Number(food.id)}`,{method:'PATCH',body:{active:false,published:false}});
    const archived=await call('/api/orders/products?business_id='+businessId);
    requireEvidence(!archived.some(row=>row.source_kind==='marketplace_product'&&Number(row.id)===Number(food.id)),
      'archived canonical product remains in the picker.');
    await counter(businessId,[{source_kind:'marketplace_product',product_id:Number(food.id),quantity:1}],409);
    await counter(businessId,[{source_kind:'marketplace_product',product_id:Number(retail.id),quantity:11}],409);
    const failedOrderEvidence=await pool.query(`SELECT id FROM orders WHERE business_id=$1 AND note=$2`,[businessId,'Controlled private counter acceptance '+marker]);
    requireEvidence(failedOrderEvidence.rowCount===1,'rejected counter requests persisted orders.');
    const money=await pool.query(`SELECT COUNT(*)::int count FROM order_payments WHERE order_id=$1`,[orderId]);
    requireEvidence(Number(money.rows[0]?.count)===0,'counter QA recorded money without a payment action.');
    const finalLedger=await pool.query('SELECT COUNT(*)::int count FROM transactions WHERE business_id=$1',[businessId]);
    requireEvidence(Number(finalLedger.rows[0]?.count)===Number(initialLedger.rows[0]?.count),
      'counter creation/cancellation changed the money ledger without a payment action.');
    const privateStore=await call('/api/merchant/storefront?business_id='+businessId);
    requireEvidence(privateStore.publication_status==='draft'&&(privateStore.products||[])
      .filter(row=>createdProducts.includes(Number(row.id))).every(row=>row.published===false),'test made private products public.');
    await call('/api/public/marketplace/storefronts/'+businessId,{},404,'draft storefront public denial');
    passed=true;
    return{status:'PASS',wave:'merchant_counter_orders_v1',business_id:businessId,order_id:orderId,
      private_food_and_retail_picker:true,canonical_and_legacy_snapshots:true,business_isolation:true,
      canonical_id_not_guessed:true,immutable_price_snapshot:true,reserved_without_consumption:true,
      exact_stock_consumption:true,repeat_start_no_double_consumption:true,cancellation_restores_stock:true,
      archive_and_short_stock_denied:true,rejected_orders_rolled_back:true,no_payment_recorded:true,public_storefront_unchanged:true,
      shared_receivable_asset_served:true,accepted_receivable:30,cancelled_snapshot_outstanding:30,
      cancelled_display_receivable:0,money_ledger_unchanged:true};
  }finally{
    // Retain cancelled orders and private fixture rows as reproducible evidence.
    // Failed waves also release their own reservations and restore stock via the API.
    for(const orderId of createdOrders){
      const state=await pool.query('SELECT order_status FROM orders WHERE id=$1',[orderId]);
      if(!['cancelled','completed'].includes(state.rows[0]?.order_status)){
        const response=await requestJson(base,`/api/orders/merchant/${orderId}/cancel`,{method:'POST',token:merchant.token,
          body:{reason:'Controlled QA cleanup after '+(passed?'acceptance':'failure')}});
        expectStatus(response,200,'Merchant counter cleanup cancellation');
      }
    }
    if(merchant?.token&&originalBusinessId){
      const restore=await requestJson(base,'/api/accounting/active-workspace',{method:'PATCH',token:merchant.token,body:{business_id:originalBusinessId}});
      expectStatus(restore,200,'Merchant counter original workspace restore');
    }
    for(const token of sessions){
      const logout=await requestJson(base,'/api/auth/logout',{method:'POST',token,body:{}});
      expectStatus(logout,200,'Merchant counter QA logout');
    }
  }
}
