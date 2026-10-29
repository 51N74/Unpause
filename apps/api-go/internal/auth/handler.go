package auth

import (
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/westride/unpause/api-go/internal/config"
	"github.com/westride/unpause/api-go/internal/http/middleware"
	"github.com/westride/unpause/api-go/internal/shared"
)

// Handler handles HTTP requests for authentication and user settings.
type Handler struct {
	service *Service
	cfg     *config.Config
}

func NewHandler(service *Service, cfg *config.Config) *Handler {
	return &Handler{
		service: service,
		cfg:     cfg,
	}
}

func (h *Handler) setSessionCookie(c *gin.Context, sessionID string) {
	maxAge := h.cfg.SessionTTLHours * 3600
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     h.cfg.SessionCookieName,
		Value:    sessionID,
		Path:     "/",
		MaxAge:   maxAge,
		Expires:  time.Now().UTC().Add(time.Duration(maxAge) * time.Second),
		HttpOnly: true,
		Secure:   h.cfg.CookieSecure(),
		SameSite: h.cfg.CookieSameSiteMode(),
	})
}

func (h *Handler) clearSessionCookie(c *gin.Context) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     h.cfg.SessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		Expires:  time.Unix(0, 0).UTC(),
		HttpOnly: true,
		Secure:   h.cfg.CookieSecure(),
		SameSite: h.cfg.CookieSameSiteMode(),
	})
}

func (h *Handler) invalidatePreviousSessionCookie(c *gin.Context, newSessionID string) {
	prevSessionID, err := c.Cookie(h.cfg.SessionCookieName)
	if err == nil && strings.TrimSpace(prevSessionID) != "" && prevSessionID != newSessionID {
		_ = h.service.Logout(c.Request.Context(), prevSessionID)
	}
}

func (h *Handler) Register(c *gin.Context) {
	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		middleware.RespondError(c, shared.NewValidationError("Invalid JSON request body", nil))
		return
	}

	v := shared.NewValidator()
	email := v.Email("email", req.Email)

	var password string
	if req.Password == nil || *req.Password == "" {
		v.AddError("password", "Password is required")
	} else {
		password = *req.Password
		if utf8.RuneCountInString(password) < 8 {
			v.AddError("password", "Password must be at least 8 characters")
		} else if utf8.RuneCountInString(password) > 128 {
			v.AddError("password", "Password must be at most 128 characters")
		}
	}

	var displayName string
	if req.DisplayName != nil {
		trimmed := strings.TrimSpace(*req.DisplayName)
		if trimmed == "" {
			v.AddError("displayName", "Display name cannot be empty")
		} else if utf8.RuneCountInString(trimmed) > 80 {
			v.AddError("displayName", "Display name must be at most 80 characters")
		} else {
			displayName = trimmed
		}
	}

	if v.HasErrors() {
		middleware.RespondError(c, v.Err())
		return
	}

	user, sessionID, err := h.service.Register(c.Request.Context(), email, password, displayName)
	if err != nil {
		middleware.RespondError(c, err)
		return
	}

	h.invalidatePreviousSessionCookie(c, sessionID)
	h.setSessionCookie(c, sessionID)
	c.JSON(http.StatusCreated, gin.H{"user": user})
}

func (h *Handler) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		middleware.RespondError(c, shared.NewValidationError("Invalid JSON request body", nil))
		return
	}

	v := shared.NewValidator()
	email := v.Email("email", req.Email)
	var password string
	if req.Password == nil || *req.Password == "" {
		v.AddError("password", "Password is required")
	} else {
		password = *req.Password
		if utf8.RuneCountInString(password) > 128 {
			v.AddError("password", "Password must be at most 128 characters")
		}
	}

	if v.HasErrors() {
		middleware.RespondError(c, v.Err())
		return
	}

	user, sessionID, err := h.service.Login(c.Request.Context(), email, password)
	if err != nil {
		middleware.RespondError(c, err)
		return
	}

	h.invalidatePreviousSessionCookie(c, sessionID)
	h.setSessionCookie(c, sessionID)
	c.JSON(http.StatusOK, gin.H{"user": user})
}

func (h *Handler) Logout(c *gin.Context) {
	sessionID, _ := c.Cookie(h.cfg.SessionCookieName)
	if err := h.service.Logout(c.Request.Context(), sessionID); err != nil {
		middleware.RespondError(c, err)
		return
	}
	h.clearSessionCookie(c)
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *Handler) Me(c *gin.Context) {
	userVal, exists := c.Get(middleware.ContextUserKey)
	if !exists {
		middleware.RespondError(c, shared.NewUnauthorizedError("Authentication required"))
		return
	}
	user := userVal.(*User)
	c.JSON(http.StatusOK, gin.H{"user": SerializeUser(*user)})
}

func (h *Handler) UpdateProfile(c *gin.Context) {
	userVal, exists := c.Get(middleware.ContextUserKey)
	if !exists {
		middleware.RespondError(c, shared.NewUnauthorizedError("Authentication required"))
		return
	}
	user := userVal.(*User)

	var req UpdateProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		middleware.RespondError(c, shared.NewValidationError("Invalid JSON request body", nil))
		return
	}

	v := shared.NewValidator()
	displayName := v.RequiredTrimmed("displayName", "Display name", req.DisplayName, 80)
	if v.HasErrors() {
		middleware.RespondError(c, v.Err())
		return
	}

	updated, err := h.service.UpdateDisplayName(c.Request.Context(), user.ID, displayName)
	if err != nil {
		middleware.RespondError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"user": updated})
}
