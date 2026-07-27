PRAGMA foreign_keys = ON;

-- Matrícula cooperativa permanente. O cadastro pode ser desativado e reativado
-- sem perder o mesmo id, matrícula ou histórico financeiro/operacional.
ALTER TABLE drivers ADD COLUMN membership_number TEXT;
ALTER TABLE drivers ADD COLUMN membership_sequence INTEGER;
ALTER TABLE drivers ADD COLUMN membership_year INTEGER;
ALTER TABLE drivers ADD COLUMN joined_at TEXT;
ALTER TABLE drivers ADD COLUMN left_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_drivers_membership_number
  ON drivers(cooperative_id, membership_number)
  WHERE membership_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_drivers_membership_sequence
  ON drivers(cooperative_id, membership_year, membership_sequence);

CREATE UNIQUE INDEX IF NOT EXISTS idx_drivers_membership_sequence_unique
  ON drivers(cooperative_id, membership_sequence)
  WHERE membership_sequence IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_drivers_status_history
  ON drivers(cooperative_id, status, left_at, name);

-- Configuração global do provedor de mapas é gravada na tabela settings já
-- existente. As chaves são salvas criptografadas pelo backend.
INSERT OR IGNORE INTO settings(key,value) VALUES ('maps_provider','auto');
INSERT OR IGNORE INTO settings(key,value) VALUES ('google_maps_map_id','DEMO_MAP_ID');
