const ROLE_META = {
  merchant: { label: 'Merchant', icon: '🏪', desc: 'Accounting, products and business', hero: 'Run your business with every peso visible.' },
  customer: { label: 'Customer', icon: '🛍️', desc: 'Discover, order and track', hero: 'Discover local. Order with confidence.' },
  supplier: { label: 'Supplier', icon: '📦', desc: 'Catalog and procurement orders', hero: 'Supply local businesses from one place.' },
  courier: { label: 'Delivery', icon: '🛵', desc: 'Approved delivery operations', hero: 'Deliver safely with a clear active route.' },
  service_provider: { label: 'Local Services', icon: '🛠️', desc: 'Skills, quotes and service jobs', hero: 'Turn your skills into trusted local work.' }
};
const ROLE_ORDER = ['merchant', 'customer', 'supplier', 'courier', 'service_provider'];
const ADMIN_RANK_LABELS = { super_admin:'Super Admin', country_admin:'Country Admin', territory_admin:'Territory Admin', specialist:'Specialist' };
let snapshot = null;
let adminContext = null;
let activeRole = 'merchant';
let toastTimer;

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
  const bits = String(name || 'Business owner').trim().split(/\s+/).filter(Boolean);
  return (bits[0]?.[0] || 'B').toUpperCase();
}
function avatarMarkup(account, extraClass = '') {
  const image = account?.avatar_data_url;
  if (image) return `<span class="accountAvatar ${extraClass}"><img src="${image}" alt="Account avatar"></span>`;
  return `<span class="accountAvatar ${extraClass}" aria-hidden="true">${escapeHtml(initials(account?.display_name))}</span>`;
}
function roleProfile(role) { return snapshot?.profiles?.find(p => p.role === role); }
function isEnabled(role) { return Boolean(roleProfile(role)?.enabled); }
function adminRank(assignment){ return assignment?.effective_rank || assignment?.authority_rank || assignment?.admin_role || 'admin'; }
function highestAdminAssignment(){
  const levels={super_admin:100,country_admin:80,territory_admin:60,specialist:40};
  return [...(adminContext?.assignments||[])].sort((a,b)=>(levels[adminRank(b)]||0)-(levels[adminRank(a)]||0))[0]||null;
}
function adminProfileRow(){
  if(!adminContext?.is_admin)return '';
  const assignment=highestAdminAssignment();
  const rank=adminRank(assignment);
  const label=ADMIN_RANK_LABELS[rank]||'Admin';
  const scope=assignment?.territory_name||assignment?.country_code||'Platform';
  const desc=rank==='super_admin'?'Platform control • all administrative functions':scope+' • delegated administration';
  return `<div id="adminProfileRole" class="profileRole adminProfileRole">
    <span class="roleIcon">🛡️</span>
    <span class="roleCopy"><strong>${escapeHtml(label)}</strong><small>${escapeHtml(desc)}</small></span>
    <button class="roleAction" type="button" data-admin-profile>Switch</button>
  </div>`;
}
async function refreshAdminContext(){
  if(!token()){adminContext=null;return null}
  try{
    const data=await profileApi('/api/admin/me');
    adminContext=data?.is_admin?data:null;
  }catch(_error){adminContext=null}
  return adminContext;
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
    controls.innerHTML = `<span id="activeRolePill" class="activeRolePill">Merchant</span><button id="accountAvatarButton" class="accountAvatarButton" type="button" aria-label="Open account and profiles"><span class="accountAvatar">B</span></button>`;
    topActions.appendChild(controls);
    controls.querySelector('#accountAvatarButton').addEventListener('click', openDrawer);
  }
  if (!document.getElementById('roleHub')) {
    const hub = document.createElement('section');
    hub.id = 'roleHub';
    hub.className = 'roleHub hidden';
    const topbar = shell.querySelector('.topbar');
    topbar.insertAdjacentElement('afterend', hub);
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
  if (pill) pill.textContent = ROLE_META[activeRole]?.label || activeRole;
}

function renderDrawer() {
  if (!snapshot?.account) return;
  const account = snapshot.account;
  const panel = document.getElementById('profileDrawerPanel');
  if (!panel) return;
  const adminRow = adminProfileRow();
  const profileRows = ROLE_ORDER.map(role => {
    const meta = ROLE_META[role];
    const profile = roleProfile(role);
    const enabled = Boolean(profile?.enabled);
    const current = activeRole === role;
    const statusText = role === 'courier' && snapshot.courier ? ` • ${snapshot.courier.eligibility_status.replaceAll('_',' ')}` : '';
    return `<div class="profileRole ${current ? 'active' : ''}">
      <span class="roleIcon">${meta.icon}</span>
      <span class="roleCopy"><strong>${meta.label}</strong><small>${meta.desc}${statusText}</small></span>
      <button class="roleAction ${current ? 'active' : enabled ? '' : 'enable'}" type="button" data-role-action="${role}">${current ? 'Active' : enabled ? 'Switch' : 'Enable'}</button>
    </div>`;
  }).join('');
  panel.innerHTML = `
    <div class="drawerHandle"></div>
    <div class="drawerHeader">${avatarMarkup(account)}<div class="drawerIdentity"><h2>${escapeHtml(account.display_name || 'Business owner')}</h2><p>${escapeHtml(account.email || account.phone || 'One account • multiple profiles')}</p></div><button id="drawerClose" class="drawerClose" type="button" aria-label="Close">×</button></div>
    <section class="drawerSection"><h3>Switch profile</h3><div class="profileRoleList">${adminRow}${profileRows}</div></section>
    <section class="drawerSection growthDrawerSection">
      <div class="growthDrawerCopy"><span class="growthDrawerEyebrow">INVITE &amp; EARN</span><h3>Promotion Center</h3><p>Share your account-level referral link from the active ${escapeHtml(ROLE_META[activeRole]?.label || activeRole)} profile.</p></div>
      <button id="promotionCenterButton" class="growthDrawerButton" type="button">Open Promotion Center</button>
    </section>
    <section class="drawerSection"><h3>Account identity</h3>
      <form id="accountIdentityForm" class="profileForm">
        <div class="avatarEdit"><input id="avatarFile" type="file" accept="image/png,image/jpeg,image/webp"><button id="removeAvatar" class="miniBtn" type="button">Remove photo</button></div>
        <div class="avatarHint">Photo is compressed on your phone before it is saved.</div>
        <label>Name<input id="shellDisplayName" value="${escapeHtml(account.display_name || '')}" required></label>
        <label>Email<input id="shellEmail" type="email" value="${escapeHtml(account.email || '')}"></label>
        <label>Phone<input id="shellPhone" inputmode="tel" value="${escapeHtml(account.phone || '')}"></label>
        <label>Primary address<textarea id="shellAddress" rows="2">${escapeHtml(account.address || '')}</textarea></label>
        <div class="formActions"><button class="primary" type="submit">Save account</button></div>
      </form>
    </section>`;
  panel.querySelector('#drawerClose').onclick = closeDrawer;
  panel.querySelector('#promotionCenterButton').onclick = () => { window.location.href = `/referral/promotion-center.html?profile=${encodeURIComponent(activeRole)}`; };
  panel.querySelector('[data-admin-profile]')?.addEventListener('click',()=>{closeDrawer();window.location.assign('/admin')});
  panel.querySelectorAll('[data-role-action]').forEach(btn => btn.onclick = () => enableOrSwitch(btn.dataset.roleAction));
  panel.querySelector('#accountIdentityForm').onsubmit = saveIdentity;
  panel.querySelector('#avatarFile').onchange = uploadAvatar;
  panel.querySelector('#removeAvatar').onclick = removeAvatar;
  document.dispatchEvent(new CustomEvent('abl:drawer-rendered', { detail: { activeRole, accountId: Number(account.id) || null } }));
}

async function openDrawer() {
  if (!token()) return showToast('Sign in first to open your account.');
  if (snapshot?.account) renderDrawer();
  document.getElementById('profileDrawerBackdrop')?.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  try {
    await Promise.all([refreshProfile(),refreshAdminContext()]);
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
    renderTopAccount(); renderDrawer(); showToast('Account saved.');
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
    renderTopAccount(); renderDrawer(); showToast('Profile photo updated.');
  } catch (err) { showToast(err.message); }
}
async function removeAvatar() {
  try {
    snapshot = await profileApi('/api/me', { method: 'PATCH', body: JSON.stringify({
      display_name: snapshot.account.display_name || 'Business owner', phone: snapshot.account.phone || '', email: snapshot.account.email || '', address: snapshot.account.address || '', avatar_data_url: ''
    }) });
    renderTopAccount(); renderDrawer(); showToast('Profile photo removed.');
  } catch (err) { showToast(err.message); }
}

async function enableOrSwitch(role) {
  try {
    if (!isEnabled(role)) snapshot = await profileApi(`/api/profiles/${role}`, { method: 'PUT', body: JSON.stringify({ enabled: true, visibility: role === 'merchant' ? 'public' : 'private' }) });
    snapshot = await profileApi('/api/me/active-role', { method: 'PATCH', body: JSON.stringify({ role }) });
    activeRole = snapshot.account.active_role || role;
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
  applyActiveRole();
  publishProfileState();
  window.scrollTo({top:0,behavior:'auto'});
}
window.BusinessLifeShell=Object.freeze({
  showActiveWorkspace,
  getProfileState:()=>window.BusinessLifeProfileState||null
});

const HUBS = {
  customer: [
    ['🍲','Food','Local food merchants, menus and ordering','Marketplace'],
    ['🧺','Non-food','Everyday goods from nearby merchants','Marketplace'],
    ['🛠️','Local Services','Electricians, carpenters, painters and more','Local Services'],
    ['🛒','Platform Store','Philippines-only platform Shopify store','Platform Store'],
    ['🧾','My Orders','Preparation, payment and order history','Orders'],
    ['📍','Delivery','Courier status and live tracking','Delivery']
  ],
  supplier: [
    ['📦','My Catalog','Products and raw materials you supply','Catalog'],['📥','Incoming Orders','Purchase orders from connected merchants','Procurement'],['⏱️','ETA & Readiness','Confirm availability and ready times','ETA'],['🚚','Fulfilment','Pickup or supplier delivery status','Fulfilment']
  ],
  courier: [
    ['✅','Eligibility','Admin approval and document status','Eligibility'],['🟢','Availability','Go available after approval','Availability'],['📋','Assigned Deliveries','Your active delivery queue','Deliveries'],['🗺️','Active Route','Pickup, transit and completion','Tracking']
  ],
  service_provider: [
    ['👤','Public Profile','Headline, experience and service area','Profile'],['🧰','Services Offered','Choose the tasks you provide','Services'],['🎓','Qualifications & CV','Credentials, experience and portfolio','Qualifications'],['💬','Requests & Quotes','Review requests and send quotes','Quotes'],['🗓️','Jobs','Scheduled and active work','Jobs'],['⭐','Reviews','Verified feedback from completed work','Reviews']
  ]
};

function renderRoleHub(role) {
  const meta = ROLE_META[role];
  const hub = document.getElementById('roleHub');
  if (!hub || !meta) return;
  const tiles = (HUBS[role] || []).map((item, index) => `<button class="hubTile ${index === 3 && role === 'customer' ? 'accent' : ''}" type="button" data-hub-feature="${escapeHtml(item[3])}"><span class="hubTileIcon">${item[0]}</span><strong>${escapeHtml(item[1])}</strong><small>${escapeHtml(item[2])}</small>${role === 'courier' && item[1] === 'Eligibility' ? `<span class="miniBadge ${snapshot?.courier?.eligibility_status === 'approved' ? '' : 'pending'}">${escapeHtml(snapshot?.courier?.eligibility_status || 'not requested')}</span>` : ''}</button>`).join('');
  hub.innerHTML = `<div class="hubHero"><div class="hubEyebrow">${escapeHtml(meta.label)} profile</div><h1>${escapeHtml(meta.hero)}</h1><p>One identity, a dedicated workspace, and only the information this role needs.</p><span class="hubStatus">Profile selected</span></div><div class="hubSectionTitle"><h2>Your ${escapeHtml(meta.label)} workspace</h2><span>Philippines Edition</span></div><div class="hubGrid">${tiles}</div>`;
  hub.querySelectorAll('[data-hub-feature]').forEach(btn => btn.onclick = () => showToast(`${btn.dataset.hubFeature}: implementation continues in the next marketplace/service slice.`));
  hub.classList.remove('hidden');
}

function applyActiveRole() {
  activeRole = snapshot?.account?.active_role || 'merchant';
  renderTopAccount();
  if (activeRole === 'merchant') showMerchantWorkspace();
  else { hideMerchantWorkspace(); renderRoleHub(activeRole); }
}

function publishProfileState(){
  const detail={activeRole,accountId:Number(snapshot?.account?.id)||null,snapshot};
  window.BusinessLifeProfileState=Object.freeze(detail);
  document.dispatchEvent(new CustomEvent('abl:profile-state',{detail}));
}
async function refreshProfile() {
  if (!token()) return;
  snapshot = await profileApi('/api/me');
  activeRole = snapshot.account?.active_role || 'merchant';
  ensureShellChrome();
  applyActiveRole();
  publishProfileState();
}

function onShellVisibility() {
  const shell = document.getElementById('shell');
  if (!shell) return;
  if (!shell.classList.contains('hidden') && token()) refreshProfile().catch(err => console.warn('Profile shell:', err.message));
  if (shell.classList.contains('hidden')) closeDrawer();
}

function boot() {
  if (!ensureShellChrome()) return setTimeout(boot, 80);
  const shell = document.getElementById('shell');
  if (shell) new MutationObserver(onShellVisibility).observe(shell, { attributes: true, attributeFilter: ['class'] });
  if (token()) {
    refreshProfile().catch(() => {});
    refreshAdminContext().then(()=>{if(!document.getElementById('profileDrawerBackdrop')?.classList.contains('hidden'))renderDrawer()}).catch(()=>{});
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
}
boot();
