import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reconcileDeliveryRefundEconomics} from '../paymongo-adapter.js';

function fakeDb({intentAmount=100,refundedAmount=100,sourceType='order',hasDelivery=true,allocations=[]}={}){
  const rows=allocations.map(x=>({...x,has_settlement_line:Boolean(x.has_settlement_line),rule_snapshot:x.rule_snapshot||{delivery_id:'77'}}));
  const updates=[];
  const audits=[];
  return{
    rows,updates,audits,
    async query(sql,args=[]){
      if(sql.includes('SELECT pi.id,pi.source_type,pi.source_id,pi.amount')){
        return{rowCount:1,rows:[{
          id:9,source_type:sourceType,source_id:44,amount:intentAmount,
          refunded_amount:refundedAmount,has_delivery:hasDelivery
        }]};
      }
      if(sql.includes("component_code IN ('courier_net','platform_fee')")&&sql.includes('FOR UPDATE')){
        return{rowCount:rows.length,rows:rows.filter(x=>!['reversed','failed'].includes(x.settlement_status))};
      }
      if(sql.startsWith('UPDATE payment_allocations SET settlement_status=')){
        const [target,id,current]=args;
        const row=rows.find(x=>Number(x.id)===Number(id));
        if(!row||row.settlement_status!==current)return{rowCount:0,rows:[]};
        row.settlement_status=target;
        updates.push({id:Number(id),from:current,to:target});
        return{rowCount:1,rows:[{id:Number(id)}]};
      }
      if(sql.includes('delivery_refund_economics_reconciled')){
        audits.push({args});
        return{rowCount:1,rows:[]};
      }
      throw new Error('Unexpected SQL in refund economics test: '+sql.slice(0,120));
    }
  };
}

test('full intent refund reverses only unsettled Delivery-derived economics',async()=>{
  const db=fakeDb({allocations:[
    {id:1,component_code:'courier_net',settlement_status:'eligible',amount:90},
    {id:2,component_code:'platform_fee',settlement_status:'held',amount:10},
    {id:3,component_code:'courier_net',settlement_status:'paid',amount:20},
    {id:4,component_code:'platform_fee',settlement_status:'manual_review',amount:2,has_settlement_line:true}
  ]});
  const result=await reconcileDeliveryRefundEconomics(db,{
    paymentIntentId:9,refundId:31,actorAccountId:1
  });
  assert.equal(result.status,'RECONCILED');
  assert.equal(result.full_intent_refund,true);
  assert.deepEqual(result.reversed_allocation_ids,[1,2]);
  assert.deepEqual(result.manual_review_allocation_ids,[3]);
  assert.deepEqual(db.updates,[
    {id:1,from:'eligible',to:'reversed'},
    {id:2,from:'held',to:'reversed'},
    {id:3,from:'paid',to:'manual_review'}
  ]);
  assert.equal(db.audits.length,1);
});

test('partial refund never guesses merchandise versus Delivery ownership',async()=>{
  const db=fakeDb({intentAmount:100,refundedAmount:25,allocations:[
    {id:5,component_code:'courier_net',settlement_status:'eligible',amount:90},
    {id:6,component_code:'platform_fee',settlement_status:'pending',amount:10}
  ]});
  const result=await reconcileDeliveryRefundEconomics(db,{paymentIntentId:9,refundId:32});
  assert.equal(result.full_intent_refund,false);
  assert.deepEqual(result.reversed_allocation_ids,[]);
  assert.deepEqual(result.manual_review_allocation_ids,[5,6]);
  assert.deepEqual(db.updates.map(x=>x.to),['manual_review','manual_review']);
  assert.equal(db.audits.length,1);
});

test('non-Delivery payment is a no-op',async()=>{
  const db=fakeDb({sourceType:'order',hasDelivery:false,allocations:[
    {id:7,component_code:'platform_fee',settlement_status:'eligible',amount:5}
  ]});
  const result=await reconcileDeliveryRefundEconomics(db,{paymentIntentId:9,refundId:33});
  assert.equal(result.status,'NOOP');
  assert.equal(result.reason,'NOT_DELIVERY_ORDER_PAYMENT');
  assert.equal(db.updates.length,0);
  assert.equal(db.audits.length,0);
});

test('reconciliation is idempotent after statuses are already corrected',async()=>{
  const db=fakeDb({allocations:[
    {id:8,component_code:'courier_net',settlement_status:'eligible',amount:90},
    {id:9,component_code:'platform_fee',settlement_status:'eligible',amount:10}
  ]});
  const first=await reconcileDeliveryRefundEconomics(db,{paymentIntentId:9,refundId:34});
  const second=await reconcileDeliveryRefundEconomics(db,{paymentIntentId:9,refundId:34});
  assert.equal(first.status,'RECONCILED');
  assert.equal(second.status,'NO_CHANGE');
  assert.equal(db.audits.length,1);
});


test('cumulative full refund can reverse prior review only when no settlement evidence exists',async()=>{
  const db=fakeDb({allocations:[
    {id:10,component_code:'courier_net',settlement_status:'manual_review',amount:90,has_settlement_line:false},
    {id:11,component_code:'platform_fee',settlement_status:'manual_review',amount:10,has_settlement_line:true}
  ]});
  const result=await reconcileDeliveryRefundEconomics(db,{paymentIntentId:9,refundId:35});
  assert.deepEqual(result.reversed_allocation_ids,[10]);
  assert.deepEqual(result.manual_review_allocation_ids,[]);
  assert.deepEqual(db.updates,[{id:10,from:'manual_review',to:'reversed'}]);
});

const moneyCore=readFileSync(new URL('../profile-money-core.js',import.meta.url),'utf8');
const moneyUi=readFileSync(new URL('../public/profile-money-ui.js',import.meta.url),'utf8');

test('Courier Money excludes refund-review allocations from displayed compensation and payout eligibility',()=>{
  assert.match(moneyCore,/settlement_status='manual_review'/);
  assert.match(moneyCore,/manual_review:money\(row\.manual_review_amount\)/);
  assert.match(moneyCore,/settlement_status NOT IN \('reversed','manual_review'\)/);
  assert.match(moneyCore,/courier_manual_review/);
  assert.match(moneyUi,/Compensation under refund review/);
  assert.match(moneyUi,/excluded from Gross compensation and is not eligible for payout/);
  assert.match(moneyUi,/Under review/);
});
