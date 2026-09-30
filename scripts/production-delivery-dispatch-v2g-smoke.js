import crypto from 'node:crypto';
import pg from 'pg';
import {deliveryOfferTtlSeconds,deliveryOfferExpired} from '../delivery-dispatch-v2g-core.js';

const {Pool}=pg;
const fail=message=>{throw new Error(message)};

async function run(){
  if(process.env.RAILWAY_ENVIRONMENT_NAME!=='production')fail('Delivery V2G smoke requires Railway production.');
  if(process.env.NODE_ENV!=='production')fail('Delivery V2G smoke requires NODE_ENV=production.');
  if(!process.env.DATABASE_URL)fail('DATABASE_URL is required.');

  const ttl=deliveryOfferTtlSeconds(process.env);
  if(ttl<30||ttl>600)fail('Production Delivery offer TTL is outside the supported bound.');

  const pool=new Pool({
    connectionString:process.env.DATABASE_URL,
    ssl:process.env.DATABASE_URL?{rejectUnauthorized:false}:undefined
  });
  const client=await pool.connect();
  let began=false;

  try{
    await client.query('BEGIN');
    began=true;

    const createAccount=async(role,label)=>{
      const q=await client.query(
        `INSERT INTO accounts(
           display_name,email,account_mode,test_role,email_verified_at,auth_status
         ) VALUES($1,$2,'company_test',$3,NOW(),'active')
         RETURNING id`,
        [label,`delivery-v2g-${role}-${crypto.randomUUID()}@business-life.invalid`,role]
      );
      const id=Number(q.rows[0]?.id);
      if(!Number.isInteger(id)||id<1)fail('Could not create '+role+' fixture.');
      await client.query(
        `INSERT INTO profiles(account_id,role,enabled,visibility,status)
         VALUES($1,$2,TRUE,'private','active')`,
        [id,role]
      );
      return id;
    };

    const merchantId=await createAccount('merchant','Delivery V2G Smoke Merchant');
    const customerId=await createAccount('customer','Delivery V2G Smoke Customer');
    const courierId=await createAccount('courier','Delivery V2G Smoke Courier');

    await client.query(
      `INSERT INTO courier_profiles(
         account_id,display_name,vehicle_type,available,max_weight_kg,max_volume_l,
         service_radius_km,eligibility_status,approved_vehicle_class,eligibility_expires_at
       ) VALUES($1,'Delivery V2G Smoke Courier','motorcycle',TRUE,20,60,25,
         'approved','motorcycle',NOW()+INTERVAL '30 days')`,
      [courierId]
    );
    await client.query(
      `INSERT INTO profile_authorizations(
         account_id,role,territory_id,application_id,status,
         approved_by_account_id,approved_at,expires_at,reason
       ) VALUES($1,'courier',NULL,NULL,'active',$1,NOW(),NULL,
         'Rollback-only Delivery V2G Production smoke')`,
      [courierId]
    );

    const b=await client.query(
      `INSERT INTO businesses(name,country_code,currency_code)
       VALUES($1,'PH','PHP') RETURNING id`,
      ['Delivery V2G Smoke Business '+crypto.randomUUID().slice(0,8)]
    );
    const businessId=Number(b.rows[0]?.id);
    await client.query(
      `INSERT INTO business_memberships(business_id,account_id,membership_role,active)
       VALUES($1,$2,'owner',TRUE)`,
      [businessId,merchantId]
    );

    const order=await client.query(
      `INSERT INTO orders(
         order_number,public_token,business_id,customer_account_id,
         customer_name_snapshot,customer_contact_snapshot,fulfilment_method,
         delivery_address,order_status,payment_status,payment_method,currency_code,
         subtotal,delivery_fee,total,paid_amount,outstanding_amount
       ) VALUES($1,$2,$3,$4,'Delivery V2G Smoke Customer','',
         'delivery','Private QA destination','ready','paid','cash','PHP',
         100,50,150,150,0)
       RETURNING id`,
      ['BL-V2G-'+crypto.randomUUID().slice(0,8),crypto.randomUUID(),businessId,customerId]
    );
    const orderId=Number(order.rows[0]?.id);

    const delivery=await client.query(
      `INSERT INTO deliveries(
         order_id,business_id,customer_account_id,status,dispatch_round,
         delivery_fee,service_fare,platform_fee_basis_amount,currency_code,
         route_distance_km,estimated_weight_kg,estimated_volume_l,
         required_vehicle_class,pickup_address,pickup_lat,pickup_lng,
         dropoff_address,dropoff_lat,dropoff_lng
       ) VALUES($1,$2,$3,'awaiting_courier',1,
         50,50,50,'PHP',3.5,2,5,'motorcycle',
         'Private QA pickup',14.4000,120.9000,
         'SECRET CUSTOMER DESTINATION',14.4100,120.9100)
       RETURNING id`,
      [orderId,businessId,customerId]
    );
    const deliveryId=Number(delivery.rows[0]?.id);

    const stale=await client.query(
      `INSERT INTO delivery_offers(
         delivery_id,courier_account_id,offer_round,status,offered_at,expires_at
       ) VALUES($1,$2,1,'pending',NOW()-INTERVAL '3 minutes',NOW()-INTERVAL '1 second')
       RETURNING id,expires_at`,
      [deliveryId,courierId]
    );
    const staleOfferId=Number(stale.rows[0]?.id);
    if(!deliveryOfferExpired(stale.rows[0]?.expires_at))fail('Expired offer was not recognized as expired.');

    const expired=await client.query(
      `UPDATE delivery_offers
          SET status='expired',responded_at=COALESCE(responded_at,NOW()),updated_at=NOW()
        WHERE id=$1 AND status='pending' AND expires_at<=NOW()
        RETURNING id,status`,
      [staleOfferId]
    );
    if(expired.rowCount!==1||expired.rows[0]?.status!=='expired')fail('Stale pending offer was not expired.');

    const waiting=await client.query(
      'SELECT status,courier_account_id FROM deliveries WHERE id=$1',
      [deliveryId]
    );
    if(waiting.rows[0]?.status!=='awaiting_courier'||waiting.rows[0]?.courier_account_id!=null){
      fail('Offer expiry incorrectly assigned or advanced the Delivery.');
    }

    const staleClaim=await client.query(
      `UPDATE deliveries
          SET courier_account_id=$1,status='courier_assigned',assigned_at=NOW()
        WHERE id=$2 AND status='awaiting_courier' AND courier_account_id IS NULL
          AND EXISTS(
            SELECT 1 FROM delivery_offers
             WHERE id=$3 AND status='pending' AND expires_at>NOW()
          )
        RETURNING id`,
      [courierId,deliveryId,staleOfferId]
    );
    if(staleClaim.rowCount!==0)fail('Expired offer could still claim the Delivery.');

    await client.query('UPDATE deliveries SET dispatch_round=2,updated_at=NOW() WHERE id=$1',[deliveryId]);
    const fresh=await client.query(
      `INSERT INTO delivery_offers(
         delivery_id,courier_account_id,offer_round,status,expires_at
       ) VALUES($1,$2,2,'pending',NOW()+make_interval(secs=>$3::int))
       RETURNING id,expires_at`,
      [deliveryId,courierId,ttl]
    );
    const freshOfferId=Number(fresh.rows[0]?.id);
    if(deliveryOfferExpired(fresh.rows[0]?.expires_at))fail('Fresh retry offer was already expired.');

    const pending=await client.query(
      `SELECT COUNT(*)::int count
         FROM delivery_offers
        WHERE delivery_id=$1 AND offer_round=2
          AND status='pending' AND expires_at>NOW()`,
      [deliveryId]
    );
    if(Number(pending.rows[0]?.count||0)!==1)fail('Retry round did not expose exactly one active offer.');

    const freshClaim=await client.query(
      `UPDATE deliveries
          SET courier_account_id=$1,vehicle_class='motorcycle',
              status='courier_assigned',assigned_at=NOW(),updated_at=NOW()
        WHERE id=$2 AND status='awaiting_courier' AND courier_account_id IS NULL
          AND EXISTS(
            SELECT 1 FROM delivery_offers
             WHERE id=$3 AND status='pending' AND expires_at>NOW()
          )
        RETURNING id`,
      [courierId,deliveryId,freshOfferId]
    );
    if(freshClaim.rowCount!==1)fail('Fresh retry offer could not claim the Delivery.');

    await client.query('ROLLBACK');
    began=false;

    console.log('PRODUCTION_DELIVERY_DISPATCH_V2G_SMOKE_RESULT '+JSON.stringify({
      status:'PASS',
      environment:'production',
      rollback:true,
      ttl_seconds:ttl,
      stale_offer_expired:true,
      expiry_did_not_assign:true,
      expired_offer_cannot_claim:true,
      retry_round_created:true,
      fresh_offer_accepts:true,
      real_money:false
    }));
  }catch(error){
    if(began)await client.query('ROLLBACK').catch(()=>{});
    console.error('PRODUCTION_DELIVERY_DISPATCH_V2G_SMOKE_RESULT '+JSON.stringify({
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
