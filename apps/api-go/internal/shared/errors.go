// Package shared provides application-wide error types, password hashing, and validation helpers.
package shared

import (
	"fmt"
	"net/http"
	"time"
)

// ErrorCode represents stable machine-readable API error codes expected by the frontend.
type ErrorCode string

const (
	ErrCodeValidation            ErrorCode = "VALIDATION_ERROR"
	ErrCodeUnauthorized          ErrorCode = "UNAUTHORIZED"
	ErrCodeForbidden             ErrorCode = "FORBIDDEN"
	ErrCodeInvalidOrigin         ErrorCode = "INVALID_ORIGIN"
	ErrCodeNotFound              ErrorCode = "NOT_FOUND"
	ErrCodeConflict              ErrorCode = "CONFLICT"
	ErrCodeProjectArchived       ErrorCode = "PROJECT_ARCHIVED"
	ErrCodeScopeVersionImmutable ErrorCode = "SCOPE_VERSION_IMMUTABLE"
	ErrCodeRateLimit             ErrorCode = "RATE_LIMIT_EXCEEDED"
	ErrCodeGitHubRateLimit       ErrorCode = "GITHUB_RATE_LIMIT"
	ErrCodeGitHubUpstream        ErrorCode = "GITHUB_UPSTREAM_ERROR"
	ErrCodeInternal              ErrorCode = "INTERNAL_ERROR"
)

// ValidationDetail describes a single field validation error.
type ValidationDetail struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

// AppError represents a structured HTTP error that maps cleanly to the API error response contract.
type AppError struct {
	StatusCode int
	Code       ErrorCode
	Message    string
	Details    any
}

func (e *AppError) Error() string {
	return fmt.Sprintf("[%s] %s", e.Code, e.Message)
}

func NewValidationError(message string, details any) *AppError {
	return &AppError{
		StatusCode: http.StatusBadRequest,
		Code:       ErrCodeValidation,
		Message:    message,
		Details:    details,
	}
}

func NewUnauthorizedError(message string) *AppError {
	if message == "" {
		message = "Authentication required"
	}
	return &AppError{
		StatusCode: http.StatusUnauthorized,
		Code:       ErrCodeUnauthorized,
		Message:    message,
	}
}

func NewForbiddenError(message string) *AppError {
	if message == "" {
		message = "Access denied"
	}
	return &AppError{
		StatusCode: http.StatusForbidden,
		Code:       ErrCodeForbidden,
		Message:    message,
	}
}

func NewInvalidOriginError() *AppError {
	return &AppError{
		StatusCode: http.StatusForbidden,
		Code:       ErrCodeInvalidOrigin,
		Message:    "Origin is not permitted for state-changing requests",
	}
}

func NewNotFoundError(message string) *AppError {
	if message == "" {
		message = "Resource not found"
	}
	return &AppError{
		StatusCode: http.StatusNotFound,
		Code:       ErrCodeNotFound,
		Message:    message,
	}
}

func NewConflictError(message string, details any) *AppError {
	return &AppError{
		StatusCode: http.StatusConflict,
		Code:       ErrCodeConflict,
		Message:    message,
		Details:    details,
	}
}

func NewProjectArchivedError() *AppError {
	return &AppError{
		StatusCode: http.StatusConflict,
		Code:       ErrCodeProjectArchived,
		Message:    "Archived projects are read-only. Restore the project to make changes.",
	}
}

func NewScopeVersionImmutableError() *AppError {
	return &AppError{
		StatusCode: http.StatusMethodNotAllowed,
		Code:       ErrCodeScopeVersionImmutable,
		Message:    "Scope versions are immutable and cannot be updated or deleted.",
	}
}

func NewRateLimitError(message string) *AppError {
	if message == "" {
		message = "Too many authentication attempts. Please wait and try again."
	}
	return &AppError{
		StatusCode: http.StatusTooManyRequests,
		Code:       ErrCodeRateLimit,
		Message:    message,
	}
}

func NewGitHubRateLimitError(message string, details any) *AppError {
	if message == "" {
		message = "GitHub API rate limit exceeded. Please wait and retry."
	}
	return &AppError{
		StatusCode: http.StatusTooManyRequests,
		Code:       ErrCodeGitHubRateLimit,
		Message:    message,
		Details:    details,
	}
}

func NewGitHubUpstreamError(message string, details any) *AppError {
	if message == "" {
		message = "Failed to fetch repositories from GitHub API."
	}
	return &AppError{
		StatusCode: http.StatusBadGateway,
		Code:       ErrCodeGitHubUpstream,
		Message:    message,
		Details:    details,
	}
}

// FormatISO8601 formats a time.Time in UTC millisecond ISO-8601 format matching JavaScript Date.toISOString().
func FormatISO8601(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000Z")
}
