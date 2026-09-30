import crypto from 'node:crypto';
import pg from 'pg';
import {
  deliveryRouteTrackingActive,
  deliveryRoutePointDecision
} from '../delivery-tracking-v2e-core.js';
import {
  storePrivateEvidence,
  readPrivateEvidence,
  deletePrivateEvidence
} from '../private-evidence-core.js';

const {Pool}=pg;
const QA_PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlWhVQAAAAASUVORK5CYII=';

const fail=message=>{throw new Error(message)};

async function run(){
  if(process.env.RAILWAY_ENVIRONMENT_NAME!=='production')fail('Delivery V2E smoke requires Railway production.');
  if(process.env.NODE_ENV!=='production')fail('Delivery V2E smoke requires NODE_ENV=production.');
  if(!process.env.DATABASE_URL)fail('DATABASE_URL is required.');

  const pool=new Pool({
    connectionString:process.env.DATABASE_URL,
    ssl:process.env.DATABASE_URL?{rejectUnauthorized:false}:undefined
  });

  let proofObject=null;
  let client=null;
  let began=false;
  try{
    proofObject=await storePrivateEvidence(pool,{
      dataUrl:QA_PNG,
      fileName:'delivery-v2e-production-smoke.png',
      allowedMimes:['image/png'],
      maxBytes:200000,
      ownerAccountId:null,
      actorAccountId:null,
      sourceType:'delivery_proof_smoke',
      sourceId:'production-smoke',
      purpose:'delivery_v2e_production_smoke',
      classification:'delivery_proof'
    });
    if(!proofObject?.id)fail('Private proof object was not created.');
    const proofRead=await readPrivateEvidence(pool,{
      objectId:proofObject.id,
      actorAccountId:null,
      purpose:'delivery_v2e_production_smoke_read'
    });
    if(!proofRead?.bytes?.length)fail('Private proof object was not readable.');

    client=await pool.connect();
    await client.query('BEGIN');
    began=true;

    const suffix=crypto.randomUUID();
    const createAccount=async(role,label)=>{
      const q=await client.query(
        `INSERT INTO accounts(
           display_name,email,account_mode,test_role,email_verified_at,auth_status
         ) VALUES($1,$2,'company_test',$3,NOW(),'active')
         RETURNING id`,
        [label,`delivery-v2e-${role}-${suffix}@business-life.invalid`,role]
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

    const customerId=await createAccount('customer','Delivery V2E Smoke Customer');
    const merchantId=await createAccount('merchant','Delivery V2E Smoke Merchant');
    const courierId=await createAccount('courier','Delivery V2E Smoke Courier');

    const b=await client.query(
      `INSERT INTO businesses(name,country_code,currency_code)
       VALUES('Delivery V2E Smoke Business','PH','PHP')
       RETURNING id`
    );
    const businessId=Number(b.rows[0]?.id);
    await client.query(
      `INSERT INTO business_memberships(business_id,account_id,membership_role,active)
       VALUES($1,$2,'owner',TRUE)`,
      [businessId,merchantId]
    );

    const orderToken=crypto.randomUUID();
    const orderNumber='BL-V2E-SMOKE-'+suffix.slice(0,8);
    const order=await client.query(
      `INSERT INTO orders(
         order_number,public_token,business_id,customer_account_id,
         customer_name_snapshot,customer_contact_snapshot,fulfilment_method,
         delivery_address,order_status,payment_status,payment_method,currency_code,
         subtotal,delivery_fee,total,paid_amount,outstanding_amount
       ) VALUES($1,$2,$3,$4,'Delivery V2E Smoke Customer','',
         'delivery','Private QA destination','ready','paid','cash','PHP',
         100,50,150,150,0)
       RETURNING id`,
      [orderNumber,orderToken,businessId,customerId]
    );
    const orderId=Number(order.rows[0]?.id);

    const delivery=await client.query(
      `INSERT INTO deliveries(
         order_id,business_id,customer_account_id,courier_account_id,status,
         delivery_fee,service_fare,platform_fee_basis_amount,currency_code,
         route_distance_km,estimated_weight_kg,estimated_volume_l,
         pickup_address,pickup_lat,pickup_lng,
         dropoff_address,dropoff_lat,dropoff_lng,vehicle_class,
         assigned_at,en_route_to_merchant_at
       ) VALUES($1,$2,$3,$4,'courier_en_route_to_merchant',
         50,50,50,'PHP',2.5,1,2,
         'Private QA pickup',14.4000,120.9000,
         'Private QA destination',14.4100,120.9100,'motorcycle',
         NOW(),NOW())
       RETURNING id,status`,
      [orderId,businessId,customerId,courierId]
    );
    const deliveryId=Number(delivery.rows[0]?.id);
    if(!deliveryRouteTrackingActive(delivery.rows[0]?.status))fail('Active route state was not recognized.');

    const first=deliveryRoutePointDecision({
      previous:null,
      next:{lat:14.4001,lng:120.9001,accuracy_m:6,heading_deg:45,speed_mps:4},
      pointCount:0
    });
    if(!first.append)fail('First route point was not accepted.');
    await client.query(
      `INSERT INTO delivery_location_points(
         delivery_id,courier_account_id,sequence_no,latitude,longitude,
         accuracy_m,heading_deg,speed_mps,delivery_status
       ) VALUES($1,$2,1,$3,$4,$5,$6,$7,'courier_en_route_to_merchant')`,
      [deliveryId,courierId,first.point.latitude,first.point.longitude,
       first.point.accuracy_m,first.point.heading_deg,first.point.speed_mps]
    );

    const duplicate=deliveryRoutePointDecision({
      previous:{
        latitude:first.point.latitude,
        longitude:first.point.longitude,
        recorded_at:new Date().toISOString()
      },
      next:{lat:14.40011,lng:120.90011,accuracy_m:7},
      pointCount:1,
      nowMs:Date.now()+3000
    });
    if(duplicate.append||duplicate.reason!=='deduplicated')fail('Near duplicate route point was not deduplicated.');

    const second=deliveryRoutePointDecision({
      previous:{
        latitude:first.point.latitude,
        longitude:first.point.longitude,
        recorded_at:new Date(Date.now()-20000).toISOString()
      },
      next:{lat:14.4020,lng:120.9020,accuracy_m:8,heading_deg:60,speed_mps:5},
      pointCount:1
    });
    if(!second.append)fail('Second distinct route point was not accepted.');
    await client.query(
      `INSERT INTO delivery_location_points(
         delivery_id,courier_account_id,sequence_no,latitude,longitude,
         accuracy_m,heading_deg,speed_mps,delivery_status
       ) VALUES($1,$2,2,$3,$4,$5,$6,$7,'in_transit')`,
      [deliveryId,courierId,second.point.latitude,second.point.longitude,
       second.point.accuracy_m,second.point.heading_deg,second.point.speed_mps]
    );

    const route=await client.query(
      `SELECT sequence_no,courier_account_id,latitude,longitude
         FROM delivery_location_points
        WHERE delivery_id=$1
        ORDER BY sequence_no`,
      [deliveryId]
    );
    if(route.rowCount!==2)fail('Production route history did not persist two ordered points.');
    if(Number(route.rows[0].sequence_no)!==1||Number(route.rows[1].sequence_no)!==2)fail('Route sequence order is incorrect.');
    if(route.rows.some(row=>Number(row.courier_account_id)!==courierId))fail('Route point Courier binding is incorrect.');

    const proof=await client.query(
      `INSERT INTO delivery_proof_media(
         delivery_id,courier_account_id,proof_type,private_evidence_object_id,
         courier_note,delivery_status
       ) VALUES($1,$2,'pickup',$3,'Rollback-only Production smoke','courier_arrived_at_merchant')
       RETURNING id,private_evidence_object_id`,
      [deliveryId,courierId,proofObject.id]
    );
    if(proof.rowCount!==1||Number(proof.rows[0].private_evidence_object_id)!==Number(proofObject.id)){
      fail('Private proof was not bound to the Delivery proof table.');
    }
    const proofColumns=await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name='delivery_proof_media'`
    );
    if(proofColumns.rows.some(row=>/data_url|base64/i.test(String(row.column_name)))){
      fail('Delivery proof table exposes a raw media column.');
    }

    await client.query(
      `UPDATE deliveries
          SET status='delivered',last_lat=NULL,last_lng=NULL,last_location_at=NULL,delivered_at=NOW()
        WHERE id=$1`,
      [deliveryId]
    );
    const terminal=await client.query('SELECT status,last_lat,last_lng,last_location_at FROM deliveries WHERE id=$1',[deliveryId]);
    if(deliveryRouteTrackingActive(terminal.rows[0]?.status))fail('Terminal Delivery still allows route tracking.');
    if(terminal.rows[0]?.last_lat!=null||terminal.rows[0]?.last_lng!=null||terminal.rows[0]?.last_location_at!=null){
      fail('Terminal Delivery retained live current-location fields.');
    }

    await client.query('ROLLBACK');
    began=false;

    await deletePrivateEvidence(pool,{
      objectId:proofObject.id,
      actorAccountId:null,
      purpose:'delivery_v2e_production_smoke_cleanup'
    });
    proofObject=null;

    console.log('PRODUCTION_DELIVERY_V2E_SMOKE_RESULT '+JSON.stringify({
      status:'PASS',
      environment:'production',
      rollback:true,
      route_points_ordered:2,
      near_duplicate_suppressed:true,
      courier_binding_verified:true,
      terminal_tracking_blocked:true,
      live_location_cleared:true,
      private_proof_storage_verified:true,
      raw_media_in_delivery_table:false,
      proof_object_deleted:true,
      real_money:false
    }));
  }catch(error){
    if(client&&began)await client.query('ROLLBACK').catch(()=>{});
    if(proofObject?.id){
      await deletePrivateEvidence(pool,{
        objectId:proofObject.id,
        actorAccountId:null,
        purpose:'delivery_v2e_production_smoke_failure_cleanup'
      }).catch(()=>{});
    }
    console.error('PRODUCTION_DELIVERY_V2E_SMOKE_RESULT '+JSON.stringify({
      status:'FAIL',
      rollback:true,
      error:String(error?.message||error).slice(0,500)
    }));
    process.exitCode=1;
  }finally{
    client?.release();
    await pool.end();
  }
}

await run();
