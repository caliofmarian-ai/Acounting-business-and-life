// Build a restricted Markdown view with DOM nodes. Repository HTML and images
// remain text; links are restricted and content is never assigned to innerHTML.
export function safeMarkdownLink(raw, links = {}) {
  if (/[\u0000-\u0020\u007f\\]/.test(raw)) return null;
  if (Object.hasOwn(links, raw)) return '/knowledge?document=' + encodeURIComponent(links[raw]);
  if (/^\/help(?:\/|$)/.test(raw) && !/[\\\s]/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

function inline(parent, text, links) {
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^\s)]+\))/g;
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    parent.append(document.createTextNode(text.slice(start, match.index)));
    const part = match[0];
    if (part.startsWith('`')) { const code = document.createElement('code'); code.textContent = part.slice(1, -1); parent.append(code); }
    else if (part.startsWith('**')) { const strong = document.createElement('strong'); strong.textContent = part.slice(2, -2); parent.append(strong); }
    else {
      const [, label, raw] = /^\[([^\]]+)\]\((.+)\)$/.exec(part);
      const href = safeMarkdownLink(raw, links);
      if (href) {
        const a = document.createElement('a'); a.textContent = label; a.href = href;
        if (/^https?:/.test(href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; a.referrerPolicy = 'no-referrer'; }
        parent.append(a);
      } else parent.append(document.createTextNode(label));
    }
    start = match.index + part.length;
  }
  parent.append(document.createTextNode(text.slice(start)));
}

export function renderMarkdown(markdown, links = {}) {
  const root = document.createElement('div'); root.className = 'document-body';
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  let list = null, code = null, paragraph = [], table = null;
  const flush = () => { if (paragraph.length) { const p = document.createElement('p'); inline(p, paragraph.join(' '), links); root.append(p); paragraph = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) {
      flush(); list = null; table = null;
      if (code) code = null;
      else { const pre = document.createElement('pre'); code = document.createElement('code'); pre.append(code); root.append(pre); }
      continue;
    }
    if (code) { code.append(document.createTextNode(line + '\n')); continue; }
    if (!line.trim()) { flush(); list = null; table = null; continue; }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    const bullet = /^\s*(?:([-*])|\d+\.)\s+(.+)$/.exec(line);
    if (heading) { flush(); list = null; table = null; const h = document.createElement('h' + heading[1].length); inline(h, heading[2], links); root.append(h); }
    else if (line.startsWith('|') && line.endsWith('|')) {
      flush(); list = null;
      if (/^\|[\s:|-]+\|$/.test(line)) continue;
      const header = !table;
      if (!table) { const wrap = document.createElement('div'); wrap.className = 'table-scroll'; wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', 'Document table'); table = document.createElement('table'); wrap.append(table); root.append(wrap); }
      const tr = document.createElement('tr');
      for (const cell of line.slice(1, -1).split('|')) { const td = document.createElement(header ? 'th' : 'td'); inline(td, cell.trim(), links); tr.append(td); }
      table.append(tr);
    } else if (bullet) {
      flush(); table = null; const tag = bullet[1] ? 'UL' : 'OL';
      if (!list || list.tagName !== tag) { list = document.createElement(tag.toLowerCase()); root.append(list); }
      const li = document.createElement('li'); inline(li, bullet[2], links); list.append(li);
    } else if (line.startsWith('>')) { flush(); list = null; table = null; const q = document.createElement('blockquote'); inline(q, line.replace(/^>\s?/, ''), links); root.append(q); }
    else if (/^---+$/.test(line)) { flush(); list = null; table = null; root.append(document.createElement('hr')); }
    else { if (list || table) flush(); list = null; table = null; paragraph.push(line); }
  }
  flush(); return root;
}
