-- ChegaJá 14.9.1
-- Agendamento de entregas sem adicionar novas colunas na tabela deliveries.
-- A tabela deliveries já está no limite de colunas aceito pelo SQLite/D1.

CREATE TABLE IF NOT EXISTS delivery_schedules (
  delivery_id TEXT PRIMARY KEY REFERENCES deliveries(id) ON DELETE CASCADE,
  scheduled_for TEXT,
  dispatch_mode TEXT NOT NULL DEFAULT 'none' CHECK(dispatch_mode IN ('none','manual','automatic')),
  planned_driver_id TEXT REFERENCES drivers(id),
  dispatch_processed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_delivery_schedules_dispatch
  ON delivery_schedules(scheduled_for,dispatch_mode,dispatch_processed_at);

CREATE INDEX IF NOT EXISTS idx_delivery_schedules_planned_driver
  ON delivery_schedules(planned_driver_id,scheduled_for);
