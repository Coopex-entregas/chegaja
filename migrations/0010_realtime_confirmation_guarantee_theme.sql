PRAGMA foreign_keys = ON;

ALTER TABLE establishments ADD COLUMN confirmation_mode TEXT NOT NULL DEFAULT 'required' CHECK(confirmation_mode IN ('required','optional','disabled'));
ALTER TABLE establishments ADD COLUMN driver_map_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE establishments ADD COLUMN customer_chat_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE establishments ADD COLUMN driver_call_enabled INTEGER NOT NULL DEFAULT 0;

ALTER TABLE bases ADD COLUMN confirmation_mode TEXT NOT NULL DEFAULT 'required' CHECK(confirmation_mode IN ('required','optional','disabled'));
ALTER TABLE bases ADD COLUMN customer_chat_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE bases ADD COLUMN driver_call_enabled INTEGER NOT NULL DEFAULT 0;

ALTER TABLE deliveries ADD COLUMN confirmation_required INTEGER NOT NULL DEFAULT 1;
ALTER TABLE deliveries ADD COLUMN finish_without_code_authorized INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN finish_without_code_authorized_by TEXT;
ALTER TABLE deliveries ADD COLUMN finish_without_code_authorized_at TEXT;
ALTER TABLE deliveries ADD COLUMN approach_alert_sent_at TEXT;
ALTER TABLE deliveries ADD COLUMN customer_chat_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE deliveries ADD COLUMN driver_call_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN guarantee_schedule_id TEXT REFERENCES schedules(id);
ALTER TABLE deliveries ADD COLUMN unassigned_at TEXT;

CREATE TABLE IF NOT EXISTS guarantee_settlements (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  schedule_id TEXT NOT NULL UNIQUE,
  driver_id TEXT NOT NULL,
  establishment_id TEXT,
  base_id TEXT,
  guaranteed_cents INTEGER NOT NULL DEFAULT 0,
  eligible_delivery_cents INTEGER NOT NULL DEFAULT 0,
  complement_cents INTEGER NOT NULL DEFAULT 0,
  financial_entry_id TEXT,
  settled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (schedule_id) REFERENCES schedules(id),
  FOREIGN KEY (driver_id) REFERENCES drivers(id),
  FOREIGN KEY (establishment_id) REFERENCES establishments(id),
  FOREIGN KEY (base_id) REFERENCES bases(id),
  FOREIGN KEY (financial_entry_id) REFERENCES financial_entries(id)
);
CREATE INDEX IF NOT EXISTS idx_guarantee_settlement_scope ON guarantee_settlements(cooperative_id,driver_id,settled_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_delivery_message_notification
AFTER INSERT ON delivery_messages
BEGIN
  INSERT INTO notification_events(id,cooperative_id,establishment_id,driver_id,delivery_id,event_type,title,message)
  SELECT lower(hex(randomblob(16))), NEW.cooperative_id, d.establishment_id, d.assigned_driver_id, NEW.delivery_id,
    'delivery_message', 'Nova mensagem', substr(NEW.sender_name || ': ' || NEW.message,1,240)
  FROM deliveries d WHERE d.id=NEW.delivery_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_delivery_unassigned_notification
AFTER UPDATE OF assigned_driver_id ON deliveries
WHEN OLD.assigned_driver_id IS NOT NULL AND NEW.assigned_driver_id IS NULL
BEGIN
  INSERT INTO notification_events(id,cooperative_id,establishment_id,driver_id,delivery_id,event_type,title,message)
  VALUES(lower(hex(randomblob(16))),NEW.cooperative_id,NEW.establishment_id,OLD.assigned_driver_id,NEW.id,
    'delivery_unassigned','Entrega retirada',COALESCE(NEW.display_code,'Entrega') || ' voltou para a fila.');
END;
