// Real app route, canonical password login and browser cookie/CSRF transport.
// No Railway credentials, production database or payment provider is used.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes,scryptSync} from 'node:crypto';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {setTimeout as sleep} from 'node:timers/promises';
import pg from 'pg';
import {CSRF_COOKIE_NAME,SESSION_COOKIE_NAME} from '../session-cookie-core.js';
import {runPurchaseIntent881Acceptance} from '../qa-purchase-intent-881.js';

const database='abl_purchase_intent_runtime_ci';
const {PGHOST,PGPORT,PGUSER,PGPASSWORD,PGDATABASE,NODE_ENV,ABL_PURCHASE_INTENT_CI,DATABASE_URL}=process.env;
if(NODE_ENV!=='test'||ABL_PURCHASE_INTENT_CI!=='1'||DATABASE_URL||PGHOST!=='127.0.0.1'||PGDATABASE!==database){
  throw new Error('Inventory purchase acceptance requires its disposable localhost PostgreSQL database');
}
const pool=new pg.Pool({host:PGHOST,port:PGPORT,user:PGUSER,password:PGPASSWORD,database,ssl:false,connectionTimeoutMillis:5000});
const portReservation=createServer();
portReservation.listen(0,'127.0.0.1');
await once(portReservation,'listening');
const port=String(portReservation.address().port),base='http://127.0.0.1:'+port;
await new Promise((resolve,reject)=>portReservation.close(error=>error?reject(error):resolve()));
const aliases={merchant:'purchase-881-merchant@example.test',customer:'purchase-881-customer@example.test'};
const cookies=new Map();

async function requestJson(origin,path,{method='GET',token,body,headers={}}={}){
  assert.equal(origin,base,'CI requests must remain on the disposable loopback server');
  const session=cookies.get(token);
  const response=await fetch(base+path,{
    method,
    headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'}),
      ...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrf}:{}),...headers},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)
  });
  return {status:response.status,json:await response.json().catch(()=>({})),headers:response.headers};
}

async function qaAccountSession({email,role}){
  assert.equal(email,aliases[role]);
  const password=randomBytes(24).toString('base64url'),salt=randomBytes(16).toString('hex');
  const hash=scryptSync(password,salt,64).toString('hex');
  const result=await pool.query(`INSERT INTO accounts(display_name,email,active_role,password_salt,password_hash,
       auth_status,email_verified_at,account_mode,test_role) VALUES($1,$2,$3,$4,$5,'active',NOW(),'company_test',$3) RETURNING id`,
  ['Purchase 881 CI '+role,email,role,salt,hash]);
  const accountId=result.rows[0].id;
  await pool.query("INSERT INTO profiles(account_id,role,enabled,status,visibility) VALUES($1,$2,TRUE,'active','private')",[accountId,role]);
  const login=await requestJson(base,'/api/auth/login',{method:'POST',body:{email,password}});
  assert.equal(login.status,200,'Canonical login succeeds for the disposable '+role);
  assert.equal(login.json.auth_transport,'cookie','Login uses the browser session transport');
  assert.equal(login.json.token,undefined,'Browser login returns no raw bearer credential');
  const setCookies=login.headers.getSetCookie();
  const session=setCookies.find(value=>value.startsWith(SESSION_COOKIE_NAME+'='));
  const csrfCookie=setCookies.find(value=>value.startsWith(CSRF_COOKIE_NAME+'='));
  assert.ok(session&&csrfCookie,'Login issues both secure session cookies');
  assert.match(session,/; HttpOnly(?:;|$)/);
  const csrf=decodeURIComponent(csrfCookie.split(';',1)[0].slice(CSRF_COOKIE_NAME.length+1));
  cookies.set(role,{cookie:[session,csrfCookie].map(value=>value.split(';',1)[0]).join('; '),csrf});
  return {accountId,token:role};
}

async function ensureActiveRole({token,role}){
  const response=await requestJson(base,'/api/me/active-role',{method:'PATCH',token,body:{role}});
  assert.equal(response.status,200,'Canonical role selection succeeds');
}

async function withRejectedExpense(businessId,receive){
  assert.match(String(businessId),/^[1-9][0-9]*$/);
  await pool.query(`CREATE FUNCTION ci_purchase_881_reject_expense() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.business_id=TG_ARGV[0]::bigint AND NEW.source='inventory_purchase' THEN
        RAISE EXCEPTION 'Forced expense insert rejection in isolated Inventory CI';
      END IF;
      RETURN NEW;
    END; $$`);
  try{
    await pool.query(`CREATE TRIGGER ci_purchase_881_reject_expense BEFORE INSERT ON transactions
      FOR EACH ROW EXECUTE FUNCTION ci_purchase_881_reject_expense('${businessId}')`);
    return await receive();
  }finally{
    await pool.query('DROP FUNCTION ci_purchase_881_reject_expense() CASCADE');
  }
}

let app,appOutput='';
try{
  const target=await pool.query("SELECT current_database() AS name,to_regclass('accounts') AS accounts");
  assert.equal(target.rows[0].name,database);
  assert.equal(target.rows[0].accounts,null,'A fresh PostgreSQL database is required');
  app=spawn(process.execPath,['server-paymongo.js'],{env:{
    PATH:process.env.PATH,PGHOST,PGPORT:PGPORT||'5432',PGUSER:PGUSER||'postgres',PGPASSWORD:PGPASSWORD||'',PGDATABASE,
    NODE_ENV:'test',APP_ENV:'test',RAILWAY_SERVICE_NAME:'accounting-purchase-intent-runtime-ci',
    PORT:port,TOKEN_SECRET:randomBytes(32).toString('hex'),APP_PIN:'0000',PAYMONGO_MODE:'test',PAYMONGO_LIVE_ENABLED:'false'
  },stdio:['ignore','pipe','pipe']});
  for(const stream of [app.stdout,app.stderr])stream.on('data',chunk=>{appOutput=(appOutput+chunk).slice(-10000)});
  let health;
  for(let attempt=0;attempt<120&&app.exitCode===null;attempt++){
    health=await requestJson(base,'/health').catch(()=>null);
    if(health?.status===200)break;
    await sleep(500);
  }
  assert.equal(health?.status,200,'Full application gateway starts on isolated PostgreSQL');
  const outcome=await runPurchaseIntent881Acceptance({pool,base,aliases,
    helpers:{requestJson,qaAccountSession,ensureActiveRole,withRejectedExpense}});
  assert.equal(outcome.status,'PASS');
  console.log(JSON.stringify({...outcome,browser_cookie_csrf:true,real_application_route:true}));
}catch(error){
  if(appOutput)console.error(appOutput);
  throw error;
}finally{
  if(app&&app.exitCode===null&&app.signalCode===null){
    const exited=once(app,'exit');
    app.kill('SIGTERM');
    const forced=setTimeout(()=>app.kill('SIGKILL'),5000);
    try{await exited}finally{clearTimeout(forced)}
  }
  await pool.end();
}
