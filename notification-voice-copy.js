import { normalizeNotificationSoundVariant,isNotificationSoundSlot } from './notification-sound-options.js';

const SLOT_LEAF=new Map([
  ['merchant.new_order','merchant'],
  ['courier.new_delivery','courier'],
  ['finance.payment_received','finance'],
  ['general.info','info'],
  ['general.success','success'],
  ['general.action','action'],
  ['general.urgent','urgent'],
  ['general.warning','warning'],
  ['merchant.action','action'],
  ['courier.action','action'],
  ['supplier.action','action'],
  ['service.action','action']
]);

const COPY={
  'en-PH':{
    1:{
      info:'You have a new update.',
      success:'Done. Everything is confirmed.',
      action:'Action needed. Please check now.',
      urgent:'Urgent. Please respond now.',
      finance:'Payment received. Funds updated.',
      warning:'Attention. There is a problem.',
      merchant:'New order. Merchant action needed.',
      courier:'New delivery request. Please respond.'
    },
    2:{
      info:'Psst... something new just landed.',
      success:"Nice! That one's officially done.",
      action:'Hey, your move. Take a quick look.',
      urgent:"Heads up! This one really can't wait.",
      finance:'Good news. Your money just checked in.',
      warning:'Oops. Something needs a little rescue.',
      merchant:'New order! Time to make someone happy.',
      courier:'New delivery! Your next stop is calling.'
    },
    3:{
      info:'Business update. New information is available.',
      success:'Confirmed. The operation was completed successfully.',
      action:'Action required. Please review this notification.',
      urgent:'Urgent action required. Please respond immediately.',
      finance:'Payment received. Your financial balance has been updated.',
      warning:'Attention required. An issue needs your review.',
      merchant:'New order received. Merchant action is required.',
      courier:'New delivery request received. Please review and respond.'
    }
  },
  'fil-PH':{
    1:{
      info:'May bago kang update.',
      success:'Tapos na. Kumpirmado na ang lahat.',
      action:'Kailangan ng aksyon. Pakitingnan ito ngayon.',
      urgent:'Urgent. Pakiresponde agad.',
      finance:'Natanggap ang bayad. Na-update na ang financial record.',
      warning:'Pakitingnan. May problemang kailangang ayusin.',
      merchant:'May bagong order. Pakitingnan at aksyunan.',
      courier:'May bagong delivery request. Pakiresponde.'
    },
    2:{
      info:"Psst... may bagong dumating para sa'yo.",
      success:"Nice! Tapos na 'yan, opisyal na.",
      action:'Uy, ikaw na. Paki-check ito saglit.',
      urgent:'Heads up! Hindi na ito puwedeng maghintay.',
      finance:'Good news. Dumating na ang bayad mo.',
      warning:'Oops. May kailangan lang ayusin.',
      merchant:'Bagong order! Oras nang pasayahin ang customer.',
      courier:'Bagong delivery! Handa na ang susunod mong biyahe.'
    },
    3:{
      info:'Business update. May bagong impormasyong available.',
      success:'Kumpirmado. Matagumpay na natapos ang operation.',
      action:'Kailangan ng aksyon. Pakireview ang notification na ito.',
      urgent:'Kailangan ng agarang aksyon. Pakiresponde kaagad.',
      finance:'Natanggap ang bayad. Na-update na ang financial record.',
      warning:'Kailangan ng atensyon. May issue na kailangang i-review.',
      merchant:'May bagong order. Kailangan itong i-review at aksyunan.',
      courier:'May bagong delivery request. Pakireview at tumugon.'
    }
  }
};

export function normalizeNotificationVoiceLocale(value='en-PH'){
  return /^(fil|tl)(-|$)/i.test(String(value||''))?'fil-PH':'en-PH';
}

export function notificationVoiceLeaf(soundSlot){
  const slot=String(soundSlot||'').trim();
  if(!isNotificationSoundSlot(slot))throw Object.assign(new Error('Unknown notification sound slot'),{status:400});
  const leaf=SLOT_LEAF.get(slot);
  if(!leaf)throw Object.assign(new Error('Notification sound slot has no voice copy'),{status:404});
  return leaf;
}

export function notificationVoiceCopy({soundSlot,variant,locale='en-PH'}={}){
  const normalizedVariant=normalizeNotificationSoundVariant(variant);
  const normalizedLocale=normalizeNotificationVoiceLocale(locale);
  const leaf=notificationVoiceLeaf(soundSlot);
  return{
    sound_slot:String(soundSlot),
    variant:normalizedVariant,
    locale:normalizedLocale,
    leaf,
    text:COPY[normalizedLocale][normalizedVariant][leaf]
  };
}

export function notificationVoiceTranscriptMatrix(locale='en-PH'){
  const normalizedLocale=normalizeNotificationVoiceLocale(locale);
  const out={};
  for(const slot of SLOT_LEAF.keys()){
    out[slot]={};
    for(const variant of [1,2,3])out[slot][variant]=notificationVoiceCopy({soundSlot:slot,variant,locale:normalizedLocale}).text;
  }
  return out;
}

export function notificationVoiceLocales(){
  return ['en-PH','fil-PH'];
}
