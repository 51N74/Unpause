// Package middleware provides HTTP middleware for error formatting, CORS/Origin security, and session authentication.
package middleware

import (
	"errors"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/westride/unpause/api-go/internal/shared"
)

type errorBody struct {
	ID      string           `json:"id"`
	Code    shared.ErrorCode `json:"code"`
	Message string           `json:"message"`
	Details any              `json:"details,omitempty"`
}

type errorEnvelope struct {
	Error errorBody `json:"error"`
}

// RespondError writes a consistent JSON error payload with a unique UUID error ID.
// It never exposes stack traces, SQL errors, or sensitive credentials.
func RespondError(c *gin.Context, err error) {
	errorID := uuid.NewString()

	var appErr *shared.AppError
	if errors.As(err, &appErr) {
		c.AbortWithStatusJSON(appErr.StatusCode, errorEnvelope{
			Error: errorBody{
				ID:      errorID,
				Code:    appErr.Code,
				Message: appErr.Message,
				Details: appErr.Details,
			},
		})
		return
	}

	log.Printf("[Error %s] internal server error", errorID)
	c.AbortWithStatusJSON(http.StatusInternalServerError, errorEnvelope{
		Error: errorBody{
			ID:      errorID,
			Code:    shared.ErrCodeInternal,
			Message: "An unexpected internal error occurred.",
		},
	})
}

// RecoveryMiddleware catches unexpected panics and converts them into a safe 500 INTERNAL_ERROR response.
func RecoveryMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if rec := recover(); rec != nil {
				errorID := uuid.NewString()
				log.Printf("[Error %s] recovered from panic", errorID)
				c.AbortWithStatusJSON(http.StatusInternalServerError, errorEnvelope{
					Error: errorBody{
						ID:      errorID,
						Code:    shared.ErrCodeInternal,
						Message: "An unexpected internal error occurred.",
					},
				})
			}
		}()
		c.Next()
	}
}
