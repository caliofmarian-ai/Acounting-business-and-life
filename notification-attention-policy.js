import { notificationSoundSlot } from './notification-sound-options.js';

const ROLE_ALIASES=new Map([
  ['delivery','courier'],
  ['driver','courier'],
  ['rider','courier'],
  ['service-provider','service_provider'],
  ['provider','service_provider'],
  ['super_admin','admin'],
  ['country_admin','admin'],
  ['territory_admin','admin']
]);

const KNOWN_ROLES=new Set(['customer','merchant','supplier','courier','service_provider','admin']);

const HAPTICS={
  off:[],
  soft:[80],
  success:[70,60,70],
  action:[180,90,90],
  urgent:[220,100,220,180,260],
  finance:[70,70,70],
  warning:[180,120,180]
};

const CONTROLLED_REPEAT_EVENTS=new Set([
  'delivery.offer_received',
  'delivery.offer_expiring',
  'order.merchant_ack_required',
  'order.merchant_ack_expiring'
]);

const ACTION_EVENTS=new Set([
  'order.created',
  'order.customer_checked_in',
  'delivery.assigned',
  'delivery.arrived',
  'supplier.relationship_invited',
  'procurement.po_created',
  'service.request_created',
  'service.quote_created',
  'support.ticket_created',
  'profile.application_submitted',
  'legal.reconsent_required',
  'delivery.offer_received',
  'order.merchant_ack_required'
]);

const SUCCESS_EVENTS=new Set([
  'order.ready',
  'order.completed',
  'delivery.completed',
  'service.quote_accepted'
]);

const FINANCE_EVENTS=new Set([
  'order.payment_confirmed',
  'procurement.payment_received'
]);

const WARNING_EVENTS=new Set([
  'order.cancelled',
  'profile.authorization_changed',
  'delivery.offer_withdrawn'
]);

const INFO_EVENTS=new Set([
  'order.preparing',
  'delivery.picked_up',
  'delivery.in_transit',
  'supplier.relationship_updated',
  'support.reply',
  'support.user_reply'
]);

const successStatus=value=>/^(approved|accepted|active|completed|complete|received|delivered|paid|resolved)$/i.test(String(value||'').trim());
const warningStatus=value=>/^(cancelled|canceled|declined|rejected|denied|failed|suspended|blocked|expired|escalated)$/i.test(String(value||'').trim());

export function normalizeAttentionRole(value=''){
  const raw=String(value||'').trim().toLowerCase().replace(/\s+/g,'_');
  const mapped=ROLE_ALIASES.get(raw)||raw;
  return KNOWN_ROLES.has(mapped)?mapped:'';
}

function eventFamily({eventCode,role,priority,category,data}){
  if(category==='marketing')return'info';

  if(eventCode==='delivery.offer_expiring'||eventCode==='order.merchant_ack_expiring')return'urgent';
  if(eventCode==='incident.updated')return priority==='urgent'||warningStatus(data?.status)?'urgent':'warning';
  if(eventCode==='support.ticket_created')return priority==='urgent'?'urgent':'action';

  if(eventCode==='delivery.assigned')return role==='courier'?'action':'info';
  if(eventCode==='order.customer_checked_in')return role==='merchant'?'action':'info';

  if(eventCode==='procurement.po_updated'){
    if(warningStatus(data?.status))return'warning';
    if(successStatus(data?.status))return'success';
    return'info';
  }

  if(eventCode==='service.status_changed'){
    if(warningStatus(data?.status))return'warning';
    if(successStatus(data?.status))return'success';
    return'info';
  }

  if(eventCode==='profile.application_reviewed'){
    if(warningStatus(data?.status))return'warning';
    if(successStatus(data?.status))return'success';
    return'info';
  }

  if(FINANCE_EVENTS.has(eventCode))return'finance';
  if(WARNING_EVENTS.has(eventCode))return'warning';
  if(SUCCESS_EVENTS.has(eventCode))return'success';
  if(ACTION_EVENTS.has(eventCode))return'action';
  if(INFO_EVENTS.has(eventCode))return'info';

  if(category==='security')return'warning';
  if(priority==='urgent')return'urgent';
  if(priority==='high')return'action';
  return'info';
}

function soundKey(family,role){
  if((family==='action'||family==='urgent')&&['merchant','courier','supplier','service_provider'].includes(role)){
    return `bl-${family}-${role}`;
  }
  return `bl-${family}`;
}

export function notificationAttention({
  eventCode='',
  roleHint='',
  priority='normal',
  category='operational',
  data={}
}={}){
  const code=String(eventCode||'').trim();
  const role=normalizeAttentionRole(roleHint);
  const pri=['low','normal','high','urgent'].includes(String(priority||''))?String(priority):'normal';
  const cat=String(category||'operational').trim().toLowerCase();
  const family=eventFamily({eventCode:code,role,priority:pri,category:cat,data:data&&typeof data==='object'?data:{}});
  const marketing=cat==='marketing';
  const repeat=CONTROLLED_REPEAT_EVENTS.has(code)?'controlled':'none';
  const haptic=marketing?'off':family==='success'?'success':family;
  return {
    family,
    role,
    repeat,
    haptic,
    vibrate:[...(HAPTICS[haptic]||[])],
    silent:marketing,
    renotify:!marketing&&family==='urgent',
    requireInteraction:!marketing&&family==='urgent',
    soundSlot:marketing?'':notificationSoundSlot({eventCode:code,role,family}),
    foregroundSoundKey:marketing?'':soundKey(family,role)
  };
}

export function notificationAttentionFamilies(){
  return ['info','success','action','urgent','finance','warning'];
}
