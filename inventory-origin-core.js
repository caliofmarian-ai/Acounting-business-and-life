// Explicit business authority is revalidated against live authenticated bindings.
const WRITE_METHODS=new Set(['POST','PUT','PATCH','DELETE']);
// These optimized GETs can still repair drift, including missing location/lot rows.
const REPAIRING_GET_PATHS=new Set([
  '/api/inventory/locations','/api/inventory/location-balances','/api/inventory/location-summary'
]);
export function inventoryMutationOrigin(req){
  const method=String(req?.method||'').toUpperCase();
  const path=String(req?.path||'').replace(/\/$/,'');
  if(!/^\/api\/inventory(?:\/|$)/.test(path))return null;
  const required=WRITE_METHODS.has(method)||(method==='GET'&&REPAIRING_GET_PATHS.has(path));
  const raw=req?.headers?.['x-abl-inventory-origin-business'];
  if(!required&&raw==null)return null;
  if(typeof raw!=='string'||! /^[1-9]\d*$/.test(raw)||!Number.isSafeInteger(Number(raw)))
    throw Object.assign(new Error('Inventory business context is missing or invalid. Reload Inventory and try again.'),{status:409,code:'INVENTORY_ORIGIN_REQUIRED'});
  return Number(raw);
}
export function boundInventoryOrigin(bindings,id){
  const selected=bindings.find(x=>Number(x.id)===id);
  if(!selected)throw Object.assign(new Error('The initiating Inventory business is not authorized for this account.'),{status:403,code:'INVENTORY_ORIGIN_FORBIDDEN'});
  return selected;
}
