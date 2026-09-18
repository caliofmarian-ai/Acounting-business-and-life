export const RUNTIME_MARKETING_TEMPLATES = Object.freeze([
  { id: 'A4_REFERRAL_POSTER_V1', label: 'A4 referral poster', width: 794, height: 1123 },
  { id: 'SOCIAL_SQUARE_REFERRAL_V1', label: 'Social square', width: 1080, height: 1080 },
  { id: 'STORY_REFERRAL_V1', label: 'Story / Status', width: 1080, height: 1920 },
  { id: 'A5_REFERRAL_FLYER_V1', label: 'A5 referral flyer', width: 559, height: 794 },
  { id: 'REFERRAL_CARD_V1', label: 'Referral card', width: 1050, height: 600 },
  { id: 'COUNTER_CARD_V1', label: 'Counter card', width: 1200, height: 800 },
  { id: 'WINDOW_STICKER_V1', label: 'Window sticker', width: 1080, height: 1080 },
  { id: 'LINKEDIN_REFERRAL_V1', label: 'LinkedIn landscape', width: 1200, height: 627 },
  { id: 'EMAIL_WEB_BANNER_V1', label: 'Email / web banner', width: 1200, height: 400 },
  { id: 'QR_PHONE_CARD_V1', label: 'QR phone card', width: 1080, height: 1920 }
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

const TEMPLATE_BY_ID = new Map(RUNTIME_MARKETING_TEMPLATES.map(template => [template.id, template]));
const QR_DATA_URL_RE = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
const REFERRAL_CODE_RE = /^r1_[A-Za-z0-9_-]{16}$/;

function text(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function compactUrl(value, max = 62) {
  const raw = text(value, 2048);
  if (raw.length <= max) return raw;
  const keep = Math.max(12, Math.floor((max - 1) / 2));
  return raw.slice(0, keep) + '…' + raw.slice(-keep);
}

function interpolate(value, fields) {
  return String(value).replace(/\{([A-Z_]+)\}/g, (_, key) => String(fields[key] ?? ''));
}

export function resolveMarketingKitCopy(locale = 'en-PH', variantId = 'personal_share_v1') {
  const selectedLocale = SUPPORTED_MARKETING_LOCALES.includes(locale) ? locale : 'en-PH';
  const pack = RUNTIME_MARKETING_COPY[selectedLocale];
  const variant = pack.variants.find(item => item.id === variantId) || pack.variants.find(item => item.id === 'personal_share_v1') || pack.variants[0];
  return Object.freeze({ locale: selectedLocale, pack, variant });
}

export function deriveReferrerName(shareText) {
  const value = text(shareText, 220);
  const suffix = ' invited you to try Business & Life.';
  if (value.endsWith(suffix)) {
    const name = value.slice(0, -suffix.length).trim();
    if (name && name.length <= 80 && !/^you$/i.test(name)) return name;
  }
  return 'Business & Life member';
}

export function normalizeMarketingKitFields(input = {}) {
  const referrerName = text(input.referrerName, 80) || 'Business & Life member';
  const referralCode = text(input.referralCode, 40);
  const referralUrl = text(input.referralUrl, 2048);
  const qrDataUrl = text(input.qrDataUrl, 500000);

  if (!REFERRAL_CODE_RE.test(referralCode)) throw new TypeError('valid referral code is required');
  let parsed;
  try { parsed = new URL(referralUrl); } catch { throw new TypeError('valid referral URL is required'); }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.pathname !== '/referral/' || parsed.searchParams.get('ref') !== referralCode) {
    throw new TypeError('referral URL must match the canonical referral identity');
  }
  if (!QR_DATA_URL_RE.test(qrDataUrl)) throw new TypeError('local PNG QR asset is required');

  return Object.freeze({ referrerName, referralCode, referralUrl: parsed.toString(), qrDataUrl });
}

export function marketingKitFileName(templateId, referralCode, locale = 'en-PH') {
  const template = TEMPLATE_BY_ID.get(String(templateId || ''));
  if (!template) throw new TypeError('unknown marketing template');
  if (!REFERRAL_CODE_RE.test(String(referralCode || ''))) throw new TypeError('valid referral code is required');
  const safeLocale = SUPPORTED_MARKETING_LOCALES.includes(locale) ? locale.toLowerCase() : 'en-ph';
  return `business-life-${template.id.toLowerCase().replaceAll('_','-')}-${safeLocale}-${referralCode}.svg`;
}

export function generateMarketingKitSvg({ templateId, fields, locale = 'en-PH', variantId = 'personal_share_v1' } = {}) {
  const template = TEMPLATE_BY_ID.get(String(templateId || ''));
  if (!template) throw new TypeError('unknown marketing template');
  const safe = normalizeMarketingKitFields(fields);
  const copy = resolveMarketingKitCopy(locale, variantId);
  const copyFields = { REFERRER_NAME: safe.referrerName, REFERRAL_CODE: safe.referralCode, REFERRAL_URL: safe.referralUrl };

  const { width, height } = template;
  const min = Math.min(width, height);
  const pad = Math.max(28, Math.round(min * 0.055));
  const landscape = width / height > 1.25;
  const qrSize = Math.round(min * (landscape ? 0.34 : 0.31));
  const qrX = landscape ? width - pad - qrSize : Math.round((width - qrSize) / 2);
  const qrY = landscape ? Math.round((height - qrSize) / 2) : height - pad - qrSize;
  const contentWidth = landscape ? width - qrSize - pad * 3 : width - pad * 2;
  const titleSize = Math.max(28, Math.round(min * (landscape ? 0.065 : 0.072)));
  const bodySize = Math.max(16, Math.round(min * 0.032));
  const codeSize = Math.max(18, Math.round(min * 0.04));
  const left = pad;
  const titleY = pad + titleSize;
  const bodyY = titleY + Math.round(titleSize * 1.15);
  const recommendedY = bodyY + Math.round(bodySize * 2.15);
  const codeY = recommendedY + Math.round(bodySize * 1.55);
  const urlY = codeY + Math.round(codeSize * 1.55);
  const accentH = Math.max(8, Math.round(min * 0.018));
  const title = copy.variant.headline;
  const subtitle = copy.variant.body;
  const recommendedBy = interpolate(copy.pack.reusable.recommendedBy, copyFields);
  const referralCodeLabel = interpolate(copy.pack.reusable.referralCodeLabel, copyFields);
  const scanCta = copy.pack.reusable.scanCta;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Business & Life referral creative">
  <rect width="${width}" height="${height}" rx="${Math.round(min * 0.035)}" fill="#f8fbff"/>
  <rect x="0" y="0" width="${width}" height="${Math.max(84, Math.round(height * 0.115))}" fill="#0f172a"/>
  <rect x="${pad}" y="${Math.max(62, Math.round(height * 0.115))}" width="${Math.max(90, Math.round(contentWidth * 0.32))}" height="${accentH}" rx="${Math.round(accentH/2)}" fill="#0284c7"/>
  <text x="${pad}" y="${Math.max(45, Math.round(height * 0.065))}" font-family="Inter,Arial,sans-serif" font-size="${Math.max(17, Math.round(min * 0.032))}" font-weight="800" letter-spacing="2" fill="#ffffff">${xmlEscape(copy.pack.reusable.brandLine)}</text>
  <text x="${left}" y="${titleY + Math.max(84, Math.round(height * 0.115))}" font-family="Inter,Arial,sans-serif" font-size="${titleSize}" font-weight="900" fill="#0f172a">${xmlEscape(title)}</text>
  <text x="${left}" y="${bodyY + Math.max(84, Math.round(height * 0.115))}" font-family="Inter,Arial,sans-serif" font-size="${bodySize}" font-weight="500" fill="#475569">${xmlEscape(subtitle.slice(0, 118))}</text>
  <text x="${left}" y="${recommendedY + Math.max(84, Math.round(height * 0.115))}" font-family="Inter,Arial,sans-serif" font-size="${Math.max(13, Math.round(bodySize * 0.8))}" font-weight="700" fill="#334155">${xmlEscape(recommendedBy)}</text>
  <text x="${left}" y="${codeY + Math.max(84, Math.round(height * 0.115))}" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="${Math.max(15, Math.round(codeSize * 0.8))}" font-weight="800" fill="#0369a1">${xmlEscape(referralCodeLabel)}</text>
  <text x="${left}" y="${urlY + Math.max(84, Math.round(height * 0.115))}" font-family="Inter,Arial,sans-serif" font-size="${Math.max(13, Math.round(bodySize * 0.78))}" fill="#64748b">${xmlEscape(compactUrl(safe.referralUrl))}</text>
  <rect x="${qrX - Math.round(pad * 0.28)}" y="${qrY - Math.round(pad * 0.28)}" width="${qrSize + Math.round(pad * 0.56)}" height="${qrSize + Math.round(pad * 0.56)}" rx="${Math.round(min * 0.025)}" fill="#ffffff" stroke="#cbd5e1"/>
  <image href="${xmlEscape(safe.qrDataUrl)}" x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}" preserveAspectRatio="xMidYMid meet"/>
  <text x="${landscape ? qrX + qrSize/2 : width/2}" y="${Math.min(height - Math.round(pad * 0.45), qrY + qrSize + Math.round(bodySize * 1.8))}" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="${Math.max(12, Math.round(bodySize * 0.72))}" font-weight="700" fill="#475569">${xmlEscape(scanCta)}</text>
</svg>`;
}
