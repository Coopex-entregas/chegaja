CREATE TABLE IF NOT EXISTS branding_assets (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  data_base64 TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_branding_assets_entity ON branding_assets(entity_type, entity_id);
ALTER TABLE delivery_sos ADD COLUMN silenced_until TEXT;
ALTER TABLE driver_sos_alerts ADD COLUMN silenced_until TEXT;
