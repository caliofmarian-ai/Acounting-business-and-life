import crypto from 'node:crypto';
import {promisify} from 'node:util';
import {validateRuntimeSafety} from './runtime-safety.js';
import {
  COMPANY_TEST_ACCOUNTS,
  ensureCompanyTestAccountSchema
} from './company-test-accounts.js';
import {
  ensureAccountSafetyEligibilitySchema,
  recordCompanyTestEligibilityExemption
} from './account-safety-eligibility-core.js';
import {
  accountGeographySnapshot,
  ensureAccountGeographySchema,
  saveAccountGeography
} from './account-geography.js';
import {
  bindPrivateEvidenceSource,
  deletePrivateEvidence,
  ensurePrivateEvidenceSchema,
  readPrivateEvidence,
  storePrivateEvidence
} from './private-evidence-core.js';
import {COURIER_ELIGIBILITY_POLICY_VERSION} from './courier-eligibility-core.js';

const scryptAsync=promisify(crypto.scrypt);
const FIXTURE_WAVE='operational_v1';
const FIXTURE_ACK='non_settling_private_v1';
const FIXTURE_CODE='controlled-role-e2e-v1';
const DEFAULT_PSGC_CODE='0402103028';
const CUSTOMER_ALIAS='dropi.deliveries+testcustomer@gmail.com';
const MERCHANT_ALIAS='dropi.deliveries+testmerchant@gmail.com';
const COURIER_EVIDENCE_REFERENCE='BL-CONTROLLED-COURIER-V1';
const COURIER_EVIDENCE_TYPE='company_test_vehicle_attestation';
const REQUIRED_TABLES=Object.freeze([
  'accounts','account_sessions','profiles','territories','profile_invitations',
  'profile_applications','profile_authorizations','profile_governance_events',
  'businesses','business_memberships','profile_business_bindings',
  'account_business_preferences','budgets','supplier_profiles',
  'supplier_operating_locations','courier_profiles','courier_documents',
  'service_provider_profiles','service_provider_operating_locations'
]);
const ROLE_FIXTURES=Object.freeze([
  Object.freeze({
    email:'dropi.deliveries+testsupplier@gmail.com',role:'supplier',
    displayName:'Business & Life Supplier Test',label:'Supplier'
  }),
  Object.freeze({
    email:'dropi.deliveries+testcourier@gmail.com',role:'courier',
    displayName:'Business & Life Courier Test',label:'Courier Delivery'
  }),
  Object.freeze({
    email:'dropi.deliveries+testservice@gmail.com',role:'service_provider',
    displayName:'Business & Life Local Services Test',label:'Local Services'
  })
]);

const clean=(value,max=300)=>String(value??'').trim().slice(0,max);
const truthy=value=>['1','true','yes','on'].includes(clean(value,10).toLowerCase());
const safeError=error=>clean(error?.message||'controlled fixture failed',240).replace(/\s+/g,' ');

export function controlledRoleFixtureGateRequired(env=process.env){
  return Boolean(clean(env.CONTROLLED_ROLE_FIXTURE_WAVE,80));
}

export function controlledRoleFixtureConfig(env=process.env){
  const wave=clean(env.CONTROLLED_ROLE_FIXTURE_WAVE,80);
  if(!wave)return{enabled:false,wave:''};
  if(wave!==FIXTURE_WAVE)throw new Error('Unknown controlled role fixture wave.');
  if(clean(env.CONTROLLED_ROLE_FIXTURE_ACK,80)!==FIXTURE_ACK){
    throw new Error('Controlled role fixtures require the explicit non-settling/private acknowledgement.');
  }
  const secret=String(env.CONTROLLED_ROLE_FIXTURE_SECRET||'');
  if(secret.length<32)throw new Error('Controlled role fixtures require a temporary secret of at least 32 characters.');
  if(env.QA_AUTOMATION_SECRET&&secret===String(env.QA_AUTOMATION_SECRET)){
    throw new Error('Controlled role fixtures require a secret separate from QA automation.');
  }
  const runtime=validateRuntimeSafety(env);
  if(!runtime.previewService&&!runtime.productionService){
    throw new Error('Controlled role fixtures may run only on the named Preview or Production service.');
  }
  if(runtime.previewService){
    if(runtime.appEnvironment!=='qa'||!/(?:^|_)(?:qa|test)$/.test(runtime.databaseName)){
      throw new Error('Preview controlled role fixtures require the isolated QA database.');
    }
    const paymentMode=clean(env.PAYMONGO_MODE,20).toLowerCase();
    if(paymentMode!=='test'||truthy(env.PAYMONGO_LIVE_ENABLED)){
      throw new Error('Preview controlled role fixtures require PayMongo TEST mode with live payments disabled.');
    }
  }
  if(runtime.productionService&&clean(env.QA_ACCEPTANCE_WAVE,80)){
    throw new Error('Production controlled role provisioning cannot run with a QA acceptance wave.');
  }
  const revision=clean(env.RAILWAY_GIT_COMMIT_SHA||env.GITHUB_SHA,80);
  if(!/^[a-f0-9]{7,64}$/i.test(revision)){
    throw new Error('Controlled role fixtures require an immutable deployment revision.');
  }
  const psgcCode=clean(env.CONTROLLED_ROLE_FIXTURE_PSGC_CODE||DEFAULT_PSGC_CODE,20).replace(/\D/g,'');
  if(psgcCode.length!==10)throw new Error('Controlled role fixture PSGC code must contain exactly 10 digits.');
  return{
    enabled:true,wave,secret,revision,psgcCode,runtime,
    environment:runtime.productionService?'production':'preview'
  };
}

export function deriveControlledRolePassword(secret,email){
  if(String(secret||'').length<32)throw new Error('Controlled role password derivation requires a strong temporary secret.');
  const normalized=clean(email,200).toLowerCase();
  const fixture=COMPANY_TEST_ACCOUNTS[normalized];
  if(!fixture||!ROLE_FIXTURES.some(item=>item.email===normalized)){
    throw new Error('Password derivation is restricted to controlled operational aliases.');
  }
  return crypto.createHmac('sha256',String(secret))
    .update('business-life-controlled-role-v1:'+normalized)
    .digest('base64url');
}

export function controlledBusinessTerritoryAction({environment,currentTerritoryId,fixtureTerritoryId}){
  const target=Number(fixtureTerritoryId);
  if(!Number.isInteger(target))throw new Error('Controlled fixture business territory must be an integer.');
  if(currentTerritoryId==null)return'assign';
  const current=Number(currentTerritoryId);
  if(!Number.isInteger(current))throw new Error('Controlled fixture found an invalid business territory.');
  if(current===target)return'keep';
  return environment==='preview'?'preserve_preview':'reject';
}

async function passwordCredential(secret,email){
  const password=deriveControlledRolePassword(secret,email);
  const salt=crypto.randomBytes(16).toString('hex');
  const derived=await scryptAsync(password,salt,64);
  return{password,salt,hash:Buffer.from(derived).toString('hex')};
}

function pdfEscape(value){
  return String(value).replaceAll('\\','\\\\').replaceAll('(','\\(').replaceAll(')','\\)');
}

export function controlledCourierEvidencePdf({psgcCode=DEFAULT_PSGC_CODE,areaName='Controlled PH test area'}={}){
  const lines=[
    'Business & Life controlled Courier fixture',
    'Company-managed test identity; no natural person is represented.',
    'Vehicle class: motorcycle; maximum weight: 20 kg; maximum volume: 80 L.',
    `Operating PSGC: ${clean(psgcCode,20)}; area: ${clean(areaName,100)}.`,
    'Private, non-settling E2E evidence. Not valid for real-world identification.'
  ];
  const commands=['BT','/F1 11 Tf','48 760 Td'];
  lines.forEach((line,index)=>{
    if(index)commands.push('0 -20 Td');
    commands.push(`(${pdfEscape(line)}) Tj`);
  });
  commands.push('ET');
  const stream=commands.join('\n')+'\n';
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let output='%PDF-1.4\n';
  const offsets=[0];
  objects.forEach((object,index)=>{
    offsets.push(Buffer.byteLength(output));
    output+=`${index+1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset=Buffer.byteLength(output);
  output+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for(let index=1;index<offsets.length;index++)output+=`${String(offsets[index]).padStart(10,'0')} 00000 n \n`;
  output+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output,'utf8');
}

async function ensureFixtureSchema(pool){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS controlled_role_fixture_runs(
      id BIGSERIAL PRIMARY KEY,
      fixture_code TEXT NOT NULL,
      wave TEXT NOT NULL,
      environment_name TEXT NOT NULL,
      revision TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'started',
      detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      CHECK(status IN ('started','provisioned','passed','failed'))
    );
    CREATE INDEX IF NOT EXISTS controlled_role_fixture_runs_revision_idx
      ON controlled_role_fixture_runs(environment_name,revision,started_at DESC);

    CREATE TABLE IF NOT EXISTS controlled_role_lifecycle_fixtures(
      fixture_code TEXT PRIMARY KEY,
      environment_name TEXT NOT NULL,
      revision TEXT NOT NULL,
      territory_id BIGINT NOT NULL REFERENCES territories(id),
      customer_account_id BIGINT NOT NULL REFERENCES accounts(id),
      merchant_account_id BIGINT NOT NULL REFERENCES accounts(id),
      merchant_business_id BIGINT NOT NULL REFERENCES businesses(id),
      supplier_account_id BIGINT NOT NULL REFERENCES accounts(id),
      supplier_business_id BIGINT NOT NULL REFERENCES businesses(id),
      courier_account_id BIGINT NOT NULL REFERENCES accounts(id),
      service_provider_account_id BIGINT NOT NULL REFERENCES accounts(id),
      lifecycle_status TEXT NOT NULL DEFAULT 'provisioning',
      settlement_mode TEXT NOT NULL DEFAULT 'blocked',
      detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(lifecycle_status IN ('provisioning','ready','blocked')),
      CHECK(settlement_mode='blocked')
    );
  `);
}

async function requireRuntimeTables(pool){
  const q=await pool.query(
    `SELECT name,to_regclass(name) relation FROM unnest($1::text[]) name`,
    [REQUIRED_TABLES]
  );
  const missing=q.rows.filter(row=>!row.relation).map(row=>row.name);
  if(missing.length)throw new Error('Controlled fixture runtime schema is incomplete: '+missing.join(', '));
}

async function requireAnchor(client,email,role){
  const q=await client.query(
    `SELECT id,email,account_mode,test_role,auth_status FROM accounts WHERE LOWER(email)=$1 FOR UPDATE`,
    [email]
  );
  if(q.rowCount!==1)throw new Error(`Required ${role} controlled anchor is missing.`);
  const row=q.rows[0];
  if(row.account_mode!=='company_test'||row.test_role!==role||row.auth_status!=='active'){
    throw new Error(`Required ${role} controlled anchor classification is invalid.`);
  }
  const profile=await client.query(
    `SELECT enabled,status FROM profiles WHERE account_id=$1 AND role=$2 FOR UPDATE`,
    [row.id,role]
  );
  if(profile.rowCount!==1||profile.rows[0].enabled!==true||profile.rows[0].status!=='active'){
    throw new Error(`Required ${role} controlled anchor profile is not active.`);
  }
  return{...row,id:Number(row.id)};
}

async function upsertControlledIdentity(client,fixture,credential){
  const mapped=COMPANY_TEST_ACCOUNTS[fixture.email];
  if(!mapped||mapped.role!==fixture.role)throw new Error('Controlled fixture alias mapping changed unexpectedly.');
  const found=await client.query(
    `SELECT id,account_mode,test_role FROM accounts WHERE LOWER(email)=$1 FOR UPDATE`,
    [fixture.email]
  );
  let accountId;
  if(found.rowCount){
    const row=found.rows[0];
    if(row.account_mode!=='company_test'||row.test_role!==fixture.role){
      throw new Error(`Existing controlled identity classification mismatch for ${fixture.role}.`);
    }
    accountId=Number(row.id);
    await client.query(`
      UPDATE accounts
         SET display_name=$1,phone='',address='',active_role=$2,
             password_salt=$3,password_hash=$4,email_verified_at=COALESCE(email_verified_at,NOW()),
             auth_status='active',account_mode='company_test',test_role=$2,updated_at=NOW()
       WHERE id=$5
    `,[fixture.displayName,fixture.role,credential.salt,credential.hash,accountId]);
  }else{
    const inserted=await client.query(`
      INSERT INTO accounts(
        display_name,phone,email,address,active_role,password_salt,password_hash,
        email_verified_at,auth_status,account_mode,test_role
      ) VALUES($1,'',$2,'',$3,$4,$5,NOW(),'active','company_test',$3)
      RETURNING id
    `,[fixture.displayName,fixture.email,fixture.role,credential.salt,credential.hash]);
    accountId=Number(inserted.rows[0].id);
  }
  await client.query(`UPDATE account_sessions SET revoked_at=NOW() WHERE account_id=$1 AND revoked_at IS NULL`,[accountId]);
  await client.query(`
    UPDATE profiles SET enabled=FALSE,visibility='private',status='disabled',updated_at=NOW()
     WHERE account_id=$1 AND role<>$2
  `,[accountId,fixture.role]);
  await recordCompanyTestEligibilityExemption(client,{accountId,source:'controlled_role_fixture_v1'});
  return{...fixture,accountId};
}

async function ensureInvitation(client,{account,territoryId,ownerId,revision}){
  if(!['supplier','courier'].includes(account.role))return null;
  const tokenHash=crypto.createHash('sha256')
    .update(`${FIXTURE_CODE}:${account.email}:${territoryId}`)
    .digest('hex');
  const q=await client.query(`
    INSERT INTO profile_invitations(
      target_email,role,territory_id,token_hash,status,invited_by_account_id,
      accepted_by_account_id,note,expires_at,accepted_at
    ) VALUES($1,$2,$3,$4,'accepted',$5,$6,$7,NOW()+INTERVAL '30 days',NOW())
    ON CONFLICT(token_hash) DO UPDATE SET
      status='accepted',accepted_by_account_id=EXCLUDED.accepted_by_account_id,
      accepted_at=NOW(),note=EXCLUDED.note,expires_at=EXCLUDED.expires_at
    RETURNING id
  `,[account.email,account.role,territoryId,tokenHash,ownerId,account.accountId,`Controlled fixture ${revision.slice(0,12)}; no personal data`]);
  return Number(q.rows[0].id);
}

function applicationData(account,{psgcCode,geography}){
  const common={
    onboarding_version:'controlled-role-e2e-v1',
    company_managed:true,personal_data:false,public_discovery:false,
    geography_psgc_code:psgcCode,geography_name:geography.name,
    settlement_mode:'blocked'
  };
  if(account.role==='courier')return{
    ...common,vehicle_class:'motorcycle',max_weight_kg:20,max_volume_l:80,
    service_radius_km:12,evidence_contract:COURIER_EVIDENCE_REFERENCE
  };
  if(account.role==='service_provider')return{
    ...common,professional_headline:'Controlled Local Services test profile',
    about:'Private non-settling operational fixture.',service_area:geography.name,
    years_experience:null,requested_category_ids:[]
  };
  return common;
}

async function ensureGovernedProfile(client,{account,territoryId,ownerId,revision,geography}){
  const invitationId=await ensureInvitation(client,{account,territoryId,ownerId,revision});
  const proposedName=account.role==='supplier'?'Business & Life Controlled Supplier':'';
  const app=await client.query(`
    INSERT INTO profile_applications(
      account_id,role,territory_id,invitation_id,status,proposed_business_name,
      applicant_note,responsibility_acknowledged,application_data,submitted_at,
      reviewed_by_account_id,reviewed_at,decision_reason
    ) VALUES($1,$2,$3,$4,'approved',$5,$6,TRUE,$7::jsonb,NOW(),$8,NOW(),$9)
    ON CONFLICT(account_id,role,territory_id) WHERE status NOT IN ('rejected','revoked')
    DO UPDATE SET invitation_id=EXCLUDED.invitation_id,status='approved',
      proposed_business_name=EXCLUDED.proposed_business_name,
      applicant_note=EXCLUDED.applicant_note,responsibility_acknowledged=TRUE,
      application_data=EXCLUDED.application_data,submitted_at=COALESCE(profile_applications.submitted_at,NOW()),
      reviewed_by_account_id=EXCLUDED.reviewed_by_account_id,reviewed_at=NOW(),
      decision_reason=EXCLUDED.decision_reason,updated_at=NOW()
    RETURNING id
  `,[
    account.accountId,account.role,territoryId,invitationId,proposedName,
    'Controlled company-test fixture; private and non-settling.',
    JSON.stringify(applicationData(account,{psgcCode:geography.psgc_code,geography})),
    ownerId,'Controlled operational fixture approval with assigned-role isolation'
  ]);
  const applicationId=Number(app.rows[0].id);
  await client.query(`
    INSERT INTO profile_authorizations(
      account_id,role,territory_id,application_id,status,approved_by_account_id,approved_at,reason
    ) VALUES($1,$2,$3,$4,'active',$5,NOW(),$6)
    ON CONFLICT(account_id,role,COALESCE(territory_id,0)) DO UPDATE SET
      application_id=EXCLUDED.application_id,status='active',
      approved_by_account_id=EXCLUDED.approved_by_account_id,approved_at=NOW(),
      expires_at=NULL,reason=EXCLUDED.reason,updated_at=NOW()
  `,[account.accountId,account.role,territoryId,applicationId,ownerId,'Controlled role fixture; no Super Admin self-test bypass']);
  await client.query(`
    INSERT INTO profiles(account_id,role,enabled,visibility,status)
    VALUES($1,$2,TRUE,'private','active')
    ON CONFLICT(account_id,role) DO UPDATE SET
      enabled=TRUE,visibility='private',status='active',updated_at=NOW()
  `,[account.accountId,account.role]);
  await client.query(`UPDATE accounts SET active_role=$1,updated_at=NOW() WHERE id=$2`,[account.role,account.accountId]);
  await client.query(`
    INSERT INTO profile_governance_events(
      actor_account_id,event_code,target_account_id,role,territory_id,detail_json
    ) VALUES($1,'controlled_company_test_identity_provisioned',$2,$3,$4,$5::jsonb)
  `,[ownerId,account.accountId,account.role,territoryId,JSON.stringify({
    fixture_code:FIXTURE_CODE,revision:revision.slice(0,12),visibility:'private',
    assigned_role_only:true,super_admin_bypass:false,personal_data:false,
    recovery_route:'company_owned_email_alias',credential_secret_persisted:false,
    settlement_mode:'blocked'
  })]);
  return applicationId;
}

async function ensureSupplierDomain(client,{account,territoryId,geography,environment}){
  await client.query(`
    INSERT INTO supplier_profiles(
      account_id,supplier_name,description,delivery_available,service_area,
      normal_lead_days,minimum_order_value,notes,updated_at
    ) VALUES($1,'Business & Life Controlled Supplier',$2,FALSE,$3,1,NULL,$4,NOW())
    ON CONFLICT(account_id) DO UPDATE SET
      supplier_name=EXCLUDED.supplier_name,description=EXCLUDED.description,
      delivery_available=FALSE,service_area=EXCLUDED.service_area,
      normal_lead_days=EXCLUDED.normal_lead_days,minimum_order_value=NULL,
      notes=EXCLUDED.notes,updated_at=NOW()
  `,[account.accountId,'Private non-settling Supplier E2E fixture.',geography.name,'No real orders or settlement.']);
  let binding=await client.query(`
    SELECT b.id,b.territory_id FROM profile_business_bindings pb
    JOIN businesses b ON b.id=pb.business_id
    WHERE pb.account_id=$1 AND pb.role='supplier' AND pb.status='active'
    ORDER BY pb.is_primary DESC,b.id LIMIT 1 FOR UPDATE OF b
  `,[account.accountId]);
  let businessId;
  if(binding.rowCount){
    businessId=Number(binding.rows[0].id);
    const territoryAction=controlledBusinessTerritoryAction({
      environment,currentTerritoryId:binding.rows[0].territory_id,fixtureTerritoryId:territoryId
    });
    if(territoryAction==='reject'){
      throw new Error('Controlled Supplier business is bound to a different territory.');
    }
    if(territoryAction==='assign'){
      await client.query(`UPDATE businesses SET territory_id=$1,updated_at=NOW() WHERE id=$2`,[territoryId,businessId]);
    }
  }else{
    const business=await client.query(`
      INSERT INTO businesses(name,country_code,currency_code,territory_id)
      VALUES('Business & Life Controlled Supplier','PH','PHP',$1) RETURNING id
    `,[territoryId]);
    businessId=Number(business.rows[0].id);
  }
  await client.query(`
    INSERT INTO business_memberships(business_id,account_id,membership_role,active)
    VALUES($1,$2,'owner',TRUE)
    ON CONFLICT(business_id,account_id) DO UPDATE SET membership_role='owner',active=TRUE
  `,[businessId,account.accountId]);
  await client.query(`
    UPDATE profile_business_bindings SET is_primary=FALSE,updated_at=NOW()
     WHERE account_id=$1 AND role='supplier' AND business_id<>$2
  `,[account.accountId,businessId]);
  await client.query(`
    INSERT INTO profile_business_bindings(account_id,role,business_id,status,is_primary)
    VALUES($1,'supplier',$2,'active',TRUE)
    ON CONFLICT(account_id,role,business_id) DO UPDATE SET status='active',is_primary=TRUE,updated_at=NOW()
  `,[account.accountId,businessId]);
  await client.query(`
    INSERT INTO account_business_preferences(account_id,role,business_id)
    VALUES($1,'supplier',$2)
    ON CONFLICT(account_id,role) DO UPDATE SET business_id=EXCLUDED.business_id,updated_at=NOW()
  `,[account.accountId,businessId]);
  await client.query(`INSERT INTO budgets(id,business_id) VALUES(1,$1) ON CONFLICT(business_id,id) DO NOTHING`,[businessId]);
  await client.query(`
    INSERT INTO supplier_operating_locations(
      business_id,account_id,location_mode,location_type,location_label,exact_address,visibility,updated_at
    ) VALUES($1,$2,'personal_default','warehouse_dispatch_pickup','','','private',NOW())
    ON CONFLICT(business_id) DO UPDATE SET account_id=EXCLUDED.account_id,
      location_mode='personal_default',location_type='warehouse_dispatch_pickup',
      location_label='',exact_address='',visibility='private',updated_at=NOW()
  `,[businessId,account.accountId]);
  return businessId;
}

async function ensureCourierDomain(client,{account,geography}){
  await client.query(`
    INSERT INTO courier_profiles(
      account_id,display_name,vehicle_type,available,non_commercial_test_only,max_weight_kg,max_volume_l,
      service_radius_km,eligibility_status,approved_vehicle_class,eligibility_expires_at,
      approval_note,eligibility_reviewed_by_account_id,eligibility_reviewed_at,
      eligibility_policy_version,operating_psgc_code,operating_area_name,operating_area_path,
      operating_area_source_version,updated_at
    ) VALUES($1,$2,'motorcycle',FALSE,TRUE,20,80,12,'pending','',NULL,$3,NULL,NULL,'',$4,$5,$6,$7,NOW())
    ON CONFLICT(account_id) DO UPDATE SET
      display_name=EXCLUDED.display_name,vehicle_type='motorcycle',available=FALSE,
      non_commercial_test_only=TRUE,
      max_weight_kg=20,max_volume_l=80,service_radius_km=12,
      eligibility_status='pending',approved_vehicle_class='',eligibility_expires_at=NULL,
      approval_note=EXCLUDED.approval_note,eligibility_reviewed_by_account_id=NULL,
      eligibility_reviewed_at=NULL,eligibility_policy_version='',
      operating_psgc_code=EXCLUDED.operating_psgc_code,
      operating_area_name=EXCLUDED.operating_area_name,operating_area_path=EXCLUDED.operating_area_path,
      operating_area_source_version=EXCLUDED.operating_area_source_version,updated_at=NOW()
  `,[
    account.accountId,account.displayName,'Awaiting controlled private evidence verification.',
    geography.psgc_code,geography.name,geography.path_text||'',geography.source_version||''
  ]);
}

async function ensureServiceProviderDomain(client,{account,geography}){
  await client.query(`
    INSERT INTO service_provider_profiles(
      account_id,display_name,professional_headline,about,service_area,
      years_experience,public_reputation_enabled,updated_at
    ) VALUES($1,$2,'Controlled Local Services test profile',$3,$4,NULL,FALSE,NOW())
    ON CONFLICT(account_id) DO UPDATE SET
      display_name=EXCLUDED.display_name,professional_headline=EXCLUDED.professional_headline,
      about=EXCLUDED.about,service_area=EXCLUDED.service_area,years_experience=NULL,
      public_reputation_enabled=FALSE,updated_at=NOW()
  `,[account.accountId,account.displayName,'Private non-settling operational fixture.',geography.name]);
  await client.query(`
    INSERT INTO service_provider_operating_locations(
      account_id,location_mode,location_label,exact_address,visibility,service_radius_km,updated_at
    ) VALUES($1,'personal_default','','','private',12,NOW())
    ON CONFLICT(account_id) DO UPDATE SET location_mode='personal_default',
      location_label='',exact_address='',visibility='private',service_radius_km=12,updated_at=NOW()
  `,[account.accountId]);
  await client.query(`UPDATE service_provider_services SET active=FALSE WHERE account_id=$1`,[account.accountId]);
}

async function ensureMerchantBusiness(client,merchant,territoryId,environment){
  let q=await client.query(`
    SELECT b.id,b.territory_id FROM profile_business_bindings pb
    JOIN businesses b ON b.id=pb.business_id
    WHERE pb.account_id=$1 AND pb.role='merchant' AND pb.status='active'
    ORDER BY pb.is_primary DESC,b.id LIMIT 1 FOR UPDATE OF b
  `,[merchant.id]);
  if(!q.rowCount){
    q=await client.query(`
      SELECT b.id,b.territory_id FROM business_memberships bm
      JOIN businesses b ON b.id=bm.business_id
      WHERE bm.account_id=$1 AND bm.active=TRUE ORDER BY b.id LIMIT 1 FOR UPDATE OF b
    `,[merchant.id]);
    if(!q.rowCount)throw new Error('Controlled Merchant anchor has no business workspace.');
    await client.query(`
      INSERT INTO profile_business_bindings(account_id,role,business_id,status,is_primary)
      VALUES($1,'merchant',$2,'active',TRUE)
      ON CONFLICT(account_id,role,business_id) DO UPDATE SET status='active',is_primary=TRUE,updated_at=NOW()
    `,[merchant.id,q.rows[0].id]);
  }
  const businessId=Number(q.rows[0].id);
  const territoryAction=controlledBusinessTerritoryAction({
    environment,currentTerritoryId:q.rows[0].territory_id,fixtureTerritoryId:territoryId
  });
  if(territoryAction==='reject'){
    throw new Error('Controlled Merchant anchor business is bound to a different territory.');
  }
  if(territoryAction==='assign'){
    await client.query(`UPDATE businesses SET territory_id=$1,updated_at=NOW() WHERE id=$2`,[territoryId,businessId]);
  }
  await client.query(`
    INSERT INTO account_business_preferences(account_id,role,business_id)
    VALUES($1,'merchant',$2)
    ON CONFLICT(account_id,role) DO UPDATE SET business_id=EXCLUDED.business_id,updated_at=NOW()
  `,[merchant.id,businessId]);
  await client.query(`INSERT INTO budgets(id,business_id) VALUES(1,$1) ON CONFLICT(business_id,id) DO NOTHING`,[businessId]);
  return businessId;
}

async function provisionDatabaseState({pool,config,credentials,runId}){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const owner=await client.query(`SELECT id,auth_status FROM accounts WHERE id=1 FOR UPDATE`);
    if(owner.rowCount!==1||owner.rows[0].auth_status!=='active')throw new Error('Active Project Owner account id=1 is required.');
    const ownerId=1;
    const customer=await requireAnchor(client,CUSTOMER_ALIAS,'customer');
    const merchant=await requireAnchor(client,MERCHANT_ALIAS,'merchant');
    const accounts=[];
    for(const fixture of ROLE_FIXTURES){
      accounts.push(await upsertControlledIdentity(client,fixture,credentials.get(fixture.email)));
    }
    const geographyByAccount=new Map();
    for(const account of [customer,merchant,...accounts]){
      geographyByAccount.set(account.id||account.accountId,await saveAccountGeography(
        client,account.id||account.accountId,config.psgcCode,{source:'controlled_role_fixture_v1'}
      ));
    }
    const geography=geographyByAccount.get(customer.id);
    const territoryId=Number(geography?.exact_territory?.id);
    if(!Number.isInteger(territoryId)||!['active','onboarding'].includes(geography?.exact_territory?.status)){
      throw new Error('Controlled fixture geography must resolve to an active or onboarding barangay territory.');
    }
    for(const account of accounts){
      await ensureGovernedProfile(client,{account,territoryId,ownerId,revision:config.revision,geography:geographyByAccount.get(account.accountId)});
    }
    const supplier=accounts.find(account=>account.role==='supplier');
    const courier=accounts.find(account=>account.role==='courier');
    const serviceProvider=accounts.find(account=>account.role==='service_provider');
    const supplierBusinessId=await ensureSupplierDomain(client,{
      account:supplier,territoryId,geography:geographyByAccount.get(supplier.accountId),environment:config.environment
    });
    await ensureCourierDomain(client,{account:courier,geography:geographyByAccount.get(courier.accountId)});
    await ensureServiceProviderDomain(client,{account:serviceProvider,geography:geographyByAccount.get(serviceProvider.accountId)});
    const merchantBusinessId=await ensureMerchantBusiness(client,merchant,territoryId,config.environment);
    await client.query(`
      INSERT INTO controlled_role_lifecycle_fixtures(
        fixture_code,environment_name,revision,territory_id,customer_account_id,
        merchant_account_id,merchant_business_id,supplier_account_id,supplier_business_id,
        courier_account_id,service_provider_account_id,lifecycle_status,settlement_mode,detail_json
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'provisioning','blocked',$12::jsonb)
      ON CONFLICT(fixture_code) DO UPDATE SET
        environment_name=EXCLUDED.environment_name,revision=EXCLUDED.revision,
        territory_id=EXCLUDED.territory_id,customer_account_id=EXCLUDED.customer_account_id,
        merchant_account_id=EXCLUDED.merchant_account_id,merchant_business_id=EXCLUDED.merchant_business_id,
        supplier_account_id=EXCLUDED.supplier_account_id,supplier_business_id=EXCLUDED.supplier_business_id,
        courier_account_id=EXCLUDED.courier_account_id,
        service_provider_account_id=EXCLUDED.service_provider_account_id,
        lifecycle_status='provisioning',settlement_mode='blocked',detail_json=EXCLUDED.detail_json,updated_at=NOW()
    `,[
      FIXTURE_CODE,config.environment,config.revision,territoryId,customer.id,merchant.id,merchantBusinessId,
      supplier.accountId,supplierBusinessId,courier.accountId,serviceProvider.accountId,
      JSON.stringify({flow:['customer','merchant','supplier','courier','finance'],settlement_guard:'blocked_until_explicit_acceptance'})
    ]);
    await client.query(`
      UPDATE controlled_role_fixture_runs SET status='provisioned',detail_json=$1::jsonb
       WHERE id=$2
    `,[JSON.stringify({accounts:accounts.length,territory_id:territoryId,settlement_mode:'blocked'}),runId]);
    await client.query('COMMIT');
    return{
      ownerId,customer,merchant,accounts,territoryId,merchantBusinessId,supplierBusinessId,
      supplier,courier,serviceProvider,geography
    };
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{client.release()}
}

async function ensureCourierEvidence({pool,state,config}){
  const courierId=state.courier.accountId;
  const existing=await pool.query(`
    SELECT d.id,d.private_evidence_object_id,pe.sha256,pe.byte_size,pe.scan_status
      FROM courier_documents d
      JOIN private_evidence_objects pe ON pe.id=d.private_evidence_object_id
     WHERE d.account_id=$1 AND d.document_type=$2 AND d.reference_number=$3
       AND pe.scan_status='clean' AND pe.retention_state='active'
     ORDER BY d.id DESC LIMIT 1
  `,[courierId,COURIER_EVIDENCE_TYPE,COURIER_EVIDENCE_REFERENCE]);
  let documentId,objectId,created=false,stored=null;
  if(existing.rowCount){
    documentId=Number(existing.rows[0].id);
    objectId=Number(existing.rows[0].private_evidence_object_id);
  }else{
    const pdf=controlledCourierEvidencePdf({psgcCode:config.psgcCode,areaName:state.geography.name});
    stored=await storePrivateEvidence(pool,{
      dataUrl:'data:application/pdf;base64,'+pdf.toString('base64'),
      fileName:'controlled-courier-vehicle-attestation.pdf',
      allowedMimes:['application/pdf'],maxBytes:250_000,
      ownerAccountId:courierId,actorAccountId:state.ownerId,
      sourceType:'courier_document',sourceId:`pending:${courierId}`,
      purpose:'controlled_courier_fixture_evidence',classification:'courier_document',
      correlationId:`${FIXTURE_CODE}:${config.revision.slice(0,12)}`
    });
    objectId=Number(stored.id);
    try{
      const inserted=await pool.query(`
        INSERT INTO courier_documents(
          account_id,document_type,vehicle_class,reference_number,issue_date,expiry_date,
          evidence_data_url,private_evidence_object_id,verification_status,
          verified_by_account_id,verified_at,rejection_reason
        ) VALUES($1,$2,'motorcycle',$3,CURRENT_DATE,CURRENT_DATE+365,NULL,$4,'verified',$5,NOW(),'')
        RETURNING id
      `,[courierId,COURIER_EVIDENCE_TYPE,COURIER_EVIDENCE_REFERENCE,objectId,state.ownerId]);
      documentId=Number(inserted.rows[0].id);
      await bindPrivateEvidenceSource(pool,{
        objectId,sourceType:'courier_document',sourceId:String(documentId),
        actorAccountId:state.ownerId,purpose:'controlled_courier_fixture_bind',
        correlationId:`${FIXTURE_CODE}:${config.revision.slice(0,12)}`
      });
      created=true;
    }catch(error){
      await deletePrivateEvidence(pool,{
        objectId,actorAccountId:state.ownerId,purpose:'controlled_courier_fixture_rollback',
        correlationId:`${FIXTURE_CODE}:${config.revision.slice(0,12)}`
      }).catch(()=>{});
      throw error;
    }
  }
  const evidence=await readPrivateEvidence(pool,{
    objectId,actorAccountId:state.ownerId,purpose:'controlled_courier_fixture_verify',
    correlationId:`${FIXTURE_CODE}:${config.revision.slice(0,12)}`
  });
  if(evidence.metadata.scan_status!=='clean'||!evidence.bytes.subarray(0,5).equals(Buffer.from('%PDF-'))){
    throw new Error('Controlled Courier evidence failed private-storage integrity verification.');
  }
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query(`
      UPDATE courier_documents SET vehicle_class='motorcycle',issue_date=CURRENT_DATE,
        expiry_date=CURRENT_DATE+365,verification_status='verified',verified_by_account_id=$1,
        verified_at=NOW(),rejection_reason='',updated_at=NOW()
       WHERE id=$2 AND account_id=$3
    `,[state.ownerId,documentId,courierId]);
    const approved=await client.query(`
      UPDATE courier_profiles SET eligibility_status='approved',approved_vehicle_class='motorcycle',
        eligibility_expires_at=CURRENT_DATE+365,approval_note=$1,
        eligibility_reviewed_by_account_id=$2,eligibility_reviewed_at=NOW(),
        eligibility_policy_version=$3,available=FALSE,updated_at=NOW()
       WHERE account_id=$4 AND operating_psgc_code=$5
       RETURNING account_id
    `,[
      'Controlled company-test vehicle evidence verified; non-settling and unavailable by default.',
      state.ownerId,COURIER_ELIGIBILITY_POLICY_VERSION,courierId,config.psgcCode
    ]);
    if(approved.rowCount!==1)throw new Error('Controlled Courier operating area changed before evidence approval.');
    await client.query(`
      INSERT INTO profile_governance_events(
        actor_account_id,event_code,target_account_id,role,territory_id,detail_json
      ) VALUES($1,'controlled_courier_evidence_verified',$2,'courier',$3,$4::jsonb)
    `,[state.ownerId,courierId,state.territoryId,JSON.stringify({
      fixture_code:FIXTURE_CODE,document_id:documentId,private_evidence_object_id:objectId,
      scan_status:'clean',vehicle_class:'motorcycle',operating_psgc_code:config.psgcCode,
      available:false,settlement_mode:'blocked'
    })]);
    await client.query(`
      UPDATE controlled_role_lifecycle_fixtures SET lifecycle_status='ready',
        settlement_mode='blocked',updated_at=NOW() WHERE fixture_code=$1
    `,[FIXTURE_CODE]);
    await client.query('COMMIT');
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{client.release()}
  return{documentId,objectId,created,byteSize:Number(evidence.metadata.byte_size)};
}

function cookieHeader(response){
  const values=typeof response.headers.getSetCookie==='function'
    ?response.headers.getSetCookie()
    :[response.headers.get('set-cookie')||''].filter(Boolean);
  return values.map(value=>String(value).split(';')[0]).filter(Boolean).join('; ');
}

async function requestJson(base,path,{method='GET',headers={},body}={}){
  const requestHeaders={Accept:'application/json',...headers};
  let payload;
  if(body!==undefined){requestHeaders['Content-Type']='application/json';payload=JSON.stringify(body)}
  const response=await fetch(base+path,{method,headers:requestHeaders,body:payload});
  const json=await response.json().catch(()=>({}));
  return{response,status:response.status,json};
}

async function verifyControlledLogin({base,account,credential,psgcCode}){
  const login=await requestJson(base,'/api/auth/login',{
    method:'POST',body:{email:account.email,password:credential.password}
  });
  if(login.status!==200||login.json?.auth_transport!=='cookie'||login.json?.token){
    throw new Error(`Controlled ${account.role} cookie login failed.`);
  }
  const cookie=cookieHeader(login.response);
  if(!cookie.includes('__Host-abl_session='))throw new Error(`Controlled ${account.role} login did not issue a secure session cookie.`);
  const me=await requestJson(base,'/api/me',{headers:{Cookie:cookie}});
  if(me.status!==200)throw new Error(`Controlled ${account.role} account snapshot failed.`);
  const snapshot=me.json;
  const enabled=(snapshot.profiles||[]).filter(profile=>profile.enabled===true&&profile.status==='active');
  if(snapshot.account?.account_mode!=='company_test'||snapshot.account?.test_role!==account.role||
    snapshot.account?.active_role!==account.role||enabled.length!==1||enabled[0]?.role!==account.role||
    enabled[0]?.visibility!=='private'||snapshot.geography?.psgc_code!==psgcCode){
    throw new Error(`Controlled ${account.role} role or privacy isolation failed.`);
  }
  const ownPath=account.role==='supplier'?'/api/supplier/me'
    :account.role==='courier'?'/api/courier/home':'/api/service-provider/me?view=home';
  const own=await requestJson(base,ownPath,{headers:{Cookie:cookie}});
  if(own.status!==200)throw new Error(`Controlled ${account.role} workspace is unavailable.`);
  const deniedPath=account.role==='courier'?'/api/supplier/me':'/api/courier/home';
  const denied=await requestJson(base,deniedPath,{headers:{Cookie:cookie}});
  if(denied.status!==403)throw new Error(`Controlled ${account.role} cross-role access was not denied.`);
  if(account.role==='courier'){
    const profile=own.json?.profile;
    if(profile?.eligibility_status!=='approved'||profile?.approved_vehicle_class!=='motorcycle'||
      profile?.available!==false||profile?.operating_psgc_code!==psgcCode){
      throw new Error('Controlled Courier evidence-backed runtime state is incomplete.');
    }
  }
  const logout=await requestJson(base,'/api/auth/logout',{method:'POST',headers:{Cookie:cookie},body:{}});
  if(logout.status!==200)throw new Error(`Controlled ${account.role} logout failed.`);
  return{role:account.role,login:true,workspace:true,cross_role_denied:true,private:true,logout:true};
}

async function verifyDatabaseAcceptance({pool,state,config,evidence}){
  const ids=state.accounts.map(account=>account.accountId);
  const q=await pool.query(`
    SELECT a.id,a.email,a.account_mode,a.test_role,a.phone,a.address,a.email_verified_at,
      p.role,p.enabled,p.visibility,p.status,
      (SELECT COUNT(*)::int FROM profiles px WHERE px.account_id=a.id AND px.enabled=TRUE) enabled_count
    FROM accounts a JOIN profiles p ON p.account_id=a.id AND p.role=a.test_role
    WHERE a.id=ANY($1::bigint[]) ORDER BY a.id
  `,[ids]);
  if(q.rowCount!==ROLE_FIXTURES.length||q.rows.some(row=>
    row.account_mode!=='company_test'||row.test_role!==row.role||row.enabled!==true||
    row.visibility!=='private'||row.status!=='active'||Number(row.enabled_count)!==1||
    row.phone!==''||row.address!==''||!row.email_verified_at
  ))throw new Error('Controlled identity directory or assigned-role invariant failed.');
  for(const account of [state.customer,state.merchant,...state.accounts]){
    const geo=await accountGeographySnapshot(pool,account.id||account.accountId);
    if(geo.psgc_code!==config.psgcCode)throw new Error('Controlled lifecycle geography is not deterministic.');
  }
  const lifecycle=await pool.query(`
    SELECT * FROM controlled_role_lifecycle_fixtures
    WHERE fixture_code=$1 AND lifecycle_status='ready' AND settlement_mode='blocked'
  `,[FIXTURE_CODE]);
  if(lifecycle.rowCount!==1)throw new Error('Controlled non-settling lifecycle fixture is not ready.');
  const doc=await pool.query(`
    SELECT d.verification_status,d.vehicle_class,pe.scan_status,pe.retention_state
      FROM courier_documents d JOIN private_evidence_objects pe ON pe.id=d.private_evidence_object_id
     WHERE d.id=$1 AND d.account_id=$2
  `,[evidence.documentId,state.courier.accountId]);
  if(doc.rowCount!==1||doc.rows[0].verification_status!=='verified'||doc.rows[0].vehicle_class!=='motorcycle'||
    doc.rows[0].scan_status!=='clean'||doc.rows[0].retention_state!=='active'){
    throw new Error('Controlled Courier document evidence is not verified and private.');
  }
  return{directory_ready:true,geography_deterministic:true,lifecycle_ready:true,settlement_blocked:true,evidence_private:true};
}

async function markFailure(pool,runId,error){
  await pool.query(`
    UPDATE controlled_role_fixture_runs SET status='failed',completed_at=NOW(),
      detail_json=$1::jsonb WHERE id=$2
  `,[JSON.stringify({error:safeError(error),credentials_exposed:false}),runId]).catch(()=>{});
  await pool.query(`
    UPDATE controlled_role_lifecycle_fixtures SET lifecycle_status='blocked',
      settlement_mode='blocked',updated_at=NOW() WHERE fixture_code=$1
  `,[FIXTURE_CODE]).catch(()=>{});
  await pool.query(`
    UPDATE courier_profiles SET available=FALSE,eligibility_status=CASE
      WHEN eligibility_status='approved' THEN 'pending' ELSE eligibility_status END,
      approved_vehicle_class=CASE WHEN eligibility_status='approved' THEN '' ELSE approved_vehicle_class END,
      eligibility_expires_at=CASE WHEN eligibility_status='approved' THEN NULL ELSE eligibility_expires_at END,
      updated_at=NOW()
    WHERE account_id=(SELECT courier_account_id FROM controlled_role_lifecycle_fixtures WHERE fixture_code=$1)
  `,[FIXTURE_CODE]).catch(()=>{});
}

export async function runControlledRoleFixturesIfRequested({pool,port,env=process.env}){
  const config=controlledRoleFixtureConfig(env);
  if(!config.enabled){
    console.log('CONTROLLED_ROLE_FIXTURE_SKIPPED no_wave');
    return{status:'SKIPPED',wave:''};
  }
  if(env===process.env){
    delete process.env.CONTROLLED_ROLE_FIXTURE_SECRET;
    delete process.env.CONTROLLED_ROLE_FIXTURE_ACK;
    delete process.env.CONTROLLED_ROLE_FIXTURE_WAVE;
  }
  console.log(`CONTROLLED_ROLE_FIXTURE_START ${config.wave} ${config.environment} ${config.revision.slice(0,12)}`);
  await ensureCompanyTestAccountSchema(pool);
  await ensureAccountSafetyEligibilitySchema(pool);
  await ensureAccountGeographySchema(pool);
  await ensurePrivateEvidenceSchema(pool);
  await requireRuntimeTables(pool);
  await ensureFixtureSchema(pool);
  const run=await pool.query(`
    INSERT INTO controlled_role_fixture_runs(fixture_code,wave,environment_name,revision,status,detail_json)
    VALUES($1,$2,$3,$4,'started',$5::jsonb) RETURNING id
  `,[FIXTURE_CODE,config.wave,config.environment,config.revision,JSON.stringify({
    psgc_code:config.psgcCode,roles:ROLE_FIXTURES.map(item=>item.role),
    visibility:'private',settlement_mode:'blocked',credentials_exposed:false
  })]);
  const runId=Number(run.rows[0].id);
  try{
    const credentials=new Map();
    await Promise.all(ROLE_FIXTURES.map(async fixture=>{
      credentials.set(fixture.email,await passwordCredential(config.secret,fixture.email));
    }));
    const state=await provisionDatabaseState({pool,config,credentials,runId});
    const evidence=await ensureCourierEvidence({pool,state,config});
    const database=await verifyDatabaseAcceptance({pool,state,config,evidence});
    const base='http://127.0.0.1:'+Number(port);
    const sessions=[];
    for(const account of state.accounts){
      sessions.push(await verifyControlledLogin({
        base,account,credential:credentials.get(account.email),psgcCode:config.psgcCode
      }));
    }
    const result={
      status:'PASS',wave:config.wave,environment:config.environment,
      revision:config.revision.slice(0,12),roles:sessions.map(item=>item.role),
      isolated_sessions:sessions.every(item=>item.login&&item.cross_role_denied&&item.private),
      directory_ready:database.directory_ready,geography_deterministic:database.geography_deterministic,
      courier_evidence_verified:database.evidence_private,courier_available:false,
      lifecycle_ready:database.lifecycle_ready,settlement_blocked:database.settlement_blocked,
      credentials_exposed:false
    };
    await pool.query(`
      UPDATE controlled_role_fixture_runs SET status='passed',completed_at=NOW(),detail_json=$1::jsonb
       WHERE id=$2
    `,[JSON.stringify(result),runId]);
    console.log('CONTROLLED_ROLE_FIXTURE_RESULT '+JSON.stringify(result));
    return result;
  }catch(error){
    await markFailure(pool,runId,error);
    console.error('CONTROLLED_ROLE_FIXTURE_RESULT '+JSON.stringify({
      status:'FAIL',wave:config.wave,environment:config.environment,
      revision:config.revision.slice(0,12),error:safeError(error),credentials_exposed:false
    }));
    throw error;
  }
}

export const CONTROLLED_ROLE_FIXTURE_CONTRACT=Object.freeze({
  wave:FIXTURE_WAVE,ack:FIXTURE_ACK,fixtureCode:FIXTURE_CODE,
  defaultPsgcCode:DEFAULT_PSGC_CODE,
  roles:ROLE_FIXTURES.map(item=>Object.freeze({...item}))
});
