PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS waiting_queue (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  establishment_id TEXT,
  base_id TEXT,
  driver_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','assigned','left','cancelled')),
  source TEXT NOT NULL DEFAULT 'driver_app',
  arrived_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  served_at TEXT,
  left_at TEXT,
  served_delivery_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (establishment_id) REFERENCES establishments(id),
  FOREIGN KEY (base_id) REFERENCES bases(id),
  FOREIGN KEY (driver_id) REFERENCES drivers(id),
  FOREIGN KEY (served_delivery_id) REFERENCES deliveries(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_waiting_queue_driver_active
  ON waiting_queue(driver_id) WHERE status='waiting';
CREATE INDEX IF NOT EXISTS idx_waiting_queue_location
  ON waiting_queue(cooperative_id,establishment_id,base_id,status,arrived_at);

CREATE TABLE IF NOT EXISTS cooperative_expenses (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  establishment_id TEXT,
  base_id TEXT,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
  reference_date TEXT NOT NULL,
  attachment_url TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (establishment_id) REFERENCES establishments(id),
  FOREIGN KEY (base_id) REFERENCES bases(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_cooperative_expenses_period
  ON cooperative_expenses(cooperative_id,reference_date,status);
CREATE INDEX IF NOT EXISTS idx_cooperative_expenses_location
  ON cooperative_expenses(establishment_id,base_id,reference_date);
