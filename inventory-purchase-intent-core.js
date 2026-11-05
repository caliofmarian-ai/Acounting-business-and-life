// #881 — transaction-scoped Inventory receiving intent primitive.
// PRE-INTEGRATION ONLY: importing this module does not activate a route or schema.
// The caller MUST authenticate/authorize and bind the originating business before
// BEGIN, use one pg Client for the whole purchase+expense+lot transaction, and
// create the schema at a controlled migration/startup boundary, never per GET.
import {createHash} from 'node:crypto';

export const INVENTORY_PURCHASE_INTENT_SCHEMA = `
CREATE TABLE IF NOT EXISTS inventory_purchase_intents (
  business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  intent_key TEXT NOT NULL CHECK (length(intent_key) BETWEEN 12 AND 128),
  payload_sha256 CHAR(64) NOT NULL,
  purchase_id BIGINT REFERENCES inventory_purchases(id) ON DELETE RESTRICT,
  response_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  committed_at TIMESTAMPTZ,
  PRIMARY KEY (business_id, account_id, intent_key),
  CONSTRAINT inventory_purchase_intents_complete_check CHECK (
    (purchase_id IS NULL AND response_json IS NULL AND committed_at IS NULL)
    OR (purchase_id IS NOT NULL AND response_json IS NOT NULL AND committed_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_purchase_intents_purchase_unique
  ON inventory_purchase_intents(business_id, purchase_id) WHERE purchase_id IS NOT NULL;
-- A reservation MUST NOT survive COMMIT unless its stock/purchase/lot/expense
-- transaction also produced the final response. The ordinary row CHECK
-- permits the temporary NULL state inside BEGIN; the deferrable trigger
-- rejects that state at COMMIT, preventing permanently poisoned replay keys.
CREATE OR REPLACE FUNCTION inventory_purchase_intents_assert_complete()
RETURNS trigger LANGUAGE plpgsql AS $intent_complete$
BEGIN
  IF EXISTS (
    SELECT 1 FROM inventory_purchase_intents AS current_intent
     WHERE current_intent.business_id=NEW.business_id
       AND current_intent.account_id=NEW.account_id
       AND current_intent.intent_key=NEW.intent_key
       AND (current_intent.purchase_id IS NULL
         OR current_intent.response_json IS NULL
         OR current_intent.committed_at IS NULL)
  ) THEN
    RAISE EXCEPTION 'Inventory purchase intent cannot commit incomplete'
      USING ERRCODE='23514', CONSTRAINT='inventory_purchase_intents_complete_commit';
  END IF;
  RETURN NULL;
END;
$intent_complete$;
DO $install_intent_complete$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid='inventory_purchase_intents'::regclass
       AND tgname='inventory_purchase_intents_complete_commit'
  ) THEN
    CREATE CONSTRAINT TRIGGER inventory_purchase_intents_complete_commit
      AFTER INSERT OR UPDATE ON inventory_purchase_intents
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION inventory_purchase_intents_assert_complete();
  END IF;
END;
$install_intent_complete$;
`;

const bad=(message,code='INVENTORY_PURCHASE_INTENT_INVALID',status=400)=>
  Object.assign(new Error(message),{code,status});
const MAX_BIGINT=9223372036854775807n;
function dbId(value,label){
  // Reject arrays, wrappers, booleans and objects as Merchant/account/purchase
  // identities rather than coercing them through String() (e.g. [1] => "1").
  // Genuine bigint IDs are supported within PostgreSQL signed BIGINT bounds.
  if(typeof value!=='string'&&typeof value!=='number'&&typeof value!=='bigint'){
    throw bad(`${label} must be a literal database identifier`);
  }
  if(typeof value==='number'&&!Number.isSafeInteger(value))throw bad(`${label} must be a safe database identifier`);
  const s=String(value);
  if(!/^[1-9][0-9]{0,18}$/.test(s)||BigInt(s)>MAX_BIGINT)throw bad(`${label} must be a positive database identifier`);
  return s;
}
function literalKey(value){
  if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{11,127}$/.test(value)){
    throw bad('A stable, literal 12–128 character purchase intent key is required');
  }
  return value; // never trim/case-fold: two distinct intent keys must not collide
}
// A replay must never return a different purchase than the row committed
// under this intent. Keep both persistence and replay fail-closed if a caller
// supplies a mismatched snapshot (or a stored row is later corrupted).
function verifiedPurchaseResponse(response,purchaseId){
  if(!response||typeof response!=='object'||Array.isArray(response)||
     !response.purchase||typeof response.purchase!=='object'||Array.isArray(response.purchase)){
    throw bad('Purchase response must contain its linked purchase','INVENTORY_PURCHASE_INTENT_CONFLICT',409);
  }
  let claimedId;
  try{claimedId=dbId(response.purchase.id,'Response purchase')}
  catch{throw bad('Purchase response contains an invalid purchase ID','INVENTORY_PURCHASE_INTENT_CONFLICT',409)}
  if(claimedId!==dbId(purchaseId,'Purchase')){
    throw bad('Purchase response does not match the committed purchase ID','INVENTORY_PURCHASE_INTENT_CONFLICT',409);
  }
  return response;
}

// PostgreSQL JSONB cannot represent NaN/Infinity/undefined and JSON.stringify
// silently turns them into null or omits them. The saved/replayed response is
// accounting evidence: fail rather than persist a different economic snapshot.
// Genuine Date timestamps remain supported and are serialized as ISO strings.
function requireLosslessPurchaseSnapshot(value,depth=0,ancestors=new WeakSet()){
  const invalid=()=>bad('Purchase response contains lossy or non-JSON evidence',
    'INVENTORY_PURCHASE_INTENT_CONFLICT',409);
  if(depth>32)throw invalid();
  if(value===null||typeof value==='string'||typeof value==='boolean')return;
  if(typeof value==='number'){
    if(!Number.isFinite(value))throw invalid();
    return;
  }
  if(typeof value!=='object')throw invalid();
  if(value instanceof Date){
    // Date.toJSON ignores own properties and may invoke a custom serializer:
    // neither may silently change durable purchase evidence.
    if(!Number.isFinite(value.getTime())||
       Object.getPrototypeOf(value)!==Date.prototype||
       Object.getOwnPropertyNames(value).length||
       Object.getOwnPropertySymbols(value).length)throw invalid();
    return;
  }
  if(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype&&
     Object.getPrototypeOf(value)!==null)throw invalid();
  if(ancestors.has(value)||Object.getOwnPropertySymbols(value).length||Object.hasOwn(value,'toJSON'))throw invalid();
  ancestors.add(value);
  if(Array.isArray(value)){
    if(Object.keys(value).length!==value.length||
       Object.getOwnPropertyNames(value).length!==value.length+1)throw invalid();
    for(let i=0;i<value.length;i++){
      const item=Object.getOwnPropertyDescriptor(value,String(i));
      if(!item||!Object.hasOwn(item,'value'))throw invalid();
      requireLosslessPurchaseSnapshot(item.value,depth+1,ancestors);
    }
  }else{
    for(const key of Object.getOwnPropertyNames(value)){
      const item=Object.getOwnPropertyDescriptor(value,key);
      if(!item?.enumerable||!Object.hasOwn(item,'value'))throw invalid();
      requireLosslessPurchaseSnapshot(item.value,depth+1,ancestors);
    }
  }
  ancestors.delete(value);
}

// Hash the canonical JSON stream directly: the existing 32 KiB maximum must
// apply DURING serialization, not after allocating an unbounded canonical string.
// The emitted order and bytes are the same as the original stable() algorithm.
function stableToHash(value,hash,budget,depth=0){
  if(depth>16)throw bad('Purchase payload is nested too deeply');
  const write=chunk=>{
    const size=Buffer.byteLength(chunk,'utf8');
    if(size>32768-budget.bytes)throw bad('Purchase payload exceeds intent fingerprint limit');
    budget.bytes+=size;
    hash.update(chunk);
  };
  if(value===null){write('null');return}
  if(typeof value==='string'){
    // Do not stringify a huge, attacker-controlled string just to reject it.
    if(Buffer.byteLength(value,'utf8')>32768-budget.bytes)throw bad('Purchase payload exceeds intent fingerprint limit');
    write(JSON.stringify(value));return;
  }
  if(typeof value==='boolean'){write(JSON.stringify(value));return}
  if(typeof value==='number'){
    if(!Number.isFinite(value))throw bad('Purchase payload contains an invalid number');
    write(JSON.stringify(value));return;
  }
  if(Array.isArray(value)){
    // Sparse or decorated JS arrays are not JSON request arrays and could
    // otherwise omit an item or silently ignore a non-indexed instruction.
    if(Object.keys(value).length!==value.length||
       Object.getOwnPropertyNames(value).length!==value.length+1||
       Object.getOwnPropertySymbols(value).length){
      throw bad('Purchase payload arrays must contain JSON-only values');
    }
    write('[');
    for(let i=0;i<value.length;i++){
      const entry=Object.getOwnPropertyDescriptor(value,String(i));
      if(!entry||!Object.hasOwn(entry,'value'))throw bad('Purchase payload arrays must contain JSON-only values');
      if(i)write(',');
      stableToHash(entry.value,hash,budget,depth+1);
    }
    write(']');return;
  }
  if(typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype||
     Object.getOwnPropertySymbols(value).length){
    throw bad('Purchase payload must contain JSON-only values');
  }
  const keys=Object.keys(value).sort();
  // Non-enumerable instructions vanish from JSON but must never vanish
  // from an idempotency fingerprint while the caller still holds them.
  if(Object.getOwnPropertyNames(value).length!==keys.length){
    throw bad('Purchase payload must contain JSON-only data fields');
  }
  write('{');
  for(let i=0;i<keys.length;i++){
    const key=keys[i],entry=Object.getOwnPropertyDescriptor(value,key);
    if(!entry||!Object.hasOwn(entry,'value'))throw bad('Purchase payload must contain data-only values');
    if(i)write(',');
    write(JSON.stringify(key));
    write(':');
    stableToHash(entry.value,hash,budget,depth+1);
  }
  write('}');
}
export function inventoryPurchaseFingerprint(payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw bad('Purchase payload must be a JSON object');
  const hash=createHash('sha256').update('ABL-INVENTORY-PURCHASE-V1\n');
  stableToHash(payload,hash,{bytes:0});
  return hash.digest('hex');
}

// Call strictly AFTER BEGIN, on a single pg Client; the unique-key insert is
// PostgreSQL's real concurrency barrier. A simultaneous same-key INSERT waits
// for the first transaction to commit/rollback, not a separate SELECT race.
export async function claimInventoryPurchaseIntent(client,{businessId,accountId,intentKey,payload}){
  const business=dbId(businessId,'Business');
  const actor=dbId(accountId,'Account');
  const key=literalKey(intentKey);
  const fingerprint=inventoryPurchaseFingerprint(payload);
  const args=[business,actor,key,fingerprint];
  const inserted=await client.query(`
    INSERT INTO inventory_purchase_intents(business_id,account_id,intent_key,payload_sha256)
    VALUES($1,$2,$3,$4)
    ON CONFLICT (business_id,account_id,intent_key) DO NOTHING
    RETURNING intent_key
  `,args);
  if(inserted.rowCount===1)return{kind:'new',fingerprint};
  // The purchase's current business provenance must also be locked; a
  // previously committed response cannot be exposed after ownership changes.
  const prior=await client.query(`
    SELECT payload_sha256,purchase_id,response_json FROM inventory_purchase_intents
    WHERE business_id=$1 AND account_id=$2 AND intent_key=$3
      AND EXISTS (
        SELECT 1 FROM inventory_purchases AS source_purchase
        WHERE source_purchase.id=inventory_purchase_intents.purchase_id
          AND source_purchase.business_id=inventory_purchase_intents.business_id
        FOR SHARE
      )
    FOR UPDATE
  `,args.slice(0,3));
  if(prior.rowCount!==1)throw bad('Purchase intent changed during replay','INVENTORY_PURCHASE_INTENT_RETRY',409);
  const row=prior.rows[0];
  if(row.payload_sha256!==fingerprint)throw bad('Purchase intent key was reused with different details','INVENTORY_PURCHASE_INTENT_CONFLICT',409);
  if(row.purchase_id==null||row.response_json==null)throw bad('Purchase intent has no committed result','INVENTORY_PURCHASE_INTENT_INCOMPLETE',409);
  return{kind:'replay',purchaseId:row.purchase_id,response:verifiedPurchaseResponse(row.response_json,row.purchase_id)};
}

// Serialize EVERY new Inventory purchase for a business before the existing-item
// SELECT and first-time INSERT. Same-business/different-intent purchases must
// both post; locking them just prevents the missing-row/unique-index race.
// Hash collisions can only cause extra contention, never incorrect attribution.
export async function lockInventoryPurchaseBusiness(client,businessId){
  const business=dbId(businessId,'Business');
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('abl:inventory:purchase:business:v1'),hashtext($1::text))`,[business]);
}

// Must happen in the SAME transaction as inventory row, purchase, lot, ledger
// expense and reconciliation writes. A rollback erases the reservation too.
// The response is persisted privately so a replay gets the exact original
// committed response, not a later stock balance or a second expense.
export async function finishInventoryPurchaseIntent(client,{businessId,accountId,intentKey,purchaseId,response}){
  const args=[dbId(businessId,'Business'),dbId(accountId,'Account'),literalKey(intentKey),dbId(purchaseId,'Purchase')];
  if(!response||typeof response!=='object'||Array.isArray(response))throw bad('A committed purchase response object is required');
  verifiedPurchaseResponse(response,args[3]);
  requireLosslessPurchaseSnapshot(response);
  // The original response object is NOT necessarily the JSON response that
  // PostgreSQL will persist (e.g. a nested toJSON method or Date). Validate
  // the actual bytes before committing so neither first response nor replay
  // can claim a different purchase ID from the durable purchase_id.
  let json;
  try{json=JSON.stringify(response)}
  catch{throw bad('Purchase response must be JSON serializable','INVENTORY_PURCHASE_INTENT_CONFLICT',409)}
  if(!json||Buffer.byteLength(json,'utf8')>65536)throw bad('Purchase response snapshot exceeds intent limit');
  const snapshot=JSON.parse(json);
  verifiedPurchaseResponse(snapshot,args[3]);
  // Do not associate a scoped Merchant intent with another business's purchase.
  // The database relationship is checked inside this SAME open transaction.
  // UPDATE ... FROM alone does not lock the source purchase. A correlated
  // FOR SHARE hold keeps its business identity stable through this COMMIT.
  const saved=await client.query(`
    UPDATE inventory_purchase_intents AS intent
       SET purchase_id=$4,response_json=$5::jsonb,committed_at=NOW()
      FROM inventory_purchases AS purchase
     WHERE intent.business_id=$1 AND intent.account_id=$2
       AND intent.intent_key=$3 AND intent.purchase_id IS NULL
       AND purchase.id=$4 AND purchase.business_id=intent.business_id
       AND EXISTS (
         SELECT 1 FROM inventory_purchases AS source_purchase
         WHERE source_purchase.id=purchase.id
           AND source_purchase.business_id=intent.business_id
         FOR SHARE
       )
     RETURNING intent.purchase_id
  `,[...args,json]);
  if(saved.rowCount!==1)throw bad('Purchase intent was already committed or missing','INVENTORY_PURCHASE_INTENT_CONFLICT',409);
  // Return the exact JSON-safe snapshot persisted for future replay, rather
  // than an in-memory representation that could serialize differently.
  return snapshot;
}

// Integration-safe transaction coordinator for the existing authenticated HTTP
// Every caller MUST supply a current Merchant grant check on the SAME locked
// PostgreSQL client: check after waiting for locks (including replay) and before
// final COMMIT. The checker must read live, origin-bound membership/grants with
// clock_timestamp() and lock the relevant authorization row (FOR SHARE or
// stronger) through COMMIT; a cached session boolean is NOT sufficient.
// purchase route (NOT mounted here). Its caller must FIRST bind an authorized
// originating Merchant/business and provide the same pg Client for every
// stock/lot/purchase/expense/reconciliation query inside createPurchase.
// Neither createPurchase nor its callees may issue BEGIN/COMMIT/ROLLBACK or use
// pool.query: a purchase intent and its financial effects are one transaction.
// On an uncertain COMMIT/network outcome, the HTTP caller must reconcile the\n// SAME key; never treat the exception as proof of rollback or auto-repost.
export async function executeInventoryPurchaseIntent(client,options,createPurchase){
  if(!client||typeof client.query!=='function')throw bad('A transactional database client is required');
  if(typeof createPurchase!=='function')throw bad('A transactional purchase callback is required');
  const context={
    businessId:dbId(options?.businessId,'Business'),
    accountId:dbId(options?.accountId,'Account'),
    intentKey:literalKey(options?.intentKey),
    payload:options?.payload
  };
  // Hash the exact initiating instructions BEFORE the first asynchronous gap.
  // A caller may otherwise mutate a shared request body while BEGIN, business
  // locking, authorization or purchase writes are awaiting PostgreSQL. That
  // would commit different stock/expense data under the original fingerprint.
  const initiatingFingerprint=inventoryPurchaseFingerprint(context.payload);
  const assertInstructionsUnchanged=()=>{
    let current;
    try{current=inventoryPurchaseFingerprint(context.payload)}
    catch{throw bad('Purchase instructions changed during receiving',
      'INVENTORY_PURCHASE_INTENT_CONFLICT',409)}
    if(current!==initiatingFingerprint){
      throw bad('Purchase instructions changed during receiving',
        'INVENTORY_PURCHASE_INTENT_CONFLICT',409);
    }
  };
  const verifyCurrent=options?.verifyCurrentMerchantAuthority;
  if(typeof verifyCurrent!=='function'){
    throw bad('A current origin-bound Merchant authority verifier is required',
      'INVENTORY_PURCHASE_INTENT_AUTH_REQUIRED',403);
  }
  const assertAuthorized=async stage=>{
    const allowed=await verifyCurrent(client,Object.freeze({
      businessId:context.businessId,accountId:context.accountId,
      intentKey:context.intentKey,stage
    }));
    if(allowed!==true){
      throw bad('Current Merchant purchase authority is unavailable or revoked',
        'INVENTORY_PURCHASE_INTENT_FORBIDDEN',403);
    }
  };
  let started=false;
  let newPurchaseCommitAttempted=false;
  try{
    await client.query('BEGIN');
    started=true;
    assertInstructionsUnchanged();
    const claim=await claimInventoryPurchaseIntent(client,context);
    if(claim.kind==='replay'){
      await assertAuthorized('replay');
      assertInstructionsUnchanged();
      await client.query('COMMIT');
      started=false;
      return claim; // No purchase callback, inventory delta, lot or second expense.
    }
    await lockInventoryPurchaseBusiness(client,context.businessId);
    assertInstructionsUnchanged();
    await assertAuthorized('before-write');
    assertInstructionsUnchanged();
    const created=await createPurchase(client);
    assertInstructionsUnchanged();
    if(!created||typeof created!=='object'||Array.isArray(created)){
      throw bad('The purchase callback must return a committed response and purchase ID');
    }
    const response=await finishInventoryPurchaseIntent(client,{
      ...context,purchaseId:created.purchaseId,response:created.response
    });
    await assertAuthorized('before-commit');
    assertInstructionsUnchanged();
    // Once COMMIT is sent, an exception cannot prove whether stock, lots and
    // expense were committed. Explicitly mark this outcome as indeterminate.
    newPurchaseCommitAttempted=true;
    await client.query('COMMIT');
    newPurchaseCommitAttempted=false;
    started=false;
    return {kind:'new',purchaseId:String(created.purchaseId),response};
  }catch(error){
    if(started){
      // Preserve the original failure for the caller and avoid retrying effects.
      // If the connection is lost, the owning HTTP layer must discard it.
      await client.query('ROLLBACK').catch(()=>{});
    }
    if(newPurchaseCommitAttempted){
      // ROLLBACK after a lost COMMIT acknowledgement may be a no-op: the
      // original intent and financial effects might already be durable.
      // Do not collapse this into an ordinary purchase failure or auto-retry.
      const uncertain=bad('Purchase commit outcome is unknown; reconcile the original intent key before another attempt',
        'INVENTORY_PURCHASE_INTENT_COMMIT_UNKNOWN',503);
      uncertain.cause=error;
      throw uncertain;
    }
    throw error;
  }
}


/**
 * Read-only reconciliation, NOT a safe-post retry. An absent row may reflect
 * an in-flight transaction, not a failed purchase. In particular, NEVER call
 * executeInventoryPurchaseIntent just to inspect an unknown COMMIT: if the
 * prior INSERT rolled back it could create a new stock/lot/expense operation.
 * The caller must bind the actual session's business/account and verify live,
 * row-locked Merchant authority on this same pg client through COMMIT.
 */
export async function inspectInventoryPurchaseIntent(client,options){
  if(!client||typeof client.query!=='function')throw bad('A transactional client is required');
  const business=dbId(options?.businessId,'Business');
  const account=dbId(options?.accountId,'Account');
  const key=literalKey(options?.intentKey);
  const fingerprint=inventoryPurchaseFingerprint(options?.payload);
  const verify=options?.verifyCurrentMerchantAuthority;
  if(typeof verify!=='function')throw bad('Current Merchant grant verifier required',
    'INVENTORY_PURCHASE_INTENT_AUTH_REQUIRED',403);
  let started=false;
  try{
    await client.query('BEGIN');started=true;
    const allowed=await verify(client,Object.freeze({
      businessId:business,accountId:account,intentKey:key,stage:'reconcile'
    }));
    if(allowed!==true)throw bad('Current Merchant authority revoked',
      'INVENTORY_PURCHASE_INTENT_FORBIDDEN',403);
    // No INSERT or business advisory lock here; neither missing nor pending
    // keys may be treated as permission to create a new purchase.
    const found=await client.query(`
      SELECT payload_sha256,purchase_id,response_json
        FROM inventory_purchase_intents
       WHERE business_id=$1 AND account_id=$2 AND intent_key=$3
       FOR SHARE
    `,[business,account,key]);
    if(found.rowCount===0){
      await client.query('COMMIT');started=false;
      return{kind:'unconfirmed',safeToRetry:false};
    }
    if(found.rowCount!==1)throw bad('Ambiguous purchase intent',
      'INVENTORY_PURCHASE_INTENT_CONFLICT',409);
    const row=found.rows[0];
    if(row.payload_sha256!==fingerprint)throw bad('Purchase intent key reused with different details',
      'INVENTORY_PURCHASE_INTENT_CONFLICT',409);
    if(row.purchase_id==null||row.response_json==null)throw bad('Purchase intent incomplete',
      'INVENTORY_PURCHASE_INTENT_INCOMPLETE',409);
    const purchase=dbId(row.purchase_id,'Purchase');
    // Lock the actual purchase as well as its private response: provenance
    // must remain tied to this business until the inspection completes.
    const source=await client.query(`
      SELECT id FROM inventory_purchases WHERE id=$1 AND business_id=$2 FOR SHARE
    `,[purchase,business]);
    if(source.rowCount!==1)throw bad('Original purchase provenance has changed',
      'INVENTORY_PURCHASE_INTENT_CONFLICT',409);
    const response=verifiedPurchaseResponse(row.response_json,purchase);
    await client.query('COMMIT');started=false;
    return{kind:'committed',purchaseId:purchase,response,safeToRetry:false};
  }catch(error){
    if(started)await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }
}
