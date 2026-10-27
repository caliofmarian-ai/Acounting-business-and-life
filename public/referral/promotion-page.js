import { RUNTIME_MARKETING_TEMPLATES, RUNTIME_MARKETING_COPY, generateMarketingKitSvg, getMarketingKitTemplate } from './marketing-kit-runtime.js';
import { createReferralController, normalizePromotionLocale, readPresentation, writePresentation, resolvePresentation, presentationPageUrl, sanitizePresentation, waitForPromotionOperation } from './promotion-ui-core.js';
import { promotionText } from './promotion-copy.js';
import { createMarketingKitExport, decodePromotionImage, downloadPromotionFile, promotionPrintDocument } from './promotion-export.js';
import { captureReferralEvent } from './referral-analytics.js';
import { PROMOTION_BRAND_ASSETS, DEFAULT_PROMOTION_ARTWORK_ID, getPromotionBrandAsset } from './promotion-brand.js';

const PRESENTATION_OPTIONS = Object.freeze({
  templates: RUNTIME_MARKETING_TEMPLATES.map(item => item.id),
  variants: RUNTIME_MARKETING_COPY['en-PH'].variants.map(item => item.id)
});

export function promotionChannelLinks(url, invitation) {
  const message = invitation + ' ' + url;
  return {
    wa: 'https://wa.me/?text=' + encodeURIComponent(message),
    tg: 'https://t.me/share/url?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(invitation),
    sms: 'sms:?body=' + encodeURIComponent(message),
    mail: 'mailto:?subject=' + encodeURIComponent('Business & Life') + '&body=' + encodeURIComponent(message)
  };
}

export async function copyPromotionLink({ url, clipboard, input, isCurrent = () => true }) {
  if (!isCurrent()) return '';
  try {
    await clipboard.writeText(url);
    return isCurrent() ? 'copied' : '';
  } catch {
    if (!isCurrent()) return '';
    input.value = url;
    input.focus();
    input.select();
    input.setSelectionRange?.(0, url.length);
    input.classList.add('manualCopy');
    return 'manualCopy';
  }
}

export async function loadApprovedBrandAsset(runtime, locale, asset = getPromotionBrandAsset(DEFAULT_PROMOTION_ARTWORK_ID), { timeoutMs = 12000 } = {}) {
  if (!asset) throw new Error('Choose an approved artwork');
  const url = new URL(asset.src, runtime.location.origin);
  if (url.origin !== runtime.location.origin || !url.pathname.startsWith('/referral/assets/')) throw new Error('Unapproved artwork location');
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  let reader;
  try {
    const response = await waitForPromotionOperation(runtime.fetch(url.href, { cache: 'force-cache', signal: abort.signal }), abort.signal);
    if (!response.ok) throw new Error('Artwork could not load');
    const blob = await waitForPromotionOperation(response.blob(), abort.signal);
    // The renderer accepts at most 8 million data-URL characters, including base64 expansion.
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type) || blob.size > 5 * 1024 * 1024) throw new Error('Artwork is not a supported image');
    const dataUrl = await waitForPromotionOperation(new Promise((resolve, reject) => {
      reader = new runtime.FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Artwork could not load'));
      reader.onabort = () => reject(new Error('Artwork loading stopped'));
      reader.readAsDataURL(blob);
    }), abort.signal);
    await decodePromotionImage(dataUrl, { ImageCtor: runtime.Image, timeoutMs, signal: abort.signal });
    return { dataUrl, alt: asset.alt?.[locale] || asset.alt?.['en-PH'] || promotionText(locale, 'artworkAlt') };
  } finally {
    clearTimeout(timer);
    if (reader) { reader.onload = null; reader.onerror = null; reader.onabort = null; if (reader.readyState === 1) reader.abort(); }
  }
}

export function initPromotionPage(runtime = globalThis, overrides = {}) {
  const document = runtime.document;
  const kit = document.body.dataset.promotionPage === 'kit';
  const element = id => document.getElementById(id);
  const session = runtime.ABLSession;
  const decodeImage = overrides.decodeImage || ((source) => decodePromotionImage(source, { ImageCtor: runtime.Image }));
  const makeExport = overrides.createExport || ((options) => createMarketingKitExport(options, runtime));
  const sendEvent = overrides.captureEvent || captureReferralEvent;
  const generateSvg = overrides.generateSvg || generateMarketingKitSvg;
  const downloadFile = overrides.downloadFile || ((file) => downloadPromotionFile(file, runtime));
  const loadBrand = overrides.loadBrandAsset || ((asset, locale) => loadApprovedBrandAsset(runtime, locale, asset));
  let storage;
  try { storage = runtime.localStorage; } catch {}
  let explicit = sanitizePresentation(Object.fromEntries(new URLSearchParams(runtime.location.search)), PRESENTATION_OPTIONS);
  let choices = { profile: '', locale: normalizePromotionLocale(explicit.locale), template: PRESENTATION_OPTIONS.templates[0], variant: 'personal_share_v1', format: 'png', artwork: DEFAULT_PROMOTION_ARTWORK_ID, ...explicit };
  let account = null;
  let accountId = null;
  let accountSession = '';
  let profiles = [];
  let renderSequence = 0;
  let artworkSequence = 0;
  let previewUrl = '';
  let prepared = null;
  let rendered = null;
  let statusKey = 'loadingIdentity';
  let feedbackKey = '';
  let qrReady = false;
  let linkReady = false;
  const brandPromises = new Map();
  const artworkControls = new Map();
  let artworkStatusKey = 'artworkWaiting';
  let stopped = false;
  let controller;
  const t = (key, values) => promotionText(choices.locale, key, values);
  const sessionKey = () => String(session?.csrfToken?.() || '');

  async function approvedBrand(id, locale) {
    const asset = getPromotionBrandAsset(id);
    if (!asset) throw new Error('Choose an approved artwork');
    if (!brandPromises.has(id)) {
      const pending = Promise.resolve().then(() => loadBrand(asset, locale));
      brandPromises.set(id, pending);
      pending.catch(() => { if (brandPromises.get(id) === pending) brandPromises.delete(id); });
    }
    const loadedAsset = await brandPromises.get(id);
    if (!loadedAsset?.dataUrl) throw new Error('Artwork could not load');
    // Bytes are reusable; description language belongs to the current selection.
    return { dataUrl: loadedAsset.dataUrl, alt: asset.alt[locale] || asset.alt['en-PH'] };
  }
  function setArtworkStatus(key) {
    artworkStatusKey = key;
    element('artworkStatus').removeAttribute('data-i18n');
    element('artworkStatus').textContent = t(key);
    element('artworkStatus').classList.toggle('error', key === 'artworkUnavailable');
    element('artworkOptions').setAttribute('aria-busy', String(key === 'artworkLoading'));
    element('artworkRetry').hidden = key !== 'artworkUnavailable';
  }
  function buildArtworkOptions() {
    for (const asset of PROMOTION_BRAND_ASSETS) {
      const card = document.createElement('label');
      card.className = 'artworkCard';
      const input = document.createElement('input');
      input.type = 'radio'; input.name = 'artwork'; input.value = asset.id;
      input.id = 'artwork-' + asset.id;
      input.setAttribute('aria-labelledby', 'artworkName-' + asset.id);
      card.setAttribute('for', input.id);
      const thumbnail = document.createElement('img');
      thumbnail.src = asset.thumbnail; thumbnail.width = 360; thumbnail.height = 240;
      const name = document.createElement('strong');
      name.className = 'artworkName'; name.id = 'artworkName-' + asset.id;
      const marker = document.createElement('span'); marker.className = 'artworkSelected';
      marker.setAttribute('aria-hidden', 'true');
      card.append(input, thumbnail, name, marker);
      element('artworkOptions').append(card);
      artworkControls.set(asset.id, { card, input, thumbnail, name, marker });
      input.addEventListener('change', () => {
        if (!input.checked || choices.artwork === asset.id) return;
        choices.artwork = asset.id;
        explicit.artwork = asset.id;
        localize(); syncNavigation();
        const loaded = controller.getCurrent();
        if (loaded) { if (kit) void renderDesign(loaded); else void renderCenterArtwork(loaded); }
      });
    }
  }
  function localizeArtworkOptions() {
    for (const asset of PROMOTION_BRAND_ASSETS) {
      const control = artworkControls.get(asset.id);
      if (!control) continue;
      const selected = choices.artwork === asset.id;
      control.input.checked = selected;
      control.card.classList.toggle('selected', selected);
      control.name.textContent = asset.name[choices.locale] || asset.name['en-PH'];
      control.thumbnail.alt = asset.alt[choices.locale] || asset.alt['en-PH'];
      control.marker.textContent = '✓ ' + t('artworkSelected');
      control.marker.hidden = !selected;
    }
    setArtworkStatus(artworkStatusKey);
  }

  function setStatus(key = '') {
    statusKey = key;
    element('status').removeAttribute('data-i18n');
    element('status').textContent = key ? t(key) : '';
  }
  function showFeedback(key = '', error = false) {
    feedbackKey = key;
    element('feedback').hidden = !key;
    element('feedback').classList.toggle('error', error);
    element('feedbackText').textContent = key ? t(key) : '';
    element('retry').hidden = !error;
  }
  function setLinkActions(enabled) {
    if (kit) return;
    element('copy').disabled = !enabled;
    element('share').disabled = !enabled;
    element('channels').hidden = !enabled;
    element('marketingKit').setAttribute('aria-disabled', String(!enabled));
    element('marketingKit').tabIndex = enabled ? 0 : -1;
  }
  function setExportActions(enabled, printable = enabled) {
    if (!kit) return;
    element('export').disabled = !enabled;
    element('share').disabled = !enabled;
    element('print').disabled = !printable;
  }
  function previewMessage(key, error = false) {
    if (!kit) return;
    element('preview').replaceChildren();
    const box = document.createElement('div');
    box.className = error ? 'previewError' : 'previewPlaceholder';
    box.textContent = t(key);
    element('preview').append(box);
  }
  function clearLoaded() {
    renderSequence += 1;
    artworkSequence += 1;
    setArtworkStatus('artworkWaiting');
    prepared = null;
    rendered = null;
    linkReady = false;
    qrReady = false;
    if (previewUrl) { runtime.URL.revokeObjectURL(previewUrl); previewUrl = ''; }
    if (kit) {
      setExportActions(false);
      previewMessage('previewLoading');
      element('previewCaption').textContent = '';
    } else {
      element('brandArtwork').hidden = true;
      element('brandArtwork').removeAttribute('src');
      element('brandArtwork').removeAttribute('data-artwork');
      setLinkActions(false);
      element('referralCode').textContent = '—';
      element('referralUrl').value = '';
      element('referralUrl').classList.remove('manualCopy');
      element('qrImage').hidden = true;
      element('qrImage').removeAttribute('src');
      element('qrFallback').hidden = false;
      element('qrFallback').removeAttribute('data-i18n');
      element('qrFallback').textContent = t('loadingIdentity');
      element('progressLink').textContent = t('unavailable');
      element('progressQr').textContent = t('unavailable');
      for (const id of ['wa', 'tg', 'sms', 'mail']) element(id).removeAttribute('href');
    }
  }
  function setOptions(select, values, selected) {
    select.replaceChildren();
    for (const value of values) {
      const option = document.createElement('option');
      option.value = value.value;
      option.textContent = value.label;
      select.append(option);
    }
    select.value = selected;
  }
  function localize() {
    document.documentElement.lang = choices.locale;
    document.title = 'Business & Life — ' + t(kit ? 'marketingKit' : 'promotionTitle');
    document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
    element('locale').value = choices.locale;
    setOptions(element('role'), profiles.map(profile => ({ value: profile, label: t(profile) })), choices.profile);
    element('status').textContent = statusKey ? t(statusKey) : '';
    element('feedbackText').textContent = feedbackKey ? t(feedbackKey) : '';
    localizeArtworkOptions();
    if (kit) {
      setOptions(element('template'), RUNTIME_MARKETING_TEMPLATES.map(item => ({ value: item.id, label: item.labels?.[choices.locale] || item.label })), choices.template);
      const variants = (RUNTIME_MARKETING_COPY[choices.locale] || RUNTIME_MARKETING_COPY['en-PH']).variants;
      setOptions(element('variant'), variants.map(item => ({ value: item.id, label: item.headline })), choices.variant);
      element('format').value = choices.format;
      element('preview').setAttribute('aria-label', t('previewLabel'));
      element('export').textContent = t(choices.format === 'svg' ? 'downloadSvg' : 'download');
    } else {
      element('referralUrl').setAttribute('aria-label', t('manualLinkLabel'));
      element('qrImage').alt = t('yourQr');
      element('channels').setAttribute('aria-label', t('shareInvitation'));
      element('progressLink').textContent = t(linkReady ? 'ready' : 'unavailable');
      element('progressQr').textContent = t(qrReady ? 'ready' : 'unavailable');
      if (linkReady && !qrReady) element('qrFallback').textContent = t('qrUnavailable');
    }
  }
  function persist() {
    if (!accountId || !session?.authenticated?.() || sessionKey() !== accountSession) return;
    writePresentation(storage, accountId, choices, PRESENTATION_OPTIONS);
  }
  function syncNavigation() {
    const path = kit ? '/referral/marketing-kit.html' : '/referral/promotion-center.html';
    const url = presentationPageUrl(path, choices, PRESENTATION_OPTIONS);
    runtime.history.replaceState(runtime.history.state, '', url);
    if (kit) element('back').href = presentationPageUrl('/referral/promotion-center.html', choices, PRESENTATION_OPTIONS);
    else element('marketingKit').href = presentationPageUrl('/referral/marketing-kit.html', choices, PRESENTATION_OPTIONS);
    persist();
  }
  function invitation(loaded) {
    const name = String(loaded.account.display_name || '').trim();
    return name ? t('invited', { name }) : t('genericInvite');
  }
  function syncChannels(loaded) {
    for (const [id, href] of Object.entries(promotionChannelLinks(loaded.identity.referralUrl, invitation(loaded)))) element(id).href = href;
  }
  function track(loaded, event, channel = '') {
    if (controller.getCurrent() !== loaded) return;
    const properties = { campaign: loaded.identity.campaign, source_profile_role: loaded.profile };
    if (channel) properties.channel = channel;
    void sendEvent({ event, properties, authenticated: true });
  }
  function currentDesign(sequence, loaded) {
    return !stopped && sequence === renderSequence && controller.getCurrent() === loaded;
  }
  async function renderDesign(loaded) {
    const sequence = ++renderSequence;
    const selection = { ...choices };
    prepared = null;
    rendered = null;
    setExportActions(false);
    previewMessage('previewLoading');
    setStatus('exportPreparing');
    setArtworkStatus('artworkLoading');
    if (previewUrl) { runtime.URL.revokeObjectURL(previewUrl); previewUrl = ''; }
    let nextUrl = '';
    try {
      if (!loaded.identity.qrDataUrl) throw Object.assign(new Error('QR required'), { code: 'qrRequired' });
      await decodeImage(loaded.identity.qrDataUrl);
      if (!currentDesign(sequence, loaded)) return;
      let brandAsset;
      try { brandAsset = await approvedBrand(selection.artwork, selection.locale); }
      catch (error) { throw Object.assign(new Error('The selected artwork could not load'), { code: 'artworkUnavailable', cause: error }); }
      if (!currentDesign(sequence, loaded)) return;
      setArtworkStatus('artworkReady');
      const fields = {
        referrerName: String(loaded.account.display_name || '').trim() || t('fallbackName'),
        referralCode: loaded.identity.code,
        referralUrl: loaded.identity.referralUrl,
        qrDataUrl: loaded.identity.qrDataUrl
      };
      const svg = generateSvg({ templateId: selection.template, fields, locale: selection.locale, variantId: selection.variant, brandAsset });
      nextUrl = runtime.URL.createObjectURL(new runtime.Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
      const image = await decodeImage(nextUrl);
      if (!currentDesign(sequence, loaded)) { runtime.URL.revokeObjectURL(nextUrl); return; }
      image.alt = t('previewLabel');
      image.setAttribute('draggable', 'false');
      image.setAttribute('data-artwork', selection.artwork);
      element('preview').replaceChildren(image);
      previewUrl = nextUrl;
      nextUrl = '';
      const metadata = getMarketingKitTemplate(selection.template);
      element('previewCaption').textContent = metadata.print
        ? t('printPaper', { width: metadata.print.widthMm, height: metadata.print.heightMm })
        : t('digitalPaper', { width: metadata.width, height: metadata.height });
      rendered = { svg, selection, loaded, sequence };
      setExportActions(false, true);
      const file = await makeExport({ svg, templateId: selection.template, referralCode: loaded.identity.code, locale: selection.locale, format: selection.format });
      if (!currentDesign(sequence, loaded)) return;
      prepared = { ...file, loaded, sequence, artwork: selection.artwork };
      setExportActions(true);
      setStatus('');
    } catch (error) {
      if (nextUrl) runtime.URL.revokeObjectURL(nextUrl);
      if (!currentDesign(sequence, loaded)) return;
      prepared = null;
      const failure = error?.code === 'artworkUnavailable' ? 'artworkDesignUnavailable' : error?.code === 'qrRequired' ? 'qrRequired' : 'previewError';
      if (error?.code === 'artworkUnavailable') setArtworkStatus('artworkUnavailable');
      else if (artworkStatusKey === 'artworkLoading') setArtworkStatus('artworkWaiting');
      if (!rendered) previewMessage(failure, true);
      setExportActions(false, Boolean(rendered));
      setStatus(rendered ? 'exportError' : failure);
    }
  }
  async function renderCenterArtwork(loaded) {
    const sequence = ++artworkSequence;
    const selection = { artwork: choices.artwork, locale: choices.locale };
    const current = () => !stopped && sequence === artworkSequence && controller.getCurrent() === loaded
      && choices.artwork === selection.artwork && choices.locale === selection.locale;
    element('brandArtwork').hidden = true;
    element('brandArtwork').removeAttribute('src');
    element('brandArtwork').removeAttribute('data-artwork');
    setArtworkStatus('artworkLoading');
    try {
      const asset = await approvedBrand(selection.artwork, selection.locale);
      if (!current()) return;
      element('brandArtwork').src = asset.dataUrl;
      element('brandArtwork').alt = asset.alt;
      element('brandArtwork').setAttribute('data-artwork', selection.artwork);
      element('brandArtwork').hidden = false;
      setArtworkStatus('artworkReady');
    } catch {
      if (current()) setArtworkStatus('artworkUnavailable');
    }
  }
  async function renderIdentity(loaded, isCurrent) {
    linkReady = true;
    if (kit) { await renderDesign(loaded); return; }
    element('referralCode').textContent = loaded.identity.code;
    element('referralUrl').value = loaded.identity.referralUrl;
    element('progressLink').textContent = t('ready');
    setLinkActions(true);
    syncChannels(loaded);
    setStatus('');
    track(loaded, 'referral_link_created');
    const artwork = renderCenterArtwork(loaded);
    const sequence = renderSequence;
    try {
      if (!loaded.identity.qrDataUrl) throw new Error('QR unavailable');
      await decodeImage(loaded.identity.qrDataUrl);
      if (!isCurrent() || sequence !== renderSequence) return;
      element('qrImage').src = loaded.identity.qrDataUrl;
      element('qrImage').hidden = false;
      element('qrFallback').hidden = true;
      qrReady = true;
      element('progressQr').textContent = t('ready');
    } catch {
      if (!isCurrent() || sequence !== renderSequence) return;
      element('qrFallback').textContent = t('qrUnavailable');
      element('progressQr').textContent = t('unavailable');
    }
    await artwork;
  }

  controller = createReferralController({
    fetchImpl: (...args) => runtime.fetch(...args), session,
    onState(state) {
      if (state.phase === 'ready') return;
      clearLoaded();
      element('signin').hidden = state.phase !== 'signed_out';
      if (state.phase === 'loading') {
        showFeedback('');
        setStatus('loadingIdentity');
        element('role').disabled = !account || sessionKey() !== accountSession;
        return;
      }
      if (state.phase === 'signed_out') {
        account = null;
        element('role').disabled = true;
        showFeedback('');
        setStatus('signInTitle');
        if (kit) previewMessage('signInTitle');
        else element('qrFallback').textContent = t('signInTitle');
        return;
      }
      const errorKey = { no_profiles: 'noProfiles', profile_unavailable: 'errorProfile', invalid_response: 'errorIdentity', timeout: 'errorTimeout', session_changed: 'errorSession' }[state.code] || 'errorTemporary';
      showFeedback(errorKey, state.phase !== 'empty');
      setStatus('');
      if (kit) previewMessage('previewUnavailable', true);
      else element('qrFallback').textContent = t('unavailable');
      if (state.phase === 'empty' || state.code === 'session_changed') element('role').disabled = true;
    },
    onContext(snapshot, context) {
      const nextId = Number(snapshot.account.id);
      if (accountId && accountId !== nextId) explicit = {};
      if (context.requestedProfile && (!accountId || accountId === nextId)) explicit.profile = context.requestedProfile;
      account = snapshot.account;
      accountId = nextId;
      accountSession = sessionKey();
      profiles = context.profiles;
      choices = resolvePresentation({ query: explicit, saved: readPresentation(storage, accountId, PRESENTATION_OPTIONS), snapshot, ...PRESENTATION_OPTIONS });
      explicit = sanitizePresentation(choices, PRESENTATION_OPTIONS);
      localize();
      element('role').disabled = !profiles.length;
      element('signin').hidden = true;
      showFeedback(choices.unavailableRequestedProfile ? 'profileFallback' : '');
      syncNavigation();
      return choices.profile;
    },
    onReady: renderIdentity
  });

  function updateChoices() {
    choices = { ...choices, locale: normalizePromotionLocale(element('locale').value), profile: element('role').value || choices.profile };
    if (kit) choices = { ...choices, template: element('template').value, variant: element('variant').value, format: element('format').value };
    explicit = sanitizePresentation(choices, PRESENTATION_OPTIONS);
    localize();
    syncNavigation();
  }
  element('role').addEventListener('change', () => {
    const requested = element('role').value;
    choices.profile = requested;
    explicit.profile = requested;
    syncNavigation();
    void controller.load(requested);
  });
  element('locale').addEventListener('change', () => {
    updateChoices();
    const loaded = controller.getCurrent();
    if (loaded) { if (kit) void renderDesign(loaded); else { syncChannels(loaded); void renderCenterArtwork(loaded); } }
  });
  for (const id of ['retry', 'signinRetry']) element(id).addEventListener('click', () => { void controller.load(choices.profile); });
  element('artworkRetry').addEventListener('click', () => {
    const loaded = controller.getCurrent();
    if (!loaded) { void controller.load(choices.profile); return; }
    brandPromises.delete(choices.artwork);
    if (kit) void renderDesign(loaded); else void renderCenterArtwork(loaded);
  });

  if (kit) {
    for (const id of ['template', 'variant', 'format']) element(id).addEventListener('change', () => {
      updateChoices();
      const loaded = controller.getCurrent();
      if (loaded) void renderDesign(loaded);
    });
    element('export').addEventListener('click', () => {
      if (!prepared || !currentDesign(prepared.sequence, prepared.loaded)) return;
      try { downloadFile(prepared); setStatus('downloadStarted'); } catch { setStatus('exportError'); }
    });
    element('share').addEventListener('click', async () => {
      const file = prepared;
      if (!file || !currentDesign(file.sequence, file.loaded)) return;
      if (typeof runtime.File === 'function' && runtime.navigator.share && runtime.navigator.canShare) {
        const attachment = new runtime.File([file.blob], file.filename, { type: file.mimeType });
        if (runtime.navigator.canShare({ files: [attachment] })) {
          try {
            await runtime.navigator.share({ title: 'Business & Life', files: [attachment] });
            if (currentDesign(file.sequence, file.loaded)) setStatus('shareDone');
            return;
          } catch (error) { if (error?.name === 'AbortError') return; }
        }
      }
      if (!currentDesign(file.sequence, file.loaded)) return;
      try { downloadFile(file); setStatus('shareDownload'); } catch { setStatus('exportError'); }
    });
    element('print').addEventListener('click', () => {
      const design = rendered;
      if (!design || !currentDesign(design.sequence, design.loaded)) return;
      const popup = runtime.open('', '_blank');
      if (!popup) { setStatus('printBlocked'); return; }
      try {
        const html = promotionPrintDocument({ svg: design.svg, templateId: design.selection.template, locale: choices.locale, title: t('printTitle'), help: t('printHelp'), action: t('printAction'), close: t('closeWindow') });
        popup.document.open(); popup.document.write(html); popup.document.close(); popup.opener = null;
        setStatus('printInstructions');
      } catch { popup.close(); setStatus('exportError'); }
    });
  } else {
    element('copy').addEventListener('click', async () => {
      const loaded = controller.getCurrent();
      if (!loaded) return;
      const key = await copyPromotionLink({ url: loaded.identity.referralUrl, clipboard: runtime.navigator.clipboard, input: element('referralUrl'), isCurrent: () => controller.getCurrent() === loaded });
      if (!key) return;
      setStatus(key);
      if (key === 'copied') track(loaded, 'referral_shared', 'copy_link');
    });
    element('share').addEventListener('click', async () => {
      const loaded = controller.getCurrent();
      if (!loaded) return;
      if (runtime.navigator.share) {
        try {
          await runtime.navigator.share({ title: 'Business & Life', text: invitation(loaded), url: loaded.identity.referralUrl });
          if (controller.getCurrent() === loaded) { track(loaded, 'referral_shared', 'native_share'); setStatus('shareDone'); }
          return;
        } catch (error) { if (error?.name === 'AbortError') return; }
      }
      const key = await copyPromotionLink({ url: loaded.identity.referralUrl, clipboard: runtime.navigator.clipboard, input: element('referralUrl'), isCurrent: () => controller.getCurrent() === loaded });
      if (!key) return;
      setStatus(key === 'copied' ? 'shareFallback' : 'shareUnavailable');
      if (key === 'copied') track(loaded, 'referral_shared', 'copy_link');
    });
    for (const [id, channel] of [['wa', 'whatsapp'], ['tg', 'telegram'], ['sms', 'sms'], ['mail', 'email']]) element(id).addEventListener('click', event => {
      const loaded = controller.getCurrent();
      if (!loaded) { event.preventDefault(); return; }
      track(loaded, 'referral_shared', channel);
    });
    element('marketingKit').addEventListener('click', event => { if (!controller.getCurrent()) event.preventDefault(); });
  }

  const expired = () => controller.invalidate('signed_out');
  let suspended = false;
  const pagehide = () => { suspended = true; controller.invalidate('session_changed'); };
  const pageshow = event => { if (event.persisted || suspended) { suspended = false; void controller.load(choices.profile); } };
  const visibility = () => {
    if (document.visibilityState === 'hidden') { suspended = true; controller.invalidate('session_changed'); }
    else if (suspended) { suspended = false; void controller.load(choices.profile); }
  };
  const focus = () => { if (accountSession && sessionKey() !== accountSession && !suspended) void controller.load(); };
  document.addEventListener('abl:auth-expired', expired);
  document.addEventListener('visibilitychange', visibility);
  runtime.addEventListener('pagehide', pagehide);
  runtime.addEventListener('pageshow', pageshow);
  runtime.addEventListener('focus', focus);
  buildArtworkOptions();
  localize();
  void controller.load();
  return Object.freeze({
    controller,
    getChoices: () => ({ ...choices }),
    getPrepared: () => prepared,
    destroy() {
      stopped = true;
      controller.dispose();
      clearLoaded();
      document.removeEventListener('abl:auth-expired', expired);
      document.removeEventListener('visibilitychange', visibility);
      runtime.removeEventListener('pagehide', pagehide);
      runtime.removeEventListener('pageshow', pageshow);
      runtime.removeEventListener('focus', focus);
    }
  });
}

if (typeof document !== 'undefined' && document.body?.dataset?.promotionPage) initPromotionPage(globalThis);
