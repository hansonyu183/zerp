package app

import (
	"sync"
	"time"
)

const (
	signinWindow       = time.Minute
	signinWindowLimit  = 30
	limiterCleanupSize = 10_000
)

type signinWindowEntry struct {
	startedAt time.Time
	count     int
}

type signinLimiter struct {
	mu      sync.Mutex
	entries map[string]signinWindowEntry
	now     func() time.Time
}

func newSigninLimiter() *signinLimiter {
	return &signinLimiter{entries: make(map[string]signinWindowEntry), now: time.Now}
}

func (limiter *signinLimiter) allow(username string) bool {
	key := signinLimiterKey(username)
	now := limiter.now()
	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	entry, exists := limiter.entries[key]
	if exists && now.Sub(entry.startedAt) < signinWindow {
		if entry.count >= signinWindowLimit {
			return false
		}
		entry.count++
		limiter.entries[key] = entry
		return true
	}
	if len(limiter.entries) >= limiterCleanupSize {
		for entryKey, candidate := range limiter.entries {
			if now.Sub(candidate.startedAt) >= signinWindow {
				delete(limiter.entries, entryKey)
			}
		}
		if len(limiter.entries) >= limiterCleanupSize {
			return false
		}
	}
	limiter.entries[key] = signinWindowEntry{startedAt: now, count: 1}
	return true
}

func signinLimiterKey(username string) string {
	username = normalizeUsername(username)
	if !runeLengthBetween(username, 3, 64) {
		return "<invalid>"
	}
	return username
}
