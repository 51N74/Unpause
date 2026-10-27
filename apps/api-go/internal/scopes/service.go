package scopes

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/westride/unpause/api-go/internal/shared"
)

// Service implements business rules for listing and creating immutable Scope Versions.
type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// List returns all Scope Versions for a project ordered by versionNumber DESC, plus the currentScope.
func (s *Service) List(ctx context.Context, userID, projectID string) (*ScopeVersionResponse, []ScopeVersionResponse, error) {
	if _, err := shared.VerifyProjectOwnership(ctx, s.pool, userID, projectID, false); err != nil {
		return nil, nil, err
	}

	rows, err := s.pool.Query(
		ctx,
		`SELECT "id", "projectId", "versionNumber", "problem", "targetUsers", "goal",
		        "inScope", "outOfScope", "reasonForChange", "createdAt"
		 FROM "ScopeVersion"
		 WHERE "projectId" = $1
		 ORDER BY "versionNumber" DESC`,
		projectID,
	)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	versions := make([]ScopeVersionResponse, 0)
	for rows.Next() {
		var sv ScopeVersion
		if err := rows.Scan(
			&sv.ID,
			&sv.ProjectID,
			&sv.VersionNumber,
			&sv.Problem,
			&sv.TargetUsers,
			&sv.Goal,
			&sv.InScope,
			&sv.OutOfScope,
			&sv.ReasonForChange,
			&sv.CreatedAt,
		); err != nil {
			return nil, nil, err
		}
		versions = append(versions, SerializeScopeVersion(sv))
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}

	var currentScope *ScopeVersionResponse
	if len(versions) > 0 {
		first := versions[0]
		currentScope = &first
	}

	return currentScope, versions, nil
}

// VerifyOwnership checks that projectID exists and belongs to userID.
func (s *Service) VerifyOwnership(ctx context.Context, userID, projectID string) error {
	_, err := shared.VerifyProjectOwnership(ctx, s.pool, userID, projectID, false)
	return err
}

// Create inserts a new immutable Scope Version with the next sequential versionNumber in a transaction.
func (s *Service) Create(ctx context.Context, userID, projectID string, input CreateScopeVersionInput) (ScopeVersionResponse, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ScopeVersionResponse{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	var status string
	err = tx.QueryRow(
		ctx,
		`SELECT "status"::text FROM "Project" WHERE "id" = $1 AND "userId" = $2 FOR UPDATE`,
		projectID, userID,
	).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return ScopeVersionResponse{}, shared.NewNotFoundError("Project not found")
	}
	if err != nil {
		return ScopeVersionResponse{}, err
	}
	if status == "Archived" {
		return ScopeVersionResponse{}, shared.NewProjectArchivedError()
	}

	var currentVersion int
	err = tx.QueryRow(
		ctx,
		`SELECT COALESCE(MAX("versionNumber"), 0) FROM "ScopeVersion" WHERE "projectId" = $1`,
		projectID,
	).Scan(&currentVersion)
	if err != nil {
		return ScopeVersionResponse{}, err
	}

	nextVersion := currentVersion + 1
	now := time.Now().UTC()
	scopeID := uuid.NewString()

	var sv ScopeVersion
	err = tx.QueryRow(
		ctx,
		`INSERT INTO "ScopeVersion" (
		    "id", "projectId", "versionNumber", "problem", "targetUsers",
		    "goal", "inScope", "outOfScope", "reasonForChange", "createdAt"
		 )
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		 RETURNING "id", "projectId", "versionNumber", "problem", "targetUsers",
		           "goal", "inScope", "outOfScope", "reasonForChange", "createdAt"`,
		scopeID,
		projectID,
		nextVersion,
		input.Problem,
		input.TargetUsers,
		input.Goal,
		input.InScope,
		input.OutOfScope,
		input.ReasonForChange,
		now,
	).Scan(
		&sv.ID,
		&sv.ProjectID,
		&sv.VersionNumber,
		&sv.Problem,
		&sv.TargetUsers,
		&sv.Goal,
		&sv.InScope,
		&sv.OutOfScope,
		&sv.ReasonForChange,
		&sv.CreatedAt,
	)
	if err != nil {
		return ScopeVersionResponse{}, err
	}

	_, err = tx.Exec(
		ctx,
		`UPDATE "Project" SET "updatedAt" = $1 WHERE "id" = $2`,
		now, projectID,
	)
	if err != nil {
		return ScopeVersionResponse{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return ScopeVersionResponse{}, err
	}

	return SerializeScopeVersion(sv), nil
}

// GetByID retrieves a single Scope Version belonging to the project.
func (s *Service) GetByID(ctx context.Context, userID, projectID, versionID string) (ScopeVersionResponse, error) {
	if _, err := shared.VerifyProjectOwnership(ctx, s.pool, userID, projectID, false); err != nil {
		return ScopeVersionResponse{}, err
	}

	var sv ScopeVersion
	err := s.pool.QueryRow(
		ctx,
		`SELECT "id", "projectId", "versionNumber", "problem", "targetUsers", "goal",
		        "inScope", "outOfScope", "reasonForChange", "createdAt"
		 FROM "ScopeVersion"
		 WHERE "id" = $1 AND "projectId" = $2`,
		versionID, projectID,
	).Scan(
		&sv.ID,
		&sv.ProjectID,
		&sv.VersionNumber,
		&sv.Problem,
		&sv.TargetUsers,
		&sv.Goal,
		&sv.InScope,
		&sv.OutOfScope,
		&sv.ReasonForChange,
		&sv.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return ScopeVersionResponse{}, shared.NewNotFoundError("Scope version not found")
	}
	if err != nil {
		return ScopeVersionResponse{}, err
	}

	return SerializeScopeVersion(sv), nil
}
