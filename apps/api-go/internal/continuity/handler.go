package continuity

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/westride/unpause/api-go/internal/http/middleware"
	"github.com/westride/unpause/api-go/internal/shared"
	"io"
	"net/http"
	"strings"
)

type Handler struct{ service *Service }

func NewHandler(s *Service) *Handler { return &Handler{s} }
func decode(c *gin.Context, target any) error {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256<<10)
	dec := json.NewDecoder(c.Request.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(target); err != nil {
		return shared.NewValidationError("Invalid JSON body or body exceeds 256 KiB", nil)
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		return shared.NewValidationError("Only one JSON value is allowed", nil)
	}
	return nil
}
func respond(c *gin.Context, data any, err error) {
	if err != nil {
		middleware.RespondError(c, err)
		return
	}
	c.JSON(http.StatusOK, data)
}
func owner(c *gin.Context) (string, string) {
	return middleware.GetAuthenticatedUserID(c), c.Param("projectId")
}
func (h *Handler) View(c *gin.Context) {
	u, p := owner(c)
	v, err := h.service.View(c.Request.Context(), u, p)
	respond(c, v, err)
}
func (h *Handler) Connect(c *gin.Context) {
	var req struct {
		URL string `json:"url"`
	}
	if err := decode(c, &req); err != nil {
		respond(c, nil, err)
		return
	}
	u, p := owner(c)
	r, secret, err := h.service.Connect(c.Request.Context(), u, p, req.URL)
	c.Header("Cache-Control", "no-store")
	respond(c, gin.H{"connection": r, "secret": secret}, err)
}
func (h *Handler) Unlink(c *gin.Context) {
	u, p := owner(c)
	respond(c, gin.H{"ok": true}, h.service.Unlink(c.Request.Context(), u, p))
}
func (h *Handler) Rotate(c *gin.Context) {
	u, p := owner(c)
	secret, err := h.service.Rotate(c.Request.Context(), u, p)
	c.Header("Cache-Control", "no-store")
	respond(c, gin.H{"secret": secret}, err)
}
func (h *Handler) Review(c *gin.Context) {
	var req struct {
		ConnectionID string `json:"connectionId"`
		Sequence     int64  `json:"sequence"`
	}
	if err := decode(c, &req); err != nil {
		respond(c, nil, err)
		return
	}
	u, p := owner(c)
	respond(c, gin.H{"ok": true}, h.service.Review(c.Request.Context(), u, p, req.ConnectionID, req.Sequence))
}
func (h *Handler) ReturnContext(c *gin.Context) {
	var req struct {
		Note  string  `json:"returnNote"`
		Focus *string `json:"focusIssueId"`
	}
	if err := decode(c, &req); err != nil {
		respond(c, nil, err)
		return
	}
	u, p := owner(c)
	respond(c, gin.H{"ok": true}, h.service.ReturnContext(c.Request.Context(), u, p, req.Note, req.Focus))
}
func (h *Handler) Sync(c *gin.Context) {
	var req struct {
		Force bool `json:"force"`
	}
	if err := decode(c, &req); err != nil {
		respond(c, nil, err)
		return
	}
	u, p := owner(c)
	respond(c, gin.H{"ok": true}, h.service.Sync(c.Request.Context(), u, p, req.Force))
}
func (h *Handler) LinkCommit(c *gin.Context) {
	var req struct {
		IssueID    *string `json:"issueId"`
		DecisionID *string `json:"decisionId"`
	}
	if err := decode(c, &req); err != nil {
		respond(c, nil, err)
		return
	}
	u, p := owner(c)
	respond(c, gin.H{"ok": true}, h.service.LinkCommit(c.Request.Context(), u, p, c.Param("sha"), req.IssueID, req.DecisionID))
}
func (h *Handler) Ingest(c *gin.Context) {
	var req Delivery
	if err := decode(c, &req); err != nil {
		respond(c, nil, err)
		return
	}
	auth := c.GetHeader("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		respond(c, nil, shared.NewUnauthorizedError("Integration credential required"))
		return
	}
	respond(c, gin.H{"ok": true}, h.service.Ingest(c.Request.Context(), c.Param("connectionId"), strings.TrimPrefix(auth, "Bearer "), req))
}
