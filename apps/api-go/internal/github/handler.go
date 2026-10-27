package github

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/westride/unpause/api-go/internal/http/middleware"
	"github.com/westride/unpause/api-go/internal/shared"
)

// Handler handles GET /api/v1/github/repositories.
type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) SearchRepositories(c *gin.Context) {
	qRaw := strings.TrimSpace(c.Query("q"))
	language := strings.TrimSpace(c.Query("language"))
	minStarsRaw := strings.TrimSpace(c.Query("minStars"))
	pageRaw := strings.TrimSpace(c.Query("page"))
	perPageRaw := strings.TrimSpace(c.Query("perPage"))

	v := shared.NewValidator()
	if qRaw == "" {
		v.AddError("q", "Search query is required")
	} else if len([]rune(qRaw)) > 200 {
		v.AddError("q", "Search query must be at most 200 characters")
	}

	if len([]rune(language)) > 50 {
		v.AddError("language", "Language must be at most 50 characters")
	}

	var minStars *int
	if minStarsRaw != "" {
		n, err := strconv.Atoi(minStarsRaw)
		if err != nil || n < 0 {
			v.AddError("minStars", "minStars must be a non-negative integer")
		} else {
			minStars = &n
		}
	}

	page := 1
	if pageRaw != "" {
		p, err := strconv.Atoi(pageRaw)
		if err != nil || p < 1 || p > 100 {
			v.AddError("page", "page must be between 1 and 100")
		} else {
			page = p
		}
	}

	perPage := 10
	if perPageRaw != "" {
		pp, err := strconv.Atoi(perPageRaw)
		if err != nil || pp < 1 || pp > 30 {
			v.AddError("perPage", "perPage must be between 1 and 30")
		} else {
			perPage = pp
		}
	}

	if v.HasErrors() {
		middleware.RespondError(c, v.Err())
		return
	}

	results, err := h.service.SearchRepositories(c.Request.Context(), SearchParams{
		Query:    qRaw,
		Language: language,
		MinStars: minStars,
		Page:     page,
		PerPage:  perPage,
	})
	if err != nil {
		middleware.RespondError(c, err)
		return
	}

	c.JSON(http.StatusOK, results)
}
