const PROFILE_CODES = Object.freeze({ customer:'CU', merchant:'ME', supplier:'SU', courier:'DE', service_provider:'LS', admin:'AD' });

export async function ensurePersonIdentitySchema(pool) {
  await pool.query(`
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS identity_country_code TEXT;
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS personal_public_id TEXT;
    UPDATE accounts SET identity_country_code='PH' WHERE identity_country_code IS NULL OR identity_country_code='';
    UPDATE accounts SET personal_public_id='BL-' || identity_country_code || '-P-' || UPPER(SUBSTRING(MD5('business-life-person:' || id::text) FROM 1 FOR 8)) WHERE personal_public_id IS NULL OR personal_public_id='';
    ALTER TABLE accounts ALTER COLUMN identity_country_code SET DEFAULT 'PH';
    ALTER TABLE accounts ALTER COLUMN identity_country_code SET NOT NULL;
    ALTER TABLE accounts ALTER COLUMN personal_public_id SET DEFAULT ('BL-PH-P-' || UPPER(SUBSTRING(MD5(RANDOM()::text || CLOCK_TIMESTAMP()::text) FROM 1 FOR 8)));
    ALTER TABLE accounts ALTER COLUMN personal_public_id SET NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS accounts_personal_public_id_uidx ON accounts(personal_public_id);
    ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_identity_country_code_check;
    ALTER TABLE accounts ADD CONSTRAINT accounts_identity_country_code_check CHECK (identity_country_code ~ '^[A-Z]{2}$');
  `);
}

export function profilePublicId(personalId, role) {
  const code=PROFILE_CODES[role];
  return personalId&&code?`${personalId}-${code}`:'';
}

export function withPublicProfileIds(snapshot) {
  if(!snapshot?.account)return snapshot;
  const personalId=snapshot.account.personal_public_id;
  return {...snapshot,
    account:{...snapshot.account,personal_id:personalId,country_code:snapshot.account.identity_country_code,admin_profile_id:profilePublicId(personalId,'admin')},
    profiles:(snapshot.profiles||[]).map(profile=>({...profile,profile_id:profilePublicId(personalId,profile.role)}))
  };
}

export { PROFILE_CODES };
