package github

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/westride/unpause/api-go/internal/shared"
)

// Service queries the public GitHub repository search API with timeouts and rate-limit handling.
type Service struct {
	baseURL    string
	token      string
	httpClient *http.Client
}

func NewService(baseURL, token string, httpClient *http.Client) *Service {
	if httpClient == nil {
		httpClient = &http.Client{
			Timeout: 10 * time.Second,
		}
	}
	return &Service{
		baseURL:    strings.TrimRight(baseURL, "/"),
		token:      strings.TrimSpace(token),
		httpClient: httpClient,
	}
}

func (s *Service) SetBaseURL(baseURL string) {
	s.baseURL = strings.TrimRight(baseURL, "/")
}

func (s *Service) SearchRepositories(ctx context.Context, params SearchParams) (SearchResponse, error) {
	const maxAccessibleResults = 1000
	maxPage := maxAccessibleResults / params.PerPage
	if maxPage < 1 {
		maxPage = 1
	}
	safePage := params.Page
	if safePage > maxPage {
		safePage = maxPage
	}

	qualifiers := []string{strings.TrimSpace(params.Query)}
	if lang := strings.TrimSpace(params.Language); lang != "" {
		qualifiers = append(qualifiers, fmt.Sprintf("language:%s", lang))
	}
	if params.MinStars != nil && *params.MinStars > 0 {
		qualifiers = append(qualifiers, fmt.Sprintf("stars:>=%d", *params.MinStars))
	}

	combinedQuery := strings.Join(qualifiers, " ")

	endpoint, err := url.Parse(s.baseURL + "/search/repositories")
	if err != nil {
		return SearchResponse{}, shared.NewGitHubUpstreamError("Invalid GitHub API base URL", nil)
	}
	q := endpoint.Query()
	q.Set("q", combinedQuery)
	q.Set("page", strconv.Itoa(safePage))
	q.Set("per_page", strconv.Itoa(params.PerPage))
	q.Set("sort", "stars")
	q.Set("order", "desc")
	endpoint.RawQuery = q.Encode()

	reqCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return SearchResponse{}, shared.NewGitHubUpstreamError("Failed to build GitHub API request.", nil)
	}

	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "Unpause-MVP-Course-Project")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if s.token != "" {
		req.Header.Set("Authorization", "Bearer "+s.token)
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return SearchResponse{}, shared.NewGitHubUpstreamError(
			"Unable to reach GitHub API. Please check your network connection and retry.",
			nil,
		)
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		rateRemaining := resp.Header.Get("x-ratelimit-remaining")
		rateReset := resp.Header.Get("x-ratelimit-reset")

		var errBody struct {
			Message string `json:"message"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&errBody)

		if resp.StatusCode == http.StatusTooManyRequests ||
			(resp.StatusCode == http.StatusForbidden &&
				(rateRemaining == "0" || strings.Contains(strings.ToLower(errBody.Message), "rate limit"))) {
			var details any
			if rateReset != "" {
				if unixSec, convErr := strconv.ParseInt(rateReset, 10, 64); convErr == nil {
					details = map[string]string{
						"resetAt": shared.FormatISO8601(time.Unix(unixSec, 0)),
					}
				}
			}
			return SearchResponse{}, shared.NewGitHubRateLimitError(
				"GitHub API rate limit reached. Please wait a moment and try again.",
				details,
			)
		}

		msg := fmt.Sprintf("GitHub API request failed with status %d.", resp.StatusCode)
		if errBody.Message != "" {
			msg = fmt.Sprintf("GitHub API returned an error (%d): %s", resp.StatusCode, errBody.Message)
		}
		return SearchResponse{}, shared.NewGitHubUpstreamError(msg, nil)
	}

	var raw rawGitHubSearchResponse
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return SearchResponse{}, shared.NewGitHubUpstreamError("Invalid response received from GitHub API.", nil)
	}
	if raw.Items == nil {
		return SearchResponse{}, shared.NewGitHubUpstreamError("Unexpected payload structure from GitHub API.", nil)
	}

	effectiveMax := raw.TotalCount
	if effectiveMax > maxAccessibleResults {
		effectiveMax = maxAccessibleResults
	}
	hasNextPage := safePage*params.PerPage < effectiveMax
	hasPrevPage := safePage > 1

	items := make([]RepositoryItem, 0, len(raw.Items))
	for _, r := range raw.Items {
		desc := ""
		if r.Description != nil {
			desc = *r.Description
		}
		items = append(items, RepositoryItem{
			ID:              r.ID,
			Name:            r.Name,
			FullName:        r.FullName,
			Owner:           r.Owner.Login,
			Description:     desc,
			Language:        r.Language,
			StargazersCount: r.StargazersCount,
			ForksCount:      r.ForksCount,
			HTMLURL:         r.HTMLURL,
			UpdatedAt:       r.UpdatedAt,
		})
	}

	return SearchResponse{
		Items:           items,
		TotalCount:      raw.TotalCount,
		Page:            safePage,
		PerPage:         params.PerPage,
		HasNextPage:     hasNextPage,
		HasPreviousPage: hasPrevPage,
	}, nil
}
