PRAGMA foreign_keys = ON;

-- 14.8.3: entrega cancelada não entra em ganhos ou descontos.
-- Exceção: cancelamento da Base após chegada, com deslocamento cobrado.

-- Primeiro cancela todos os lançamentos vinculados a entregas canceladas.
UPDATE financial_entries
SET status='cancelled', updated_at=CURRENT_TIMESTAMP
WHERE deleted_at IS NULL
  AND delivery_id IN (SELECT id FROM deliveries WHERE status='cancelled');

-- Zera valores financeiros das canceladas sem deslocamento cobrado.
UPDATE deliveries
SET driver_earnings_cents=0,
    driver_gross_cents=0,
    driver_net_cents=0,
    cooperative_fee_cents=0,
    updated_at=CURRENT_TIMESTAMP
WHERE status='cancelled'
  AND COALESCE(cancellation_charge_cents,0)<=0;

-- Nas canceladas com deslocamento, o ganho bruto corresponde somente ao deslocamento.
UPDATE deliveries
SET driver_earnings_cents=MAX(0,COALESCE(cancellation_charge_cents,0)),
    driver_gross_cents=MAX(0,COALESCE(cancellation_charge_cents,0)),
    driver_net_cents=MAX(0,COALESCE(cancellation_charge_cents,0)),
    cooperative_fee_cents=0,
    updated_at=CURRENT_TIMESTAMP
WHERE status='cancelled'
  AND assigned_driver_id IS NOT NULL
  AND COALESCE(cancellation_charge_cents,0)>0;

-- Recria apenas o crédito do deslocamento para cancelamentos com deslocamento.
INSERT INTO financial_entries (
  id,cooperative_id,driver_id,establishment_id,delivery_id,entry_type,category,description,
  amount_cents,settled_cents,reference_date,status,created_by
)
SELECT lower(hex(randomblob(16))),d.cooperative_id,d.assigned_driver_id,d.establishment_id,d.id,
  'credit','delivery','Deslocamento por cancelamento ' || COALESCE(d.display_code,substr(d.id,1,8)),
  MAX(0,COALESCE(d.cancellation_charge_cents,0)),
  CASE WHEN d.delivery_type='base' AND COALESCE(lower(d.payment_method),'') NOT IN ('credit','credito','pix_cooperativa')
       THEN MAX(0,COALESCE(d.cancellation_charge_cents,0)) ELSE 0 END,
  date(COALESCE(d.cancelled_at,d.updated_at,d.created_at),'-3 hours'),
  CASE WHEN d.delivery_type='base' AND COALESCE(lower(d.payment_method),'') NOT IN ('credit','credito','pix_cooperativa')
       THEN 'paid' ELSE 'open' END,NULL
FROM deliveries d
WHERE d.status='cancelled' AND d.deleted_at IS NULL
  AND d.assigned_driver_id IS NOT NULL
  AND COALESCE(d.cancellation_charge_cents,0)>0
  AND NOT EXISTS (
    SELECT 1 FROM financial_entries f
    WHERE f.delivery_id=d.id AND f.category='delivery' AND f.entry_type='credit'
      AND f.status!='cancelled' AND f.deleted_at IS NULL
  );

-- INSS e SEST/SENAT incidem somente quando a forma de pagamento da Base for tributável.
INSERT INTO financial_entries (id,cooperative_id,driver_id,establishment_id,delivery_id,entry_type,category,description,amount_cents,reference_date,status,created_by)
SELECT lower(hex(randomblob(16))),d.cooperative_id,d.assigned_driver_id,d.establishment_id,d.id,
  'debit','INSS','INSS sobre deslocamento de cancelamento',
  ROUND(MAX(0,COALESCE(d.cancellation_charge_cents,0))*COALESCE(c.inss_percent,0)/100.0),
  date(COALESCE(d.cancelled_at,d.updated_at,d.created_at),'-3 hours'),'open',NULL
FROM deliveries d JOIN cooperatives c ON c.id=d.cooperative_id
WHERE d.status='cancelled' AND d.delivery_type='base' AND d.deleted_at IS NULL
  AND d.assigned_driver_id IS NOT NULL AND COALESCE(d.cancellation_charge_cents,0)>0
  AND COALESCE(lower(d.payment_method),'') IN ('credit','credito','pix_cooperativa')
  AND COALESCE(c.inss_percent,0)>0;

INSERT INTO financial_entries (id,cooperative_id,driver_id,establishment_id,delivery_id,entry_type,category,description,amount_cents,reference_date,status,created_by)
SELECT lower(hex(randomblob(16))),d.cooperative_id,d.assigned_driver_id,d.establishment_id,d.id,
  'debit','SEST/SENAT','SEST/SENAT sobre deslocamento de cancelamento',
  ROUND(MAX(0,COALESCE(d.cancellation_charge_cents,0))*COALESCE(c.sest_senat_percent,0)/100.0),
  date(COALESCE(d.cancelled_at,d.updated_at,d.created_at),'-3 hours'),'open',NULL
FROM deliveries d JOIN cooperatives c ON c.id=d.cooperative_id
WHERE d.status='cancelled' AND d.delivery_type='base' AND d.deleted_at IS NULL
  AND d.assigned_driver_id IS NOT NULL AND COALESCE(d.cancellation_charge_cents,0)>0
  AND COALESCE(lower(d.payment_method),'') IN ('credit','credito','pix_cooperativa')
  AND COALESCE(c.sest_senat_percent,0)>0;

-- Atualiza o líquido dos deslocamentos tributáveis.
UPDATE deliveries
SET driver_net_cents=MAX(0,COALESCE(cancellation_charge_cents,0)
  - ROUND(COALESCE(cancellation_charge_cents,0)*COALESCE((SELECT inss_percent FROM cooperatives c WHERE c.id=deliveries.cooperative_id),0)/100.0)
  - ROUND(COALESCE(cancellation_charge_cents,0)*COALESCE((SELECT sest_senat_percent FROM cooperatives c WHERE c.id=deliveries.cooperative_id),0)/100.0)),
  updated_at=CURRENT_TIMESTAMP
WHERE status='cancelled' AND delivery_type='base'
  AND COALESCE(cancellation_charge_cents,0)>0
  AND COALESCE(lower(payment_method),'') IN ('credit','credito','pix_cooperativa');
