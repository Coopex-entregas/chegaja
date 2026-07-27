-- Rapidim 12.3 — ordem manual da fila de espera
ALTER TABLE waiting_queue ADD COLUMN queue_order INTEGER NOT NULL DEFAULT 0;

UPDATE waiting_queue
SET queue_order = CAST(strftime('%s', arrived_at) AS INTEGER)
WHERE queue_order = 0;

CREATE INDEX IF NOT EXISTS idx_waiting_queue_location_order
ON waiting_queue(cooperative_id,base_id,establishment_id,status,queue_order,arrived_at);
