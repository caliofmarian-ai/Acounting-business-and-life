const ROLE_META = {
  merchant: { label: 'Merchant', icon: '🏪', desc: 'Accounting, products and business', hero: 'Run your business with every peso visible.' },
  customer: { label: 'Customer', icon: '🛍️', desc: 'Discover, order and track', hero: 'Discover local. Order with confidence.' },
  supplier: { label: 'Supplier', icon: '📦', desc: 'Catalog and procurement orders', hero: 'Supply local businesses from one place.' },
  courier: { label: 'Delivery', icon: '🛵', desc: 'Approved delivery operations', hero: 'Deliver safely with a clear active route.' },
  service_provider: { label: 'Local Services', icon: '🛠️', desc: 'Skills, quotes and service jobs', hero: 'Turn your skills into trusted local work.' }
};
const ROLE_ORDER = ['merchant', 'customer', 'supplier', 'courier', 'service_provider'];
const ADMIN_RANK_LABELS = { super_admin:'Super Admin', country_admin:'Country Admin', territory_admin:'Territory Admin', specialist:'Specialist' };
const COUNTRY_META = { PH:{flag:'🇵🇭',label:'Philippines'}, RO:{flag:'🇷🇴',label:'Romania'} };
let snapshot = null;
let profileFetchedAt = 0;
let profileRefreshPromise = null;
let adminContext = null;
let adminContextFetchedAt = 0;
let adminContextRefreshPromise = null;
let activeRole = null;
let activeSurface = 'account';
let accountSettingsView = 'home';
let toastTimer;
const PROFILE_CACHE_MS = 30000;
const ADMIN_CONTEXT_CACHE_MS = 60000;

const token = () => localStorage.getItem('abl_token') || '';
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

async function profileApi(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const t = token();
  if (t) headers.Authorization = `Bearer ${t}`;
  const controller = options.signal ? null : new AbortController();
  const timeout = controller ? setTimeout(() => controller.abort(), 10000) : null;
  try {
    const response = await fetch(path, { ...options, headers, signal: options.signal || controller?.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('The app is taking too long to respond. Check your connection and try again.');
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function initials(name) {
  const bits = String(name || '').trim().split(/\s+/).filter(Boolean);
  return (bits[0]?.[0] || '').toUpperCase();
}
function avatarMarkup(account, extraClass = '') {
  const image = account?.avatar_data_url;
  if (image) return `<span class="accountAvatar ${extraClass}"><img src="${image}" alt="Account avatar"></span>`;
  const initial=initials(account?.display_name);
  if(!initial)return `<span class="accountAvatar accountAvatarLoading ${extraClass}" aria-hidden="true"></span>`;
  return `<span class="accountAvatar ${extraClass}" aria-hidden="true">${escapeHtml(initial)}</span>`;
}
function roleProfile(role) { return snapshot?.profiles?.find(p => p.role === role); }
function isEnabled(role) { const profile=roleProfile(role);return Boolean(profile?.enabled&&profile?.status==='active'); }
function isCompanyTestAccount(account=snapshot?.account){return Boolean(account?.is_test_account&&account?.account_mode==='company_test')}
function accountDetailsReady(account=snapshot?.account){return Boolean(String(account?.display_name||'').trim()&&String(account?.email||'').trim()&&(isCompanyTestAccount(account)||String(account?.address||'').trim()))}
function accountIdentityLabel(account=snapshot?.account){return isCompanyTestAccount(account)?'Test Account ID':'Personal ID'}
function testAccountRoleLabel(account=snapshot?.account){return account?.test_role_label||ROLE_META[account?.test_role]?.label||String(account?.test_role||'Test').replaceAll('_',' ')}
function adminRank(assignment){ return assignment?.effective_rank || assignment?.authority_rank || assignment?.admin_role || 'admin'; }
function highestAdminAssignment(){
  const levels={super_admin:100,country_admin:80,territory_admin:60,specialist:40};
  return [...(adminContext?.assignments||[])].sort((a,b)=>(levels[adminRank(b)]||0)-(levels[adminRank(a)]||0))[0]||null;
}
function isSuperAdminAccount(){
  return (adminContext?.assignments||[]).some(assignment=>adminRank(assignment)==='super_admin');
}
function countryMeta(code){return COUNTRY_META[code]||{flag:'🌐',label:code||'Country not set'}}
function identityLine(id,label='ID'){
  return `<span class="publicIdentity"><span>${escapeHtml(label)}</span><code>${escapeHtml(id||'Preparing ID…')}</code>${id?`<button type="button" data-copy-id="${escapeHtml(id)}" aria-label="Copy ${escapeHtml(label)}">Copy</button>`:''}</span>`;
}
function bindCopyIds(panel){panel.querySelectorAll('[data-copy-id]').forEach(button=>button.onclick=async()=>{try{await navigator.clipboard.writeText(button.dataset.copyId);showToast('ID copied.')}catch{showToast('Select and copy the ID manually.')}})}
function drawerHeader(account,back=false){const country=countryMeta(account.country_code),test=isCompanyTestAccount(account);return `<div class="drawerHandle"></div><div class="drawerHeader">${back?'<button id="drawerBack" class="drawerBack" type="button" aria-label="Back">‹</button>':avatarMarkup(account)}<div class="drawerIdentity"><h2>${escapeHtml(back?'Account Settings':account.display_name||'Business owner')}</h2><p>${test?'🧪 '+escapeHtml(testAccountRoleLabel(account))+' · managed by '+escapeHtml(account.managed_by||'Business & Life'):country.flag+' '+escapeHtml(country.label)+' · '+escapeHtml(account.country_code||'')}</p>${identityLine(account.personal_id,accountIdentityLabel(account))}</div><button id="drawerClose" class="drawerClose" type="button" aria-label="Close">×</button></div>`}
async function refreshAdminContext(force=false){
  if(!token()){adminContext=null;adminContextFetchedAt=0;return null}
  if(!force&&adminContextFetchedAt&&Date.now()-adminContextFetchedAt<ADMIN_CONTEXT_CACHE_MS)return adminContext;
  if(adminContextRefreshPromise)return adminContextRefreshPromise;
  adminContextRefreshPromise=(async()=>{
    try{
      const data=await profileApi('/api/admin/me');
      adminContext=data?.is_admin?data:null;
      adminContextFetchedAt=Date.now();
      return adminContext;
    }catch(_error){
      adminContext=null;
      return null;
    }
  })();
  try{return await adminContextRefreshPromise}
  finally{adminContextRefreshPromise=null}
}

function showToast(message) {
  const toast = document.getElementById('roleToast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function ensureShellChrome() {
  const shell = document.getElementById('shell');
  const topActions = document.querySelector('.topActions');
  if (!shell || !topActions) return false;
  if (!document.getElementById('accountAvatarButton')) {
    const controls = document.createElement('div');
    controls.className = 'shellProfileControls';
    controls.innerHTML = `<span id="activeRolePill" class="activeRolePill" aria-live="polite"></span><button id="accountAvatarButton" class="accountAvatarButton" type="button" aria-label="Open Account Home"><span class="accountAvatar accountAvatarLoading" aria-hidden="true"></span></button>`;
    topActions.appendChild(controls);
    controls.querySelector('#accountAvatarButton').addEventListener('click', openAccountHome);
  }
  if (!document.getElementById('roleHub')) {
    const hub = document.createElement('section');
    hub.id = 'roleHub';
    hub.className = 'roleHub hidden';
    const topbar = shell.querySelector('.topbar');
    topbar.insertAdjacentElement('afterend', hub);
  }
  if (!document.getElementById('accountSettingsWorkspace')) {
    const workspace = document.createElement('section');
    workspace.id = 'accountSettingsWorkspace';
    workspace.className = 'accountSettingsWorkspace hidden';
    shell.querySelector('.topbar')?.insertAdjacentElement('afterend', workspace);
  }
  if (!document.getElementById('profileDrawerBackdrop')) {
    const backdrop = document.createElement('div');
    backdrop.id = 'profileDrawerBackdrop';
    backdrop.className = 'profileDrawerBackdrop hidden';
    backdrop.innerHTML = `<aside id="profileDrawerPanel" class="profileDrawerPanel" role="dialog" aria-modal="true" aria-label="Account and profiles"></aside>`;
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) closeDrawer(); });
  }
  if (!document.getElementById('roleToast')) {
    const toast = document.createElement('div');
    toast.id = 'roleToast'; toast.className = 'roleToast'; toast.setAttribute('role', 'status');
    document.body.appendChild(toast);
  }
  return true;
}

function renderTopAccount() {
  if (!snapshot?.account) return;
  const button = document.getElementById('accountAvatarButton');
  const pill = document.getElementById('activeRolePill');
  if (button) button.innerHTML = avatarMarkup(snapshot.account);
  if (pill) pill.textContent = activeSurface === 'profile' ? (ROLE_META[activeRole]?.label || activeRole || 'Account') : activeSurface === 'admin' ? 'Admin' : 'Account';
}

function renderDrawer() {
  if (!snapshot?.account) return;
  const account = snapshot.account;
  const panel = document.getElementById('profileDrawerPanel');
  if (!panel) return;
  const profileRows = ROLE_ORDER.filter(isEnabled).map(role => {
    const meta = ROLE_META[role];
    const profile = roleProfile(role);
    const enabled = Boolean(profile?.enabled);
    const current = activeRole === role;
    const statusText = role === 'courier' && snapshot.courier ? ` • ${snapshot.courier.eligibility_status.replaceAll('_',' ')}` : '';
    return `<div class="profileRole ${current ? 'active' : ''}">
      <span class="roleIcon">${meta.icon}</span>
      <span class="roleCopy"><strong>${meta.label}</strong><small>${meta.desc}${statusText}</small><code>${escapeHtml(profile?.profile_id||'')}</code></span>
      <button class="roleAction ${current ? 'active' : ''}" type="button" data-role-action="${role}" ${current?'disabled':''}>${current ? 'Active' : 'Switch'}</button>
    </div>`;
  }).join('');
  panel.innerHTML = `
    ${drawerHeader(account)}
    <button id="accountHomeButton" class="accountSettingsEntry" type="button"><span>${isCompanyTestAccount(account)?'🧪':'👤'}</span><span><strong>Account Home</strong><small>${isCompanyTestAccount(account)?'Company test identity and assigned role':'Personal identity and profile selection'}</small></span><b>›</b></button>
    <section class="drawerSection"><h3>Active profiles</h3><div class="profileRoleList">${profileRows||'<p class="drawerEmpty">No active profiles yet.</p>'}</div></section>
    ${adminContext?.is_admin?'<button id="adminWorkspaceButton" class="accountSettingsEntry adminWorkspaceEntry" type="button"><span>🛡️</span><span><strong>Admin Workspace</strong><small>Delegated administrative access</small></span><b>›</b></button>':''}
    <button id="accountSettingsButton" class="accountSettingsEntry" type="button"><span>⚙️</span><span><strong>Account Settings</strong><small>${isCompanyTestAccount(account)?'Test identity, security and assigned role':'Personal details, security and profile management'}</small></span><b>›</b></button>
    <button id="drawerSignOutButton" class="accountSignOutEntry" type="button"><span>↪</span><span><strong>Sign out</strong><small>End this account session on this device</small></span></button>`;
  panel.querySelector('#drawerClose').onclick = closeDrawer;
  panel.querySelector('#accountHomeButton').onclick = () => { closeDrawer(); renderAccountHome(); };
  panel.querySelector('#accountSettingsButton').onclick = () => openAccountSettings();
  panel.querySelector('#drawerSignOutButton').onclick = event => signOutCurrentAccount(event.currentTarget);
  panel.querySelector('#adminWorkspaceButton')?.addEventListener('click',()=>{closeDrawer();window.location.assign('/admin')});
  panel.querySelectorAll('[data-role-action]').forEach(btn => btn.onclick = () => enableOrSwitch(btn.dataset.roleAction));
  bindCopyIds(panel);
  document.dispatchEvent(new CustomEvent('abl:drawer-rendered', { detail: { activeRole, accountId: Number(account.id) || null, view:'profiles' } }));
}

function profileManagementMarkup(){
  const account=snapshot.account;
  let emailReady=Boolean(account.email_verified_at);
  let detailsReady=accountDetailsReady(account);
  const superAdmin=isSuperAdminAccount();
  if(superAdmin){emailReady=true;detailsReady=true}
  const roles=isCompanyTestAccount(account)?ROLE_ORDER.filter(role=>role===account.test_role):ROLE_ORDER;
  if(!roles.length)return `<div class="companyTestRoleBoundary"><strong>${escapeHtml(testAccountRoleLabel(account))} test account</strong><p>This company-managed account is reserved for Admin testing and does not require a personal operational profile.</p></div>`;
  return roles.map(role=>{
    const meta=ROLE_META[role],profile=roleProfile(role),enabled=Boolean(profile?.enabled&&profile?.status==='active');
    const state=profile?.status||'not_started',reactivable=state==='disabled';
    const inProgress=['application_started','requirements_pending','submitted','under_review','rejected'].includes(state);
    let action,label;
    if(enabled){action=`data-profile-toggle="${role}" data-enabled="1"`;label='Disable'}
    else if(!emailReady){action=`data-verify-email="${role}"`;label='Verify email first'}
    else if(!detailsReady){action=`data-complete-personal="${role}"`;label='Complete details'}
    else if(reactivable){action=`data-profile-reactivate="${role}"`;label='Reactivate'}
    else{action=`data-role-action="${role}"`;label=superAdmin?'Activate':inProgress?'Continue onboarding':'Start onboarding'}
    const status=enabled?'Active profile':reactivable?'Disabled · ID and history preserved':superAdmin?'Ready for Super Admin testing':inProgress?state.replaceAll('_',' '):!emailReady?'Email verification required':!detailsReady?'Personal details required':'Not active';
    return `<div class="profileRole"><span class="roleIcon">${meta.icon}</span><span class="roleCopy"><strong>${meta.label}</strong><small>${escapeHtml(status)}</small><code>${escapeHtml(profile?.profile_id||`${account.personal_id}-${({merchant:'ME',customer:'CU',supplier:'SU',courier:'DE',service_provider:'LS'})[role]}`)}</code></span><button class="roleAction ${enabled?'active':'enable'}" type="button" ${action}>${label}</button></div>`
  }).join('');
}

function accountSettingsHeader(title,subtitle){return `<div class="accountSettingsHeader"><button id="accountSettingsBack" type="button" aria-label="Back">‹</button><div><span>ACCOUNT SETTINGS</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div></div>`}
function renderAccountSettings(view=accountSettingsView){
  if(!snapshot?.account)return;
  const account=snapshot.account,test=isCompanyTestAccount(account),workspace=document.getElementById('accountSettingsWorkspace');if(!workspace)return;
  workspace.classList.remove('hidden');
  accountSettingsView=view;
  if(view==='home'){
    workspace.innerHTML=accountSettingsHeader(test?'Company test account':'Your account',test?'A controlled test identity managed by Business & Life, separate from any real person.':'Settings shared by your personal account, separate from every work profile.')+`${test?`<section class="companyTestNotice"><span aria-hidden="true">🧪</span><div><strong>Company-managed ${escapeHtml(testAccountRoleLabel(account))} test account</strong><p>No personal phone or home address is required. Company contact details are used only when configured; otherwise a test scenario supplies the necessary operational address.</p></div></section>`:''}<div class="accountSettingsGrid">
      <button type="button" data-account-settings-view="personal"><span>${test?'🧪':'👤'}</span><strong>${test?'Test account details':'Personal details'}</strong><small>${test?'Photo, test name and protected company email alias':'Photo, name, email, phone and primary address'}</small><b>›</b></button>
      <button type="button" data-account-settings-view="security"><span>🔐</span><strong>Security & access</strong><small>Password, email verification and signed-in devices</small><b>›</b></button>
      <button type="button" data-account-settings-view="profiles"><span>🧩</span><strong>Manage profiles</strong><small>Start onboarding or deactivate profiles you own</small><b>›</b></button>
      <button type="button" id="accountMoneyBanking"><span>🏦</span><strong>Money & Banking</strong><small>Shared payment methods, payout destination and financial identity</small><b>›</b></button>
    </div><div class="accountSettingsBoundary"><strong>Profile settings stay inside each profile</strong><p>Open Customer, Merchant, Supplier, Delivery or Local Services and use its dedicated Profile Settings card.</p></div>`;
  }else if(view==='personal'){
    workspace.innerHTML=accountSettingsHeader(test?'Test account details':'Personal details',test?'Company-managed test identity. It must not contain invented personal contact data.':'Identity and contact information shared by your account.')+`${test?`<section class="companyTestNotice"><span aria-hidden="true">🧪</span><div><strong>Not a personal account</strong><p>Managed by ${escapeHtml(account.managed_by||'Business & Life')} for ${escapeHtml(testAccountRoleLabel(account))} testing. Personal phone and home address are not applicable. ${account.contact_requirements?.company_address_configured?'The configured company address is available to supported test flows.':'No company address is configured yet; flows that genuinely need a location must request one for that test scenario.'}</p></div></section>`:''}<section class="accountSettingsCard"><form id="accountIdentityForm" class="profileForm">
      <div class="avatarEdit"><input id="avatarFile" type="file" accept="image/png,image/jpeg,image/webp"><button id="removeAvatar" class="miniBtn" type="button">Remove photo</button></div>
      <div class="avatarHint">Photo is compressed on your phone before it is saved.</div>
      <label>${test?'Test account name':'Name'}<input id="shellDisplayName" value="${escapeHtml(account.display_name || '')}" required></label>
      <label>Email${test?' · protected company alias':''}<input id="shellEmail" type="email" value="${escapeHtml(account.email || '')}" ${test?'readonly aria-readonly="true"':''}></label>
      ${test?'<div class="companyContactPolicy"><div><span>Personal phone</span><strong>Not required</strong></div><div><span>Personal address</span><strong>Not required</strong></div><div><span>Contact source</span><strong>Company / test scenario</strong></div></div>':`<label>Phone<input id="shellPhone" inputmode="tel" value="${escapeHtml(account.phone || '')}"></label><label>Primary address<textarea id="shellAddress" rows="2">${escapeHtml(account.address || '')}</textarea></label>`}
      <div class="formActions"><button class="primary" type="submit">Save account</button></div>
    </form></section>`;
  }else if(view==='profiles'){
    const detailsReady=accountDetailsReady(account),superAdmin=isSuperAdminAccount();
    const activationGate=superAdmin?`<section class="profileActivationGate" role="status"><span aria-hidden="true">🛡️</span><div><strong>Super Admin direct profile access</strong><p>Email verification, invitation, onboarding and document checks are skipped only for this Super Admin account so you can test every profile. Newly activated profiles stay private until you intentionally configure live/public operation.</p></div></section>`:!account.email_verified_at?`<section class="profileActivationGate" role="status"><span aria-hidden="true">✉️</span><div><strong>Verify your email before activating a profile</strong><p>This protects your ${test?'Test Account ID':'Personal ID'}. After verification, you can start or continue the assigned profile onboarding here.</p></div><button id="verifyProfilesEmail" type="button">Open Security &amp; access</button></section>`:!detailsReady?`<section class="profileActivationGate" role="status"><span aria-hidden="true">👤</span><div><strong>Complete your personal details first</strong><p>Add your name, email and primary address before activating a profile.</p></div><button id="completeProfilesIdentity" type="button">Open Personal details</button></section>`:'';
    workspace.innerHTML=accountSettingsHeader(test?'Assigned test role':'Manage profiles',test?`This account is reserved for ${testAccountRoleLabel(account)} testing and does not require personal contact details.`:'Profiles derive from your Personal ID and keep their IDs after deactivation.')+activationGate+`<section class="accountSettingsCard"><div class="profileRoleList">${profileManagementMarkup()}</div></section>`;
  }else{
    workspace.innerHTML=accountSettingsHeader('Security & access','Protect the personal account used by all your profiles.')+'<div id="accountSecurityMount"></div>';
  }
  workspace.querySelector('#accountSettingsBack').onclick=()=>view==='home'?closeAccountSettings():renderAccountSettings('home');
  workspace.querySelectorAll('[data-account-settings-view]').forEach(button=>button.onclick=()=>button.dataset.accountSettingsView==='profiles'?openAccountSettings('profiles'):renderAccountSettings(button.dataset.accountSettingsView));
  workspace.querySelector('#accountMoneyBanking')?.addEventListener('click',()=>window.BusinessLifeProfileSettings?.openAccountMoney?.());
  workspace.querySelector('#accountIdentityForm')?.addEventListener('submit',saveIdentity);
  workspace.querySelector('#avatarFile')?.addEventListener('change',uploadAvatar);
  workspace.querySelector('#removeAvatar')?.addEventListener('click',removeAvatar);
  workspace.querySelectorAll('[data-profile-toggle]').forEach(btn=>btn.onclick=()=>toggleProfile(btn.dataset.profileToggle,btn.dataset.enabled!=='1'));
  workspace.querySelectorAll('[data-profile-reactivate]').forEach(btn=>btn.onclick=()=>reactivateProfile(btn.dataset.profileReactivate));
  workspace.querySelectorAll('[data-role-action]').forEach(btn=>btn.onclick=()=>toggleProfile(btn.dataset.roleAction,true));
  workspace.querySelectorAll('[data-verify-email]').forEach(btn=>btn.onclick=()=>openAccountSettings('security'));
  workspace.querySelectorAll('[data-complete-personal]').forEach(btn=>btn.onclick=()=>openAccountSettings('personal'));
  workspace.querySelector('#verifyProfilesEmail')?.addEventListener('click',()=>openAccountSettings('security'));
  workspace.querySelector('#completeProfilesIdentity')?.addEventListener('click',()=>openAccountSettings('personal'));
  bindCopyIds(workspace);
  document.dispatchEvent(new CustomEvent('abl:account-settings-rendered',{detail:{view,activeRole,accountId:Number(account.id)||null}}));
}

async function openAccountSettings(view='home'){
  closeDrawer();
  activeSurface='account';
  hideMerchantWorkspace();
  hideFeatureWorkspaces();
  document.getElementById('roleHub')?.classList.add('hidden');
  document.getElementById('profileSettingsWorkspace')?.classList.add('hidden');
  const workspace=document.getElementById('accountSettingsWorkspace');
  workspace?.classList.remove('hidden');
  if(view==='profiles'&&(!adminContextFetchedAt||Date.now()-adminContextFetchedAt>=ADMIN_CONTEXT_CACHE_MS)){
    await refreshAdminContext(true).catch(()=>null);
  }
  renderAccountSettings(view);
  renderTopAccount();
  publishProfileState();
  window.scrollTo({top:0,behavior:'auto'});
}

function closeAccountSettings(){
  document.getElementById('accountSettingsWorkspace')?.classList.add('hidden');
  renderAccountHome();
  publishProfileState();
  window.scrollTo({top:0,behavior:'auto'});
}

function openAccountHome(){
  closeDrawer();
  renderAccountHome();
  publishProfileState();
  window.scrollTo({top:0,behavior:'auto'});
  if(!profileFetchedAt||Date.now()-profileFetchedAt>=PROFILE_CACHE_MS)refreshProfile().catch(error=>console.warn('Account refresh:',error.message));
}

async function reactivateProfile(role){try{
  if(isSuperAdminAccount())snapshot=await profileApi(`/api/governance/super-admin/self-test/profiles/${role}/activate`,{method:'POST',body:'{}'});
  else if(role==='customer')snapshot=await profileApi('/api/profiles/customer/activate',{method:'POST',body:'{}'});
  else snapshot=await profileApi(`/api/profiles/${role}`,{method:'PUT',body:JSON.stringify({enabled:true,visibility:'private'})});
  snapshot=await profileApi('/api/me/active-role',{method:'PATCH',body:JSON.stringify({role})});
  activeRole=role;profileFetchedAt=Date.now();activeSurface='profile';applyActiveRole();publishProfileState();showToast('Profile reactivated.');
}catch(err){showToast(err.message)}}

async function toggleProfile(role,enabled){try{
  if(enabled&&isSuperAdminAccount())snapshot=await profileApi(`/api/governance/super-admin/self-test/profiles/${role}/activate`,{method:'POST',body:'{}'});
  else if(enabled&&role==='customer')snapshot=await profileApi('/api/profiles/customer/activate',{method:'POST',body:'{}'});
  else if(enabled){document.dispatchEvent(new CustomEvent('abl:start-profile-onboarding',{detail:{role}}));return}
  else snapshot=await profileApi(`/api/profiles/${role}`,{method:'PUT',body:JSON.stringify({enabled:false,visibility:'private'})});
  if(enabled){snapshot=await profileApi('/api/me/active-role',{method:'PATCH',body:JSON.stringify({role})});activeRole=role}
  else activeRole=snapshot.account.active_role||null;
  profileFetchedAt=Date.now();if(enabled){activeSurface='profile';applyActiveRole()}else renderAccountHome();publishProfileState();renderAccountSettings();showToast(enabled?'Profile activated.':'Profile disabled.');
}catch(err){showToast(err.message)}}

async function openDrawer() {
  if (!token()) return showToast('Sign in first to open your account.');
  const profileStale=!snapshot?.account||!profileFetchedAt||Date.now()-profileFetchedAt>=PROFILE_CACHE_MS;
  const adminStale=!adminContextFetchedAt||Date.now()-adminContextFetchedAt>=ADMIN_CONTEXT_CACHE_MS;
  const panel=document.getElementById('profileDrawerPanel');
  const hasCompleteSnapshot=Boolean(snapshot?.account&&adminContextFetchedAt);
  if(hasCompleteSnapshot)renderDrawer();
  else if(panel)panel.innerHTML='<div class="drawerHandle"></div><div class="drawerContextLoading" role="status"><span class="accountAvatar accountAvatarLoading" aria-hidden="true"></span><strong>Loading account and Admin access…</strong><small>Preparing the complete profile list.</small></div>';
  document.getElementById('profileDrawerBackdrop')?.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  try {
    const tasks=[];
    if(profileStale)tasks.push(refreshProfile());
    if(adminStale)tasks.push(refreshAdminContext());
    if(tasks.length)await Promise.all(tasks);
    renderDrawer();
  } catch (error) {
    showToast(error.message);
  }
}
function closeDrawer() {
  document.getElementById('profileDrawerBackdrop')?.classList.add('hidden');
  document.body.style.overflow = '';
}

async function saveIdentity(event) {
  event.preventDefault();
  try {
    snapshot = await profileApi('/api/me', { method: 'PATCH', body: JSON.stringify({
      display_name: document.getElementById('shellDisplayName').value,
      email: document.getElementById('shellEmail').value,
      phone: document.getElementById('shellPhone')?.value || '',
      address: document.getElementById('shellAddress')?.value || ''
    }) });
    profileFetchedAt=Date.now(); renderTopAccount(); renderAccountSettings(); showToast('Account saved.');
  } catch (err) { showToast(err.message); }
}

function imageToAvatarDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file || !['image/png','image/jpeg','image/webp'].includes(file.type)) return reject(new Error('Choose a PNG, JPEG or WebP image.'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read image.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not load image.'));
      img.onload = () => {
        const size = 256; const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(canvas.toDataURL('image/webp', .82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
async function uploadAvatar(event) {
  try {
    const avatar_data_url = await imageToAvatarDataUrl(event.target.files?.[0]);
    snapshot = await profileApi('/api/me', { method: 'PATCH', body: JSON.stringify({
      display_name: snapshot.account.display_name || 'Business owner', phone: snapshot.account.phone || '', email: snapshot.account.email || '', address: snapshot.account.address || '', avatar_data_url
    }) });
    profileFetchedAt=Date.now(); renderTopAccount(); renderAccountSettings(); showToast('Profile photo updated.');
  } catch (err) { showToast(err.message); }
}
async function removeAvatar() {
  try {
    snapshot = await profileApi('/api/me', { method: 'PATCH', body: JSON.stringify({
      display_name: snapshot.account.display_name || 'Business owner', phone: snapshot.account.phone || '', email: snapshot.account.email || '', address: snapshot.account.address || '', avatar_data_url: ''
    }) });
    profileFetchedAt=Date.now(); renderTopAccount(); renderAccountSettings(); showToast('Profile photo removed.');
  } catch (err) { showToast(err.message); }
}

async function enableOrSwitch(role) {
  try {
    if (!isEnabled(role)) snapshot = await profileApi(`/api/profiles/${role}`, { method: 'PUT', body: JSON.stringify({ enabled: true, visibility: role === 'merchant' ? 'public' : 'private' }) });
    snapshot = await profileApi('/api/me/active-role', { method: 'PATCH', body: JSON.stringify({ role }) });
    activeRole = snapshot.account.active_role || role;
    activeSurface = 'profile';
    profileFetchedAt=Date.now();
    applyActiveRole();
    publishProfileState();
    renderDrawer();
    closeDrawer();
  } catch (err) { showToast(err.message); }
}

function hideMerchantWorkspace() {
  document.querySelectorAll('#shell > .view').forEach(v => v.classList.add('hidden'));
  document.querySelector('.bottomNav')?.classList.add('hidden');
}
function showMerchantWorkspace() {
  if(activeRole!=='merchant')return hideMerchantWorkspace();
  document.getElementById('roleHub')?.classList.add('hidden');
  document.querySelector('.bottomNav')?.classList.remove('hidden');
  const dashboard = document.querySelector('.bottomNav [data-view="Dashboard"]');
  if (dashboard) dashboard.click();
  else document.getElementById('viewDashboard')?.classList.remove('hidden');
}

function hideFeatureWorkspaces() {
  for (const id of ['ordersWorkspace','marketWorkspace','servicesWorkspace','supWorkspace','deliveryWorkspace']) {
    document.getElementById(id)?.classList.add('hidden');
  }
  for (const id of ['basketBar','orderModalBackdrop','checkoutBackdrop','serviceModalBackdrop','supModalBg','deliveryModalBg']) {
    document.getElementById(id)?.classList.add('hidden');
  }
  document.body.classList.remove('supplierAccountingMode');
  document.getElementById('supplierAccountingBack')?.remove();
  document.body.style.overflow='';
}
function showActiveWorkspace() {
  hideFeatureWorkspaces();
  closeDrawer();
  activeSurface = 'profile';
  applyActiveRole();
  publishProfileState();
  window.scrollTo({top:0,behavior:'auto'});
}
window.BusinessLifeShell=Object.freeze({
  showActiveWorkspace,
  openAccountHome,
  openAccountSettings,
  signOutCurrentAccount,
  refreshProfile,
  getProfileState:()=>window.BusinessLifeProfileState||null
});

const HUBS = {
  supplier: [
    ['☀️','Today','What needs your attention now','Today'],
    ['📦','Catalog','Products, pricing and availability','Catalog'],
    ['📥','Orders','New, preparing and fulfilment orders','Orders'],
    ['💰','Money','Receivables and recorded payments','Money']
  ]
};


const CUSTOMER_HOME_CACHE_MS=30000;
let customerHomeCache={accountId:null,data:null,loadedAt:0,promise:null};

function customerNice(value){return String(value||'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase())}
function customerMoney(value){return new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(value)||0)}
function customerDate(value){if(!value)return'';try{return new Date(value).toLocaleDateString('en-PH')}catch{return''}}
function invalidateCustomerHome(){customerHomeCache={accountId:null,data:null,loadedAt:0,promise:null}}
async function loadCustomerHomeData(force=false){
  const accountId=Number(snapshot?.account?.id)||null;
  if(!accountId)throw new Error('Customer account is not ready yet.');
  if(customerHomeCache.accountId!==accountId)invalidateCustomerHome();
  if(!force&&customerHomeCache.data&&Date.now()-customerHomeCache.loadedAt<CUSTOMER_HOME_CACHE_MS)return customerHomeCache.data;
  if(customerHomeCache.promise)return customerHomeCache.promise;
  customerHomeCache.promise=(async()=>{
    const [ordersResult,deliveryResult,servicesResult,moneyResult]=await Promise.allSettled([
      profileApi('/api/orders/mine'),
      profileApi('/api/delivery/mine'),
      profileApi('/api/services/jobs/mine'),
      profileApi('/api/profile-money/customer')
    ]);
    const failures=[];
    const value=(result,label,fallback)=>{
      if(result.status==='fulfilled')return result.value;
      failures.push(label);
      return fallback;
    };
    const allServices=value(servicesResult,'Local Services',null);
    const services=Array.isArray(allServices)
      ?allServices.filter(job=>Number(job.customer_account_id)===accountId)
      :allServices;
    const data={
      orders:value(ordersResult,'Orders',null),
      deliveries:value(deliveryResult,'Delivery',null),
      services,
      money:value(moneyResult,'Money',null),
      failures
    };
    if(failures.length===4)throw new Error('Customer Home could not be loaded. Check your connection and try again.');
    customerHomeCache={accountId,data,loadedAt:Date.now(),promise:null};
    return data;
  })();
  try{return await customerHomeCache.promise}
  finally{if(customerHomeCache.promise)customerHomeCache.promise=null}
}
function customerHomeActivities(data){
  const active=[];
  for(const order of Array.isArray(data.orders)?data.orders:[]){
    if(['completed','cancelled'].includes(order.order_status))continue;
    active.push({
      type:'orders',
      icon:'🧾',
      title:(order.business_name||'Merchant')+' · '+(order.order_number||'Order'),
      status:customerNice(order.order_status),
      detail:Number(order.outstanding_amount||0)>0
        ?customerMoney(order.outstanding_amount)+' still due'
        :customerNice(order.fulfilment_method||'order'),
      at:order.updated_at||order.created_at
    });
  }
  for(const delivery of Array.isArray(data.deliveries)?data.deliveries:[]){
    if(['delivered','failed','cancelled'].includes(delivery.status))continue;
    active.push({
      type:'delivery',
      icon:'📍',
      title:delivery.business_name||delivery.order_number||'Delivery',
      status:customerNice(delivery.status),
      detail:delivery.eta_minutes!=null?'ETA ~'+Number(delivery.eta_minutes)+' min':'Live Delivery status',
      at:delivery.updated_at||delivery.created_at
    });
  }
  for(const job of Array.isArray(data.services)?data.services:[]){
    if(job.status==='cancelled'||(job.status==='completed'&&job.customer_confirmed_at))continue;
    active.push({
      type:'services',
      icon:'🛠️',
      title:job.service_label||job.category||'Local Service',
      status:customerNice(job.status),
      detail:job.provider_name?'With '+job.provider_name:'Service request',
      at:job.updated_at||job.created_at
    });
  }
  return active.sort((a,b)=>new Date(b.at||0)-new Date(a.at||0)).slice(0,6);
}
function customerRecentActivities(data){
  const recent=[];
  for(const order of Array.isArray(data.orders)?data.orders:[]){
    if(order.order_status!=='completed')continue;
    recent.push({
      type:'orders',icon:'✓',title:order.business_name||order.order_number||'Completed order',
      detail:(order.order_number||'Order')+' · '+customerMoney(order.total),
      at:order.completed_at||order.updated_at||order.created_at
    });
  }
  for(const job of Array.isArray(data.services)?data.services:[]){
    if(job.status!=='completed'||!job.customer_confirmed_at)continue;
    recent.push({
      type:'services',icon:'✓',title:job.service_label||job.category||'Completed service',
      detail:job.provider_name||'Local Services',
      at:job.customer_confirmed_at||job.completed_at||job.updated_at||job.created_at
    });
  }
  return recent.sort((a,b)=>new Date(b.at||0)-new Date(a.at||0)).slice(0,3);
}
function customerActivityCard(item){
  return '<button class="customerContinueCard" type="button" data-customer-home-open="'+escapeHtml(item.type)+'">'+
    '<span class="customerContinueIcon">'+escapeHtml(item.icon)+'</span>'+
    '<span class="customerContinueCopy"><strong>'+escapeHtml(item.title)+'</strong><small>'+escapeHtml(item.status||'')+(item.detail?' · '+escapeHtml(item.detail):'')+'</small></span>'+
    '<b>›</b></button>';
}
function openCustomerHomeDestination(kind,hub){
  if(kind==='orders'){
    if(window.BusinessLifeOrders?.openCustomerOrders)return window.BusinessLifeOrders.openCustomerOrders();
    return openCustomerHubFeature(hub,'Orders');
  }
  if(kind==='delivery'){
    if(window.BusinessLifeDelivery?.openCustomerDelivery)return window.BusinessLifeDelivery.openCustomerDelivery();
    return openCustomerHubFeature(hub,'Delivery');
  }
  if(kind==='services'){
    if(window.BusinessLifeServices?.openCustomerJobs)return window.BusinessLifeServices.openCustomerJobs();
    return showToast('Local Services is still loading. Try again in a moment.');
  }
  if(kind==='money'){
    if(window.BusinessLifeProfileMoney?.openCustomerMoney)return window.BusinessLifeProfileMoney.openCustomerMoney();
    return openCustomerHubFeature(hub,'Money');
  }
}
function renderCustomerHomeData(hub,data){
  const loading=hub.querySelector('#customerHomeLoading');
  const error=hub.querySelector('#customerHomeError');
  const dynamic=hub.querySelector('#customerHomeDynamic');
  loading?.classList.add('hidden');
  error?.classList.add('hidden');
  dynamic?.classList.remove('hidden');

  const active=customerHomeActivities(data);
  const continueList=hub.querySelector('#customerContinueList');
  const continueMeta=hub.querySelector('#customerContinueMeta');
  if(continueMeta)continueMeta.textContent=active.length?active.length+' active':'Nothing waiting';
  if(continueList)continueList.innerHTML=active.length
    ?active.map(customerActivityCard).join('')
    :'<div class="customerHomeEmpty"><strong>You’re all caught up.</strong><span>Shop local or request a service whenever you need something.</span></div>';

  const money=hub.querySelector('#customerMoneySnapshot');
  if(money){
    const summary=data.money?.summary;
    const evidence=value=>value==null||!Number.isFinite(Number(value))?'Unavailable':customerMoney(value);
    money.innerHTML=summary
      ?'<div><span>Paid</span><strong>'+evidence(summary.confirmed_payments)+'</strong><small>Confirmed payments</small></div>'+
       '<div><span>Still due</span><strong>'+evidence(summary.outstanding_purchases)+'</strong><small>Outstanding purchases</small></div>'+
       '<div><span>Refunded</span><strong>'+evidence(summary.refunded)+'</strong><small>Completed refunds</small></div>'
      :'<div class="customerMoneyUnavailable"><strong>Money summary unavailable</strong><small>Open My Money to try again. No balance has been assumed.</small></div>';
  }

  const recent=customerRecentActivities(data);
  const recentSection=hub.querySelector('#customerRecentSection');
  const recentList=hub.querySelector('#customerRecentList');
  if(recentSection)recentSection.classList.toggle('hidden',!recent.length);
  if(recentList)recentList.innerHTML=recent.map(item=>
    '<button class="customerRecentRow" type="button" data-customer-home-open="'+escapeHtml(item.type)+'">'+
      '<span>'+escapeHtml(item.icon)+'</span><span><strong>'+escapeHtml(item.title)+'</strong><small>'+escapeHtml(item.detail)+(item.at?' · '+escapeHtml(customerDate(item.at)):'')+'</small></span><b>›</b></button>'
  ).join('');

  const partial=hub.querySelector('#customerHomePartial');
  if(partial){
    partial.classList.toggle('hidden',!data.failures.length);
    partial.innerHTML=data.failures.length
      ?'<span>Some Home information is unavailable: '+escapeHtml(data.failures.join(', '))+'.</span><button type="button" data-customer-home-retry>Retry</button>'
      :'';
  }
  hub.querySelectorAll('[data-customer-home-open]').forEach(button=>button.onclick=()=>openCustomerHomeDestination(button.dataset.customerHomeOpen,hub));
  hub.querySelectorAll('[data-customer-home-retry]').forEach(button=>button.onclick=()=>loadCustomerHome(hub,{force:true}));
}
async function loadCustomerHome(hub,{force=false}={}){
  const loading=hub.querySelector('#customerHomeLoading');
  const error=hub.querySelector('#customerHomeError');
  if(force){
    loading?.classList.remove('hidden');
    error?.classList.add('hidden');
  }
  try{
    const data=await loadCustomerHomeData(force);
    if(!hub.isConnected||activeRole!=='customer')return;
    renderCustomerHomeData(hub,data);
  }catch(err){
    loading?.classList.add('hidden');
    const message=hub.querySelector('#customerHomeErrorMessage');
    if(message)message.textContent=err.message||'Customer Home could not be loaded.';
    error?.classList.remove('hidden');
  }
}
function setCustomerHubPanel(hub,panel){
  const target=panel==='shop'?'shop':'home';
  hub.querySelectorAll('[data-customer-panel]').forEach(node=>node.classList.toggle('hidden',node.dataset.customerPanel!==target));
  hub.querySelectorAll('[data-customer-nav]').forEach(button=>button.classList.toggle('active',button.dataset.customerNav===target));
  window.scrollTo({top:0,behavior:'smooth'});
}
function openCustomerHubFeature(hub,feature){
  const target=hub.querySelector('[data-hub-feature="'+feature+'"]');
  if(!target)return showToast(feature+' is still loading. Try again in a moment.');
  target.click();
}
function renderCustomerHub(){
  const hub=document.getElementById('roleHub');
  if(!hub)return;
  document.getElementById('accountSettingsWorkspace')?.classList.add('hidden');
  hub.innerHTML=
    '<div class="hubHero customerHomeHero"><div class="hubEyebrow">Customer profile</div><h1>What would you like to do?</h1><p>Shop local, book trusted help, or continue something already in progress.</p><span class="hubStatus">Philippines Edition</span></div>'+
    '<section class="customerHomePanel" data-customer-panel="home">'+
      '<div class="customerHomeToolbar"><div><strong>Home</strong><small>Your current activity and personal purchase snapshot</small></div><button id="customerHomeRefresh" type="button">Refresh</button></div>'+
      '<div id="customerHomeLoading" class="customerHomeState"><strong>Checking your activity…</strong><span>Orders, Delivery, Local Services and confirmed personal money.</span></div>'+
      '<div id="customerHomeError" class="customerHomeState customerHomeError hidden" role="alert"><strong>Home could not be loaded.</strong><span id="customerHomeErrorMessage">Check your connection and try again.</span><button type="button" data-customer-home-retry>Try again</button></div>'+
      '<div id="customerHomePartial" class="customerHomePartial hidden"></div>'+
      '<div id="customerHomeDynamic" class="customerHomeDynamic hidden">'+
        '<section class="customerHomeSection"><div class="hubSectionTitle"><h2>Continue</h2><span id="customerContinueMeta">Checking…</span></div><div id="customerContinueList" class="customerContinueList"></div></section>'+
        '<section class="customerHomeSection customerMoneyHome"><div class="hubSectionTitle"><h2>My money</h2><button type="button" data-customer-home-open="money">Open Money</button></div><div id="customerMoneySnapshot" class="customerMoneySnapshot"></div></section>'+
        '<section id="customerRecentSection" class="customerHomeSection hidden"><div class="hubSectionTitle"><h2>Recent</h2><span>Completed activity</span></div><div id="customerRecentList" class="customerRecentList"></div></section>'+
      '</div>'+
      '<div class="hubSectionTitle customerDiscoverTitle"><h2>Discover</h2><span>Start something new</span></div>'+
      '<div class="customerStartGrid">'+
        '<button class="customerActionCard primaryCustomerAction" type="button" data-customer-nav-target="shop"><span>🛍️</span><strong>Shop local</strong><small>Food, everyday goods and the separate Platform Store</small></button>'+
        '<button class="customerActionCard" type="button" data-hub-feature="Local Services"><span>🛠️</span><strong>Find a local service</strong><small>Request quotes and manage service jobs</small></button>'+
        '<button class="customerActionCard" type="button" data-hub-feature="Orders"><span>🧾</span><strong>My orders</strong><small>Payment, preparation, pickup and delivery context</small></button>'+
        '<button class="customerActionCard" type="button" data-hub-feature="Money"><span>💳</span><strong>My money</strong><small>Confirmed payments, refunds and personal purchase history</small></button>'+
      '</div>'+
      '<button class="customerFeatureProxy hidden" type="button" data-hub-feature="Delivery" tabindex="-1" aria-hidden="true">Deliveries</button>'+
      '<button class="customerSettingsLink" type="button" data-hub-feature="Profile Settings"><span>⚙️</span><span><strong>Customer settings</strong><small>Shopping, delivery, privacy and payment preferences</small></span><b>›</b></button>'+
    '</section>'+
    '<section class="customerHomePanel hidden" data-customer-panel="shop">'+
      '<div class="hubSectionTitle"><h2>Shop</h2><span>Choose what you need</span></div>'+
      '<div class="customerShopGrid">'+
        '<button class="customerShopCard" type="button" data-hub-feature="Marketplace"><span>🍲</span><strong>Food</strong><small>Local food merchants, menus and ordering</small></button>'+
        '<button class="customerShopCard" type="button" data-hub-feature="Marketplace"><span>🧺</span><strong>Non-food</strong><small>Everyday goods from nearby merchants</small></button>'+
        '<button class="customerShopCard platform" type="button" data-hub-feature="Platform Store"><span>🛒</span><strong>Platform Store</strong><small>Separate Philippines platform store</small></button>'+
      '</div>'+
      '<p class="customerShopBoundary">Merchant Marketplace and Platform Store stay separate. Products, pricing and baskets are never mixed automatically.</p>'+
    '</section>'+
    '<nav class="customerPrimaryNav" aria-label="Customer navigation">'+
      '<button type="button" class="active" data-customer-nav="home"><span>⌂</span><strong>Home</strong></button>'+
      '<button type="button" data-customer-nav="shop"><span>🛍️</span><strong>Shop</strong></button>'+
      '<button type="button" data-customer-nav="services"><span>🛠️</span><strong>Services</strong></button>'+
      '<button type="button" data-customer-nav="orders"><span>🧾</span><strong>Orders</strong></button>'+
      '<button type="button" data-customer-nav="money"><span>💳</span><strong>Money</strong></button>'+
    '</nav>';
  hub.querySelectorAll('[data-hub-feature]').forEach(button=>{
    button.onclick=()=>button.dataset.hubFeature==='Profile Settings'
      ?window.BusinessLifeProfileSettings?.open?.('customer')
      :showToast(button.dataset.hubFeature+' is still loading. Try again in a moment.');
  });
  hub.querySelectorAll('[data-customer-nav-target]').forEach(button=>button.onclick=()=>setCustomerHubPanel(hub,button.dataset.customerNavTarget));
  hub.querySelectorAll('[data-customer-nav]').forEach(button=>button.onclick=()=>{
    const destination=button.dataset.customerNav;
    if(destination==='home'||destination==='shop')return setCustomerHubPanel(hub,destination);
    const feature=destination==='services'?'Local Services':destination==='orders'?'Orders':'Money';
    openCustomerHubFeature(hub,feature);
  });
  hub.querySelector('#customerHomeRefresh')?.addEventListener('click',()=>loadCustomerHome(hub,{force:true}));
  hub.querySelectorAll('[data-customer-home-retry]').forEach(button=>button.onclick=()=>loadCustomerHome(hub,{force:true}));
  hub.classList.remove('hidden');
  loadCustomerHome(hub).catch(()=>{});
}


const COURIER_HOME_CACHE_MS=20000;
const COURIER_HOME_ROUTE_STATES=new Set(['courier_en_route_to_merchant','courier_arrived_at_merchant','picked_up','in_transit','courier_arrived_at_customer']);
const COURIER_HOME_TERMINAL_STATES=new Set(['delivered','failed','cancelled','quoted']);
let courierHomeCache={accountId:null,data:null,loadedAt:0,promise:null};

function invalidateCourierHome(){courierHomeCache={accountId:null,data:null,loadedAt:0,promise:null}}
function courierHomeApproved(profile){
  if(!profile||profile.eligibility_status!=='approved')return false;
  if(!profile.eligibility_expires_at)return true;
  const expiry=new Date(profile.eligibility_expires_at).getTime();
  return Number.isFinite(expiry)&&expiry>Date.now();
}
function courierHomeCurrentWork(delivery){
  const list=Array.isArray(delivery?.deliveries)?delivery.deliveries:[];
  const route=list.find(item=>COURIER_HOME_ROUTE_STATES.has(item.status));
  if(route)return{item:route,destination:'Tracking',label:'Open route'};
  const assigned=list.find(item=>!COURIER_HOME_TERMINAL_STATES.has(item.status));
  if(assigned)return{item:assigned,destination:'Deliveries',label:'Open delivery'};
  return null;
}
function courierHomeSettlementPending(earnings){
  return ['pending','eligible','held','processing'].reduce((sum,key)=>sum+Number(earnings?.[key]||0),0);
}
async function loadCourierHomeData(force=false){
  const accountId=Number(snapshot?.account?.id)||null;
  if(!accountId)throw new Error('Courier account is not ready yet.');
  if(courierHomeCache.accountId!==accountId)invalidateCourierHome();
  if(!force&&courierHomeCache.data&&Date.now()-courierHomeCache.loadedAt<COURIER_HOME_CACHE_MS)return courierHomeCache.data;
  if(courierHomeCache.promise)return courierHomeCache.promise;
  courierHomeCache.promise=(async()=>{
    const [deliveryResult,moneyResult]=await Promise.allSettled([
      profileApi('/api/courier/delivery-profile'),
      profileApi('/api/profile-money/courier')
    ]);
    const failures=[];
    const value=(result,label)=>{
      if(result.status==='fulfilled')return result.value;
      failures.push(label);
      return null;
    };
    const data={
      delivery:value(deliveryResult,'Delivery'),
      money:value(moneyResult,'Money'),
      failures
    };
    if(failures.length===2)throw new Error('Courier Home could not be loaded. Check your connection and try again.');
    courierHomeCache={accountId,data,loadedAt:Date.now(),promise:null};
    return data;
  })();
  try{return await courierHomeCache.promise}
  finally{if(courierHomeCache.promise)courierHomeCache.promise=null}
}
function openCourierHubFeature(hub,feature){
  if(feature==='Money'&&window.BusinessLifeProfileMoney?.openProfileMoney){
    return window.BusinessLifeProfileMoney.openProfileMoney('courier');
  }
  if(['Eligibility','Availability','Deliveries','Tracking'].includes(feature)&&window.BusinessLifeDelivery?.openCourierWorkspace){
    return window.BusinessLifeDelivery.openCourierWorkspace(feature);
  }
  showToast(feature+' is still loading. Try again in a moment.');
}
function bindCourierHomeDynamic(hub){
  hub.querySelectorAll('[data-courier-home-open]').forEach(button=>button.onclick=()=>openCourierHubFeature(hub,button.dataset.courierHomeOpen));
  const availability=hub.querySelector('#courierHomeAvailabilityAction');
  if(availability)availability.onclick=async()=>{
    const desired=availability.dataset.nextAvailable==='true';
    const previous=availability.textContent;
    availability.disabled=true;
    availability.textContent='Saving…';
    try{
      const result=await profileApi('/api/courier/availability',{method:'PUT',body:JSON.stringify({available:desired})});
      if(Boolean(result?.available)!==desired)throw new Error('Availability was not confirmed by the server.');
      invalidateCourierHome();
      showToast(desired?'You are available for assignments.':'Availability paused.');
      await loadCourierHome(hub,{force:true});
    }catch(err){
      availability.disabled=false;
      availability.textContent=previous;
      showToast(err.message||'Availability could not be changed.');
    }
  };
}
function renderCourierHomeData(hub,data){
  hub.querySelector('#courierHomeLoading')?.classList.add('hidden');
  hub.querySelector('#courierHomeError')?.classList.add('hidden');
  hub.querySelector('#courierHomeDynamic')?.classList.remove('hidden');

  const profile=data.delivery?.profile||null;
  const approved=courierHomeApproved(profile);
  const expired=profile?.eligibility_status==='approved'&&!approved;
  const statusLabel=!profile?'Status unavailable':expired?'Approval expired':customerNice(profile.eligibility_status||'not requested');
  const vehicle=profile?.approved_vehicle_class||profile?.vehicle_type||'No approved vehicle';
  const status=hub.querySelector('#courierHomeStatus');
  if(status){
    status.innerHTML=
      '<div class="courierStatusMain"><div><span class="courierStatusEyebrow">Eligibility</span><strong>'+escapeHtml(statusLabel)+'</strong><small>'+escapeHtml(vehicle)+'</small></div>'+
      '<button type="button" data-courier-home-open="Eligibility">'+(approved?'Review':'Fix eligibility')+'</button></div>'+
      '<div class="courierAvailabilityRow"><div><strong>'+(profile?.available&&approved?'Available':'Not available')+'</strong><small>'+(approved?'You decide when you are open for new assignments.':'Admin approval is required before availability can be enabled.')+'</small></div>'+
      '<button id="courierHomeAvailabilityAction" type="button" data-next-available="'+String(!(profile?.available&&approved))+'" '+(!approved?'disabled':'')+'>'+(profile?.available&&approved?'Pause availability':'Go available')+'</button></div>';
  }

  const work=courierHomeCurrentWork(data.delivery);
  const workBox=hub.querySelector('#courierHomeWork');
  if(workBox){
    workBox.innerHTML=work
      ?'<article class="courierCurrentWork"><div><span>'+escapeHtml(customerNice(work.item.status||'assigned'))+'</span><strong>'+escapeHtml(work.item.business_name||work.item.order_number||'Assigned delivery')+'</strong><small>'+escapeHtml(work.item.order_number||'Delivery')+'</small></div><button type="button" data-courier-home-open="'+escapeHtml(work.destination)+'">'+escapeHtml(work.label)+'</button></article>'
      :'<div class="courierHomeEmpty"><strong>No assigned delivery right now.</strong><span>Stay available if you want to receive eligible assignments.</span><button type="button" data-courier-home-open="Deliveries">Open deliveries</button></div>';
  }

  const moneyBox=hub.querySelector('#courierHomeMoney');
  if(moneyBox){
    const summary=data.money?.summary||null;
    const earnings=summary?.earnings||null;
    if(!summary){
      moneyBox.innerHTML='<div class="courierMoneyHold"><strong>Money summary unavailable</strong><span>Open Money to retry. No earnings amount has been assumed.</span></div>';
    }else if(earnings?.tracked){
      moneyBox.innerHTML=
        '<div><span>Active</span><strong>'+escapeHtml(String(Number(summary.active_count||0)))+'</strong><small>Deliveries</small></div>'+
        '<div><span>Paid earnings</span><strong>'+escapeHtml(customerMoney(earnings.paid))+'</strong><small>Recorded courier_net</small></div>'+
        '<div><span>In settlement</span><strong>'+escapeHtml(customerMoney(courierHomeSettlementPending(earnings)))+'</strong><small>Pending / eligible / held / processing</small></div>';
    }else{
      moneyBox.innerHTML=
        '<div><span>Active</span><strong>'+escapeHtml(String(Number(summary.active_count||0)))+'</strong><small>Deliveries</small></div>'+
        '<div><span>Delivered</span><strong>'+escapeHtml(String(Number(summary.delivered_count||0)))+'</strong><small>Completed deliveries</small></div>'+
        '<div class="courierMoneyHold"><strong>Earnings not configured yet</strong><span>No courier_net allocation evidence exists. Delivery fees stay customer charge context, not Courier earnings.</span></div>';
    }
  }

  const partial=hub.querySelector('#courierHomePartial');
  if(partial){
    partial.classList.toggle('hidden',!data.failures.length);
    partial.innerHTML=data.failures.length
      ?'<span>Some Home information is unavailable: '+escapeHtml(data.failures.join(', '))+'.</span><button type="button" data-courier-home-retry>Retry</button>'
      :'';
  }
  bindCourierHomeDynamic(hub);
  hub.querySelectorAll('[data-courier-home-retry]').forEach(button=>button.onclick=()=>loadCourierHome(hub,{force:true}));
}
async function loadCourierHome(hub,{force=false}={}){
  const loading=hub.querySelector('#courierHomeLoading');
  const error=hub.querySelector('#courierHomeError');
  if(force){
    loading?.classList.remove('hidden');
    error?.classList.add('hidden');
  }
  try{
    const data=await loadCourierHomeData(force);
    if(!hub.isConnected||activeRole!=='courier')return;
    renderCourierHomeData(hub,data);
  }catch(err){
    loading?.classList.add('hidden');
    hub.querySelector('#courierHomeDynamic')?.classList.add('hidden');
    const message=hub.querySelector('#courierHomeErrorMessage');
    if(message)message.textContent=err.message||'Courier Home could not be loaded.';
    error?.classList.remove('hidden');
  }
}
function renderCourierHub(){
  const hub=document.getElementById('roleHub');
  if(!hub)return;
  document.getElementById('accountSettingsWorkspace')?.classList.add('hidden');
  hub.innerHTML=
    '<div class="hubHero courierHomeHero"><div class="hubEyebrow">Delivery profile</div><h1>Ready for your next delivery?</h1><p>See whether you can work, whether you are available, what is assigned now and what Money evidence is recorded.</p><span class="hubStatus">Courier workspace</span></div>'+
    '<section class="courierHomePanel">'+
      '<div class="courierHomeToolbar"><div><strong>Home</strong><small>Your current work status</small></div><button id="courierHomeRefresh" type="button">Refresh</button></div>'+
      '<div id="courierHomeLoading" class="courierHomeState"><strong>Checking your delivery status…</strong><span>Eligibility, availability, assigned work and Money evidence.</span></div>'+
      '<div id="courierHomeError" class="courierHomeState courierHomeError hidden" role="alert"><strong>Courier Home could not be loaded.</strong><span id="courierHomeErrorMessage">Check your connection and try again.</span><button type="button" data-courier-home-retry>Try again</button></div>'+
      '<div id="courierHomePartial" class="courierHomePartial hidden"></div>'+
      '<div id="courierHomeDynamic" class="courierHomeDynamic hidden">'+
        '<section id="courierHomeStatus" class="courierHomeSection"></section>'+
        '<section class="courierHomeSection"><div class="hubSectionTitle"><h2>Current work</h2><span>What needs attention now</span></div><div id="courierHomeWork"></div></section>'+
        '<section class="courierHomeSection"><div class="hubSectionTitle"><h2>Money</h2><button type="button" data-courier-home-open="Money">Open Money</button></div><div id="courierHomeMoney" class="courierMoneySnapshot"></div></section>'+
      '</div>'+
      '<button class="courierSettingsLink" type="button" data-hub-feature="Profile Settings"><span>⚙️</span><span><strong>Delivery settings</strong><small>Vehicle, documents, payout preferences and profile settings</small></span><b>›</b></button>'+
    '</section>'+
    '<nav class="courierPrimaryNav" aria-label="Delivery navigation">'+
      '<button type="button" class="active" data-courier-nav="home"><span>⌂</span><strong>Home</strong></button>'+
      '<button type="button" data-courier-nav="deliveries"><span>📋</span><strong>Deliveries</strong></button>'+
      '<button type="button" data-courier-nav="money"><span>💰</span><strong>Money</strong></button>'+
    '</nav>';
  hub.querySelector('[data-hub-feature="Profile Settings"]').onclick=()=>window.BusinessLifeProfileSettings?.open?.('courier');
  hub.querySelectorAll('[data-courier-nav]').forEach(button=>button.onclick=()=>{
    const destination=button.dataset.courierNav;
    if(destination==='home'){
      hub.querySelectorAll('[data-courier-nav]').forEach(x=>x.classList.toggle('active',x===button));
      window.scrollTo({top:0,behavior:'smooth'});
      return;
    }
    openCourierHubFeature(hub,destination==='deliveries'?'Deliveries':'Money');
  });
  hub.querySelector('#courierHomeRefresh')?.addEventListener('click',()=>loadCourierHome(hub,{force:true}));
  hub.querySelectorAll('[data-courier-home-retry]').forEach(button=>button.onclick=()=>loadCourierHome(hub,{force:true}));
  hub.classList.remove('hidden');
  loadCourierHome(hub).catch(()=>{});
}

let serviceProviderHubPanel='home';
function openServiceProviderSection(section){
  if(window.BusinessLifeServices?.openProviderWorkspace)return window.BusinessLifeServices.openProviderWorkspace(section);
  showToast('Local Services is still loading. Try again in a moment.');
}
function setServiceProviderHubPanel(hub,panel,{scroll=true}={}){
  const target=['home','services','jobs'].includes(panel)?panel:'home';
  serviceProviderHubPanel=target;
  hub.querySelectorAll('[data-service-provider-panel]').forEach(node=>node.classList.toggle('hidden',node.dataset.serviceProviderPanel!==target));
  hub.querySelectorAll('[data-service-provider-nav]').forEach(button=>button.classList.toggle('active',button.dataset.serviceProviderNav===target));
  if(scroll)window.scrollTo({top:0,behavior:'smooth'});
}
function openServiceProviderHubDestination(hub,destination){
  if(destination==='money'){
    if(window.BusinessLifeProfileMoney?.openProfileMoney)return window.BusinessLifeProfileMoney.openProfileMoney('service_provider');
    return showToast('Money is still loading. Try again in a moment.');
  }
  setServiceProviderHubPanel(hub,destination);
}
function renderServiceProviderHub(){
  const hub=document.getElementById('roleHub');
  if(!hub)return;
  document.getElementById('accountSettingsWorkspace')?.classList.add('hidden');
  hub.innerHTML=
    '<div class="hubHero serviceProviderHero"><div class="hubEyebrow">Local Services profile</div><h1>Your work, without the platform jargon.</h1><p>Set up what you offer, handle customer work, and keep Money evidence separate from job value.</p><span class="hubStatus">Service Provider workspace</span></div>'+
    '<section class="serviceProviderPanel" data-service-provider-panel="home">'+
      '<div class="hubSectionTitle"><h2>Home</h2><span>Choose what needs attention</span></div>'+
      '<div class="serviceProviderActionGrid">'+
        '<button class="serviceProviderActionCard" type="button" data-service-provider-open="services"><span>🧰</span><strong>Set up your services</strong><small>Public profile, services offered, pricing, service area and trust evidence.</small></button>'+
        '<button class="serviceProviderActionCard" type="button" data-service-provider-open="jobs"><span>🗓️</span><strong>Handle customer work</strong><small>Requests, quotes, scheduled work, completion and verified review context.</small></button>'+
        '<button class="serviceProviderActionCard" type="button" data-service-provider-open="money"><span>💰</span><strong>Check Money</strong><small>Commercial job value and only the income or settlement evidence actually recorded.</small></button>'+
      '</div>'+
      '<div class="serviceProviderBoundary"><strong>Job value is not automatically income.</strong><span>Business & Life keeps payment and settlement evidence separate so this screen never invents earnings.</span></div>'+
    '</section>'+
    '<section class="serviceProviderPanel hidden" data-service-provider-panel="services">'+
      '<div class="hubSectionTitle"><h2>Services</h2><span>What customers can understand and hire</span></div>'+
      '<div class="serviceProviderContextList">'+
        '<button type="button" data-service-provider-section="Profile"><span>👤</span><span><strong>Public profile</strong><small>Name, headline, experience, service area, pricing and public visibility</small></span><b>›</b></button>'+
        '<button type="button" data-service-provider-section="Services"><span>🧰</span><span><strong>Services offered</strong><small>Choose the approved work customers can request</small></span><b>›</b></button>'+
        '<button type="button" data-service-provider-section="Qualifications"><span>🎓</span><span><strong>Qualifications &amp; work evidence</strong><small>CV summary, credentials and portfolio with privacy boundaries preserved</small></span><b>›</b></button>'+
      '</div>'+
    '</section>'+
    '<section class="serviceProviderPanel hidden" data-service-provider-panel="jobs">'+
      '<div class="hubSectionTitle"><h2>Jobs</h2><span>One lifecycle from request to confirmed completion</span></div>'+
      '<div class="serviceProviderContextList">'+
        '<button type="button" data-service-provider-section="Quotes"><span>💬</span><span><strong>Requests &amp; quotes</strong><small>Review new requests and send quotations</small></span><b>›</b></button>'+
        '<button type="button" data-service-provider-section="Jobs"><span>🗓️</span><span><strong>Current &amp; completed jobs</strong><small>Accepted, scheduled, active and completed customer work</small></span><b>›</b></button>'+
        '<button type="button" data-service-provider-section="Reviews"><span>⭐</span><span><strong>Verified reviews</strong><small>Feedback only where the canonical Customer-confirmed completion rule allows it</small></span><b>›</b></button>'+
      '</div>'+
    '</section>'+
    '<button class="serviceProviderSettingsLink" type="button" data-hub-feature="Profile Settings"><span>⚙️</span><span><strong>Local Services settings</strong><small>Profile preferences, payout destination and account-linked settings</small></span><b>›</b></button>'+
    '<nav class="serviceProviderPrimaryNav" aria-label="Local Services navigation">'+
      '<button type="button" class="active" data-service-provider-nav="home"><span>⌂</span><strong>Home</strong></button>'+
      '<button type="button" data-service-provider-nav="services"><span>🧰</span><strong>Services</strong></button>'+
      '<button type="button" data-service-provider-nav="jobs"><span>🗓️</span><strong>Jobs</strong></button>'+
      '<button type="button" data-service-provider-nav="money"><span>💰</span><strong>Money</strong></button>'+
    '</nav>';
  hub.querySelectorAll('[data-service-provider-open]').forEach(button=>button.onclick=()=>openServiceProviderHubDestination(hub,button.dataset.serviceProviderOpen));
  hub.querySelectorAll('[data-service-provider-nav]').forEach(button=>button.onclick=()=>openServiceProviderHubDestination(hub,button.dataset.serviceProviderNav));
  hub.querySelectorAll('[data-service-provider-section]').forEach(button=>button.onclick=()=>openServiceProviderSection(button.dataset.serviceProviderSection));
  hub.querySelector('[data-hub-feature="Profile Settings"]').onclick=()=>window.BusinessLifeProfileSettings?.open?.('service_provider');
  setServiceProviderHubPanel(hub,serviceProviderHubPanel,{scroll:false});
  hub.classList.remove('hidden');
}

function renderRoleHub(role) {
  if(role==='customer')return renderCustomerHub();
  if(role==='courier')return renderCourierHub();
  if(role==='service_provider')return renderServiceProviderHub();
  const meta = ROLE_META[role];
  const hub = document.getElementById('roleHub');
  if (!hub || !meta) return;
  document.getElementById('accountSettingsWorkspace')?.classList.add('hidden');
  const items=[...(HUBS[role]||[]),['⚙️','Profile Settings','Preferences, banking and tools for this profile','Profile Settings']];
  const tiles = items.map((item, index) => `<button class="hubTile ${item[3]==='Profile Settings'?'profileSettingsTile':index === 3 && role === 'customer' ? 'accent' : ''}" type="button" data-hub-feature="${escapeHtml(item[3])}"><span class="hubTileIcon">${item[0]}</span><strong>${escapeHtml(item[1])}</strong><small>${escapeHtml(item[2])}</small>${role === 'courier' && item[1] === 'Eligibility' ? `<span class="miniBadge ${snapshot?.courier?.eligibility_status === 'approved' ? '' : 'pending'}">${escapeHtml(snapshot?.courier?.eligibility_status || 'not requested')}</span>` : ''}</button>`).join('');
  hub.innerHTML = `<div class="hubHero"><div class="hubEyebrow">${escapeHtml(meta.label)} profile</div><h1>${escapeHtml(meta.hero)}</h1><p>One identity, a dedicated workspace, and only the information this role needs.</p><span class="hubStatus">Profile selected</span></div><div class="hubSectionTitle"><h2>Your ${escapeHtml(meta.label)} workspace</h2><span>Philippines Edition</span></div><div class="hubGrid">${tiles}</div>`;
  hub.querySelectorAll('[data-hub-feature]').forEach(btn => btn.onclick = () => btn.dataset.hubFeature==='Profile Settings'?window.BusinessLifeProfileSettings?.open?.(role):showToast(`${btn.dataset.hubFeature}: implementation continues in the next marketplace/service slice.`));
  hub.classList.remove('hidden');
}

function renderAccountHome(){
  if(!snapshot?.account)return;
  activeSurface='account';
  hideMerchantWorkspace();
  const account=snapshot.account,hub=document.getElementById('roleHub');
  if(!hub)return;
  document.getElementById('accountSettingsWorkspace')?.classList.add('hidden');
  const profiles=ROLE_ORDER.filter(isEnabled).map(role=>{const meta=ROLE_META[role];return `<button class="hubTile accountHomeAction" type="button" data-account-role="${role}"><span class="hubTileIcon">${meta.icon}</span><span class="accountHomeActionCopy"><strong>${escapeHtml(meta.label)}</strong><small>${escapeHtml(meta.desc)}</small></span><span class="accountHomeOpen">Open profile ›</span></button>`}).join('');
  const admin=adminContext?.is_admin?`<section class="accountHomeSection accountAdminAccess"><div class="hubSectionTitle"><h2>Admin access</h2><span>Assigned separately</span></div><button class="hubTile accountHomeAction" id="accountAdminProfile" type="button"><span class="hubTileIcon">🛡️</span><span class="accountHomeActionCopy"><strong>${escapeHtml(ADMIN_RANK_LABELS[adminRank(highestAdminAssignment())]||'Admin Workspace')}</strong><small>Delegated administration — separate from your personal and commercial profiles</small></span><span class="accountHomeOpen">Open workspace ›</span></button></section>`:'';
  const country=countryMeta(account.country_code);
  const test=isCompanyTestAccount(account);
  hub.innerHTML=`<div class="hubHero accountHomeHero ${test?'companyTestHero':''}"><div class="hubEyebrow">${test?'COMPANY TEST ACCOUNT':'PERSON ACCOUNT'}</div><h1>${escapeHtml(account.display_name||'Your account')}</h1><div class="accountHomeIdentity"><span>${test?'🧪 '+escapeHtml(testAccountRoleLabel(account))+' · managed by '+escapeHtml(account.managed_by||'Business & Life'):country.flag+' '+escapeHtml(country.label)+' account'}</span>${identityLine(account.personal_id,accountIdentityLabel(account))}</div><span class="hubStatus">${test?'Controlled testing only':'Choose where you want to continue'}</span></div><div class="hubSectionTitle"><h2>${test?'Assigned active profile':'Your active profiles'}</h2><span>${test?escapeHtml(testAccountRoleLabel(account)):'You choose every time'}</span></div><div class="hubGrid accountProfileGrid">${profiles||`<p class="hubEmpty">No active ${test?'test ':''}profile yet. Open Account Settings to start onboarding.</p>`}</div>${admin}<section class="accountHomeSection accountSettingsAccess"><div class="hubSectionTitle"><h2>Account</h2><span>${test?'Company-managed':'Shared settings'}</span></div><button class="hubTile accountHomeAction profileSettingsTile" id="accountHomeSettings" type="button"><span class="hubTileIcon">⚙️</span><span class="accountHomeActionCopy"><strong>Account Settings</strong><small>${test?'Test identity, security and assigned-role onboarding':'Personal details, security, Money &amp; Banking and profile onboarding'}</small></span><span class="accountHomeOpen">Open settings ›</span></button><button class="hubTile accountHomeAction accountSignOutAction" id="accountHomeSignOut" type="button"><span class="hubTileIcon">↪</span><span class="accountHomeActionCopy"><strong>Sign out</strong><small>End the current session and return to the sign-in screen</small></span><span class="accountHomeOpen">Sign out ›</span></button></section>`;
  hub.querySelectorAll('[data-account-role]').forEach(button=>button.onclick=()=>enableOrSwitch(button.dataset.accountRole));
  hub.querySelector('#accountAdminProfile')?.addEventListener('click',()=>window.location.assign('/admin'));
  hub.querySelector('#accountHomeSettings')?.addEventListener('click',()=>openAccountSettings());
  hub.querySelector('#accountHomeSignOut')?.addEventListener('click',event=>signOutCurrentAccount(event.currentTarget));
  bindCopyIds(hub);
  hub.classList.remove('hidden');
  renderTopAccount();
}

async function signOutCurrentAccount(button){
  if(button){button.disabled=true;button.setAttribute('aria-busy','true')}
  showToast('Signing out…');
  try{await profileApi('/api/auth/logout',{method:'POST',body:'{}'})}catch(_error){}
  localStorage.removeItem('abl_token');
  sessionStorage.removeItem('abl_flash');
  snapshot=null;profileFetchedAt=0;adminContext=null;adminContextFetchedAt=0;activeRole=null;activeSurface='account';
  window.location.replace('/');
}

function applyActiveRole() {
  activeRole = snapshot?.account?.active_role || null;
  renderTopAccount();
  hideFeatureWorkspaces();
  if (!activeRole){hideMerchantWorkspace();
    const hub=document.getElementById('roleHub'),account=snapshot?.account;
    if(hub&&account){
      const detailsReady=accountDetailsReady(account);
      const emailReady=Boolean(account.email_verified_at);
      const test=isCompanyTestAccount(account);
      hub.innerHTML=`<div class="hubHero ${test?'companyTestHero':''}"><div class="hubEyebrow">${test?'COMPANY TEST ACCOUNT':'PERSON ACCOUNT'}</div><h1>${test?`${escapeHtml(testAccountRoleLabel(account))} test account`:'Choose your first profile when ready.'}</h1><p>${test?'This identity is managed by Business & Life for controlled testing. It does not represent a person and does not need a personal phone or home address.':'Set up your account first. No Customer, Merchant, Supplier, Delivery or Local Services profile is active. You decide which onboarding to start.'}</p><span class="hubStatus">${test?'🧪':countryMeta(account.country_code).flag} ${escapeHtml(account.personal_id||'Account ID preparing')}</span></div><div class="hubSectionTitle"><h2>Before your first profile</h2><span>${detailsReady&&emailReady?'Ready to choose':'Setup required'}</span></div><div class="hubGrid"><div class="hubTile"><span class="hubTileIcon">${detailsReady?'✓':'1'}</span><strong>${test?'Test identity':'Personal details'}</strong><small>${test?'Company-managed; personal phone and address not required':detailsReady?'Name and primary address completed':'Add your name and primary address'}</small></div><div class="hubTile"><span class="hubTileIcon">${emailReady?'✓':'2'}</span><strong>Email verification</strong><small>${emailReady?'Email verified':'Open the verification message or request a new one'}</small></div><button class="hubTile profileSettingsTile" id="openFirstAccountSettings" type="button"><span class="hubTileIcon">⚙️</span><strong>Account Settings</strong><small>${test?'Open the assigned test role':'Complete setup and choose a profile to onboard'}</small></button></div>`;
      hub.classList.remove('hidden');hub.querySelector('#openFirstAccountSettings').onclick=()=>openAccountSettings();
    }return
  }
  if (activeRole === 'merchant') showMerchantWorkspace();
  else { hideMerchantWorkspace(); renderRoleHub(activeRole); }
}

function publishProfileState(){
  const detail={surface:activeSurface,activeRole:activeSurface==='profile'?activeRole:null,accountId:Number(snapshot?.account?.id)||null,snapshot};
  window.BusinessLifeProfileState=Object.freeze(detail);
  document.dispatchEvent(new CustomEvent('abl:profile-state',{detail}));
}
async function refreshProfile(force=false) {
  if (!token()) return null;
  if(!force&&snapshot?.account&&profileFetchedAt&&Date.now()-profileFetchedAt<PROFILE_CACHE_MS)return snapshot;
  if(profileRefreshPromise)return profileRefreshPromise;
  profileRefreshPromise=(async()=>{
    const bootstrap = await profileApi('/api/session/bootstrap');
    snapshot = bootstrap.profile;
    adminContext = bootstrap.admin?.is_admin ? bootstrap.admin : null;
    adminContextFetchedAt=Date.now();
    profileFetchedAt=Date.now();
    activeRole = snapshot.account?.active_role || null;
    ensureShellChrome();
    renderAccountHome();
    const params=new URLSearchParams(location.search),requested=params.get('account_settings');
    if(['home','personal','security','profiles'].includes(requested)){
      params.delete('account_settings');
      history.replaceState({},'',location.pathname+(params.toString()?'?'+params.toString():'')+location.hash);
      openAccountSettings(requested);
    }
    publishProfileState();
    return snapshot;
  })();
  try{return await profileRefreshPromise}
  finally{profileRefreshPromise=null}
}

function onShellVisibility() {
  const shell = document.getElementById('shell');
  if (!shell) return;
  if (!shell.classList.contains('hidden') && token()) refreshProfile().catch(err => console.warn('Profile shell:', err.message));
  if (shell.classList.contains('hidden')) closeDrawer();
}

function boot() {
  if (!ensureShellChrome()) return setTimeout(boot, 80);
  hideMerchantWorkspace();
  const shell = document.getElementById('shell');
  if (shell) new MutationObserver(onShellVisibility).observe(shell, { attributes: true, attributeFilter: ['class'] });
  if (token()) {
    refreshProfile().catch(() => {});
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
  document.addEventListener('abl:profile-state',e=>{if(e.detail?.activeRole!=='customer')invalidateCustomerHome()},{passive:true});
}
boot();
