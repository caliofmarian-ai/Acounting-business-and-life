import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {allocateCourierCompensation} from '../courier-compensation-core.js';

const core=readFileSync(new URL('../courier-compensation-core.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../server-delivery.js',import.meta.url),'utf8');

function fakeDb({initialCourier=null,policy=null,refundCount=0,refundAmount=0,evidence=[]}={}){
  const inserted=[];
  let existingChecks=0;
  return{
    inserted,
    async query(sql,args=[]){
      if(sql.includes("pa.component_code='courier_net'")&&sql.includes('COUNT(*)::int allocation_count')){
        existingChecks++;
        if(existingChecks===1&&initialCourier){
          return{rows:[{allocation_count:initialCourier.count,amount:initialCourier.amount}]};
        }
        const courier=inserted.filter(x=>x.component==='courier_net');
        return{rows:[{allocation_count:courier.length,amount:courier.reduce((s,x)=>s+x.amount,0)}]};
      }
      if(sql.includes('FROM fee_policy_versions p')){
        return{rows:policy?[policy]:[]};
      }
      if(sql.includes('FROM refunds r')){
        return{rows:[{refund_count:refundCount,refunded_amount:refundAmount}]};
      }
      if(sql.includes("pa.component_code='delivery'")){
        return{rows:evidence};
      }
      if(sql.includes('INSERT INTO payment_allocations')){
        if(sql.includes("'courier_net'")){
          inserted.push({component:'courier_net',payment_intent_id:Number(args[0]),gross_base:Number(args[2]),amount:Number(args[3]),fee_policy_version_id:args[5],snapshot:JSON.parse(args[6])});
          return{rowCount:1,rows:[{id:1000+inserted.length}]};
        }
        if(sql.includes("'platform_fee'")){
          inserted.push({component:'platform_fee',payment_intent_id:Number(args[0]),gross_base:Number(args[1]),amount:Number(args[2]),fee_policy_version_id:args[4],snapshot:JSON.parse(args[5])});
          return{rowCount:1,rows:[{id:2000+inserted.length}]};
        }
      }
      throw new Error('Unexpected SQL in fake courier compensation DB: '+sql.slice(0,120));
    }
  };
}

const baseInput={
  deliveryId:44,
  orderId:33,
  courierAccountId:22,
  territoryId:11,
  deliveryPrice:100,
  feeBasis:100,
  passThrough:0,
  currencyCode:'PHP',
  completedAt:'2026-09-26T10:00:00Z'
};

test('30-day promotional delivery allocates 100% verified fee basis to courier_net',async()=>{
  const db=fakeDb({evidence:[
    {payment_intent_id:1,delivery_allocation_id:10,delivery_amount:'30.00',currency_code:'PHP',settlement_status:'eligible'},
    {payment_intent_id:2,delivery_allocation_id:11,delivery_amount:'70.00',currency_code:'PHP',settlement_status:'eligible'}
  ]});
  const result=await allocateCourierCompensation(db,{...baseInput,phase:'promotional'});
  assert.equal(result.status,'TRACKED');
  assert.equal(result.platform_rate_pct,0);
  assert.equal(result.business_life_delivery_fee,0);
  assert.equal(result.courier_gross_entitlement,100);
  assert.equal(result.tracked_courier_amount,100);
  assert.equal(result.settlement_status,'eligible');
  assert.equal(result.payout_status,'NOT_EXECUTED');
  const courier=db.inserted.filter(x=>x.component==='courier_net');
  assert.equal(courier.length,2);
  assert.equal(courier.reduce((s,x)=>s+x.amount,0),100);
  assert.equal(db.inserted.filter(x=>x.component==='platform_fee').length,0);
  assert.ok(courier.every(x=>x.fee_policy_version_id==null));
  assert.ok(courier.every(x=>x.snapshot.phase==='promotional'&&x.snapshot.promotional_days===30));
});

test('pass-through amounts are excluded from Courier production-fee basis',async()=>{
  const db=fakeDb({evidence:[
    {payment_intent_id:1,delivery_allocation_id:10,delivery_amount:'120.00',currency_code:'PHP',settlement_status:'eligible'}
  ]});
  const result=await allocateCourierCompensation(db,{
    ...baseInput,deliveryPrice:120,feeBasis:100,passThrough:20,phase:'promotional'
  });
  assert.equal(result.compensation_basis,100);
  assert.equal(result.excluded_pass_through,20);
  assert.equal(result.courier_gross_entitlement,100);
});

test('post-promo Courier allocation stays HOLD until exact active 10% delivery policy exists',async()=>{
  const db=fakeDb();
  const result=await allocateCourierCompensation(db,{...baseInput,phase:'post_promo'});
  assert.equal(result.status,'HOLD');
  assert.equal(result.reason,'POST_PROMO_DELIVERY_POLICY_NOT_ACTIVE');
  assert.equal(result.owner_approved_rate_pct,10);
  assert.equal(db.inserted.length,0);
});

test('active post-promo delivery policy allocates 90% courier_net and 10% Business & Life fee',async()=>{
  const db=fakeDb({
    policy:{
      id:77,policy_code:'delivery-production',version:3,status:'active',country_code:'PH',
      territory_id:null,service_scope:'delivery',effective_from:'2026-09-01T00:00:00Z',
      effective_until:null,protected_platform_policy:true,rule_id:88,rate:'10',
      component_code:'platform_fee',base_component:'delivery',charged_to:'courier_deduction',
      beneficiary_type:'platform',calculation_type:'percentage'
    },
    evidence:[
      {payment_intent_id:5,delivery_allocation_id:51,delivery_amount:'40.00',currency_code:'PHP',settlement_status:'eligible'},
      {payment_intent_id:6,delivery_allocation_id:52,delivery_amount:'60.00',currency_code:'PHP',settlement_status:'eligible'}
    ]
  });
  const result=await allocateCourierCompensation(db,{...baseInput,phase:'post_promo'});
  assert.equal(result.status,'TRACKED');
  assert.equal(result.platform_rate_pct,10);
  assert.equal(result.business_life_delivery_fee,10);
  assert.equal(result.courier_gross_entitlement,90);
  assert.equal(result.tracked_courier_amount,90);
  assert.equal(result.policy.id,77);
  const courier=db.inserted.filter(x=>x.component==='courier_net');
  const platform=db.inserted.filter(x=>x.component==='platform_fee');
  assert.equal(courier.reduce((s,x)=>s+x.amount,0),90);
  assert.equal(platform.reduce((s,x)=>s+x.amount,0),10);
  assert.ok([...courier,...platform].every(x=>x.fee_policy_version_id===77));
});

test('succeeded refund holds new Courier compensation for allocation review',async()=>{
  const db=fakeDb({refundCount:1,refundAmount:25});
  const result=await allocateCourierCompensation(db,{...baseInput,phase:'promotional'});
  assert.equal(result.status,'HOLD');
  assert.equal(result.reason,'ORDER_REFUND_REQUIRES_ALLOCATION_REVIEW');
  assert.equal(result.refunded_amount,25);
  assert.equal(db.inserted.length,0);
});

test('delivery payment mismatch cannot create Courier earnings',async()=>{
  const db=fakeDb({evidence:[
    {payment_intent_id:5,delivery_allocation_id:51,delivery_amount:'95.00',currency_code:'PHP',settlement_status:'eligible'}
  ]});
  const result=await allocateCourierCompensation(db,{...baseInput,phase:'promotional'});
  assert.equal(result.status,'HOLD');
  assert.equal(result.reason,'DELIVERY_PAYMENT_AMOUNT_MISMATCH');
  assert.equal(db.inserted.length,0);
});

test('existing courier_net evidence makes compensation idempotent',async()=>{
  const db=fakeDb({initialCourier:{count:1,amount:100}});
  const result=await allocateCourierCompensation(db,{...baseInput,phase:'promotional'});
  assert.equal(result.status,'TRACKED');
  assert.equal(result.reason,'IDEMPOTENT_EXISTING');
  assert.equal(result.courier_gross_entitlement,100);
  assert.equal(db.inserted.length,0);
});

test('runtime allocates compensation only after verified Delivery completion and monetization phase',()=>{
  const completeStart=server.indexOf("app.post('/api/courier/deliveries/:id/complete'");
  const completeEnd=server.indexOf("app.get('/api/delivery/mine'",completeStart);
  const block=server.slice(completeStart,completeEnd);
  const delivered=block.indexOf("SET status='delivered'");
  const monetization=block.indexOf("recordMonetizableCompletion(client,{serviceScope:'delivery'");
  const compensation=block.indexOf('allocateCourierCompensation(client');
  const commit=block.indexOf("client.query('COMMIT')");
  assert.ok(delivered>=0&&monetization>delivered&&compensation>monetization&&commit>compensation);
  assert.match(block,/deliveryPrice:Number\(x\.delivery_fee\|\|0\)/);
  assert.match(block,/feeBasis:deliveryFeeBasis/);
  assert.match(block,/passThrough:Number\(x\.pass_through_amount\|\|0\)/);
});

test('Courier compensation never marks payout paid and post-promo needs protected active policy',()=>{
  assert.match(core,/settlement_status[^\n]*'eligible'/);
  assert.match(core,/payout_status:'NOT_EXECUTED'/);
  assert.doesNotMatch(core,/courier_net[^\n]*settlement_status[^\n]*'paid'/);
  assert.match(core,/p\.status='active'/);
  assert.match(core,/p\.protected_platform_policy=TRUE/);
  assert.match(core,/r\.charged_to='courier_deduction'/);
  assert.match(core,/ABS\(COALESCE\(r\.rate,0\)-\$3::numeric\)/);
});
