// Production bootstrap shared by the complete gateway chain.
//
// Neon/Railway connection URLs may currently contain sslmode=require. The
// pg/pg-connection-string dependency warns that the meaning of that mode will
// change in its next major release. Preserve the current certificate-verifying
// behavior explicitly before any gateway creates a Pool or spawns a child.
import { enforceRuntimeSafety } from './runtime-safety.js';

const rawDatabaseUrl = process.env.DATABASE_URL;

if (rawDatabaseUrl) {
  try {
    const url = new URL(rawDatabaseUrl);
    const sslMode = url.searchParams.get('sslmode');
    if (sslMode && ['prefer', 'require', 'verify-ca'].includes(sslMode)) {
      url.searchParams.set('sslmode', 'verify-full');
      process.env.DATABASE_URL = url.toString();
    }
  } catch {
    // Leave malformed/local development values untouched so the owning service
    // produces the authoritative connection error instead of masking it here.
  }
}

enforceRuntimeSafety(process.env);
