PRAGMA foreign_keys = ON;

-- Distribuição automática configurável por Base.
ALTER TABLE bases ADD COLUMN auto_dispatch_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bases ADD COLUMN auto_dispatch_response_seconds INTEGER NOT NULL DEFAULT 25;
ALTER TABLE bases ADD COLUMN auto_dispatch_max_active INTEGER NOT NULL DEFAULT 3;

-- Tentativas individuais permitem aceite/recusa com motivo e passagem automática
-- para o próximo cooperado elegível.
CREATE TABLE IF NOT EXISTS delivery_offer_attempts (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  base_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','expired','cancelled')),
  rejection_reason TEXT,
  distance_to_pickup_meters INTEGER NOT NULL DEFAULT 0,
  active_deliveries INTEGER NOT NULL DEFAULT 0,
  deliveries_today INTEGER NOT NULL DEFAULT 0,
  score REAL NOT NULL DEFAULT 0,
  offered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  responded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (base_id) REFERENCES bases(id),
  FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE,
  FOREIGN KEY (driver_id) REFERENCES drivers(id)
);
CREATE INDEX IF NOT EXISTS idx_offer_attempt_delivery ON delivery_offer_attempts(delivery_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_offer_attempt_driver ON delivery_offer_attempts(driver_id,status,expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_offer_attempt_one_pending_delivery
  ON delivery_offer_attempts(delivery_id) WHERE status='pending';

-- Registro auditável dos pagamentos adicionais, incluindo espera excedente.
CREATE TABLE IF NOT EXISTS delivery_payments (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  customer_id TEXT,
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  payment_method TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'external' CHECK(source IN ('external','credit')),
  notes TEXT,
  proof_url TEXT,
  received_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (received_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_delivery_payments_delivery ON delivery_payments(delivery_id,created_at DESC);
