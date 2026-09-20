export const SUPPLIER_PAYMENT_TERM_CODES=Object.freeze([
  'prepaid','cod','due_on_receipt','net_7','net_15','net_30','net_45','net_60','custom'
]);

const TERM_SET=new Set(SUPPLIER_PAYMENT_TERM_CODES);

const finite=(value,label)=>{
  const n=Number(value);
  if(!Number.isFinite(n))throw new TypeError(`${label} must be a finite number`);
  return n;
};
const nonNegative=(value,label)=>{
  const n=finite(value,label);
  if(n<0)throw new RangeError(`${label} cannot be negative`);
  return n;
};
const dateOnly=value=>{
  if(value instanceof Date){
    if(Number.isNaN(value.getTime()))throw new RangeError(`Invalid date: ${value}`);
    return new Date(value.toISOString().slice(0,10)+'T00:00:00Z');
  }
  const s=String(value??'').trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)){
    const d=new Date(s+'T00:00:00Z');
    if(Number.isNaN(d.getTime()))throw new RangeError(`Invalid date: ${value}`);
    return d;
  }
  const parsed=new Date(s);
  if(Number.isNaN(parsed.getTime()))throw new RangeError(`Invalid date: ${value}`);
  return new Date(parsed.toISOString().slice(0,10)+'T00:00:00Z');
};
const addDays=(date,days)=>{
  const d=new Date(date.getTime());
  d.setUTCDate(d.getUTCDate()+days);
  return d.toISOString().slice(0,10);
};

export function normalizePaymentTerms({
  paymentTermCode='cod',
  customDays=null,
  creditLimit=null,
  currencyCode='PHP'
}={}){
  const code=String(paymentTermCode||'cod').trim().toLowerCase();
  if(!TERM_SET.has(code))throw new RangeError(`Unsupported payment term: ${paymentTermCode}`);
  let days=null;
  if(code==='custom'){
    days=Math.trunc(finite(customDays,'customDays'));
    if(days<0||days>365)throw new RangeError('customDays must be between 0 and 365');
  }
  const limit=creditLimit==null||creditLimit===''?null:nonNegative(creditLimit,'creditLimit');
  const currency=String(currencyCode||'PHP').trim().toUpperCase().slice(0,3);
  if(!/^[A-Z]{3}$/.test(currency))throw new RangeError('currencyCode must be a three-letter code');
  return{
    payment_term_code:code,
    custom_days:days,
    credit_limit:limit,
    currency_code:currency
  };
}

export function dueDateForTerms({
  issueDate,
  receivedDate=null,
  paymentTermCode='cod',
  customDays=null
}={}){
  const terms=normalizePaymentTerms({paymentTermCode,customDays});
  const issue=dateOnly(issueDate);
  const received=receivedDate?dateOnly(String(receivedDate).slice(0,10)):null;
  const code=terms.payment_term_code;
  if(code==='prepaid')return issue.toISOString().slice(0,10);
  if(code==='cod'||code==='due_on_receipt')return (received||issue).toISOString().slice(0,10);
  const mapped={net_7:7,net_15:15,net_30:30,net_45:45,net_60:60};
  const days=code==='custom'?terms.custom_days:mapped[code];
  return addDays(issue,days??0);
}

export function commercialPosition({
  expectedTotal=0,
  receivedTotal=0,
  invoiceTotal=0,
  paidAmount=0,
  confirmedCredits=0,
  earliestDueDate=null,
  asOfDate=new Date().toISOString().slice(0,10)
}={}){
  const expected=nonNegative(expectedTotal,'expectedTotal');
  const received=nonNegative(receivedTotal,'receivedTotal');
  const invoiced=nonNegative(invoiceTotal,'invoiceTotal');
  const paid=nonNegative(paidAmount,'paidAmount');
  const credits=nonNegative(confirmedCredits,'confirmedCredits');

  const basis=invoiced>0?invoiced:(received>0?received:expected);
  const basisSource=invoiced>0?'invoice_evidence':(received>0?'received_value':'purchase_order');
  const netLiability=Math.max(0,basis-credits);
  const outstanding=Math.max(0,netLiability-paid);
  const supplierRefundOrCreditDue=Math.max(0,paid-netLiability);
  const variance=invoiced>0?Math.round((invoiced-received)*100)/100:null;
  let overdue=false;
  if(earliestDueDate&&outstanding>0){
    overdue=dateOnly(earliestDueDate).getTime()<dateOnly(asOfDate).getTime();
  }
  return{
    charge_basis:Math.round(basis*100)/100,
    charge_basis_source:basisSource,
    expected_total:Math.round(expected*100)/100,
    received_total:Math.round(received*100)/100,
    invoice_total:Math.round(invoiced*100)/100,
    paid_amount:Math.round(paid*100)/100,
    confirmed_credits:Math.round(credits*100)/100,
    net_liability:Math.round(netLiability*100)/100,
    outstanding:Math.round(outstanding*100)/100,
    supplier_refund_or_credit_due:Math.round(supplierRefundOrCreditDue*100)/100,
    invoice_vs_received_variance:variance,
    earliest_due_date:earliestDueDate||null,
    overdue
  };
}

export function returnCreditAmount({
  quantityBase,
  unitCostBase,
  explicitExpectedCredit=null
}={}){
  const qty=nonNegative(quantityBase,'quantityBase');
  const unit=nonNegative(unitCostBase,'unitCostBase');
  if(qty<=0)throw new RangeError('quantityBase must be greater than zero');
  const amount=explicitExpectedCredit==null||explicitExpectedCredit===''
    ?qty*unit
    :nonNegative(explicitExpectedCredit,'explicitExpectedCredit');
  return Math.round((amount+Number.EPSILON)*100)/100;
}
