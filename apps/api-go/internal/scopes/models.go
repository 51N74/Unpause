// Package scopes manages immutable project Scope Versions.
package scopes

import (
	"time"

	"github.com/westride/unpause/api-go/internal/shared"
)

// ScopeVersion represents a row in the "ScopeVersion" table.
type ScopeVersion struct {
	ID              string
	ProjectID       string
	VersionNumber   int
	Problem         string
	TargetUsers     string
	Goal            string
	InScope         string
	OutOfScope      string
	ReasonForChange string
	CreatedAt       time.Time
}

// ScopeVersionResponse matches the JSON contract for a Scope Version.
type ScopeVersionResponse struct {
	ID              string `json:"id"`
	ProjectID       string `json:"projectId"`
	VersionNumber   int    `json:"versionNumber"`
	Problem         string `json:"problem"`
	TargetUsers     string `json:"targetUsers"`
	Goal            string `json:"goal"`
	InScope         string `json:"inScope"`
	OutOfScope      string `json:"outOfScope"`
	ReasonForChange string `json:"reasonForChange"`
	CreatedAt       string `json:"createdAt"`
}

func SerializeScopeVersion(sv ScopeVersion) ScopeVersionResponse {
	return ScopeVersionResponse{
		ID:              sv.ID,
		ProjectID:       sv.ProjectID,
		VersionNumber:   sv.VersionNumber,
		Problem:         sv.Problem,
		TargetUsers:     sv.TargetUsers,
		Goal:            sv.Goal,
		InScope:         sv.InScope,
		OutOfScope:      sv.OutOfScope,
		ReasonForChange: sv.ReasonForChange,
		CreatedAt:       shared.FormatISO8601(sv.CreatedAt),
	}
}

type CreateScopeVersionRequest struct {
	Problem         *string `json:"problem"`
	TargetUsers     *string `json:"targetUsers"`
	Goal            *string `json:"goal"`
	InScope         *string `json:"inScope"`
	OutOfScope      *string `json:"outOfScope"`
	ReasonForChange *string `json:"reasonForChange"`
}

type CreateScopeVersionInput struct {
	Problem         string
	TargetUsers     string
	Goal            string
	InScope         string
	OutOfScope      string
	ReasonForChange string
}
