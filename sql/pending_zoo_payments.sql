-- Pending ZOO payments: queue for verification / anti-replay.
-- Run this on your Postgres (e.g. Render Postgres) then point your Node verification server at it.

CREATE TABLE IF NOT EXISTS pending_zoo_payments (
    id SERIAL PRIMARY KEY,
    order_id INT NOT NULL,
    signature TEXT UNIQUE NOT NULL,
    expected_amount NUMERIC(20, 9) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for anti-replay (lookup by signature)
CREATE INDEX IF NOT EXISTS idx_pending_zoo_payments_signature ON pending_zoo_payments (signature);

-- Index for polling pending items (e.g. background job)
CREATE INDEX IF NOT EXISTS idx_pending_zoo_payments_status ON pending_zoo_payments (status);

-- Optional: index for order lookup
CREATE INDEX IF NOT EXISTS idx_pending_zoo_payments_order_id ON pending_zoo_payments (order_id);

-- Anti-replay for verification server: one row per verified signature.
-- INSERT ... ON CONFLICT DO NOTHING ensures retries won't duplicate.
CREATE TABLE IF NOT EXISTS verified_signatures (
    id SERIAL PRIMARY KEY,
    signature TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_verified_signatures_signature ON verified_signatures (signature);
