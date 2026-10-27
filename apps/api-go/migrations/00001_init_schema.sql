-- +goose Up
-- +goose StatementBegin
DO $$ BEGIN
    CREATE TYPE "ProjectStatus" AS ENUM ('Active', 'Archived');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "IssueStatus" AS ENUM ('Open', 'In Progress', 'Closed');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "IssuePriority" AS ENUM ('High', 'Medium', 'Low');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "ScopeImpact" AS ENUM ('None', 'Expands', 'Narrows', 'Changes direction');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Project" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'Active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ScopeVersion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "problem" TEXT NOT NULL,
    "targetUsers" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "inScope" TEXT NOT NULL,
    "outOfScope" TEXT NOT NULL,
    "reasonForChange" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScopeVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Issue" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "IssueStatus" NOT NULL DEFAULT 'Open',
    "priority" "IssuePriority" NOT NULL DEFAULT 'Medium',
    "nextAction" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Issue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DecisionRecord" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "scopeVersionId" TEXT NOT NULL,
    "issueId" TEXT,
    "problem" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "alternativesConsidered" TEXT,
    "outcome" TEXT,
    "scopeImpact" "ScopeImpact" NOT NULL DEFAULT 'None',
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "pinnedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");
CREATE INDEX IF NOT EXISTS "Session_userId_idx" ON "Session"("userId");
CREATE INDEX IF NOT EXISTS "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE INDEX IF NOT EXISTS "Project_userId_status_idx" ON "Project"("userId", "status");
CREATE INDEX IF NOT EXISTS "Project_userId_updatedAt_idx" ON "Project"("userId", "updatedAt");
CREATE INDEX IF NOT EXISTS "ScopeVersion_projectId_versionNumber_idx" ON "ScopeVersion"("projectId", "versionNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "ScopeVersion_projectId_versionNumber_key" ON "ScopeVersion"("projectId", "versionNumber");
CREATE INDEX IF NOT EXISTS "Issue_projectId_status_priority_updatedAt_idx" ON "Issue"("projectId", "status", "priority", "updatedAt");
CREATE INDEX IF NOT EXISTS "DecisionRecord_projectId_scopeVersionId_idx" ON "DecisionRecord"("projectId", "scopeVersionId");
CREATE INDEX IF NOT EXISTS "DecisionRecord_projectId_isPinned_idx" ON "DecisionRecord"("projectId", "isPinned");
CREATE INDEX IF NOT EXISTS "DecisionRecord_projectId_createdAt_idx" ON "DecisionRecord"("projectId", "createdAt");

DO $$ BEGIN
    ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "ScopeVersion" ADD CONSTRAINT "ScopeVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "Issue" ADD CONSTRAINT "Issue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "DecisionRecord" ADD CONSTRAINT "DecisionRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "DecisionRecord" ADD CONSTRAINT "DecisionRecord_scopeVersionId_fkey" FOREIGN KEY ("scopeVersionId") REFERENCES "ScopeVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "DecisionRecord" ADD CONSTRAINT "DecisionRecord_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION prevent_scope_version_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'ScopeVersion records are immutable and cannot be updated';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_scope_version_update ON "ScopeVersion";
CREATE TRIGGER trg_prevent_scope_version_update
BEFORE UPDATE ON "ScopeVersion"
FOR EACH ROW
EXECUTE FUNCTION prevent_scope_version_update();
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- Non-destructive down migration guard: preserve production/course data unless explicitly reset.
SELECT 1;
-- +goose StatementEnd
