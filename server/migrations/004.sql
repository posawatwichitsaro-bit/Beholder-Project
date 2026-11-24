CREATE TABLE IF NOT EXISTS library_objects (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  definition jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS library_objects_profile_idx ON library_objects(profile_id);
