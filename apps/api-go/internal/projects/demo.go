package projects

import (
	"context"
	"github.com/google/uuid"
)

// Demo creates one private sample project per owner atomically. Repeated requests
// return the existing project without resetting edits or creating credentials.
func (s *Service) Demo(ctx context.Context, user string) (ProjectResponse, error) {
	id := uuid.NewSHA1(uuid.NameSpaceURL, []byte("unpause:resume-demo:v1:"+user)).String()
	scope, issue, decision := uuid.NewString(), uuid.NewString(), uuid.NewString()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ProjectResponse{}, err
	}
	defer tx.Rollback(ctx)
	result, err := tx.Exec(ctx, `INSERT INTO "Project"("id","userId","name","description","updatedAt") VALUES($1,$2,'Unpause Demo','Sample project: try saving a pause note, then connect your own public GitHub repository.',now()) ON CONFLICT("id") DO NOTHING`, id, user)
	if err != nil {
		return ProjectResponse{}, err
	}
	if result.RowsAffected() == 0 {
		if err = tx.Rollback(ctx); err != nil {
			return ProjectResponse{}, err
		}
		return s.GetByID(ctx, user, id)
	}
	_, err = tx.Exec(ctx, `INSERT INTO "ScopeVersion"("id","projectId","versionNumber","problem","targetUsers","goal","inScope","outOfScope","reasonForChange") VALUES($1,$2,1,'Returning after a break loses context','Solo developers','Know what changed, why and what to do next','Saved context, issues, decisions and one public repository','Automatic issue completion and private repositories','Initial demo scope')`, scope, id)
	if err != nil {
		return ProjectResponse{}, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO "Issue"("id","projectId","title","priority","nextAction","updatedAt") VALUES($1,$2,'Try the pause and resume flow','High','Save where you stopped, reload, then resume from your note.',now())`, issue, id)
	if err != nil {
		return ProjectResponse{}, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO "DecisionRecord"("id","projectId","scopeVersionId","issueId","problem","decision","rationale","isPinned","pinnedAt","updatedAt") VALUES($1,$2,$3,$4,'Keep project intent clear after code changes','Keep owner-authored context separate from commit history','A commit shows code activity; the owner records the reason and next action.',true,now(),now())`, decision, id, scope, issue)
	if err != nil {
		return ProjectResponse{}, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO project_return_context(project_id,note,focus_issue_id) VALUES($1,'Sample: the project structure is ready. Next, try Pause work and save your own handoff note.',$2)`, id, issue)
	if err != nil {
		return ProjectResponse{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return ProjectResponse{}, err
	}
	return s.GetByID(ctx, user, id)
}
