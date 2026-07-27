PRAGMA foreign_keys = ON;

-- Mantém o cadastro de clientes separado por cooperativa sem duplicar a conta
-- global do cliente no aplicativo Ligerim.
CREATE TABLE IF NOT EXISTS cooperative_customers (
  cooperative_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','blocked')),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (cooperative_id, customer_id),
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_cooperative_customers_customer
  ON cooperative_customers(customer_id, cooperative_id);

-- Vincula automaticamente os clientes que já fizeram pedidos ou movimentaram
-- crédito antes desta atualização.
INSERT OR IGNORE INTO cooperative_customers (cooperative_id, customer_id)
SELECT DISTINCT cooperative_id, customer_id
FROM customer_requests
WHERE cooperative_id IS NOT NULL AND customer_id IS NOT NULL;

INSERT OR IGNORE INTO cooperative_customers (cooperative_id, customer_id)
SELECT DISTINCT t.cooperative_id, w.customer_id
FROM customer_wallet_transactions t
JOIN customer_wallets w ON w.id = t.wallet_id
WHERE t.cooperative_id IS NOT NULL;
