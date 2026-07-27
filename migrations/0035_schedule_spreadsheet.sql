PRAGMA foreign_keys = ON;

-- Grade de escala estilo planilha: 14 linhas padrão por cooperado, linhas extras,
-- filtros, Base/Contrato/Estabelecimento e salvamento automático por linha.
CREATE TABLE IF NOT EXISTS schedule_week_rows (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  week_start TEXT NOT NULL,
  group_driver_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  day_index INTEGER NOT NULL CHECK(day_index BETWEEN 0 AND 6),
  row_order INTEGER NOT NULL DEFAULT 1,
  turn_label TEXT NOT NULL DEFAULT 'DIA',
  entry_type TEXT NOT NULL DEFAULT 'day_off' CHECK(entry_type IN ('work','day_off','leave')),
  assignment_type TEXT NOT NULL DEFAULT 'day_off' CHECK(assignment_type IN ('contract','base','establishment','day_off','leave')),
  contract_id TEXT,
  base_id TEXT,
  establishment_id TEXT,
  shift_template_id TEXT,
  start_time TEXT,
  end_time TEXT,
  shift_label TEXT,
  guaranteed_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  is_default INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  leave_auto INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY(group_driver_id) REFERENCES drivers(id),
  FOREIGN KEY(driver_id) REFERENCES drivers(id),
  FOREIGN KEY(contract_id) REFERENCES contracts(id),
  FOREIGN KEY(base_id) REFERENCES bases(id),
  FOREIGN KEY(establishment_id) REFERENCES establishments(id),
  FOREIGN KEY(shift_template_id) REFERENCES shift_templates(id),
  FOREIGN KEY(created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_schedule_week_rows_week
  ON schedule_week_rows(cooperative_id, week_start, active, group_driver_id, day_index, row_order);
CREATE INDEX IF NOT EXISTS idx_schedule_week_rows_driver
  ON schedule_week_rows(cooperative_id, week_start, driver_id, day_index, start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_schedule_week_rows_assignment
  ON schedule_week_rows(cooperative_id, week_start, assignment_type, contract_id, base_id, establishment_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_week_rows_default_slot
  ON schedule_week_rows(cooperative_id,week_start,group_driver_id,day_index,row_order)
  WHERE active=1;

ALTER TABLE schedules ADD COLUMN schedule_row_id TEXT;
CREATE INDEX IF NOT EXISTS idx_schedules_schedule_row
  ON schedules(cooperative_id, publication_week_start, schedule_row_id);
