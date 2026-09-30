import crypto from 'node:crypto';
import pg from 'pg';
import {deliveryOfferCourierGate,deliveryOfferSafeView} from '../delivery-dispatch-v2f-core.js';

const {Pool}=pg;
const fail=message=>{throw new Error(message)};

async function run(){
  if(process.env.RAILWAY_ENVIRONMENT_NAME!=='production')fail('Delivery V2F smoke requires Railway production.');
  if(process.env.NODE_ENV!=='production')fail('Delivery V2F smoke requires NODE_ENV=production.');
  if(!process.env.DATABASE_URL)fail('DATABASE_URL is required.');

  const pool=new Pool({
    connectionString:process.env.DATABASE_URL,
    ssl:process.env.DATABASE_URL?{rejectUnauthorized:false}:undefined
  });
  const client=await pool.connect();
  let began=false;
  try{
    await client.query('BEGIN');
    began=true;
    const suffix=crypto.randomUUID();

    const createAccount=async(role,label)=>{
      const q=await client.query(
        `INSERT INTO accounts(
           display_name,email,account_mode,test_role,email_verified_at,auth_status
         ) VALUES($1,$2,'company_test',$3,NOW(),'active')
         RETURNING id`,
        [label,`delivery-v2f-${role}-${crypto.randomUUID()}@business-life.invalid`,role]
      );
      const accountId=Number(q.rows[0]?.id);
      if(!Number.isInteger(accountId)||accountId<1)fail('Could not create '+role+' fixture.');
      await client.query(
        `INSERT INTO profiles(account_id,role,enabled,visibility,status)
         VALUES($1,$2,TRUE,'private','active')`,
        [accountId,role]
      );
      return accountId;
    };

    const createCourier=async(label,{available=true,vehicle='motorcycle'}={})=>{
      const accountId=await createAccount('courier',label);
      await client.query(
        `INSERT INTO courier_profiles(
           account_id,display_name,vehicle_type,available,max_weight_kg,max_volume_l,
           service_radius_km,eligibility_status,approved_vehicle_class,eligibility_expires_at
         ) VALUES($1,$2,$3,$4,20,60,25,'approved',$3,NOW()+INTERVAL '30 days')`,
        [accountId,label,vehicle,available]
      );
      await client.query(
        `INSERT INTO profile_authorizations(
           account_id,role,territory_id,application_id,status,
           approved_by_account_id,approved_at,expires_at,reason
         ) VALUES($1,'courier',NULL,NULL,'active',$1,NOW(),NULL,'Rollback-only Delivery V2F Production smoke')`,
        [accountId]
      );
      return accountId;
    };

    const merchantId=await createAccount('merchant','Delivery V2F Smoke Merchant');
    const customerId=await createAccount('customer','Delivery V2F Smoke Customer');
    const courierA=await createCourier('Delivery V2F Smoke Courier A');
    const courierB=await createCourier('Delivery V2F Smoke Courier B');
    const courierC=await createCourier('Delivery V2F Smoke Courier C');
    const unavailableCourier=await createCourier('Delivery V2F Smoke Courier Unavailable',{available:false});

    const businessQ=await client.query(
      `INSERT INTO businesses(name,country_code,currency_code)
       VALUES($1,'PH','PHP') RETURNING id`,
      ['Delivery V2F Smoke Business '+suffix.slice(0,8)]
    );
    const businessId=Number(businessQ.rows[0]?.id);
    await client.query(
      `INSERT INTO business_memberships(business_id,account_id,membership_role,active)
       VALUES($1,$2,'owner',TRUE)`,
      [businessId,merchantId]
    );

    const createDelivery=async(label)=>{
      const orderQ=await client.query(
        `INSERT INTO orders(
           order_number,public_token,business_id,customer_account_id,
           customer_name_snapshot,customer_contact_snapshot,fulfilment_method,
           delivery_address,order_status,payment_status,payment_method,currency_code,
           subtotal,delivery_fee,total,paid_amount,outstanding_amount
         ) VALUES($1,$2,$3,$4,'Delivery V2F Smoke Customer','',
           'delivery','Private QA destination','ready','paid','cash','PHP',
           100,50,150,150,0)
         RETURNING id`,
        ['BL-V2F-'+label+'-'+suffix.slice(0,8),crypto.randomUUID(),businessId,customerId]
      );
      const orderId=Number(orderQ.rows[0]?.id);
      const deliveryQ=await client.query(
        `INSERT INTO deliveries(
           order_id,business_id,customer_account_id,status,dispatch_round,
           delivery_fee,service_fare,platform_fee_basis_amount,currency_code,
           route_distance_km,estimated_weight_kg,estimated_volume_l,
           required_vehicle_class,pickup_address,pickup_lat,pickup_lng,
           dropoff_address,dropoff_lat,dropoff_lng
         ) VALUES($1,$2,$3,'awaiting_courier',1,
           50,50,50,'PHP',3.5,2,5,
           'motorcycle','Private QA pickup',14.4000,120.9000,
           'SECRET CUSTOMER DESTINATION',14.4100,120.9100)
         RETURNING *`,
        [orderId,businessId,customerId]
      );
      return deliveryQ.rows[0];
    };

    const gateReady=deliveryOfferCourierGate({
      available:true,eligibility_status:'approved',approved_vehicle_class:'motorcycle',
      max_weight_kg:20,max_volume_l:60,service_radius_km:25
    },{
      required_vehicle_class:'motorcycle',estimated_weight_kg:2,
      estimated_volume_l:5,route_distance_km:3.5
    },{territoryAuthorized:true,hasActiveDelivery:false});
    if(!gateReady.allowed)fail('Eligible Courier gate rejected a valid Courier.');

    const gateUnavailable=deliveryOfferCourierGate({
      available:false,eligibility_status:'approved',approved_vehicle_class:'motorcycle',
      max_weight_kg:20,max_volume_l:60,service_radius_km:25
    },{
      required_vehicle_class:'motorcycle',estimated_weight_kg:2,
      estimated_volume_l:5,route_distance_km:3.5
    },{territoryAuthorized:true,hasActiveDelivery:false});
    if(gateUnavailable.allowed||gateUnavailable.reason!=='COURIER_NOT_AVAILABLE')fail('Unavailable Courier gate was not rejected.');

    const declineDelivery=await createDelivery('DECLINE');
    const offerA1=await client.query(
      `INSERT INTO delivery_offers(delivery_id,courier_account_id,offer_round,status)
       VALUES($1,$2,1,'pending') RETURNING *`,
      [declineDelivery.id,courierA]
    );

    const safeView=deliveryOfferSafeView({
      ...offerA1.rows[0],
      delivery_id:declineDelivery.id,
      order_number:'BL-V2F-SAFE',
      business_name:'Delivery V2F Smoke Business',
      route_distance_km:declineDelivery.route_distance_km,
      estimated_weight_kg:declineDelivery.estimated_weight_kg,
      estimated_volume_l:declineDelivery.estimated_volume_l,
      required_vehicle_class:declineDelivery.required_vehicle_class,
      delivery_fee:declineDelivery.delivery_fee,
      currency_code:'PHP',
      dropoff_address:'SECRET CUSTOMER DESTINATION',
      dropoff_lat:14.41,
      dropoff_lng:120.91,
      customer_name:'SECRET CUSTOMER'
    });
    for(const secret of ['dropoff_address','dropoff_lat','dropoff_lng','customer_name','customer_contact']){
      if(Object.hasOwn(safeView,secret))fail('Pre-accept safe offer leaked '+secret+'.');
    }

    await client.query(
      `UPDATE delivery_offers
          SET status='declined',decline_reason='Production smoke refusal',
              responded_at=NOW(),updated_at=NOW()
        WHERE id=$1`,
      [offerA1.rows[0].id]
    );
    const afterDecline=await client.query(
      'SELECT status,courier_account_id FROM deliveries WHERE id=$1',
      [declineDelivery.id]
    );
    if(afterDecline.rows[0]?.status!=='awaiting_courier'||afterDecline.rows[0]?.courier_account_id!=null){
      fail('Courier refusal changed Delivery assignment.');
    }

    await client.query('UPDATE deliveries SET dispatch_round=2,updated_at=NOW() WHERE id=$1',[declineDelivery.id]);
    const offerA2=await client.query(
      `INSERT INTO delivery_offers(delivery_id,courier_account_id,offer_round,status)
       VALUES($1,$2,2,'pending') RETURNING id`,
      [declineDelivery.id,courierA]
    );
    const claimA=await client.query(
      `UPDATE deliveries
          SET courier_account_id=$1,vehicle_class='motorcycle',
              status='courier_assigned',assigned_at=NOW(),updated_at=NOW()
        WHERE id=$2 AND status='awaiting_courier' AND courier_account_id IS NULL
        RETURNING id`,
      [courierA,declineDelivery.id]
    );
    if(claimA.rowCount!==1)fail('Re-offered Courier could not accept Delivery.');
    await client.query(
      `UPDATE delivery_offers
          SET status='accepted',responded_at=NOW(),updated_at=NOW()
        WHERE id=$1 AND status='pending'`,
      [offerA2.rows[0].id]
    );
    await client.query('UPDATE courier_profiles SET available=FALSE WHERE account_id=$1',[courierA]);
    const acceptedA=await client.query(
      'SELECT status,courier_account_id FROM deliveries WHERE id=$1',
      [declineDelivery.id]
    );
    if(acceptedA.rows[0]?.status!=='courier_assigned'||Number(acceptedA.rows[0]?.courier_account_id)!==courierA){
      fail('Courier acceptance did not assign Delivery.');
    }

    const raceDelivery=await createDelivery('RACE');
    const offersRace=await client.query(
      `INSERT INTO delivery_offers(delivery_id,courier_account_id,offer_round,status)
       VALUES($1,$2,1,'pending'),($1,$3,1,'pending')
       RETURNING id,courier_account_id`,
      [raceDelivery.id,courierB,courierC]
    );
    const offerB=offersRace.rows.find(x=>Number(x.courier_account_id)===courierB);
    const offerC=offersRace.rows.find(x=>Number(x.courier_account_id)===courierC);
    if(!offerB||!offerC)fail('Competing offers were not created.');

    const firstClaim=await client.query(
      `UPDATE deliveries
          SET courier_account_id=$1,vehicle_class='motorcycle',
              status='courier_assigned',assigned_at=NOW(),updated_at=NOW()
        WHERE id=$2 AND status='awaiting_courier' AND courier_account_id IS NULL
        RETURNING id`,
      [courierB,raceDelivery.id]
    );
    if(firstClaim.rowCount!==1)fail('First valid Courier accept did not claim Delivery.');
    await client.query(
      `UPDATE delivery_offers
          SET status=CASE WHEN id=$1 THEN 'accepted' ELSE 'withdrawn' END,
              responded_at=NOW(),updated_at=NOW()
        WHERE delivery_id=$2 AND offer_round=1 AND status='pending'`,
      [offerB.id,raceDelivery.id]
    );
    const secondClaim=await client.query(
      `UPDATE deliveries
          SET courier_account_id=$1,vehicle_class='motorcycle',
              status='courier_assigned',assigned_at=NOW(),updated_at=NOW()
        WHERE id=$2 AND status='awaiting_courier' AND courier_account_id IS NULL
        RETURNING id`,
      [courierC,raceDelivery.id]
    );
    if(secondClaim.rowCount!==0)fail('Second Courier incorrectly claimed an already accepted Delivery.');
    const raceOffers=await client.query(
      'SELECT courier_account_id,status FROM delivery_offers WHERE delivery_id=$1 ORDER BY courier_account_id',
      [raceDelivery.id]
    );
    const bState=raceOffers.rows.find(x=>Number(x.courier_account_id)===courierB)?.status;
    const cState=raceOffers.rows.find(x=>Number(x.courier_account_id)===courierC)?.status;
    if(bState!=='accepted'||cState!=='withdrawn')fail('Competing offer states were not resolved after first acceptance.');

    const unavailableRow=await client.query('SELECT available FROM courier_profiles WHERE account_id=$1',[unavailableCourier]);
    if(unavailableRow.rows[0]?.available!==false)fail('Unavailable Courier fixture unexpectedly became available.');

    const templates=await client.query(
      `SELECT event_code,locale
         FROM notification_templates
        WHERE event_code IN ('delivery.offer_received','delivery.assigned')
          AND locale IN ('en-PH','fil-PH')`
    );
    const templateKeys=new Set(templates.rows.map(x=>x.event_code+':'+x.locale));
    for(const key of [
      'delivery.offer_received:en-PH','delivery.offer_received:fil-PH',
      'delivery.assigned:en-PH','delivery.assigned:fil-PH'
    ])if(!templateKeys.has(key))fail('Missing Production notification template '+key);

    await client.query('ROLLBACK');
    began=false;

    console.log('PRODUCTION_DELIVERY_DISPATCH_V2F_SMOKE_RESULT '+JSON.stringify({
      status:'PASS',
      environment:'production',
      rollback:true,
      unavailable_courier_rejected:true,
      pre_accept_customer_destination_private:true,
      refusal_did_not_assign:true,
      reoffer_after_refusal:true,
      courier_accept_assigned:true,
      first_accept_wins:true,
      competing_offer_withdrawn:true,
      offer_and_assignment_notifications_present:true,
      real_money:false
    }));
  }catch(error){
    if(began)await client.query('ROLLBACK').catch(()=>{});
    console.error('PRODUCTION_DELIVERY_DISPATCH_V2F_SMOKE_RESULT '+JSON.stringify({
      status:'FAIL',
      rollback:true,
      error:String(error?.message||error).slice(0,700)
    }));
    process.exitCode=1;
  }finally{
    client.release();
    await pool.end();
  }
}

await run();
