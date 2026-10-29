// Package database manages the PostgreSQL pgxpool connection pool and Goose SQL migrations.
package database

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

// SanitizePgxConnString strips Prisma-specific query parameters (such as schema=public or connection_limit)
// so pgxpool and database/sql can connect cleanly to the same DATABASE_URL.
func SanitizePgxConnString(rawURL string) (cleanURL string, maxConns int32, err error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "", 0, fmt.Errorf("invalid DATABASE_URL: %w", err)
	}

	q := parsed.Query()
	if rawLimit := q.Get("connection_limit"); rawLimit != "" {
		if n, convErr := strconv.Atoi(rawLimit); convErr == nil && n > 0 {
			maxConns = int32(n)
		}
		q.Del("connection_limit")
	}

	// Remove Prisma-only parameters not recognized as PostgreSQL server startup parameters
	q.Del("schema")
	q.Del("pool_timeout")
	q.Del("pgbouncer")

	parsed.RawQuery = q.Encode()
	return parsed.String(), maxConns, nil
}

// NewPool creates and verifies a pgxpool.Pool connection to PostgreSQL.
func NewPool(ctx context.Context, rawDatabaseURL string) (*pgxpool.Pool, error) {
	cleanURL, maxConns, err := SanitizePgxConnString(rawDatabaseURL)
	if err != nil {
		return nil, err
	}

	poolConfig, err := pgxpool.ParseConfig(cleanURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse pgxpool config: %w", err)
	}

	if maxConns > 0 {
		poolConfig.MaxConns = maxConns
	} else if IsLocalPGliteActive() {
		poolConfig.MaxConns = 1
	} else {
		poolConfig.MaxConns = 10
	}
	poolConfig.MaxConnIdleTime = 5 * time.Minute
	// Use unnamed prepared statements in the extended query protocol so that
	// connection recycling after MaxConnIdleTime (or behind connection poolers / PGlite)
	// never fails with SQLSTATE 42P05 (prepared statement "stmtcache_..." already exists).
	poolConfig.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeExec

	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create pgx connection pool: %w", err)
	}

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("failed to ping PostgreSQL database: %w", err)
	}

	return pool, nil
}

// ResolveMigrationsDir locates the SQL migrations directory whether the process working directory
// is apps/api-go or the repository root.
func ResolveMigrationsDir() string {
	candidates := []string{
		filepath.Join(".", "migrations"),
		filepath.Join("apps", "api-go", "migrations"),
	}
	for _, c := range candidates {
		if info, err := os.Stat(c); err == nil && info.IsDir() {
			return c
		}
	}
	return filepath.Join(".", "migrations")
}

// RunMigrations applies versioned SQL migrations from migrationsDir using Goose.
func RunMigrations(pool *pgxpool.Pool, migrationsDir string) error {
	sqlDB := stdlib.OpenDBFromPool(pool)
	defer func() {
		_ = sqlDB.Close()
	}()

	return RunMigrationsWithSQLDB(sqlDB, migrationsDir)
}

// RunMigrationsWithSQLDB runs Goose migrations against a standard *sql.DB handle.
func RunMigrationsWithSQLDB(sqlDB *sql.DB, migrationsDir string) error {
	if err := goose.SetDialect("postgres"); err != nil {
		return fmt.Errorf("failed to set goose dialect: %w", err)
	}
	if err := goose.Up(sqlDB, migrationsDir); err != nil {
		return fmt.Errorf("failed to apply goose migrations: %w", err)
	}
	return nil
}
