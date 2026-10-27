// Package middleware provides HTTP middlewares for authentication, security, and error handling.
package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/westride/unpause/api-go/internal/config"
	"github.com/westride/unpause/api-go/internal/shared"
)

// SessionValidator validates a session token and returns the user object and user ID.
type SessionValidator func(ctx context.Context, sessionID string) (user any, userID string, err error)

// RequireAuth enforces a valid session cookie for protected endpoints.
func RequireAuth(cfg *config.Config, validateFn SessionValidator) gin.HandlerFunc {
	return func(c *gin.Context) {
		sessionID, err := c.Cookie(cfg.SessionCookieName)
		if err != nil || strings.TrimSpace(sessionID) == "" {
			RespondError(c, shared.NewUnauthorizedError("Authentication required"))
			return
		}

		user, userID, err := validateFn(c.Request.Context(), sessionID)
		if err != nil {
			c.SetSameSite(http.SameSiteLaxMode)
			c.SetCookie(cfg.SessionCookieName, "", -1, "/", "", cfg.Env == "production", true)
			RespondError(c, err)
			return
		}

		c.Set("user", user)
		c.Set("userId", userID)
		c.Set("sessionId", sessionID)
		c.Next()
	}
}
