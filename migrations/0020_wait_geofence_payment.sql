ALTER TABLE delivery_wait_sessions ADD COLUMN start_lat REAL;
ALTER TABLE delivery_wait_sessions ADD COLUMN start_lng REAL;
ALTER TABLE delivery_wait_sessions ADD COLUMN end_lat REAL;
ALTER TABLE delivery_wait_sessions ADD COLUMN end_lng REAL;
ALTER TABLE delivery_wait_sessions ADD COLUMN end_reason TEXT;

UPDATE bases
SET pickup_free_seconds=300
WHERE pickup_free_seconds IS NULL OR pickup_free_seconds=900;

UPDATE bases
SET delivery_free_seconds=300
WHERE delivery_free_seconds IS NULL OR delivery_free_seconds=900;
