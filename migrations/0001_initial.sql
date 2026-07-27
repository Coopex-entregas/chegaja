PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cooperatives (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  legal_name TEXT,
  cnpj TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  logo_url TEXT,
  primary_color TEXT NOT NULL DEFAULT '#7A1538',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','blocked','inactive')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cooperatives_cnpj ON cooperatives(cnpj) WHERE cnpj IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS establishments (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  name TEXT NOT NULL,
  legal_name TEXT,
  cnpj TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  latitude REAL,
  longitude REAL,
  checkin_token TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id)
);
CREATE INDEX IF NOT EXISTS idx_establishments_cooperative ON establishments(cooperative_id, active);

CREATE TABLE IF NOT EXISTS drivers (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  name TEXT NOT NULL,
  cpf TEXT,
  email TEXT,
  phone TEXT,
  vehicle_plate TEXT,
  vehicle_model TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','blocked')),
  online INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT,
  current_lat REAL,
  current_lng REAL,
  location_accuracy REAL,
  location_updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id)
);
CREATE INDEX IF NOT EXISTS idx_drivers_cooperative ON drivers(cooperative_id, status, online);
CREATE UNIQUE INDEX IF NOT EXISTS idx_drivers_cpf ON drivers(cooperative_id, cpf) WHERE cpf IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT,
  establishment_id TEXT,
  driver_id TEXT,
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  username TEXT COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('platform_admin','cooperative_admin','dispatcher','establishment','driver')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','blocked','inactive')),
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (establishment_id) REFERENCES establishments(id),
  FOREIGN KEY (driver_id) REFERENCES drivers(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE username IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_cooperative ON users(cooperative_id, role, status);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_reset_user ON password_reset_tokens(user_id, expires_at);

CREATE TABLE IF NOT EXISTS driver_establishments (
  driver_id TEXT NOT NULL,
  establishment_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (driver_id, establishment_id),
  FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE,
  FOREIGN KEY (establishment_id) REFERENCES establishments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  establishment_id TEXT,
  driver_id TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','confirmed','completed','absent','cancelled')),
  guaranteed_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  recurrence_group_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (establishment_id) REFERENCES establishments(id),
  FOREIGN KEY (driver_id) REFERENCES drivers(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_schedules_period ON schedules(cooperative_id, start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_schedules_driver ON schedules(driver_id, start_at);
CREATE INDEX IF NOT EXISTS idx_schedules_establishment ON schedules(establishment_id, start_at);

CREATE TABLE IF NOT EXISTS price_tables (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  establishment_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  visible_to_driver INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (establishment_id) REFERENCES establishments(id)
);
CREATE INDEX IF NOT EXISTS idx_price_tables_scope ON price_tables(cooperative_id, establishment_id, active);

CREATE TABLE IF NOT EXISTS price_rules (
  id TEXT PRIMARY KEY,
  price_table_id TEXT NOT NULL,
  origin TEXT,
  destination TEXT,
  min_km REAL,
  max_km REAL,
  base_cents INTEGER NOT NULL DEFAULT 0,
  driver_cents INTEGER NOT NULL DEFAULT 0,
  cooperative_cents INTEGER NOT NULL DEFAULT 0,
  day_type TEXT NOT NULL DEFAULT 'all' CHECK(day_type IN ('all','weekday','friday','saturday','sunday','holiday')),
  start_time TEXT,
  end_time TEXT,
  wait_cents_per_15m INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (price_table_id) REFERENCES price_tables(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_price_rules_table ON price_rules(price_table_id, active);

CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  establishment_id TEXT NOT NULL,
  external_id TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  customer_name TEXT,
  customer_phone TEXT,
  pickup_address TEXT NOT NULL,
  pickup_lat REAL,
  pickup_lng REAL,
  delivery_address TEXT NOT NULL,
  delivery_lat REAL,
  delivery_lng REAL,
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','offered','assigned','accepted','to_pickup','at_pickup','picked_up','in_route','delivered','cancelled','problem')),
  charge_cents INTEGER NOT NULL DEFAULT 0,
  driver_earnings_cents INTEGER NOT NULL DEFAULT 0,
  cooperative_fee_cents INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT,
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK(payment_status IN ('pending','paid','cancelled')),
  notes TEXT,
  tracking_token TEXT NOT NULL UNIQUE,
  assigned_driver_id TEXT,
  accepted_at TEXT,
  picked_up_at TEXT,
  delivered_at TEXT,
  cancelled_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (establishment_id) REFERENCES establishments(id),
  FOREIGN KEY (assigned_driver_id) REFERENCES drivers(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_deliveries_external ON deliveries(cooperative_id, source, external_id) WHERE external_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_deliveries_period ON deliveries(cooperative_id, created_at, status);
CREATE INDEX IF NOT EXISTS idx_deliveries_establishment ON deliveries(establishment_id, created_at, status);
CREATE INDEX IF NOT EXISTS idx_deliveries_driver ON deliveries(assigned_driver_id, status, created_at);

CREATE TABLE IF NOT EXISTS delivery_status_history (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL,
  cooperative_id TEXT NOT NULL,
  old_status TEXT,
  new_status TEXT NOT NULL,
  notes TEXT,
  changed_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (changed_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_delivery_history ON delivery_status_history(delivery_id, created_at);

CREATE TABLE IF NOT EXISTS driver_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cooperative_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  delivery_id TEXT,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  accuracy REAL,
  speed REAL,
  heading REAL,
  battery REAL,
  recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (driver_id) REFERENCES drivers(id),
  FOREIGN KEY (delivery_id) REFERENCES deliveries(id)
);
CREATE INDEX IF NOT EXISTS idx_locations_driver_time ON driver_locations(driver_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_locations_delivery_time ON driver_locations(delivery_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS checkins (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  establishment_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  source TEXT NOT NULL DEFAULT 'qr',
  checked_in_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (establishment_id) REFERENCES establishments(id),
  FOREIGN KEY (driver_id) REFERENCES drivers(id)
);
CREATE INDEX IF NOT EXISTS idx_checkins_period ON checkins(cooperative_id, checked_in_at);

CREATE TABLE IF NOT EXISTS financial_entries (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  establishment_id TEXT,
  delivery_id TEXT,
  entry_type TEXT NOT NULL CHECK(entry_type IN ('credit','debit')),
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  reference_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','paid','cancelled')),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (driver_id) REFERENCES drivers(id),
  FOREIGN KEY (establishment_id) REFERENCES establishments(id),
  FOREIGN KEY (delivery_id) REFERENCES deliveries(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_financial_driver_period ON financial_entries(driver_id, reference_date, status);
CREATE INDEX IF NOT EXISTS idx_financial_cooperative_period ON financial_entries(cooperative_id, reference_date, status);

CREATE TABLE IF NOT EXISTS api_clients (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  establishment_id TEXT,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL DEFAULT 'orders:write,orders:read',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  last_used_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (establishment_id) REFERENCES establishments(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_api_clients_scope ON api_clients(cooperative_id, establishment_id, status);

CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  establishment_id TEXT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT 'delivery.created,delivery.updated',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (establishment_id) REFERENCES establishments(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_webhooks_scope ON webhooks(cooperative_id, establishment_id, status);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL,
  event TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','delivered','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered_at TEXT,
  FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_webhook_queue ON webhook_deliveries(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cooperative_id TEXT,
  user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_audit_scope ON audit_logs(cooperative_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at, created_at DESC);
