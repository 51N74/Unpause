# Unpause

**Unpause** is a full-stack web application designed to help solo developers resume software projects after time away without losing context.

When returning to a paused project, developers often remember *what* code exists but forget *why* scope boundaries changed or what the immediate next step was. Unpause addresses this by automatically and permanently linking every **Decision Record** to the **Scope Version** that was active when the decision was recorded, alongside a focused **Resume Context** view and issue-level `nextAction` tracking.

Unpause stores and displays user-authored project records only—it does not generate AI summaries, automatically judge scope alignment, or fabricate next actions.

---

## Table of Contents

1. [Features](#1-features)
2. [Tech Stack](#2-tech-stack)
3. [Architecture](#3-architecture)
4. [Project Structure](#4-project-structure)
5. [Prerequisites](#5-prerequisites)
6. [Getting Started](#6-getting-started)
7. [Environment Variables](#7-environment-variables)
8. [Development Commands](#8-development-commands)
9. [Testing](#9-testing)
10. [API Overview](#10-api-overview)
11. [Deployment: Render + Neon](#11-deployment-render--neon)
12. [Troubleshooting](#12-troubleshooting)
13. [Project Status and License](#13-project-status-and-license)

---

## 1. Features

### Implemented Features

- **Authentication & Server-Side Sessions:**
  - Email and password registration, login, and logout.
  - Argon2id password hashing (`golang.org/x/crypto/argon2` in PHC string format) with legacy `bcrypt` verification compatibility and bounded hashing concurrency.
  - PostgreSQL-backed server-side sessions (`Session` table) delivered via `HttpOnly` cookies (`unpause_sid`, `SameSite=Lax`, and `Secure=true` in production).
  - Pre-existing sessions are invalidated in PostgreSQL when a user logs in or registers again, and per-IP rate limiting protects `/api/v1/auth/login` and `/api/v1/auth/register`.
- **Strict Per-User Ownership Isolation:**
  - Every project, scope version, issue, and decision record is scoped to the authenticated owner (`userId`). Cross-user and cross-project resource access returns `404 Not Found`.
- **Projects & Transactional Initial Scope:**
  - Creating a project atomically creates **Scope Version 1 (`v1`)** in the same PostgreSQL transaction.
  - Projects support name search, status filtering (`Active`, `Archived`, `All`), metadata editing, archiving (which enforces read-only mode across the project's scope versions, issues, and decisions with `403 PROJECT_ARCHIVED`), and restoring to `Active`.
- **Immutable Scope Versions:**
  - Each scope version records `problem`, `targetUsers`, `goal`, `inScope`, `outOfScope`, and `reasonForChange` with a sequential `versionNumber` (`v1`, `v2`, ...).
  - Scope versions are append-only: update and delete attempts are rejected both at the HTTP layer (`405 SCOPE_VERSION_IMMUTABLE`) and at the PostgreSQL layer (`trg_prevent_scope_version_update` trigger and `ON DELETE RESTRICT` foreign key).
- **Scope-Linked Decision Records:**
  - Creating a decision record (`problem`, `decision`, `rationale`, optional `alternativesConsidered` and `outcome`, `scopeImpact`, and optional `issueId`) automatically binds it to the project's currently active `ScopeVersion`.
  - Editing a decision record's text or impact preserves its original `scopeVersionId` even after newer scope versions are created.
  - Decisions can be pinned or unpinned (up to 3 shown in Resume Context) without mutating the content `updatedAt` timestamp.
  - Supports keyword search and filtering by `scopeImpact` (`None`, `Expands`, `Narrows`, `Changes direction`), `scopeVersionId`, and `pinnedOnly`.
- **Issues with Required Next Actions:**
  - Full CRUD for project issues with required `title` and `nextAction`, optional `description`, reversible `status` (`Open`, `In Progress`, `Closed`), and `priority` (`High`, `Medium`, `Low`).
  - Supports filtering by status, priority, and keyword search, with server-side pagination (default 20 per page).
  - Deleting an issue retains any linked decision records and sets their `issueId` to `null` (`ON DELETE SET NULL`).
- **Resume Context View (`/projects/:projectId/resume`):**
  - Aggregates the project's active scope version, up to 3 pinned decisions, up to 5 recent decisions recorded under the current scope version, and up to 5 `Open` or `In Progress` issues with a non-empty `nextAction` (ordered by priority `High` $\rightarrow$ `Medium` $\rightarrow$ `Low`, then most recently updated).
- **Scope Timeline View (`/projects/:projectId/timeline`):**
  - Displays all scope versions chronologically alongside the decision records recorded while each scope version was active.
- **GitHub Repository Explorer (`/github`):**
  - Authenticated proxy search against the GitHub REST API (`/search/repositories`) with query, language, minimum stars, and pagination parameters, plus explicit handling for upstream rate limits (`429 GITHUB_RATE_LIMIT`) and upstream errors (`502 GITHUB_UPSTREAM_ERROR`).
- **User Profile Settings (`/settings`):**
  - Allows the authenticated user to update their `displayName`.
- **Timezone Formatting:**
  - Timestamps are stored in UTC (`ISO-8601`) and formatted in the web UI under the `Asia/Bangkok` (`UTC+7`) timezone.

### Planned Roadmap (Not Implemented in Current MVP)

- Separate multi-item Next Actions resource per project or issue
- Side-by-side diff view between arbitrary scope versions
- Direct foreign-key link from a new Scope Version to the Decision Record that triggered it
- Saving GitHub repositories from the Explorer into a project as references
- Project JSON export and import
- Password reset via email, password change, and account deletion

---

## 2. Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Frontend (`apps/web`)** | React 18, TypeScript 5.7, Vite 6, Material UI (MUI v6, Emotion), React Router v6, TanStack Query v5, React Hook Form v7 + Zod, Axios |
| **Backend (`apps/api-go`)** | Go `1.24`, Gin (`github.com/gin-gonic/gin`), `pgx/v5` (`pgxpool`), Goose v3 (`github.com/pressly/goose/v3`), `golang.org/x/crypto` (Argon2id + bcrypt), `github.com/joho/godotenv` |
| **Database** | PostgreSQL (external **Neon PostgreSQL** in production; local PostgreSQL or embedded **PGlite** socket server in local development and tests) |
| **Testing** | Go `testing` + `net/http/httptest` ([`apps/api-go/tests/api_test.go`](./apps/api-go/tests/api_test.go)), Vitest 3 + React Testing Library + jsdom ([`apps/web/src/test/app.test.tsx`](./apps/web/src/test/app.test.tsx)) |
| **Deployment** | Multi-stage [`Dockerfile`](./Dockerfile) (`node:22-alpine` $\rightarrow$ `golang:1.24-alpine` $\rightarrow$ `alpine:3.21`), Render Web Service ([`render.yaml`](./render.yaml)), Neon PostgreSQL |

> **Note on `apps/api`:** The repository also retains an earlier Node.js/Express/Prisma reference implementation in [`apps/api`](./apps/api) from an earlier course milestone. The active backend used by local development (`npm run dev`), tests (`npm test`), builds (`npm run build`), and production deployment ([`Dockerfile`](./Dockerfile) / [`render.yaml`](./render.yaml)) is the Go service in [`apps/api-go`](./apps/api-go).

---

## 3. Architecture

### Local Development vs. Production Deployment

- **In Local Development (`npm run dev`):**
  - Vite serves the React application on `http://localhost:5173` and proxies `/api` requests to `http://localhost:4000` ([`apps/web/vite.config.ts`](./apps/web/vite.config.ts)).
  - The Go API server runs on `http://localhost:4000`. If no external PostgreSQL server is listening on `localhost:5432`, the Go server automatically spawns [`scripts/pglite-server.mjs`](./scripts/pglite-server.mjs) backed by `.pglite/unpause-dev-db`.
- **In Production (Single Render Docker Web Service + Neon PostgreSQL):**
  - A single Render Web Service builds and runs the multi-stage [`Dockerfile`](./Dockerfile).
  - Stage 1 builds the React frontend (`apps/web/dist`) with `VITE_API_BASE_URL=/api/v1`.
  - Stage 2 compiles the Go server (`./apps/api-go/bin/server`) and migration binary (`./apps/api-go/bin/migrate`).
  - Stage 3 runs `./apps/api-go/bin/server` on `0.0.0.0:$PORT` without Node.js or Go build tools in the runtime container.
  - The Go router ([`apps/api-go/internal/http/router/router.go`](./apps/api-go/internal/http/router/router.go)) handles `/api/v1/*` requests, serves static assets from `STATIC_FILES_DIR=apps/web/dist`, falls back to `apps/web/dist/index.html` for client-side React routes on `GET`/`HEAD`, and returns JSON `404 NOT_FOUND` responses for unknown `/api/*` paths.
  - Because the React UI and `/api/v1` share the exact same origin, session cookies operate over first-party HTTPS with `HttpOnly`, `Secure=true`, and `SameSite=Lax`.

```mermaid
flowchart LR
    Browser["Browser (React 18 SPA)"]

    subgraph Render["Render Web Service (Docker Runtime)"]
        GoServer["Go 1.24 / Gin Server (0.0.0.0:$PORT)"]
        StaticDist["Built Frontend (apps/web/dist)"]
        Migrations["Goose SQL Migrations (apps/api-go/migrations)"]
        GoServer -->|"GET /* (non-API)"| StaticDist
        GoServer -->|"AUTO_MIGRATE=true"| Migrations
    end

    Neon[("Neon PostgreSQL (TLS)")]
    GitHub["GitHub REST API (api.github.com)"]

    Browser -->|"Same-Origin HTTPS (/ & /api/v1/*)"| GoServer
    GoServer -->|"DATABASE_URL (pgxpool)"| Neon
    GoServer -->|"GET /search/repositories"| GitHub
```

---

## 4. Project Structure

```text
.
├── apps/
│   ├── api-go/                         # Active Go 1.24 + Gin backend
│   │   ├── cmd/
│   │   │   ├── server/main.go          # Production HTTP server entrypoint (0.0.0.0:$PORT, graceful shutdown)
│   │   │   ├── migrate/main.go         # Standalone Goose SQL migration CLI
│   │   │   └── seed/main.go            # Development-only database seed CLI (blocked in production)
│   │   ├── internal/
│   │   │   ├── config/                 # Environment variable parsing and validation
│   │   │   ├── database/               # pgxpool connection setup, Goose migration runner, dev PGlite helper
│   │   │   ├── http/
│   │   │   │   ├── middleware/         # Auth, CORS/Origin/Fetch-Metadata CSRF, security headers, rate limit
│   │   │   │   └── router/             # /api/v1 route registration and static SPA fallback handler
│   │   │   ├── auth/                   # Registration, login, logout, session validation, profile update
│   │   │   ├── projects/               # Projects CRUD, archive/restore, Resume Context, Scope Timeline
│   │   │   ├── scopes/                 # Immutable Scope Versions & 405 immutability handler
│   │   │   ├── issues/                 # Issues CRUD, status/priority filters, search, pagination
│   │   │   ├── decisions/              # Decision Records CRUD, active scopeVersionId binding, pin/unpin
│   │   │   ├── github/                 # GitHub repository search proxy & error mapping
│   │   │   └── shared/                 # AppError, Argon2id/bcrypt password hashing, input validation
│   │   ├── migrations/
│   │   │   └── 00001_init_schema.sql   # Idempotent Goose SQL schema, constraints, indexes, and triggers
│   │   ├── tests/
│   │   │   └── api_test.go             # End-to-end Go HTTP + PostgreSQL integration test suite
│   │   ├── .env.example                # Backend environment variable template
│   │   └── go.mod                      # Go module definition (go 1.24.0)
│   ├── web/                            # React 18 + Vite + TypeScript frontend
│   │   ├── src/
│   │   │   ├── api/                    # Axios client (/api/v1) and typed endpoint wrappers
│   │   │   ├── components/             # AppLayout, dialogs, status/impact badges, error state
│   │   │   ├── context/                # AuthContext session state and 401 redirect listener
│   │   │   ├── pages/                  # Login, Register, Projects, Resume, Timeline, Issues, Decisions, GitHub, Settings
│   │   │   ├── test/                   # Vitest + React Testing Library tests
│   │   │   ├── types/                  # TypeScript API interfaces
│   │   │   └── utils/                  # UTC to Asia/Bangkok date formatting
│   │   ├── .env.example                # Frontend environment variable template
│   │   ├── package.json                # Frontend dependencies and scripts
│   │   └── vite.config.ts              # Vite dev server (/api proxy) and Vitest configuration
│   └── api/                            # Legacy Node.js/Express/Prisma reference implementation
├── scripts/
│   ├── dev.mjs                         # Runs Go API and Vite dev server concurrently
│   ├── pglite-server.mjs               # Embedded PGlite PostgreSQL socket server for local dev and tests
│   └── run-go.mjs                      # Portable Go command wrapper (uses GO_BIN or system PATH)
├── Dockerfile                          # Multi-stage production container build (Node 22 + Go 1.24 + Alpine 3.21)
├── .dockerignore                       # Docker build context exclusions
├── render.yaml                         # Render Blueprint for single Docker Web Service
├── .env.example                        # Root environment variable reference
└── package.json                        # Root workspace scripts and engines configuration
```

---

## 5. Prerequisites

### Local Development Requirements

- **Node.js:** `>= 20.0.0` (configured in root [`package.json`](./package.json) `engines.node`; tested with Node 22 LTS) and **npm** `>= 10.0.0`.
- **Go:** `>= 1.24.0` (configured in [`apps/api-go/go.mod`](./apps/api-go/go.mod)).
  - Must be available on your system `PATH` as `go`, **or** specified via the `GO_BIN` environment variable (`GO_BIN=/path/to/go`).
- **PostgreSQL (Optional for Local Dev):**
  - You can use a local PostgreSQL `>= 15` instance on `localhost:5432`, **or** rely on the repository's built-in PGlite fallback ([`scripts/pglite-server.mjs`](./scripts/pglite-server.mjs)), which starts automatically in non-production environments when nothing is listening on `127.0.0.1:5432`.

### Production Runtime Requirements

- In production ([`Dockerfile`](./Dockerfile)), the container build runs on Render using `node:22-alpine` and `golang:1.24-alpine`, and the final `alpine:3.21` runtime image executes only the compiled Go binary (`./apps/api-go/bin/server`) connected to an external PostgreSQL database (`DATABASE_URL`). Node.js and Go are not required inside the final runtime container.

---

## 6. Getting Started

All commands below are run from the **repository root**.

### 1. Clone the Repository

```bash
git clone <your-repo-url>
cd Unpause
```

### 2. Install Workspace and Go Dependencies

Install Node.js dependencies using the committed [`package-lock.json`](./package-lock.json) and download Go modules:

```bash
npm ci
node scripts/run-go.mjs mod download
```

*(If `go` is installed in a non-standard location not on your `PATH`, prefix Go commands with `GO_BIN=/path/to/go`.)*

### 3. Configure Local Environment Variables

Copy the example environment files for the Go backend and React frontend:

```bash
cp apps/api-go/.env.example apps/api-go/.env
cp apps/web/.env.example apps/web/.env
```

The default values in `apps/api-go/.env` and `apps/web/.env` work out of the box for local development (`PORT=4000`, `CORS_ORIGINS="http://localhost:5173"`, `VITE_API_BASE_URL="/api/v1"`, and `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/unpause?sslmode=disable"`).

### 4. Database Setup and Migrations

- **Automatic in Development:** When `NODE_ENV=development` (the default), starting the Go server via `npm run dev` or `npm run dev:api` automatically starts the local PGlite PostgreSQL server (persisted under `.pglite/unpause-dev-db` if no external PostgreSQL server is running on port `5432`) and applies all pending Goose migrations in [`apps/api-go/migrations/`](./apps/api-go/migrations/).
- **Manual Migration Commands:** If you are running an external local PostgreSQL server or want to run migrations explicitly:

```bash
# Apply pending Goose SQL migrations
npm run db:migrate:deploy

# Check current migration version status
npm run db:migrate:status
```

### 5. (Optional) Seed Demo Data

To populate a sample account (`demo@unpause.local` / `Password123!`) with a sample project (`InvoiceFlow CLI`), two scope versions, two issues, and two linked decision records:

```bash
npm run db:seed
```

> The seed command refuses to run when `NODE_ENV=production`. Newly registered accounts always start with zero projects.

### 6. Start the Local Development Servers

Run both the Go API (`http://localhost:4000`) and Vite frontend (`http://localhost:5173`) concurrently:

```bash
npm run dev
```

Or run them in two separate terminals:

```bash
# Terminal 1: Go API on http://localhost:4000
npm run dev:api

# Terminal 2: Vite React dev server on http://localhost:5173
npm run dev:web
```

Open `http://localhost:5173` in your browser.

---

## 7. Environment Variables

### Backend Environment Variables ([`apps/api-go/internal/config/config.go`](./apps/api-go/internal/config/config.go))

All backend variables are read at **runtime** when `./apps/api-go/bin/server` or `./apps/api-go/bin/migrate` starts.

| Variable | Required? | Default | Local Value | Production Value (Render + Neon) | Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `DATABASE_URL` | **Required** | — | `postgresql://postgres:postgres@localhost:5432/unpause?sslmode=disable` | `postgresql://<user>:<pass>@<host>.neon.tech/<db>?sslmode=require` | PostgreSQL connection string (`postgres://` or `postgresql://`). |
| `SESSION_SECRET` | **Required** | — | Any string `>= 16` chars (32+ recommended) | Cryptographic random string `>= 32` chars (`generateValue: true` in `render.yaml`) | Secret validated at startup (minimum 16 characters enforced by `config.ParseEnv`). |
| `CORS_ORIGINS` | **Required** (unless `RENDER_EXTERNAL_URL` is set) | — | `http://localhost:5173` | `https://<your-service>.onrender.com` | Comma-separated list of allowed browser origins for CORS and state-changing `Origin` validation. Trailing slashes are normalized automatically, and `RENDER_EXTERNAL_URL` is automatically added when present. |
| `NODE_ENV` | Optional | `development` | `development` | `production` | Application mode (`development`, `test`, or `production`; falls back to `APP_ENV` if `NODE_ENV` is unset). Enables Gin release mode, `Strict-Transport-Security` header, and `Secure` cookies by default in `production`. |
| `PORT` | Optional | `4000` | `4000` | `10000` (or injected by Render) | TCP port bound by the Go server on `0.0.0.0:$PORT` (`1`–`65535`). |
| `STATIC_FILES_DIR` | Optional | `""` | `""` (served by Vite in dev) | `apps/web/dist` | Directory containing the built React SPA (`index.html` and `assets/`). When set, the Go server serves static files and SPA fallback on non-API `GET`/`HEAD` routes. |
| `AUTO_MIGRATE` | Optional | Unset (`false`) | `false` (dev mode auto-migrates automatically) | `true` | When `"true"`, runs Goose SQL migrations automatically on server startup before listening for HTTP requests. |
| `SESSION_COOKIE_NAME` | Optional | `unpause_sid` | `unpause_sid` | `unpause_sid` | Name of the `HttpOnly` session cookie. |
| `SESSION_COOKIE_SAMESITE` | Optional | `lax` | `lax` | `lax` | Cookie `SameSite` policy (`lax`, `strict`, or `none`). |
| `SESSION_COOKIE_SECURE` | Optional | `false` in dev, `true` in prod | `false` | `true` | Whether the session cookie includes the `Secure` attribute (`true`/`1` or `false`/`0`). Must be `true` if `SESSION_COOKIE_SAMESITE=none`. |
| `SESSION_TTL_HOURS` | Optional | `168` | `168` | `168` | Session expiration lifetime in hours (`168` = 7 days). |
| `AUTH_RATE_LIMIT_MAX` | Optional | `25` | `25` | `25` | Maximum requests per IP address per minute allowed on `POST /api/v1/auth/register` and `POST /api/v1/auth/login` before returning `429 RATE_LIMIT_EXCEEDED`. |
| `GITHUB_API_BASE_URL` | Optional | `https://api.github.com` | `https://api.github.com` | `https://api.github.com` | Base URL for upstream GitHub repository search requests. |
| `GITHUB_TOKEN` | Optional | `""` | `""` | Optional GitHub PAT | Optional `Bearer` token sent to GitHub REST API to increase upstream rate limits. |

### Frontend Environment Variables ([`apps/web/.env.example`](./apps/web/.env.example))

Frontend `VITE_*` variables are embedded into static JavaScript files at **Vite build time** (`npm run build:web`), not read dynamically at browser runtime.

| Variable | Required? | Default in Code | Local & Production Value | Build vs. Runtime | Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `VITE_API_BASE_URL` | Optional | `/api/v1` | `/api/v1` | **Build time** ([`apps/web/src/api/client.ts`](./apps/web/src/api/client.ts)) | Base URL used by Axios for API requests. Using `/api/v1` works in both local development (via Vite's `/api` proxy) and single-service production deployment (same origin). |
| `VITE_API_PROXY_TARGET` | Optional | `http://localhost:4000` | `http://localhost:4000` | **Dev server only** ([`apps/web/vite.config.ts`](./apps/web/vite.config.ts)) | Target URL for Vite's local `/api` development proxy. Not used in production builds. |

### Build / Helper Script Environment Variables

| Variable | Required? | Default | Purpose |
| :--- | :--- | :--- | :--- |
| `GO_BIN` | Optional | Resolved from `PATH` | Used by [`scripts/run-go.mjs`](./scripts/run-go.mjs) to specify an explicit path to the `go` binary during local builds or tests. If set to an invalid path, the script exits with code `1` rather than falling back silently. |

---

## 8. Development Commands

All commands below are defined in the root [`package.json`](./package.json) and should be executed from the repository root:

| Command | Description |
| :--- | :--- |
| `npm run dev` | Starts both the Go backend (`dev:api`) and Vite frontend (`dev:web`) concurrently via [`scripts/dev.mjs`](./scripts/dev.mjs). |
| `npm run dev:api` | Runs the Go backend server (`go run ./cmd/server` in `apps/api-go`). |
| `npm run dev:web` | Starts the Vite React development server on `http://localhost:5173`. |
| `npm run build` | Runs `npm run build:api` followed by `npm run build:web`. |
| `npm run build:api` | Compiles `apps/api-go/bin/server`, `apps/api-go/bin/migrate`, and `apps/api-go/bin/seed`. |
| `npm run build:web` | Runs `tsc -b && vite build` in `apps/web`, outputting the production bundle to `apps/web/dist`. |
| `npm test` | Runs `npm run test:api` followed by `npm run test:web`. |
| `npm run test:api` | Runs the Go integration test suite (`go test -v ./tests/...` in `apps/api-go`). |
| `npm run test:web` | Runs the frontend Vitest suite (`vitest run` in `apps/web`). |
| `npm run db:migrate:deploy` | Applies pending Goose SQL migrations (`go run ./cmd/migrate up`). |
| `npm run db:migrate:dev` | Alias for `go run ./cmd/migrate up`. |
| `npm run db:migrate:status` | Prints Goose migration status (`go run ./cmd/migrate status`). |
| `npm run db:seed` | Seeds development demo data (`go run ./cmd/seed`; blocked when `NODE_ENV=production`). |

---

## 9. Testing

### Running the Test Suites

```bash
# Run both backend and frontend test suites
npm test

# Run only Go backend integration tests
npm run test:api

# Run only React frontend unit/component tests
npm run test:web
```

### What Is Tested

1. **Backend Integration Tests ([`apps/api-go/tests/api_test.go`](./apps/api-go/tests/api_test.go)):**
   - Automatically boots an isolated in-memory PGlite PostgreSQL instance ([`scripts/pglite-server.mjs`](./scripts/pglite-server.mjs)) on a dedicated local port—no external database is required to run `npm run test:api`, and existing local data is never touched.
   - Covers 6 top-level test suites (29 subtests):
     - **`Test1_EnvironmentAndErrorFormatValidation`:** Startup environment variable validation, UUID error ID formatting (`error.id`), CORS/Origin validation (`403 INVALID_ORIGIN`), and `GET /api/v1/health`.
     - **`Test2_AuthenticationPasswordCompatibilityAndSessions`:** Unauthenticated `401` enforcement, registration, `HttpOnly` + `SameSite=Lax` cookies, duplicate email rejection (`409`), Argon2id and legacy `bcrypt` verification, display name updates, logout session invalidation, and connection pool recovery.
     - **`Test3_CoreDomainDatabaseIntegrityAndOwnershipIsolation`:** Atomic creation of Project + Scope Version 1, automatic binding and preservation of `scopeVersionId` on Decision Records across scope changes, pin/unpin timestamp preservation, API-level (`405`) and DB-trigger Scope Version immutability, Scope Timeline and Resume Context aggregation, issue filtering/pagination, `ON DELETE SET NULL` when deleting an issue linked to a decision, archived project read-only enforcement (`403 PROJECT_ARCHIVED`), and cross-user ownership isolation.
     - **`Test4_GitHubExplorerIntegrationAndErrorHandling`:** Query/language/minStars search formatting, upstream `429 GITHUB_RATE_LIMIT`, and upstream `502 GITHUB_UPSTREAM_ERROR` handling.
     - **`Test5_GooseMigrationFreshAndPrismaCompatibility`:** Fresh Goose migration verification and idempotent migration of pre-existing Prisma-initialized schemas without data loss.
     - **`Test6_SecurityHardeningIDORValidationAndRateLimiting`:** Security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS in production), `Sec-Fetch-Site` / `Referer` CSRF protection, static SPA file serving and path-traversal protection (`STATIC_FILES_DIR`), session replacement on re-login/re-registration, cross-project IDOR and issue-linking prevention, `ILIKE` wildcard escaping, and `429 RATE_LIMIT_EXCEEDED` authentication throttling.
2. **Frontend Tests ([`apps/web/src/test/app.test.tsx`](./apps/web/src/test/app.test.tsx)):**
   - Runs in Vitest with `jsdom` and React Testing Library.
   - Verifies UTC-to-`Asia/Bangkok` timestamp formatting, `ErrorState` rendering (message, Error ID, and Retry callback), `ScopeImpactChip` label rendering, and clean `/login` redirection on `401 UNAUTHORIZED` responses without redirect loops.

---

## 10. API Overview

All API routes are mounted under **`/api/v1`** in [`apps/api-go/internal/http/router/router.go`](./apps/api-go/internal/http/router/router.go).

- State-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`) require an allowed `Origin` header (when sent by a browser) and reject cross-site `Sec-Fetch-Site: cross-site` requests with `403 INVALID_ORIGIN`.
- Error responses use a consistent JSON envelope:
  ```json
  {
    "error": {
      "id": "d6e1f334-f5db-4391-9b42-e511a1b07eff",
      "code": "NOT_FOUND",
      "message": "Resource not found"
    }
  }
  ```

### Summary of `/api/v1` Endpoints

| Method | Path | Auth | Description |
| :--- | :--- | :---: | :--- |
| `GET` | `/api/v1/health` | Public | Checks server liveness and pings PostgreSQL (`200 OK` with `"database": "ok"`, or `503` if unreachable). |
| `POST` | `/api/v1/auth/register` | Public (Rate-limited) | Registers a user (`email`, `password`, optional `displayName`), creates a session, and sets the session cookie. |
| `POST` | `/api/v1/auth/login` | Public (Rate-limited) | Authenticates a user (`email`, `password`), replaces any prior session cookie, and sets a new session cookie. |
| `POST` | `/api/v1/auth/logout` | Public | Deletes the current server-side session (if present) and clears the session cookie. |
| `GET` | `/api/v1/auth/me` | Required | Returns the currently authenticated user (`{ "user": { ... } }`). |
| `PATCH` / `PUT` | `/api/v1/users/me` | Required | Updates the authenticated user's `displayName`. |
| `GET` | `/api/v1/projects` | Required | Lists the user's projects (supports `search` and `status=Active\|Archived\|All`). |
| `POST` | `/api/v1/projects` | Required | Creates a project and its initial `ScopeVersion` (`versionNumber: 1`) atomically. |
| `GET` | `/api/v1/projects/:projectId` | Required | Returns a single project owned by the user (`404` if not found or owned by another user). |
| `PATCH` / `PUT` | `/api/v1/projects/:projectId` | Required | Updates project `name` and/or `description` (requires project to be `Active`). |
| `POST` | `/api/v1/projects/:projectId/archive` | Required | Sets project status to `Archived` (read-only). |
| `POST` | `/api/v1/projects/:projectId/restore` | Required | Restores an `Archived` project back to `Active`. |
| `GET` | `/api/v1/projects/:projectId/resume-context` | Required | Returns active scope, up to 3 pinned decisions, up to 5 recent current-scope decisions, and up to 5 actionable issues. |
| `GET` | `/api/v1/projects/:projectId/timeline` | Required | Returns chronological scope versions with decisions grouped under the version active when created. |
| `GET` | `/api/v1/projects/:projectId/scope-versions` | Required | Lists all scope versions and `currentScope` for a project. |
| `POST` | `/api/v1/projects/:projectId/scope-versions` | Required | Appends a new immutable scope version (`problem`, `targetUsers`, `goal`, `inScope`, `outOfScope`, `reasonForChange`). |
| `GET` | `/api/v1/projects/:projectId/scope-versions/:versionId` | Required | Returns a specific scope version by ID. |
| `PUT` / `PATCH` / `DELETE` | `/api/v1/projects/:projectId/scope-versions/*` | Required | Always rejected with `405 SCOPE_VERSION_IMMUTABLE`. |
| `GET` | `/api/v1/projects/:projectId/issues` | Required | Lists paginated project issues (supports `status`, `priority`, `search`, `page`, `pageSize`). |
| `POST` | `/api/v1/projects/:projectId/issues` | Required | Creates an issue with required `title` and `nextAction`. |
| `GET` | `/api/v1/projects/:projectId/issues/:issueId` | Required | Returns an issue and its linked decision records. |
| `PATCH` / `PUT` | `/api/v1/projects/:projectId/issues/:issueId` | Required | Updates an issue's fields or reversible status (`Open`, `In Progress`, `Closed`). |
| `DELETE` | `/api/v1/projects/:projectId/issues/:issueId` | Required | Deletes an issue (`linked DecisionRecord.issueId` is set to `null`). |
| `GET` | `/api/v1/projects/:projectId/decisions` | Required | Lists project decision records (supports `search`, `scopeImpact`, `scopeVersionId`, `pinnedOnly`). |
| `POST` | `/api/v1/projects/:projectId/decisions` | Required | Creates a decision record automatically bound to the latest `ScopeVersion`. |
| `GET` | `/api/v1/projects/:projectId/decisions/:decisionId` | Required | Returns a single decision record. |
| `PATCH` / `PUT` | `/api/v1/projects/:projectId/decisions/:decisionId` | Required | Updates a decision record while preserving its original `scopeVersionId`. |
| `PATCH` | `/api/v1/projects/:projectId/decisions/:decisionId/pin` | Required | Pins or unpins a decision (`{ "isPinned": true\|false }`) without changing `updatedAt`. |
| `DELETE` | `/api/v1/projects/:projectId/decisions/:decisionId` | Required | Deletes a decision record. |
| `GET` | `/api/v1/github/repositories` | Required | Searches public GitHub repositories (`q`, `language`, `minStars`, `page`, `perPage`). |

---

## 11. Deployment: Render + Neon

Unpause is configured for deployment as **one Render Web Service** using the repository's multi-stage [`Dockerfile`](./Dockerfile) and [`render.yaml`](./render.yaml), backed by an external **Neon PostgreSQL** database.

> **Important Note on Verification State:** The backend/frontend test suites, production asset build (`apps/web/dist`), Go binary compilation (`apps/api-go/bin/{server,migrate}`), and local single-origin production runtime have been verified. However, a live cloud deployment to Render and Neon has **not** been executed automatically from this repository; follow the steps below to deploy in your own accounts.

### Step 1: Create a Neon PostgreSQL Database (Manual)

1. Sign in to [Neon](https://neon.tech) and create a new PostgreSQL project (for example, `unpause`).
2. Copy the PostgreSQL connection string from the Neon dashboard.
3. Confirm that TLS is enabled at the end of the URL (`?sslmode=require`), for example:
   ```text
   postgresql://<user>:<password>@<endpoint>.neon.tech/<dbname>?sslmode=require
   ```

### Step 2: Connect the Repository to Render (Manual)

Push your branch to GitHub, then sign in to the [Render Dashboard](https://dashboard.render.com) and choose one of the two setup methods:

- **Option A — Render Blueprint (Recommended):**
  1. Click **New +** $\rightarrow$ **Blueprint**.
  2. Select your GitHub repository and branch.
  3. Render reads [`render.yaml`](./render.yaml) automatically and configures a single Docker web service (`name: unpause`, `runtime: docker`, `plan: free`, `dockerfilePath: ./Dockerfile`, `dockerContext: .`, `healthCheckPath: /api/v1/health`).
- **Option B — Manual Web Service Setup:**
  1. Click **New +** $\rightarrow$ **Web Service** and connect your GitHub repository.
  2. Set **Language / Runtime** to **Docker**.
  3. Leave **Root Directory** blank (repository root).
  4. Set **Dockerfile Path** to `./Dockerfile` and **Docker Build Context Directory** to `.`.
  5. Set **Health Check Path** to `/api/v1/health`.
  6. Select the **Free** instance plan.

### Step 3: Configure Render Environment Variables (Manual + Automatic)

When using [`render.yaml`](./render.yaml), non-secret defaults are pre-populated and `SESSION_SECRET` is generated automatically (`generateValue: true`), while variables marked `sync: false` must be entered manually:

| Variable | Action Required in Render | Value |
| :--- | :--- | :--- |
| `DATABASE_URL` | **Set Manually (Secret)** | Your Neon connection string ending in `?sslmode=require` |
| `CORS_ORIGINS` | **Set Manually** | Your Render service URL without a trailing slash (e.g., `https://unpause.onrender.com`). Note: Render also injects `RENDER_EXTERNAL_URL`, which [`config.ParseEnv`](./apps/api-go/internal/config/config.go) automatically adds to allowed origins. |
| `SESSION_SECRET` | **Auto-generated by Blueprint** (or set manually if not using Blueprint) | Random secret string (`>= 32` characters recommended; `>= 16` required). |
| `NODE_ENV` | Pre-set by `render.yaml` / `Dockerfile` | `production` |
| `PORT` | Pre-set by `render.yaml` / `Dockerfile` | `10000` (Render routes traffic to `$PORT` bound on `0.0.0.0`) |
| `AUTO_MIGRATE` | Pre-set by `render.yaml` / `Dockerfile` | `true` |
| `STATIC_FILES_DIR` | Pre-set by `render.yaml` / `Dockerfile` | `apps/web/dist` |
| `VITE_API_BASE_URL` | Pre-set by `render.yaml` / `Dockerfile` | `/api/v1` |
| `SESSION_COOKIE_NAME` | Pre-set by `render.yaml` | `unpause_sid` |
| `SESSION_COOKIE_SAMESITE` | Pre-set by `render.yaml` / `Dockerfile` | `lax` |
| `SESSION_COOKIE_SECURE` | Pre-set by `render.yaml` / `Dockerfile` | `true` |
| `SESSION_TTL_HOURS` | Pre-set by `render.yaml` | `168` |
| `AUTH_RATE_LIMIT_MAX` | Pre-set by `render.yaml` | `25` |
| `GITHUB_API_BASE_URL` | Pre-set by `render.yaml` | `https://api.github.com` |

### Step 4: How Build, Startup, and Migrations Work Automatically

1. **Container Build:** Render builds [`Dockerfile`](./Dockerfile) from the repository root context:
   - Stage 1 (`node:22-alpine`) runs `npm ci --include=dev --workspace=@unpause/web` and `npm --workspace=@unpause/web run build` with `VITE_API_BASE_URL=/api/v1`.
   - Stage 2 (`golang:1.24-alpine`) compiles `./cmd/server` and `./cmd/migrate`.
   - Stage 3 (`alpine:3.21`) copies `./apps/api-go/bin/server`, `./apps/api-go/bin/migrate`, `./apps/api-go/migrations`, and `./apps/web/dist` into `/app`.
2. **Startup Migrations (`AUTO_MIGRATE=true`):** Render's Free plan does not support `preDeployCommand`. Instead, when `./apps/api-go/bin/server` starts with `AUTO_MIGRATE=true`, [`cmd/server/main.go`](./apps/api-go/cmd/server/main.go) resolves `apps/api-go/migrations` and executes `database.RunMigrations` (Goose `up`) before opening the HTTP listener. Because [`00001_init_schema.sql`](./apps/api-go/migrations/00001_init_schema.sql) uses idempotent DDL (`CREATE TABLE IF NOT EXISTS`, `DO $$ ... EXCEPTION WHEN duplicate_object`), restarts and redeployments are safe.

### Step 5: Inspect Logs, Health Check, and Run Smoke Tests

1. **Service Logs:** In the Render Dashboard **Logs** tab, verify that Goose migration `00001_init_schema.sql` completes and the log line `Unpause Go/Gin API listening on 0.0.0.0:10000 (production)` appears.
2. **Health Endpoint:** Open `https://<your-service>.onrender.com/api/v1/health` and verify a `200 OK` JSON response:
   ```json
   {
     "database": "ok",
     "status": "ok",
     "timestamp": "2026-10-29T12:00:00.000Z"
   }
   ```
3. **Post-Deployment Smoke Tests:**
   - **Frontend & SPA Routing:** Visit `https://<your-service>.onrender.com/` and refresh directly on `/login` or `/register` to confirm `index.html` loads (`200 OK`).
   - **API 404 Protection:** Visit `https://<your-service>.onrender.com/api/v1/unknown` and confirm it returns a JSON `404` (`NOT_FOUND`), not `index.html`.
   - **Registration & Session Cookie:** Register **User A**. In browser DevTools $\rightarrow$ Application $\rightarrow$ Cookies, confirm `unpause_sid` is set with `HttpOnly`, `Secure`, and `SameSite=Lax`.
   - **Project Workflow:** Create a project as **User A**, add an issue and a decision record, refresh `/projects/<id>/resume` and `/projects/<id>/timeline`, then log out and log back in to confirm data persistence.
   - **Cross-User Isolation:** In an incognito window, register **User B**, confirm **User B** starts with an empty project list, and verify that navigating to **User A**'s project URL returns `404 Not Found`.

### Free-Tier Considerations

- **Render Free Web Service Spin-Down:** Free web services spin down after 15 minutes of inactivity and take roughly 30–60 seconds to cold-start on the next incoming request.
- **Neon Free Tier Compute Suspend:** Neon free-tier compute endpoints also suspend after inactivity and wake on connection; if the first request after idle coincides with a cold start, allow a few seconds for the initial database ping.

---

## 12. Troubleshooting

| Symptom | Cause | Fix |
| :--- | :--- | :--- |
| `Invalid environment configuration: ...` on startup | A required variable (`DATABASE_URL`, `SESSION_SECRET >= 16 chars`, or `CORS_ORIGINS`) is missing or invalid. | Check the startup error message in logs and verify `apps/api-go/.env` (local) or Render Environment settings. |
| `Error: Go toolchain ("go") was not found in PATH` | `go` is not installed on your system `PATH` and `GO_BIN` is unset. | Install Go `>= 1.24` and add it to `PATH`, or set `GO_BIN=/full/path/to/go` when running npm scripts. |
| `Error: Configured GO_BIN "..." is not a valid Go executable` | `GO_BIN` is set to a nonexistent or non-executable file path. | Unset `GO_BIN` to use `PATH`, or update `GO_BIN` to point directly to the `go` binary. |
| `failed to ping PostgreSQL database` or `503` on `/api/v1/health` | `DATABASE_URL` host/credentials are wrong, or `?sslmode=require` is missing for Neon. | Verify `DATABASE_URL`. For Neon, ensure `?sslmode=require` is included; for local PGlite/Postgres without TLS, use `?sslmode=disable`. |
| `403 INVALID_ORIGIN` on registration, login, or mutations | The browser's `Origin` header does not match `CORS_ORIGINS` (or `RENDER_EXTERNAL_URL`). | Ensure `CORS_ORIGINS` includes the exact scheme, hostname, and port of the browser URL (e.g., `http://localhost:5173` in dev or `https://<your-service>.onrender.com` in prod). |
| Visiting `/` returns `404 API endpoint not found` in production mode | `STATIC_FILES_DIR` is unset or `apps/web/dist` has not been built. | Run `npm run build:web` and set `STATIC_FILES_DIR=apps/web/dist`. |
| Session cookie (`unpause_sid`) is not saved by browser | `SESSION_COOKIE_SECURE=true` is set while testing over plain `http://localhost`, or `VITE_API_BASE_URL` points to a different domain. | Set `SESSION_COOKIE_SECURE=false` for local `http://localhost` testing (`true` for HTTPS production) and keep `VITE_API_BASE_URL=/api/v1`. |

---

## 13. Project Status and License

- **Project Status:** Course final project MVP intended for portfolio demonstration and public workflow testing. Core authentication, scope versioning, scope-linked decision records, issue tracking, GitHub repository search, and automated integration tests are implemented; see [Section 1](#1-features) for items outside the MVP scope.
- **License:** No `LICENSE` file is currently present in this repository, and [`package.json`](./package.json) marks the workspace `"private": true`. All rights remain with the repository author unless a license is added.
