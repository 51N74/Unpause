package issues

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/westride/unpause/api-go/internal/decisions"
	"github.com/westride/unpause/api-go/internal/shared"
)

// Service implements Issue CRUD, filtering, pagination, and status change rules.
type Service struct {
	pool            *pgxpool.Pool
	decisionService *decisions.Service
}

func NewService(pool *pgxpool.Pool, decisionService *decisions.Service) *Service {
	return &Service{
		pool:            pool,
		decisionService: decisionService,
	}
}

func scanIssueRow(row pgx.Row) (Issue, error) {
	var i Issue
	err := row.Scan(
		&i.ID,
		&i.ProjectID,
		&i.Title,
		&i.Description,
		&i.Status,
		&i.Priority,
		&i.NextAction,
		&i.CreatedAt,
		&i.UpdatedAt,
	)
	return i, err
}

// List returns paginated Issues for a project ordered by updatedAt DESC.
func (s *Service) List(ctx context.Context, userID, projectID string, filter ListIssuesFilter) (PaginatedIssuesResponse, error) {
	if _, err := shared.VerifyProjectOwnership(ctx, s.pool, userID, projectID, false); err != nil {
		return PaginatedIssuesResponse{}, err
	}

	whereClauses := []string{`"projectId" = $1`}
	args := []any{projectID}
	argIdx := 2

	if filter.Status != "" {
		whereClauses = append(whereClauses, fmt.Sprintf(`"status" = $%d::"IssueStatus"`, argIdx))
		args = append(args, filter.Status)
		argIdx++
	}

	if filter.Priority != "" {
		whereClauses = append(whereClauses, fmt.Sprintf(`"priority" = $%d::"IssuePriority"`, argIdx))
		args = append(args, filter.Priority)
		argIdx++
	}

	if q := strings.TrimSpace(filter.Search); q != "" {
		whereClauses = append(
			whereClauses,
			fmt.Sprintf(
				`("title" ILIKE '%%' || $%d || '%%' ESCAPE '\' OR COALESCE("description", '') ILIKE '%%' || $%d || '%%' ESCAPE '\' OR "nextAction" ILIKE '%%' || $%d || '%%' ESCAPE '\')`,
				argIdx, argIdx, argIdx,
			),
		)
		args = append(args, shared.EscapeLikePattern(q))
		argIdx++
	}

	whereSQL := strings.Join(whereClauses, " AND ")

	var total int
	countSQL := fmt.Sprintf(`SELECT COUNT(*) FROM "Issue" WHERE %s`, whereSQL)
	if err := s.pool.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
		return PaginatedIssuesResponse{}, err
	}

	skip := (filter.Page - 1) * filter.PageSize
	listArgs := append(append([]any{}, args...), filter.PageSize, skip)
	listSQL := fmt.Sprintf(
		`SELECT "id", "projectId", "title", "description", "status"::text, "priority"::text,
		        "nextAction", "createdAt", "updatedAt"
		 FROM "Issue"
		 WHERE %s
		 ORDER BY "updatedAt" DESC
		 LIMIT $%d OFFSET $%d`,
		whereSQL, argIdx, argIdx+1,
	)

	rows, err := s.pool.Query(ctx, listSQL, listArgs...)
	if err != nil {
		return PaginatedIssuesResponse{}, err
	}
	defer rows.Close()

	items := make([]IssueResponse, 0)
	for rows.Next() {
		iss, err := scanIssueRow(rows)
		if err != nil {
			return PaginatedIssuesResponse{}, err
		}
		items = append(items, SerializeIssue(iss))
	}
	if err := rows.Err(); err != nil {
		return PaginatedIssuesResponse{}, err
	}

	totalPages := int(math.Ceil(float64(total) / float64(filter.PageSize)))
	if totalPages < 1 {
		totalPages = 1
	}

	return PaginatedIssuesResponse{
		Items:      items,
		Total:      total,
		Page:       filter.Page,
		PageSize:   filter.PageSize,
		TotalPages: totalPages,
	}, nil
}

// Create inserts a new Issue and updates the parent project's updatedAt timestamp.
func (s *Service) Create(ctx context.Context, userID, projectID string, input CreateIssueInput) (IssueResponse, error) {
	if _, err := shared.VerifyProjectOwnership(ctx, s.pool, userID, projectID, true); err != nil {
		return IssueResponse{}, err
	}

	now := time.Now().UTC()
	issueID := uuid.NewString()

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return IssueResponse{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	row := tx.QueryRow(
		ctx,
		`INSERT INTO "Issue" (
		    "id", "projectId", "title", "description",
		    "status", "priority", "nextAction", "createdAt", "updatedAt"
		 )
		 VALUES ($1, $2, $3, $4, $5::"IssueStatus", $6::"IssuePriority", $7, $8, $8)
		 RETURNING "id", "projectId", "title", "description", "status"::text, "priority"::text,
		           "nextAction", "createdAt", "updatedAt"`,
		issueID,
		projectID,
		input.Title,
		input.Description,
		input.Status,
		input.Priority,
		input.NextAction,
		now,
	)
	iss, err := scanIssueRow(row)
	if err != nil {
		return IssueResponse{}, err
	}

	if _, err := tx.Exec(ctx, `UPDATE "Project" SET "updatedAt" = $1 WHERE "id" = $2`, now, projectID); err != nil {
		return IssueResponse{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return IssueResponse{}, err
	}

	return SerializeIssue(iss), nil
}

// GetByID retrieves a single Issue and its associated Decision Records.
func (s *Service) GetByID(ctx context.Context, userID, projectID, issueID string) (IssueDetailResponse, error) {
	if _, err := shared.VerifyProjectOwnership(ctx, s.pool, userID, projectID, false); err != nil {
		return IssueDetailResponse{}, err
	}

	row := s.pool.QueryRow(
		ctx,
		`SELECT "id", "projectId", "title", "description", "status"::text, "priority"::text,
		        "nextAction", "createdAt", "updatedAt"
		 FROM "Issue"
		 WHERE "id" = $1 AND "projectId" = $2`,
		issueID, projectID,
	)
	iss, err := scanIssueRow(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return IssueDetailResponse{}, shared.NewNotFoundError("Issue not found")
	}
	if err != nil {
		return IssueDetailResponse{}, err
	}

	linkedDecisions, err := s.decisionService.ListByIssueID(ctx, projectID, issueID)
	if err != nil {
		return IssueDetailResponse{}, err
	}

	return IssueDetailResponse{
		IssueResponse:   SerializeIssue(iss),
		DecisionRecords: linkedDecisions,
	}, nil
}

// Update modifies an Issue's fields and bumps updatedAt on both the Issue and parent Project.
func (s *Service) Update(ctx context.Context, userID, projectID, issueID string, req UpdateIssueRequest) (IssueResponse, error) {
	if _, err := shared.VerifyProjectOwnership(ctx, s.pool, userID, projectID, true); err != nil {
		return IssueResponse{}, err
	}

	row := s.pool.QueryRow(
		ctx,
		`SELECT "id", "projectId", "title", "description", "status"::text, "priority"::text,
		        "nextAction", "createdAt", "updatedAt"
		 FROM "Issue"
		 WHERE "id" = $1 AND "projectId" = $2`,
		issueID, projectID,
	)
	existing, err := scanIssueRow(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return IssueResponse{}, shared.NewNotFoundError("Issue not found")
	}
	if err != nil {
		return IssueResponse{}, err
	}

	title := existing.Title
	if req.Title != nil {
		title = *req.Title
	}
	desc := ""
	if existing.Description != nil {
		desc = *existing.Description
	}
	if req.Description != nil {
		desc = *req.Description
	}
	status := existing.Status
	if req.Status != nil {
		status = *req.Status
	}
	priority := existing.Priority
	if req.Priority != nil {
		priority = *req.Priority
	}
	nextAction := existing.NextAction
	if req.NextAction != nil {
		nextAction = *req.NextAction
	}

	now := time.Now().UTC()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return IssueResponse{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	updatedRow := tx.QueryRow(
		ctx,
		`UPDATE "Issue"
		 SET "title" = $1,
		     "description" = $2,
		     "status" = $3::"IssueStatus",
		     "priority" = $4::"IssuePriority",
		     "nextAction" = $5,
		     "updatedAt" = $6
		 WHERE "id" = $7 AND "projectId" = $8
		 RETURNING "id", "projectId", "title", "description", "status"::text, "priority"::text,
		           "nextAction", "createdAt", "updatedAt"`,
		title, desc, status, priority, nextAction, now, issueID, projectID,
	)
	updated, err := scanIssueRow(updatedRow)
	if err != nil {
		return IssueResponse{}, err
	}

	if _, err := tx.Exec(ctx, `UPDATE "Project" SET "updatedAt" = $1 WHERE "id" = $2`, now, projectID); err != nil {
		return IssueResponse{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return IssueResponse{}, err
	}

	return SerializeIssue(updated), nil
}

// Delete removes an Issue. Because DecisionRecord.issueId uses ON DELETE SET NULL,
// any Decision Records linked to this Issue are retained with their issueId cleared.
func (s *Service) Delete(ctx context.Context, userID, projectID, issueID string) error {
	if _, err := shared.VerifyProjectOwnership(ctx, s.pool, userID, projectID, true); err != nil {
		return err
	}

	var existingID string
	err := s.pool.QueryRow(
		ctx,
		`SELECT "id" FROM "Issue" WHERE "id" = $1 AND "projectId" = $2`,
		issueID, projectID,
	).Scan(&existingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return shared.NewNotFoundError("Issue not found")
	}
	if err != nil {
		return err
	}

	now := time.Now().UTC()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if _, err := tx.Exec(ctx, `DELETE FROM "Issue" WHERE "id" = $1 AND "projectId" = $2`, issueID, projectID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE "Project" SET "updatedAt" = $1 WHERE "id" = $2`, now, projectID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}
