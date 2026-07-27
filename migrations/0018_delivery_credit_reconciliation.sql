PRAGMA foreign_keys = ON;

-- Vincula o cliente e o consumo de crédito diretamente à entrega.
ALTER TABLE deliveries ADD COLUMN customer_id TEXT REFERENCES customers(id);
ALTER TABLE deliveries ADD COLUMN credit_used_cents INTEGER NOT NULL DEFAULT 0;

-- Cada movimentação passa a indicar exatamente qual entrega originou o débito ou estorno.
ALTER TABLE customer_wallet_transactions ADD COLUMN delivery_id TEXT REFERENCES deliveries(id);
ALTER TABLE customer_wallet_transactions ADD COLUMN reason TEXT;

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_delivery
  ON customer_wallet_transactions(delivery_id, cooperative_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_deliveries_customer
  ON deliveries(customer_id, cooperative_id, created_at DESC);

-- Recupera os vínculos de pedidos já feitos pelo aplicativo.
UPDATE deliveries
SET customer_id = (
  SELECT r.customer_id FROM customer_requests r
  WHERE r.delivery_id = deliveries.id AND r.customer_id IS NOT NULL
  ORDER BY r.created_at DESC LIMIT 1
)
WHERE customer_id IS NULL;

UPDATE deliveries
SET credit_used_cents = COALESCE((
  SELECT r.credit_used_cents FROM customer_requests r
  WHERE r.delivery_id = deliveries.id
  ORDER BY r.created_at DESC LIMIT 1
),0)
WHERE credit_used_cents = 0;

UPDATE customer_wallet_transactions
SET delivery_id = (
  SELECT r.delivery_id FROM customer_requests r
  WHERE r.id = customer_wallet_transactions.request_id
)
WHERE delivery_id IS NULL AND request_id IS NOT NULL;
