PRAGMA foreign_keys = ON;

-- Repara acessos antigos de cooperados criados sem vínculo, somente quando há
-- exatamente um cooperado ativo da mesma cooperativa com o mesmo e-mail.
UPDATE users
SET driver_id = (
  SELECT d.id FROM drivers d
  WHERE d.cooperative_id=users.cooperative_id
    AND d.deleted_at IS NULL
    AND d.status='active'
    AND lower(trim(COALESCE(d.email,'')))=lower(trim(users.email))
  LIMIT 1
), updated_at=CURRENT_TIMESTAMP
WHERE role='driver' AND driver_id IS NULL AND deleted_at IS NULL
  AND 1=(
    SELECT COUNT(*) FROM drivers d
    WHERE d.cooperative_id=users.cooperative_id
      AND d.deleted_at IS NULL
      AND d.status='active'
      AND lower(trim(COALESCE(d.email,'')))=lower(trim(users.email))
  );

CREATE INDEX IF NOT EXISTS idx_users_driver_active ON users(driver_id, status) WHERE role='driver' AND deleted_at IS NULL;

-- Diferencia pedidos recebidos de integrações externas para usar um alerta
-- sonoro próprio e mais forte nos painéis da cooperativa e do estabelecimento.
DROP TRIGGER IF EXISTS trg_delivery_created_notification;
CREATE TRIGGER trg_delivery_created_notification
AFTER INSERT ON deliveries
BEGIN
  INSERT INTO notification_events (
    id, cooperative_id, establishment_id, driver_id, delivery_id, event_type, title, message
  ) VALUES (
    lower(hex(randomblob(16))), NEW.cooperative_id, NEW.establishment_id, NEW.assigned_driver_id, NEW.id,
    CASE
      WHEN NEW.external_id IS NOT NULL OR lower(COALESCE(NEW.source,'')) IN ('integration','api','ifood','marketplace','webhook','external')
        THEN 'integration_order_created'
      WHEN NEW.delivery_type='base' THEN 'base_order_created'
      ELSE 'counter_order_created'
    END,
    CASE
      WHEN NEW.external_id IS NOT NULL OR lower(COALESCE(NEW.source,'')) IN ('integration','api','ifood','marketplace','webhook','external')
        THEN 'Nova entrega recebida do sistema'
      WHEN NEW.delivery_type='base' THEN 'Nova entrega da Base'
      ELSE 'Nova entrega de balcão'
    END,
    COALESCE(NEW.display_code,'Nova entrega') || ' • ' || COALESCE(NEW.delivery_address,'')
  );
END;
