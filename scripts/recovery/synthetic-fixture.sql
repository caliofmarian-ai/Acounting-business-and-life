-- Synthetic subset of canonical columns, never personal/company-test records.
-- Deliberately no FKs: restore verification must itself catch broken references.
CREATE TABLE accounts(id bigint PRIMARY KEY);
CREATE TABLE businesses(id bigint PRIMARY KEY);
CREATE TABLE profiles(account_id bigint,role text);
CREATE TABLE business_memberships(business_id bigint,account_id bigint);
CREATE TABLE orders(id bigint PRIMARY KEY,business_id bigint,customer_account_id bigint,subtotal numeric(12,2),delivery_fee numeric(12,2),total numeric(12,2),paid_amount numeric(12,2),outstanding_amount numeric(12,2));
CREATE TABLE order_items(order_id bigint,quantity numeric(12,3),line_total numeric(12,2));
CREATE TABLE inventory(id bigint PRIMARY KEY,business_id bigint,quantity numeric(12,3),unit_cost numeric(12,4));
CREATE TABLE transactions(id bigint PRIMARY KEY,business_id bigint,type text,amount numeric(12,2));
CREATE TABLE order_stock_consumptions(order_id bigint,inventory_id bigint);
CREATE TABLE order_payments(id bigint PRIMARY KEY,order_id bigint,payment_intent_id bigint);
CREATE TABLE payment_intents(id bigint PRIMARY KEY,business_id bigint,payer_account_id bigint,amount numeric(14,2),currency_code text);
CREATE TABLE payment_allocations(payment_intent_id bigint,currency_code text);
CREATE TABLE refunds(payment_intent_id bigint);
INSERT INTO accounts VALUES(1),(2);
INSERT INTO businesses VALUES(1),(2);
INSERT INTO profiles VALUES(1,'merchant'),(2,'customer');
INSERT INTO business_memberships VALUES(1,1),(2,1);
-- A null customer is a legitimate counter order; business 2 tests isolation.
INSERT INTO orders VALUES(1,1,2,100,20,120,120,0),(2,2,NULL,50,0,50,0,50);
INSERT INTO order_items VALUES(1,2,100),(2,1,50);
INSERT INTO inventory VALUES(1,1,8,10),(2,2,4,5);
INSERT INTO transactions VALUES(1,1,'sale',100),(2,2,'business_expense',10);
INSERT INTO order_stock_consumptions VALUES(1,1);
-- Legacy payments may have no intent. Gross/net allocation rows overlap.
INSERT INTO payment_intents VALUES(1,1,2,120,'PHP');
INSERT INTO order_payments VALUES(1,1,1),(2,2,NULL);
INSERT INTO payment_allocations VALUES(1,'PHP'),(1,'PHP');
INSERT INTO refunds VALUES(1);
