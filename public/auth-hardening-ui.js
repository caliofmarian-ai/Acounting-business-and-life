import {phGeographyCascadeMarkup,bindPhGeographyCascade} from './ph-geography-cascade.js';
const ADULT_ELIGIBILITY_POLICY_VERSION='ph-adult-eligibility-v1';
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
function sessionActive(){return Boolean(window.ABLSession?.authenticated())}
async function api(path,options={}){const headers={'Content-Type':'application/json',...(options.headers||{})};const r=await fetch(path,{...options,headers});const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error||`Request failed (${r.status})`);return b}
function clearQuery(){history.replaceState({},'',location.pathname)}
function msg(text,kind=''){const el=document.getElementById('modernAuthMessage');if(el){el.textContent=text||'';el.className=`modernAuthMessage ${kind}`}}
let status={google_enabled:false,email_delivery_configured:false,preview_link_enabled:false,qa_preview_context:{enabled:false}};

function bindModernBarangayPicker(){
  return bindPhGeographyCascade({prefix:'reg',fetchJson:api});
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
  else body.innerHTML=qaPreviewBanner()+`<form id="modernRegister" class="modernAuthForm"><label>Name<input id="regName" autocomplete="name" required></label><label>Email<input id="regEmail" type="email" autocomplete="email" required></label><label>Password<input id="regPassword" type="password" minlength="8" autocomplete="new-password" required></label><label>Phone <span>optional</span><input id="regPhone" inputmode="tel" autocomplete="tel"></label>${phGeographyCascadeMarkup('reg',{legend:'Official home area'})}<div class="modernGeoStatus">Your operating area is determined only by the official barangay you select, not by typed address text.</div><label class="modernQaRemoteToggle"><input id="regAdultEligibility" type="checkbox" required> I confirm that I am 18 or older. The Philippines pilot is adult-only because it includes commerce, payments, Delivery and Local Services.</label>${status.qa_preview_context?.remote_override_configured?'<label class="modernQaRemoteToggle"><input id="regQaRemoteTest" type="checkbox"> Use the designated remote PH QA test override for this account</label>':''}<button class="modernPrimary">Create person account</button><small class="modernFine">No date of birth is collected for this declaration. No operational profile is activated automatically.</small></form>${googleButton()}`;
  if(mode==='login'){document.getElementById('modernLogin').onsubmit=login;document.getElementById('forgotBtn').onclick=()=>renderForgot()}
  else{document.getElementById('modernRegister').onsubmit=register;bindModernBarangayPicker().catch(error=>msg(error.message,'error'))}
}
async function login(e){e.preventDefault();msg('Signing in…');try{await api('/api/auth/login',{method:'POST',body:JSON.stringify({email:document.getElementById('modernEmail').value,password:document.getElementById('modernPassword').value})});location.reload()}catch(e){msg(e.message,'error')}}
async function register(e){e.preventDefault();msg('Creating account…');try{await api('/api/auth/register',{method:'POST',body:JSON.stringify({display_name:document.getElementById('regName').value,email:document.getElementById('regEmail').value,password:document.getElementById('regPassword').value,phone:document.getElementById('regPhone').value,home_psgc_code:document.getElementById('regHomePsgcCode')?.value||'',adult_eligibility_attested:Boolean(document.getElementById('regAdultEligibility')?.checked),adult_eligibility_policy_version:ADULT_ELIGIBILITY_POLICY_VERSION,qa_remote_test:Boolean(document.getElementById('regQaRemoteTest')?.checked)})});const v=await api('/api/auth/email-verification/request',{method:'POST',body:'{}'}).catch(()=>null);if(v?.preview_verify_url){document.getElementById('modernAuthBody').innerHTML=`<div class="modernSuccess"><h2>Account created</h2><p>For this preview you can open the verification link directly.</p><a href="${esc(v.preview_verify_url)}">Verify email</a><button id="continueApp" class="modernPrimary">Continue to app</button></div>`;document.getElementById('continueApp').onclick=()=>location.reload()}else location.reload()}catch(e){msg(e.message,'error')}}
function renderForgot({email='',returnToApp=false}={}){const body=document.getElementById('modernAuthBody');setTab('none');body.innerHTML=`<div class="modernBackRow"><button id="backLogin" class="modernBack">‹</button><div><h2>Reset password</h2><p>Enter the email used for your account.</p></div></div><form id="forgotForm" class="modernAuthForm"><label>Email<input id="forgotEmail" type="email" autocomplete="email" value="${esc(email)}" required></label><button class="modernPrimary">Send reset instructions</button></form>`;document.getElementById('backLogin').onclick=()=>returnToApp?location.reload():render('login');document.getElementById('forgotForm').onsubmit=async e=>{e.preventDefault();msg('Preparing reset…');try{const r=await api('/api/auth/forgot-password',{method:'POST',body:JSON.stringify({email:document.getElementById('forgotEmail').value})});if(r.preview_reset_url){body.innerHTML=`<div class="modernSuccess"><h2>Reset prepared</h2><p>${esc(r.message)}</p><a href="${esc(r.preview_reset_url)}">Open preview reset link</a></div>`}else{body.innerHTML=`<div class="modernSuccess"><h2>Check your email</h2><p>${esc(r.message)}</p></div>`}msg('')}catch(e){msg(e.message,'error')}}}
function openPasswordRecovery(email=''){
  document.getElementById('shell')?.classList.add('hidden');
  document.getElementById('login')?.classList.remove('hidden');
  panel();renderForgot({email,returnToApp:true});
  requestAnimationFrame(()=>document.getElementById('forgotEmail')?.focus({preventScroll:true}));
}
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
  document.getElementById('verificationSignIn')?.addEventListener('click',async()=>{try{await api('/api/auth/logout',{method:'POST',body:'{}'})}catch{}window.ABLSession?.clearReadableSession();location.reload()});
}
async function verifyFromUrl(raw){try{const r=await api('/api/auth/email-verification/verify',{method:'POST',body:JSON.stringify({token:raw})});clearQuery();renderVerificationResult(r.verification_session)}catch(e){clearQuery();sessionStorage.setItem('abl_flash',e.message);location.reload()}}
async function verifyRegistrationFromUrl(raw){
  try{
    const r=await api('/api/auth/registration/verify',{method:'POST',body:JSON.stringify({token:raw})});
    clearQuery();
    if(r?.registration_completed){location.reload();return}
    throw new Error('Registration verification did not complete.');
  }catch(e){
    clearQuery();
    sessionStorage.setItem('abl_flash',e.message);
    location.reload();
  }
}
async function oauthHandoff(raw){try{await api('/api/auth/oauth/handoff',{method:'POST',body:JSON.stringify({code:raw})});clearQuery();location.reload()}catch(e){clearQuery();sessionStorage.setItem('abl_flash',e.message);location.reload()}}
async function decorateSecurity(){
  if(!sessionActive())return;
  const panel=document.getElementById('accountSecurityMount');if(!panel)return;
  const account=window.BusinessLifeProfileState?.snapshot?.account;if(!account)return;
  const protectionMount=document.getElementById('accountProtectionMount')||panel;
  const sensitiveMount=document.getElementById('accountSensitiveActionMount')||panel;
  const sessionsMount=document.getElementById('accountSessionsMount')||panel;
  if(panel.dataset.authSecurityDecorating==='1')return;
  panel.dataset.authSecurityDecorating='1';
  try{
    const [ids,stepUp,closureAssessment]=await Promise.all([
      api('/api/auth/identities'),
      api('/api/auth/step-up/status').catch(()=>({verified:false,valid_for_minutes:10})),
      api('/api/auth/account-closure/preflight').catch(()=>null)
    ]);
    if(!document.body.contains(panel))return;
    const googleLinked=ids.some(x=>x.provider==='google');
    const deliveryNote=!account.email_verified_at&&!status.email_delivery_configured?'<div class="avatarHint authDeliveryWarning">Email delivery is not configured in this environment. A preview may offer a direct verification link.</div>':'';
    const stepUpMinutes=Number(stepUp?.valid_for_minutes||10);
    const stepUpMarkup=stepUp?.verified
      ?'<div class="authSecurityLine"><span>Recent identity confirmation</span><strong>Active · up to '+stepUpMinutes+' min</strong></div>'
      :account.has_password
        ?'<form id="stepUpSecurityForm" class="authStepUpForm"><label>Confirm current password<input id="stepUpSecurityPassword" type="password" autocomplete="current-password" maxlength="160" required></label><button type="submit">Confirm identity for sensitive actions</button><div id="stepUpSecurityMsg" class="avatarHint">This confirmation is session-specific and expires automatically.</div></form>'
        :'<div class="avatarHint authStepUpNotice">Sensitive actions require recent identity confirmation. Sign out and sign back in with Google to refresh this session.</div>';

    const protection=document.createElement('section');protection.className='accountSettingsCard authUpgradeCard authProtectionCard';
    protection.innerHTML=`<h2>Account protection</h2><div class="authSecurityLine"><span>Email</span><strong>${account.email_verified_at?'Verified':'Not verified'}</strong></div>${!account.email_verified_at?'<button id="sendVerify" type="button">Verify email</button>':''}${deliveryNote}${status.google_enabled&&!googleLinked?'<a class="authDrawerLink" href="/api/auth/google/link/start">Link Google account</a>':status.google_enabled?'<div class="authSecurityLine"><span>Google</span><strong>Linked</strong></div>':''}<div id="accountProtectionMsg" class="avatarHint"></div>`;
    const sensitive=document.createElement('section');sensitive.className='accountSettingsCard authUpgradeCard authSensitiveCard';
    sensitive.innerHTML=`<h2>Sensitive-action confirmation</h2><p class="authSectionIntro">Confirm your identity only when a protected action requires it. This is separate from changing your password.</p>${stepUpMarkup}`;
    const sessions=document.createElement('section');sessions.className='accountSettingsCard authUpgradeCard authSessionsCard';
    sessions.innerHTML='<h2>Sessions</h2><div class="authSecurityLine"><span>Current session</span><strong>This device · Active</strong></div><p class="authSectionIntro">Manage signed-in access separately from your password.</p><button id="revokeOthers" type="button" class="dangerLite">Sign out other devices</button><button id="signOutCurrent" type="button" class="dangerStrong">Sign out</button><div id="authSessionMsg" class="avatarHint"></div>';
    const closure=document.createElement('section');closure.id='accountDeleteSection';closure.className='accountSettingsCard authUpgradeCard authAccountClosureCard';
    const closureBlocked=Boolean(closureAssessment?.blocker_count);
    const closureItems=(closureAssessment?.blockers||[]).map(item=>'<li><strong>'+esc(item.message||item.code)+'</strong><span>'+esc(item.next_action||'Resolve this item before closing your account.')+'</span></li>').join('');
    closure.innerHTML='<h2>Delete account</h2><p class="authSectionIntro">Deleting your account removes sign-in access and direct personal/authentication data. Records that must remain for accounting, completed transactions, disputes, fraud/security or legal obligations are retained with minimal identifiers.</p>'
      +(closureAssessment===null?'<div class="avatarHint">Account deletion status is temporarily unavailable. No deletion will be attempted until the safety check succeeds.</div>'
        :closureBlocked?'<div class="authClosureBlocked"><strong>Account cannot be deleted yet.</strong><ul>'+closureItems+'</ul></div>'
        :'<form id="accountClosureForm" class="authStepUpForm"><label>Type DELETE to confirm<input name="confirmation" autocomplete="off" maxlength="20" required></label><label class="authClosureConfirm"><input name="confirm" type="checkbox" required> I understand that this closes my Business & Life account and signs out all devices.</label><button type="submit" class="dangerStrong">Delete account</button><div id="accountClosureMsg" class="avatarHint">A fresh financial, security, Support and legal blocker check runs again before deletion.</div></form>');
    protectionMount.replaceChildren(protection);sensitiveMount.replaceChildren(sensitive);sessionsMount.replaceChildren(sessions,closure);
    if(sessionStorage.getItem('abl_open_account_delete')==='1'){
      sessionStorage.removeItem('abl_open_account_delete');
      requestAnimationFrame(()=>{
        closure.scrollIntoView({behavior:'smooth',block:'start'});
        closure.querySelector('[name="confirmation"]')?.focus();
      });
    }

    protection.querySelector('#sendVerify')?.addEventListener('click',async()=>{
      const out=protection.querySelector('#accountProtectionMsg');out.textContent='Preparing verification…';
      try{
        const r=await api('/api/auth/email-verification/request',{method:'POST',body:'{}'});
        if(r.delivery_status==='sent')out.textContent='Verification email sent. Check your inbox and spam folder.';
        else if(r.preview_verify_url)out.innerHTML=`Email sending is unavailable in this preview. <a href="${esc(r.preview_verify_url)}">Verify directly here</a>.`;
        else if(r.delivery_status==='not_configured')out.textContent='Email delivery is not configured yet. Your verification request was not emailed.';
        else out.textContent='Verification email could not be delivered. Please try again later.';
      }catch(e){out.textContent=e.message}
    });
    sensitive.querySelector('#stepUpSecurityForm')?.addEventListener('submit',async e=>{
      e.preventDefault();const input=sensitive.querySelector('#stepUpSecurityPassword'),out=sensitive.querySelector('#stepUpSecurityMsg');if(!input||!out)return;
      const password=input.value;input.value='';out.textContent='Confirming identity…';
      try{await api('/api/auth/step-up/password',{method:'POST',body:JSON.stringify({password})});out.textContent='Identity confirmed. Sensitive actions are available for a short period on this session.';const button=sensitive.querySelector('button[type="submit"]');if(button)button.disabled=true;input.disabled=true}catch(error){input.value='';out.textContent=error.message}
    });
    closure.querySelector('#accountClosureForm')?.addEventListener('submit',async event=>{
      event.preventDefault();
      const form=event.currentTarget,out=form.querySelector('#accountClosureMsg'),button=form.querySelector('button[type="submit"]');
      const fd=new FormData(form),confirmation=String(fd.get('confirmation')||'').trim().toUpperCase();
      if(confirmation!=='DELETE'){out.textContent='Type DELETE exactly to continue.';return}
      button.disabled=true;out.textContent='Checking financial, security and legal blockers…';
      try{
        const currentStep=await api('/api/auth/step-up/status');
        if(!currentStep?.verified){out.textContent='Confirm your identity in Sensitive-action confirmation above, then try again.';button.disabled=false;return}
        const latest=await api('/api/auth/account-closure/preflight');
        if(latest?.blocker_count){
          out.textContent='Account closure is blocked. Reopen Security & access to review the unresolved items.';
          button.disabled=false;return;
        }
        const result=await api('/api/auth/account-closure/close',{method:'POST',body:JSON.stringify({confirmation:'DELETE',confirm:fd.get('confirm')==='on'})});
        if(result?.closed){
          window.ABLSession?.clearReadableSession();
          location.reload();
          return;
        }
        out.textContent='Account closure did not complete.';button.disabled=false;
      }catch(error){
        const blockers=error?.assessment?.blockers||[];
        out.textContent=blockers.length?'Account closure is blocked until the outstanding matters are resolved.':error.message;
        button.disabled=false;
      }
    });
    sessions.querySelector('#revokeOthers').onclick=async()=>{const out=sessions.querySelector('#authSessionMsg');try{await api('/api/auth/sessions/revoke-others',{method:'POST',body:'{}'});out.textContent='Other sessions signed out.'}catch(e){out.textContent=e.message}};
    sessions.querySelector('#signOutCurrent').onclick=async event=>{event.currentTarget.disabled=true;try{await api('/api/auth/logout',{method:'POST',body:'{}'})}catch{}window.ABLSession?.clearReadableSession();location.reload()};
  }catch{}finally{delete panel.dataset.authSecurityDecorating}
}

function watchDrawer(){document.addEventListener('abl:account-settings-rendered',event=>{if(event.detail?.view==='security')decorateSecurity().catch(()=>{})});document.addEventListener('abl:open-password-recovery',event=>openPasswordRecovery(event.detail?.email||''))}
async function boot(){
  await (window.ABLSession?.ready||Promise.resolve());
  const params=new URLSearchParams(location.search);
  if(params.get('registration_verify_token'))return verifyRegistrationFromUrl(params.get('registration_verify_token'));
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
window.BusinessLifeAuthHardening=Object.freeze({openPasswordRecovery});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
