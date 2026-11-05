package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/westride/unpause/api-go/internal/continuity"
	"github.com/westride/unpause/api-go/internal/http/router"
)

// A small per-query delay models a database in a different region. A full
// recovery window must finish within the service's existing bounded deadline.
type continuityQueryLatency struct{}

func (continuityQueryLatency) TraceQueryStart(ctx context.Context, _ *pgx.Conn, _ pgx.TraceQueryStartData) context.Context {
	select {
	case <-time.After(40 * time.Millisecond):
	case <-ctx.Done():
	}
	return ctx
}
func (continuityQueryLatency) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

func TestGitHubContinuity(t *testing.T) {
	ctx := context.Background()
	history := []string{strings.Repeat("a", 40)}
	unavailable := false
	repositoryID := int64(4242)
	coreLimited := false
	searchFullName := "solo/demo"
	searchPrivate := false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			t.Error("public continuity request leaked an authorization token")
		}
		if unavailable {
			w.WriteHeader(503)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/search/repositories" {
			if r.URL.Query().Get("q") != "repo:solo/demo is:public" || r.URL.Query().Get("per_page") != "1" {
				t.Error("unbounded or unsafe repository fallback search")
			}
			json.NewEncoder(w).Encode(map[string]any{"items": []any{map[string]any{"id": repositoryID, "full_name": searchFullName, "default_branch": "main", "private": searchPrivate, "visibility": "public"}}})
			return
		}
		if r.URL.Path == "/repos/solo/demo" {
			if coreLimited {
				w.Header().Set("X-RateLimit-Remaining", "0")
				w.Header().Set("X-RateLimit-Reset", "2000000000")
				w.WriteHeader(403)
				return
			}
			json.NewEncoder(w).Encode(map[string]any{"id": repositoryID, "full_name": "solo/demo", "default_branch": "main", "private": false, "visibility": "public"})
			return
		}
		if r.URL.Path == "/repos/solo/demo/commits" {
			if r.URL.Query().Get("sha") != "main" || r.URL.Query().Get("per_page") != "100" {
				t.Error("recovery was not bounded to configured branch")
			}
			commits := []any{}
			for _, sha := range history {
				commits = append(commits, map[string]any{"sha": sha, "commit": map[string]any{"message": "Recovered change", "author": map[string]any{"name": "Dev", "date": "2026-01-01T00:00:00Z"}}})
			}
			json.NewEncoder(w).Encode(commits)
			return
		}
		w.WriteHeader(404)
	}))
	defer upstream.Close()
	previous := testDeps.ContinuityService
	testDeps.ContinuityService = continuity.NewService(testPool, upstream.URL, nil)
	// Existing server's handler has a captured service; use a separate router with same DB.
	defer func() { testDeps.ContinuityService = previous }()
	// Construct isolated service for direct recovery checks, and a full HTTP engine below.
	svc := testDeps.ContinuityService
	owner := newTestClient(t)
	other := newTestClient(t)
	register := func(c *testClient, email string) {
		r, b := c.request("POST", "/api/v1/auth/register", map[string]any{"email": email, "password": "Password123!"}, nil)
		if r.StatusCode != 201 {
			t.Fatalf("register: %d %v", r.StatusCode, b)
		}
	}
	register(owner, "continuity-owner@unpause.test")
	register(other, "continuity-other@unpause.test")
	project := func(name string) string {
		r, b := owner.request("POST", "/api/v1/projects", map[string]any{"name": name, "initialScope": map[string]any{"problem": "Resume safely", "targetUsers": "Solo developers", "goal": "Keep authored context", "inScope": "Public repo", "outOfScope": "Private repo"}}, nil)
		if r.StatusCode != 201 {
			t.Fatalf("create: %d %v", r.StatusCode, b)
		}
		return b["project"].(map[string]any)["id"].(string)
	}
	p := project("GitHub demo")
	p2 := project("Other project")
	var user string
	if err := testPool.QueryRow(ctx, `SELECT "userId" FROM "Project" WHERE "id"=$1`, p).Scan(&user); err != nil {
		t.Fatal(err)
	}
	r, secret, err := svc.Connect(ctx, user, p, "https://github.com/solo/demo")
	if err != nil {
		t.Fatal(err)
	}
	if r.State != "Awaiting first update" || len(secret) != 64 {
		t.Fatalf("bad setup: %+v", r)
	}
	connectionJSON, _ := json.Marshal(r)
	if bytes.Contains(connectionJSON, []byte(secret)) || bytes.Contains(connectionJSON, []byte("Hash")) {
		t.Fatal("credential leaked in normal response")
	}
	var hash []byte
	testPool.QueryRow(ctx, `SELECT credential_hash FROM project_repository WHERE id=$1`, r.ID).Scan(&hash)
	if bytes.Contains(hash, []byte(secret)) || len(hash) != 32 {
		t.Fatal("secret not hashed")
	}
	if _, _, err = svc.Connect(ctx, user, p, "https://github.com/solo/demo"); err == nil {
		t.Fatal("duplicate connection accepted")
	}
	if _, _, err = svc.Connect(ctx, user, p2, "https://evil.example/solo/demo"); err == nil {
		t.Fatal("arbitrary host accepted")
	}
	// Switch the router's continuity service for HTTP-level assertions.
	originalSrv := testSrv
	testSrv = httptest.NewServer(router.NewEngine(testDeps))
	defer func() { testSrv.Close(); testSrv = originalSrv }()
	// test clients' cookies are valid for same host across ports.
	base := "/api/v1/projects/" + p + "/github"
	for _, check := range []struct {
		method, path string
		body         any
	}{
		{"GET", base, nil}, {"POST", base, map[string]any{"url": "https://github.com/solo/demo"}}, {"DELETE", base, nil}, {"POST", base + "/rotate", nil}, {"POST", base + "/review", map[string]any{"connectionId": r.ID, "sequence": 0}}, {"POST", base + "/sync", map[string]any{"force": true}}, {"PUT", "/api/v1/projects/" + p + "/return-context", map[string]any{"returnNote": "Injected"}},
	} {
		resp, body := other.request(check.method, check.path, check.body, nil)
		if resp.StatusCode != 404 {
			t.Fatalf("cross-owner %s: %d %v", check.path, resp.StatusCode, body)
		}
	}
	d := continuity.Delivery{DeliveryID: "actions:1", RepositoryID: 4242, Branch: "main", EventAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), Commits: []continuity.Commit{{SHA: history[0], Message: "Auth works; test expiry next", Author: "Dev", EventAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}}}
	send := func(secret string, body any) int {
		resp, _ := newTestClient(t).request("POST", "/api/v1/integrations/github/"+r.ID+"/deliveries", body, map[string]string{"Authorization": "Bearer " + secret})
		return resp.StatusCode
	}
	coreLimited = true
	otherProject := project("Separate connection")
	_, otherSecret, err := svc.Connect(ctx, user, otherProject, "https://github.com/solo/demo")
	if err != nil {
		t.Fatal(err)
	}
	if code := send(otherSecret, d); code != 401 {
		t.Fatalf("credential from another connection wrote target: %d", code)
	}
	mismatchProject := project("Reject approximate/private fallback")
	searchFullName = "unrelated/repository"
	if _, _, err = svc.Connect(ctx, user, mismatchProject, "https://github.com/solo/demo"); err == nil {
		t.Fatal("approximate fallback match accepted")
	}
	searchFullName = "solo/demo"
	searchPrivate = true
	if _, _, err = svc.Connect(ctx, user, mismatchProject, "https://github.com/solo/demo"); err == nil {
		t.Fatal("private fallback repository accepted")
	}
	coreLimited = false
	searchPrivate = false

	if code := send(strings.Repeat("0", 64), d); code != 401 {
		t.Fatalf("invalid secret: %d", code)
	}
	dWrong := d
	dWrong.RepositoryID++
	if code := send(secret, dWrong); code != 403 {
		t.Fatalf("wrong repo: %d", code)
	}
	dWrong = d
	dWrong.Branch = "feature"
	if code := send(secret, dWrong); code != 403 {
		t.Fatalf("wrong branch: %d", code)
	}
	unknown := map[string]any{"deliveryId": "actions:bad", "projectId": p2}
	if code := send(secret, unknown); code != 400 {
		t.Fatalf("untrusted project field: %d", code)
	}
	dWrong = d
	dWrong.Commits = nil
	if code := send(secret, dWrong); code != 400 {
		t.Fatalf("invalid commits: %d", code)
	}
	if code := send(secret, d); code != 200 {
		t.Fatalf("browser-independent ingest: %d", code)
	}
	if code := send(secret, d); code != 200 {
		t.Fatalf("retry: %d", code)
	}
	v, err := svc.View(ctx, user, p)
	if err != nil {
		t.Fatal(err)
	}
	if v.Unread != 1 || len(v.Activity) != 1 || v.Connection.State != "Receiving updates" {
		t.Fatalf("retry duplicated or state wrong: %+v", v)
	}
	seq := v.Connection.Sequence
	if _, err = svc.View(ctx, user, p); err != nil {
		t.Fatal(err)
	}
	v, _ = svc.View(ctx, user, p)
	if v.Unread != 1 {
		t.Fatal("page read moved marker")
	}
	if err = svc.Sync(ctx, user, p, true); err != nil {
		t.Fatal(err)
	}
	v, _ = svc.View(ctx, user, p)
	if len(v.Activity) != 1 || v.Connection.LastSyncedAt == nil {
		t.Fatalf("recovery duplicate: %+v", v)
	}
	// Existing head only changes through recovery, not a late sender delivery.
	late := d
	late.DeliveryID = "actions:late"
	late.Commits = []continuity.Commit{{SHA: strings.Repeat("b", 40), Message: "Late change", Author: "Dev", EventAt: time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)}}
	if code := send(secret, late); code != 200 {
		t.Fatalf("late: %d", code)
	}
	v, _ = svc.View(ctx, user, p)
	if v.Unread != 2 || v.Connection.Head != history[0] {
		t.Fatalf("late unread/head: %+v", v)
	}
	if err = svc.Review(ctx, user, p, r.ID, seq); err != nil {
		t.Fatal(err)
	}
	v, _ = svc.View(ctx, user, p)
	if v.Unread != 1 {
		t.Fatal("acknowledged unseen late delivery")
	}
	if err = svc.Review(ctx, user, p, r.ID, 99999); err == nil {
		t.Fatal("future marker accepted")
	}
	// Recovery restores missed commits and truthfully flags rewritten history.
	history = []string{strings.Repeat("c", 40)}
	testPool.Exec(ctx, `UPDATE project_repository SET last_attempt_at=NULL WHERE id=$1`, r.ID)
	if err = svc.Sync(ctx, user, p, true); err != nil {
		t.Fatal(err)
	}
	v, _ = svc.View(ctx, user, p)
	if !v.Connection.Incomplete || len(v.Activity) != 3 {
		t.Fatalf("recovery missing rewrite: %+v", v)
	}
	// Failed sync preserves saved context and cached activity.
	if err = svc.ReturnContext(ctx, user, p, "Next: test expired session. Cookie sessions keep deployment simple.", nil); err != nil {
		t.Fatal(err)
	}
	unavailable = true
	testPool.Exec(ctx, `UPDATE project_repository SET last_attempt_at=NULL WHERE id=$1`, r.ID)
	if err = svc.Sync(ctx, user, p, true); err == nil {
		t.Fatal("expected upstream error")
	}
	v, _ = svc.View(ctx, user, p)
	if v.Connection.State != "Needs attention" || v.Note == "" || len(v.Activity) != 3 {
		t.Fatal("cached context unavailable on failure")
	}
	unavailable = false
	// Recovery never verifies workflow after credential rotation.
	rotated, err := svc.Rotate(ctx, user, p)
	if err != nil {
		t.Fatal(err)
	}
	if code := send(secret, d); code != 401 {
		t.Fatalf("rotated old secret: %d", code)
	}
	testPool.Exec(ctx, `UPDATE project_repository SET last_attempt_at=NULL WHERE id=$1`, r.ID)
	if err = svc.Sync(ctx, user, p, true); err != nil {
		t.Fatal(err)
	}
	v, _ = svc.View(ctx, user, p)
	if v.Connection.State != "Awaiting first update" {
		t.Fatalf("catch-up falsely verified sender: %s", v.Connection.State)
	}
	if code := send(rotated, d); code != 200 {
		t.Fatal("new secret rejected")
	}
	// Cross-project focus references are forbidden, including same-owner projects.
	issResp, iss := owner.request("POST", "/api/v1/projects/"+p2+"/issues", map[string]any{"title": "Other issue", "nextAction": "Do not link"}, nil)
	if issResp.StatusCode != 201 {
		t.Fatal(iss)
	}
	foreign := iss["issue"].(map[string]any)["id"].(string)
	if err = svc.ReturnContext(ctx, user, p, "Bad focus", &foreign); err == nil {
		t.Fatal("cross-project focus accepted")
	}
	ownResp, ownBody := owner.request("POST", "/api/v1/projects/"+p+"/issues", map[string]any{"title": "Focus survives ranking", "nextAction": "Verify the chosen issue"}, nil)
	if ownResp.StatusCode != 201 {
		t.Fatal(ownBody)
	}
	focusID := ownBody["issue"].(map[string]any)["id"].(string)
	if err = svc.ReturnContext(ctx, user, p, "Next: verify focus", &focusID); err != nil {
		t.Fatal(err)
	}
	owner.request("PATCH", "/api/v1/projects/"+p+"/issues/"+focusID, map[string]any{"status": "Closed"}, nil)
	focused, err := svc.View(ctx, user, p)
	if err != nil || focused.FocusIssue == nil || focused.FocusIssue.NextAction != "Verify the chosen issue" {
		t.Fatal("focus lost after issue left outstanding list", err)
	}
	owner.request("DELETE", "/api/v1/projects/"+p+"/issues/"+focusID, nil, nil)
	focused, err = svc.View(ctx, user, p)
	if err != nil || focused.FocusIssue != nil || focused.FocusIssueID != nil || focused.Note == "" {
		t.Fatal("deleted focus did not clear safely", err)
	}

	resp, _ := owner.request("POST", "/api/v1/projects/"+p+"/archive", nil, nil)
	if resp.StatusCode != 200 {
		t.Fatal("archive failed")
	}
	if code := send(rotated, late); code != 409 {
		t.Fatalf("archived ingest: %d", code)
	}
	if err = svc.Sync(ctx, user, p, true); err == nil {
		t.Fatal("archived catchup accepted")
	}
	v, _ = svc.View(ctx, user, p)
	if v.Connection.State != "Paused (archived)" {
		t.Fatal("archive state")
	}
	owner.request("POST", "/api/v1/projects/"+p+"/restore", nil, nil)
	if err = svc.Unlink(ctx, user, p); err != nil {
		t.Fatal(err)
	}
	if code := send(rotated, d); code != 401 {
		t.Fatalf("unlinked ingest: %d", code)
	}
	v, _ = svc.View(ctx, user, p)
	if v.Connection != nil || len(v.Activity) != 0 || v.Note == "" {
		t.Fatal("unlink did not clear cache or removed authored context")
	}
	var remaining int
	testPool.QueryRow(ctx, `SELECT count(*) FROM git_activity WHERE connection_id=$1`, r.ID).Scan(&remaining)
	if remaining != 0 {
		t.Fatal("orphan activity after unlink")
	}
	// The only Project changes above are the two explicit archive/restore actions.
	// A separate project verifies background work never touches updatedAt.
	_, _, err = svc.Connect(ctx, user, p2, "https://github.com/solo/demo")
	if err != nil {
		t.Fatal(err)
	}
	var before2, after2 time.Time
	testPool.QueryRow(ctx, `SELECT "updatedAt" FROM "Project" WHERE "id"=$1`, p2).Scan(&before2)
	if err = svc.Sync(ctx, user, p2, true); err != nil {
		t.Fatal(err)
	}
	testPool.QueryRow(ctx, `SELECT "updatedAt" FROM "Project" WHERE "id"=$1`, p2).Scan(&after2)
	if !before2.Equal(after2) {
		t.Fatal("sync changed project modification time")
	}
	// Oversized bodies are rejected before authentication/database writes.
	big := map[string]any{"deliveryId": strings.Repeat("x", 300000)}
	if code := send(rotated, big); code != 400 {
		t.Fatalf("oversized body: %d", code)
	}
	history = make([]string, 100)
	for i := range history {
		history[i] = fmt.Sprintf("%040x", i+1)
	}
	latencyConfig := testPool.Config()
	latencyConfig.ConnConfig.Tracer = continuityQueryLatency{}
	latencyPool, err := pgxpool.NewWithConfig(ctx, latencyConfig)
	if err != nil {
		t.Fatal(err)
	}
	defer latencyPool.Close()
	boundedRecovery := continuity.NewService(latencyPool, upstream.URL, nil)
	testPool.Exec(ctx, `UPDATE project_repository SET last_attempt_at=NULL WHERE project_id=$1`, p2)
	// The in-memory test server supports one client connection at a time.
	testPool.Reset()
	err = boundedRecovery.Sync(ctx, user, p2, true)
	latencyPool.Reset()
	if err != nil {
		t.Fatal("full history window failed with database latency:", err)
	}
	fullWindow, err := svc.View(ctx, user, p2)
	if err != nil || !fullWindow.Connection.Incomplete {
		t.Fatal("full recovery window not flagged incomplete", err)
	}
	var commitCount int
	if err = testPool.QueryRow(ctx, `SELECT count(*) FROM git_activity WHERE connection_id=$1`, fullWindow.Connection.ID).Scan(&commitCount); err != nil || commitCount != 101 {
		t.Fatalf("full window lost or duplicated commits: count=%d err=%v", commitCount, err)
	}
	// Repeating recovery must preserve the same unique commits under that latency.
	testPool.Exec(ctx, `UPDATE project_repository SET last_attempt_at=NULL WHERE project_id=$1`, p2)
	testPool.Reset()
	err = boundedRecovery.Sync(ctx, user, p2, true)
	latencyPool.Reset()
	if err != nil {
		t.Fatal("repeated full history recovery:", err)
	}
	if err = testPool.QueryRow(ctx, `SELECT count(*) FROM git_activity WHERE connection_id=$1`, fullWindow.Connection.ID).Scan(&commitCount); err != nil || commitCount != 101 {
		t.Fatalf("repeated full window duplicated commits: count=%d err=%v", commitCount, err)
	}

	// Upstream repository replacement is never treated as the connected identity.
	repositoryID = 9999
	testPool.Exec(ctx, `UPDATE project_repository SET last_attempt_at=NULL WHERE project_id=$1`, p2)
	if err = svc.Sync(ctx, user, p2, true); err == nil {
		t.Fatal("repository replacement accepted")
	}
	t.Log("Verified: ownership, credentials, idempotence, unread receipt ordering, recovery, archive, unlink and cached context")
}
