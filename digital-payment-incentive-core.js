export const PAYMONGO_PH_BENCHMARK_AS_OF='2026-09-19';

export const PAYMONGO_PH_PAYMENT_BENCHMARKS=Object.freeze({
  qrph:Object.freeze({
    code:'qrph',
    label:'QR Ph',
    variable_rate_pct:1.34,
    fixed_fee_php:0,
    published_fee_excludes_vat:true,
    source:'https://www.paymongo.com/en/pricing',
    note:'QR Ph online published standard rate. Compatible payer apps include participating banks/e-wallets such as GCash and Maya.'
  }),
  gcash:Object.freeze({
    code:'gcash',
    label:'GCash',
    variable_rate_pct:2.23,
    fixed_fee_php:0,
    published_fee_excludes_vat:true,
    source:'https://www.paymongo.com/en/pricing',
    note:'Direct GCash e-wallet published standard rate.'
  }),
  paymaya:Object.freeze({
    code:'paymaya',
    label:'Maya',
    variable_rate_pct:1.79,
    fixed_fee_php:0,
    published_fee_excludes_vat:true,
    source:'https://www.paymongo.com/en/pricing',
    note:'Direct Maya e-wallet published standard rate.'
  }),
  card:Object.freeze({
    code:'card',
    label:'Domestic Visa / Mastercard',
    variable_rate_pct:3.125,
    fixed_fee_php:13.39,
    published_fee_excludes_vat:true,
    source:'https://www.paymongo.com/en/pricing',
    note:'Domestic card published standard rate. International card pricing differs.'
  })
});

const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const num=(v,label,{min=0,max=1e12}={})=>{
  const n=Number(v??0);
  if(!Number.isFinite(n)||n<min||n>max)throw Object.assign(new Error(label+' is invalid'),{status:400});
  return n;
};
const pct=(v,label)=>num(v,label,{min:0,max:100});

export function payMongoRailCost(amount,railCode,{providerFeeTaxPct=0}={}){
  const commercialAmount=money(num(amount,'commercial amount'));
  const rail=PAYMONGO_PH_PAYMENT_BENCHMARKS[String(railCode||'').toLowerCase()];
  if(!rail)throw Object.assign(new Error('Unsupported PayMongo benchmark rail'),{status:400});
  const baseVariable=money(commercialAmount*rail.variable_rate_pct/100);
  const baseFixed=money(rail.fixed_fee_php);
  const publishedFee=money(baseVariable+baseFixed);
  const taxPct=pct(providerFeeTaxPct,'provider fee tax/VAT percent');
  const feeTax=money(publishedFee*taxPct/100);
  const estimatedTotalProcessorCost=money(publishedFee+feeTax);
  return{
    benchmark_as_of:PAYMONGO_PH_BENCHMARK_AS_OF,
    commercial_amount:commercialAmount,
    rail_code:rail.code,
    rail_label:rail.label,
    published_variable_rate_pct:rail.variable_rate_pct,
    published_fixed_fee_php:rail.fixed_fee_php,
    published_fee_excludes_vat:rail.published_fee_excludes_vat,
    published_fee_before_tax:publishedFee,
    modeled_provider_fee_tax_pct:taxPct,
    modeled_provider_fee_tax:feeTax,
    modeled_total_processor_cost:estimatedTotalProcessorCost,
    source:rail.source,
    note:rail.note
  };
}

export function digitalPaymentIncentiveScenario(input={}){
  const amount=money(num(input.commercialAmount,'commercial amount'));
  const railCode=String(input.railCode||'');
  const cashHandlingPct=pct(input.cashHandlingCostPct,'cash handling cost percent');
  const cashHandlingFixed=money(num(input.cashHandlingFixedCost,'cash handling fixed cost'));
  const providerFeeTaxPct=pct(input.providerFeeTaxPct,'provider fee tax/VAT percent');
  const returnSavingsPct=pct(input.returnSavingsPct,'returned savings percent');
  const creditCap=input.creditCap==null||input.creditCap===''?null:money(num(input.creditCap,'credit cap'));
  const budgetRemaining=input.growthBudgetRemaining==null||input.growthBudgetRemaining===''?null:money(num(input.growthBudgetRemaining,'growth budget remaining'));

  const processor=payMongoRailCost(amount,railCode,{providerFeeTaxPct});
  const cashVariable=money(amount*cashHandlingPct/100);
  const modeledCashCost=money(cashVariable+cashHandlingFixed);
  const grossOperationalSavings=money(modeledCashCost-processor.modeled_total_processor_cost);
  const supportableSavings=money(Math.max(0,grossOperationalSavings));
  const rawCredit=money(supportableSavings*returnSavingsPct/100);
  const afterCreditCap=creditCap==null?rawCredit:money(Math.min(rawCredit,creditCap));
  const finalCredit=budgetRemaining==null?afterCreditCap:money(Math.min(afterCreditCap,budgetRemaining));
  const retainedSavings=money(supportableSavings-finalCredit);
  const netCompanyImpact=money(grossOperationalSavings-finalCredit);

  let state='SUPPORTED';
  if(grossOperationalSavings<=0)state='NO_ECONOMIC_SAVINGS';
  else if(finalCredit<=0)state='SAVINGS_EXIST_BUT_NO_CREDIT_CONFIGURED';
  else if(budgetRemaining!=null&&budgetRemaining<=0)state='BUDGET_EXHAUSTED';

  return{
    simulation_only:true,
    applies_live_credit:false,
    currency_code:'PHP',
    state,
    provider_cost:processor,
    cash_cost_model:{
      cash_handling_cost_pct:cashHandlingPct,
      cash_handling_fixed_cost:cashHandlingFixed,
      modeled_cash_variable_cost:cashVariable,
      modeled_cash_total_cost:modeledCashCost,
      evidence_status:'OWNER_ASSUMPTION_OR_MEASURED_INPUT'
    },
    incentive:{
      gross_operational_savings:grossOperationalSavings,
      supportable_positive_savings:supportableSavings,
      return_savings_pct:returnSavingsPct,
      raw_credit:rawCredit,
      credit_cap:creditCap,
      growth_finance_budget_remaining:budgetRemaining,
      supported_credit:finalCredit,
      retained_business_life_savings:retainedSavings,
      net_business_life_impact_after_credit:netCompanyImpact
    },
    guardrails:{
      provider_confirmation_required:true,
      no_cash_surcharge:true,
      actual_provider_statement_overrides_benchmark:true,
      provider_pricing_is_dated_reference:true,
      published_paymongo_fee_excludes_vat:true,
      credit_targets:['subscription','future_platform_fee'],
      customer_reward_requires_separate_policy:true,
      activation:'NOT_PERFORMED'
    }
  };
}

export function compareDigitalPaymentRails(input={}){
  return Object.keys(PAYMONGO_PH_PAYMENT_BENCHMARKS).map(railCode=>
    digitalPaymentIncentiveScenario({...input,railCode})
  ).sort((a,b)=>a.provider_cost.modeled_total_processor_cost-b.provider_cost.modeled_total_processor_cost);
}
