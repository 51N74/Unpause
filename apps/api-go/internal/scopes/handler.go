package scopes

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/westride/unpause/api-go/internal/http/middleware"
	"github.com/westride/unpause/api-go/internal/shared"
)

// Handler handles HTTP endpoints for Scope Versions.
type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) List(c *gin.Context) {
	userID := middleware.GetAuthenticatedUserID(c)
	projectID := c.Param("projectId")

	currentScope, versions, err := h.service.List(c.Request.Context(), userID, projectID)
	if err != nil {
		middleware.RespondError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"currentScope": currentScope,
		"versions":     versions,
	})
}

func (h *Handler) Create(c *gin.Context) {
	userID := middleware.GetAuthenticatedUserID(c)
	projectID := c.Param("projectId")

	var req CreateScopeVersionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		middleware.RespondError(c, shared.NewValidationError("Invalid JSON request body", nil))
		return
	}

	v := shared.NewValidator()
	input := CreateScopeVersionInput{
		Problem:         v.RequiredTrimmed("problem", "Problem", req.Problem, 5000),
		TargetUsers:     v.RequiredTrimmed("targetUsers", "Target users", req.TargetUsers, 5000),
		Goal:            v.RequiredTrimmed("goal", "Goal", req.Goal, 5000),
		InScope:         v.RequiredTrimmed("inScope", "In-scope items", req.InScope, 5000),
		OutOfScope:      v.RequiredTrimmed("outOfScope", "Out-of-scope items", req.OutOfScope, 5000),
		ReasonForChange: v.RequiredTrimmed("reasonForChange", "Reason for change", req.ReasonForChange, 2000),
	}
	if v.HasErrors() {
		middleware.RespondError(c, v.Err())
		return
	}

	sv, err := h.service.Create(c.Request.Context(), userID, projectID, input)
	if err != nil {
		middleware.RespondError(c, err)
		return
	}

	c.JSON(http.StatusCreated, gin.H{"scopeVersion": sv})
}

func (h *Handler) GetByID(c *gin.Context) {
	userID := middleware.GetAuthenticatedUserID(c)
	projectID := c.Param("projectId")
	versionID := c.Param("versionId")

	sv, err := h.service.GetByID(c.Request.Context(), userID, projectID, versionID)
	if err != nil {
		middleware.RespondError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"scopeVersion": sv})
}

// RejectImmutable responds with 405 SCOPE_VERSION_IMMUTABLE for any attempt to update or delete a Scope Version.
func (h *Handler) RejectImmutable(c *gin.Context) {
	middleware.RespondError(c, shared.NewScopeVersionImmutableError())
}
