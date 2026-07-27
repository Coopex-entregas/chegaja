PRAGMA foreign_keys = ON;

-- Os horários passam a poder pertencer diretamente a uma Base.
-- contract_id e establishment_id já existem e continuam sendo usados para
-- restringir o leque de horários do local selecionado na escala.
ALTER TABLE shift_templates ADD COLUMN base_id TEXT REFERENCES bases(id);

CREATE INDEX IF NOT EXISTS idx_shift_templates_base
  ON shift_templates(cooperative_id, base_id, active, start_time);
