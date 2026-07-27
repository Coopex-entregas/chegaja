PRAGMA foreign_keys = ON;

ALTER TABLE bases ADD COLUMN checkin_radius_meters INTEGER NOT NULL DEFAULT 250;
ALTER TABLE waiting_queue ADD COLUMN arrival_lat REAL;
ALTER TABLE waiting_queue ADD COLUMN arrival_lng REAL;
ALTER TABLE waiting_queue ADD COLUMN distance_meters INTEGER;
ALTER TABLE waiting_queue ADD COLUMN location_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE waiting_queue ADD COLUMN presence_session_id TEXT REFERENCES presence_sessions(id);

ALTER TABLE financial_entries ADD COLUMN settled_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE financial_entries ADD COLUMN deduction_order INTEGER;

CREATE INDEX IF NOT EXISTS idx_financial_driver_open_order
  ON financial_entries(cooperative_id,driver_id,status,reference_date,created_at);
CREATE INDEX IF NOT EXISTS idx_queue_base_verified
  ON waiting_queue(base_id,status,location_verified,arrived_at);
