export const ADMIN_RANKS = Object.freeze({
  super_admin:Object.freeze({code:'super_admin',label:'Super Admin',level:100,scope:'platform',protected:true}),
  country_admin:Object.freeze({code:'country_admin',label:'Country Admin',level:80,scope:'country',protected:false}),
  territory_admin:Object.freeze({code:'territory_admin',label:'Territory Admin',level:60,scope:'territory',protected:false}),
  specialist:Object.freeze({code:'specialist',label:'Specialist',level:40,scope:'country_or_territory',protected:false})
});

export const ADMIN_FUNCTION_BUNDLES = Object.freeze({
  support_operations:Object.freeze({
    code:'support_operations',label:'Support Operations',
    description:'Support queues, replies, routing and service recovery.',
    assignable_to:['country_admin','territory_admin','specialist'],
    permissions:['admin.console','support.manage']
  }),
  profile_onboarding:Object.freeze({
    code:'profile_onboarding',label:'Profile Onboarding',
    description:'Invitations, application review, approvals and profile suspension.',
    assignable_to:['country_admin','territory_admin','specialist'],
    permissions:['admin.console','profiles.invite_merchant','profiles.invite_supplier','profiles.invite_courier','merchant.approve','supplier.approve','profiles.review_service_provider','profile.suspend']
  }),
  trust_safety:Object.freeze({
    code:'trust_safety',label:'Trust & Safety',
    description:'Incident triage, escalations and scoped safety interventions.',
    assignable_to:['country_admin','territory_admin','specialist'],
    permissions:['admin.console','incident.triage','profile.suspend']
  }),
  compliance_credentials:Object.freeze({
    code:'compliance_credentials',label:'Compliance & Credentials',
    description:'Credential review and regulated-profile verification.',
    assignable_to:['country_admin','territory_admin','specialist'],
    permissions:['admin.console','credential.verify','courier.verify','profiles.review_service_provider','legal.view']
  }),
  finance_accounting:Object.freeze({
    code:'finance_accounting',label:'Finance & Accounting',
    description:'Financial summaries, accounting exports and operational metrics.',
    assignable_to:['country_admin','territory_admin','specialist'],
    permissions:['admin.console','finance.summary.view','finance.cost.manage','accounting.export.view','metrics.view']
  }),
  payments_settlements:Object.freeze({
    code:'payments_settlements',label:'Payments & Settlements',
    description:'Payment operations, reconciliation, settlements and bounded fee-policy work.',
    assignable_to:['country_admin','territory_admin','specialist'],
    permissions:['admin.console','payment.view','payment.manage','payment.reconcile','settlement.manage','fee_policy.manage_limited','finance.summary.view']
  }),
  legal_governance:Object.freeze({
    code:'legal_governance',label:'Legal & Governance',
    description:'Legal document visibility and delegated governance management.',
    assignable_to:['country_admin','territory_admin','specialist'],
    permissions:['admin.console','legal.view','legal.manage']
  }),
  audit_analytics:Object.freeze({
    code:'audit_analytics',label:'Audit & Analytics',
    description:'Admin audit review, operational metrics and anomaly investigation.',
    assignable_to:['country_admin','territory_admin','specialist'],
    permissions:['admin.console','audit.view','metrics.view','finance.summary.view']
  }),
  territory_operations:Object.freeze({
    code:'territory_operations',label:'Territory Operations',
    description:'Operating-cell configuration, local oversight and scoped metrics.',
    assignable_to:['country_admin','territory_admin'],
    permissions:['admin.console','territory.manage','metrics.view','support.manage']
  }),
  admin_delegation:Object.freeze({
    code:'admin_delegation',label:'Admin Delegation',
    description:'Delegate lower-rank Admin authority within owned permissions and scope.',
    assignable_to:['country_admin','territory_admin'],
    permissions:['admin.console','admin.assign_limited','admin.delegate','audit.view']
  })
});

export function rankLevel(role){
  return Number(ADMIN_RANKS[String(role||'')]?.level||0);
}

export function canDelegateRank(actorRole,targetRole){
  const actor=ADMIN_RANKS[String(actorRole||'')],target=ADMIN_RANKS[String(targetRole||'')];
  if(!actor||!target||target.code==='super_admin')return false;
  return actor.level>target.level;
}

export function isFunctionAssignableToRole(functionCode,role){
  const fn=ADMIN_FUNCTION_BUNDLES[String(functionCode||'')];
  return Boolean(fn&&fn.assignable_to.includes(String(role||'')));
}

export function expandAdminFunctions(functionCodes,role=null){
  const out=new Set();
  for(const code of Array.isArray(functionCodes)?functionCodes:[]){
    const fn=ADMIN_FUNCTION_BUNDLES[String(code||'')];
    if(!fn)continue;
    if(role&&!fn.assignable_to.includes(String(role)))continue;
    fn.permissions.forEach(p=>out.add(p));
  }
  return [...out];
}

export function publicAdminCatalog(){
  return {
    ranks:Object.values(ADMIN_RANKS).map(x=>({...x})),
    functions:Object.values(ADMIN_FUNCTION_BUNDLES).map(x=>({...x,permissions:[...x.permissions],assignable_to:[...x.assignable_to]}))
  };
}
