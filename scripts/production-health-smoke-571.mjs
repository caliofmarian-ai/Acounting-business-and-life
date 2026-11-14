import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const origin = 'https://caliof.com';
const expectedRevision = process.env.EXPECTED_PRODUCTION_REVISION || '';
if (!/^[a-f0-9]{40}$/i.test(expectedRevision)) {
  throw new Error('EXPECTED_PRODUCTION_REVISION must be the full 40-character main SHA');
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getPublic(url, accept) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          accept,
          'cache-control': 'no-cache, no-store',
          pragma: 'no-cache'
        },
        redirect: 'error',
        signal: AbortSignal.timeout(15000)
      });
      if ([502, 503, 504].includes(response.status) && attempt < 4) {
        await response.arrayBuffer().catch(() => {});
        await pause(attempt * 3000);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt === 4) break;
      await pause(attempt * 3000);
    }
  }
  throw lastError || new Error('Public GET failed after retries');
}

const healthUrl = new URL('/health', origin);
const healthResponse = await getPublic(healthUrl, 'application/json');
if (healthResponse.status !== 200) {
  const body = (await healthResponse.text()).slice(0, 500);
  throw new Error(`Public /health returned HTTP ${healthResponse.status}: ${body}`);
}
if (!healthResponse.headers.get('content-type')?.toLowerCase().includes('application/json')) {
  throw new Error('Public /health did not return JSON content type');
}
const health = await healthResponse.json();
const revision = health?.deployment?.revision;
const revisionMatches = typeof revision === 'string'
  && revision.length >= 12
  && (expectedRevision.startsWith(revision) || revision.startsWith(expectedRevision));
if (
  health?.ok !== true
  || health?.db !== true
  || health?.payment_core !== true
  || health?.deployment?.environment !== 'production'
  || !revisionMatches
) {
  throw new Error(`Public Production health/revision mismatch: ${JSON.stringify({
    ok: health?.ok,
    db: health?.db,
    payment_core: health?.payment_core,
    environment: health?.deployment?.environment,
    revision,
    expectedRevision: expectedRevision.slice(0, 12)
  })}`);
}

const assetPath = '/payments-ui.js';
const assetResponse = await getPublic(new URL(assetPath, origin), 'text/javascript, application/javascript, */*');
if (assetResponse.status !== 200) {
  throw new Error(`Public ${assetPath} returned HTTP ${assetResponse.status}`);
}
if (!assetResponse.headers.get('content-type')?.toLowerCase().includes('javascript')) {
  throw new Error(`Public ${assetPath} did not return JavaScript content type`);
}
const [expectedAsset, servedAsset] = await Promise.all([
  readFile(new URL('../public/payments-ui.js', import.meta.url)),
  assetResponse.arrayBuffer()
]);
const expectedHash = createHash('sha256').update(expectedAsset).digest('hex');
const servedBytes = Buffer.from(servedAsset);
const servedHash = createHash('sha256').update(servedBytes).digest('hex');
if (servedHash !== expectedHash) {
  throw new Error(`Public ${assetPath} SHA-256 mismatch: served=${servedHash} source=${expectedHash}`);
}

console.log(JSON.stringify({
  result: 'PASS',
  origin,
  health: {
    http_status: healthResponse.status,
    ok: health.ok,
    db: health.db,
    payment_core: health.payment_core,
    environment: health.deployment.environment,
    revision
  },
  asset: {
    path: assetPath,
    http_status: assetResponse.status,
    bytes: servedBytes.byteLength,
    sha256: servedHash,
    source_sha256: expectedHash,
    byte_parity: true
  }
}, null, 2));
