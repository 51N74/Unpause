package shared

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/bcrypt"
)

const (
	argon2Memory         uint32 = 19456
	argon2Time           uint32 = 2
	argon2Parallelism    uint8  = 1
	argon2SaltLen        uint32 = 16
	argon2KeyLen         uint32 = 32
	maxConcurrentArgon2  int    = 4
	dummyArgon2idPHCHash string = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXJhbmRvbXNhbHQxMjM0$K8p7mU5dG9X1vP2zL4qW6nB8yR0cT3fH5jK7lM9nP1q"
)

// argon2Sem bounds concurrent Argon2id computations so rapid authentication spikes
// cannot exhaust container memory on small hosting instances.
var argon2Sem = make(chan struct{}, maxConcurrentArgon2)

// HashPassword hashes a plaintext password using Argon2id and encodes it in standard PHC string format
// ($argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>), fully compatible with existing Node argon2 hashes.
func HashPassword(plain string) (string, error) {
	salt := make([]byte, argon2SaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("failed to generate password salt: %w", err)
	}

	argon2Sem <- struct{}{}
	hash := argon2.IDKey([]byte(plain), salt, argon2Time, argon2Memory, argon2Parallelism, argon2KeyLen)
	<-argon2Sem

	b64Salt := base64.RawStdEncoding.EncodeToString(salt)
	b64Hash := base64.RawStdEncoding.EncodeToString(hash)

	encoded := fmt.Sprintf(
		"$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version,
		argon2Memory,
		argon2Time,
		argon2Parallelism,
		b64Salt,
		b64Hash,
	)
	return encoded, nil
}

// VerifyPassword verifies a plaintext password against either an Argon2id PHC hash or a bcrypt fallback hash.
func VerifyPassword(encodedHash, plain string) (bool, error) {
	if strings.HasPrefix(encodedHash, "$argon2id$") {
		return verifyArgon2id(encodedHash, plain)
	}
	if strings.HasPrefix(encodedHash, "$2a$") || strings.HasPrefix(encodedHash, "$2b$") || strings.HasPrefix(encodedHash, "$2y$") {
		err := bcrypt.CompareHashAndPassword([]byte(encodedHash), []byte(plain))
		if errors.Is(err, bcrypt.ErrMismatchedHashAndPassword) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		return true, nil
	}
	return false, errors.New("unsupported password hash format")
}

func verifyArgon2id(encodedHash, plain string) (bool, error) {
	parts := strings.Split(encodedHash, "$")
	if len(parts) != 6 {
		return false, errors.New("invalid argon2id hash format")
	}

	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil {
		return false, fmt.Errorf("invalid argon2 version: %w", err)
	}

	var memory, iterations uint32
	var parallelism uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &iterations, &parallelism); err != nil {
		return false, fmt.Errorf("invalid argon2 parameters: %w", err)
	}

	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false, fmt.Errorf("invalid argon2 salt: %w", err)
	}

	expectedHash, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false, fmt.Errorf("invalid argon2 hash: %w", err)
	}

	argon2Sem <- struct{}{}
	computedHash := argon2.IDKey([]byte(plain), salt, iterations, memory, parallelism, uint32(len(expectedHash)))
	<-argon2Sem

	if subtle.ConstantTimeCompare(expectedHash, computedHash) == 1 {
		return true, nil
	}
	return false, nil
}

// VerifyDummyPassword performs a full Argon2id verification against a static dummy hash
// so failed login attempts for nonexistent accounts take the same work as existing accounts.
func VerifyDummyPassword(plain string) {
	_, _ = verifyArgon2id(dummyArgon2idPHCHash, plain)
}
