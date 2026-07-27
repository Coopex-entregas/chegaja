PRAGMA foreign_keys = ON;

-- O garantido pertence ao horário cadastrado, e não ao dia da semana.
-- Cada horário do estabelecimento tem seu próprio valor mínimo.
ALTER TABLE shift_templates ADD COLUMN guaranteed_cents INTEGER NOT NULL DEFAULT 0 CHECK(guaranteed_cents >= 0);

CREATE INDEX IF NOT EXISTS idx_shift_templates_guarantee
  ON shift_templates(cooperative_id,establishment_id,contract_id,active,guaranteed_cents);

-- Migração conservadora dos valores da versão anterior:
-- só replica o garantido diário quando o estabelecimento tinha um único valor
-- não-zero para todos os dias. Se existiam valores diferentes, o sistema deixa
-- zero para que a cooperativa defina corretamente o garantido de cada horário.
UPDATE shift_templates
SET guaranteed_cents = COALESCE((
  SELECT CASE
    WHEN COUNT(DISTINCT g.guaranteed_cents)=1 THEN MAX(g.guaranteed_cents)
    ELSE 0
  END
  FROM establishment_daily_guarantees g
  WHERE g.establishment_id=shift_templates.establishment_id
    AND g.active=1
    AND g.guaranteed_cents>0
),0)
WHERE establishment_id IS NOT NULL;

-- Contratos ligados a estabelecimento também recebem a migração conservadora.
UPDATE shift_templates
SET guaranteed_cents = COALESCE((
  SELECT CASE
    WHEN COUNT(DISTINCT g.guaranteed_cents)=1 THEN MAX(g.guaranteed_cents)
    ELSE 0
  END
  FROM contracts ct
  JOIN establishment_daily_guarantees g ON g.establishment_id=ct.establishment_id
  WHERE ct.id=shift_templates.contract_id
    AND g.active=1
    AND g.guaranteed_cents>0
),0)
WHERE contract_id IS NOT NULL;

-- A Base nunca usa garantido.
UPDATE shift_templates SET guaranteed_cents=0 WHERE base_id IS NOT NULL;

-- A configuração diária antiga deixa de participar dos cálculos.
UPDATE establishment_daily_guarantees SET active=0,updated_at=CURRENT_TIMESTAMP WHERE active=1;

-- Preenche rascunhos e escalas futuras que ainda estavam sem garantido.
UPDATE schedule_week_rows
SET guaranteed_cents=COALESCE((
  SELECT st.guaranteed_cents FROM shift_templates st
  WHERE st.id=schedule_week_rows.shift_template_id
),0),updated_at=CURRENT_TIMESTAMP
WHERE shift_template_id IS NOT NULL AND COALESCE(guaranteed_cents,0)=0;

UPDATE schedules
SET guaranteed_cents=COALESCE((
  SELECT st.guaranteed_cents FROM shift_templates st
  WHERE st.id=schedules.shift_template_id
),0),updated_at=CURRENT_TIMESTAMP
WHERE shift_template_id IS NOT NULL
  AND COALESCE(guaranteed_cents,0)=0
  AND datetime(start_at)>=datetime('now','-1 day');

CREATE INDEX IF NOT EXISTS idx_deliveries_guarantee_schedule
  ON deliveries(cooperative_id,guarantee_schedule_id,status,deleted_at);
