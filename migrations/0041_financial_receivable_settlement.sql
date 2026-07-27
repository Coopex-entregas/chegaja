PRAGMA foreign_keys = ON;

-- Remove identificadores internos de lote que não devem aparecer para a cooperativa.
UPDATE financial_entries
SET description = trim(substr(description,1,instr(lower(description),' • lote ')-1)),
    updated_at = CURRENT_TIMESTAMP
WHERE instr(lower(description),' • lote ') > 0;

-- Entregas da Base recebidas diretamente pelo cooperado (PIX comum, dinheiro, cartões, vales etc.)
-- são produção já recebida: não formam saldo disponível para desconto.
UPDATE financial_entries
SET settled_cents = amount_cents,
    status = 'paid',
    description = CASE
      WHEN instr(lower(description),'recebido diretamente pelo cooperado') > 0 THEN description
      ELSE trim(description) || ' • recebido diretamente pelo cooperado'
    END,
    updated_at = CURRENT_TIMESTAMP
WHERE entry_type='credit' AND category='delivery' AND deleted_at IS NULL AND status!='cancelled'
  AND delivery_id IN (
    SELECT d.id FROM deliveries d
    WHERE d.delivery_type='base'
      AND lower(replace(replace(COALESCE(d.payment_method,''),' ','_'),'-','_')) NOT IN
        ('credit','credito','credito_antecipado','credito_pre_pago','credito_automatico','prepaid','pre_pago','pix_cooperativa')
  );

-- Entregas de estabelecimento e Base paga por PIX Cooperativa/crédito antecipado
-- permanecem como produção para fechamento.
-- Corrige lançamentos antigos que foram marcados como recebidos diretamente,
-- embora pertençam a estabelecimento ou a uma forma elegível da Base.
UPDATE financial_entries
SET settled_cents = 0,
    status = 'open',
    description = replace(description,' • recebido diretamente pelo cooperado',''),
    updated_at = CURRENT_TIMESTAMP
WHERE entry_type='credit' AND category='delivery' AND deleted_at IS NULL AND status!='cancelled'
  AND instr(lower(description),'recebido diretamente pelo cooperado') > 0
  AND delivery_id IN (
    SELECT d.id FROM deliveries d
    WHERE d.delivery_type='establishment'
       OR (d.delivery_type='base' AND lower(replace(replace(COALESCE(d.payment_method,''),' ','_'),'-','_')) IN
          ('credit','credito','credito_antecipado','credito_pre_pago','credito_automatico','prepaid','pre_pago','pix_cooperativa'))
  );

UPDATE financial_entries
SET status = CASE WHEN COALESCE(settled_cents,0) >= amount_cents THEN 'paid' ELSE 'open' END,
    description = replace(description,' • recebido diretamente pelo cooperado',''),
    updated_at = CURRENT_TIMESTAMP
WHERE entry_type='credit' AND category='delivery' AND deleted_at IS NULL AND status!='cancelled'
  AND delivery_id IN (
    SELECT d.id FROM deliveries d
    WHERE d.delivery_type='establishment'
       OR (d.delivery_type='base' AND lower(replace(replace(COALESCE(d.payment_method,''),' ','_'),'-','_')) IN
          ('credit','credito','credito_antecipado','credito_pre_pago','credito_automatico','prepaid','pre_pago','pix_cooperativa'))
  );

-- Base recebida diretamente não sofre INSS nem SEST/SENAT no fechamento.
UPDATE financial_entries
SET status='cancelled',deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
WHERE entry_type='debit' AND category IN ('INSS','SEST/SENAT') AND deleted_at IS NULL
  AND delivery_id IN (
    SELECT d.id FROM deliveries d
    WHERE d.delivery_type='base'
      AND lower(replace(replace(COALESCE(d.payment_method,''),' ','_'),'-','_')) NOT IN
        ('credit','credito','credito_antecipado','credito_pre_pago','credito_automatico','prepaid','pre_pago','pix_cooperativa')
  );

-- Normaliza lançamentos parcialmente pagos de versões anteriores.
UPDATE financial_entries
SET status='paid',settled_cents=amount_cents,updated_at=CURRENT_TIMESTAMP
WHERE status='open' AND COALESCE(settled_cents,0)>=amount_cents;

-- Lançamentos parcialmente liquidados preservam o valor original e exibem apenas o restante em aberto.

-- Garante INSS para toda produção de estabelecimento e para Base elegível.
INSERT INTO financial_entries (
  id,cooperative_id,driver_id,establishment_id,delivery_id,entry_type,category,description,
  amount_cents,settled_cents,reference_date,status,created_by
)
SELECT lower(hex(randomblob(16))),d.cooperative_id,d.assigned_driver_id,d.establishment_id,d.id,
  'debit','INSS','INSS sobre entrega',
  CAST(round(max(0,COALESCE(NULLIF(d.driver_gross_cents,0),NULLIF(d.driver_earnings_cents,0),d.charge_cents-d.cooperative_fee_cents,0))*COALESCE(c.inss_percent,0)/100.0) AS INTEGER),
  0,date(COALESCE(d.delivered_at,d.updated_at,d.created_at),'-3 hours'),'open',NULL
FROM deliveries d JOIN cooperatives c ON c.id=d.cooperative_id
WHERE d.status='delivered' AND d.deleted_at IS NULL AND d.assigned_driver_id IS NOT NULL
  AND (d.delivery_type='establishment' OR (d.delivery_type='base' AND lower(replace(replace(COALESCE(d.payment_method,''),' ','_'),'-','_')) IN ('credit','credito','credito_antecipado','credito_pre_pago','credito_automatico','prepaid','pre_pago','pix_cooperativa')))
  AND COALESCE(c.inss_percent,0)>0
  AND round(max(0,COALESCE(NULLIF(d.driver_gross_cents,0),NULLIF(d.driver_earnings_cents,0),d.charge_cents-d.cooperative_fee_cents,0))*COALESCE(c.inss_percent,0)/100.0)>0
  AND NOT EXISTS (SELECT 1 FROM financial_entries f WHERE f.delivery_id=d.id AND f.entry_type='debit' AND f.category='INSS' AND f.deleted_at IS NULL);

-- Garante SEST/SENAT para toda produção de estabelecimento e para Base elegível.
INSERT INTO financial_entries (
  id,cooperative_id,driver_id,establishment_id,delivery_id,entry_type,category,description,
  amount_cents,settled_cents,reference_date,status,created_by
)
SELECT lower(hex(randomblob(16))),d.cooperative_id,d.assigned_driver_id,d.establishment_id,d.id,
  'debit','SEST/SENAT','SEST/SENAT sobre entrega',
  CAST(round(max(0,COALESCE(NULLIF(d.driver_gross_cents,0),NULLIF(d.driver_earnings_cents,0),d.charge_cents-d.cooperative_fee_cents,0))*COALESCE(c.sest_senat_percent,0)/100.0) AS INTEGER),
  0,date(COALESCE(d.delivered_at,d.updated_at,d.created_at),'-3 hours'),'open',NULL
FROM deliveries d JOIN cooperatives c ON c.id=d.cooperative_id
WHERE d.status='delivered' AND d.deleted_at IS NULL AND d.assigned_driver_id IS NOT NULL
  AND (d.delivery_type='establishment' OR (d.delivery_type='base' AND lower(replace(replace(COALESCE(d.payment_method,''),' ','_'),'-','_')) IN ('credit','credito','credito_antecipado','credito_pre_pago','credito_automatico','prepaid','pre_pago','pix_cooperativa')))
  AND COALESCE(c.sest_senat_percent,0)>0
  AND round(max(0,COALESCE(NULLIF(d.driver_gross_cents,0),NULLIF(d.driver_earnings_cents,0),d.charge_cents-d.cooperative_fee_cents,0))*COALESCE(c.sest_senat_percent,0)/100.0)>0
  AND NOT EXISTS (SELECT 1 FROM financial_entries f WHERE f.delivery_id=d.id AND f.entry_type='debit' AND f.category='SEST/SENAT' AND f.deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_financial_delivery_settlement
  ON financial_entries(cooperative_id,driver_id,entry_type,status,reference_date)
  WHERE deleted_at IS NULL;
