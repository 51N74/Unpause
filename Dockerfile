# syntax=docker/dockerfile:1

# ==============================================================================
# Stage 1: Build the React + Vite + TypeScript frontend (apps/web/dist)
# ==============================================================================
FROM node:22-alpine AS web-builder
WORKDIR /app

# Copy workspace manifests and lockfile for deterministic install via npm ci
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/api/package.json ./apps/api/package.json

# Include devDependencies (typescript, vite, @vitejs/plugin-react) required for the build
RUN npm ci --include=dev --workspace=@unpause/web

COPY apps/web ./apps/web

ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm --workspace=@unpause/web run build

# ==============================================================================
# Stage 2: Build the Go backend server and migration binaries (apps/api-go)
# ==============================================================================
FROM golang:1.27.3-alpine AS go-builder
WORKDIR /src/apps/api-go

COPY apps/api-go/go.mod apps/api-go/go.sum ./
RUN go mod download

COPY apps/api-go/cmd ./cmd
COPY apps/api-go/internal ./internal

RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server && \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/migrate ./cmd/migrate

# ==============================================================================
# Stage 3: Minimal production runtime (no Node.js or Go toolchain at runtime)
# ==============================================================================
FROM alpine:3.21 AS runtime

RUN apk add --no-cache ca-certificates tzdata && \
    addgroup -S unpause && \
    adduser -S -G unpause unpause

WORKDIR /app

# Preserve repository-relative paths so runtime configuration is identical
# between container execution and repository-root execution:
# - ./apps/api-go/bin/server
# - ./apps/api-go/bin/migrate
# - ./apps/api-go/migrations
# - ./apps/web/dist (STATIC_FILES_DIR=apps/web/dist)
COPY --from=go-builder /out/server ./apps/api-go/bin/server
COPY --from=go-builder /out/migrate ./apps/api-go/bin/migrate
COPY apps/api-go/migrations ./apps/api-go/migrations
COPY --from=web-builder /app/apps/web/dist ./apps/web/dist

RUN chown -R unpause:unpause /app

USER unpause

ENV NODE_ENV=production \
    PORT=10000 \
    STATIC_FILES_DIR=apps/web/dist \
    AUTO_MIGRATE=true \
    SESSION_COOKIE_SAMESITE=lax \
    SESSION_COOKIE_SECURE=true

EXPOSE 10000

CMD ["./apps/api-go/bin/server"]
