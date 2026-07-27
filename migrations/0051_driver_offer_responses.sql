PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS driver_offer_responses (
  delivery_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  response TEXT NOT NULL CHECK(response IN ('accepted','declined')),
  reason TEXT,
  responded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (delivery_id,driver_id),
  FOREIGN KEY (delivery_id) REFERENCES deliveries(id),
  FOREIGN KEY (driver_id) REFERENCES drivers(id)
);

CREATE INDEX IF NOT EXISTS idx_driver_offer_responses_driver
  ON driver_offer_responses(driver_id,response,responded_at DESC);

CREATE INDEX IF NOT EXISTS idx_driver_offer_responses_delivery
  ON driver_offer_responses(delivery_id,response);

CREATE INDEX IF NOT EXISTS idx_deliveries_driver_live
  ON deliveries(cooperative_id,assigned_driver_id,status,deleted_at,created_at);

CREATE INDEX IF NOT EXISTS idx_deliveries_offered_live
  ON deliveries(cooperative_id,status,assigned_driver_id,deleted_at,created_at);
