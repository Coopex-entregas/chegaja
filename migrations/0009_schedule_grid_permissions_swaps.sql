PRAGMA foreign_keys = ON;

ALTER TABLE shift_templates ADD COLUMN contract_id TEXT REFERENCES contracts(id);
ALTER TABLE schedules ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE schedules ADD COLUMN conflict_flag INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_shift_templates_contract
  ON shift_templates(cooperative_id, contract_id, active, start_time);
CREATE INDEX IF NOT EXISTS idx_schedules_print
  ON schedules(cooperative_id, start_at, sort_order, driver_id);

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id TEXT NOT NULL,
  cooperative_id TEXT NOT NULL,
  module_key TEXT NOT NULL,
  can_view INTEGER NOT NULL DEFAULT 0,
  can_create INTEGER NOT NULL DEFAULT 0,
  can_edit INTEGER NOT NULL DEFAULT 0,
  can_delete INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, module_key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_permissions_scope
  ON user_permissions(cooperative_id, user_id, module_key);

CREATE TABLE IF NOT EXISTS schedule_swap_requests (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  source_schedule_id TEXT NOT NULL,
  target_schedule_id TEXT NOT NULL,
  requested_by_driver_id TEXT NOT NULL,
  requested_to_driver_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','cancelled')),
  message TEXT,
  responded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (source_schedule_id) REFERENCES schedules(id),
  FOREIGN KEY (target_schedule_id) REFERENCES schedules(id),
  FOREIGN KEY (requested_by_driver_id) REFERENCES drivers(id),
  FOREIGN KEY (requested_to_driver_id) REFERENCES drivers(id)
);
CREATE INDEX IF NOT EXISTS idx_schedule_swap_requester
  ON schedule_swap_requests(requested_by_driver_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_schedule_swap_target
  ON schedule_swap_requests(requested_to_driver_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_swap_pending_pair
  ON schedule_swap_requests(source_schedule_id, target_schedule_id)
  WHERE status='pending';
