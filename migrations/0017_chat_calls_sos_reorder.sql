PRAGMA foreign_keys = ON;

-- Conversas separadas por participante: cliente x local, cliente x cooperado e cooperado x local.
ALTER TABLE delivery_messages ADD COLUMN conversation_key TEXT NOT NULL DEFAULT 'legacy';

UPDATE delivery_messages
SET conversation_key = CASE
  WHEN (sender_type='customer' AND recipient_type='driver')
    OR (sender_type='driver' AND recipient_type='customer') THEN 'customer_driver'
  WHEN (sender_type='customer' AND recipient_type IN ('establishment','cooperative'))
    OR (sender_type IN ('establishment','cooperative') AND recipient_type='customer') THEN 'customer_place'
  WHEN (sender_type='driver' AND recipient_type IN ('establishment','cooperative'))
    OR (sender_type IN ('establishment','cooperative') AND recipient_type='driver') THEN 'driver_place'
  ELSE 'legacy'
END;

CREATE INDEX IF NOT EXISTS idx_delivery_messages_conversation
  ON delivery_messages(delivery_id,conversation_key,created_at);

-- Nome de quem recebeu, informado opcionalmente pelo cooperado ou pela Base.
ALTER TABLE deliveries ADD COLUMN received_by_name TEXT;
ALTER TABLE deliveries ADD COLUMN received_by_reported_at TEXT;

-- Sinalização de chamadas de voz internas via WebRTC.
CREATE TABLE IF NOT EXISTS delivery_calls (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL,
  cooperative_id TEXT NOT NULL,
  conversation_key TEXT NOT NULL CHECK(conversation_key IN ('customer_place','customer_driver','driver_place')),
  caller_type TEXT NOT NULL CHECK(caller_type IN ('customer','driver','place')),
  caller_user_id TEXT,
  caller_customer_id TEXT,
  caller_name TEXT NOT NULL,
  callee_type TEXT NOT NULL CHECK(callee_type IN ('customer','driver','place')),
  status TEXT NOT NULL DEFAULT 'ringing' CHECK(status IN ('ringing','accepted','declined','ended','missed')),
  offer_sdp TEXT NOT NULL,
  answer_sdp TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  answered_at TEXT,
  ended_at TEXT,
  expires_at TEXT NOT NULL DEFAULT (datetime('now','+90 seconds')),
  ended_by TEXT,
  FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (caller_user_id) REFERENCES users(id),
  FOREIGN KEY (caller_customer_id) REFERENCES customers(id)
);
CREATE INDEX IF NOT EXISTS idx_delivery_calls_incoming
  ON delivery_calls(cooperative_id,callee_type,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_calls_delivery
  ON delivery_calls(delivery_id,conversation_key,created_at DESC);

CREATE TABLE IF NOT EXISTS delivery_call_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id TEXT NOT NULL,
  sender_type TEXT NOT NULL CHECK(sender_type IN ('customer','driver','place')),
  candidate_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (call_id) REFERENCES delivery_calls(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_delivery_call_candidates
  ON delivery_call_candidates(call_id,id);

-- Pedido de socorro com localização instantânea do cooperado.
CREATE TABLE IF NOT EXISTS delivery_sos (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL,
  cooperative_id TEXT NOT NULL,
  base_id TEXT,
  driver_id TEXT NOT NULL,
  driver_name TEXT NOT NULL,
  occurrence TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  accuracy REAL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','resolved')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  resolved_by TEXT,
  FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE,
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id),
  FOREIGN KEY (base_id) REFERENCES bases(id),
  FOREIGN KEY (driver_id) REFERENCES drivers(id),
  FOREIGN KEY (resolved_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_delivery_sos_active
  ON delivery_sos(cooperative_id,status,created_at DESC);
