// Documentation policy reads the canonical account snapshot and active RBAC
// assignments. It grants access to repository guidance, never operating powers.
export const ACCESS_CLASSES = Object.freeze([
  'MEMBER', 'PROFILE_PRIVATE', 'BUSINESS_PRIVATE', 'OPERATIONS_PRIVATE',
  'TERRITORY_ADMIN', 'COUNTRY_ADMIN', 'SUPER_ADMIN', 'EXECUTIVE_CONFIDENTIAL'
]);
const rank = a => a.effective_rank || a.authority_rank || a.admin_role;
const role = value => String(value || '').trim().toLowerCase().replaceAll(' ', '_');
const functions = Object.freeze({
  'Support Agent': ['support.manage'],
  'Incident / Trust & Safety Agent': ['incident.triage'],
  'Compliance / Credential Reviewer': ['credential.verify', 'merchant.approve', 'supplier.approve', 'courier.verify', 'profiles.review_service_provider'],
  'Documentation Governance Owner': ['legal.manage']
});

export function documentationAccessContext(me, adminAssignments = [], { privilegedVerified = false, now = Date.now() } = {}) {
  const accountId = Number(me?.account?.id);
  const authenticated = Number.isSafeInteger(accountId) && accountId > 0
    && !['suspended', 'closed'].includes(me?.account?.auth_status);
  const profiles = (me?.profiles || []).filter(p => p.enabled === true && p.status === 'active').map(p => role(p.role));
  const assignments = authenticated ? adminAssignments.filter(a =>
    Number(a.account_id) === accountId && a.status === 'active'
    && ['super_admin', 'country_admin', 'territory_admin', 'specialist'].includes(rank(a))
    && (a.country_code === 'PH' || (rank(a) === 'super_admin' && a.country_code === 'GLB'))
    && Number.isFinite(Date.parse(a.effective_from)) && Date.parse(a.effective_from) <= now
    && (a.effective_until == null || Date.parse(a.effective_until) > now)
  ) : [];
  const superAdmin = assignments.some(a => rank(a) === 'super_admin');
  return {
    authenticated, accountId,
    enabledProfiles: authenticated ? profiles : [],
    hasBusinessAccess: authenticated && profiles.some(p => ['merchant', 'supplier'].includes(p))
      && (me?.businesses || []).some(b => b.active === true && b.country_code === 'PH'),
    adminAssignments: assignments,
    adminLocked: superAdmin && !privilegedVerified,
    privilegedVerified: !superAdmin || privilegedVerified
  };
}

function functionRelevant(doc, assignments) {
  const required = doc.applicable_functions || [];
  if (!required.length) return true;
  return assignments.some(a => {
    const r = rank(a);
    if (r === 'super_admin') return true;
    return required.some(fn => {
      if (fn === 'Country Admin') return r === 'country_admin';
      if (fn === 'Territory Admin') return ['country_admin', 'territory_admin'].includes(r);
      return (functions[fn] || []).some(p => (a.permissions || []).includes(p));
    });
  });
}

export function canAccessControlledDocument(doc, ctx) {
  if (!ctx?.authenticated || !ACCESS_CLASSES.includes(doc?.access_class)) return false;
  // These are reusable global/PH guides, not private territory/business records.
  // A future document with a concrete territory needs an explicit scoped policy.
  if (!['PH', 'GLB'].includes(doc.country_code) || doc.territory_id != null
      || !['global', 'country', 'national'].includes(doc.territory_scope)) return false;
  if (doc.access_class === 'MEMBER') return true;
  if (doc.access_class === 'PROFILE_PRIVATE') {
    const required = doc.applicable_profiles || [];
    return !required.length || required.some(p => ctx.enabledProfiles.includes(role(p)));
  }
  if (doc.access_class === 'BUSINESS_PRIVATE') {
    return ctx.hasBusinessAccess && (!(doc.applicable_profiles || []).length
      || doc.applicable_profiles.some(p => ctx.enabledProfiles.includes(role(p))));
  }
  if (!ctx.privilegedVerified) return false;
  const assignments = ctx.adminAssignments;
  const ranks = assignments.map(rank);
  if (doc.access_class === 'EXECUTIVE_CONFIDENTIAL') return ctx.accountId === 1 && ranks.includes('super_admin');
  if (!functionRelevant(doc, assignments)) return false;
  if (doc.access_class === 'OPERATIONS_PRIVATE') return assignments.length > 0;
  if (doc.access_class === 'SUPER_ADMIN') return ranks.includes('super_admin');
  if (doc.access_class === 'COUNTRY_ADMIN') return ranks.some(r => ['super_admin', 'country_admin'].includes(r));
  if (doc.access_class === 'TERRITORY_ADMIN') return ranks.some(r => ['super_admin', 'country_admin', 'territory_admin'].includes(r));
  return false;
}

export function documentationAccessSummary(ctx, documents) {
  const classes = [...new Set(documents.map(d => d.access_class))].sort();
  return { profiles: ctx.enabledProfiles, business_guidance: ctx.hasBusinessAccess,
    admin_available: ctx.adminAssignments.length > 0, admin_locked: ctx.adminLocked,
    access_classes: classes, document_count: documents.length };
}
