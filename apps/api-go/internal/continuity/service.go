package continuity

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/westride/unpause/api-go/internal/shared"
)

type Service struct {
	pool    *pgxpool.Pool
	baseURL string
	client  *http.Client
}

func NewService(pool *pgxpool.Pool, baseURL string, client *http.Client) *Service {
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	// Refuse redirects so upstream changes cannot redirect requests to arbitrary hosts.
	copyClient := *client
	copyClient.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	return &Service{pool, strings.TrimRight(baseURL, "/"), &copyClient}
}
func credential() (string, []byte, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", nil, err
	}
	secret := hex.EncodeToString(b)
	h := sha256.Sum256([]byte(secret))
	return secret, h[:], nil
}

// Lock Project before connection in every write. Archive's Project UPDATE uses the same lock.
func (s *Service) ownedTx(ctx context.Context, user, project string) (pgx.Tx, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	var status string
	err = tx.QueryRow(ctx, `SELECT "status"::text FROM "Project" WHERE "id"=$1 AND "userId"=$2 FOR UPDATE`, project, user).Scan(&status)
	if err != nil || status != "Active" {
		_ = tx.Rollback(ctx)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, shared.NewNotFoundError("Project not found")
		}
		if err != nil {
			return nil, err
		}
		return nil, shared.NewProjectArchivedError()
	}
	return tx, nil
}

const connectionSQL = `SELECT id,repository_id,full_name,branch,credential_hash,last_delivery_at,last_synced_at,last_git_activity_at,incomplete,sequence,reviewed_sequence,head_sha,sync_until,sync_error FROM project_repository WHERE project_id=$1`

func scanConnection(row pgx.Row) (*Connection, error) {
	r := &Connection{}
	err := row.Scan(&r.ID, &r.RepositoryID, &r.FullName, &r.Branch, &r.Hash, &r.LastDeliveryAt, &r.LastSyncedAt, &r.LastGitActivityAt, &r.Incomplete, &r.Sequence, &r.ReviewedSequence, &r.Head, &r.SyncUntil, &r.SyncError)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return r, nil
}
func (s *Service) Connect(ctx context.Context, user, project, raw string) (*Connection, string, error) {
	if _, err := shared.VerifyProjectOwnership(ctx, s.pool, user, project, true); err != nil {
		return nil, "", err
	}
	name, err := repositoryName(raw)
	if err != nil {
		return nil, "", err
	}
	repo, err := s.resolve(ctx, name)
	if err != nil {
		return nil, "", err
	}
	secret, hash, err := credential()
	if err != nil {
		return nil, "", err
	}
	tx, err := s.ownedTx(ctx, user, project)
	if err != nil {
		return nil, "", err
	}
	defer tx.Rollback(ctx)
	existing, err := scanConnection(tx.QueryRow(ctx, connectionSQL, project))
	if err != nil {
		return nil, "", err
	}
	if existing != nil {
		return nil, "", shared.NewConflictError("Unlink the existing repository first", nil)
	}
	_, err = tx.Exec(ctx, `INSERT INTO project_repository(id,project_id,repository_id,full_name,branch,credential_hash) VALUES($1,$2,$3,$4,$5,$6)`, uuid.NewString(), project, repo.ID, repo.FullName, repo.DefaultBranch, hash)
	if err != nil {
		return nil, "", err
	}
	r, err := scanConnection(tx.QueryRow(ctx, connectionSQL, project))
	if err != nil {
		return nil, "", err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, "", err
	}
	r.State = "Awaiting first update"
	return r, secret, nil
}
func (s *Service) Unlink(ctx context.Context, user, project string) error {
	tx, err := s.ownedTx(ctx, user, project)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `DELETE FROM project_repository WHERE project_id=$1`, project); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Service) Rotate(ctx context.Context, user, project string) (string, error) {
	secret, hash, err := credential()
	if err != nil {
		return "", err
	}
	tx, err := s.ownedTx(ctx, user, project)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	result, err := tx.Exec(ctx, `UPDATE project_repository SET credential_hash=$1,last_delivery_at=NULL WHERE project_id=$2`, hash, project)
	if err != nil {
		return "", err
	}
	if result.RowsAffected() != 1 {
		return "", shared.NewNotFoundError("Repository not connected")
	}
	return secret, tx.Commit(ctx)
}
func (s *Service) View(ctx context.Context, user, project string) (View, error) {
	p, err := shared.VerifyProjectOwnership(ctx, s.pool, user, project, false)
	if err != nil {
		return View{}, err
	}
	v := View{Activity: make([]Activity, 0), Links: make([]CommitLink, 0)}
	var title, nextAction *string
	err = s.pool.QueryRow(ctx, `SELECT c.note,c.focus_issue_id,i."title",i."nextAction" FROM project_return_context c LEFT JOIN "Issue" i ON i."id"=c.focus_issue_id AND i."projectId"=c.project_id WHERE c.project_id=$1`, project).Scan(&v.Note, &v.FocusIssueID, &title, &nextAction)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return v, err
	}
	if v.FocusIssueID != nil && title != nil && nextAction != nil {
		v.FocusIssue = &FocusIssue{*v.FocusIssueID, *title, *nextAction}
	}

	r, err := scanConnection(s.pool.QueryRow(ctx, connectionSQL, project))
	if err != nil {
		return v, err
	}
	v.Connection = r
	if r == nil {
		return v, nil
	}
	r.State = "Awaiting first update"
	if r.LastDeliveryAt != nil {
		r.State = "Receiving updates"
	}
	if r.SyncError {
		r.State = "Needs attention"
	}
	if r.SyncUntil != nil && r.SyncUntil.After(time.Now()) {
		r.State = "Syncing"
	}
	if p.Status == "Archived" {
		r.State = "Paused (archived)"
	}
	// Snapshot the upper sequence: the review button can only acknowledge what this view saw.
	rows, err := s.pool.Query(ctx, `SELECT d.delivery_id,d.sequence,d.source,d.event_at,d.received_at,
  (SELECT json_agg(json_build_object('sha',a.sha,'message',a.message,'author',a.author_name,'eventAt',a.event_at) ORDER BY a.event_at,a.sha) FROM git_activity a WHERE a.connection_id=d.connection_id AND a.delivery_id=d.delivery_id)
  FROM git_delivery d WHERE d.connection_id=$1 AND d.sequence<=$2 AND EXISTS(SELECT 1 FROM git_activity a WHERE a.connection_id=d.connection_id AND a.delivery_id=d.delivery_id) ORDER BY d.sequence DESC LIMIT 20`, r.ID, r.Sequence)
	if err != nil {
		return v, err
	}
	defer rows.Close()
	for rows.Next() {
		var a Activity
		if err = rows.Scan(&a.DeliveryID, &a.Sequence, &a.Source, &a.EventAt, &a.ReceivedAt, &a.Commits); err != nil {
			return v, err
		}
		v.Activity = append(v.Activity, a)
	}
	if err = rows.Err(); err != nil {
		return v, err
	}
	rows.Close()
	err = s.pool.QueryRow(ctx, `SELECT count(*) FROM git_delivery d WHERE connection_id=$1 AND sequence>$2 AND sequence<=$3 AND EXISTS(SELECT 1 FROM git_activity a WHERE a.connection_id=d.connection_id AND a.delivery_id=d.delivery_id)`, r.ID, r.ReviewedSequence, r.Sequence).Scan(&v.Unread)
	if err != nil {
		return v, err
	}
	shas := make([]string, 0)
	for _, group := range v.Activity {
		for _, commit := range group.Commits {
			shas = append(shas, commit.SHA)
		}
	}
	links, err := s.pool.Query(ctx, `SELECT l.sha,l.issue_id,l.decision_id,i."title",d."decision" FROM git_activity_link l LEFT JOIN "Issue" i ON i."id"=l.issue_id AND i."projectId"=$3 LEFT JOIN "DecisionRecord" d ON d."id"=l.decision_id AND d."projectId"=$3 WHERE l.connection_id=$1 AND l.sha=ANY($2::text[]) AND (l.issue_id IS NOT NULL OR l.decision_id IS NOT NULL)`, r.ID, shas, project)
	if err != nil {
		return v, err
	}
	defer links.Close()
	for links.Next() {
		var link CommitLink
		if err = links.Scan(&link.SHA, &link.IssueID, &link.DecisionID, &link.IssueTitle, &link.DecisionTitle); err != nil {
			return v, err
		}
		v.Links = append(v.Links, link)
	}
	return v, links.Err()
}
func (s *Service) ReturnContext(ctx context.Context, user, project, note string, focus *string) error {
	if len([]rune(note)) > 5000 {
		return shared.NewValidationError("Return note must be at most 5000 characters", nil)
	}
	tx, err := s.ownedTx(ctx, user, project)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if focus != nil {
		var id string
		err = tx.QueryRow(ctx, `SELECT "id" FROM "Issue" WHERE "id"=$1 AND "projectId"=$2 FOR KEY SHARE`, *focus, project).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return shared.NewValidationError("Focus issue must belong to this project", nil)
		}
		if err != nil {
			return err
		}
	}
	_, err = tx.Exec(ctx, `INSERT INTO project_return_context(project_id,note,focus_issue_id) VALUES($1,$2,$3) ON CONFLICT(project_id) DO UPDATE SET note=EXCLUDED.note,focus_issue_id=EXCLUDED.focus_issue_id`, project, note, focus)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Service) Review(ctx context.Context, user, project, connection string, sequence int64) error {
	tx, err := s.ownedTx(ctx, user, project)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	result, err := tx.Exec(ctx, `UPDATE project_repository SET reviewed_sequence=GREATEST(reviewed_sequence,$1) WHERE project_id=$2 AND id=$3 AND $1>=0 AND $1<=sequence`, sequence, project, connection)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return shared.NewValidationError("Invalid review marker or connection", nil)
	}
	return tx.Commit(ctx)
}

// store is called with both Project and connection locked. Sequence allocation and commit
// happen in one transaction, so receipt ordering also respects transaction visibility.
func store(ctx context.Context, tx pgx.Tx, r *Connection, d Delivery, source string) error {
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM git_delivery WHERE connection_id=$1 AND delivery_id=$2)`, r.ID, d.DeliveryID).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return nil
	}
	r.Sequence++
	_, err := tx.Exec(ctx, `INSERT INTO git_delivery(connection_id,delivery_id,sequence,source,event_at) VALUES($1,$2,$3,$4,$5)`, r.ID, d.DeliveryID, r.Sequence, source, d.EventAt)
	if err != nil {
		return err
	}
	// Write the bounded window in one database round trip. Per-commit inserts can
	// exhaust recovery's deadline when the API and database are in different regions.
	shas := make([]string, len(d.Commits))
	messages := make([]string, len(d.Commits))
	authors := make([]string, len(d.Commits))
	eventTimes := make([]time.Time, len(d.Commits))
	latest := d.Commits[0].EventAt
	for i, c := range d.Commits {
		shas[i], messages[i], authors[i], eventTimes[i] = c.SHA, c.Message, c.Author, c.EventAt
		if c.EventAt.After(latest) {
			latest = c.EventAt
		}
	}
	_, err = tx.Exec(ctx, `INSERT INTO git_activity(connection_id,sha,delivery_id,message,author_name,event_at)
  SELECT $1,c.sha,$2,c.message,c.author_name,c.event_at
  FROM unnest($3::text[],$4::text[],$5::text[],$6::timestamptz[]) AS c(sha,message,author_name,event_at)
  ON CONFLICT(connection_id,sha) DO NOTHING`, r.ID, d.DeliveryID, shas, messages, authors, eventTimes)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE project_repository SET sequence=$1,incomplete=incomplete OR $2,last_git_activity_at=GREATEST(last_git_activity_at,$3) WHERE id=$4`, r.Sequence, d.Incomplete, latest, r.ID)
	return err
}
func (s *Service) Ingest(ctx context.Context, connection, secret string, d Delivery) error {
	if len(secret) != 64 {
		return shared.NewUnauthorizedError("Invalid integration credential")
	}
	var project, user string
	err := s.pool.QueryRow(ctx, `SELECT r.project_id,p."userId" FROM project_repository r JOIN "Project" p ON p."id"=r.project_id WHERE r.id=$1`, connection).Scan(&project, &user)
	if errors.Is(err, pgx.ErrNoRows) {
		return shared.NewUnauthorizedError("Invalid integration credential")
	}
	if err != nil {
		return err
	}
	tx, err := s.ownedTx(ctx, user, project)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	r, err := scanConnection(tx.QueryRow(ctx, connectionSQL+` FOR UPDATE`, project))
	if err != nil {
		return err
	}
	hash := sha256.Sum256([]byte(secret))
	if r == nil || r.ID != connection || subtle.ConstantTimeCompare(hash[:], r.Hash) != 1 {
		return shared.NewUnauthorizedError("Invalid integration credential")
	}
	if err = validateDelivery(d); err != nil {
		return err
	}
	if d.RepositoryID != r.RepositoryID || d.Branch != r.Branch {
		return shared.NewForbiddenError("Repository or branch does not match this connection")
	}
	// The sender never updates head_sha: only a successful GitHub catch-up may do so.
	if err = store(ctx, tx, r, d, "actions"); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE project_repository SET last_delivery_at=now() WHERE id=$1`, r.ID)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
