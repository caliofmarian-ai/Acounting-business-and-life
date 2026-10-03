export const WASTE_KINDS=Object.freeze(['waste','spoilage','expired','damaged','other_loss']);
const WASTE_SET=new Set(WASTE_KINDS);
const money=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const qty=v=>Math.round((Number(v||0)+Number.EPSILON)*10000)/10000;

export function wasteKindLabel(kind){
  return({
    waste:'Waste',
    spoilage:'Spoilage',
    expired:'Expired',
    damaged:'Damaged / broken',
    other_loss:'Other loss'
  })[String(kind||'')]||String(kind||'Other loss');
}

export function normalizeWasteAdjustment(row={}){
  const kind=String(row.adjustment_kind||'');
  if(!WASTE_SET.has(kind))return null;
  const delta=Number(row.quantity_delta||0);
  if(!Number.isFinite(delta)||delta>=0)return null;
  const lossQuantity=Math.abs(delta);
  const valueDelta=Number(row.estimated_value_delta||0);
  const valueLoss=Math.abs(Number.isFinite(valueDelta)?valueDelta:lossQuantity*Number(row.unit_cost_snapshot||0));
  return{
    ...row,
    adjustment_kind:kind,
    loss_quantity:qty(lossQuantity),
    value_loss:money(valueLoss),
    unit:String(row.unit||'unit')
  };
}

export function buildWasteAnalytics({
  adjustments=[],
  purchases=[],
  usage=[]
}={}){
  const lossRows=(Array.isArray(adjustments)?adjustments:[])
    .map(normalizeWasteAdjustment)
    .filter(Boolean);

  const reasonMap=new Map();
  const itemMap=new Map();
  const unitTotals=new Map();

  for(const row of lossRows){
    const reason=reasonMap.get(row.adjustment_kind)||{
      adjustment_kind:row.adjustment_kind,
      label:wasteKindLabel(row.adjustment_kind),
      events:0,
      value_loss:0
    };
    reason.events+=1;reason.value_loss+=row.value_loss;
    reasonMap.set(row.adjustment_kind,reason);

    const id=Number(row.inventory_id);
    const item=itemMap.get(id)||{
      inventory_id:id,
      item:String(row.item||'Inventory item'),
      inventory_type:String(row.inventory_type||'ingredient'),
      unit:row.unit,
      events:0,
      quantity_loss:0,
      value_loss:0,
      by_reason:{}
    };
    item.events+=1;
    item.quantity_loss+=row.loss_quantity;
    item.value_loss+=row.value_loss;
    item.by_reason[row.adjustment_kind]=(item.by_reason[row.adjustment_kind]||0)+row.value_loss;
    itemMap.set(id,item);

    const unitKey=row.unit;
    unitTotals.set(unitKey,(unitTotals.get(unitKey)||0)+row.loss_quantity);
  }

  const purchaseMap=new Map();
  for(const row of Array.isArray(purchases)?purchases:[]){
    const id=Number(row.inventory_id);
    if(!Number.isInteger(id))continue;
    const p=purchaseMap.get(id)||{purchase_quantity:0,purchase_value:0,unit:String(row.base_unit||row.unit||'unit'),events:0};
    p.purchase_quantity+=Number(row.base_quantity||0);
    p.purchase_value+=Number(row.total_cost||0);
    p.events+=Number(row.purchase_events||1);
    purchaseMap.set(id,p);
  }

  const usageMap=new Map();
  for(const row of Array.isArray(usage)?usage:[]){
    const id=Number(row.inventory_id);
    if(!Number.isInteger(id))continue;
    const u=usageMap.get(id)||{usage_quantity:0,usage_value:0,events:0};
    u.usage_quantity+=Number(row.usage_quantity||0);
    u.usage_value+=Number(row.usage_value||0);
    u.events+=Number(row.usage_events||0);
    usageMap.set(id,u);
  }

  const topItems=[...itemMap.values()].map(item=>{
    const p=purchaseMap.get(item.inventory_id)||null;
    const u=usageMap.get(item.inventory_id)||null;
    const hasPurchase=Boolean(p&&p.purchase_value>0);
    const hasUsage=Boolean(u&&u.usage_quantity>0);
    return{
      ...item,
      quantity_loss:qty(item.quantity_loss),
      value_loss:money(item.value_loss),
      by_reason:Object.fromEntries(Object.entries(item.by_reason).map(([k,v])=>[k,money(v)])),
      comparison:{
        purchase_evidence:hasPurchase?{
          status:'RECORDED_PURCHASES_PRESENT',
          quantity:qty(p.purchase_quantity),
          value:money(p.purchase_value),
          events:p.events
        }:{status:'NO_PURCHASE_EVIDENCE',quantity:null,value:null,events:0},
        usage_evidence:hasUsage?{
          status:'RECORDED_USAGE_PRESENT',
          quantity:qty(u.usage_quantity),
          value:money(u.usage_value),
          events:u.events
        }:{status:'NO_USAGE_EVIDENCE',quantity:null,value:null,events:0},
        waste_rate_pct:null,
        waste_rate_status:hasPurchase||hasUsage
          ?'DENOMINATOR_COMPLETENESS_NOT_PROVEN'
          :'NO_DENOMINATOR_EVIDENCE'
      }
    };
  }).sort((a,b)=>b.value_loss-a.value_loss||b.events-a.events||a.item.localeCompare(b.item));

  const totalValue=lossRows.reduce((sum,row)=>sum+row.value_loss,0);
  const reasons=[...reasonMap.values()]
    .map(row=>({
      ...row,
      value_loss:money(row.value_loss),
      share_of_loss_value_pct:totalValue>0?Math.round((row.value_loss/totalValue)*1000)/10:0
    }))
    .sort((a,b)=>b.value_loss-a.value_loss||a.label.localeCompare(b.label));

  return{
    summary:{
      events:lossRows.length,
      value_loss:money(totalValue),
      quantities_by_unit:[...unitTotals.entries()]
        .map(([unit,quantity])=>({unit,quantity:qty(quantity)}))
        .sort((a,b)=>a.unit.localeCompare(b.unit)),
      items_affected:topItems.length
    },
    by_reason:reasons,
    top_items:topItems,
    details:[...lossRows]
      .sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0)||Number(b.id||0)-Number(a.id||0))
      .map(row=>({
        id:Number(row.id),
        inventory_id:Number(row.inventory_id),
        item:String(row.item||'Inventory item'),
        inventory_type:String(row.inventory_type||'ingredient'),
        adjustment_kind:row.adjustment_kind,
        label:wasteKindLabel(row.adjustment_kind),
        quantity_loss:row.loss_quantity,
        unit:row.unit,
        value_loss:row.value_loss,
        unit_cost_snapshot:Number(row.unit_cost_snapshot||0),
        note:String(row.note||''),
        created_at:row.created_at||null,
        lot_allocations:Array.isArray(row.lot_allocations)?row.lot_allocations:[]
      })),
    denominator_policy:{
      waste_rate_pct:null,
      status:'NOT_COMPUTED_WITHOUT_COMPLETE_DENOMINATOR_EVIDENCE',
      note:'Purchase and usage evidence may be shown as recorded values, but Business & Life does not present them as a waste rate unless denominator completeness can be proven.'
    }
  };
}
