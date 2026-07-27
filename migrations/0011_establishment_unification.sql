PRAGMA foreign_keys = ON;

-- Contrato e estabelecimento passam a ser a mesma entidade operacional.
-- As tabelas antigas permanecem apenas para compatibilidade histórica.
ALTER TABLE shift_templates ADD COLUMN establishment_id TEXT REFERENCES establishments(id);

UPDATE shift_templates
SET establishment_id = (
  SELECT c.establishment_id FROM contracts c WHERE c.id = shift_templates.contract_id
)
WHERE establishment_id IS NULL AND contract_id IS NOT NULL;

UPDATE schedules
SET establishment_id = COALESCE(
      establishment_id,
      (SELECT c.establishment_id FROM contracts c WHERE c.id = schedules.contract_id)
    ),
    contract_id = NULL
WHERE contract_id IS NOT NULL;

UPDATE deliveries
SET establishment_id = COALESCE(
      establishment_id,
      (SELECT c.establishment_id FROM contracts c WHERE c.id = deliveries.contract_id)
    ),
    contract_id = NULL
WHERE contract_id IS NOT NULL;

UPDATE shift_templates SET contract_id = NULL WHERE contract_id IS NOT NULL;

DELETE FROM user_permissions WHERE module_key IN ('contracts','prices');

CREATE INDEX IF NOT EXISTS idx_shift_templates_establishment
  ON shift_templates(cooperative_id, establishment_id, active, start_time);
CREATE INDEX IF NOT EXISTS idx_schedules_establishment_date
  ON schedules(cooperative_id, establishment_id, start_at, status);
