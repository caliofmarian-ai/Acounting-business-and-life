import crypto from 'node:crypto';
import { promisify } from 'node:util';
import pg from 'pg';
import { validateRuntimeSafety } from '../runtime-safety.js';
import {
  COMPANY_TEST_ACCOUNTS,
  ensureCompanyTestAccountSchema
} from '../company-test-accounts.js';

const { Pool } = pg;
const scryptAsync = promisify(crypto.scrypt);

function displayNameFor(fixture) {
  return `Business & Life ${fixture.label} Test`;
}

async function passwordHash() {
  const password = crypto.randomBytes(32).toString('base64url');
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt, 64);
  return { salt, hash: Buffer.from(derived).toString('hex') };
}

function requireSafeQaRuntime(env = process.env) {
  const state = validateRuntimeSafety(env);
  if (!state.previewService || state.appEnvironment !== 'qa' || !/(_qa|_test)$/.test(state.databaseName)) {
    throw new Error('Company test fixtures may run only in isolated QA.');
  }
  const paymentMode = String(env.PAYMONGO_MODE || '').trim().toLowerCase();
  const livePayments = ['1','true','yes','on'].includes(String(env.PAYMONGO_LIVE_ENABLED || '').trim().toLowerCase());
  if (paymentMode !== 'test' || livePayments) {
    throw new Error('Company test fixtures require PayMongo TEST mode with live payments disabled.');
  }
  return state;
}

async function provision() {
  const runtime = requireSafeQaRuntime();
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined
  });

  const fixtures = Object.entries(COMPANY_TEST_ACCOUNTS).map(([email, fixture]) => ({
    email,
    ...fixture
  }));
  const superAdmin = fixtures.find(fixture => fixture.role === 'super_admin');
  const remaining = fixtures.filter(fixture => fixture.role !== 'super_admin');
  if (!superAdmin) throw new Error('Super Admin company test fixture is missing.');

  let created = 0;
  let existing = 0;
  const client = await pool.connect();

  try {
    await ensureCompanyTestAccountSchema(client);
    await client.query('BEGIN');

    const owner = await client.query(
      `SELECT id,email,account_mode,test_role,password_hash,email_verified_at
         FROM accounts WHERE id=1 FOR UPDATE`
    );
    if (!owner.rowCount) throw new Error('QA owner account id=1 is missing.');

    const current = owner.rows[0];
    const normalizedOwnerEmail = String(current.email || '').trim().toLowerCase();
    if (normalizedOwnerEmail && normalizedOwnerEmail !== superAdmin.email) {
      throw new Error('QA owner account is already bound to a different email.');
    }

    if (!normalizedOwnerEmail) {
      const credentials = await passwordHash();
      await client.query(
        `UPDATE accounts
            SET email=$1,
                display_name=$2,
                phone='',
                address='',
                password_salt=$3,
                password_hash=$4,
                email_verified_at=NULL,
                account_mode='company_test',
                test_role='super_admin',
                updated_at=NOW()
          WHERE id=1`,
        [superAdmin.email, displayNameFor(superAdmin), credentials.salt, credentials.hash]
      );
      created += 1;
    } else {
      if (current.account_mode !== 'company_test' || current.test_role !== 'super_admin') {
        throw new Error('Existing QA owner account has an invalid company test classification.');
      }
      existing += 1;
    }

    for (const fixture of remaining) {
      const found = await client.query(
        `SELECT id,account_mode,test_role FROM accounts WHERE LOWER(email)=$1 FOR UPDATE`,
        [fixture.email]
      );
      if (found.rowCount) {
        const row = found.rows[0];
        if (row.account_mode !== 'company_test' || row.test_role !== fixture.role) {
          throw new Error(`Existing QA fixture classification mismatch for ${fixture.email}`);
        }
        existing += 1;
        continue;
      }

      const credentials = await passwordHash();
      await client.query(
        `INSERT INTO accounts(
           display_name,phone,email,address,active_role,
           password_salt,password_hash,email_verified_at,auth_status,
           account_mode,test_role
         ) VALUES($1,'',$2,'',NULL,$3,$4,NULL,'active','company_test',$5)`,
        [displayNameFor(fixture), fixture.email, credentials.salt, credentials.hash, fixture.role]
      );
      created += 1;
    }

    await client.query('COMMIT');
    console.log(JSON.stringify({
      ok: true,
      database: runtime.databaseName,
      total: fixtures.length,
      created,
      existing,
      email_verification_required: true,
      privileges_granted: false
    }));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  provision().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}

export { requireSafeQaRuntime, provision };
