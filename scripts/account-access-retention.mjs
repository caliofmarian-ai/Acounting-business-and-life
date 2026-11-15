import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  AccountAccessRetentionError, validateAccountAccessRetentionPolicy,
  requireAccountAccessRetentionApply, initializeAccountAccessRetention, runAccountAccessRetention
} from '../account-access-retention.js';

// Operator-only CLI. Never accepts a DB URL, credentials, days or approval flags
// from a public request. No self-scheduling and no side effects when imported.
export async function main(args = process.argv.slice(2), env = process.env) {
  let pool;
  try {
    if (args.length > 1 || (args.length && !['--dry-run','--apply','--initialize'].includes(args[0]))) {
      throw new AccountAccessRetentionError('ACCOUNT_ACCESS_RETENTION_OPTIONS_INVALID');
    }
    const input = JSON.parse(await fs.readFile(new URL('../privacy/account-access-retention.json', import.meta.url), 'utf8'));
    const { digest } = validateAccountAccessRetentionPolicy(input);
    const mode = args[0] || '--dry-run';
    if (mode !== '--dry-run') requireAccountAccessRetentionApply(digest, env);
    if (!env.DATABASE_URL) throw new AccountAccessRetentionError('ACCOUNT_ACCESS_RETENTION_DATABASE_REQUIRED');
    const { default: pg } = await import('pg');
    pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
    pool.on('error', () => {}); // A failed operation still rejects with a safe error below.
    const result = mode === '--initialize' ? await initializeAccountAccessRetention(pool, input, { env })
      : await runAccountAccessRetention(pool, input, { mode: mode === '--apply' ? 'apply' : 'dry-run', env });
    console.log(JSON.stringify(result));
    return 0;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, code: error instanceof AccountAccessRetentionError ? error.code : 'ACCOUNT_ACCESS_RETENTION_UNAVAILABLE' }));
    return 1;
  } finally { if (pool) await pool.end(); }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = await main();
