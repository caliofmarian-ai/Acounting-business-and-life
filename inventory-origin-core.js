// Explicit Inventory business authority. Always revalidate against the authenticated bindings.
const WRITE_METHODS=new Set(['POST','PUT','PATCH','DELETE']);
export function inventoryMutationOrigin(req){
  if(!WRITE_METHODS.has(String(req?.method||'').toUpperCase())||!/^\/api\/inventory(?:\/|$)/.test(String(req?.path||'')))return null;
  const raw=req?.headers?.['x-abl-inventory-origin-business'];
  if(typeof raw!=='string'||!/^\d+$/.test(raw)||raw[0]==='0'||!Number.isSafeInteger(Number(raw))||Number(raw)<1)
    throw Object.assign(new Error('Inventory business context is missing or invalid. Reload Inventory and try again.'),{status:409,code:'INVENTORY_ORIGIN_REQUIRED'});
  return Number(raw);
}
export function boundInventoryOrigin(bindings,id){
  const selected=bindings.find(x=>Number(x.id)===id);
  if(!selected)throw Object.assign(new Error('The initiating Inventory business is not authorized for this account.'),{status:403,code:'INVENTORY_ORIGIN_FORBIDDEN'});
  return selected;
}
