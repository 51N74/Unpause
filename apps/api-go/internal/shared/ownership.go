package shared

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// OwnedProjectInfo holds essential ownership and current scope metadata for a user's project.
type OwnedProjectInfo struct {
	ID                   string
	UserID               string
	Status               string
	CurrentScopeID       string
	CurrentVersionNumber int
}

// VerifyProjectOwnership checks that projectID exists and belongs to userID.
// When requireActive is true, it also rejects archived projects with 409 PROJECT_ARCHIVED.
func VerifyProjectOwnership(
	ctx context.Context,
	pool *pgxpool.Pool,
	userID string,
	projectID string,
	requireActive bool,
) (*OwnedProjectInfo, error) {
	var info OwnedProjectInfo
	err := pool.QueryRow(
		ctx,
		`SELECT p."id", p."userId", p."status"::text,
		        COALESCE(sv."id", ''), COALESCE(sv."versionNumber", 0)
		 FROM "Project" p
		 LEFT JOIN LATERAL (
		     SELECT "id", "versionNumber"
		     FROM "ScopeVersion"
		     WHERE "projectId" = p."id"
		     ORDER BY "versionNumber" DESC
		     LIMIT 1
		 ) sv ON true
		 WHERE p."id" = $1 AND p."userId" = $2`,
		projectID, userID,
	).Scan(&info.ID, &info.UserID, &info.Status, &info.CurrentScopeID, &info.CurrentVersionNumber)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, NewNotFoundError("Project not found")
	}
	if err != nil {
		return nil, err
	}

	if requireActive && info.Status == "Archived" {
		return nil, NewProjectArchivedError()
	}

	return &info, nil
}
