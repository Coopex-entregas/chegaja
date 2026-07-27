PRAGMA foreign_keys = ON;

ALTER TABLE checkins ADD COLUMN schedule_id TEXT REFERENCES schedules(id);
ALTER TABLE checkins ADD COLUMN contract_id TEXT REFERENCES contracts(id);
ALTER TABLE checkins ADD COLUMN checked_out_at TEXT;
ALTER TABLE checkins ADD COLUMN checkout_latitude REAL;
ALTER TABLE checkins ADD COLUMN checkout_longitude REAL;
ALTER TABLE checkins ADD COLUMN checkout_source TEXT;
ALTER TABLE checkins ADD COLUMN notes TEXT;

CREATE INDEX IF NOT EXISTS idx_checkins_driver_open ON checkins(driver_id, checked_out_at, checked_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkins_establishment_time ON checkins(establishment_id, checked_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkins_schedule ON checkins(schedule_id);
