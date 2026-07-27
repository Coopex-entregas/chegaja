-- ChegaJá 13.1 — SOS independente de entrega e melhorias do aplicativo.
CREATE TABLE IF NOT EXISTS driver_sos_alerts (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  base_id TEXT,
  driver_id TEXT NOT NULL,
  driver_name TEXT NOT NULL,
  occurrence TEXT NOT NULL,
  emergency_service TEXT,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  accuracy REAL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','resolved')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  resolved_by TEXT,
  helper_name TEXT,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (base_id) REFERENCES bases(id),
  FOREIGN KEY (driver_id) REFERENCES drivers(id),
  FOREIGN KEY (resolved_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_driver_sos_alerts_active
  ON driver_sos_alerts(cooperative_id,status,created_at DESC);
