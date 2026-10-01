import {normalizeVehiclePricingRule} from './delivery-pricing-v2-core.js';

export const BACOOR_CAVITE_PRICING_V1_KEY='bacoor-cavite-market-2026-10-01-v1';

export const BACOOR_CAVITE_PRICING_V1=Object.freeze({
  activation_key:BACOOR_CAVITE_PRICING_V1_KEY,
  country_code:'PH',
  currency_code:'PHP',
  benchmark_date:'2026-10-01',
  route_factor:1.15,
  maximum_distance_km:40,
  average_speed_bicycle_kmh:null,
  average_speed_motorbike_kmh:30,
  average_speed_car_kmh:25,
  source_urls:Object.freeze([
    'https://www.lalamove.com/en-ph/all-delivery-pricing-detail?city=manila',
    'https://www.lalamove.com/en-ph/',
    'https://www.lalamove.com/en-ph/personal'
  ]),
  vehicle_rules:Object.freeze([
    Object.freeze({
      vehicle_class:'motorcycle',
      formula_type:'tiered_distance',
      priority:1,
      base_fee:49,
      included_distance_km:0,
      distance_bands:Object.freeze([
        Object.freeze({up_to_km:5,per_km:6}),
        Object.freeze({up_to_km:null,per_km:5})
      ]),
      minimum_fee:49,
      maximum_distance_km:40,
      max_weight_kg:20,
      max_volume_l:100,
      extra_stop_fee:40,
      free_wait_minutes:30,
      waiting_fee_per_minute:1,
      demand_adjustment_cap_pct:0,
      route_profile:'motorcycle_no_expressway',
      expressway_eligible:false,
      toll_policy:'disabled',
      parking_policy:'pass_through',
      stacking_policy:'direct_only'
    }),
    Object.freeze({
      vehicle_class:'sedan',
      formula_type:'tiered_distance',
      priority:2,
      base_fee:100,
      included_distance_km:0,
      distance_bands:Object.freeze([
        Object.freeze({up_to_km:5,per_km:18}),
        Object.freeze({up_to_km:null,per_km:15})
      ]),
      minimum_fee:100,
      maximum_distance_km:40,
      max_weight_kg:200,
      max_volume_l:420,
      extra_stop_fee:45,
      free_wait_minutes:30,
      waiting_fee_per_minute:1.67,
      demand_adjustment_cap_pct:0,
      route_profile:'car_optional_tolls',
      expressway_eligible:true,
      toll_policy:'pass_through',
      parking_policy:'pass_through',
      stacking_policy:'direct_only'
    }),
    Object.freeze({
      vehicle_class:'l300_van',
      formula_type:'tiered_distance',
      priority:3,
      base_fee:280,
      included_distance_km:0,
      distance_bands:Object.freeze([
        Object.freeze({up_to_km:null,per_km:20})
      ]),
      minimum_fee:280,
      maximum_distance_km:40,
      max_weight_kg:1000,
      max_volume_l:3024,
      extra_stop_fee:100,
      free_wait_minutes:60,
      waiting_fee_per_minute:2.5,
      demand_adjustment_cap_pct:0,
      route_profile:'light_commercial_optional_tolls',
      expressway_eligible:true,
      toll_policy:'pass_through',
      parking_policy:'pass_through',
      stacking_policy:'direct_only'
    })
  ])
});

export function normalizedBacoorCavitePricingV1Rules(){
  return BACOOR_CAVITE_PRICING_V1.vehicle_rules.map(rule=>normalizeVehiclePricingRule(rule));
}

function environmentName(env={}){
  return String(env.RAILWAY_ENVIRONMENT_NAME||env.APP_ENV||'').trim().toLowerCase();
}

export async function activateBacoorCaviteProductionPricingV1(pool,{env=process.env}={}){
  if(environmentName(env)!=='production'){
    throw new Error('Bacoor/Cavite commercial pricing activation is restricted to the Production environment');
  }
  if(!pool?.connect)throw new Error('A PostgreSQL pool is required');

  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS delivery_pricing_activation_markers(
        activation_key TEXT PRIMARY KEY,
        pricing_rule_id BIGINT NOT NULL REFERENCES delivery_pricing_rules(id) ON DELETE RESTRICT,
        country_code TEXT NOT NULL,
        benchmark_date DATE NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const marker=await client.query(
      'SELECT activation_key,pricing_rule_id,activated_at FROM delivery_pricing_activation_markers WHERE activation_key=$1 FOR UPDATE',
      [BACOOR_CAVITE_PRICING_V1_KEY]
    );
    if(marker.rowCount){
      await client.query('COMMIT');
      return{
        status:'already_applied',
        activation_key:BACOOR_CAVITE_PRICING_V1_KEY,
        pricing_rule_id:Number(marker.rows[0].pricing_rule_id),
        activated_at:marker.rows[0].activated_at
      };
    }

    const active=await client.query(
      "SELECT id,version FROM delivery_pricing_rules WHERE country_code='PH' AND active=TRUE ORDER BY version DESC LIMIT 1 FOR UPDATE"
    );
    if(active.rowCount){
      throw new Error(
        'Refusing Bacoor/Cavite activation because PH already has active Delivery pricing rule version '+
        String(active.rows[0].version)
      );
    }

    const next=await client.query(
      "SELECT COALESCE(MAX(version),0)+1 version FROM delivery_pricing_rules WHERE country_code='PH'"
    );
    const version=Number(next.rows[0].version);
    const pricing=BACOOR_CAVITE_PRICING_V1;
    const parent=await client.query(`
      INSERT INTO delivery_pricing_rules(
        country_code,version,active,base_fee,per_km,per_kg,per_liter,minimum_fee,
        maximum_distance_km,route_factor,
        average_speed_bicycle_kmh,average_speed_motorbike_kmh,average_speed_car_kmh,
        created_by_account_id
      ) VALUES('PH',$1,TRUE,0,0,0,0,0,$2,$3,$4,$5,$6,NULL)
      RETURNING id,version,active
    `,[
      version,
      pricing.maximum_distance_km,
      pricing.route_factor,
      pricing.average_speed_bicycle_kmh,
      pricing.average_speed_motorbike_kmh,
      pricing.average_speed_car_kmh
    ]);
    const pricingRuleId=Number(parent.rows[0].id);

    const normalized=normalizedBacoorCavitePricingV1Rules();
    for(const rule of normalized){
      await client.query(`
        INSERT INTO delivery_vehicle_pricing_rules(
          pricing_rule_id,vehicle_class,formula_type,priority,
          base_fee,per_km,per_kg,per_liter,minimum_fee,
          maximum_distance_km,max_weight_kg,max_volume_l,
          included_distance_km,distance_bands,extra_stop_fee,free_wait_minutes,waiting_fee_per_minute,
          demand_adjustment_cap_pct,route_profile,expressway_eligible,toll_policy,parking_policy,stacking_policy
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18,$19,$20,$21,$22,$23)
      `,[
        pricingRuleId,rule.vehicle_class,rule.formula_type,rule.priority,
        rule.base_fee,rule.per_km,rule.per_kg,rule.per_liter,rule.minimum_fee,
        rule.maximum_distance_km,rule.max_weight_kg,rule.max_volume_l,
        rule.included_distance_km,JSON.stringify(rule.distance_bands),rule.extra_stop_fee,
        rule.free_wait_minutes,rule.waiting_fee_per_minute,rule.demand_adjustment_cap_pct,
        rule.route_profile,rule.expressway_eligible,rule.toll_policy,rule.parking_policy,rule.stacking_policy
      ]);
    }

    await client.query(`
      INSERT INTO delivery_pricing_activation_markers(
        activation_key,pricing_rule_id,country_code,benchmark_date,metadata
      ) VALUES($1,$2,'PH',$3,$4::jsonb)
    `,[
      BACOOR_CAVITE_PRICING_V1_KEY,
      pricingRuleId,
      pricing.benchmark_date,
      JSON.stringify({
        market:'Bacoor/Cavite',
        currency_code:pricing.currency_code,
        sources:pricing.source_urls,
        demand_adjustment_pct:0,
        note:'Owner-approved Production V1 benchmark activation'
      })
    ]);

    await client.query('COMMIT');
    return{
      status:'activated',
      activation_key:BACOOR_CAVITE_PRICING_V1_KEY,
      pricing_rule_id:pricingRuleId,
      version,
      active:true,
      vehicle_classes:normalized.map(rule=>rule.vehicle_class)
    };
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{
    client.release();
  }
}
