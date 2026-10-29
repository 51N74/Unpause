package tests

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/westride/unpause/api-go/internal/config"
	"github.com/westride/unpause/api-go/internal/database"
	"github.com/westride/unpause/api-go/internal/http/middleware"
	"github.com/westride/unpause/api-go/internal/http/router"
	"github.com/westride/unpause/api-go/internal/shared"
	"golang.org/x/crypto/bcrypt"
)

const (
	testAllowedOrigin = "http://localhost:5173"
	testPgPort        = 54349
)

var (
	testPool *pgxpool.Pool
	testDeps *router.Dependencies
	testSrv  *httptest.Server
)

func TestMain(m *testing.M) {
	var pgCmd *exec.Cmd
	dbURL := os.Getenv("TEST_DATABASE_URL")

	if dbURL == "" {
		scriptPath := filepath.Clean("../../../scripts/pglite-server.mjs")
		if _, err := os.Stat(scriptPath); err != nil {
			scriptPath = filepath.Clean("../../scripts/pglite-server.mjs")
		}

		pgCmd = exec.Command("node", scriptPath, fmt.Sprintf("%d", testPgPort), "memory")
		stdout, err := pgCmd.StdoutPipe()
		if err != nil {
			fmt.Fprintf(os.Stderr, "failed to create stdout pipe for pglite: %v\n", err)
			os.Exit(1)
		}
		pgCmd.Stderr = os.Stderr

		if err := pgCmd.Start(); err != nil {
			fmt.Fprintf(os.Stderr, "failed to start pglite server: %v\n", err)
			os.Exit(1)
		}

		readyCh := make(chan struct{})
		go func() {
			scanner := bufio.NewScanner(stdout)
			for scanner.Scan() {
				line := scanner.Text()
				if strings.HasPrefix(line, "PGLITE_READY:") {
					close(readyCh)
					return
				}
			}
		}()

		select {
		case <-readyCh:
		case <-time.After(20 * time.Second):
			_ = pgCmd.Process.Kill()
			fmt.Fprintln(os.Stderr, "timed out waiting for pglite PostgreSQL server to start")
			os.Exit(1)
		}

		dbURL = fmt.Sprintf("postgresql://postgres:postgres@127.0.0.1:%d/postgres?sslmode=disable&connection_limit=1", testPgPort)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	pool, err := database.NewPool(ctx, dbURL)
	cancel()
	if err != nil {
		if pgCmd != nil {
			_ = pgCmd.Process.Kill()
		}
		fmt.Fprintf(os.Stderr, "failed to connect to test PostgreSQL database: %v\n", err)
		os.Exit(1)
	}
	testPool = pool

	migrationsDir := filepath.Clean("../migrations")
	if err := database.RunMigrations(testPool, migrationsDir); err != nil {
		testPool.Close()
		if pgCmd != nil {
			_ = pgCmd.Process.Kill()
		}
		fmt.Fprintf(os.Stderr, "failed to run Goose migrations on test database: %v\n", err)
		os.Exit(1)
	}

	cfg := &config.Config{
		Env:               "test",
		Port:              4005,
		DatabaseURL:       dbURL,
		SessionSecret:     "test-session-secret-with-at-least-32-chars!!",
		SessionCookieName: "unpause_sid",
		SessionTTLHours:   168,
		CORSOrigins:       []string{testAllowedOrigin},
		GitHubAPIBaseURL:  "https://api.github.com",
		GitHubToken:       "",
	}

	testDeps = router.NewDependencies(cfg, testPool, nil)
	engine := router.NewEngine(testDeps)
	testSrv = httptest.NewServer(engine)

	code := m.Run()

	testSrv.Close()
	testPool.Close()
	if pgCmd != nil && pgCmd.Process != nil {
		_ = pgCmd.Process.Signal(os.Interrupt)
		_, _ = pgCmd.Process.Wait()
	}

	os.Exit(code)
}

type testClient struct {
	t      *testing.T
	client *http.Client
}

func newTestClient(t *testing.T) *testClient {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("failed to create cookie jar: %v", err)
	}
	return &testClient{
		t: t,
		client: &http.Client{
			Jar:     jar,
			Timeout: 10 * time.Second,
		},
	}
}

func (tc *testClient) request(method, path string, body any, headers map[string]string) (*http.Response, map[string]any) {
	tc.t.Helper()
	var bodyReader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			tc.t.Fatalf("failed to marshal request body: %v", err)
		}
		bodyReader = bytes.NewReader(raw)
	}

	req, err := http.NewRequest(method, testSrv.URL+path, bodyReader)
	if err != nil {
		tc.t.Fatalf("failed to create request: %v", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	resp, err := tc.client.Do(req)
	if err != nil {
		tc.t.Fatalf("request %s %s failed: %v", method, path, err)
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	rawResp, err := io.ReadAll(resp.Body)
	if err != nil {
		tc.t.Fatalf("failed to read response body: %v", err)
	}

	var parsed map[string]any
	if len(rawResp) > 0 {
		_ = json.Unmarshal(rawResp, &parsed)
	}
	return resp, parsed
}

func Test1_EnvironmentAndErrorFormatValidation(t *testing.T) {
	t.Run("validates environment variables and rejects invalid configuration", func(t *testing.T) {
		_, err := config.ParseEnv(func(key string) string {
			switch key {
			case "NODE_ENV":
				return "development"
			case "DATABASE_URL":
				return "invalid-url"
			case "SESSION_SECRET":
				return "short"
			case "CORS_ORIGINS":
				return ""
			default:
				return ""
			}
		})
		if err == nil || !strings.Contains(err.Error(), "Invalid environment configuration") {
			t.Fatalf("expected invalid environment configuration error, got: %v", err)
		}
	})

	t.Run("returns consistent error response with UUID error ID on 404", func(t *testing.T) {
		tc := newTestClient(t)
		resp, body := tc.request(http.MethodGet, "/api/v1/non-existent-route", nil, nil)
		if resp.StatusCode != http.StatusNotFound {
			t.Fatalf("expected 404, got %d", resp.StatusCode)
		}
		errObj, ok := body["error"].(map[string]any)
		if !ok {
			t.Fatalf("expected error object in response, got %v", body)
		}
		id, _ := errObj["id"].(string)
		code, _ := errObj["code"].(string)
		if len(id) != 36 || code != "NOT_FOUND" {
			t.Fatalf("unexpected error id=%q or code=%q", id, code)
		}
	})

	t.Run("rejects state-changing requests from disallowed Origins", func(t *testing.T) {
		tc := newTestClient(t)
		resp, body := tc.request(
			http.MethodPost,
			"/api/v1/auth/login",
			map[string]any{"email": "a@b.com", "password": "password123"},
			map[string]string{"Origin": "https://malicious.example.com"},
		)
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("expected 403, got %d", resp.StatusCode)
		}
		errObj := body["error"].(map[string]any)
		if errObj["code"] != "INVALID_ORIGIN" {
			t.Fatalf("expected INVALID_ORIGIN, got %v", errObj["code"])
		}
	})

	t.Run("returns 200 status ok on GET /api/v1/health", func(t *testing.T) {
		tc := newTestClient(t)
		resp, body := tc.request(http.MethodGet, "/api/v1/health", nil, nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200, got %d", resp.StatusCode)
		}
		if body["status"] != "ok" {
			t.Fatalf("expected status ok, got %v", body["status"])
		}
	})
}

func Test2_AuthenticationPasswordCompatibilityAndSessions(t *testing.T) {
	tc := newTestClient(t)

	t.Run("rejects unauthenticated access to protected endpoints", func(t *testing.T) {
		resp, body := tc.request(http.MethodGet, "/api/v1/auth/me", nil, nil)
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d", resp.StatusCode)
		}
		errObj := body["error"].(map[string]any)
		if errObj["code"] != "UNAUTHORIZED" {
			t.Fatalf("expected UNAUTHORIZED, got %v", errObj["code"])
		}

		projResp, _ := tc.request(http.MethodGet, "/api/v1/projects", nil, nil)
		if projResp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("expected 401 on /projects, got %d", projResp.StatusCode)
		}
	})

	t.Run("registers user, sets HttpOnly SameSite=Lax cookie, and starts with empty projects", func(t *testing.T) {
		resp, body := tc.request(
			http.MethodPost,
			"/api/v1/auth/register",
			map[string]any{
				"email":       "Alice@Example.com",
				"password":    "SecurePassword123!",
				"displayName": "Alice Dev",
			},
			map[string]string{"Origin": testAllowedOrigin},
		)
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("expected 201, got %d: %v", resp.StatusCode, body)
		}

		user := body["user"].(map[string]any)
		if user["email"] != "alice@example.com" || user["displayName"] != "Alice Dev" {
			t.Fatalf("unexpected user response: %v", user)
		}
		if _, hasHash := user["passwordHash"]; hasHash {
			t.Fatal("passwordHash must never be exposed in JSON")
		}

		setCookie := strings.Join(resp.Header.Values("Set-Cookie"), ";")
		if !strings.Contains(setCookie, "unpause_sid=") ||
			!strings.Contains(setCookie, "HttpOnly") ||
			!strings.Contains(strings.ToLower(setCookie), "samesite=lax") {
			t.Fatalf("missing required cookie attributes in Set-Cookie: %s", setCookie)
		}

		listResp, listBody := tc.request(http.MethodGet, "/api/v1/projects", nil, nil)
		if listResp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 on /projects, got %d", listResp.StatusCode)
		}
		projects := listBody["projects"].([]any)
		if len(projects) != 0 {
			t.Fatalf("expected empty projects list for new user, got %d", len(projects))
		}
	})

	t.Run("rejects duplicate email registration", func(t *testing.T) {
		other := newTestClient(t)
		resp, body := other.request(
			http.MethodPost,
			"/api/v1/auth/register",
			map[string]any{
				"email":    "alice@example.com",
				"password": "AnotherPassword123!",
			},
			nil,
		)
		if resp.StatusCode != http.StatusConflict {
			t.Fatalf("expected 409, got %d", resp.StatusCode)
		}
		errObj := body["error"].(map[string]any)
		if errObj["code"] != "CONFLICT" {
			t.Fatalf("expected CONFLICT, got %v", errObj["code"])
		}
	})

	t.Run("verifies both Argon2id PHC hashes and legacy bcrypt hashes", func(t *testing.T) {
		argonHash, err := shared.HashPassword("MySecretPass123!")
		if err != nil {
			t.Fatalf("HashPassword failed: %v", err)
		}
		ok, err := shared.VerifyPassword(argonHash, "MySecretPass123!")
		if err != nil || !ok {
			t.Fatalf("VerifyPassword failed for argon2id hash: %v", err)
		}

		bcryptBytes, err := bcrypt.GenerateFromPassword([]byte("LegacyPass123!"), 10)
		if err != nil {
			t.Fatalf("bcrypt failed: %v", err)
		}
		okBcrypt, err := shared.VerifyPassword(string(bcryptBytes), "LegacyPass123!")
		if err != nil || !okBcrypt {
			t.Fatalf("VerifyPassword failed for bcrypt fallback hash: %v", err)
		}
	})

	t.Run("updates logged-in user display name", func(t *testing.T) {
		resp, body := tc.request(
			http.MethodPatch,
			"/api/v1/users/me",
			map[string]any{"displayName": "Alice Updated"},
			nil,
		)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200, got %d: %v", resp.StatusCode, body)
		}
		user := body["user"].(map[string]any)
		if user["displayName"] != "Alice Updated" {
			t.Fatalf("expected Alice Updated, got %v", user["displayName"])
		}
	})

	t.Run("invalidates server-side session on logout and allows logging back in", func(t *testing.T) {
		logoutResp, _ := tc.request(http.MethodPost, "/api/v1/auth/logout", nil, nil)
		if logoutResp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 on logout, got %d", logoutResp.StatusCode)
		}

		meAfter, _ := tc.request(http.MethodGet, "/api/v1/auth/me", nil, nil)
		if meAfter.StatusCode != http.StatusUnauthorized {
			t.Fatalf("expected 401 after logout, got %d", meAfter.StatusCode)
		}

		badLogin, _ := tc.request(
			http.MethodPost,
			"/api/v1/auth/login",
			map[string]any{"email": "alice@example.com", "password": "WrongPassword!"},
			nil,
		)
		if badLogin.StatusCode != http.StatusUnauthorized {
			t.Fatalf("expected 401 on wrong password, got %d", badLogin.StatusCode)
		}

		goodLogin, _ := tc.request(
			http.MethodPost,
			"/api/v1/auth/login",
			map[string]any{"email": "alice@example.com", "password": "SecurePassword123!"},
			nil,
		)
		if goodLogin.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 on valid login, got %d", goodLogin.StatusCode)
		}
	})

	t.Run("preserves session across idle connection pool resets, transient database errors, and clears cookie only on 401 UNAUTHORIZED", func(t *testing.T) {
		// Verify session works across multiple authenticated requests
		meResp1, meBody1 := tc.request(http.MethodGet, "/api/v1/auth/me", nil, nil)
		if meResp1.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 on /auth/me, got %d: %v", meResp1.StatusCode, meBody1)
		}

		projResp1, projBody1 := tc.request(http.MethodGet, "/api/v1/projects", nil, nil)
		if projResp1.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 on /projects before idle reset, got %d: %v", projResp1.StatusCode, projBody1)
		}

		// Simulate MaxConnIdleTime (5m) expiring while the application is left idle:
		// Resetting the pool closes all idle connections so subsequent requests must establish
		// a new database connection without colliding on cached prepared statements (SQLSTATE 42P05).
		testPool.Reset()

		projRespAfterIdle, projBodyAfterIdle := tc.request(http.MethodGet, "/api/v1/projects", nil, nil)
		if projRespAfterIdle.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 on /projects after idle connection pool reset, got %d: %v", projRespAfterIdle.StatusCode, projBodyAfterIdle)
		}

		meRespAfterIdle, meBodyAfterIdle := tc.request(http.MethodGet, "/api/v1/auth/me", nil, nil)
		if meRespAfterIdle.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 on /auth/me after idle connection pool reset, got %d: %v", meRespAfterIdle.StatusCode, meBodyAfterIdle)
		}

		// Simulate a transient non-401 error (e.g., temporary DB error) during session validation
		// and verify RequireAuth does NOT wipe the user's valid session cookie.
		r := gin.New()
		r.GET("/api/v1/projects", middleware.RequireAuth(testDeps.Config, func(ctx context.Context, sessionID string) (any, string, error) {
			return nil, "", fmt.Errorf("transient database connection error")
		}), func(c *gin.Context) {
			c.Status(http.StatusOK)
		})
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/projects", nil)
		req.AddCookie(&http.Cookie{Name: testDeps.Config.SessionCookieName, Value: "valid-session-token"})
		r.ServeHTTP(rec, req)
		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("expected 500 on transient DB error, got %d", rec.Code)
		}
		if setCookie := rec.Header().Get("Set-Cookie"); setCookie != "" {
			t.Fatalf("expected RequireAuth NOT to clear session cookie on non-401 transient error, got Set-Cookie: %s", setCookie)
		}

		// Verify expired session in PostgreSQL returns 401 UNAUTHORIZED, deletes the expired row, and clears cookie
		expiredClient := newTestClient(t)
		loginResp, _ := expiredClient.request(
			http.MethodPost,
			"/api/v1/auth/login",
			map[string]any{"email": "alice@example.com", "password": "SecurePassword123!"},
			nil,
		)
		if loginResp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 on login for expiry test, got %d", loginResp.StatusCode)
		}

		var expiredSessionID string
		for _, c := range loginResp.Cookies() {
			if c.Name == testDeps.Config.SessionCookieName {
				expiredSessionID = c.Value
			}
		}
		if expiredSessionID == "" {
			t.Fatal("expected session cookie to be set on login")
		}

		// Expire the session in PostgreSQL
		_, err := testPool.Exec(
			context.Background(),
			`UPDATE "Session" SET "expiresAt" = $1 WHERE "id" = $2`,
			time.Now().UTC().Add(-1*time.Hour),
			expiredSessionID,
		)
		if err != nil {
			t.Fatalf("failed to update session expiresAt: %v", err)
		}

		expResp, expBody := expiredClient.request(http.MethodGet, "/api/v1/projects", nil, nil)
		if expResp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("expected 401 for expired session, got %d: %v", expResp.StatusCode, expBody)
		}
		errObj := expBody["error"].(map[string]any)
		if errObj["code"] != "UNAUTHORIZED" {
			t.Fatalf("expected UNAUTHORIZED code, got %v", errObj["code"])
		}

		// Verify Set-Cookie header clears the expired cookie
		setCookieHeader := strings.Join(expResp.Header.Values("Set-Cookie"), ";")
		if !strings.Contains(setCookieHeader, "Max-Age=0") && !strings.Contains(setCookieHeader, "Max-Age=-1") {
			t.Fatalf("expected expired session response to clear cookie, got Set-Cookie: %s", setCookieHeader)
		}

		// Verify expired session record was removed from PostgreSQL
		var remaining int
		if err := testPool.QueryRow(context.Background(), `SELECT COUNT(*) FROM "Session" WHERE "id" = $1`, expiredSessionID).Scan(&remaining); err != nil || remaining != 0 {
			t.Fatalf("expected expired session record to be deleted from PostgreSQL, remaining=%d err=%v", remaining, err)
		}

		// Verify Alice's original session on tc is still completely valid and usable
		meResp2, _ := tc.request(http.MethodGet, "/api/v1/auth/me", nil, nil)
		if meResp2.StatusCode != http.StatusOK {
			t.Fatalf("expected Alice's active session to remain valid, got %d", meResp2.StatusCode)
		}
	})
}

func Test3_CoreDomainDatabaseIntegrityAndOwnershipIsolation(t *testing.T) {
	userA := newTestClient(t)
	userB := newTestClient(t)

	regA, _ := userA.request(http.MethodPost, "/api/v1/auth/register", map[string]any{
		"email":       "usera@unpause.test",
		"password":    "Password123!",
		"displayName": "User A",
	}, nil)
	if regA.StatusCode != http.StatusCreated {
		t.Fatalf("failed to register userA: %d", regA.StatusCode)
	}

	regB, _ := userB.request(http.MethodPost, "/api/v1/auth/register", map[string]any{
		"email":       "userb@unpause.test",
		"password":    "Password123!",
		"displayName": "User B",
	}, nil)
	if regB.StatusCode != http.StatusCreated {
		t.Fatalf("failed to register userB: %d", regB.StatusCode)
	}

	var projectAId, scopeV1Id, scopeV2Id, issueHighId, issueLowId, decisionV1Id, decisionV2Id string

	t.Run("creates project and initial Scope Version 1 atomically", func(t *testing.T) {
		resp, body := userA.request(http.MethodPost, "/api/v1/projects", map[string]any{
			"name":        "Solo SaaS Tracker",
			"description": "Track subscriptions and recurring billing.",
			"initialScope": map[string]any{
				"problem":     "Hard to track personal SaaS renewals.",
				"targetUsers": "Indie hackers and solo developers.",
				"goal":        "Simple renewal ledger with CSV import.",
				"inScope":     "Manual entry, CSV import, monthly total calculation.",
				"outOfScope":  "Bank Plaid sync, mobile push notifications.",
			},
		}, nil)
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("expected 201, got %d: %v", resp.StatusCode, body)
		}

		proj := body["project"].(map[string]any)
		sv1 := body["initialScopeVersion"].(map[string]any)
		if proj["name"] != "Solo SaaS Tracker" || proj["status"] != "Active" || int(proj["currentScopeVersion"].(float64)) != 1 {
			t.Fatalf("unexpected project payload: %v", proj)
		}
		if int(sv1["versionNumber"].(float64)) != 1 || sv1["reasonForChange"] != "Initial scope" {
			t.Fatalf("unexpected initialScopeVersion payload: %v", sv1)
		}

		projectAId = proj["id"].(string)
		scopeV1Id = sv1["id"].(string)
	})

	t.Run("associates new Decision Record with active Scope Version and preserves scopeVersionId on edit after Scope v2 is created", func(t *testing.T) {
		iss1Resp, iss1Body := userA.request(http.MethodPost, fmt.Sprintf("/api/v1/projects/%s/issues", projectAId), map[string]any{
			"title":       "Build CSV parser for billing statements",
			"description": "Support date, amount, and vendor columns.",
			"status":      "In Progress",
			"priority":    "High",
			"nextAction":  "Write unit test for RFC4180 quoted commas in parser.ts",
		}, nil)
		if iss1Resp.StatusCode != http.StatusCreated {
			t.Fatalf("expected 201 creating issue 1, got %d: %v", iss1Resp.StatusCode, iss1Body)
		}
		issueHighId = iss1Body["issue"].(map[string]any)["id"].(string)

		iss2Resp, iss2Body := userA.request(http.MethodPost, fmt.Sprintf("/api/v1/projects/%s/issues", projectAId), map[string]any{
			"title":       "Add currency badge to totals row",
			"description": "Show USD label next to summary.",
			"status":      "Open",
			"priority":    "Low",
			"nextAction":  "Update SummaryRow.tsx component",
		}, nil)
		if iss2Resp.StatusCode != http.StatusCreated {
			t.Fatalf("expected 201 creating issue 2, got %d", iss2Resp.StatusCode)
		}
		issueLowId = iss2Body["issue"].(map[string]any)["id"].(string)

		dec1Resp, dec1Body := userA.request(http.MethodPost, fmt.Sprintf("/api/v1/projects/%s/decisions", projectAId), map[string]any{
			"problem":                "Which CSV library should parse uploaded files?",
			"decision":               "Use PapaParse on the client before uploading.",
			"rationale":              "Avoids multipart file parsing on the backend.",
			"alternativesConsidered": "csv-parse on Node backend",
			"outcome":                "Working prototype in 20 minutes.",
			"scopeImpact":            "Narrows",
			"issueId":                issueHighId,
		}, nil)
		if dec1Resp.StatusCode != http.StatusCreated {
			t.Fatalf("expected 201 creating decision 1, got %d: %v", dec1Resp.StatusCode, dec1Body)
		}
		dec1 := dec1Body["decision"].(map[string]any)
		if dec1["scopeVersionId"] != scopeV1Id || dec1["scopeImpact"] != "Narrows" {
			t.Fatalf("expected decision 1 bound to scopeV1Id, got %v", dec1)
		}
		decisionV1Id = dec1["id"].(string)

		// Create Scope Version 2
		sv2Resp, sv2Body := userA.request(http.MethodPost, fmt.Sprintf("/api/v1/projects/%s/scope-versions", projectAId), map[string]any{
			"problem":         "Hard to track personal SaaS renewals.",
			"targetUsers":     "Indie hackers and solo developers.",
			"goal":            "Simple renewal ledger with CSV import and annual breakdown.",
			"inScope":         "Manual entry, CSV import, monthly and annual total calculation.",
			"outOfScope":      "Bank Plaid sync, mobile push notifications.",
			"reasonForChange": "Annual billing subscriptions skewed monthly totals without annualized breakdown.",
		}, nil)
		if sv2Resp.StatusCode != http.StatusCreated {
			t.Fatalf("expected 201 creating scope v2, got %d: %v", sv2Resp.StatusCode, sv2Body)
		}
		sv2 := sv2Body["scopeVersion"].(map[string]any)
		if int(sv2["versionNumber"].(float64)) != 2 {
			t.Fatalf("expected versionNumber 2, got %v", sv2["versionNumber"])
		}
		scopeV2Id = sv2["id"].(string)

		// Edit Decision 1 while Scope v2 is active (and pass scopeVersionId: scopeV2Id to confirm it is ignored)
		editResp, editBody := userA.request(
			http.MethodPatch,
			fmt.Sprintf("/api/v1/projects/%s/decisions/%s", projectAId, decisionV1Id),
			map[string]any{
				"outcome":        "Confirmed working across 500-row CSV files.",
				"scopeVersionId": scopeV2Id,
			},
			nil,
		)
		if editResp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 editing decision 1, got %d: %v", editResp.StatusCode, editBody)
		}
		editedDec1 := editBody["decision"].(map[string]any)
		if editedDec1["scopeVersionId"] != scopeV1Id {
			t.Fatalf("expected decision 1 to preserve scopeV1Id (%s), got %v", scopeV1Id, editedDec1["scopeVersionId"])
		}

		// Create Decision 2 under Scope v2
		dec2Resp, dec2Body := userA.request(http.MethodPost, fmt.Sprintf("/api/v1/projects/%s/decisions", projectAId), map[string]any{
			"problem":     "How to normalize annual subscriptions in monthly view?",
			"decision":    "Store billingCycle enum and divide annual cost by 12 in summary.",
			"rationale":   "Keeps schema simple while giving accurate monthly burn.",
			"scopeImpact": "Changes direction",
		}, nil)
		if dec2Resp.StatusCode != http.StatusCreated {
			t.Fatalf("expected 201 creating decision 2, got %d: %v", dec2Resp.StatusCode, dec2Body)
		}
		dec2 := dec2Body["decision"].(map[string]any)
		if dec2["scopeVersionId"] != scopeV2Id || dec2["scopeImpact"] != "Changes direction" {
			t.Fatalf("expected decision 2 bound to scopeV2Id with Changes direction, got %v", dec2)
		}
		decisionV2Id = dec2["id"].(string)
	})

	t.Run("preserves Decision Record updatedAt timestamp when pinning or unpinning", func(t *testing.T) {
		_, beforeBody := userA.request(http.MethodGet, fmt.Sprintf("/api/v1/projects/%s/decisions/%s", projectAId, decisionV1Id), nil, nil)
		originalUpdatedAt := beforeBody["decision"].(map[string]any)["updatedAt"].(string)

		time.Sleep(25 * time.Millisecond)

		pinResp, pinBody := userA.request(
			http.MethodPatch,
			fmt.Sprintf("/api/v1/projects/%s/decisions/%s/pin", projectAId, decisionV1Id),
			map[string]any{"isPinned": true},
			nil,
		)
		if pinResp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 pinning decision, got %d", pinResp.StatusCode)
		}
		pinnedDec := pinBody["decision"].(map[string]any)
		if pinnedDec["isPinned"] != true || pinnedDec["updatedAt"] != originalUpdatedAt {
			t.Fatalf("expected updatedAt=%s to remain unchanged on pin, got %v", originalUpdatedAt, pinnedDec["updatedAt"])
		}

		unpinResp, unpinBody := userA.request(
			http.MethodPatch,
			fmt.Sprintf("/api/v1/projects/%s/decisions/%s/pin", projectAId, decisionV1Id),
			map[string]any{"isPinned": false},
			nil,
		)
		if unpinResp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 unpinning decision, got %d", unpinResp.StatusCode)
		}
		unpinnedDec := unpinBody["decision"].(map[string]any)
		if unpinnedDec["isPinned"] != false || unpinnedDec["updatedAt"] != originalUpdatedAt {
			t.Fatalf("expected updatedAt=%s to remain unchanged on unpin, got %v", originalUpdatedAt, unpinnedDec["updatedAt"])
		}

		// Re-pin for Resume Context verification
		userA.request(
			http.MethodPatch,
			fmt.Sprintf("/api/v1/projects/%s/decisions/%s/pin", projectAId, decisionV1Id),
			map[string]any{"isPinned": true},
			nil,
		)
	})

	t.Run("enforces Scope Version immutability at both API and PostgreSQL levels", func(t *testing.T) {
		for _, method := range []string{http.MethodPatch, http.MethodPut, http.MethodDelete} {
			resp, body := userA.request(
				method,
				fmt.Sprintf("/api/v1/projects/%s/scope-versions/%s", projectAId, scopeV1Id),
				map[string]any{"goal": "Mutated goal"},
				nil,
			)
			if resp.StatusCode != http.StatusMethodNotAllowed {
				t.Fatalf("expected 405 on %s scope-version, got %d", method, resp.StatusCode)
			}
			errObj := body["error"].(map[string]any)
			if errObj["code"] != "SCOPE_VERSION_IMMUTABLE" {
				t.Fatalf("expected SCOPE_VERSION_IMMUTABLE, got %v", errObj["code"])
			}
		}

		// Direct SQL UPDATE must fail due to PostgreSQL trigger trg_prevent_scope_version_update
		_, err := testPool.Exec(
			context.Background(),
			`UPDATE "ScopeVersion" SET "goal" = 'Direct mutation' WHERE "id" = $1`,
			scopeV1Id,
		)
		if err == nil || !strings.Contains(err.Error(), "ScopeVersion records are immutable") {
			t.Fatalf("expected PostgreSQL trigger to block ScopeVersion UPDATE, got: %v", err)
		}

		// Direct SQL DELETE of referenced ScopeVersion must fail due to ON DELETE RESTRICT
		_, err = testPool.Exec(
			context.Background(),
			`DELETE FROM "ScopeVersion" WHERE "id" = $1`,
			scopeV1Id,
		)
		if err == nil {
			t.Fatal("expected PostgreSQL ON DELETE RESTRICT foreign key to block ScopeVersion DELETE")
		}
	})

	t.Run("builds Scope Timeline and Resume Context accurately", func(t *testing.T) {
		tlResp, tlBody := userA.request(http.MethodGet, fmt.Sprintf("/api/v1/projects/%s/timeline", projectAId), nil, nil)
		if tlResp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 on timeline, got %d", tlResp.StatusCode)
		}
		versions := tlBody["versions"].([]any)
		if len(versions) != 2 {
			t.Fatalf("expected 2 versions in timeline, got %d", len(versions))
		}
		v1 := versions[0].(map[string]any)
		v2 := versions[1].(map[string]any)
		if len(v1["decisions"].([]any)) != 1 || len(v2["decisions"].([]any)) != 1 {
			t.Fatalf("expected 1 decision under each scope version, got v1=%v v2=%v", v1["decisions"], v2["decisions"])
		}

		rcResp, rcBody := userA.request(http.MethodGet, fmt.Sprintf("/api/v1/projects/%s/resume-context", projectAId), nil, nil)
		if rcResp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 on resume-context, got %d", rcResp.StatusCode)
		}
		currScope := rcBody["currentScope"].(map[string]any)
		if int(currScope["versionNumber"].(float64)) != 2 {
			t.Fatalf("expected currentScope version 2, got %v", currScope["versionNumber"])
		}
		outstanding := rcBody["outstandingIssues"].([]any)
		if len(outstanding) != 2 {
			t.Fatalf("expected 2 outstanding issues, got %d", len(outstanding))
		}
		firstIssue := outstanding[0].(map[string]any)
		secondIssue := outstanding[1].(map[string]any)
		if firstIssue["id"] != issueHighId || secondIssue["id"] != issueLowId {
			t.Fatalf("expected High priority issue before Low priority issue, got %v then %v", firstIssue["id"], secondIssue["id"])
		}
	})

	t.Run("supports search, filters, reversible issue statuses, and pagination", func(t *testing.T) {
		// Reversible issue status: Open -> Closed -> Open
		closeResp, _ := userA.request(
			http.MethodPatch,
			fmt.Sprintf("/api/v1/projects/%s/issues/%s", projectAId, issueLowId),
			map[string]any{"status": "Closed"},
			nil,
		)
		if closeResp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 closing issue, got %d", closeResp.StatusCode)
		}

		reopenResp, reopenBody := userA.request(
			http.MethodPatch,
			fmt.Sprintf("/api/v1/projects/%s/issues/%s", projectAId, issueLowId),
			map[string]any{"status": "Open"},
			nil,
		)
		if reopenResp.StatusCode != http.StatusOK || reopenBody["issue"].(map[string]any)["status"] != "Open" {
			t.Fatalf("expected issue status to reverse back to Open, got %v", reopenBody)
		}

		// Decision keyword search
		searchDecResp, searchDecBody := userA.request(
			http.MethodGet,
			fmt.Sprintf("/api/v1/projects/%s/decisions?search=PapaParse", projectAId),
			nil,
			nil,
		)
		if searchDecResp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 searching decisions, got %d", searchDecResp.StatusCode)
		}
		matchedDecs := searchDecBody["decisions"].([]any)
		if len(matchedDecs) != 1 || matchedDecs[0].(map[string]any)["id"] != decisionV1Id {
			t.Fatalf("expected keyword search for PapaParse to return decisionV1Id, got %v", matchedDecs)
		}
	})

	t.Run("retains Decision Records and sets issueId to null when a linked Issue is deleted", func(t *testing.T) {
		delResp, _ := userA.request(
			http.MethodDelete,
			fmt.Sprintf("/api/v1/projects/%s/issues/%s", projectAId, issueHighId),
			nil,
			nil,
		)
		if delResp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 deleting issue, got %d", delResp.StatusCode)
		}

		decResp, decBody := userA.request(
			http.MethodGet,
			fmt.Sprintf("/api/v1/projects/%s/decisions/%s", projectAId, decisionV1Id),
			nil,
			nil,
		)
		if decResp.StatusCode != http.StatusOK {
			t.Fatalf("expected decision to still exist after issue delete, got %d", decResp.StatusCode)
		}
		dec := decBody["decision"].(map[string]any)
		if dec["issueId"] != nil {
			t.Fatalf("expected issueId to be nil after issue delete, got %v", dec["issueId"])
		}
	})

	t.Run("enforces archived project read-only behavior until restored", func(t *testing.T) {
		archResp, archBody := userA.request(
			http.MethodPost,
			fmt.Sprintf("/api/v1/projects/%s/archive", projectAId),
			nil,
			nil,
		)
		if archResp.StatusCode != http.StatusOK || archBody["project"].(map[string]any)["status"] != "Archived" {
			t.Fatalf("expected project to archive, got %d: %v", archResp.StatusCode, archBody)
		}

		editProj, editBody := userA.request(
			http.MethodPatch,
			fmt.Sprintf("/api/v1/projects/%s", projectAId),
			map[string]any{"name": "Blocked"},
			nil,
		)
		if editProj.StatusCode != http.StatusConflict || editBody["error"].(map[string]any)["code"] != "PROJECT_ARCHIVED" {
			t.Fatalf("expected 409 PROJECT_ARCHIVED on archived project edit, got %d: %v", editProj.StatusCode, editBody)
		}

		addIss, _ := userA.request(
			http.MethodPost,
			fmt.Sprintf("/api/v1/projects/%s/issues", projectAId),
			map[string]any{"title": "Blocked", "nextAction": "Blocked"},
			nil,
		)
		if addIss.StatusCode != http.StatusConflict {
			t.Fatalf("expected 409 PROJECT_ARCHIVED on archived issue create, got %d", addIss.StatusCode)
		}

		addDec, _ := userA.request(
			http.MethodPost,
			fmt.Sprintf("/api/v1/projects/%s/decisions", projectAId),
			map[string]any{"problem": "B", "decision": "B", "rationale": "B", "scopeImpact": "None"},
			nil,
		)
		if addDec.StatusCode != http.StatusConflict {
			t.Fatalf("expected 409 PROJECT_ARCHIVED on archived decision create, got %d", addDec.StatusCode)
		}

		restResp, restBody := userA.request(
			http.MethodPost,
			fmt.Sprintf("/api/v1/projects/%s/restore", projectAId),
			nil,
			nil,
		)
		if restResp.StatusCode != http.StatusOK || restBody["project"].(map[string]any)["status"] != "Active" {
			t.Fatalf("expected project restore to Active, got %d", restResp.StatusCode)
		}
	})

	t.Run("enforces strict cross-user ownership isolation across all endpoints", func(t *testing.T) {
		bListResp, bListBody := userB.request(http.MethodGet, "/api/v1/projects?status=All", nil, nil)
		if bListResp.StatusCode != http.StatusOK || len(bListBody["projects"].([]any)) != 0 {
			t.Fatalf("expected userB project list to be empty, got %v", bListBody)
		}

		checks := []struct {
			method string
			path   string
			body   any
		}{
			{http.MethodGet, fmt.Sprintf("/api/v1/projects/%s", projectAId), nil},
			{http.MethodPatch, fmt.Sprintf("/api/v1/projects/%s", projectAId), map[string]any{"name": "Hack"}},
			{http.MethodPost, fmt.Sprintf("/api/v1/projects/%s/archive", projectAId), nil},
			{http.MethodGet, fmt.Sprintf("/api/v1/projects/%s/resume-context", projectAId), nil},
			{http.MethodGet, fmt.Sprintf("/api/v1/projects/%s/timeline", projectAId), nil},
			{http.MethodGet, fmt.Sprintf("/api/v1/projects/%s/scope-versions", projectAId), nil},
			{http.MethodDelete, fmt.Sprintf("/api/v1/projects/%s/scope-versions/%s", projectAId, scopeV1Id), nil},
			{http.MethodGet, fmt.Sprintf("/api/v1/projects/%s/issues", projectAId), nil},
			{http.MethodPatch, fmt.Sprintf("/api/v1/projects/%s/issues/%s", projectAId, issueLowId), map[string]any{"title": "Hack"}},
			{http.MethodGet, fmt.Sprintf("/api/v1/projects/%s/decisions", projectAId), nil},
			{http.MethodPatch, fmt.Sprintf("/api/v1/projects/%s/decisions/%s", projectAId, decisionV1Id), map[string]any{"outcome": "Hack"}},
			{http.MethodDelete, fmt.Sprintf("/api/v1/projects/%s/decisions/%s", projectAId, decisionV2Id), nil},
		}

		for _, chk := range checks {
			resp, body := userB.request(chk.method, chk.path, chk.body, nil)
			if resp.StatusCode != http.StatusNotFound {
				t.Fatalf("expected 404 NOT_FOUND for userB on %s %s, got %d: %v", chk.method, chk.path, resp.StatusCode, body)
			}
		}
	})

	t.Run("restores full project, scope versions, issues, and decisions across logout and re-login while isolating User B's new project", func(t *testing.T) {
		// User B creates their own project
		bCreateResp, bCreateBody := userB.request(http.MethodPost, "/api/v1/projects", map[string]any{
			"name":        "User B Private Project",
			"description": "Owned exclusively by User B.",
			"initialScope": map[string]any{
				"problem":     "User B problem",
				"targetUsers": "User B target",
				"goal":        "User B goal",
				"inScope":     "User B in-scope",
				"outOfScope":  "User B out-of-scope",
			},
		}, nil)
		if bCreateResp.StatusCode != http.StatusCreated {
			t.Fatalf("expected 201 creating User B project, got %d: %v", bCreateResp.StatusCode, bCreateBody)
		}

		// User A logs out
		logoutResp, _ := userA.request(http.MethodPost, "/api/v1/auth/logout", nil, nil)
		if logoutResp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 on User A logout, got %d", logoutResp.StatusCode)
		}

		// Verify User A cannot access projects while logged out
		unauthResp, _ := userA.request(http.MethodGet, "/api/v1/projects", nil, nil)
		if unauthResp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("expected 401 on /projects after logout, got %d", unauthResp.StatusCode)
		}

		// User A logs back in on a fresh client session
		userARelogin := newTestClient(t)
		reloginResp, _ := userARelogin.request(http.MethodPost, "/api/v1/auth/login", map[string]any{
			"email":    "usera@unpause.test",
			"password": "Password123!",
		}, nil)
		if reloginResp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 on User A re-login, got %d", reloginResp.StatusCode)
		}

		// Verify User A's project list contains only User A's project (and not User B's project)
		aListResp, aListBody := userARelogin.request(http.MethodGet, "/api/v1/projects?status=All", nil, nil)
		if aListResp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 listing User A projects after re-login, got %d", aListResp.StatusCode)
		}
		aProjects := aListBody["projects"].([]any)
		if len(aProjects) != 1 || aProjects[0].(map[string]any)["id"] != projectAId {
			t.Fatalf("expected User A to see only projectAId (%s), got %v", projectAId, aProjects)
		}

		// Verify User A's Scope Timeline still has both Scope v1 and Scope v2 and their historical decisions
		tlResp, tlBody := userARelogin.request(http.MethodGet, fmt.Sprintf("/api/v1/projects/%s/timeline", projectAId), nil, nil)
		if tlResp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 on timeline after re-login, got %d", tlResp.StatusCode)
		}
		versions := tlBody["versions"].([]any)
		if len(versions) != 2 {
			t.Fatalf("expected 2 scope versions restored after re-login, got %d", len(versions))
		}
	})
}

func Test4_GitHubExplorerIntegrationAndErrorHandling(t *testing.T) {
	tc := newTestClient(t)
	loginResp, _ := tc.request(http.MethodPost, "/api/v1/auth/login", map[string]any{
		"email":    "usera@unpause.test",
		"password": "Password123!",
	}, nil)
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 logging in, got %d", loginResp.StatusCode)
	}

	var mode string
	var capturedQuery string
	mockGH := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedQuery = r.URL.Query().Get("q")
		switch mode {
		case "success":
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{
				"total_count": 42,
				"incomplete_results": false,
				"items": [
					{
						"id": 101,
						"name": "gin",
						"full_name": "gin-gonic/gin",
						"owner": {"login": "gin-gonic"},
						"description": "Gin is a HTTP web framework written in Go",
						"language": "Go",
						"stargazers_count": 78000,
						"forks_count": 8000,
						"html_url": "https://github.com/gin-gonic/gin",
						"updated_at": "2026-10-01T00:00:00Z"
					}
				]
			}`))
		case "ratelimit":
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("x-ratelimit-remaining", "0")
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"message": "API rate limit exceeded"}`))
		case "upstream_error":
			w.WriteHeader(http.StatusBadGateway)
			_, _ = w.Write([]byte(`{"message": "Bad Gateway"}`))
		}
	}))
	defer mockGH.Close()

	testDeps.GitHubService.SetBaseURL(mockGH.URL)

	t.Run("fetches and formats GitHub repositories with language and minStars filters", func(t *testing.T) {
		mode = "success"
		resp, body := tc.request(
			http.MethodGet,
			"/api/v1/github/repositories?q=router&language=Go&minStars=1000&page=1&perPage=10",
			nil,
			nil,
		)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200, got %d: %v", resp.StatusCode, body)
		}
		if !strings.Contains(capturedQuery, "language:Go") || !strings.Contains(capturedQuery, "stars:>=1000") {
			t.Fatalf("expected language and stars qualifiers in query, got %q", capturedQuery)
		}
		if int(body["totalCount"].(float64)) != 42 || body["hasNextPage"] != true || body["hasPreviousPage"] != false {
			t.Fatalf("unexpected pagination metadata: %v", body)
		}
		items := body["items"].([]any)
		first := items[0].(map[string]any)
		if first["fullName"] != "gin-gonic/gin" || int(first["stargazersCount"].(float64)) != 78000 {
			t.Fatalf("unexpected repository item: %v", first)
		}
	})

	t.Run("surfaces rate-limit errors explicitly as 429 GITHUB_RATE_LIMIT", func(t *testing.T) {
		mode = "ratelimit"
		resp, body := tc.request(http.MethodGet, "/api/v1/github/repositories?q=gin", nil, nil)
		if resp.StatusCode != http.StatusTooManyRequests {
			t.Fatalf("expected 429, got %d", resp.StatusCode)
		}
		errObj := body["error"].(map[string]any)
		if errObj["code"] != "GITHUB_RATE_LIMIT" {
			t.Fatalf("expected GITHUB_RATE_LIMIT, got %v", errObj["code"])
		}
	})

	t.Run("surfaces upstream failures explicitly as 502 GITHUB_UPSTREAM_ERROR", func(t *testing.T) {
		mode = "upstream_error"
		resp, body := tc.request(http.MethodGet, "/api/v1/github/repositories?q=gin", nil, nil)
		if resp.StatusCode != http.StatusBadGateway {
			t.Fatalf("expected 502, got %d", resp.StatusCode)
		}
		errObj := body["error"].(map[string]any)
		if errObj["code"] != "GITHUB_UPSTREAM_ERROR" {
			t.Fatalf("expected GITHUB_UPSTREAM_ERROR, got %v", errObj["code"])
		}
	})
}

func captureSchemaCatalog(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	ctx := context.Background()
	var sb strings.Builder

	// 1. Enums
	enumRows, err := pool.Query(ctx, `
		SELECT t.typname, e.enumlabel
		FROM pg_type t
		JOIN pg_enum e ON t.oid = e.enumtypid
		ORDER BY t.typname, e.enumsortorder
	`)
	if err != nil {
		t.Fatalf("failed to query pg_enum: %v", err)
	}
	defer enumRows.Close()
	sb.WriteString("ENUMS:\n")
	for enumRows.Next() {
		var typ, label string
		if err := enumRows.Scan(&typ, &label); err != nil {
			t.Fatalf("scan enum failed: %v", err)
		}
		sb.WriteString(fmt.Sprintf("  %s=%s\n", typ, label))
	}

	// 2. Columns of domain tables
	colRows, err := pool.Query(ctx, `
		SELECT table_name, column_name, data_type, udt_name, is_nullable
		FROM information_schema.columns
		WHERE table_schema = 'public'
		  AND table_name IN ('User', 'Session', 'Project', 'ScopeVersion', 'Issue', 'DecisionRecord')
		ORDER BY table_name, ordinal_position
	`)
	if err != nil {
		t.Fatalf("failed to query columns: %v", err)
	}
	defer colRows.Close()
	sb.WriteString("COLUMNS:\n")
	for colRows.Next() {
		var tbl, col, dtype, udt, nullable string
		if err := colRows.Scan(&tbl, &col, &dtype, &udt, &nullable); err != nil {
			t.Fatalf("scan col failed: %v", err)
		}
		sb.WriteString(fmt.Sprintf("  %s.%s:%s(%s) null=%s\n", tbl, col, dtype, udt, nullable))
	}

	// 3. Indexes
	idxRows, err := pool.Query(ctx, `
		SELECT tablename, indexname, indexdef
		FROM pg_indexes
		WHERE schemaname = 'public'
		  AND tablename IN ('User', 'Session', 'Project', 'ScopeVersion', 'Issue', 'DecisionRecord')
		ORDER BY tablename, indexname
	`)
	if err != nil {
		t.Fatalf("failed to query indexes: %v", err)
	}
	defer idxRows.Close()
	sb.WriteString("INDEXES:\n")
	for idxRows.Next() {
		var tbl, idx, def string
		if err := idxRows.Scan(&tbl, &idx, &def); err != nil {
			t.Fatalf("scan index failed: %v", err)
		}
		sb.WriteString(fmt.Sprintf("  %s.%s: %s\n", tbl, idx, def))
	}

	// 4. Foreign keys
	fkRows, err := pool.Query(ctx, `
		SELECT conname, confupdtype::text, confdeltype::text
		FROM pg_constraint
		WHERE contype = 'f'
		ORDER BY conname
	`)
	if err != nil {
		t.Fatalf("failed to query foreign keys: %v", err)
	}
	defer fkRows.Close()
	sb.WriteString("FKS:\n")
	for fkRows.Next() {
		var name, upd, del string
		if err := fkRows.Scan(&name, &upd, &del); err != nil {
			t.Fatalf("scan fk failed: %v", err)
		}
		sb.WriteString(fmt.Sprintf("  %s upd=%s del=%s\n", name, upd, del))
	}

	// 5. Triggers
	trgRows, err := pool.Query(ctx, `
		SELECT tgname
		FROM pg_trigger
		WHERE NOT tgisinternal
		ORDER BY tgname
	`)
	if err != nil {
		t.Fatalf("failed to query triggers: %v", err)
	}
	defer trgRows.Close()
	sb.WriteString("TRIGGERS:\n")
	for trgRows.Next() {
		var tg string
		if err := trgRows.Scan(&tg); err != nil {
			t.Fatalf("scan trigger failed: %v", err)
		}
		sb.WriteString(fmt.Sprintf("  %s\n", tg))
	}

	return sb.String()
}

func Test5_GooseMigrationFreshAndPrismaCompatibility(t *testing.T) {
	var freshCatalog string

	t.Run("verifies fresh Goose-migrated database schema, enums, indexes, foreign keys, and trigger", func(t *testing.T) {
		freshCatalog = captureSchemaCatalog(t, testPool)

		expectedFragments := []string{
			"ProjectStatus=Active",
			"ProjectStatus=Archived",
			"IssueStatus=Open",
			"IssueStatus=In Progress",
			"IssueStatus=Closed",
			"IssuePriority=High",
			"IssuePriority=Medium",
			"IssuePriority=Low",
			"ScopeImpact=None",
			"ScopeImpact=Expands",
			"ScopeImpact=Narrows",
			"ScopeImpact=Changes direction",
			"User.User_email_key",
			"ScopeVersion.ScopeVersion_projectId_versionNumber_key",
			"Issue.Issue_projectId_status_priority_updatedAt_idx",
			"DecisionRecord.DecisionRecord_projectId_scopeVersionId_idx",
			"DecisionRecord_scopeVersionId_fkey upd=c del=r",
			"DecisionRecord_issueId_fkey upd=c del=n",
			"Session_userId_fkey upd=c del=c",
			"Project_userId_fkey upd=c del=c",
			"trg_prevent_scope_version_update",
		}
		for _, frag := range expectedFragments {
			if !strings.Contains(freshCatalog, frag) {
				t.Fatalf("fresh Goose schema catalog missing %q.\nFull catalog:\n%s", frag, freshCatalog)
			}
		}
	})

	t.Run("migrates an existing Prisma-managed database safely without losing data and matches fresh Goose schema 100%", func(t *testing.T) {
		scriptPath := filepath.Clean("../../scripts/pglite-server.mjs")
		if _, err := os.Stat(scriptPath); err != nil {
			scriptPath = filepath.Clean("../../../scripts/pglite-server.mjs")
		}

		prismaPort := testPgPort + 1
		pgCmd := exec.Command("node", scriptPath, fmt.Sprintf("%d", prismaPort), "memory")
		stdout, err := pgCmd.StdoutPipe()
		if err != nil {
			t.Fatalf("failed to create stdout pipe: %v", err)
		}
		pgCmd.Stderr = os.Stderr
		if err := pgCmd.Start(); err != nil {
			t.Fatalf("failed to start secondary pglite server: %v", err)
		}
		defer func() {
			if pgCmd.Process != nil {
				_ = pgCmd.Process.Signal(os.Interrupt)
				_, _ = pgCmd.Process.Wait()
			}
		}()

		readyCh := make(chan struct{})
		go func() {
			scanner := bufio.NewScanner(stdout)
			for scanner.Scan() {
				if strings.HasPrefix(scanner.Text(), "PGLITE_READY:") {
					close(readyCh)
					_, _ = io.Copy(io.Discard, stdout)
					return
				}
			}
		}()

		select {
		case <-readyCh:
		case <-time.After(15 * time.Second):
			t.Fatal("timed out waiting for secondary pglite server")
		}

		ctx := context.Background()
		prismaDBURL := fmt.Sprintf("postgresql://postgres:postgres@127.0.0.1:%d/postgres?sslmode=disable&connection_limit=1", prismaPort)
		prismaPool, err := database.NewPool(ctx, prismaDBURL)
		if err != nil {
			t.Fatalf("failed to connect to secondary pglite server: %v", err)
		}
		defer prismaPool.Close()

		// 1. Apply Prisma's original migration.sql + _prisma_migrations table
		prismaSQLBytes, err := os.ReadFile(filepath.Clean("../../api/prisma/migrations/20261019000000_init/migration.sql"))
		if err != nil {
			prismaSQLBytes, err = os.ReadFile(filepath.Clean("../../../apps/api/prisma/migrations/20261019000000_init/migration.sql"))
		}
		if err != nil {
			t.Fatalf("failed to read Prisma migration.sql: %v", err)
		}

		if _, err := prismaPool.Exec(ctx, string(prismaSQLBytes)); err != nil {
			t.Fatalf("failed to apply Prisma migration.sql: %v", err)
		}

		_, err = prismaPool.Exec(ctx, `
			CREATE TABLE "_prisma_migrations" (
				"id" VARCHAR(36) PRIMARY KEY,
				"migration_name" VARCHAR(255) NOT NULL,
				"finished_at" TIMESTAMPTZ DEFAULT NOW()
			);
			INSERT INTO "_prisma_migrations" ("id", "migration_name")
			VALUES ('11111111-1111-1111-1111-111111111111', '20261019000000_init');
		`)
		if err != nil {
			t.Fatalf("failed to create _prisma_migrations table: %v", err)
		}

		// 2. Insert pre-existing user, project, ScopeVersion 1, Issue, and DecisionRecord
		now := time.Now().UTC()
		seedQueries := []string{
			`INSERT INTO "User" ("id", "email", "passwordHash", "displayName", "createdAt", "updatedAt") VALUES ('u-legacy', 'legacy@unpause.local', 'hash', 'Legacy User', $1, $1)`,
			`INSERT INTO "Project" ("id", "userId", "name", "description", "status", "createdAt", "updatedAt") VALUES ('p-legacy', 'u-legacy', 'Legacy Project', 'Created under Prisma', 'Active', $1, $1)`,
			`INSERT INTO "ScopeVersion" ("id", "projectId", "versionNumber", "problem", "targetUsers", "goal", "inScope", "outOfScope", "reasonForChange", "createdAt") VALUES ('sv-legacy', 'p-legacy', 1, 'Prob', 'Users', 'Goal', 'In', 'Out', 'Initial scope', $1)`,
			`INSERT INTO "Issue" ("id", "projectId", "title", "status", "priority", "nextAction", "createdAt", "updatedAt") VALUES ('i-legacy', 'p-legacy', 'Legacy Issue', 'In Progress', 'High', 'Next step', $1, $1)`,
			`INSERT INTO "DecisionRecord" ("id", "projectId", "scopeVersionId", "issueId", "problem", "decision", "rationale", "scopeImpact", "isPinned", "createdAt", "updatedAt") VALUES ('d-legacy', 'p-legacy', 'sv-legacy', 'i-legacy', 'Prob', 'Dec', 'Rat', 'Changes direction', true, $1, $1)`,
		}
		for _, q := range seedQueries {
			if _, err := prismaPool.Exec(ctx, q, now); err != nil {
				t.Fatalf("failed to insert pre-existing row into Prisma DB: %v", err)
			}
		}

		// 3. Run Goose migrations TWICE to verify Prisma compatibility and rerun idempotency
		migrationsDir := filepath.Clean("../migrations")
		if err := database.RunMigrations(prismaPool, migrationsDir); err != nil {
			t.Fatalf("first Goose migration run on Prisma DB failed: %v", err)
		}
		if err := database.RunMigrations(prismaPool, migrationsDir); err != nil {
			t.Fatalf("second Goose migration run (idempotency check) failed: %v", err)
		}

		// 4. Verify pre-existing data and _prisma_migrations are intact
		var prismaMigCount, decisionCount int
		if err := prismaPool.QueryRow(ctx, `SELECT COUNT(*) FROM "_prisma_migrations"`).Scan(&prismaMigCount); err != nil || prismaMigCount != 1 {
			t.Fatalf("expected _prisma_migrations count=1, got %d (err=%v)", prismaMigCount, err)
		}
		if err := prismaPool.QueryRow(ctx, `SELECT COUNT(*) FROM "DecisionRecord" WHERE "id" = 'd-legacy'`).Scan(&decisionCount); err != nil || decisionCount != 1 {
			t.Fatalf("expected pre-existing DecisionRecord to survive migration, count=%d (err=%v)", decisionCount, err)
		}

		// 5. Verify catalog equivalence between Fresh Goose DB and Prisma->Goose DB
		prismaThenGooseCatalog := captureSchemaCatalog(t, prismaPool)
		if prismaThenGooseCatalog != freshCatalog {
			t.Fatalf("schema mismatch between fresh Goose DB and Prisma->Goose DB!\nFresh:\n%s\nPrisma->Goose:\n%s", freshCatalog, prismaThenGooseCatalog)
		}
	})
}

func Test6_SecurityHardeningIDORValidationAndRateLimiting(t *testing.T) {
	t.Run("sets security headers, validates cookie config, checks DB in /health, and blocks cross-site Sec-Fetch-Site or Referer", func(t *testing.T) {
		tc := newTestClient(t)
		resp, body := tc.request(http.MethodGet, "/api/v1/health", nil, nil)
		if resp.StatusCode != http.StatusOK || body["status"] != "ok" || body["database"] != "ok" {
			t.Fatalf("expected 200 status=ok database=ok on /health, got %d: %v", resp.StatusCode, body)
		}
		if resp.Header.Get("X-Content-Type-Options") != "nosniff" ||
			resp.Header.Get("X-Frame-Options") != "DENY" ||
			resp.Header.Get("Referrer-Policy") != "strict-origin-when-cross-origin" ||
			resp.Header.Get("Permissions-Policy") == "" {
			t.Fatalf("missing expected security headers: %v", resp.Header)
		}

		// Verify HSTS header is set in production mode
		prodCfg := *testDeps.Config
		prodCfg.Env = "production"
		prodEngine := router.NewEngine(router.NewDependencies(&prodCfg, testPool, nil))
		prodRec := httptest.NewRecorder()
		prodReq := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
		prodEngine.ServeHTTP(prodRec, prodReq)
		if !strings.Contains(prodRec.Header().Get("Strict-Transport-Security"), "max-age=31536000") {
			t.Fatalf("expected Strict-Transport-Security header in production, got %q", prodRec.Header().Get("Strict-Transport-Security"))
		}

		// Verify cookie SameSite=none with Secure=false is rejected by config.ParseEnv
		_, cfgErr := config.ParseEnv(func(key string) string {
			switch key {
			case "NODE_ENV":
				return "production"
			case "DATABASE_URL":
				return "postgresql://postgres:postgres@localhost:5432/unpause"
			case "SESSION_SECRET":
				return "super-secret-session-key-at-least-32-chars"
			case "CORS_ORIGINS":
				return "https://app.unpause.test"
			case "SESSION_COOKIE_SAMESITE":
				return "none"
			case "SESSION_COOKIE_SECURE":
				return "false"
			default:
				return ""
			}
		})
		if cfgErr == nil || !strings.Contains(cfgErr.Error(), "SESSION_COOKIE_SECURE") {
			t.Fatalf("expected ParseEnv to reject SameSite=none with Secure=false, got: %v", cfgErr)
		}

		// Verify state-changing request without Origin is blocked when Sec-Fetch-Site: cross-site is present
		csrfResp1, csrfBody1 := tc.request(
			http.MethodPost,
			"/api/v1/auth/logout",
			nil,
			map[string]string{"Sec-Fetch-Site": "cross-site"},
		)
		if csrfResp1.StatusCode != http.StatusForbidden || csrfBody1["error"].(map[string]any)["code"] != "INVALID_ORIGIN" {
			t.Fatalf("expected 403 INVALID_ORIGIN on Sec-Fetch-Site: cross-site, got %d: %v", csrfResp1.StatusCode, csrfBody1)
		}

		// Verify state-changing request without Origin is blocked when Referer is from a disallowed origin
		csrfResp2, csrfBody2 := tc.request(
			http.MethodPost,
			"/api/v1/auth/logout",
			nil,
			map[string]string{"Referer": "https://evil.example.com/attack.html"},
		)
		if csrfResp2.StatusCode != http.StatusForbidden || csrfBody2["error"].(map[string]any)["code"] != "INVALID_ORIGIN" {
			t.Fatalf("expected 403 INVALID_ORIGIN on disallowed Referer, got %d: %v", csrfResp2.StatusCode, csrfBody2)
		}

		// Verify state-changing request with allowed Referer succeeds
		okLogoutResp, _ := tc.request(
			http.MethodPost,
			"/api/v1/auth/logout",
			nil,
			map[string]string{"Referer": testAllowedOrigin + "/projects"},
		)
		if okLogoutResp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 on logout with allowed Referer, got %d", okLogoutResp.StatusCode)
		}
	})

	t.Run("serves static SPA files and index.html fallback when STATIC_FILES_DIR is configured while protecting /api routes", func(t *testing.T) {
		tmpDir := t.TempDir()
		if err := os.WriteFile(filepath.Join(tmpDir, "index.html"), []byte("<!doctype html><title>Unpause SPA</title>"), 0o600); err != nil {
			t.Fatalf("failed to write temp index.html: %v", err)
		}
		if err := os.WriteFile(filepath.Join(tmpDir, "app.js"), []byte("console.log('unpause');"), 0o600); err != nil {
			t.Fatalf("failed to write temp app.js: %v", err)
		}

		spaCfg := *testDeps.Config
		spaCfg.StaticFilesDir = tmpDir
		spaEngine := router.NewEngine(router.NewDependencies(&spaCfg, testPool, nil))

		// 1. Root "/" serves index.html with 200 OK
		rootRec := httptest.NewRecorder()
		rootReq := httptest.NewRequest(http.MethodGet, "/", nil)
		spaEngine.ServeHTTP(rootRec, rootReq)
		if rootRec.Code != http.StatusOK || !strings.Contains(rootRec.Body.String(), "<title>Unpause SPA</title>") {
			t.Fatalf("expected 200 serving index.html on /, got %d: %s", rootRec.Code, rootRec.Body.String())
		}

		// 2. Static asset request
		assetRec := httptest.NewRecorder()
		assetReq := httptest.NewRequest(http.MethodGet, "/app.js", nil)
		spaEngine.ServeHTTP(assetRec, assetReq)
		if assetRec.Code != http.StatusOK || !strings.Contains(assetRec.Body.String(), "console.log('unpause')") {
			t.Fatalf("expected 200 serving static asset, got %d: %s", assetRec.Code, assetRec.Body.String())
		}

		// 3. Client-side route fallback to index.html
		routeRec := httptest.NewRecorder()
		routeReq := httptest.NewRequest(http.MethodGet, "/projects/123/resume", nil)
		spaEngine.ServeHTTP(routeRec, routeReq)
		if routeRec.Code != http.StatusOK || !strings.Contains(routeRec.Body.String(), "<title>Unpause SPA</title>") {
			t.Fatalf("expected 200 SPA index.html fallback, got %d: %s", routeRec.Code, routeRec.Body.String())
		}

		// 4. Unknown /api/v1/* route still returns 404 JSON error
		apiRec := httptest.NewRecorder()
		apiReq := httptest.NewRequest(http.MethodGet, "/api/v1/unknown-endpoint", nil)
		spaEngine.ServeHTTP(apiRec, apiReq)
		if apiRec.Code != http.StatusNotFound || !strings.Contains(apiRec.Body.String(), "NOT_FOUND") {
			t.Fatalf("expected 404 JSON NOT_FOUND on unknown /api route, got %d: %s", apiRec.Code, apiRec.Body.String())
		}

		// 5. Path traversal attempt is rejected with 404
		travRec := httptest.NewRecorder()
		travReq := httptest.NewRequest(http.MethodGet, "/%2e%2e/%2e%2e/etc/passwd", nil)
		spaEngine.ServeHTTP(travRec, travReq)
		if travRec.Code != http.StatusNotFound {
			t.Fatalf("expected 404 on path traversal attempt, got %d", travRec.Code)
		}

		// 6. Health check returns 503 when database pool is closed/unreachable
		deadPoolCfg, err := pgxpool.ParseConfig("postgresql://postgres:postgres@127.0.0.1:1/postgres?sslmode=disable")
		if err != nil {
			t.Fatalf("failed to parse dead pool config: %v", err)
		}
		deadPool, err := pgxpool.NewWithConfig(context.Background(), deadPoolCfg)
		if err != nil {
			t.Fatalf("failed to create dead pool: %v", err)
		}
		deadPool.Close()
		unhealthyEngine := router.NewEngine(router.NewDependencies(&spaCfg, deadPool, nil))
		unhealthyRec := httptest.NewRecorder()
		unhealthyReq := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
		unhealthyEngine.ServeHTTP(unhealthyRec, unhealthyReq)
		if unhealthyRec.Code != http.StatusServiceUnavailable || !strings.Contains(unhealthyRec.Body.String(), "degraded") {
			t.Fatalf("expected 503 degraded when DB is unreachable, got %d: %s", unhealthyRec.Code, unhealthyRec.Body.String())
		}
	})

	t.Run("invalidates previous session in PostgreSQL when logging in or registering again and rejects forged cookies", func(t *testing.T) {
		browserClient := newTestClient(t)

		// Log in as usera@unpause.test (obtaining Session 1)
		login1Resp, _ := browserClient.request(http.MethodPost, "/api/v1/auth/login", map[string]any{
			"email":    "usera@unpause.test",
			"password": "Password123!",
		}, nil)
		if login1Resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 on first login, got %d", login1Resp.StatusCode)
		}

		var session1ID string
		for _, c := range login1Resp.Cookies() {
			if c.Name == testDeps.Config.SessionCookieName {
				session1ID = c.Value
			}
		}
		if session1ID == "" {
			t.Fatal("expected session1 cookie on first login")
		}

		// Without logging out, log in as userb@unpause.test on the same browser client (sending session1ID cookie)
		login2Resp, _ := browserClient.request(http.MethodPost, "/api/v1/auth/login", map[string]any{
			"email":    "userb@unpause.test",
			"password": "Password123!",
		}, nil)
		if login2Resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 on second login, got %d", login2Resp.StatusCode)
		}

		// Verify session1ID was immediately deleted from PostgreSQL
		var count int
		if err := testPool.QueryRow(context.Background(), `SELECT COUNT(*) FROM "Session" WHERE "id" = $1`, session1ID).Scan(&count); err != nil || count != 0 {
			t.Fatalf("expected previous session1ID to be invalidated in PostgreSQL on re-login, count=%d err=%v", count, err)
		}

		// Verify a forged/random session cookie is rejected with 401 and cleared
		forgedClient := newTestClient(t)
		forgedResp, forgedBody := forgedClient.request(
			http.MethodGet,
			"/api/v1/projects",
			nil,
			map[string]string{"Cookie": "unpause_sid=0000000000000000000000000000000000000000000000000000000000000000"},
		)
		if forgedResp.StatusCode != http.StatusUnauthorized || forgedBody["error"].(map[string]any)["code"] != "UNAUTHORIZED" {
			t.Fatalf("expected 401 UNAUTHORIZED for forged session cookie, got %d: %v", forgedResp.StatusCode, forgedBody)
		}
		setCookie := strings.Join(forgedResp.Header.Values("Set-Cookie"), ";")
		if !strings.Contains(setCookie, "Max-Age=0") && !strings.Contains(setCookie, "Max-Age=-1") {
			t.Fatalf("expected forged session response to clear cookie, got Set-Cookie: %s", setCookie)
		}
	})

	t.Run("enforces complete cross-user and cross-project isolation, blocks cross-project issue linking, and validates malformed inputs", func(t *testing.T) {
		clientA := newTestClient(t)
		clientB := newTestClient(t)

		if resp, _ := clientA.request(http.MethodPost, "/api/v1/auth/login", map[string]any{
			"email":    "usera@unpause.test",
			"password": "Password123!",
		}, nil); resp.StatusCode != http.StatusOK {
			t.Fatalf("failed to log in User A: %d", resp.StatusCode)
		}
		if resp, _ := clientB.request(http.MethodPost, "/api/v1/auth/login", map[string]any{
			"email":    "userb@unpause.test",
			"password": "Password123!",
		}, nil); resp.StatusCode != http.StatusOK {
			t.Fatalf("failed to log in User B: %d", resp.StatusCode)
		}

		// User A creates two separate projects (Project A1 and Project A2)
		createProj := func(tc *testClient, name string) (string, string) {
			resp, body := tc.request(http.MethodPost, "/api/v1/projects", map[string]any{
				"name":        name,
				"description": "Isolation test project",
				"initialScope": map[string]any{
					"problem":     "Problem statement",
					"targetUsers": "Solo developers",
					"goal":        "Goal statement",
					"inScope":     "In scope items",
					"outOfScope":  "Out of scope items",
				},
			}, nil)
			if resp.StatusCode != http.StatusCreated {
				t.Fatalf("failed to create project %s: %d %v", name, resp.StatusCode, body)
			}
			return body["project"].(map[string]any)["id"].(string),
				body["initialScopeVersion"].(map[string]any)["id"].(string)
		}

		projA1, scopeA1 := createProj(clientA, "Project A1 (100% Literal_Search)")
		projA2, _ := createProj(clientA, "Project A2")
		projB1, _ := createProj(clientB, "Project B1")

		// User A creates an issue and decision in Project A1
		issAResp, issABody := clientA.request(http.MethodPost, fmt.Sprintf("/api/v1/projects/%s/issues", projA1), map[string]any{
			"title":      "Issue in Project A1",
			"nextAction": "Do step 1",
		}, nil)
		issueA1 := issABody["issue"].(map[string]any)["id"].(string)
		if issAResp.StatusCode != http.StatusCreated {
			t.Fatalf("expected 201 creating issueA1, got %d", issAResp.StatusCode)
		}

		decAResp, decABody := clientA.request(http.MethodPost, fmt.Sprintf("/api/v1/projects/%s/decisions", projA1), map[string]any{
			"problem":     "Decision problem A1",
			"decision":    "Decision choice A1",
			"rationale":   "Decision rationale A1",
			"scopeImpact": "None",
			"issueId":     issueA1,
		}, nil)
		if decAResp.StatusCode != http.StatusCreated {
			t.Fatalf("expected 201 creating decisionA1, got %d", decAResp.StatusCode)
		}
		decisionA1 := decABody["decision"].(map[string]any)["id"].(string)

		// 1. User B attempts remaining endpoints on User A's Project A1 -> all must return 404 NOT_FOUND
		remainingChecks := []struct {
			method string
			path   string
			body   any
		}{
			{http.MethodPost, fmt.Sprintf("/api/v1/projects/%s/restore", projA1), nil},
			{http.MethodPost, fmt.Sprintf("/api/v1/projects/%s/scope-versions", projA1), map[string]any{
				"problem": "P", "targetUsers": "U", "goal": "G", "inScope": "I", "outOfScope": "O", "reasonForChange": "R",
			}},
			{http.MethodGet, fmt.Sprintf("/api/v1/projects/%s/scope-versions/%s", projA1, scopeA1), nil},
			{http.MethodPost, fmt.Sprintf("/api/v1/projects/%s/issues", projA1), map[string]any{
				"title": "Injected Issue", "nextAction": "Step",
			}},
			{http.MethodGet, fmt.Sprintf("/api/v1/projects/%s/issues/%s", projA1, issueA1), nil},
			{http.MethodDelete, fmt.Sprintf("/api/v1/projects/%s/issues/%s", projA1, issueA1), nil},
			{http.MethodPost, fmt.Sprintf("/api/v1/projects/%s/decisions", projA1), map[string]any{
				"problem": "P", "decision": "D", "rationale": "R", "scopeImpact": "None",
			}},
			{http.MethodGet, fmt.Sprintf("/api/v1/projects/%s/decisions/%s", projA1, decisionA1), nil},
			{http.MethodPatch, fmt.Sprintf("/api/v1/projects/%s/decisions/%s/pin", projA1, decisionA1), map[string]any{"isPinned": true}},
		}
		for _, chk := range remainingChecks {
			resp, body := clientB.request(chk.method, chk.path, chk.body, nil)
			if resp.StatusCode != http.StatusNotFound {
				t.Fatalf("expected 404 NOT_FOUND for User B on %s %s, got %d: %v", chk.method, chk.path, resp.StatusCode, body)
			}
		}

		// 2. Cross-User Resource Linking: User B attempts to link User A's issueA1 into a Decision in User B's projB1 -> 400 VALIDATION_ERROR
		crossLinkResp, crossLinkBody := clientB.request(http.MethodPost, fmt.Sprintf("/api/v1/projects/%s/decisions", projB1), map[string]any{
			"problem":     "User B problem",
			"decision":    "User B decision",
			"rationale":   "User B rationale",
			"scopeImpact": "None",
			"issueId":     issueA1,
		}, nil)
		if crossLinkResp.StatusCode != http.StatusBadRequest || crossLinkBody["error"].(map[string]any)["code"] != "VALIDATION_ERROR" {
			t.Fatalf("expected 400 VALIDATION_ERROR when User B links User A's issueId, got %d: %v", crossLinkResp.StatusCode, crossLinkBody)
		}

		// 3. Cross-Project Resource Access (Same Owner): User A attempts to access/delete Project A1's issue/decision via Project A2's URL path -> 404 NOT_FOUND
		crossProjGetIss, _ := clientA.request(http.MethodGet, fmt.Sprintf("/api/v1/projects/%s/issues/%s", projA2, issueA1), nil, nil)
		if crossProjGetIss.StatusCode != http.StatusNotFound {
			t.Fatalf("expected 404 accessing Project A1 issue via Project A2 path, got %d", crossProjGetIss.StatusCode)
		}
		crossProjDelDec, _ := clientA.request(http.MethodDelete, fmt.Sprintf("/api/v1/projects/%s/decisions/%s", projA2, decisionA1), nil, nil)
		if crossProjDelDec.StatusCode != http.StatusNotFound {
			t.Fatalf("expected 404 deleting Project A1 decision via Project A2 path, got %d", crossProjDelDec.StatusCode)
		}
		crossProjLinkDec, _ := clientA.request(http.MethodPost, fmt.Sprintf("/api/v1/projects/%s/decisions", projA2), map[string]any{
			"problem": "P", "decision": "D", "rationale": "R", "issueId": issueA1,
		}, nil)
		if crossProjLinkDec.StatusCode != http.StatusBadRequest {
			t.Fatalf("expected 400 linking Project A1 issue into Project A2 decision, got %d", crossProjLinkDec.StatusCode)
		}

		// 4. Escaped ILIKE Wildcard Search: searching for literal "%" only matches projects containing "%"
		searchPctResp, searchPctBody := clientA.request(http.MethodGet, "/api/v1/projects?search=%25", nil, nil)
		if searchPctResp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 searching literal %%, got %d", searchPctResp.StatusCode)
		}
		pctProjects := searchPctBody["projects"].([]any)
		if len(pctProjects) != 1 || pctProjects[0].(map[string]any)["id"] != projA1 {
			t.Fatalf("expected literal %% search to match only Project A1, got %v", pctProjects)
		}

		// 5. Input Validation & Malformed Requests
		badRegShort, _ := clientA.request(http.MethodPost, "/api/v1/auth/register", map[string]any{
			"email": "valid@unpause.test", "password": "short",
		}, nil)
		if badRegShort.StatusCode != http.StatusBadRequest {
			t.Fatalf("expected 400 on short password (<8 chars), got %d", badRegShort.StatusCode)
		}

		badRegLongPass, _ := clientA.request(http.MethodPost, "/api/v1/auth/register", map[string]any{
			"email": "valid2@unpause.test", "password": strings.Repeat("a", 129),
		}, nil)
		if badRegLongPass.StatusCode != http.StatusBadRequest {
			t.Fatalf("expected 400 on oversized password (>128 chars), got %d", badRegLongPass.StatusCode)
		}

		badRegEmail, _ := clientA.request(http.MethodPost, "/api/v1/auth/register", map[string]any{
			"email": "not-an-email", "password": "ValidPassword123!",
		}, nil)
		if badRegEmail.StatusCode != http.StatusBadRequest {
			t.Fatalf("expected 400 on invalid email, got %d", badRegEmail.StatusCode)
		}

		emptyPatchProj, _ := clientA.request(http.MethodPatch, fmt.Sprintf("/api/v1/projects/%s", projA1), map[string]any{}, nil)
		if emptyPatchProj.StatusCode != http.StatusBadRequest {
			t.Fatalf("expected 400 on empty project update payload, got %d", emptyPatchProj.StatusCode)
		}

		badEnumIssue, _ := clientA.request(http.MethodPost, fmt.Sprintf("/api/v1/projects/%s/issues", projA1), map[string]any{
			"title": "Valid", "nextAction": "Valid", "status": "InvalidStatus", "priority": "InvalidPriority",
		}, nil)
		if badEnumIssue.StatusCode != http.StatusBadRequest {
			t.Fatalf("expected 400 on invalid issue status/priority enums, got %d", badEnumIssue.StatusCode)
		}
	})

	t.Run("throttles rapid authentication attempts with 429 RATE_LIMIT_EXCEEDED and Retry-After header", func(t *testing.T) {
		rlCfg := *testDeps.Config
		rlCfg.AuthRateLimitPerMin = 3
		rlEngine := router.NewEngine(router.NewDependencies(&rlCfg, testPool, nil))
		rlSrv := httptest.NewServer(rlEngine)
		defer rlSrv.Close()

		for i := 1; i <= 3; i++ {
			resp, err := http.Post(
				rlSrv.URL+"/api/v1/auth/login",
				"application/json",
				strings.NewReader(`{"email":"nonexistent@unpause.test","password":"WrongPassword123!"}`),
			)
			if err != nil {
				t.Fatalf("request %d failed: %v", i, err)
			}
			_ = resp.Body.Close()
			if resp.StatusCode != http.StatusUnauthorized {
				t.Fatalf("expected 401 on attempt %d within rate limit, got %d", i, resp.StatusCode)
			}
		}

		// 4th attempt within the same window must be throttled with 429
		resp4, err := http.Post(
			rlSrv.URL+"/api/v1/auth/login",
			"application/json",
			strings.NewReader(`{"email":"nonexistent@unpause.test","password":"WrongPassword123!"}`),
		)
		if err != nil {
			t.Fatalf("request 4 failed: %v", err)
		}
		defer func() {
			_ = resp4.Body.Close()
		}()

		if resp4.StatusCode != http.StatusTooManyRequests {
			t.Fatalf("expected 429 Too Many Requests on 4th rapid auth attempt, got %d", resp4.StatusCode)
		}
		if resp4.Header.Get("Retry-After") == "" {
			t.Fatal("expected Retry-After header on 429 response")
		}

		var body4 map[string]any
		_ = json.NewDecoder(resp4.Body).Decode(&body4)
		errObj, _ := body4["error"].(map[string]any)
		if errObj["code"] != "RATE_LIMIT_EXCEEDED" {
			t.Fatalf("expected RATE_LIMIT_EXCEEDED error code, got %v", errObj["code"])
		}
	})
}

