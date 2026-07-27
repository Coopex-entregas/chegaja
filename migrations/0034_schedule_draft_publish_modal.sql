PRAGMA foreign_keys = ON;

-- A escala da próxima semana é preparada como rascunho e só substitui a escala ativa ao clicar em Enviar escala.
CREATE TABLE IF NOT EXISTS schedule_week_drafts (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  week_start TEXT NOT NULL,
  template_driver_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  day_index INTEGER NOT NULL CHECK(day_index BETWEEN 0 AND 6),
  slot_index INTEGER NOT NULL CHECK(slot_index IN (1,2)),
  entry_type TEXT NOT NULL DEFAULT 'day_off' CHECK(entry_type IN ('work','day_off','leave')),
  contract_id TEXT,
  establishment_id TEXT,
  shift_template_id TEXT,
  start_time TEXT,
  end_time TEXT,
  shift_label TEXT,
  guaranteed_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(cooperative_id, week_start, template_driver_id, day_index, slot_index),
  FOREIGN KEY(cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY(template_driver_id) REFERENCES drivers(id),
  FOREIGN KEY(driver_id) REFERENCES drivers(id),
  FOREIGN KEY(contract_id) REFERENCES contracts(id),
  FOREIGN KEY(establishment_id) REFERENCES establishments(id),
  FOREIGN KEY(shift_template_id) REFERENCES shift_templates(id),
  FOREIGN KEY(created_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_schedule_week_drafts_week
  ON schedule_week_drafts(cooperative_id, week_start, template_driver_id, day_index, slot_index);
CREATE INDEX IF NOT EXISTS idx_schedule_week_drafts_driver
  ON schedule_week_drafts(cooperative_id, week_start, driver_id, entry_type);

CREATE TABLE IF NOT EXISTS schedule_week_publications (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  week_start TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
  published_at TEXT,
  published_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(cooperative_id, week_start),
  FOREIGN KEY(cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY(published_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_schedule_week_publications
  ON schedule_week_publications(cooperative_id, week_start, status);

-- Identifica a linha-base que originou a escala publicada e a semana da publicação.
ALTER TABLE schedules ADD COLUMN template_driver_id TEXT REFERENCES drivers(id);
ALTER TABLE schedules ADD COLUMN publication_week_start TEXT;
CREATE INDEX IF NOT EXISTS idx_schedules_publication_week
  ON schedules(cooperative_id, publication_week_start, template_driver_id, slot_index, start_at);
