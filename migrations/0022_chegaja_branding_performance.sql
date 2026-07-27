ALTER TABLE cooperatives ADD COLUMN login_title TEXT DEFAULT 'Bem-vindo ao ChegaJá';
ALTER TABLE cooperatives ADD COLUMN login_subtitle TEXT DEFAULT 'Entregas simples, rápidas e acompanhadas em tempo real.';
ALTER TABLE cooperatives ADD COLUMN login_footer_text TEXT DEFAULT 'Tecnologia para cooperativas, clientes e cooperados.';
ALTER TABLE deliveries ADD COLUMN actual_displacement_distance_meters INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN actual_displacement_cents INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_deliveries_driver_active_fast ON deliveries(assigned_driver_id,status,updated_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_deliveries_coop_type_status_fast ON deliveries(cooperative_id,delivery_type,status,created_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_deliveries_tracking_fast ON deliveries(tracking_token) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_waiting_queue_location_order_fast ON waiting_queue(cooperative_id,base_id,establishment_id,status,queue_order,arrived_at);
CREATE INDEX IF NOT EXISTS idx_customer_requests_customer_fast ON customer_requests(customer_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_financial_driver_open_fast ON financial_entries(driver_id,status,entry_type,reference_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_driver_cursor_fast ON notification_events(driver_id,seq);
UPDATE cooperatives SET primary_color='#0D257A' WHERE lower(primary_color) IN ('#7a1538','#721536','#8f2349','#4c0c23');
