-- +goose Up
CREATE TABLE project_repository (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL UNIQUE REFERENCES "Project"("id") ON DELETE CASCADE,
    repository_id BIGINT NOT NULL,
    full_name TEXT NOT NULL,
    branch TEXT NOT NULL,
    credential_hash BYTEA NOT NULL,
    last_delivery_at TIMESTAMPTZ,
    last_synced_at TIMESTAMPTZ,
    last_git_activity_at TIMESTAMPTZ,
    last_attempt_at TIMESTAMPTZ,
    sync_token TEXT,
    sync_until TIMESTAMPTZ,
    sync_error BOOLEAN NOT NULL DEFAULT false,
    incomplete BOOLEAN NOT NULL DEFAULT false,
    head_sha TEXT NOT NULL DEFAULT '',
    sequence BIGINT NOT NULL DEFAULT 0,
    reviewed_sequence BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE git_delivery (
    connection_id TEXT NOT NULL REFERENCES project_repository(id) ON DELETE CASCADE,
    delivery_id TEXT NOT NULL,
    sequence BIGINT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('actions', 'recovery')),
    event_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(connection_id, delivery_id)
);
CREATE TABLE git_activity (
    connection_id TEXT NOT NULL,
    sha TEXT NOT NULL,
    delivery_id TEXT NOT NULL,
    message TEXT NOT NULL,
    author_name TEXT NOT NULL,
    event_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY(connection_id, sha),
    FOREIGN KEY(connection_id, delivery_id) REFERENCES git_delivery(connection_id, delivery_id) ON DELETE CASCADE
);
CREATE INDEX git_delivery_recent ON git_delivery(connection_id, sequence DESC);
CREATE TABLE project_return_context (
    project_id TEXT PRIMARY KEY REFERENCES "Project"("id") ON DELETE CASCADE,
    note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 5000),
    focus_issue_id TEXT REFERENCES "Issue"("id") ON DELETE SET NULL
);
-- +goose Down
DROP TABLE project_return_context;
DROP TABLE git_activity;
DROP TABLE git_delivery;
DROP TABLE project_repository;
