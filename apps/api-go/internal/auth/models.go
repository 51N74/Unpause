// Package auth implements user registration, login, logout, session management, and profile updates.
package auth

import (
	"time"

	"github.com/westride/unpause/api-go/internal/shared"
)

// User represents the database User record.
type User struct {
	ID           string
	Email        string
	PasswordHash string
	DisplayName  string
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// UserResponse is the safe JSON representation of a User (excluding passwordHash).
type UserResponse struct {
	ID          string `json:"id"`
	Email       string `json:"email"`
	DisplayName string `json:"displayName"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

func SerializeUser(u User) UserResponse {
	return UserResponse{
		ID:          u.ID,
		Email:       u.Email,
		DisplayName: u.DisplayName,
		CreatedAt:   shared.FormatISO8601(u.CreatedAt),
		UpdatedAt:   shared.FormatISO8601(u.UpdatedAt),
	}
}

type RegisterRequest struct {
	Email       *string `json:"email"`
	Password    *string `json:"password"`
	DisplayName *string `json:"displayName"`
}

type LoginRequest struct {
	Email    *string `json:"email"`
	Password *string `json:"password"`
}

type UpdateProfileRequest struct {
	DisplayName *string `json:"displayName"`
}
