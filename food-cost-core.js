export const DIRECT_CONSUMABLE_TYPES=Object.freeze(['packaging','kitchen_consumable','hygiene']);
const DIRECT_SET=new Set(DIRECT_CONSUMABLE_TYPES);
const money=v=>Math.round((Number(v||0)+Number.EPSILON)*10000)/10000;

export function directFoodCostRole(inventoryType='ingredient'){
  const type=String(inventoryType||'ingredient');
  if(type==='ingredient')return'ingredient';
  if(DIRECT_SET.has(type))return'direct_consumable';
  return'overhead_or_indirect';
}

export function fulfilmentRuleApplies(scope='all',fulfilment='pickup'){
  const s=String(scope||'all'),f=String(fulfilment||'pickup');
  return s==='all'||s===f;
}

export function directConsumableRuleCost(rules=[],fulfilment='pickup'){
  let perItem=0,perOrder=0,excluded=0;
  const included=[],excludedRules=[];
  for(const row of Array.isArray(rules)?rules:[]){
    if(row?.active===false||!fulfilmentRuleApplies(row?.fulfilment_scope,fulfilment))continue;
    const cost=Math.max(0,Number(row?.quantity_used||0))*Math.max(0,Number(row?.unit_cost||0));
    const role=directFoodCostRole(row?.inventory_type);
    if(role!=='direct_consumable'){
      excluded+=cost;
      excludedRules.push({...row,calculated_cost:money(cost),cost_role:role});
      continue;
    }
    if(row?.usage_basis==='per_item')perItem+=cost;
    else perOrder+=cost;
    included.push({...row,calculated_cost:money(cost),cost_role:role});
  }
  return{
    fulfilment,
    direct_consumable_per_item:money(perItem),
    direct_consumable_per_order:money(perOrder),
    excluded_overhead_rule_cost:money(excluded),
    included_rules:included,
    excluded_rules:excludedRules
  };
}

export function directProductCostEstimate({ingredientCost=0,rules=[]}={}){
  const ingredient=money(ingredientCost);
  const pickup=directConsumableRuleCost(rules,'pickup');
  const delivery=directConsumableRuleCost(rules,'delivery');
  return{
    ingredient_cost_per_item:ingredient,
    pickup:{
      ...pickup,
      direct_food_cost_per_item:money(ingredient+pickup.direct_consumable_per_item)
    },
    delivery:{
      ...delivery,
      direct_food_cost_per_item:money(ingredient+delivery.direct_consumable_per_item)
    }
  };
}

export function summarizeOrderConsumptionCosts(rows=[]){
  let ingredient=0,direct=0,overhead=0;
  for(const row of Array.isArray(rows)?rows:[]){
    const cost=Math.max(0,Number(row?.cost_snapshot||0));
    const role=directFoodCostRole(row?.inventory_type_snapshot||row?.inventory_type||'ingredient');
    if(role==='ingredient')ingredient+=cost;
    else if(role==='direct_consumable')direct+=cost;
    else overhead+=cost;
  }
  return{
    ingredient_cost:money(ingredient),
    direct_consumable_cost:money(direct),
    direct_food_cost:money(ingredient+direct),
    excluded_overhead_cost:money(overhead)
  };
}
