// Package router wires all Unpause /api/v1 routes and middleware into a Gin Engine.
package router

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/westride/unpause/api-go/internal/auth"
	"github.com/westride/unpause/api-go/internal/config"
	"github.com/westride/unpause/api-go/internal/decisions"
	"github.com/westride/unpause/api-go/internal/github"
	"github.com/westride/unpause/api-go/internal/http/middleware"
	"github.com/westride/unpause/api-go/internal/issues"
	"github.com/westride/unpause/api-go/internal/projects"
	"github.com/westride/unpause/api-go/internal/scopes"
	"github.com/westride/unpause/api-go/internal/shared"
)

// Dependencies holds the configured services used by the HTTP router.
type Dependencies struct {
	Config          *config.Config
	Pool            *pgxpool.Pool
	AuthService     *auth.Service
	ProjectService  *projects.Service
	ScopeService    *scopes.Service
	IssueService    *issues.Service
	DecisionService *decisions.Service
	GitHubService   *github.Service
}

// NewDependencies constructs all domain services with explicit constructor injection.
func NewDependencies(cfg *config.Config, pool *pgxpool.Pool, httpClient *http.Client) *Dependencies {
	authSvc := auth.NewService(pool, cfg.SessionTTLHours)
	projSvc := projects.NewService(pool)
	scopeSvc := scopes.NewService(pool)
	decSvc := decisions.NewService(pool)
	issueSvc := issues.NewService(pool, decSvc)
	ghSvc := github.NewService(cfg.GitHubAPIBaseURL, cfg.GitHubToken, httpClient)

	return &Dependencies{
		Config:          cfg,
		Pool:            pool,
		AuthService:     authSvc,
		ProjectService:  projSvc,
		ScopeService:    scopeSvc,
		IssueService:    issueSvc,
		DecisionService: decSvc,
		GitHubService:   ghSvc,
	}
}

// NewEngine configures and returns a Gin Engine serving all /api/v1 routes.
func NewEngine(deps *Dependencies) *gin.Engine {
	if deps.Config.Env == "production" || deps.Config.Env == "test" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()
	r.Use(middleware.RecoveryMiddleware())
	r.Use(middleware.SecurityMiddleware(deps.Config.CORSOrigins))

	authHandler := auth.NewHandler(deps.AuthService, deps.Config)
	projHandler := projects.NewHandler(deps.ProjectService)
	scopeHandler := scopes.NewHandler(deps.ScopeService)
	issueHandler := issues.NewHandler(deps.IssueService)
	decHandler := decisions.NewHandler(deps.DecisionService)
	ghHandler := github.NewHandler(deps.GitHubService)

	requireAuth := middleware.RequireAuth(deps.Config, func(ctx context.Context, sessionID string) (any, string, error) {
		u, err := deps.AuthService.ValidateSession(ctx, sessionID)
		if err != nil {
			return nil, "", err
		}
		return u, u.ID, nil
	})

	v1 := r.Group("/api/v1")
	{
		v1.GET("/health", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{
				"status":    "ok",
				"timestamp": shared.FormatISO8601(time.Now().UTC()),
			})
		})

		// Public auth endpoints
		v1.POST("/auth/register", authHandler.Register)
		v1.POST("/auth/login", authHandler.Login)
		v1.POST("/auth/logout", authHandler.Logout)

		// Protected endpoints
		protected := v1.Group("")
		protected.Use(requireAuth)
		{
			protected.GET("/auth/me", authHandler.Me)
			protected.PATCH("/users/me", authHandler.UpdateProfile)
			protected.PUT("/users/me", authHandler.UpdateProfile)

			// Projects
			protected.GET("/projects", projHandler.List)
			protected.POST("/projects", projHandler.Create)
			protected.GET("/projects/:projectId", projHandler.GetByID)
			protected.PATCH("/projects/:projectId", projHandler.Update)
			protected.PUT("/projects/:projectId", projHandler.Update)
			protected.POST("/projects/:projectId/archive", projHandler.Archive)
			protected.POST("/projects/:projectId/restore", projHandler.Restore)

			// Differentiating views
			protected.GET("/projects/:projectId/resume-context", projHandler.GetResumeContext)
			protected.GET("/projects/:projectId/timeline", projHandler.GetTimeline)

			// Scope Versions (Immutable)
			protected.GET("/projects/:projectId/scope-versions", scopeHandler.List)
			protected.POST("/projects/:projectId/scope-versions", scopeHandler.Create)
			protected.GET("/projects/:projectId/scope-versions/:versionId", scopeHandler.GetByID)
			protected.PUT("/projects/:projectId/scope-versions", scopeHandler.RejectImmutable)
			protected.PATCH("/projects/:projectId/scope-versions", scopeHandler.RejectImmutable)
			protected.DELETE("/projects/:projectId/scope-versions", scopeHandler.RejectImmutable)
			protected.PUT("/projects/:projectId/scope-versions/:versionId", scopeHandler.RejectImmutable)
			protected.PATCH("/projects/:projectId/scope-versions/:versionId", scopeHandler.RejectImmutable)
			protected.DELETE("/projects/:projectId/scope-versions/:versionId", scopeHandler.RejectImmutable)

			// Issues
			protected.GET("/projects/:projectId/issues", issueHandler.List)
			protected.POST("/projects/:projectId/issues", issueHandler.Create)
			protected.GET("/projects/:projectId/issues/:issueId", issueHandler.GetByID)
			protected.PATCH("/projects/:projectId/issues/:issueId", issueHandler.Update)
			protected.PUT("/projects/:projectId/issues/:issueId", issueHandler.Update)
			protected.DELETE("/projects/:projectId/issues/:issueId", issueHandler.Delete)

			// Decision Records
			protected.GET("/projects/:projectId/decisions", decHandler.List)
			protected.POST("/projects/:projectId/decisions", decHandler.Create)
			protected.GET("/projects/:projectId/decisions/:decisionId", decHandler.GetByID)
			protected.PATCH("/projects/:projectId/decisions/:decisionId", decHandler.Update)
			protected.PUT("/projects/:projectId/decisions/:decisionId", decHandler.Update)
			protected.PATCH("/projects/:projectId/decisions/:decisionId/pin", decHandler.Pin)
			protected.DELETE("/projects/:projectId/decisions/:decisionId", decHandler.Delete)

			// GitHub Explorer
			protected.GET("/github/repositories", ghHandler.SearchRepositories)
		}
	}

	r.NoRoute(func(c *gin.Context) {
		middleware.RespondError(c, shared.NewNotFoundError("API endpoint not found"))
	})

	return r
}
