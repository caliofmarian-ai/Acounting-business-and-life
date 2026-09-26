const ABL_AUTH_TOKEN='abl_token';
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
function token(){return localStorage.getItem(ABL_AUTH_TOKEN)||''}
function isV2(){const t=token();return t.startsWith('v2.')&&t.split('.').length===5}
async function api(path,options={}){const headers={'Content-Type':'application/json',...(options.headers||{})};if(token())headers.Authorization=`Bearer ${token()}`;const r=await fetch(path,{...options,headers});const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error||`Request failed (${r.status})`);return b}
function clearQuery(){history.replaceState({},'',location.pathname)}
function msg(text,kind=''){const el=document.getElementById('modernAuthMessage');if(el){el.textContent=text||'';el.className=`modernAuthMessage ${kind}`}}
let status={google_enabled:false,email_delivery_configured:false,preview_link_enabled:false,qa_preview_context:{enabled:false}};

let modernGeoSearchTimer=null;
function bindModernBarangayPicker(){
  const input=document.getElementById('regBarangaySearch'),hidden=document.getElementById('regHomePsgcCode'),results=document.getElementById('regBarangayResults'),state=document.getElementById('regBarangayStatus');
  if(!input||!hidden||!results||!state)return;
  input.addEventListener('input',()=>{
    hidden.value='';state.textContent='Choose an official barangay from the results.';state.className='modernGeoStatus';
    clearTimeout(modernGeoSearchTimer);
    const query=input.value.trim();if(query.length<2){results.innerHTML='';return}
    modernGeoSearchTimer=setTimeout(async()=>{
      results.innerHTML='<div class="modernGeoStatus">Searching official PSGC…</div>';
      try{
        const data=await api('/api/auth/geography/search?q='+encodeURIComponent(query)+'&limit=20');
        const items=data.items||[];
        results.innerHTML=items.length?items.map(x=>'<button type="button" class="modernGeoResult" data-geo="'+esc(x.psgc_code)+'"><strong>'+esc(x.name)+'</strong><small>'+esc(x.path_text)+' · PSGC '+esc(x.psgc_code)+'</small></button>').join(''):'<div class="modernGeoStatus warn">No official barangay matched. Search by barangay or city name.</div>';
        results.querySelectorAll('[data-geo]').forEach(button=>button.onclick=async()=>{
          hidden.value=button.dataset.geo;input.value=button.querySelector('strong')?.textContent||'';results.innerHTML='';
          try{
            const availability=await api('/api/auth/geography/status?psgc_code='+encodeURIComponent(hidden.value));
            state.textContent=availability.message||'Official barangay selected.';
            state.className='modernGeoStatus '+(availability.operational_onboarding_available?'ok':'warn');
          }catch(error){state.textContent=error.message;state.className='modernGeoStatus warn'}
        });
      }catch(error){results.innerHTML='<div class="modernGeoStatus warn">'+esc(error.message)+'</div>'}
    },250);
  });
}


function panel(){
  const root=document.getElementById('modernAuthRoot');if(!root)return;
  root.innerHTML=`<section class="modernAuthCard"><div class="modernAuthBrandRow"><span class="modernAuthLogo">B&L</span><div><strong>Business & Life</strong><small>Philippines Edition</small></div></div><div class="modernAuthTabs"><button data-auth-mode="login" class="active">Sign in</button><button data-auth-mode="register">Create account</button></div><div id="modernAuthBody"></div><div id="modernAuthMessage" class="modernAuthMessage"></div></section>`;
  root.querySelectorAll('[data-auth-mode]').forEach(b=>b.onclick=()=>render(b.dataset.authMode));
  render('login');
}
function setTab(mode){document.querySelectorAll('[data-auth-mode]').forEach(b=>b.classList.toggle('active',b.dataset.authMode===mode))}
function googleButton(){return status.google_enabled?`<a class="googleAuthBtn" href="/api/auth/google/start"><span>G</span> Continue with Google</a>`:''}
function qaPreviewBanner(){const qa=status.qa_preview_context;if(!qa?.enabled)return'';return '<div class="modernQaContext"><strong>🧪 '+esc(qa.label||'QA test context')+'</strong><span>Testing country: Philippines. Your physical device location is not used as the Business & Life test territory. Choose the official PH barangay you want to test.</span></div>'}
function render(mode){
  const body=document.getElementById('modernAuthBody');if(!body)return;setTab(mode);msg('');
  if(mode==='login')body.innerHTML=qaPreviewBanner()+`<form id="modernLogin" class="modernAuthForm"><label>Email<input id="modernEmail" type="email" autocomplete="email" required></label><label>Password<input id="modernPassword" type="password" autocomplete="current-password" required></label><button class="modernPrimary">Sign in</button><button id="forgotBtn" class="modernLinkBtn" type="button">Forgot password?</button></form>${googleButton()}`;
  else body.innerHTML=qaPreviewBanner()+`<form id="modernRegister" class="modernAuthForm"><label>Name<input id="regName" autocomplete="name" required></label><label>Email<input id="regEmail" type="email" autocomplete="email" required></label><label>Password<input id="regPassword" type="password" minlength="8" autocomplete="new-password" required></label><label>Phone <span>optional</span><input id="regPhone" inputmode="tel" autocomplete="tel"></label><label>Primary address <span>private</span><textarea id="regAddress" rows="2" autocomplete="street-address"></textarea></label><div class="modernGeoPicker"><label>Your barangay <span>official PSGC</span><input id="regBarangaySearch" autocomplete="off" placeholder="Queens Row West, Bacoor…"></label><input id="regHomePsgcCode" type="hidden"><div id="regBarangayResults" class="modernGeoResults"></div><div id="regBarangayStatus" class="modernGeoStatus">Choose the official barangay where you live. This sets your Business & Life area without publishing your street address.</div></div><button class="modernPrimary">Create person account</button><small class="modernFine">No operational profile is activated automatically. Your barangay determines which Business & Life area can onboard you.</small></form>${googleButton()}`;
  if(mode==='login'){document.getElementById('modernLogin').onsubmit=login;document.getElementById('forgotBtn').onclick=()=>renderForgot()}
  else{document.getElementById('modernRegister').onsubmit=register;bindModernBarangayPicker()}
}
async function login(e){e.preventDefault();msg('Signing in…');try{const r=await api('/api/auth/login',{method:'POST',body:JSON.stringify({email:document.getElementById('modernEmail').value,password:document.getElementById('modernPassword').value})});localStorage.setItem(ABL_AUTH_TOKEN,r.token);location.reload()}catch(e){msg(e.message,'error')}}
async function register(e){e.preventDefault();msg('Creating account…');try{const r=await api('/api/auth/register',{method:'POST',body:JSON.stringify({display_name:document.getElementById('regName').value,email:document.getElementById('regEmail').value,password:document.getElementById('regPassword').value,phone:document.getElementById('regPhone').value,address:document.getElementById('regAddress').value,home_psgc_code:document.getElementById('regHomePsgcCode').value})});localStorage.setItem(ABL_AUTH_TOKEN,r.token);const v=await api('/api/auth/email-verification/request',{method:'POST',body:'{}'}).catch(()=>null);if(v?.preview_verify_url){document.getElementById('modernAuthBody').innerHTML=`<div class="modernSuccess"><h2>Account created</h2><p>For this preview you can open the verification link directly.</p><a href="${esc(v.preview_verify_url)}">Verify email</a><button id="continueApp" class="modernPrimary">Continue to app</button></div>`;document.getElementById('continueApp').onclick=()=>location.reload()}else location.reload()}catch(e){msg(e.message,'error')}}
function renderForgot(){const body=document.getElementById('modernAuthBody');setTab('none');body.innerHTML=`<div class="modernBackRow"><button id="backLogin" class="modernBack">‹</button><div><h2>Reset password</h2><p>Enter the email used for your account.</p></div></div><form id="forgotForm" class="modernAuthForm"><label>Email<input id="forgotEmail" type="email" autocomplete="email" required></label><button class="modernPrimary">Send reset instructions</button></form>`;document.getElementById('backLogin').onclick=()=>render('login');document.getElementById('forgotForm').onsubmit=async e=>{e.preventDefault();msg('Preparing reset…');try{const r=await api('/api/auth/forgot-password',{method:'POST',body:JSON.stringify({email:document.getElementById('forgotEmail').value})});if(r.preview_reset_url){body.innerHTML=`<div class="modernSuccess"><h2>Reset prepared</h2><p>${esc(r.message)}</p><a href="${esc(r.preview_reset_url)}">Open preview reset link</a></div>`}else{body.innerHTML=`<div class="modernSuccess"><h2>Check your email</h2><p>${esc(r.message)}</p></div>`}msg('')}catch(e){msg(e.message,'error')}}}
function renderReset(raw){const root=document.getElementById('modernAuthRoot');if(!root)return;root.innerHTML=`<section class="modernAuthCard"><div class="modernBackRow"><div><h2>Choose a new password</h2><p>This link can be used once.</p></div></div><form id="resetForm" class="modernAuthForm"><label>New password<input id="resetPassword" type="password" minlength="8" autocomplete="new-password" required></label><label>Confirm password<input id="resetConfirm" type="password" minlength="8" autocomplete="new-password" required></label><button class="modernPrimary">Reset password</button></form><div id="modernAuthMessage" class="modernAuthMessage"></div></section>`;document.getElementById('resetForm').onsubmit=async e=>{e.preventDefault();const p=document.getElementById('resetPassword').value;if(p!==document.getElementById('resetConfirm').value)return msg('Passwords do not match','error');msg('Resetting…');try{await api('/api/auth/reset-password',{method:'POST',body:JSON.stringify({token:raw,new_password:p})});clearQuery();document.getElementById('modernAuthRoot').innerHTML=`<section class="modernAuthCard"><div class="modernSuccess"><h2>Password updated</h2><p>All previous sessions were revoked. Sign in again with your new password.</p><button id="backAfterReset" class="modernPrimary">Sign in</button></div></section>`;document.getElementById('backAfterReset').onclick=()=>location.reload()}catch(e){msg(e.message,'error')}}}
function renderVerificationResult(state){
  const root=document.getElementById('modernAuthRoot');if(!root)return;
  const different=state==='different_account',same=state==='same_account';
  const explanation=different
    ?'The email address from this verification link is now verified. This browser is still signed in to another account. For your security, Business & Life did not switch accounts automatically.'
    :same
      ?'The email address for the account currently signed in on this device is now verified.'
      :'The email address from this verification link is now verified. Sign in with that email to continue.';
  root.innerHTML=`<section class="modernAuthCard"><div class="modernSuccess"><h2>Email verified</h2><p>${explanation}</p>${different?'<button id="verificationKeepSession" class="modernPrimary">Keep current account</button><button id="verificationSignIn" class="modernLinkBtn">Sign out and sign in to verified account</button>':same?'<button id="verificationContinue" class="modernPrimary">Continue to account</button>':'<button id="verificationSignIn" class="modernPrimary">Sign in</button>'}</div></section>`;
  document.getElementById('verificationContinue')?.addEventListener('click',()=>location.reload());
  document.getElementById('verificationKeepSession')?.addEventListener('click',()=>location.reload());
  document.getElementById('verificationSignIn')?.addEventListener('click',()=>{localStorage.removeItem(ABL_AUTH_TOKEN);location.reload()});
}
async function verifyFromUrl(raw){try{const r=await api('/api/auth/email-verification/verify',{method:'POST',body:JSON.stringify({token:raw})});clearQuery();renderVerificationResult(r.verification_session)}catch(e){clearQuery();sessionStorage.setItem('abl_flash',e.message);location.reload()}}
async function oauthHandoff(raw){try{const r=await api('/api/auth/oauth/handoff',{method:'POST',body:JSON.stringify({code:raw})});localStorage.setItem(ABL_AUTH_TOKEN,r.token);clearQuery();location.reload()}catch(e){clearQuery();sessionStorage.setItem('abl_flash',e.message);location.reload()}}
async function decorateSecurity(){
  if(!isV2())return;
  const panel=document.getElementById('accountSecurityMount');
  if(!panel)return;
  const account=window.BusinessLifeProfileState?.snapshot?.account;
  if(!account)return;
  const existing=[...panel.querySelectorAll('.authUpgradeCard')];
  if(existing.length){existing.slice(1).forEach(x=>x.remove());return}
  if(panel.dataset.authSecurityDecorating==='1')return;
  panel.dataset.authSecurityDecorating='1';
  try{
    const [ids,stepUp]=await Promise.all([
      api('/api/auth/identities'),
      api('/api/auth/step-up/status').catch(()=>({verified:false,valid_for_minutes:10}))
    ]);
    if(!document.body.contains(panel))return;
    const raced=[...panel.querySelectorAll('.authUpgradeCard')];
    if(raced.length){raced.slice(1).forEach(x=>x.remove());return}
    const googleLinked=ids.some(x=>x.provider==='google');
    const section=document.createElement('section');
    section.className='accountSettingsCard authUpgradeCard';
    const deliveryNote=!account.email_verified_at&&!status.email_delivery_configured
      ?'<div class="avatarHint authDeliveryWarning">Email delivery is not configured in this environment. A preview may offer a direct verification link.</div>'
      :'';
    const stepUpMinutes=Number(stepUp?.valid_for_minutes||10);
    const stepUpMarkup=stepUp?.verified
      ?'<div class="authSecurityLine"><span>Recent identity confirmation</span><strong>Active · up to '+stepUpMinutes+' min</strong></div>'
      :account.has_password
        ?'<form id="stepUpSecurityForm" class="authStepUpForm"><label>Confirm current password<input id="stepUpSecurityPassword" type="password" autocomplete="current-password" maxlength="160" required></label><button type="submit">Confirm identity for sensitive actions</button><div id="stepUpSecurityMsg" class="avatarHint">This confirmation is session-specific and expires automatically.</div></form>'
        :'<div class="avatarHint authStepUpNotice">Sensitive actions require recent identity confirmation. Sign out and sign back in with Google to refresh this session.</div>';
    section.innerHTML=`<h2>Account protection</h2><div class="authSecurityLine"><span>Email</span><strong>${account.email_verified_at?'Verified':'Not verified'}</strong></div>${!account.email_verified_at?'<button id="sendVerify" type="button">Verify email</button>':''}${deliveryNote}${status.google_enabled&&!googleLinked?'<a class="authDrawerLink" href="/api/auth/google/link/start">Link Google account</a>':status.google_enabled?'<div class="authSecurityLine"><span>Google</span><strong>Linked</strong></div>':''}<h3 class="authStepUpTitle">Sensitive-action confirmation</h3>${stepUpMarkup}<button id="revokeOthers" type="button" class="dangerLite">Sign out other devices</button><div id="authDrawerMsg" class="avatarHint"></div>`;
    panel.appendChild(section);
    section.querySelector('#sendVerify')?.addEventListener('click',async()=>{
      const out=section.querySelector('#authDrawerMsg');out.textContent='Preparing verification…';
      try{
        const r=await api('/api/auth/email-verification/request',{method:'POST',body:'{}'});
        if(r.delivery_status==='sent')out.textContent='Verification email sent. Check your inbox and spam folder.';
        else if(r.preview_verify_url)out.innerHTML=`Email sending is unavailable in this preview. <a href="${esc(r.preview_verify_url)}">Verify directly here</a>.`;
        else if(r.delivery_status==='not_configured')out.textContent='Email delivery is not configured yet. Your verification request was not emailed.';
        else out.textContent='Verification email could not be delivered. Please try again later.';
      }catch(e){out.textContent=e.message}
    });
    section.querySelector('#stepUpSecurityForm')?.addEventListener('submit',async e=>{
      e.preventDefault();
      const input=section.querySelector('#stepUpSecurityPassword'),out=section.querySelector('#stepUpSecurityMsg');
      if(!input||!out)return;
      const password=input.value;
      input.value='';
      out.textContent='Confirming identity…';
      try{
        await api('/api/auth/step-up/password',{method:'POST',body:JSON.stringify({password})});
        out.textContent='Identity confirmed. Sensitive actions are available for a short period on this session.';
        section.remove();
        await decorateSecurity();
      }catch(error){
        input.value='';
        out.textContent=error.message;
      }
    });
    section.querySelector('#revokeOthers').onclick=async()=>{const out=section.querySelector('#authDrawerMsg');try{await api('/api/auth/sessions/revoke-others',{method:'POST',body:'{}'});out.textContent='Other sessions signed out.'}catch(e){out.textContent=e.message}};
  }catch{}finally{delete panel.dataset.authSecurityDecorating}
}

function watchDrawer(){document.addEventListener('abl:account-settings-rendered',event=>{if(event.detail?.view==='security')decorateSecurity().catch(()=>{})})}
async function boot(){
  if(token()&&!isV2())localStorage.removeItem(ABL_AUTH_TOKEN);
  const params=new URLSearchParams(location.search);
  if(params.get('verify_token'))return verifyFromUrl(params.get('verify_token'));
  if(params.get('oauth_handoff'))return oauthHandoff(params.get('oauth_handoff'));
  const root=document.getElementById('modernAuthRoot');
  if(params.get('reset_token'))return renderReset(params.get('reset_token'));
  // Render immediately. Network/config discovery must never leave the entry screen blank.
  if(root)panel();
  fetch('/api/auth/hardening/status').then(r=>r.ok?r.json():status).then(next=>{
    status=next||status;
    if(!root||document.activeElement?.closest?.('#modernAuthRoot'))return;
    const active=root.querySelector('[data-auth-mode].active')?.dataset.authMode||'login';
    if(active==='login'||active==='register')render(active);
  }).catch(()=>{});
  if(params.get('oauth_error')){const map={existing_email:'That email already has a Business & Life account. Sign in with your password, then link Google from Account protection.',google_failed:'Google sign-in could not be completed.'};setTimeout(()=>msg(map[params.get('oauth_error')]||'Google sign-in failed.','error'),30);clearQuery()}
  const flash=sessionStorage.getItem('abl_flash');if(flash){sessionStorage.removeItem('abl_flash');setTimeout(()=>{const t=document.getElementById('roleToast');if(t){t.textContent=flash;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3500)}},500)}
  watchDrawer();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
