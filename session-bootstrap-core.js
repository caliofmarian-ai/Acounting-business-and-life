const PUBLIC_PROFILE_ROLES = new Set(['customer', 'merchant', 'supplier', 'courier', 'service_provider']);

function enabledProfileNavigation(profileSnapshot) {
  return (Array.isArray(profileSnapshot?.profiles) ? profileSnapshot.profiles : [])
    .filter(profile => profile?.enabled === true && PUBLIC_PROFILE_ROLES.has(profile.role))
    .map(profile => ({
      role: profile.role,
      profile_id: profile.profile_id || null,
      status: profile.status || 'active'
    }));
}

export function buildSessionBootstrap(profileSnapshot, adminIdentity = null) {
  if (!profileSnapshot?.account?.id) throw new TypeError('A profile snapshot with an account is required');
  const isAdmin = adminIdentity?.is_admin === true && Array.isArray(adminIdentity.assignments) && adminIdentity.assignments.length > 0;
  const admin = isAdmin ? adminIdentity : { is_admin: false, assignments: [], permissions: [] };
  return {
    version: 'v1',
    initial_surface: 'account',
    selected_profile_id: null,
    profile: profileSnapshot,
    navigation: {
      account: true,
      profiles: enabledProfileNavigation(profileSnapshot),
      admin: isAdmin
    },
    admin
  };
}
