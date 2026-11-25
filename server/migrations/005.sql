ALTER TABLE profile_sessions ADD COLUMN IF NOT EXISTS idle_expires_at timestamptz NOT NULL DEFAULT (now() + interval '12 hours');
CREATE INDEX IF NOT EXISTS profile_sessions_expiry_idx ON profile_sessions (expires_at);
CREATE INDEX IF NOT EXISTS profile_sessions_idle_expiry_idx ON profile_sessions (idle_expires_at);
