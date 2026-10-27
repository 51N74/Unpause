import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import request from 'supertest';
import {
  afterAll,
  beforeAll,
   describe,
  expect,
  it,
  vi,
} from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pgLite: PGlite;
let pgServer: PGLiteSocketServer;
let app: ReturnType<typeof import('../src/app.js').createApp>;
let prisma: typeof import('../src/lib/prisma.js').prisma;
let parseEnv: typeof import('../src/config/env.js').parseEnv;

const TEST_PORT = 54339;
const ALLOWED_ORIGIN = 'http://localhost:5173';

beforeAll(async () => {
  pgLite = await PGlite.create();
  const migrationSqlPath = path.resolve(
    __dirname,
    '../prisma/migrations/20261019000000_init/migration.sql'
  );
  const migrationSql = fs.readFileSync(migrationSqlPath, 'utf8');
  await pgLite.exec(migrationSql);

  pgServer = new PGLiteSocketServer({
    db: pgLite,
    port: TEST_PORT,
    host: '127.0.0.1',
  });
  await pgServer.start();

  process.env.NODE_ENV = 'test';
  process.env.PORT = '4005';
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${TEST_PORT}/postgres?sslmode=disable&connection_limit=1`;
  process.env.SESSION_SECRET = 'test-session-secret-with-at-least-32-chars!!';
  process.env.SESSION_COOKIE_NAME = 'unpause_sid';
  process.env.SESSION_TTL_HOURS = '168';
  process.env.CORS_ORIGINS = ALLOWED_ORIGIN;
  process.env.GITHUB_API_BASE_URL = 'https://api.github.com';

  const envMod = await import('../src/config/env.js');
  parseEnv = envMod.parseEnv;

  const prismaMod = await import('../src/lib/prisma.js');
  prisma = prismaMod.prisma;

  const appMod = await import('../src/app.js');
  app = appMod.createApp([ALLOWED_ORIGIN]);
});

afterAll(async () => {
  if (prisma) {
    await prisma.$disconnect();
  }
  if (pgServer) {
    await pgServer.stop();
  }
  if (pgLite) {
    await pgLite.close();
  }
});

describe('Unpause MVP API Integration Suite', () => {
  describe('1. Environment & Error Format Validation', () => {
    it('validates environment variables and rejects invalid configuration', () => {
      expect(() =>
        parseEnv({
          NODE_ENV: 'development',
          DATABASE_URL: 'invalid-url',
          SESSION_SECRET: 'short',
          CORS_ORIGINS: '',
        })
      ).toThrow(/Invalid environment configuration/);
    });

    it('returns a consistent error response with an error ID on 404 and validation errors', async () => {
      const res = await request(app).get('/api/v1/non-existent-route');
      expect(res.status).toBe(404);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('rejects state-changing requests from disallowed Origins', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('Origin', 'https://malicious.example.com')
        .send({ email: 'a@b.com', password: 'password123' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('INVALID_ORIGIN');
      expect(res.body.error.id).toBeTruthy();
    });
  });

  describe('2. Authentication & Session Persistence', () => {
    let agent: ReturnType<typeof request.agent>;

    beforeAll(() => {
      agent = request.agent(app);
    });

    it('rejects unauthenticated access to protected endpoints', async () => {
      const meRes = await request(app).get('/api/v1/auth/me');
      expect(meRes.status).toBe(401);
      expect(meRes.body.error.code).toBe('UNAUTHORIZED');
      expect(meRes.body.error.id).toBeTruthy();

      const projRes = await request(app).get('/api/v1/projects');
      expect(projRes.status).toBe(401);
    });

    it('registers a new user, sets an HttpOnly SameSite=Lax session cookie, and starts with an empty project list', async () => {
      const regRes = await agent
        .post('/api/v1/auth/register')
        .set('Origin', ALLOWED_ORIGIN)
        .send({
          email: 'Alice@Example.com',
          password: 'SecurePassword123!',
          displayName: 'Alice Dev',
        });

      expect(regRes.status).toBe(201);
      expect(regRes.body.user.email).toBe('alice@example.com');
      expect(regRes.body.user.displayName).toBe('Alice Dev');
      expect(regRes.body.user.passwordHash).toBeUndefined();

      const setCookie = regRes.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
      expect(cookieStr).toContain('unpause_sid=');
      expect(cookieStr).toContain('HttpOnly');
      expect(cookieStr).toMatch(/SameSite=Lax/i);

      // Verify empty state for new account
      const listRes = await agent.get('/api/v1/projects');
      expect(listRes.status).toBe(200);
      expect(listRes.body.projects).toEqual([]);
    });

    it('rejects duplicate email registration', async () => {
      const dupRes = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'alice@example.com',
          password: 'AnotherPassword123!',
        });

      expect(dupRes.status).toBe(409);
      expect(dupRes.body.error.code).toBe('CONFLICT');
    });

    it('allows updating the logged-in user display name', async () => {
      const patchRes = await agent
        .patch('/api/v1/users/me')
        .send({ displayName: 'Alice Updated' });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.user.displayName).toBe('Alice Updated');

      const meRes = await agent.get('/api/v1/auth/me');
      expect(meRes.status).toBe(200);
      expect(meRes.body.user.displayName).toBe('Alice Updated');
    });

    it('invalidates the server-side session on logout and allows logging back in', async () => {
      const logoutRes = await agent.post('/api/v1/auth/logout');
      expect(logoutRes.status).toBe(200);

      const meAfterLogout = await agent.get('/api/v1/auth/me');
      expect(meAfterLogout.status).toBe(401);

      const badLogin = await agent
        .post('/api/v1/auth/login')
        .send({ email: 'alice@example.com', password: 'WrongPassword!' });
      expect(badLogin.status).toBe(401);

      const goodLogin = await agent
        .post('/api/v1/auth/login')
        .send({ email: 'alice@example.com', password: 'SecurePassword123!' });
      expect(goodLogin.status).toBe(200);
      expect(goodLogin.body.user.email).toBe('alice@example.com');
    });
  });

  describe('3. Projects, ScopeVersion Immutability, Issues, Decisions, Timeline, Resume Context & Ownership Isolation', () => {
    let userAAgent: ReturnType<typeof request.agent>;
    let userBAgent: ReturnType<typeof request.agent>;

    let projectAId: string;
    let scopeV1Id: string;
    let scopeV2Id: string;
    let issueHighId: string;
    let issueLowId: string;
    let decisionV1Id: string;
    let decisionV2Id: string;

    beforeAll(async () => {
      userAAgent = request.agent(app);
      userBAgent = request.agent(app);

      await userAAgent.post('/api/v1/auth/register').send({
        email: 'usera@unpause.test',
        password: 'Password123!',
        displayName: 'User A',
      });

      await userBAgent.post('/api/v1/auth/register').send({
        email: 'userb@unpause.test',
        password: 'Password123!',
        displayName: 'User B',
      });
    });

    it('creates a project and initial Scope Version 1 in a single transaction', async () => {
      const createRes = await userAAgent.post('/api/v1/projects').send({
        name: 'Solo SaaS Tracker',
        description: 'Track subscriptions and recurring billing.',
        initialScope: {
          problem: 'Hard to track personal SaaS renewals.',
          targetUsers: 'Indie hackers and solo developers.',
          goal: 'Simple renewal ledger with CSV import.',
          inScope: 'Manual entry, CSV import, monthly total calculation.',
          outOfScope: 'Bank Plaid sync, mobile push notifications.',
        },
      });

      expect(createRes.status).toBe(201);
      expect(createRes.body.project.name).toBe('Solo SaaS Tracker');
      expect(createRes.body.project.status).toBe('Active');
      expect(createRes.body.project.currentScopeVersion).toBe(1);
      expect(createRes.body.initialScopeVersion.versionNumber).toBe(1);
      expect(createRes.body.initialScopeVersion.reasonForChange).toBe('Initial scope');

      projectAId = createRes.body.project.id;
      scopeV1Id = createRes.body.initialScopeVersion.id;
    });

    it('automatically associates a new Decision Record with Scope Version 1 and preserves scopeVersionId on edit even after Scope Version 2 is created', async () => {
      // Create issue under project A
      const issueRes = await userAAgent
        .post(`/api/v1/projects/${projectAId}/issues`)
        .send({
          title: 'Build CSV parser for billing statements',
          description: 'Support date, amount, and vendor columns.',
          status: 'In Progress',
          priority: 'High',
          nextAction: 'Write unit test for RFC4180 quoted commas in parser.ts',
        });
      expect(issueRes.status).toBe(201);
      issueHighId = issueRes.body.issue.id;

      const issueLowRes = await userAAgent
        .post(`/api/v1/projects/${projectAId}/issues`)
        .send({
          title: 'Add currency badge to totals row',
          description: 'Show USD label next to summary.',
          status: 'Open',
          priority: 'Low',
          nextAction: 'Update SummaryRow.tsx component',
        });
      expect(issueLowRes.status).toBe(201);
      issueLowId = issueLowRes.body.issue.id;

      // Record decision under Scope Version 1
      const dec1Res = await userAAgent
        .post(`/api/v1/projects/${projectAId}/decisions`)
        .send({
          problem: 'Which CSV library should parse uploaded files?',
          decision: 'Use PapaParse on the client before uploading.',
          rationale: 'Avoids multipart file parsing on the backend.',
          alternativesConsidered: 'csv-parse on Node backend',
          outcome: 'Working prototype in 20 minutes.',
          scopeImpact: 'Narrows',
          issueId: issueHighId,
        });

      expect(dec1Res.status).toBe(201);
      expect(dec1Res.body.decision.scopeVersionId).toBe(scopeV1Id);
      expect(dec1Res.body.decision.scopeVersion.versionNumber).toBe(1);
      expect(dec1Res.body.decision.scopeImpact).toBe('Narrows');
      decisionV1Id = dec1Res.body.decision.id;

      // Now create Scope Version 2
      const scope2Res = await userAAgent
        .post(`/api/v1/projects/${projectAId}/scope-versions`)
        .send({
          problem: 'Hard to track personal SaaS renewals.',
          targetUsers: 'Indie hackers and solo developers.',
          goal: 'Simple renewal ledger with CSV import and annual breakdown.',
          inScope:
            'Manual entry, CSV import, monthly and annual total calculation.',
          outOfScope: 'Bank Plaid sync, mobile push notifications.',
          reasonForChange:
            'Annual billing subscriptions skewed monthly totals without annualized breakdown.',
        });

      expect(scope2Res.status).toBe(201);
      expect(scope2Res.body.scopeVersion.versionNumber).toBe(2);
      scopeV2Id = scope2Res.body.scopeVersion.id;

      // Edit Decision 1 while Scope v2 is active (and even attempt to pass scopeVersionId: scopeV2Id)
      const editDec1Res = await userAAgent
        .patch(`/api/v1/projects/${projectAId}/decisions/${decisionV1Id}`)
        .send({
          outcome: 'Confirmed working across 500-row CSV files.',
          scopeVersionId: scopeV2Id, // Must be ignored
        });

      expect(editDec1Res.status).toBe(200);
      expect(editDec1Res.body.decision.outcome).toBe(
        'Confirmed working across 500-row CSV files.'
      );
      // MUST still belong to Scope Version 1!
      expect(editDec1Res.body.decision.scopeVersionId).toBe(scopeV1Id);
      expect(editDec1Res.body.decision.scopeVersion.versionNumber).toBe(1);

      // Create Decision 2 under Scope Version 2
      const dec2Res = await userAAgent
        .post(`/api/v1/projects/${projectAId}/decisions`)
        .send({
          problem: 'How to normalize annual subscriptions in monthly view?',
          decision: 'Store billingCycle enum and divide annual cost by 12 in summary.',
          rationale: 'Keeps schema simple while giving accurate monthly burn.',
          scopeImpact: 'Expands',
        });

      expect(dec2Res.status).toBe(201);
      expect(dec2Res.body.decision.scopeVersionId).toBe(scopeV2Id);
      expect(dec2Res.body.decision.scopeVersion.versionNumber).toBe(2);
      decisionV2Id = dec2Res.body.decision.id;
    });

    it('preserves Decision Record updatedAt timestamp when pinning or unpinning', async () => {
      const beforeRes = await userAAgent.get(
        `/api/v1/projects/${projectAId}/decisions/${decisionV1Id}`
      );
      const originalUpdatedAt = beforeRes.body.decision.updatedAt;

      await new Promise((r) => setTimeout(r, 25));

      const pinRes = await userAAgent
        .patch(`/api/v1/projects/${projectAId}/decisions/${decisionV1Id}/pin`)
        .send({ isPinned: true });

      expect(pinRes.status).toBe(200);
      expect(pinRes.body.decision.isPinned).toBe(true);
      expect(pinRes.body.decision.updatedAt).toBe(originalUpdatedAt);

      const unpinRes = await userAAgent
        .patch(`/api/v1/projects/${projectAId}/decisions/${decisionV1Id}/pin`)
        .send({ isPinned: false });

      expect(unpinRes.status).toBe(200);
      expect(unpinRes.body.decision.isPinned).toBe(false);
      expect(unpinRes.body.decision.updatedAt).toBe(originalUpdatedAt);

      // Pin it again for Resume Context verification
      await userAAgent
        .patch(`/api/v1/projects/${projectAId}/decisions/${decisionV1Id}/pin`)
        .send({ isPinned: true });
    });

    it('enforces Scope Version immutability at both the API and database levels', async () => {
      const patchRes = await userAAgent
        .patch(`/api/v1/projects/${projectAId}/scope-versions/${scopeV1Id}`)
        .send({ goal: 'Mutated goal' });
      expect(patchRes.status).toBe(405);
      expect(patchRes.body.error.code).toBe('SCOPE_VERSION_IMMUTABLE');

      const putRes = await userAAgent
        .put(`/api/v1/projects/${projectAId}/scope-versions/${scopeV1Id}`)
        .send({ goal: 'Mutated goal' });
      expect(putRes.status).toBe(405);
      expect(putRes.body.error.code).toBe('SCOPE_VERSION_IMMUTABLE');

      const delRes = await userAAgent.delete(
        `/api/v1/projects/${projectAId}/scope-versions/${scopeV1Id}`
      );
      expect(delRes.status).toBe(405);
      expect(delRes.body.error.code).toBe('SCOPE_VERSION_IMMUTABLE');

      // Direct DB update must fail due to PostgreSQL trigger
      await expect(
        prisma.scopeVersion.update({
          where: { id: scopeV1Id },
          data: { goal: 'Direct DB mutation' },
        })
      ).rejects.toThrow();

      // Direct DB delete of referenced ScopeVersion must fail due to ON DELETE RESTRICT
      await expect(
        prisma.scopeVersion.delete({
          where: { id: scopeV1Id },
        })
      ).rejects.toThrow();
    });

    it('builds Scope Timeline and Resume Context accurately', async () => {
      const timelineRes = await userAAgent.get(
        `/api/v1/projects/${projectAId}/timeline`
      );
      expect(timelineRes.status).toBe(200);
      expect(timelineRes.body.versions).toHaveLength(2);
      expect(timelineRes.body.versions[0].versionNumber).toBe(1);
      expect(timelineRes.body.versions[0].decisions).toHaveLength(1);
      expect(timelineRes.body.versions[0].decisions[0].id).toBe(decisionV1Id);
      expect(timelineRes.body.versions[1].versionNumber).toBe(2);
      expect(timelineRes.body.versions[1].decisions).toHaveLength(1);
      expect(timelineRes.body.versions[1].decisions[0].id).toBe(decisionV2Id);

      const resumeRes = await userAAgent.get(
        `/api/v1/projects/${projectAId}/resume-context`
      );
      expect(resumeRes.status).toBe(200);
      expect(resumeRes.body.currentScope.versionNumber).toBe(2);
      expect(resumeRes.body.pinnedDecisions).toHaveLength(1);
      expect(resumeRes.body.pinnedDecisions[0].id).toBe(decisionV1Id);
      expect(resumeRes.body.recentDecisions).toHaveLength(1);
      expect(resumeRes.body.recentDecisions[0].id).toBe(decisionV2Id);
      // Outstanding issues ordered High before Low
      expect(resumeRes.body.outstandingIssues.map((i: { id: string }) => i.id)).toEqual([
        issueHighId,
        issueLowId,
      ]);
    });

    it('retains Decision Records and sets issueId to null when a linked Issue is deleted', async () => {
      const delIssueRes = await userAAgent.delete(
        `/api/v1/projects/${projectAId}/issues/${issueHighId}`
      );
      expect(delIssueRes.status).toBe(200);

      const decAfterIssueDelete = await userAAgent.get(
        `/api/v1/projects/${projectAId}/decisions/${decisionV1Id}`
      );
      expect(decAfterIssueDelete.status).toBe(200);
      expect(decAfterIssueDelete.body.decision.id).toBe(decisionV1Id);
      expect(decAfterIssueDelete.body.decision.issueId).toBeNull();
    });

    it('makes archived projects and their child resources strictly read-only until restored', async () => {
      const archiveRes = await userAAgent.post(
        `/api/v1/projects/${projectAId}/archive`
      );
      expect(archiveRes.status).toBe(200);
      expect(archiveRes.body.project.status).toBe('Archived');

      // Mutations must fail with 409 PROJECT_ARCHIVED
      const editProj = await userAAgent
        .patch(`/api/v1/projects/${projectAId}`)
        .send({ name: 'Should fail' });
      expect(editProj.status).toBe(409);
      expect(editProj.body.error.code).toBe('PROJECT_ARCHIVED');

      const addIssue = await userAAgent
        .post(`/api/v1/projects/${projectAId}/issues`)
        .send({ title: 'Blocked issue', nextAction: 'Blocked action' });
      expect(addIssue.status).toBe(409);
      expect(addIssue.body.error.code).toBe('PROJECT_ARCHIVED');

      const addDecision = await userAAgent
        .post(`/api/v1/projects/${projectAId}/decisions`)
        .send({
          problem: 'Blocked',
          decision: 'Blocked',
          rationale: 'Blocked',
          scopeImpact: 'None',
        });
      expect(addDecision.status).toBe(409);
      expect(addDecision.body.error.code).toBe('PROJECT_ARCHIVED');

      // Restore returns project to Active
      const restoreRes = await userAAgent.post(
        `/api/v1/projects/${projectAId}/restore`
      );
      expect(restoreRes.status).toBe(200);
      expect(restoreRes.body.project.status).toBe('Active');
    });

    it('enforces strict user ownership isolation across all endpoints', async () => {
      // User B cannot see User A's project in list
      const bList = await userBAgent.get('/api/v1/projects?status=All');
      expect(bList.status).toBe(200);
      expect(bList.body.projects).toHaveLength(0);

      // User B cannot read or modify User A's project, resume context, timeline, scopes, issues, or decisions
      const endpoints = [
        userBAgent.get(`/api/v1/projects/${projectAId}`),
        userBAgent.patch(`/api/v1/projects/${projectAId}`).send({ name: 'Hack' }),
        userBAgent.post(`/api/v1/projects/${projectAId}/archive`),
        userBAgent.get(`/api/v1/projects/${projectAId}/resume-context`),
        userBAgent.get(`/api/v1/projects/${projectAId}/timeline`),
        userBAgent.get(`/api/v1/projects/${projectAId}/scope-versions`),
        userBAgent.get(`/api/v1/projects/${projectAId}/issues`),
        userBAgent.patch(`/api/v1/projects/${projectAId}/issues/${issueLowId}`).send({ title: 'Hack' }),
        userBAgent.get(`/api/v1/projects/${projectAId}/decisions`),
        userBAgent.patch(`/api/v1/projects/${projectAId}/decisions/${decisionV1Id}`).send({ outcome: 'Hack' }),
        userBAgent.delete(`/api/v1/projects/${projectAId}/decisions/${decisionV1Id}`),
      ];

      const results = await Promise.all(endpoints);
      for (const res of results) {
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      }
    });
  });

  describe('4. GitHub Explorer Backend Integration & Error Handling', () => {
    let agent: ReturnType<typeof request.agent>;

    beforeAll(async () => {
      agent = request.agent(app);
      await agent.post('/api/v1/auth/login').send({
        email: 'usera@unpause.test',
        password: 'Password123!',
      });
    });

    it('fetches and formats GitHub repositories with language and minStars filters', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            total_count: 42,
            incomplete_results: false,
            items: [
              {
                id: 101,
                name: 'prisma',
                full_name: 'prisma/prisma',
                owner: { login: 'prisma' },
                description: 'Next-generation ORM for Node.js & TypeScript',
                language: 'TypeScript',
                stargazers_count: 40000,
                forks_count: 1500,
                html_url: 'https://github.com/prisma/prisma',
                updated_at: '2026-10-01T00:00:00Z',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      const res = await agent.get(
        '/api/v1/github/repositories?q=orm&language=TypeScript&minStars=1000&page=1&perPage=10'
      );

      expect(res.status).toBe(200);
      expect(res.body.totalCount).toBe(42);
      expect(res.body.hasNextPage).toBe(true);
      expect(res.body.hasPreviousPage).toBe(false);
      expect(res.body.items[0].fullName).toBe('prisma/prisma');
      expect(res.body.items[0].stargazersCount).toBe(40000);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const calledUrl = String(fetchSpy.mock.calls[0][0]);
      expect(calledUrl).toContain('language%3ATypeScript');
      expect(calledUrl).toContain('stars%3A%3E%3D1000');
      fetchSpy.mockRestore();
    });

    it('surfaces rate-limit errors explicitly as 429 GITHUB_RATE_LIMIT instead of empty results', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({ message: 'API rate limit exceeded for IP' }),
          {
            status: 403,
            headers: {
              'Content-Type': 'application/json',
              'x-ratelimit-remaining': '0',
            },
          }
        )
      );

      const res = await agent.get('/api/v1/github/repositories?q=react');
      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('GITHUB_RATE_LIMIT');
      expect(res.body.error.id).toBeTruthy();

      fetchSpy.mockRestore();
    });

    it('surfaces upstream failures explicitly as 502 GITHUB_UPSTREAM_ERROR', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValueOnce(new Error('Network failure'));

      const res = await agent.get('/api/v1/github/repositories?q=react');
      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('GITHUB_UPSTREAM_ERROR');

      fetchSpy.mockRestore();
    });
  });
});
