import { captureReferralEvent, referralCorrelationId } from './referral/referral-analytics.js';

const authStyle = document.createElement('style');
authStyle.textContent = `
.accountAuthChoices{display:grid;gap:9px;width:min(100%,520px);margin:12px auto 0}.accountAuthDivider{display:flex;align-items:center;gap:10px;color:#7b8797;font-size:11px}.accountAuthDivider::before,.accountAuthDivider::after{content:"";height:1px;background:#dfe6e3;flex:1}.accountAuthBtn{border:1px solid #d8e2df;background:#fff;color:#17233c;border-radius:15px;padding:12px 14px;font-weight:800;font-size:13px;box-shadow:0 4px 14px rgba(23,35,60,.04)}.accountAuthBtn.primaryAlt{background:#0a7c66;color:#fff;border-color:#0a7c66}.accountAuthHint{font-size:10px;color:#687386;text-align:center;line-height:1.45}
.authModalBackdrop{position:fixed;inset:0;z-index:180;background:rgba(9,18,33,.52);backdrop-filter:blur(5px);display:grid;place-items:end center}.authModalBackdrop.hidden{display:none!important}.authModal{width:min(100%,520px);max-height:92dvh;overflow:auto;background:#f8fbfa;border-radius:28px 28px 0 0;padding:12px 16px calc(24px + env(safe-area-inset-bottom));box-shadow:0 -20px 70px rgba(9,18,33,.28)}.authModalHandle{width:44px;height:5px;border-radius:999px;background:#cfd9d6;margin:2px auto 16px}.authModalHeader{display:flex;justify-content:space-between;align-items:start;gap:16px;margin-bottom:14px}.authModalHeader h2{margin:0 0 4px;font-size:22px;letter-spacing:-.03em;color:#17233c}.authModalHeader p{margin:0;color:#687386;font-size:12px;line-height:1.45}.authModalClose{border:0;background:#eaf0ee;width:38px;height:38px;border-radius:50%;font-size:20px}.authTabs{display:grid;grid-template-columns:1fr 1fr;background:#e9f0ed;padding:4px;border-radius:14px;margin-bottom:14px}.authTab{border:0;background:transparent;border-radius:11px;padding:9px;font-weight:800;font-size:12px;color:#687386}.authTab.active{background:#fff;color:#075f50;box-shadow:0 3px 10px rgba(23,35,60,.06)}.authForm{display:grid;gap:11px;background:#fff;border:1px solid #e1e8e5;border-radius:20px;padding:16px}.authForm label{display:grid;gap:6px;font-size:11px;font-weight:800;color:#4f5a6b}.authForm input,.authForm textarea{width:100%;border:1px solid #d7e1de;border-radius:13px;padding:12px 13px;font:inherit;color:#17233c;background:#fcfefd;box-sizing:border-box}.authForm input:focus,.authForm textarea:focus{outline:3px solid rgba(10,124,102,.12);border-color:#69ad9f}.authForm button{border:0;border-radius:14px;padding:13px;background:#0a7c66;color:#fff;font-weight:900}.authError{min-height:16px;color:#b33c42;font-size:11px}.authLegal{font-size:10px;color:#7b8797;line-height:1.45}.securityCard{margin-top:12px}.securityCard form{display:grid;gap:9px}.securityCard input{border:1px solid #d9e2df;border-radius:12px;padding:10px}.securityActions{display:grid;grid-template-columns:1fr 1fr;gap:8px}.securityActions button{border:0;border-radius:12px;padding:10px;font-weight:800}.securityActions .saveSecurity{background:#0a7c66;color:#fff}.securityActions .logoutSecurity{background:#f4ecec;color:#983a3e}.merchantMigrationNotice{background:linear-gradient(135deg,#17233c,#0a7c66);color:white;border-radius:26px;padding:22px;box-shadow:0 14px 35px rgba(23,35,60,.18)}.merchantMigrationNotice h2{margin:0 0 8px;font-size:22px}.merchantMigrationNotice p{margin:0;color:#dcebea;font-size:13px;line-height:1.5}
@media(min-width:650px){.authModalBackdrop{place-items:center}.authModal{border-radius:28px;padding:20px;max-height:88dvh}.authModalHandle{display:none}}
`;
document.head.appendChild(authStyle);

let mode = 'login';
let currentProfile = null;
let referralSignupStartedSent = false;
const REFERRAL_CODE_RE = /^r1_[A-Za-z0-9_-]{16}$/;
const REFERRAL_ROLES = new Set(['customer','merchant','supplier','courier','service_provider']);

function referralSignupContext(){
  const params=new URLSearchParams(location.search);
  const referralCode=params.get('ref')||'';
  const sourceProfileRole=params.get('profile')||'';
  if(!REFERRAL_CODE_RE.test(referralCode)||!REFERRAL_ROLES.has(sourceProfileRole))return null;
  return {
    referralCode,
    properties:{
      campaign:sourceProfileRole+'_referral_v1',
      source:'profile',
      source_profile_role:sourceProfileRole
    }
  };
}
async function trackReferralSignupStarted(){
  if(referralSignupStartedSent)return true;
  const context=referralSignupContext();
  if(!context)return true;
  const tracked=await captureReferralEvent({event:'referral_signup_started',...context});
  if(tracked)referralSignupStartedSent=true;
  return tracked;
}
function referralRegistrationContext(){
  const context=referralSignupContext();
  if(!context)return null;
  return {
    referral_code:context.referralCode,
    source_profile_role:context.properties.source_profile_role,
    correlation_id:referralCorrelationId()
  };
}

function authToken(){return localStorage.getItem('abl_token') || ''}
async function authFetch(path, options={}){
  const headers={'Content-Type':'application/json',...(options.headers||{})}; const t=authToken(); if(t)headers.Authorization=`Bearer ${t}`;
  const r=await fetch(path,{...options,headers}); const body=await r.json().catch(()=>({})); if(!r.ok)throw new Error(body.error||`Request failed (${r.status})`);return body;
}
function ensureAuthChoices(){
  const login=document.getElementById('login'); const form=document.getElementById('loginForm'); if(!login||!form||document.getElementById('accountAuthChoices'))return;
  const box=document.createElement('div');box.id='accountAuthChoices';box.className='accountAuthChoices';box.innerHTML=`<div class="accountAuthDivider"><span>or use your personal account</span></div><button id="emailLoginBtn" class="accountAuthBtn" type="button">Sign in with email</button><button id="createAccountBtn" class="accountAuthBtn primaryAlt" type="button">Create account</button><div class="accountAuthHint">One account can later use Customer, Merchant, Supplier, Delivery and Local Services profiles.</div>`;form.insertAdjacentElement('afterend',box);box.querySelector('#emailLoginBtn').onclick=()=>openAuth('login');box.querySelector('#createAccountBtn').onclick=()=>openAuth('register');
}
function ensureModal(){
  if(document.getElementById('authModalBackdrop'))return;
  const backdrop=document.createElement('div');backdrop.id='authModalBackdrop';backdrop.className='authModalBackdrop hidden';backdrop.innerHTML=`<section class="authModal" role="dialog" aria-modal="true"><div class="authModalHandle"></div><div class="authModalHeader"><div><h2 id="authTitle">Your account</h2><p>Business & Life — Philippines Edition</p></div><button id="authClose" class="authModalClose" type="button" aria-label="Close">×</button></div><div class="authTabs"><button id="authTabLogin" class="authTab" type="button">Sign in</button><button id="authTabRegister" class="authTab" type="button">Create account</button></div><div id="authFormHost"></div></section>`;document.body.appendChild(backdrop);backdrop.onclick=e=>{if(e.target===backdrop)closeAuth()};backdrop.querySelector('#authClose').onclick=closeAuth;backdrop.querySelector('#authTabLogin').onclick=()=>renderAuth('login');backdrop.querySelector('#authTabRegister').onclick=()=>renderAuth('register');
}
function openAuth(nextMode){ensureModal();renderAuth(nextMode);document.getElementById('authModalBackdrop').classList.remove('hidden');document.body.style.overflow='hidden'}
function closeAuth(){document.getElementById('authModalBackdrop')?.classList.add('hidden');document.body.style.overflow=''}
function renderAuth(nextMode){
  mode=nextMode;document.getElementById('authTabLogin')?.classList.toggle('active',mode==='login');document.getElementById('authTabRegister')?.classList.toggle('active',mode==='register');document.getElementById('authTitle').textContent=mode==='login'?'Welcome back':'Create your account';const host=document.getElementById('authFormHost');if(!host)return;
  host.innerHTML=mode==='login'?`<form id="accountAuthForm" class="authForm"><label>Email<input id="authEmail" type="email" autocomplete="email" required></label><label>Password<input id="authPassword" type="password" autocomplete="current-password" required></label><button>Sign in</button><div id="authError" class="authError"></div></form>`:`<form id="accountAuthForm" class="authForm"><label>Name<input id="authName" autocomplete="name" required></label><label>Email<input id="authEmail" type="email" autocomplete="email" required></label><label>Phone (optional)<input id="authPhone" inputmode="tel" autocomplete="tel"></label><label>Primary address (complete before profile activation)<textarea id="authAddress" rows="2" autocomplete="street-address"></textarea></label><label>Password<input id="authPassword" type="password" autocomplete="new-password" minlength="8" required></label><button>Create person account</button><div class="authLegal">No operational profile is activated automatically. Start each profile separately from Account Settings.</div><div id="authError" class="authError"></div></form>`;
  host.querySelector('#accountAuthForm').onsubmit=submitAuth;
}
async function submitAuth(e){e.preventDefault();const err=document.getElementById('authError');err.textContent='';const email=document.getElementById('authEmail').value;const password=document.getElementById('authPassword').value;if(mode==='register')await trackReferralSignupStarted();try{const referralConversion=mode==='register'?referralRegistrationContext():null;const payload=mode==='login'?{email,password}:{display_name:document.getElementById('authName').value,email,password,phone:document.getElementById('authPhone').value,address:document.getElementById('authAddress').value,...(referralConversion?{referral_conversion:referralConversion}:{})};const result=await authFetch(mode==='login'?'/api/auth/login':'/api/auth/register',{method:'POST',body:JSON.stringify(payload)});localStorage.setItem('abl_token',result.token);localStorage.setItem('abl_active_role',result.profile?.account?.active_role||'customer');location.reload()}catch(ex){err.textContent=ex.message}}

async function logoutAccount(){try{await authFetch('/api/auth/logout',{method:'POST',body:'{}'})}catch{}localStorage.removeItem('abl_token');localStorage.removeItem('abl_active_role');location.reload()}
async function updatePassword(form){const message=form.querySelector('.securityMessage');message.textContent='';try{await authFetch('/api/auth/password',{method:'POST',body:JSON.stringify({current_password:form.querySelector('[name=current_password]')?.value||'',new_password:form.querySelector('[name=new_password]').value})});message.textContent='Password saved.';await loadProfile();decorateDrawer()}catch(e){message.textContent=e.message}}
function decorateDrawer(){
  const panel=document.getElementById('profileDrawerPanel');if(!panel||!currentProfile||panel.querySelector('.drawerContextLoading')||!panel.querySelector('#accountIdentityForm')||panel.querySelector('.securityCard'))return;
  const section=document.createElement('section');section.className='drawerSection securityCard';section.innerHTML=`<h3>Security & session</h3><form id="securityForm">${currentProfile.account.has_password?'<label>Current password<input name="current_password" type="password" autocomplete="current-password"></label>':''}<label>${currentProfile.account.has_password?'New password':'Set an email-account password'}<input name="new_password" type="password" minlength="8" autocomplete="new-password" required></label><div class="securityMessage avatarHint"></div><div class="securityActions"><button class="saveSecurity" type="submit">Save password</button><button class="logoutSecurity" type="button">Sign out</button></div></form>`;panel.appendChild(section);section.querySelector('#securityForm').onsubmit=e=>{e.preventDefault();updatePassword(e.currentTarget)};section.querySelector('.logoutSecurity').onclick=logoutAccount;
}
async function loadProfile(){if(!authToken())return null;try{currentProfile=await authFetch('/api/me');return currentProfile}catch{return null}}
function guardNonOwnerMerchant(){
  if(!currentProfile||Number(currentProfile.account.id)===1||currentProfile.account.active_role!=='merchant')return;
  document.querySelectorAll('#shell > .view').forEach(v=>v.classList.add('hidden'));document.querySelector('.bottomNav')?.classList.add('hidden');const hub=document.getElementById('roleHub');if(!hub)return;hub.innerHTML=`<div class="merchantMigrationNotice"><h2>Your Merchant profile is ready for setup.</h2><p>Your store identity can be created now. The legacy single-business accounting ledger stays isolated until the multi-business workspace migration is complete, so another merchant can never see the original merchant's finances.</p></div>`;hub.classList.remove('hidden');
}
function observeDrawer(){const panel=document.getElementById('profileDrawerPanel');if(!panel)return setTimeout(observeDrawer,100);new MutationObserver(()=>decorateDrawer()).observe(panel,{childList:true,subtree:false})}
async function boot(){ensureAuthChoices();ensureModal();observeDrawer();if(authToken()){await loadProfile();decorateDrawer();setTimeout(guardNonOwnerMerchant,150);const shell=document.getElementById('shell');if(shell)new MutationObserver(()=>setTimeout(guardNonOwnerMerchant,30)).observe(shell,{attributes:true,attributeFilter:['class']});}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
document.addEventListener('abl:account-settings-rendered',decorateDrawer,{passive:true});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeAuth()});
