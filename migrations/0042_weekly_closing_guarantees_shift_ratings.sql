PRAGMA foreign_keys = ON;

-- Garantido diário configurado no cadastro de cada estabelecimento.
CREATE TABLE IF NOT EXISTS establishment_daily_guarantees (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  establishment_id TEXT NOT NULL,
  weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
  guaranteed_cents INTEGER NOT NULL DEFAULT 0 CHECK(guaranteed_cents >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(establishment_id,weekday),
  FOREIGN KEY(cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY(establishment_id) REFERENCES establishments(id)
);
CREATE INDEX IF NOT EXISTS idx_establishment_daily_guarantees_scope
  ON establishment_daily_guarantees(cooperative_id,establishment_id,weekday);

-- Ajuste do total do turno pelo estabelecimento quando uma entrega feita depois do horário
-- ainda pertencia ao cooperado daquele turno.
CREATE TABLE IF NOT EXISTS guarantee_turn_adjustments (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  schedule_id TEXT NOT NULL UNIQUE,
  establishment_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  declared_total_cents INTEGER NOT NULL DEFAULT 0 CHECK(declared_total_cents >= 0),
  notes TEXT,
  adjusted_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY(schedule_id) REFERENCES schedules(id),
  FOREIGN KEY(establishment_id) REFERENCES establishments(id),
  FOREIGN KEY(driver_id) REFERENCES drivers(id),
  FOREIGN KEY(adjusted_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_guarantee_turn_adjustments_scope
  ON guarantee_turn_adjustments(cooperative_id,establishment_id,updated_at DESC);

-- Liga o complemento de garantido e os impostos gerados ao mesmo fechamento de turno.
CREATE TABLE IF NOT EXISTS guarantee_settlement_financial_entries (
  settlement_id TEXT NOT NULL,
  entry_kind TEXT NOT NULL CHECK(entry_kind IN ('complement','inss','sest_senat')),
  financial_entry_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(settlement_id,entry_kind),
  FOREIGN KEY(settlement_id) REFERENCES guarantee_settlements(id) ON DELETE CASCADE,
  FOREIGN KEY(financial_entry_id) REFERENCES financial_entries(id)
);

-- Avaliação opcional feita pelo estabelecimento ao fim do turno. A Base não participa.
CREATE TABLE IF NOT EXISTS shift_ratings (
  id TEXT PRIMARY KEY,
  cooperative_id TEXT NOT NULL,
  schedule_id TEXT NOT NULL UNIQUE,
  establishment_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5),
  tags_json TEXT,
  comment TEXT,
  source TEXT NOT NULL DEFAULT 'establishment_shift',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY(schedule_id) REFERENCES schedules(id),
  FOREIGN KEY(establishment_id) REFERENCES establishments(id),
  FOREIGN KEY(driver_id) REFERENCES drivers(id),
  FOREIGN KEY(created_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_shift_ratings_driver
  ON shift_ratings(cooperative_id,driver_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shift_ratings_establishment
  ON shift_ratings(establishment_id,created_at DESC);

-- Corrige liquidações prematuras da semana ainda não fechada criadas pela versão anterior.
-- Produção recebida diretamente na Base continua paga; produção para fechamento e descontos
-- permanecem em aberto até o fechamento semanal.
UPDATE financial_entries
SET settled_cents=0,status='open',updated_at=CURRENT_TIMESTAMP
WHERE deleted_at IS NULL AND status='paid'
  AND date(reference_date) > date(COALESCE((
    SELECT MAX(w.week_end) FROM weekly_closings w
    WHERE w.cooperative_id=financial_entries.cooperative_id AND w.status='closed'
  ),'1900-01-01'))
  AND NOT (
    entry_type='credit' AND category='delivery' AND delivery_id IN (
      SELECT d.id FROM deliveries d
      WHERE d.delivery_type='base'
        AND lower(replace(replace(COALESCE(d.payment_method,''),' ','_'),'-','_')) IN ('pix','pix_comum','dinheiro','cash')
    )
  );


-- Padroniza os lançamentos de produção recebida diretamente: somente PIX comum e dinheiro da Base.
UPDATE financial_entries
SET settled_cents=amount_cents,status='paid',updated_at=CURRENT_TIMESTAMP
WHERE deleted_at IS NULL AND entry_type='credit' AND category='delivery' AND delivery_id IN (
  SELECT d.id FROM deliveries d WHERE d.delivery_type='base'
    AND lower(replace(replace(COALESCE(d.payment_method,''),' ','_'),'-','_')) IN ('pix','pix_comum','dinheiro','cash')
);

-- PIX Cooperativa e créditos da Base permanecem para o fechamento da semana corrente.
UPDATE financial_entries
SET settled_cents=0,status='open',updated_at=CURRENT_TIMESTAMP
WHERE deleted_at IS NULL AND entry_type='credit' AND category='delivery' AND delivery_id IN (
  SELECT d.id FROM deliveries d WHERE d.delivery_type='base'
    AND lower(replace(replace(COALESCE(d.payment_method,''),' ','_'),'-','_')) IN
      ('credit','credito','credito_antecipado','credito_pre_pago','credito_automatico','prepaid','pre_pago','pix_cooperativa')
)
AND date(reference_date) > date(COALESCE((SELECT MAX(w.week_end) FROM weekly_closings w WHERE w.cooperative_id=financial_entries.cooperative_id AND w.status='closed'),'1900-01-01'));



-- Na Base, cartões e vales informam apenas como cobrar o produto/refeição do cliente.
-- Eles nunca são produção do cooperado e, portanto, não geram INSS nem SEST/SENAT.
UPDATE financial_entries
SET status='cancelled',settled_cents=0,deleted_at=COALESCE(deleted_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP
WHERE deleted_at IS NULL AND delivery_id IN (
  SELECT d.id FROM deliveries d
  WHERE d.delivery_type='base'
    AND lower(replace(replace(replace(replace(COALESCE(d.payment_method,''),' ','_'),'-','_'),'ã','a'),'ç','c')) IN (
      'cartao_credito','cartao_de_credito','cartão_de_crédito','credito_cartao','credit_card','card_credit',
      'cartao_debito','cartao_de_debito','cartão_de_débito','debito_cartao','debit_card','card_debit',
      'vale_refeicao','vale_refeição','voucher_refeicao','meal_voucher',
      'vale_alimentacao','vale_alimentação','voucher_alimentacao','food_voucher'
    )
)
AND (
  (entry_type='credit' AND category='delivery')
  OR (entry_type='debit' AND category IN ('INSS','SEST/SENAT'))
);

-- Remove identificadores técnicos das descrições antigas.
UPDATE financial_entries SET description=trim(replace(description,substr(description,instr(lower(description),'• lote ')),'')),updated_at=CURRENT_TIMESTAMP
WHERE lower(description) LIKE '%• lote %';
