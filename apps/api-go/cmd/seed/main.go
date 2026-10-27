package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/westride/unpause/api-go/internal/config"
	"github.com/westride/unpause/api-go/internal/database"
	"github.com/westride/unpause/api-go/internal/shared"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "Seed error: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	if os.Getenv("NODE_ENV") == "production" {
		return fmt.Errorf("refusing to run seed script in production environment")
	}

	cfg, err := config.LoadFromEnv()
	if err != nil {
		return fmt.Errorf("configuration error: %w", err)
	}
	if cfg.Env == "production" {
		return fmt.Errorf("refusing to run seed script in production environment")
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

	migrationsDir := filepath.Join(".", "migrations")
	if err := database.RunMigrations(pool, migrationsDir); err != nil {
		return fmt.Errorf("database migration failed: %w", err)
	}

	log.Println("Running development seed (Go)...")

	email := "demo@unpause.local"
	passwordHash, err := shared.HashPassword("Password123!")
	if err != nil {
		return fmt.Errorf("failed to hash demo password: %w", err)
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to start transaction: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	var existingUserID string
	err = tx.QueryRow(ctx, `SELECT "id" FROM "User" WHERE "email" = $1`, email).Scan(&existingUserID)
	if err != nil && err != pgx.ErrNoRows {
		return fmt.Errorf("failed to query existing demo user: %w", err)
	}

	if existingUserID != "" {
		_, _ = tx.Exec(ctx, `DELETE FROM "DecisionRecord" WHERE "projectId" IN (SELECT "id" FROM "Project" WHERE "userId" = $1)`, existingUserID)
		_, _ = tx.Exec(ctx, `DELETE FROM "Issue" WHERE "projectId" IN (SELECT "id" FROM "Project" WHERE "userId" = $1)`, existingUserID)
		_, _ = tx.Exec(ctx, `DELETE FROM "ScopeVersion" WHERE "projectId" IN (SELECT "id" FROM "Project" WHERE "userId" = $1)`, existingUserID)
		_, _ = tx.Exec(ctx, `DELETE FROM "Project" WHERE "userId" = $1`, existingUserID)
		_, _ = tx.Exec(ctx, `DELETE FROM "User" WHERE "id" = $1`, existingUserID)
	}

	now := time.Now().UTC()
	userID := uuid.NewString()
	projectID := uuid.NewString()
	scopeV1ID := uuid.NewString()
	scopeV2ID := uuid.NewString()
	issue1ID := uuid.NewString()
	issue2ID := uuid.NewString()
	decision1ID := uuid.NewString()
	decision2ID := uuid.NewString()

	_, err = tx.Exec(ctx,
		`INSERT INTO "User" ("id", "email", "passwordHash", "displayName", "createdAt", "updatedAt")
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		userID, email, passwordHash, "Alex (Solo Dev)", now, now,
	)
	if err != nil {
		return fmt.Errorf("failed to insert demo user: %w", err)
	}

	_, err = tx.Exec(ctx,
		`INSERT INTO "Project" ("id", "userId", "name", "description", "status", "createdAt", "updatedAt")
		 VALUES ($1, $2, $3, $4, 'Active'::"ProjectStatus", $5, $6)`,
		projectID, userID,
		"InvoiceFlow CLI",
		"A lightweight command-line invoice generator for freelance developers.",
		now, now,
	)
	if err != nil {
		return fmt.Errorf("failed to insert demo project: %w", err)
	}

	_, err = tx.Exec(ctx,
		`INSERT INTO "ScopeVersion"
		 ("id", "projectId", "versionNumber", "problem", "targetUsers", "goal", "inScope", "outOfScope", "reasonForChange", "createdAt")
		 VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9)`,
		scopeV1ID, projectID,
		"Freelancers waste 30 minutes formatting PDF invoices manually every month.",
		"Solo freelance software engineers billing 1-5 clients.",
		"Generate clean PDF invoices from a YAML file in under 10 seconds.",
		"YAML config parsing, single HTML-to-PDF template, CLI flags for output path, tax calculation.",
		"Web dashboard, recurring billing automation, Stripe integration, multi-user accounts.",
		"Initial scope",
		now.Add(-7*24*time.Hour),
	)
	if err != nil {
		return fmt.Errorf("failed to insert Scope v1: %w", err)
	}

	_, err = tx.Exec(ctx,
		`INSERT INTO "Issue" ("id", "projectId", "title", "description", "status", "priority", "nextAction", "createdAt", "updatedAt")
		 VALUES ($1, $2, $3, $4, 'In Progress'::"IssueStatus", 'High'::"IssuePriority", $5, $6, $7)`,
		issue1ID, projectID,
		"Fix rounding error on fractional tax rates",
		"Tax rates like 7.25% produce floating point precision issues.",
		"Replace float multiplication with integer cents arithmetic in src/calc.ts",
		now, now,
	)
	if err != nil {
		return fmt.Errorf("failed to insert Issue 1: %w", err)
	}

	_, err = tx.Exec(ctx,
		`INSERT INTO "Issue" ("id", "projectId", "title", "description", "status", "priority", "nextAction", "createdAt", "updatedAt")
		 VALUES ($1, $2, $3, $4, 'Open'::"IssueStatus", 'Medium'::"IssuePriority", $5, $6, $7)`,
		issue2ID, projectID,
		"Add currency symbol option to YAML schema",
		"Support USD, THB, and EUR symbols in invoice totals.",
		"Add currency enum to Zod config schema and update PDF footer partial",
		now, now,
	)
	if err != nil {
		return fmt.Errorf("failed to insert Issue 2: %w", err)
	}

	d1Time := now.Add(-6 * 24 * time.Hour)
	_, err = tx.Exec(ctx,
		`INSERT INTO "DecisionRecord"
		 ("id", "projectId", "scopeVersionId", "issueId", "problem", "decision", "rationale",
		  "alternativesConsidered", "outcome", "scopeImpact", "isPinned", "pinnedAt", "createdAt", "updatedAt")
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Narrows'::"ScopeImpact", true, $10, $11, $12)`,
		decision1ID, projectID, scopeV1ID, issue1ID,
		"Need reliable PDF generation without requiring headless Chrome.",
		"Use PDFKit directly instead of Puppeteer.",
		"Puppeteer downloads a 150MB Chromium binary and breaks offline CLI installs.",
		"Puppeteer, Playwright, wkhtmltopdf",
		"CLI package size dropped to 4MB and installs in 2 seconds.",
		d1Time, d1Time, d1Time,
	)
	if err != nil {
		return fmt.Errorf("failed to insert Decision 1: %w", err)
	}

	_, err = tx.Exec(ctx,
		`INSERT INTO "ScopeVersion"
		 ("id", "projectId", "versionNumber", "problem", "targetUsers", "goal", "inScope", "outOfScope", "reasonForChange", "createdAt")
		 VALUES ($1, $2, 2, $3, $4, $5, $6, $7, $8, $9)`,
		scopeV2ID, projectID,
		"Freelancers waste 30 minutes formatting PDF invoices manually every month.",
		"Solo freelance software engineers billing domestic and international clients.",
		"Generate clean PDF invoices from a YAML file with multi-currency support.",
		"YAML config parsing, single PDFKit layout, CLI flags, integer tax calculation, static currency symbol formatting.",
		"Web dashboard, live FX rate fetching, recurring billing, Stripe integration.",
		"Two early testers needed EUR and THB symbol support on invoices, while HTML-to-PDF was dropped in favor of a single PDFKit layout.",
		now.Add(-2*24*time.Hour),
	)
	if err != nil {
		return fmt.Errorf("failed to insert Scope v2: %w", err)
	}

	d2Time := now.Add(-1 * 24 * time.Hour)
	_, err = tx.Exec(ctx,
		`INSERT INTO "DecisionRecord"
		 ("id", "projectId", "scopeVersionId", "issueId", "problem", "decision", "rationale",
		  "alternativesConsidered", "outcome", "scopeImpact", "isPinned", "pinnedAt", "createdAt", "updatedAt")
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Expands'::"ScopeImpact", true, $10, $11, $12)`,
		decision2ID, projectID, scopeV2ID, issue2ID,
		"Users requested multi-currency invoices, which could balloon scope.",
		"Support static currency code and symbol in YAML only; do not fetch exchange rates.",
		"Freelancers already agree on a billing currency per contract; live FX APIs add failure modes.",
		"OpenExchangeRates API integration",
		"Kept CLI 100% offline-capable.",
		d2Time, d2Time, d2Time,
	)
	if err != nil {
		return fmt.Errorf("failed to insert Decision 2: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit seed transaction: %w", err)
	}

	log.Println("Seed completed! Demo login: demo@unpause.local / Password123!")
	return nil
}
