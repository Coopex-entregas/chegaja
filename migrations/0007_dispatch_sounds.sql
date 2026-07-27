PRAGMA foreign_keys = ON;

ALTER TABLE deliveries ADD COLUMN assigned_by_role TEXT;
ALTER TABLE deliveries ADD COLUMN assigned_by_user_id TEXT;
ALTER TABLE deliveries ADD COLUMN assignment_source TEXT;

CREATE TABLE IF NOT EXISTS notification_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  cooperative_id TEXT NOT NULL,
  establishment_id TEXT,
  driver_id TEXT,
  delivery_id TEXT,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (establishment_id) REFERENCES establishments(id),
  FOREIGN KEY (driver_id) REFERENCES drivers(id),
  FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_notification_events_coop ON notification_events(cooperative_id, seq);
CREATE INDEX IF NOT EXISTS idx_notification_events_est ON notification_events(establishment_id, seq);
CREATE INDEX IF NOT EXISTS idx_notification_events_driver ON notification_events(driver_id, seq);

CREATE TRIGGER IF NOT EXISTS trg_delivery_created_notification
AFTER INSERT ON deliveries
BEGIN
  INSERT INTO notification_events (
    id, cooperative_id, establishment_id, driver_id, delivery_id, event_type, title, message
  ) VALUES (
    lower(hex(randomblob(16))), NEW.cooperative_id, NEW.establishment_id, NEW.assigned_driver_id, NEW.id,
    CASE WHEN NEW.delivery_type='base' THEN 'base_order_created' ELSE 'counter_order_created' END,
    CASE WHEN NEW.delivery_type='base' THEN 'Nova entrega da Base' ELSE 'Nova entrega de balcão' END,
    COALESCE(NEW.display_code,'Nova entrega') || ' • ' || COALESCE(NEW.delivery_address,'')
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_delivery_assigned_notification
AFTER UPDATE OF assigned_driver_id ON deliveries
WHEN NEW.assigned_driver_id IS NOT NULL AND (OLD.assigned_driver_id IS NULL OR OLD.assigned_driver_id != NEW.assigned_driver_id)
BEGIN
  INSERT INTO notification_events (
    id, cooperative_id, establishment_id, driver_id, delivery_id, event_type, title, message
  ) VALUES (
    lower(hex(randomblob(16))), NEW.cooperative_id, NEW.establishment_id, NEW.assigned_driver_id, NEW.id,
    'delivery_assigned', 'Nova entrega atribuída', COALESCE(NEW.display_code,'Entrega') || ' foi atribuída a você.'
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_delivery_status_notification
AFTER UPDATE OF status ON deliveries
WHEN OLD.status != NEW.status
BEGIN
  INSERT INTO notification_events (
    id, cooperative_id, establishment_id, driver_id, delivery_id, event_type, title, message
  ) VALUES (
    lower(hex(randomblob(16))), NEW.cooperative_id, NEW.establishment_id, NEW.assigned_driver_id, NEW.id,
    CASE
      WHEN NEW.status='delivered' THEN 'delivery_completed'
      WHEN NEW.status='accepted' THEN 'delivery_accepted'
      WHEN NEW.status='problem' THEN 'delivery_problem'
      WHEN NEW.status='cancelled' THEN 'delivery_cancelled'
      ELSE 'delivery_status_changed'
    END,
    CASE
      WHEN NEW.status='delivered' THEN 'Entrega finalizada'
      WHEN NEW.status='accepted' THEN 'Entrega aceita'
      WHEN NEW.status='problem' THEN 'Problema na entrega'
      WHEN NEW.status='cancelled' THEN 'Entrega cancelada'
      ELSE 'Entrega atualizada'
    END,
    COALESCE(NEW.display_code,'Entrega') || ' • ' || NEW.status
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_driver_online_notification
AFTER UPDATE OF online ON drivers
WHEN OLD.online != NEW.online
BEGIN
  INSERT INTO notification_events (
    id, cooperative_id, driver_id, event_type, title, message
  ) VALUES (
    lower(hex(randomblob(16))), NEW.cooperative_id, NEW.id,
    CASE WHEN NEW.online=1 THEN 'driver_online' ELSE 'driver_offline' END,
    CASE WHEN NEW.online=1 THEN 'Cooperado online' ELSE 'Cooperado offline' END,
    NEW.name
  );
END;
