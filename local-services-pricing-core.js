const MONEY_LIMIT=9_999_999.99;
const QUANTITY_LIMIT=100_000;

export const SERVICE_PRICING_METHODS=Object.freeze([
  'quotation','fixed','hourly','half_day','daily','per_unit','per_sqm','inspection_then_quote'
]);
export const SERVICE_RATE_UNITS=Object.freeze(['job','hour','half_day','day','sqm','item','unit','visit']);
export const SERVICE_MATERIALS_POLICIES=Object.freeze(['included','separate','customer_supplied','mixed']);
export const SERVICE_MODES=Object.freeze(['at_customer','workshop','both']);
export const SERVICE_QUOTE_KINDS=Object.freeze(['fixed_quote','estimate','inspection','change_order']);
export const SERVICE_QUOTE_PHASES=Object.freeze(['initial','change_order']);
export const SERVICE_QUOTE_ITEM_KINDS=Object.freeze(['labor','materials','callout','travel','other']);
export const SERVICE_QUOTE_STATUSES=Object.freeze(['sent','accepted','superseded','withdrawn','declined','changes_requested','expired']);

export class ServicePricingValidationError extends Error{
  constructor(message,code='SERVICE_PRICING_INVALID'){
    super(message);
    this.name='ServicePricingValidationError';
    this.code=code;
    this.status=400;
  }
}

function text(value,max=800){return String(value??'').trim().slice(0,max)}
function member(value,allowed,fallback){return allowed.includes(value)?value:fallback}
function enumValue(value,allowed,{label,fallback}){
  const normalized=text(value,40);
  if(!normalized)return fallback;
  if(!allowed.includes(normalized))throw new ServicePricingValidationError(`${label} is unsupported`);
  return normalized;
}
function optionalNumber(value,label,{min=0,max=MONEY_LIMIT}={}){
  if(value==null||(typeof value==='string'&&!value.trim()))return null;
  const number=Number(value);
  if(!Number.isFinite(number)||number<min||number>max)throw new ServicePricingValidationError(`${label} is invalid`);
  return number;
}
function money(value,label,{required=true}={}){
  if(!required&&(value===''||value==null))return null;
  const number=optionalNumber(value,label);
  if(number==null)throw new ServicePricingValidationError(`${label} is required`);
  return Math.round((number+Number.EPSILON)*100)/100;
}
function quantity(value,label='Quantity'){
  const number=Number(value);
  if(!Number.isFinite(number)||number<=0||number>QUANTITY_LIMIT)throw new ServicePricingValidationError(`${label} must be greater than zero`);
  return Math.round((number+Number.EPSILON)*1000)/1000;
}
function signedMoney(value,label){
  const number=Number(value);
  if(!Number.isFinite(number)||Math.abs(number)>MONEY_LIMIT)throw new ServicePricingValidationError(`${label} is invalid`);
  return Math.round((number+Number.EPSILON)*100)/100;
}
function pricingIntegrity(message){
  const error=new ServicePricingValidationError(message,'SERVICE_JOB_PRICE_INTEGRITY_MISMATCH');
  error.status=409;
  return error;
}
function integrityMoney(value,label){
  try{return money(value,label)}catch{throw pricingIntegrity(`${label} is invalid in the Service Job pricing snapshot`)}
}
function integrityMoneyCents(value,label){
  return Math.round(integrityMoney(value,label)*100);
}
function integritySignedMoney(value,label){
  try{return signedMoney(value,label)}catch{throw pricingIntegrity(`${label} is invalid in the Service Job pricing snapshot`)}
}
export function moneyCents(value,label='Amount'){
  return Math.round(money(value,label)*100);
}
export function centsMoney(cents){return Number((Number(cents||0)/100).toFixed(2))}

export function serviceJobPayableSnapshot(job={}){
  const hasAcceptedId=job.accepted_quote_id!==undefined&&job.accepted_quote_id!==null&&job.accepted_quote_id!=='';
  const hasAgreedTotal=job.agreed_total!==undefined&&job.agreed_total!==null&&job.agreed_total!=='';
  const hasPricingSnapshot=hasAcceptedId||hasAgreedTotal||Boolean(job.pricing_locked_at);

  if(hasPricingSnapshot){
    const acceptedQuoteId=Number(job.accepted_quote_id);
    if(!hasAcceptedId||!Number.isInteger(acceptedQuoteId)||acceptedQuoteId<=0||!hasAgreedTotal){
      throw pricingIntegrity('Service Job pricing snapshot is incomplete');
    }
    const agreedTotal=integrityMoney(job.agreed_total,'Agreed total');
    const legacyAdjustment=job.legacy_final_adjustment===undefined||job.legacy_final_adjustment===null||job.legacy_final_adjustment===''
      ?null:integritySignedMoney(job.legacy_final_adjustment,'Legacy final adjustment');
    const payableCents=moneyCents(agreedTotal)+(legacyAdjustment==null?0:Math.round(legacyAdjustment*100));
    if(payableCents<0||payableCents>Math.round(MONEY_LIMIT*100))throw pricingIntegrity('Service Job payable value is invalid');
    const payableValue=centsMoney(payableCents);
    if(job.status==='completed'&&job.final_price!==undefined&&job.final_price!==null&&job.final_price!==''&&integrityMoneyCents(job.final_price,'Final price')!==payableCents){
      throw pricingIntegrity('Completed Service Job price differs from its approved pricing snapshot');
    }
    return{
      payable_value:payableValue,
      payable_authority:'accepted_quote_snapshot',
      accepted_quote_id:acceptedQuoteId,
      agreed_total:agreedTotal,
      legacy_final_adjustment:legacyAdjustment
    };
  }

  const legacySource=job.final_price!==undefined&&job.final_price!==null&&job.final_price!==''?'final_price':'quote_amount';
  const legacyValue=legacySource==='final_price'?job.final_price:job.quote_amount;
  return{
    payable_value:legacyValue===undefined||legacyValue===null||legacyValue===''?0:integrityMoney(legacyValue,'Legacy Service Job price'),
    payable_authority:`legacy_${legacySource}`,
    accepted_quote_id:null,
    agreed_total:null,
    legacy_final_adjustment:null
  };
}

export function resolveAcceptedServiceJobPayable(job={},acceptedQuote=null){
  const snapshot=serviceJobPayableSnapshot(job);
  if(snapshot.accepted_quote_id==null)return snapshot;
  if(!acceptedQuote||Number(acceptedQuote.id)!==snapshot.accepted_quote_id||Number(acceptedQuote.job_id)!==Number(job.id)){
    throw pricingIntegrity('Service Job accepted quote snapshot is missing');
  }
  if(acceptedQuote.status!=='accepted')throw pricingIntegrity('Service Job accepted quote is no longer accepted');
  if(integrityMoneyCents(acceptedQuote.total_amount,'Accepted quote total')!==integrityMoneyCents(snapshot.agreed_total,'Agreed total')){
    throw pricingIntegrity('Service Job agreed total differs from the accepted quote');
  }
  if(acceptedQuote.currency_code&&job.currency_code&&acceptedQuote.currency_code!==job.currency_code){
    throw pricingIntegrity('Service Job currency differs from the accepted quote');
  }
  const legacyQuote=acceptedQuote.legacy_record===true;
  if(snapshot.legacy_final_adjustment!=null&&!legacyQuote){
    throw pricingIntegrity('Only a migrated legacy quote may carry a legacy final adjustment');
  }
  return{
    ...snapshot,
    payable_authority:legacyQuote
      ?(snapshot.legacy_final_adjustment==null?'legacy_accepted_quote':'legacy_accepted_quote_plus_adjustment')
      :'accepted_quote'
  };
}

export function normalizeServicePriceOffer(input={}){
  const pricingMethod=enumValue(input.pricing_method,SERVICE_PRICING_METHODS,{label:'Pricing method',fallback:'quotation'});
  const defaultUnit={
    fixed:'job',hourly:'hour',half_day:'half_day',daily:'day',per_unit:'unit',per_sqm:'sqm',inspection_then_quote:'visit',quotation:'job'
  }[pricingMethod];
  const rateUnit=enumValue(input.rate_unit,SERVICE_RATE_UNITS,{label:'Rate unit',fallback:defaultUnit});
  const priceFrom=money(input.price_from,'Price from',{required:false});
  const priceTo=money(input.price_to,'Price to',{required:false});
  if(priceFrom!=null&&priceTo!=null&&priceTo<priceFrom)throw new ServicePricingValidationError('Price to cannot be lower than price from');
  const minimumCharge=money(input.minimum_charge,'Minimum charge',{required:false});
  const calloutFee=money(input.callout_fee,'Call-out or inspection fee',{required:false});
  return{
    pricing_method:pricingMethod,
    rate_unit:rateUnit,
    price_from:priceFrom,
    price_to:priceTo,
    minimum_charge:minimumCharge,
    callout_fee:calloutFee,
    materials_policy:enumValue(input.materials_policy,SERVICE_MATERIALS_POLICIES,{label:'Materials policy',fallback:'separate'}),
    service_mode:enumValue(input.service_mode,SERVICE_MODES,{label:'Service mode',fallback:'at_customer'}),
    pricing_note:text(input.pricing_note,600)
  };
}

export function normalizeServiceQuoteLine(input={},index=0){
  const itemKind=member(text(input.item_kind,30),SERVICE_QUOTE_ITEM_KINDS,null);
  if(!itemKind)throw new ServicePricingValidationError(`Quote item ${index+1} has an unsupported type`);
  const description=text(input.description,240);
  if(!description)throw new ServicePricingValidationError(`Quote item ${index+1} needs a description`);
  const unitCode=member(text(input.unit_code,30),SERVICE_RATE_UNITS,null);
  if(!unitCode)throw new ServicePricingValidationError(`Quote item ${index+1} has an unsupported unit`);
  const normalizedQuantity=quantity(input.quantity,`Quote item ${index+1} quantity`);
  const unitPrice=money(input.unit_price,`Quote item ${index+1} unit price`);
  const subtotalCents=Math.round(normalizedQuantity*moneyCents(unitPrice));
  if(subtotalCents>Math.round(MONEY_LIMIT*100))throw new ServicePricingValidationError(`Quote item ${index+1} subtotal is too large`);
  if(input.subtotal!==undefined&&input.subtotal!==null&&moneyCents(input.subtotal,`Quote item ${index+1} subtotal`)!==subtotalCents){
    throw new ServicePricingValidationError(`Quote item ${index+1} subtotal must be calculated by the server`,'SERVICE_QUOTE_TOTAL_MISMATCH');
  }
  return{
    item_kind:itemKind,
    description,
    quantity:normalizedQuantity,
    unit_code:unitCode,
    unit_price:unitPrice,
    subtotal:centsMoney(subtotalCents)
  };
}

function legacyLine(input){
  if(input.quote_amount===undefined||input.quote_amount===null)return null;
  return{
    item_kind:'labor',
    description:text(input.quote_note,240)||'Service work described in the request',
    quantity:1,
    unit_code:'job',
    unit_price:input.quote_amount
  };
}

function validUntil(value,now){
  if(value===''||value==null)return new Date(now.getTime()+7*24*60*60*1000).toISOString();
  const date=new Date(value);
  if(Number.isNaN(date.getTime())||date.getTime()<=now.getTime())throw new ServicePricingValidationError('Quote validity must end in the future');
  if(date.getTime()>now.getTime()+90*24*60*60*1000)throw new ServicePricingValidationError('Quote validity cannot exceed 90 days');
  return date.toISOString();
}

export function normalizeServiceQuote(input={},options={}){
  const now=options.now instanceof Date?options.now:new Date(options.now||Date.now());
  const quoteKind=enumValue(input.quote_kind,SERVICE_QUOTE_KINDS,{label:'Quote kind',fallback:'fixed_quote'});
  const quotePhase=quoteKind==='change_order'?'change_order':'initial';
  const sourceLines=Array.isArray(input.line_items)&&input.line_items.length?input.line_items:[legacyLine(input)].filter(Boolean);
  if(!sourceLines.length)throw new ServicePricingValidationError('Add at least one quote item');
  if(sourceLines.length>30)throw new ServicePricingValidationError('A quote can contain at most 30 items');
  const lineItems=sourceLines.map(normalizeServiceQuoteLine);
  const totals={labor:0,materials:0,callout:0,travel:0,other:0};
  for(const line of lineItems)totals[line.item_kind]+=moneyCents(line.subtotal);
  const totalCents=Object.values(totals).reduce((sum,value)=>sum+value,0);
  if(totalCents>Math.round(MONEY_LIMIT*100))throw new ServicePricingValidationError('Quote total is too large');
  if(input.total_amount!==undefined&&input.total_amount!==null&&moneyCents(input.total_amount,'Quote total')!==totalCents){
    throw new ServicePricingValidationError('Quote total must be calculated by the server','SERVICE_QUOTE_TOTAL_MISMATCH');
  }
  const durationValue=optionalNumber(input.estimated_duration_value,'Estimated duration',{min:0.01,max:10_000});
  const durationUnit=durationValue==null?null:member(text(input.estimated_duration_unit,20),['hour','day'],null);
  if(durationValue!=null&&!durationUnit)throw new ServicePricingValidationError('Choose hours or days for the estimated duration');
  const scopeSummary=text(input.scope_summary||input.quote_note,1200)||'Service work described in the request';
  return{
    quote_kind:quoteKind,
    quote_phase:quotePhase,
    scope_summary:scopeSummary,
    materials_policy:enumValue(input.materials_policy,SERVICE_MATERIALS_POLICIES,{label:'Materials policy',fallback:'separate'}),
    currency_code:'PHP',
    labor_amount:centsMoney(totals.labor),
    materials_amount:centsMoney(totals.materials),
    callout_amount:centsMoney(totals.callout),
    travel_amount:centsMoney(totals.travel),
    other_amount:centsMoney(totals.other),
    total_amount:centsMoney(totalCents),
    estimated_duration_value:durationValue,
    estimated_duration_unit:durationUnit,
    valid_until:validUntil(input.valid_until,now),
    inclusions:text(input.inclusions,1200),
    exclusions:text(input.exclusions,1200),
    terms:text(input.terms,1200),
    line_items:lineItems
  };
}

export function quoteIsExpired(quote,now=new Date()){
  const expiry=new Date(quote?.valid_until||0);
  return Number.isNaN(expiry.getTime())||expiry.getTime()<=new Date(now).getTime();
}

export function acceptedCompletionPrice({acceptedTotal,requestedFinalPrice}){
  const accepted=money(acceptedTotal,'Accepted quote total');
  if(requestedFinalPrice!==undefined&&requestedFinalPrice!==null&&requestedFinalPrice!==''){
    const requested=money(requestedFinalPrice,'Final price');
    if(moneyCents(requested)!==moneyCents(accepted)){
      const error=new ServicePricingValidationError('Final price differs from the latest Customer-accepted quote. Send a change order for Customer approval.','SERVICE_CHANGE_ORDER_REQUIRED');
      error.status=409;
      throw error;
    }
  }
  return accepted;
}
