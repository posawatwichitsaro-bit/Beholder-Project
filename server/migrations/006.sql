ALTER TABLE rooms ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS rooms_updated_idx ON rooms (updated_at DESC);
CREATE INDEX IF NOT EXISTS rooms_members_idx ON rooms USING gin ((state->'members') jsonb_path_ops);
