# Unpause — Course Final Project Scope (v2, trimmed)

> **Purpose:** A course-final MVP for WeStride, to be finished in **7–14 days**. Satisfy the rubric, demonstrate one clear idea, and leave everything else on the roadmap. This is not a production product.

## 1. Product Overview

**Unpause** helps a solo developer resume a project after being away. Its single differentiator: it **links each decision and its rationale to the version of the project scope that was active when the decision was made**, so the user can see how and why the scope changed over time.

The app shows what the user saved. It does not generate AI summaries, judge scope alignment, or create next actions automatically. It helps the user *see*, not *decide*.

### Core user journey

1. Register or log in.
2. Create a project with its initial scope (Scope v1).
3. Record issues (each with a next action) and decision records.
4. Change the scope by creating a new Scope Version with a reason.
5. Return later and open **Resume Context** or the **Scope Timeline** to understand where things stand and why.

## 2. Rubric Mapping

| Requirement | Unpause implementation |
|---|---|
| React.js | React + Vite + TypeScript |
| CSS framework | Material UI (MUI) |
| Axios | One shared Axios client + per-feature API functions |
| Fetch/display API data | GitHub public repository search via the backend |
| Filter/search fetched data | GitHub search query + language/stars filters; plus project, issue and decision filters |
| Login | Email/password with server-side sessions |
| Update/edit | Edit + explicit Save with validation on projects, issues, decisions |
| CRUD | Projects, Issues, Decision Records (full CRUD); Scope Versions (create/read, immutable) |
| Database | PostgreSQL via Prisma |

## 3. Technology Stack

**Frontend:** React, Vite, TypeScript, Material UI, React Router (or TanStack Router), TanStack Query, Axios, React Hook Form + Zod

**Backend:** Node.js, Express, REST under `/api/v1`, PostgreSQL + Prisma, Zod request validation

**Auth and security (essentials only):**
- Email/password register, login, logout
- Server-side sessions stored in PostgreSQL; HttpOnly cookie with `SameSite=Lax`
- Passwords hashed with Argon2id (bcrypt is acceptable if installation is a problem)
- Every query checks that the resource belongs to the logged-in user
- CORS allowlist and Origin check on state-changing requests
- Env validation with Zod at startup; `.env.example` with placeholders only
- Never log passwords, session IDs or secrets
- Consistent error format; never expose stack traces

**Testing and deployment:**
- Vitest + Supertest: a small set of tests for auth, ownership isolation, and scope-version immutability
- Manual walkthrough of the demo flow (no Playwright, no CI in v1)
- Deploy on Render: static frontend, Express service, PostgreSQL
- Prisma Migrate (`migrate dev` locally, `migrate deploy` in production)
- Seed script for development only, guarded against production

## 4. MVP Scope

### Required

- [ ] Registration, login, logout, per-user data isolation
- [ ] PostgreSQL schema + Prisma migrations
- [ ] Express REST API + centralized Axios client
- [ ] Projects: create, edit, archive, restore
- [ ] Scope Versions: initial scope, new immutable versions with a reason
- [ ] **Scope Timeline** page (decisions grouped by scope version)
- [ ] Issues: create, view, edit, change status, delete
- [ ] Decision Records: create, view, edit, pin/unpin, delete
- [ ] **Resume Context** page
- [ ] Search/filter: projects, issues, decision records
- [ ] GitHub Explorer: search + filters + pagination + error handling
- [ ] Form validation, loading/error states, save feedback
- [ ] Essential tests (see above)
- [ ] README (run instructions, implemented vs. roadmap) and a working deployment

### Roadmap (after the course submission)

- Separate Next Actions resource (multiple per project, complete/reopen)
- Compare any two scope versions side by side
- Link a Scope Version to the decision that triggered it
- Scope Alignment Review history
- Project References and "save GitHub repo to project"
- JSON export
- Password reset by email, password change, account deletion
- Rate limiting, CSRF tokens, idempotency
- OpenAPI/Swagger, structured logging (Pino), CI, Playwright E2E
- Timezone setting, dashboard counts, unsaved-changes warning

### Out of scope

AI summaries or judgments, collaboration, notifications, admin tools, email verification, GitHub OAuth, general notes, automatic next actions, global search.

## 5. Data Model and Behavior

### Projects
- Fields: name, optional description, status (`Active` or `Archived`), timestamps.
- Names need not be unique.
- Creating a project also creates **Scope Version 1** (in one transaction) and then opens Resume Context.
- Projects are archived, never deleted. Archived projects are read-only; restore returns them to `Active`.
- Project list shows name, status, last modified; search by name and an Archived filter.

### Scope Versions (the core)
- Fields: version number, problem, target users, goal, in-scope, out-of-scope, **reason for change**, created time.
- Immutable once created. A correction is a new version with a new reason.
- A new version is prefilled from the current one and edited before saving.
- Current scope = the latest version. Going back to an old direction = a new version copied from the old content.
- Version 1's reason is fixed text such as "Initial scope".
- Foreign key from Decision Records uses `Restrict`, so versions can never be deleted while referenced.

### Decision Records (the core)
- Required: problem, decision, rationale. Optional: alternatives considered, outcome (can be filled in later).
- Belongs to a project. **`scopeVersionId` is set automatically** to the current scope version when the record is created and does not change on edit.
- **`scopeImpact`** (chosen by the user): `None`, `Expands`, `Narrows`, `Changes direction`. A plain label, not an automated judgment.
- Optional link to an Issue. Deleting an Issue sets this link to null; the decision is kept.
- Pin/unpin does not change the content-modified timestamp.
- Full CRUD. Deleting a decision record simply removes it.
- Keyword search over problem and decision text.

### Issues
- Fields: title (required), description, status (`Open`, `In Progress`, `Closed`; reversible), priority (`High`, `Medium`, `Low`), **`nextAction`** (short text), timestamps.
- List sorted by last modified; filters for status and priority; pagination (20 per page).
- Detail is read-only until Edit; Save is explicit. If nothing changed, no request is sent.

### Scope Timeline
- One page per project: Scope v1 → decisions made under v1 → Scope v2 with its reason → decisions made under v2 → and so on.
- Each decision shows its `scopeImpact` label.
- Built by grouping existing data by `scopeVersionId`; no extra tables.

### Resume Context
Shows saved data only. Sections:
1. Current scope: version number, date and the reason it was created, with a link to the Timeline
2. Pinned decisions (up to 3)
3. Latest decisions made under the current scope (up to 5)
4. Open / in-progress issues with their `nextAction` (up to 5, ordered by priority then last modified), with a link to all issues

## 6. Search and GitHub API

- Search/filter for Projects, Issues and Decision Records as described above; no global search.
- **GitHub Explorer** is a separate page; the backend calls the public GitHub search API (no OAuth).
- Query plus language and minimum-stars filters; previous/next pagination within GitHub's result limits.
- Debounced requests; rate-limit errors are shown clearly.
- Each result shows name, description, language, stars, forks, and a link opening GitHub in a new tab.
- Failures show an error with Retry; an API failure is not shown as an empty result.

## 7. Shared UX Rules

- Responsive, light mode only.
- Settings page: edit display name only.
- Explicit Save (no autosave); Save disabled while a request is in flight; success/error feedback.
- Loading failures show an error and Retry; never present unloaded data as real.
- Timestamps stored in UTC and displayed in `Asia/Bangkok`.
- New accounts see empty states; no demo data in normal accounts.

## 8. API and Integrity Rules

- All routes under `/api/v1`; Zod validation; common error format with an error ID.
- Auth middleware on every protected route; the service layer checks ownership.
- Scope Versions are immutable (no update/delete endpoints).
- Transactions only where needed (project + initial scope creation).
- Foreign keys: Decision → ScopeVersion `Restrict`; Decision → Issue `SetNull`; Issue/Decision/ScopeVersion → Project `Restrict` (projects are archived, not deleted).

## 9. Suggested Timeline (7–14 days)

| Days | Work |
|---|---|
| 1–2 | Foundation: repo, Prisma schema, migrations, env validation, error format; auth with sessions |
| 3–4 | Projects + Scope Versions (create, history, archive/restore) |
| 5–7 | Issues and Decision Records (CRUD, pin, auto scope link, `scopeImpact`) |
| 8–9 | Scope Timeline, Resume Context, search/filter |
| 10–11 | GitHub Explorer |
| 12–14 | Tests, README, deployment, demo rehearsal, buffer |

If time is short (7 days): skip pagination outside Issues/GitHub, keep tests to auth + ownership only, and deploy with the simplest Render setup.

## 10. Suggested Demo

1. Log in.
2. Create a project with its initial scope (v1).
3. Add an issue with a next action.
4. Record a decision with rationale and a scope impact.
5. Create Scope v2 with a reason, then record another decision.
6. Open the **Scope Timeline** to show how decisions and scope changes line up.
7. Open **Resume Context** to show where to restart.
8. Demonstrate search/filter and GitHub Explorer.
9. Log out and back in to show persistence and user isolation.

## 11. Delivery Guardrails

- This is a course MVP; do not add features because they might be useful later.
- Finish the rubric flows before anything else.
- Prefer a few complete vertical slices over many half-built modules.
- If time is tight, cut from the roadmap and polish first, never login, isolation, CRUD, search/filter, the GitHub API or persistence.
- Keep the README honest about what is implemented and what is on the roadmap.
- The app helps users *see* how scope changed; it never judges whether they drifted.

## 12. Rubric Checklist

- [ ] React.js frontend
- [ ] Material UI
- [ ] Axios for API requests
- [ ] API data fetched and displayed (GitHub)
- [ ] Search/filter on fetched data
- [ ] Login flow
- [ ] Update/edit flow
- [ ] CRUD demonstrated
- [ ] PostgreSQL database
- [ ] README and run instructions
- [ ] Demo flow rehearsed
