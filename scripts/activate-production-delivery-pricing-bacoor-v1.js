import pg from 'pg';
import {activateBacoorCaviteProductionPricingV1} from '../delivery-pricing-bacoor-v1.js';

const {Pool}=pg;

const pool=new Pool({
  connectionString:process.env.DATABASE_URL,
  ssl:process.env.DATABASE_URL?{rejectUnauthorized:false}:undefined
});

try{
  const result=await activateBacoorCaviteProductionPricingV1(pool);
  console.log('PRODUCTION_DELIVERY_PRICING_BACOOR_V1',JSON.stringify(result));
}finally{
  await pool.end().catch(()=>{});
}
