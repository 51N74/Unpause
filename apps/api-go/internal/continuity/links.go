package continuity

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/westride/unpause/api-go/internal/shared"
)

type CommitLink struct {
	SHA           string  `json:"sha"`
	IssueID       *string `json:"issueId"`
	DecisionID    *string `json:"decisionId"`
	IssueTitle    *string `json:"issueTitle"`
	DecisionTitle *string `json:"decisionTitle"`
}

// LinkCommit only annotates cached commits; it never changes an issue, decision or review marker.
func (s *Service) LinkCommit(ctx context.Context, user, project, sha string, issue, decision *string) error {
	if !shaPattern.MatchString(sha) {
		return shared.NewValidationError("Invalid commit SHA", nil)
	}
	tx, err := s.ownedTx(ctx, user, project)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var connection string
	err = tx.QueryRow(ctx, `SELECT a.connection_id FROM git_activity a JOIN project_repository r ON r.id=a.connection_id WHERE r.project_id=$1 AND a.sha=$2 FOR UPDATE OF r`, project, sha).Scan(&connection)
	if errors.Is(err, pgx.ErrNoRows) {
		return shared.NewNotFoundError("Commit not found in this project")
	}
	if err != nil {
		return err
	}
	for _, target := range []struct {
		id    *string
		query string
	}{
		{issue, `SELECT "id" FROM "Issue" WHERE "id"=$1 AND "projectId"=$2 FOR KEY SHARE`},
		{decision, `SELECT "id" FROM "DecisionRecord" WHERE "id"=$1 AND "projectId"=$2 FOR KEY SHARE`},
	} {
		if target.id == nil {
			continue
		}
		var id string
		err = tx.QueryRow(ctx, target.query, *target.id, project).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return shared.NewValidationError("Linked records must belong to this project", nil)
		}
		if err != nil {
			return err
		}
	}
	if issue == nil && decision == nil {
		_, err = tx.Exec(ctx, `DELETE FROM git_activity_link WHERE connection_id=$1 AND sha=$2`, connection, sha)
	} else {
		_, err = tx.Exec(ctx, `INSERT INTO git_activity_link(connection_id,sha,issue_id,decision_id) VALUES($1,$2,$3,$4) ON CONFLICT(connection_id,sha) DO UPDATE SET issue_id=EXCLUDED.issue_id,decision_id=EXCLUDED.decision_id`, connection, sha, issue, decision)
	}
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
