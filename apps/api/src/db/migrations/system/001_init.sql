CREATE TABLE IF NOT EXISTS schema_versions (
  db_kind       TEXT NOT NULL,
  identifier    TEXT NOT NULL,
  version       INTEGER NOT NULL,
  applied_at    TEXT NOT NULL,
  PRIMARY KEY (db_kind, identifier)
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  timezone      TEXT NOT NULL DEFAULT 'UTC',
  day_start     TEXT NOT NULL DEFAULT '07:00',
  day_end       TEXT NOT NULL DEFAULT '23:00',
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_clients (
  id                       TEXT PRIMARY KEY,
  client_secret            TEXT,
  redirect_uris            TEXT NOT NULL,
  name                     TEXT NOT NULL,
  application_type        TEXT NOT NULL DEFAULT 'web',
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
  created_at               TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  code                   TEXT PRIMARY KEY,
  user_id                TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id              TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  redirect_uri           TEXT NOT NULL,
  code_challenge         TEXT NOT NULL,
  code_challenge_method  TEXT NOT NULL CHECK (code_challenge_method = 'S256'),
  resource               TEXT NOT NULL,
  scope                  TEXT NOT NULL,
  expires_at             TEXT NOT NULL,
  used_at                TEXT,
  created_at             TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id   TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('access', 'refresh')),
  resource    TEXT NOT NULL,
  scope       TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user ON oauth_tokens(user_id, type);
CREATE INDEX IF NOT EXISTS idx_oauth_codes_expiry ON oauth_authorization_codes(expires_at);
