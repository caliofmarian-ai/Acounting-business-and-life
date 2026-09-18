import QRCode from 'qrcode';
import { isValidReferralCode } from './referral-domain.js';

const MAX_REFERRAL_URL_LENGTH = 2048;

export async function buildLocalReferralQr(referralUrl) {
  let parsed;
  try {
    parsed = new URL(String(referralUrl ?? ''));
  } catch {
    throw new TypeError('valid referral URL is required');
  }

  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new TypeError('referral URL must use http or https');
  }
  if (parsed.pathname !== '/referral/' || !isValidReferralCode(parsed.searchParams.get('ref'))) {
    throw new TypeError('QR payload must be a canonical referral URL');
  }

  if (parsed.hash) throw new TypeError('canonical referral URL must not contain a fragment');
  const referralUrl = parsed.toString();
  parsed.hash = 'qr';
  const payload = parsed.toString();
  if (payload.length > MAX_REFERRAL_URL_LENGTH) {
    throw new RangeError('referral URL is too long for QR rendering');
  }

  const dataUrl = await QRCode.toDataURL(payload, {
    type: 'image/png',
    errorCorrectionLevel: 'M',
    margin: 4,
    width: 256
  });

  return Object.freeze({
    format: 'png',
    encoder: 'local',
    marker: 'qr',
    referralUrl,
    payload,
    dataUrl
  });
}
