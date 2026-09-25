// Shared bootstrap for the legacy accounting tables that are now owned at runtime by Multi-business Accounting.
// This module owns schema creation only. It exposes no HTTP routes and starts no listener.
export async function ensureLegacyAccountingBaseSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id BIGSERIAL PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('sale','business_expense','money_received','personal_withdrawal','adjustment')),
      category TEXT NOT NULL DEFAULT 'Other',
      amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
      payment_method TEXT NOT NULL DEFAULT 'cash',
      note TEXT NOT NULL DEFAULT '',
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS account TEXT NOT NULL DEFAULT 'cash';
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source_id BIGINT;
    UPDATE transactions SET account=payment_method WHERE account='cash' AND payment_method IN ('gcash','bank','other');

    CREATE TABLE IF NOT EXISTS inventory (
      id BIGSERIAL PRIMARY KEY,
      item TEXT UNIQUE NOT NULL,
      unit TEXT NOT NULL DEFAULT 'pcs',
      quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
      reorder_level NUMERIC(12,3) NOT NULL DEFAULT 0,
      unit_cost NUMERIC(12,4) NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE inventory ALTER COLUMN unit_cost TYPE NUMERIC(12,4);

    CREATE TABLE IF NOT EXISTS daily_openings (
      business_date DATE PRIMARY KEY,
      opening_cash NUMERIC(12,2) NOT NULL CHECK (opening_cash >= 0),
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS daily_closings (
      business_date DATE PRIMARY KEY,
      expected_cash NUMERIC(12,2) NOT NULL,
      actual_cash NUMERIC(12,2) NOT NULL,
      variance NUMERIC(12,2) NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE daily_closings ADD COLUMN IF NOT EXISTS opening_cash NUMERIC(12,2) NOT NULL DEFAULT 0;

    CREATE TABLE IF NOT EXISTS remittances (
      id BIGSERIAL PRIMARY KEY,
      sent_amount NUMERIC(12,2) NOT NULL CHECK (sent_amount >= 0),
      sent_currency TEXT NOT NULL DEFAULT 'EUR',
      fee_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      exchange_rate NUMERIC(14,6),
      expected_php NUMERIC(12,2),
      received_php NUMERIC(12,2) NOT NULL CHECK (received_php >= 0),
      account TEXT NOT NULL DEFAULT 'gcash',
      provider TEXT NOT NULL DEFAULT '',
      reference TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      received_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS budgets (
      id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      personal_daily_limit NUMERIC(12,2) NOT NULL DEFAULT 0,
      personal_weekly_limit NUMERIC(12,2) NOT NULL DEFAULT 0,
      business_daily_limit NUMERIC(12,2) NOT NULL DEFAULT 0,
      min_available_warning NUMERIC(12,2) NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE budgets ADD COLUMN IF NOT EXISTS business_id BIGINT NOT NULL DEFAULT 1;
    CREATE UNIQUE INDEX IF NOT EXISTS budgets_business_id_unique ON budgets(business_id,id);
    INSERT INTO budgets(id,business_id) VALUES(1,1) ON CONFLICT(business_id,id) DO NOTHING;

    CREATE TABLE IF NOT EXISTS audit_events (
      id BIGSERIAL PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id BIGINT NOT NULL,
      action TEXT NOT NULL,
      before_data JSONB,
      after_data JSONB,
      reason TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS products (
      id BIGSERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      category TEXT NOT NULL DEFAULT 'Food',
      selling_price NUMERIC(12,2) NOT NULL CHECK (selling_price >= 0),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS recipes (
      product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      inventory_id BIGINT NOT NULL REFERENCES inventory(id),
      quantity NUMERIC(14,4) NOT NULL CHECK (quantity > 0),
      PRIMARY KEY(product_id, inventory_id)
    );

    CREATE TABLE IF NOT EXISTS product_sales (
      id BIGSERIAL PRIMARY KEY,
      product_id BIGINT NOT NULL REFERENCES products(id),
      product_name_snapshot TEXT NOT NULL,
      quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
      unit_price_snapshot NUMERIC(12,2) NOT NULL,
      unit_cost_snapshot NUMERIC(12,4) NOT NULL,
      revenue NUMERIC(12,2) NOT NULL,
      estimated_cogs NUMERIC(12,2) NOT NULL,
      gross_profit NUMERIC(12,2) NOT NULL,
      account TEXT NOT NULL,
      transaction_id BIGINT UNIQUE NOT NULL REFERENCES transactions(id),
      note TEXT NOT NULL DEFAULT '',
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS product_sale_ingredients (
      sale_id BIGINT NOT NULL REFERENCES product_sales(id) ON DELETE CASCADE,
      inventory_id BIGINT NOT NULL REFERENCES inventory(id),
      item_name_snapshot TEXT NOT NULL,
      quantity_used NUMERIC(14,4) NOT NULL,
      unit_cost_snapshot NUMERIC(12,4) NOT NULL,
      cost_snapshot NUMERIC(12,4) NOT NULL,
      PRIMARY KEY(sale_id, inventory_id)
    );

    CREATE INDEX IF NOT EXISTS transactions_occurred_idx ON transactions(occurred_at DESC);
    CREATE INDEX IF NOT EXISTS transactions_account_idx ON transactions(account);
    CREATE INDEX IF NOT EXISTS audit_entity_idx ON audit_events(entity_type, entity_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS product_sales_occurred_idx ON product_sales(occurred_at DESC);
    CREATE INDEX IF NOT EXISTS product_sales_product_idx ON product_sales(product_id, occurred_at DESC);
  `);
}
