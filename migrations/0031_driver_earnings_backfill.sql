-- Recupera ganhos de entregas já finalizadas que não receberam lançamento financeiro.
INSERT INTO financial_entries (
  id, cooperative_id, driver_id, establishment_id, delivery_id,
  entry_type, category, description, amount_cents, settled_cents,
  reference_date, status, created_by
)
SELECT
  lower(hex(randomblob(16))),
  d.cooperative_id,
  d.assigned_driver_id,
  d.establishment_id,
  d.id,
  'credit',
  'delivery',
  'Entrega ' || COALESCE(d.display_code, substr(d.id, 1, 8)) ||
    CASE WHEN d.delivery_type = 'base'
      AND COALESCE(lower(d.payment_method), '') NOT IN ('credit','credito','pix_cooperativa')
      THEN ' • recebido diretamente pelo cooperado' ELSE '' END,
  max(0, COALESCE(NULLIF(d.driver_gross_cents, 0), NULLIF(d.driver_earnings_cents, 0), d.charge_cents - d.cooperative_fee_cents, 0)),
  CASE WHEN d.delivery_type = 'base'
      AND COALESCE(lower(d.payment_method), '') NOT IN ('credit','credito','pix_cooperativa')
    THEN max(0, COALESCE(NULLIF(d.driver_gross_cents, 0), NULLIF(d.driver_earnings_cents, 0), d.charge_cents - d.cooperative_fee_cents, 0)) ELSE 0 END,
  date(COALESCE(d.delivered_at, d.updated_at, d.created_at), '-3 hours'),
  CASE WHEN d.delivery_type = 'base'
      AND COALESCE(lower(d.payment_method), '') NOT IN ('credit','credito','pix_cooperativa')
    THEN 'paid' ELSE 'open' END,
  NULL
FROM deliveries d
WHERE d.status = 'delivered'
  AND d.deleted_at IS NULL
  AND d.assigned_driver_id IS NOT NULL
  AND max(0, COALESCE(NULLIF(d.driver_gross_cents, 0), NULLIF(d.driver_earnings_cents, 0), d.charge_cents - d.cooperative_fee_cents, 0)) > 0
  AND NOT EXISTS (
    SELECT 1 FROM financial_entries f
    WHERE f.delivery_id = d.id
      AND f.category = 'delivery'
      AND f.entry_type = 'credit'
      AND f.deleted_at IS NULL
  );
