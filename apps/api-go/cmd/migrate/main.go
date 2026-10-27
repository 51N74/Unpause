package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/westride/unpause/api-go/internal/config"
	"github.com/westride/unpause/api-go/internal/database"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "Migration error: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.LoadFromEnv()
	if err != nil {
		return fmt.Errorf("configuration error: %w", err)
	}

	command := "up"
	if len(os.Args) > 1 {
		command = os.Args[1]
	}

	stopLocalPg, err := database.EnsureLocalPostgresIfNeeded(cfg.Env, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("local development PostgreSQL startup failed: %w", err)
	}
	defer stopLocalPg()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	pool, err := database.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("database connection failed: %w", err)
	}
	defer pool.Close()

	sqlDB := stdlib.OpenDBFromPool(pool)
	defer func() {
		_ = sqlDB.Close()
	}()

	if err := goose.SetDialect("postgres"); err != nil {
		return fmt.Errorf("failed to set goose dialect: %w", err)
	}

	migrationsDir := filepath.Join(".", "migrations")
	if err := goose.RunContext(ctx, command, sqlDB, migrationsDir, os.Args[2:]...); err != nil {
		return fmt.Errorf("goose %q failed: %w", command, err)
	}

	return nil
}
