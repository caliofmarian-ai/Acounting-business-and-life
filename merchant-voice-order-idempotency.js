/**
 * Issue #863: transaction-level exactly-once order creation guard.
 * This is an isolated, unmounted primitive. DO NOT enable until the canonical
 * createOrder function accepts the SAME checked-out PostgreSQL transaction,
 * a verified quote/reauthenticated operator and a fully reviewed UI action.
 */
const error=(status,code,message)=>Object.assign(new Error(message),{status,code});
const id=v=>Number.isSafeInteger(Number(v))&&Number(v)>0;
const keyPattern=/^[A-Za-z0-9_-]{24,100}$/;
export async function ensureVoiceOrderSubmissionSchema(db){
  await db.query(`CREATE TABLE IF NOT EXISTS merchant_voice_order_submissions (
    business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    request_key TEXT NOT NULL CHECK (length(request_key) BETWEEN 24 AND 100),
    quote_hash CHAR(64) NOT NULL CHECK (quote_hash ~ '^[a-f0-9]{64}$'),
    order_id BIGINT REFERENCES orders(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    PRIMARY KEY(business_id,account_id,request_key)
  )`);
}
export async function withVoiceOrderExactlyOnce(db,{
  businessId,accountId,requestKey,quoteHash,createWithClient
}={}){
  const bid=Number(businessId),aid=Number(accountId);
  if(!id(bid)||!id(aid)||!keyPattern.test(String(requestKey||''))||!(/^[a-f0-9]{64}$/.test(String(quoteHash||'')))||typeof createWithClient!=='function')
    throw error(400,'VOICE_CREATE_BAD_REQUEST','Voice order confirmation parameters are invalid.');
  const client=await db.connect();
  try{
    await client.query('BEGIN');
    // INSERT and SELECT FOR UPDATE serialize even concurrent retries. A failing
    // callback rolls back BOTH the claim and any canonical stock/order changes.
    const claimed=await client.query(`INSERT INTO merchant_voice_order_submissions
      (business_id,account_id,request_key,quote_hash)
      VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING request_key`,
    [bid,aid,requestKey,quoteHash]);
    if(claimed.rowCount===0){
      const old=await client.query(`SELECT quote_hash,order_id FROM merchant_voice_order_submissions
        WHERE business_id=$1 AND account_id=$2 AND request_key=$3 FOR UPDATE`,[bid,aid,requestKey]);
      if(old.rowCount!==1)throw error(409,'VOICE_CREATE_PENDING','The previous order confirmation is still being resolved.');
      if(old.rows[0].quote_hash!==quoteHash)
        throw error(409,'VOICE_CREATE_KEY_REUSED','That confirmation key belongs to a different order.');
      if(!id(old.rows[0].order_id))throw error(409,'VOICE_CREATE_PENDING','The previous order confirmation is still being resolved.');
      const orderId=Number(old.rows[0].order_id);
      await client.query('COMMIT');return{order_id:orderId,replayed:true};
    }
    // Callback must operate wholly inside this transaction; do not call an
    // independently committed createOrder(pool) from here.
    const created=await createWithClient(client);
    const orderId=Number(created?.id??created?.order_id);
    if(!id(orderId))throw error(500,'VOICE_CREATE_RESULT_INVALID','The canonical Orders engine did not return an order ID.');
    const saved=await client.query(`UPDATE merchant_voice_order_submissions
      SET order_id=$4,completed_at=NOW()
      WHERE business_id=$1 AND account_id=$2 AND request_key=$3
      RETURNING order_id`,[bid,aid,requestKey,orderId]);
    if(saved.rowCount!==1)throw error(500,'VOICE_CREATE_RECORD_FAILED','Order confirmation could not be recorded.');
    await client.query('COMMIT');return{order_id:orderId,replayed:false};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
  finally{client.release()}
}