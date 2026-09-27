import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  ensureHighRiskVelocitySchema,
  enforceHighRiskVelocity,
  highRiskVelocityErrorBody,
  highRiskVelocityRules
} from '../abuse-velocity-core.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const core=read('abuse-velocity-core.js');
const servers={
  auth:read('server-auth.js'),
  orders:read('server-orders.js'),
  marketplace:read('server-marketplace.js'),
  services:read('server-services.js'),
  payments:read('server-payments.js'),
  governance:read('server-profile-governance.js'),
  delivery:read('server-delivery.js'),
  incidents:read('server-incidents.js'),
  admin:read('server-admin-operations.js'),
  suppliers:read('server-suppliers.js'),
  sourcing:read('server-supplier-sourcing-v4.js'),
  paymongo:read('server-paymongo.js')
};

function fakeVelocityPool(){
  const counters=new Map(),denials=[],queryArgs=[];
  let commits=0,rollbacks=0,releases=0;
  const client={
    async query(sql,args=[]){
      queryArgs.push(args);
      if(/^\s*BEGIN\s*$/i.test(sql))return{rows:[]};
      if(/^\s*COMMIT\s*$/i.test(sql)){commits++;return{rows:[]}}
      if(/^\s*ROLLBACK\s*$/i.test(sql)){rollbacks++;return{rows:[]}}
      if(sql.includes('INSERT INTO high_risk_velocity_buckets')){
        const[hash,,action,windowSeconds]=args;
        const key=`${hash}:${action}:${windowSeconds}`;
        const next=(counters.get(key)?.attempt_count||0)+1;
        const windowStartedAt=new Date(Math.floor(Date.now()/(windowSeconds*1000))*windowSeconds*1000);
        counters.set(key,{attempt_count:next,window_started_at:windowStartedAt});
        return{rows:[{attempt_count:next,window_started_at:windowStartedAt}]};
      }
      if(sql.includes('INSERT INTO high_risk_velocity_denials')){
        denials.push(args);
        return{rows:[]};
      }
      if(sql.includes('UPDATE high_risk_velocity_buckets'))return{rows:[]};
      throw new Error(`Unexpected fake query: ${String(sql).trim().slice(0,100)}`);
    },
    release(){releases++}
  };
  return{
    connect:async()=>client,
    state:{counters,denials,queryArgs,get commits(){return commits},get rollbacks(){return rollbacks},get releases(){return releases}}
  };
}

test('velocity schema uses atomic DB counters and privacy-minimised denial audit',async()=>{
  const calls=[];
  await ensureHighRiskVelocitySchema({query:async(sql)=>{calls.push(sql);return{rows:[]}}});
  const schema=calls.join('\n');
  assert.match(schema,/CREATE TABLE IF NOT EXISTS high_risk_velocity_buckets/);
  assert.match(schema,/PRIMARY KEY\(actor_key_hash,action_code,window_seconds,window_started_at\)/);
  assert.match(schema,/CREATE TABLE IF NOT EXISTS high_risk_velocity_denials/);
  assert.match(schema,/DELETE FROM high_risk_velocity_buckets[\s\S]{0,100}INTERVAL '8 days'/);
  assert.match(core,/ON CONFLICT\(actor_key_hash,action_code,window_seconds,window_started_at\)/);
  assert.match(core,/attempt_count=high_risk_velocity_buckets\.attempt_count\+1/);
  assert.match(core,/\$4::integer,[\s\S]{0,140}\(\$4::integer\)[\s\S]{0,40}\(\$4::integer\)/);
  assert.doesNotMatch(core,/ip_address|user_agent|request_body|latitude|longitude|data_url|evidence_data/);
});

test('registry covers every P0 mutation family with burst and sustained limits',()=>{
  assert.deepEqual(highRiskVelocityRules('order_create'),[
    {windowSeconds:300,maxAttempts:8},
    {windowSeconds:3600,maxAttempts:40},
    {windowSeconds:86400,maxAttempts:120}
  ]);
  assert.deepEqual(highRiskVelocityRules('incident_submit'),[
    {windowSeconds:3600,maxAttempts:12},
    {windowSeconds:86400,maxAttempts:40}
  ]);
  for(const action of [
    'order_cancel','service_job_create','service_job_cancel','refund_request',
    'payout_destination_change','upload_private','upload_public','incident_note',
    'review_submit','invitation_create','referral_event_account','referral_event_public',
    'account_location_change','store_location_change','courier_location_update'
  ])assert.ok(highRiskVelocityRules(action).length>=2,`${action} needs burst and sustained windows`);
  assert.ok(highRiskVelocityRules('courier_location_update')[0].maxAttempts>highRiskVelocityRules('store_location_change')[0].maxAttempts);
  assert.throws(()=>highRiskVelocityRules('not_registered'),e=>e.code==='UNKNOWN_VELOCITY_ACTION');
});

test('the ninth five-minute order attempt is denied and audited before the 429',async()=>{
  const pool=fakeVelocityPool();
  for(let i=0;i<8;i++)await enforceHighRiskVelocity(pool,{actorAccountId:42,actionCode:'order_create',subjectType:'business',subjectId:7});
  await assert.rejects(
    ()=>enforceHighRiskVelocity(pool,{actorAccountId:42,actionCode:'order_create',subjectType:'business',subjectId:7}),
    error=>error.status===429&&error.code==='HIGH_RISK_VELOCITY_LIMIT'&&error.retryAfterSeconds>0
  );
  assert.equal(pool.state.denials.length,1);
  assert.equal(pool.state.denials[0][2],'order_create');
  assert.equal(pool.state.denials[0][5],8);
  assert.equal(pool.state.denials[0][6],300);
  assert.equal(pool.state.commits,9,'the denial audit must commit before the caller receives 429');
  assert.equal(pool.state.rollbacks,0);
  assert.equal(pool.state.releases,9);
});

test('public actors are HMAC pseudonyms and raw network identifiers never reach persistence',async()=>{
  const pool=fakeVelocityPool();
  const actorKey='203.0.113.8|Example Browser/1.0';
  for(let i=0;i<8;i++)await enforceHighRiskVelocity(pool,{actorKey,secret:'test-secret',actionCode:'order_create',subjectType:'public_test',subjectId:'ping'});
  await assert.rejects(()=>enforceHighRiskVelocity(pool,{actorKey,secret:'test-secret',actionCode:'order_create'}),e=>e.status===429);
  const persisted=JSON.stringify(pool.state.queryArgs);
  assert.doesNotMatch(persisted,/203\.0\.113\.8|Example Browser/);
  const hash=pool.state.queryArgs.find(args=>args[2]==='order_create')?.[0];
  assert.match(hash,/^[a-f0-9]{64}$/);
  assert.equal(pool.state.denials[0][0],hash);
});

test('429 responses expose a bounded machine-readable retry contract',()=>{
  const body=highRiskVelocityErrorBody(Object.assign(new Error('Too many recent attempts. Try again later.'),{
    status:429,code:'HIGH_RISK_VELOCITY_LIMIT',retryAfterSeconds:17
  }));
  assert.deepEqual(body,{
    error:'Too many recent attempts. Try again later.',
    code:'HIGH_RISK_VELOCITY_LIMIT',
    retry_after_seconds:17
  });
  assert.deepEqual(highRiskVelocityErrorBody(new Error('database detail')), {error:'Unexpected server error'});
});

test('high-risk routes use the shared limiter and return Retry-After',()=>{
  const expected={
    auth:['referral_event_account','referral_event_public','account_location_change','upload_public'],
    orders:['order_create','order_cancel'],
    marketplace:['order_create','order_cancel','store_location_change','upload_public'],
    services:['service_job_create','service_job_cancel','review_submit','upload_private','upload_public'],
    payments:['refund_request','payout_destination_change'],
    governance:['invitation_create','upload_private'],
    delivery:['store_location_change','courier_location_update','upload_private'],
    incidents:['incident_submit','incident_note','upload_private'],
    admin:['incident_submit','upload_private'],
    suppliers:['order_create','invitation_create'],
    paymongo:['refund_request']
  };
  for(const[name,actions]of Object.entries(expected)){
    for(const action of actions)assert.match(servers[name],new RegExp(`actionCode:'${action}'`),`${name} must enforce ${action}`);
    assert.match(servers[name],/HIGH_RISK_VELOCITY_LIMIT[\s\S]{0,180}Retry-After/,`${name} must return Retry-After`);
  }
  assert.match(servers.auth,/await ensureHighRiskVelocitySchema\(pool\)/);
  assert.match(servers.auth,/actorKey:String\(req\.ip\|\|'unknown'\)/);
  assert.doesNotMatch(servers.auth,/actorKey:[^\n]+user-agent/);
  assert.match(servers.sourcing,/actionCode:'invitation_create'/);
  assert.match(servers.sourcing,/actionCode:'order_create'/);
  assert.doesNotMatch(servers.auth,/growthAnalyticsAttempts|growthAnalyticsThrottled/);
  assert.doesNotMatch(servers.incidents,/assertIncidentSubmissionAllowed|INCIDENT_HOURLY_LIMIT|INCIDENT_DAILY_LIMIT/);
});

test('limit checks precede long mutation transactions on deadlock-sensitive routes',()=>{
  const incident=servers.incidents.slice(servers.incidents.indexOf("app.post('/api/incidents'"),servers.incidents.indexOf("app.get('/api/incidents/mine'"));
  assert.ok(incident.indexOf("actionCode:'incident_submit'")<incident.indexOf('pool.connect()'));

  const support=servers.admin.slice(servers.admin.indexOf("app.post('/api/support/tickets'"),servers.admin.indexOf("app.get('/api/support/tickets/mine'"));
  assert.ok(support.indexOf("actionCode:'upload_private'")<support.indexOf('pool.connect()'));

  const ordersCancel=servers.orders.slice(servers.orders.indexOf("app.post('/api/orders/merchant/:id/cancel'"),servers.orders.indexOf("app.get('/api/orders/merchant/customers/:customerId/trust'"));
  assert.ok(ordersCancel.indexOf("actionCode:'order_cancel'")<ordersCancel.indexOf('pool.connect()'));

  const marketplaceCancel=servers.marketplace.slice(servers.marketplace.indexOf('async function marketplaceCancel'),servers.marketplace.indexOf("app.get('/health'"));
  assert.ok(marketplaceCancel.indexOf("actionCode:'order_cancel'")<marketplaceCancel.indexOf('pool.connect()'));

  const supplierOrder=servers.suppliers.slice(servers.suppliers.indexOf("app.post('/api/procurement/orders'"),servers.suppliers.indexOf("app.get('/api/procurement/orders'"));
  assert.ok(supplierOrder.indexOf("actionCode:'order_create'")<supplierOrder.indexOf('pool.connect()'));

  const supplierRfq=servers.sourcing.slice(servers.sourcing.indexOf("app.post('/api/procurement/sourcing/rfqs'"),servers.sourcing.indexOf("app.get('/api/procurement/sourcing/rfqs'"));
  assert.ok(supplierRfq.indexOf("actionCode:'invitation_create'")<supplierRfq.indexOf('pool.connect()'));

  const quotePo=servers.sourcing.slice(servers.sourcing.indexOf("app.post('/api/procurement/sourcing/quotes/:quoteId/create-po'"));
  assert.ok(quotePo.indexOf("actionCode:'order_create'")<quotePo.indexOf('pool.connect()'));
});
