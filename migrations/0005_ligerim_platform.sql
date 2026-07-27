PRAGMA foreign_keys = ON;

ALTER TABLE cooperatives ADD COLUMN inss_percent REAL NOT NULL DEFAULT 4.0;
ALTER TABLE cooperatives ADD COLUMN sest_senat_percent REAL NOT NULL DEFAULT 0.5;
ALTER TABLE cooperatives ADD COLUMN default_minimum_cents INTEGER NOT NULL DEFAULT 1200;
ALTER TABLE cooperatives ADD COLUMN default_km_cents INTEGER NOT NULL DEFAULT 250;
ALTER TABLE cooperatives ADD COLUMN cooperative_fee_percent REAL NOT NULL DEFAULT 0;

ALTER TABLE establishments ADD COLUMN city TEXT;
ALTER TABLE establishments ADD COLUMN state TEXT;
ALTER TABLE establishments ADD COLUMN postal_code TEXT;
ALTER TABLE establishments ADD COLUMN rate_per_km_cents INTEGER NOT NULL DEFAULT 250;
ALTER TABLE establishments ADD COLUMN minimum_fee_cents INTEGER NOT NULL DEFAULT 1200;
ALTER TABLE establishments ADD COLUMN cooperative_fee_percent REAL NOT NULL DEFAULT 0;
ALTER TABLE establishments ADD COLUMN auto_quote INTEGER NOT NULL DEFAULT 1;
ALTER TABLE establishments ADD COLUMN order_prefix TEXT;

ALTER TABLE schedules ADD COLUMN base_id TEXT;

ALTER TABLE deliveries ADD COLUMN display_code TEXT;
ALTER TABLE deliveries ADD COLUMN delivery_type TEXT NOT NULL DEFAULT 'establishment';
ALTER TABLE deliveries ADD COLUMN base_id TEXT;
ALTER TABLE deliveries ADD COLUMN distance_meters INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN duration_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN route_geometry TEXT;
ALTER TABLE deliveries ADD COLUMN driver_gross_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN driver_net_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN services_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN route_order INTEGER;

ALTER TABLE customer_requests ADD COLUMN base_id TEXT;
ALTER TABLE customer_requests ADD COLUMN services_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customer_requests ADD COLUMN distance_meters INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customer_requests ADD COLUMN duration_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customer_requests ADD COLUMN credit_used_cents INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS bases (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  latitude REAL,
  longitude REAL,
  minimum_fee_cents INTEGER NOT NULL DEFAULT 1200,
  rate_per_km_cents INTEGER NOT NULL DEFAULT 250,
  cooperative_fee_percent REAL NOT NULL DEFAULT 0,
  qr_token TEXT NOT NULL UNIQUE,
  virtual_establishment_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (virtual_establishment_id) REFERENCES establishments(id)
);
CREATE INDEX IF NOT EXISTS idx_bases_cooperative ON bases(cooperative_id, active);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  base_id TEXT,
  establishment_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  add_cents INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (base_id) REFERENCES bases(id),
  FOREIGN KEY (establishment_id) REFERENCES establishments(id)
);
CREATE INDEX IF NOT EXISTS idx_services_scope ON services(cooperative_id, base_id, establishment_id, active);

CREATE TABLE IF NOT EXISTS delivery_services (
  delivery_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  service_name TEXT NOT NULL,
  add_cents INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (delivery_id, service_id),
  FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE,
  FOREIGN KEY (service_id) REFERENCES services(id)
);

CREATE TABLE IF NOT EXISTS cooperative_sequences (
  cooperative_id TEXT NOT NULL,
  sequence_name TEXT NOT NULL,
  current_value INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (cooperative_id, sequence_name),
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id)
);

CREATE TABLE IF NOT EXISTS deduction_types (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  name TEXT NOT NULL,
  calculation_type TEXT NOT NULL CHECK(calculation_type IN ('percentage','fixed_monthly','fixed_weekly')),
  default_value REAL NOT NULL DEFAULT 0,
  apply_on TEXT NOT NULL DEFAULT 'gross' CHECK(apply_on IN ('gross','net')),
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id)
);
CREATE INDEX IF NOT EXISTS idx_deduction_types_scope ON deduction_types(cooperative_id, active, sort_order);

CREATE TABLE IF NOT EXISTS monthly_deduction_values (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  deduction_type_id TEXT NOT NULL,
  reference_month TEXT NOT NULL,
  value REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (deduction_type_id) REFERENCES deduction_types(id) ON DELETE CASCADE,
  UNIQUE(cooperative_id, deduction_type_id, reference_month)
);

CREATE TABLE IF NOT EXISTS weekly_closings (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  week_start TEXT NOT NULL,
  week_end TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','closed','paid','cancelled')),
  total_gross_cents INTEGER NOT NULL DEFAULT 0,
  total_deductions_cents INTEGER NOT NULL DEFAULT 0,
  total_advances_cents INTEGER NOT NULL DEFAULT 0,
  total_net_cents INTEGER NOT NULL DEFAULT 0,
  closed_by TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (closed_by) REFERENCES users(id),
  UNIQUE(cooperative_id, week_start)
);

CREATE TABLE IF NOT EXISTS weekly_closing_items (
  id TEXT PRIMARY KEY,
  closing_id TEXT NOT NULL,
  cooperative_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  gross_cents INTEGER NOT NULL DEFAULT 0,
  deductions_cents INTEGER NOT NULL DEFAULT 0,
  advances_cents INTEGER NOT NULL DEFAULT 0,
  net_cents INTEGER NOT NULL DEFAULT 0,
  details_json TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','paid','cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (closing_id) REFERENCES weekly_closings(id) ON DELETE CASCADE,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (driver_id) REFERENCES drivers(id),
  UNIQUE(closing_id, driver_id)
);
CREATE INDEX IF NOT EXISTS idx_weekly_items_driver ON weekly_closing_items(driver_id, created_at DESC);

CREATE TABLE IF NOT EXISTS advance_requests (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  requested_cents INTEGER NOT NULL,
  approved_cents INTEGER NOT NULL DEFAULT 0,
  available_at_request_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','paid','cancelled')),
  driver_notes TEXT,
  admin_notes TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (driver_id) REFERENCES drivers(id),
  FOREIGN KEY (reviewed_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_advances_scope ON advance_requests(cooperative_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_advances_driver ON advance_requests(driver_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS customer_accounts (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'password',
  provider_subject TEXT,
  email TEXT COLLATE NOCASE,
  phone TEXT,
  password_hash TEXT,
  password_salt TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','blocked','inactive')),
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_accounts_email ON customer_accounts(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_accounts_provider ON customer_accounts(provider, provider_subject) WHERE provider_subject IS NOT NULL;

CREATE TABLE IF NOT EXISTS customer_wallets (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL UNIQUE,
  balance_cents INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customer_wallet_transactions (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL,
  cooperative_id TEXT,
  request_id TEXT,
  entry_type TEXT NOT NULL CHECK(entry_type IN ('credit','debit')),
  category TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('pending','confirmed','cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (wallet_id) REFERENCES customer_wallets(id) ON DELETE CASCADE,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (request_id) REFERENCES customer_requests(id)
);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions ON customer_wallet_transactions(wallet_id, created_at DESC);

CREATE TABLE IF NOT EXISTS credit_purchase_requests (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  cooperative_id TEXT,
  amount_cents INTEGER NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'pix',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
  proof_url TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (reviewed_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_credit_requests_scope ON credit_purchase_requests(cooperative_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS presence_sessions (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  location_type TEXT NOT NULL CHECK(location_type IN ('establishment','base')),
  establishment_id TEXT,
  base_id TEXT,
  schedule_id TEXT,
  contract_id TEXT,
  checkin_lat REAL,
  checkin_lng REAL,
  checkin_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  checkout_lat REAL,
  checkout_lng REAL,
  checkout_at TEXT,
  source TEXT NOT NULL DEFAULT 'qr',
  notes TEXT,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (driver_id) REFERENCES drivers(id),
  FOREIGN KEY (establishment_id) REFERENCES establishments(id),
  FOREIGN KEY (base_id) REFERENCES bases(id),
  FOREIGN KEY (schedule_id) REFERENCES schedules(id),
  FOREIGN KEY (contract_id) REFERENCES contracts(id)
);
CREATE INDEX IF NOT EXISTS idx_presence_driver_open ON presence_sessions(driver_id, checkout_at, checkin_at DESC);
CREATE INDEX IF NOT EXISTS idx_presence_scope ON presence_sessions(cooperative_id, checkin_at DESC);

CREATE TABLE IF NOT EXISTS integration_connectors (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  establishment_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'inbound' CHECK(mode IN ('inbound','pull')),
  base_url TEXT,
  orders_path TEXT,
  auth_type TEXT NOT NULL DEFAULT 'bearer' CHECK(auth_type IN ('none','bearer','header')),
  auth_header TEXT,
  encrypted_secret TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','error')),
  last_sync_at TEXT,
  last_error TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (establishment_id) REFERENCES establishments(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_connectors_sync ON integration_connectors(status, mode, last_sync_at);

CREATE TABLE IF NOT EXISTS driver_route_plans (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','cancelled')),
  distance_meters INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  geometry TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (driver_id) REFERENCES drivers(id)
);

CREATE TABLE IF NOT EXISTS driver_route_plan_stops (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  stop_order INTEGER NOT NULL,
  stop_type TEXT NOT NULL CHECK(stop_type IN ('pickup','delivery')),
  address TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  completed_at TEXT,
  FOREIGN KEY (plan_id) REFERENCES driver_route_plans(id) ON DELETE CASCADE,
  FOREIGN KEY (delivery_id) REFERENCES deliveries(id)
);
CREATE INDEX IF NOT EXISTS idx_route_stops_plan ON driver_route_plan_stops(plan_id, stop_order);
