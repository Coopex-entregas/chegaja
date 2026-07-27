PRAGMA foreign_keys = ON;

-- Dados adicionais dos endereços e confirmação pelo próprio cliente.
ALTER TABLE deliveries ADD COLUMN pickup_apartment TEXT;
ALTER TABLE deliveries ADD COLUMN pickup_complement TEXT;
ALTER TABLE deliveries ADD COLUMN delivery_apartment TEXT;
ALTER TABLE deliveries ADD COLUMN delivery_complement TEXT;
ALTER TABLE deliveries ADD COLUMN customer_confirmed_received_at TEXT;
ALTER TABLE deliveries ADD COLUMN completion_source TEXT;

ALTER TABLE customer_requests ADD COLUMN pickup_apartment TEXT;
ALTER TABLE customer_requests ADD COLUMN pickup_complement TEXT;
ALTER TABLE customer_requests ADD COLUMN delivery_apartment TEXT;
ALTER TABLE customer_requests ADD COLUMN delivery_complement TEXT;

-- Conversas direcionadas entre cliente, estabelecimento/Base, cooperado e cooperativa.
ALTER TABLE delivery_messages ADD COLUMN recipient_type TEXT NOT NULL DEFAULT 'all';
ALTER TABLE delivery_messages ADD COLUMN customer_read_at TEXT;
ALTER TABLE delivery_messages ADD COLUMN driver_read_at TEXT;
ALTER TABLE delivery_messages ADD COLUMN establishment_read_at TEXT;
ALTER TABLE delivery_messages ADD COLUMN cooperative_read_at TEXT;

CREATE INDEX IF NOT EXISTS idx_delivery_messages_recipient
  ON delivery_messages(delivery_id,recipient_type,created_at);
CREATE INDEX IF NOT EXISTS idx_delivery_messages_customer_unread
  ON delivery_messages(delivery_id,customer_read_at,created_at);
CREATE INDEX IF NOT EXISTS idx_delivery_messages_driver_unread
  ON delivery_messages(delivery_id,driver_read_at,created_at);
CREATE INDEX IF NOT EXISTS idx_delivery_messages_establishment_unread
  ON delivery_messages(delivery_id,establishment_read_at,created_at);

-- O aviso de mensagem continua sendo criado, mas agora inclui o destinatário.
DROP TRIGGER IF EXISTS trg_delivery_message_notification;
CREATE TRIGGER IF NOT EXISTS trg_delivery_message_notification
AFTER INSERT ON delivery_messages
BEGIN
  INSERT INTO notification_events(id,cooperative_id,establishment_id,driver_id,delivery_id,event_type,title,message)
  SELECT lower(hex(randomblob(16))), NEW.cooperative_id, d.establishment_id, d.assigned_driver_id, NEW.delivery_id,
    'delivery_message', 'Nova mensagem', substr(NEW.sender_name || ': ' || NEW.message,1,240)
  FROM deliveries d WHERE d.id=NEW.delivery_id;
END;
