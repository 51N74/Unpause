// Package config validates and provides application configuration from environment variables.
package config

import (
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

// Config holds validated startup settings for the Unpause Go API server.
type Config struct {
	Env                   string
	Port                  int
	DatabaseURL           string
	SessionSecret         string
	SessionCookieName     string
	SessionCookieSameSite string
	SessionCookieSecure   *bool
	SessionTTLHours       int
	CORSOrigins           []string
	GitHubAPIBaseURL      string
	GitHubToken           string
	AuthRateLimitPerMin   int
	StaticFilesDir        string
}

// CookieSameSiteMode returns the net/http SameSite mode (defaulting to Lax).
func (c *Config) CookieSameSiteMode() http.SameSite {
	switch strings.ToLower(strings.TrimSpace(c.SessionCookieSameSite)) {
	case "none":
		return http.SameSiteNoneMode
	case "strict":
		return http.SameSiteStrictMode
	default:
		return http.SameSiteLaxMode
	}
}

// CookieSecure reports whether the session cookie must be marked Secure.
func (c *Config) CookieSecure() bool {
	if c.SessionCookieSecure != nil {
		return *c.SessionCookieSecure
	}
	return c.Env == "production" || c.CookieSameSiteMode() == http.SameSiteNoneMode
}

// EffectiveAuthRateLimitPerMin returns the per-IP per-minute limit for authentication endpoints.
func (c *Config) EffectiveAuthRateLimitPerMin() int {
	if c.AuthRateLimitPerMin > 0 {
		return c.AuthRateLimitPerMin
	}
	return 25
}

// LoadFromEnv loads an optional .env file and validates process environment variables.
func LoadFromEnv() (*Config, error) {
	_ = godotenv.Load()
	return ParseEnv(os.Getenv)
}

// ParseEnv validates configuration using a lookup function so tests can supply custom maps.
func ParseEnv(getenv func(string) string) (*Config, error) {
	var issues []string

	env := strings.TrimSpace(getenv("NODE_ENV"))
	if env == "" {
		env = strings.TrimSpace(getenv("APP_ENV"))
	}
	if env == "" {
		env = "development"
	}
	switch env {
	case "development", "test", "production":
	default:
		issues = append(issues, "NODE_ENV: must be one of development, test, production")
	}

	port := 4000
	if rawPort := strings.TrimSpace(getenv("PORT")); rawPort != "" {
		p, err := strconv.Atoi(rawPort)
		if err != nil || p <= 0 || p > 65535 {
			issues = append(issues, "PORT: must be a positive integer between 1 and 65535")
		} else {
			port = p
		}
	}

	dbURL := strings.TrimSpace(getenv("DATABASE_URL"))
	if dbURL == "" {
		issues = append(issues, "DATABASE_URL: DATABASE_URL is required")
	} else if !strings.HasPrefix(dbURL, "postgresql://") && !strings.HasPrefix(dbURL, "postgres://") {
		issues = append(issues, "DATABASE_URL: DATABASE_URL must be a valid PostgreSQL connection string")
	}

	sessionSecret := getenv("SESSION_SECRET")
	if len(sessionSecret) < 16 {
		issues = append(issues, "SESSION_SECRET: SESSION_SECRET must be at least 16 characters long")
	}

	cookieName := strings.TrimSpace(getenv("SESSION_COOKIE_NAME"))
	if cookieName == "" {
		cookieName = "unpause_sid"
	}

	cookieSameSite := strings.ToLower(strings.TrimSpace(getenv("SESSION_COOKIE_SAMESITE")))
	if cookieSameSite == "" {
		cookieSameSite = "lax"
	}
	switch cookieSameSite {
	case "lax", "strict", "none":
	default:
		issues = append(issues, "SESSION_COOKIE_SAMESITE: must be one of lax, strict, none")
	}

	var cookieSecure *bool
	if rawSecure := strings.ToLower(strings.TrimSpace(getenv("SESSION_COOKIE_SECURE"))); rawSecure != "" {
		switch rawSecure {
		case "true", "1":
			b := true
			cookieSecure = &b
		case "false", "0":
			b := false
			cookieSecure = &b
		default:
			issues = append(issues, "SESSION_COOKIE_SECURE: must be true or false")
		}
	}
	if cookieSameSite == "none" && cookieSecure != nil && !*cookieSecure {
		issues = append(issues, "SESSION_COOKIE_SECURE: must be true when SESSION_COOKIE_SAMESITE is none")
	}

	ttlHours := 168
	if rawTTL := strings.TrimSpace(getenv("SESSION_TTL_HOURS")); rawTTL != "" {
		t, err := strconv.Atoi(rawTTL)
		if err != nil || t <= 0 {
			issues = append(issues, "SESSION_TTL_HOURS: must be a positive integer")
		} else {
			ttlHours = t
		}
	}

	authRateLimit := 25
	if rawRate := strings.TrimSpace(getenv("AUTH_RATE_LIMIT_MAX")); rawRate != "" {
		r, err := strconv.Atoi(rawRate)
		if err != nil || r <= 0 {
			issues = append(issues, "AUTH_RATE_LIMIT_MAX: must be a positive integer")
		} else {
			authRateLimit = r
		}
	}

	staticFilesDir := strings.TrimSpace(getenv("STATIC_FILES_DIR"))

	rawOrigins := strings.TrimSpace(getenv("CORS_ORIGINS"))
	renderExternalURL := strings.TrimRight(strings.TrimSpace(getenv("RENDER_EXTERNAL_URL")), "/")
	var corsOrigins []string
	if rawOrigins == "" && renderExternalURL == "" {
		issues = append(issues, "CORS_ORIGINS: CORS_ORIGINS is required")
	} else {
		seenOrigins := make(map[string]struct{})
		for _, part := range strings.Split(rawOrigins, ",") {
			trimmed := strings.TrimRight(strings.TrimSpace(part), "/")
			if trimmed != "" {
				if _, exists := seenOrigins[trimmed]; !exists {
					seenOrigins[trimmed] = struct{}{}
					corsOrigins = append(corsOrigins, trimmed)
				}
			}
		}
		if renderExternalURL != "" {
			if _, exists := seenOrigins[renderExternalURL]; !exists {
				seenOrigins[renderExternalURL] = struct{}{}
				corsOrigins = append(corsOrigins, renderExternalURL)
			}
		}
		if len(corsOrigins) == 0 {
			issues = append(issues, "CORS_ORIGINS: at least one allowed origin is required")
		}
	}

	githubBase := strings.TrimSpace(getenv("GITHUB_API_BASE_URL"))
	if githubBase == "" {
		githubBase = "https://api.github.com"
	} else {
		parsedURL, err := url.ParseRequestURI(githubBase)
		if err != nil || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") {
			issues = append(issues, "GITHUB_API_BASE_URL: must be a valid URL")
		}
	}

	githubToken := strings.TrimSpace(getenv("GITHUB_TOKEN"))

	if len(issues) > 0 {
		return nil, fmt.Errorf("Invalid environment configuration: %s", strings.Join(issues, "; "))
	}

	return &Config{
		Env:                   env,
		Port:                  port,
		DatabaseURL:           dbURL,
		SessionSecret:         sessionSecret,
		SessionCookieName:     cookieName,
		SessionCookieSameSite: cookieSameSite,
		SessionCookieSecure:   cookieSecure,
		SessionTTLHours:       ttlHours,
		CORSOrigins:           corsOrigins,
		GitHubAPIBaseURL:      strings.TrimRight(githubBase, "/"),
		GitHubToken:           githubToken,
		AuthRateLimitPerMin:   authRateLimit,
		StaticFilesDir:        staticFilesDir,
	}, nil
}
