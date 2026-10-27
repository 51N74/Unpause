// Package projects implements project management, Resume Context, and Scope Timeline views.
package projects

import (
	"time"

	"github.com/westride/unpause/api-go/internal/decisions"
	"github.com/westride/unpause/api-go/internal/issues"
	"github.com/westride/unpause/api-go/internal/scopes"
	"github.com/westride/unpause/api-go/internal/shared"
)

const InitialScopeReason = "Initial scope"

type Project struct {
	ID          string
	UserID      string
	Name        string
	Description *string
	Status      string
	CreatedAt   time.Time
	UpdatedAt   time.Time
	LatestScope *scopes.ScopeVersion
}

type ProjectResponse struct {
	ID                  string                       `json:"id"`
	Name                string                       `json:"name"`
	Description         string                       `json:"description"`
	Status              string                       `json:"status"`
	CurrentScopeVersion int                          `json:"currentScopeVersion"`
	CurrentScope        *scopes.ScopeVersionResponse `json:"currentScope"`
	CreatedAt           string                       `json:"createdAt"`
	UpdatedAt           string                       `json:"updatedAt"`
}

func SerializeProject(p Project) ProjectResponse {
	desc := ""
	if p.Description != nil {
		desc = *p.Description
	}

	currentVersionNum := 1
	var currentScopeResp *scopes.ScopeVersionResponse
	if p.LatestScope != nil {
		currentVersionNum = p.LatestScope.VersionNumber
		s := scopes.SerializeScopeVersion(*p.LatestScope)
		currentScopeResp = &s
	}

	return ProjectResponse{
		ID:                  p.ID,
		Name:                p.Name,
		Description:         desc,
		Status:              p.Status,
		CurrentScopeVersion: currentVersionNum,
		CurrentScope:        currentScopeResp,
		CreatedAt:           shared.FormatISO8601(p.CreatedAt),
		UpdatedAt:           shared.FormatISO8601(p.UpdatedAt),
	}
}

type InitialScopeRequest struct {
	Problem     *string `json:"problem"`
	TargetUsers *string `json:"targetUsers"`
	Goal        *string `json:"goal"`
	InScope     *string `json:"inScope"`
	OutOfScope  *string `json:"outOfScope"`
}

type CreateProjectRequest struct {
	Name         *string              `json:"name"`
	Description  *string              `json:"description"`
	InitialScope *InitialScopeRequest `json:"initialScope"`
}

type CreateProjectInput struct {
	Name        string
	Description string
	Problem     string
	TargetUsers string
	Goal        string
	InScope     string
	OutOfScope  string
}

type UpdateProjectRequest struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
}

type ResumeContextResponse struct {
	Project           ProjectResponse              `json:"project"`
	CurrentScope      scopes.ScopeVersionResponse  `json:"currentScope"`
	PinnedDecisions   []decisions.DecisionResponse `json:"pinnedDecisions"`
	RecentDecisions   []decisions.DecisionResponse `json:"recentDecisions"`
	OutstandingIssues []issues.IssueResponse       `json:"outstandingIssues"`
}

type TimelineScopeVersionResponse struct {
	scopes.ScopeVersionResponse
	IsCurrent bool                         `json:"isCurrent"`
	Decisions []decisions.DecisionResponse `json:"decisions"`
}

type ScopeTimelineResponse struct {
	Project  ProjectResponse                `json:"project"`
	Versions []TimelineScopeVersionResponse `json:"versions"`
}
