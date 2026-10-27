// Package decisions manages Decision Records linked to project Scope Versions.
package decisions

import (
	"time"

	"github.com/westride/unpause/api-go/internal/shared"
)

type ScopeVersionSummary struct {
	ID              string `json:"id"`
	VersionNumber   int    `json:"versionNumber"`
	ReasonForChange string `json:"reasonForChange"`
	CreatedAt       string `json:"createdAt"`
}

type LinkedIssueSummary struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Status string `json:"status"`
}

type DecisionRecord struct {
	ID                     string
	ProjectID              string
	ScopeVersionID         string
	ScopeVersionNumber     int
	ScopeReasonForChange   string
	ScopeCreatedAt         time.Time
	IssueID                *string
	IssueTitle             *string
	IssueStatus            *string
	Problem                string
	Decision               string
	Rationale              string
	AlternativesConsidered *string
	Outcome                *string
	ScopeImpact            string
	IsPinned               bool
	PinnedAt               *time.Time
	CreatedAt              time.Time
	UpdatedAt              time.Time
}

type DecisionResponse struct {
	ID                     string               `json:"id"`
	ProjectID              string               `json:"projectId"`
	ScopeVersionID         string               `json:"scopeVersionId"`
	ScopeVersion           *ScopeVersionSummary `json:"scopeVersion,omitempty"`
	IssueID                *string              `json:"issueId"`
	Issue                  *LinkedIssueSummary  `json:"issue"`
	Problem                string               `json:"problem"`
	Decision               string               `json:"decision"`
	Rationale              string               `json:"rationale"`
	AlternativesConsidered string               `json:"alternativesConsidered"`
	Outcome                string               `json:"outcome"`
	ScopeImpact            string               `json:"scopeImpact"`
	IsPinned               bool                 `json:"isPinned"`
	PinnedAt               *string              `json:"pinnedAt"`
	CreatedAt              string               `json:"createdAt"`
	UpdatedAt              string               `json:"updatedAt"`
}

func SerializeDecision(d DecisionRecord) DecisionResponse {
	var pinnedAtStr *string
	if d.PinnedAt != nil {
		s := shared.FormatISO8601(*d.PinnedAt)
		pinnedAtStr = &s
	}

	var issueSummary *LinkedIssueSummary
	if d.IssueID != nil && d.IssueTitle != nil && d.IssueStatus != nil {
		issueSummary = &LinkedIssueSummary{
			ID:     *d.IssueID,
			Title:  *d.IssueTitle,
			Status: *d.IssueStatus,
		}
	}

	alt := ""
	if d.AlternativesConsidered != nil {
		alt = *d.AlternativesConsidered
	}
	outcome := ""
	if d.Outcome != nil {
		outcome = *d.Outcome
	}

	return DecisionResponse{
		ID:             d.ID,
		ProjectID:      d.ProjectID,
		ScopeVersionID: d.ScopeVersionID,
		ScopeVersion: &ScopeVersionSummary{
			ID:              d.ScopeVersionID,
			VersionNumber:   d.ScopeVersionNumber,
			ReasonForChange: d.ScopeReasonForChange,
			CreatedAt:       shared.FormatISO8601(d.ScopeCreatedAt),
		},
		IssueID:                d.IssueID,
		Issue:                  issueSummary,
		Problem:                d.Problem,
		Decision:               d.Decision,
		Rationale:              d.Rationale,
		AlternativesConsidered: alt,
		Outcome:                outcome,
		ScopeImpact:            d.ScopeImpact,
		IsPinned:               d.IsPinned,
		PinnedAt:               pinnedAtStr,
		CreatedAt:              shared.FormatISO8601(d.CreatedAt),
		UpdatedAt:              shared.FormatISO8601(d.UpdatedAt),
	}
}

type CreateDecisionRequest struct {
	Problem                *string `json:"problem"`
	Decision               *string `json:"decision"`
	Rationale              *string `json:"rationale"`
	AlternativesConsidered *string `json:"alternativesConsidered"`
	Outcome                *string `json:"outcome"`
	ScopeImpact            *string `json:"scopeImpact"`
	IssueID                *string `json:"issueId"`
}

type CreateDecisionInput struct {
	Problem                string
	Decision               string
	Rationale              string
	AlternativesConsidered string
	Outcome                string
	ScopeImpact            string
	IssueID                *string
}

type UpdateDecisionRequest struct {
	Problem                *string `json:"problem"`
	Decision               *string `json:"decision"`
	Rationale              *string `json:"rationale"`
	AlternativesConsidered *string `json:"alternativesConsidered"`
	Outcome                *string `json:"outcome"`
	ScopeImpact            *string `json:"scopeImpact"`
	IssueID                *string `json:"issueId"`
	HasIssueIDField        bool    `json:"-"`
}

type PinDecisionRequest struct {
	IsPinned *bool `json:"isPinned"`
}

type ListDecisionsFilter struct {
	Search         string
	ScopeImpact    string
	ScopeVersionID string
	PinnedOnly     bool
}
