import crypto from 'node:crypto';
import pg from 'pg';

const{Pool}=pg;
const fail=message=>{throw new Error(message)};
const FIXTURE_CODE='controlled-role-e2e-v1';

function token(prefix){
  return prefix+'-'+crypto.randomBytes(10).toString('hex');
}

async function run(){
  if(process.env.RAILWAY_ENVIRONMENT_NAME!=='production')fail('Production non-settling E2E requires Railway production.');
  if(process.env.NODE_ENV!=='production')fail('Production non-settling E2E requires NODE_ENV=production.');
  if(process.env.RAILWAY_SERVICE_NAME!=='accounting-business-life')fail('Production non-settling E2E requires the canonical Production service.');
  if(!process.env.DATABASE_URL)fail('DATABASE_URL is required.');

  const revision=String(process.env.RAILWAY_GIT_COMMIT_SHA||'').trim();
  if(!/^[a-f0-9]{40}$/i.test(revision))fail('Immutable Production revision is required.');

  const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
  const client=await pool.connect();
  const marker='PROD-E2E-785-'+revision.slice(0,12)+'-'+Date.now();
  let began=false;
  let ids={};
  try{
    const fixtureQ=await client.query(`
      SELECT *
        FROM controlled_role_lifecycle_fixtures
       WHERE fixture_code=$1
         AND lifecycle_status='ready'
         AND settlement_mode='blocked'
       LIMIT 1
    `,[FIXTURE_CODE]);
    if(fixtureQ.rowCount!==1)fail('Controlled non-settling lifecycle fixture is not ready.');
    const fixture=fixtureQ.rows[0];

    const accountIds=[
      fixture.customer_account_id,fixture.merchant_account_id,fixture.supplier_account_id,
      fixture.courier_account_id,fixture.service_provider_account_id
    ].map(Number);
    const accounts=await client.query(`
      SELECT a.id,a.account_mode,a.test_role,a.phone,a.address,a.email_verified_at,
             p.role,p.enabled,p.visibility,p.status,
             g.psgc_code
        FROM accounts a
        JOIN profiles p ON p.account_id=a.id AND p.role=a.test_role
        JOIN account_geography_assignments g ON g.account_id=a.id
       WHERE a.id=ANY($1::bigint[])
       ORDER BY a.id
    `,[accountIds]);
    if(accounts.rowCount!==5)fail('Controlled Production role identities are incomplete.');
    if(accounts.rows.some(row=>
      row.account_mode!=='company_test'||row.enabled!==true||row.visibility!=='private'
      ||row.status!=='active'||row.phone!==''||row.address!==''||!row.email_verified_at
      ||row.psgc_code!=='0402103028'
    ))fail('Controlled role isolation, privacy or deterministic geography invariant failed.');

    const expectedRoles=new Set(['customer','merchant','supplier','courier','service_provider']);
    if(accounts.rows.some(row=>!expectedRoles.delete(row.test_role))||expectedRoles.size)fail('Controlled role identities are not role-isolated.');

    await client.query('BEGIN');
    began=true;

    const poToken=token('prod-e2e-po');
    const po=await client.query(`
      INSERT INTO purchase_orders(
        public_token,business_id,supplier_account_id,status,fulfilment_mode,
        subtotal,delivery_fee,expected_total,actual_received_total,payment_status,
        paid_amount,supplier_note,merchant_note,sent_at,accepted_at,received_at
      ) VALUES($1,$2,$3,'received','delivery',80,0,80,80,'unpaid',0,$4,$4,NOW(),NOW(),NOW())
      RETURNING id
    `,[poToken,Number(fixture.merchant_business_id),Number(fixture.supplier_account_id),marker]);
    ids.purchase_order=Number(po.rows[0].id);

    const poItem=await client.query(`
      INSERT INTO purchase_order_items(
        purchase_order_id,name_snapshot,sku_snapshot,unit_name_snapshot,base_unit_snapshot,
        base_units_per_pack_snapshot,ordered_packs,confirmed_packs,received_packs,
        price_per_pack_snapshot,confirmed_price_per_pack,line_total,supplier_note
      ) VALUES($1,'Controlled E2E supply','E2E-785','pack','unit',1,1,1,1,80,80,80,$2)
      RETURNING id
    `,[ids.purchase_order,marker]);
    ids.purchase_order_item=Number(poItem.rows[0].id);

    const receipt=await client.query(`
      INSERT INTO purchase_receipts(purchase_order_id,received_by_account_id,note)
      VALUES($1,$2,$3) RETURNING id
    `,[ids.purchase_order,Number(fixture.merchant_account_id),marker]);
    ids.receipt=Number(receipt.rows[0].id);
    await client.query(`
      INSERT INTO purchase_receipt_items(
        receipt_id,purchase_order_item_id,received_packs,received_base_units,actual_price_per_pack
      ) VALUES($1,$2,1,1,80)
    `,[ids.receipt,ids.purchase_order_item]);

    const orderToken=token('prod-e2e-order');
    const order=await client.query(`
      INSERT INTO orders(
        public_token,business_id,customer_account_id,customer_name_snapshot,customer_contact_snapshot,
        fulfilment_method,delivery_address,order_status,payment_status,payment_method,currency_code,
        subtotal,delivery_fee,total,paid_amount,outstanding_amount,preparation_eta_minutes,note,
        accepted_at,preparing_at,ready_at,handoff_at,completed_at
      ) VALUES(
        $1,$2,$3,'Controlled Customer','','delivery','Controlled Queens Row West fixture',
        'completed','paid','online','PHP',100,50,150,150,0,15,$4,
        NOW(),NOW(),NOW(),NOW(),NOW()
      ) RETURNING id
    `,[orderToken,Number(fixture.merchant_business_id),Number(fixture.customer_account_id),marker]);
    ids.order=Number(order.rows[0].id);

    await client.query(`
      INSERT INTO order_items(
        order_id,source_kind,name_snapshot,category_snapshot,quantity,
        unit_price_snapshot,unit_cost_snapshot,line_total,estimated_cogs,estimated_gross_profit
      ) VALUES($1,'product','Controlled E2E product','company_test',1,100,80,100,80,20)
    `,[ids.order]);

    const orderStates=[
      [null,'accepted'],['accepted','preparing'],['preparing','ready'],
      ['ready','handoff_to_delivery'],['handoff_to_delivery','completed']
    ];
    for(const[from,to]of orderStates){
      await client.query(`
        INSERT INTO order_status_events(order_id,from_status,to_status,actor_account_id,note)
        VALUES($1,$2,$3,$4,$5)
      `,[ids.order,from,to,Number(fixture.merchant_account_id),marker]);
    }

    const delivery=await client.query(`
      INSERT INTO deliveries(
        order_id,business_id,customer_account_id,courier_account_id,status,
        delivery_fee,service_fare,platform_fee_basis_amount,pass_through_amount,
        price_breakdown,route_source,route_profile,currency_code,route_distance_km,
        estimated_weight_kg,estimated_volume_l,pickup_address,pickup_lat,pickup_lng,
        dropoff_address,dropoff_lat,dropoff_lng,vehicle_class,required_vehicle_class,
        requested_at,assigned_at,en_route_to_merchant_at,arrived_merchant_at,picked_up_at,
        in_transit_at,arrived_customer_at,delivered_at
      ) VALUES(
        $1,$2,$3,$4,'delivered',
        50,50,50,0,'{"company_test":true}'::jsonb,'controlled_fixture','driving','PHP',2.5,
        1,5,'Controlled Merchant',14.444,120.956,
        'Controlled Queens Row West',14.445,120.957,'motorcycle','motorcycle',
        NOW(),NOW(),NOW(),NOW(),NOW(),NOW(),NOW(),NOW()
      ) RETURNING id
    `,[
      ids.order,Number(fixture.merchant_business_id),Number(fixture.customer_account_id),
      Number(fixture.courier_account_id)
    ]);
    ids.delivery=Number(delivery.rows[0].id);

    for(const eventCode of [
      'controlled_requested','controlled_assigned','controlled_picked_up',
      'controlled_in_transit','controlled_delivered'
    ]){
      await client.query(`
        INSERT INTO delivery_dispatch_events(
          delivery_id,actor_account_id,courier_account_id,event_code,detail_json
        ) VALUES($1,$2,$3,$4,$5::jsonb)
      `,[
        ids.delivery,Number(fixture.courier_account_id),Number(fixture.courier_account_id),
        eventCode,JSON.stringify({company_test:true,marker})
      ]);
    }

    const successIntent=await client.query(`
      INSERT INTO payment_intents(
        public_id,idempotency_key,source_type,source_id,payer_account_id,business_id,territory_id,
        provider_code,provider_intent_id,logical_method,currency_code,amount,status,provider_status,
        client_reference,succeeded_at
      ) VALUES($1,$2,'order',$3,$4,$5,$6,'company_test_non_settling','', 'online_other',
        'PHP',150,'succeeded','synthetic_company_test',$7,NOW())
      RETURNING id
    `,[
      token('pi'),token('idem'),ids.order,Number(fixture.customer_account_id),
      Number(fixture.merchant_business_id),Number(fixture.territory_id),marker
    ]);
    ids.payment_intent=Number(successIntent.rows[0].id);

    const merchantAllocation=await client.query(`
      INSERT INTO payment_allocations(
        payment_intent_id,component_code,economic_party_type,economic_party_id,
        gross_base,amount,currency_code,rule_snapshot,settlement_status
      ) VALUES($1,'merchant_net','business',$2,100,100,'PHP',$3::jsonb,'held')
      RETURNING id
    `,[
      ids.payment_intent,String(fixture.merchant_business_id),
      JSON.stringify({company_test:true,no_real_money:true,marker})
    ]);
    ids.merchant_allocation=Number(merchantAllocation.rows[0].id);

    const courierAllocation=await client.query(`
      INSERT INTO payment_allocations(
        payment_intent_id,component_code,economic_party_type,economic_party_id,
        gross_base,amount,currency_code,rule_snapshot,settlement_status
      ) VALUES($1,'courier_net','account',$2,50,50,'PHP',$3::jsonb,'held')
      RETURNING id
    `,[
      ids.payment_intent,String(fixture.courier_account_id),
      JSON.stringify({company_test:true,no_real_money:true,marker})
    ]);
    ids.courier_allocation=Number(courierAllocation.rows[0].id);

    const merchantSettlement=await client.query(`
      INSERT INTO settlements(
        public_id,beneficiary_type,beneficiary_ref,provider_code,currency_code,
        gross_amount,deduction_amount,net_amount,status,evidence_reference
      ) VALUES($1,'merchant',$2,'company_test_non_settling','PHP',100,0,100,'held',$3)
      RETURNING id
    `,[token('settlement'),String(fixture.merchant_business_id),marker]);
    ids.merchant_settlement=Number(merchantSettlement.rows[0].id);
    await client.query(`
      INSERT INTO settlement_lines(settlement_id,payment_allocation_id,amount)
      VALUES($1,$2,100)
    `,[ids.merchant_settlement,ids.merchant_allocation]);

    const courierSettlement=await client.query(`
      INSERT INTO settlements(
        public_id,beneficiary_type,beneficiary_ref,provider_code,currency_code,
        gross_amount,deduction_amount,net_amount,status,evidence_reference
      ) VALUES($1,'courier',$2,'company_test_non_settling','PHP',50,0,50,'held',$3)
      RETURNING id
    `,[token('settlement'),String(fixture.courier_account_id),marker]);
    ids.courier_settlement=Number(courierSettlement.rows[0].id);
    await client.query(`
      INSERT INTO settlement_lines(settlement_id,payment_allocation_id,amount)
      VALUES($1,$2,50)
    `,[ids.courier_settlement,ids.courier_allocation]);

    const cancelOrder=await client.query(`
      INSERT INTO orders(
        public_token,business_id,customer_account_id,customer_name_snapshot,customer_contact_snapshot,
        fulfilment_method,delivery_address,order_status,payment_status,payment_method,currency_code,
        subtotal,delivery_fee,total,paid_amount,outstanding_amount,preparation_eta_minutes,note,
        cancelled_at,cancellation_reason
      ) VALUES(
        $1,$2,$3,'Controlled Customer','','delivery','Controlled Queens Row West fixture',
        'cancelled','unpaid','online','PHP',60,30,90,0,90,15,$4,NOW(),'Controlled cancellation path'
      ) RETURNING id
    `,[token('prod-e2e-cancel'),Number(fixture.merchant_business_id),Number(fixture.customer_account_id),marker]);
    ids.cancel_order=Number(cancelOrder.rows[0].id);

    const cancelDelivery=await client.query(`
      INSERT INTO deliveries(
        order_id,business_id,customer_account_id,courier_account_id,status,
        delivery_fee,service_fare,platform_fee_basis_amount,pass_through_amount,
        price_breakdown,route_source,route_profile,currency_code,route_distance_km,
        estimated_weight_kg,estimated_volume_l,pickup_address,pickup_lat,pickup_lng,
        dropoff_address,dropoff_lat,dropoff_lng,vehicle_class,required_vehicle_class,
        requested_at,cancelled_at,failure_reason
      ) VALUES(
        $1,$2,$3,NULL,'cancelled',
        30,30,30,0,'{"company_test":true}'::jsonb,'controlled_fixture','driving','PHP',1.5,
        1,5,'Controlled Merchant',14.444,120.956,
        'Controlled Queens Row West',14.445,120.957,'motorcycle','motorcycle',
        NOW(),NOW(),'Controlled cancellation path'
      ) RETURNING id
    `,[ids.cancel_order,Number(fixture.merchant_business_id),Number(fixture.customer_account_id)]);
    ids.cancel_delivery=Number(cancelDelivery.rows[0].id);

    const failedIntent=await client.query(`
      INSERT INTO payment_intents(
        public_id,idempotency_key,source_type,source_id,payer_account_id,business_id,territory_id,
        provider_code,provider_intent_id,logical_method,currency_code,amount,status,provider_status,
        client_reference,failure_code,failure_message
      ) VALUES(
        $1,$2,'order',$3,$4,$5,$6,'company_test_non_settling','', 'online_other',
        'PHP',90,'failed','synthetic_failure',$7,'CONTROLLED_FAILURE','No external provider call'
      ) RETURNING id
    `,[
      token('pi'),token('idem'),ids.cancel_order,Number(fixture.customer_account_id),
      Number(fixture.merchant_business_id),Number(fixture.territory_id),marker
    ]);
    ids.failed_payment_intent=Number(failedIntent.rows[0].id);

    const successProof=await client.query(`
      SELECT
        (SELECT status FROM purchase_orders WHERE id=$1) po_status,
        (SELECT order_status FROM orders WHERE id=$2) order_status,
        (SELECT status FROM deliveries WHERE id=$3) delivery_status,
        (SELECT status FROM payment_intents WHERE id=$4) payment_status,
        (SELECT COUNT(*)::int FROM payment_allocations WHERE payment_intent_id=$4 AND settlement_status='held') held_allocations,
        (SELECT COUNT(*)::int FROM settlements WHERE id=ANY($5::bigint[]) AND status='held') held_settlements,
        (SELECT COUNT(*)::int FROM settlements WHERE id=ANY($5::bigint[]) AND status='paid') paid_settlements
    `,[
      ids.purchase_order,ids.order,ids.delivery,ids.payment_intent,
      [ids.merchant_settlement,ids.courier_settlement]
    ]);
    const success=successProof.rows[0];
    if(success.po_status!=='received'||success.order_status!=='completed'||success.delivery_status!=='delivered')fail('Controlled success lifecycle did not reach fulfilment completion.');
    if(success.payment_status!=='succeeded'||Number(success.held_allocations)!==2||Number(success.held_settlements)!==2||Number(success.paid_settlements)!==0)fail('Controlled payment/settlement boundary is not held as required.');

    const failureProof=await client.query(`
      SELECT
        (SELECT order_status FROM orders WHERE id=$1) order_status,
        (SELECT status FROM deliveries WHERE id=$2) delivery_status,
        (SELECT status FROM payment_intents WHERE id=$3) payment_status,
        (SELECT COUNT(*)::int FROM payment_allocations WHERE payment_intent_id=$3) allocations,
        (SELECT COUNT(*)::int FROM settlement_lines sl
          JOIN payment_allocations pa ON pa.id=sl.payment_allocation_id
         WHERE pa.payment_intent_id=$3) settlement_lines
    `,[ids.cancel_order,ids.cancel_delivery,ids.failed_payment_intent]);
    const failed=failureProof.rows[0];
    if(failed.order_status!=='cancelled'||failed.delivery_status!=='cancelled'||failed.payment_status!=='failed')fail('Controlled cancellation/failure lifecycle did not reach its terminal state.');
    if(Number(failed.allocations)!==0||Number(failed.settlement_lines)!==0)fail('Failed controlled payment unexpectedly reached allocation or settlement.');

    await client.query('ROLLBACK');
    began=false;
    client.release();

    const residue=await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM purchase_orders WHERE supplier_note=$1 OR merchant_note=$1) purchase_orders,
        (SELECT COUNT(*)::int FROM orders WHERE note=$1) orders,
        (SELECT COUNT(*)::int FROM payment_intents WHERE client_reference=$1) payment_intents,
        (SELECT COUNT(*)::int FROM settlements WHERE evidence_reference=$1) settlements
    `,[marker]);
    const left=residue.rows[0];
    if(Object.values(left).some(value=>Number(value)!==0))fail('Rollback left synthetic Production lifecycle residue.');

    console.log('PRODUCTION_NON_SETTLING_E2E_785_RESULT '+JSON.stringify({
      status:'PASS',
      environment:'production',
      revision:revision.slice(0,12),
      roles:['customer','merchant','supplier','courier','service_provider'],
      supplier_receipt:true,
      customer_order_completed:true,
      courier_delivery_completed:true,
      synthetic_payment_state:'succeeded_company_test_only',
      held_allocations:2,
      held_settlements:2,
      paid_settlements:0,
      cancellation_path:true,
      payment_failure_path:true,
      failed_path_allocations:0,
      rollback:true,
      residue:false,
      provider_call:false,
      real_money:false,
      credentials_exposed:false
    }));
  }catch(error){
    if(began)await client.query('ROLLBACK').catch(()=>{});
    try{client.release()}catch{}
    console.error('PRODUCTION_NON_SETTLING_E2E_785_RESULT '+JSON.stringify({
      status:'FAIL',rollback:true,provider_call:false,real_money:false,
      error:String(error?.message||error).slice(0,500)
    }));
    process.exitCode=1;
  }finally{
    await pool.end();
  }
}

await run();
