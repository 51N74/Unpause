// Package issues manages project Issues and their next actions.
package issues

import (
	"time"

	"github.com/westride/unpause/api-go/internal/decisions"
	"github.com/westride/unpause/api-go/internal/shared"
)

type Issue struct {
	ID          string
	ProjectID   string
	Title       string
	Description *string
	Status      string
	Priority    string
	NextAction  string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type IssueResponse struct {
	ID          string `json:"id"`
	ProjectID   string `json:"projectId"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Status      string `json:"status"`
	Priority    string `json:"priority"`
	NextAction  string `json:"nextAction"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

type IssueDetailResponse struct {
	IssueResponse
	DecisionRecords []decisions.DecisionResponse `json:"decisionRecords"`
}

type PaginatedIssuesResponse struct {
	Items      []IssueResponse `json:"items"`
	Total      int             `json:"total"`
	Page       int             `json:"page"`
	PageSize   int             `json:"pageSize"`
	TotalPages int             `json:"totalPages"`
}

func SerializeIssue(i Issue) IssueResponse {
	desc := ""
	if i.Description != nil {
		desc = *i.Description
	}
	return IssueResponse{
		ID:          i.ID,
		ProjectID:   i.ProjectID,
		Title:       i.Title,
		Description: desc,
		Status:      i.Status,
		Priority:    i.Priority,
		NextAction:  i.NextAction,
		CreatedAt:   shared.FormatISO8601(i.CreatedAt),
		UpdatedAt:   shared.FormatISO8601(i.UpdatedAt),
	}
}

type CreateIssueRequest struct {
	Title       *string `json:"title"`
	Description *string `json:"description"`
	Status      *string `json:"status"`
	Priority    *string `json:"priority"`
	NextAction  *string `json:"nextAction"`
}

type CreateIssueInput struct {
	Title       string
	Description string
	Status      string
	Priority    string
	NextAction  string
}

type UpdateIssueRequest struct {
	Title       *string `json:"title"`
	Description *string `json:"description"`
	Status      *string `json:"status"`
	Priority    *string `json:"priority"`
	NextAction  *string `json:"nextAction"`
}

type ListIssuesFilter struct {
	Status   string
	Priority string
	Search   string
	Page     int
	PageSize int
}
