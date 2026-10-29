package shared

import (
	"net/mail"
	"strings"
	"unicode/utf8"
)

// Validator collects field-level validation errors and produces a structured VALIDATION_ERROR.
type Validator struct {
	details []ValidationDetail
}

func NewValidator() *Validator {
	return &Validator{
		details: make([]ValidationDetail, 0),
	}
}

func (v *Validator) AddError(path, message string) {
	v.details = append(v.details, ValidationDetail{
		Path:    path,
		Message: message,
	})
}

func (v *Validator) HasErrors() bool {
	return len(v.details) > 0
}

func (v *Validator) Err() *AppError {
	if !v.HasErrors() {
		return nil
	}
	return NewValidationError("Request validation failed", v.details)
}

func (v *Validator) RequiredTrimmed(path, label string, val *string, maxRunes int) string {
	if val == nil {
		v.AddError(path, label+" is required")
		return ""
	}
	trimmed := strings.TrimSpace(*val)
	if trimmed == "" {
		v.AddError(path, label+" is required")
		return ""
	}
	if maxRunes > 0 && utf8.RuneCountInString(trimmed) > maxRunes {
		v.AddError(path, label+" exceeds maximum length")
		return ""
	}
	return trimmed
}

func (v *Validator) OptionalTrimmed(path, label string, val *string, maxRunes int) string {
	if val == nil {
		return ""
	}
	trimmed := strings.TrimSpace(*val)
	if maxRunes > 0 && utf8.RuneCountInString(trimmed) > maxRunes {
		v.AddError(path, label+" exceeds maximum length")
	}
	return trimmed
}

func (v *Validator) Email(path string, val *string) string {
	if val == nil {
		v.AddError(path, "Email is required")
		return ""
	}
	trimmed := strings.TrimSpace(*val)
	if trimmed == "" {
		v.AddError(path, "Email is required")
		return ""
	}
	if utf8.RuneCountInString(trimmed) > 254 {
		v.AddError(path, "Email must be at most 254 characters")
		return ""
	}
	addr, err := mail.ParseAddress(trimmed)
	if err != nil || addr.Address != trimmed || !strings.Contains(trimmed, "@") {
		v.AddError(path, "Please provide a valid email address")
		return ""
	}
	return strings.ToLower(trimmed)
}

// EscapeLikePattern escapes SQL LIKE/ILIKE wildcard characters (%, _, \) so user search
// strings match literal characters when paired with ESCAPE '\'.
func EscapeLikePattern(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(s)
}

func IsValidIssueStatus(status string) bool {
	switch status {
	case "Open", "In Progress", "Closed":
		return true
	default:
		return false
	}
}

func IsValidIssuePriority(priority string) bool {
	switch priority {
	case "High", "Medium", "Low":
		return true
	default:
		return false
	}
}

func IsValidScopeImpact(impact string) bool {
	switch impact {
	case "None", "Expands", "Narrows", "Changes direction":
		return true
	default:
		return false
	}
}

func IsValidProjectStatusFilter(status string) bool {
	switch status {
	case "Active", "Archived", "All":
		return true
	default:
		return false
	}
}
