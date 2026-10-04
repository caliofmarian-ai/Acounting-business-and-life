import pg from 'pg';
import {
  base32Encode,
  decryptMfaSecret,
  encryptMfaSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  verifyTotpCode
} from '../super-admin-mfa-core.js';
import {
  clearV2SessionMfa,
  createV2Session,
  markV2SessionMfa,
  resolveV2SessionMfa
} from '../auth-session-core.js';

const{Pool}=pg;
const fail=message=>{throw new Error(message)};

async function run(){
  if(process.env.RAILWAY_ENVIRONMENT_NAME!=='production')fail('Production Super Admin MFA smoke requires Railway production environment.');
  if(process.env.NODE_ENV!=='production')fail('Production Super Admin MFA smoke requires NODE_ENV=production.');
  if(!process.env.DATABASE_URL)fail('DATABASE_URL is required.');
  if(!process.env.TOKEN_SECRET)fail('TOKEN_SECRET is required.');
  const keyMaterial=String(process.env.SUPER_ADMIN_MFA_ENCRYPTION_KEY||process.env.TOKEN_SECRET||'');
  if(keyMaterial.length<16)fail('Stable MFA encryption key material is required.');

  const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
  const client=await pool.connect();
  const suffix=String(Date.now())+'-'+String(process.pid);
  const email=`production-smoke-mfa-${suffix}@business-life.invalid`;
  let began=false;
  try{
    await client.query('BEGIN');
    began=true;

    const schema=await client.query(`
      SELECT
        to_regclass('public.super_admin_mfa_factors') factor_table,
        to_regclass('public.super_admin_mfa_recovery_codes') recovery_table,
        to_regclass('public.auth_mfa_attempt_windows') rate_table
    `);
    const s=schema.rows[0]||{};
    if(!s.factor_table||!s.recovery_table||!s.rate_table)fail('Production MFA schema is incomplete.');

    const columns=await client.query(`
      SELECT column_name
        FROM information_schema.columns
       WHERE table_schema='public'
         AND table_name='account_sessions'
         AND column_name IN ('mfa_verified_at','mfa_method')
    `);
    if(new Set(columns.rows.map(r=>r.column_name)).size!==2)fail('Production account_sessions MFA columns are incomplete.');

    const account=await client.query(`
      INSERT INTO accounts(display_name,email,account_mode,test_role,email_verified_at,auth_status)
      VALUES('Production Smoke Super Admin MFA',$1,'company_test','super_admin',NOW(),'active')
      RETURNING id
    `,[email]);
    const accountId=Number(account.rows[0]?.id);
    if(!accountId)fail('Synthetic Production MFA account was not created.');

    await client.query(`
      INSERT INTO platform_admin_assignments(
        account_id,admin_role,authority_rank,country_code,territory_id,status,assigned_by_account_id,reason
      ) VALUES($1,'super_admin','super_admin','PH',NULL,'active',$1,'Rollback-only Super Admin MFA smoke')
    `,[accountId]);

    const rfcSecret=base32Encode(Buffer.from('12345678901234567890'));
    const envelope=encryptMfaSecret(rfcSecret,keyMaterial);
    if(envelope.includes(rfcSecret))fail('Encrypted MFA envelope leaked the raw secret.');
    if(decryptMfaSecret(envelope,keyMaterial)!==rfcSecret)fail('Production MFA encrypted secret did not round-trip.');

    await client.query(`
      INSERT INTO super_admin_mfa_factors(account_id,status,secret_ciphertext,last_totp_counter,enrolled_at)
      VALUES($1,'active',$2,-1,NOW())
    `,[accountId,envelope]);

    const first=verifyTotpCode(rfcSecret,'287082',{now:59_000,window:0,digits:6,minCounter:-1});
    if(!first.ok||first.counter!==1)fail('RFC-compatible Production TOTP verification failed.');
    await client.query(`
      UPDATE super_admin_mfa_factors SET last_totp_counter=$2,updated_at=NOW() WHERE account_id=$1
    `,[accountId,first.counter]);
    const replay=verifyTotpCode(rfcSecret,'287082',{now:59_000,window:0,digits:6,minCounter:first.counter});
    if(replay.ok)fail('Production TOTP replay protection failed.');

    const [recoveryCode]=generateRecoveryCodes(1);
    const recoveryHash=hashRecoveryCode(recoveryCode,keyMaterial);
    if(recoveryHash.includes(recoveryCode.replaceAll('-','')))fail('Recovery material was stored in raw form.');
    await client.query(`
      INSERT INTO super_admin_mfa_recovery_codes(account_id,code_hash) VALUES($1,$2)
    `,[accountId,recoveryHash]);
    const consumed=await client.query(`
      UPDATE super_admin_mfa_recovery_codes
         SET used_at=NOW()
       WHERE account_id=$1 AND code_hash=$2 AND used_at IS NULL
       RETURNING id
    `,[accountId,recoveryHash]);
    if(consumed.rowCount!==1)fail('Production recovery code was not consumed.');
    const replayRecovery=await client.query(`
      UPDATE super_admin_mfa_recovery_codes
         SET used_at=NOW()
       WHERE account_id=$1 AND code_hash=$2 AND used_at IS NULL
       RETURNING id
    `,[accountId,recoveryHash]);
    if(replayRecovery.rowCount!==0)fail('Production recovery code replay was accepted.');

    const session=await createV2Session(client,process.env.TOKEN_SECRET,accountId,{
      userAgent:'production-super-admin-mfa-smoke',
      ipHash:'rollback-only',
      stepUpVerified:true
    });
    const before=await resolveV2SessionMfa(client,process.env.TOKEN_SECRET,session.token);
    if(before?.mfaValid)fail('Fresh synthetic session unexpectedly began MFA-verified.');
    const marked=await markV2SessionMfa(client,{accountId,sessionId:session.sessionId,method:'totp'});
    if(!marked?.verifiedAt||marked.method!=='totp')fail('Production session MFA mark failed.');
    const after=await resolveV2SessionMfa(client,process.env.TOKEN_SECRET,session.token);
    if(!after?.mfaValid||after.mfaMethod!=='totp')fail('Production session MFA resolution failed.');
    await clearV2SessionMfa(client,{accountId,sessionId:session.sessionId});
    const cleared=await resolveV2SessionMfa(client,process.env.TOKEN_SECRET,session.token);
    if(cleared?.mfaValid)fail('Production session MFA clear failed.');

    await client.query(`
      INSERT INTO auth_mfa_attempt_windows(key_hash,account_id,purpose,attempts,locked_until)
      VALUES($1,$2,'production_smoke',5,NOW()+INTERVAL '15 minutes')
    `,[`production-smoke-${suffix}`,accountId]);
    const durable=await client.query(`
      SELECT attempts,locked_until IS NOT NULL locked
        FROM auth_mfa_attempt_windows
       WHERE account_id=$1 AND purpose='production_smoke'
    `,[accountId]);
    if(Number(durable.rows[0]?.attempts)!==5||durable.rows[0]?.locked!==true)fail('Durable Production MFA rate-limit state failed.');

    await client.query('ROLLBACK');
    began=false;
    const residue=await pool.query(`SELECT COUNT(*)::int count FROM accounts WHERE email=$1`,[email]);
    if(Number(residue.rows[0]?.count)!==0)fail('Production MFA smoke rollback left synthetic account residue.');

    console.log('PRODUCTION_SUPER_ADMIN_MFA_SMOKE_RESULT '+JSON.stringify({
      status:'PASS',
      environment:'production',
      rollback:true,
      schema:true,
      encrypted_secret:true,
      totp_rfc_compatible:true,
      totp_replay_blocked:true,
      recovery_single_use:true,
      session_mfa_state:true,
      durable_rate_limit:true,
      raw_secret_logged:false,
      real_money:false
    }));
  }catch(error){
    if(began)await client.query('ROLLBACK').catch(()=>{});
    console.error('PRODUCTION_SUPER_ADMIN_MFA_SMOKE_RESULT '+JSON.stringify({
      status:'FAIL',rollback:true,error:String(error?.message||error).slice(0,500)
    }));
    process.exitCode=1;
  }finally{
    client.release();
    await pool.end();
  }
}

await run();
