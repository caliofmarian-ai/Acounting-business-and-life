// Only for the disposable postgres:16 GitHub Actions database.
// Exercise the actual shipped readConsistentOrderForDocument and Orders reader.
import assert from 'node:assert/strict';
import pg from 'pg';
import {readConsistentOrderForDocument,commercialOrderDocument} from '../customer-sales-documents.js';

const {Client}=pg;
if(process.env.ABL_SALES_SNAPSHOT_CI!=='1' ||
  process.env.PGHOST!=='127.0.0.1' ||
  process.env.PGDATABASE!=='abl_sales_snapshot_ci')
  throw Error('Refusing non-isolated PostgreSQL target');
const config={
  host:process.env.PGHOST,port:Number(process.env.PGPORT||5432),
  database:process.env.PGDATABASE,user:process.env.PGUSER,
  password:process.env.PGPASSWORD
};
const reader=new Client(config),writer=new Client(config);
await reader.connect();
try{
  await writer.connect();
  try{
    await writer.query(`
      CREATE TABLE businesses(id BIGINT PRIMARY KEY,name TEXT NOT NULL);
      CREATE TABLE orders(
        id BIGINT PRIMARY KEY,business_id BIGINT NOT NULL,
        customer_account_id BIGINT NOT NULL,order_number TEXT,
        created_at TIMESTAMPTZ NOT NULL,order_status TEXT,payment_status TEXT,
        payment_method TEXT,currency_code TEXT,subtotal NUMERIC(12,2),
        delivery_fee NUMERIC(12,2),total NUMERIC(12,2),
        paid_amount NUMERIC(12,2),outstanding_amount NUMERIC(12,2)
      );
      CREATE TABLE order_items(
        id BIGINT PRIMARY KEY,order_id BIGINT NOT NULL,
        name_snapshot TEXT NOT NULL,quantity NUMERIC(12,3),
        unit_price_snapshot NUMERIC(12,2),line_total NUMERIC(12,2)
      );
      CREATE TABLE order_payments(
        id BIGINT PRIMARY KEY,order_id BIGINT NOT NULL,
        amount NUMERIC(12,2),account TEXT,method_code TEXT,
        provider_code TEXT,provider_reference TEXT,status TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE order_status_events(
        id BIGINT PRIMARY KEY,order_id BIGINT NOT NULL,from_status TEXT,
        to_status TEXT,note TEXT,created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await writer.query("INSERT INTO businesses(id,name) VALUES(1,'PH Merchant')");
    await writer.query(`INSERT INTO orders(
      id,business_id,customer_account_id,order_number,created_at,
      order_status,payment_status,payment_method,currency_code,
      subtotal,delivery_fee,total,paid_amount,outstanding_amount
    ) VALUES(10,1,20,'PH-10','2026-11-05T06:00:00Z',
      'completed','paid','cash','PHP',10,0,10,10,0)`);
    await writer.query(`INSERT INTO order_items(id,order_id,name_snapshot,quantity,
      unit_price_snapshot,line_total) VALUES(100,10,'Existing stock item',1,10,10)`);
    let changed=false,readOnlyChecked=false;
    const wrapped={
      async query(sql,params){
        const response=await reader.query(sql,params);
        if(sql.includes('SELECT o.*,b.name business_name FROM orders o')){
          const isolation=await reader.query('SHOW transaction_isolation');
          const access=await reader.query('SHOW transaction_read_only');
          assert.equal(isolation.rows[0].transaction_isolation,'repeatable read');
          assert.equal(access.rows[0].transaction_read_only,'on');
          readOnlyChecked=true;
          // Commit a second economic revision AFTER the order SELECT but
          // BEFORE the separate order_items/payments/status queries.
          await writer.query('BEGIN');
          try{
            await writer.query(`UPDATE orders SET subtotal=20,total=20,paid_amount=20
              WHERE id=10`);
            await writer.query(`UPDATE order_items SET unit_price_snapshot=20,line_total=20
              WHERE id=100`);
            await writer.query(`INSERT INTO order_payments(id,order_id,amount,account,status)
              VALUES(1000,10,10,'cash','received')`);
            await writer.query('COMMIT');
            changed=true;
          }catch(e){await writer.query('ROLLBACK');throw e}
        }
        return response;
      },
      release(){}
    };
    const order=await readConsistentOrderForDocument({connect:async()=>wrapped},10);
    assert.equal(changed,true);
    assert.equal(readOnlyChecked,true);
    assert.equal(order.total,'10.00');
    assert.equal(order.paid_amount,'10.00');
    assert.equal(order.items.length,1);
    assert.equal(order.items[0].line_total,'10.00');
    assert.equal(order.payments.length,0,'new payment must not leak into old snapshot');
    assert.equal(order.events.length,0);
    const doc=commercialOrderDocument(order);
    assert.equal(doc.total,10);
    assert.equal(doc.items[0].line_total,10);
    const latest=await writer.query(`SELECT o.total,i.line_total,
      (SELECT count(*) FROM order_payments WHERE order_id=10) AS payments
      FROM orders o JOIN order_items i ON i.order_id=o.id WHERE o.id=10`);
    assert.equal(latest.rows[0].total,'20.00');
    assert.equal(latest.rows[0].line_total,'20.00');
    assert.equal(latest.rows[0].payments,'1');
    console.log('PASS: real PostgreSQL 16 read-only repeatable-read snapshot survives concurrent order/line/payment COMMIT');
  }finally{
    await writer.query('DROP TABLE IF EXISTS order_status_events,order_payments,order_items,orders,businesses').catch(()=>{});
    await writer.end();
  }
}finally{await reader.end()}
