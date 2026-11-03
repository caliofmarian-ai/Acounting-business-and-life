/**
 * Full in-process HTTP acceptance on disposable CI PostgreSQL. No real customer,
 * order posting, payment, live AI or Production connection is ever permitted.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import {signV2SessionToken} from '../auth-session-core.js';

if(process.env.STAFF_TERMINAL_HTTP_CI!=='1'||process.env.PGDATABASE!=='abl_terminal_http_ci'||process.env.DATABASE_URL)
  throw new Error('Refusing to run staff terminal HTTP test outside isolated CI database');
const port=Number(process.env.PORT||3000),base=`http://127.0.0.1:${port}`;
const pool=new pg.Pool(); // PGHOST/PGDATABASE on disposable non-TLS CI Postgres only
const request=async(path,{method='GET',body=null,headers={}}={})=>{
  const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...headers},
    body:body==null?undefined:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(20000)});
  const text=await r.text();let data;try{data=JSON.parse(text)}catch{data={html:text}};
  return{status:r.status,headers:r.headers,data};
};
function expect(result,status,label){
  assert.equal(result.status,status,`${label}: HTTP ${result.status}: ${String(result.data?.error||'').slice(0,160)}`);
  return result.data;
}

try{
  // The database is disposable and was just initialized by the real service.
  await pool.query(`UPDATE accounts SET auth_status='active',email_verified_at=COALESCE(email_verified_at,NOW())
    WHERE id=1`);
  await pool.query(`INSERT INTO profiles(account_id,role,enabled,status)
    VALUES(1,'merchant',TRUE,'active')
    ON CONFLICT(account_id,role) DO UPDATE SET enabled=TRUE,status='active'`);
  await pool.query(`INSERT INTO businesses(id,name,country_code,currency_code)
    VALUES(1,'CI Staff Terminal','PH','PHP') ON CONFLICT(id) DO NOTHING`);
  await pool.query(`INSERT INTO business_memberships(business_id,account_id,membership_role,active)
    VALUES(1,1,'owner',TRUE)
    ON CONFLICT(business_id,account_id) DO UPDATE SET membership_role='owner',active=TRUE`);
  const sid=`ci-terminal-owner-${crypto.randomBytes(8).toString('hex')}`;
  await pool.query(`INSERT INTO account_sessions(session_id,account_id,expires_at,step_up_verified_at)
    VALUES($1,1,NOW()+INTERVAL '1 hour',NOW())`,[sid]);
  const ownerToken=signV2SessionToken(process.env.TOKEN_SECRET,1,sid);
  const owner={Authorization:'Bearer '+ownerToken};
  const me=expect(await request('/api/me',{headers:owner}),200,'owner identity');
  assert.equal(me.profiles.some(p=>p.role==='merchant'&&p.enabled),true);

  const pin='694273';
  const created=expect(await request('/api/orders/team/operators',{method:'POST',headers:owner,
    body:{business_id:1,name:'CI Staff Operator',role:'order_operator',pin}}),200,'owner adds staff');
  const operatorId=created.operator.id;
  assert.ok(operatorId);
  const invite=expect(await request('/api/orders/team/terminal/pair',{method:'POST',headers:owner,
    body:{business_id:1}}),200,'owner issues pairing');
  assert.match(invite.pair_code,/^[A-Za-z0-9_-]{30,100}$/);
  assert.ok(Date.parse(invite.expires_at)>Date.now());
  const landing=expect(await request('/operator'),200,'staff portal');
  assert.match(landing.html,/Staff terminal/);
  assert.doesNotMatch(landing.html,/payments-ui\.js|auth-ui\.js/);
  expect(await request('/merchant-operator-ui.js'),200,'standalone staff JS');
  expect(await request('/merchant-operator.css'),200,'standalone staff CSS');

  const options=expect(await request('/api/orders/operator/pair/operators',{method:'POST',body:{pair_code:invite.pair_code}}),200,'employee selector');
  assert.ok(options.operators.some(o=>o.id===operatorId));
  const start=await request('/api/orders/operator/pair/start',{method:'POST',body:{pair_code:invite.pair_code,operator_id:operatorId,pin}});
  expect(start,200,'employee starts shift');
  const cookieHeader=start.headers.get('set-cookie')||'';
  assert.match(cookieHeader,/__Host-abl_operator=[A-Za-z0-9_-]+/);
  assert.match(cookieHeader,/HttpOnly/i);assert.match(cookieHeader,/SameSite=Strict/i);
  const cookie=cookieHeader.split(';')[0],workerHeaders={Cookie:cookie};
  const session=expect(await request('/api/orders/operator/session',{headers:workerHeaders}),200,'worker identity');
  assert.equal(session.operator.id,operatorId);
  assert.equal(session.capabilities.money,false);assert.equal(session.capabilities.order_create,false);
  assert.match(session.csrf_token,/^[a-f0-9]{64}$/);
  const catalog=expect(await request('/api/orders/operator/catalog',{headers:workerHeaders}),200,'worker Catalog');
  assert.ok(Array.isArray(catalog.products));
  assert.equal(JSON.stringify(catalog.products).includes('unit_cost'),false);
  const orders=expect(await request('/api/orders/operator/orders',{headers:workerHeaders}),200,'worker Orders');
  assert.ok(Array.isArray(orders.orders));

  expect(await request('/api/orders/merchant/list?business_id=1',{headers:workerHeaders}),401,'worker denied owner orders API');
  const ownerCookieConflict=await request('/api/orders/operator/session',{headers:{Cookie:cookie+'; __Host-abl_session=owner-login'}});
  expect(ownerCookieConflict,409,'no employee terminal with owner session');
  // Root account bearer is a real, already-validated V2 token from /api/me,
  // not an invented string; staff cookies and owner auth must never coexist.
  const mixedHeaders={...workerHeaders,Authorization:'Bearer '+ownerToken,
    'x-team-csrf-token':session.csrf_token};
  for(const path of ['/api/orders/operator/session','/api/orders/operator/catalog',
    '/api/orders/operator/orders']){
    const denied=await request(path,{headers:mixedHeaders});
    expect(denied,409,'mixed owner bearer + operator cookie '+path);
    assert.equal(denied.data.code,'OPERATOR_OWNER_SESSION');
  }
  for(const [path,body] of [
    ['/api/orders/operator/voice/turn',{transcript:'Three adobo',consent:true}],
    ['/api/orders/operator/voice/quote',{consent:true,draft:{}}],
    ['/api/orders/operator/pair/operators',{pair_code:invite.pair_code}],
    ['/api/orders/operator/pair/start',{pair_code:invite.pair_code,operator_id:operatorId,pin}],
    ['/api/orders/operator/logout',{}]
  ]){
    const denied=await request(path,{method:'POST',headers:mixedHeaders,body});
    expect(denied,409,'mixed owner bearer + operator cookie '+path);
    assert.equal(denied.data.code,'OPERATOR_OWNER_SESSION');
  }
  for(const path of ['/api/orders/operator/pair/operators','/api/orders/operator/pair/start']){
    const denied=await request(path,{method:'POST',headers:owner,body:{
      pair_code:invite.pair_code,operator_id:operatorId,pin}});
    expect(denied,409,'owner bearer without staff cookie '+path);
    assert.equal(denied.data.code,'OPERATOR_OWNER_SESSION');
  }

  const aiOff=await request('/api/orders/operator/voice/turn',{method:'POST',headers:{...workerHeaders,'x-team-csrf-token':session.csrf_token},
    body:{transcript:'Three adobo',consent:true}});
  expect(aiOff,503,'AI disabled by default');
  const repeat=await request('/api/orders/operator/pair/start',{method:'POST',body:{pair_code:invite.pair_code,operator_id:operatorId,pin}});
  expect(repeat,401,'one-time pairing code');
  expect(await request(`/api/orders/team/operators/${operatorId}/disable`,{method:'PATCH',headers:owner,
    body:{business_id:1}}),200,'owner disables staff');
  expect(await request('/api/orders/operator/session',{headers:workerHeaders}),401,'disabled employee denied immediately');
  console.log('Merchant operator-only real HTTP acceptance PASS: owner pair -> worker cookie -> limited Orders -> revoked.');
}finally{await pool.end()}