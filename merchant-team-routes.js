/** Merchant #863: team operator management and shift unlock, never a full account login.
 * All routes are owned by the existing Orders runtime and require an authenticated
 * main Merchant session + exact business before examining any team data.
 */
import {
  teamShiftFlag,teamSessionBinding,addTeamOperator,listTeamOperators,
  beginTeamShift,resolveTeamShift,stopTeamOperator,endTeamShift
} from './merchant-team-operators.js';

const validId=v=>Number.isSafeInteger(Number(v))&&Number(v)>0;
const safeCodes=new Set(['TEAM_NOT_CONFIGURED','TEAM_ACCOUNT_SESSION','TEAM_OWNER_STEP_UP_REQUIRED','TEAM_OWNER_REQUIRED',
  'TEAM_NAME_INVALID','TEAM_PIN_INVALID','TEAM_ROLE_INVALID','TEAM_EXPIRY_INVALID',
  'TEAM_LIMIT','TEAM_OPERATOR_INVALID','TEAM_OPERATOR_NOT_FOUND','TEAM_OPERATOR_INACTIVE',
  'TEAM_PIN_LOCKED','TEAM_PIN_REJECTED','TEAM_SHIFT_REQUIRED','TEAM_SHIFT_ENDED','TEAM_PERMISSION_DENIED',
  'TEAM_OPERATOR_TERMINAL_REQUIRED']);
const error=(status,code,message)=>Object.assign(new Error(message),{status,code});
const loginToken=req=>String(req.ablSessionToken||req.headers?.authorization||'').replace(/^Bearer\s+/i,'').trim();
const shiftToken=req=>String(req.headers?.['x-merchant-team-shift']||'').trim();
export function installMerchantTeamRoutes(app,{
  db,requireMerchant,bodyMiddleware=null,env=process.env,
  secret=env.MERCHANT_TEAM_SECRET||env.TOKEN_SECRET||'',pinPepper=env.MERCHANT_TEAM_PIN_PEPPER||'',tokenSecret=env.TOKEN_SECRET||'',
  now=()=>new Date(),shiftStart=beginTeamShift,requireShift=resolveTeamShift
}={}){
  if(!app?.get||!app?.post||!app?.patch||!db?.connect||typeof requireMerchant!=='function')
    throw new TypeError('Team operators require canonical Merchant authorization and PostgreSQL.');
  const enabled=()=>teamShiftFlag(env);
  async function context(req,rawBusinessId){
    if(!validId(rawBusinessId))throw error(400,'TEAM_ACCOUNT_SESSION','Choose an active Merchant business.');
    const bid=Number(rawBusinessId);
    const {me,business}=await requireMerchant(req,bid);
    const aid=Number(me?.account?.id);
    if(!validId(aid)||Number(business?.id)!==bid)throw error(403,'TEAM_ACCOUNT_SESSION','Merchant business is unavailable.');
    const token=loginToken(req);
    const binding=teamSessionBinding({token,accountId:aid,businessId:bid,secret});
    return{businessId:bid,accountId:aid,token,sessionBinding:binding};
  }
  const respond=fn=>async(req,res)=>{
    res.set('Cache-Control','private, no-store, max-age=0');
    try{
      if(!enabled())throw error(503,'TEAM_NOT_CONFIGURED','Merchant Team is not enabled.');
      const ctx=await context(req,req.method==='GET'?req.query?.business_id:req.body?.business_id);
      const value=await fn(req,ctx);
      res.json(value);
    }catch(e){
      const status=[400,401,403,404,409,422,428,429,503].includes(e?.status)?e.status:503;
      const code=safeCodes.has(e?.code)?e.code:'TEAM_UNAVAILABLE';
      if(status===429)res.set('Retry-After','900');
      res.status(status).json({code,error:safeCodes.has(e?.code)?String(e.message).slice(0,200):'Team operation unavailable.'});
    }
  };
  const withBody=(path,fn)=>bodyMiddleware?app.post(path,bodyMiddleware,respond(fn)):app.post(path,respond(fn));
  const patchBody=(path,fn)=>bodyMiddleware?app.patch(path,bodyMiddleware,respond(fn)):app.patch(path,respond(fn));
  app.get('/api/orders/team/operators',respond(async(_req,ctx)=>({business_id:ctx.businessId,
    terminal_enabled:env.MERCHANT_TEAM_TERMINAL_ENABLED==='1',
    operators:await listTeamOperators(db,ctx)})));
  withBody('/api/orders/team/operators',async(req,ctx)=>({operator:await addTeamOperator(db,{
    ...ctx,tokenSecret,pepper:pinPepper,secret,input:{
      name:req.body?.name,role:req.body?.role,pin:req.body?.pin,expiresAt:req.body?.expires_at
    },now:now()
  })}));
  patchBody('/api/orders/team/operators/:operatorId/disable',async(req,ctx)=>await stopTeamOperator(db,{
    ...ctx,operatorId:req.params?.operatorId,tokenSecret,now:now()
  }));
  withBody('/api/orders/team/shift/start',async(req,ctx)=>{
    if(env.MERCHANT_TEAM_TERMINAL_ENABLED==='1')
      throw error(403,'TEAM_OPERATOR_TERMINAL_REQUIRED','Use the restricted staff terminal, not the owner session.');
    return{shift:await shiftStart(db,{
    ...ctx,operatorId:req.body?.operator_id,pin:req.body?.pin,
    secret,pepper:pinPepper,now:now()
  })};
  });
  app.get('/api/orders/team/shift/current',respond(async(req,ctx)=>({shift:await requireShift(db,{
    ...ctx,secret,token:shiftToken(req),requiredPermission:null,now:now()
  })})));
  withBody('/api/orders/team/shift/end',async(req,ctx)=>await endTeamShift(db,{
    ...ctx,secret,token:shiftToken(req)
  }));
  // No anonymous team auth or broad account impersonation endpoint is added.
  // Voice routes receive this callback for their own narrow draft-only scope.
  return{enabled,resolveForVoice:async(req,{accountId,businessId,permission='orders.voice_draft'}={})=>{
    if(!enabled())throw error(503,'TEAM_NOT_CONFIGURED','Merchant Team is not enabled.');
    if(env.MERCHANT_TEAM_TERMINAL_ENABLED==='1')
      throw error(403,'TEAM_OPERATOR_TERMINAL_REQUIRED','Use the restricted staff terminal for AI voice orders.');
    const token=loginToken(req),sessionBinding=teamSessionBinding({token,accountId,businessId,secret});
    return requireShift(db,{businessId,accountId,sessionBinding,secret,token:shiftToken(req),requiredPermission:permission,now:now()});
  }};
}