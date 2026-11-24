CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  name_key text UNIQUE NOT NULL,
  salt text NOT NULL,
  password_hash text NOT NULL
);
CREATE TABLE IF NOT EXISTS profile_sessions (
  token_hash text PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS library_sheets (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sheet jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS library_sheets_profile_idx ON library_sheets(profile_id);
