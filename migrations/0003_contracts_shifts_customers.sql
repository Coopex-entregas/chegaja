PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  establishment_id TEXT,
  name TEXT NOT NULL,
  code TEXT,
  pickup_address TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (establishment_id) REFERENCES establishments(id)
);
CREATE INDEX IF NOT EXISTS idx_contracts_scope ON contracts(cooperative_id, establishment_id, active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contracts_name ON contracts(cooperative_id, name) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS contract_price_rules (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  neighborhood TEXT NOT NULL,
  fixed_cents INTEGER NOT NULL DEFAULT 0,
  base_cents INTEGER NOT NULL DEFAULT 0,
  driver_cents INTEGER NOT NULL DEFAULT 0,
  cooperative_cents INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_contract_prices ON contract_price_rules(contract_id, neighborhood, active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_prices_unique ON contract_price_rules(contract_id, neighborhood);

CREATE TABLE IF NOT EXISTS shift_templates (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  name TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  shift_label TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id)
);
CREATE INDEX IF NOT EXISTS idx_shift_templates_scope ON shift_templates(cooperative_id, active, start_time);

ALTER TABLE schedules ADD COLUMN contract_id TEXT REFERENCES contracts(id);
ALTER TABLE schedules ADD COLUMN shift_template_id TEXT REFERENCES shift_templates(id);
ALTER TABLE schedules ADD COLUMN shift_label TEXT;
CREATE INDEX IF NOT EXISTS idx_schedules_contract ON schedules(contract_id, start_at);

ALTER TABLE deliveries ADD COLUMN contract_id TEXT REFERENCES contracts(id);
ALTER TABLE deliveries ADD COLUMN pickup_contact_name TEXT;
ALTER TABLE deliveries ADD COLUMN pickup_phone TEXT;
ALTER TABLE deliveries ADD COLUMN pickup_neighborhood TEXT;
ALTER TABLE deliveries ADD COLUMN recipient_name TEXT;
ALTER TABLE deliveries ADD COLUMN recipient_phone TEXT;
ALTER TABLE deliveries ADD COLUMN delivery_neighborhood TEXT;
ALTER TABLE deliveries ADD COLUMN item_description TEXT;
CREATE INDEX IF NOT EXISTS idx_deliveries_contract ON deliveries(contract_id, created_at);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

CREATE TABLE IF NOT EXISTS customer_addresses (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  label TEXT,
  address TEXT NOT NULL,
  neighborhood TEXT,
  city TEXT,
  reference TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customer_requests (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  customer_id TEXT,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  pickup_address TEXT NOT NULL,
  pickup_neighborhood TEXT,
  pickup_contact_name TEXT,
  pickup_phone TEXT,
  delivery_address TEXT NOT NULL,
  delivery_neighborhood TEXT,
  recipient_name TEXT,
  recipient_phone TEXT,
  item_description TEXT,
  payment_method TEXT,
  quoted_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','accepted','converted','cancelled')),
  delivery_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (delivery_id) REFERENCES deliveries(id)
);
CREATE INDEX IF NOT EXISTS idx_customer_requests_scope ON customer_requests(cooperative_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS service_areas (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  city TEXT NOT NULL,
  neighborhood TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id)
);
CREATE INDEX IF NOT EXISTS idx_service_areas_scope ON service_areas(cooperative_id, city, neighborhood, active);
