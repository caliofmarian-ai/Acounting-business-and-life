/**
 * Restricted staff portal routes. No account bearer, main Merchant auth cookie,
 * or general app API is given to a staff member. All staff actions live under
 * /api/orders/operator/* and use a distinct HttpOnly session + CSRF header.
 */
import {readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  TERMINAL_COOKIE,forbidOwnerSession,terminalCookieValue,terminalCsrf,verifyTerminalCsrf,
  issueMerchantTeamPairing,listPairingOperators,activateMerchantTeamTerminal,
  resolveMerchantTeamTerminal,endMerchantTeamTerminal
} from './merchant-team-terminal-core.js';

const root=dirname(fileURLToPath(import.meta.url));
const failure=(status,code,message)=>Object.assign(new Error(message),{status,code});
const positive=v=>Number.isSafeInteger(Number(v))&&Number(v)>0;
const safeErrors=new Set([
  'OPERATOR_TERMINAL_UNAVAILABLE','OPERATOR_OWNER_SESSION','OPERATOR_SESSION_REQUIRED',
  'OPERATOR_PAIR_INVALID','OPERATOR_PAIR_LIMIT','OPERATOR_PIN_REJECTED',
  'OPERATOR_PERMISSION_DENIED','OPERATOR_CSRF_REQUIRED',
  'TEAM_OWNER_REQUIRED','TEAM_OWNER_STEP_UP_REQUIRED','TEAM_OPERATOR_INACTIVE',
  'TEAM_CREDENTIAL_INVALID','TEAM_NOT_CONFIGURED','TEAM_ACCOUNT_SESSION',
  'ORDER_VOICE_BAD_REQUEST','ORDER_VOICE_NOT_CONFIGURED','ORDER_VOICE_CATALOG_EMPTY',
  'ORDER_VOICE_RATE_LIMIT','VOICE_CONTEXT_STALE','PRODUCT_UNKNOWN','PRODUCT_AMBIGUOUS',
  'DRAFT_INVALID','DRAFT_PRODUCT_STALE','VOICE_QUOTE_STALE'
]);
const cookieHeader=req=>String(req.headers?.cookie||'');
const sessionToken=req=>terminalCookieValue(cookieHeader(req));
const noOwner=req=>{
  forbidOwnerSession(cookieHeader(req));
  // The canonical account gateway also accepts Authorization bearers.
  // A distinct operator cookie must never coexist with any owner credential.
  const authorization=Object.entries(req.headers||{}).some(([name,value])=>
    name.toLowerCase()==='authorization'&&String(value??'').trim().length>0);
  if(authorization||req.ablSessionToken)
    throw failure(409,'OPERATOR_OWNER_SESSION',
      'Sign out of the primary Business & Life account before opening a staff terminal on this browser.');
};
const sessionCookie=(token,maxAge)=>`${TERMINAL_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
const flag=env=>env.MERCHANT_TEAM_ENABLED==='1'&&env.MERCHANT_TEAM_TERMINAL_ENABLED==='1';
// A staff terminal does not receive raw unit costs, Inventory bindings, supplier
// terms or business finance data from the private Merchant Catalog.
export function staffOrderCatalog(rows=[]){
  return (Array.isArray(rows)?rows:[]).filter(p=>p.active!==false&&p.available===true).map(p=>({
    id:Number(p.id),source_kind:p.source_kind||'product',name:String(p.name||''),
    category:String(p.category||''),selling_price:Number(p.selling_price||0),
    active:true,available:true,published:Boolean(p.published),
    variant_mode:Boolean(p.variant_mode),
    variants:(Array.isArray(p.variants)?p.variants:[]).map(v=>({
      id:Number(v.id),variant_key:String(v.variant_key||''),
      price_override:v.price_override==null?null:Number(v.price_override),
      in_stock:Boolean(v.in_stock),option_values:(Array.isArray(v.option_values)?v.option_values:[]).map(o=>({
        value_code:String(o.value_code||''),value_label:String(o.value_label||'')
      }))
    })),
    modifier_groups:(Array.isArray(p.modifier_groups)?p.modifier_groups:[]).map(g=>({
      id:Number(g.id),name:String(g.name||''),code:String(g.code||''),
      min_select:Number(g.min_select||0),max_select:Number(g.max_select||0),
      options:(Array.isArray(g.options)?g.options:[]).map(o=>({
        id:Number(o.id),name:String(o.name||''),code:String(o.code||''),
        price_delta:Number(o.price_delta||0)
      }))
    }))
  }));
}


export function installMerchantTeamTerminalRoutes(app,{
  db,requireMerchant,env=process.env,bodyMiddleware,
  secret=env.MERCHANT_TEAM_SECRET||'',pepper=env.MERCHANT_TEAM_PIN_PEPPER||'',
  tokenSecret=env.TOKEN_SECRET||'',
  catalogForBusiness,interpretTurn,applyTurn,quoteForDraft,chargeAiQuota,
  listOrdersForBusiness,now=()=>new Date()
}={}){
  if(!app?.get||!app?.post||!db?.connect||typeof requireMerchant!=='function'||
      typeof catalogForBusiness!=='function')throw new TypeError('Merchant terminal requires existing Orders services.');
  const enabled=()=>flag(env);
  const response=fn=>async(req,res)=>{
    res.set('Cache-Control','private, no-store, max-age=0');
    res.set('X-Content-Type-Options','nosniff');
    try{
      if(!enabled())throw failure(503,'OPERATOR_TERMINAL_UNAVAILABLE','Staff terminal is not enabled.');
      const result=await fn(req,res);
      if(!res.headersSent&&result!==undefined)res.json(result);
    }catch(error){
      const status=[400,401,403,404,409,413,422,428,429,503].includes(error?.status)?error.status:503;
      const code=safeErrors.has(error?.code)?error.code:'OPERATOR_TERMINAL_UNAVAILABLE';
      if(status===429)res.set('Retry-After','900');
      res.status(status).json({code,error:safeErrors.has(error?.code)?String(error.message).slice(0,200):
        'Staff terminal action could not be completed.'});
    }
  };
  const post=(path,fn)=>bodyMiddleware?app.post(path,bodyMiddleware,response(fn)):app.post(path,response(fn));
  const requireSession=async(req,permission=null,csrf=false)=>{
    noOwner(req);
    const token=sessionToken(req);
    const state=await resolveMerchantTeamTerminal(db,{token,secret,permission,now:now()});
    if(csrf&&!verifyTerminalCsrf(secret,token,req.headers?.['x-team-csrf-token']))
      throw failure(403,'OPERATOR_CSRF_REQUIRED','Refresh the staff page and try again.');
    return{...state,token};
  };
  const ownerAuth=async req=>{
    const businessId=Number(req.body?.business_id);
    if(!positive(businessId))throw failure(400,'TEAM_OWNER_REQUIRED','Select a valid Merchant business.');
    const {me,business}=await requireMerchant(req,businessId);
    if(!positive(me?.account?.id)||Number(business?.id)!==businessId)
      throw failure(403,'TEAM_OWNER_REQUIRED','Merchant business permission required.');
    const token=String(req.ablSessionToken||req.headers?.authorization||'').replace(/^Bearer\s+/i,'').trim();
    return{businessId,accountId:Number(me.account.id),token,tokenSecret,secret,now:now()};
  };

  // This endpoint is visible only to the authenticated, reverified Merchant OWNER.
  post('/api/orders/team/terminal/pair',async req=>{
    const pairing=await issueMerchantTeamPairing(db,await ownerAuth(req));
    return{pair_code:pairing.pair_code,expires_at:pairing.expires_at,
      url_fragment:'#pair='+pairing.pair_code};
  });

  // All worker entrypoints refuse even the presence of an owner login cookie.
  app.get('/operator',async(req,res)=>{
    res.set('Cache-Control','no-store');
    if(!enabled())return res.status(404).type('text/plain').send('Staff terminal is unavailable.');
    res.type('html').send(readFileSync(join(root,'public','merchant-operator.html'),'utf8'));
  });
  app.get('/merchant-operator-ui.js',(_req,res)=>{
    res.set('Cache-Control','no-store');
    if(!enabled())return res.status(404).end();
    res.type('application/javascript').send(readFileSync(join(root,'public','merchant-operator-ui.js'),'utf8'));
  });
  app.get('/merchant-operator.css',(_req,res)=>{
    res.set('Cache-Control','no-store');
    if(!enabled())return res.status(404).end();
    res.type('text/css').send(readFileSync(join(root,'public','merchant-operator.css'),'utf8'));
  });

  post('/api/orders/operator/pair/operators',async req=>{
    noOwner(req);
    return listPairingOperators(db,{code:req.body?.pair_code,secret,now:now()});
  });
  post('/api/orders/operator/pair/start',async(req,res)=>{
    noOwner(req);
    if(sessionToken(req))throw failure(409,'OPERATOR_OWNER_SESSION','End your previous staff shift before switching operators.');
    const result=await activateMerchantTeamTerminal(db,{code:req.body?.pair_code,
      operatorId:req.body?.operator_id,pin:req.body?.pin,secret,pepper,now:now()});
    const remaining=Math.max(1,Math.min(8*3600,Math.floor((Date.parse(result.expires_at)-now().getTime())/1000)));
    res.set('Set-Cookie',sessionCookie(result.token,remaining));
    return{signed_in:true,operator:{id:result.operator_id,name:result.name,role:result.role},
      expires_at:result.expires_at};
  });
  app.get('/api/orders/operator/session',response(async(req)=>{
    const state=await requireSession(req,null);
    return{active:true,business_id:state.business_id,operator:{id:state.operator_id,
      name:state.name,role:state.role,permissions:state.permissions},
      expires_at:state.expires_at,csrf_token:terminalCsrf(secret,state.token),
      capabilities:{voice_draft:state.permissions.includes('orders.voice_draft'),
        order_create:false,money:false,refund:false,admin:false}};
  }));
  post('/api/orders/operator/logout',async(req,res)=>{
    const state=await requireSession(req,null,true);
    await endMerchantTeamTerminal(db,{token:state.token,secret});
    res.set('Set-Cookie',sessionCookie('',0));
    return{ended:true};
  });
  app.get('/api/orders/operator/catalog',response(async req=>{
    const state=await requireSession(req,'orders.voice_draft');
    const catalog=staffOrderCatalog(await catalogForBusiness(state.business_id));
    return{business_id:state.business_id,operator_id:state.operator_id,
      products:catalog};
  }));
  app.get('/api/orders/operator/orders',response(async req=>{
    const state=await requireSession(req,'orders.read');
    if(typeof listOrdersForBusiness!=='function')throw failure(503,'OPERATOR_TERMINAL_UNAVAILABLE','Orders are not available.');
    const orders=await listOrdersForBusiness(state.business_id);
    return{business_id:state.business_id,orders:orders.map(o=>({id:Number(o.id),
      order_number:String(o.order_number||''),order_status:String(o.order_status||''),
      payment_status:String(o.payment_status||''),total:Number(o.total||0)}))};
  }));
  post('/api/orders/operator/voice/turn',async req=>{
    const state=await requireSession(req,'orders.voice_draft',true);
    if(typeof interpretTurn!=='function'||typeof applyTurn!=='function'||typeof chargeAiQuota!=='function'||
       env.ORDER_VOICE_AI_ENABLED!=='1')throw failure(503,'ORDER_VOICE_NOT_CONFIGURED','AI assistant is not activated.');
    const transcript=req.body?.transcript;
    if(req.body?.consent!==true||typeof transcript!=='string'||!transcript.trim()||transcript.length>1200)
      throw failure(400,'ORDER_VOICE_BAD_REQUEST','Confirm speech/text processing and enter up to 1,200 characters.');
    const previous=req.body?.previous_draft??null;
    if(previous&&JSON.stringify(previous).length>40000)
      throw failure(413,'ORDER_VOICE_BAD_REQUEST','Order draft too large.');
    const catalog=staffOrderCatalog(await catalogForBusiness(state.business_id));
    if(!catalog.some(p=>p.available===true&&p.active!==false))
      throw failure(409,'ORDER_VOICE_CATALOG_EMPTY','Add sellable products to Catalog first.');
    const args={businessId:state.business_id,sessionId:state.voice_session_id,catalog};
    const checked=applyTurn({...args,previousDraft:previous,turn:{operations:[]}});
    await chargeAiQuota({businessId:state.business_id,accountId:state.owner_account_id});
    const turn=await interpretTurn({transcript,catalog,priorLines:checked.draft.lines,consent:true});
    const output=applyTurn({...args,previousDraft:checked.draft,turn});
    // A disabled or expired employee must never get a late model response.
    await requireSession(req,'orders.voice_draft');
    return{...output,operator_id:state.operator_id,creates_orders:false};
  });
  post('/api/orders/operator/voice/quote',async req=>{
    const state=await requireSession(req,'orders.voice_draft',true);
    if(typeof quoteForDraft!=='function'||typeof applyTurn!=='function')
      throw failure(503,'ORDER_VOICE_NOT_CONFIGURED','Voice quoting is unavailable.');
    if(req.body?.consent!==true||!req.body?.draft||typeof req.body.draft!=='object'||
       JSON.stringify(req.body.draft).length>40000)throw failure(400,'ORDER_VOICE_BAD_REQUEST','Review the current draft.');
    const catalog=staffOrderCatalog(await catalogForBusiness(state.business_id));
    const checked=applyTurn({businessId:state.business_id,sessionId:state.voice_session_id,
      catalog,previousDraft:req.body.draft,turn:{operations:[]}}).draft;
    const quote=await quoteForDraft({...state,draft:checked});
    await requireSession(req,'orders.voice_draft');
    return{...quote,operator_id:state.operator_id,creates_orders:false};
  });
  // Deliberately no /create, /payment, /refund, /stock-write, /admin endpoint.
  return{enabled};
}