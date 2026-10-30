import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {installMerchantVoicePasskeyRoutes,verifyVoiceDevicePasskey} from '../merchant-voice-passkey-routes.js';
import {authoritativeVoiceOrderQuote,verifyVoiceOrderSignedQuote} from '../merchant-voice-order-quote.js';
import {safeSessionId} from '../merchant-voice-order-routes.js';
const rpId='caliof.com',origin='https://caliof.com',accountId=44,businessId=7;
const quoteSecret=Buffer.from('0123456789abcdef0123456789abcdef'),tokenSecret='test-session-secret';
const env={ORDER_VOICE_UI_ENABLED:'1',ORDER_VOICE_WEBAUTHN_ENABLED:'1',ORDER_VOICE_WEBAUTHN_RP_ID:rpId,ORDER_VOICE_WEBAUTHN_ORIGIN:origin};
const b64=bytes=>Buffer.from(bytes).toString('base64url');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest();
const h=bytes=>sha(bytes).toString('hex');
const ok=(rows=[])=>({rowCount:rows.length,rows});
function cbor(v){
 const head=(m,n)=>n<24?Buffer.from([m*32+n]):n<256?Buffer.from([m*32+24,n]):Buffer.from([m*32+25,n>>8,n&255]);
 if(Number.isInteger(v))return v>=0?head(0,v):head(1,-1-v);
 if(Buffer.isBuffer(v))return Buffer.concat([head(2,v.length),v]);
 if(typeof v==='string'){const b=Buffer.from(v);return Buffer.concat([head(3,b.length),b])}
 if(v instanceof Map)return Buffer.concat([head(5,v.size),...[...v].flatMap(([a,b])=>[cbor(a),cbor(b)])]);
 throw Error('Invalid test cbor');
}
function makePasskey(challenge,credentialId=crypto.randomBytes(32)){
 const {privateKey,publicKey}=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=publicKey.export({format:'jwk'});
 const counter=(flags,n)=>{const b=Buffer.concat([sha(Buffer.from(rpId)),Buffer.from([flags]),Buffer.alloc(4)]);b.writeUInt32BE(n,33);return b};
 const userData=(type,ch=challenge)=>b64(Buffer.from(JSON.stringify({type,origin,challenge:b64(ch)})));
 const key=cbor(new Map([[1,2],[3,-7],[-1,1],[-2,Buffer.from(jwk.x,'base64url')],[-3,Buffer.from(jwk.y,'base64url')]]));
 const length=Buffer.alloc(2);length.writeUInt16BE(credentialId.length);
 const attData=Buffer.concat([counter(0x45,0),Buffer.alloc(16),length,credentialId,key]);
 const attestation=cbor(new Map([['fmt','none'],['attStmt',new Map()],['authData',attData]]));
 const register={id:b64(credentialId),rawId:b64(credentialId),type:'public-key',response:{clientDataJSON:userData('webauthn.create'),attestationObject:b64(attestation)}};
 const assertion=(nextChallenge=challenge,count=1)=>{
   const authData=counter(0x05,count),json=userData('webauthn.get',nextChallenge);
   return{id:b64(credentialId),rawId:b64(credentialId),type:'public-key',response:{clientDataJSON:json,authenticatorData:b64(authData),signature:b64(crypto.sign('sha256',Buffer.concat([authData,sha(Buffer.from(json,'base64url'))]),privateKey))}};
 };
 return{register,assertion};
}
function fakeStore(){
 const st={challenges:new Map(),credentials:new Map(),queries:[],rollbacks:0,commits:0};
 const db={state:st,async connect(){return {release(){},async query(sql,args=[]){
   const norm=String(sql).replace(/\s+/g,' ').trim();st.queries.push({sql:norm,args});
   if(norm==='BEGIN')return ok();
   if(norm==='COMMIT'){st.commits++;return ok()}
   if(norm==='ROLLBACK'){st.rollbacks++;return ok()}
   if(norm.includes('FROM accounts WHERE id=$1 FOR UPDATE'))return ok([{id:accountId}]);
   if(norm.includes('SELECT COUNT(*)::int count FROM merchant_voice_passkey_challenges'))return ok([{count:0}]);
   if(norm.includes('INSERT INTO merchant_voice_passkey_challenges')){
     const [id,bid,aid,session_binding,kind,challenge_digest,quote_hash,request_key,phrase_digest]=args;
     st.challenges.set(id,{id,business_id:bid,account_id:aid,session_binding,kind,challenge_digest,quote_hash,request_key,phrase_digest,expires_at:new Date(Date.now()+90000)});return ok();}
   if(norm.includes('FROM merchant_voice_passkey_challenges')&&norm.includes('FOR UPDATE')){
     const [id,kind,aid,bid,session]=args,x=st.challenges.get(id);
     return ok(x&&x.kind===kind&&x.account_id===aid&&x.business_id===bid&&x.session_binding===session?[x]:[]);
   }
   if(norm.includes('FROM merchant_voice_passkey_credentials')&&norm.includes('ORDER BY created_at')){
     const [aid,rp]=args;return ok([...st.credentials.values()].filter(x=>x.account_id===aid&&x.rp_id===rp&&!x.revoked_at).map(x=>({credential_id:x.credential_id})));}
   if(norm.includes('FROM merchant_voice_passkey_credentials')&&norm.includes('WHERE account_id=$1')){
     const [aid,rp]=args;return ok([...st.credentials.values()].filter(x=>x.account_id===aid&&x.rp_id===rp));}
   if(norm.includes('FROM merchant_voice_passkey_credentials')&&norm.includes('WHERE credential_id=$1')){
     const [cred,aid,rp]=args,x=st.credentials.get(cred);return ok(x&&x.account_id===aid&&x.rp_id===rp&&!x.revoked_at?[x]:[]);}
   if(norm.includes('INSERT INTO merchant_voice_passkey_credentials')){
     const [credential_id,aid,rp,public_key_pem,user_handle,sign_count,backup_eligible]=args;
     if(st.credentials.has(credential_id))return ok();
     st.credentials.set(credential_id,{credential_id,account_id:aid,rp_id:rp,public_key_pem,user_handle,sign_count,backup_eligible});
     return ok([{credential_id}]);}
   if(norm.includes('UPDATE merchant_voice_passkey_credentials SET sign_count')){
     const [counter,id]=args;st.credentials.get(id).sign_count=counter;return ok();}
   if(norm.includes('UPDATE merchant_voice_passkey_challenges SET consumed_at=NOW()')){
     if(norm.includes('WHERE id=$1')){const x=st.challenges.get(args[0]);
       if(!x||x.consumed_at)return ok();x.consumed_at=new Date();return ok([{id:x.id}]);}
     for(const x of st.challenges.values())if(x.account_id===args[0]&&x.business_id===args[1]&&x.session_binding===args[2]&&x.kind==='approve'&&x.quote_hash===args[3]&&x.request_key===args[4])x.consumed_at=new Date();
     return ok();}
   throw Error('Unexpected SQL: '+norm.slice(0,160));
 }}}};return db;
}
function harness(){
 const paths={},db=fakeStore();const app={post:(path,...handlers)=>paths[path]=handlers.at(-1)};
 const rp=installMerchantVoicePasskeyRoutes(app,{db,quoteSecret,tokenSecret,env,
   requireMerchant:async()=>({me:{account:{id:accountId}},business:{id:businessId}}),
   verifyStepUp:async()=>({accountId,sessionId:'mock'})});
 const req={headers:{authorization:'Bearer fake-token'},body:{business_id:businessId}};
 const request=async(path,body={})=>{
   let status=200,payload;const res={set(){return this},status(x){status=x;return this},json(x){payload=x;return this}};
   await paths[path]({...req,body:{...req.body,...body}},res);return{status,payload};};
 const sid=safeSessionId(req,accountId,businessId,quoteSecret);
 const draft={status:'unposted_draft',business_id:businessId,session_id:sid,customer_name:'Ana',lines:[{source_kind:'marketplace_product',product_id:11,quantity:1,variant_id:null,modifier_option_ids:[]}]};
 const signedQuote=authoritativeVoiceOrderQuote({draft,snapshots:[{source_kind:'marketplace_product',source_id:11,
   name_snapshot:'Rice',quantity:1,catalog_variant_id:null,modifier_snapshot_json:{groups:[]},unit_price_snapshot:'35.00',line_total:'35.00'}],
   accountId,businessId,sessionId:sid,secret:quoteSecret});
 return{db,request,sid,req,rp,signedQuote};
}
const path=p=>'/api/orders/voice/passkey/'+p;

test('passkey registration is challenge-bound and one-time for exact Merchant session',async()=>{
 const h=harness();assert.equal(h.rp.ready(),true);
 const opt=await h.request(path('enroll/options'));assert.equal(opt.status,200);
 const credential=makePasskey(Buffer.from(opt.payload.publicKey.challenge,'base64url'));
 const registered=await h.request(path('enroll/verify'),{challenge_id:opt.payload.challenge_id,credential:credential.register});
 assert.equal(registered.status,200);assert.equal(registered.payload.enrolled,true);
 assert.equal(h.db.state.credentials.size,1);
 const replay=await h.request(path('enroll/verify'),{challenge_id:opt.payload.challenge_id,credential:credential.register});
 assert.equal(replay.status,409);assert.equal(replay.payload.code,'VOICE_PASSKEY_EXPIRED');
});

test('passkey approval requires manually typed phrase and the authentic signature for quote and request key',async()=>{
 const h=harness(),register=await h.request(path('enroll/options'));
 const key=makePasskey(Buffer.from(register.payload.publicKey.challenge,'base64url'));
 assert.equal((await h.request(path('enroll/verify'),{challenge_id:register.payload.challenge_id,credential:key.register})).status,200);
 const requestKey='voice_1234567890abcdefghijklmno12345';
 const options=await h.request(path('approval/options'),{signed_quote:h.signedQuote,request_key:requestKey});
 assert.equal(options.status,200);assert.equal(options.payload.publicKey.allowCredentials.length,1);
 const approval=key.assertion(Buffer.from(options.payload.publicKey.challenge,'base64url'));
 const quoteHash=verifyVoiceOrderSignedQuote({signedQuote:h.signedQuote,accountId,businessId,sessionId:h.sid,secret:quoteSecret}).quoteHash;
 const body={challenge_id:options.payload.challenge_id,credential:approval,confirmation_phrase:options.payload.confirmation_phrase};
 const wrong=await assert.rejects(h.rp.verifyDeviceApproval(await h.db.connect(),{
   req:{body:{device_approval:{...body,confirmation_phrase:'wrong'}}},accountId,businessId,sessionId:h.sid,
   quoteHash,requestKey}),e=>e.code==='VOICE_PASSKEY_PHRASE_INVALID');
 const valid=await h.rp.verifyDeviceApproval(await h.db.connect(),{
   req:{body:{device_approval:body}},accountId,businessId,sessionId:h.sid,quoteHash,requestKey});
 assert.equal(valid,true);assert.equal(h.db.state.credentials.get(approval.id).sign_count,1);
 await assert.rejects(h.rp.verifyDeviceApproval(await h.db.connect(),{
   req:{body:{device_approval:body}},accountId,businessId,sessionId:h.sid,quoteHash,requestKey}),e=>e.code==='VOICE_PASSKEY_EXPIRED');
});

test('approval fails closed for a different Merchant, operator or quote hash',async()=>{
 const h=harness(),reg=await h.request(path('enroll/options'));
 const key=makePasskey(Buffer.from(reg.payload.publicKey.challenge,'base64url'));
 await h.request(path('enroll/verify'),{challenge_id:reg.payload.challenge_id,credential:key.register});
 const requestKey='voice_1234567890abcdefghijklmno12345';
 const options=await h.request(path('approval/options'),{signed_quote:h.signedQuote,request_key:requestKey});
 const proof={challenge_id:options.payload.challenge_id,confirmation_phrase:options.payload.confirmation_phrase,
   credential:key.assertion(Buffer.from(options.payload.publicKey.challenge,'base64url'))};
 const goodHash=verifyVoiceOrderSignedQuote({signedQuote:h.signedQuote,accountId,businessId,sessionId:h.sid,secret:quoteSecret}).quoteHash;
 for(const change of [{businessId:9},{accountId:30},{sessionId:'other'},{quoteHash:'a'.repeat(64)},{requestKey:'wrong-value'}]){
   await assert.rejects(h.rp.verifyDeviceApproval(await h.db.connect(),{
      req:{body:{device_approval:proof}},accountId,businessId,sessionId:h.sid,quoteHash:goodHash,requestKey,...change}),
      e=>e.code==='VOICE_PASSKEY_INVALID'||e.code==='VOICE_CONTEXT_STALE');
 }
});

test('missing passkey configuration denies registration even for a valid merchant',async()=>{
 const h=harness();const app={post:(path,...args)=>{app[path]=args.at(-1)}};
 const other=installMerchantVoicePasskeyRoutes(app,{db:h.db,quoteSecret,tokenSecret,env:{...env,ORDER_VOICE_WEBAUTHN_ENABLED:'0'},
   requireMerchant:async()=>({me:{account:{id:accountId}},business:{id:businessId}})});
 assert.equal(other.ready(),false);
 let status=0;await app[path('enroll/options')]({body:{business_id:businessId}},
   {set(){},status(n){status=n;return this},json(){}});assert.equal(status,503);
});