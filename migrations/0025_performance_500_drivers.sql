CREATE INDEX IF NOT EXISTS idx_schedules_driver_day_status
ON schedules(cooperative_id,driver_id,status,start_at,base_id,establishment_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_driver_permissions_day
ON establishment_driver_permissions(cooperative_id,driver_id,service_date,active,establishment_id);

CREATE INDEX IF NOT EXISTS idx_waiting_queue_driver_status
ON waiting_queue(driver_id,status,arrived_at DESC);

CREATE INDEX IF NOT EXISTS idx_drivers_online_fresh
ON drivers(cooperative_id,online,status,last_seen_at)
WHERE deleted_at IS NULL;
