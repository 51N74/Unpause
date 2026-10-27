package database

import (
	"bufio"
	"fmt"
	"io"
	"log"
	"net"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"
)

var localPGliteActive atomic.Bool

// IsLocalPGliteActive reports whether the embedded single-connection PGlite socket server
// was started for local development in this process.
func IsLocalPGliteActive() bool {
	return localPGliteActive.Load()
}

// EnsureLocalPostgresIfNeeded checks if a local PostgreSQL server is reachable when running
// in non-production mode against localhost/127.0.0.1. If no external PostgreSQL daemon is
// listening, it starts the local PGlite PostgreSQL socket server persisted to .pglite/unpause-dev-db.
func EnsureLocalPostgresIfNeeded(env string, dbURL string) (func(), error) {
	noop := func() {}
	if env == "production" {
		return noop, nil
	}

	parsed, err := url.Parse(dbURL)
	if err != nil {
		return noop, nil
	}

	host := parsed.Hostname()
	port := parsed.Port()
	if port == "" {
		port = "5432"
	}

	if host != "localhost" && host != "127.0.0.1" {
		return noop, nil
	}

	conn, err := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", port), 500*time.Millisecond)
	if err == nil {
		_ = conn.Close()
		return noop, nil
	}

	scriptPath := findRepoFile("scripts/pglite-server.mjs")
	if scriptPath == "" {
		return noop, nil
	}

	log.Printf("[devPostgres] No external PostgreSQL detected on %s:%s. Starting local PGlite PostgreSQL server...", host, port)

	cmd := exec.Command("node", scriptPath, port, "persist")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return noop, err
	}
	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		return noop, fmt.Errorf("failed to start pglite-server.mjs: %w", err)
	}

	readyCh := make(chan error, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "PGLITE_READY:") {
				readyCh <- nil
				_, _ = io.Copy(io.Discard, stdout)
				return
			}
		}
		if err := scanner.Err(); err != nil {
			readyCh <- err
		} else {
			readyCh <- fmt.Errorf("pglite-server exited before listening")
		}
	}()

	select {
	case err := <-readyCh:
		if err != nil {
			_ = cmd.Process.Kill()
			return noop, err
		}
	case <-time.After(15 * time.Second):
		_ = cmd.Process.Kill()
		return noop, fmt.Errorf("timed out waiting for local PGlite PostgreSQL server")
	}

	log.Printf("[devPostgres] Local PostgreSQL listening on 127.0.0.1:%s", port)
	localPGliteActive.Store(true)

	cleanup := func() {
		localPGliteActive.Store(false)
		if cmd.Process != nil {
			_ = cmd.Process.Signal(os.Interrupt)
			done := make(chan error, 1)
			go func() {
				done <- cmd.Wait()
			}()
			select {
			case <-done:
			case <-time.After(3 * time.Second):
				_ = cmd.Process.Kill()
				<-done
			}
		}
	}
	return cleanup, nil
}

func findRepoFile(relPath string) string {
	candidates := []string{
		relPath,
		filepath.Join("..", relPath),
		filepath.Join("..", "..", relPath),
		filepath.Join("..", "..", "..", relPath),
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			abs, err := filepath.Abs(candidate)
			if err == nil {
				return abs
			}
			return candidate
		}
	}
	return ""
}
