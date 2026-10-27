const template = (id, label, filipinoLabel, width, height, layout, print) => Object.freeze({
  id, label, labels: Object.freeze({ 'en-PH': label, 'fil-PH': filipinoLabel }), width, height, layout,
  ...(print ? { print: Object.freeze(print) } : {})
});

export const RUNTIME_MARKETING_TEMPLATES = Object.freeze([
  template('A4_REFERRAL_POSTER_V1', 'A4 referral poster', 'A4 na poster', 794, 1123, 'poster', { widthMm: 210, heightMm: 297 }),
  template('SOCIAL_SQUARE_REFERRAL_V1', 'Social square', 'Parisukat para sa social media', 1080, 1080, 'social'),
  template('STORY_REFERRAL_V1', 'Story / Status', 'Story / Status', 1080, 1920, 'story'),
  template('A5_REFERRAL_FLYER_V1', 'A5 referral flyer', 'A5 na flyer', 559, 794, 'poster', { widthMm: 148, heightMm: 210 }),
  template('REFERRAL_CARD_V1', 'Referral card', 'Referral card', 1050, 600, 'card'),
  template('COUNTER_CARD_V1', 'Counter card', 'Card sa counter', 1200, 800, 'counter'),
  template('WINDOW_STICKER_V1', 'Window sticker', 'Sticker sa bintana', 1080, 1080, 'sticker'),
  template('LINKEDIN_REFERRAL_V1', 'LinkedIn landscape', 'Pahalang para sa LinkedIn', 1200, 627, 'landscape'),
  template('EMAIL_WEB_BANNER_V1', 'Email / web banner', 'Banner para sa email / web', 1200, 400, 'banner'),
  template('QR_PHONE_CARD_V1', 'QR phone card', 'QR card sa telepono', 1080, 1920, 'phone'),
  template('BRANDED_INVITATION_V1', 'Branded invitation', 'Imbitasyong may tatak', 1536, 1536, 'branded-invitation')
]);
export const RUNTIME_MARKETING_COPY = Object.freeze({
  "en-PH": {
    "locale": "en-PH",
    "version": "1.0.0",
    "brand": "Business & Life",
    "reusable": {
      "brandLine": "BUSINESS & LIFE",
      "scanCta": "SCAN TO START",
      "referralCodeLabel": "Referral code: {REFERRAL_CODE}",
      "recommendedBy": "Recommended by {REFERRER_NAME}",
      "governanceNote": "Referral credit never bypasses operational profile approval."
    },
    "variants": [
      {
        "id": "clarity_v1",
        "headline": "Run your business. Understand your money.",
        "body": "One account for the tools and profiles available to you."
      },
      {
        "id": "money_visibility_v1",
        "headline": "Know where your money goes.",
        "body": "Business and personal money can be easier to understand when the right information lives in one place."
      },
      {
        "id": "personal_share_v1",
        "headline": "You’ve been invited to try Business & Life.",
        "body": "Use the referral link or QR code to get started."
      }
    ],
    "prohibitedClaims": [
      "Guaranteed savings",
      "Guaranteed profit",
      "Automatic business approval",
      "Government-approved accounting",
      "Guaranteed tax compliance"
    ]
  },
  "fil-PH": {
    "locale": "fil-PH",
    "version": "1.0.0",
    "brand": "Business & Life",
    "reusable": {
      "brandLine": "BUSINESS & LIFE",
      "scanCta": "I-SCAN PARA MAGSIMULA",
      "referralCodeLabel": "Referral code: {REFERRAL_CODE}",
      "recommendedBy": "Inirerekomenda ni {REFERRER_NAME}",
      "governanceNote": "Hindi nilalaktawan ng referral credit ang kinakailangang pag-apruba ng operational profile."
    },
    "variants": [
      {
        "id": "clarity_v1",
        "headline": "Patakbuhin ang iyong negosyo. Unawain ang iyong pera.",
        "body": "Isang account para sa mga tool at profile na available sa iyo."
      },
      {
        "id": "money_visibility_v1",
        "headline": "Alamin kung saan napupunta ang iyong pera.",
        "body": "Mas madaling unawain ang pera ng negosyo at personal na pera kapag nasa iisang lugar ang tamang impormasyon."
      },
      {
        "id": "personal_share_v1",
        "headline": "Inimbitahan kang subukan ang Business & Life.",
        "body": "Gamitin ang referral link o QR code para magsimula."
      }
    ],
    "prohibitedClaims": [
      "Garantisadong matitipid",
      "Garantisadong kita",
      "Awtomatikong pag-apruba ng negosyo",
      "Accounting na aprubado ng gobyerno",
      "Garantisadong pagsunod sa buwis"
    ]
  }
});

export const SUPPORTED_MARKETING_LOCALES = Object.freeze(['en-PH','fil-PH']);

const TEMPLATE_BY_ID = new Map(RUNTIME_MARKETING_TEMPLATES.map(item => [item.id, item]));
const QR_DATA_URL_RE = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
const BRAND_DATA_URL_RE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const REFERRAL_CODE_RE = /^r1_[A-Za-z0-9_-]{16}$/;
const FONT = 'Arial,Helvetica,sans-serif';
const MONO_FONT = 'ui-monospace,SFMono-Regular,Menlo,monospace';

function cleanText(value) {
  // XML 1.0 forbids these controls, even when the surrounding markup is escaped.
  return String(value ?? '').replace(/[\uD800-\uDFFF]/gu, '\uFFFD').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').trim();
}
function xmlEscape(value) {
  return cleanText(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}
function interpolate(value, fields) {
  return String(value).replace(/\{([A-Z_]+)\}/g, (_, key) => String(fields[key] ?? ''));
}
function rounded(value) { return Math.round(value * 100) / 100; }

export function getMarketingKitTemplate(templateId) {
  const selected = TEMPLATE_BY_ID.get(String(templateId || ''));
  if (!selected) throw new TypeError('unknown marketing template');
  return selected;
}
export function getMarketingKitExportSize(templateId, { dpi = 300 } = {}) {
  const selected = getMarketingKitTemplate(templateId);
  if (!Number.isFinite(dpi) || dpi < 72 || dpi > 600) throw new RangeError('export resolution must be between 72 and 600 DPI');
  return selected.print
    ? Object.freeze({ width: Math.round(selected.print.widthMm * dpi / 25.4), height: Math.round(selected.print.heightMm * dpi / 25.4) })
    : Object.freeze({ width: selected.width, height: selected.height });
}
export function resolveMarketingKitCopy(locale = 'en-PH', variantId = 'personal_share_v1') {
  const selectedLocale = SUPPORTED_MARKETING_LOCALES.includes(locale) ? locale : 'en-PH';
  const pack = RUNTIME_MARKETING_COPY[selectedLocale];
  const variant = pack.variants.find(item => item.id === variantId) || pack.variants.find(item => item.id === 'personal_share_v1') || pack.variants[0];
  return Object.freeze({ locale: selectedLocale, pack, variant });
}
export function deriveReferrerName(shareText) {
  const value = cleanText(shareText);
  const suffix = ' invited you to try Business & Life.';
  if (value.endsWith(suffix)) {
    const name = value.slice(0, -suffix.length).trim();
    if (name && name.length <= 120 && !/^you$/i.test(name)) return name;
  }
  return 'Business & Life member';
}
export function normalizeMarketingKitFields(input = {}) {
  const referrerName = cleanText(input.referrerName) || 'Business & Life member';
  const referralCode = cleanText(input.referralCode);
  const referralUrl = cleanText(input.referralUrl);
  const qrDataUrl = cleanText(input.qrDataUrl);
  if (referrerName.length > 120) throw new RangeError('referrer name must contain no more than 120 characters');
  if (!REFERRAL_CODE_RE.test(referralCode)) throw new TypeError('valid referral code is required');
  if (referralUrl.length > 2048) throw new RangeError('referral URL is too long');
  let parsed;
  try { parsed = new URL(referralUrl); } catch { throw new TypeError('valid referral URL is required'); }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash || parsed.pathname !== '/referral/' || parsed.searchParams.get('ref') !== referralCode) {
    throw new TypeError('referral URL must match the canonical referral identity');
  }
  if (qrDataUrl.length > 500000 || !QR_DATA_URL_RE.test(qrDataUrl)) throw new TypeError('local PNG QR asset is required');
  return Object.freeze({ referrerName, referralCode, referralUrl: parsed.toString(), qrDataUrl });
}
function normalizeBrandAsset(input) {
  if (input == null) return null;
  const dataUrl = cleanText(input.dataUrl), alt = cleanText(input.alt);
  if (dataUrl.length > 8000000 || !BRAND_DATA_URL_RE.test(dataUrl)) throw new TypeError('brand artwork must be an embedded PNG, JPEG or WebP image');
  if (!alt || alt.length > 200) throw new TypeError('brand artwork needs a short image description');
  return Object.freeze({ dataUrl, alt });
}
export function marketingKitFileName(templateId, referralCode, locale = 'en-PH', format = 'svg') {
  const selected = getMarketingKitTemplate(templateId);
  if (!REFERRAL_CODE_RE.test(String(referralCode || ''))) throw new TypeError('valid referral code is required');
  const extension = format === 'jpeg' ? 'jpg' : String(format).toLowerCase();
  if (!['svg', 'png', 'jpg', 'pdf'].includes(extension)) throw new TypeError('unsupported marketing export format');
  const safeLocale = SUPPORTED_MARKETING_LOCALES.includes(locale) ? locale.toLowerCase() : 'en-ph';
  return `business-life-${selected.id.toLowerCase().replaceAll('_', '-')}-${safeLocale}-${referralCode}.${extension}`;
}

// The SVG explicitly sets each line's textLength. These conservative character
// advances choose line breaks; the exported geometry remains bounded on devices
// with a different fallback font, without depending on canvas or remote fonts.
function textWidth(value, size, mono = false) {
  let units = 0;
  for (const char of value) {
    if (mono) units += .62;
    else if (/\s/u.test(char)) units += .3;
    else if (/[ilI1.,:;'!|]/u.test(char)) units += .3;
    else if (/[MWmw@%&]/u.test(char)) units += .88;
    else if (/[A-Z0-9]/u.test(char)) units += .65;
    else if (/[^\x00-\xFF]/u.test(char)) units += /[‘’“”–—]/u.test(char) ? .45 : .82;
    else units += .55;
  }
  return units * size;
}
function wrapText(value, maxWidth, size, mono = false) {
  const words = value.replace(/\s+/gu, ' ').split(' '), lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? line + ' ' + word : word;
    if (textWidth(candidate, size, mono) <= maxWidth) { line = candidate; continue; }
    if (textWidth(word, size, mono) <= maxWidth) {
      if (line) lines.push(line);
      line = word;
      continue;
    }
    if (line) line += ' ';
    for (const char of word) {
      if (line && textWidth(line + char, size, mono) > maxWidth) { lines.push(line.trimEnd()); line = ''; }
      line += char;
    }
  }
  if (line) lines.push(line);
  return lines;
}
function fitText(role, value, box, size, { mono = false, fill = '#122d35', weight = 500, minSize = 11 } = {}) {
  const content = cleanText(value).replace(/\s+/gu, ' ');
  for (let fontSize = Math.round(size); fontSize >= minSize; fontSize--) {
    const lineHeight = rounded(fontSize * 1.28), lines = wrapText(content, box.width, fontSize, mono);
    if (lines.length * lineHeight > box.height) continue;
    return { role, content, ...box, fontSize, lineHeight, mono, fill, weight,
      lines: lines.map((line, index) => ({ text: line, x: box.x, y: rounded(box.y + fontSize + index * lineHeight), width: rounded(textWidth(line, fontSize, mono)) })) };
  }
  throw new RangeError('This text is too long for the selected format. Choose a larger format.');
}
function layoutRegions(selected) {
  const { width: w, height: h, layout } = selected;
  const rect = (x, y, width, height) => ({ x: rounded(x * w), y: rounded(y * h), width: rounded(width * w), height: rounded(height * h) });
  const qr = (x, y, width) => ({ x: rounded(x * w), y: rounded(y * h), width: rounded(width * w), height: rounded(width * w) });
  const common = { header: rect(.055, .035, .89, .065) };
  if (layout === 'branded-invitation') return {
    hero: { x: 0, y: 0, width: 1536, height: 1024 },
    footer: { x: 0, y: 1024, width: 1536, height: 512 },
    info: { x: 56, y: 1056, width: 1032, height: 448 },
    qr: { x: 1160, y: 1080, width: 320, height: 320 },
    scan: { x: 1160, y: 1440, width: 320, height: 64 }
  };
  if (layout === 'phone') return { header: rect(.06, .035, .58, .05), hero: rect(.71, .025, .23, .085), title: rect(.06, .135, .88, .10), body: rect(.06, .245, .88, .06), info: rect(.08, .79, .84, .17), qr: qr(.16, .33, .68) };
  if (layout === 'sticker') return { ...common, title: rect(.06, .14, .88, .15), body: rect(.06, .31, .88, .09), info: rect(.59, .46, .35, .30), hero: rect(.59, .80, .35, .12), qr: qr(.065, .44, .46) };
  if (layout === 'social') return { ...common, hero: rect(.56, .14, .385, .42), title: rect(.06, .15, .44, .22), body: rect(.06, .40, .44, .16), info: rect(.06, .64, .54, .30), qr: qr(.665, .65, .27) };
  if (layout === 'story') return { ...common, hero: rect(.06, .12, .88, .30), title: rect(.06, .455, .88, .135), body: rect(.06, .61, .88, .085), info: rect(.06, .755, .54, .20), qr: qr(.665, .77, .27) };
  if (layout === 'counter') return { ...common, hero: rect(.05, .14, .35, .42), title: rect(.45, .145, .50, .205), body: rect(.45, .39, .50, .16), info: rect(.05, .65, .59, .29), qr: qr(.72, .60, .22) };
  if (layout === 'banner') return { header: rect(.04, .035, .66, .09), hero: rect(.77, .035, .19, .14), title: rect(.04, .19, .65, .19), body: rect(.04, .43, .65, .13), info: rect(.04, .64, .64, .31), qr: qr(.78, .25, .18) };
  if (layout === 'card' || layout === 'landscape') return { header: rect(.04, .045, .61, .09), hero: rect(.68, .055, .28, .30), title: rect(.04, .22, .59, .21), body: rect(.04, .465, .57, .13), info: rect(.04, .66, .57, .29), qr: qr(.72, .44, .22) };
  return { ...common, hero: rect(.06, .13, .88, .25), title: rect(.06, .415, .88, .135), body: rect(.06, .575, .88, .085), info: rect(.06, .72, .54, .23), qr: qr(.67, .72, .25) };
}

function brandedInvitationBlocks(copy, sourceFields, regions) {
  // Flow personal information only in the footer. Keep names comfortably sized;
  // an unusually long URL can use smaller text before the optional body is omitted.
  for (const includeBody of [true, false]) {
    for (let size = 24; size >= (includeBody ? 14 : 10); size--) {
      const specs = [
        ['headline', copy.variant.headline, Math.max(26, Math.round(size * 1.5)), { weight: 800 }],
        ...(includeBody ? [['body', copy.variant.body, Math.max(20, size), { fill: '#385761' }]] : []),
        ['referrer', interpolate(copy.pack.reusable.recommendedBy, sourceFields), 24, { weight: 600 }],
        ['code', interpolate(copy.pack.reusable.referralCodeLabel, sourceFields), 22, { mono: true, weight: 700, fill: '#086970' }],
        ['url', sourceFields.REFERRAL_URL, size, { fill: '#385761' }]
      ];
      const measured = specs.map(([role, value, fontSize, options]) => {
        const content = cleanText(value).replace(/\s+/gu, ' ');
        const lines = wrapText(content, regions.info.width, fontSize, options.mono);
        return { role, value, fontSize, options, height: lines.length * rounded(fontSize * 1.28) };
      });
      if (measured.reduce((sum, item) => sum + item.height, 0) + (measured.length - 1) * 10 > regions.info.height) continue;
      let top = regions.info.y;
      const blocks = measured.map(item => {
        const block = fitText(item.role, item.value, { x: regions.info.x, y: top, width: regions.info.width, height: item.height }, item.fontSize, { ...item.options, minSize: item.fontSize });
        top = rounded(top + item.height + 10);
        return block;
      });
      blocks.push(fitText('scan', copy.pack.reusable.scanCta, regions.scan, 24, { weight: 700, fill: '#0f5960', minSize: 20 }));
      return blocks;
    }
  }
  throw new RangeError('This text is too long for the selected format. Choose a larger format.');
}

export function buildMarketingKitLayout({ templateId, fields, locale = 'en-PH', variantId = 'personal_share_v1', brandAsset } = {}) {
  const selected = getMarketingKitTemplate(templateId), safe = normalizeMarketingKitFields(fields);
  const copy = resolveMarketingKitCopy(locale, variantId), artwork = normalizeBrandAsset(brandAsset), regions = layoutRegions(selected);
  const min = Math.min(selected.width, selected.height), { info, qr } = regions;
  const sourceFields = { REFERRER_NAME: safe.referrerName, REFERRAL_CODE: safe.referralCode, REFERRAL_URL: safe.referralUrl };
  if (selected.layout === 'branded-invitation') return {
    template: selected, locale: copy.locale, variantId: copy.variant.id, fields: safe, brandAsset: artwork,
    regions, blocks: brandedInvitationBlocks(copy, sourceFields, regions)
  };
  const infoBox = (top, fraction) => ({ x: info.x, y: rounded(info.y + top * info.height), width: info.width, height: rounded(fraction * info.height) });
  const ctaSize = Math.max(12, Math.round(min * .021));
  const caption = { x: qr.x, y: rounded(qr.y + qr.height + Math.max(10, min * .014)), width: qr.width, height: rounded(Math.min(ctaSize * 2.8, selected.height - qr.y - qr.height - Math.max(15, min * .02))) };
  const blocks = [
    fitText('brand', copy.pack.reusable.brandLine, regions.header, Math.max(17, min * .026), { weight: 800, fill: '#0f5960' }),
    fitText('headline', copy.variant.headline, regions.title, Math.max(27, min * .065), { weight: 800, minSize: 18 }),
    fitText('body', copy.variant.body, regions.body, Math.max(16, min * .028), { fill: '#385761', minSize: 13 }),
    fitText('referrer', interpolate(copy.pack.reusable.recommendedBy, sourceFields), infoBox(0, .40), Math.max(13, min * .022), { weight: 600 }),
    fitText('code', interpolate(copy.pack.reusable.referralCodeLabel, sourceFields), infoBox(.425, .16), Math.max(14, min * .023), { mono: true, weight: 700, fill: '#086970' }),
    fitText('url', safe.referralUrl, infoBox(.61, .39), Math.max(13, min * .019), { fill: '#385761', minSize: 10 }),
    fitText('scan', copy.pack.reusable.scanCta, caption, ctaSize, { weight: 700, fill: '#0f5960', minSize: 10 })
  ];
  return { template: selected, locale: copy.locale, variantId: copy.variant.id, fields: safe, brandAsset: artwork, regions, blocks };
}
function renderBlock(block) {
  const font = block.mono ? MONO_FONT : FONT;
  const lines = block.lines.map(line => `<tspan x="${line.x}" y="${line.y}" textLength="${line.width}" lengthAdjust="spacingAndGlyphs">${xmlEscape(line.text)}</tspan>`).join('');
  return `<text data-text-role="${block.role}" aria-label="${xmlEscape(block.content)}" font-family="${font}" font-size="${block.fontSize}" font-weight="${block.weight}" fill="${block.fill}">${lines}</text>`;
}
export function generateMarketingKitSvg(options = {}) {
  const layout = buildMarketingKitLayout(options);
  const { template: selected, fields: safe, regions, blocks, brandAsset, locale } = layout;
  const { width, height } = selected, { hero, qr } = regions, radius = Math.round(Math.min(width, height) * .025);
  const branded = selected.layout === 'branded-invitation', artworkRadius = branded ? 0 : radius, qrPadding = branded ? 24 : 7;
  const href = xmlEscape(safe.referralUrl), qrHref = xmlEscape(safe.qrDataUrl);
  const title = locale === 'fil-PH' ? 'Imbitasyon sa Business & Life' : 'Business & Life invitation';
  const description = blocks.filter(block => ['headline', 'body', 'referrer', 'code'].includes(block.role)).map(block => block.content).join(' ');
  // Approved scenes have subjects near both edges. Keep the complete composition
  // in every format, including the narrow accent panels, without moving the QR.
  const art = brandAsset
    ? `<image data-image-role="brand" href="${xmlEscape(brandAsset.dataUrl)}" xlink:href="${xmlEscape(brandAsset.dataUrl)}" x="${hero.x}" y="${hero.y}" width="${hero.width}" height="${hero.height}" preserveAspectRatio="xMidYMid meet" clip-path="url(#brand-art-clip)" aria-label="${xmlEscape(brandAsset.alt)}"/>`
    : `<path d="M ${hero.x} ${hero.y + hero.height} L ${hero.x + hero.width * .72} ${hero.y} L ${hero.x + hero.width} ${hero.y} L ${hero.x + hero.width} ${hero.y + hero.height} Z" fill="#b5dcd7" clip-path="url(#brand-art-clip)"/>`;
  const textMarkup = blocks.map(block => block.role === 'url' ? `<a href="${href}" xlink:href="${href}" target="_blank" rel="noopener noreferrer">${renderBlock(block)}</a>` : renderBlock(block)).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:lang="${locale}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="creative-title creative-description" data-template="${selected.id}">
<title id="creative-title">${xmlEscape(title)}</title><desc id="creative-description">${xmlEscape(description)}</desc>
<defs><clipPath id="brand-art-clip"><rect x="${hero.x}" y="${hero.y}" width="${hero.width}" height="${hero.height}" rx="${artworkRadius}"/></clipPath></defs>
<rect width="${width}" height="${height}" fill="#f7fbf9"/>
${branded ? '' : `<rect x="0" y="0" width="${width}" height="${Math.max(6, Math.round(height * .006))}" fill="#147b7e"/>`}
<rect x="${hero.x}" y="${hero.y}" width="${hero.width}" height="${hero.height}" rx="${artworkRadius}" fill="#d9eeea"/>
${art}
${branded ? `<rect data-marketing-role="personal-footer" x="${regions.footer.x}" y="${regions.footer.y}" width="${regions.footer.width}" height="${regions.footer.height}" fill="#ffffff"/>` : ''}
<rect data-marketing-role="qr-panel" x="${rounded(qr.x - qrPadding)}" y="${rounded(qr.y - qrPadding)}" width="${rounded(qr.width + qrPadding * 2)}" height="${rounded(qr.height + qrPadding * 2)}" rx="${radius}" fill="#ffffff" stroke="#c7d9d6"/>
<a href="${href}" xlink:href="${href}" target="_blank" rel="noopener noreferrer"><image data-image-role="qr" href="${qrHref}" xlink:href="${qrHref}" x="${qr.x}" y="${qr.y}" width="${qr.width}" height="${qr.height}" preserveAspectRatio="xMidYMid meet" image-rendering="pixelated" aria-label="${xmlEscape(title)} QR"/></a>
${textMarkup}
</svg>`;
}
