import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {orderReceivableAmount,ordersReceivableTotal} from '../public/orders-receivable-view.js';

test('cancelled balance is excluded while active and completed credit remain receivable',()=>{
  const orders=[{order_status:'cancelled',outstanding_amount:'1.00'},
    {order_status:'accepted',outstanding_amount:'5.00'},
    {order_status:'completed',outstanding_amount:'7.00'}];
  assert.equal(ordersReceivableTotal(orders),12);
  assert.equal(orderReceivableAmount(orders[0]),0);
});

test('paid, part-paid and refunded cancellation snapshots never become new receipts or fees',()=>{
  const orders=[
    {order_status:'cancelled',payment_status:'unpaid',total:100,paid_amount:0,outstanding_amount:100},
    {order_status:'cancelled',payment_status:'partial',total:100,paid_amount:40,outstanding_amount:60},
    {order_status:'cancelled',payment_status:'paid',total:100,paid_amount:100,outstanding_amount:0},
    {order_status:'cancelled',payment_status:'refunded',total:100,paid_amount:0,outstanding_amount:100}
  ].map(Object.freeze);
  const before=JSON.stringify(orders);
  assert.equal(ordersReceivableTotal(Object.freeze(orders)),0);
  assert.equal(JSON.stringify(orders),before);
});

test('non-cancelled balances use recorded outstanding without reconstructing payment/refund money',()=>{
  const orders=[
    {order_status:'accepted',payment_status:'partial',total:100,paid_amount:80,outstanding_amount:20},
    {order_status:'completed',payment_status:'unpaid',total:50,paid_amount:0,outstanding_amount:12},
    {order_status:'completed',payment_status:'paid',total:100,paid_amount:100,outstanding_amount:0},
    {order_status:'completed',payment_status:'refunded',total:100,paid_amount:0,outstanding_amount:0}
  ];
  assert.equal(ordersReceivableTotal(orders),32);
});

test('invalid/negative balances cannot corrupt totals and currency totals stay at cents',()=>{
  const invalid=[undefined,null,'wrong',-1,Infinity,NaN].map(outstanding_amount=>({order_status:'accepted',outstanding_amount}));
  assert.equal(ordersReceivableTotal(invalid),0);
  assert.equal(ordersReceivableTotal([{outstanding_amount:0.1},{outstanding_amount:0.2}]),0.3);
});

function browser(orders){
  const board={innerHTML:'',querySelector:()=>({}),querySelectorAll:()=>[]};
  const document={readyState:'loading',hidden:false,addEventListener(){},getElementById:()=>null};
  const context=vm.createContext({window:{},document,Intl,Date,Number,JSON,orderReceivableAmount,ordersReceivableTotal,
    fetch:async path=>({ok:true,json:async()=>path==='/api/orders/mine'||path.startsWith('/api/orders/merchant/list')?orders:[]})});
  const source=readFileSync(new URL('../public/orders-ui.js',import.meta.url),'utf8');
  assert.match(source,/import \{orderReceivableAmount,ordersReceivableTotal\} from '\.\/orders-receivable-view\.js'/);
  vm.runInContext(source.replace(/^import .*\n/,''),context);
  context.board=board;
  // Rendering/balance functions execute their real product implementation. Only
  // unrelated interaction binders are stubbed because this test has no DOM parser.
  vm.runInContext("orderWorkspace=board;merchantBusinessId=4;bindHeader=()=>{};bindDirectSaleProductForm=()=>{};bindCounterForm=()=>{};bindMerchantActions=()=>{};",context);
  return{context,board};
}

test('fresh Merchant board excludes cancelled unpaid orders without excluding completed credit',async()=>{
  const orders=[{id:1,order_status:'cancelled',outstanding_amount:1,payment_status:'unpaid'},
    {id:2,order_status:'completed',outstanding_amount:7,payment_status:'unpaid'},
    {id:3,order_status:'accepted',outstanding_amount:5,payment_status:'partial'}];
  const {context,board}=browser(orders);
  await context.renderMerchantOrders(false);
  assert.match(board.innerHTML,/<small>Receivable<\/small><strong>₱12\.00<\/strong>/);
  assert.match(board.innerHTML,/<small>Active<\/small><strong>1<\/strong>/);
});

test('Customer summary/history shows cancelled unpaid order with no amount due and no Paid claim',async()=>{
  const orders=[{id:1,order_status:'cancelled',outstanding_amount:1,payment_status:'unpaid',total:1,
    business_name:'QA Store',order_number:'QA-1',created_at:'2026-10-26T12:00:00Z',fulfilment_method:'pickup'}];
  const {context,board}=browser(orders);
  await context.renderCustomerOrders(false);
  assert.match(board.innerHTML,/<small>Amount due<\/small><strong>₱0\.00<\/strong>/);
  assert.match(board.innerHTML,/<small>No amount due<\/small>/);
  assert.doesNotMatch(board.innerHTML,/<small>Paid<\/small>/);
  assert.equal(orders[0].outstanding_amount,1);assert.equal(orders[0].payment_status,'unpaid');
});

test('zero-balance copy preserves Paid and Refunded evidence without labelling an unpaid cancellation Paid',()=>{
  const {context}=browser([]);
  assert.equal(context.orderBalanceCopy({order_status:'cancelled',payment_status:'unpaid',outstanding_amount:1}),'<small>No amount due</small>');
  assert.equal(context.orderBalanceCopy({order_status:'completed',payment_status:'paid',outstanding_amount:0}),'<small>Paid</small>');
  assert.equal(context.orderBalanceCopy({order_status:'completed',payment_status:'refunded',outstanding_amount:0}),'<small>Refunded</small>');
});
