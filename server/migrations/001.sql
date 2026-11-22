CREATE TABLE IF NOT EXISTS rooms (
  id uuid PRIMARY KEY,
  invite uuid UNIQUE NOT NULL,
  state jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES rooms(id),
  member_id uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS command_receipts (
  room_id uuid NOT NULL REFERENCES rooms(id),
  member_id uuid NOT NULL,
  command_id uuid NOT NULL,
  payload jsonb NOT NULL,
  result jsonb NOT NULL,
  PRIMARY KEY (room_id, member_id, command_id)
);
