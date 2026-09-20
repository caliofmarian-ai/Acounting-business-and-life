export const DEFAULT_NOTIFICATION_SOUND_VARIANT=2;

const VARIANTS=[
  {id:2,key:'set2',label:'Set 2 — Friendly',description:'Default Business & Life voice set.',isDefault:true},
  {id:1,key:'set1',label:'Set 1 — Professional',description:'Clear professional voice set.',isDefault:false},
  {id:3,key:'set3',label:'Set 3 — Business',description:'Formal business voice set.',isDefault:false}
];

const SLOTS=[
  {id:'merchant.new_order',label:'New order — Merchant',description:'A Merchant receives a new customer order.'},
  {id:'merchant.action',label:'Merchant action',description:'Other Merchant actions that need attention.'},
  {id:'courier.new_delivery',label:'New delivery request — Courier',description:'A Courier receives a new delivery request.'},
  {id:'courier.action',label:'Courier action',description:'Other Courier actions that need attention.'},
  {id:'supplier.action',label:'Supplier action',description:'Supplier and procurement actions.'},
  {id:'service.action',label:'Service Provider action',description:'Local-service requests and actions.'},
  {id:'finance.payment_received',label:'Payment / finance',description:'Payment received and financial updates.'},
  {id:'general.info',label:'General update',description:'Routine informational notifications.'},
  {id:'general.success',label:'Success / completed',description:'Successful or completed actions.'},
  {id:'general.action',label:'Action required',description:'General notifications requiring action.'},
  {id:'general.urgent',label:'Urgent',description:'Time-sensitive notifications.'},
  {id:'general.warning',label:'Warning / problem',description:'Warnings, cancellations and problems.'}
];

const SLOT_IDS=new Set(SLOTS.map(x=>x.id));

export function notificationSoundVariants(){
  return VARIANTS.map(x=>({...x}));
}

export function notificationSoundSlots(){
  return SLOTS.map(x=>({...x}));
}

export function normalizeNotificationSoundVariant(value){
  const n=Number(value);
  return [1,2,3].includes(n)?n:DEFAULT_NOTIFICATION_SOUND_VARIANT;
}

export function isNotificationSoundSlot(value){
  return SLOT_IDS.has(String(value||''));
}

export function notificationSoundSlot({eventCode='',role='',family='info'}={}){
  const code=String(eventCode||'').trim();
  const normalizedRole=String(role||'').trim();

  if(code==='order.created'&&normalizedRole==='merchant')return'merchant.new_order';
  if(['delivery.assigned','delivery.offer_received'].includes(code)&&normalizedRole==='courier')return'courier.new_delivery';
  if(family==='finance')return'finance.payment_received';

  if(['action','urgent'].includes(family)){
    if(normalizedRole==='merchant')return'merchant.action';
    if(normalizedRole==='courier')return'courier.action';
    if(normalizedRole==='supplier')return'supplier.action';
    if(normalizedRole==='service_provider')return'service.action';
  }

  if(['info','success','action','urgent','warning'].includes(family))return`general.${family}`;
  return'general.info';
}
