PRAGMA foreign_keys = ON;

-- Índices para GPS, mapas, rastreio e SOS com grande volume de usuários.
CREATE INDEX IF NOT EXISTS idx_drivers_live_cooperative
  ON drivers(cooperative_id, online, status, last_seen_at, deleted_at);

CREATE INDEX IF NOT EXISTS idx_drivers_live_location
  ON drivers(cooperative_id, location_updated_at, current_lat, current_lng);

CREATE INDEX IF NOT EXISTS idx_driver_locations_driver_time
  ON driver_locations(driver_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_deliveries_driver_active
  ON deliveries(assigned_driver_id, status, deleted_at, updated_at);

CREATE INDEX IF NOT EXISTS idx_deliveries_tracking_token_fast
  ON deliveries(tracking_token, deleted_at, status);

CREATE INDEX IF NOT EXISTS idx_deliveries_approach_fast
  ON deliveries(assigned_driver_id, status, approach_alert_sent_at, deleted_at);

CREATE INDEX IF NOT EXISTS idx_notification_events_coop_cursor
  ON notification_events(cooperative_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_notification_events_driver_cursor
  ON notification_events(driver_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_delivery_sos_active_fast
  ON delivery_sos(cooperative_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_driver_sos_active_fast
  ON driver_sos_alerts(cooperative_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_schedules_driver_today_fast
  ON schedules(driver_id, status, start_at, deleted_at);

CREATE INDEX IF NOT EXISTS idx_waiting_queue_driver_status_fast
  ON waiting_queue(driver_id, status, updated_at);
