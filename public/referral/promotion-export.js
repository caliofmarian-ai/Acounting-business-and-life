import { getMarketingKitExportSize, getMarketingKitTemplate, marketingKitFileName } from './marketing-kit-runtime.js';

export function decodePromotionImage(source, { ImageCtor = globalThis.Image, timeoutMs = 12000, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof ImageCtor !== 'function') return reject(new Error('Image decoding is unavailable'));
    const image = new ImageCtor();
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
      image.onload = null;
      image.onerror = null;
      if (error || !image.naturalWidth || !image.naturalHeight) { image.src = ''; reject(error || new Error('Image decoding failed')); }
      else resolve(image);
    };
    const aborted = () => finish(signal.reason || new Error('Image decoding aborted'));
    const timer = setTimeout(() => finish(new Error('Image decoding timed out')), timeoutMs);
    if (signal?.aborted) { aborted(); return; }
    signal?.addEventListener('abort', aborted, { once: true });
    image.onload = () => finish();
    image.onerror = () => finish(new Error('Image decoding failed'));
    image.src = source;
    if (typeof image.decode === 'function') image.decode().then(() => finish(), error => finish(error));
    else if (image.complete) finish();
  });
}

export async function createMarketingKitExport({ svg, templateId, referralCode, locale, format = 'png', timeoutMs = 12000 }, runtime = globalThis) {
  if (!['png', 'jpg', 'svg'].includes(format) || typeof svg !== 'string' || !svg.startsWith('<svg')) throw new TypeError('Invalid export request');
  const filename = marketingKitFileName(templateId, referralCode, locale, format);
  const vector = new runtime.Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  if (format === 'svg') return { blob: vector, filename, mimeType: 'image/svg+xml' };
  const size = getMarketingKitExportSize(templateId, { dpi: 300 });
  if (!Number.isInteger(size.width) || !Number.isInteger(size.height) || size.width * size.height > 16000000) throw new RangeError('Export is too large for this device');
  const objectUrl = runtime.URL.createObjectURL(vector);
  let canvas;
  try {
    const image = await decodePromotionImage(objectUrl, { ImageCtor: runtime.Image, timeoutMs });
    canvas = runtime.document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image export is unavailable');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(image, 0, 0, size.width, size.height);
    const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png';
    const blob = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Image export timed out')), timeoutMs);
      try { canvas.toBlob(value => { clearTimeout(timer); value && value.type === mimeType ? resolve(value) : reject(new Error('Image export failed')); }, mimeType, 0.94); }
      catch (error) { clearTimeout(timer); reject(error); }
    });
    return { blob, filename, mimeType, width: size.width, height: size.height };
  } finally {
    runtime.URL.revokeObjectURL(objectUrl);
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

export function downloadPromotionFile(file, runtime = globalThis) {
  const url = runtime.URL.createObjectURL(file.blob);
  const anchor = runtime.document.createElement('a');
  anchor.href = url;
  anchor.download = file.filename;
  runtime.document.body.append(anchor);
  try { anchor.click(); }
  finally {
    anchor.remove();
    // Give mobile browsers time to hand the object URL to their download manager.
    runtime.setTimeout(() => runtime.URL.revokeObjectURL(url), 30000);
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

export function promotionPrintDocument({ svg, templateId, locale = 'en-PH', title, help, action, close }) {
  const template = getMarketingKitTemplate(templateId);
  const widthMm = template.print?.widthMm || Number((template.width * 25.4 / 96).toFixed(2));
  const heightMm = template.print?.heightMm || Number((template.height * 25.4 / 96).toFixed(2));
  if (!Number.isFinite(widthMm) || !Number.isFinite(heightMm) || !svg.startsWith('<svg')) throw new TypeError('Invalid print design');
  return '<!doctype html><html lang="' + escapeHtml(locale) + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + escapeHtml(title) + '</title><style>html,body{margin:0;background:#edf1f4;font:16px system-ui;color:#142139}.tools{padding:18px;max-width:800px;margin:auto}.tools button{font:inherit;padding:12px 18px;margin:6px 8px 6px 0;cursor:pointer}.sheet{width:' + widthMm + 'mm;height:' + heightMm + 'mm;margin:20px auto;background:white}.sheet>svg{display:block;width:100%;height:100%}@page{size:' + widthMm + 'mm ' + heightMm + 'mm;margin:0}@media print{html,body{background:white}.tools{display:none}.sheet{margin:0;width:' + widthMm + 'mm;height:' + heightMm + 'mm;break-after:avoid;break-inside:avoid}}</style></head><body>'
    + '<div class="tools"><h1>' + escapeHtml(title) + '</h1><p>' + escapeHtml(help) + '</p><p class="paperSize">' + widthMm + ' × ' + heightMm + ' mm</p><button type="button" id="print">' + escapeHtml(action) + '</button><button type="button" id="close">' + escapeHtml(close) + '</button></div><div class="sheet">' + svg + '</div>'
    + '<script>document.getElementById("print").onclick=function(){window.print()};document.getElementById("close").onclick=function(){window.close()};<\/script></body></html>';
}
