CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('member','admin')),
  active INTEGER NOT NULL DEFAULT 1,
  joined TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  text_limit INTEGER NOT NULL DEFAULT 12 CHECK(text_limit BETWEEN 0 AND 35),
  image_limit INTEGER NOT NULL DEFAULT 3 CHECK(image_limit BETWEEN 0 AND 8)
);
CREATE TABLE invitations (
  digest TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member','admin')),
  expires INTEGER NOT NULL,
  redeemed_at INTEGER,
  issued_by TEXT REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE TABLE sessions (
  digest TEXT PRIMARY KEY,
  owner TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires);
CREATE INDEX sessions_owner ON sessions(owner, expires);
CREATE TABLE workspaces (
  owner TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0,
  write_token TEXT NOT NULL DEFAULT '',
  preferences TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE conversations (
  owner TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  archived INTEGER NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (owner,id)
);
CREATE TABLE messages (
  owner TEXT NOT NULL,
  conversation TEXT NOT NULL,
  position INTEGER NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (owner,conversation,position),
  FOREIGN KEY (owner,conversation) REFERENCES conversations(owner,id) ON DELETE CASCADE
);
CREATE TABLE memories (
  owner TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('manual','explicit')),
  PRIMARY KEY (owner,id)
);
CREATE TABLE studio_images (
  owner TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  data TEXT NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (owner,id)
);
