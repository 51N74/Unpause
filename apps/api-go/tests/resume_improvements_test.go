package tests

import (
	"context"
	"encoding/json"
	"github.com/westride/unpause/api-go/internal/continuity"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestResumeDemoAndCommitLinks(t *testing.T) {
	ctx := context.Background()
	owner, other, anon := newTestClient(t), newTestClient(t), newTestClient(t)
	call := func(c *testClient, method, path string, body any, status int) map[string]any {
		t.Helper()
		r, b := c.request(method, path, body, nil)
		if r.StatusCode != status {
			t.Fatalf("%s %s: %d %v", method, path, r.StatusCode, b)
		}
		return b
	}
	call(anon, "POST", "/api/v1/projects/demo", nil, 401)
	user := call(owner, "POST", "/api/v1/auth/register", map[string]any{"email": "resume-owner@test.local", "password": "Password123!"}, 201)["user"].(map[string]any)["id"].(string)
	call(other, "POST", "/api/v1/auth/register", map[string]any{"email": "resume-other@test.local", "password": "Password123!"}, 201)
	p := call(owner, "POST", "/api/v1/projects/demo", nil, 200)["project"].(map[string]any)["id"].(string)
	q := call(other, "POST", "/api/v1/projects/demo", nil, 200)["project"].(map[string]any)["id"].(string)
	if p == q {
		t.Fatal("demo shared across owners")
	}
	base := "/api/v1/projects/" + p
	call(other, "GET", base+"/resume-context", nil, 404)
	var issue, decision, foreignIssue, foreignDecision string
	for _, entry := range []struct {
		table, project string
		id             *string
	}{{"Issue", p, &issue}, {"DecisionRecord", p, &decision}, {"Issue", q, &foreignIssue}, {"DecisionRecord", q, &foreignDecision}} {
		if err := testPool.QueryRow(ctx, `SELECT "id" FROM "`+entry.table+`" WHERE "projectId"=$1`, entry.project).Scan(entry.id); err != nil {
			t.Fatal(err)
		}
	}
	call(owner, "PUT", base+"/return-context", map[string]any{"returnNote": "My edited demo", "focusIssueId": issue}, 200)
	again := call(owner, "POST", "/api/v1/projects/demo", map[string]any{"userId": "ignored"}, 200)
	if again["project"].(map[string]any)["id"] != p {
		t.Fatal("demo duplicated")
	}
	state := call(owner, "GET", base+"/github", nil, 200)
	if state["returnNote"] != "My edited demo" || state["connection"] != nil {
		t.Fatal("demo reset edits or created GitHub connection")
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"id": 55, "full_name": "solo/demo", "default_branch": "main", "visibility": "public"})
	}))
	defer upstream.Close()
	svc := continuity.NewService(testPool, upstream.URL, nil)
	connection, secret, err := svc.Connect(ctx, user, p, "https://github.com/solo/demo")
	if err != nil {
		t.Fatal(err)
	}
	sha := strings.Repeat("e", 40)
	err = svc.Ingest(ctx, connection.ID, secret, continuity.Delivery{DeliveryID: "actions:resume-test", RepositoryID: 55, Branch: "main", EventAt: time.Now(), Commits: []continuity.Commit{{SHA: sha, Message: "<script>unsafe</script>", Author: "Dev", EventAt: time.Now()}}})
	if err != nil {
		t.Fatal(err)
	}

	sameOwnerProject := call(owner, "POST", "/api/v1/projects", map[string]any{"name": "Separate owned project", "initialScope": map[string]any{"problem": "test", "targetUsers": "test", "goal": "test", "inScope": "test", "outOfScope": "test"}}, 201)["project"].(map[string]any)["id"].(string)
	sameOwnerIssue := call(owner, "POST", "/api/v1/projects/"+sameOwnerProject+"/issues", map[string]any{"title": "Other project issue", "nextAction": "Test isolation"}, 201)["issue"].(map[string]any)["id"].(string)
	path := base + "/github/commits/" + sha + "/link"
	call(owner, "PUT", path, map[string]any{"issueId": sameOwnerIssue}, 400)
	call(other, "PUT", path, map[string]any{"issueId": foreignIssue}, 404)
	call(anon, "PUT", path, map[string]any{"issueId": issue}, 401)
	call(owner, "PUT", path, map[string]any{"issueId": foreignIssue}, 400)
	call(owner, "PUT", path, map[string]any{"decisionId": foreignDecision}, 400)
	call(owner, "PUT", path, map[string]any{"issueId": issue, "extra": "invalid"}, 400)
	call(owner, "PUT", base+"/github/commits/invalid/link", map[string]any{}, 400)
	call(owner, "PUT", base+"/github/commits/"+strings.Repeat("f", 40)+"/link", map[string]any{"issueId": issue}, 404)
	r, _ := owner.request("PUT", path, map[string]any{"issueId": issue}, map[string]string{"Origin": "https://evil.example"})
	if r.StatusCode != 403 {
		t.Fatal("cross-origin link accepted")
	}
	before := call(owner, "GET", base+"/github", nil, 200)
	call(owner, "PUT", path, map[string]any{"issueId": issue, "decisionId": decision}, 200)
	after := call(owner, "GET", base+"/github", nil, 200)
	links := after["links"].([]any)
	if len(links) != 1 || links[0].(map[string]any)["issueId"] != issue || links[0].(map[string]any)["decisionId"] != decision {
		t.Fatal("links not saved")
	}
	if after["unread"] != before["unread"] || after["returnNote"] != before["returnNote"] {
		t.Fatal("link changed context or unread")
	}
	call(owner, "PUT", path, map[string]any{}, 200)
	if len(call(owner, "GET", base+"/github", nil, 200)["links"].([]any)) != 0 {
		t.Fatal("link removal failed")
	}
	call(owner, "PUT", path, map[string]any{"issueId": issue, "decisionId": decision}, 200)
	call(owner, "DELETE", base+"/issues/"+issue, nil, 200)
	state = call(owner, "GET", base+"/github", nil, 200)
	if state["links"].([]any)[0].(map[string]any)["issueId"] != nil {
		t.Fatal("deleted target retained")
	}
	call(owner, "POST", base+"/archive", nil, 200)
	call(owner, "PUT", path, map[string]any{"decisionId": decision}, 409)
	call(owner, "PUT", base+"/return-context", map[string]any{"returnNote": "archived change"}, 409)
	call(owner, "POST", base+"/restore", nil, 200)
	call(owner, "DELETE", base+"/github", nil, 200)
	var count int
	if err = testPool.QueryRow(ctx, `SELECT count(*) FROM git_activity_link WHERE connection_id=$1`, connection.ID).Scan(&count); err != nil || count != 0 {
		t.Fatal("unlink retained links", err)
	}
}
