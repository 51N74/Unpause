package middleware

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/westride/unpause/api-go/internal/shared"
)

func isStateChangingMethod(method string) bool {
	switch strings.ToUpper(method) {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
}

// SecurityMiddleware enforces the CORS allowlist, sets security headers, and validates Origin/Referer/Sec-Fetch-Site on state-changing requests.
func SecurityMiddleware(allowedOrigins []string, isProduction ...bool) gin.HandlerFunc {
	prod := len(isProduction) > 0 && isProduction[0]
	allowedSet := make(map[string]struct{}, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		trimmed := strings.TrimRight(strings.TrimSpace(origin), "/")
		if trimmed != "" {
			allowedSet[trimmed] = struct{}{}
		}
	}

	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Header("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
		if prod {
			c.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}

		origin := strings.TrimSpace(c.GetHeader("Origin"))

		if origin != "" {
			if _, ok := allowedSet[origin]; !ok {
				RespondError(c, shared.NewInvalidOriginError())
				return
			}

			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Vary", "Origin")
			c.Header("Access-Control-Allow-Credentials", "true")
			c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept")
		}

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		if isStateChangingMethod(c.Request.Method) {
			if origin != "" {
				if _, ok := allowedSet[origin]; !ok {
					RespondError(c, shared.NewInvalidOriginError())
					return
				}
			} else {
				// When Origin is omitted, reject explicit cross-site Sec-Fetch-Site or disallowed Referer
				secFetchSite := strings.ToLower(strings.TrimSpace(c.GetHeader("Sec-Fetch-Site")))
				if secFetchSite == "cross-site" {
					RespondError(c, shared.NewInvalidOriginError())
					return
				}

				if referer := strings.TrimSpace(c.GetHeader("Referer")); referer != "" {
					parsedRef, err := url.Parse(referer)
					if err != nil || parsedRef.Scheme == "" || parsedRef.Host == "" {
						RespondError(c, shared.NewInvalidOriginError())
						return
					}
					refOrigin := parsedRef.Scheme + "://" + parsedRef.Host
					if _, ok := allowedSet[refOrigin]; !ok {
						RespondError(c, shared.NewInvalidOriginError())
						return
					}
				}
			}
		}

		if c.Request.Body != nil {
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
		}

		c.Next()
	}
}

type ipRateBucket struct {
	count   int
	resetAt time.Time
}

const maxTrackedRateLimitIPs = 4096

// AuthRateLimitMiddleware applies a bounded, per-IP fixed-window rate limit to authentication endpoints.
func AuthRateLimitMiddleware(maxRequests int, window time.Duration) gin.HandlerFunc {
	if maxRequests <= 0 {
		maxRequests = 25
	}
	if window <= 0 {
		window = time.Minute
	}

	var mu sync.Mutex
	buckets := make(map[string]*ipRateBucket)

	return func(c *gin.Context) {
		ip := c.ClientIP()
		if ip == "" {
			ip = "unknown"
		}

		now := time.Now()
		mu.Lock()
		b, exists := buckets[ip]
		if !exists || !now.Before(b.resetAt) {
			if !exists && len(buckets) >= maxTrackedRateLimitIPs {
				var oldestIP string
				var oldestTime time.Time
				for k, v := range buckets {
					if !now.Before(v.resetAt) {
						delete(buckets, k)
					} else if oldestIP == "" || v.resetAt.Before(oldestTime) {
						oldestIP = k
						oldestTime = v.resetAt
					}
				}
				if len(buckets) >= maxTrackedRateLimitIPs && oldestIP != "" {
					delete(buckets, oldestIP)
				}
			}
			b = &ipRateBucket{
				count:   1,
				resetAt: now.Add(window),
			}
			buckets[ip] = b
			mu.Unlock()
			c.Next()
			return
		}

		if b.count >= maxRequests {
			retryAfterSec := int(time.Until(b.resetAt).Seconds()) + 1
			if retryAfterSec < 1 {
				retryAfterSec = 1
			}
			mu.Unlock()
			c.Header("Retry-After", fmt.Sprintf("%d", retryAfterSec))
			RespondError(c, shared.NewRateLimitError(""))
			return
		}

		b.count++
		mu.Unlock()
		c.Next()
	}
}
