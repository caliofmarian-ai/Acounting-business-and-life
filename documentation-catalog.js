import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCESS_CLASSES } from './documentation-access.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
export const CONTROLLED_DOC_ROOTS = Object.freeze([
  'docs/governance', 'docs/masterplan', 'docs/roles', 'docs/compliance/ph',
  'docs/forms', 'docs/sop', 'docs/pitch', 'docs/agreements', 'docs/training'
]);
const CATEGORIES = Object.freeze({ governance: 'Management', masterplan: 'Management',
  roles: 'My role', compliance: 'Compliance', forms: 'Forms', sop: 'SOPs',
  pitch: 'Management', agreements: 'Agreements', training: 'Training' });
const STATUSES = new Set(['DRAFT', 'IN_REVIEW', 'APPROVED', 'EFFECTIVE', 'SUPERSEDED', 'RETIRED']);
export const DOCUMENT_ID = /^BL-[A-Z0-9-]{3,116}$/;
const unquote = value => value.replace(/^(["'])(.*)\1$/, '$2');

// The controlled files use this deliberately small front-matter format. Unknown
// or ambiguous syntax is excluded rather than interpreting arbitrary YAML.
export function parseControlledMarkdown(text) {
  const raw = String(text).replace(/\r\n/g, '\n');
  if (!raw.startsWith('---\n')) return null;
  const end = raw.indexOf('\n---\n', 4);
  if (end < 0) return null;
  const meta = Object.create(null);
  for (const line of raw.slice(4, end).split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const m = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!m || Object.hasOwn(meta, m[1])) return null;
    const [, key, value] = m;
    if (key.startsWith('applicable_')) {
      if (!/^\[[^\[\]]*\]$/.test(value)) return null;
      meta[key] = value.slice(1, -1).split(',').map(v => unquote(v.trim())).filter(Boolean);
    } else meta[key] = unquote(value.trim());
  }
  const id = meta.document_id || meta.template_id;
  // Template IDs explicitly encode their jurisdiction; older canonical form
  // headers omit the redundant country/scope fields.
  if (meta.template_id && !meta.country_code) meta.country_code = /^BL-\d+-(PH|GLB)-/.exec(id)?.[1];
  if (meta.template_id && !meta.territory_scope) meta.territory_scope = meta.country_code === 'GLB' ? 'global' : 'country';
  if (!DOCUMENT_ID.test(id || '') || !meta.title || !meta.version
      || !STATUSES.has(meta.status) || !ACCESS_CLASSES.includes(meta.access_class)
      || !['PH', 'GLB'].includes(meta.country_code)
      || !['global', 'country', 'national'].includes(meta.territory_scope)
      || Object.hasOwn(meta, 'territory_id')) return null;
  return { meta, markdown: raw.slice(end + 5) };
}

function inside(base, path) {
  const p = relative(base, path);
  return p !== '..' && !p.startsWith('..' + sep) && !isAbsolute(p);
}

export function loadControlledDocuments(baseDir = ROOT) {
  const base = realpathSync(baseDir), documents = [], ids = new Set();
  function walk(folder) {
    const files = [];
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const file = join(folder, entry.name);
      if (!inside(base, realpathSync(file))) continue;
      if (entry.isDirectory()) files.push(...walk(file));
      else if (entry.isFile() && entry.name.endsWith('.md')) files.push(file);
    }
    return files;
  }
  for (const root of CONTROLLED_DOC_ROOTS) {
    const dir = join(base, root);
    let actual;
    try { actual = realpathSync(dir); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (!inside(base, actual)) continue;
    for (const file of walk(actual)) {
      if (statSync(file).size > 256 * 1024) throw new Error('Controlled document exceeds size limit');
      const parsed = parseControlledMarkdown(readFileSync(file, 'utf8'));
      if (!parsed) continue;
      const { meta, markdown } = parsed, id = meta.document_id || meta.template_id;
      if (ids.has(id)) throw new Error('Duplicate controlled document identifier');
      ids.add(id);
      const path = relative(base, file).split(sep).join('/');
      const category = CATEGORIES[path.split('/')[1]];
      documents.push({ id, title: meta.title, document_type: meta.document_type || 'template',
        status: meta.status, access_class: meta.access_class,
        applicable_profiles: meta.applicable_profiles || [], applicable_functions: meta.applicable_functions || [],
        country_code: meta.country_code, territory_scope: meta.territory_scope, version: meta.version,
        effective_date: meta.effective_date || null, legal_review: meta.legal_review || null,
        category, markdown, relative_path: path });
      if (documents.length > 200) throw new Error('Controlled catalog exceeds bounded list size');
    }
  }
  return documents.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
}

export function documentMetadata(doc) {
  const { id, title, document_type, status, access_class, country_code, territory_scope,
    version, effective_date, legal_review, category } = doc;
  return { id, title, document_type, status, access_class, country_code, territory_scope,
    version, effective_date, legal_review, category };
}

export function authorizedDocumentLinks(doc, documents) {
  const links = Object.create(null), byPath = new Map(documents.map(d => [resolve(ROOT, d.relative_path), d.id]));
  for (const m of doc.markdown.matchAll(/\[[^\]\n]+\]\(([^\s)]+)\)/g)) {
    const href = m[1];
    if (/^[a-z]+:|^\/|^#|\\/i.test(href)) continue;
    const [path] = href.split('#');
    const id = byPath.get(resolve(ROOT, dirname(doc.relative_path), path));
    if (id) links[href] = id;
  }
  return links;
}
