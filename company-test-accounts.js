const COMPANY_TEST_OWNER = 'Business & Life';

const COMPANY_TEST_ACCOUNTS = Object.freeze({
  'dropi.deliveries+testcustomer@gmail.com': Object.freeze({ role:'customer', label:'Customer' }),
  'dropi.deliveries+testmerchant@gmail.com': Object.freeze({ role:'merchant', label:'Merchant' }),
  'dropi.deliveries+testsupplier@gmail.com': Object.freeze({ role:'supplier', label:'Supplier' }),
  'dropi.deliveries+testcourier@gmail.com': Object.freeze({ role:'courier', label:'Courier Delivery' }),
  'dropi.deliveries+testservice@gmail.com': Object.freeze({ role:'service_provider', label:'Service Provider' }),
  'dropi.deliveries+testcountryadmin@gmail.com': Object.freeze({ role:'country_admin', label:'Country Admin' }),
  'dropi.deliveries+testterritoryadmin@gmail.com': Object.freeze({ role:'territory_admin', label:'Territory Admin' }),
  'dropi.deliveries+testspecialist@gmail.com': Object.freeze({ role:'specialist_admin', label:'Specialist Admin' }),
  'dropi.deliveries+testsuperadmin@gmail.com': Object.freeze({ role:'super_admin', label:'Super Admin' })
});

const OPERATIONAL_PROFILE_ROLES = new Set(['customer','merchant','supplier','courier','service_provider']);

function normalizeEmail(value='') { return String(value || '').trim().toLowerCase(); }
function cleanCompanyContact(value, max) { return String(value || '').trim().slice(0, max); }

export function companyTestAccountForEmail(value) {
  const match=COMPANY_TEST_ACCOUNTS[normalizeEmail(value)];
  return match ? { ...match, owner:COMPANY_TEST_OWNER } : null;
}

export function companyTestProfileRole(testRole) {
  return OPERATIONAL_PROFILE_ROLES.has(testRole) ? testRole : null;
}

export function companyTestContact() {
  return {
    phone:cleanCompanyContact(process.env.BUSINESS_LIFE_COMPANY_PHONE,40),
    address:cleanCompanyContact(process.env.BUSINESS_LIFE_COMPANY_ADDRESS,300)
  };
}

export async function ensureCompanyTestAccountSchema(pool) {
  await pool.query(`
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS account_mode TEXT;
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS test_role TEXT;
    UPDATE accounts SET account_mode='personal' WHERE account_mode IS NULL OR account_mode='';
    UPDATE accounts
       SET account_mode='company_test',
           test_role=CASE LOWER(email)
             WHEN 'dropi.deliveries+testcustomer@gmail.com' THEN 'customer'
             WHEN 'dropi.deliveries+testmerchant@gmail.com' THEN 'merchant'
             WHEN 'dropi.deliveries+testsupplier@gmail.com' THEN 'supplier'
             WHEN 'dropi.deliveries+testcourier@gmail.com' THEN 'courier'
             WHEN 'dropi.deliveries+testservice@gmail.com' THEN 'service_provider'
             WHEN 'dropi.deliveries+testcountryadmin@gmail.com' THEN 'country_admin'
             WHEN 'dropi.deliveries+testterritoryadmin@gmail.com' THEN 'territory_admin'
             WHEN 'dropi.deliveries+testspecialist@gmail.com' THEN 'specialist_admin'
             WHEN 'dropi.deliveries+testsuperadmin@gmail.com' THEN 'super_admin'
           END
     WHERE LOWER(email) IN (
       'dropi.deliveries+testcustomer@gmail.com',
       'dropi.deliveries+testmerchant@gmail.com',
       'dropi.deliveries+testsupplier@gmail.com',
       'dropi.deliveries+testcourier@gmail.com',
       'dropi.deliveries+testservice@gmail.com',
       'dropi.deliveries+testcountryadmin@gmail.com',
       'dropi.deliveries+testterritoryadmin@gmail.com',
       'dropi.deliveries+testspecialist@gmail.com',
       'dropi.deliveries+testsuperadmin@gmail.com'
     );
    UPDATE accounts
       SET phone='', address=''
     WHERE account_mode='company_test';
    UPDATE profiles p
       SET enabled=FALSE, updated_at=NOW()
      FROM accounts a
     WHERE p.account_id=a.id
       AND a.account_mode='company_test'
       AND (a.test_role NOT IN ('customer','merchant','supplier','courier','service_provider') OR p.role<>a.test_role);
    ALTER TABLE accounts ALTER COLUMN account_mode SET DEFAULT 'personal';
    ALTER TABLE accounts ALTER COLUMN account_mode SET NOT NULL;
    ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_account_mode_check;
    ALTER TABLE accounts ADD CONSTRAINT accounts_account_mode_check CHECK (account_mode IN ('personal','company_test'));
    ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_company_test_role_check;
    ALTER TABLE accounts ADD CONSTRAINT accounts_company_test_role_check CHECK (
      (account_mode='personal' AND test_role IS NULL)
      OR
      (account_mode='company_test' AND test_role IN ('customer','merchant','supplier','courier','service_provider','country_admin','territory_admin','specialist_admin','super_admin'))
    );
  `);
}

export function withCompanyTestAccountPolicy(snapshot) {
  if(!snapshot?.account)return snapshot;
  const account=snapshot.account;
  const isTest=account.account_mode==='company_test';
  if(!isTest)return {...snapshot,account:{...account,is_test_account:false}};
  const mapped=companyTestAccountForEmail(account.email);
  const contact=companyTestContact();
  return {
    ...snapshot,
    account:{
      ...account,
      phone:contact.phone,
      address:contact.address,
      is_test_account:true,
      test_role_label:mapped?.label || account.test_role || 'Test',
      managed_by:COMPANY_TEST_OWNER,
      contact_source:'company',
      contact_requirements:{
        personal_phone_required:false,
        personal_address_required:false,
        company_phone_configured:Boolean(contact.phone),
        company_address_configured:Boolean(contact.address)
      }
    }
  };
}

export { COMPANY_TEST_ACCOUNTS, COMPANY_TEST_OWNER };
