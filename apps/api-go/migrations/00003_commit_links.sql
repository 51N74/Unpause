-- +goose Up
CREATE TABLE git_activity_link (
    connection_id TEXT NOT NULL,
    sha TEXT NOT NULL,
    issue_id TEXT REFERENCES "Issue"("id") ON DELETE SET NULL,
    decision_id TEXT REFERENCES "DecisionRecord"("id") ON DELETE SET NULL,
    PRIMARY KEY (connection_id, sha),
    FOREIGN KEY (connection_id, sha) REFERENCES git_activity(connection_id, sha) ON DELETE CASCADE
);
CREATE INDEX git_activity_link_issue ON git_activity_link(issue_id) WHERE issue_id IS NOT NULL;
CREATE INDEX git_activity_link_decision ON git_activity_link(decision_id) WHERE decision_id IS NOT NULL;
-- +goose Down
DROP TABLE git_activity_link;
