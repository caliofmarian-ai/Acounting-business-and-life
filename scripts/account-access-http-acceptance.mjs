import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import express from 'express';
import pg from 'pg';
import { ensureAdminSchema, requireAdminPermission } from '../admin-authorization.js';
import { sessionSecurityMiddleware } from '../session-cookie-core.js';
import { ensureAccountAccessSchema, submitAccountAccess } from '../account-access-core.js';
import { registerPublicAccountAccessRoutes, registerStaffAccountAccessRoutes } from '../server-account-access.js';

// This acceptance runner deliberately cannot point at Preview/Production.
const db = new URL(process.env.DATABASE_URL || 'http://invalid');
assert.equal(process.env.ACCOUNT_ACCESS_FIXTURE_DB, '1', 'Explicit disposable-fixture gate required');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(db.hostname), 'Only a loopback database is allowed');
assert.equal(db.pathname, '/account_access_815', 'Only the dedicated disposable database is allowed');
assert.ok(['postgres:', 'postgresql:'].includes(db.protocol));
const pool = new pg.Pool({ connectionString: db.href, ssl: false, max: 6, connectionTimeoutMillis: 3000 });
const secret = 'synthetic-account-access-fixture-secret-815-no-real-credential';
const results = [];
let server;
const valid = (extra = {}) => ({ contact_email:'fixture@example.test',name:'Synthetic fixture',reason:'sign_in',message:'Synthetic acceptance: cannot sign in after resetting password.',website:'',...extra });
async function check(name, work) { await work(); results.push({ name, passed:true }); console.log('PASS '+name); }
try {
  await pool.query(`
    CREATE TABLE accounts(id BIGINT PRIMARY KEY);
    INSERT INTO accounts(id) VALUES(1),(2),(3),(4),(5);
    CREATE TABLE territories(id BIGINT PRIMARY KEY,name TEXT,parent_id BIGINT,country_code TEXT);
    INSERT INTO territories(id,name,country_code) VALUES(10,'Fixture territory','PH');
  `);
  await ensureAdminSchema(pool);
  await ensureAccountAccessSchema(pool);
  await ensureAccountAccessSchema(pool); // Additive schema is idempotent.
  await pool.query(`
    INSERT INTO platform_admin_assignments(account_id,admin_role,authority_rank,country_code,territory_id,status,assigned_by_account_id,reason)
    VALUES(2,'country_admin','country_admin','PH',NULL,'active',1,'Synthetic fixture'),
      (3,'territory_admin','territory_admin','PH',10,'active',1,'Synthetic fixture'),
      (5,'country_admin','country_admin','US',NULL,'active',1,'Synthetic fixture');
    INSERT INTO admin_permission_grants(assignment_id,permission_code,status,granted_by_account_id,reason)
    SELECT id,'support.manage','active',1,'Synthetic fixture' FROM platform_admin_assignments WHERE account_id IN (2,3,5);
  `);
  // Identity is deliberately synthetic. This suite tests real Express/Postgres,
  // existing cookie-CSRF and permission code, NOT password/MFA sign-in E2E.
  const tokens = new Map([['qa-owner',1],['qa-country',2],['qa-scoped',3],['qa-customer',4],['qa-foreign',5]]);
  const identity = async req => {
    const id=tokens.get(String(req.headers.authorization||'').replace(/^Bearer /u,''));
    if(!id)throw Object.assign(new Error('Unauthorized'),{status:401});
    return {account:{id}};
  };
  const app=express();
  registerPublicAccountAccessRoutes(app,{pool,json:express.json,secret:()=>secret});
  app.use(sessionSecurityMiddleware);
  registerStaffAccountAccessRoutes(app,{pool,json:express.json,identity,requireAdminPermission});
  server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  const publicHeaders={'Content-Type':'application/json','X-Account-Access-Request':'1',Origin:base};
  const submit=(body=valid(),headers={})=>fetch(base+'/api/public/account-access',{method:'POST',headers:{...publicHeaders,...headers},body:typeof body==='string'?body:JSON.stringify(body)});
  const staff=(path='',token='qa-owner',body)=>fetch(base+'/api/admin/account-access'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const clear=()=>pool.query('TRUNCATE guest_account_access_requests,guest_account_access_limits RESTART IDENTITY');

  await check('public form and assets are served without sign-in and are no-store',async()=>{
    const r=await fetch(base+'/help/account-access');assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/u);assert.match(await r.text(),/id="access-form"/u);
    for(const asset of ['public.js','staff.js','style.css'])assert.equal((await fetch(base+'/account-access-assets/'+asset)).status,200);
  });
  await check('guest submission saves exactly one private row before generic acknowledgement',async()=>{
    const r=await submit();assert.equal(r.status,202);const data=await r.json();assert.equal(data.ok,true);assert.doesNotMatch(JSON.stringify(data),/fixture@example|request_id|account_id/u);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM guest_account_access_requests')).rows[0].n,1);
  });
  await check('expired session cookie and invalid bearer do not block public help',async()=>{
    const r=await submit(valid({contact_email:'expired@example.test'}),{Cookie:'__Host-abl_session=expired',Authorization:'Bearer expired'});assert.equal(r.status,202);
  });
  await check('duplicates receive the same acknowledgement without creating another row',async()=>{
    const r=await submit();assert.equal(r.status,202);assert.equal((await r.json()).ok,true);
    assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM guest_account_access_requests WHERE contact_email='fixture@example.test'")).rows[0].n,1);
  });
  await check('contact rate limit returns 429 and Retry-After',async()=>{
    assert.equal((await submit()).status,202);const r=await submit();assert.equal(r.status,429);assert.ok(Number(r.headers.get('retry-after'))>0);
  });
  await check('cross-origin submissions and missing form header are rejected',async()=>{
    assert.equal((await submit(valid(),{Origin:'https://other.example'})).status,403);
    assert.equal((await submit(valid(),{'X-Account-Access-Request':''})).status,403);
  });
  await check('parser bounds reject invalid JSON, oversized and compressed bodies',async()=>{
    assert.equal((await submit('{invalid')).status,400);
    assert.equal((await submit(valid({message:'x'.repeat(13000)}))).status,413);
    const r=await fetch(base+'/api/public/account-access',{method:'POST',headers:{...publicHeaders,'Content-Encoding':'gzip'},body:gzipSync(JSON.stringify(valid()))});assert.equal(r.status,415);
    assert.equal((await submit('text',{'Content-Type':'text/plain'})).status,415);
  });
  await check('public reads, attachments and account association are unavailable',async()=>{
    assert.equal((await fetch(base+'/api/public/account-access')).status,405);
    assert.equal((await submit({...valid(),account_id:1})).status,400);
    assert.equal((await submit({...valid(),attachment:'private'})).status,400);
  });
  await check('staff authorization negatives deny guest/customer/territory/foreign country',async()=>{
    for(const [token,status] of [['expired',401],['qa-customer',403],['qa-scoped',403],['qa-foreign',403]]){
      for(const path of ['', '/1'])assert.equal((await staff(path,token)).status,status);
      assert.equal((await staff('/1/triage',token,{status:'closed',revision:1})).status,status);
    }
    assert.equal((await fetch(base+'/admin/account-access')).status,401);
  });
  await check('authorized queue omits contact evidence and detail reads are audited',async()=>{
    const list=await staff('','qa-country');assert.equal(list.status,200);const listing=await list.json();assert.ok(listing.items.length);assert.doesNotMatch(JSON.stringify(listing),/contact_email|message|display_name/u);
    const detail=await staff('/1');assert.equal(detail.status,200);assert.equal((await detail.json()).contact_email,'fixture@example.test');
    assert.ok((await pool.query("SELECT COUNT(*)::int n FROM admin_audit_events WHERE event_code='account_access_request_read'")).rows[0].n>0);
  });
  await check('staff cookie mutations retain existing CSRF checks',async()=>{
    const path=base+'/api/admin/account-access/1/triage',payload=JSON.stringify({status:'reviewing',note:'Synthetic note',revision:1});
    const denied=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json',Cookie:'__Host-abl_session=qa-owner'},body:payload});assert.equal(denied.status,403);
    const csrf='s'.repeat(40);const allowed=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json',Cookie:'__Host-abl_session=qa-owner; __Host-abl_csrf='+csrf,'X-CSRF-Token':csrf},body:payload});assert.equal(allowed.status,200);assert.equal((await allowed.json()).revision,2);
  });
  await check('stale revision cannot overwrite another staff update',async()=>{
    assert.equal((await staff('/1/triage','qa-owner',{status:'closed',revision:1})).status,409);
    assert.equal((await pool.query('SELECT status FROM guest_account_access_requests WHERE id=1')).rows[0].status,'reviewing');
  });
  await check('revoked current support permission takes effect immediately',async()=>{
    await pool.query("UPDATE admin_permission_grants SET status='revoked' WHERE assignment_id IN(SELECT id FROM platform_admin_assignments WHERE account_id=2) AND permission_code='support.manage'");
    assert.equal((await staff('','qa-country')).status,403);
  });
  await check('database storage failure cannot return a saved acknowledgement or SQL detail',async()=>{
    await pool.query('ALTER TABLE guest_account_access_requests RENAME TO guest_account_access_requests_unavailable');
    try{const r=await submit(valid({contact_email:'storage-fail@example.test'}));assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/relation|INSERT|storage-fail@example|does not exist/u);}
    finally{await pool.query('ALTER TABLE guest_account_access_requests_unavailable RENAME TO guest_account_access_requests');}
  });
  await check('private read/update audit failure is fail-closed and rolls back changes',async()=>{
    await pool.query('ALTER TABLE admin_audit_events RENAME TO admin_audit_events_unavailable');
    try{
      const r=await staff('/1');assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/fixture@example|Synthetic fixture/u);
      assert.equal((await staff('/1/triage','qa-owner',{status:'closed',note:'Must roll back',revision:2})).status,503);
      assert.equal((await pool.query('SELECT status,revision FROM guest_account_access_requests WHERE id=1')).rows[0].status,'reviewing');
    }finally{await pool.query('ALTER TABLE admin_audit_events_unavailable RENAME TO admin_audit_events');}
  });
  await check('PostgreSQL atomic quotas hold under concurrent submissions',async()=>{
    await clear();const attempts=await Promise.allSettled(Array.from({length:10},(_,i)=>submitAccountAccess(pool,valid({message:'Synthetic concurrent request number '+i}),{secret,source:'source-'+i})));
    assert.equal(attempts.filter(x=>x.status==='fulfilled').length,3);
    assert.equal(attempts.filter(x=>x.status==='rejected'&&x.reason.status===429).length,7);
    assert.equal((await pool.query('SELECT COUNT(*)::int n FROM guest_account_access_requests')).rows[0].n,3);
  });
  await check('PostgreSQL unique constraint deduplicates simultaneous identical requests',async()=>{
    await clear();await Promise.all(Array.from({length:3},()=>submitAccountAccess(pool,valid(),{secret,source:'same-source'})));
    assert.equal((await pool.query('SELECT COUNT(*)::int n FROM guest_account_access_requests')).rows[0].n,1);
  });
  await check('audit metadata never includes the submitted private content',async()=>{
    const result=await pool.query('SELECT before_json,after_json,reason FROM admin_audit_events');assert.doesNotMatch(JSON.stringify(result.rows),/fixture@example|Synthetic acceptance|Synthetic note/u);
  });
} finally {
  if(server)await new Promise(resolve=>server.close(resolve));
  await pool.end();
  await mkdir('artifacts',{recursive:true});
  await writeFile('artifacts/account-access-integration.json',JSON.stringify({head:process.env.TESTED_SHA||null,kind:'isolated-express-postgres-with-synthetic-identity',passed:results.length,checks:results},null,2)+'\n');
}
console.log('Account-access integration: '+results.length+' checks passed. Not deployed acceptance.');
