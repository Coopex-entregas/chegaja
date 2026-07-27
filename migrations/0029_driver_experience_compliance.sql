PRAGMA foreign_keys = ON;

ALTER TABLE cooperatives ADD COLUMN support_email TEXT;
ALTER TABLE cooperatives ADD COLUMN driver_compliance_required INTEGER NOT NULL DEFAULT 0;

ALTER TABLE drivers ADD COLUMN photo_url TEXT;
ALTER TABLE drivers ADD COLUMN cnh_number TEXT;
ALTER TABLE drivers ADD COLUMN cnh_expires_at TEXT;
ALTER TABLE drivers ADD COLUMN vehicle_document_number TEXT;
ALTER TABLE drivers ADD COLUMN vehicle_document_expires_at TEXT;
ALTER TABLE drivers ADD COLUMN compliance_status TEXT NOT NULL DEFAULT 'not_required';
ALTER TABLE drivers ADD COLUMN compliance_suspended INTEGER NOT NULL DEFAULT 0;
ALTER TABLE drivers ADD COLUMN compliance_override_until TEXT;
ALTER TABLE drivers ADD COLUMN compliance_override_reason TEXT;
ALTER TABLE drivers ADD COLUMN compliance_reviewed_at TEXT;
ALTER TABLE drivers ADD COLUMN compliance_reviewed_by TEXT;

CREATE TABLE IF NOT EXISTS driver_photo_requests (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
  current_photo_url TEXT,
  reviewed_by TEXT,
  review_notes TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY(driver_id) REFERENCES drivers(id),
  FOREIGN KEY(reviewed_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_driver_photo_requests_review ON driver_photo_requests(cooperative_id,status,created_at);

CREATE TABLE IF NOT EXISTS driver_document_submissions (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  cnh_number TEXT NOT NULL,
  cnh_expires_at TEXT NOT NULL,
  vehicle_document_number TEXT NOT NULL,
  vehicle_document_expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
  reviewed_by TEXT,
  review_notes TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY(driver_id) REFERENCES drivers(id),
  FOREIGN KEY(reviewed_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_driver_documents_review ON driver_document_submissions(cooperative_id,status,created_at);

CREATE TABLE IF NOT EXISTS support_requests (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  driver_id TEXT,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','answered','closed')),
  response TEXT,
  responded_by TEXT,
  responded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(driver_id) REFERENCES drivers(id),
  FOREIGN KEY(responded_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_support_requests_driver ON support_requests(driver_id,created_at);
CREATE INDEX IF NOT EXISTS idx_support_requests_cooperative ON support_requests(cooperative_id,status,created_at);

CREATE INDEX IF NOT EXISTS idx_drivers_compliance ON drivers(cooperative_id,compliance_status,compliance_suspended);
