// Historical outstanding amounts are retained after cancellation. They are not
// current receivables, and must never be reinterpreted as a cancellation fee.
export function orderReceivableAmount(order={}){
  if(order.order_status==='cancelled')return 0;
  const amount=Number(order.outstanding_amount??0);
  return Number.isFinite(amount)&&amount>0?amount:0;
}

export function ordersReceivableTotal(orders=[]){
  return Math.round(orders.reduce((total,order)=>total+orderReceivableAmount(order),0)*100)/100;
}
