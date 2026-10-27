package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/westride/unpause/api-go/internal/shared"
)

// Service handles authentication, PostgreSQL session persistence, and user profile updates.
type Service struct {
	pool            *pgxpool.Pool
	sessionTTLHours int
}

func NewService(pool *pgxpool.Pool, sessionTTLHours int) *Service {
	return &Service{
		pool:            pool,
		sessionTTLHours: sessionTTLHours,
	}
}

func generateSessionToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("failed to generate session token: %w", err)
	}
	return hex.EncodeToString(b), nil
}

func (s *Service) sessionExpiry() time.Time {
	return time.Now().UTC().Add(time.Duration(s.sessionTTLHours) * time.Hour)
}

// Register creates a new User and initial Session inside a single PostgreSQL transaction.
func (s *Service) Register(ctx context.Context, email, password, displayName string) (UserResponse, string, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return UserResponse{}, "", err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	var existingID string
	err = tx.QueryRow(ctx, `SELECT "id" FROM "User" WHERE "email" = $1`, email).Scan(&existingID)
	if err == nil {
		return UserResponse{}, "", shared.NewConflictError("An account with this email already exists.", nil)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return UserResponse{}, "", err
	}

	passwordHash, err := shared.HashPassword(password)
	if err != nil {
		return UserResponse{}, "", err
	}

	finalDisplayName := strings.TrimSpace(displayName)
	if finalDisplayName == "" {
		parts := strings.Split(email, "@")
		if len(parts) > 0 && parts[0] != "" {
			finalDisplayName = parts[0]
		} else {
			finalDisplayName = "Developer"
		}
	}
	if utf8.RuneCountInString(finalDisplayName) > 80 {
		runes := []rune(finalDisplayName)
		finalDisplayName = string(runes[:80])
	}

	userID := uuid.NewString()
	sessionID, err := generateSessionToken()
	if err != nil {
		return UserResponse{}, "", err
	}
	now := time.Now().UTC()
	expiresAt := s.sessionExpiry()

	var user User
	err = tx.QueryRow(
		ctx,
		`INSERT INTO "User" ("id", "email", "passwordHash", "displayName", "createdAt", "updatedAt")
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING "id", "email", "passwordHash", "displayName", "createdAt", "updatedAt"`,
		userID, email, passwordHash, finalDisplayName, now, now,
	).Scan(&user.ID, &user.Email, &user.PasswordHash, &user.DisplayName, &user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		return UserResponse{}, "", err
	}

	_, err = tx.Exec(
		ctx,
		`INSERT INTO "Session" ("id", "userId", "expiresAt", "createdAt")
		 VALUES ($1, $2, $3, $4)`,
		sessionID, user.ID, expiresAt, now,
	)
	if err != nil {
		return UserResponse{}, "", err
	}

	if err := tx.Commit(ctx); err != nil {
		return UserResponse{}, "", err
	}

	return SerializeUser(user), sessionID, nil
}

// Login verifies email/password credentials and creates a new PostgreSQL session.
func (s *Service) Login(ctx context.Context, email, password string) (UserResponse, string, error) {
	var user User
	err := s.pool.QueryRow(
		ctx,
		`SELECT "id", "email", "passwordHash", "displayName", "createdAt", "updatedAt"
		 FROM "User"
		 WHERE "email" = $1`,
		email,
	).Scan(&user.ID, &user.Email, &user.PasswordHash, &user.DisplayName, &user.CreatedAt, &user.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return UserResponse{}, "", shared.NewUnauthorizedError("Invalid email or password.")
	}
	if err != nil {
		return UserResponse{}, "", err
	}

	valid, err := shared.VerifyPassword(user.PasswordHash, password)
	if err != nil || !valid {
		return UserResponse{}, "", shared.NewUnauthorizedError("Invalid email or password.")
	}

	sessionID, err := generateSessionToken()
	if err != nil {
		return UserResponse{}, "", err
	}
	now := time.Now().UTC()
	expiresAt := s.sessionExpiry()

	_, err = s.pool.Exec(
		ctx,
		`INSERT INTO "Session" ("id", "userId", "expiresAt", "createdAt")
		 VALUES ($1, $2, $3, $4)`,
		sessionID, user.ID, expiresAt, now,
	)
	if err != nil {
		return UserResponse{}, "", err
	}

	return SerializeUser(user), sessionID, nil
}

// Logout deletes the session record from PostgreSQL.
func (s *Service) Logout(ctx context.Context, sessionID string) error {
	if strings.TrimSpace(sessionID) == "" {
		return nil
	}
	_, err := s.pool.Exec(ctx, `DELETE FROM "Session" WHERE "id" = $1`, sessionID)
	return err
}

// ValidateSession looks up the session and its associated user, deleting expired sessions if found.
func (s *Service) ValidateSession(ctx context.Context, sessionID string) (*User, error) {
	if strings.TrimSpace(sessionID) == "" {
		return nil, shared.NewUnauthorizedError("Authentication required")
	}

	var user User
	var expiresAt time.Time
	err := s.pool.QueryRow(
		ctx,
		`SELECT u."id", u."email", u."passwordHash", u."displayName", u."createdAt", u."updatedAt", s."expiresAt"
		 FROM "Session" s
		 INNER JOIN "User" u ON u."id" = s."userId"
		 WHERE s."id" = $1`,
		sessionID,
	).Scan(
		&user.ID,
		&user.Email,
		&user.PasswordHash,
		&user.DisplayName,
		&user.CreatedAt,
		&user.UpdatedAt,
		&expiresAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, shared.NewUnauthorizedError("Authentication required")
	}
	if err != nil {
		return nil, err
	}

	if !expiresAt.After(time.Now().UTC()) {
		_, _ = s.pool.Exec(ctx, `DELETE FROM "Session" WHERE "id" = $1`, sessionID)
		return nil, shared.NewUnauthorizedError("Session expired. Please log in again.")
	}

	return &user, nil
}

// UpdateDisplayName updates the logged-in user's displayName.
func (s *Service) UpdateDisplayName(ctx context.Context, userID, displayName string) (UserResponse, error) {
	now := time.Now().UTC()
	var user User
	err := s.pool.QueryRow(
		ctx,
		`UPDATE "User"
		 SET "displayName" = $1, "updatedAt" = $2
		 WHERE "id" = $3
		 RETURNING "id", "email", "passwordHash", "displayName", "createdAt", "updatedAt"`,
		strings.TrimSpace(displayName), now, userID,
	).Scan(&user.ID, &user.Email, &user.PasswordHash, &user.DisplayName, &user.CreatedAt, &user.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return UserResponse{}, shared.NewNotFoundError("User not found")
	}
	if err != nil {
		return UserResponse{}, err
	}
	return SerializeUser(user), nil
}
