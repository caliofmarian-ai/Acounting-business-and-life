const clean=v=>String(v??'').trim().toLowerCase();

export const ACCESS_CLASSES=Object.freeze([
  'PUBLIC','MEMBER','PROFILE_PRIVATE','BUSINESS_PRIVATE','OPERATIONS_PRIVATE',
  'TERRITORY_ADMIN','COUNTRY_ADMIN','SUPER_ADMIN','EXECUTIVE_CONFIDENTIAL'
]);

function assignments(ctx){return Array.isArray(ctx?.adminAssignments)?ctx.adminAssignments:[]}
function roleSet(ctx){return new Set(assignments(ctx).map(a=>clean(a.admin_role)))}
function permissionSet(ctx){
  const out=new Set();
  for(const a of assignments(ctx))for(const p of Array.isArray(a.permissions)?a.permissions:[])out.add(clean(p));
  return out;
}
function isOwner(ctx){return Number(ctx?.accountId)===1}
function isSuper(ctx){return roleSet(ctx).has('super_admin')}
function isCountry(ctx){const r=roleSet(ctx);return r.has('super_admin')||r.has('country_admin')}
function isTerritory(ctx){const r=roleSet(ctx);return r.has('super_admin')||r.has('country_admin')||r.has('territory_admin')}

function functionRelevant(doc,ctx){
  const functions=Array.isArray(doc?.applicable_functions)?doc.applicable_functions.map(clean).filter(Boolean):[];
  if(!functions.length)return true;
  if(isOwner(ctx)||isSuper(ctx))return true;
  const roles=roleSet(ctx),perms=permissionSet(ctx);
  for(const fn of functions){
    if(fn.includes('executive')||fn.includes('project owner')){if(isOwner(ctx))return true}
    if(fn.includes('super admin')&&roles.has('super_admin'))return true;
    if(fn.includes('country admin')&&isCountry(ctx))return true;
    if(fn.includes('territory admin')&&isTerritory(ctx))return true;
    if(fn.includes('support')&&perms.has('support.manage'))return true;
    if((fn.includes('incident')||fn.includes('trust & safety'))&&perms.has('incident.triage'))return true;
    if((fn.includes('compliance')||fn.includes('credential reviewer'))&&(
      perms.has('credential.verify')||perms.has('merchant.approve')||perms.has('supplier.approve')||
      perms.has('courier.verify')||perms.has('profiles.review_service_provider')
    ))return true;
    if((fn.includes('finance')||fn.includes('accounting'))&&(perms.has('finance.summary.view')||perms.has('accounting.export.view')))return true;
    if((fn.includes('onboarding')||fn.includes('partner operations'))&&(
      perms.has('profiles.invite_merchant')||perms.has('profiles.invite_supplier')||perms.has('profiles.invite_courier')
    ))return true;
    if(fn.includes('documentation governance')&&perms.has('admin.console'))return true;
  }
  return false;
}

export function canAccessControlledDocument(doc,ctx){
  if(!ctx?.authenticated)return false;
  const access=String(doc?.access_class||'OPERATIONS_PRIVATE').toUpperCase();
  if(!ACCESS_CLASSES.includes(access))return false;

  if(access==='PUBLIC'||access==='MEMBER')return true;

  if(access==='PROFILE_PRIVATE'){
    const required=Array.isArray(doc?.applicable_profiles)?doc.applicable_profiles.map(clean).filter(Boolean):[];
    if(!required.length)return true;
    const enabled=new Set((ctx.enabledProfiles||[]).map(clean));
    return required.some(r=>enabled.has(r));
  }

  if(access==='BUSINESS_PRIVATE')return Boolean(ctx.hasBusinessAccess);

  if(access==='OPERATIONS_PRIVATE'){
    if(!assignments(ctx).length)return false;
    return functionRelevant(doc,ctx);
  }

  if(access==='TERRITORY_ADMIN')return isTerritory(ctx)&&functionRelevant(doc,ctx);
  if(access==='COUNTRY_ADMIN')return isCountry(ctx)&&functionRelevant(doc,ctx);
  if(access==='SUPER_ADMIN')return isSuper(ctx)&&functionRelevant(doc,ctx);
  if(access==='EXECUTIVE_CONFIDENTIAL')return isOwner(ctx);

  return false;
}

export function effectiveAccessClasses(ctx){
  if(!ctx?.authenticated)return[];
  const out=['PUBLIC','MEMBER'];
  if((ctx.enabledProfiles||[]).length)out.push('PROFILE_PRIVATE');
  if(ctx.hasBusinessAccess)out.push('BUSINESS_PRIVATE');
  if(assignments(ctx).length)out.push('OPERATIONS_PRIVATE');
  if(isTerritory(ctx))out.push('TERRITORY_ADMIN');
  if(isCountry(ctx))out.push('COUNTRY_ADMIN');
  if(isSuper(ctx))out.push('SUPER_ADMIN');
  if(isOwner(ctx))out.push('EXECUTIVE_CONFIDENTIAL');
  return out;
}

export function documentationAccessContext({me,adminAssignments=[],hasBusinessAccess=false}){
  return{
    authenticated:Boolean(me?.account?.id),
    accountId:Number(me?.account?.id)||null,
    enabledProfiles:(me?.profiles||[]).filter(p=>p?.enabled).map(p=>clean(p.role)).filter(Boolean),
    activeRole:clean(me?.account?.active_role),
    adminAssignments,
    hasBusinessAccess:Boolean(hasBusinessAccess)
  };
}
