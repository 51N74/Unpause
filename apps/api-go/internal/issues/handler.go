package issues

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/westride/unpause/api-go/internal/http/middleware"
	"github.com/westride/unpause/api-go/internal/shared"
)

// Handler handles HTTP endpoints for project Issues.
type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) List(c *gin.Context) {
	userID := middleware.GetAuthenticatedUserID(c)
	projectID := c.Param("projectId")

	status := strings.TrimSpace(c.Query("status"))
	priority := strings.TrimSpace(c.Query("priority"))
	search := strings.TrimSpace(c.Query("search"))
	pageRaw := strings.TrimSpace(c.Query("page"))
	pageSizeRaw := strings.TrimSpace(c.Query("pageSize"))

	v := shared.NewValidator()
	if status != "" && !shared.IsValidIssueStatus(status) {
		v.AddError("status", "Invalid status filter value")
	}
	if priority != "" && !shared.IsValidIssuePriority(priority) {
		v.AddError("priority", "Invalid priority filter value")
	}

	page := 1
	if pageRaw != "" {
		p, err := strconv.Atoi(pageRaw)
		if err != nil || p < 1 {
			v.AddError("page", "page must be an integer >= 1")
		} else {
			page = p
		}
	}

	pageSize := 20
	if pageSizeRaw != "" {
		ps, err := strconv.Atoi(pageSizeRaw)
		if err != nil || ps < 1 || ps > 50 {
			v.AddError("pageSize", "pageSize must be between 1 and 50")
		} else {
			pageSize = ps
		}
	}

	if v.HasErrors() {
		middleware.RespondError(c, v.Err())
		return
	}

	res, err := h.service.List(c.Request.Context(), userID, projectID, ListIssuesFilter{
		Status:   status,
		Priority: priority,
		Search:   search,
		Page:     page,
		PageSize: pageSize,
	})
	if err != nil {
		middleware.RespondError(c, err)
		return
	}

	c.JSON(http.StatusOK, res)
}

func (h *Handler) Create(c *gin.Context) {
	userID := middleware.GetAuthenticatedUserID(c)
	projectID := c.Param("projectId")

	var req CreateIssueRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		middleware.RespondError(c, shared.NewValidationError("Invalid JSON request body", nil))
		return
	}

	v := shared.NewValidator()
	title := v.RequiredTrimmed("title", "Issue title", req.Title, 200)
	description := v.OptionalTrimmed("description", "Description", req.Description, 5000)
	nextAction := v.RequiredTrimmed("nextAction", "Next action", req.NextAction, 500)

	status := "Open"
	if req.Status != nil && strings.TrimSpace(*req.Status) != "" {
		status = strings.TrimSpace(*req.Status)
		if !shared.IsValidIssueStatus(status) {
			v.AddError("status", "Invalid issue status")
		}
	}

	priority := "Medium"
	if req.Priority != nil && strings.TrimSpace(*req.Priority) != "" {
		priority = strings.TrimSpace(*req.Priority)
		if !shared.IsValidIssuePriority(priority) {
			v.AddError("priority", "Invalid issue priority")
		}
	}

	if v.HasErrors() {
		middleware.RespondError(c, v.Err())
		return
	}

	created, err := h.service.Create(c.Request.Context(), userID, projectID, CreateIssueInput{
		Title:       title,
		Description: description,
		Status:      status,
		Priority:    priority,
		NextAction:  nextAction,
	})
	if err != nil {
		middleware.RespondError(c, err)
		return
	}

	c.JSON(http.StatusCreated, gin.H{"issue": created})
}

func (h *Handler) GetByID(c *gin.Context) {
	userID := middleware.GetAuthenticatedUserID(c)
	projectID := c.Param("projectId")
	issueID := c.Param("issueId")

	iss, err := h.service.GetByID(c.Request.Context(), userID, projectID, issueID)
	if err != nil {
		middleware.RespondError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"issue": iss})
}

func (h *Handler) Update(c *gin.Context) {
	userID := middleware.GetAuthenticatedUserID(c)
	projectID := c.Param("projectId")
	issueID := c.Param("issueId")

	var req UpdateIssueRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		middleware.RespondError(c, shared.NewValidationError("Invalid JSON request body", nil))
		return
	}

	v := shared.NewValidator()
	hasAnyField := false

	if req.Title != nil {
		hasAnyField = true
		t := v.RequiredTrimmed("title", "Issue title", req.Title, 200)
		req.Title = &t
	}
	if req.Description != nil {
		hasAnyField = true
		d := v.OptionalTrimmed("description", "Description", req.Description, 5000)
		req.Description = &d
	}
	if req.Status != nil {
		hasAnyField = true
		st := strings.TrimSpace(*req.Status)
		if !shared.IsValidIssueStatus(st) {
			v.AddError("status", "Invalid issue status")
		}
		req.Status = &st
	}
	if req.Priority != nil {
		hasAnyField = true
		pr := strings.TrimSpace(*req.Priority)
		if !shared.IsValidIssuePriority(pr) {
			v.AddError("priority", "Invalid issue priority")
		}
		req.Priority = &pr
	}
	if req.NextAction != nil {
		hasAnyField = true
		na := v.RequiredTrimmed("nextAction", "Next action", req.NextAction, 500)
		req.NextAction = &na
	}

	if !hasAnyField {
		v.AddError("", "At least one issue field must be provided for update")
	}

	if v.HasErrors() {
		middleware.RespondError(c, v.Err())
		return
	}

	updated, err := h.service.Update(c.Request.Context(), userID, projectID, issueID, req)
	if err != nil {
		middleware.RespondError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"issue": updated})
}

func (h *Handler) Delete(c *gin.Context) {
	userID := middleware.GetAuthenticatedUserID(c)
	projectID := c.Param("projectId")
	issueID := c.Param("issueId")

	if err := h.service.Delete(c.Request.Context(), userID, projectID, issueID); err != nil {
		middleware.RespondError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"deleted": true})
}
