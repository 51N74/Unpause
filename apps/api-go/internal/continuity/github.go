package continuity

import (
	"context"
	"encoding/json"
	"github.com/westride/unpause/api-go/internal/shared"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

var repoPattern = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)
var shaPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)
var deliveryPattern = regexp.MustCompile(`^[A-Za-z0-9:_-]{1,128}$`)

func repositoryName(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host != "github.com" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", shared.NewValidationError("Use a public https://github.com/owner/repository URL", nil)
	}
	name := strings.TrimSuffix(strings.Trim(u.Path, "/"), ".git")
	if !repoPattern.MatchString(name) || strings.Contains(name, "..") {
		return "", shared.NewValidationError("Invalid repository URL", nil)
	}
	return name, nil
}

// Only the administrator-configured upstream is used, never a caller-provided host.
// Public requests deliberately omit the optional Explorer token so private repos cannot leak.
func (s *Service) github(ctx context.Context, path string, target any) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.baseURL+path, nil)
	if err != nil {
		return shared.NewGitHubUpstreamError("Invalid upstream configuration", nil)
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "Unpause-Continuity")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	resp, err := s.client.Do(req)
	if err != nil {
		return shared.NewGitHubUpstreamError("GitHub unavailable; cached context is still available", nil)
	}
	defer resp.Body.Close()
	if resp.StatusCode == 429 || resp.StatusCode == 403 {
		return shared.NewGitHubRateLimitError("GitHub refused the request; retry later", nil)
	}
	if resp.StatusCode != 200 {
		return shared.NewGitHubUpstreamError("Public repository or branch unavailable", nil)
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(target); err != nil {
		return shared.NewGitHubUpstreamError("Invalid GitHub response", nil)
	}
	return nil
}
func (s *Service) resolve(ctx context.Context, name string) (Repository, error) {
	var r Repository
	err := s.github(ctx, "/repos/"+name, &r)
	if err != nil {
		return r, err
	}
	if r.ID <= 0 || r.Private || r.Visibility != "public" || !repoPattern.MatchString(r.FullName) || r.DefaultBranch == "" || len(r.DefaultBranch) > 255 {
		return r, shared.NewValidationError("Only public repositories with a default branch are supported", nil)
	}
	return r, nil
}
func (s *Service) commits(ctx context.Context, r *Connection) ([]Commit, error) {
	var raw []struct {
		SHA    string `json:"sha"`
		Commit struct {
			Message string `json:"message"`
			Author  struct {
				Name string    `json:"name"`
				Date time.Time `json:"date"`
			} `json:"author"`
		} `json:"commit"`
	}
	if err := s.github(ctx, "/repos/"+r.FullName+"/commits?per_page=100&sha="+url.QueryEscape(r.Branch), &raw); err != nil {
		return nil, err
	}
	result := make([]Commit, 0, len(raw))
	for _, c := range raw {
		result = append(result, Commit{c.SHA, truncate(c.Commit.Message, 2000), truncate(c.Commit.Author.Name, 200), c.Commit.Author.Date})
	}
	if len(result) == 0 || len(result) > 100 {
		return nil, shared.NewGitHubUpstreamError("No bounded commit history available", nil)
	}
	return result, nil
}
func truncate(s string, limit int) string {
	r := []rune(s)
	if len(r) > limit {
		return string(r[:limit])
	}
	return s
}
func validateDelivery(d Delivery) error {
	if !deliveryPattern.MatchString(d.DeliveryID) || d.RepositoryID <= 0 || len(d.Branch) == 0 || len(d.Branch) > 255 || len(d.Commits) < 1 || len(d.Commits) > 100 || d.EventAt.IsZero() || d.EventAt.After(time.Now().Add(5*time.Minute)) {
		return shared.NewValidationError("Invalid delivery metadata (1–100 commits required)", nil)
	}
	for _, c := range d.Commits {
		if !shaPattern.MatchString(c.SHA) || len([]rune(c.Message)) > 2000 || len([]rune(c.Author)) > 200 || c.EventAt.IsZero() || c.EventAt.After(time.Now().Add(5*time.Minute)) {
			return shared.NewValidationError("Invalid commit metadata", nil)
		}
	}
	return nil
}
