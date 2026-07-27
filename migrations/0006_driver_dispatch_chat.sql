PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS establishment_driver_permissions (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  establishment_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  service_date TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  added_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (establishment_id) REFERENCES establishments(id),
  FOREIGN KEY (driver_id) REFERENCES drivers(id),
  FOREIGN KEY (added_by) REFERENCES users(id),
  UNIQUE(establishment_id, driver_id, service_date)
);
CREATE INDEX IF NOT EXISTS idx_est_driver_permissions_day
  ON establishment_driver_permissions(cooperative_id, establishment_id, service_date, active);

CREATE TABLE IF NOT EXISTS delivery_messages (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL,
  cooperative_id TEXT NOT NULL,
  sender_type TEXT NOT NULL CHECK(sender_type IN ('driver','customer','establishment','cooperative')),
  sender_user_id TEXT,
  sender_customer_id TEXT,
  sender_name TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (sender_user_id) REFERENCES users(id),
  FOREIGN KEY (sender_customer_id) REFERENCES customers(id)
);
CREATE INDEX IF NOT EXISTS idx_delivery_messages_delivery
  ON delivery_messages(delivery_id, created_at);
