# Unpause — Course Final Project MVP (Go/Gin Backend + React Frontend)

**Unpause** helps a solo developer resume a project after being away.

Its single differentiator: **every Decision Record is automatically and permanently associated with the version of the project scope that was active when the decision was created**, allowing you to see how and why your project scope evolved over time.

Unpause presents user-saved data only. It does not generate AI summaries, judge scope alignment, or fabricate next actions automatically. It helps you *see*, not *decide*.

---

## 1. Repository Structure

```text
.
├── apps/
│   ├── api-go/               # Primary Go + Gin + pgx/v5 + Goose PostgreSQL REST API (/api/v1)
│   │   ├── cmd/
│   │   │   ├── server/       # HTTP API server entrypoint (graceful shutdown & timeouts)
│   │   │   ├── migrate/      # Standalone Goose SQL migration CLI
│   │   │   └── seed/         # Development-only seed CLI (guarded against production)
│   │   ├── internal/
│   │   │   ├── config/       # Startup environment variable validation
│   │   │   ├── database/     # pgxpool connection pool, Goose runner, dev Postgres helper
│   │   │   ├── http/         # Gin router, auth/CORS/Origin & error-handling middleware
│   │   │   ├── auth/         # Registration, login, logout, session & profile management
│   │   │   ├── projects/     # Projects CRUD, archive/restore, Resume Context, Scope Timeline
│   │   │   ├── scopes/       # Immutable Scope Versions & 405 immutability handler
│   │   │   ├── issues/       # Issues CRUD, filters, reversible status, pagination
│   │   │   ├── decisions/    # Decision Records CRUD, auto scopeVersionId binding, pin/unpin
│   │   │   ├── github/       # GitHub Explorer search, rate-limit (429) & upstream (502) handling
│   │   │   └── shared/       # AppError, Argon2id + bcrypt verification, validation, ownership
│   │   ├── migrations/       # Versioned Goose SQL migrations (idempotent, Prisma-compatible)
│   │   └── tests/            # Go httptest + real PostgreSQL integration test suite
│   ├── api/                  # Original Node.js/Express/Prisma backend (retained for reference)
│   └── web/                  # React + Vite + TypeScript + Material UI frontend
│       └── src/              # Axios client, TanStack Query, React Hook Form + Zod pages
├── scripts/
│   ├── dev.mjs               # Concurrent local development runner (Go API + Vite Web)
│   ├── pglite-server.mjs     # Local PGlite PostgreSQL wire-protocol socket server
│   └── run-go.mjs            # Cross-environment Go command wrapper
├── .env.example              # Safe environment variable placeholders
└── render.yaml               # Render deployment blueprint (Static Web + Go/Gin API + PostgreSQL)
```

---

## 2. Technology Stack

- **Frontend (`apps/web`):** React 18, Vite, TypeScript, Material UI (MUI, light mode), React Router, TanStack Query, Axios (single shared client in `apps/web/src/api/client.ts`), React Hook Form + Zod.
- **Primary Backend (`apps/api-go`):** Go (`1.24`), Gin (`github.com/gin-gonic/gin`), REST API under `/api/v1`, PostgreSQL via `pgx/v5` & `pgxpool`, versioned SQL migrations via `pressly/goose/v3`, explicit request & startup environment validation, Argon2id password hashing (`golang.org/x/crypto/argon2` in PHC format) with `bcrypt` verification fallback, and PostgreSQL-stored server-side sessions (`HttpOnly`, `SameSite=Lax` cookies).
- **Testing:** Go's built-in `testing` + `net/http/httptest` against a real PostgreSQL engine (`apps/api-go/tests/api_test.go`) and Vitest + React Testing Library (`apps/web/src/test/app.test.tsx`).

---

## 3. Prerequisites & Installation

### Prerequisites
- **Go** `>= 1.24`
- **Node.js** `>= 20.0.0` (tested on Node `v22`) and **npm** `>= 10.0.0`
- **PostgreSQL** `>= 15` (Note: for convenience in local development and tests, if no external PostgreSQL server is listening on `localhost:5432`, `apps/api-go` automatically starts a local PGlite PostgreSQL server persisted to `.pglite/unpause-dev-db`.)

### Install Dependencies

```bash
npm install
cd apps/api-go && go mod download
```

---

## 4. Environment Configuration

Copy the `.env.example` files and adjust values if needed:

```bash
cp apps/api-go/.env.example apps/api-go/.env
cp apps/web/.env.example apps/web/.env
```

### Go Backend Environment Variables (`apps/api-go/.env`)

| Variable | Description | Default / Example |
|---|---|---|
| `NODE_ENV` | `development`, `test`, or `production` (can also use `APP_ENV`) | `development` |
| `PORT` | Port for Go/Gin API server | `4000` |
| `DATABASE_URL` | PostgreSQL connection URL | `postgresql://postgres:postgres@localhost:5432/unpause?sslmode=disable` |
| `SESSION_SECRET` | Secret string (min 16 chars) | `replace-with-a-secure-random-secret-at-least-32-chars` |
| `SESSION_COOKIE_NAME` | Session cookie name | `unpause_sid` |
| `SESSION_TTL_HOURS` | Session duration in hours | `168` |
| `CORS_ORIGINS` | Comma-separated allowed frontend origins | `http://localhost:5173` |
| `GITHUB_API_BASE_URL` | GitHub REST API base URL | `https://api.github.com` |
| `GITHUB_TOKEN` | Optional GitHub token for higher rate limits | `""` |

### Frontend Environment Variables (`apps/web/.env`)

| Variable | Description | Default / Example |
|---|---|---|
| `VITE_API_BASE_URL` | Backend `/api/v1` base URL | `http://localhost:4000/api/v1` |

---

## 5. Database Setup, Migrations, and Seed

The Go backend uses **Goose** (`github.com/pressly/goose/v3`) to manage versioned SQL migrations in `apps/api-go/migrations/`. The baseline migration (`00001_init_schema.sql`) uses idempotent DDL (`CREATE TABLE IF NOT EXISTS`, `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object ...`) so it safely preserves all existing tables, data, constraints, and triggers from Databases originally initialized by Prisma Migrate.

### Run Migrations
```bash
# Apply all pending migrations
npm run db:migrate:deploy

# Check current migration status
npm run db:migrate:status

# Or directly in apps/api-go:
cd apps/api-go && go run ./cmd/migrate up
```

### Run Development Seed (Non-Production Only)
Populates a demo developer account (`demo@unpause.local` / `Password123!`) with a sample project, Scope v1 & v2, issues, and decisions. Refuses to run when `NODE_ENV=production`. (Normal user registrations always start with empty states.)
```bash
npm run db:seed

# Or directly in apps/api-go:
cd apps/api-go && go run ./cmd/seed
```

---

## 6. Running the Application Locally

Start both the Go/Gin API (`http://localhost:4000`) and Vite React frontend (`http://localhost:5173`):

```bash
npm run dev
```

Or run them in separate terminals:
```bash
npm run dev:api
npm run dev:web
```

Build both the Go backend binaries (`apps/api-go/bin/{server,migrate,seed}`) and React frontend (`apps/web/dist`) for production:
```bash
npm run build
```

---

## 7. Running Tests

Run the full automated test suite (Go API integration tests + React frontend tests):

```bash
npm test
```

Or run them individually:
```bash
# Run Go backend integration tests (19 subtests across Test1-Test4)
npm run test:api

# Run React frontend tests
npm run test:web

# (Optional) Run original Node/Express baseline tests
npm run test:api:node
```

The Go integration test suite (`apps/api-go/tests/api_test.go`) verifies:
1. Startup environment variable validation, `/api/v1/health`, and consistent error responses with UUID error IDs (`error.id`).
2. CORS allowlist & `Origin` validation on state-changing requests (`403 INVALID_ORIGIN`).
3. Registration, login, session persistence, display name update, logout invalidation, and verification of both Argon2id PHC hashes and legacy `bcrypt` hashes.
4. Transactional creation of a Project and its initial Scope Version 1.
5. Automatic association of Decision Records with the active Scope Version and preservation of `scopeVersionId` when edited after newer scope versions are created.
6. Preservation of Decision Record `updatedAt` (content-modified timestamp) when pinning or unpinning.
7. Scope Version immutability enforced at both the API level (`405 SCOPE_VERSION_IMMUTABLE`) and PostgreSQL level (`trg_prevent_scope_version_update` trigger + `ON DELETE RESTRICT` foreign key).
8. Retention of Decision Records (`issueId` set to `null`) when a linked Issue is deleted (`ON DELETE SET NULL`).
9. Strict read-only enforcement on `Archived` projects (`403 PROJECT_ARCHIVED`) until restored.
10. Strict per-user ownership isolation across all endpoints.
11. GitHub Explorer backend search, filtering, rate-limit (`429 GITHUB_RATE_LIMIT`), and upstream error (`502 GITHUB_UPSTREAM_ERROR`) handling.

---

## 8. Deployment on Render

This repository includes a [`render.yaml`](./render.yaml) blueprint for deploying on Render:

1. **PostgreSQL Database (`unpause-postgres`)**: Managed PostgreSQL database.
2. **Go Backend Web Service (`unpause-api`)**:
   - Runtime: `go` (`rootDir: apps/api-go`)
   - Build command: `go build -o bin/server ./cmd/server && go build -o bin/migrate ./cmd/migrate`
   - Pre-deploy command: `./bin/migrate up`
   - Start command: `./bin/server`
   - Set `CORS_ORIGINS` to your deployed frontend static site URL (e.g., `https://unpause-web.onrender.com`).
3. **Static Frontend (`unpause-web`)**:
   - Build command: `npm install && npm run build:web`
   - Publish directory: `apps/web/dist`
   - Set `VITE_API_BASE_URL` to your backend service URL + `/api/v1` (or `/api/v1` with a Render rewrite rule from `/api/*` to `unpause-api`).

---

## 9. Implemented MVP Features vs. Future Roadmap

### Implemented in this MVP
- [x] Email/password registration, login, logout, and PostgreSQL server-side sessions (`HttpOnly`, `SameSite=Lax`)
- [x] Per-user ownership isolation across all projects, scope versions, issues, and decisions
- [x] Projects: create (with transactional Scope Version 1 creation), edit details, archive (read-only), restore, search by name, and filter by status
- [x] Scope Versions: immutable scope versions with required reason for change, prefilled from current or historical versions
- [x] **Resume Context** page: current scope summary, up to 3 pinned decisions, up to 5 recent decisions under current scope, and up to 5 open/in-progress issues with `nextAction` ordered by priority then last modified
- [x] **Scope Timeline** page: chronological Scope Versions (`v1`, `v2`, ...) with decisions grouped under the version active when they were recorded and `scopeImpact` labels
- [x] Issues: full CRUD, `nextAction` field, reversible statuses (`Open`, `In Progress`, `Closed`), priority (`High`, `Medium`, `Low`), status/priority filters, pagination (20 per page), explicit Edit/Save without unnecessary requests
- [x] Decision Records: full CRUD, automatic `scopeVersionId` binding on create, preserved `scopeVersionId` on edit, `scopeImpact` labels (`None`, `Expands`, `Narrows`, `Changes direction`), pin/unpin without altering `updatedAt`, optional Issue link (`SetNull` on issue delete), and keyword search
- [x] **GitHub Explorer** page: debounced public repository search via backend, language & minimum stars filters, pagination, and explicit rate-limit/error handling with Retry
- [x] Settings page: update user display name
- [x] Timestamps stored in UTC and displayed in `Asia/Bangkok`

### Roadmap (Not Implemented in Course MVP)
- [ ] Separate Next Actions resource (multiple next actions per project/issue)
- [ ] Side-by-side diff comparison between arbitrary Scope Versions
- [ ] Direct link from a Scope Version to the Decision Record that triggered it
- [ ] Scope Alignment Review history
- [ ] Project References / saving GitHub repositories into a project
- [ ] JSON export/import
- [ ] Password reset by email, password change, and account deletion
- [ ] Rate limiting, CSRF token infrastructure, and idempotency keys
- [ ] OpenAPI/Swagger docs, structured JSON logging, CI pipelines, and Playwright E2E suite
