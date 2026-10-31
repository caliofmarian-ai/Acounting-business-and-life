/**
 * Business & Life #863 — append-only, same-transaction attribution of a staff
 * counter order to the human operator and restricted terminal session.
 * This module NEVER creates or approves an order by itself.
 * Caller MUST hold the same checked-out PostgreSQL transaction used by
 * canonical createOrder() and by the idempotent approval guard.
 */
import crypto from 'node:crypto';
import {merchantTeamPermissions} from './merchant-team-operators.js';

const error=(code,message,status=409)=>Object.assign(new Error(message),{code,status});
const positive=value=>Number.isSafeInteger(Number(value))&&Number(value)>0;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const keyPattern=/^[A-Za-z0-9_-]{24,100}$/;
const hashPattern=/^[a-f0-9]{64}$/;
const allowedModes=new Set(['staff_pin','staff_passkey']);
const allowedSources=new Set(['voice','manual_counter']);

export async function ensureMerchantTeamOrderAttributionSchema(db){
  await db.query(`CREATE TABLE IF NOT EXISTS merchant_team_order_attribution (
    order_id BIGINT PRIMARY KEY REFERENCES orders(id) ON DELETE RESTRICT,
    business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
    owner_account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    operator_id UUID REFERENCES merchant_team_operators(id) ON DELETE SET NULL,
    operator_name_snapshot TEXT NOT NULL CHECK(length(operator_name_snapshot) BETWEEN 2 AND 80),
    terminal_session_id UUID NOT NULL,
    confirmation_method TEXT NOT NULL CHECK(confirmation_method IN ('staff_pin','staff_passkey')),
    order_source TEXT NOT NULL CHECK(order_source IN ('voice','manual_counter')),
    request_key_hash CHAR(64) NOT NULL CHECK(request_key_hash ~ '^[0-9a-f]{64}$'),
    quote_hash CHAR(64) NOT NULL CHECK(quote_hash ~ '^[0-9a-f]{64}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(business_id,request_key_hash)
  );
  CREATE INDEX IF NOT EXISTS merchant_team_order_attribution_operator_idx
    ON merchant_team_order_attribution(business_id,operator_id,created_at DESC)`);
}

export function validateStaffOrderAttribution(input={}){
  const orderId=Number(input.orderId),businessId=Number(input.businessId),
    accountId=Number(input.ownerAccountId),operatorId=String(input.operatorId||''),
    sessionId=String(input.terminalSessionId||''),requestKey=String(input.requestKey||''),
    quoteHash=String(input.quoteHash||''),method=String(input.confirmationMethod||''),
    source=String(input.source||'');
  if(!positive(orderId)||!positive(businessId)||!positive(accountId)||
     !uuid.test(operatorId)||!uuid.test(sessionId)||!keyPattern.test(requestKey)||
     !hashPattern.test(quoteHash)||!allowedModes.has(method)||!allowedSources.has(source))
    throw error('STAFF_ATTRIBUTION_INVALID','Staff order attribution is incomplete.',400);
  return{orderId,businessId,accountId,operatorId,sessionId,
    requestHash:crypto.createHash('sha256').update(requestKey).digest('hex'),
    quoteHash,method,source};
}

/**
 * Call after canonical order INSERT, before outer COMMIT. Holds shared row
 * locks until COMMIT: a racing owner revocation cannot erase authorization.
 * The owner account remains the Merchant legal identity, while operator is
 * the recorded human who confirmed this particular order.
 */
export async function recordStaffOrderAttribution(client,input,{now=new Date()}={}){
  if(!client||typeof client.query!=='function'||typeof client.connect==='function')
    throw error('STAFF_ATTRIBUTION_TX_REQUIRED','Use the existing Orders transaction to record the operator.',500);
  const x=validateStaffOrderAttribution(input);
  const q=await client.query(`SELECT o.id order_id, o.business_id,
      s.id session_id,s.operator_id,s.owner_account_id,s.expires_at session_expires_at,
      s.revoked_at session_revoked,
      p.display_name,p.role,p.is_active,p.revoked_at operator_revoked,
      p.expires_at operator_expires_at
    FROM orders o
    JOIN merchant_team_terminal_sessions s ON s.id=$5
      AND s.business_id=o.business_id AND s.owner_account_id=$3 AND s.operator_id=$4
    JOIN merchant_team_operators p ON p.id=s.operator_id
      AND p.business_id=s.business_id AND p.owner_account_id=s.owner_account_id
    JOIN business_memberships bm ON bm.business_id=s.business_id
      AND bm.account_id=s.owner_account_id AND bm.active=TRUE AND bm.membership_role='owner'
    JOIN accounts a ON a.id=bm.account_id AND a.auth_status='active'
    JOIN profiles pr ON pr.account_id=a.id AND pr.role='merchant' AND pr.enabled=TRUE
    WHERE o.id=$1 AND o.business_id=$2
    FOR SHARE OF o,s,p,bm,a,pr`,
  [x.orderId,x.businessId,x.accountId,x.operatorId,x.sessionId]);
  const row=q.rows?.[0];
  if(q.rowCount!==1||!row||Number(row.business_id)!==x.businessId||
     row.operator_id!==x.operatorId||row.owner_account_id!=x.accountId||
     row.session_id!==x.sessionId||row.session_revoked||row.operator_revoked||!row.is_active||
     new Date(row.session_expires_at).getTime()<=now.getTime()||
     row.operator_expires_at&&new Date(row.operator_expires_at).getTime()<=now.getTime()||
     !merchantTeamPermissions(row.role).includes('orders.read')||
     !['manager','order_operator','temporary'].includes(row.role))
    throw error('STAFF_ATTRIBUTION_NOT_AUTHORIZED','The staff shift is no longer authorized to confirm this order.',403);

  const inserted=await client.query(`INSERT INTO merchant_team_order_attribution (
      order_id,business_id,owner_account_id,operator_id,operator_name_snapshot,
      terminal_session_id,confirmation_method,order_source,request_key_hash,quote_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT(order_id) DO NOTHING RETURNING order_id`,
  [x.orderId,x.businessId,x.accountId,x.operatorId,String(row.display_name).slice(0,80),
    x.sessionId,x.method,x.source,x.requestHash,x.quoteHash]);
  if(inserted.rowCount===1)return{order_id:x.orderId,operator_id:x.operatorId,created:true};
  const old=await client.query(`SELECT business_id,owner_account_id,operator_id,terminal_session_id,
      confirmation_method,order_source,request_key_hash,quote_hash
    FROM merchant_team_order_attribution WHERE order_id=$1 FOR SHARE`,[x.orderId]);
  const prior=old.rows?.[0];
  if(old.rowCount!==1||Number(prior.business_id)!==x.businessId||
      Number(prior.owner_account_id)!==x.accountId||prior.operator_id!==x.operatorId||
      prior.terminal_session_id!==x.sessionId||prior.confirmation_method!==x.method||
      prior.order_source!==x.source||prior.request_key_hash!==x.requestHash||
      prior.quote_hash!==x.quoteHash)
    throw error('STAFF_ATTRIBUTION_CONFLICT','An order cannot be attributed to another staff member.',409);
  return{order_id:x.orderId,operator_id:x.operatorId,created:false};
}