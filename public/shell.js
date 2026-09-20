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
function adminRank(assignment){ return assignment?.effective_rank || assignment?.authority_rank || assignment?.admin_role || 'admin'; }
function highestAdminAssignment(){
  const levels={super_admin:100,country_admin:80,territory_admin:60,specialist:40};
  return [...(adminContext?.assignments||[])].sort((a,b)=>(levels[adminRank(b)]||0)-(levels[adminRank(a)]||0))[0]||null;
}
function countryMeta(code){return COUNTRY_META[code]||{flag:'🌐',label:code||'Country not set'}}
function identityLine(id,label='ID'){
  return `<span class="publicIdentity"><span>${escapeHtml(label)}</span><code>${escapeHtml(id||'Preparing ID…')}</code>${id?`<button type="button" data-copy-id="${escapeHtml(id)}" aria-label="Copy ${escapeHtml(label)}">Copy</button>`:''}</span>`;
}
function bindCopyIds(panel){panel.querySelectorAll('[data-copy-id]').forEach(button=>button.onclick=async()=>{try{await navigator.clipboard.writeText(button.dataset.copyId);showToast('ID copied.')}catch{showToast('Select and copy the ID manually.')}})}
function drawerHeader(account,back=false){const country=countryMeta(account.country_code);return `<div class="drawerHandle"></div><div class="drawerHeader">${back?'<button id="drawerBack" class="drawerBack" type="button" aria-label="Back">‹</button>':avatarMarkup(account)}<div class="drawerIdentity"><h2>${escapeHtml(back?'Account Settings':account.display_name||'Business owner')}</h2><p>${country.flag} ${escapeHtml(country.label)} · ${escapeHtml(account.country_code||'')}</p>${identityLine(account.personal_id,'Personal ID')}</div><button id="drawerClose" class="drawerClose" type="button" aria-label="Close">×</button></div>`}
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
    <button id="accountHomeButton" class="accountSettingsEntry" type="button"><span>👤</span><span><strong>Account Home</strong><small>Personal identity and profile selection</small></span><b>›</b></button>
    <section class="drawerSection"><h3>Active profiles</h3><div class="profileRoleList">${profileRows||'<p class="drawerEmpty">No active profiles yet.</p>'}</div></section>
    ${adminContext?.is_admin?'<button id="adminWorkspaceButton" class="accountSettingsEntry adminWorkspaceEntry" type="button"><span>🛡️</span><span><strong>Admin Workspace</strong><small>Delegated administrative access</small></span><b>›</b></button>':''}
    <button id="accountSettingsButton" class="accountSettingsEntry" type="button"><span>⚙️</span><span><strong>Account Settings</strong><small>Personal details, security and profile management</small></span><b>›</b></button>
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
  const emailReady=Boolean(account.email_verified_at);
  const detailsReady=Boolean(String(account.display_name||'').trim()&&String(account.email||'').trim()&&String(account.address||'').trim());
  return ROLE_ORDER.map(role=>{
    const meta=ROLE_META[role],profile=roleProfile(role),enabled=Boolean(profile?.enabled&&profile?.status==='active');
    const state=profile?.status||'not_started',reactivable=state==='disabled';
    const inProgress=['application_started','requirements_pending','submitted','under_review','rejected'].includes(state);
    let action,label;
    if(enabled){action=`data-profile-toggle="${role}" data-enabled="1"`;label='Disable'}
    else if(!emailReady){action=`data-verify-email="${role}"`;label='Verify email first'}
    else if(!detailsReady){action=`data-complete-personal="${role}"`;label='Complete details'}
    else if(reactivable){action=`data-profile-reactivate="${role}"`;label='Reactivate'}
    else{action=`data-role-action="${role}"`;label=inProgress?'Continue onboarding':'Start onboarding'}
    const status=enabled?'Active profile':reactivable?'Disabled · ID and history preserved':inProgress?state.replaceAll('_',' '):!emailReady?'Email verification required':!detailsReady?'Personal details required':'Not active';
    return `<div class="profileRole"><span class="roleIcon">${meta.icon}</span><span class="roleCopy"><strong>${meta.label}</strong><small>${escapeHtml(status)}</small><code>${escapeHtml(profile?.profile_id||`${account.personal_id}-${({merchant:'ME',customer:'CU',supplier:'SU',courier:'DE',service_provider:'LS'})[role]}`)}</code></span><button class="roleAction ${enabled?'active':'enable'}" type="button" ${action}>${label}</button></div>`
  }).join('');
}

function accountSettingsHeader(title,subtitle){return `<div class="accountSettingsHeader"><button id="accountSettingsBack" type="button" aria-label="Back">‹</button><div><span>ACCOUNT SETTINGS</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div></div>`}
function renderAccountSettings(view=accountSettingsView){
  if(!snapshot?.account)return;
  const account=snapshot.account,workspace=document.getElementById('accountSettingsWorkspace');if(!workspace)return;
  workspace.classList.remove('hidden');
  accountSettingsView=view;
  if(view==='home'){
    workspace.innerHTML=accountSettingsHeader('Your account','Settings shared by your personal account, separate from every work profile.')+`<div class="accountSettingsGrid">
      <button type="button" data-account-settings-view="personal"><span>👤</span><strong>Personal details</strong><small>Photo, name, email, phone and primary address</small><b>›</b></button>
      <button type="button" data-account-settings-view="security"><span>🔐</span><strong>Security & access</strong><small>Password, email verification and signed-in devices</small><b>›</b></button>
      <button type="button" data-account-settings-view="profiles"><span>🧩</span><strong>Manage profiles</strong><small>Start onboarding or deactivate profiles you own</small><b>›</b></button>
      <button type="button" id="accountMoneyBanking"><span>🏦</span><strong>Money & Banking</strong><small>Shared payment methods, payout destination and financial identity</small><b>›</b></button>
    </div><div class="accountSettingsBoundary"><strong>Profile settings stay inside each profile</strong><p>Open Customer, Merchant, Supplier, Delivery or Local Services and use its dedicated Profile Settings card.</p></div>`;
  }else if(view==='personal'){
    workspace.innerHTML=accountSettingsHeader('Personal details','Identity and contact information shared by your account.')+`<section class="accountSettingsCard"><form id="accountIdentityForm" class="profileForm">
      <div class="avatarEdit"><input id="avatarFile" type="file" accept="image/png,image/jpeg,image/webp"><button id="removeAvatar" class="miniBtn" type="button">Remove photo</button></div>
      <div class="avatarHint">Photo is compressed on your phone before it is saved.</div>
      <label>Name<input id="shellDisplayName" value="${escapeHtml(account.display_name || '')}" required></label>
      <label>Email<input id="shellEmail" type="email" value="${escapeHtml(account.email || '')}"></label>
      <label>Phone<input id="shellPhone" inputmode="tel" value="${escapeHtml(account.phone || '')}"></label>
      <label>Primary address<textarea id="shellAddress" rows="2">${escapeHtml(account.address || '')}</textarea></label>
      <div class="formActions"><button class="primary" type="submit">Save account</button></div>
    </form></section>`;
  }else if(view==='profiles'){
    const detailsReady=Boolean(String(account.display_name||'').trim()&&String(account.email||'').trim()&&String(account.address||'').trim());
    const activationGate=!account.email_verified_at?`<section class="profileActivationGate" role="status"><span aria-hidden="true">✉️</span><div><strong>Verify your email before activating a profile</strong><p>This protects your Personal ID. After verification, you can start or continue each profile onboarding here.</p></div><button id="verifyProfilesEmail" type="button">Open Security &amp; access</button></section>`:!detailsReady?`<section class="profileActivationGate" role="status"><span aria-hidden="true">👤</span><div><strong>Complete your personal details first</strong><p>Add your name, email and primary address before activating a profile.</p></div><button id="completeProfilesIdentity" type="button">Open Personal details</button></section>`:'';
    workspace.innerHTML=accountSettingsHeader('Manage profiles','Profiles derive from your Personal ID and keep their IDs after deactivation.')+activationGate+`<section class="accountSettingsCard"><div class="profileRoleList">${profileManagementMarkup()}</div></section>`;
  }else{
    workspace.innerHTML=accountSettingsHeader('Security & access','Protect the personal account used by all your profiles.')+'<div id="accountSecurityMount"></div>';
  }
  workspace.querySelector('#accountSettingsBack').onclick=()=>view==='home'?closeAccountSettings():renderAccountSettings('home');
  workspace.querySelectorAll('[data-account-settings-view]').forEach(button=>button.onclick=()=>renderAccountSettings(button.dataset.accountSettingsView));
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

function openAccountSettings(view='home'){
  closeDrawer();
  activeSurface='account';
  hideMerchantWorkspace();
  hideFeatureWorkspaces();
  document.getElementById('roleHub')?.classList.add('hidden');
  document.getElementById('profileSettingsWorkspace')?.classList.add('hidden');
  const workspace=document.getElementById('accountSettingsWorkspace');
  workspace?.classList.remove('hidden');
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

async function reactivateProfile(role){try{snapshot=await profileApi(`/api/profiles/${role}`,{method:'PUT',body:JSON.stringify({enabled:true,visibility:'private'})});activeRole=snapshot.account.active_role||role;profileFetchedAt=Date.now();renderAccountSettings('profiles');publishProfileState();showToast('Profile reactivated.')}catch(err){showToast(err.message)}}

async function toggleProfile(role,enabled){try{if(enabled&&role==='customer')snapshot=await profileApi('/api/profiles/customer/activate',{method:'POST',body:'{}'});else if(enabled){document.dispatchEvent(new CustomEvent('abl:start-profile-onboarding',{detail:{role}}));return}else snapshot=await profileApi(`/api/profiles/${role}`,{method:'PUT',body:JSON.stringify({enabled:false,visibility:'private'})});activeRole=snapshot.account.active_role||null;profileFetchedAt=Date.now();if(enabled){activeSurface='profile';applyActiveRole()}else renderAccountHome();publishProfileState();renderAccountSettings();showToast(enabled?'Profile activated.':'Profile disabled.')}catch(err){showToast(err.message)}}

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
      phone: document.getElementById('shellPhone').value,
      address: document.getElementById('shellAddress').value
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
  customer: [
    ['🍲','Food','Local food merchants, menus and ordering','Marketplace'],
    ['🧺','Non-food','Everyday goods from nearby merchants','Marketplace'],
    ['🛠️','Local Services','Electricians, carpenters, painters and more','Local Services'],
    ['🛒','Platform Store','Philippines-only platform Shopify store','Platform Store'],
    ['🧾','My Orders','Preparation, payment and order history','Orders'],
    ['📍','Delivery','Courier status and live tracking','Delivery'],
    ['💳','My Money','Payments, refunds and personal purchase flow','Money']
  ],
  supplier: [
    ['📦','My Catalog','Products and raw materials you supply','Catalog'],['📥','Incoming Orders','Purchase orders from connected merchants','Procurement'],['⏱️','ETA & Readiness','Confirm availability and ready times','ETA'],['🚚','Fulfilment','Pickup or supplier delivery status','Fulfilment']
  ],
  courier: [
    ['✅','Eligibility','Admin approval and document status','Eligibility'],['🟢','Availability','Go available after approval','Availability'],['📋','Assigned Deliveries','Your active delivery queue','Deliveries'],['🗺️','Active Route','Pickup, transit and completion','Tracking'],['💰','Earnings & Money','Recorded earnings, settlement and payout status','Money']
  ],
  service_provider: [
    ['👤','Public Profile','Headline, experience and service area','Profile'],['🧰','Services Offered','Choose the tasks you provide','Services'],['🎓','Qualifications & CV','Credentials, experience and portfolio','Qualifications'],['💬','Requests & Quotes','Review requests and send quotes','Quotes'],['🗓️','Jobs','Scheduled and active work','Jobs'],['⭐','Reviews','Verified feedback from completed work','Reviews'],['💰','Money','Job value, receivables and payout status','Money']
  ]
};

function renderRoleHub(role) {
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
  hub.innerHTML=`<div class="hubHero accountHomeHero"><div class="hubEyebrow">PERSON ACCOUNT</div><h1>${escapeHtml(account.display_name||'Your account')}</h1><div class="accountHomeIdentity"><span>${country.flag} ${escapeHtml(country.label)} account</span>${identityLine(account.personal_id,'Personal ID')}</div><span class="hubStatus">Choose where you want to continue</span></div><div class="hubSectionTitle"><h2>Your active profiles</h2><span>You choose every time</span></div><div class="hubGrid accountProfileGrid">${profiles||'<p class="hubEmpty">No active profiles yet. Open Account Settings to start onboarding.</p>'}</div>${admin}<section class="accountHomeSection accountSettingsAccess"><div class="hubSectionTitle"><h2>Account</h2><span>Shared settings</span></div><button class="hubTile accountHomeAction profileSettingsTile" id="accountHomeSettings" type="button"><span class="hubTileIcon">⚙️</span><span class="accountHomeActionCopy"><strong>Account Settings</strong><small>Personal details, security, Money &amp; Banking and profile onboarding</small></span><span class="accountHomeOpen">Open settings ›</span></button><button class="hubTile accountHomeAction accountSignOutAction" id="accountHomeSignOut" type="button"><span class="hubTileIcon">↪</span><span class="accountHomeActionCopy"><strong>Sign out</strong><small>End the current session and return to the sign-in screen</small></span><span class="accountHomeOpen">Sign out ›</span></button></section>`;
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
      const detailsReady=Boolean(String(account.display_name||'').trim()&&String(account.address||'').trim());
      const emailReady=Boolean(account.email_verified_at);
      hub.innerHTML=`<div class="hubHero"><div class="hubEyebrow">PERSON ACCOUNT</div><h1>Choose your first profile when ready.</h1><p>Set up your account first. No Customer, Merchant, Supplier, Delivery or Local Services profile is active. You decide which onboarding to start.</p><span class="hubStatus">${countryMeta(account.country_code).flag} ${escapeHtml(account.personal_id||'Personal ID preparing')}</span></div><div class="hubSectionTitle"><h2>Before your first profile</h2><span>${detailsReady&&emailReady?'Ready to choose':'Setup required'}</span></div><div class="hubGrid"><div class="hubTile"><span class="hubTileIcon">${detailsReady?'✓':'1'}</span><strong>Personal details</strong><small>${detailsReady?'Name and primary address completed':'Add your name and primary address'}</small></div><div class="hubTile"><span class="hubTileIcon">${emailReady?'✓':'2'}</span><strong>Email verification</strong><small>${emailReady?'Email verified':'Open the verification message or request a new one'}</small></div><button class="hubTile profileSettingsTile" id="openFirstAccountSettings" type="button"><span class="hubTileIcon">⚙️</span><strong>Account Settings</strong><small>Complete setup and choose a profile to onboard</small></button></div>`;
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
}
boot();
