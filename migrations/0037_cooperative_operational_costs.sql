ALTER TABLE cooperatives ADD COLUMN fuel_km_per_liter REAL;
ALTER TABLE cooperatives ADD COLUMN fuel_price_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cooperatives ADD COLUMN displacement_rate_cents_per_km INTEGER NOT NULL DEFAULT 0;

UPDATE cooperatives
SET fuel_km_per_liter = COALESCE(
      fuel_km_per_liter,
      (SELECT NULLIF(b.fuel_km_per_liter,0) FROM bases b
       WHERE b.cooperative_id=cooperatives.id AND b.active=1 AND b.deleted_at IS NULL
       ORDER BY b.name LIMIT 1),
      35
    ),
    fuel_price_cents = COALESCE(NULLIF(fuel_price_cents,0),
      (SELECT NULLIF(b.fuel_price_cents,0) FROM bases b
       WHERE b.cooperative_id=cooperatives.id AND b.active=1 AND b.deleted_at IS NULL
       ORDER BY b.name LIMIT 1),0),
    displacement_rate_cents_per_km = COALESCE(NULLIF(displacement_rate_cents_per_km,0),
      (SELECT NULLIF(b.displacement_rate_cents_per_km,0) FROM bases b
       WHERE b.cooperative_id=cooperatives.id AND b.active=1 AND b.deleted_at IS NULL
       ORDER BY b.name LIMIT 1),0);
