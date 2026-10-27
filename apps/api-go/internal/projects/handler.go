package projects

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/westride/unpause/api-go/internal/http/middleware"
	"github.com/westride/unpause/api-go/internal/shared"
)

// Handler handles HTTP endpoints for Projects, Resume Context, and Scope Timeline.
type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) List(c *gin.Context) {
	userID := middleware.GetAuthenticatedUserID(c)
	search := strings.TrimSpace(c.Query("search"))
	status := strings.TrimSpace(c.Query("status"))
	if status == "" {
		status = "Active"
	}

	v := shared.NewValidator()
	if !shared.IsValidProjectStatusFilter(status) {
		v.AddError("status", "status must be one of Active, Archived, All")
	}
	if v.HasErrors() {
		middleware.RespondError(c, v.Err())
		return
	}

	projects, err := h.service.List(c.Request.Context(), userID, search, status)
	if err != nil {
		middleware.RespondError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"projects": projects})
}

func (h *Handler) Create(c *gin.Context) {
	userID := middleware.GetAuthenticatedUserID(c)

	var req CreateProjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		middleware.RespondError(c, shared.NewValidationError("Invalid JSON request body", nil))
		return
	}

	v := shared.NewValidator()
	name := v.RequiredTrimmed("name", "Project name", req.Name, 120)
	desc := v.OptionalTrimmed("description", "Description", req.Description, 2000)

	var problem, targetUsers, goal, inScope, outOfScope string
	if req.InitialScope == nil {
		v.AddError("initialScope", "Initial scope is required")
	} else {
		problem = v.RequiredTrimmed("initialScope.problem", "Problem", req.InitialScope.Problem, 5000)
		targetUsers = v.RequiredTrimmed("initialScope.targetUsers", "Target users", req.InitialScope.TargetUsers, 5000)
		goal = v.RequiredTrimmed("initialScope.goal", "Goal", req.InitialScope.Goal, 5000)
		inScope = v.RequiredTrimmed("initialScope.inScope", "In-scope items", req.InitialScope.InScope, 5000)
		outOfScope = v.RequiredTrimmed("initialScope.outOfScope", "Out-of-scope items", req.InitialScope.OutOfScope, 5000)
	}

	if v.HasErrors() {
		middleware.RespondError(c, v.Err())
		return
	}

	project, initialScope, err := h.service.CreateWithInitialScope(c.Request.Context(), userID, CreateProjectInput{
		Name:        name,
		Description: desc,
		Problem:     problem,
		TargetUsers: targetUsers,
		Goal:        goal,
		InScope:     inScope,
		OutOfScope:  outOfScope,
	})
	if err != nil {
		middleware.RespondError(c, err)
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"project":             project,
		"initialScopeVersion": initialScope,
	})
}

func (h *Handler) GetByID(c *gin.Context) {
	userID := middleware.GetAuthenticatedUserID(c)
	projectID := c.Param("projectId")

	project, err := h.service.GetByID(c.Request.Context(), userID, projectID)
	if err != nil {
		middleware.RespondError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"project": project})
}

func (h *Handler) Update(c *gin.Context) {
	userID := middleware.GetAuthenticatedUserID(c)
	projectID := c.Param("projectId")

	var req UpdateProjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		middleware.RespondError(c, shared.NewValidationError("Invalid JSON request body", nil))
		return
	}

	v := shared.NewValidator()
	hasAnyField := false

	if req.Name != nil {
		hasAnyField = true
		n := v.RequiredTrimmed("name", "Project name", req.Name, 120)
		req.Name = &n
	}
	if req.Description != nil {
		hasAnyField = true
		d := v.OptionalTrimmed("description", "Description", req.Description, 2000)
		req.Description = &d
	}
	if !hasAnyField {
		v.AddError("", "At least one project field must be provided for update")
	}

	if v.HasErrors() {
		middleware.RespondError(c, v.Err())
		return
	}

	project, err := h.service.Update(c.Request.Context(), userID, projectID, req)
	if err != nil {
		middleware.RespondError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"project": project})
}

func (h *Handler) Archive(c *gin.Context) {
	userID := middleware.GetAuthenticatedUserID(c)
	projectID := c.Param("projectId")

	project, err := h.service.SetStatus(c.Request.Context(), userID, projectID, "Archived")
	if err != nil {
		middleware.RespondError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"project": project})
}

func (h *Handler) Restore(c *gin.Context) {
	userID := middleware.GetAuthenticatedUserID(c)
	projectID := c.Param("projectId")

	project, err := h.service.SetStatus(c.Request.Context(), userID, projectID, "Active")
	if err != nil {
		middleware.RespondError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"project": project})
}

func (h *Handler) GetResumeContext(c *gin.Context) {
	userID := middleware.GetAuthenticatedUserID(c)
	projectID := c.Param("projectId")

	data, err := h.service.GetResumeContext(c.Request.Context(), userID, projectID)
	if err != nil {
		middleware.RespondError(c, err)
		return
	}

	c.JSON(http.StatusOK, data)
}

func (h *Handler) GetTimeline(c *gin.Context) {
	userID := middleware.GetAuthenticatedUserID(c)
	projectID := c.Param("projectId")

	data, err := h.service.GetScopeTimeline(c.Request.Context(), userID, projectID)
	if err != nil {
		middleware.RespondError(c, err)
		return
	}

	c.JSON(http.StatusOK, data)
}
