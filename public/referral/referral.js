import { captureReferralEvent } from './referral-analytics.js';

const CODE_RE = /^r1_[A-Za-z0-9_-]{16}$/;
const PUBLIC_ROLES = new Set(['customer','merchant','supplier','courier','service_provider']);

const params = new URLSearchParams(location.search);
const ref = params.get('ref') || '';
const campaign = clean(params.get('utm_campaign'), 'organic');
const source = clean(params.get('utm_source'), 'profile');
const medium = clean(params.get('utm_medium'), 'referral');
const profile = params.get('profile') || '';
const qrOrigin = location.hash === '#qr';
const valid = CODE_RE.test(ref) && (!profile || PUBLIC_ROLES.has(profile));

const referralCode = document.querySelector('#referralCode');
const profileSource = document.querySelector('#profileSource');
const status = document.querySelector('#status');
const continueButton = document.querySelector('#continueButton');
const shareButton = document.querySelector('#shareButton');
const copyButton = document.querySelector('#copyButton');

function clean(value, fallback) {
  const normalized = String(value || '').trim().replace(/[^A-Za-z0-9._~-]/g, '-').replace(/-+/g, '-').slice(0, 80);
  return normalized || fallback;
}

function currentReferralUrl() {
  const url = new URL(location.href);
  url.hash = '';
  return url.toString();
}

function continueUrl() {
  const url = new URL('/', location.origin);
  if (valid) {
    url.searchParams.set('ref', ref);
    url.searchParams.set('utm_campaign', campaign);
    url.searchParams.set('utm_source', source);
    url.searchParams.set('utm_medium', medium);
    if (profile) url.searchParams.set('profile', profile);
  }
  return url.toString();
}

function invitationText() {
  return 'You are invited to try Business & Life.';
}

function setStatus(message) {
  status.textContent = message;
}

function configureChannelLinks(url) {
  const message = `${invitationText()} ${url}`;
  document.querySelector('#whatsappLink').href = `https://wa.me/?text=${encodeURIComponent(message)}`;
  document.querySelector('#telegramLink').href = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(invitationText())}`;
  document.querySelector('#smsLink').href = `sms:?body=${encodeURIComponent(message)}`;
  document.querySelector('#emailLink').href = `mailto:?subject=${encodeURIComponent('Business & Life invitation')}&body=${encodeURIComponent(message)}`;
}

if (valid) {
  referralCode.textContent = ref;
  if (profile) {
    profileSource.hidden = false;
    profileSource.textContent = `Shared from a ${profile.replace('_', ' ')} profile`;
  }
  continueButton.href = continueUrl();
  configureChannelLinks(currentReferralUrl());
  if(profile){
    if(qrOrigin){
      void captureReferralEvent({
        event:'referral_qr_opened',
        referralCode:ref,
        properties:{campaign,source_profile_role:profile}
      });
      history.replaceState?.(null,'',currentReferralUrl());
    }
    void captureReferralEvent({
      event:'referral_landing_viewed',
      referralCode:ref,
      properties:{campaign,source,medium,source_profile_role:profile}
    });
  }
} else {
  document.documentElement.dataset.invalid = 'true';
  referralCode.textContent = 'Invalid or missing referral code';
  shareButton.disabled = true;
  copyButton.disabled = true;
  document.querySelector('.channels').hidden = true;
  setStatus('You can still continue to Business & Life without referral attribution.');
}

shareButton.addEventListener('click', async () => {
  if (!valid) return;
  const data = { title: 'Business & Life', text: invitationText(), url: currentReferralUrl() };
  if (navigator.share) {
    try {
      await navigator.share(data);
      if(profile)void captureReferralEvent({event:'referral_shared',referralCode:ref,properties:{channel:'native_share',campaign,source_profile_role:profile}});
      setStatus('Share sheet opened.');
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(data.url);
    if(profile)void captureReferralEvent({event:'referral_shared',referralCode:ref,properties:{channel:'copy_link',campaign,source_profile_role:profile}});
    setStatus('Sharing is unavailable here, so the invitation link was copied.');
  } catch {
    setStatus('Sharing is unavailable. Copy the address from your browser.');
  }
});

copyButton.addEventListener('click', async () => {
  if (!valid) return;
  try {
    await navigator.clipboard.writeText(currentReferralUrl());
    if(profile)void captureReferralEvent({event:'referral_shared',referralCode:ref,properties:{channel:'copy_link',campaign,source_profile_role:profile}});
    setStatus('Invitation link copied.');
  } catch {
    setStatus('Copy is unavailable. Copy the address from your browser.');
  }
});


for (const [id, channel] of [['whatsappLink','whatsapp'],['telegramLink','telegram'],['smsLink','sms'],['emailLink','email']]) {
  document.querySelector('#' + id)?.addEventListener('click', () => {
    if (valid && profile) void captureReferralEvent({
      event: 'referral_shared',
      referralCode: ref,
      properties: { channel, campaign, source_profile_role: profile }
    });
  });
}
