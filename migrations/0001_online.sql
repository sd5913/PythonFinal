CREATE TABLE github_users (
    github_id TEXT PRIMARY KEY NOT NULL,
    login TEXT NOT NULL
);

CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY NOT NULL,
    github_id TEXT NOT NULL REFERENCES github_users(github_id),
    expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE oauth_attempts (
    state_hash TEXT PRIMARY KEY NOT NULL,
    browser_hash TEXT NOT NULL,
    verifier TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX oauth_attempts_expiry ON oauth_attempts(expires_at);

CREATE TABLE online_rooms (
    code TEXT PRIMARY KEY NOT NULL,
    creator_id TEXT NOT NULL REFERENCES github_users(github_id),
    invite_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL
);
CREATE INDEX online_rooms_expiry ON online_rooms(expires_at);
