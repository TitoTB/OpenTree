CREATE TABLE IF NOT EXISTS trees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'es',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  tree_id TEXT NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
  given_name TEXT NOT NULL,
  family_name TEXT NOT NULL,
  gender TEXT NOT NULL DEFAULT 'unknown',
  birth_date TEXT,
  birth_place TEXT,
  death_date TEXT,
  death_place TEXT,
  photo_path TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS relationships (
  id TEXT PRIMARY KEY,
  tree_id TEXT NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  from_person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  to_person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  start_date TEXT,
  end_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  event_date TEXT,
  place TEXT,
  description TEXT,
  source_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media_items (
  id TEXT PRIMARY KEY,
  tree_id TEXT NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
  owner_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  title TEXT,
  description TEXT,
  captured_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS citations (
  id TEXT PRIMARY KEY,
  tree_id TEXT NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT,
  archive_reference TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contributions (
  id TEXT PRIMARY KEY,
  tree_id TEXT NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_people_tree ON people(tree_id);
CREATE INDEX IF NOT EXISTS idx_relationships_tree ON relationships(tree_id);
CREATE INDEX IF NOT EXISTS idx_relationships_from ON relationships(from_person_id);
CREATE INDEX IF NOT EXISTS idx_relationships_to ON relationships(to_person_id);
