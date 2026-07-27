PRAGMA foreign_keys = ON;

-- Regras gerais de precificação e espera configuráveis por Base.
ALTER TABLE bases ADD COLUMN fuel_km_per_liter REAL NOT NULL DEFAULT 35;
ALTER TABLE bases ADD COLUMN fuel_price_cents INTEGER NOT NULL DEFAULT 600;
ALTER TABLE bases ADD COLUMN displacement_rate_cents_per_km INTEGER NOT NULL DEFAULT 20;
ALTER TABLE bases ADD COLUMN return_percent REAL NOT NULL DEFAULT 50;
ALTER TABLE bases ADD COLUMN cancellation_displacement_multiplier REAL NOT NULL DEFAULT 2;
ALTER TABLE bases ADD COLUMN pickup_free_seconds INTEGER NOT NULL DEFAULT 900;
ALTER TABLE bases ADD COLUMN delivery_free_seconds INTEGER NOT NULL DEFAULT 900;
ALTER TABLE bases ADD COLUMN wait_cents_per_15m INTEGER NOT NULL DEFAULT 500;

-- Cada serviço pode substituir a tolerância e o valor de espera da Base.
ALTER TABLE services ADD COLUMN free_wait_seconds INTEGER NOT NULL DEFAULT 900;
ALTER TABLE services ADD COLUMN wait_cents_per_15m INTEGER NOT NULL DEFAULT 500;
ALTER TABLE services ADD COLUMN wait_tracking_enabled INTEGER NOT NULL DEFAULT 1;

-- Foto financeira e operacional da entrega.
ALTER TABLE deliveries ADD COLUMN launched_by_user_id TEXT REFERENCES users(id);
ALTER TABLE deliveries ADD COLUMN launched_by_name TEXT;
ALTER TABLE deliveries ADD COLUMN customer_mode TEXT NOT NULL DEFAULT 'guest' CHECK(customer_mode IN ('registered','guest'));
ALTER TABLE deliveries ADD COLUMN base_charge_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN route_charge_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN displacement_distance_meters INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN displacement_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN return_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN return_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN service_charge_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN wait_charge_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN cancellation_charge_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN paid_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN outstanding_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN wait_free_seconds INTEGER NOT NULL DEFAULT 900;
ALTER TABLE deliveries ADD COLUMN wait_rate_cents_per_15m INTEGER NOT NULL DEFAULT 500;

UPDATE deliveries
SET launched_by_user_id=COALESCE(launched_by_user_id,created_by),
    launched_by_name=COALESCE(launched_by_name,(SELECT u.name FROM users u WHERE u.id=deliveries.created_by)),
    customer_mode=CASE WHEN customer_id IS NULL THEN 'guest' ELSE 'registered' END,
    base_charge_cents=CASE WHEN base_charge_cents=0 THEN MAX(0,charge_cents-COALESCE(wait_charge_cents,0)) ELSE base_charge_cents END,
    route_charge_cents=CASE WHEN route_charge_cents=0 THEN MAX(0,charge_cents-COALESCE(services_cents,0)) ELSE route_charge_cents END,
    service_charge_cents=CASE WHEN service_charge_cents=0 THEN COALESCE(services_cents,0) ELSE service_charge_cents END,
    paid_cents=CASE WHEN payment_status='paid' AND paid_cents=0 THEN charge_cents ELSE paid_cents END,
    outstanding_cents=MAX(0,charge_cents-CASE WHEN payment_status='paid' THEN charge_cents ELSE paid_cents END);

-- Atendentes que podem operar a Base. O acesso continua sendo um usuário do perfil Operador.
CREATE TABLE IF NOT EXISTS base_attendants (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  base_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (base_id) REFERENCES bases(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id),
  UNIQUE(base_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_base_attendants_scope ON base_attendants(cooperative_id,base_id,active);

-- Cronômetro por etapa. O valor é calculado por segundo após a tolerância.
CREATE TABLE IF NOT EXISTS delivery_wait_sessions (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL,
  cooperative_id TEXT NOT NULL,
  base_id TEXT,
  driver_id TEXT NOT NULL,
  stage TEXT NOT NULL CHECK(stage IN ('pickup','delivery','service')),
  free_seconds INTEGER NOT NULL DEFAULT 900,
  rate_cents_per_15m INTEGER NOT NULL DEFAULT 500,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TEXT,
  elapsed_seconds INTEGER NOT NULL DEFAULT 0,
  billed_seconds INTEGER NOT NULL DEFAULT 0,
  charge_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','ended','cancelled')),
  started_by TEXT NOT NULL,
  ended_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (base_id) REFERENCES bases(id),
  FOREIGN KEY (driver_id) REFERENCES drivers(id),
  FOREIGN KEY (started_by) REFERENCES users(id),
  FOREIGN KEY (ended_by) REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_wait_one_active ON delivery_wait_sessions(delivery_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS idx_delivery_wait_delivery ON delivery_wait_sessions(delivery_id,created_at DESC);
