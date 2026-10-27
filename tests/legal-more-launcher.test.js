import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const loaderSource = read('public/mobile-feature-loader.js');
const legalSource = read('public/legal-ui.js');

// A deliberately small DOM for the actual loader and Legal module. Only module
// loading and HTTP are substituted; this is not deployed-browser acceptance.
function dom() {
  class Element {
    constructor(tag) {
      this.tagName = tag.toLowerCase();
      this.children = [];
      this.attributes = {};
      this.dataset = {};
      this.style = {};
      this.listeners = new Map();
      this.textContent = '';
      this.hidden = false;
      this._html = '';
      this.classList = {
        contains: name => this.className.split(/\s+/).includes(name),
        add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
        remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => name && !names.includes(name)).join(' '); },
        toggle: (name, force) => {
          const add = force === undefined ? !this.classList.contains(name) : force;
          this.classList[add ? 'add' : 'remove'](name);
          return add;
        }
      };
    }
    get id() { return this.attributes.id || ''; }
    set id(value) { this.attributes.id = value; }
    get className() { return this.attributes.class || ''; }
    set className(value) { this.attributes.class = value; }
    get firstChild() { return this.children[0] || null; }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
    }
    getAttribute(name) { return this.attributes[name] ?? null; }
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
    prepend(child) { child.parentElement = this; this.children.unshift(child); }
    insertBefore(child, before) {
      child.parentElement = this;
      const i = this.children.indexOf(before);
      if (i < 0) this.children.push(child); else this.children.splice(i, 0, child);
    }
    addEventListener(name, fn) { this.listeners.set(name, [...(this.listeners.get(name) || []), fn]); }
    click() { return this.onclick?.({ target: this }); }
    matches(selector) {
      if (selector.startsWith('#')) return this.id === selector.slice(1);
      if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
      const m = selector.match(/^([a-z-]+)?\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/i);
      if (m) {
        const value = m[2].startsWith('data-')
          ? this.dataset[m[2].slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())]
          : this.getAttribute(m[2]);
        return (!m[1] || this.tagName === m[1]) && value != null && (m[3] === undefined || value === m[3]);
      }
      return this.tagName === selector;
    }
    querySelectorAll(selector) {
      const result = [];
      const visit = node => { for (const child of node.children) { if (child.matches(selector)) result.push(child); visit(child); } };
      visit(this);
      return result;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    get innerHTML() { return this._html; }
    set innerHTML(html) {
      this._html = String(html);
      this.children = [];
      const stack = [this];
      for (const token of this._html.matchAll(/<(\/?)([a-z][\w-]*)([^>]*)>/gi)) {
        const [, closing, tag, attributes] = token;
        if (closing) {
          for (let i = stack.length - 1; i > 0; i--) if (stack[i].tagName === tag.toLowerCase()) { stack.length = i; break; }
          continue;
        }
        const element = new Element(tag);
        for (const a of attributes.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) element.setAttribute(a[1], a[2] ?? a[3] ?? a[4] ?? '');
        stack.at(-1).appendChild(element);
        if (!['input', 'br', 'hr', 'img', 'link', 'meta'].includes(element.tagName)) stack.push(element);
      }
    }
  }
  const document = new Element('document');
  document.head = document.appendChild(new Element('head'));
  document.body = document.appendChild(new Element('body'));
  document.readyState = 'complete';
  document.createElement = tag => new Element(tag);
  document.getElementById = id => document.querySelector('#' + id);
  const top = document.createElement('div'); top.className = 'topActions'; document.body.appendChild(top);
  return document;
}

function harness({ role = '', surface = 'account', admin = null, authenticated = true, failImport = false, missingApi = false, failure = null } = {}) {
  const document = dom(), requests = [], imports = [], launches = [];
  let clock = 0, importFailures = failImport ? 1 : 0;
  class Clock extends Date { static now() { return clock; } }
  const response = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
  const window = {
    ABLSession: { authenticated: () => authenticated },
    BusinessLifeProfileState: { surface: 'account', activeRole: '' },
    fetch: async (path, options = {}) => {
      requests.push({ path, method: options.method || 'GET' });
      if (failure?.path === path) return response(failure.status, { error: failure.message });
      if (path === '/api/me') return response(200, { id: 17, roles: role ? [role] : [] });
      if (path === '/api/admin/me') return admin ? response(200, admin) : response(403, { error: 'Admin access denied' });
      if (path.startsWith('/api/legal/status?')) {
        const url = new URL(path, 'https://test.invalid');
        return response(200, { action_code: url.searchParams.get('action'), role: url.searchParams.get('role'), requirements: [], review_pending: [{ document_code: 'TEST-DRAFT', title: 'Draft <not active>' }] });
      }
      if (path === '/api/legal/history') return response(200, []);
      if (path === '/api/legal/admin/overview') return response(200, { documents: [] });
      assert.fail('Unexpected API request: ' + path);
    }
  };
  const context = createContext({ window, document, location: { search: '' }, URLSearchParams, Date: Clock, console,
    setTimeout(fn, delay = 0) { if (delay < 250) { clock += delay; queueMicrotask(fn); } return 1; }
  });
  context.__loadModule = async path => {
    imports.push(path);
    if (path === '/legal-ui.js') {
      if (importFailures-- > 0) throw new Error('Legal module temporarily unavailable');
      if (!missingApi) runInContext('(function(){\n' + legalSource + '\n})();', context);
    } else {
      const ids = { '/payments-ui.js': 'paymentCenterBtn', '/incidents-ui.js': 'incidentQuickButton' };
      assert.ok(ids[path], 'Unexpected module: ' + path);
      const button = document.createElement('button'); button.id = ids[path]; button.onclick = () => launches.push(path); document.body.appendChild(button);
    }
    return {};
  };
  assert.equal(loaderSource.split('import(spec.js)').length, 2, 'Update the module-loading seam if the loader changes');
  runInContext('(function(){\n' + loaderSource.replace('import(spec.js)', '__loadModule(spec.js)') + '\n})();', context);
  window.BusinessLifeProfileState = { surface, activeRole: role };
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const open = async (action = 'legal') => {
    document.getElementById('lazyMoreBtn').click();
    await document.querySelector('[data-lazy-action="' + action + '"]').click();
    await settle();
  };
  return { document, window, requests, imports, launches, open, settle };
}

const roles = {
  customer: ['order.create', 'location.share', 'marketing.opt_in'],
  merchant: ['profile.submit', 'platform_fee.accept', 'marketing.opt_in'],
  supplier: ['profile.submit', 'platform_fee.accept', 'marketing.opt_in'],
  courier: ['profile.submit', 'location.share', 'marketing.opt_in'],
  service_provider: ['profile.submit', 'marketing.opt_in']
};
for (const [role, actions] of Object.entries(roles)) {
  test('More → Legal opens the actual center for ordinary ' + role, async () => {
    const h = harness({ role, surface: 'profile' }); await h.open();
    assert.equal(h.document.getElementById('legalTitle').textContent, 'Legal & Privacy Center');
    assert.equal(h.document.getElementById('legalBackdrop').classList.contains('hidden'), false);
    assert.equal(h.document.getElementById('lazyMoreBackdrop').classList.contains('hidden'), true);
    assert.equal(h.document.body.classList.contains('lazyModalOpen'), false);
    assert.equal(h.document.getElementById('legalCenterBtn'), null, 'Lazy mode deliberately omits the legacy launcher');
    assert.equal(h.document.getElementById('lazyFeatureToast'), null);
    const statuses = h.requests.filter(r => r.path.startsWith('/api/legal/status?')).map(r => new URL(r.path, 'https://test.invalid'));
    assert.deepEqual(statuses.map(url => url.searchParams.get('action')), actions);
    assert.ok(statuses.every(url => url.searchParams.get('role') === role));
    assert.equal(h.document.querySelector('[data-ltab="admin"]'), null);
    assert.ok(!h.requests.some(r => r.path.startsWith('/api/legal/admin/')));
    assert.ok(h.requests.every(r => r.method === 'GET'), 'Navigation never accepts or activates a document');
  });
}

test('Account Home uses general legal context, not a stored Merchant role', async () => {
  const h = harness({ role: 'merchant', surface: 'account' }); await h.open();
  assert.ok(h.document.getElementById('legalRequired'));
  const statuses = h.requests.filter(r => r.path.startsWith('/api/legal/status?'));
  assert.equal(statuses.length, 1);
  assert.equal(new URL(statuses[0].path, 'https://test.invalid').searchParams.get('role'), '*');
});

for (const admin of [
  { is_admin: true, permissions: ['legal.view'], assignments: [] },
  { is_admin: true, permissions: [], assignments: [{ admin_role: 'super_admin' }] }
]) test('Authorized Legal Admin presentation follows existing permission/assignment rules ' + JSON.stringify(admin), async () => {
  const h = harness({ admin }); await h.open();
  assert.ok(h.document.querySelector('[data-ltab="admin"]'));
  assert.equal(h.requests.filter(r => r.path === '/api/legal/admin/overview').length, 1);
  assert.ok(h.requests.every(r => r.method === 'GET'));
});

test('Delegated Admin without legal.view does not acquire Legal Admin', async () => {
  const h = harness({ admin: { is_admin: true, permissions: [], assignments: [{ admin_role: 'territory_admin' }] } }); await h.open();
  assert.ok(h.document.getElementById('legalRequired'));
  assert.equal(h.document.querySelector('[data-ltab="admin"]'), null);
  assert.ok(!h.requests.some(r => r.path === '/api/legal/admin/overview'));
});

test('Pending drafts remain non-binding and History is usable', async () => {
  const h = harness({ role: 'merchant', surface: 'profile' }); await h.open();
  const required = h.document.getElementById('legalRequired');
  assert.match(required.innerHTML, /not active legal terms/);
  assert.match(required.innerHTML, /Draft &lt;not active&gt;/);
  assert.match(required.innerHTML, /Exact-version acceptance/);
  assert.match(h.document.getElementById('legalHistory').innerHTML, /No legal acceptance history yet/);
  h.document.querySelector('[data-ltab="history"]').click();
  assert.equal(h.document.getElementById('legalHistory').classList.contains('hidden'), false);
  assert.equal(required.classList.contains('hidden'), true);
  assert.ok(h.requests.every(r => r.method === 'GET'));
});

test('Repeated Legal opens share one import, stylesheet and sheet', async () => {
  const h = harness(); await h.open(); h.window.BusinessLifeLegal.close(); await h.open();
  assert.equal(h.imports.filter(path => path === '/legal-ui.js').length, 1);
  assert.equal(h.document.querySelectorAll('#legalBackdrop').length, 1);
  assert.equal(h.document.head.querySelectorAll('link[data-lazy-css="/legal.css"]').length, 1);
  assert.equal(h.document.getElementById('legalBackdrop').classList.contains('hidden'), false);
});

test('Failed Legal import is reported and the next click retries', async () => {
  const h = harness({ failImport: true }); await h.open();
  assert.match(h.document.getElementById('lazyFeatureToast').textContent, /temporarily unavailable/);
  assert.equal(h.document.getElementById('lazyMoreBackdrop').classList.contains('hidden'), true);
  await h.open();
  assert.equal(h.imports.length, 2);
  assert.equal(h.document.getElementById('legalBackdrop').classList.contains('hidden'), false);
  assert.ok(h.document.getElementById('legalRequired'));
  assert.equal(h.document.head.querySelectorAll('link[data-lazy-css="/legal.css"]').length, 1);
});

test('Missing Legal module API produces a Legal-specific loading error', async () => {
  const h = harness({ missingApi: true }); await h.open();
  assert.equal(h.document.getElementById('lazyFeatureToast').textContent, 'Legal & Privacy could not finish loading.');
  assert.equal(h.requests.length, 0);
});

for (const failure of [
  { path: '/api/me', status: 401, message: 'Please sign in again' },
  { path: '/api/legal/history', status: 503, message: 'History temporarily unavailable' }
]) test('Legal read failure is displayed without mutation: ' + failure.path, async () => {
  const h = harness({ failure }); await h.open();
  assert.match(h.document.getElementById('legalBody').innerHTML, new RegExp(failure.message));
  assert.equal(h.document.getElementById('legalBackdrop').classList.contains('hidden'), false);
  assert.equal(h.document.getElementById('lazyFeatureToast'), null);
  assert.ok(h.requests.every(r => r.method === 'GET'));
});

for (const [action, path, id] of [
  ['payments', '/payments-ui.js', 'paymentCenterBtn'],
  ['report', '/incidents-ui.js', 'incidentQuickButton']
]) test('Other More action keeps its existing launcher: ' + action, async () => {
  const h = harness(); await h.open(action);
  assert.deepEqual(h.launches, [path]);
  assert.equal(h.document.getElementById(id).hidden, true);
  assert.equal(h.document.getElementById('lazyMoreBackdrop').classList.contains('hidden'), true);
});

test('Signed-out shell does not mount authenticated More launchers', () => {
  const h = harness({ authenticated: false });
  assert.equal(h.document.getElementById('lazyMoreBtn'), null);
  assert.equal(h.imports.length, 0);
  assert.equal(h.requests.length, 0);
});
