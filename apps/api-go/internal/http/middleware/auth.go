package middleware

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/westride/unpause/api-go/internal/config"
	"github.com/westride/unpause/api-go/internal/shared"
)

const (
	ContextUserKey      = "authenticatedUser"
	ContextUserIDKey    = "authenticatedUserID"
	ContextSessionIDKey = "authenticatedSessionID"
)

// SessionValidator abstracts session lookup so middleware does not depend cyclically on auth handlers.
type SessionValidator interface {
	ValidateSessionGeneric(ctx context.Context, sessionID string) (user any, userID string, err error)
}

// RequireAuth validates the session cookie against PostgreSQL and populates the authenticated user in Gin's context.
func RequireAuth(cfg *config.Config, validateFn func(ctx context.Context, sessionID string) (any, string, error)) gin.HandlerFunc {
	return func(c *gin.Context) {
		sessionID, err := c.Cookie(cfg.SessionCookieName)
		if err != nil || sessionID == "" {
			RespondError(c, shared.NewUnauthorizedError("Authentication required"))
			return
		}

		user, userID, err := validateFn(c.Request.Context(), sessionID)
		if err != nil {
			var appErr *shared.AppError
			if errors.As(err, &appErr) && appErr.StatusCode == http.StatusUnauthorized {
				http.SetCookie(c.Writer, &http.Cookie{
					Name:     cfg.SessionCookieName,
					Value:    "",
					Path:     "/",
					MaxAge:   -1,
					Expires:  time.Unix(0, 0).UTC(),
					HttpOnly: true,
					Secure:   cfg.CookieSecure(),
					SameSite: cfg.CookieSameSiteMode(),
				})
			}
			RespondError(c, err)
			return
		}

		c.Set(ContextUserKey, user)
		c.Set(ContextUserIDKey, userID)
		c.Set(ContextSessionIDKey, sessionID)
		c.Next()
	}
}

// GetAuthenticatedUserID returns the authenticated user's ID from the Gin context.
func GetAuthenticatedUserID(c *gin.Context) string {
	val, exists := c.Get(ContextUserIDKey)
	if !exists {
		return ""
	}
	id, _ := val.(string)
	return id
}
