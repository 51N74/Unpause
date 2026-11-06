// Package continuity connects public repositories to owner-authored Resume context.
package continuity

import "time"

type Repository struct {
	ID            int64  `json:"id"`
	FullName      string `json:"full_name"`
	DefaultBranch string `json:"default_branch"`
	Private       bool   `json:"private"`
	Visibility    string `json:"visibility"`
}
type Commit struct {
	SHA     string    `json:"sha"`
	Message string    `json:"message"`
	Author  string    `json:"author"`
	EventAt time.Time `json:"eventAt"`
}
type Delivery struct {
	DeliveryID   string    `json:"deliveryId"`
	RepositoryID int64     `json:"repositoryId"`
	Branch       string    `json:"branch"`
	EventAt      time.Time `json:"eventAt"`
	Incomplete   bool      `json:"incomplete"`
	Commits      []Commit  `json:"commits"`
}
type Connection struct {
	ID                string     `json:"id"`
	RepositoryID      int64      `json:"repositoryId"`
	FullName          string     `json:"fullName"`
	Branch            string     `json:"branch"`
	LastDeliveryAt    *time.Time `json:"lastDeliveryReceivedAt"`
	LastSyncedAt      *time.Time `json:"lastSyncedAt"`
	LastGitActivityAt *time.Time `json:"lastGitActivityAt"`
	Incomplete        bool       `json:"incompleteHistory"`
	Sequence          int64      `json:"sequence"`
	ReviewedSequence  int64      `json:"reviewedSequence"`
	State             string     `json:"state"`
	Head              string     `json:"-"`
	SyncUntil         *time.Time `json:"-"`
	SyncError         bool       `json:"-"`
	Hash              []byte     `json:"-"`
}
type Activity struct {
	DeliveryID string    `json:"deliveryId"`
	Sequence   int64     `json:"sequence"`
	Source     string    `json:"source"`
	EventAt    time.Time `json:"eventAt"`
	ReceivedAt time.Time `json:"receivedAt"`
	Commits    []Commit  `json:"commits"`
}
type FocusIssue struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	NextAction string `json:"nextAction"`
}
type View struct {
	Links        []CommitLink `json:"links"`
	FocusIssue   *FocusIssue  `json:"focusIssue"`
	Connection   *Connection  `json:"connection"`
	Activity     []Activity   `json:"activity"`
	Unread       int          `json:"unread"`
	Note         string       `json:"returnNote"`
	FocusIssueID *string      `json:"focusIssueId"`
}
