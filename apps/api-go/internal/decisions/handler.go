package decisions

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/westride/unpause/api-go/internal/http/middleware"
	"github.com/westride/unpause/api-go/internal/shared"
)

// Handler handles HTTP endpoints for Decision Records.
type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) List(c *gin.Context) {
	userID := middleware.GetAuthenticatedUserID(c)
	projectID := c.Param("projectId")

	search := strings.TrimSpace(c.Query("search"))
	scopeImpact := strings.TrimSpace(c.Query("scopeImpact"))
	scopeVersionID := strings.TrimSpace(c.Query("scopeVersionId"))
	pinnedOnlyRaw := strings.TrimSpace(c.Query("pinnedOnly"))

	v := shared.NewValidator()
	if scopeImpact != "" && !shared.IsValidScopeImpact(scopeImpact) {
		v.AddError("scopeImpact", "Invalid scopeImpact filter value")
	}
	if pinnedOnlyRaw != "" && pinnedOnlyRaw != "true" && pinnedOnlyRaw != "false" {
		v.AddError("pinnedOnly", "pinnedOnly must be 'true' or 'false'")
	}
	if v.HasErrors() {
		middleware.RespondError(c, v.Err())
		return
	}

	decisions, err := h.service.List(c.Request.Context(), userID, projectID, ListDecisionsFilter{
		Search:         search,
		ScopeImpact:    scopeImpact,
		ScopeVersionID: scopeVersionID,
		PinnedOnly:     pinnedOnlyRaw == "true",
	})
	if err != nil {
		middleware.RespondError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"decisions": decisions})
}

func (h *Handler) Create(c *gin.Context) {
	userID := middleware.GetAuthenticatedUserID(c)
	projectID := c.Param("projectId")

	var req CreateDecisionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		middleware.RespondError(c, shared.NewValidationError("Invalid JSON request body", nil))
		return
	}

	v := shared.NewValidator()
	problem := v.RequiredTrimmed("problem", "Problem", req.Problem, 5000)
	decisionText := v.RequiredTrimmed("decision", "Decision", req.Decision, 5000)
	rationale := v.RequiredTrimmed("rationale", "Rationale", req.Rationale, 5000)
	alt := v.OptionalTrimmed("alternativesConsidered", "Alternatives considered", req.AlternativesConsidered, 5000)
	outcome := v.OptionalTrimmed("outcome", "Outcome", req.Outcome, 5000)

	scopeImpact := "None"
	if req.ScopeImpact != nil && strings.TrimSpace(*req.ScopeImpact) != "" {
		scopeImpact = strings.TrimSpace(*req.ScopeImpact)
		if !shared.IsValidScopeImpact(scopeImpact) {
			v.AddError("scopeImpact", "Invalid scopeImpact value")
		}
	}

	var issueID *string
	if req.IssueID != nil {
		trimmed := strings.TrimSpace(*req.IssueID)
		if trimmed != "" {
			issueID = &trimmed
		}
	}

	if v.HasErrors() {
		middleware.RespondError(c, v.Err())
		return
	}

	created, err := h.service.Create(c.Request.Context(), userID, projectID, CreateDecisionInput{
		Problem:                problem,
		Decision:               decisionText,
		Rationale:              rationale,
		AlternativesConsidered: alt,
		Outcome:                outcome,
		ScopeImpact:            scopeImpact,
		IssueID:                issueID,
	})
	if err != nil {
		middleware.RespondError(c, err)
		return
	}

	c.JSON(http.StatusCreated, gin.H{"decision": created})
}

func (h *Handler) GetByID(c *gin.Context) {
	userID := middleware.GetAuthenticatedUserID(c)
	projectID := c.Param("projectId")
	decisionID := c.Param("decisionId")

	d, err := h.service.GetByID(c.Request.Context(), userID, projectID, decisionID)
	if err != nil {
		middleware.RespondError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"decision": d})
}

func (h *Handler) Update(c *gin.Context) {
	userID := middleware.GetAuthenticatedUserID(c)
	projectID := c.Param("projectId")
	decisionID := c.Param("decisionId")

	rawBody, err := io.ReadAll(c.Request.Body)
	if err != nil {
		middleware.RespondError(c, shared.NewValidationError("Invalid request body", nil))
		return
	}

	var rawMap map[string]json.RawMessage
	if err := json.Unmarshal(rawBody, &rawMap); err != nil {
		middleware.RespondError(c, shared.NewValidationError("Invalid JSON request body", nil))
		return
	}

	var req UpdateDecisionRequest
	if err := json.Unmarshal(rawBody, &req); err != nil {
		middleware.RespondError(c, shared.NewValidationError("Invalid JSON request body", nil))
		return
	}
	_, hasIssueID := rawMap["issueId"]
	req.HasIssueIDField = hasIssueID

	v := shared.NewValidator()
	hasAnyField := false

	if req.Problem != nil {
		hasAnyField = true
		p := v.RequiredTrimmed("problem", "Problem", req.Problem, 5000)
		req.Problem = &p
	}
	if req.Decision != nil {
		hasAnyField = true
		d := v.RequiredTrimmed("decision", "Decision", req.Decision, 5000)
		req.Decision = &d
	}
	if req.Rationale != nil {
		hasAnyField = true
		r := v.RequiredTrimmed("rationale", "Rationale", req.Rationale, 5000)
		req.Rationale = &r
	}
	if req.AlternativesConsidered != nil {
		hasAnyField = true
		a := v.OptionalTrimmed("alternativesConsidered", "Alternatives considered", req.AlternativesConsidered, 5000)
		req.AlternativesConsidered = &a
	}
	if req.Outcome != nil {
		hasAnyField = true
		o := v.OptionalTrimmed("outcome", "Outcome", req.Outcome, 5000)
		req.Outcome = &o
	}
	if req.ScopeImpact != nil {
		hasAnyField = true
		si := strings.TrimSpace(*req.ScopeImpact)
		if !shared.IsValidScopeImpact(si) {
			v.AddError("scopeImpact", "Invalid scopeImpact value")
		}
		req.ScopeImpact = &si
	}
	if hasIssueID {
		hasAnyField = true
	}

	if !hasAnyField {
		v.AddError("", "At least one decision field must be provided for update")
	}

	if v.HasErrors() {
		middleware.RespondError(c, v.Err())
		return
	}

	updated, err := h.service.Update(c.Request.Context(), userID, projectID, decisionID, req)
	if err != nil {
		middleware.RespondError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"decision": updated})
}

func (h *Handler) Pin(c *gin.Context) {
	userID := middleware.GetAuthenticatedUserID(c)
	projectID := c.Param("projectId")
	decisionID := c.Param("decisionId")

	var req PinDecisionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		middleware.RespondError(c, shared.NewValidationError("Invalid JSON request body", nil))
		return
	}

	if req.IsPinned == nil {
		v := shared.NewValidator()
		v.AddError("isPinned", "isPinned boolean is required")
		middleware.RespondError(c, v.Err())
		return
	}

	updated, err := h.service.SetPinned(c.Request.Context(), userID, projectID, decisionID, *req.IsPinned)
	if err != nil {
		middleware.RespondError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"decision": updated})
}

func (h *Handler) Delete(c *gin.Context) {
	userID := middleware.GetAuthenticatedUserID(c)
	projectID := c.Param("projectId")
	decisionID := c.Param("decisionId")

	if err := h.service.Delete(c.Request.Context(), userID, projectID, decisionID); err != nil {
		middleware.RespondError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"deleted": true})
}
