import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCOUNT_ACCESS_ACK, AccountAccessError, validateAccountAccessInput, accountAccessDigest,
  ensureAccountAccessSchema, submitAccountAccess, isUnscopedSupportAssignment,
  accountAccessId, validateAccountAccessTriage, listAccountAccess, readAccountAccess, triageAccountAccess
} from '../account-access-core.js';
import {
  accountAccessHeaders, accountAccessPublicOrigin, accountAccessError,
  registerPublicAccountAccessRoutes, registerStaffAccountAccessRoutes
} from '../server-account-access.js';

const secret = 'synthetic-test-secret-not-a-real-credential-815';
const valid = (extra = {}) => ({ contact_email: 'person@example.test', name: 'Test Person', reason: 'sign_in', message: 'I cannot sign in after requesting a password reset.', website: '', ...extra });
const actor = { accountId: 9, assignmentId: 7 };

class MemoryPool {
  constructor() { this.rows = []; this.limits = new Map(); this.audits = []; this.queries = []; this.releases = 0; this.fail = ''; }
  async query(sql, params = []) { return this.execute(sql, params); }
  async connect() {
    let snapshot;
    return { query: async (sql, params = []) => {
      if (sql === 'BEGIN') snapshot = { rows: structuredClone(this.rows), limits: new Map(this.limits), audits: structuredClone(this.audits) };
      if (sql === 'ROLLBACK' && snapshot) Object.assign(this, snapshot);
      return this.execute(sql, params);
    }, release: () => { this.releases++; } };
  }
  async execute(sql, params) {
    this.queries.push({ sql, params });
    if (this.fail && sql.includes(this.fail)) throw new Error('private-sql-error person@example.test recovery-secret');
    if (/CREATE TABLE/u.test(sql) || ['BEGIN','COMMIT','ROLLBACK'].includes(sql) || /^DELETE FROM guest_account_access_limits/u.test(sql)) return { rows: [], rowCount: 0 };
    if (/INSERT INTO guest_account_access_limits/u.test(sql)) {
      const count = Math.min((this.limits.get(params[0]) || 0) + 1, params[1] + 1);
      this.limits.set(params[0], count);
      return { rows: [{ attempts: count, day: '2026-10-27', retry_after: 123 }] };
    }
    if (/INSERT INTO guest_account_access_requests/u.test(sql)) {
      if (!this.rows.some(r => r.dedupe_key === params[4])) this.rows.push({ id: this.rows.length + 1, contact_email: params[0], display_name: params[1], reason: params[2], message: params[3], dedupe_key: params[4], status: 'new', staff_note: '', revision: 1 });
      return { rows: [] };
    }
    if (/INSERT INTO admin_audit_events/u.test(sql)) { this.audits.push(params); return { rows: [] }; }
    if (/SELECT id,reason,status/u.test(sql)) return { rows: this.rows.filter(r => (params[0] == null || r.id < params[0]) && (params[1] === 'all' || r.status === params[1])).sort((a,b) => b.id-a.id).slice(0,26).map(({id,reason,status,revision}) => ({id,reason,status,revision})) };
    if (/SELECT status,revision/u.test(sql)) return { rows: this.rows.filter(r => r.id === params[0]).map(r => ({ status: r.status, revision: r.revision })) };
    if (/SELECT id,contact_email/u.test(sql)) return { rows: this.rows.filter(r => r.id === params[0]).map(r => { const {dedupe_key, ...item} = r; return {...item}; }) };
    if (/UPDATE guest_account_access_requests/u.test(sql)) {
      const row = this.rows.find(r => r.id === params[0]);
      Object.assign(row, { status: params[1], staff_note: params[2], revision: row.revision+1 });
      return { rows: [{ id: row.id, status: row.status, revision: row.revision }] };
    }
    throw new Error('Unexpected query in test fixture');
  }
}
const options = { secret, source: '192.0.2.1' };
function response() {
  return { statusCode: 200, headers: {}, payload: undefined,
    setHeader(k,v) { this.headers[k.toLowerCase()] = v; },
    status(n) { this.statusCode = n; return this; }, json(v) { this.payload = v; return this; },
    sendFile(file) { this.file = file; return this; }
  };
}
function registry() {
  const routes = [];
  const app = Object.fromEntries(['get','post','all'].map(method => [method, (path,...handlers) => routes.push({method,path,handlers})]));
  return { app, routes, jsonOptions: [], json(opts) { this.jsonOptions.push(opts); return (_req,_res,next) => next(); } };
}

for (const [label, input] of [
  ['null', null], ['array', []], ['email object', valid({ contact_email: {} })],
  ['email newline', valid({ contact_email: 'a@example.test\r\nb@example.test' })], ['email missing domain', valid({ contact_email: 'a@localhost' })],
  ['email too long', valid({ contact_email: 'x'.repeat(250)+'@example.test' })], ['name multiline', valid({ name: 'a\nb' })], ['name too long', valid({ name: 'x'.repeat(81) })],
  ['invalid reason', valid({ reason: 'approve_merchant' })], ['short message', valid({ message: 'short' })], ['long message', valid({ message: 'x'.repeat(2001) })],
  ['message object', valid({ message: {} })], ['control character', valid({ message: 'x'.repeat(20)+'\u0000' })],
  ['attachment', { ...valid(), attachment: 'data:image/png;base64,private' }],
  ['account association', { ...valid(), account_id: 1 }], ['territory association', { ...valid(), territory_id: 1 }],
  ['honeypot', valid({ website: 'https://spam.invalid' })]
]) test(`input rejects ${label}`, () => assert.throws(() => validateAccountAccessInput(input), e => e.status === 400));

test('normalizes input and accepts Unicode/newlines without executing HTML', () => {
  const result = validateAccountAccessInput(valid({ contact_email: ' Person@Example.Test ', name: '  Ana Ștefan ', message: '<script>alert(1)</script>\nCannot sign in.' }));
  assert.equal(result.contactEmail, 'person@example.test');
  assert.equal(result.name, 'Ana Ștefan');
  assert.match(result.message, /<script>/u);
});
test('requires a strong configured digest secret; domain separates private hashes', () => {
  assert.throws(() => accountAccessDigest('', 'contact', 'x'), e => e.status === 503);
  assert.notEqual(accountAccessDigest(secret,'contact','x'), accountAccessDigest(secret,'source','x'));
  assert.match(accountAccessDigest(secret,'contact','x'), /^[a-f0-9]{64}$/u);
});
test('schema is separate from authenticated support and accounts', async () => {
  const pool = new MemoryPool(); await ensureAccountAccessSchema(pool);
  assert.match(pool.queries[0].sql, /guest_account_access_requests/u);
  assert.doesNotMatch(pool.queries[0].sql, /ALTER TABLE|support_tickets|REFERENCES accounts/u);
});
test('durable success returns generic acknowledgement and performs no account lookup/recovery', async () => {
  const pool = new MemoryPool(); const result = await submitAccountAccess(pool, valid(), options);
  assert.deepEqual(result, ACCOUNT_ACCESS_ACK);
  assert.equal(pool.rows.length, 1);
  assert.equal(pool.queries.at(-1).sql, 'COMMIT');
  assert.equal(pool.releases, 1);
  assert.doesNotMatch(pool.queries.map(q => q.sql).join('\n'), /FROM accounts|UPDATE accounts|support_tickets|recovery_token/u);
  assert.doesNotMatch(JSON.stringify(result), /person@example|Test Person|request_id|receipt/u);
  for (const q of pool.queries.filter(q => /INSERT INTO guest_account_access_limits/u.test(q.sql))) assert.match(q.params[0], /^[a-f0-9]{64}$/u);
});
test('repeated identical requests are idempotent without revealing duplication', async () => {
  const pool = new MemoryPool();
  const a = await submitAccountAccess(pool, valid(), options);
  const b = await submitAccountAccess(pool, valid(), options);
  assert.deepEqual(a,b); assert.equal(pool.rows.length,1);
});
for (const fail of ['INSERT INTO guest_account_access_requests','COMMIT']) test(`storage failure at ${fail} never acknowledges; rolls back`, async () => {
  const pool = new MemoryPool(); pool.fail = fail;
  await assert.rejects(submitAccountAccess(pool, valid(), options));
  assert.equal(pool.rows.length,0); assert.equal(pool.limits.size,0); assert.equal(pool.releases,1);
  assert.equal(pool.queries.at(-1).sql,'ROLLBACK');
});
test('connection failure never acknowledges', async () => {
  await assert.rejects(submitAccountAccess({connect:async()=>{throw new Error('unavailable');}},valid(),options));
});
test('per-contact quota applies even when source changes', async () => {
  const pool = new MemoryPool();
  for(let i=0;i<3;i++) await submitAccountAccess(pool,valid({message:'Cannot sign in. Attempt '+i}),{...options,source:'192.0.2.'+i});
  await assert.rejects(submitAccountAccess(pool,valid(),{...options,source:'192.0.2.9'}),e=>e.status===429&&e.retryAfter===123);
  assert.equal(pool.rows.length,3);
});
test('per-source quota applies across different contacts', async () => {
  const pool = new MemoryPool();
  for(let i=0;i<60;i++) await submitAccountAccess(pool,valid({contact_email:`person${i}@example.test`}),options);
  await assert.rejects(submitAccountAccess(pool,valid({contact_email:'extra@example.test'}),options),e=>e.status===429);
  assert.equal(pool.rows.length,60);
});
test('global quota bounds distributed requests', async () => {
  const pool = new MemoryPool();
  for(let i=0;i<300;i++) await submitAccountAccess(pool,valid({contact_email:`person${i}@example.test`}),{...options,source:'source-'+i});
  await assert.rejects(submitAccountAccess(pool,valid(),{...options,source:'extra'}),e=>e.status===429);
  assert.equal(pool.rows.length,300);
});
for (const bad of [null,{}, {country_code:'US'}, {country_code:'PH',territory_id:1}, {admin_role:'super_admin',territory_id:1}]) test('unverified territory cannot authorize '+JSON.stringify(bad),()=>assert.equal(isUnscopedSupportAssignment(bad),false));
test('scope helper accepts only already-permission-checked unscoped PH/platform assignments',()=>{
  assert.equal(isUnscopedSupportAssignment({country_code:'PH',territory_id:null}),true);
  assert.equal(isUnscopedSupportAssignment({admin_role:'super_admin',territory_id:null}),true);
});
for(const id of ['0','-1','1e2','01','1 OR 1=1','9007199254740992',{},undefined]) test('rejects invalid private id '+String(id),()=>assert.throws(()=>accountAccessId(id)));
test('triage input bounds and optimistic revision are required',()=>{
  assert.deepEqual(validateAccountAccessTriage({status:'reviewing',note:'review started',revision:1}),{status:'reviewing',note:'review started',revision:1});
  for(const input of [{status:'approved',revision:1},{status:'new',revision:0},{status:'new',revision:'1'},{status:'new',revision:1,note:'x'.repeat(1001)},{status:'new',revision:1,account_id:1}]) assert.throws(()=>validateAccountAccessTriage(input));
});
test('list returns bounded keyset pages without contact details or messages',async()=>{
  const pool=new MemoryPool();
  for(let i=0;i<30;i++) await submitAccountAccess(pool,valid({contact_email:`person${i}@example.test`}),options);
  const first=await listAccountAccess(pool,actor,{status:'all'});
  assert.equal(first.items.length,25); assert.equal(first.next_cursor,'6');
  assert.doesNotMatch(JSON.stringify(first),/contact_email|display_name|message|dedupe_key/u);
  const second=await listAccountAccess(pool,actor,{status:'all',before:first.next_cursor});
  assert.equal(second.items.length,5); assert.equal(second.next_cursor,null);
  assert.equal(pool.audits.length,2);
});
test('detail is private and audited without putting evidence in audit metadata',async()=>{
  const pool=new MemoryPool(); await submitAccountAccess(pool,valid(),options);
  const item=await readAccountAccess(pool,actor,'1');
  assert.equal(item.contact_email,'person@example.test'); assert.equal(item.dedupe_key,undefined);
  assert.doesNotMatch(JSON.stringify(pool.audits),/person@example|Cannot sign|Test Person/u);
});
test('failed read audit prevents evidence return',async()=>{
  const pool=new MemoryPool(); await submitAccountAccess(pool,valid(),options); pool.fail='INSERT INTO admin_audit_events';
  await assert.rejects(readAccountAccess(pool,actor,'1')); await assert.rejects(listAccountAccess(pool,actor));
});
test('triage uses row lock and revision; concurrent stale update cannot overwrite',async()=>{
  const pool=new MemoryPool(); await submitAccountAccess(pool,valid(),options);
  const result=await triageAccountAccess(pool,actor,'1',{status:'reviewing',note:'Needs established recovery checks',revision:1});
  assert.equal(result.revision,2);
  await assert.rejects(triageAccountAccess(pool,actor,'1',{status:'closed',revision:1}),e=>e.status===409);
  assert.equal(pool.rows[0].status,'reviewing');
  assert.match(pool.queries.find(q=>/SELECT status,revision/u.test(q.sql)).sql,/FOR UPDATE/u);
});
test('failed update audit rolls back status and staff note',async()=>{
  const pool=new MemoryPool(); await submitAccountAccess(pool,valid(),options); pool.fail='INSERT INTO admin_audit_events';
  await assert.rejects(triageAccountAccess(pool,actor,'1',{status:'closed',note:'private',revision:1}));
  assert.equal(pool.rows[0].status,'new'); assert.equal(pool.rows[0].staff_note,''); assert.equal(pool.rows[0].revision,1);
});
test('missing case read and triage are 404 for authorized callers',async()=>{
  const pool=new MemoryPool();
  await assert.rejects(readAccountAccess(pool,actor,'1'),e=>e.status===404);
  await assert.rejects(triageAccountAccess(pool,actor,'1',{status:'closed',revision:1}),e=>e.status===404);
});

const sameOrigin={host:'caliof.com',origin:'https://caliof.com','sec-fetch-site':'same-origin','x-account-access-request':'1','content-type':'application/json'};
test('same-origin public form works with expired cookie and does not inspect credentials',()=>{
  let called=false;const res=response();
  accountAccessPublicOrigin({headers:{...sameOrigin,cookie:'__Host-abl_session=expired',authorization:'Bearer expired'}},res,()=>{called=true;});
  assert.equal(called,true);
});
for(const [label,headers] of [
  ['foreign origin',{...sameOrigin,origin:'https://evil.example'}],
  ['null origin',{...sameOrigin,origin:'null'}],
  ['same site sibling',{...sameOrigin,origin:'https://other.caliof.com','sec-fetch-site':'same-site'}],
  ['cross-site metadata',{...sameOrigin,'sec-fetch-site':'cross-site'}],
  ['no custom header',{...sameOrigin,'x-account-access-request':undefined}],
  ['plaintext production origin',{...sameOrigin,origin:'http://caliof.com'}]
]) test('public origin rejects '+label,()=>{
  const res=response();accountAccessPublicOrigin({headers},res,()=>assert.fail('unexpected next'));
  assert.equal(res.statusCode,403);
});
test('public endpoint rejects form and multipart content types',()=>{
  for(const type of ['text/plain','application/x-www-form-urlencoded','multipart/form-data']) {
    const res=response();accountAccessPublicOrigin({headers:{...sameOrigin,'content-type':type}},res,()=>assert.fail('unexpected next'));
    assert.equal(res.statusCode,415);
  }
});
test('responses are no-store and frame/script constrained',()=>{
  const res=response();accountAccessHeaders({},res,()=>{});
  assert.match(res.headers['cache-control'],/no-store/u); assert.equal(res.headers['referrer-policy'],'no-referrer');
  assert.match(res.headers['content-security-policy'],/frame-ancestors 'none'/u);
  assert.doesNotMatch(res.headers['content-security-policy'],/unsafe-inline/u);
});
for(const [error,status] of [[new Error('private-sql-error person@example.test'),503],[{type:'entity.too.large'},413],[{type:'entity.parse.failed',body:'private'},400],[{type:'encoding.unsupported'},415]]) test('safe parser/storage failure '+status,()=>{
  const res=response(); accountAccessError(error,{},res,()=>{});
  assert.equal(res.statusCode,status);assert.doesNotMatch(JSON.stringify(res.payload),/person@example|private-sql|stack/u);
});
test('rate error includes bounded retry header',()=>{
  const res=response();accountAccessError(new AccountAccessError(429,'ACCOUNT_ACCESS_RATE_LIMIT','Wait',123),{},res,()=>{});
  assert.equal(res.headers['retry-after'],'123');
});
test('public registration is isolated and uses its own 12kb uncompressed parser',async()=>{
  const r=registry(),pool=new MemoryPool();
  registerPublicAccountAccessRoutes(r.app,{pool,json:r.json.bind(r),secret:()=>secret});
  assert.deepEqual(r.jsonOptions,[{limit:'12kb',strict:true,inflate:false,type:'application/json'}]);
  const route=r.routes.find(x=>x.method==='post');
  assert.equal(route.path,'/api/public/account-access');
  const res=response();
  await route.handlers[3]({body:valid(),socket:{remoteAddress:'192.0.2.1'},headers:{cookie:'expired'}},res,e=>{throw e;});
  assert.equal(res.statusCode,202);assert.deepEqual(res.payload,ACCOUNT_ACCESS_ACK);
  assert.equal(r.routes.some(x=>x.path==='/api/support/tickets'),false);
});
test('staff registration requires authentication and existing support.manage before storage',async()=>{
  const r=registry(),pool=new MemoryPool();let permission;
  registerStaffAccountAccessRoutes(r.app,{pool,json:r.json.bind(r),identity:async()=>({account:{id:9}}),requireAdminPermission:async(_pool,id,p)=>{permission={id,p};return{id:7,country_code:'PH',territory_id:null};}});
  const route=r.routes.find(x=>x.path==='/api/admin/account-access');
  const req={};let next=false;await route.handlers[1](req,response(),()=>{next=true;});
  assert.equal(next,true);assert.deepEqual(permission,{id:9,p:'support.manage'});assert.deepEqual(req.accountAccessActor,actor);
  assert.equal(pool.queries.length,0);
});
for(const [label,identity,permission,status] of [
  ['guest',async()=>{throw Object.assign(new Error('Expired private token'),{status:401});},async()=>{throw new Error('must not run');},401],
  ['customer',async()=>({account:{id:9}}),async()=>{throw Object.assign(new Error('private permission detail'),{status:403});},403],
  ['territory support',async()=>({account:{id:9}}),async()=>({id:7,country_code:'PH',territory_id:12}),403],
  ['foreign country',async()=>({account:{id:9}}),async()=>({id:7,country_code:'US',territory_id:null}),403]
]) test('staff denies '+label+' before reading any request',async()=>{
  const r=registry(),pool=new MemoryPool();registerStaffAccountAccessRoutes(r.app,{pool,json:r.json.bind(r),identity,requireAdminPermission:permission});
  for(const route of r.routes){const res=response();await route.handlers[1]({},res,()=>assert.fail('unauthorized next'));assert.equal(res.statusCode,status);assert.doesNotMatch(JSON.stringify(res.payload),/private token|permission detail/u);}
  assert.equal(pool.queries.length,0);
});
