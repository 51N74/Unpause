package continuity

import (
	"context"
	"github.com/google/uuid"
	"github.com/westride/unpause/api-go/internal/shared"
	"time"
)

// Sync leases a bounded request without holding a DB connection during network I/O.
// A lease token prevents an older result from overwriting a newer synchronization.
func (s *Service) Sync(ctx context.Context, user, project string, force bool) error {
	tx, err := s.ownedTx(ctx, user, project)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	r, err := scanConnection(tx.QueryRow(ctx, connectionSQL+` FOR UPDATE`, project))
	if err != nil {
		return err
	}
	if r == nil {
		return shared.NewNotFoundError("Repository not connected")
	}
	now := time.Now()
	if r.SyncUntil != nil && r.SyncUntil.After(now) {
		return nil
	}
	if !force && r.LastSyncedAt != nil && now.Sub(*r.LastSyncedAt) < 5*time.Minute {
		return nil
	}
	token := uuid.NewString()
	result, err := tx.Exec(ctx, `UPDATE project_repository SET sync_token=$1,sync_until=now()+interval '30 seconds',last_attempt_at=now() WHERE id=$2 AND (last_attempt_at IS NULL OR last_attempt_at<now()-interval '30 seconds')`, token, r.ID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return nil
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	fetchCtx, fetchCancel := context.WithTimeout(ctx, 10*time.Second)
	defer fetchCancel()
	repo, fetchErr := s.resolve(fetchCtx, r.FullName)
	var commits []Commit
	if fetchErr == nil && repo.ID != r.RepositoryID {
		fetchErr = shared.NewGitHubUpstreamError("Repository identity changed; reconnect required", nil)
	}
	if fetchErr == nil {
		commits, fetchErr = s.commits(fetchCtx, r)
	}
	if fetchErr == nil {
		fetchErr = validateDelivery(Delivery{DeliveryID: token, RepositoryID: r.RepositoryID, Branch: r.Branch, EventAt: now.UTC(), Commits: commits})
	}
	// Cleanup also works after client cancellation, and never touches authored context.
	finishCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
	defer cancel()
	finish, err := s.ownedTx(finishCtx, user, project)
	if err != nil {
		return err
	}
	defer finish.Rollback(finishCtx)
	current, err := scanConnection(finish.QueryRow(finishCtx, connectionSQL+` FOR UPDATE`, project))
	if err != nil {
		return err
	}
	if current == nil || current.ID != r.ID {
		return shared.NewConflictError("Connection changed during sync", nil)
	}
	var activeToken *string
	if err = finish.QueryRow(finishCtx, `SELECT sync_token FROM project_repository WHERE id=$1`, r.ID).Scan(&activeToken); err != nil {
		return err
	}
	if activeToken == nil || *activeToken != token {
		return nil
	}
	if fetchErr != nil {
		_, err = finish.Exec(finishCtx, `UPDATE project_repository SET sync_token=NULL,sync_until=NULL,sync_error=true WHERE id=$1`, r.ID)
		if err != nil {
			return err
		}
		if err = finish.Commit(finishCtx); err != nil {
			return err
		}
		return fetchErr
	}
	incomplete := len(commits) == 100
	if r.Head != "" {
		found := false
		for _, c := range commits {
			if c.SHA == r.Head {
				found = true
			}
		}
		if !found {
			incomplete = true
		}
	}
	d := Delivery{DeliveryID: "recovery:" + token, RepositoryID: r.RepositoryID, Branch: r.Branch, EventAt: now.UTC(), Incomplete: incomplete, Commits: commits}
	if err = store(finishCtx, finish, current, d, "recovery"); err != nil {
		return err
	}
	_, err = finish.Exec(finishCtx, `UPDATE project_repository SET last_synced_at=now(),head_sha=$1,sync_token=NULL,sync_until=NULL,sync_error=false WHERE id=$2`, commits[0].SHA, r.ID)
	if err != nil {
		return err
	}
	return finish.Commit(finishCtx)
}
