ALTER TABLE deliveries ADD COLUMN amount_to_collect_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customer_requests ADD COLUMN amount_to_collect_cents INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_waiting_queue_location_status_order ON waiting_queue(cooperative_id,base_id,establishment_id,status,queue_order,arrived_at);
CREATE INDEX IF NOT EXISTS idx_deliveries_active_location_driver ON deliveries(cooperative_id,base_id,establishment_id,status,assigned_driver_id,updated_at);
