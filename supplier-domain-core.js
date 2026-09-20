export const SUPPLIER_ACTIVITY_CODES=Object.freeze([
  'producer','processor','manufacturer','packer','repacker','trader',
  'importer','exporter','distributor','wholesaler','retailer','service_provider'
]);

export const PRODUCT_HANDLING_MODES=Object.freeze([
  'sealed_resale','break_pack','bulk','repacked','produced'
]);

const ACTIVITY_SET=new Set(SUPPLIER_ACTIVITY_CODES);
const HANDLING_SET=new Set(PRODUCT_HANDLING_MODES);

function finiteNumber(value,label){
  const n=Number(value);
  if(!Number.isFinite(n))throw new TypeError(`${label} must be a finite number`);
  return n;
}
function positiveNumber(value,label){
  const n=finiteNumber(value,label);
  if(n<=0)throw new RangeError(`${label} must be greater than zero`);
  return n;
}
function nonNegativeNumber(value,label){
  const n=finiteNumber(value,label);
  if(n<0)throw new RangeError(`${label} cannot be negative`);
  return n;
}
function code(value){
  return String(value??'').trim().toLowerCase().replace(/[\s-]+/g,'_');
}

export function normalizeSupplierActivities(values=[]){
  const input=Array.isArray(values)?values:[values];
  const out=[];
  for(const value of input){
    const normalized=code(value);
    if(!normalized)continue;
    if(!ACTIVITY_SET.has(normalized))throw new RangeError(`Unsupported supplier activity: ${value}`);
    if(!out.includes(normalized))out.push(normalized);
  }
  return out;
}

export function normalizeHandlingMode(value,{fallback='sealed_resale'}={}){
  const normalized=code(value||fallback);
  if(!HANDLING_SET.has(normalized))throw new RangeError(`Unsupported product handling mode: ${value}`);
  return normalized;
}

export function normalizePackageDefinition({
  outerUnit='pack',
  innerUnit='unit',
  innerQuantity=1
}={}){
  const outer=String(outerUnit||'pack').trim().slice(0,50);
  const inner=String(innerUnit||'unit').trim().slice(0,50);
  const quantity=positiveNumber(innerQuantity,'innerQuantity');
  return {
    outer_unit:outer||'pack',
    inner_unit:inner||'unit',
    inner_quantity:quantity
  };
}

export function breakPackUnits({outerPacks,innerUnitsPerPack}){
  return positiveNumber(outerPacks,'outerPacks')*positiveNumber(innerUnitsPerPack,'innerUnitsPerPack');
}

export function normalizePriceTiers(tiers=[]){
  if(!Array.isArray(tiers))throw new TypeError('tiers must be an array');
  const seen=new Set();
  const normalized=tiers.map((tier,index)=>{
    const minimum=positiveNumber(tier?.minimum_quantity??tier?.minimumQuantity,`tiers[${index}].minimum_quantity`);
    const price=nonNegativeNumber(tier?.price_per_pack??tier?.pricePerPack,`tiers[${index}].price_per_pack`);
    const key=String(minimum);
    if(seen.has(key))throw new RangeError(`Duplicate price-tier minimum: ${minimum}`);
    seen.add(key);
    return{
      minimum_quantity:minimum,
      price_per_pack:price,
      label:String(tier?.label??'').trim().slice(0,80)
    };
  }).sort((a,b)=>a.minimum_quantity-b.minimum_quantity);
  return normalized;
}

export function priceForQuantity({basePrice,quantity,tiers=[]}){
  const qty=positiveNumber(quantity,'quantity');
  const base=nonNegativeNumber(basePrice,'basePrice');
  const normalized=normalizePriceTiers(tiers);
  let selected={minimum_quantity:1,price_per_pack:base,label:'base'};
  for(const tier of normalized){
    if(qty>=tier.minimum_quantity)selected=tier;
    else break;
  }
  return{...selected,quantity:qty};
}

export function computeRepackPlan({
  inputQuantity,
  packageSize,
  outputPackages,
  wasteQuantity=0,
  inputUnitCost=0,
  packagingCostPerOutput=0,
  tolerance=1e-6
}){
  const input=positiveNumber(inputQuantity,'inputQuantity');
  const size=positiveNumber(packageSize,'packageSize');
  const outputs=positiveNumber(outputPackages,'outputPackages');
  const waste=nonNegativeNumber(wasteQuantity,'wasteQuantity');
  const unitCost=nonNegativeNumber(inputUnitCost,'inputUnitCost');
  const packaging=nonNegativeNumber(packagingCostPerOutput,'packagingCostPerOutput');
  const packed=size*outputs;
  const delta=input-(packed+waste);
  if(Math.abs(delta)>Math.max(Number(tolerance)||0,1e-9)){
    throw new RangeError('Repack quantities do not conserve input quantity');
  }
  const inputCost=input*unitCost;
  const packagingCost=outputs*packaging;
  const totalCost=inputCost+packagingCost;
  return{
    input_quantity:input,
    packed_quantity:packed,
    waste_quantity:waste,
    output_packages:outputs,
    package_size:size,
    input_cost:inputCost,
    packaging_cost:packagingCost,
    total_output_cost:totalCost,
    cost_per_output_package:totalCost/outputs,
    conservation_delta:delta
  };
}

export function inheritedExpiry(sourceExpiries=[]){
  const timestamps=(Array.isArray(sourceExpiries)?sourceExpiries:[sourceExpiries])
    .filter(Boolean)
    .map(value=>{
      const t=Date.parse(value);
      if(!Number.isFinite(t))throw new RangeError(`Invalid expiry date: ${value}`);
      return t;
    });
  if(!timestamps.length)return null;
  return new Date(Math.min(...timestamps)).toISOString();
}

export function supplierRelationshipKind({connectedAccountId=null,externalSupplierId=null}={}){
  const connected=connectedAccountId!=null&&String(connectedAccountId)!=='';
  const external=externalSupplierId!=null&&String(externalSupplierId)!=='';
  if(connected===external)throw new RangeError('Exactly one supplier relationship source is required');
  return connected?'connected':'external';
}
