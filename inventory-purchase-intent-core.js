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
`;

const bad=(message,code='INVENTORY_PURCHASE_INTENT_INVALID',status=400)=>
  Object.assign(new Error(message),{code,status});
const MAX_BIGINT=9223372036854775807n;
function dbId(value,label){
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
function stable(value,depth=0){
  if(depth>16)throw bad('Purchase payload is nested too deeply');
  if(value===null)return 'null';
  if(typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'){
    if(!Number.isFinite(value))throw bad('Purchase payload contains an invalid number');
    return JSON.stringify(value);
  }
  if(Array.isArray(value))return `[${value.map(v=>stable(v,depth+1)).join(',')}]`;
  if(typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype){
    throw bad('Purchase payload must contain JSON-only values');
  }
  const keys=Object.keys(value).sort();
  return `{${keys.map(k=>`${JSON.stringify(k)}:${stable(value[k],depth+1)}`).join(',')}}`;
}
export function inventoryPurchaseFingerprint(payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw bad('Purchase payload must be a JSON object');
  const canonical=stable(payload);
  if(Buffer.byteLength(canonical,'utf8')>32768)throw bad('Purchase payload exceeds intent fingerprint limit');
  return createHash('sha256').update('ABL-INVENTORY-PURCHASE-V1\n').update(canonical).digest('hex');
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
  const prior=await client.query(`
    SELECT payload_sha256,purchase_id,response_json FROM inventory_purchase_intents
    WHERE business_id=$1 AND account_id=$2 AND intent_key=$3 FOR UPDATE
  `,args.slice(0,3));
  if(prior.rowCount!==1)throw bad('Purchase intent changed during replay','INVENTORY_PURCHASE_INTENT_RETRY',409);
  const row=prior.rows[0];
  if(row.payload_sha256!==fingerprint)throw bad('Purchase intent key was reused with different details','INVENTORY_PURCHASE_INTENT_CONFLICT',409);
  if(row.purchase_id==null||row.response_json==null)throw bad('Purchase intent has no committed result','INVENTORY_PURCHASE_INTENT_INCOMPLETE',409);
  return{kind:'replay',purchaseId:row.purchase_id,response:row.response_json};
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
  const json=JSON.stringify(response);
  if(!json||Buffer.byteLength(json,'utf8')>65536)throw bad('Purchase response snapshot exceeds intent limit');
  const saved=await client.query(`
    UPDATE inventory_purchase_intents
       SET purchase_id=$4,response_json=$5::jsonb,committed_at=NOW()
     WHERE business_id=$1 AND account_id=$2 AND intent_key=$3 AND purchase_id IS NULL
     RETURNING purchase_id
  `,[...args,json]);
  if(saved.rowCount!==1)throw bad('Purchase intent was already committed or missing','INVENTORY_PURCHASE_INTENT_CONFLICT',409);
  return response;
}
