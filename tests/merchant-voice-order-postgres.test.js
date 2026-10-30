import test, {after, before} from 'node:test';
import assert from 'node:assert/strict';
import {withVoiceOrderExactlyOnce,ensureVoiceOrderSubmissionSchema} from '../merchant-voice-order-idempotency.js';
import {requireVoiceOperatorStepUp} from '../merchant-voice-order-confirm.js';
import {signV2SessionToken} from '../auth-session-core.js';
import {ensureMerchantVoicePasskeySchema,verifyVoiceDevicePasskey} from '../merchant-voice-passkey-routes.js';
import crypto from 'node:crypto';

const isolated=process.env.VOICE_ORDER_TEST_ISOLATED==='1'&&
  process.env.VOICE_ORDER_TEST_DB_URL?.endsWith('/abl_voice_ci');
let pool=null;
const key='voice_pg_serialization_aaaaaaaaaaaaaaaaa',quoteHash='f'.repeat(64);
const claim={businessId:7,accountId:44,requestKey:key,quoteHash};

before(async()=>{
  if(!isolated)return;
  const {default:pg}=await import('pg');
  pool=new pg.Pool({connectionString:process.env.VOICE_ORDER_TEST_DB_URL,max:6,connectionTimeoutMillis:6000,statement_timeout:12000});
  await pool.query(`CREATE TABLE accounts(id BIGINT PRIMARY KEY);
    CREATE TABLE businesses(id BIGINT PRIMARY KEY);
    CREATE TABLE orders(id BIGSERIAL PRIMARY KEY,business_id BIGINT NOT NULL REFERENCES businesses(id));
    CREATE TABLE stock_reservations(order_id BIGINT NOT NULL REFERENCES orders(id),stock_id BIGINT NOT NULL,units INTEGER NOT NULL);
    CREATE TABLE account_sessions(session_id TEXT PRIMARY KEY,account_id BIGINT NOT NULL,
      revoked_at TIMESTAMPTZ,expires_at TIMESTAMPTZ NOT NULL,step_up_verified_at TIMESTAMPTZ);
    INSERT INTO accounts VALUES(44);
    INSERT INTO businesses VALUES(7),(8);`);
  await ensureVoiceOrderSubmissionSchema(pool);
  await ensureMerchantVoicePasskeySchema(pool);
});
after(async()=>{if(pool)await pool.end()});
const create=async(client,bid=7)=>{
  const order=await client.query('INSERT INTO orders(business_id) VALUES($1) RETURNING id',[bid]);
  await client.query('INSERT INTO stock_reservations(order_id,stock_id,units) VALUES($1,5,2)',[order.rows[0].id]);
  return{id:order.rows[0].id};
};

test('real PostgreSQL parallel duplicate confirmations serialize to one order and stock reservation',{skip:!isolated},async()=>{
  const [a,b]=await Promise.all([
    withVoiceOrderExactlyOnce(pool,{...claim,createWithClient:client=>create(client)}),
    withVoiceOrderExactlyOnce(pool,{...claim,createWithClient:client=>create(client)})
  ]);
  assert.equal(a.order_id,b.order_id);
  assert.deepEqual([a.replayed,b.replayed].sort(),[false,true]);
  const o=await pool.query('SELECT COUNT(*)::int n FROM orders');
  const s=await pool.query('SELECT COUNT(*)::int n FROM stock_reservations');
  assert.equal(o.rows[0].n,1);assert.equal(s.rows[0].n,1);
  await assert.rejects(withVoiceOrderExactlyOnce(pool,{...claim,quoteHash:'e'.repeat(64),
    createWithClient:client=>create(client)}),{status:409,code:'VOICE_CREATE_KEY_REUSED'});
});

test('real PostgreSQL exception rolls back both Order and idempotency claim',{skip:!isolated},async()=>{
  const args={...claim,requestKey:'voice_pg_rollback_aaaaaaaaaaaaaaaaaaa'};
  await assert.rejects(withVoiceOrderExactlyOnce(pool,{...args,createWithClient:async client=>{
    await create(client);throw Error('stock reservation validation failed');
  }}),/stock reservation validation failed/);
  const saved=await pool.query('SELECT order_id FROM merchant_voice_order_submissions WHERE request_key=$1',[args.requestKey]);
  assert.equal(saved.rowCount,0);
  const orders=await pool.query('SELECT COUNT(*)::int n FROM orders');assert.equal(orders.rows[0].n,1);
});

test('business boundary and request key are independent, without cross-business replay',{skip:!isolated},async()=>{
  const other=await withVoiceOrderExactlyOnce(pool,{...claim,businessId:8,createWithClient:client=>create(client,8)});
  const existing=await withVoiceOrderExactlyOnce(pool,{...claim,createWithClient:client=>create(client)});
  assert.notEqual(other.order_id,existing.order_id);
  assert.equal(existing.replayed,true);
});

test('operator session step-up FOR SHARE blocks concurrent revocation until approval commits',{skip:!isolated},async()=>{
  const secret='ci-voice-only-auth-secret',sessionId='voice-pg-ci-session',issued=Date.now();
  const token=signV2SessionToken(secret,44,sessionId,{issued});
  await pool.query(`INSERT INTO account_sessions(session_id,account_id,expires_at,step_up_verified_at)
    VALUES($1,44,NOW()+INTERVAL '1 hour',NOW())`,[sessionId]);
  const holder=await pool.connect();const revoker=await pool.connect();
  try{
    await holder.query('BEGIN');
    await requireVoiceOperatorStepUp(holder,{token,tokenSecret:secret,accountId:44,now:new Date()});
    await revoker.query('BEGIN');
    await revoker.query(`SET LOCAL lock_timeout='250ms'`);
    await assert.rejects(revoker.query('UPDATE account_sessions SET revoked_at=NOW() WHERE session_id=$1',[sessionId]),
      error=>error.code==='55P03');
    await revoker.query('ROLLBACK');
    await holder.query('COMMIT');
    const update=await pool.query('UPDATE account_sessions SET revoked_at=NOW() WHERE session_id=$1 RETURNING revoked_at',[sessionId]);
    assert.equal(update.rowCount,1);
  }finally{await revoker.query('ROLLBACK').catch(()=>{});await holder.query('ROLLBACK').catch(()=>{});
    revoker.release();holder.release()}
});

const webauthnRp='caliof.com',webauthnOrigin='https://caliof.com';
const hash=buffer=>crypto.createHash('sha256').update(buffer).digest();
const b64=buffer=>Buffer.from(buffer).toString('base64url');
const webauthnConfig={ready:true,rpId:webauthnRp,origin:webauthnOrigin};
async function passkeyApprovalFixture({quoteHash='d'.repeat(64),requestKey='voice_pg_passkey_aaaaaaaaaaaaaa',businessId=7}={}){
  const id=crypto.randomUUID(),phrase='mango river 271',challenge=crypto.randomBytes(32);
  const credentialId=b64(crypto.randomBytes(32)),{publicKey,privateKey}=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const sessionBinding=b64(crypto.randomBytes(36)).slice(0,48);
  await pool.query(`INSERT INTO merchant_voice_passkey_credentials
    (credential_id,account_id,rp_id,public_key_pem,user_handle,sign_count,backup_eligible)
    VALUES($1,44,$2,$3,$4,0,FALSE)`,[credentialId,webauthnRp,publicKey.export({format:'pem',type:'spki'}),b64(crypto.randomBytes(32))]);
  await pool.query(`INSERT INTO merchant_voice_passkey_challenges
    (id,business_id,account_id,session_binding,kind,challenge_digest,quote_hash,request_key,phrase_digest,expires_at)
    VALUES($1,$2,44,$3,'approve',$4,$5,$6,$7,NOW()+INTERVAL '90 seconds')`,
    [id,businessId,sessionBinding,hash(challenge).toString('hex'),quoteHash,requestKey,
    hash(Buffer.from(id+':'+phrase)).toString('hex')]);
  const authenticatorData=Buffer.concat([hash(Buffer.from(webauthnRp)),Buffer.from([0x05]),Buffer.alloc(4)]);
  authenticatorData.writeUInt32BE(1,33);
  const clientData=b64(Buffer.from(JSON.stringify({type:'webauthn.get',origin:webauthnOrigin,challenge:b64(challenge)})));
  const signature=crypto.sign('sha256',Buffer.concat([authenticatorData,hash(Buffer.from(clientData,'base64url'))]),privateKey);
  const req={body:{device_approval:{challenge_id:id,confirmation_phrase:phrase,credential:{
    id:credentialId,rawId:credentialId,type:'public-key',response:{
      clientDataJSON:clientData,authenticatorData:b64(authenticatorData),signature:b64(signature),userHandle:null
    }
  }}}};
  return {id,quoteHash,requestKey,businessId,sessionId:sessionBinding,credentialId,req};
}

test('real PostgreSQL WebAuthn one-time approval and exactly-once stock in SAME transaction',{skip:!isolated},async()=>{
  const a=await passkeyApprovalFixture();
  const claim={businessId:a.businessId,accountId:44,requestKey:a.requestKey,quoteHash:a.quoteHash};
  const approve=client=>verifyVoiceDevicePasskey(client,{req:a.req,accountId:44,businessId:7,
    sessionId:a.sessionId,quoteHash:a.quoteHash,requestKey:a.requestKey,config:webauthnConfig});
  const before=await pool.query('SELECT COUNT(*)::int n FROM orders'),prior=before.rows[0].n;
  const [first,retry]=await Promise.all([
    withVoiceOrderExactlyOnce(pool,{...claim,createWithClient:async client=>{await approve(client);return create(client)}}),
    withVoiceOrderExactlyOnce(pool,{...claim,createWithClient:async client=>{await approve(client);return create(client)}})
  ]);
  assert.equal(first.order_id,retry.order_id);assert.deepEqual([first.replayed,retry.replayed].sort(),[false,true]);
  const after=await pool.query('SELECT COUNT(*)::int n FROM orders');assert.equal(after.rows[0].n,prior+1);
  const state=await pool.query('SELECT sign_count FROM merchant_voice_passkey_credentials WHERE credential_id=$1',[a.credentialId]);
  assert.equal(Number(state.rows[0].sign_count),1);
  const spent=await pool.query('SELECT consumed_at FROM merchant_voice_passkey_challenges WHERE id=$1',[a.id]);
  assert.ok(spent.rows[0].consumed_at);
});

test('real PostgreSQL failed canonical create restores passkey use/phrase and idempotency claim',{skip:!isolated},async()=>{
  const a=await passkeyApprovalFixture({quoteHash:'c'.repeat(64),requestKey:'voice_pg_passkey_rollback_aaaaaaaa'});
  const claim={businessId:7,accountId:44,requestKey:a.requestKey,quoteHash:a.quoteHash};
  await assert.rejects(withVoiceOrderExactlyOnce(pool,{...claim,createWithClient:async client=>{
    await verifyVoiceDevicePasskey(client,{req:a.req,accountId:44,businessId:7,sessionId:a.sessionId,
      quoteHash:a.quoteHash,requestKey:a.requestKey,config:webauthnConfig});
    await create(client);throw Error('Test stock constraint failed after passkey use');
  }}),/Test stock constraint failed/);
  const challenge=await pool.query('SELECT consumed_at FROM merchant_voice_passkey_challenges WHERE id=$1',[a.id]);
  const counter=await pool.query('SELECT sign_count FROM merchant_voice_passkey_credentials WHERE credential_id=$1',[a.credentialId]);
  const approval=await pool.query('SELECT order_id FROM merchant_voice_order_submissions WHERE request_key=$1',[a.requestKey]);
  assert.equal(challenge.rows[0].consumed_at,null);assert.equal(Number(counter.rows[0].sign_count),0);
  assert.equal(approval.rowCount,0);
  const good=await withVoiceOrderExactlyOnce(pool,{...claim,createWithClient:async client=>{
    await verifyVoiceDevicePasskey(client,{req:a.req,accountId:44,businessId:7,sessionId:a.sessionId,
      quoteHash:a.quoteHash,requestKey:a.requestKey,config:webauthnConfig});
    return create(client);
  }});
  assert.equal(good.replayed,false);
});