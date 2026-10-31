/** Isolated PostgreSQL proof that staff order attribution follows order COMMIT/ROLLBACK.
 * Never connect to Preview/Production. 
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import {ensureMerchantTeamSchema} from '../merchant-team-operators.js';
import {ensureMerchantTeamTerminalSchema} from '../merchant-team-terminal-core.js';
import {ensureMerchantTeamOrderAttributionSchema,recordStaffOrderAttribution} from '../merchant-team-order-attribution.js';

const enabled=process.env.VOICE_ORDER_TEST_ISOLATED==='1'&&
  /\/abl_voice_ci$/.test(String(process.env.VOICE_ORDER_TEST_DB_URL||''));
test('real PostgreSQL: staff attribution is same-transaction, immutable and revocation-safe',
  {skip:!enabled},async()=>{
  const db=new pg.Pool({connectionString:process.env.VOICE_ORDER_TEST_DB_URL,max:4});
  const bid=90000111,aid=90000111,oid=crypto.randomUUID(),sid=crypto.randomUUID();
  const firstOrder=90000111,secondOrder=90000112,thirdOrder=90000113;
  const row=orderId=>({orderId,businessId:bid,ownerAccountId:aid,operatorId:oid,
    terminalSessionId:sid,requestKey:'ci-staff-source-'+orderId+'-unique-key',
    quoteHash:'f'.repeat(64),confirmationMethod:'staff_passkey',source:'voice'});
  try{
    await db.query(`CREATE TABLE IF NOT EXISTS accounts(id BIGINT PRIMARY KEY);
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS auth_status TEXT NOT NULL DEFAULT 'active';
      CREATE TABLE IF NOT EXISTS businesses(id BIGINT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS profiles(account_id BIGINT NOT NULL REFERENCES accounts(id),
        role TEXT NOT NULL,enabled BOOLEAN NOT NULL DEFAULT TRUE,PRIMARY KEY(account_id,role));
      CREATE TABLE IF NOT EXISTS business_memberships(business_id BIGINT NOT NULL REFERENCES businesses(id),
        account_id BIGINT NOT NULL REFERENCES accounts(id),active BOOLEAN NOT NULL DEFAULT TRUE,
        membership_role TEXT NOT NULL,PRIMARY KEY(business_id,account_id));
      CREATE TABLE IF NOT EXISTS orders(id BIGINT PRIMARY KEY,business_id BIGINT NOT NULL REFERENCES businesses(id));`);
    await ensureMerchantTeamSchema(db);
    await ensureMerchantTeamTerminalSchema(db);
    await ensureMerchantTeamOrderAttributionSchema(db);
    await db.query(`INSERT INTO accounts(id,auth_status) VALUES($1,'active') ON CONFLICT(id) DO NOTHING`,[aid]);
    await db.query(`INSERT INTO businesses(id) VALUES($1) ON CONFLICT(id) DO NOTHING`,[bid]);
    await db.query(`INSERT INTO profiles(account_id,role,enabled) VALUES($1,'merchant',TRUE)
      ON CONFLICT(account_id,role) DO UPDATE SET enabled=TRUE`,[aid]);
    await db.query(`INSERT INTO business_memberships(business_id,account_id,active,membership_role)
      VALUES($1,$2,TRUE,'owner') ON CONFLICT(business_id,account_id) DO UPDATE
      SET active=TRUE,membership_role='owner'`,[bid,aid]);
    await db.query(`INSERT INTO merchant_team_operators(id,business_id,owner_account_id,
      display_name,role,pin_salt,pin_hash,created_by_account_id)
      VALUES($1,$2,$3,'CI Family Helper','order_operator',$4,$5,$3)`,[oid,bid,aid,'a'.repeat(48),'b'.repeat(128)]);
    await db.query(`INSERT INTO merchant_team_terminal_sessions(
      id,business_id,owner_account_id,operator_id,token_digest,expires_at)
      VALUES($1,$2,$3,$4,$5,NOW()+INTERVAL '1 hour')`,[sid,bid,aid,oid,'c'.repeat(64)]);

    const client=await db.connect();
    try{
      await client.query('BEGIN');
      await client.query('INSERT INTO orders(id,business_id) VALUES($1,$2)',[firstOrder,bid]);
      const result=await recordStaffOrderAttribution(client,row(firstOrder));
      assert.equal(result.created,true);
      await client.query('COMMIT');
      await client.query('BEGIN');
      assert.equal((await recordStaffOrderAttribution(client,row(firstOrder))).created,false);
      await client.query('COMMIT');
      await client.query('BEGIN');
      await client.query('INSERT INTO orders(id,business_id) VALUES($1,$2)',[secondOrder,bid]);
      await recordStaffOrderAttribution(client,row(secondOrder));
      await client.query('ROLLBACK');
    }finally{client.release()}
    const first=await db.query('SELECT * FROM merchant_team_order_attribution WHERE order_id=$1',[firstOrder]);
    assert.equal(first.rowCount,1);
    assert.equal(first.rows[0].operator_name_snapshot,'CI Family Helper');
    assert.equal(first.rows[0].business_id,bid);
    assert.equal((await db.query('SELECT 1 FROM merchant_team_order_attribution WHERE order_id=$1',[secondOrder])).rowCount,0);
    assert.equal((await db.query('SELECT 1 FROM orders WHERE id=$1',[secondOrder])).rowCount,0);

    await db.query('UPDATE merchant_team_terminal_sessions SET revoked_at=NOW() WHERE id=$1',[sid]);
    const revoked=await db.connect();try{
      await revoked.query('BEGIN');
      await revoked.query('INSERT INTO orders(id,business_id) VALUES($1,$2)',[thirdOrder,bid]);
      await assert.rejects(recordStaffOrderAttribution(revoked,row(thirdOrder)),e=>e.status===403);
      await revoked.query('ROLLBACK');
    }finally{revoked.release()}
    assert.equal((await db.query('SELECT 1 FROM orders WHERE id=$1',[thirdOrder])).rowCount,0);
  }finally{await db.end()}
});