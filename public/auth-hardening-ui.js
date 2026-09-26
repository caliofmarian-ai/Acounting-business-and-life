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
  const renderItems=items=>{
    results.innerHTML=items.length?items.map(x=>'<button type="button" class="modernGeoResult" data-geo="'+esc(x.psgc_code)+'"><strong>'+esc(x.name)+'</strong><small>'+esc(x.path_text)+' · PSGC '+esc(x.psgc_code)+(x.operating_status?' · '+esc(String(x.operating_status).replaceAll('_',' ')):'')+'</small></button>').join(''):'<div class="modernGeoStatus warn">No official barangay matched. Search by barangay or city name.</div>';
    results.querySelectorAll('[data-geo]').forEach(button=>button.onclick=async()=>{
      hidden.value=button.dataset.geo;input.value=button.querySelector('strong')?.textContent||'';results.innerHTML='';
      try{
        const availability=await api('/api/auth/geography/status?psgc_code='+encodeURIComponent(hidden.value));
        state.textContent=availability.message||'Official barangay selected.';
        state.className='modernGeoStatus '+(availability.operational_onboarding_available?'ok':'warn');
      }catch(error){state.textContent=error.message;state.className='modernGeoStatus warn'}
    });
  };
  const load=async(query='')=>{
    results.innerHTML='<div class="modernGeoStatus">'+'Searching official PSGC…'+'</div>';
    try{
      const data=await api('/api/auth/geography/search?q='+encodeURIComponent(query)+'&limit=15');
      renderItems(data.items||[]);
    }catch(error){results.innerHTML='<div class="modernGeoStatus warn">'+esc(error.message)+'</div>'}
  };
    input.addEventListener('input',()=>{
    hidden.value='';state.textContent='Choose an official barangay from the results.';state.className='modernGeoStatus';
    clearTimeout(modernGeoSearchTimer);
    const query=input.value.trim();
    if(query.length===0){results.innerHTML='';return}
    if(query.length<2){results.innerHTML='';return}
    modernGeoSearchTimer=setTimeout(()=>load(query),250);
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
function qaPreviewBanner(){const qa=status.qa_preview_context;if(!qa?.enabled)return'';return '<div class="modernQaContext"><strong>🧪 '+esc(qa.label||'QA test context')+'</strong><span>Standard location rules remain active. A remote Philippines test override is available only to the designated QA test account; all other accounts follow normal location controls.</span></div>'}
function render(mode){
  const body=document.getElementById('modernAuthBody');if(!body)return;setTab(mode);msg('');
  if(mode==='login')body.innerHTML=qaPreviewBanner()+`<form id="modernLogin" class="modernAuthForm"><label>Email<input id="modernEmail" type="email" autocomplete="email" required></label><label>Password<input id="modernPassword" type="password" autocomplete="current-password" required></label><button class="modernPrimary">Sign in</button><button id="forgotBtn" class="modernLinkBtn" type="button">Forgot password?</button></form>${googleButton()}`;
  else body.innerHTML=qaPreviewBanner()+`<form id="modernRegister" class="modernAuthForm"><label>Name<input id="regName" autocomplete="name" required></label><label>Email<input id="regEmail" type="email" autocomplete="email" required></label><label>Password<input id="regPassword" type="password" minlength="8" autocomplete="new-password" required></label><label>Phone <span>optional</span><input id="regPhone" inputmode="tel" autocomplete="tel"></label><label>Primary address <span>private</span><textarea id="regAddress" rows="2" autocomplete="street-address"></textarea></label><div class="modernGeoPicker"><label>Your barangay <span>official PSGC</span><input id="regBarangaySearch" autocomplete="off" placeholder="Queens Row West, Bacoor…"></label><input id="regHomePsgcCode" type="hidden"><div id="regBarangayResults" class="modernGeoResults"></div><div id="regBarangayStatus" class="modernGeoStatus">Choose the official barangay where you live. This sets your Business & Life area without publishing your street address.</div></div>${status.qa_preview_context?.remote_override_configured?'<label class="modernQaRemoteToggle"><input id="regQaRemoteTest" type="checkbox"> Use the designated remote PH QA test override for this account</label>':''}<button class="modernPrimary">Create person account</button><small class="modernFine">No operational profile is activated automatically. Your barangay determines which Business & Life area can onboard you.</small></form>${googleButton()}`;
  if(mode==='login'){document.getElementById('modernLogin').onsubmit=login;document.getElementById('forgotBtn').onclick=()=>renderForgot()}
  else{document.getElementById('modernRegister').onsubmit=register;bindModernBarangayPicker()}
}
async function login(e){e.preventDefault();msg('Signing in…');try{const r=await api('/api/auth/login',{method:'POST',body:JSON.stringify({email:document.getElementById('modernEmail').value,password:document.getElementById('modernPassword').value})});localStorage.setItem(ABL_AUTH_TOKEN,r.token);location.reload()}catch(e){msg(e.message,'error')}}
async function register(e){e.preventDefault();msg('Creating account…');try{const r=await api('/api/auth/register',{method:'POST',body:JSON.stringify({display_name:document.getElementById('regName').value,email:document.getElementById('regEmail').value,password:document.getElementById('regPassword').value,phone:document.getElementById('regPhone').value,address:document.getElementById('regAddress').value,home_psgc_code:document.getElementById('regHomePsgcCode').value,qa_remote_test:Boolean(document.getElementById('regQaRemoteTest')?.checked)})});localStorage.setItem(ABL_AUTH_TOKEN,r.token);const v=await api('/api/auth/email-verification/request',{method:'POST',body:'{}'}).catch(()=>null);if(v?.preview_verify_url){document.getElementById('modernAuthBody').innerHTML=`<div class="modernSuccess"><h2>Account created</h2><p>For this preview you can open the verification link directly.</p><a href="${esc(v.preview_verify_url)}">Verify email</a><button id="continueApp" class="modernPrimary">Continue to app</button></div>`;document.getElementById('continueApp').onclick=()=>location.reload()}else location.reload()}catch(e){msg(e.message,'error')}}
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
function ensureSecurityDialog(){
  let backdrop=document.getElementById('authSecurityDialogBackdrop');
  if(backdrop)return backdrop;
  backdrop=document.createElement('div');
  backdrop.id='authSecurityDialogBackdrop';
  backdrop.className='authSecurityDialogBackdrop hidden';
  backdrop.innerHTML='<section class="authSecurityDialog" role="dialog" aria-modal="true" aria-labelledby="authSecurityDialogTitle"><div id="authSecurityDialogBody"></div></section>';
  document.body.appendChild(backdrop);
  backdrop.addEventListener('click',event=>{if(event.target===backdrop)closeSecurityDialog()});
  return backdrop;
}
function closeSecurityDialog(){
  const backdrop=document.getElementById('authSecurityDialogBackdrop');
  backdrop?.classList.add('hidden');
  document.body.style.overflow='';
}
function openSecurityDialog(markup){
  const backdrop=ensureSecurityDialog(),body=backdrop.querySelector('#authSecurityDialogBody');
  body.innerHTML=markup;
  backdrop.classList.remove('hidden');
  document.body.style.overflow='hidden';
  body.querySelector('[data-auth-dialog-close]')?.addEventListener('click',closeSecurityDialog);
  requestAnimationFrame(()=>body.querySelector('input:not([readonly]),button')?.focus?.());
  return body;
}
async function openPasswordDialog(account){
  const hasPassword=Boolean(account.has_password);
  const body=openSecurityDialog(
    '<div class="authDialogHeader"><div><small>PASSWORD</small><h2 id="authSecurityDialogTitle">'+(hasPassword?'Change password':'Set password')+'</h2><p>'+(hasPassword?'Enter your current password, then choose a new one.':'Create a local password for this account. Recent identity confirmation is required.')+'</p></div><button type="button" data-auth-dialog-close aria-label="Close">×</button></div>'+
    '<form id="authPasswordForm" class="modernAuthForm">'+
      (hasPassword?'<label>Current password<input id="authCurrentPassword" type="password" autocomplete="current-password" maxlength="160" required></label>':'')+
      '<label>New password<input id="authNewPassword" type="password" autocomplete="new-password" minlength="8" maxlength="160" required></label>'+
      '<label>Confirm new password<input id="authConfirmPassword" type="password" autocomplete="new-password" minlength="8" maxlength="160" required></label>'+
      '<div id="authPasswordDialogMsg" class="modernAuthMessage"></div>'+
      '<div class="authDialogActions"><button type="button" class="modernLinkBtn" data-auth-dialog-close>Cancel</button><button type="submit" class="modernPrimary">'+(hasPassword?'Save new password':'Set password')+'</button></div>'+
    '</form>'
  );
  body.querySelectorAll('[data-auth-dialog-close]').forEach(button=>button.addEventListener('click',closeSecurityDialog));
  body.querySelector('#authPasswordForm').onsubmit=async event=>{
    event.preventDefault();
    const current=body.querySelector('#authCurrentPassword')?.value||'';
    const next=body.querySelector('#authNewPassword').value;
    const confirm=body.querySelector('#authConfirmPassword').value;
    const out=body.querySelector('#authPasswordDialogMsg'),submit=body.querySelector('button[type="submit"]');
    if(next.length<8){out.textContent='Password must be at least 8 characters.';out.className='modernAuthMessage error';return}
    if(next!==confirm){out.textContent='Passwords do not match.';out.className='modernAuthMessage error';return}
    submit.disabled=true;out.textContent=hasPassword?'Changing password…':'Setting password…';out.className='modernAuthMessage';
    try{
      await api('/api/auth/password',{method:'POST',body:JSON.stringify({current_password:current,new_password:next})});
      closeSecurityDialog();
      await window.BusinessLifeShell?.refreshProfile?.();
      const panel=document.getElementById('accountSecurityMount');if(panel){delete panel.dataset.authSecurityReady;panel.innerHTML=''}
      await decorateSecurity();
      const toast=document.getElementById('roleToast');if(toast){toast.textContent=hasPassword?'Password changed.':'Password set.';toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),2600)}
    }catch(error){out.textContent=error.message;out.className='modernAuthMessage error';submit.disabled=false}
  };
}
function openPasswordRecoveryDialog(account){
  const body=openSecurityDialog(
    '<div class="authDialogHeader"><div><small>RECOVERY</small><h2 id="authSecurityDialogTitle">Forgot password?</h2><p>Send a one-time reset link to your verified account email.</p></div><button type="button" data-auth-dialog-close aria-label="Close">×</button></div>'+
    '<div class="modernAuthForm"><label>Email<input type="email" value="'+esc(account.email||'')+'" readonly></label><div id="authRecoveryMsg" class="modernAuthMessage"></div><div class="authDialogActions"><button type="button" class="modernLinkBtn" data-auth-dialog-close>Cancel</button><button id="authSendReset" type="button" class="modernPrimary">Send reset instructions</button></div></div>'
  );
  body.querySelectorAll('[data-auth-dialog-close]').forEach(button=>button.addEventListener('click',closeSecurityDialog));
  body.querySelector('#authSendReset').onclick=async()=>{
    const out=body.querySelector('#authRecoveryMsg'),button=body.querySelector('#authSendReset');button.disabled=true;out.textContent='Preparing reset…';
    try{
      const result=await api('/api/auth/forgot-password',{method:'POST',body:JSON.stringify({email:account.email})});
      if(result.preview_reset_url)out.innerHTML=esc(result.message)+' <a href="'+esc(result.preview_reset_url)+'">Open preview reset link</a>';
      else out.textContent=result.message||'If the account is eligible, reset instructions were sent.';
    }catch(error){out.textContent=error.message;out.className='modernAuthMessage error'}finally{button.disabled=false}
  };
}
function openStepUpDialog(account){
  if(!account.has_password){
    const body=openSecurityDialog('<div class="authDialogHeader"><div><small>IDENTITY CONFIRMATION</small><h2 id="authSecurityDialogTitle">Confirm your identity</h2><p>This account does not have a local password. Sign out and sign in again with your linked identity provider to refresh sensitive-action confirmation.</p></div><button type="button" data-auth-dialog-close aria-label="Close">×</button></div><div class="authDialogActions"><button type="button" class="modernLinkBtn" data-auth-dialog-close>Close</button></div>');
    body.querySelectorAll('[data-auth-dialog-close]').forEach(button=>button.addEventListener('click',closeSecurityDialog));
    return;
  }
  const body=openSecurityDialog(
    '<div class="authDialogHeader"><div><small>IDENTITY CONFIRMATION</small><h2 id="authSecurityDialogTitle">Confirm current password</h2><p>This confirmation is session-specific and expires automatically.</p></div><button type="button" data-auth-dialog-close aria-label="Close">×</button></div>'+
    '<form id="authStepUpDialogForm" class="modernAuthForm"><label>Current password<input id="authStepUpDialogPassword" type="password" autocomplete="current-password" maxlength="160" required></label><div id="authStepUpDialogMsg" class="modernAuthMessage"></div><div class="authDialogActions"><button type="button" class="modernLinkBtn" data-auth-dialog-close>Cancel</button><button type="submit" class="modernPrimary">Confirm identity</button></div></form>'
  );
  body.querySelectorAll('[data-auth-dialog-close]').forEach(button=>button.addEventListener('click',closeSecurityDialog));
  body.querySelector('#authStepUpDialogForm').onsubmit=async event=>{
    event.preventDefault();const input=body.querySelector('#authStepUpDialogPassword'),out=body.querySelector('#authStepUpDialogMsg'),submit=body.querySelector('button[type="submit"]');
    submit.disabled=true;out.textContent='Confirming identity…';
    try{
      await api('/api/auth/step-up/password',{method:'POST',body:JSON.stringify({password:input.value})});
      closeSecurityDialog();
      const panel=document.getElementById('accountSecurityMount');if(panel){delete panel.dataset.authSecurityReady;panel.innerHTML=''}
      await decorateSecurity();
    }catch(error){input.value='';out.textContent=error.message;out.className='modernAuthMessage error';submit.disabled=false}
  };
}
async function decorateSecurity(){
  if(!isV2())return;
  const panel=document.getElementById('accountSecurityMount');
  if(!panel||panel.dataset.authSecurityReady==='1')return;
  const account=window.BusinessLifeProfileState?.snapshot?.account;
  if(!account)return;
  if(panel.dataset.authSecurityDecorating==='1')return;
  panel.dataset.authSecurityDecorating='1';
  try{
    const [ids,stepUp]=await Promise.all([
      api('/api/auth/identities'),
      api('/api/auth/step-up/status').catch(()=>({verified:false,valid_for_minutes:10}))
    ]);
    if(!document.body.contains(panel))return;
    const googleLinked=ids.some(x=>x.provider==='google');
    const deliveryNote=!account.email_verified_at&&!status.email_delivery_configured
      ?'<div class="avatarHint authDeliveryWarning">Email delivery is not configured in this environment. A preview may offer a direct verification link.</div>'
      :'';
    panel.innerHTML=
      '<div class="authSecurityStack">'+
        '<section class="accountSettingsCard authUpgradeCard authSecurityCard"><div class="authSecurityCardHead"><div><small>ACCOUNT PROTECTION</small><h2>Email & identity</h2></div><span class="authSecurityState '+(account.email_verified_at?'ok':'warn')+'">'+(account.email_verified_at?'Verified':'Action needed')+'</span></div>'+
          '<div class="authSecurityLine"><span>Email</span><strong>'+esc(account.email||'')+'</strong></div>'+
          '<div class="authSecurityLine"><span>Verification</span><strong>'+(account.email_verified_at?'Verified':'Not verified')+'</strong></div>'+
          (!account.email_verified_at?'<button id="sendVerify" type="button">Verify email</button>':'')+
          deliveryNote+
          (status.google_enabled&&!googleLinked?'<a class="authDrawerLink" href="/api/auth/google/link/start">Link Google account</a>':status.google_enabled?'<div class="authSecurityLine"><span>Google</span><strong>Linked</strong></div>':'')+
        '</section>'+
        '<section class="accountSettingsCard authUpgradeCard authSecurityCard"><div class="authSecurityCardHead"><div><small>PASSWORD</small><h2>Password</h2></div><span class="authSecurityState '+(account.has_password?'ok':'neutral')+'">'+(account.has_password?'Password set':'No password set')+'</span></div>'+
          '<p class="authSecurityCardCopy">'+(account.has_password?'Change your password only when you want to.':'You can add a local password while keeping linked sign-in methods.')+'</p>'+
          '<div class="authSecurityActions"><button id="authChangePassword" type="button">'+(account.has_password?'Change password':'Set password')+'</button>'+(account.has_password?'<button id="authForgotPassword" type="button" class="authSecondaryAction">Forgot password?</button>':'')+'</div>'+
        '</section>'+
        '<section class="accountSettingsCard authUpgradeCard authSecurityCard"><div class="authSecurityCardHead"><div><small>SENSITIVE ACTIONS</small><h2>Identity confirmation</h2></div><span class="authSecurityState '+(stepUp?.verified?'ok':'neutral')+'">'+(stepUp?.verified?'Recently confirmed':'Not recently confirmed')+'</span></div>'+
          '<p class="authSecurityCardCopy">'+(stepUp?.verified?'Sensitive actions are available for up to '+Number(stepUp.valid_for_minutes||10)+' minutes.':'Confirm your identity only when a sensitive action requires it.')+'</p>'+
          (!stepUp?.verified?'<button id="authConfirmIdentity" type="button">Confirm identity</button>':'')+
        '</section>'+
        '<section class="accountSettingsCard authUpgradeCard authSecurityCard"><div class="authSecurityCardHead"><div><small>SESSIONS</small><h2>Signed-in sessions</h2></div><span class="authSecurityState neutral">Current device active</span></div>'+
          '<p class="authSecurityCardCopy">End other sessions or sign out this device. These controls are separate from password changes.</p>'+
          '<div class="authSecurityActions"><button id="revokeOthers" type="button" class="dangerLite">Sign out other devices</button><button id="authSignOutCurrent" type="button" class="authSecondaryAction">Sign out</button></div>'+
          '<div id="authDrawerMsg" class="avatarHint"></div>'+
        '</section>'+
      '</div>';
    panel.dataset.authSecurityReady='1';
    panel.querySelector('#sendVerify')?.addEventListener('click',async()=>{
      const out=panel.querySelector('#authDrawerMsg');if(out)out.textContent='Preparing verification…';
      try{
        const r=await api('/api/auth/email-verification/request',{method:'POST',body:'{}'});
        if(!out)return;
        if(r.delivery_status==='sent')out.textContent='Verification email sent. Check your inbox and spam folder.';
        else if(r.preview_verify_url)out.innerHTML='Email sending is unavailable in this preview. <a href="'+esc(r.preview_verify_url)+'">Verify directly here</a>.';
        else if(r.delivery_status==='not_configured')out.textContent='Email delivery is not configured yet. Your verification request was not emailed.';
        else out.textContent='Verification email could not be delivered. Please try again later.';
      }catch(error){if(out)out.textContent=error.message}
    });
    panel.querySelector('#authChangePassword')?.addEventListener('click',()=>openPasswordDialog(account));
    panel.querySelector('#authForgotPassword')?.addEventListener('click',()=>openPasswordRecoveryDialog(account));
    panel.querySelector('#authConfirmIdentity')?.addEventListener('click',()=>openStepUpDialog(account));
    panel.querySelector('#revokeOthers')?.addEventListener('click',async()=>{
      const out=panel.querySelector('#authDrawerMsg');try{await api('/api/auth/sessions/revoke-others',{method:'POST',body:'{}'});if(out)out.textContent='Other sessions signed out.'}catch(error){if(out)out.textContent=error.message}
    });
    panel.querySelector('#authSignOutCurrent')?.addEventListener('click',event=>window.BusinessLifeShell?.signOutCurrentAccount?.(event.currentTarget));
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
