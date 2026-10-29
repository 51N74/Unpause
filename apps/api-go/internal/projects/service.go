package projects

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/westride/unpause/api-go/internal/decisions"
	"github.com/westride/unpause/api-go/internal/issues"
	"github.com/westride/unpause/api-go/internal/scopes"
	"github.com/westride/unpause/api-go/internal/shared"
)

const selectProjectWithLatestScopeSQL = `
SELECT p."id", p."userId", p."name", p."description", p."status"::text,
       p."createdAt", p."updatedAt",
       sv."id", sv."projectId", sv."versionNumber", sv."problem",
       sv."targetUsers", sv."goal", sv."inScope", sv."outOfScope",
       sv."reasonForChange", sv."createdAt"
FROM "Project" p
LEFT JOIN LATERAL (
    SELECT "id", "projectId", "versionNumber", "problem", "targetUsers",
           "goal", "inScope", "outOfScope", "reasonForChange", "createdAt"
    FROM "ScopeVersion"
    WHERE "projectId" = p."id"
    ORDER BY "versionNumber" DESC
    LIMIT 1
) sv ON true
`

func scanProjectWithScope(row pgx.Row) (Project, error) {
	var p Project
	var svID, svProjID, svProb, svUsers, svGoal, svIn, svOut, svReason *string
	var svVer *int
	var svCreated *time.Time

	err := row.Scan(
		&p.ID,
		&p.UserID,
		&p.Name,
		&p.Description,
		&p.Status,
		&p.CreatedAt,
		&p.UpdatedAt,
		&svID,
		&svProjID,
		&svVer,
		&svProb,
		&svUsers,
		&svGoal,
		&svIn,
		&svOut,
		&svReason,
		&svCreated,
	)
	if err != nil {
		return Project{}, err
	}

	if svID != nil && svVer != nil && svCreated != nil {
		p.LatestScope = &scopes.ScopeVersion{
			ID:              *svID,
			ProjectID:       *svProjID,
			VersionNumber:   *svVer,
			Problem:         *svProb,
			TargetUsers:     *svUsers,
			Goal:            *svGoal,
			InScope:         *svIn,
			OutOfScope:      *svOut,
			ReasonForChange: *svReason,
			CreatedAt:       *svCreated,
		}
	}

	return p, nil
}

// Service implements business rules for Projects, Resume Context, and Scope Timeline.
type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

func (s *Service) getOwnedProject(ctx context.Context, userID, projectID string) (Project, error) {
	query := selectProjectWithLatestScopeSQL + ` WHERE p."id" = $1 AND p."userId" = $2`
	p, err := scanProjectWithScope(s.pool.QueryRow(ctx, query, projectID, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Project{}, shared.NewNotFoundError("Project not found")
	}
	if err != nil {
		return Project{}, err
	}
	return p, nil
}

// List returns projects owned by userID filtered by optional search query and status ('Active', 'Archived', 'All').
func (s *Service) List(ctx context.Context, userID, search, status string) ([]ProjectResponse, error) {
	whereClauses := []string{`p."userId" = $1`}
	args := []any{userID}
	argIdx := 2

	if status != "" && status != "All" {
		whereClauses = append(whereClauses, fmt.Sprintf(`p."status" = $%d::"ProjectStatus"`, argIdx))
		args = append(args, status)
		argIdx++
	}

	if q := strings.TrimSpace(search); q != "" {
		whereClauses = append(whereClauses, fmt.Sprintf(`p."name" ILIKE '%%' || $%d || '%%' ESCAPE '\'`, argIdx))
		args = append(args, shared.EscapeLikePattern(q))
		argIdx++
	}

	query := fmt.Sprintf(
		`%s WHERE %s ORDER BY p."updatedAt" DESC`,
		selectProjectWithLatestScopeSQL,
		strings.Join(whereClauses, " AND "),
	)

	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := make([]ProjectResponse, 0)
	for rows.Next() {
		p, err := scanProjectWithScope(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, SerializeProject(p))
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return list, nil
}

// CreateWithInitialScope atomically creates a new Project and its initial Scope Version 1 in a single transaction.
func (s *Service) CreateWithInitialScope(
	ctx context.Context,
	userID string,
	input CreateProjectInput,
) (ProjectResponse, scopes.ScopeVersionResponse, error) {
	now := time.Now().UTC()
	projectID := uuid.NewString()
	scopeID := uuid.NewString()

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ProjectResponse{}, scopes.ScopeVersionResponse{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	var p Project
	err = tx.QueryRow(
		ctx,
		`INSERT INTO "Project" ("id", "userId", "name", "description", "status", "createdAt", "updatedAt")
		 VALUES ($1, $2, $3, $4, 'Active'::"ProjectStatus", $5, $5)
		 RETURNING "id", "userId", "name", "description", "status"::text, "createdAt", "updatedAt"`,
		projectID, userID, input.Name, input.Description, now,
	).Scan(&p.ID, &p.UserID, &p.Name, &p.Description, &p.Status, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return ProjectResponse{}, scopes.ScopeVersionResponse{}, err
	}

	var sv scopes.ScopeVersion
	err = tx.QueryRow(
		ctx,
		`INSERT INTO "ScopeVersion" (
		    "id", "projectId", "versionNumber", "problem", "targetUsers",
		    "goal", "inScope", "outOfScope", "reasonForChange", "createdAt"
		 )
		 VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9)
		 RETURNING "id", "projectId", "versionNumber", "problem", "targetUsers",
		           "goal", "inScope", "outOfScope", "reasonForChange", "createdAt"`,
		scopeID,
		projectID,
		input.Problem,
		input.TargetUsers,
		input.Goal,
		input.InScope,
		input.OutOfScope,
		InitialScopeReason,
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
		return ProjectResponse{}, scopes.ScopeVersionResponse{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return ProjectResponse{}, scopes.ScopeVersionResponse{}, err
	}

	p.LatestScope = &sv
	return SerializeProject(p), scopes.SerializeScopeVersion(sv), nil
}

// GetByID returns details for an owned project.
func (s *Service) GetByID(ctx context.Context, userID, projectID string) (ProjectResponse, error) {
	p, err := s.getOwnedProject(ctx, userID, projectID)
	if err != nil {
		return ProjectResponse{}, err
	}
	return SerializeProject(p), nil
}

// Update modifies name/description of an active owned project.
func (s *Service) Update(ctx context.Context, userID, projectID string, req UpdateProjectRequest) (ProjectResponse, error) {
	p, err := s.getOwnedProject(ctx, userID, projectID)
	if err != nil {
		return ProjectResponse{}, err
	}
	if p.Status == "Archived" {
		return ProjectResponse{}, shared.NewProjectArchivedError()
	}

	name := p.Name
	if req.Name != nil {
		name = *req.Name
	}
	desc := ""
	if p.Description != nil {
		desc = *p.Description
	}
	if req.Description != nil {
		desc = *req.Description
	}

	now := time.Now().UTC()
	_, err = s.pool.Exec(
		ctx,
		`UPDATE "Project"
		 SET "name" = $1, "description" = $2, "updatedAt" = $3
		 WHERE "id" = $4 AND "userId" = $5`,
		name, desc, now, projectID, userID,
	)
	if err != nil {
		return ProjectResponse{}, err
	}

	return s.GetByID(ctx, userID, projectID)
}

// SetStatus transitions an owned project between 'Active' and 'Archived'.
func (s *Service) SetStatus(ctx context.Context, userID, projectID, status string) (ProjectResponse, error) {
	if _, err := s.getOwnedProject(ctx, userID, projectID); err != nil {
		return ProjectResponse{}, err
	}

	now := time.Now().UTC()
	_, err := s.pool.Exec(
		ctx,
		`UPDATE "Project"
		 SET "status" = $1::"ProjectStatus", "updatedAt" = $2
		 WHERE "id" = $3 AND "userId" = $4`,
		status, now, projectID, userID,
	)
	if err != nil {
		return ProjectResponse{}, err
	}

	return s.GetByID(ctx, userID, projectID)
}

// GetResumeContext builds the Resume Context view for an owned project.
func (s *Service) GetResumeContext(ctx context.Context, userID, projectID string) (ResumeContextResponse, error) {
	p, err := s.getOwnedProject(ctx, userID, projectID)
	if err != nil {
		return ResumeContextResponse{}, err
	}
	if p.LatestScope == nil {
		return ResumeContextResponse{}, shared.NewNotFoundError("Project has no scope version")
	}

	currentScope := scopes.SerializeScopeVersion(*p.LatestScope)

	// 1. Up to 3 pinned decisions
	pinnedRows, err := s.pool.Query(
		ctx,
		`SELECT d."id", d."projectId", d."scopeVersionId",
		        sv."versionNumber", sv."reasonForChange", sv."createdAt",
		        d."issueId", i."title", i."status"::text,
		        d."problem", d."decision", d."rationale",
		        d."alternativesConsidered", d."outcome",
		        d."scopeImpact"::text, d."isPinned", d."pinnedAt",
		        d."createdAt", d."updatedAt"
		 FROM "DecisionRecord" d
		 INNER JOIN "ScopeVersion" sv ON sv."id" = d."scopeVersionId"
		 LEFT JOIN "Issue" i ON i."id" = d."issueId"
		 WHERE d."projectId" = $1 AND d."isPinned" = true
		 ORDER BY d."pinnedAt" DESC NULLS LAST, d."createdAt" DESC
		 LIMIT 3`,
		projectID,
	)
	if err != nil {
		return ResumeContextResponse{}, err
	}
	defer pinnedRows.Close()

	pinnedDecisions := make([]decisions.DecisionResponse, 0)
	for pinnedRows.Next() {
		var d decisions.DecisionRecord
		if err := pinnedRows.Scan(
			&d.ID, &d.ProjectID, &d.ScopeVersionID,
			&d.ScopeVersionNumber, &d.ScopeReasonForChange, &d.ScopeCreatedAt,
			&d.IssueID, &d.IssueTitle, &d.IssueStatus,
			&d.Problem, &d.Decision, &d.Rationale,
			&d.AlternativesConsidered, &d.Outcome,
			&d.ScopeImpact, &d.IsPinned, &d.PinnedAt,
			&d.CreatedAt, &d.UpdatedAt,
		); err != nil {
			return ResumeContextResponse{}, err
		}
		pinnedDecisions = append(pinnedDecisions, decisions.SerializeDecision(d))
	}
	if err := pinnedRows.Err(); err != nil {
		return ResumeContextResponse{}, err
	}

	// 2. Up to 5 recent decisions made under the current scope version
	recentRows, err := s.pool.Query(
		ctx,
		`SELECT d."id", d."projectId", d."scopeVersionId",
		        sv."versionNumber", sv."reasonForChange", sv."createdAt",
		        d."issueId", i."title", i."status"::text,
		        d."problem", d."decision", d."rationale",
		        d."alternativesConsidered", d."outcome",
		        d."scopeImpact"::text, d."isPinned", d."pinnedAt",
		        d."createdAt", d."updatedAt"
		 FROM "DecisionRecord" d
		 INNER JOIN "ScopeVersion" sv ON sv."id" = d."scopeVersionId"
		 LEFT JOIN "Issue" i ON i."id" = d."issueId"
		 WHERE d."projectId" = $1 AND d."scopeVersionId" = $2
		 ORDER BY d."createdAt" DESC
		 LIMIT 5`,
		projectID, p.LatestScope.ID,
	)
	if err != nil {
		return ResumeContextResponse{}, err
	}
	defer recentRows.Close()

	recentDecisions := make([]decisions.DecisionResponse, 0)
	for recentRows.Next() {
		var d decisions.DecisionRecord
		if err := recentRows.Scan(
			&d.ID, &d.ProjectID, &d.ScopeVersionID,
			&d.ScopeVersionNumber, &d.ScopeReasonForChange, &d.ScopeCreatedAt,
			&d.IssueID, &d.IssueTitle, &d.IssueStatus,
			&d.Problem, &d.Decision, &d.Rationale,
			&d.AlternativesConsidered, &d.Outcome,
			&d.ScopeImpact, &d.IsPinned, &d.PinnedAt,
			&d.CreatedAt, &d.UpdatedAt,
		); err != nil {
			return ResumeContextResponse{}, err
		}
		recentDecisions = append(recentDecisions, decisions.SerializeDecision(d))
	}
	if err := recentRows.Err(); err != nil {
		return ResumeContextResponse{}, err
	}

	// 3. Up to 5 Open or In Progress issues ordered by priority (High -> Medium -> Low), then most recently modified
	issueRows, err := s.pool.Query(
		ctx,
		`SELECT "id", "projectId", "title", "description", "status"::text, "priority"::text,
		        "nextAction", "createdAt", "updatedAt"
		 FROM "Issue"
		 WHERE "projectId" = $1 AND "status" IN ('Open'::"IssueStatus", 'In Progress'::"IssueStatus")
		 ORDER BY
		   CASE "priority"
		     WHEN 'High'::"IssuePriority" THEN 1
		     WHEN 'Medium'::"IssuePriority" THEN 2
		     ELSE 3
		   END ASC,
		   "updatedAt" DESC
		 LIMIT 5`,
		projectID,
	)
	if err != nil {
		return ResumeContextResponse{}, err
	}
	defer issueRows.Close()

	outstandingIssues := make([]issues.IssueResponse, 0)
	for issueRows.Next() {
		var iss issues.Issue
		if err := issueRows.Scan(
			&iss.ID, &iss.ProjectID, &iss.Title, &iss.Description,
			&iss.Status, &iss.Priority, &iss.NextAction,
			&iss.CreatedAt, &iss.UpdatedAt,
		); err != nil {
			return ResumeContextResponse{}, err
		}
		outstandingIssues = append(outstandingIssues, issues.SerializeIssue(iss))
	}
	if err := issueRows.Err(); err != nil {
		return ResumeContextResponse{}, err
	}

	return ResumeContextResponse{
		Project:           SerializeProject(p),
		CurrentScope:      currentScope,
		PinnedDecisions:   pinnedDecisions,
		RecentDecisions:   recentDecisions,
		OutstandingIssues: outstandingIssues,
	}, nil
}

// GetScopeTimeline builds the chronological Scope Timeline by grouping Decision Records by scopeVersionId.
func (s *Service) GetScopeTimeline(ctx context.Context, userID, projectID string) (ScopeTimelineResponse, error) {
	p, err := s.getOwnedProject(ctx, userID, projectID)
	if err != nil {
		return ScopeTimelineResponse{}, err
	}

	svRows, err := s.pool.Query(
		ctx,
		`SELECT "id", "projectId", "versionNumber", "problem", "targetUsers", "goal",
		        "inScope", "outOfScope", "reasonForChange", "createdAt"
		 FROM "ScopeVersion"
		 WHERE "projectId" = $1
		 ORDER BY "versionNumber" ASC`,
		projectID,
	)
	if err != nil {
		return ScopeTimelineResponse{}, err
	}
	defer svRows.Close()

	rawVersions := make([]scopes.ScopeVersion, 0)
	for svRows.Next() {
		var sv scopes.ScopeVersion
		if err := svRows.Scan(
			&sv.ID, &sv.ProjectID, &sv.VersionNumber,
			&sv.Problem, &sv.TargetUsers, &sv.Goal,
			&sv.InScope, &sv.OutOfScope, &sv.ReasonForChange, &sv.CreatedAt,
		); err != nil {
			return ScopeTimelineResponse{}, err
		}
		rawVersions = append(rawVersions, sv)
	}
	if err := svRows.Err(); err != nil {
		return ScopeTimelineResponse{}, err
	}

	decRows, err := s.pool.Query(
		ctx,
		`SELECT d."id", d."projectId", d."scopeVersionId",
		        sv."versionNumber", sv."reasonForChange", sv."createdAt",
		        d."issueId", i."title", i."status"::text,
		        d."problem", d."decision", d."rationale",
		        d."alternativesConsidered", d."outcome",
		        d."scopeImpact"::text, d."isPinned", d."pinnedAt",
		        d."createdAt", d."updatedAt"
		 FROM "DecisionRecord" d
		 INNER JOIN "ScopeVersion" sv ON sv."id" = d."scopeVersionId"
		 LEFT JOIN "Issue" i ON i."id" = d."issueId"
		 WHERE d."projectId" = $1
		 ORDER BY d."createdAt" ASC`,
		projectID,
	)
	if err != nil {
		return ScopeTimelineResponse{}, err
	}
	defer decRows.Close()

	decisionsByScope := make(map[string][]decisions.DecisionResponse)
	for decRows.Next() {
		var d decisions.DecisionRecord
		if err := decRows.Scan(
			&d.ID, &d.ProjectID, &d.ScopeVersionID,
			&d.ScopeVersionNumber, &d.ScopeReasonForChange, &d.ScopeCreatedAt,
			&d.IssueID, &d.IssueTitle, &d.IssueStatus,
			&d.Problem, &d.Decision, &d.Rationale,
			&d.AlternativesConsidered, &d.Outcome,
			&d.ScopeImpact, &d.IsPinned, &d.PinnedAt,
			&d.CreatedAt, &d.UpdatedAt,
		); err != nil {
			return ScopeTimelineResponse{}, err
		}
		decisionsByScope[d.ScopeVersionID] = append(decisionsByScope[d.ScopeVersionID], decisions.SerializeDecision(d))
	}
	if err := decRows.Err(); err != nil {
		return ScopeTimelineResponse{}, err
	}

	maxVersionNumber := 0
	if len(rawVersions) > 0 {
		maxVersionNumber = rawVersions[len(rawVersions)-1].VersionNumber
	}

	timelineVersions := make([]TimelineScopeVersionResponse, 0, len(rawVersions))
	for _, sv := range rawVersions {
		decs := decisionsByScope[sv.ID]
		if decs == nil {
			decs = make([]decisions.DecisionResponse, 0)
		}
		timelineVersions = append(timelineVersions, TimelineScopeVersionResponse{
			ScopeVersionResponse: scopes.SerializeScopeVersion(sv),
			IsCurrent:            sv.VersionNumber == maxVersionNumber,
			Decisions:            decs,
		})
	}

	return ScopeTimelineResponse{
		Project:  SerializeProject(p),
		Versions: timelineVersions,
	}, nil
}
