import crypto from 'node:crypto';

const CATEGORIES=new Set(['operational','security','legal','support','compliance','marketing']);
const PRIORITIES=new Set(['low','normal','high','urgent']);
const LOCALES=new Set(['en-PH','fil-PH']);
const CHANNELS=new Set(['in_app','email','push']);
const clean=(v,max=1200)=>String(v??'').trim().slice(0,max);
const bool=v=>Boolean(v);

export function normalizeNotificationLocale(value){
  const raw=clean(value,32);
  if(/^fil(-|$)/i.test(raw)||/^tl(-|$)/i.test(raw))return 'fil-PH';
  return 'en-PH';
}

const templates=[
  ['order.created','en-PH','New order {{order_number}}','A new order was placed by {{customer_name}}.'],
  ['order.created','fil-PH','Bagong order {{order_number}}','May bagong order mula kay {{customer_name}}.'],
  ['order.customer_checked_in','en-PH','Customer has arrived','{{customer_name}} checked in for order {{order_number}}.'],
  ['order.customer_checked_in','fil-PH','Dumating na ang customer','Nag-check in si {{customer_name}} para sa order {{order_number}}.'],
  ['order.preparing','en-PH','Your order is being prepared','Order {{order_number}} is now being prepared.'],
  ['order.preparing','fil-PH','Inihahanda na ang order mo','Inihahanda na ngayon ang order {{order_number}}.'],
  ['order.ready','en-PH','Your order is ready','Order {{order_number}} is ready for pickup{{delivery_suffix}}.'],
  ['order.ready','fil-PH','Handa na ang order mo','Handa na ang order {{order_number}} para kunin{{delivery_suffix}}.'],
  ['order.payment_confirmed','en-PH','Payment confirmed','Payment for order {{order_number}} was confirmed.'],
  ['order.payment_confirmed','fil-PH','Kumpirmado ang bayad','Nakumpirma ang bayad para sa order {{order_number}}.'],
  ['order.completed','en-PH','Order completed','Order {{order_number}} has been completed.'],
  ['order.completed','fil-PH','Tapos na ang order','Nakumpleto na ang order {{order_number}}.'],
  ['order.cancelled','en-PH','Order cancelled','Order {{order_number}} was cancelled.'],
  ['order.cancelled','fil-PH','Kinansela ang order','Kinansela ang order {{order_number}}.'],
  ['delivery.assigned','en-PH','Courier assigned','A courier was assigned to order {{order_number}}.'],
  ['delivery.assigned','fil-PH','May nakatalagang courier','May courier na para sa order {{order_number}}.'],
  ['delivery.picked_up','en-PH','Order picked up','The courier picked up order {{order_number}}.'],
  ['delivery.picked_up','fil-PH','Nakuha na ng courier','Nakuha na ng courier ang order {{order_number}}.'],
  ['delivery.in_transit','en-PH','Delivery is on the way','Order {{order_number}} is on the way.'],
  ['delivery.in_transit','fil-PH','Papunta na ang delivery','Papunta na ang order {{order_number}}.'],
  ['delivery.arrived','en-PH','Courier arrived','The courier has arrived for order {{order_number}}.'],
  ['delivery.arrived','fil-PH','Dumating na ang courier','Dumating na ang courier para sa order {{order_number}}.'],
  ['delivery.completed','en-PH','Delivery completed','Order {{order_number}} was delivered successfully.'],
  ['delivery.completed','fil-PH','Tapos na ang delivery','Matagumpay na naihatid ang order {{order_number}}.'],
  ['supplier.relationship_invited','en-PH','New business connection','{{business_name}} invited you to connect as a Supplier.'],
  ['supplier.relationship_invited','fil-PH','Bagong business connection','Inimbitahan ka ng {{business_name}} bilang Supplier.'],
  ['supplier.relationship_updated','en-PH','Supplier relationship updated','{{supplier_name}} updated the business relationship.'],
  ['supplier.relationship_updated','fil-PH','Na-update ang Supplier relationship','In-update ni {{supplier_name}} ang business relationship.'],
  ['procurement.po_created','en-PH','New purchase order {{po_number}}','You received a new purchase order from {{business_name}}.'],
  ['procurement.po_created','fil-PH','Bagong purchase order {{po_number}}','May bago kang purchase order mula sa {{business_name}}.'],
  ['procurement.po_updated','en-PH','Purchase order updated','Purchase order {{po_number}} is now {{status}}.'],
  ['procurement.po_updated','fil-PH','Na-update ang purchase order','Ang purchase order {{po_number}} ay {{status}} na.'],
  ['procurement.payment_received','en-PH','Supplier payment updated','Payment for purchase order {{po_number}} was recorded.'],
  ['procurement.payment_received','fil-PH','Na-update ang bayad sa Supplier','Naitala ang bayad para sa purchase order {{po_number}}.'],
  ['service.request_created','en-PH','New service request','You received a new {{service_label}} request.'],
  ['service.request_created','fil-PH','Bagong service request','May bago kang request para sa {{service_label}}.'],
  ['service.quote_created','en-PH','New service quote','A quote is ready for your service request.'],
  ['service.quote_created','fil-PH','May bagong service quote','Handa na ang quote para sa service request mo.'],
  ['service.quote_accepted','en-PH','Quote accepted','Your service quote was accepted.'],
  ['service.quote_accepted','fil-PH','Tinanggap ang quote','Tinanggap ang service quote mo.'],
  ['service.status_changed','en-PH','Service job updated','Your service job is now {{status}}.'],
  ['service.status_changed','fil-PH','Na-update ang service job','Ang service job mo ay {{status}} na.'],
  ['support.ticket_created','en-PH','New support ticket #{{ticket_id}}','A new support issue requires attention: {{subject}}.'],
  ['support.ticket_created','fil-PH','Bagong support ticket #{{ticket_id}}','May bagong support issue na kailangang tingnan: {{subject}}.'],
  ['support.reply','en-PH','Support replied','There is a new reply on support ticket #{{ticket_id}}.'],
  ['support.reply','fil-PH','Sumagot ang Support','May bagong sagot sa support ticket #{{ticket_id}}.'],
  ['support.user_reply','en-PH','User replied to support','Ticket #{{ticket_id}} has a new customer reply.'],
  ['support.user_reply','fil-PH','Sumagot ang user sa Support','May bagong sagot ang customer sa ticket #{{ticket_id}}.'],
  ['incident.updated','en-PH','Incident updated','Your incident report #{{incident_id}} is now {{status}}.'],
  ['incident.updated','fil-PH','Na-update ang incident','Ang incident report #{{incident_id}} ay {{status}} na.'],
  ['profile.application_submitted','en-PH','Profile application submitted','A {{role}} application is awaiting review.'],
  ['profile.application_submitted','fil-PH','Na-submit ang profile application','May {{role}} application na naghihintay ng review.'],
  ['profile.application_reviewed','en-PH','Profile application updated','Your {{role}} application is now {{status}}.'],
  ['profile.application_reviewed','fil-PH','Na-update ang profile application','Ang {{role}} application mo ay {{status}} na.'],
  ['profile.authorization_changed','en-PH','Profile authorization updated','Your {{role}} authorization is now {{status}}.'],
  ['profile.authorization_changed','fil-PH','Na-update ang profile authorization','Ang {{role}} authorization mo ay {{status}} na.'],
  ['legal.reconsent_required','en-PH','Legal document updated','A reviewed Business & Life legal document was updated. Open Legal & Privacy to review version {{version_label}}.'],
  ['legal.reconsent_required','fil-PH','Na-update ang legal document','May na-update na reviewed legal document sa Business & Life. Buksan ang Legal & Privacy para makita ang version {{version_label}}.']
];

export async function ensureNotificationSchema(pool){
  await pool.query(`
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS preferred_locale TEXT NOT NULL DEFAULT 'en-PH';

    CREATE TABLE IF NOT EXISTS notification_events (
      id BIGSERIAL PRIMARY KEY,
      event_key TEXT NOT NULL UNIQUE,
      event_code TEXT NOT NULL,
      source_service TEXT NOT NULL DEFAULT '',
      entity_type TEXT NOT NULL DEFAULT '',
      entity_id TEXT NOT NULL DEFAULT '',
      correlation_id TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'operational',
      priority TEXT NOT NULL DEFAULT 'normal',
      mandatory BOOLEAN NOT NULL DEFAULT FALSE,
      email_default BOOLEAN NOT NULL DEFAULT FALSE,
      push_default BOOLEAN NOT NULL DEFAULT TRUE,
      data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(category IN ('operational','security','legal','support','compliance','marketing')),
      CHECK(priority IN ('low','normal','high','urgent'))
    );
    CREATE INDEX IF NOT EXISTS notification_events_entity_idx ON notification_events(entity_type,entity_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS notification_events_code_idx ON notification_events(event_code,created_at DESC);

    CREATE TABLE IF NOT EXISTS notification_recipients (
      id BIGSERIAL PRIMARY KEY,
      event_id BIGINT NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      role_hint TEXT NOT NULL DEFAULT '',
      locale TEXT NOT NULL DEFAULT 'en-PH',
      read_at TIMESTAMPTZ,
      dismissed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(event_id,account_id)
    );
    CREATE INDEX IF NOT EXISTS notification_recipients_account_idx ON notification_recipients(account_id,created_at DESC);

    CREATE TABLE IF NOT EXISTS notification_deliveries (
      id BIGSERIAL PRIMARY KEY,
      recipient_id BIGINT NOT NULL REFERENCES notification_recipients(id) ON DELETE CASCADE,
      channel TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'queued',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      provider_reference TEXT NOT NULL DEFAULT '',
      error_code TEXT NOT NULL DEFAULT '',
      delivered_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(recipient_id,channel),
      CHECK(channel IN ('in_app','email','push')),
      CHECK(status IN ('queued','delivering','delivered','retry','failed','not_configured','skipped'))
    );
    CREATE INDEX IF NOT EXISTS notification_deliveries_due_idx ON notification_deliveries(status,next_attempt_at,id);

    CREATE TABLE IF NOT EXISTS notification_preferences (
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      profile_role TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL,
      in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      email_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(account_id,profile_role,category),
      CHECK(category IN ('operational','security','legal','support','compliance','marketing'))
    );

    CREATE TABLE IF NOT EXISTS notification_templates (
      id BIGSERIAL PRIMARY KEY,
      event_code TEXT NOT NULL,
      country_code TEXT NOT NULL DEFAULT 'PH',
      locale TEXT NOT NULL DEFAULT 'en-PH',
      channel TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      title_template TEXT NOT NULL,
      body_template TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(event_code,country_code,locale,channel,version),
      CHECK(channel IN ('in_app','email','push'))
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id BIGSERIAL PRIMARY KEY,
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS push_subscriptions_account_idx ON push_subscriptions(account_id,revoked_at,last_seen_at DESC);
  `);
  for(const [eventCode,locale,title,body] of templates){
    for(const channel of CHANNELS){
      await pool.query(`
        INSERT INTO notification_templates(event_code,country_code,locale,channel,version,title_template,body_template,active)
        VALUES($1,'PH',$2,$3,1,$4,$5,TRUE)
        ON CONFLICT(event_code,country_code,locale,channel,version)
        DO UPDATE SET title_template=EXCLUDED.title_template,body_template=EXCLUDED.body_template,active=TRUE
      `,[eventCode,locale,channel,title,body]);
    }
  }
}

function safeData(data){
  const source=data&&typeof data==='object'?data:{};
  const blocked=/token|password|secret|coordinate|latitude|longitude|evidence|attachment|data_url/i;
  const out={};
  for(const [k,v] of Object.entries(source)){
    if(blocked.test(k))continue;
    if(v==null||typeof v==='boolean'||typeof v==='number')out[clean(k,80)]=v;
    else out[clean(k,80)]=clean(v,500);
  }
  return out;
}

async function preferenceFor(client,accountId,role,category){
  const q=await client.query(`
    SELECT * FROM notification_preferences
    WHERE account_id=$1 AND category=$2 AND profile_role IN ($3,'')
    ORDER BY (profile_role=$3) DESC LIMIT 1
  `,[accountId,category,clean(role,40)]);
  return q.rows[0]||null;
}

async function queueRecipientChannels(client,{recipientId,accountId,role,category,mandatory,emailDefault,pushDefault}){
  const pref=await preferenceFor(client,accountId,role,category);
  const isMarketing=category==='marketing';
  const inApp=mandatory||(pref?bool(pref.in_app_enabled):!isMarketing);
  const email=mandatory&&emailDefault ? true : (pref?bool(pref.email_enabled):(!isMarketing&&emailDefault));
  const push=mandatory&&pushDefault ? true : (pref?bool(pref.push_enabled):(!isMarketing&&pushDefault));
  if(inApp)await client.query(`
    INSERT INTO notification_deliveries(recipient_id,channel,provider,status,attempt_count,delivered_at)
    VALUES($1,'in_app','internal','delivered',1,NOW())
    ON CONFLICT(recipient_id,channel) DO NOTHING
  `,[recipientId]);
  if(email)await client.query(`
    INSERT INTO notification_deliveries(recipient_id,channel,provider,status)
    VALUES($1,'email','resend','queued')
    ON CONFLICT(recipient_id,channel) DO NOTHING
  `,[recipientId]);
  if(push)await client.query(`
    INSERT INTO notification_deliveries(recipient_id,channel,provider,status)
    VALUES($1,'push','web-push','queued')
    ON CONFLICT(recipient_id,channel) DO NOTHING
  `,[recipientId]);
}

export async function emitNotificationEvent(pool,{
  eventKey,eventCode,sourceService='',entityType='',entityId='',correlationId='',
  category='operational',priority='normal',mandatory=false,emailDefault=false,pushDefault=true,
  data={},recipients=[]
}){
  if(!eventKey||!eventCode)return null;
  const cat=CATEGORIES.has(category)?category:'operational';
  const pri=PRIORITIES.has(priority)?priority:'normal';
  const normalized=[...new Map((Array.isArray(recipients)?recipients:[])
    .map(r=>typeof r==='number'?{accountId:r,roleHint:''}:r)
    .filter(r=>Number.isInteger(Number(r?.accountId))&&Number(r.accountId)>0)
    .map(r=>[Number(r.accountId),{accountId:Number(r.accountId),roleHint:clean(r.roleHint,40)}])).values()];
  if(!normalized.length)return null;
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const insert=await client.query(`
      INSERT INTO notification_events(event_key,event_code,source_service,entity_type,entity_id,correlation_id,category,priority,mandatory,email_default,push_default,data_json)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
      ON CONFLICT(event_key) DO NOTHING RETURNING id
    `,[
      clean(eventKey,220),clean(eventCode,120),clean(sourceService,80),clean(entityType,80),clean(entityId,120),
      clean(correlationId,120),cat,pri,bool(mandatory),bool(emailDefault),bool(pushDefault),JSON.stringify(safeData(data))
    ]);
    const eventId=insert.rowCount?Number(insert.rows[0].id):Number((await client.query(`SELECT id FROM notification_events WHERE event_key=$1`,[clean(eventKey,220)])).rows[0]?.id);
    if(!eventId){await client.query('ROLLBACK');return null}
    for(const r of normalized){
      const localeRow=await client.query(`SELECT preferred_locale FROM accounts WHERE id=$1`,[r.accountId]);
      if(!localeRow.rowCount)continue;
      const locale=normalizeNotificationLocale(localeRow.rows[0].preferred_locale);
      const ins=await client.query(`
        INSERT INTO notification_recipients(event_id,account_id,role_hint,locale)
        VALUES($1,$2,$3,$4)
        ON CONFLICT(event_id,account_id) DO UPDATE SET role_hint=CASE WHEN notification_recipients.role_hint='' THEN EXCLUDED.role_hint ELSE notification_recipients.role_hint END
        RETURNING id
      `,[eventId,r.accountId,r.roleHint,locale]);
      await queueRecipientChannels(client,{recipientId:Number(ins.rows[0].id),accountId:r.accountId,role:r.roleHint,category:cat,mandatory,emailDefault,pushDefault});
    }
    await client.query('COMMIT');
    return eventId;
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
}

export async function businessNotificationRecipients(pool,businessId,roleHint='merchant'){
  const {rows}=await pool.query(`
    SELECT DISTINCT account_id FROM business_memberships
    WHERE business_id=$1 AND active=TRUE
    ORDER BY account_id
  `,[Number(businessId)]);
  return rows.map(r=>({accountId:Number(r.account_id),roleHint}));
}

export async function adminNotificationRecipients(pool,{territoryId=null,permission='admin.console',destination='support'}={}){
  const params=[];let where=`a.status='active' AND a.effective_from<=NOW() AND (a.effective_until IS NULL OR a.effective_until>NOW())`;
  if(destination==='platform_admin')where+=` AND a.admin_role='super_admin'`;
  else if(destination==='country_admin')where+=` AND a.admin_role IN ('super_admin','country_admin')`;
  else if(destination==='territory_admin')where+=` AND a.admin_role IN ('super_admin','territory_admin')`;
  if(territoryId!=null&&destination!=='platform_admin'&&destination!=='country_admin'){
    params.push(Number(territoryId));
    where+=` AND (a.admin_role='super_admin' OR (a.admin_role='territory_admin' AND EXISTS(
      WITH RECURSIVE tree AS (
        SELECT id,parent_id FROM territories WHERE id=a.territory_id
        UNION ALL SELECT t.id,t.parent_id FROM territories t JOIN tree x ON t.parent_id=x.id
      ) SELECT 1 FROM tree WHERE id=$${params.length}
    )))`;
  }
  if(permission){
    params.push(clean(permission,100));
    where+=` AND (a.admin_role='super_admin' OR EXISTS(
      SELECT 1 FROM admin_permission_grants g
      WHERE g.assignment_id=a.id AND g.permission_code=${params.length} AND g.status='active'
        AND g.effective_from<=NOW() AND (g.effective_until IS NULL OR g.effective_until>NOW())
    ))`;
  }
  const {rows}=await pool.query(`SELECT DISTINCT a.account_id FROM platform_admin_assignments a WHERE ${where} ORDER BY a.account_id`,params);
  return rows.map(r=>({accountId:Number(r.account_id),roleHint:'admin'}));
}

function renderText(template,data){
  return String(template||'').replace(/\{\{([a-zA-Z0-9_]+)\}\}/g,(_m,key)=>clean(data?.[key]??'',500));
}

async function loadTemplate(pool,eventCode,locale,channel,data){
  const q=await pool.query(`
    SELECT title_template,body_template FROM notification_templates
    WHERE event_code=$1 AND country_code='PH' AND locale IN ($2,'en-PH') AND channel=$3 AND active=TRUE
    ORDER BY (locale=$2) DESC,version DESC LIMIT 1
  `,[eventCode,normalizeNotificationLocale(locale),channel]);
  const row=q.rows[0];
  const fallbackTitle=clean(data?.title||'Business & Life update',180);
  const fallbackBody=clean(data?.body||'There is a new update in Business & Life.',1000);
  return row?{title:renderText(row.title_template,data),body:renderText(row.body_template,data)}:{title:fallbackTitle,body:fallbackBody};
}

function emailDepartment(eventCode='',category='operational'){
  const code=String(eventCode||'').toLowerCase(),cat=String(category||'').toLowerCase();
  if(/auth|security|password|verify|verification/.test(code)||cat==='security')return'security';
  if(/payment|billing|invoice|subscription|refund|settlement|payout|fee|finance/.test(code))return'billing';
  if(/support|incident/.test(code)||cat==='support')return'support';
  if(/legal|privacy|consent|compliance/.test(code)||cat==='legal'||cat==='compliance')return'legal';
  if(/marketing|promotion|referral|campaign/.test(code)||cat==='marketing')return'marketing';
  return'operations';
}
function resendConfig(eventCode='',category='operational'){
  const provider=String(process.env.AUTH_EMAIL_PROVIDER||'').toLowerCase();
  const dept=emailDepartment(eventCode,category);
  const suffix=dept.toUpperCase();
  const apiKey=process.env['RESEND_API_KEY_'+suffix]||process.env.RESEND_API_KEY||'';
  const from=process.env['RESEND_FROM_'+suffix]||process.env.AUTH_FROM_EMAIL||'';
  return{provider,department:dept,apiKey,from};
}
async function resendEmail({to,subject,html,eventCode='',category='operational'}){
  const cfg=resendConfig(eventCode,category);
  if(cfg.provider!=='resend'||!cfg.apiKey||!cfg.from)return{ok:false,notConfigured:true,error:'email_provider_not_configured',department:cfg.department};
  try{
    const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${cfg.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({from:cfg.from,to:[to],subject,html,tags:[{name:'department',value:cfg.department},{name:'event',value:clean(eventCode||'generic',80)}]})});
    const b=await r.json().catch(()=>({}));
    if(!r.ok)return{ok:false,error:clean(b?.message||`provider_${r.status}`,300),department:cfg.department};
    return{ok:true,reference:clean(b?.id,300),department:cfg.department};
  }catch(e){return{ok:false,error:clean(e.message,300),department:cfg.department}}
}

export async function sendTransientEmailNotification(pool,{
  eventKey,eventCode,accountId,to,subject,html,category='security',priority='high',data={}
}){
  const eventId=await emitNotificationEvent(pool,{eventKey,eventCode,sourceService:'auth',entityType:'account',entityId:String(accountId),category,priority,mandatory:true,emailDefault:true,pushDefault:false,data,recipients:[{accountId,roleHint:''}]});
  if(!eventId)return{sent:false};
  const q=await pool.query(`
    SELECT d.id FROM notification_deliveries d
    JOIN notification_recipients r ON r.id=d.recipient_id
    WHERE r.event_id=$1 AND r.account_id=$2 AND d.channel='email'
  `,[eventId,accountId]);
  if(!q.rowCount)return{sent:false};
  const deliveryId=Number(q.rows[0].id);
  await pool.query(`UPDATE notification_deliveries SET status='delivering',attempt_count=attempt_count+1,updated_at=NOW() WHERE id=$1`,[deliveryId]);
  const sent=await resendEmail({to,subject,html,eventCode,category});
  if(sent.ok)await pool.query(`UPDATE notification_deliveries SET status='delivered',provider='resend',provider_reference=$1,error_code='',delivered_at=NOW(),updated_at=NOW() WHERE id=$2`,[sent.reference||'',deliveryId]);
  else await pool.query(`UPDATE notification_deliveries SET status=$1,error_code=$2,updated_at=NOW() WHERE id=$3`,[sent.notConfigured?'not_configured':'failed',sent.error||'',deliveryId]);
  return{sent:Boolean(sent.ok),reference:sent.reference||'',not_configured:Boolean(sent.notConfigured)};
}

async function sendQueuedEmail(pool,row){
  const account=await pool.query(`SELECT email FROM accounts WHERE id=$1`,[row.account_id]);
  const email=clean(account.rows[0]?.email,180).toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return{ok:false,skip:true,error:'recipient_email_missing'};
  const template=await loadTemplate(pool,row.event_code,row.locale,'email',row.data_json);
  const html=`<p>${escapeHtml(template.body)}</p><p><a href="${escapeHtml(process.env.AUTH_PUBLIC_BASE_URL||'/')}">Open Business & Life</a></p>`;
  return resendEmail({to:email,subject:template.title,html,eventCode:row.event_code,category:row.category||'operational'});
}

function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

async function sendQueuedPush(pool,row){
  const pub=process.env.WEB_PUSH_VAPID_PUBLIC_KEY||'',priv=process.env.WEB_PUSH_VAPID_PRIVATE_KEY||'',subject=process.env.WEB_PUSH_SUBJECT||'https://accounting-business-life-production.up.railway.app';
  if(!pub||!priv)return{ok:false,notConfigured:true,error:'push_vapid_not_configured'};
  const {rows:subs}=await pool.query(`SELECT * FROM push_subscriptions WHERE account_id=$1 AND revoked_at IS NULL ORDER BY last_seen_at DESC`,[row.account_id]);
  if(!subs.length)return{ok:false,skip:true,error:'push_subscription_missing'};
  const webpush=(await import('web-push')).default;
  webpush.setVapidDetails(subject,pub,priv);
  const template=await loadTemplate(pool,row.event_code,row.locale,'push',row.data_json);
  const payload=JSON.stringify({title:template.title,body:template.body,url:'/',event_code:row.event_code,entity_type:row.entity_type,entity_id:row.entity_id});
  let successes=0,lastError='';
  for(const sub of subs){
    try{
      await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},payload,{TTL:3600});
      successes++;
    }catch(e){
      lastError=clean(e?.message||e?.statusCode||'push_failed',300);
      if([404,410].includes(Number(e?.statusCode)))await pool.query(`UPDATE push_subscriptions SET revoked_at=NOW() WHERE id=$1`,[sub.id]).catch(()=>{});
    }
  }
  return successes?{ok:true,reference:`${successes}_subscription(s)`}:{ok:false,error:lastError||'push_failed'};
}

export async function processNotificationDeliveries(pool,{limit=20}={}){
  const {rows}=await pool.query(`
    SELECT d.id,d.channel,d.attempt_count,r.account_id,r.locale,e.event_code,e.category,e.entity_type,e.entity_id,e.data_json
    FROM notification_deliveries d
    JOIN notification_recipients r ON r.id=d.recipient_id
    JOIN notification_events e ON e.id=r.event_id
    WHERE d.channel IN ('email','push') AND d.status IN ('queued','retry') AND d.next_attempt_at<=NOW()
    ORDER BY CASE e.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,d.id
    LIMIT $1
  `,[Math.max(1,Math.min(100,Number(limit)||20))]);
  for(const row of rows){
    const claim=await pool.query(`UPDATE notification_deliveries SET status='delivering',attempt_count=attempt_count+1,updated_at=NOW() WHERE id=$1 AND status IN ('queued','retry') RETURNING attempt_count`,[row.id]);
    if(!claim.rowCount)continue;
    const attempt=Number(claim.rows[0].attempt_count);
    let result;
    try{result=row.channel==='email'?await sendQueuedEmail(pool,row):await sendQueuedPush(pool,row)}catch(e){result={ok:false,error:clean(e.message,300)}}
    if(result.ok){
      await pool.query(`UPDATE notification_deliveries SET status='delivered',provider_reference=$1,error_code='',delivered_at=NOW(),updated_at=NOW() WHERE id=$2`,[clean(result.reference,300),row.id]);
    }else if(result.notConfigured){
      await pool.query(`UPDATE notification_deliveries SET status='not_configured',error_code=$1,updated_at=NOW() WHERE id=$2`,[clean(result.error,300),row.id]);
    }else if(result.skip){
      await pool.query(`UPDATE notification_deliveries SET status='skipped',error_code=$1,updated_at=NOW() WHERE id=$2`,[clean(result.error,300),row.id]);
    }else if(attempt<3){
      const delay=Math.min(30,Math.pow(2,attempt));
      await pool.query(`UPDATE notification_deliveries SET status='retry',error_code=$1,next_attempt_at=NOW()+($2*INTERVAL '1 minute'),updated_at=NOW() WHERE id=$3`,[clean(result.error,300),delay,row.id]);
    }else{
      await pool.query(`UPDATE notification_deliveries SET status='failed',error_code=$1,updated_at=NOW() WHERE id=$2`,[clean(result.error,300),row.id]);
    }
  }
  return rows.length;
}

export async function renderNotification(pool,row,channel='in_app'){
  const data=row.data_json&&typeof row.data_json==='object'?row.data_json:{};
  return loadTemplate(pool,row.event_code,row.locale||'en-PH',channel,data);
}
