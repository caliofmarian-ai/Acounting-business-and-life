import { readFileSync } from 'node:fs';
import { initPromotionPage } from '../public/referral/promotion-page.js';

export const tick = () => new Promise(resolve => setImmediate(resolve));
export const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
export class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.dataset = {}; this.attributes = new Map(); this.children = [];
    this.listeners = new Map(); this.value = ''; this.textContent = ''; this.hidden = false; this.disabled = false;
    this.classes = new Set(); this.classList = {
      add: (...names) => names.forEach(name => this.classes.add(name)),
      remove: (...names) => names.forEach(name => this.classes.delete(name)),
      toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name)
    };
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'src' || name === 'href') this[name] = String(value); }
  removeAttribute(name) { this.attributes.delete(name); if (name === 'src' || name === 'href') delete this[name]; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(name, listener) { const list = this.listeners.get(name) || []; list.push(listener); this.listeners.set(name, list); }
  removeEventListener(name, listener) { this.listeners.set(name, (this.listeners.get(name) || []).filter(item => item !== listener)); }
  fire(name, event = {}) { return Promise.all((this.listeners.get(name) || []).map(listener => listener({ target: this, preventDefault() {}, ...event }))); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  focus() { this.focused = true; }
  select() { this.selected = true; }
  setSelectionRange(start, end) { this.selection = [start, end]; }
  remove() {}
  click() { this.clicked = true; }
}
export function fixture({ page = 'center', query = '', locale = 'en-PH', fetchImpl, createExport, generateSvg, clipboard, share, brandAsset, loadBrandAsset } = {}) {
  const html = read('public/referral/' + (page === 'kit' ? 'marketing-kit.html' : 'promotion-center.html'));
  const document = new Element('document');
  const elements = new Map(), translatable = [];
  for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/gi)) {
    const node = new Element(match[1]);
    const attrs = Object.fromEntries([...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(item => [item[1], item[2]]));
    node.hidden = /(?:^|\s)hidden(?:\s|$)/.test(match[2]);
    node.disabled = /(?:^|\s)disabled(?:\s|$)/.test(match[2]);
    for (const [key, value] of Object.entries(attrs)) {
      node.setAttribute(key, value);
      if (key === 'id') elements.set(value, node);
      if (key === 'value') node.value = value;
      if (key === 'class') value.split(/\s+/).forEach(name => node.classes.add(name));
      if (key === 'data-i18n') { node.dataset.i18n = value; translatable.push(node); }
    }
  }
  document.body = new Element('body'); document.body.dataset.promotionPage = page;
  document.documentElement = new Element('html'); document.visibilityState = 'visible';
  document.createElement = tag => new Element(tag);
  document.getElementById = id => elements.get(id) || null;
  document.querySelectorAll = selector => selector === '[data-i18n]' ? translatable : [];
  const values = new Map(), captured = [], downloads = [], requests = [], revoked = [];
  const runtime = new Element('window');
  let authenticated = true, csrf = 'current-session', objectId = 0;
  const location = new URL('https://caliof.com/referral/' + (page === 'kit' ? 'marketing-kit.html' : 'promotion-center.html') + query);
  Object.assign(runtime, {
    document, Blob, File: globalThis.File, location,
    history: { state: null, replaceState(_state, _title, url) { runtime.location = new URL(url, runtime.location); } },
    localStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) },
    ABLSession: { ready: Promise.resolve(), authenticated: () => authenticated, csrfToken: () => csrf },
    URL: { createObjectURL: () => 'blob:test-' + (++objectId), revokeObjectURL: value => revoked.push(value) },
    navigator: { clipboard: clipboard || { writeText: async value => captured.push({ copied: value }) }, ...(share ? { share } : {}) },
    open: () => null,
    fetch: async (path, init) => {
      requests.push({ path, init });
      if (fetchImpl) return fetchImpl(path, init);
      const data = String(path).startsWith('/api/me') ? {
        account: { id: 21, display_name: 'Sample Account', active_role: 'merchant', preferred_locale: locale },
        profiles: [{ role: 'merchant', enabled: true }, { role: 'customer', enabled: true }, { role: 'supplier', enabled: false }]
      } : referral(new URL(path, 'https://caliof.com').searchParams.get('profile'));
      return { ok: true, status: 200, json: async () => data };
    }
  });
  const ui = initPromotionPage(runtime, {
    decodeImage: async () => { const image = new Element('img'); image.naturalWidth = 256; image.naturalHeight = 256; return image; },
    createExport: createExport || (async options => ({ blob: new Blob(['synthetic-image'], { type: options.format === 'jpg' ? 'image/jpeg' : options.format === 'svg' ? 'image/svg+xml' : 'image/png' }), filename: 'design.' + options.format, mimeType: options.format === 'jpg' ? 'image/jpeg' : options.format === 'svg' ? 'image/svg+xml' : 'image/png' })),
    captureEvent: async value => { captured.push(value); return true; },
    downloadFile: value => downloads.push(value),
    ...(generateSvg ? { generateSvg } : {}),
    ...(brandAsset ? { brandAsset, loadBrandAsset } : {})
  });
  return { ui, runtime, document, el: id => elements.get(id), values, captured, requests, downloads, revoked, signOut() { authenticated = false; }, changeSession(value) { csrf = value; } };
}
export function referral(profile) {
  const code = 'r1_abcdefghijklmnop';
  const referralUrl = 'https://caliof.com/referral/?ref=' + code + '&profile=' + profile + '&utm_campaign=' + profile + '_referral_v1';
  return { account_id: 21, code, profileRole: profile, referralUrl, campaign: profile + '_referral_v1', qr: { marker: 'qr', referralUrl, dataUrl: 'data:image/png;base64,AAAA' } };
}

