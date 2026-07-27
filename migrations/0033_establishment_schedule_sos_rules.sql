PRAGMA foreign_keys = ON;

-- Raio obrigatório para entrada na fila do estabelecimento.
ALTER TABLE establishments ADD COLUMN queue_radius_meters INTEGER NOT NULL DEFAULT 250;

-- Afastamento operacional com retorno automático.
ALTER TABLE drivers ADD COLUMN on_leave INTEGER NOT NULL DEFAULT 0;
ALTER TABLE drivers ADD COLUMN leave_start_date TEXT;
ALTER TABLE drivers ADD COLUMN leave_return_date TEXT;
ALTER TABLE drivers ADD COLUMN leave_reason TEXT;

-- A grade semanal possui dois espaços por dia e pode registrar trabalho, folga ou afastamento.
ALTER TABLE schedules ADD COLUMN entry_type TEXT NOT NULL DEFAULT 'work';
ALTER TABLE schedules ADD COLUMN slot_index INTEGER;
ALTER TABLE schedules ADD COLUMN week_start TEXT;

-- Bloqueio de cooperado por estabelecimento.
CREATE TABLE IF NOT EXISTS driver_establishment_blocks (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  establishment_id TEXT NOT NULL,
  reason TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(driver_id, establishment_id),
  FOREIGN KEY(cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY(driver_id) REFERENCES drivers(id) ON DELETE CASCADE,
  FOREIGN KEY(establishment_id) REFERENCES establishments(id) ON DELETE CASCADE,
  FOREIGN KEY(created_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_driver_establishment_blocks_lookup
  ON driver_establishment_blocks(cooperative_id, driver_id, establishment_id, active);
CREATE INDEX IF NOT EXISTS idx_schedules_weekly_slot
  ON schedules(cooperative_id, driver_id, week_start, slot_index, start_at);
CREATE INDEX IF NOT EXISTS idx_drivers_leave_return
  ON drivers(cooperative_id, on_leave, leave_return_date);

-- Entrega cancelada não gera ganho nem desconto.
UPDATE financial_entries
SET status='cancelled', updated_at=CURRENT_TIMESTAMP
WHERE deleted_at IS NULL
  AND delivery_id IN (SELECT id FROM deliveries WHERE status='cancelled');

-- Recupera créditos faltantes de todas as entregas concluídas.
INSERT INTO financial_entries (
  id, cooperative_id, driver_id, establishment_id, delivery_id,
  entry_type, category, description, amount_cents, settled_cents,
  reference_date, status, created_by
)
SELECT
  lower(hex(randomblob(16))), d.cooperative_id, d.assigned_driver_id,
  d.establishment_id, d.id, 'credit', 'delivery',
  'Entrega ' || COALESCE(d.display_code, substr(d.id,1,8)) ||
    CASE WHEN d.delivery_type='base'
      AND COALESCE(lower(d.payment_method),'') NOT IN ('credit','credito','pix_cooperativa')
      THEN ' • recebido diretamente pelo cooperado' ELSE '' END,
  max(0, COALESCE(NULLIF(d.driver_gross_cents,0), NULLIF(d.driver_earnings_cents,0), d.charge_cents-d.cooperative_fee_cents, 0)),
  CASE WHEN d.delivery_type='base'
      AND COALESCE(lower(d.payment_method),'') NOT IN ('credit','credito','pix_cooperativa')
    THEN max(0, COALESCE(NULLIF(d.driver_gross_cents,0), NULLIF(d.driver_earnings_cents,0), d.charge_cents-d.cooperative_fee_cents, 0)) ELSE 0 END,
  date(COALESCE(d.delivered_at,d.updated_at,d.created_at),'-3 hours'),
  CASE WHEN d.delivery_type='base'
      AND COALESCE(lower(d.payment_method),'') NOT IN ('credit','credito','pix_cooperativa')
    THEN 'paid' ELSE 'open' END,
  NULL
FROM deliveries d
WHERE d.status='delivered' AND d.deleted_at IS NULL AND d.assigned_driver_id IS NOT NULL
  AND max(0, COALESCE(NULLIF(d.driver_gross_cents,0), NULLIF(d.driver_earnings_cents,0), d.charge_cents-d.cooperative_fee_cents, 0)) > 0
  AND NOT EXISTS (
    SELECT 1 FROM financial_entries f
    WHERE f.delivery_id=d.id AND f.category='delivery' AND f.entry_type='credit' AND f.deleted_at IS NULL
  );

-- Toda entrega de estabelecimento desconta INSS e SEST/SENAT, independentemente da forma de pagamento.
INSERT INTO financial_entries (
  id, cooperative_id, driver_id, establishment_id, delivery_id,
  entry_type, category, description, amount_cents, reference_date, status, created_by
)
SELECT lower(hex(randomblob(16))), d.cooperative_id, d.assigned_driver_id, d.establishment_id, d.id,
  'debit', 'INSS', 'INSS sobre entrega',
  round(max(0, COALESCE(NULLIF(d.driver_gross_cents,0), NULLIF(d.driver_earnings_cents,0), d.charge_cents-d.cooperative_fee_cents,0)) * COALESCE(c.inss_percent,0) / 100.0),
  date(COALESCE(d.delivered_at,d.updated_at,d.created_at),'-3 hours'), 'open', NULL
FROM deliveries d JOIN cooperatives c ON c.id=d.cooperative_id
WHERE d.delivery_type='establishment' AND d.status='delivered' AND d.deleted_at IS NULL
  AND d.assigned_driver_id IS NOT NULL AND COALESCE(c.inss_percent,0)>0
  AND NOT EXISTS (SELECT 1 FROM financial_entries f WHERE f.delivery_id=d.id AND f.category='INSS' AND f.entry_type='debit' AND f.deleted_at IS NULL);

INSERT INTO financial_entries (
  id, cooperative_id, driver_id, establishment_id, delivery_id,
  entry_type, category, description, amount_cents, reference_date, status, created_by
)
SELECT lower(hex(randomblob(16))), d.cooperative_id, d.assigned_driver_id, d.establishment_id, d.id,
  'debit', 'SEST/SENAT', 'SEST/SENAT sobre entrega',
  round(max(0, COALESCE(NULLIF(d.driver_gross_cents,0), NULLIF(d.driver_earnings_cents,0), d.charge_cents-d.cooperative_fee_cents,0)) * COALESCE(c.sest_senat_percent,0) / 100.0),
  date(COALESCE(d.delivered_at,d.updated_at,d.created_at),'-3 hours'), 'open', NULL
FROM deliveries d JOIN cooperatives c ON c.id=d.cooperative_id
WHERE d.delivery_type='establishment' AND d.status='delivered' AND d.deleted_at IS NULL
  AND d.assigned_driver_id IS NOT NULL AND COALESCE(c.sest_senat_percent,0)>0
  AND NOT EXISTS (SELECT 1 FROM financial_entries f WHERE f.delivery_id=d.id AND f.category='SEST/SENAT' AND f.entry_type='debit' AND f.deleted_at IS NULL);

-- Atualiza o líquido histórico de entregas de estabelecimento conforme os percentuais atuais.
UPDATE deliveries
SET driver_net_cents = max(0,
  COALESCE(NULLIF(driver_gross_cents,0), NULLIF(driver_earnings_cents,0), charge_cents-cooperative_fee_cents,0)
  - round(COALESCE(NULLIF(driver_gross_cents,0), NULLIF(driver_earnings_cents,0), charge_cents-cooperative_fee_cents,0)
      * COALESCE((SELECT inss_percent FROM cooperatives c WHERE c.id=deliveries.cooperative_id),0) / 100.0)
  - round(COALESCE(NULLIF(driver_gross_cents,0), NULLIF(driver_earnings_cents,0), charge_cents-cooperative_fee_cents,0)
      * COALESCE((SELECT sest_senat_percent FROM cooperatives c WHERE c.id=deliveries.cooperative_id),0) / 100.0)
), updated_at=CURRENT_TIMESTAMP
WHERE delivery_type='establishment' AND status='delivered' AND deleted_at IS NULL;
