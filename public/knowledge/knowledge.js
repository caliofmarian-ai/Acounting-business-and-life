import { renderMarkdown } from './markdown.js';

const $ = id => document.getElementById(id);
let documents = [], selectedId = '', catalogEpoch = 0, documentEpoch = 0, pending, catalogReady = false;
function node(tag, text, className) { const el = document.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el; }
function state(target, title, message, retry = null, signIn = false) {
  const box = node('div', '', 'state' + (retry ? ' state-error' : ''));
  box.append(node('strong', title), node('p', message));
  if (retry) { const button = node('button', 'Try again'); button.type = 'button'; button.addEventListener('click', retry); box.append(button); }
  if (signIn) { const link = node('a', 'Sign in', 'button'); link.href = '/'; box.append(link); }
  target.replaceChildren(box);
}
async function api(path, signal) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal, headers: { Accept: 'application/json' } });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'Please try again.'), { status: response.status });
  return data;
}
function clearPrivateView() {
  catalogEpoch++; documentEpoch++; pending?.abort(); documents = []; selectedId = ''; catalogReady = false;
  $('catalog').setAttribute('aria-busy', 'false'); $('reader').setAttribute('aria-busy', 'false');
  $('access').replaceChildren(); $('access').hidden = true; $('adminLocked').hidden = true;
  $('resultCount').textContent = '';
  $('category').replaceChildren(new Option('All topics', '')); $('search').value = '';
  state($('catalog'), 'Sign in to open Knowledge', 'Your account access is checked before documents are shown.', null, true);
  state($('document'), 'Session ended', 'Sign in again to open your documents.', null, true);
}
function renderList() {
  if (!catalogReady) return;
  const query = $('search').value.toLowerCase().trim(), category = $('category').value;
  const filtered = documents.filter(d => (!category || d.category === category)
    && [d.title, d.id, d.category, d.document_type].join(' ').toLowerCase().includes(query));
  $('resultCount').textContent = filtered.length + (filtered.length === 1 ? ' document' : ' documents');
  const cards = filtered.map(doc => {
    const button = node('button', '', 'doc-card'); button.type = 'button'; button.dataset.documentId = doc.id;
    button.setAttribute('aria-current', String(doc.id === selectedId));
    button.append(node('strong', doc.title), node('small', doc.category + ' · v' + doc.version), node('span', doc.status.replaceAll('_', ' '), 'status' + (doc.status === 'EFFECTIVE' ? ' effective' : '')));
    button.addEventListener('click', () => openDocument(doc.id)); return button;
  });
  $('catalog').replaceChildren(...cards);
  if (!cards.length) state($('catalog'), documents.length ? 'No matching documents' : 'No documents available yet', documents.length ? 'Try a different title, topic or document ID.' : 'Documents appear here when your enabled profiles or assigned responsibilities allow access.');
}
function showReader() {
  $('knowledge').classList.add('reading'); $('reader').classList.add('active'); $('backToList').hidden = false;
}
async function openDocument(id, { updateUrl = true } = {}) {
  const epoch = ++documentEpoch; pending?.abort(); pending = new AbortController();
  selectedId = id; renderList(); showReader();
  state($('document'), 'Opening document…', 'Checking your current access.'); $('reader').setAttribute('aria-busy', 'true');
  if (updateUrl) history.replaceState(null, '', '/knowledge?document=' + encodeURIComponent(id));
  try {
    const doc = await api('/api/knowledge/documents/' + encodeURIComponent(id), pending.signal);
    if (epoch !== documentEpoch) return;
    const head = node('div', '', 'document-head'); head.append(node('span', doc.category, 'eyebrow'), node('h2', doc.title));
    const meta = node('div', '', 'document-meta'); meta.append(node('span', doc.id), node('span', 'Version ' + doc.version), node('span', doc.status.replaceAll('_', ' '), 'pill'), node('span', doc.access_class.replaceAll('_', ' ')));
    if (doc.effective_date) meta.append(node('span', 'Effective ' + doc.effective_date)); head.append(meta);
    if (doc.status !== 'EFFECTIVE') head.append(node('p', doc.status === 'DRAFT' || doc.status === 'IN_REVIEW'
      ? 'Draft guidance — this document has not been activated as binding policy. Reading it does not record acceptance or grant authorization.'
      : 'This is not a current effective policy. Check the status and applicable version before relying on it.', 'document-notice'));
    $('document').replaceChildren(head, renderMarkdown(doc.markdown, doc.links)); $('reader').focus({ preventScroll: true });
    if (matchMedia('(max-width:850px)').matches) window.scrollTo({ top: 0, behavior: 'instant' });
  } catch (error) {
    if (epoch !== documentEpoch || error.name === 'AbortError') return;
    if (error.status === 401) { clearPrivateView(); return; }
    state($('document'), error.status === 404 ? 'Document unavailable' : 'Document could not be opened', error.message, () => openDocument(id));
  } finally { if (epoch === documentEpoch) $('reader').setAttribute('aria-busy', 'false'); }
}
async function loadCatalog() {
  const epoch = ++catalogEpoch; documentEpoch++; pending?.abort();
  documents = []; selectedId = ''; catalogReady = false; $('access').hidden = true; $('adminLocked').hidden = true;
  $('catalog').setAttribute('aria-busy', 'true'); $('resultCount').textContent = 'Loading your documents…';
  state($('catalog'), 'Loading Knowledge…', 'Finding the documents available to your account.');
  state($('document'), 'Your document library', 'Select a document to read it here.');
  try {
    const data = await api('/api/knowledge/catalog'); if (epoch !== catalogEpoch) return;
    documents = data.documents; catalogReady = true; $('access').replaceChildren(node('strong', 'What you can see'), node('span', data.access.document_count + ' documents available'));
    for (const profile of data.access.profiles) $('access').append(node('span', profile.replaceAll('_', ' '), 'pill'));
    if (data.access.business_guidance) $('access').append(node('span', 'Business guidance', 'pill'));
    if (data.access.admin_available && !data.access.admin_locked) $('access').append(node('span', 'Assigned Admin guidance', 'pill'));
    $('access').hidden = false; $('adminLocked').hidden = !data.access.admin_locked;
    $('category').replaceChildren(new Option('All topics', ''), ...[...new Set(documents.map(d => d.category))].sort().map(c => new Option(c, c)));
    renderList();
    const requested = new URLSearchParams(location.search).get('document');
    if (requested && documents.some(d => d.id === requested)) await openDocument(requested, { updateUrl: false });
    else if (requested) { showReader(); state($('document'), 'Document unavailable', 'This document is not available for your current account access.'); }
  } catch (error) {
    if (epoch !== catalogEpoch) return;
    if (error.status === 401) { clearPrivateView(); return; }
    $('resultCount').textContent = 'Documents unavailable';
    state($('catalog'), 'Knowledge could not be loaded', error.message, loadCatalog);
  } finally { if (epoch === catalogEpoch) $('catalog').setAttribute('aria-busy', 'false'); }
}
$('search').addEventListener('input', renderList); $('category').addEventListener('change', renderList);
$('refreshAccess').addEventListener('click', loadCatalog);
$('backToList').addEventListener('click', () => { $('knowledge').classList.remove('reading'); $('reader').classList.remove('active'); documentEpoch++; pending?.abort(); history.replaceState(null, '', '/knowledge'); $('search').focus({ preventScroll: true }); });
document.addEventListener('abl:auth-expired', clearPrivateView);
window.addEventListener('pagehide', clearPrivateView);
window.addEventListener('pageshow', event => { if (event.persisted) loadCatalog(); });
// Another tab may revoke/switch the session; clear old contents before reloading.
document.addEventListener('visibilitychange', () => { if (document.hidden) clearPrivateView(); else loadCatalog(); });
loadCatalog();
