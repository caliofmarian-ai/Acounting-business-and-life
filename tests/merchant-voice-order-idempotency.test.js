import test from 'node:test';
import assert from 'node:assert/strict';
import {withVoiceOrderExactlyOnce,ensureVoiceOrderSubmissionSchema} from '../merchant-voice-order-idempotency.js';
const requestKey='voice_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const quoteHash='a'.repeat(64),args={businessId:7,accountId:44,requestKey,quoteHash};
function fakeDb(){
  const state=new Map(),events=[];let starts=0,releases=0,commits=0,rollbacks=0;
  const key=(bid,aid,req)=>`${bid}:${aid}:${req}`;
  return{state,events,get stats(){return{starts,releases,commits,rollbacks}},
    async connect(){starts++;let pending=null;return{
      async query(sql,params=[]){events.push({sql:String(sql).slice(0,45),params});
        if(sql==='BEGIN')return{rowCount:0};
        if(sql==='COMMIT'){if(pending)state.set(pending.key,pending.data);commits++;return{rowCount:0}}
        if(sql==='ROLLBACK'){pending=null;rollbacks++;return{rowCount:0}}
        if(sql.includes('INSERT INTO merchant_voice_order_submissions')){
          const k=key(params[0],params[1],params[2]);if(state.has(k))return{rowCount:0,rows:[]};
          pending={key:k,data:{quote_hash:params[3],order_id:null}};return{rowCount:1,rows:[{request_key:params[2]}]};
        }
        if(sql.includes('SELECT quote_hash,order_id')){
          const item=state.get(key(...params));return{rowCount:item?1:0,rows:item?[item]:[]};
        }
        if(sql.includes('UPDATE merchant_voice_order_submissions')){
          if(!pending)return{rowCount:0,rows:[]};pending.data.order_id=params[3];return{rowCount:1,rows:[{order_id:params[3]}]};
        }
        throw Error('Unexpected query');
      },release(){releases++}
    }}
  }
}
test('first confirmed voice order commits once and identical retry returns same order ID',async()=>{
  const db=fakeDb();let creations=0;
  const createWithClient=async()=>{creations++;return{id:1234}};
  const a=await withVoiceOrderExactlyOnce(db,{...args,createWithClient});
  const b=await withVoiceOrderExactlyOnce(db,{...args,createWithClient});
  assert.deepEqual(a,{order_id:1234,replayed:false});assert.deepEqual(b,{order_id:1234,replayed:true});
  assert.equal(creations,1);assert.equal(db.stats.commits,2);assert.equal(db.stats.releases,2);
});
test('same key with changed quote is rejected without invoking the canonical creator',async()=>{
  const db=fakeDb();await withVoiceOrderExactlyOnce(db,{...args,createWithClient:async()=>({id:100})});
  let creations=0;
  await assert.rejects(withVoiceOrderExactlyOnce(db,{...args,quoteHash:'b'.repeat(64),createWithClient:async()=>{creations++;return{id:200}}}),{status:409,code:'VOICE_CREATE_KEY_REUSED'});
  assert.equal(creations,0);assert.equal(db.stats.rollbacks,1);
});
test('no order ID means rollback and no durable submitted claim',async()=>{
  const db=fakeDb();await assert.rejects(withVoiceOrderExactlyOnce(db,{...args,createWithClient:async()=>({})}),{code:'VOICE_CREATE_RESULT_INVALID'});
  assert.equal(db.state.size,0);assert.equal(db.stats.rollbacks,1);
  const b=await withVoiceOrderExactlyOnce(db,{...args,createWithClient:async()=>({id:456})});assert.equal(b.order_id,456);
});
test('creation failure rolls back claim; idempotency record cannot outlive failed Order transaction',async()=>{
  const db=fakeDb();await assert.rejects(withVoiceOrderExactlyOnce(db,{...args,createWithClient:async()=>{throw Error('inventory shortage')}}),/inventory shortage/);
  assert.equal(db.state.size,0);assert.equal(db.stats.rollbacks,1);
});
test('reject malformed account, business, key or quote hash BEFORE DB transaction',async()=>{
  const db=fakeDb();for(const wrong of [{businessId:0},{accountId:0},{requestKey:'same'},{quoteHash:'not-a-hash'}])
    await assert.rejects(withVoiceOrderExactlyOnce(db,{...args,...wrong,createWithClient:async()=>({id:1})}),{status:400});
  assert.equal(db.stats.starts,0);
});
test('schema enforces unique per business/account/request and original order foreign key',async()=>{
  const queries=[];await ensureVoiceOrderSubmissionSchema({query:async q=>queries.push(q)});
  assert.match(queries[0],/PRIMARY KEY\(business_id,account_id,request_key\)/);
  assert.match(queries[0],/order_id BIGINT REFERENCES orders\(id\) ON DELETE RESTRICT/);
});