-- ChegaJá 14.1 — fluxo de ajuda do SOS e índices para edição operacional.
ALTER TABLE delivery_sos ADD COLUMN helper_user_id TEXT;
ALTER TABLE delivery_sos ADD COLUMN helper_driver_id TEXT;
ALTER TABLE delivery_sos ADD COLUMN helper_name TEXT;
ALTER TABLE delivery_sos ADD COLUMN acknowledged_at TEXT;
ALTER TABLE delivery_sos ADD COLUMN silenced_at TEXT;

ALTER TABLE driver_sos_alerts ADD COLUMN helper_user_id TEXT;
ALTER TABLE driver_sos_alerts ADD COLUMN helper_driver_id TEXT;
ALTER TABLE driver_sos_alerts ADD COLUMN acknowledged_at TEXT;
ALTER TABLE driver_sos_alerts ADD COLUMN silenced_at TEXT;

CREATE INDEX IF NOT EXISTS idx_delivery_sos_helper
  ON delivery_sos(cooperative_id,status,helper_driver_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_driver_sos_helper
  ON driver_sos_alerts(cooperative_id,status,helper_driver_id,created_at DESC);
