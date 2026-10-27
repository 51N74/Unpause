// Package github implements the GitHub public repository search client and HTTP handler.
package github

type RepositoryItem struct {
	ID              int64   `json:"id"`
	Name            string  `json:"name"`
	FullName        string  `json:"fullName"`
	Owner           string  `json:"owner"`
	Description     string  `json:"description"`
	Language        *string `json:"language"`
	StargazersCount int     `json:"stargazersCount"`
	ForksCount      int     `json:"forksCount"`
	HTMLURL         string  `json:"htmlUrl"`
	UpdatedAt       string  `json:"updatedAt"`
}

type SearchResponse struct {
	Items           []RepositoryItem `json:"items"`
	TotalCount      int              `json:"totalCount"`
	Page            int              `json:"page"`
	PerPage         int              `json:"perPage"`
	HasNextPage     bool             `json:"hasNextPage"`
	HasPreviousPage bool             `json:"hasPreviousPage"`
}

type SearchParams struct {
	Query    string
	Language string
	MinStars *int
	Page     int
	PerPage  int
}

type rawGitHubOwner struct {
	Login string `json:"login"`
}

type rawGitHubRepo struct {
	ID              int64          `json:"id"`
	Name            string         `json:"name"`
	FullName        string         `json:"full_name"`
	Owner           rawGitHubOwner `json:"owner"`
	Description     *string        `json:"description"`
	Language        *string        `json:"language"`
	StargazersCount int            `json:"stargazers_count"`
	ForksCount      int            `json:"forks_count"`
	HTMLURL         string         `json:"html_url"`
	UpdatedAt       string         `json:"updated_at"`
}

type rawGitHubSearchResponse struct {
	TotalCount        int             `json:"total_count"`
	IncompleteResults bool            `json:"incomplete_results"`
	Items             []rawGitHubRepo `json:"items"`
}
