const DELIVERY_EVENTS=Object.freeze([
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.complained',
  'email.failed',
  'email.suppressed'
]);

const clean=(v,max=500)=>String(v??'').trim().slice(0,max);

export function resendDeliveryWebhookEvents(){return [...DELIVERY_EVENTS]}

export function canonicalResendWebhookUrl(baseUrl=''){
  const raw=clean(baseUrl,1000);
  if(!raw)return'';
  try{
    const u=new URL(raw);
    if(!['https:','http:'].includes(u.protocol))return'';
    u.pathname='/api/notifications/webhooks/resend';
    u.search='';
    u.hash='';
    return u.toString();
  }catch{return''}
}

function enabled(v){return ['1','true','yes','on'].includes(String(v||'').trim().toLowerCase())}

function publicState(state={}){
  const {secret:_secret,...safe}=state;
  return safe;
}

async function jsonResponse(response){
  return response.json().catch(()=>({}));
}

async function resendRequest(fetchImpl,apiKey,path,options={}){
  const r=await fetchImpl('https://api.resend.com'+path,{
    ...options,
    headers:{
      Authorization:'Bearer '+apiKey,
      'Content-Type':'application/json',
      ...(options.headers||{})
    }
  });
  const body=await jsonResponse(r);
  return{ok:r.ok,status:r.status,body};
}

function webhookList(body){
  if(Array.isArray(body?.data))return body.data;
  if(Array.isArray(body))return body;
  return[];
}

function signingSecret(row){return clean(row?.signing_secret||row?.signingSecret,500)}
function webhookId(row){return clean(row?.id,200)}
function webhookEndpoint(row){return clean(row?.endpoint||row?.url,1000)}

export async function bootstrapResendWebhook({env=process.env,fetchImpl=fetch}={}){
  const explicitSecret=clean(env.RESEND_WEBHOOK_SECRET,500);
  const endpoint=canonicalResendWebhookUrl(env.AUTH_PUBLIC_BASE_URL||'');
  if(explicitSecret)return{
    ready:true,status:'ready',source:'env',endpoint,webhook_id:'',secret:explicitSecret
  };

  if(String(env.AUTH_EMAIL_PROVIDER||'').toLowerCase()!=='resend')return{
    ready:false,status:'provider_not_resend',source:'none',endpoint,webhook_id:'',secret:''
  };
  if(!enabled(env.RESEND_WEBHOOK_AUTO_BOOTSTRAP))return{
    ready:false,status:'auto_bootstrap_disabled',source:'none',endpoint,webhook_id:'',secret:''
  };
  if(!endpoint)return{
    ready:false,status:'public_base_url_invalid',source:'none',endpoint:'',webhook_id:'',secret:''
  };

  const apiKey=clean(env.RESEND_WEBHOOK_API_KEY||env.RESEND_API_KEY,500);
  if(!apiKey)return{
    ready:false,status:'api_key_missing',source:'none',endpoint,webhook_id:'',secret:''
  };

  try{
    const listed=await resendRequest(fetchImpl,apiKey,'/webhooks',{method:'GET'});
    if(!listed.ok)return{
      ready:false,status:'list_http_'+listed.status,source:'resend_api',endpoint,webhook_id:'',secret:''
    };

    const existing=webhookList(listed.body).find(row=>webhookEndpoint(row)===endpoint);
    if(existing){
      let detail=existing;
      let secret=signingSecret(detail);
      const id=webhookId(detail);
      if(!secret&&id){
        const retrieved=await resendRequest(fetchImpl,apiKey,'/webhooks/'+encodeURIComponent(id),{method:'GET'});
        if(retrieved.ok)detail=retrieved.body?.data||retrieved.body||detail;
        secret=signingSecret(detail);
      }
      if(!secret)return{
        ready:false,status:'existing_secret_unavailable',source:'resend_api',endpoint,webhook_id:id,secret:''
      };
      return{
        ready:true,status:'reused',source:'resend_api',endpoint,webhook_id:id,secret
      };
    }

    const created=await resendRequest(fetchImpl,apiKey,'/webhooks',{
      method:'POST',
      body:JSON.stringify({endpoint,events:DELIVERY_EVENTS})
    });
    if(!created.ok)return{
      ready:false,status:'create_http_'+created.status,source:'resend_api',endpoint,webhook_id:'',secret:''
    };
    const row=created.body?.data||created.body||{};
    const secret=signingSecret(row);
    const id=webhookId(row);
    if(!secret)return{
      ready:false,status:'created_secret_unavailable',source:'resend_api',endpoint,webhook_id:id,secret:''
    };
    return{
      ready:true,status:'created',source:'resend_api',endpoint,webhook_id:id,secret
    };
  }catch(e){
    return{
      ready:false,status:'request_failed',source:'resend_api',endpoint,webhook_id:'',secret:'',error:clean(e?.message,200)
    };
  }
}

export function resendWebhookReadiness(state={}){
  return publicState({
    ready:Boolean(state.ready),
    status:clean(state.status||'not_ready',80),
    source:clean(state.source||'none',40),
    endpoint:clean(state.endpoint||'',1000),
    webhook_id:clean(state.webhook_id||'',200),
    error:clean(state.error||'',200)
  });
}
