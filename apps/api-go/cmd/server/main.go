package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/westride/unpause/api-go/internal/config"
	"github.com/westride/unpause/api-go/internal/database"
	"github.com/westride/unpause/api-go/internal/http/router"
)

func main() {
	if err := run(); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}

func run() error {
	cfg, err := config.LoadFromEnv()
	if err != nil {
		return fmt.Errorf("startup configuration error: %w", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	stopLocalPg, err := database.EnsureLocalPostgresIfNeeded(cfg.Env, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("local development PostgreSQL startup failed: %w", err)
	}
	defer stopLocalPg()

	pool, err := database.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("database connection failed: %w", err)
	}
	defer pool.Close()

	if cfg.Env == "development" || os.Getenv("AUTO_MIGRATE") == "true" {
		migrationsDir := filepath.Join(".", "migrations")
		if err := database.RunMigrations(pool, migrationsDir); err != nil {
			return fmt.Errorf("database migration failed: %w", err)
		}
	}

	deps := router.NewDependencies(cfg, pool, nil)
	engine := router.NewEngine(deps)

	srv := &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.Port),
		Handler:           engine,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		log.Printf("Unpause Go/Gin API listening on port %d (%s)", cfg.Port, cfg.Env)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- fmt.Errorf("HTTP server error: %w", err)
		}
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		log.Println("Shutting down Unpause Go/Gin API server gracefully...")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("server forced to shutdown: %w", err)
	}
	return nil
}
