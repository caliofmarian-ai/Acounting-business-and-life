const DEPARTMENTS=Object.freeze({
  security:{label:'Security',sender:'Caliof · Business & Life Security'},
  billing:{label:'Billing',sender:'Caliof · Business & Life Billing'},
  support:{label:'Support',sender:'Caliof · Business & Life Support'},
  operations:{label:'Operations',sender:'Caliof · Business & Life Operations'},
  legal:{label:'Legal',sender:'Caliof · Business & Life Legal'},
  marketing:{label:'Updates',sender:'Caliof · Business & Life Updates'}
});

const ROLE_LABELS=Object.freeze({
  customer:'Customer',
  merchant:'Merchant',
  supplier:'Supplier',
  courier:'Courier',
  delivery:'Courier',
  service_provider:'Local Services',
  admin:'Admin'
});

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clean=(v,max=500)=>String(v??'').trim().slice(0,max);
const emailAddress=v=>{
  const raw=clean(v,320);
  const angled=raw.match(/<([^<>]+)>/);
  const candidate=clean(angled?.[1]||raw,254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)?candidate:'';
};

export function communicationDepartment(department='operations'){
  return DEPARTMENTS[department]||DEPARTMENTS.operations;
}

export function brandedSender(from,department='operations'){
  const address=emailAddress(from);
  if(!address)return clean(from,320);
  return communicationDepartment(department).sender+' <'+address+'>';
}

export function configuredReplyTo(env={},department='operations'){
  const suffix=String(department||'operations').toUpperCase().replace(/[^A-Z0-9_]/g,'_');
  const candidate=env['RESEND_REPLY_TO_'+suffix]||env.RESEND_REPLY_TO||'';
  return emailAddress(candidate)?clean(candidate,320):'';
}

function absoluteBase(baseUrl='/'){
  try{
    const u=new URL(String(baseUrl||''));
    if(!['https:','http:'].includes(u.protocol))return null;
    u.hash='';
    return u;
  }catch{return null}
}

export function emailTargetUrl({baseUrl='/',entityType='',entityId=''}={}){
  const base=absoluteBase(baseUrl);
  if(!base)return String(baseUrl||'/');
  if(entityType==='support_ticket'&&String(entityId||'').trim()){
    base.pathname='/';
    base.search='';
    base.searchParams.set('support_ticket',String(entityId).trim());
  }
  return base.toString();
}

function htmlToText(html=''){
  return String(html)
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,(_m,href,label)=>label.replace(/<[^>]+>/g,'').trim()+' ('+href+')')
    .replace(/<br\s*\/?\s*>/gi,'\n')
    .replace(/<\/p\s*>/gi,'\n\n')
    .replace(/<\/div\s*>/gi,'\n')
    .replace(/<[^>]+>/g,'')
    .replace(/&nbsp;/g,' ')
    .replace(/&amp;/g,'&')
    .replace(/&lt;/g,'<')
    .replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"')
    .replace(/&#39;/g,"'")
    .replace(/\n{3,}/g,'\n\n')
    .trim();
}

export function renderTransactionalEmail({
  subject='Business & Life update',
  body='',
  bodyHtml='',
  department='operations',
  roleHint='',
  actionUrl='',
  actionLabel='Open Business & Life',
  preheader=''
}={}){
  const meta=communicationDepartment(department);
  const role=ROLE_LABELS[String(roleHint||'').toLowerCase()]||'';
  const safeSubject=clean(subject,180)||'Business & Life update';
  const safePreheader=clean(preheader||body||safeSubject,220);
  const contentHtml=bodyHtml||'<p style="margin:0;color:#334155;font-size:16px;line-height:1.65">'+esc(body)+'</p>';
  const cta=actionUrl
    ?'<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:26px 0 4px"><tr><td style="border-radius:12px;background:#0f172a"><a href="'+esc(actionUrl)+'" style="display:inline-block;padding:13px 18px;color:#ffffff;text-decoration:none;font-weight:800;font-size:14px">'+esc(actionLabel)+'</a></td></tr></table>'
    :'';
  const context=[meta.label,role].filter(Boolean).join(' · ');
  const html='<!doctype html>'+
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>'+
    '<body style="margin:0;padding:0;background:#f4f7f9;font-family:Inter,-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;color:#0f172a">'+
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">'+esc(safePreheader)+'</div>'+
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f7f9"><tr><td align="center" style="padding:28px 12px">'+
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:620px;background:#ffffff;border:1px solid #e2e8f0;border-radius:20px;overflow:hidden">'+
    '<tr><td style="padding:24px 28px 18px;border-bottom:1px solid #eef2f7"><div style="font-size:12px;font-weight:900;letter-spacing:.16em;color:#0a7c66">CALIOF</div><div style="margin-top:5px;font-size:15px;font-weight:800;color:#0f172a">Business &amp; Life</div></td></tr>'+
    '<tr><td style="padding:28px"><div style="display:inline-block;padding:6px 9px;border-radius:999px;background:#eefbf7;color:#075f50;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase">'+esc(context||meta.label)+'</div>'+
    '<h1 style="margin:16px 0 12px;font-size:26px;line-height:1.2;letter-spacing:-.02em;color:#0f172a">'+esc(safeSubject)+'</h1>'+
    '<div style="color:#334155;font-size:16px;line-height:1.65">'+contentHtml+'</div>'+cta+'</td></tr>'+
    '<tr><td style="padding:20px 28px;background:#f8fafc;border-top:1px solid #eef2f7;color:#64748b;font-size:12px;line-height:1.55"><strong style="color:#334155">Business &amp; Life by Caliof</strong><br>caliof.com<br>This message was sent because of activity in your Business &amp; Life account or profile.</td></tr>'+
    '</table></td></tr></table></body></html>';
  const bodyText=bodyHtml?htmlToText(bodyHtml):clean(body,4000);
  const text=[
    'CALIOF — Business & Life',
    context,
    '',
    safeSubject,
    '',
    bodyText,
    actionUrl?'\n'+actionLabel+': '+actionUrl:'',
    '',
    'Business & Life by Caliof',
    'caliof.com'
  ].filter((v,i,a)=>v!==''||a[i-1]!=='').join('\n').trim();
  return{html,text,subject:safeSubject,department,context};
}
