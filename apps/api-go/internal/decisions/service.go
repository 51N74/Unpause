package decisions

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/westride/unpause/api-go/internal/shared"
)

const baseSelectDecisionSQL = `
SELECT d."id", d."projectId", d."scopeVersionId",
       sv."versionNumber", sv."reasonForChange", sv."createdAt",
       d."issueId", i."title", i."status"::text,
       d."problem", d."decision", d."rationale",
       d."alternativesConsidered", d."outcome",
       d."scopeImpact"::text, d."isPinned", d."pinnedAt",
       d."createdAt", d."updatedAt"
FROM "DecisionRecord" d
INNER JOIN "ScopeVersion" sv ON sv."id" = d."scopeVersionId"
LEFT JOIN "Issue" i ON i."id" = d."issueId"
`

func scanDecisionRow(row pgx.Row) (DecisionRecord, error) {
	var d DecisionRecord
	err := row.Scan(
		&d.ID,
		&d.ProjectID,
		&d.ScopeVersionID,
		&d.ScopeVersionNumber,
		&d.ScopeReasonForChange,
		&d.ScopeCreatedAt,
		&d.IssueID,
		&d.IssueTitle,
		&d.IssueStatus,
		&d.Problem,
		&d.Decision,
		&d.Rationale,
		&d.AlternativesConsidered,
		&d.Outcome,
		&d.ScopeImpact,
		&d.IsPinned,
		&d.PinnedAt,
		&d.CreatedAt,
		&d.UpdatedAt,
	)
	return d, err
}

// Service implements Decision Record CRUD, pinning, filtering, and scope-version binding rules.
type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

func (s *Service) verifyIssueInProject(ctx context.Context, projectID string, issueID *string) error {
	if issueID == nil || *issueID == "" {
		return nil
	}
	var foundID string
	err := s.pool.QueryRow(
		ctx,
		`SELECT "id" FROM "Issue" WHERE "id" = $1 AND "projectId" = $2`,
		*issueID, projectID,
	).Scan(&foundID)
	if errors.Is(err, pgx.ErrNoRows) {
		return shared.NewValidationError("Linked issue does not exist in this project", nil)
	}
	return err
}

// List returns Decision Records for a project matching optional search and filter criteria.
func (s *Service) List(ctx context.Context, userID, projectID string, filter ListDecisionsFilter) ([]DecisionResponse, error) {
	if _, err := shared.VerifyProjectOwnership(ctx, s.pool, userID, projectID, false); err != nil {
		return nil, err
	}

	whereClauses := []string{`d."projectId" = $1`}
	args := []any{projectID}
	argIdx := 2

	if filter.ScopeImpact != "" {
		whereClauses = append(whereClauses, fmt.Sprintf(`d."scopeImpact" = $%d::"ScopeImpact"`, argIdx))
		args = append(args, filter.ScopeImpact)
		argIdx++
	}

	if filter.ScopeVersionID != "" {
		whereClauses = append(whereClauses, fmt.Sprintf(`d."scopeVersionId" = $%d`, argIdx))
		args = append(args, filter.ScopeVersionID)
		argIdx++
	}

	if filter.PinnedOnly {
		whereClauses = append(whereClauses, `d."isPinned" = true`)
	}

	if q := strings.TrimSpace(filter.Search); q != "" {
		whereClauses = append(
			whereClauses,
			fmt.Sprintf(`(d."problem" ILIKE '%%' || $%d || '%%' ESCAPE '\' OR d."decision" ILIKE '%%' || $%d || '%%' ESCAPE '\')`, argIdx, argIdx),
		)
		args = append(args, shared.EscapeLikePattern(q))
		argIdx++
	}

	query := fmt.Sprintf(
		`%s WHERE %s ORDER BY d."isPinned" DESC, d."createdAt" DESC`,
		baseSelectDecisionSQL,
		strings.Join(whereClauses, " AND "),
	)

	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	results := make([]DecisionResponse, 0)
	for rows.Next() {
		d, err := scanDecisionRow(rows)
		if err != nil {
			return nil, err
		}
		results = append(results, SerializeDecision(d))
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return results, nil
}

// Create records a new Decision Record and automatically associates it with the project's current Scope Version.
func (s *Service) Create(ctx context.Context, userID, projectID string, input CreateDecisionInput) (DecisionResponse, error) {
	info, err := shared.VerifyProjectOwnership(ctx, s.pool, userID, projectID, true)
	if err != nil {
		return DecisionResponse{}, err
	}
	if info.CurrentScopeID == "" {
		return DecisionResponse{}, shared.NewValidationError("Project does not have an active scope version", nil)
	}

	if err := s.verifyIssueInProject(ctx, projectID, input.IssueID); err != nil {
		return DecisionResponse{}, err
	}

	now := time.Now().UTC()
	decisionID := uuid.NewString()

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DecisionResponse{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	_, err = tx.Exec(
		ctx,
		`INSERT INTO "DecisionRecord" (
		    "id", "projectId", "scopeVersionId", "issueId",
		    "problem", "decision", "rationale",
		    "alternativesConsidered", "outcome", "scopeImpact",
		    "isPinned", "pinnedAt", "createdAt", "updatedAt"
		 )
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::"ScopeImpact", false, NULL, $11, $11)`,
		decisionID,
		projectID,
		info.CurrentScopeID,
		input.IssueID,
		input.Problem,
		input.Decision,
		input.Rationale,
		input.AlternativesConsidered,
		input.Outcome,
		input.ScopeImpact,
		now,
	)
	if err != nil {
		return DecisionResponse{}, err
	}

	_, err = tx.Exec(
		ctx,
		`UPDATE "Project" SET "updatedAt" = $1 WHERE "id" = $2`,
		now, projectID,
	)
	if err != nil {
		return DecisionResponse{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return DecisionResponse{}, err
	}

	return s.GetByID(ctx, userID, projectID, decisionID)
}

// GetByID fetches a single Decision Record belonging to the project.
func (s *Service) GetByID(ctx context.Context, userID, projectID, decisionID string) (DecisionResponse, error) {
	if _, err := shared.VerifyProjectOwnership(ctx, s.pool, userID, projectID, false); err != nil {
		return DecisionResponse{}, err
	}

	query := baseSelectDecisionSQL + ` WHERE d."id" = $1 AND d."projectId" = $2`
	d, err := scanDecisionRow(s.pool.QueryRow(ctx, query, decisionID, projectID))
	if errors.Is(err, pgx.ErrNoRows) {
		return DecisionResponse{}, shared.NewNotFoundError("Decision record not found")
	}
	if err != nil {
		return DecisionResponse{}, err
	}

	return SerializeDecision(d), nil
}

// Update modifies a Decision Record's content fields while strictly preserving its original scopeVersionId.
func (s *Service) Update(ctx context.Context, userID, projectID, decisionID string, req UpdateDecisionRequest) (DecisionResponse, error) {
	if _, err := shared.VerifyProjectOwnership(ctx, s.pool, userID, projectID, true); err != nil {
		return DecisionResponse{}, err
	}

	query := baseSelectDecisionSQL + ` WHERE d."id" = $1 AND d."projectId" = $2`
	existing, err := scanDecisionRow(s.pool.QueryRow(ctx, query, decisionID, projectID))
	if errors.Is(err, pgx.ErrNoRows) {
		return DecisionResponse{}, shared.NewNotFoundError("Decision record not found")
	}
	if err != nil {
		return DecisionResponse{}, err
	}

	problem := existing.Problem
	if req.Problem != nil {
		problem = *req.Problem
	}
	decisionText := existing.Decision
	if req.Decision != nil {
		decisionText = *req.Decision
	}
	rationale := existing.Rationale
	if req.Rationale != nil {
		rationale = *req.Rationale
	}
	alt := ""
	if existing.AlternativesConsidered != nil {
		alt = *existing.AlternativesConsidered
	}
	if req.AlternativesConsidered != nil {
		alt = *req.AlternativesConsidered
	}
	outcome := ""
	if existing.Outcome != nil {
		outcome = *existing.Outcome
	}
	if req.Outcome != nil {
		outcome = *req.Outcome
	}
	scopeImpact := existing.ScopeImpact
	if req.ScopeImpact != nil {
		scopeImpact = *req.ScopeImpact
	}

	issueID := existing.IssueID
	if req.HasIssueIDField {
		if req.IssueID == nil || strings.TrimSpace(*req.IssueID) == "" {
			issueID = nil
		} else {
			trimmed := strings.TrimSpace(*req.IssueID)
			issueID = &trimmed
		}
	}

	if err := s.verifyIssueInProject(ctx, projectID, issueID); err != nil {
		return DecisionResponse{}, err
	}

	now := time.Now().UTC()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DecisionResponse{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	// Note: "scopeVersionId" is intentionally omitted from the UPDATE statement so it is never altered.
	_, err = tx.Exec(
		ctx,
		`UPDATE "DecisionRecord"
		 SET "problem" = $1,
		     "decision" = $2,
		     "rationale" = $3,
		     "alternativesConsidered" = $4,
		     "outcome" = $5,
		     "scopeImpact" = $6::"ScopeImpact",
		     "issueId" = $7,
		     "updatedAt" = $8
		 WHERE "id" = $9 AND "projectId" = $10`,
		problem,
		decisionText,
		rationale,
		alt,
		outcome,
		scopeImpact,
		issueID,
		now,
		decisionID,
		projectID,
	)
	if err != nil {
		return DecisionResponse{}, err
	}

	_, err = tx.Exec(
		ctx,
		`UPDATE "Project" SET "updatedAt" = $1 WHERE "id" = $2`,
		now, projectID,
	)
	if err != nil {
		return DecisionResponse{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return DecisionResponse{}, err
	}

	return s.GetByID(ctx, userID, projectID, decisionID)
}

// SetPinned pins or unpins a Decision Record WITHOUT modifying its content-modified timestamp (updatedAt).
func (s *Service) SetPinned(ctx context.Context, userID, projectID, decisionID string, isPinned bool) (DecisionResponse, error) {
	if _, err := shared.VerifyProjectOwnership(ctx, s.pool, userID, projectID, true); err != nil {
		return DecisionResponse{}, err
	}

	var existingID string
	err := s.pool.QueryRow(
		ctx,
		`SELECT "id" FROM "DecisionRecord" WHERE "id" = $1 AND "projectId" = $2`,
		decisionID, projectID,
	).Scan(&existingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return DecisionResponse{}, shared.NewNotFoundError("Decision record not found")
	}
	if err != nil {
		return DecisionResponse{}, err
	}

	var pinnedAt *time.Time
	if isPinned {
		now := time.Now().UTC()
		pinnedAt = &now
	}

	// CRITICAL: Do NOT update "updatedAt" when pinning or unpinning.
	_, err = s.pool.Exec(
		ctx,
		`UPDATE "DecisionRecord"
		 SET "isPinned" = $1, "pinnedAt" = $2
		 WHERE "id" = $3 AND "projectId" = $4`,
		isPinned, pinnedAt, decisionID, projectID,
	)
	if err != nil {
		return DecisionResponse{}, err
	}

	return s.GetByID(ctx, userID, projectID, decisionID)
}

// Delete removes a Decision Record from the project.
func (s *Service) Delete(ctx context.Context, userID, projectID, decisionID string) error {
	if _, err := shared.VerifyProjectOwnership(ctx, s.pool, userID, projectID, true); err != nil {
		return err
	}

	var existingID string
	err := s.pool.QueryRow(
		ctx,
		`SELECT "id" FROM "DecisionRecord" WHERE "id" = $1 AND "projectId" = $2`,
		decisionID, projectID,
	).Scan(&existingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return shared.NewNotFoundError("Decision record not found")
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

	if _, err := tx.Exec(ctx, `DELETE FROM "DecisionRecord" WHERE "id" = $1 AND "projectId" = $2`, decisionID, projectID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE "Project" SET "updatedAt" = $1 WHERE "id" = $2`, now, projectID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// ListByIssueID returns all Decision Records linked to a specific issue (ordered by createdAt DESC).
func (s *Service) ListByIssueID(ctx context.Context, projectID, issueID string) ([]DecisionResponse, error) {
	query := baseSelectDecisionSQL + ` WHERE d."projectId" = $1 AND d."issueId" = $2 ORDER BY d."createdAt" DESC`
	rows, err := s.pool.Query(ctx, query, projectID, issueID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := make([]DecisionResponse, 0)
	for rows.Next() {
		d, err := scanDecisionRow(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, SerializeDecision(d))
	}
	return list, rows.Err()
}
