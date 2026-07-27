-- Base não cobra valor de produto/refeição. Essa cobrança é exclusiva de estabelecimentos.
UPDATE deliveries
SET amount_to_collect_cents = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE delivery_type = 'base'
  AND COALESCE(amount_to_collect_cents, 0) <> 0;

UPDATE customer_requests
SET amount_to_collect_cents = 0
WHERE COALESCE(amount_to_collect_cents, 0) <> 0
  AND delivery_id IN (
    SELECT id FROM deliveries WHERE delivery_type = 'base'
  );
